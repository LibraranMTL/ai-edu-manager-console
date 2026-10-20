'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('production settings exposes fifth Skills tab and isolated IPC', () => {
  const main = read('src/main.tsx'), preload = read('electron/preload.cjs'), host = read('electron/main.cjs');
  assert.match(main, /type AgentSettingsTab = 'tools' \| 'data' \| 'connection' \| 'cloud' \| 'skills'/);
  assert.match(main, /\['skills', 'Skills管理'\]/);
  assert.match(main, /<SkillManagementPanel api=\{bridge\(\) \|\| \{\}\}/);
  assert.match(preload, /skillLibraryAction\(action, input\)/);
  assert.match(host, /bridge:skillLibraryAction/);
  assert.doesNotMatch(host.slice(host.indexOf("bridge:skillLibraryAction"), host.indexOf("bridge:skillLibraryAction") + 500), /agent-capabilities|MCP/);
});

test('production Skills page preserves QClaw and plugin installation boundaries', () => {
  const panel = read('src/SkillManagementPanel.tsx'), service = read('electron/skill-library-service.cjs'), adapters = read('electron/skill-discovery-adapters.cjs');
  assert.match(panel, /Skill存档管理/); assert.match(panel, /Skill浏览/);
  assert.match(panel, /QClaw 始终只读/); assert.match(panel, /providerId === 'qclaw' \? '不可安装'/);
  assert.match(service, /QClaw 本轮仅支持扫描和导出存档，不能安装/);
  assert.match(service, /sourceUnchanged = true/);
  assert.match(adapters, /canInstallSkill: false/);
  assert.match(panel, /selected\.kind === 'plugin' \? '插件暂缓'/);
});

test('Skill browser exposes guarded archive deletion without deleting Agent targets', () => {
  const panel = read('src/SkillManagementPanel.tsx'), service = read('electron/skill-library-service.cjs'), store = read('electron/skill-library-store.cjs');
  assert.match(panel, /删除此存档/);
  assert.match(panel, /确认删除存档/);
  assert.match(panel, /历史回执与恢复副本保留/);
  assert.match(service, /name === 'deleteArtifact'/);
  assert.match(store, /请先在 Codex 或 WorkBuddy 中卸载/);
  assert.match(store, /receipts\/deletes/);
  assert.doesNotMatch(store.slice(store.indexOf('deleteArtifact('), store.indexOf('listReceipts(', store.indexOf('deleteArtifact('))), /targetPath/);
});

test('Skill browser keeps search usable, sorts by name and exports manual-install copies', () => {
  const panel = read('src/SkillManagementPanel.tsx'), service = read('electron/skill-library-service.cjs'), store = read('electron/skill-library-store.cjs'), css = read('src/skill-management.css');
  assert.match(panel, /aria-label="搜索 Skill"/);
  assert.match(panel, /名称 A → Z/); assert.match(panel, /名称 Z → A/);
  assert.match(panel, /localeCompare\(.+zh-CN-u-co-pinyin/);
  assert.match(panel, /手动安装到其他 Agent/); assert.match(panel, /导出安装副本/);
  assert.match(service, /name === 'manualInstallInfo'/); assert.match(service, /name === 'exportManualInstallCopy'/);
  assert.match(store, /exportArtifactCopy/); assert.match(store, /independentlyManaged: true/);
  assert.match(css, /grid-template-columns:minmax\(320px,1fr\)/);
});
