const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
const controlCenter = fs.readFileSync(path.join(root, 'src', 'GlobalAgentControlCenter.tsx'), 'utf8');
const externalConnector = fs.readFileSync(path.join(root, 'src', 'ExternalAgentConnector.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');

test('Windows sidebar groups education, projects, Agent knowledge, collaboration, courses and settings', () => {
  for (const label of ['教育档案', '学情资料', '项目知识管理', '新建项目', '已有项目', 'Agent会话自动采集', 'Agent调用能力设置', '知识查询', '协作设置', 'Agent问答设置']) {
    assert.match(renderer, new RegExp(label));
  }
  assert.match(renderer, /type SettingsSubmenu = 'basic' \| 'connection' \| 'collaboration' \| 'agent-qa'/);
  assert.match(renderer, /edu-manager-settings-submenu/);
  assert.match(renderer, /settingsSubmenu === 'basic'/);
  assert.match(renderer, /settingsSubmenu === 'connection'/);
  assert.match(renderer, /settingsSubmenu === 'collaboration'/);
  assert.match(renderer, /className="sub-nav-list settings-sub-nav-list" aria-label="系统设置子菜单"/);
  assert.match(renderer, /<span>\{t\('nav.settings.basic'\)\}<\/span>/);
  assert.match(renderer, /<span>\{t\('nav.settings.connection'\)\}<\/span>/);
  assert.match(renderer, /<span>\{t\('nav.qa.settings'\)\}<\/span>/);
  const nav = renderer.slice(renderer.indexOf('<nav className="nav-list"'), renderer.indexOf('</nav>'));
  assert.ok(nav.indexOf("aria-label={t('nav.education')}") < nav.indexOf("<span>{t('nav.projects')}</span>"));
  assert.ok(nav.indexOf("aria-label={t('nav.collaboration')}") < nav.indexOf("activeSection === 'assets'"));
  const fixedNav = nav.slice(nav.indexOf('className="v12-fixed-navigation"'), nav.indexOf('{navItems.map'));
  assert.ok(fixedNav.indexOf("label: '精选课程'") < fixedNav.indexOf('<span>系统设置</span>'));
  assert.ok(!fixedNav.slice(fixedNav.indexOf('系统设置子菜单')).includes("t('nav.collaboration')"));
  assert.match(renderer, /setSettingsMenuOpen\(true\)/);
  assert.doesNotMatch(renderer, /<aside className="settings-submenu-nav"/);
  assert.doesNotMatch(styles, /\.settings-submenu-nav/);
  assert.match(styles, /\.settings-page-layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test('primary navigation stays unscrolled while the student list owns overflow', () => {
  assert.match(renderer, /<nav className="nav-list" aria-label="主菜单">/);
  assert.match(styles, /\.app-shell > \.sidebar \{[\s\S]*?min-height: 100vh;[\s\S]*?height: auto;/);
  assert.match(styles, /\.app-shell:not\(\.sidebar-collapsed\)::after \{[\s\S]*?width: 290px;[\s\S]*?background: #fff;/);
  assert.match(styles, /\.sidebar \.nav-list \{[\s\S]*?overflow: visible;/);
  assert.match(styles, /\.sidebar \.student-list \{[\s\S]*?overflow-y: auto;/);
  assert.match(styles, /\.sidebar \.sub-nav-list \{[\s\S]*?position: static;/);
  assert.match(styles, /\.sidebar \.student-rail \{[\s\S]*?height: 248px;/);
});

test('collaboration and Q&A reuse their existing state without a duplicate workspace switcher', () => {
  assert.doesNotMatch(renderer, /KnowledgeWorkspaceView/);
  assert.doesNotMatch(renderer, /edu-manager-knowledge-workspace-view/);
  assert.doesNotMatch(renderer, /workspace-view-switcher/);
  assert.doesNotMatch(styles, /\.workspace-view-switcher/);
  assert.match(renderer, /knowledge-collaboration', label: '知识协作', section: 'settings', action: \(\) => openSettingsSubmenu\('collaboration'\)/);
  assert.match(renderer, /activeSection === 'qa' && <>\s*<form className="agent-knowledge-query"/);
  assert.match(renderer, /settingsSubmenu === 'agent-qa' && agentSettingsTab === 'connection' && agentConnectionTab === 'qa'/);
  assert.match(renderer, /activeSection === 'capture' \|\| \(!isWindows && showingAgentMemory\)/);
  assert.match(renderer, /<details className="advanced-options growth-advanced-options">/);
  assert.match(renderer, /<details className="advanced-options archive-advanced-options" open=\{!isWindows\}>/);
});

test('external connector owns inbound authorization and write review under Agent connection management', () => {
  const knowledgeItems = renderer.slice(renderer.indexOf('const knowledgeNavItems = ['), renderer.indexOf('const courseCatalogCourses ='));
  assert.doesNotMatch(knowledgeItems, /id: 'agent-capabilities'/);
  for (const label of ['Agent 数据管理', 'Agent连接管理', '外部 Agent 连接器', 'Agent记忆管理']) assert.match(renderer, new RegExp(label));
  assert.match(controlCenter, /自定义 Agent 工具/);
  assert.match(renderer, /type AgentConnectionTab = 'connector' \| 'qa'/);
  assert.match(renderer, /\['connector', '外部 Agent 连接器'\]/);
  assert.match(renderer, /agentSettingsTab === 'connection' && agentConnectionTab === 'connector'[\s\S]{0,220}<ExternalAgentConnector api=/);
  assert.doesNotMatch(renderer, /外部写入审核|外部 Agent 能力与写入审核|showingAgentCapabilities/);
  assert.doesNotMatch(controlCenter, /<ExternalAgentConnector|import\('\.\/ExternalAgentConnector'\)/);
  for (const label of ['每次写入前确认', '写入记录与异常', '查看待确认内容', '确认批准此项', '拒绝并清除待写内容']) assert.match(externalConnector, new RegExp(label));
  assert.match(renderer, /activeSection === 'agent-capabilities'[\s\S]{0,220}setAgentConnectionTab\('connector'\)/);
  assert.match(renderer, /'agent-capabilities'\s*,\s*'soul'/);
});

test('executor connection settings use one Agent selector without changing provider controls', () => {
  const section = controlCenter.slice(controlCenter.indexOf('<section aria-label="执行器与连接设置">'), controlCenter.indexOf('<section aria-label="默认调度顺序">'));
  assert.match(section, /aria-label="选择 Agent／执行器"/);
  assert.match(section, /<optgroup label="内置 Agent">/);
  assert.match(section, /<optgroup label="LLM API">/);
  assert.match(section, /<optgroup label="自定义 Agent 工具">/);
  assert.match(section, /providerCard\(selectedProvider\)/);
  assert.match(section, /selectedProvider\.id === 'llm-api'/);
  assert.doesNotMatch(section, /snapshot\.providers\.map\(providerCard\)/);
  for (const action of ['连接／授权', '验证连接', '验证 CLI 协议', '打开工具', '官网／下载', '移除工具']) assert.match(controlCenter, new RegExp(action));
  for (const label of ['自动优先', '仅手工交接', '停用', '选择参与自动调度的任务合同', '验证联网研究合同', '编辑接入方式与连接设置']) assert.match(controlCenter, new RegExp(label));
  assert.match(controlCenter, /providerOperation/);
  assert.match(controlCenter, /通常需要 1–2 分钟，请勿重复点击/);
  assert.match(controlCenter, /aria-live="polite"/);
});

test('license affordances, archive warning and narrow navigation remain visible', () => {
  const collaborationNav = renderer.slice(renderer.indexOf('title={t(\'nav.collaboration\')}'), renderer.indexOf("aria-label={t('nav.collaboration')}") );
  assert.doesNotMatch(collaborationNav, /locked/);
  assert.match(renderer, /title=\{!windowsLicenseActive \? `\$\{t\('nav.qa'\)\}需要激活后使用`/);
  const archivePage = renderer.slice(renderer.indexOf("activeSection === 'archive' && selectedStudent"), renderer.indexOf("activeSection === 'qa'", renderer.indexOf("activeSection === 'archive' && selectedStudent")));
  assert.ok(archivePage.indexOf('当前为未激活只读浏览模式') < archivePage.indexOf('<details className="advanced-options archive-advanced-options"'));
  assert.match(styles, /@media \(max-width: 960px\)[\s\S]*\.nav-list \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.nav-item span \{\s*display: inline;/);
});

test('new navigation labels exist in all nine supported language tables', () => {
  for (const key of ['nav.education', 'nav.projects', 'nav.projects.new', 'nav.projects.existing', 'nav.growth', 'nav.archive', 'nav.qa', 'nav.qa.settings', 'nav.collaboration', 'nav.collaboration.settings', 'nav.courses', 'nav.courses.learning', 'nav.courses.management', 'nav.capture', 'nav.agentCapabilities', 'nav.settings.basic', 'nav.settings.connection']) {
    assert.equal((renderer.match(new RegExp(`'${key.replaceAll('.', '\\.')}':`, 'g')) || []).length, 9, `${key} should cover zh-CN plus eight locales`);
  }
});

test('built-in direct transfer is default while syncthing stays advanced compatibility', () => {
  assert.match(renderer, /教育管家内置直传/);
  assert.match(renderer, /Syncthing 高级兼容/);
  assert.match(renderer, /打开兼容交换目录/);
  assert.match(renderer, /默认由教育管家通过局域网直传/);
  assert.match(renderer, /跨网络时自动尝试 Tailscale/);
});
