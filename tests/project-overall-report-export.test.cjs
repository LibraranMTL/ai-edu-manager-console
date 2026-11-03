'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { projectReportMarkdown, projectReportHtml } = require('../electron/project-report-export.cjs');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`); assert.notEqual(start, -1);
  const bodyStart = source.indexOf('{', start); let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unable to extract ${name}`);
}

function projection() {
  return {
    projectId: 'internal-project-id', versionId: 'internal-version-id', snapshotId: 'internal-snapshot-id',
    reportType: 'completion', asOf: '2026-11-02T08:00:00.000Z', project: { name: '虚构云台支架', objective: '完成结项验证' },
    summary: { currentStage: '已结项归档', changes: '根据结项时固定证据生成唯一结项版本。', representativeResults: [{ title: '最终成果/支架_原型.docx', statement: '代表材料：最终成果/支架_原型.docx（版本 2）；选择理由是其已采用且处于当前证据快照。' }], nextAction: '保留结项依据和固定版本，供后续复核与展示。' },
    sections: [{ key: 'outcomes', title: '成果与目标达成', items: [{ claimKey: 'internal-claim', status: 'observed', statement: '截至 2026-11-02T08:00:00.000Z，已登记 46 份项目资料，46 份进入本次快照。', evidenceIds: ['internal-evidence-id'] }] }],
    gaps: ['M1 只确认登记事实，目标达成仍需结构化测试或明确评价。'], disclaimer: '从阶段摘要到结项报告均绑定固定证据快照；归档成功后冻结唯一结项版本。', completion: { completedAt: '2026-11-02T08:00:00.000Z', archiveTransactionId: 'internal-archive-id' },
  };
}

test('Markdown and safe HTML exports contain only the current projected report and omit internal identifiers', () => {
  const markdown = projectReportMarkdown(projection());
  const html = projectReportHtml(projection());
  for (const value of ['虚构云台支架', '已结项归档', '本报告参考了 46 份项目资料', '支架 原型', '方便后续查看与展示']) {
    assert.match(markdown, new RegExp(value)); assert.match(html, new RegExp(value));
  }
  for (const technicalText of ['M1', 'M2', 'M3', '进入本次快照', '选择理由是其已采用', '固定证据快照']) {
    assert.equal(markdown.includes(technicalText), false); assert.equal(html.includes(technicalText), false);
  }
  for (const secret of ['internal-project-id', 'internal-version-id', 'internal-snapshot-id', 'internal-evidence-id', 'internal-archive-id']) {
    assert.equal(markdown.includes(secret), false); assert.equal(html.includes(secret), false);
  }
  assert.match(html, /<!doctype html>/i);
});

test('completion export, archive recovery and migration bridges are wired without making page reads write', () => {
  const main = read('electron/main.cjs'), preload = read('electron/preload.cjs'), panel = read('src/ProjectOverallReportPanel.tsx');
  assert.match(main, /finalizeArchivedProjectReport/);
  assert.match(main, /syncCommittedArchivedProject/);
  assert.match(main, /consumeCommittedProjectReportReceipt/);
  assert.match(main, /bridge:exportProjectOverallReport/);
  assert.match(preload, /exportProjectOverallReport/);
  assert.match(panel, /下载文字版/);
  assert.match(panel, /下载网页版/);
  assert.match(panel, /结项成果报告/);
  assert.doesNotMatch(panel, /useEffect\([^)]*exportProjectOverallReport/s);
  assert.match(main, /migration-project-reports\/project-report-state\.sqlite3/);
  assert.match(main, /packageIncludesProjectReports/);
  assert.match(main, /restoreProjectReportMigrationSnapshot/);
});

test('a committed archive receipt synchronizes the authoritative project row without overwriting newer state', () => {
  const main = read('electron/main.cjs');
  let current = { id: 'p1', status: 'active', updatedAt: '2026-11-02T07:00:00.000Z' };
  let invalidated = 0;
  const store = { getMetadata: () => current, upsert: (value) => { current = value; return value; } };
  const sync = new Function('projectStateStore', 'projectStateStoreInstance',
    `${extractFunction(main, 'syncCommittedArchivedProject')}; return syncCommittedArchivedProject;`)(
      () => store, { invalidateCaches: () => { invalidated += 1; } });
  const archived = { id: 'p1', status: 'archived', updatedAt: '2026-11-02T08:00:00.000Z' };
  assert.equal(sync('p1', { ok: true, project: archived }).status, 'archived');
  assert.equal(invalidated, 1);
  current = { id: 'p1', status: 'archived', updatedAt: '2026-11-02T09:00:00.000Z' };
  assert.throws(() => sync('p1', { ok: true, project: archived }), /不能用旧回执覆盖/);
});
