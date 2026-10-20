'use strict';
// Test-only compiler hook: run the existing suite against the exact whitespace
// transform used in release packaging, without rewriting source checkout files.
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const { compactRuntimeSource } = require('./compact-windows-runtime.cjs');
const repo = path.resolve(__dirname, '..');
const pnpm = path.join(repo, 'node_modules/.pnpm');
const esbuild = require(path.join(pnpm, fs.readdirSync(pnpm).find(n => n.startsWith('esbuild@')), 'node_modules/esbuild'));
const original = Module._extensions['.cjs'] || Module._extensions['.js'];
Module._extensions['.cjs'] = function(module, filename) {
  const relative = path.relative(repo, filename);
  if ((relative.startsWith(`electron${path.sep}`) || relative.startsWith(`cloud-report-service${path.sep}`)) && path.basename(filename) !== 'license-trust-store.cjs') {
    module._compile(compactRuntimeSource(fs.readFileSync(filename, 'utf8'), esbuild), filename);
  } else original(module, filename);
};
