'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createWorkBuddyCliManager, safeTarEntries } = require('../electron/workbuddy-cli-manager.cjs');
const run = promisify(execFile);

test('automatic WorkBuddy CLI preparation verifies registry integrity and needs no user-selected file', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'workbuddy-cli-manager-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source'), pkg = path.join(source, 'package');
  await fs.mkdir(path.join(pkg, 'dist'), { recursive: true });
  await fs.writeFile(path.join(pkg, 'package.json'), JSON.stringify({ name: '@tencent-ai/codebuddy-code', version: '2.164.0' }));
  await fs.writeFile(path.join(pkg, 'dist', 'codebuddy.js'), 'official synthetic cli');
  const archive = path.join(dir, 'official.tgz'); await run('tar', ['-czf', archive, '-C', source, 'package']);
  const bytes = await fs.readFile(archive), integrity = `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`;
  let metadataCalls = 0, downloadCalls = 0;
  const manager = createWorkBuddyCliManager({ directory: path.join(dir, 'managed'),
    fetch: async () => ({ ok: true, json: async () => { metadataCalls++; return { name: '@tencent-ai/codebuddy-code', version: '2.164.0', dist: {
      integrity, tarball: 'https://registry.npmjs.org/@tencent-ai/codebuddy-code/-/codebuddy-code-2.164.0.tgz' } }; } }),
    download: async () => { downloadCalls++; return bytes; },
    runProcess: async (executable, args) => (await run(executable, args)).stdout,
  });
  const first = await manager.ensure(); assert.equal(first.reused, false); assert.match(first.cliPath, /codebuddy\.js$/);
  const second = await manager.ensure(); assert.equal(second.reused, true);
  assert.equal(metadataCalls, 1); assert.equal(downloadCalls, 1);
});

test('archive entry validation rejects traversal before extraction', () => {
  assert.throws(() => safeTarEntries('package/dist/codebuddy.js\npackage/../outside.txt\n'), /不安全路径/);
});
