'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('project state is cached in SQLite and sends bounded summaries before selected-project details', () => {
  const host = read('electron', 'main.cjs');
  const store = read('electron', 'project-state-store.cjs');
  const preload = read('electron', 'preload.cjs');
  const ui = read('src', 'main.tsx');
  assert.match(host, /return projectStateStore\(\)\.readAll\(\)/);
  assert.match(store, /if \(!metadataCache\)/);
  assert.match(store, /if \(!allCache\)/);
  assert.match(host, /const includeStaging = options\?\.includeStaging !== false/);
  assert.match(host, /projectStateStore\(\)\.listStaging\(\{ projectId: project\.id, pageSize: 100 \}\)/);
  assert.match(host, /stagingItemsDeferred: !includeStaging && stagingSummary\.total > 0/);
  assert.match(host, /ipcMain\.handle\('bridge:getProjects', \(_event, options\)/);
  assert.match(preload, /getProjects\(options\)[\s\S]*bridge:getProjects', options \|\| \{\}/);
  assert.match(ui, /await api\.listProjects\(\{ pageSize: 100 \}\)/);
  assert.match(ui, /await api\.getProjectDetail\(requestedDetailId\)/);
  assert.match(ui, /api\.listProjectStagingItems\(\{ projectId,[\s\S]*pageSize: 100 \}\)/);
  assert.match(ui, /projectDetailAbortRef\.current\?\.abort\(\)/);
  assert.match(ui, /activeSection === 'projects-new' \|\| activeSection === 'projects-existing'\) void refreshProjects\(selectedProjectId\)/);
});
