const path = require('node:path');

const TASK_PROTOCOL_VERSION = '1.2';

const TASK_STATUS_TRANSITIONS = Object.freeze({
  draft: ['pending', 'cancelled', 'archived'],
  pending: ['approved', 'cancelled', 'blocked', 'archived'],
  approved: ['queued', 'running', 'waiting_result', 'cancelled', 'blocked', 'archived'],
  queued: ['running', 'waiting_result', 'cancelled', 'timed_out', 'blocked', 'archived'],
  running: ['waiting_result', 'reviewing', 'failed', 'timed_out', 'cancelled'],
  waiting_result: ['running', 'reviewing', 'failed', 'timed_out', 'cancelled'],
  reviewing: ['succeeded', 'failed', 'pending', 'cancelled'],
  succeeded: ['pending', 'archived'],
  failed: ['pending', 'approved', 'cancelled', 'archived'],
  blocked: ['pending', 'approved', 'cancelled', 'archived'],
  cancelled: ['pending', 'archived'],
  timed_out: ['pending', 'approved', 'cancelled', 'archived'],
  archived: ['cancelled'],
});

function validateTaskTransition(currentStatus, nextStatus) {
  const current = String(currentStatus || '');
  const next = String(nextStatus || '');
  if (current === next) return { ok: true };
  if (!(TASK_STATUS_TRANSITIONS[current] || []).includes(next)) {
    return { ok: false, message: `不允许从 ${current} 直接流转到 ${next}。` };
  }
  if (next === 'succeeded' && current !== 'reviewing') {
    return { ok: false, message: '任务成功前必须进入 reviewing 并完成结果校验或审核。' };
  }
  return { ok: true };
}

function validateExternalTaskResultIdentity(task, payload, options = {}) {
  if (!task) return { ok: false, code: 'TASK_NOT_FOUND', message: '未找到任务。' };
  if (!payload || typeof payload !== 'object') return { ok: false, code: 'INVALID_RESULT', message: '结果包不是有效对象。' };
  if (String(payload.protocolVersion || '') !== TASK_PROTOCOL_VERSION) {
    return { ok: false, code: 'PROTOCOL_MISMATCH', message: `结果协议必须为 ${TASK_PROTOCOL_VERSION}。` };
  }
  if (String(payload.taskId || '') !== String(task.id || '')) {
    return { ok: false, code: 'TASK_ID_MISMATCH', message: '结果文件 taskId 与当前任务不一致。' };
  }
  if (!payload.executionId || String(payload.executionId) !== String(task.executionId || '')) {
    return { ok: false, code: 'EXECUTION_ID_MISMATCH', message: '结果文件 executionId 与当前执行批次不一致。' };
  }
  const allowedStatuses = options.allowedStatuses || ['running', 'waiting_result'];
  if (!allowedStatuses.includes(String(task.status || ''))) {
    return { ok: false, code: 'TASK_STATUS_MISMATCH', message: `任务状态 ${task.status || '-'} 不接受外部结果。` };
  }
  return { ok: true };
}

function canonicalPath(value) {
  if (!value) return '';
  try { return path.resolve(String(value)); } catch { return ''; }
}

function pathWithin(candidate, root) {
  const target = canonicalPath(candidate);
  const base = canonicalPath(root);
  if (!target || !base) return false;
  const relative = path.relative(base, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function validatePermissionDeclaration(task, operationAllowlist = {}) {
  const permissions = task?.permissions || {};
  const reads = Array.isArray(permissions.read) ? permissions.read.filter(Boolean) : [];
  const writes = Array.isArray(permissions.write) ? permissions.write.filter(Boolean) : [];
  const operations = Array.isArray(permissions.operations) ? permissions.operations.filter(Boolean) : [];
  const invalidPath = [...reads, ...writes].find((item) => String(item).includes('\u0000') || /(^|[\\/])\.\.([\\/]|$)/.test(String(item)) || !path.isAbsolute(String(item)));
  if (invalidPath) return { ok: false, message: `权限声明包含不安全路径：${invalidPath}` };
  if (task?.riskLevel === 'high' && (!writes.length || !operations.length)) return { ok: false, message: '高风险任务缺少明确的写入范围或操作声明。' };
  const allowed = operationAllowlist[String(task?.kind || '')];
  const disallowedOperation = allowed && operations.find((operation) => !allowed.has(String(operation)));
  if (disallowedOperation) return { ok: false, message: `任务类型 ${task.kind} 不允许操作：${disallowedOperation}` };
  const outputPaths = [task?.expectedOutput?.draftPath, task?.expectedOutput?.path].filter(Boolean);
  const outside = outputPaths.find((output) => !writes.some((root) => pathWithin(output, root)));
  if (outside) return { ok: false, message: `预期产物超出声明的写入范围：${outside}` };
  return { ok: true, permissions: { read: reads.map(canonicalPath), write: writes.map(canonicalPath), operations } };
}

function digestExpectedOutputForBatch(expectedOutput, receiptPath = '') {
  const current = expectedOutput && typeof expectedOutput === 'object' ? expectedOutput : {};
  if (current.hostManaged === true || current.type === 'project_digest_host_receipt') {
    return { type: 'project_digest_host_receipt', hostManaged: true };
  }
  return { ...current, path: receiptPath, type: 'digest_receipt_v1' };
}

function selectFallbackAdapter(routeDecision, attemptedAdapters, attempt, maxAttempts) {
  const attempted = new Set((attemptedAdapters || []).map(String).filter(Boolean));
  if (attempted.size >= 3) return 'manual';
  const candidates = [routeDecision?.selectedAdapter, ...(routeDecision?.candidates || [])
    .filter((candidate) => candidate?.available !== false)
    .map((candidate) => candidate?.adapterId)]
    .map((value) => String(value || ''))
    .filter(Boolean);
  // A routing round may try up to three distinct automatic providers.  The
  // caller owns the two-round/24h budget; this helper must not prematurely
  // fall back merely because the task's total attempt counter increased.
  const automatic = candidates.find((adapterId) => adapterId !== 'manual' && !attempted.has(adapterId));
  if (automatic) return automatic;
  return 'manual';
}

function parseFrontmatter(content) {
  const text = String(content || '').replace(/^\uFEFF/, '');
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) return { exists: false, values: {}, body: text };
  const values = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    values[key] = value;
  }
  return { exists: true, values, body: text.slice(match[0].length) };
}

