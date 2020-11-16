/* eslint-disable no-constant-condition */
import fs from "fs";
import path from "path";
import pEvent from "p-event";
import { EventEmitter } from "events";
import type { AddressInfo } from "net";
import type { IncomingMessage, ServerResponse } from "http";
import type { Compiler, compilation } from "webpack";
import cluster, { Worker } from "cluster";
import exitHook from "exit-hook";
import InjectPlugin, { ENTRY_ORDER } from "webpack-inject-plugin";

type Assets = Record<string, string>;
const HMR_CLIENT_SCRIPT = fs.readFileSync(require.resolve("./hmr-client"), "utf-8");
const WORKER_FILE = require.resolve("./worker");
const WATCHING_COMPILERS = new WeakSet();
const PLUGIN_NAME = "spawn-server-webpack-plugin";
const EVENT = {
  LISTENING: "listening",
  CLOSING: "closing"
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
              Refresh: `0 url=${req.url!}`
            });
            res.end();
          }
        }
      }
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
    }
  };
  private _isHMR = false;
  private _worker: Worker | null = null;
  private _previousAssets: Assets | null = null;
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
    exitHook(() => {
      if (this._worker?.isConnected()) {
        process.kill(this._worker.process.pid);
      }
    });
  }

  // Starts plugin.
  public apply(compiler: Compiler): void {
    this._isHMR =
      compiler.options.plugins?.some(
        plugin => plugin.constructor.name === "HotModuleReplacementPlugin"
      ) || false;
    compiler.hooks.afterEmit.tapPromise(PLUGIN_NAME, this._reload);
    compiler.hooks.watchClose.tap(PLUGIN_NAME, this._close);
    compiler.hooks.beforeCompile.tap(
      PLUGIN_NAME,
      () => (this.listening = false)
    ); // Mark the server as not listening while we try to rebuild.
    compiler.hooks.watchRun.tap(PLUGIN_NAME, () =>
      WATCHING_COMPILERS.add(compiler)
    ); // Track watch mode.

    if (this._isHMR) {
      new InjectPlugin(() => HMR_CLIENT_SCRIPT, {
        entryName: this._options.mainEntry,
        entryOrder: ENTRY_ORDER.First
      }).apply(compiler);

      console.log(compiler.options.entry);
    }
  }

  // Loads output from memory into a new node process.
  private _reload = async (
    compilation: compilation.Compilation
  ): Promise<void> => {
    const compiler = compilation.compiler;
    const options = compiler.options;

    // Only runs in watch mode.
    if (!WATCHING_COMPILERS.has(compiler)) return;

    // Don't reload if there was errors.
    if (compilation.errors.length) return;

    const assets = toAssets(compilation.assets);

    if (this._worker?.isConnected()) {
      if (this._isHMR) {
        const previousAssets = this._previousAssets;
        this._previousAssets = assets;
        this._worker.send({
          event: `${PLUGIN_NAME}:hmr`,
          assets: changedAssets(previousAssets, assets)
        });

        const { status } = (await waitForMessage(this._worker, "hmr-done")) as {
          status: string;
        };

        if (status === "success") {
          return;
        }
      }

      await this._close();
    }

    // Server is started based off files emitted from the main entry.
    // eslint-disable-next-line
    const mainChunk = compilation.entrypoints
      .get(this._options.mainEntry)
      ?.getRuntimeChunk().files[0] as string;

    if (!mainChunk) {
      throw new Error(
        `spawn-server-webpack-plugin: Could not find an output file for the "${
          this._options.mainEntry || "default"
        }" entry.`
      );
    }

    cluster.setupMaster({
      exec: WORKER_FILE,
      execArgv: this._options.args
    });

    // Send compiled javascript to child process.
    this._worker = cluster.fork();
    this._worker.send({
      event: `${PLUGIN_NAME}:spawn`,
      assets,
      entry: path.join(options.output!.path!, mainChunk)
    });

    this._onListening(
      (this._options.waitForAppReady
        ? (await waitForMessage(this._worker, "app-ready")).address
        : await waitForEvent(this._worker, "listening")) as AddressInfo
    );
  };
  // Kills any running child process.
  private _close = async (): Promise<void> => {
    if (!this._worker?.isConnected()) {
      return;
    }

    this.listening = false;
    this.emit(EVENT.CLOSING);
    process.kill(this._worker.process.pid);
    await pEvent(this._worker, "exit");
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

/**
 * Calculates the diff of two different lists of assets.
 */
function changedAssets(previousAssets: Assets | null, newAssets: Assets) {
  if (!previousAssets) {
    return newAssets;
  }

  const result: Record<string, string | null> = {};

  for (const key in newAssets) {
    if (previousAssets[key] !== undefined) {
      result[key] = newAssets[key];
    }
  }

  for (const key in previousAssets) {
    if (newAssets[key] === undefined) {
      result[key] = null;
    }
  }

  return result;
}

/**
 * Converts webpack assets into a searchable map.
 */
function toAssets(
  assets: Record<string, { existsAt: string; source: () => string }>
) {
  const result: Assets = {};

  for (const key in assets) {
    const asset = assets[key];
    result[asset.existsAt] = asset.source();
  }

  return result;
}

async function waitForMessage(worker: Worker, name: string) {
  while (true) {
    const msg = await waitForEvent(worker, "message");

    if (msg?.event === `${PLUGIN_NAME}:${name}`) {
      return msg;
    }
  }
}

function waitForEvent(worker: Worker, name: string) {
  return pEvent(worker, name, {
    rejectionEvents: ["error", "exit"]
  }) as Promise<Record<string, unknown>>;
}

typeof module === "object" && (module.exports = exports = SpawnServerPlugin);
export default SpawnServerPlugin;
