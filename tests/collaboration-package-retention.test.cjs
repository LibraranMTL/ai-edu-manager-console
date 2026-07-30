const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  DEFAULT_RETENTION_MS,
  compactPackagePayload,
  manifestImportComplete,
} = require('../electron/collaboration-package-retention.cjs');

test('terminal import ledger skips historical payload hashing when every materialized object still exists', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-ledger-fast-path-'));
  try {
    const importedPath = path.join(root, 'imported.md');
    fs.writeFileSync(importedPath, '已导入', 'utf8');
    const manifest = {
      manifestId: 'manifest-1',
      files: [{ objectId: 'object-1', sha256: 'abc' }],
    };
    const ledger = {
      manifests: { 'manifest-1': { status: 'imported' } },
      objects: { 'object-1': { sha256: 'abc', importedPath } },
    };
    assert.equal(manifestImportComplete(manifest, ledger), true);
    fs.rmSync(importedPath);
    assert.equal(manifestImportComplete(manifest, ledger), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('verified terminal package removes only payload after seven days and retains manifest audit', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-package-retention-'));
  try {
    const content = path.join(root, 'content');
    fs.mkdirSync(content);
    fs.writeFileSync(path.join(content, 'large.bin'), 'payload');
    const manifest = { manifestId: 'manifest-2', files: [{ objectId: 'object-2' }] };
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
    const now = Date.parse('2026-07-27T00:00:00.000Z');
    const result = compactPackagePayload(root, {
      manifest,
      terminalAt: new Date(now - DEFAULT_RETENTION_MS - 1).toISOString(),
      now,
    });
    assert.equal(result.compacted, true);
    assert.equal(fs.existsSync(content), false);
    assert.equal(fs.existsSync(path.join(root, 'manifest.json')), true);
    assert.equal(fs.existsSync(path.join(root, 'PAYLOAD-COMPACTED.json')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pending and recent package payloads are never compacted', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-package-retention-recent-'));
  try {
    const content = path.join(root, 'content');
    fs.mkdirSync(content);
    const manifest = { manifestId: 'manifest-3', files: [] };
    const result = compactPackagePayload(root, {
      manifest,
      terminalAt: new Date().toISOString(),
    });
    assert.equal(result.compacted, false);
    assert.equal(fs.existsSync(content), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
