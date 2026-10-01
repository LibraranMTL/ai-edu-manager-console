const crypto = require('node:crypto');
const fs = require('node:fs');

function sourceFingerprint(file, size) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== Number(size)) return null;
    const sha1 = crypto.createHash('sha1'), sha256 = crypto.createHash('sha256');
    const descriptor = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      let count;
      while ((count = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
        sha1.update(buffer.subarray(0, count)); sha256.update(buffer.subarray(0, count));
      }
    } finally { fs.closeSync(descriptor); }
    if (fs.lstatSync(file).size !== stat.size) return null;
    return { sha1: sha1.digest('hex'), sha256: sha256.digest('hex') };
  } catch { return null; }
}

function verifiedSource(file, size, sha1) {
  const fingerprint = sourceFingerprint(file, size);
  return Boolean(fingerprint && /^[a-f0-9]{40}$/i.test(String(sha1 || ''))
    && fingerprint.sha1 === String(sha1).toLowerCase());
}

function queryUploadReceipt({ targetType, targetId, studentId = '', uploadId, deviceId = '', admin = false,
  records = [], assets = [], materials = null }) {
  const id = String(uploadId || '').trim();
  if (!id || id.length > 180 || !['student', 'project'].includes(targetType) || !String(targetId || '').trim()) {
    throw new Error('上传回执查询范围无效。');
  }
  if (!admin && (!String(deviceId || '').trim() || (targetType === 'project' && !String(studentId || '').trim()))) {
    return { status: 'scope_unverifiable', uploadId: id, clientRequestId: id, receiptId: id,
      targetType, targetId: String(targetId), studentId: String(studentId || '') };
  }
  let candidates = [];
  if (targetType === 'student') {
    candidates = records.filter((record) => String(record.uploadId || '') === id
      && String(record.studentId || '') === String(targetId)
      && (admin || String(record.deviceId || '') === String(deviceId || '')))
      .map((record) => ({ filename: record.filename, size: record.size, sha1: record.sha1,
        contentSha256: record.contentSha256, path: record.path, receivedAt: record.uploadedAt, assetId: '' }));
  } else {
    candidates = assets.flatMap((asset) => (asset.references || [])
      .filter((reference) => String(reference.id || '') === id
        && reference.spaceType === 'project' && String(reference.spaceId || '') === String(targetId)
        && (admin || (String(reference.deviceId || '') === String(deviceId || '')
          && String(reference.studentId || '') === String(studentId || ''))))
      .map((reference) => ({ filename: asset.filename, size: asset.size, sha1: asset.sha1,
        contentSha256: reference.contentSha256, path: reference.path, receivedAt: reference.linkedAt, assetId: asset.assetId })));
  }
  if (!candidates.length) return { status: 'not_found', uploadId: id, clientRequestId: id, receiptId: id,
    targetType, targetId: String(targetId), studentId: String(studentId || '') };
  if (candidates.length !== 1) return { status: 'ambiguous', uploadId: id, clientRequestId: id, receiptId: id,
    targetType, targetId: String(targetId), studentId: String(studentId || '') };
  const candidate = candidates[0];
  const fingerprint = sourceFingerprint(candidate.path, candidate.size);
  const sourceVerified = Boolean(fingerprint && fingerprint.sha1 === String(candidate.sha1 || '').toLowerCase()
    && (!candidate.contentSha256 || fingerprint.sha256 === String(candidate.contentSha256).toLowerCase()));
  const registrations = sourceVerified && targetType === 'project' && Array.isArray(materials)
    ? materials.filter((material) => String(material.projectId) === String(targetId)
      && material.sha256 === fingerprint.sha256
      && (material.sources || []).some((source) => source.eventId === id
        && (admin || (String(source.studentId || '') === String(studentId || '')
          && String(source.deviceId || '') === String(deviceId || ''))))
      && (material.links?.assets || []).some((link) => link.assetId === candidate.assetId
        && link.version === material.version && link.sha256 === material.sha256)) : [];
  const materialVerified = !Array.isArray(materials) || targetType !== 'project' || registrations.length === 1;
  return { status: sourceVerified && materialVerified ? 'received_verified' : 'received_unavailable',
    uploadId: id, clientRequestId: id, receiptId: id,
    targetType, targetId: String(targetId), studentId: String(studentId || ''),
    ...(sourceVerified && !materialVerified ? { reason: 'material_unregistered' } : {}),
    receipt: { filename: candidate.filename, size: candidate.size, sha1: candidate.sha1,
      sha256: sourceVerified ? fingerprint.sha256 : '',
      assetId: candidate.assetId, receivedAt: candidate.receivedAt,
      ...(registrations.length === 1 ? { materialId: registrations[0].materialId,
        materialVersion: registrations[0].version } : {}) } };
}

module.exports = { queryUploadReceipt, sourceFingerprint, verifiedSource };
