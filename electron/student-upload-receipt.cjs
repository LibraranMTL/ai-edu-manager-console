function publicStudentUploadReceiptFile(file = {}) {
  const uploadId = String(file.uploadId || file.clientRequestId || '');
  const receiptId = String(file.receiptId || uploadId || file.id || '');
  return {
    filename: String(file.filename || ''),
    size: Number(file.size || 0),
    sha1: String(file.sha1 || ''),
    sha256: String(file.sha256 || file.contentSha256 || ''),
    assetId: String(file.assetId || ''),
    uploadId,
    clientRequestId: uploadId,
    receiptId,
    duplicate: Boolean(file.duplicate),
    receiptStatus: 'received_verified',
  };
}

function studentUploadAssetId(record = {}, assets = []) {
  if (record.assetId) return String(record.assetId);
  const recordId = String(record.id || '');
  const uploadId = String(record.uploadId || '');
  const studentId = String(record.studentId || '');
  const sha1 = String(record.sha1 || '');
  const sha256 = String(record.contentSha256 || record.sha256 || '');
  const candidates = Array.isArray(assets) ? assets : [];
  const referenced = candidates.find((asset) => (asset.references || []).some((reference) => {
    const referenceId = String(reference.id || '');
    const idMatches = (recordId && referenceId === recordId) || (uploadId && referenceId === uploadId);
    return idMatches && (!studentId || !reference.studentId || String(reference.studentId) === studentId);
  }));
  if (referenced?.assetId) return String(referenced.assetId);
  const fingerprinted = candidates.find((asset) => {
    const studentMatches = !studentId
      || String(asset.ownerStudentId || '') === studentId
      || (asset.linkedStudents || []).map(String).includes(studentId)
      || (asset.references || []).some((reference) => String(reference.studentId || '') === studentId);
    const digestMatches = (sha1 && String(asset.sha1 || '') === sha1)
      || (sha256 && (asset.references || []).some((reference) => String(reference.contentSha256 || '') === sha256));
    return studentMatches && digestMatches;
  });
  return String(fingerprinted?.assetId || '');
}

function studentUploadFailure(error = {}) {
  const errorCode = String(error.code || '');
  const message = String(error.message || '');
  if (errorCode === 'receipt_source_unavailable') {
    return { status: 409, body: { ok: false, code: errorCode,
      message: '原上传记录的文件已变化或不可用，不能当作重复接收。' } };
  }
  if (errorCode === 'upload_id_content_conflict') {
    return { status: 409, body: { ok: false, code: errorCode,
      message: '同一上传编号对应的文件内容不同，未作为重复接收。' } };
  }
  if (/unsupported file type/i.test(message)) {
    return { status: 400, body: { ok: false, code: 'unsupported_file_type',
      message: '该文件类型不支持上传。' } };
  }
  if (/file is too large|上传文件过大|上传大小限制无效/i.test(message)) {
    return { status: 413, body: { ok: false, code: 'upload_too_large',
      message: '上传文件超过大小限制，未接收。' } };
  }
  if (/sha-256 无效/i.test(message)) {
    return { status: 400, body: { ok: false, code: 'invalid_content_sha256',
      message: '上传内容校验信息无效，请重新选择原文件后再试。' } };
  }
  if (/sha-256.*不一致|sha-256 mismatch/i.test(message)) {
    return { status: 400, body: { ok: false, code: 'content_sha256_mismatch',
      message: '上传内容校验失败，文件未接收；请重新选择原文件后再试。' } };
  }
  if (/上传内容不完整/i.test(message)) {
    return { status: 400, body: { ok: false, code: 'upload_incomplete',
      message: '上传内容不完整，文件未接收；请重试。' } };
  }
  if (/multipart request has no file parts|只能上传一个文件|只能提交一个文件/i.test(message)) {
    return { status: 400, body: { ok: false, code: 'invalid_upload_request',
      message: '上传请求未包含可接收的文件。' } };
  }
  if (['EACCES', 'EPERM', 'ENOSPC', 'EIO', 'EROFS'].includes(errorCode)) {
    return { status: 503, body: { ok: false, code: 'student_upload_storage_unavailable',
      message: '主机暂时无法保存上传资料，请稍后重试。' } };
  }
  return { status: 500, body: { ok: false, code: 'student_upload_failed',
    message: '保存上传资料失败，文件未完成接收；请重试。' } };
}

module.exports = { publicStudentUploadReceiptFile, studentUploadAssetId, studentUploadFailure };
