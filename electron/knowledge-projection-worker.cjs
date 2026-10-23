'use strict';
const { parentPort } = require('node:worker_threads');
const { rebuildKnowledgeProjection } = require('./learning-analytics.cjs');

parentPort.on('message', (message = {}) => {
  const requestId = String(message.requestId || '');
  try {
    const result = rebuildKnowledgeProjection(String(message.studentRootPath || ''), message.input || {});
    parentPort.postMessage({ requestId, ok: true, result });
  } catch (error) {
    parentPort.postMessage({ requestId, ok: false, error: { code: error.code || 'KNOWLEDGE_PROJECTION_FAILED', message: error.message } });
  }
});
