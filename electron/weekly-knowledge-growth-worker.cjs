'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { getWeeklyKnowledgeGrowth, renderWeeklyKnowledgeGrowthPng } = require('./weekly-knowledge-growth.cjs');

try {
  const assetSnapshot = workerData.assetSnapshot;
  const assetStore = {
    statisticsState: () => ({ generation: Number(assetSnapshot.generation), changedAt: String(assetSnapshot.changedAt || '') }),
    statisticsSnapshot: () => assetSnapshot,
  };
  const snapshot = getWeeklyKnowledgeGrowth({
    studentId: workerData.studentId,
    studentRootPath: workerData.studentRootPath,
    assetStore,
    asOf: workerData.asOf,
    timezone: workerData.timezone,
    authorizationVersion: workerData.authorizationVersion,
  });
  if (!snapshot.ok) parentPort.postMessage({ ok: false, result: snapshot });
  else {
    const bytes = renderWeeklyKnowledgeGrowthPng(snapshot);
    parentPort.postMessage({ ok: true, snapshot, pngBase64: bytes.toString('base64') });
  }
} catch (error) {
  parentPort.postMessage({ ok: false, result: { ok: false, code: error.code || 'weekly_growth_worker_failed', message: error.message } });
}
