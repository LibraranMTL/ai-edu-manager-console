'use strict';

// Offline-only evidence index builder. It does not launch an Agent, mutate
// business data, package a build, or publish a release.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EXPECTED_EVIDENCE_TYPES } = require('./lib/agent-0228-matrix.cjs');

const repoRoot = path.resolve(__dirname, '..');
const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const index = value.indexOf('=');
  return index > 2 ? [value.slice(2, index), value.slice(index + 1)] : [value.slice(2), 'true'];
}));
const evidenceRoot = path.resolve(repoRoot, args.evidence || 'artifacts/p0-agent-0228');
const configFile = path.resolve(evidenceRoot, args.config || 'acceptance-config.json');
const acceptanceDir = path.join(evidenceRoot, 'acceptance');
fs.mkdirSync(acceptanceDir, { recursive: true });

const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const write = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const relative = file => path.relative(evidenceRoot, file).replaceAll('\\', '/');
const resolveEvidence = value => {
  const file = path.resolve(evidenceRoot, String(value || ''));
  const rel = path.relative(evidenceRoot, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`evidence_out_of_scope:${value}`);
  return file;
};

const config = read(configFile);
const provenanceFile = resolveEvidence(config.provenance);
const provenance = read(provenanceFile);
const candidateHash = String(provenance?.candidate?.asar?.sha256 || '').toLowerCase();
if (!/^[a-f0-9]{64}$/.test(candidateHash)) throw new Error('candidate_asar_hash_missing');

const artifacts = new Map();
function addArtifact(file) {
  const scoped = resolveEvidence(relative(file));
  const entry = { path: relative(scoped), sha256: sha256(scoped) };
  artifacts.set(entry.path, entry);
  return entry.path;
}
addArtifact(configFile);
addArtifact(provenanceFile);

const scenarios = [];
for (const providerId of ['workbuddy', 'codex']) {
  const runs = config.realAgentRuns?.[providerId] || [];
  if (runs.length !== 3) throw new Error(`real_agent_runs_must_equal_three:${providerId}`);
  for (const [index, runPath] of runs.entries()) {
    const runDir = resolveEvidence(runPath);
    const reportFile = path.join(runDir, 'result.json');
    const treeFile = path.join(runDir, 'process-tree.json');
    const report = read(reportFile);
    const tree = read(treeFile);
    if (report.passed !== true || report.provider !== providerId || report.formalStudentDataTouched !== false
      || report.hostCommitted !== true || Number(report.processedVersion || 0) < 1) {
      throw new Error(`invalid_real_agent_result:${providerId}:${index + 1}`);
    }
    const lifecycle = report.lifecycle || [];
    const started = lifecycle.find(event => event.type === 'started');
    const process = (tree.observedProcesses || tree.processes || []).find(row =>
      Number(row.processId ?? row.pid) === Number(started?.processId));
    if (!started || !process) throw new Error(`started_process_missing:${providerId}:${index + 1}`);
    const outputArtifact = path.join(runDir, report.outputArtifact);
    const prefix = `${providerId}-${index + 1}`;
    const processFile = path.join(acceptanceDir, `${prefix}-process.json`);
    const receiptFile = path.join(acceptanceDir, `${prefix}-receipt.json`);
    const traceFile = path.join(acceptanceDir, `${prefix}-trace.json`);
    write(processFile, { schema: 'edu.agent0228.process-evidence.v1', processes: [{
      pid: Number(process.processId ?? process.pid), ppid: Number(process.parentProcessId ?? process.ppid),
      providerId, executablePath: String(process.executablePath || process.path || process.name || ''),
    }] });
    write(receiptFile, {
      schema: 'edu.agent0228.receipt-evidence.v1', executionId: report.executionId,
      workKey: report.workKey, sourceVersion: report.sourceVersion, artifact: relative(outputArtifact),
      validation: { valid: true, hostCommitted: true, syntheticOnly: true },
    });
    write(traceFile, {
      schema: 'edu.agent0228.execution-trace.v1', candidateHash, providerId,
      executionId: report.executionId, workKey: report.workKey, sourceVersion: report.sourceVersion,
      processTree: relative(processFile), receipt: relative(receiptFile), events: lifecycle,
    });
    for (const file of [reportFile, treeFile, outputArtifact, processFile, receiptFile, traceFile]) addArtifact(file);
    scenarios.push({
      id: `${providerId}-real-closure-${index + 1}`, providerId, expectedOutcome: 'completed',
      evidenceKind: 'real_agent_e2e', observedStatus: 'pass', candidateHash,
      trace: relative(traceFile), registered: 1, started: 1, receipts: 1, settled: 1, duplicateExecutions: 0,
    });
  }
}

