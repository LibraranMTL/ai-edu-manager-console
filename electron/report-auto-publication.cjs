const crypto = require('node:crypto');

const CONSERVATIVE_REPORT_PATTERN = /(本周期无实质变化|资料不足|继续积累|暂无足够依据)/u;

function frontmatterValue(content, key) {
  const match = String(content || '').match(new RegExp(`^${String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*["']?([^"'\\r\\n]+)["']?\\s*$`, 'im'));
  return match ? match[1].trim() : '';
}

function reportContentFingerprint(content) {
  const body = String(content || '')
    .replace(/^\uFEFF/u, '')
    .replace(/^---[\s\S]*?---\s*/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return crypto.createHash('sha1').update(body).digest('hex');
}

function evidenceMarkers(content) {
  const markers = [];
  for (const line of String(content || '').split(/\r?\n/u)) {
    for (const match of line.matchAll(/\[依据[:：]\s*([^\]]+)\]/gu)) {
      const ids = match[1].split(/[,，、;\s]+/u).map((item) => item.trim()).filter(Boolean);
      markers.push({ line, ids });
    }
  }
  return markers;
}

function validateReportDraftForAutoPublish(options = {}) {
  const content = String(options.content || '');
  const growthIndex = options.growthIndex || {};
  const expectedStudentId = String(options.studentId || '');
  const expectedFingerprint = String(options.expectedFingerprint || '');
  const currentFingerprint = String(growthIndex.sourceFingerprint || '');
  const errors = [];

  const documentStudentId = frontmatterValue(content, 'student_id');
  const documentFingerprint = frontmatterValue(content, 'growth_fingerprint');
  if (!documentStudentId || documentStudentId !== expectedStudentId) errors.push('报告学生范围与当前任务不一致');
  if (!expectedFingerprint || currentFingerprint !== expectedFingerprint || documentFingerprint !== expectedFingerprint) errors.push('报告依据的成长模型已变化');

  const byId = new Map((Array.isArray(growthIndex.evidence) ? growthIndex.evidence : []).map((item) => [String(item.id || ''), item]));
  const markers = evidenceMarkers(content);
  const conservative = CONSERVATIVE_REPORT_PATTERN.test(content);
  if (!markers.length && !conservative) errors.push('正式报告缺少证据 ID');

  const citedEvidenceIds = [];
  for (const marker of markers) {
    for (const evidenceId of marker.ids) {
      const evidence = byId.get(evidenceId);
      if (!evidence) {
        errors.push(`证据不存在：${evidenceId}`);
        continue;
      }
      citedEvidenceIds.push(evidenceId);
      const status = String(evidence.status || '');
      if (status === 'watching') {
        if (!/(待观察|继续观察|观察中)/u.test(marker.line)) errors.push(`观察项不能写成正式定论：${evidenceId}`);
      } else if (status !== 'confirmed') {
        errors.push(`证据状态不可用于报告：${evidenceId}`);
      }
      if (String(evidence.riskLevel || '') === 'high' || (Array.isArray(evidence.conflicts) && evidence.conflicts.length)) {
        errors.push(`证据存在未解决冲突：${evidenceId}`);
      }
      if (typeof options.sourceAccessible === 'function' && !options.sourceAccessible(evidence)) {
        errors.push(`证据来源不可访问：${evidenceId}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    conservative,
    citedEvidenceIds: [...new Set(citedEvidenceIds)],
    contentFingerprint: reportContentFingerprint(content),
    studentId: documentStudentId,
    growthFingerprint: documentFingerprint,
  };
}

module.exports = {
  CONSERVATIVE_REPORT_PATTERN,
  evidenceMarkers,
  frontmatterValue,
  reportContentFingerprint,
  validateReportDraftForAutoPublish,
};
