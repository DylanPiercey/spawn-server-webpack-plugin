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

// Build webpack config.
var config = {
  name: 'Server',
  target: 'node',
  externals: [/^[^./!]/], // Trick to exclude node modules.
  entry: './myfile.js',
  plugins: [new SpawnServerPlugin({ args: ['-r', 'source-map-support/register'] })], // Use the plugin.
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

```

### Contributions

* Use `npm test` to run tests.

Please feel free to create a PR!
