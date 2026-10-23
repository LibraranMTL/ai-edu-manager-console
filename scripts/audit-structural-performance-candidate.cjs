'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolvePnpmVirtualStore } = require('./pnpm-virtual-store.cjs');

const repoRoot = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function argument(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
}
const baselinePath = path.resolve(argument('--baseline'));
const candidatePath = path.resolve(argument('--candidate'));
const outputPath = path.resolve(argument('--output'));
assert.ok(fs.existsSync(baselinePath), 'baseline build audit is required');
assert.ok(fs.existsSync(candidatePath), 'candidate build audit is required');
assert.ok(outputPath, 'output report path is required');

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const candidate = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
const pnpmRoot = resolvePnpmVirtualStore(repoRoot);
const asarDirectory = fs.readdirSync(pnpmRoot).find(name => name.startsWith('@electron+asar@'));
assert.ok(asarDirectory, '@electron/asar is required for candidate inspection');
const asar = require(path.join(pnpmRoot, asarDirectory, 'node_modules', '@electron', 'asar'));
const appAsar = path.join(candidate.stagingRoot, 'out', 'win-unpacked', 'resources', 'app.asar');
const packagedPaths = asar.listPackage(appAsar).map(value => value.replaceAll('\\', '/'));
const forbiddenProbeEntries = packagedPaths.filter(value => value.startsWith('/scripts/')
  || /(?:telemetry|performance-probe|event-loop-probe)/i.test(value));
const sourceMaps = packagedPaths.filter(value => value.endsWith('.map'));

const values = ['exe', 'zip'].map(kind => ({
  kind,
  baselineBytes: Number(baseline.artifacts[kind].bytes),
  candidateBytes: Number(candidate.artifacts[kind].bytes),
  growthBytes: Number(candidate.artifacts[kind].bytes) - Number(baseline.artifacts[kind].bytes),
  deltaToAdvisoryTargetBytes: 100_000_000 - Number(candidate.artifacts[kind].bytes),
}));
const failures = [];
for (const value of values) {
  if (value.growthBytes > 500_000) failures.push(`${value.kind} grew by more than 500 KB`);
}
if (Number(candidate.package.asarBytes) >= 21 * 1024 * 1024) failures.push('app.asar reached the 21 MiB limit');
if (forbiddenProbeEntries.length) failures.push('development performance probes entered app.asar');
if (sourceMaps.length) failures.push('source maps entered app.asar');

const report = {
  schema: 'edu-manager.structural-performance-candidate-audit.v1',
  auditedAt: new Date().toISOString(),
  baseline: { version: baseline.version, candidateTag: baseline.candidateTag || '', path: baselinePath },
  candidate: { version: candidate.version, candidateTag: candidate.candidateTag || '', path: candidatePath },
  artifacts: values,
  asar: { bytes: Number(candidate.package.asarBytes), limitBytes: 21 * 1024 * 1024, entries: packagedPaths.length },
  dist: candidate.dist,
  productionProbeAudit: { forbiddenEntries: forbiddenProbeEntries, sourceMaps },
  reviewRequired: values.flatMap(value => [
    ...(value.growthBytes > 200_000 ? [`${value.kind} growth exceeds 200 KB`] : []),
    ...(value.candidateBytes > 100_000_000 ? [`${value.kind} exceeds the advisory 100 MB target`] : []),
  ]),
  failures,
  status: failures.length ? 'failed' : 'passed',
  boundary: 'One-time local candidate audit only. No production telemetry, sampler, IPC, timer, or log rotation is installed.',
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
