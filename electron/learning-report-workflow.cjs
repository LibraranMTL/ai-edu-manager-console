const fs = require('fs');
const path = require('path');
const { markdownSectionBody } = require('./task-protocol.cjs');

function localDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function weekRange(value = new Date()) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    const today = localDate();
    return { start: today, end: today, key: today };
  }
  date.setHours(0, 0, 0, 0);
  const day = date.getDay() || 7;
  const start = new Date(date);
  start.setDate(date.getDate() - day + 1);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const startText = localDate(start);
  const endText = localDate(end);
  return { start: startText, end: endText, key: `${startText}_${endText}` };
}

function monthRange(value = new Date()) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    const today = localDate();
    return { start: today, end: today, key: today.slice(0, 7) };
  }
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return {
    start: localDate(start),
    end: localDate(end),
    key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
  };
}

function reportIsCurrent({ exists, status, updated, period, reportMtimeMs = 0, sourceMtimeMs = 0 }) {
  const publishedStatus = new Set(['published', 'current', 'updated', 'active']).has(String(status || '').toLowerCase());
  return Boolean(
    exists
    && publishedStatus
    && String(updated || '') >= String(period?.start || '')
    && String(updated || '') <= String(period?.end || '')
    && Number(sourceMtimeMs || 0) <= Number(reportMtimeMs || 0)
  );
}

function validateSectionedReport(content, requiredSections = []) {
  const text = String(content || '');
  const errors = [];
  for (const section of requiredSections) {
    if (!markdownSectionBody(text, section)) errors.push(`章节“${section}”缺失或为空`);
  }
  if (!/^status:\s*(?:generated|pending_review)\s*$/im.test(text)) errors.push('状态必须为 generated');
  if (!/^updated:\s*\d{4}-\d{2}-\d{2}\s*$/im.test(text)) errors.push('缺少有效 updated 日期');
  return { valid: errors.length === 0, errors };
}

function publishValidatedReport({ stagingPath, draftPath, publishPath, updated, type = 'learning_report', target = '学生 / 家长 / 教师' }) {
  const sourcePath = stagingPath || draftPath;
  if (!sourcePath || !publishPath || !fs.existsSync(sourcePath)) {
    return { ok: false, message: '报告生成结果不存在，不能发布。' };
  }
  fs.mkdirSync(path.dirname(publishPath), { recursive: true });
  let published = fs.readFileSync(sourcePath, 'utf8');
  const date = String(updated || localDate());
  if (/^---\s*$/m.test(published)) {
    published = /^status:\s*.*$/im.test(published)
      ? published.replace(/^status:\s*.*$/im, 'status: published')
      : published.replace(/^---\s*$/m, '---\nstatus: published');
    published = /^updated:\s*.*$/im.test(published)
      ? published.replace(/^updated:\s*.*$/im, `updated: ${date}`)
      : published.replace(/^---\s*$/m, `---\nupdated: ${date}`);
  } else {
    published = `---\ntype: ${type}\ntarget: ${target}\nupdated: ${date}\nstatus: published\n---\n\n${published}`;
  }
  const temporaryPath = `${publishPath}.publishing-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temporaryPath, published, 'utf8');
    fs.renameSync(temporaryPath, publishPath);
  } finally {
    if (fs.existsSync(temporaryPath)) {
      try { fs.unlinkSync(temporaryPath); } catch { /* Best-effort cleanup after a failed publish. */ }
    }
  }
  return { ok: true, path: publishPath, content: published };
}

const validateSectionedDraft = validateSectionedReport;
const publishReviewedReport = (options = {}) => publishValidatedReport({ ...options, stagingPath: options.stagingPath || options.draftPath });

module.exports = { localDate, weekRange, monthRange, reportIsCurrent, validateSectionedDraft, validateSectionedReport, publishReviewedReport, publishValidatedReport };
