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

function replaceFrontmatterValue(content, key, value) {
  const text = String(content || '');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/u);
  if (!match) return text;
  const line = `${key}: ${value}`;
  const expression = new RegExp(`^${String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*.*$`, 'im');
  const block = expression.test(match[1]) ? match[1].replace(expression, line) : `${match[1]}\n${line}`;
  return `${text.slice(0, match.index)}---\n${block}\n---${text.slice(match.index + match[0].length)}`;
}

// Only make deterministic, evidence-conservative corrections. Identity or
// growth-version mismatches are never rewritten because the body could belong
// to another student or source revision.
function repairReportDraftForAutoPublish(options = {}) {
  const original = String(options.content || '');
  const expectedStudentId = String(options.studentId || '');
  const expectedFingerprint = String(options.expectedFingerprint || '');
  const growthIndex = options.growthIndex || {};
  if (!original || frontmatterValue(original, 'student_id') !== expectedStudentId
    || frontmatterValue(original, 'growth_fingerprint') !== expectedFingerprint
    || String(growthIndex.sourceFingerprint || '') !== expectedFingerprint) {
    return { changed: false, content: original, corrections: [], reason: 'identity_or_version_mismatch' };
  }

  let content = original;
  const corrections = [];
  const expectedDate = String(options.expectedDate || '');
  const status = frontmatterValue(content, 'status').toLowerCase();
  if (!['generated', 'pending_review', 'draft', '待审核'].includes(status)) {
    content = replaceFrontmatterValue(content, 'status', 'pending_review');
    corrections.push('normalized_status');
  }
  if (options.weekly === true) {
    if (expectedDate && frontmatterValue(content, 'date') !== expectedDate) {
      content = replaceFrontmatterValue(content, 'date', expectedDate);
      corrections.push('normalized_date');
    }
    if (Number.isNaN(Date.parse(frontmatterValue(content, 'generated_at')))) {
      content = replaceFrontmatterValue(content, 'generated_at', String(options.now || new Date().toISOString()));
      corrections.push('normalized_generated_at');
    }
  } else if (expectedDate && !/^\d{4}-\d{2}-\d{2}$/u.test(frontmatterValue(content, 'updated'))) {
    content = replaceFrontmatterValue(content, 'updated', expectedDate);
    corrections.push('normalized_updated');
  }

  for (const section of Array.isArray(options.requiredSections) ? options.requiredSections : []) {
    const escaped = String(section).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const heading = new RegExp(`^##\\s+${escaped}\\s*$`, 'im');
    if (heading.test(content)) continue;
    content = `${content.trimEnd()}\n\n## ${section}\n\n资料不足，继续积累。\n`;
    corrections.push(`added_section:${section}`);
  }

  const evidenceById = new Map((Array.isArray(growthIndex.evidence) ? growthIndex.evidence : [])
    .map(item => [String(item.id || ''), item]));
  let section = '';
  const lines = content.split(/\r?\n/u).map((line) => {
    const heading = line.match(/^##\s+(.+?)\s*$/u);
    if (heading) { section = heading[1].trim(); return line; }
    const ids = [...line.matchAll(/\[依据[:：]\s*([^\]]+)\]/gu)]
      .flatMap(match => match[1].split(/[,，、;\s]+/u)).map(id => id.trim()).filter(Boolean);
    if (!ids.length) return line;
    const unusable = ids.filter((id) => {
      const evidence = evidenceById.get(id);
      return !evidence || !['confirmed', 'watching'].includes(String(evidence.status || ''))
        || String(evidence.riskLevel || '') === 'high'
        || (Array.isArray(evidence.conflicts) && evidence.conflicts.length)
        || (typeof options.sourceAccessible === 'function' && !options.sourceAccessible(evidence));
    });
    if (unusable.length) {
      corrections.push(`neutralized_unusable_evidence:${unusable.join(',')}`);
      return '资料不足；该项依据未通过自动校验，不形成正式结论。';
    }
    const hasWatching = ids.some(id => String(evidenceById.get(id)?.status || '') === 'watching');
    if (hasWatching && !NON_CONCLUSION_REPORT_SECTIONS.has(section) && !WATCHING_QUALIFIER_PATTERN.test(line)) {
      corrections.push(`neutralized_watching_claim:${ids.join(',')}`);
      return `该项仍待观察，不能据此形成正式结论。[依据:${ids.join(',')}]`;
    }
    return line;
  });
  content = lines.join('\n');
  return { changed: content !== original, content, corrections: [...new Set(corrections)] };
}

module.exports = {
  CONSERVATIVE_REPORT_PATTERN,
  NON_CONCLUSION_REPORT_SECTIONS,
  WATCHING_QUALIFIER_PATTERN,
  evidenceMarkers,
  frontmatterValue,
  frontmatterValueFromFile,
  reportContentFingerprint,
  repairReportDraftForAutoPublish,
  validateReportDraftForAutoPublish,
};
