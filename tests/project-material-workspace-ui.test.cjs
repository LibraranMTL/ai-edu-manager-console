const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'ProjectMaterialsPanel.tsx'), 'utf8');
const entry = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'project-materials.css'), 'utf8');

test('Windows host project material center is wired through isolated asynchronous IPC', () => {
  const methods = [
    'getProjectMaterialWorkspaceView', 'getProjectClassificationSuggestions',
    'generateProjectClassificationSuggestions',
    'applyProjectMaterialClassifications', 'undoProjectMaterialClassification',
    'getProjectMaterialOrganizationStatus', 'configureProjectMaterialOrganization',
    'runProjectMaterialOrganization', 'retryProjectMaterialOrganization',
    'undoProjectMaterialOrganization', 'inspectProjectMaterialCapacityCleanup',
    'cleanupProjectMaterialCapacity',
    'getProjectMaterialMigrationStatus', 'previewProjectMaterialMigration',
    'executeProjectMaterialMigration', 'retryProjectMaterialMigration',
    'rollbackProjectMaterialMigration', 'inspectProjectMaterialMigrationBackups',
    'cleanupProjectMaterialMigrationBackups',
    'openProjectMaterialOriginal',
    'getProjectMaterialOverview', 'listProjectMaterialExceptions',
    'runProjectMaterialAutomation', 'getProjectMaterialAutomationStatus',
  ];
  for (const method of methods) {
    assert.match(preload, new RegExp(`${method}\\(`));
    assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\('bridge:${method}'`));
    assert.doesNotMatch(preload, new RegExp(`sendSync\\('bridge:${method}'`));
    assert.match(main, new RegExp(`ipcMain\\.handle\\('bridge:${method}'`));
  }
  assert.match(entry, /<ProjectMaterialsPanel project=\{selectedProject\}/);
  assert.match(main, /localProjectSourceAccess\(projectId, event\)/);
  assert.match(main, /materialStorageMode: 'workspace-v1'/);
  assert.match(main, /materialMigrationState: 'complete'/);
});

test('four-view UI keeps suggestions human-controlled and classifications logically undoable', () => {
  for (const label of ['项目资料', '需确认', '项目知识', '贡献证据']) assert.match(ui, new RegExp(label));
  assert.match(ui, /只审异常/);
  assert.match(ui, /立即处理/);
  assert.match(ui, /暂停资料处理/);
  assert.match(ui, /恢复资料处理/);
  assert.match(ui, /processingPaused/);
  assert.match(ui, /系统文件已从业务资料和迁移异常中排除/);
  assert.match(ui, /为什么这样建议/);
  assert.match(ui, /确认分类并采用/);
  assert.match(ui, /仅保存分类/);
  assert.match(ui, /全选当前列表/);
  assert.match(ui, /选择目录已识别/);
  assert.match(ui, /继承所在目录/);
  assert.match(ui, /已在正确目录的原件不会移动/);
  assert.match(ui, /selectedWithoutCategory/);
  assert.match(ui, /reviewProjectStagingItems/);
  assert.match(ui, /organization-after-adoption/);
  assert.match(ui, /自动建议/);
  assert.match(ui, /自动规则建议/);
  assert.match(ui, /撤销上次分类/);
  assert.match(ui, /不改变采用状态或原件位置/);
  assert.match(ui, /suggestion\?\.version === material\.version/);
  assert.match(ui, /expectedRecordRevision: material\.recordRevision/);
  assert.doesNotMatch(ui, /moveFile|renameFile|deleteFile/);
  assert.match(ui, /一次授权启用/);
  assert.match(ui, /关闭自动整理/);
  assert.match(ui, /人工分类始终优先/);
  assert.match(ui, /重试异常项/);
  assert.match(ui, /安全撤销/);
  assert.match(ui, /固定版本和迁移备份不会删除/);
  assert.match(ui, /预览历史资料迁移/);
  assert.match(ui, /检查备份清理/);
  assert.match(ui, /安全回滚/);
  assert.match(main, /recoverInterruptedProjectMaterialMigrations/);
  assert.match(main, /project_migration_busy/);
});

test('original reveal resolves only the current registered version and never launches it', () => {
  const start = main.indexOf('async function openProjectMaterialOriginal');
  const end = main.indexOf('\n}', start) + 2;
  const source = main.slice(start, end);
  assert.match(source, /store\.resolve\(String\(materialId \|\| ''\)\)/);
  assert.match(source, /resolved\.version !== Number\(version\)/);
  assert.match(source, /shell\.showItemInFolder\(resolved\.path\)/);
  assert.doesNotMatch(source, /shell\.openPath/);
});

test('large material and relationship lists use bounded rendering hints and reduced-motion fallback', () => {
  assert.match(css, /content-visibility:\s*auto/);
  assert.match(css, /contain-intrinsic-size/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /\.pm-batch-tools/);
  assert.match(css, /\.pm-field-label/);
});
