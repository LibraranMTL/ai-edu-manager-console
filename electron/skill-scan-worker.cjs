'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { scanProvider } = require('./skill-discovery-adapters.cjs');

try {
  const results = [];
  for (const providerId of workerData.providerIds || []) {
    const result = scanProvider(providerId, workerData.options || {});
    results.push(result);
    parentPort.postMessage({ type: 'progress', providerId, candidateCount: result.candidates.length });
  }
  parentPort.postMessage({ type: 'complete', results });
} catch (error) {
  parentPort.postMessage({ type: 'error', message: error.message });
}
