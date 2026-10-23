'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { createProjectStateStore } = require('./project-state-store.cjs');

async function run() {
  const store = createProjectStateStore({ dbPath: workerData.dbPath, legacyJsonPath: workerData.legacyJsonPath });
  let result;
  try {
    store.initialize();
    const projects = store.listMetadata();
    result = { ok: true, projectCount: projects.length, migration: store.migrationResult() };
  } finally { store.close(); }
  // DatabaseSync owns native state on this Worker thread.  Do not tell the
  // main process that the database is available until the connection and its
  // SQLite locks have been released.  The main process terminates a completed
  // worker and opens its long-lived connection as soon as this message lands.
  parentPort.postMessage(result);
}

run().catch(error => parentPort.postMessage({ ok: false, code: error.code || 'project_initialization_failed',
  message: error.message, backupPath: error.backupPath || '' }));
