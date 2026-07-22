const fs = require('fs');
const path = require('path');

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
  return Boolean(
    exists
    && String(status || '').toLowerCase() === 'published'
    && String(updated || '') >= String(period?.start || '')
    && String(updated || '') <= String(period?.end || '')
    && Number(sourceMtimeMs || 0) <= Number(reportMtimeMs || 0)
  );
}

function validateSectionedDraft(content, requiredSections = []) {
  const text = String(content || '');
  const errors = [];
  for (const section of requiredSections) {
    const escaped = String(section).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`^##\\s+${escaped}\\s*$`, 'm').test(text)) errors.push(`缺少章节“${section}”`);
  }
  if (!/^status:\s*pending_review\s*$/im.test(text)) errors.push('状态必须为 pending_review');
  if (!/^updated:\s*\d{4}-\d{2}-\d{2}\s*$/im.test(text)) errors.push('缺少有效 updated 日期');
  return { valid: errors.length === 0, errors };
}

function publishReviewedReport({ draftPath, publishPath, updated, type = 'learning_report', target = '学生 / 家长 / 教师' }) {
  if (!draftPath || !publishPath || !fs.existsSync(draftPath)) {
    return { ok: false, message: '报告草稿不存在，不能采用。' };
  }
  fs.mkdirSync(path.dirname(publishPath), { recursive: true });
  let published = fs.readFileSync(draftPath, 'utf8');
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
  fs.writeFileSync(publishPath, published, 'utf8');
  return { ok: true, path: publishPath, content: published };
}

module.exports = { localDate, weekRange, monthRange, reportIsCurrent, validateSectionedDraft, publishReviewedReport };
