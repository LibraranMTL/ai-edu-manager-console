const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildStudentGrowthSummary } = require('../electron/student-growth-summary.cjs');
const { parseGrowthIndexMarkdown } = require('../electron/growth-markdown-summary.cjs');

test('student growth summary is bounded and excludes paths and pending review data', () => {
  const result = buildStudentGrowthSummary({ id: 's1', name: '学生甲' }, {
    updatedAt: '2026-07-27T00:00:00.000Z',
    summary: { evidenceCount: 3, confirmedCount: 1, watchingCount: 1, abilityCount: 1, projectCount: 1 },
    abilities: [{ name: '问题解决', maturity: 'emerging', trend: 'improving', evidenceCount: 2, confirmedCount: 1, projectNames: ['项目甲'], sourcePath: 'D:/secret' }],
    projects: [{ projectName: '项目甲', reviewStatus: 'published', evidenceCount: 2, confirmedEvidenceCount: 1, abilityNames: ['问题解决'], knowledgeRootPath: 'D:/secret' }],
    evidence: [
      { title: '已确认证据', status: 'confirmed', ability: '问题解决', sourcePath: 'D:/secret' },
      { title: '观察证据', status: 'watching', ability: '表达' },
      { title: '待审核证据', status: 'pending', ability: '协作' },
    ],
  });
  assert.equal(result.schema, 'edu-manager.student-growth-summary.v1');
  assert.equal(result.abilities[0].maturityLabel, '正在形成');
  assert.equal(result.projects[0].reviewStatusLabel, '已发布');
  assert.deepEqual(result.recentEvidence.map((item) => item.title), ['已确认证据', '观察证据']);
  assert.doesNotMatch(JSON.stringify(result), /D:\/secret|sourcePath|knowledgeRootPath|待审核证据/);
});

test('student growth summary accepts the current v2 index shape', () => {
  const result = buildStudentGrowthSummary({ id: 's2', name: '学生乙' }, {
    summary: {},
    abilities: [{ name: '项目实践', maturity: 'established', trend: 'stable', evidenceCount: 2 }],
    projects: [{ projectName: '项目乙', status: 'published', evidenceCount: 2, confirmedEvidenceCount: 1 }],
    evidence: [
      { title: '已确认证据', status: 'confirmed' },
      { title: '观察证据', status: 'watching' },
      { title: '待处理证据', status: 'pending' },
    ],
  });
  assert.equal(result.summary.evidenceCount, 3);
  assert.equal(result.summary.confirmedCount, 1);
  assert.equal(result.summary.watchingCount, 1);
  assert.equal(result.summary.abilityCount, 1);
  assert.equal(result.summary.projectCount, 1);
  assert.equal(result.summary.publishedProjectCount, 1);
  assert.equal(result.projects[0].reviewStatus, 'published');
  assert.equal(result.projects[0].reviewStatusLabel, '已发布');
  assert.deepEqual(result.recentEvidence.map((item) => item.title), ['已确认证据', '观察证据']);
});

test('host exposes current-student-only growth summary route', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /function handleStudentGrowthSummary\(request, response, studentId\)/);
  assert.match(main, /requireStudentAccess\(request, response, studentId\)/);
  assert.match(main, /\/growth-summary\$\//);
  assert.match(main, /buildStudentGrowthSummary\(student, index\)/);
});

test('legacy growth Markdown is converted to the bounded student summary shape', () => {
  const result = parseGrowthIndexMarkdown(`# 学生成长模型结构化索引
Schema: \`edu-manager.growth-model.v2\`
生成时间：2026-07-27T04:06:57.934Z

## 总览
| 指标 | 数量 |
| --- | ---: |
| 成长证据 | 17 |
| 已确认 | 7 |
| 观察中 | 6 |
| 能力维度 | 4 |
| 关联项目 | 2 |

## 能力画像
| 能力 | 成熟度 | 趋势 | 证据 | 已确认 | 来源项目 | 最近观察 |
| --- | --- | --- | ---: | ---: | --- | --- |
| 项目实践 | established | improving | 9 | 3 | 无人机项目、D:\\secret\\workspace | 2026-07-26 |

## 项目贡献
| 项目 | 状态 | 证据 | 已确认 | 能力 | 更新 |
| --- | --- | ---: | ---: | --- | --- |
| 无人机项目 | published | 9 | 3 | 项目实践 | 2026-07-26 |`);
  assert.equal(result.compatibilityMode, true);
  assert.equal(result.summary.evidenceCount, 17);
  assert.equal(result.abilities[0].maturityLabel, '已形成');
  assert.deepEqual(result.abilities[0].projectNames, ['无人机项目']);
  assert.equal(result.projects[0].reviewStatusLabel, '已发布');
  assert.doesNotMatch(JSON.stringify(result), /Schema|D:\\\\secret|workspace/);
});

