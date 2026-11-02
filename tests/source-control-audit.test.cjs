'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { createSourceControlAudit } = require('../scripts/source-control-audit.cjs');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

test('source audit hashes changed contents and ignores generated evidence artifacts', async t => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'edu-source-audit-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  git(directory, ['init']);
  git(directory, ['config', 'user.name', 'test']);
  git(directory, ['config', 'user.email', 'test@example.invalid']);
  await fsp.writeFile(path.join(directory, 'tracked.txt'), 'v1');
  git(directory, ['add', 'tracked.txt']);
  git(directory, ['commit', '-m', 'fixture']);
  await fsp.writeFile(path.join(directory, 'tracked.txt'), 'v2');
  await fsp.mkdir(path.join(directory, 'untracked', 'nested'), { recursive: true });
  await fsp.writeFile(path.join(directory, 'untracked', 'a.txt'), 'a');
  await fsp.writeFile(path.join(directory, 'untracked', 'nested', 'b.txt'), 'b');
  const first = createSourceControlAudit(directory);
  const second = createSourceControlAudit(directory);

  assert.equal(second.statusSha256, first.statusSha256);
  assert.equal(first.changedPathCount, 3);
  assert.deepEqual(second, first);

  await fsp.writeFile(path.join(directory, 'tracked.txt'), 'v3');
  const changedContent = createSourceControlAudit(directory);
  assert.notEqual(changedContent.statusSha256, first.statusSha256);

  await fsp.mkdir(path.join(directory, 'artifacts'), { recursive: true });
  await fsp.writeFile(path.join(directory, 'artifacts', 'runtime-sample.json'), '{}');
  const generatedEvidence = createSourceControlAudit(directory);
  assert.equal(generatedEvidence.statusSha256, changedContent.statusSha256);
  assert.equal(generatedEvidence.changedPathCount, changedContent.changedPathCount);
});
