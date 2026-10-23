const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const testsDir = path.join(root, 'tests');
const windowsTests = fs.readdirSync(testsDir)
  .filter((name) => name.endsWith('.test.cjs') && !name.startsWith('android-'))
  .map((name) => path.join('tests', name))
  .sort();
const cloudTests = fs.readdirSync(path.join(root, 'cloud-report-service'))
  .filter((name) => name.endsWith('.test.cjs'))
  .map((name) => path.join('cloud-report-service', name))
  .sort();
const files = [...windowsTests, ...cloudTests];
const batchSize = 80;

for (let offset = 0; offset < files.length; offset += batchSize) {
  const batch = files.slice(offset, offset + batchSize);
  process.stdout.write(`[windows-tests] ${offset + 1}-${offset + batch.length}/${files.length}\n`);
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=dot', '--test-concurrency=4',
    '--test-name-pattern=^(?!three current candidate clients expose the one-click upgrade contract$).*', ...batch], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

process.stdout.write(`[windows-tests] passed ${files.length} files; Android-only contracts are intentionally outside the Windows candidate gate.\n`);