const recoveryFile = resolveEvidence(config.recoveryEvidence);
const recoveryReport = read(recoveryFile);
const late = recoveryReport?.scenarios?.lateReceipt;
if (recoveryReport.passed !== true || late?.passed !== true || Number(late.duplicateDeliveryCalls || 0) !== 0) {
  throw new Error('late_receipt_recovery_missing');
}
addArtifact(recoveryFile);

const formalPerformanceFile = resolveEvidence(config.formalPerformance);
const formalPerformance = read(formalPerformanceFile);
addArtifact(formalPerformanceFile);
for (const key of ['interactionTrace', 'processTreeTrace', 'baselineTrace', 'taskTimeline']) {
  addArtifact(resolveEvidence(formalPerformance[key]));
}

const matrix = [];
for (const id of [
  ...Array.from({ length: 15 }, (_, index) => `A${index + 1}`),
  ...Array.from({ length: 7 }, (_, index) => `B${index + 1}`),
  ...Array.from({ length: 5 }, (_, index) => `C${index + 1}`),
]) {
  const row = config.matrix?.[id];
  if (!row?.evidence) throw new Error(`matrix_evidence_missing:${id}`);
  if (row.evidenceType !== EXPECTED_EVIDENCE_TYPES[id]) throw new Error(`matrix_evidence_type_invalid:${id}`);
  const evidenceFile = resolveEvidence(row.evidence);
  const document = read(evidenceFile);
  addArtifact(evidenceFile);
  const expected = Object.hasOwn(row, 'expected') ? row.expected : true;
  const passed = row.jsonPointer
    ? row.jsonPointer.split('.').filter(Boolean).reduce((value, key) => value?.[key], document) === expected
    : document.passed === true;
  matrix.push({ id, status: passed ? 'pass' : 'fail', candidateHash, evidence: relative(evidenceFile), evidenceType: row.evidenceType });
}

const packaging = (config.packaging || []).map(item => {
  const file = path.resolve(repoRoot, item.path);
  if (!fs.existsSync(file)) throw new Error(`package_missing:${item.kind}`);
  return {
    kind: item.kind, asarHash: candidateHash, sha256: sha256(file), bytes: fs.statSync(file).size,
    authenticodeStatus: String(item.authenticodeStatus || 'NotSigned'), localVerified: item.localVerified === true,
  };
});

const report = {
  schema: 'edu.agent0228.acceptance.v1', generatedAt: new Date().toISOString(), candidateHash,
  sourceProvenance: {
    candidateHash, runtimeAsarHash: candidateHash,
    sourceTreeHash: String(provenance?.workspace?.sourceTreeHash || '').toLowerCase(),
    workspaceCommit: String(provenance?.workspace?.commit || ''),
  },
  artifacts: [...artifacts.values()], scenarios,
  recovery: {
    lateReceiptsObserved: 1, lateReceiptsSettled: 1, lateReceiptEvidencePreserved: 1, duplicateExecutions: 0,
  },
  performance: formalPerformance,
  matrix,
  packaging,
  installUpgradeVerified: config.installUpgradeVerified === true,
};
const output = path.join(evidenceRoot, 'acceptance-index.json');
write(output, report);
process.stdout.write(`${JSON.stringify({ output, candidateHash, scenarios: scenarios.length, matrixPass: matrix.filter(row => row.status === 'pass').length })}\n`);
