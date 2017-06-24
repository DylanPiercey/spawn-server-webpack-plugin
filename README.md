# Spawn Server (Webpack Plugin)
Webpack plugin for Node builds that will automatically load the build into memory when watching and restart the server on consecutive builds.

This plugin also automatically supports inline source maps.

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
  plugins: [spawnedServer], // Use the plugin.
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
  this.listening === true
})

spawnedServer.on('closing', function () {
  this.listening === false
})
```

### Using with webpack-dev-server
If you are using webpack dev server and are running into 'ECONN' issues when useing the spawn server plugin then you can use the following trick to automatically recover once the server has restarted.

```js
const configs = [
  {...}, // Browser build
  {...} // Server build (included spawn-server-plugin)
]

new DevServer(webpack(configs), {
  ...,
  proxy: {
    target: 'http://localhost:9090',
    onError: (e, req, res) => {
      // Automatically retry when server is restarting.
      if (spawnedServer.listening) return
      res.writeHead(302, { location: req.url })
      spawnedServer.once('listening', () => res.end())
    }
  }
})
```

### Contributions

* Use `npm test` to run tests.

Please feel free to create a PR!
