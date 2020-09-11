import path from "path";
import { EventEmitter } from "events";
import { Volume } from "memfs";
import pEvent from "p-event";
import fetch from "node-fetch";
import webpack from "webpack";
import SpawnServerPlugin from "../";

test("Spawn Server Plugin", async () => {
  const entry = "/index.js";
  const vol = Volume.fromJSON({
    [entry]: createServerBoilerplate("hi")
  })
  const server = createBundledServer(vol, entry);

  try {
    await pEvent(server, "listening");
    expect(await (await fetch("http://localhost:3000")).text()).toEqual("hi");
  
    vol.writeFileSync(entry, createServerBoilerplate("updated"));
    server.invalidate();
    await pEvent(server, "listening");

    expect(await (await fetch("http://localhost:3000")).text()).toEqual("updated");
  } finally {
    await server.close();
  }
});

function createBundledServer(vol: ReturnType<typeof Volume.fromJSON>, entry: string) {
  (vol as typeof vol & { join: typeof path.join }).join = path.join.bind(path);
  const emitter = new EventEmitter();
  const server = new SpawnServerPlugin();
  const compiler = webpack({
    entry,
    watch: true,
    target: "node",
    plugins: [server],
    mode: "development",
    externals: [/^[^./!]/],
    output: {
      libraryTarget: "commonjs2",
      path: "/"
    }
  })

  compiler.inputFileSystem = vol as typeof compiler.inputFileSystem;
  compiler.outputFileSystem = vol as unknown as typeof compiler.outputFileSystem;

  const watcher = compiler.watch({}, (err, stats) => {
    err = err || (stats.hasErrors() && new Error(stats.toString("errors-only")));

    if (err) {
      emitter.emit("error", err);
    } else {
      server.once("listening", () => emitter.emit("listening"));
    }
  });

  return Object.assign(emitter, {
    close() {
      return new Promise(resolve => watcher.close(resolve));
    },
    invalidate() {
      watcher.invalidate();
    }
  });
}

function createServerBoilerplate(msg: string) {
  return `
  require("http").createServer((req, res) => {
    res.end(${JSON.stringify(msg)});
  }).listen(3000);
  `
}