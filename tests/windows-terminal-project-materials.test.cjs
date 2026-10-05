const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const host = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
const terminal = fs.readFileSync(path.join(root, 'electron/terminal-main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron/terminal-preload.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src/TerminalProjectMaterialsPanel.tsx'), 'utf8');

test('Windows terminal four-view bridge is asynchronous and uses host-authorized APIs', () => {
  const methods = ['getProjectMaterialView', 'readProjectKnowledgeDocument',
    'getProjectClassificationSuggestions', 'submitProjectClassificationSuggestions',
    'applyProjectClassifications', 'getProjectMaterialOrganization',
    'runProjectMaterialOrganization', 'retryProjectMaterialOrganization',
    'downloadProjectMaterialVersion'];
  for (const method of methods) {
    assert.match(preload, new RegExp(`${method}:`));
    assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\('terminal:`));
    assert.doesNotMatch(preload, new RegExp(`sendSync\\([^\n]*${method}`));
  }
  assert.match(terminal, /\/material-views/);
  assert.match(terminal, /\/materials\/classification-suggestions/);
  assert.match(terminal, /\/materials\/organization:run/);
  assert.match(terminal, /\/materials\/organization\/\$\{encodeURIComponent\(normalizedOperationId\)\}\/retry/);
  assert.match(host, /handleProjectKnowledgeDocument\(request, response/);
  assert.match(host, /handleProjectMaterialVersionDownload\(request, response/);
});

test('terminal UI exposes all four views and obeys server capability flags', () => {
  for (const text of ['项目资料', '待整理', '项目知识', '贡献证据', '本地副本', '提交建议']) {
    assert.match(ui, new RegExp(text));
  }
  assert.match(ui, /capabilities\.classificationWrite/);
  assert.match(ui, /capabilities\.classificationSuggest/);
  assert.match(ui, /expectedRecordRevision: material\.recordRevision/);
  assert.match(ui, /view\.cached/);
  assert.match(ui, /下载的是本地副本，编辑不会自动同步/);
  assert.match(ui, /本终端不直接操作主机磁盘/);
  assert.match(ui, /capabilities\.organizationRetry/);
  assert.match(ui, /重试异常项/);
  assert.match(ui, /Windows 主机正在迁移历史资料/);
  assert.match(ui, /本终端保持只读/);
  assert.match(ui, /materialMigrationState === 'running'/);
});

test('terminal version download verifies identity version length and hash before exclusive save', () => {
  const start = terminal.indexOf('async function downloadProjectMaterialVersion');
  const end = terminal.indexOf('\n}', start) + 2;
  const source = terminal.slice(start, end);
  assert.match(source, /x-edu-material-id/);
  assert.match(source, /x-edu-material-version/);
  assert.match(source, /x-edu-material-sha256/);
  assert.match(source, /contentLength > 128 \* 1024 \* 1024/);
  assert.match(source, /crypto\.createHash\('sha256'\)/);
  assert.match(source, /fs\.promises\.open\(selection\.filePath, 'wx'\)/);
  assert.doesNotMatch(source, /shell\.openPath/);
});

test('offline caches are bound to host generation and student and contributions are never cached', () => {
  assert.match(terminal, /scope\.hostId/);
  assert.match(terminal, /scope\.dataGeneration/);
  assert.match(terminal, /scope\.studentId/);
  assert.match(terminal, /age > 24 \* 60 \* 60 \* 1000/);
  assert.match(terminal, /\['materials', 'pending', 'knowledge'\]\.includes/);
  assert.doesNotMatch(terminal, /\['materials', 'pending', 'knowledge', 'contributions'\]/);
});