test('Windows and Android student terminals expose one read-only growth view', () => {
  const terminalMain = fs.readFileSync(path.join(__dirname, '..', 'electron', 'terminal-main.cjs'), 'utf8');
  const terminalPreload = fs.readFileSync(path.join(__dirname, '..', 'electron', 'terminal-preload.cjs'), 'utf8');
  const terminalUi = fs.readFileSync(path.join(__dirname, '..', 'src', 'terminal-main.tsx'), 'utf8');
  const android = fs.readFileSync(path.join(__dirname, '..', 'android-tablet-terminal', 'src', 'com', 'qxmatrix', 'eduterminal', 'MainActivity.java'), 'utf8');
  assert.match(terminalMain, /\/growth-summary/);
  assert.match(terminalMain, /async function loadGrowthSummary\(\) \{\s+const \{ config, studentId \} = currentStudentSession\(\);/);
  assert.match(terminalMain, /parseGrowthIndexMarkdown/);
  assert.match(terminalMain, /成长模型\/growth-index\.md/);
  assert.doesNotMatch(terminalMain, /requireStudentSession\(\)/);
  assert.match(terminalPreload, /getGrowthSummary/);
  assert.match(terminalUi, /查看成长模型/);
  assert.match(terminalUi, /学生端仅只读显示，不提供审核或修改操作/);
  assert.match(android, /button\("查看成长模型", false\)/);
  assert.match(android, /\/growth-summary/);
  assert.match(android, /成长模型\/growth-index\.md/);
  assert.match(android, /成长模型已更新（兼容模式）/);
  assert.match(android, /growthMaturityLabel/);
  assert.match(android, /safeGrowthNames/);
  assert.match(android, /只读显示当前学生的能力画像、项目贡献和已确认或观察中的近期成长证据/);
});

test('Android student terminal separates archive, project management and learning actions', () => {
  const android = fs.readFileSync(path.join(__dirname, '..', 'android-tablet-terminal', 'src', 'com', 'qxmatrix', 'eduterminal', 'MainActivity.java'), 'utf8');
  assert.match(android, /workspacePage\("搜集上传"/);
  assert.match(android, /workspacePage\("主机连接"/);
  assert.match(android, /workspacePage\("教育档案"/);
  assert.match(android, /workspacePage\("项目管理"/);
  assert.match(android, /workspacePage\("学习行动"/);
  assert.match(android, /workspacePage\("更多"/);
  assert.match(android, /collapsiblePanel\("学情档案"/);
  assert.match(android, /collapsiblePanel\("知识点跟踪"/);
  assert.match(android, /collapsiblePanel\("项目资料与知识"/);
  assert.match(android, /collapsiblePanel\("项目综合报告"/);
  assert.match(android, /collapsiblePanel\("项目导师"/);
  assert.match(android, /collapsiblePanel\("学习导师"/);
  assert.ok(
    android.indexOf('collapsiblePanel("学情档案"') < android.indexOf('collapsiblePanel("知识点跟踪"'),
    '知识点跟踪应位于教育档案中学情档案之后',
  );
  assert.ok(
    android.indexOf('projectPage = workspacePage("项目管理"') < android.indexOf('learningActionPage = workspacePage("学习行动"'),
    '项目管理应位于学习行动之前',
  );
  assert.match(android, /button\("升学路径", true\)/);
  assert.match(android, /button\("专业探索", false\)/);
  assert.match(android, /button\("职业发展", false\)/);
  assert.match(android, /body\.setVisibility\(View\.GONE\)/);
  const assembly = android.slice(android.indexOf('collectionPage = workspacePage'), android.indexOf('FrameLayout.LayoutParams topParams'));
  assert.doesNotMatch(assembly, /教育管家对话|contactCard|agentDialogCard|promptDialogCard/);
});
