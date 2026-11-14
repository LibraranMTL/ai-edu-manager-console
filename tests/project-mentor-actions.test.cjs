'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PROJECT_MENTOR_STAGES,
  PROJECT_MENTOR_ACTIONS,
  PROJECT_MENTOR_ACTION_IDS,
} = require('../electron/project-mentor-actions.cjs');
const {
  buildCompanionPrompt,
  createCompanionPromptPacket,
  normalizeProjectSummary,
  projectSummaryRevision,
} = require('../electron/companion-toolbar.cjs');

const expectedLabels = [
  '第一性原理拆解与重建', '使用者与场景澄清', '范围与研究问题收敛', '假设与验证设计',
  'SWOT 与决策矩阵', '决策准则与证据检查', '取舍实验与反例', '决策备忘与撤销条件',
  '项目计划：里程碑与风险', '资源、角色与关键路径', '研究与证据计划', '风险登记与预案',
  '研究问题与资料质量审查', '原型/实验设计', '测试数据与观察记录', '迭代诊断与下一轮测试',
  '周复盘与下一步', '计划偏差与根因复盘', '学习与决策日志', '优先级重排',
  '受众与核心主张', '证据链与展品选择', '叙事、演示与讲稿', '质询与答辩演练',
];

const student = { id: 'student-1', name: '测试学生' };
const project = { id: 'project-1', name: '校园节水', type: '研究项目', status: 'active', objective: '比较两种节水方案', deliverables: ['测试记录', '展示原型'] };
const target = { id: 'generic', capabilities: { copy: true, query: false } };

test('project mentor registry has six stages, four actions each and 24 unique ids', () => {
  assert.equal(PROJECT_MENTOR_STAGES.length, 6);
  assert.deepEqual(PROJECT_MENTOR_STAGES.map(item => item.label), ['定义问题', '方案比较', '制定计划', '研究与原型', '阶段复盘', '成果展示交流']);
  assert.ok(PROJECT_MENTOR_STAGES.every(item => item.actions.length === 4));
  assert.equal(PROJECT_MENTOR_ACTION_IDS.length, 24);
  assert.equal(new Set(PROJECT_MENTOR_ACTION_IDS).size, 24);
  assert.deepEqual(PROJECT_MENTOR_ACTION_IDS.map(id => PROJECT_MENTOR_ACTIONS[id].label), expectedLabels);
});

test('every mentor action has the fixed data-driven contract', () => {
  for (const id of PROJECT_MENTOR_ACTION_IDS) {
    const action = PROJECT_MENTOR_ACTIONS[id];
    assert.ok(action.stageId);
    assert.ok(action.label);
    assert.ok(action.summary);
    assert.ok(action.role);
    assert.ok(Array.isArray(action.workflow) && action.workflow.length >= 5);
    assert.match(action.output, /A\./);
    assert.ok(action.success);
    assert.ok(action.boundary);
    assert.equal(action.configMode, 'goal');
  }
});

test('first-principles action rejects analogy and rebuilds upward from foundations with falsification', () => {
  const action = PROJECT_MENTOR_ACTIONS.project_first_principles;
  const text = [action.summary, ...action.workflow, action.output, action.success, action.boundary].join('\n');
  assert.match(text, /暂停类比|暂停接受.*类比/);
  assert.match(text, /硬约束.*已验证事实.*假设.*未知项/);
  assert.match(text, /向上推导|从基础推导/);
  assert.match(text, /最小证伪|最小可区分验证|支持或否定/);
  assert.match(text, /至少两条/);
});

test('bounded project summary only keeps approved fields and lengths', () => {
  const summary = normalizeProjectSummary({
    id: 'i'.repeat(100), name: 'n'.repeat(100), type: 't'.repeat(60), status: 's'.repeat(30), objective: 'o'.repeat(350),
    deliverables: Array.from({ length: 12 }, (_, index) => `${index}-${'d'.repeat(140)}`),
    projectRootPath: 'D:/private/project', studentIds: ['other-student'], permissions: { admin: true }, members: ['secret'],
  });
  assert.deepEqual(Object.keys(summary), ['id', 'name', 'type', 'status', 'objective', 'deliverables']);
  assert.equal(summary.id.length, 80);
  assert.equal(summary.name.length, 80);
  assert.equal(summary.type.length, 40);
  assert.equal(summary.status.length, 24);
  assert.equal(summary.objective.length, 300);
  assert.equal(summary.deliverables.length, 8);
  assert.ok(summary.deliverables.every(item => item.length <= 120));
  assert.doesNotMatch(JSON.stringify(summary), /projectRootPath|studentIds|permissions|members|private|other-student|secret/);
});

test('project revision is stable and changes when approved project summary changes', () => {
  const first = projectSummaryRevision(project);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(projectSummaryRevision({ ...project, projectRootPath: 'D:/changed/private' }), first);
  assert.notEqual(projectSummaryRevision({ ...project, objective: '新的目标' }), first);
  const packet = createCompanionPromptPacket({ actionId: 'project_plan', student, project, target, scope: 'project' }, new Date('2026-11-05T00:00:00.000Z'));
  assert.equal(packet.projectRevision, first);
  assert.doesNotMatch(packet.promptText, new RegExp(first));
});

test('all 24 mentor prompts are project-bound, evidence-bounded and path-safe', () => {
  const unsafeProject = { ...project, objective: '参考 D:\\secret\\plan.md 与 file:///private/data', deliverables: ['C:/users/private/result.docx'] };
  for (const actionId of PROJECT_MENTOR_ACTION_IDS) {
    const prompt = buildCompanionPrompt({ actionId, student, project: unsafeProject, target, scope: 'project', config: { goal: '完成本次动作' } });
    assert.match(prompt, /项目 ID：project-1/);
    assert.match(prompt, /事实、推断、假设和建议/);
    assert.match(prompt, /剪贴板模式，不会读取项目资料/);
    assert.match(prompt, /不自动写回任务、项目、报告或档案/);
    assert.doesNotMatch(prompt, /[A-Z]:[\\/]|file:\/\/|other-student|项目根目录|成员列表|内部权限/i);
  }
  assert.throws(() => buildCompanionPrompt({ actionId: 'project_plan', student, target, scope: 'conversation' }), /必须选择/);
});
