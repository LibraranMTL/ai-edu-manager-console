const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');

test('system settings are split into basic, host connection and knowledge collaboration submenus', () => {
  for (const label of ['基础设置', '主机连接', '知识协作']) {
    assert.match(renderer, new RegExp(label));
  }
  assert.match(renderer, /type SettingsSubmenu = 'basic' \| 'connection' \| 'collaboration'/);
  assert.match(renderer, /edu-manager-settings-submenu/);
  assert.match(renderer, /settingsSubmenu === 'basic'/);
  assert.match(renderer, /settingsSubmenu === 'connection'/);
  assert.match(renderer, /settingsSubmenu === 'collaboration'/);
  assert.match(renderer, /className="sub-nav-list settings-sub-nav-list" aria-label="系统设置子菜单"/);
  assert.match(renderer, /<span>基础设置<\/span>/);
  assert.match(renderer, /<span>主机连接<\/span>/);
  assert.match(renderer, /<span>知识协作<\/span>/);
  assert.match(renderer, /setSettingsMenuOpen\(true\)/);
  assert.doesNotMatch(renderer, /<aside className="settings-submenu-nav"/);
  assert.doesNotMatch(styles, /\.settings-submenu-nav/);
  assert.match(styles, /\.settings-page-layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test('knowledge collaboration stays in system settings without a duplicate workspace switcher', () => {
  assert.doesNotMatch(renderer, /KnowledgeWorkspaceView/);
  assert.doesNotMatch(renderer, /edu-manager-knowledge-workspace-view/);
  assert.doesNotMatch(renderer, /workspace-view-switcher/);
  assert.doesNotMatch(styles, /\.workspace-view-switcher/);
  assert.match(renderer, /className="nav-group-block settings-nav-group"/);
  assert.match(renderer, /onClick=\{\(\) => openSettingsSubmenu\('collaboration'\)\}/);
});

test('built-in direct transfer is default while syncthing stays advanced compatibility', () => {
  assert.match(renderer, /教育管家内置直传/);
  assert.match(renderer, /Syncthing 高级兼容/);
  assert.match(renderer, /打开兼容交换目录/);
  assert.match(renderer, /默认由教育管家通过局域网直传/);
  assert.match(renderer, /跨网络时自动尝试 Tailscale/);
});
