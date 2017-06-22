'use strict'

var cp = require('child_process')
var path = require('path')
var nativeFs = require('fs')
var exitHook = require('exit-hook')
function noop () {}

// Expose plugin.
module.exports = SpawnServerPlugin

/**
 * Creates a webpack plugin that will automatically run the build in a child process.
 *
 * @param {object} [options]
 */
function SpawnServerPlugin (options) {
  this.options = options
  this.reload = this.reload.bind(this)
  this.cleanup = this.cleanup.bind(this)
  exitHook(this.cleanup)
}

// Starts plugin.
SpawnServerPlugin.prototype.apply = function (compiler) {
  compiler.plugin('done', this.reload)
  compiler.plugin('watch-close', this.cleanup)
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
  this.cleanup(function () {
    // Start new process.
    this.process = cp.spawn('node', [], {
      cwd: options.output.path,
      env: process.env.NODE_ENV,
      stdio: ['pipe', 'inherit', 'inherit', 'ipc']
    })

    // Load script from memory.
    var outFile = path.join(options.output.path, options.output.filename)
    var script = fs.createReadStream(outFile, 'utf8')
    script.pipe(this.process.stdin)
  }.bind(this))
}

// Kills any running child process.
SpawnServerPlugin.prototype.cleanup = function (done) {
  done = done || noop
  if (!this.process) return done()
  this.process.once('exit', done)
  this.process.kill()
  this.process = null
}
