import os from "os";
import path from "path";
import fetch from "node-fetch";
import webpack, { Watching } from "webpack";
import SpawnServerPlugin from "../";

const TEMP_DIR = os.tmpdir();
let watcher: Watching;
let server: SpawnServerPlugin;

beforeEach(() => {
  return new Promise((resolve, reject) => {
    server = new SpawnServerPlugin();
    watcher = webpack({
      mode: "development",
      name: "Server",
      target: "node",
      watch: true,
      externals: [/^[^./!]/],
      entry: path.join(__dirname, "fixtures/server.js"),
      plugins: [server],
      output: {
        libraryTarget: "commonjs2",
        path: TEMP_DIR
      }
    }).watch({}, (err, stats) => {
      err = err || (stats.hasErrors() && new Error(stats.toString("errors-only")));

      if (err) {
        reject(err);
      } else {
        server.once("listening", resolve);
      }
    });
  });
});

afterEach(() => new Promise(resolve => watcher.close(resolve)));

test("Spawn Server Plugin", async () => {
  const res = await fetch("http://localhost:3000");
  const text = await res.text();
  expect(text).toEqual("hi");
});
