const { parentPort } = require('worker_threads');
const {
  createMigrationPackage,
  inspectMigrationPackage,
  inspectMigrationSources,
  restoreMigrationPackage,
} = require('./host-migration.cjs');
const {
  createStudentOfflineMigrationPackage,
  inspectStudentOfflineMigration,
} = require('./student-offline-migration.cjs');

parentPort.on('message', async (message) => {
  const requestId = String(message?.requestId || '');
  try {
    let result;
    if (message.action === 'inspect-sources') {
      result = inspectMigrationSources(message.options?.sources || [], { requiredDirectories: message.options?.requiredDirectories || [] });
    } else if (message.action === 'create') {
      result = await createMigrationPackage({
        ...(message.options || {}),
        onProgress: (progress) => parentPort.postMessage({ requestId, type: 'progress', progress }),
      });
    } else if (message.action === 'inspect-student-offline') {
      result = inspectStudentOfflineMigration(message.options || {});
    } else if (message.action === 'create-student-offline') {
      result = await createStudentOfflineMigrationPackage({
        ...(message.options || {}),
        onProgress: (progress) => parentPort.postMessage({ requestId, type: 'progress', progress }),
      });
    } else if (message.action === 'inspect-package') {
      result = await inspectMigrationPackage(message.options?.packageRoot);
    } else if (message.action === 'restore') {
      result = await restoreMigrationPackage({
        ...(message.options || {}),
        onProgress: (progress) => parentPort.postMessage({ requestId, type: 'progress', progress }),
      });
    } else {
      throw new Error(`未知迁移任务：${message.action}`);
    }
    parentPort.postMessage({ requestId, type: 'result', result });
  } catch (error) {
    parentPort.postMessage({ requestId, type: 'error', error: { message: error.message, recoveryPath: error.recoveryPath || '' } });
  }
});
