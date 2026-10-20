'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('startup project read is cached and sends summaries before selected-project details', () => {
  const host = read('electron', 'main.cjs');
  const preload = read('electron', 'preload.cjs');
  const ui = read('src', 'main.tsx');
  assert.match(host, /cached\.file === file && cached\.mtimeMs === stat\.mtimeMs/);
  assert.match(host, /const includeStaging = options\?\.includeStaging !== false/);
  assert.match(host, /normalizeProject\(storedProject, \{ includeStaging \}\)/);
  assert.match(host, /stagingItemsDeferred: !includeStaging/);
  assert.match(host, /ipcMain\.handle\('bridge:getProjects', \(_event, options\)/);
  assert.match(preload, /getProjects\(options\)[\s\S]*bridge:getProjects', options \|\| \{\}/);
  assert.match(ui, /getProjects\?\.\(\{ detailProjectId: requestedDetailId \}\)/);
  assert.match(ui, /activeSection === 'projects'\) void refreshProjects\(selectedProjectId\)/);
});
