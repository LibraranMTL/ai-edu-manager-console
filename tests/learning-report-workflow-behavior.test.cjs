const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  weekRange,
  monthRange,
  reportIsCurrent,
  validateSectionedDraft,
  publishReviewedReport,
} = require('../electron/learning-report-workflow.cjs');
const { validateDailyActionDocument } = require('../electron/task-protocol.cjs');

const reports = [
  { kind: 'learning_profile', sections: ['一句话画像', '学习优势', '当前短板', '兴趣与动力', '学习习惯与执行力', '适合的学习方式', '家长沟通注意点', '依据来源'] },
  { kind: 'learning_changes', sections: ['最近 7 天变化', '最近 30 天变化', '能力变化', '习惯变化', '问题变化', '目标变化', '依据来源'] },
  { kind: 'learning_stage', sections: ['本阶段核心进展', '主要问题', '关键证据', '下一阶段目标', '建议行动', '依据来源'] },
];

test('weekly and monthly periods advance cleanly across boundaries', () => {
  assert.deepEqual(weekRange(new Date(2026, 6, 19, 12)), {
    start: '2026-07-13', end: '2026-07-19', key: '2026-07-13_2026-07-19',
  });
  assert.deepEqual(weekRange(new Date(2026, 6, 20, 12)), {
    start: '2026-07-20', end: '2026-07-26', key: '2026-07-20_2026-07-26',
  });
  assert.deepEqual(monthRange(new Date(2028, 1, 29, 12)), {
    start: '2028-02-01', end: '2028-02-29', key: '2028-02',
  });
  assert.equal(monthRange(new Date(2026, 7, 1, 12)).key, '2026-08');
});

test('a published report becomes pending after its period or source changes', () => {
  const period = weekRange(new Date(2026, 6, 21, 12));
  assert.equal(reportIsCurrent({ exists: true, status: 'published', updated: '2026-07-21', period, reportMtimeMs: 200, sourceMtimeMs: 100 }), true);
  assert.equal(reportIsCurrent({ exists: true, status: 'published', updated: '2026-07-19', period, reportMtimeMs: 200, sourceMtimeMs: 100 }), false);
  assert.equal(reportIsCurrent({ exists: true, status: 'published', updated: '2026-07-21', period, reportMtimeMs: 200, sourceMtimeMs: 201 }), false);
  assert.equal(reportIsCurrent({ exists: true, status: 'pending_review', updated: '2026-07-21', period, reportMtimeMs: 200, sourceMtimeMs: 100 }), false);
});

test('all four report drafts validate and publish without altering the draft', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-report-workflow-'));
  const date = '2026-07-21';
  try {
    for (const report of reports) {
      const body = report.sections.map((section) => `## ${section}\n\n${section}的已确认内容。`).join('\n\n');
      const content = `---\nupdated: ${date}\nstatus: pending_review\n---\n\n${body}\n`;
      assert.deepEqual(validateSectionedDraft(content, report.sections), { valid: true, errors: [] });
      const draftPath = path.join(root, `${report.kind}.draft.md`);
      const publishPath = path.join(root, 'published', `${report.kind}.md`);
      fs.writeFileSync(draftPath, content, 'utf8');
      const result = publishReviewedReport({ draftPath, publishPath, updated: date, type: report.kind });
      assert.equal(result.ok, true);
      assert.match(fs.readFileSync(publishPath, 'utf8'), /^status: published$/m);
      assert.match(fs.readFileSync(draftPath, 'utf8'), /^status: pending_review$/m);
    }

    const weeklySections = ['每周重点', '每日固定动作', '阶段性里程碑', '给学生', '给家长', '给老师', '本周不建议做的事', '观察点', '依据来源'];
    const weeklyBody = weeklySections.map((section) => `## ${section}\n\n${section}的具体安排。`).join('\n\n');
    const weekly = `---\ndate: ${date}\ngenerated_at: 2026-07-21T09:00:00+08:00\nstatus: pending_review\n---\n\n${weeklyBody}\n`;
    assert.equal(validateDailyActionDocument(weekly, { expectedDate: date, requiredSections: weeklySections }).valid, true);
    const weeklyDraft = path.join(root, 'weekly_action.draft.md');
    const weeklyPublished = path.join(root, 'published', 'weekly_action.md');
    fs.writeFileSync(weeklyDraft, weekly, 'utf8');
    assert.equal(publishReviewedReport({ draftPath: weeklyDraft, publishPath: weeklyPublished, updated: date, type: 'weekly_action' }).ok, true);
    assert.match(fs.readFileSync(weeklyPublished, 'utf8'), /^status: published$/m);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
