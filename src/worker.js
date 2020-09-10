/* eslint-disable */
"use strict";
const fs = require("fs");
const Module = require("module");

process.on("message", data => {
  if (!data || data.action !== "spawn") return;
  // Monkey patch asset loading.
  const entry = data.entry;
  const assets = data.assets;
  // Pretend files from memory exist on disc.
  const findPath = Module._findPath;
  Module._findPath = function (...args) {
    const file = args[0];
    return assets[file] === undefined ? findPath.apply(this, args) : file;
  };
  // Patches target 'node' System.import calls.
  const readFileSync = fs.readFileSync;
  fs.readFileSync = function (...args) {
    return assets[args[0]] || readFileSync.apply(this, args);
  };
  // Allows for source-map-support.
  const existsSync = fs.existsSync;
  fs.existsSync = function (file) {
    return assets[file] !== undefined || existsSync.apply(this, arguments);
  };
  // Patches target 'async-node' System.import calls.
  const readFile = fs.readFile;
  fs.readFile = function (file) {
    const source = assets[file];
    if (source === undefined) return readFile.apply(this, arguments);
    setImmediate(() => arguments[arguments.length - 1](null, source));
  };
  // Load entry file from assets.
  require(entry);
});
