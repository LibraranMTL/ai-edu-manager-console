'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { createAssetIndexStore } = require('./asset-index-store.cjs');

try {
  parentPort.postMessage({ type: 'progress', phase: 'checking', message: '正在检查资产数据库…' });
  const store = createAssetIndexStore({ dbPath: workerData.dbPath, legacyJsonPath: workerData.legacyJsonPath });
  store.initialize();
  const summary = store.summary({});
  const migration = store.migrationResult();
  store.close();
  parentPort.postMessage({ type: 'complete', ok: true, total: Number(summary.total || 0), migration: migration || null });
} catch (error) {
  parentPort.postMessage({ type: 'complete', ok: false, code: error.code || 'asset_db_corrupt', message: error.message });
}
