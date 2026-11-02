'use strict';
// Execute the actual main-process callbacks without booting a production profile.
// No replacement transition/upsert/read/write implementation is used here.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { databasePathForLegacy } = require('../../electron/task-state-store.cjs');

async function createTaskHost(root, options = {}) {
  const runtime = options.runtime || path.resolve(__dirname, '../../electron');
  const source = fs.readFileSync(path.join(runtime, 'main.cjs'), 'utf8');
  const client = require(path.join(runtime, 'task-io-client.cjs')).createTaskIoClient();
  const file = path.join(root, 'task-center', 'tasks.json');
  const service = require(path.join(runtime, 'task-store-service.cjs')).createTaskStoreService({
    request: async (...args) => {
      await options.beforeRequest?.(...args);
      return client.request(...args);
    },
  });
  try { await service.initialize(file); } catch (e) { client.close(); throw e; }
  const context = vm.createContext({ fs, path, crypto, structuredClone,
    ...require(path.join(runtime, 'task-protocol.cjs')),
    ...require(path.join(runtime, 'task-history-policy.cjs')),
    ...require(path.join(runtime, 'task-runtime-policy.cjs')),
    ...require(path.join(runtime, 'task-store-compaction.cjs')),
    ...require(path.join(runtime, 'task-work-identity.cjs')),
    ...require(path.join(runtime, 'task-closure-decision.cjs')),
    taskStoreGuard: service,
    taskProgressBuffer: require(path.join(runtime, 'task-progress-buffer.cjs')).createTaskProgressBuffer(),
    taskStorePath: () => file, taskCenterDirPath: () => path.dirname(file),
    sha1Text: value => crypto.createHash('sha1').update(String(value)).digest('hex'),
    taskNow: () => new Date().toISOString(), taskChildProcesses: new Map(),
    taskRequiresApproval: () => false, materialTaskCheckpointForCandidate: () => null,
    scheduleAutomaticTaskWakeups: () => {},
    TASK_TERMINAL_STATUSES: new Set(['succeeded', 'failed', 'blocked', 'cancelled', 'timed_out', 'archived']),
    taskCenterSnapshotCache: {}, taskLegacySnapshot: '',
  });
  for (const name of ['normalizeTaskStatus', 'taskStatusGroup', 'taskRiskForKind', 'normalizeTaskEnvelope',
    'readTaskStore', 'writeTaskStore', 'writeTaskStoreDurably', 'appendTaskEvent', 'transitionTaskInStore', 'upsertTaskCandidates','recordDigestReceiptMonitorCheck']) {
    let start = source.indexOf(`function ${name}(`);
    if (start < 0) throw Error(`Missing production function ${name}`);
    if (source.slice(start - 6, start) === 'async ') start -= 6;
    vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
  }
  const start = source.indexOf('      async beginBatch(source, manual, batch = {}) {');
  const end = source.indexOf('      agent: {', start);
  if (start < 0 || end < 0) throw Error('Missing production batch callbacks');
  const callbacks = vm.runInContext(`({${source.slice(start, end)}})`, context);
  const readRows = (sql) => {
    const db = new DatabaseSync(databasePathForLegacy(file), { readOnly: true });
    try { return db.prepare(sql).all().map(row => JSON.parse(row.payload_json)); } finally { db.close(); }
  };
  return { ...callbacks, context, file, service, client,
    disk: () => JSON.parse(JSON.stringify(service.read(file).value)),
    events: () => readRows('SELECT payload_json FROM task_events ORDER BY rowid'),
    async close() { try { await service.flush(); } finally { await client.close(); } },
  };
}
module.exports = { createTaskHost };
