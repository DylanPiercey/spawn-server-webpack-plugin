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
    var assets = stats.compilation.assets
    var outFile = path.join(options.output.path, options.output.filename)

    // Update cluster settings to load empty file and use provided args.
    var originalExec = cluster.settings.exec
    var originalArgs = cluster.settings.execArgv
    cluster.settings.exec = noopFile

    // Creates an IIFE that automatically intercepts require calls and uses in memory data.
    cluster.settings.execArgv = this.options.args.concat(
      '-e', '(' + function (entry, assets) {
        // Monkey patch asset loading.
        var fs = require('fs')
        var Module = require('module')

        // Pretend files from memory exist on disc.
        var findPath = Module._findPath
        Module._findPath = function (file) {
          return (assets[file] && file) || findPath.apply(this, arguments)
        }

        // Patches target 'node' System.import calls.
        var readFileSync = fs.readFileSync
        fs.readFileSync = function (file) {
          return assets[file] || readFileSync.apply(this, arguments)
        }

        // Patches target 'async-node' System.import calls.
        var readFile = fs.readFile
        fs.readFile = function (file) {
          if (!assets[file]) return readFile.apply(this, arguments)
          var cb = arguments[arguments.length - 1]
          setImmediate(function () { cb(null, assets[file]) })
        }

        // Load entry file from assets.
        require(entry)
      }.toString() + ')(' +
        JSON.stringify(outFile) + ', ' +
        JSON.stringify(toSources(assets)) +
      ')'
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

/**
 * Converts webpack assets into a searchable map.
 */
function toSources (assets) {
  var result = {}
  var asset

  for (var key in assets) {
    asset = assets[key]
    result[asset.existsAt] = asset.source()
  }

  return result
}
