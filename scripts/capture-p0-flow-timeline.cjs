'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createSmartInbox } = require('../electron/smart-inbox.cjs');

const root = path.resolve(__dirname, '..');
const args = new Map(process.argv.slice(2).map(value => {
  const separator = value.indexOf('=');
  return separator < 0 ? [value.replace(/^--/, ''), 'true']
    : [value.slice(0, separator).replace(/^--/, ''), value.slice(separator + 1)];
}));
const output = path.resolve(String(args.get('output') || path.join(root, 'artifacts', 'p0-red-gate-20261025', 'p0-task-timeline.json')));
const runId = String(args.get('run-id') || 'smart-inbox-flow-1');
const iso = () => new Date().toISOString();

async function main() {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'edu-p0-flow-timeline-'));
  const sourceFolder = path.join(directory, 'source');
  const destination = path.join(directory, 'destination');
  const state = path.join(directory, 'state');
  await fsp.mkdir(sourceFolder); await fsp.mkdir(destination);
  const events = [];
  const record = (stage, detail) => events.push({ at: iso(), stage, ...detail });
  const target = { studentId: 'synthetic-student', type: 'project', id: 'synthetic-project', categoryId: '' };
  const context = { studentId: 'synthetic-student', projects: [{ id: 'synthetic-project', name: 'Synthetic project', categories: [] }] };
  let pressure = true, deliveryCalls = 0, reconcileCalls = 0, settlementCalls = 0, receipt = null;
  const host = {
    directory: state,
    stableAgeMs: 0,
    automaticAllowed: () => true,
    forbiddenRoots: () => [destination],
    context: async () => context,
    validateTarget: async value => value,
    extract: async item => ({ text: await fsp.readFile(item.snapshotPath, 'utf8'), warnings: [] }),
    classify: async () => { throw new Error('classification_not_expected'); },
    acquire: () => {
      if (pressure) { record('permit_wait', { outcome: 'blocked', reason: 'synthetic_resource_pressure' }); return null; }
      return () => {};
    },
    waitingReason: () => 'synthetic resource pressure',
    deliver: async (snapshot, _validated, item, checkpoint) => {
      deliveryCalls += 1;
      record('execution', { operation: 'deliver', attempt: deliveryCalls, outcome: 'result_unknown' });
      const registered = path.join(destination, 'registered.md');
      await checkpoint({ destinationPath: registered });
      await fsp.copyFile(snapshot, registered);
      receipt = { ok: true, path: registered, recordId: item.operationId };
      throw new Error('synthetic interruption after durable registration');
    },
    reconcile: async item => {
      reconcileCalls += 1;
      record('reconciliation', { operation: 'receipt_lookup', attempt: reconcileCalls,
        outcome: receipt?.recordId === item.operationId ? 'receipt_found' : 'not_found' });
      return receipt;
    },
    settleItems: async items => {
      settlementCalls += 1;
      if (items.some(item => item.status === 'delivered')) record('settlement', { operation: 'business_settlement', outcome: 'delivered' });
    },
    events: async () => [],
  };
  const engine = createSmartInbox(host);
  try {
    await engine.init();
    const source = await engine.updateSource({ name: 'synthetic', folder: sourceFolder, studentId: 'synthetic-student',
      target, enabled: true, automatic: true, staging: false, originalMode: 'keep' });
    await fsp.writeFile(path.join(sourceFolder, 'synthetic.md'), '# Synthetic material\n\nNo student data.\n', 'utf8');
    await engine.requestScan(source.id);
    record('enqueue', { operation: 'source_scan_requested', sourceId: source.id });
    await engine.tick();
    const waited = (await engine.sources()).sources.find(value => value.id === source.id);
    if (!waited?.waitingReason) throw new Error('permit_wait_not_observed');
    pressure = false;
    await engine.tick();
    let item = (await engine.list()).rows[0];
    if (item?.status !== 'delivery_reconcile') throw new Error(`execution_unknown_state_not_observed:${item?.status}`);
    await engine.tick();
    item = await engine.detail(item.id);
    if (item.status !== 'delivered') throw new Error(`flow_not_settled:${item.status}`);
    const candidate = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'p0-red-gate-20261025', 'p0-candidate-provenance.json'), 'utf8'));
    const sourceFiles = ['electron/smart-inbox.cjs', 'electron/smart-inbox-host.cjs', 'electron/resource-coordinator.cjs',
      'electron/task-store-service.cjs', 'electron/project-materials.cjs', 'electron/main.cjs', 'src/main.tsx'];
    const sourceFingerprint = crypto.createHash('sha256').update(JSON.stringify(sourceFiles.map(file => [file,
      crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]))).digest('hex').toUpperCase();
    const sourceOnly = args.has('source-only');
    const provenance = { workspaceCommit: candidate.chains?.diagnosticCandidate?.workspaceCommit || candidate.workspace?.commit,
      candidateSha256: sourceOnly ? '' : candidate.chains?.diagnosticCandidate?.candidateSha256 || candidate.candidate?.exe?.sha256,
      sourceFingerprint, evidenceMode: sourceOnly ? 'source_only_not_candidate' : 'candidate_bound' };
    const report = { schema: 1, generatedAt: iso(), scenario: 'smart-inbox-delivery-reconcile', runId, provenance,
      isolation: { synthetic: true, directory, formalDataRead: false }, correlationId: String(item.operationId || item.id), events,
      observed: { finalStatus: item.status, deliveryCalls, reconcileCalls, settlementCalls,
        duplicateDeliveryCalls: Math.max(0, deliveryCalls - 1), receiptRecordId: receipt?.recordId || '', sourceWaitingReason: waited.waitingReason } };
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ output, correlationId: report.correlationId, stages: events.map(event => event.stage), observed: report.observed })}\n`);
  } finally {
    await engine.close();
    await fsp.rm(directory, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
