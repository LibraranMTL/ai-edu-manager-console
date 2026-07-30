const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'tests', 'fixtures', 'p6-ten-scenario-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const startedAt = new Date().toISOString();
const results = [];

for (const scenario of manifest.scenarios) {
  const start = process.hrtime.bigint();
  const run = spawnSync(process.execPath, ['--test', ...scenario.files], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, EDU_MANAGER_P6_FIXTURE_ONLY: '1' },
  });
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  const output = `${run.stdout || ''}\n${run.stderr || ''}`;
  const passMatch = output.match(/ℹ pass (\d+)/);
  const failMatch = output.match(/ℹ fail (\d+)/);
  const result = {
    id: scenario.id,
    name: scenario.name,
    passed: run.status === 0,
    testsPassed: Number(passMatch?.[1] || 0),
    testsFailed: Number(failMatch?.[1] || (run.status === 0 ? 0 : 1)),
    elapsedMs: Math.round(elapsedMs * 100) / 100,
    userSteps: 0,
    files: scenario.files,
  };
  results.push(result);
  process.stdout.write(`${result.passed ? 'PASS' : 'FAIL'} ${result.id} ${result.name} ${result.elapsedMs}ms\n`);
  if (!result.passed) process.stderr.write(output);
}

const elapsedValues = results.map((item) => item.elapsedMs).sort((a, b) => a - b);
const p95Index = Math.max(0, Math.ceil(elapsedValues.length * 0.95) - 1);
const report = {
  schema: manifest.schema,
  fixture: manifest.fixture,
  startedAt,
  completedAt: new Date().toISOString(),
  summary: {
    passed: results.filter((item) => item.passed).length,
    total: results.length,
    completionRate: results.length ? results.filter((item) => item.passed).length / results.length : 0,
    testsPassed: results.reduce((sum, item) => sum + item.testsPassed, 0),
    testsFailed: results.reduce((sum, item) => sum + item.testsFailed, 0),
    p95ElapsedMs: elapsedValues[p95Index] || 0,
    recoverySuccessRate: results.find((item) => item.id === 'P6-S10')?.passed ? 1 : 0,
  },
  results,
};

const auditDir = path.join(root, 'release', 'audit');
fs.mkdirSync(auditDir, { recursive: true });
const reportPath = path.join(auditDir, 'p6-ten-scenario-results.json');
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`REPORT ${reportPath}\n`);

if (report.summary.passed !== report.summary.total) process.exitCode = 1;
