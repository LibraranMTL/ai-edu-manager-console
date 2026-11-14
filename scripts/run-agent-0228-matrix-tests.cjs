'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const output = path.resolve(process.argv[2] || 'artifacts/p0-agent-0228/acceptance/matrix-contract-results.json');
const candidateHash = String(process.argv[3] || '').toLowerCase();
if (!/^[a-f0-9]{64}$/.test(candidateHash)) throw Error('candidate_hash_required');
const rowTests = {
  A5:['tests/agent-capability-readiness.test.cjs','tests/task-capability-wakeup.test.cjs','tests/task-auto-dispatch.test.cjs'],
  A7:['tests/task-dispatch-barrier.test.cjs','tests/task-unresolved-dispatch-conflict.test.cjs'],
  B1:['tests/digest-reconciliation-budget.test.cjs'], B2:['tests/digest-reconciliation-budget.test.cjs'],
  B3:['tests/smart-inbox-unknown-resolution-contract.test.cjs'], B5:['tests/task-execution-claim.test.cjs'],
  B7:['tests/agent-capability-readiness.test.cjs','tests/task-capability-wakeup.test.cjs'],
  C1:['tests/agent-capability-readiness.test.cjs','tests/task-auto-dispatch.test.cjs'],
};
const tests = [...new Set(Object.values(rowTests).flat())];
const run = spawnSync(process.execPath, ['--test', ...tests], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const logPath = output.replace(/\.json$/i, '.log');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(logPath, `${run.stdout || ''}${run.stderr || ''}`, 'utf8');
const rows = {};
for (const [id, files] of Object.entries(rowTests)) {
  const rowRun = spawnSync(process.execPath, ['--test', ...files], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  rows[id] = { status: rowRun.status === 0 ? 'pass' : 'fail', evidenceType: 'contract_integration', testFiles: files };
}
const passed = run.status === 0 && Object.values(rows).every(row => row.status === 'pass');
const report = {
  schema: 'edu.agent0228.matrix-contract-results.v1',
  generatedAt: new Date().toISOString(),
  candidateHash,
  command: [process.execPath, '--test', ...tests],
  testFiles: tests,
  exitCode: run.status,
  passed,
  log: path.basename(logPath),
  logSha256: crypto.createHash('sha256').update(fs.readFileSync(logPath)).digest('hex'),
  rows,
};
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output, passed, exitCode: run.status, rows: Object.keys(rows).length }));
process.exitCode = passed ? 0 : 1;
