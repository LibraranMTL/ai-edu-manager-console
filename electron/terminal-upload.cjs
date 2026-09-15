const crypto = require('crypto');
const path = require('path');

const TERMINAL_UPLOAD_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
  '.pdf', '.txt', '.md',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.csv', '.zip',
]);

function normalizeHostUrl(value) {
  const input = String(value || '').trim().replace(/\/+$/, '');
  if (!input) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input) && !/^https?:\/\//i.test(input)) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `http://${input}`);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.origin;
  } catch {
    return '';
  }
}

function normalizeUploadTarget(target = {}) {
  const type = target.type === 'project' ? 'project' : 'student';
  return {
    type,
    id: String(target.id || '').trim(),
    name: String(target.name || '').trim(),
    studentId: String(target.studentId || '').trim(),
  };
}

function projectsForStudent(projects, studentId) {
  const requested = String(studentId || '');
  return (Array.isArray(projects) ? projects : []).filter((project) => (
    project?.status !== 'sealed'
    && Array.isArray(project?.studentIds)
    && project.studentIds.map(String).includes(requested)
  ));
}

function isTerminalUploadFile(filePath) {
  return TERMINAL_UPLOAD_EXTENSIONS.has(path.extname(String(filePath || '')).toLowerCase());
}

function stableUploadId(file = {}, target = {}) {
  const normalizedTarget = normalizeUploadTarget(target);
  const seed = [
    path.resolve(String(file.path || '')),
    Number(file.size || 0),
    Number(file.mtimeMs || 0),
    normalizedTarget.type,
    normalizedTarget.id,
  ].join('|');
  return `terminal-${crypto.createHash('sha1').update(seed).digest('hex').slice(0, 24)}`;
}

function buildTargetUploadPath(target, filename, metadata = {}) {
  const normalized = normalizeUploadTarget(target);
  if (!normalized.id) throw new Error('请选择资料目标。');
  const params = new URLSearchParams({
    filename: path.basename(String(filename || 'upload.bin')),
    sourceType: String(metadata.sourceType || 'windows_terminal_upload'),
  });
  if (metadata.uploadId) params.set('uploadId', String(metadata.uploadId));
  if (metadata.captureSessionId) params.set('captureSessionId', String(metadata.captureSessionId));
  if (metadata.captureItemId) params.set('captureItemId', String(metadata.captureItemId));
  if (metadata.capturedAt) params.set('capturedAt', String(metadata.capturedAt));
  if (metadata.captureSequence) params.set('captureSequence', String(metadata.captureSequence));
  if (metadata.captureHighlighted) params.set('captureHighlighted', '1');
  if (metadata.courseId) params.set('courseId', String(metadata.courseId));
  if (metadata.courseUrl) params.set('courseUrl', String(metadata.courseUrl));
  if (metadata.courseStartedAt) params.set('courseStartedAt', String(metadata.courseStartedAt));
  if (metadata.courseCompletedAt) params.set('courseCompletedAt', String(metadata.courseCompletedAt));
  if (normalized.type === 'project') {
    if (normalized.studentId) params.set('studentId', normalized.studentId);
    return `/api/projects/${encodeURIComponent(normalized.id)}/materials?${params.toString()}`;
  }
  return `/api/students/${encodeURIComponent(normalized.id)}/materials?${params.toString()}`;
}

module.exports = {
  TERMINAL_UPLOAD_EXTENSIONS,
  buildTargetUploadPath,
  isTerminalUploadFile,
  normalizeHostUrl,
  normalizeUploadTarget,
  projectsForStudent,
  stableUploadId,
};
