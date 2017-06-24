'use strict'

var path = require('path')
var nativeFs = require('fs')
var cluster = require('cluster')
var exitHook = require('exit-hook')
var EventEmitter = require('events').EventEmitter
var noopFile = path.join(__dirname, 'noop.js')
function noop () {}

// Expose plugin.
module.exports = SpawnServerPlugin

/**
 * Creates a webpack plugin that will automatically run the build in a child process.
 *
 * @param {object} [options]
 */
function SpawnServerPlugin (options) {
  this.options = options || {}
  this.reload = this.reload.bind(this)
  this.close = this.close.bind(this)
  this.options.args = this.options.args || []
  exitHook(this.close)
}

SpawnServerPlugin.prototype = Object.create(EventEmitter.prototype)

// Starts plugin.
SpawnServerPlugin.prototype.apply = function (compiler) {
  compiler.plugin('done', this.reload)
  compiler.plugin('watch-close', this.close)
  compiler.plugin('watch-run', function (_, done) {
    // Track watch mode.
    compiler.__IS_WATCHING__ = true
    done()
  })
}

// Loads output from memory into a new node process.
SpawnServerPlugin.prototype.reload = function (stats) {
  var compiler = stats.compilation.compiler
  var options = compiler.options
  var fs = compiler.outputFileSystem
  if (!fs.createReadStream) fs = nativeFs

  // Only runs in watch mode.
  if (!compiler.__IS_WATCHING__) return

  // Kill existing process.
  this.close(function () {
    // Load script from memory.
    var outFile = path.join(options.output.path, options.output.filename)
    var script = fs.readFileSync(outFile, 'utf8')

    // Update cluster settings to load empty file and use provided args.
    var originalExec = cluster.settings.exec
    var originalArgs = cluster.settings.execArgv
    cluster.settings.exec = noopFile
    cluster.settings.execArgv = this.options.args.concat(
      '-e', (
        // Automatically load inline source maps.
        'require("source-map-support").install({ hookRequire: true, environment: "node" });' +
        // Load file from string (allows proper source maps during eval).
        'require("require-from-string")(' + JSON.stringify(script) + ', ' + JSON.stringify(outFile) + ')'
      )
    )

    // Start new process.
    this.process = cluster.fork()
    this.process.once('listening', function onListening (address) {
      this.listening = true
      this.emit('listening', address)
    }.bind(this))

    // Reset cluster settings.
    cluster.settings.exec = originalExec
    cluster.settings.execArgv = originalArgs
  }.bind(this))
}

// Kills any running child process.
SpawnServerPlugin.prototype.close = function (done) {
  done = done || noop
  this.listening = false
  if (!this.process) return done()
  this.emit('closing')
  this.process.once('exit', done)
  this.process.kill()
  this.process = null
}
