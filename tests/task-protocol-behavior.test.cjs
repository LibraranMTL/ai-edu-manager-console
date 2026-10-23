const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  TASK_PROTOCOL_VERSION,
  cronOccurrence,
  markdownSectionBody,
  normalizeMarkdownHeading,
  selectFallbackAdapter,
  selectPreviousDailyFeedback,
  validateDailyActionDocument,
  validateExternalTaskResultIdentity,
  validatePermissionDeclaration,
  validateTaskTransition,
} = require('../electron/task-protocol.cjs');

const requiredSections = ['今日重点', '给学生', '给家长', '给老师', '今日不建议做的事', '观察点', '依据来源'];

function dailyDocument(date = '2026-07-16') {
  return `---
date: ${date}
generated_at: ${date}T08:00:00+08:00
status: pending_review
---

${requiredSections.map((section) => `## ${section}\n${section}的具体内容。`).join('\n\n')}
`;
}

test('successful completion must pass through reviewing', () => {
  assert.equal(validateTaskTransition('running', 'succeeded').ok, false);
  assert.equal(validateTaskTransition('waiting_result', 'succeeded').ok, false);
  assert.equal(validateTaskTransition('running', 'reviewing').ok, true);
  assert.equal(validateTaskTransition('reviewing', 'succeeded').ok, true);
});

test('external results are bound to protocol, task and execution batch', () => {
  const task = { id: 'task-1', executionId: 'run-2', status: 'waiting_result' };
  const valid = { protocolVersion: TASK_PROTOCOL_VERSION, taskId: 'task-1', executionId: 'run-2' };
  assert.equal(validateExternalTaskResultIdentity(task, valid).ok, true);
  assert.equal(validateExternalTaskResultIdentity(task, { ...valid, protocolVersion: '1.1' }).code, 'PROTOCOL_MISMATCH');
  assert.equal(validateExternalTaskResultIdentity(task, { ...valid, taskId: 'task-2' }).code, 'TASK_ID_MISMATCH');
  assert.equal(validateExternalTaskResultIdentity(task, { ...valid, executionId: 'run-1' }).code, 'EXECUTION_ID_MISMATCH');
  assert.equal(validateExternalTaskResultIdentity({ ...task, status: 'succeeded' }, valid).code, 'TASK_STATUS_MISMATCH');
});

test('daily action schema requires strict frontmatter and non-empty sections', () => {
  assert.equal(validateDailyActionDocument(dailyDocument(), { expectedDate: '2026-07-16', requiredSections }).valid, true);
  assert.equal(validateDailyActionDocument(dailyDocument().replace('date: 2026-07-16\n', ''), { expectedDate: '2026-07-16', requiredSections }).valid, false);
  assert.equal(validateDailyActionDocument(dailyDocument().replace('generated_at: 2026-07-16T08:00:00+08:00\n', ''), { expectedDate: '2026-07-16', requiredSections }).valid, false);
  assert.equal(validateDailyActionDocument(dailyDocument().replace('## 观察点\n观察点的具体内容。', '## 观察点\n'), { expectedDate: '2026-07-16', requiredSections }).valid, false);
});

test('markdown sections accept common numbered headings without weakening body checks', () => {
  const content = `# 报告\n\n## 一、本阶段核心进展\n\n### 证据\n\n已完成实验。\n\n## 2. 主要问题\n\n仍需补充样本。\n\n## （三）关键证据\n\n- 记录 A\n`;
  assert.equal(normalizeMarkdownHeading('（一） 本阶段核心进展'), '本阶段核心进展');
  assert.match(markdownSectionBody(content, '本阶段核心进展'), /已完成实验/);
  assert.match(markdownSectionBody(content, '主要问题'), /仍需补充样本/);
  assert.match(markdownSectionBody(content, '关键证据'), /记录 A/);
  assert.equal(markdownSectionBody('## 一、空章节\n\n## 二、下一节\n内容', '空章节'), '');
});

test('second-day context reads the first-day feedback without reading same-day feedback', () => {
  const entries = [
    { taskId: 'day-2-early', date: '2026-07-17', status: 'partial', submittedAt: '2026-07-17T07:00:00Z' },
    { taskId: 'day-1', date: '2026-07-16', status: 'completed', note: '完成阅读', submittedAt: '2026-07-16T13:00:00Z' },
  ];
  const previous = selectPreviousDailyFeedback(entries, '2026-07-17', 3);
  assert.deepEqual(previous.map((item) => item.taskId), ['day-1']);
  assert.equal(previous[0].note, '完成阅读');
});

test('permission declaration blocks traversal, undeclared operations and out-of-scope output', () => {
  const root = path.resolve('D:/student/knowledge');
  const allowlist = { daily_action: new Set(['read', 'create_draft']) };
  const base = {
    kind: 'daily_action',
    riskLevel: 'low',
    permissions: { read: [root], write: [root], operations: ['read', 'create_draft'] },
    expectedOutput: { draftPath: path.join(root, 'daily.md') },
  };
  assert.equal(validatePermissionDeclaration(base, allowlist).ok, true);
  assert.equal(validatePermissionDeclaration({ ...base, permissions: { ...base.permissions, read: [`${root}${path.sep}..${path.sep}secret`] } }, allowlist).ok, false);
  assert.equal(validatePermissionDeclaration({ ...base, permissions: { ...base.permissions, operations: ['delete'] } }, allowlist).ok, false);
  assert.equal(validatePermissionDeclaration({ ...base, expectedOutput: { draftPath: path.resolve('D:/other/daily.md') } }, allowlist).ok, false);
});

test('fallback excludes attempted adapters and ends at manual after three providers in one routing round', () => {
  assert.equal(selectFallbackAdapter({ selectedAdapter: 'openclaw' }, ['codex'], 1, 3), 'openclaw');
  assert.equal(selectFallbackAdapter({ selectedAdapter: 'openclaw' }, ['openclaw'], 1, 3), 'manual');
  assert.equal(selectFallbackAdapter({ selectedAdapter: 'qclaw' }, [], 3, 6), 'qclaw');
  assert.equal(selectFallbackAdapter({ selectedAdapter: 'qclaw' }, ['codex', 'openclaw', 'workbuddy'], 3, 6), 'manual');
});

test('managed cron produces deterministic daily and interval occurrences', () => {
  const now = Date.parse('2026-07-16T08:30:00+08:00');
  const daily = cronOccurrence({ kind: 'cron', expr: '0 8 * * *' }, now);
  assert.equal(daily.due, true);
  assert.equal(cronOccurrence({ kind: 'cron', expr: '0 9 * * *' }, now).due, false);
  const every = cronOccurrence({ kind: 'every', everyMs: 60 * 60 * 1000, anchorMs: Date.parse('2026-07-16T00:00:00+08:00') }, now);
  assert.equal(every.due, true);
  assert.equal(Date.parse(every.scheduledAt) <= now, true);
});
