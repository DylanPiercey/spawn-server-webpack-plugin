import type { AddressInfo } from "net";
import type { IncomingMessage, ServerResponse } from "http";
import type { compilation, Compiler, Stats } from "webpack";
import { Worker } from "worker_threads";
import path from "path";
import exitHook from "exit-hook";
import { EventEmitter } from "events";
const WORKER_FILE = require.resolve("./worker");
const WATCHING_COMPILERS = new WeakSet();
const PLUGIN_NAME = "spawn-server-webpack-plugin";
const EVENT = {
  LISTENING: "listening",
} as const;

export type attachDevServer = (address: AddressInfo) => void;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface Global {
      attachDevServer?: attachDevServer;
    }
  }
}

/**
 * Creates a webpack plugin that will automatically run the build in a child process.
 */
class SpawnServerPlugin extends EventEmitter {
  public listening = true;
  public address: null | AddressInfo = null;
  public devServerConfig = {
    proxy: {
      "**": {
        target: true,
        logLevel: "silent",
        router: (): string => `http://127.0.0.1:${this.address!.port}`,
        onError: (
          err: Error,
          req: IncomingMessage,
          res: ServerResponse
        ): void => {
          if (this.listening) {
            console.error(err);
          } else {
            res.writeHead(200, {
              Refresh: `0 url=${req.url!}`,
            });
            res.end();
          }
        },
      },
    },
    before: (
      app: unknown & {
        use: (
          fn: (
            req: IncomingMessage,
            res: ServerResponse,
            next: () => void
          ) => void
        ) => void;
      }
    ): void => {
      process.env.PORT = "0";
      app.use((req, res, next) => {
        if (this.listening) next();
        else this.once("listening", next);
      });
    },
  };
  private _worker: Worker | null = null;
  constructor(
    private _options: {
      waitForAppReady?: boolean;
      mainEntry?: string;
      args?: string[];
    } = {}
  ) {
    super();
    _options.mainEntry = _options.mainEntry || "main";
    _options.args = _options.args || [];
    this._options = _options;
    exitHook(this._terminate);
  }

  // Starts plugin.
  public apply(compiler: Compiler): void {
    compiler.hooks.done.tap(PLUGIN_NAME, this._reload);
    compiler.hooks.watchClose.tap(PLUGIN_NAME, this._terminate);
    compiler.hooks.make.tap(PLUGIN_NAME, () => (this.listening = false)); // Mark the server as not listening while we try to rebuild.
    compiler.hooks.watchRun.tap(PLUGIN_NAME, () =>
      WATCHING_COMPILERS.add(compiler)
    ); // Track watch mode.
  }

  // Loads output from memory into a new node process.
  private _reload = (stats: Stats): void => {
    const compiler = stats.compilation.compiler;
    const options = compiler.options;

    // Only runs in watch mode.
    if (!WATCHING_COMPILERS.has(compiler)) return;

    // Don't reload if there was errors.
    if (stats.hasErrors()) return;

    // Kill existing process.
    this._terminate(() => {
      // Server is started based off files emitted from the main entry.
      // eslint-disable-next-line

      let mainChunk: string | undefined = undefined;
      // eslint-disable-next-line
      const files = stats.compilation.entrypoints
        .get(this._options.mainEntry)
        ?.getRuntimeChunk().files;

      if (files) {
        // Read the first file using iteration protocol.
        // webpack 5 uses a Set, while webpack 4 uses an array.
        // This will work for both and is more efficient.
        for (mainChunk of files) break;
      }

      if (!mainChunk) {
        throw new Error(
          `spawn-server-webpack-plugin: Could not find an output file for the "${
            this._options.mainEntry || "default"
          }" entry.`
        );
      }

      // Start new process.
      this._worker = new Worker(WORKER_FILE, {
        execArgv: this._options.args,
        workerData: {
          assets: toSources(stats.compilation),
          entry: path.isAbsolute(mainChunk)
            ? mainChunk
            : path.join(options.output!.path!, mainChunk),
        },
      });

      this._worker.once("exit", () => {
        this._worker = null;
        this.listening = false;
      });

      const checkMessage = (address: Record<string, unknown>) => {
        if (isAddressInfo(address)) {
          this._onListening(address);
          this._worker!.removeListener("message", checkMessage);
        }
      };

      this._worker.on("message", checkMessage);
    });
  };
  // Kills any running child process.
  private _terminate = (done?: () => void): void => {
    if (!this._worker) {
      done && queueMicrotask(done);
      return;
    }

    this.listening = false;
    this._worker.terminate().then(done, done);
  };

  /**
   * Called once the spawned process has a server started/listening.
   * Saves the server address.
   */
  private _onListening = (address: AddressInfo): void => {
    console.log(address);
    this.listening = true;
    this.address = address;
    this.emit(EVENT.LISTENING);
  };
}

/**
 * Converts webpack assets into a searchable map.
 */
function toSources(compilation: compilation.Compilation) {
  const { outputPath } = compilation.compiler;
  const fs = (compilation.compiler
    .outputFileSystem as unknown) as typeof import("fs");
  const result: Record<string, string> = {};

  for (const assetPath in compilation.assets) {
    const asset = compilation.assets[assetPath];
    const existsAt =
      asset.existsAt ||
      (path.isAbsolute(assetPath)
        ? assetPath
        : path.join(outputPath, assetPath));
    result[existsAt] = fs.readFileSync
      ? fs.readFileSync(existsAt, "utf-8")
      : asset.source();
  }

  return result;
}

function isAddressInfo(data: unknown): data is AddressInfo {
  return (
    data !== undefined &&
    (data as AddressInfo).address !== undefined &&
    (data as AddressInfo).port !== undefined
  );
}

typeof module === "object" && (module.exports = exports = SpawnServerPlugin);
export default SpawnServerPlugin;