function normalizeMarkdownHeading(value) {
  let normalized = String(value || '')
    .replace(/\s+#+\s*$/u, '')
    .trim();
  const numberedPrefix = /^(?:(?:第\s*)?[一二三四五六七八九十百零〇\d]+(?:章|节)?\s*[、.．:：)）\]】]\s*|[（(][一二三四五六七八九十百零〇\d]+[）)]\s*)/u;
  while (numberedPrefix.test(normalized)) normalized = normalized.replace(numberedPrefix, '').trim();
  return normalized.replace(/\s+/gu, ' ');
}

function markdownSectionBody(content, heading) {
  const lines = String(content || '').split(/\r?\n/);
  const target = normalizeMarkdownHeading(heading);
  let sectionStart = -1;
  let sectionLevel = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+(.+?)\s*$/u.exec(lines[index]);
    if (!match || normalizeMarkdownHeading(match[2]) !== target) continue;
    sectionStart = index + 1;
    sectionLevel = match[1].length;
    break;
  }
  if (sectionStart < 0) return '';
  let sectionEnd = lines.length;
  for (let index = sectionStart; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+(.+?)\s*$/u.exec(lines[index]);
    if (match && match[1].length <= sectionLevel) {
      sectionEnd = index;
      break;
    }
  }
  return lines.slice(sectionStart, sectionEnd).join('\n').trim();
}

function validateDailyActionDocument(content, options = {}) {
  const expectedDate = String(options.expectedDate || '');
  const requiredSections = Array.isArray(options.requiredSections) ? options.requiredSections : [];
  const parsed = parseFrontmatter(content);
  const errors = [];
  if (!parsed.exists) errors.push('缺少 YAML frontmatter');
  const documentDate = String(parsed.values.date || '');
  if (!documentDate) errors.push('缺少 date 字段');
  else if (expectedDate && documentDate !== expectedDate) errors.push(`日期应为 ${expectedDate}，实际为 ${documentDate}`);
  const generatedAt = String(parsed.values.generated_at || '');
  if (!generatedAt || Number.isNaN(Date.parse(generatedAt))) errors.push('缺少有效的 generated_at ISO 时间');
  const status = String(parsed.values.status || '').toLowerCase();
  if (!['generated', '待审核', 'pending_review', 'draft'].includes(status)) errors.push('status 必须为 generated');
  for (const section of requiredSections) {
    const body = markdownSectionBody(parsed.body, section);
    if (!body) errors.push(`章节“${section}”缺失或为空`);
  }
  return { valid: errors.length === 0, errors, frontmatter: parsed.values };
}

function selectPreviousDailyFeedback(entries, currentDate, limit = 3) {
  const date = String(currentDate || '');
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && String(entry.date || '') && (!date || String(entry.date) < date))
    .sort((a, b) => String(b.submittedAt || b.date || '').localeCompare(String(a.submittedAt || a.date || '')))
    .slice(0, Math.max(0, Number(limit || 0)));
}

function cronOccurrence(schedule, nowValue = Date.now()) {
  const now = new Date(nowValue);
  const kind = String(schedule?.kind || (schedule?.expr ? 'cron' : schedule?.everyMs ? 'every' : schedule?.at ? 'at' : ''));
  if (kind === 'at') {
    const at = Date.parse(schedule.at || schedule.runAt || '');
    if (!Number.isFinite(at)) return null;
    return { key: new Date(at).toISOString(), scheduledAt: new Date(at).toISOString(), due: nowValue >= at };
  }
  if (kind === 'every') {
    const everyMs = Math.max(60000, Number(schedule.everyMs || schedule.intervalMs || 0));
    const anchor = Number(schedule.anchorMs || schedule.anchor || 0) || 0;
    const slot = Math.floor(Math.max(0, nowValue - anchor) / everyMs);
    const scheduled = anchor + slot * everyMs;
    return { key: new Date(scheduled).toISOString(), scheduledAt: new Date(scheduled).toISOString(), due: nowValue >= scheduled };
  }
  const expr = String(schedule?.expr || schedule || '').trim();
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) return null;
  const [minuteText, hourText, dayText, monthText, weekdayText] = parts;
  if (!/^\d{1,2}$/.test(minuteText) || !/^\d{1,2}$/.test(hourText) || dayText !== '*' || monthText !== '*' || weekdayText !== '*') return null;
  const minute = Number(minuteText);
  const hour = Number(hourText);
  if (minute > 59 || hour > 23) return null;
  const scheduled = new Date(now);
  scheduled.setHours(hour, minute, 0, 0);
  return { key: scheduled.toISOString(), scheduledAt: scheduled.toISOString(), due: nowValue >= scheduled.getTime() };
}

module.exports = {
  TASK_PROTOCOL_VERSION,
  TASK_STATUS_TRANSITIONS,
  cronOccurrence,
  digestExpectedOutputForBatch,
  markdownSectionBody,
  normalizeMarkdownHeading,
  selectPreviousDailyFeedback,
  selectFallbackAdapter,
  validateDailyActionDocument,
  validateExternalTaskResultIdentity,
  validatePermissionDeclaration,
  validateTaskTransition,
};
