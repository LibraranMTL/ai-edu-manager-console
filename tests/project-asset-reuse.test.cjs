const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { selectReusableAssetPath } = require('../electron/project-asset-reuse.cjs');

test('asset reuse selects a scoped verified reference rather than the global top-level path', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-asset-reuse-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-asset-reuse-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const own = path.join(root, 'own.txt');
  const other = path.join(root, 'other.txt');
  fs.writeFileSync(own, 'same bytes'); fs.writeFileSync(other, 'same bytes');
  const bytes = fs.readFileSync(own);
  const asset = { assetId: 'asset-1', path: other, size: bytes.length,
    sha1: crypto.createHash('sha1').update(bytes).digest('hex'), ownerStudentId: 'student-1',
    references: [{ spaceType: 'student', spaceId: 'student-1', path: own },
      { spaceType: 'student', spaceId: 'student-2', path: other }] };
  const project = { id: 'project-1', studentIds: ['student-1'] };
  assert.equal(selectReusableAssetPath(asset, project).path, own);
  assert.equal(selectReusableAssetPath(asset, { ...project, studentIds: ['student-2'] }).code, 'owner_scope_mismatch');
  asset.references.push({ spaceType: 'project', spaceId: project.id, path: other });
  assert.equal(selectReusableAssetPath(asset, project).code, 'ambiguous_source');
  fs.writeFileSync(own, 'changed');
  assert.equal(selectReusableAssetPath(asset, project).path, other);
});
