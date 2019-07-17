'use strict'

var test = require('tape')
var path = require('path')
var request = require('supertest')
var webpack = require('webpack')
var tempDir = require('os').tmpdir()
var SpawnServerPlugin = require('../')

test('Spawn Server Plugin', function (t) {
  t.plan(2)

  var watcher = webpack({
    mode: 'development',
    name: 'Server',
    target: 'node',
    watch: true,
    externals: [/^[^./!]/],
    entry: path.join(__dirname, 'fixture/server.js'),
    plugins: [new SpawnServerPlugin()],
    output: {
      libraryTarget: 'commonjs2',
      filename: 'spawn-webpack-server-file.js',
      path: tempDir
    }
  }).watch({}, function (err) {
    if (err) return t.fail(err)
    t.pass('Should have built.')

    setTimeout(function () {
      request('localhost:3000')
        .get('/')
        .then(function (res) {
          t.equals(res.text, 'hi', 'Should have spawned server.')
        })
        .catch(t.fail)
        .then(() => watcher.close())
    }, 550)
  })
})
