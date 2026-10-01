const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { readArchivedReportEvidence, archivedReportIndex } = require('../electron/report-evidence-archive.cjs');
const { writeArchiveVersion } = require('../electron/education-archive-version.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-report-history-'));
  t.after(() => { assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir())); assert.ok(path.basename(root).startsWith('edu-report-history-')); fs.rmSync(root, { recursive: true, force: true }); });
  const rootDir = path.join(root, 'versions'); const student = { id: 's1', name: 'Synthetic' };
  const content = '---\nstudent_id: s1\ngrowth_fingerprint: original-growth\n---\nOld report [依据:e1]';
  const growthIndex = { studentId: 's1', sourceFingerprint: 'original-growth', evidence: [{ id: 'e1', content: 'old observation', status: 'confirmed' }] };
  const options = { rootDir, student, growthIndex, reports: [{ id: 'weekly', content }], createdAt: '2026-09-29T01:00:00.000Z' };
  const written = writeArchiveVersion(options);
  return { root, rootDir, options, content, written, read: (overrides = {}) => readArchivedReportEvidence({ rootDir, studentId: 's1', reportId: 'weekly', content, ...overrides }) };
}

function rewriteSnapshot(f, edit) {
  const file = path.join(f.written.versionDir, 'education-archive.json');
  const snapshot = JSON.parse(fs.readFileSync(file)); edit(snapshot);
  const bytes = Buffer.from(JSON.stringify(snapshot)); fs.writeFileSync(file, bytes);
  const manifestFile = path.join(f.written.versionDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile));
  Object.assign(manifest.files.find((entry) => entry.name === 'education-archive.json'), { size: bytes.length, sha1: crypto.createHash('sha1').update(bytes).digest('hex') });
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
}

test('historical lookup requires exact report including header and matching student, report ID and growth snapshot', (t) => {
  const f = fixture(t); const result = f.read(); assert.equal(result.ok, true);
  assert.equal(archivedReportIndex(result.archive, 's1').evidence[0].content, 'old observation');
  assert.equal(f.read({ studentId: 's2' }).ok, false);
  assert.equal(f.read({ reportId: 'different' }).ok, false);
  assert.equal(f.read({ content: f.content.replace('---\nOld', 'extra: field\n---\nOld') }).ok, false);
  assert.equal(f.read({ content: 'student_id: s1\ngrowth_fingerprint: original-growth\n' }).ok, false);
  assert.equal(f.read({ content: f.content.replace('student_id: s1', 'student_id: s1\nstudent_id: s1') }).ok, false);
  rewriteSnapshot(f, (snapshot) => { snapshot.growthIndex.sourceFingerprint = 'another-growth'; });
  assert.equal(f.read().ok, false);
});

test('old report contained in an archive built against a newer growth index is not a valid historical match', (t) => {
  const f = fixture(t);
  const newer = writeArchiveVersion({ ...f.options, growthIndex: { ...f.options.growthIndex, sourceFingerprint: 'newer-growth' }, createdAt: '2026-09-29T02:00:00.000Z' });
  fs.writeFileSync(path.join(f.written.versionDir, 'education-archive.json'), 'corrupt');
  assert.equal(f.read().ok, false); assert.notEqual(newer.versionId, f.written.versionId);
});

test('tampered bytes and duplicate evidence IDs fail closed', (t) => {
  const f = fixture(t);
  const snapshotFile = path.join(f.written.versionDir, 'education-archive.json'); const bytes = fs.readFileSync(snapshotFile);
  fs.writeFileSync(snapshotFile, Buffer.concat([bytes, Buffer.from(' ')])); assert.equal(f.read().ok, false);
  fs.writeFileSync(snapshotFile, bytes);
  rewriteSnapshot(f, (snapshot) => { snapshot.growthIndex.evidence.push({ ...snapshot.growthIndex.evidence[0] }); });
  assert.equal(f.read().ok, false);
});

test('conflicting snapshots of the same exact report do not depend on directory order', (t) => {
  const f = fixture(t); const duplicate = path.join(f.rootDir, 'another-version');
  fs.mkdirSync(duplicate);
  const manifest = JSON.parse(fs.readFileSync(path.join(f.written.versionDir, 'manifest.json'))); manifest.versionId = 'another-version';
  const snapshot = JSON.parse(fs.readFileSync(path.join(f.written.versionDir, 'education-archive.json')));
  snapshot.growthIndex.evidence[0].content = 'conflicting historical observation';
  const bytes = Buffer.from(JSON.stringify(snapshot));
  Object.assign(manifest.files.find((entry) => entry.name === 'education-archive.json'), { size: bytes.length, sha1: crypto.createHash('sha1').update(bytes).digest('hex') });
  fs.writeFileSync(path.join(duplicate, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(duplicate, 'education-archive.json'), bytes);
  assert.equal(f.read().reason, 'archive_ambiguous');
});

test('archive mutation during descriptor reading is rejected even before JSON or hash validation', (t) => {
  const f = fixture(t); const file = path.join(f.written.versionDir, 'education-archive.json');
  const size = fs.statSync(file).size; const originalRead = fs.readSync; let changed = false;
  fs.readSync = function(handle, buffer, offset, length, position) {
    const count = originalRead.call(fs, handle, buffer, offset, length, position);
    if (!changed && buffer.length === size) { changed = true; fs.appendFileSync(file, '\n'); }
    return count;
  };
  try { assert.equal(f.read().ok, false); assert.equal(changed, true); }
  finally { fs.readSync = originalRead; }
});

test('lookup rejects linked roots and linked snapshot files without reading their contents', (t) => {
  const f = fixture(t); const link = path.join(f.root, 'linked-versions');
  fs.symlinkSync(f.rootDir, link, 'junction');
  assert.equal(f.read({ rootDir: link }).reason, 'archive_linked');
  const snapshot = path.join(f.written.versionDir, 'education-archive.json'); const target = path.join(f.root, 'target.json');
  fs.renameSync(snapshot, target);
  // Directory links are also invalid at a file slot, without requiring Windows file-symlink privileges.
  fs.symlinkSync(f.root, snapshot, 'junction');
  assert.equal(f.read().ok, false);
  fs.unlinkSync(snapshot); fs.unlinkSync(link);
});

test('manifest-first lookup skips unrelated large snapshots and bounds matching snapshot and directory reads', (t) => {
  const f = fixture(t);
  const unrelated = writeArchiveVersion({ ...f.options, growthIndex: { ...f.options.growthIndex, sourceFingerprint: 'unrelated' }, createdAt: '2026-09-29T02:00:00.000Z' });
  fs.writeFileSync(path.join(unrelated.versionDir, 'education-archive.json'), Buffer.alloc(17 * 1024 * 1024));
  const result = f.read(); assert.equal(result.ok, true); assert.ok(result.bytesRead < 16384);
  fs.writeFileSync(path.join(f.written.versionDir, 'education-archive.json'), Buffer.alloc(17 * 1024 * 1024));
  assert.equal(f.read().reason, 'archive_limit');
  // Empty entries still count: a huge directory cannot bypass the enumeration budget.
  fs.writeFileSync(path.join(f.written.versionDir, 'education-archive.json'), JSON.stringify(f.written.snapshot, null, 2));
  for (let i = 0; i < 2050; i++) fs.writeFileSync(path.join(f.rootDir, `.entry-${i}`), '');
  assert.equal(f.read().reason, 'archive_limit');
});
