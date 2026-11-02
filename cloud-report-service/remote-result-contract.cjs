'use strict';

const REMOTE_PROJECT_RESULT_SCHEMA = 'edu-manager.remote-project-result.v2';
const MAX_RESULT_BYTES = 512 * 1024;
const MAX_SOURCES = 200;
const MAX_ATTACHMENTS = 8;
const MAX_ATTACHMENT_BYTES = 512 * 1024;
const MAX_ATTACHMENTS_BYTES = 2 * 1024 * 1024;

function contractError(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'REMOTE_RESULT_INVALID';
  return error;
}

function cleanText(value, label, maxLength) {
  if (typeof value !== 'string') throw contractError(`${label}无效`);
  const text = value.trim();
  if (!text || text.length > maxLength || /\u0000/.test(text)) throw contractError(`${label}无效`);
  return text;
}

function normalizeRemoteProjectResult(payload, expected = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw contractError('远程成果格式无效');
  if (payload.schema !== REMOTE_PROJECT_RESULT_SCHEMA) throw contractError('远程成果合同版本无效');
  const normalized = {
    schema: REMOTE_PROJECT_RESULT_SCHEMA,
    taskId: cleanText(payload.taskId, '任务编号', 200),
    executionId: cleanText(payload.executionId, '执行批次', 200),
    taskType: cleanText(payload.taskType, '任务类型', 100),
    projectId: cleanText(payload.projectId, '项目编号', 160),
    scopeFingerprint: cleanText(payload.scopeFingerprint, '权限摘要', 64),
    status: String(payload.status || ''),
    title: cleanText(payload.title, '成果标题', 120),
    content: cleanText(payload.content, '成果正文', MAX_RESULT_BYTES),
    sources: [],
    attachments: [],
  };
  if (normalized.status !== 'completed') throw contractError('远程成果尚未完成');
  if (!/^[a-f0-9]{64}$/.test(normalized.scopeFingerprint)) throw contractError('远程成果权限摘要无效');
  for (const [field, label] of [['taskId', '任务编号'], ['executionId', '执行批次'], ['taskType', '任务类型'], ['projectId', '项目编号'], ['scopeFingerprint', '权限摘要']]) {
    if (String(expected[field] || '') && normalized[field] !== String(expected[field])) throw contractError(`远程成果${label}与任务合同不一致`);
  }
  if (!Array.isArray(payload.sources) || !payload.sources.length || payload.sources.length > MAX_SOURCES) {
    throw contractError('远程成果必须包含可核对的资料来源');
  }
  const seen = new Set();
  for (const raw of payload.sources) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw contractError('远程成果资料来源无效');
    const source = {
      materialId: cleanText(raw.materialId, '资料编号', 200),
      revisionId: cleanText(raw.revisionId, '资料修订编号', 200),
      contentSha256: cleanText(raw.contentSha256, '资料校验值', 64),
    };
    if (!/^material_rev_[a-f0-9]{48}$/.test(source.revisionId) || !/^[a-f0-9]{64}$/.test(source.contentSha256)) {
      throw contractError('远程成果资料来源标识无效');
    }
    const key = `${source.materialId}:${source.revisionId}`;
    if (!seen.has(key)) { seen.add(key); normalized.sources.push(source); }
  }
  if (Buffer.byteLength(normalized.content, 'utf8') > MAX_RESULT_BYTES) throw contractError('远程成果正文超过限额');
  if (payload.attachments !== undefined) {
    if (!Array.isArray(payload.attachments) || payload.attachments.length > MAX_ATTACHMENTS) throw contractError('远程成果附件数量无效');
    let totalBytes = 0;
    const names = new Set();
    for (const raw of payload.attachments) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw contractError('远程成果附件无效');
      const displayName = cleanText(raw.displayName, '附件名称', 120);
      if (/[\\/\u0000-\u001f]/.test(displayName) || names.has(displayName)) throw contractError('附件名称无效或重复');
      const contentType = cleanText(raw.contentType, '附件类型', 160).toLowerCase();
      if (!['text/markdown', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(contentType)) {
        throw contractError('附件类型不受支持');
      }
      if (raw.contentBase64 === undefined && expected.allowStoredAttachmentMetadata === true) {
        const attachmentId = cleanText(raw.attachmentId, '附件编号', 80);
        const contentSha256 = cleanText(raw.contentSha256, '附件校验值', 64).toLowerCase();
        const byteSize = Number(raw.byteSize);
        if (!/^attachment_[a-f0-9]{32}$/.test(attachmentId) || !/^[a-f0-9]{64}$/.test(contentSha256) ||
            !Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > MAX_ATTACHMENT_BYTES) throw contractError('附件元数据无效');
        totalBytes += byteSize;
        if (totalBytes > MAX_ATTACHMENTS_BYTES) throw contractError('远程成果附件总大小超过限额');
        names.add(displayName);
        normalized.attachments.push({ attachmentId, displayName, contentType, contentSha256, byteSize });
        continue;
      }
      const contentBase64 = cleanText(raw.contentBase64, '附件内容', MAX_ATTACHMENT_BYTES * 2);
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64) || contentBase64.length % 4 !== 0) throw contractError('附件内容编码无效');
      const bytes = Buffer.from(contentBase64, 'base64');
      if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES) throw contractError('附件大小无效');
      const contentSha256 = cleanText(raw.contentSha256, '附件校验值', 64).toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(contentSha256) || require('node:crypto').createHash('sha256').update(bytes).digest('hex') !== contentSha256) {
        throw contractError('附件校验失败');
      }
      totalBytes += bytes.length;
      if (totalBytes > MAX_ATTACHMENTS_BYTES) throw contractError('远程成果附件总大小超过限额');
      names.add(displayName);
      normalized.attachments.push({ displayName, contentType, contentSha256, byteSize: bytes.length, contentBase64 });
    }
  }
  return normalized;
}

module.exports = { MAX_RESULT_BYTES, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_BYTES,
  REMOTE_PROJECT_RESULT_SCHEMA, normalizeRemoteProjectResult };
