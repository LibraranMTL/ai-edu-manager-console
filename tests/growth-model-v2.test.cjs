const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildGrowthIndexV2, parseLegacyGrowthEvidenceMarkdown } = require('../electron/growth-model.cjs');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

test('legacy markdown evidence is imported without placeholder rows', () => {
  const content = `# 成长证据

| 日期 | 证据 | 来源资料/项目 | 支撑能力 | 可信度 |
| --- | --- | --- | --- | --- |
| 待补充 | 待补充 | 待补充 | 待补充 | 待确认 |
| 2026-07-10 | 独立完成实验设计 | 物理 IA | 科学研究 | 教师确认 |
`;
  const records = parseLegacyGrowthEvidenceMarkdown(content);
  assert.equal(records.length, 1);
  assert.equal(records[0].status, 'confirmed');
  assert.equal(records[0].ability, '科学研究');
  assert.match(records[0].id, /^legacy-evidence-/);
});

test('growth index v2 separates abilities, contributions and evidence', () => {
  const index = buildGrowthIndexV2({
    student: { id: 'student-1', name: '测试学生' },
    growthDir: 'D:/student/成长模型',
    review: { candidates: [
      { id: 'e1', title: '实验设计', ability: '科学研究', status: 'confirmed', projectId: 'p1', projectName: '物理 IA', updatedAt: '2026-07-10T00:00:00.000Z' },
      { id: 'e2', title: '数据分析', ability: '科学研究', status: 'watching', projectId: 'p1', projectName: '物理 IA', updatedAt: '2026-07-11T00:00:00.000Z' },
    ] },
    projects: [{ id: 'p1', name: '物理 IA', status: 'published', publishedAt: '2026-07-12T00:00:00.000Z' }],
    now: new Date('2026-07-13T00:00:00.000Z'),
  });
  assert.equal(index.version, 2);
  assert.equal(index.schema, 'edu-manager.growth-model.v2');
  assert.equal(index.abilities[0].name, '科学研究');
  assert.equal(index.abilities[0].evidenceCount, 2);
  assert.equal(index.projects[0].reviewStatus, 'published');
  assert.deepEqual(index.projects[0].abilityNames, ['科学研究']);
  assert.equal(index.evidence.length, 2);
});

test('growth page owns growth data and does not render report cards', () => {
  const growthStart = ui.indexOf("activeSection === 'growth'");
  const reportsStart = ui.indexOf("activeSection === 'reports'", growthStart);
  const growthPage = ui.slice(growthStart, reportsStart);
  assert.match(growthPage, /title="成长模型目录"/);
  assert.match(growthPage, />能力画像</);
  assert.match(growthPage, />项目贡献</);
  assert.match(growthPage, />成长证据</);
  assert.doesNotMatch(growthPage, /learningReportDefinitions\.map/);
  assert.match(preload, /openGrowthModelDir\(studentId\)/);
  assert.match(main, /bridge:openGrowthModelDir/);
});

test('digestion and report protocols enforce reviewed growth data first', () => {
  assert.match(main, /成长模型是学生长期成长的权威数据层/);
  assert.match(main, /不要在资料消化过程中直接覆盖学情报告/);
  assert.match(main, /每日行动建议.*统一任务中心/);
  assert.match(ui, /资料消化不直接覆盖四份学情报告/);
  assert.match(ui, /新能力判断、项目贡献和成长证据，先写入成长模型的草稿或待审核候选/);
});
