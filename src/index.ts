import type { AddressInfo } from "net";
import type { IncomingMessage, ServerResponse } from "http";
import type { compilation, Compiler, Stats } from "webpack";
import cluster, { Worker } from "cluster";
import path from "path";
import exitHook from "exit-hook";
import { EventEmitter } from "events";
const WORKER_FILE = require.resolve("./worker");
const WATCHING_COMPILERS = new WeakSet();
const PLUGIN_NAME = "spawn-server-webpack-plugin";
const EVENT = {
  RESTART: Symbol(),
  LISTENING: "listening",
  CLOSING: "closing",
} as const;

/**
 * Creates a webpack plugin that will automatically run the build in a child process.
 */
class SpawnServerPlugin extends EventEmitter {
  public listening = true;
  public address: null | AddressInfo = null;
  public devServerConfig = {
    proxy: {
      "**": {
        xfwd: true,
        target: true,
        logLevel: "silent",
        router: (): string | Promise<string> => {
          if (this.listening) return getAddress(this);
          return new Promise<string>((resolve) => {
            this.once("listening", () => {
              resolve(getAddress(this));
            });
          });
        },
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
  };
  private _hash = "";
  private _started = false;
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
    exitHook(this._close);
  }

  // Starts plugin.
  public apply(compiler: Compiler): void {
    compiler.hooks.done.tap(PLUGIN_NAME, this._reload);
    compiler.hooks.watchClose.tap(PLUGIN_NAME, this._close);
    compiler.hooks.make.tap(PLUGIN_NAME, () => (this.listening = false)); // Mark the server as not listening while we try to rebuild.
    compiler.hooks.watchRun.tap(PLUGIN_NAME, () =>
      WATCHING_COMPILERS.add(compiler)
    ); // Track watch mode.
  }

  // Loads output from memory into a new node process.
  private _reload = (stats: Stats): void => {
    const compilation = stats.compilation;
    const compiler = compilation.compiler;
    const options = compiler.options;

    // Only runs in watch mode.
    if (!WATCHING_COMPILERS.has(compiler)) return;

    // Don't reload if there was errors.
    if (stats.hasErrors()) return;

    // For some reason webpack can output a done event twice for the same compilation...
    if (compilation.hash === this._hash) return;
    this._hash = compilation.hash!;

    // Kill existing process.
    this._close(() => {
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

      // Update cluster settings to load empty file and use provided args.
      const originalExec = cluster.settings.exec;
      const originalArgs = cluster.settings.execArgv;
      cluster.settings.exec = WORKER_FILE;
      cluster.settings.execArgv = this._options.args;

      // Start new process.
      this._started = true;
      this._worker = cluster.fork(Object.assign({ PORT: 0 }, process.env));

      // Send compiled javascript to child process.
      this._worker.send({
        action: "spawn",
        assets: toSources(stats.compilation),
        entry: path.isAbsolute(mainChunk)
          ? mainChunk
          : path.join(options.output!.path!, mainChunk),
      });

      if (this._options.waitForAppReady) {
        const checkMessage = (data: Record<string, unknown>) => {
          if (data && data.event === "app-ready") {
            this._onListening(data.address as AddressInfo);
            this._worker!.removeListener("message", checkMessage);
          }
        };
        this._worker.on("message", checkMessage);
      } else {
        // Trigger listening event once any server starts.
        this._worker.once("listening", this._onListening);
      }

      // Reset cluster settings.
      cluster.settings.exec = originalExec;
      cluster.settings.execArgv = originalArgs;
    });
  };
  // Kills any running child process.
  private _close = (done?: () => void): void => {
    if (!this._started) {
      done && done();
      return;
    }

    // Check if we need to close the existing server.
    if (this._worker!.isDead()) {
      done && setImmediate(() => this.emit(EVENT.RESTART));
    } else {
      this._worker!.once("exit", () => this.emit(EVENT.RESTART));
      this._worker!.kill("SIGKILL");
    }

    this.listening = false;
    this.emit(EVENT.CLOSING);

    // Ensure that we only start the most recent router.
    this.removeAllListeners(EVENT.RESTART);
    done && this.once(EVENT.RESTART, done);
  };

  /**
   * Called once the spawned process has a server started/listening.
   * Saves the server address.
   */
  private _onListening = (address: AddressInfo): void => {
    this.listening = true;
    this.address = address;
    this.emit(EVENT.LISTENING);
  };
}

function getAddress(plugin: SpawnServerPlugin) {
  return `http://127.0.0.1:${plugin.address!.port}`;
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

typeof module === "object" && (module.exports = exports = SpawnServerPlugin);
export default SpawnServerPlugin;
