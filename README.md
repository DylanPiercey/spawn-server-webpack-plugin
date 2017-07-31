# Spawn Server (Webpack Plugin)
Webpack plugin for Node builds that will automatically load the build into memory when watching and restart the server on consecutive builds.

# Installation

#### Npm
```console
npm install spawn-server-webpack-plugin
```

# Example Config
```javascript
var webpack = require('webpack')
var SpawnServerPlugin = require('spawn-server-webpack-plugin')
var spawnedServer = new SpawnServerPlugin({
  args: [
    '--inspect-brk',
    '-r', 'some-file.js'
  ]
})

// Build webpack config.
var config = {
  name: 'Server',
  target: 'node',
  devtool: 'cheap-module-inline-source-map',
  externals: [/^[^./!]/], // Trick to exclude node modules.
  entry: './myfile.js',
  plugins: [
    // Support inline sourcemaps.
    new webpack.BannerPlugin({ banner: 'require("source-map-support").install({ hookRequire: true })', raw: true }),
    // Use the plugin.
    spawnedServer
  ],
  output: {
    libraryTarget: 'commonjs2',
    filename: 'build.js',
    path: 'dist'
  }
}

// Start webpack and trigger watch mode.
webpack(config).watch({ ignore: /node_modules/ }, function (err, stats) {
  // The built node server will start running in the background.
})

// Special events (listening and closing)
spawnedServer.on('listening', function (address) {
  this.address === { port: ..., ip: ... }
  this.listening === true
})

spawnedServer.on('closing', function () {
  this.address === null
  this.listening === false
})
```

### Using with webpack-dev-server
If you are using webpack dev server and are running into 'ECONN' issues when using the spawn server plugin then you can use the following trick to automatically recover once the server has restarted.

```js
const configs = [
  {...}, // Browser build
  {...} // Server build (included spawn-server-plugin)
]

new DevServer(webpack(configs), {
  ...,
  // Setup proxy to the actual server.
  proxy: { target: 'http://localhost:9090' },
  // Ensure webpack waits for server build before reloading.
  setup (app) {
    app.use((req, res, next) => {
      if (spawnedServer.listening) next()
      else spawnedServer.once('listening', next)
    })
  }
})
```

### Contributions

* Use `npm test` to run tests.

Please feel free to create a PR!
