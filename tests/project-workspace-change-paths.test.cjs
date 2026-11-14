'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { resolveChangedWorkspaceFiles } = require('../electron/project-workspace-change-paths.cjs');

test('resolves only stable files inside the workspace without enumerating the directory', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-change-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const inbox = path.join(root, '收件箱');
  fs.mkdirSync(inbox);
  fs.writeFileSync(path.join(inbox, 'new.md'), 'synthetic');

  const result = await resolveChangedWorkspaceFiles(root, ['收件箱/new.md']);
  assert.equal(result.needsFullScan, false);
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].relativePath, '收件箱/new.md');
  assert.equal(result.files[0].size, 9);
  assert.match(result.files[0].fileKey, /^\d+:\d+$/);
});

test('missing and directory events request a resource-gated full scan', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-change-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '收件箱'));

  const result = await resolveChangedWorkspaceFiles(root, ['收件箱/missing.md', '收件箱']);
  assert.equal(result.files.length, 0);
  assert.equal(result.needsFullScan, true);
  assert.deepEqual(result.fullScanReasons.sort(), ['directory', 'missing']);
});

test('path traversal is rejected without widening the scan scope', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-change-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = await resolveChangedWorkspaceFiles(root, ['../outside.md', 'C:/outside.md']);
  assert.equal(result.files.length, 0);
  assert.equal(result.needsFullScan, false);
  assert.equal(result.rejected.length, 2);
});

