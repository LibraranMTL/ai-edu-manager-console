'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('project state keeps only metadata cached and sends bounded project collections', () => {
  const host = read('electron', 'main.cjs');
  const store = read('electron', 'project-state-store.cjs');
  const preload = read('electron', 'preload.cjs');
  const ui = read('src', 'main.tsx');
  assert.match(store, /if \(!metadataCache\)/);
  assert.doesNotMatch(store, /let db = null[^;]*allCache/);
  assert.doesNotMatch(store, /if \(!allCache\)/);
  assert.match(store, /function readFullProjectSnapshot\(projectId, options = \{\}\)/);
  assert.match(store, /project_full_read_forbidden/);
  assert.match(host, /const includeStaging = options\?\.includeStaging !== false/);
  assert.match(host, /projectStateStore\(\)\.listStaging\(\{ projectId: project\.id, pageSize: 100 \}\)/);
  assert.match(host, /stagingItemsDeferred: !includeStaging && stagingSummary\.total > 0/);
  assert.match(host, /ipcMain\.handle\('bridge:getProjects', \(_event, options\)/);
  assert.match(preload, /getProjects\(options\)[\s\S]*bridge:getProjects', options \|\| \{\}/);
  assert.match(preload, /listProjectWorkspaceScanEntries\(request\)/);
  assert.match(ui, /await api\.listProjects\(\{ pageSize: 100 \}\)/);
  assert.match(ui, /await api\.getProjectDetail\(requestedDetailId\)/);
  assert.match(ui, /api\.listProjectStagingItems\(\{ projectId,[\s\S]*pageSize: 100 \}\)/);
  assert.match(ui, /projectDetailAbortRef\.current\?\.abort\(\)/);
  assert.match(ui, /activeSection === 'projects-new' \|\| activeSection === 'projects-existing'\) void refreshProjects\(selectedProjectId\)/);
});

test('startup, task control plane, quick capture and Agent routes avoid full project hydration', () => {
  const host = read('electron', 'main.cjs');
  const slices = [
    host.slice(host.indexOf('function companionProjects('), host.indexOf('function companionNativeCapabilities(')),
    host.slice(host.indexOf('async function runUnifiedTaskScheduler('), host.indexOf('function startUnifiedTaskScheduler(')),
    host.slice(host.indexOf('async function refreshTaskSource('), host.indexOf('function taskSourceVersion(')),
    host.slice(host.indexOf('async function handleAgentKnowledgeQuery('), host.indexOf('async function handleAgentConversationSubmit(')),
    host.slice(host.indexOf('app.whenReady().then('), host.indexOf("app.on('before-quit'")),
  ];
  for (const source of slices) assert.doesNotMatch(source, /readProjects\(\)/);
  const startup = slices.at(-1);
  assert.doesNotMatch(startup, /getCloudReportRuntime\(\)/);
  assert.doesNotMatch(startup, /finishPersistedAuthorizationHealthCheck\(\)/);
  assert.doesNotMatch(startup, /await prepareProjectUploadIntakeStartup\(\)/);
  assert.doesNotMatch(startup, /await recoverInterruptedProjectMaterialMigrations\(\)/);
  assert.match(startup, /scheduleProjectRecoveryMaintenance\(10_000\)/);
  assert.match(startup, /scheduleTeamKnowledgeIndexWarmup\(45_000\)/);
  assert.match(startup, /setTimeout\(startUnifiedTaskScheduler, 10_000\)/);
  assert.match(host, /startup_execution_cooldown/);
  assert.match(host, /executionPlaneReadyAt = Date\.now\(\) \+ 10_000/);
});
