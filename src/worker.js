/* eslint-disable */
"use strict";
const fs = require("fs");
const Module = require("module");
const {
  workerData: { entry, assets },
  parentPort,
} = require("worker_threads");

global.attachDevServer = (address) => {
  if (
    !(address && address.port !== undefined && address.address !== undefined)
  ) {
    throw new Error(
      `attachDevServer(address) must be passed valid address info from a node server, got ${JSON.stringify(
        address
      )}`
    );
  }

  parentPort.postMessage(address);
};

// Monkey patch asset loading.
// Pretend files from memory exist on disc.
const { _findPath } = Module;
Module._findPath = function (file) {
  return assets[file] === undefined ? _findPath.apply(this, arguments) : file;
};

const { readFileSync, readFile, existsSync } = fs;
// Patches target 'node' System.import calls.
fs.readFileSync = function (file) {
  return assets[file] || readFileSync.apply(this, arguments);
};
// Allows for source-map-support.
fs.existsSync = function (file) {
  return assets[file] !== undefined || existsSync.apply(this, arguments);
};
// Patches target 'async-node' System.import calls.
fs.readFile = function (file) {
  const source = assets[file];
  if (source === undefined) return readFile.apply(this, arguments);
  setImmediate(() => arguments[arguments.length - 1](null, source));
};

// Load entry file from assets.
require(entry);
