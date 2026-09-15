const crypto = require('node:crypto');
const fs = require('node:fs');

const CONSERVATIVE_REPORT_PATTERN = /(本周期无实质变化|资料不足|继续积累|暂无足够依据)/u;
const WATCHING_QUALIFIER_PATTERN = /(待观察|继续观察|观察中|待确认|尚未确认|未确认|待核验|尚需核验|不作为正式结论|不形成正式结论|不能据此形成正式结论)/u;
const NON_CONCLUSION_REPORT_SECTIONS = new Set([
  '每日固定动作',
  '阶段性里程碑',
  '给学生',
  '给家长',
  '给老师',
  '本周不建议做的事',
  '观察点',
  '下一阶段目标',
  '建议行动',
  '依据来源',
]);

function frontmatterValue(content, key) {
  const match = String(content || '').match(new RegExp(`^${String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*["']?([^"'\\r\\n]+)["']?\\s*$`, 'im'));
  return match ? match[1].trim() : '';
}

function frontmatterValueFromFile(filePath, key, maxBytes = 8192) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size <= 0) return '';
    const bytes = Math.min(stat.size, Math.max(512, Number(maxBytes || 0)));
    const handle = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(bytes);
      const bytesRead = fs.readSync(handle, buffer, 0, bytes, 0);
      return frontmatterValue(buffer.subarray(0, bytesRead).toString('utf8'), key);
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    return '';
  }
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
  let section = '';
  for (const line of String(content || '').split(/\r?\n/u)) {
    const heading = line.match(/^##\s+(.+?)\s*$/u);
    if (heading) section = heading[1].trim();
    for (const match of line.matchAll(/\[依据[:：]\s*([^\]]+)\]/gu)) {
      const ids = match[1].split(/[,，、;\s]+/u).map((item) => item.trim()).filter(Boolean);
      markers.push({ line, ids, section });
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
        const explicitlyQualified = WATCHING_QUALIFIER_PATTERN.test(marker.line);
        const nonConclusionContext = NON_CONCLUSION_REPORT_SECTIONS.has(marker.section);
        if (!explicitlyQualified && !nonConclusionContext) errors.push(`观察项不能写成正式定论：${evidenceId}`);
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
  NON_CONCLUSION_REPORT_SECTIONS,
  WATCHING_QUALIFIER_PATTERN,
  evidenceMarkers,
  frontmatterValue,
  frontmatterValueFromFile,
  reportContentFingerprint,
  validateReportDraftForAutoPublish,
};
