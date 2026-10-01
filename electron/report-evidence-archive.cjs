const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ARCHIVE_SCHEMA, archiveFingerprint } = require('./education-archive-version.cjs');
const { invariant } = require('./project-material-contract.cjs');

// Only a successful local archive read can create a historical-read proof.
// Transported JSON, caller-supplied growth indexes and booleans are not proofs.
const proofs = new WeakMap();
const LIMITS = Object.freeze({ entries: 2048, bytes: 64 * 1024 * 1024, manifest: 256 * 1024, snapshot: 16 * 1024 * 1024 });
const digest = (bytes, algorithm = 'sha256') => crypto.createHash(algorithm).update(bytes).digest('hex');

function headerValue(content, key) {
  const header = String(content).replace(/^\uFEFF/u, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u)?.[1];
  if (!header || header.length > 8192) return '';
  const values = header.split(/\r?\n/u).filter((line) => line.startsWith(`${key}:`));
  if (values.length !== 1) return '';
  return values[0].slice(key.length + 1).trim().replace(/^(['"])(.*)\1$/u, '$2');
}

function assertUnlinked(file, directory = false) {
  for (let current = file; ; current = path.dirname(current)) {
    invariant(!fs.lstatSync(current).isSymbolicLink(), 'archive_linked', '档案路径包含链接。');
    if (current === path.dirname(current)) break;
  }
  const stat = fs.lstatSync(file);
  invariant(directory ? stat.isDirectory() : stat.isFile(), 'archive_invalid', '档案文件类型不正确。');
  return stat;
}

function readBoundedArchive(file, limit, stats) {
  const namedBefore = assertUnlinked(file);
  invariant(namedBefore.size <= limit && namedBefore.size <= LIMITS.bytes - stats.bytesRead, 'archive_limit', '历史档案读取超限。');
  const handle = fs.openSync(file, 'r');
  try {
    const before = fs.fstatSync(handle);
    const keys = ['ino', 'dev', 'size', 'mtimeMs', 'ctimeMs'];
    invariant(keys.every((key) => before[key] === namedBefore[key]), 'archive_changed', '档案读取期间变化。');
    const buffer = Buffer.alloc(before.size); let total = 0;
    while (total < buffer.length) {
      const count = fs.readSync(handle, buffer, total, Math.min(64 * 1024, buffer.length - total), null);
      if (!count) break;
      total += count; stats.bytesRead += count;
    }
    const after = fs.fstatSync(handle), namedAfter = assertUnlinked(file);
    invariant(total === before.size && keys.every((key) => before[key] === after[key] && after[key] === namedAfter[key]),
      'archive_changed', '档案读取期间变化。');
    return buffer;
  } finally { fs.closeSync(handle); }
}

function readArchivedReportEvidence({ rootDir, studentId, reportId, content }) {
  const stats = { scannedEntries: 0, bytesRead: 0 };
  const failed = (reason) => ({ ok: false, reason, ...stats });
  const fingerprint = headerValue(content, 'growth_fingerprint');
  if (!rootDir || !studentId || !reportId || !fingerprint || headerValue(content, 'student_id') !== String(studentId)) return failed('archive_identity');
  const root = path.resolve(rootDir); let directory;
  try {
    assertUnlinked(root, true); directory = fs.opendirSync(root);
    let selected = null;
    for (;;) {
      const entry = directory.readSync(); if (!entry) break;
      if (++stats.scannedEntries > LIMITS.entries) return failed('archive_limit');
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      const versionDir = path.join(root, entry.name);
      try {
        const manifest = JSON.parse(readBoundedArchive(path.join(versionDir, 'manifest.json'), LIMITS.manifest, stats));
        if (manifest.schema !== ARCHIVE_SCHEMA || manifest.version !== 1 || manifest.versionId !== entry.name
          || manifest.studentId !== String(studentId) || manifest.growthFingerprint !== fingerprint) continue;
        const files = Array.isArray(manifest.files) ? manifest.files.filter((file) => file.name === 'education-archive.json') : [];
        if (files.length !== 1 || !Number.isSafeInteger(files[0].size) || !/^[a-f0-9]{40}$/.test(files[0].sha1)) continue;
        const bytes = readBoundedArchive(path.join(versionDir, 'education-archive.json'), LIMITS.snapshot, stats);
        if (bytes.length !== files[0].size || digest(bytes, 'sha1') !== files[0].sha1) continue;
        const snapshot = JSON.parse(bytes);
        if (snapshot.schema !== ARCHIVE_SCHEMA || snapshot.version !== 1 || snapshot.student?.id !== String(studentId)
          || snapshot.growthFingerprint !== fingerprint || snapshot.growthIndex?.sourceFingerprint !== fingerprint
          || snapshot.growthIndex?.studentId !== String(studentId) || !Array.isArray(snapshot.reports)
          || !Array.isArray(snapshot.growthIndex.evidence) || snapshot.growthIndex.evidence.length > 20000
          || snapshot.sourceFingerprint !== manifest.sourceFingerprint || archiveFingerprint(snapshot) !== snapshot.sourceFingerprint) continue;
        const reports = snapshot.reports.filter((report) => report.id === String(reportId));
        // Exact bytes include frontmatter. The older body-only fingerprint is insufficient here.
        if (reports.length !== 1 || reports[0].content !== content) continue;
        const ids = snapshot.growthIndex.evidence.map((item) => item?.id);
        if (ids.some((id) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) continue;
        const evidenceDigest = digest(JSON.stringify(snapshot.growthIndex.evidence));
        if (selected && selected.evidenceDigest !== evidenceDigest) return failed('archive_ambiguous');
        selected = { versionId: entry.name, evidenceDigest, growthIndex: snapshot.growthIndex };
      } catch (error) {
        if (error.code === 'archive_limit') return failed('archive_limit');
        // A broken sibling is not permission to fall back to current evidence.
      }
    }
    if (!selected) return failed('archive_unavailable');
    const archive = Object.freeze({ versionId: selected.versionId, growthFingerprint: fingerprint, reportHash: digest(content) });
    proofs.set(archive, { studentId: String(studentId), growthIndex: selected.growthIndex,
      evidence: new Map(selected.growthIndex.evidence.map((item) => [item.id, item])) });
    return { ok: true, archive, ...stats };
  } catch (error) { return failed(error.code || 'archive_unavailable'); }
  finally { if (directory) directory.closeSync(); }
}

function archivedReportIndex(archive, studentId) {
  const proof = archive && proofs.get(archive);
  invariant(proof && proof.studentId === String(studentId), 'archive_unverified', '历史报告缺少可信档案读取结果。');
  return structuredClone(proof.growthIndex);
}

function archivedReportEvidence(archive, studentId, evidenceId) {
  const proof = archive && proofs.get(archive);
  invariant(proof && proof.studentId === String(studentId), 'archive_unverified', '历史报告缺少可信档案读取结果。');
  return structuredClone(proof.evidence.get(evidenceId));
}

module.exports = { readArchivedReportEvidence, archivedReportIndex, archivedReportEvidence };
