'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { createProjectMaterialHost } = require('./project-material-host.cjs');
const { createProjectMaterialExtractor } = require('./project-material-extract.cjs');
const { runProjectMaterialAutomation } = require('./project-material-automation.cjs');

let requestSerial = 0;
const pendingAi = new Map();

function compactCandidate(material, extractedText) {
  return {
    materialId: material.materialId,
    version: material.version,
    recordRevision: material.recordRevision,
    location: material.location,
    classification: material.classification,
    sha256: material.sha256,
    extractedText: String(extractedText || '').slice(0, 48_000),
  };
}

function requestAi(payload) {
  return new Promise((resolve, reject) => {
    const requestId = `ai-${++requestSerial}`;
    pendingAi.set(requestId, { resolve, reject });
    parentPort.postMessage({ type: 'ai_request', requestId, payload });
  });
}

parentPort.on('message', (message) => {
  if (!message || message.type !== 'ai_response') return;
  const pending = pendingAi.get(message.requestId);
  if (!pending) return;
  pendingAi.delete(message.requestId);
  if (message.ok) pending.resolve(message.value || { suggestions: [], failed: [] });
  else pending.reject(Object.assign(new Error(message.error?.message || 'AI 分类请求失败。'), {
    code: message.error?.code || 'ai_classification_failed',
  }));
});
(async () => {
  const project = workerData.project;
  const host = createProjectMaterialHost(project);
  const extractor = createProjectMaterialExtractor({ store: host.store });
  const options = workerData.options || {};
  const result = await runProjectMaterialAutomation(project, host.store, {
    reason: String(options.reason || 'background'),
    maxBatch: Math.max(1, Math.min(20, Number(options.maxBatch || 20))),
    maxAiBatch: Math.max(1, Math.min(5, Number(options.maxAiBatch || 5))),
    idempotencyKey: String(options.idempotencyKey || ''),
    requestAiSuggestions: async (input) => {
      const candidates = [], failed = [];
      for (const material of (input.candidates || []).slice(0, 5)) {
        try {
          const resolved = await host.store.resolve(material.materialId, material.version);
          const extracted = await extractor.extractText(resolved, { timeoutMs: 60_000 });
          candidates.push(compactCandidate(material, extracted));
        } catch (error) {
          failed.push({ materialId: material.materialId, code: error.code || 'material_extract_failed',
            message: error.message });
        }
      }
      if (!candidates.length) return { ruleVersion: 'project-material-ai-v1', suggestions: [], failed };
      const response = await requestAi({ projectId: project.id, registryRevision: input.registryRevision,
        categories: input.categories, candidates });
      return { ...response, failed: [...failed, ...(response.failed || [])] };
    },
  });
  parentPort.postMessage({ type: 'result', value: {
    configuration: result.configuration,
    processed: result.processed,
    ai: result.ai,
    adopted: result.adopted,
    failed: result.failed,
    remaining: result.remaining,
    overview: result.overview,
  } });
})().catch((error) => {
  parentPort.postMessage({ type: 'error', error: { code: error.code || 'material_automation_worker_failed',
    message: error.message } });
});
// This worker is intentionally side-effect only; messages are returned through parentPort.
