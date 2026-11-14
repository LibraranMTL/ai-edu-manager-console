'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { createProjectStateStore } = require('./project-state-store.cjs');

const store = createProjectStateStore({
  dbPath: workerData.dbPath,
  legacyJsonPath: workerData.legacyJsonPath,
  quickCheck: false,
});

let queue = Promise.resolve();

async function handle(message) {
  switch (message.op) {
    case 'task_projection':
      return message.input.sourceType === 'student'
        ? require('./task-source-projection.cjs').studentTaskProjection(message.input.source)
        : require('./task-source-projection.cjs').projectTaskProjection(message.input.source);
    case 'task_source_signatures':
      return message.input.sources.slice(0,100).map(source=>({id:source.id,
        signature:require('./task-source-projection.cjs').signature(source.files)}));
    case 'patch_metadata':
      return store.patchProjectMetadata(message.input.projectId, message.input.patch,
        message.input.expectedRevision ?? null);
    case 'upsert_metadata':
      return store.upsertProjectMetadata(message.input.project, message.input.expectedRevision ?? null);
    case 'mutate_staging_batch':
      return store.mutateStagingBatch(message.input);
    case 'upsert_scan_batch':
      return store.upsertWorkspaceScanBatch(message.input);
    case 'checkpoint':
      return store.checkpoint(message.input?.mode || 'PASSIVE');
    case 'integrity':
      return store.integrityCheck();
    case 'backup':
      await store.backupTo(message.input.destination);
      return { ok: true, destination: message.input.destination };
    case 'close':
      try { store.checkpoint('PASSIVE'); } catch { /* shutdown stays best effort */ }
      store.close();
      return { ok: true };
    default:
      throw Object.assign(new Error(`未知项目数据库操作：${message.op}`), { code: 'project_worker_invalid_operation' });
  }
}

parentPort.on('message', (message) => {
  queue = queue.then(async () => {
    try {
      const value = await handle(message);
      if (['patch_metadata', 'upsert_metadata', 'mutate_staging_batch', 'upsert_scan_batch'].includes(message.op)) {
        try { store.checkpoint('PASSIVE'); } catch { /* maintenance is best effort */ }
      }
      parentPort.postMessage({ id: message.id, ok: true, value });
    } catch (error) {
      parentPort.postMessage({ id: message.id, ok: false, error: {
        code: error.code || 'project_worker_failed', message: error.message,
      } });
    }
  });
});
