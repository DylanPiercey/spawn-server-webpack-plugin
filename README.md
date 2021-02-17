# Spawn Server (Webpack Plugin)

Webpack plugin for Node builds that will automatically load the build into memory when watching and restart the server on consecutive builds.
Under the hood this module uses `worker_threads` and requires node >= 10.

# Installation

#### Npm

```console
npm install spawn-server-webpack-plugin
```

# Example Config

```javascript
const webpack = require("webpack");
const SpawnServerPlugin = require("spawn-server-webpack-plugin");
const spawnedServer = new SpawnServerPlugin({
  args: [
    "--inspect-brk",
    "-r", "some-file.js"
  ]
});

// Build webpack config.
const config = {
  target: "node",
  externals: [/^[^./!]/], // Trick to exclude node modules.
  entry: "./myfile.js",
  plugins: [
    // Support inline sourcemaps.
    new webpack.BannerPlugin({
      banner: 'require("source-map-support").install({ hookRequire: true })',
      raw: true
    }),
    // Use the plugin.
    spawnedServer
  ],
  output: {
    libraryTarget: "commonjs2",
    path: "dist"
  }
};

// Start webpack and trigger watch mode.
webpack(config).watch({ ignore: /node_modules/ }, (err, stats) => {
  // The built node server will start running in the background.
});

// Listen for server start (emitted once for every build)
spawnedServer.on("listening", (address) => {
  this.address === { port: ..., address: ... }
  this.listening === true
});
```

### Using with webpack-dev-server

To automatically proxy a WebpackDevServer to the active spawned server (and to ensure that requests wait during server rebuilds) you can add the config exposed under `spawnedServerInstance.devServerConfig` into your `devServer` webpack options.

```js
const configs = [
  {...}, // Browser build
  {...} // Server build (included spawn-server-plugin)
];

new DevServer(webpack(configs), {
  // Set your custom options, then spread in the spawned server config
  ...spawnedServer.devServerConfig
}).listen(8081);

// This is approximately the same as:

new DevServer(webpack(configs), {
  ...,
  // Setup proxy to the actual server.
  proxy: { "**": { target: "http://localhost:8080" } },
  // Ensure webpack waits for server build before reloading.
  setup (app) {
    app.use((req, res, next) => {
      if (spawnedServer.listening) next()
      else spawnedServer.once("listening", next)
    })
  }
}).listen(8081);
```

> _You can also add this configuration in the same way into the `webpack.config.js` file under the `devServer` option._

Finally you must call the `attachDevServer` global function added by this plugin in your app with the `AddressInfo` for your app, here is an example http server:

```js
import http from "http";

const server = http.createServer(
  (req, res) => {
    // ...
  },
  () => {
    const address = server.address();

    if (global.attachDevServer) {
      global.attachDevServer(address);
    }

    console.log(`Server started on ${address.address}:${address.port}`);
  }
);
```

### Multiple entry points

Often with server side bundling you will have a single entry point for your server (and thus webpack) which works perfectly with this plugin.
If you need to use multiple entrypoints for your webpack config for the server then this plugin will look for an output file for the `main` entry. You can override this to use a different entry name via the `mainEntry` option to this plugin.

```js
const spawnedServer = new SpawnServerPlugin({
  mainEntry: "index"
});

module.exports = {
  ...,
  entry: {
    index: "./src/index",
    other: "./src/other"
  },
  ...,
  plugins: [
    spawnedServer
  ]
};
```

#### Dynamic Server Port

Using the `devServerConfig` will automatically set `process.env.PORT = 0`. This allows for the spawned server to start on the next available port if you use this environment variable as the port option when listening.

### Contributions

- Use `npm test` to run tests.

Please feel free to create a PR!
