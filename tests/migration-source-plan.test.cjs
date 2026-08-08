const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { mergeExternalMigrationCandidates } = require('../electron/migration-source-plan.cjs');

test('student sibling knowledge summary and raw directories remain separate required migration sources', () => {
  const base = path.resolve('D:\\legacy-student');
  const sources = mergeExternalMigrationCandidates([
    { rootPath: path.join(base, 'knowledge'), label: '学生知识库', ownerType: 'student_knowledge', ownerId: 'student-1', required: true },
    { rootPath: path.join(base, 'summary'), label: '学生学情分析汇总', ownerType: 'student_summary', ownerId: 'student-1', required: true },
    { rootPath: path.join(base, 'summary', '成长模型'), label: '学生成长模型', ownerType: 'student_growth', ownerId: 'student-1', required: true },
    { rootPath: path.join(base, 'raw'), label: '学生原始资料', ownerType: 'student_raw', ownerId: 'student-1', required: true },
  ]);

  assert.equal(sources.length, 3);
  assert.equal(sources.every((item) => item.required), true);
  const summary = sources.find((item) => item.rootPath === path.join(base, 'summary'));
  assert.ok(summary);
  assert.deepEqual(summary.references.map((item) => item.ownerType).sort(), ['student_growth', 'student_summary']);
});

test('a parent project directory covers nested project paths without swallowing student sibling directories', () => {
  const base = path.resolve('D:\\portable-data');
  const sources = mergeExternalMigrationCandidates([
    { rootPath: path.join(base, 'projects'), label: '项目根目录', ownerType: 'project_root', ownerId: 'project-1' },
    { rootPath: path.join(base, 'projects', 'workspace'), label: '项目工作空间', ownerType: 'project_workspace', ownerId: 'project-1' },
    { rootPath: path.join(base, 'student-summary'), label: '学生学情分析汇总', ownerType: 'student_summary', ownerId: 'student-1', required: true },
  ]);

  assert.equal(sources.length, 2);
  assert.equal(sources.find((item) => item.rootPath === path.join(base, 'projects')).references.length, 2);
  assert.equal(sources.find((item) => item.rootPath === path.join(base, 'student-summary')).required, true);
});
