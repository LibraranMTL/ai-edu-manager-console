'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ACTIONS, MODE_GROUPS, normalizeActionConfig, normalizeCustomTarget, readSettings, writeSettings, targetCatalog, buildCompanionPrompt, createCompanionPromptPacket, genericConnectionPrompt } = require('../electron/companion-toolbar.cjs');

test('companion actions cover approved study interaction quiz verification and plan modes', () => {
  assert.deepEqual(MODE_GROUPS.map(group => group.id), ['study', 'interactive', 'quiz', 'verify', 'plan']);
  assert.ok(['digest', 'flashcards', 'mindmap', 'infographic', 'chart_summary', 'game_learning', 'animated_video', 'archive'].every(id => ACTIONS[id]));
  assert.ok(MODE_GROUPS.every(group => group.actions.every(id => ACTIONS[id])));
});

test('learning prompt packets support a null project without weakening project scope', () => {
  const student = { id: 's-1', name: '测试学生' };
  const target = { capabilities: { query: true } };
  for (const scope of ['conversation', 'student']) {
    for (const group of MODE_GROUPS) for (const actionId of group.actions) {
      const packet = createCompanionPromptPacket({ actionId, student, target, scope, project: null });
      assert.equal(packet.projectId, '');
      assert.equal(packet.projectRevision, undefined);
      assert.match(packet.promptText, /学生 ID：s-1/);
      assert.doesNotMatch(packet.promptText, /项目 ID：/);
    }
  }
  assert.throws(() => createCompanionPromptPacket({ actionId: 'flashcards', student, target, scope: 'project', project: null }), /请选择学习项目/);
  const packet = createCompanionPromptPacket({ actionId: 'flashcards', student, target, scope: 'project', project: { id: 'p-1', name: '测试项目' } });
  assert.equal(packet.projectId, 'p-1');
  assert.ok(packet.projectRevision);
  assert.match(packet.promptText, /项目 ID：p-1/);
});

test('animation learning requires real tools and a playable video artifact', () => {
  const action = ACTIONS.animated_video;
  assert.match(action.task, /调用.*视频生成.*动画.*工具及技能/);
  assert.match(action.task, /实际生成可播放动画视频/);
  assert.match(action.output, /可播放视频文件|成品链接/);
  assert.match(action.success, /不得用文案冒充视频/);
});

test('visual study actions use quantity and style while flashcards require printable artifacts', () => {
  for (const id of ['flashcards', 'mindmap', 'infographic', 'chart_summary']) assert.equal(ACTIONS[id].configMode, 'visual');
  const config = normalizeActionConfig('flashcards', { quantity: 'custom', customQuantity: 8, style: 'anime', difficulty: '进阶', duration: '30分钟' });
  assert.deepEqual(config, { quantity: 'custom', customQuantity: 8, style: 'anime', goal: '' });
  assert.throws(() => normalizeActionConfig('flashcards', { quantity: 'custom', customQuantity: 0 }), /1–50/);
  const prompt = buildCompanionPrompt({ actionId: 'flashcards', student: { id: 's-1', name: '测试学生' }, target: { capabilities: {} },
    config: { quantity: '2', style: 'simple', difficulty: '进阶', duration: '30分钟' } });
  assert.match(prompt, /数量：2 张/);
  assert.match(prompt, /风格：简洁/);
  assert.doesNotMatch(prompt, /难度：|时长：/);
  assert.match(prompt, /PNG 与 PDF 成品/);
  assert.match(prompt, /A4 打印版/);
  assert.match(prompt, /不得用文本清单代替文件/);
});

test('verification and planning actions omit difficulty and session duration', () => {
  for (const groupId of ['verify', 'plan']) {
    const group = MODE_GROUPS.find(item => item.id === groupId);
    for (const actionId of group.actions) {
      const config = normalizeActionConfig(actionId, { difficulty: '进阶', duration: '30分钟', goal: '核对目标' });
      assert.deepEqual(config, { goal: '核对目标' });
      const prompt = buildCompanionPrompt({ actionId, student: { id: 's-1', name: '测试学生' }, target: { capabilities: {} },
        config: { difficulty: '进阶', duration: '30分钟', goal: '核对目标' } });
      assert.doesNotMatch(prompt, /难度：|时长：/);
      assert.match(prompt, /本次目标：核对目标/);
    }
  }
});

test('custom agents stay clipboard-only and reject unsafe URLs', () => {
  const target = normalizeCustomTarget({ displayName: '我的网页 Agent', surface: 'web', homeUrl: 'https://agent.example/' });
  assert.equal(target.capabilities.copy, true);
  assert.equal(target.capabilities.query, false);
  assert.equal(target.capabilities.archive, false);
  assert.throws(() => normalizeCustomTarget({ displayName: '危险', homeUrl: 'file:///C:/secret' }), /https/);
});

test('target catalog never inflates disconnected or custom agent capabilities', () => {
  const catalog = targetCatalog({ capabilities: {
    codex: { id: 'codex', label: 'Codex', available: true, authorized: true },
    workbuddy: { id: 'workbuddy', label: 'WorkBuddy', available: true, authorized: false },
  }, native: { codex: { query: true, archive: true } }, customTargets: [{ displayName: '网页助手' }] });
  assert.equal(catalog.find(item => item.id === 'builtin:codex').capabilities.query, true);
  assert.equal(catalog.find(item => item.id === 'builtin:workbuddy').capabilities.query, false);
  assert.equal(catalog.find(item => item.kind === 'custom').capabilities.query, false);
});

test('prompt binds student and scope and keeps evidence boundary', () => {
  const target = { capabilities: { query: true, archive: true } };
  const prompt = buildCompanionPrompt({ actionId: 'tutor', student: { id: 's-1', name: '赵书源' }, target,
    scope: 'project', project: { id: 'p-1', name: '机器人' }, config: { difficulty: '进阶', duration: '15分钟', goal: '练习答辩' } });
  assert.match(prompt, /学生 ID：s-1/);
  assert.match(prompt, /项目 ID：p-1/);
  assert.match(prompt, /资料事实、学生本人表现、合理推断和缺失信息/);
  assert.match(prompt, /不能形成稳定能力结论/);
  const manual = buildCompanionPrompt({ actionId: 'step_quiz', student: { id: 's-1', name: 'A' }, target: { capabilities: {} }, scope: 'student' });
  assert.match(manual, /尚未确认资料查询连接/);
  assert.match(manual, /请用户在当前对话提供相应资料/);
  assert.match(manual, /不得猜测文件路径/);
  assert.throws(() => buildCompanionPrompt({ actionId: 'archive', student: { id: 's-1', name: 'A' }, target: { capabilities: {} } }), /未通过/);
});

test('inbound connector state is independent of automatic task login and cannot inherit revoked grants', () => {
  const capabilities = { codex: { id: 'codex', label: 'Codex', available: false, authorized: false } };
  const active = targetCatalog({ capabilities, native: { codex: { managed: true, connected: true, verified: true, query: true, archive: false, status: '桥接已验证' } } }).find(t => t.providerId === 'codex');
  assert.equal(active.capabilities.query, true);
  assert.equal(active.capabilities.archive, false);
  const revoked = targetCatalog({ capabilities: { codex: { ...capabilities.codex, available: true, authorized: true } }, native: { codex: { managed: true, connected: false, status: '未授权' } } }).find(t => t.providerId === 'codex');
  assert.equal(revoked.capabilities.query, false);
  assert.equal(revoked.verified, false);
});

test('prompt carries student planning context without inventing missing ability evidence', () => {
  const prompt = buildCompanionPrompt({ actionId: 'animated_video', student: { id: 's-2', name: '赵书源', grade: '高二',
    currentRegion: '中国北京', targetRegions: ['加拿大'], planningRoutes: ['international'], interests: ['工业设计'] },
    target: { capabilities: {} }, scope: 'conversation' });
  assert.match(prompt, /规划路径：国际/);
  assert.match(prompt, /兴趣：工业设计/);
  assert.match(prompt, /实际调用工具生成画面、动画、旁白和字幕/);
  assert.match(prompt, /Agent 生成的内容不等同于学生已经理解或掌握/);
});

test('settings persist only validated target and scope fields', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-toolbar-'));
  const file = path.join(dir, 'settings.json');
  writeSettings(file, { selectedTargetId: 'generic', scope: 'conversation', customTargets: [{ displayName: '我的 Agent', homeUrl: 'https://example.com' }] });
  const result = readSettings(file);
  assert.equal(result.customTargets.length, 1);
  assert.equal(result.customTargets[0].capabilities.archive, false);
  assert.doesNotMatch(JSON.stringify(result), /token|cookie|password/i);
});

test('generic connection instruction is explicit about clipboard-only mode', () => {
  const prompt = genericConnectionPrompt({ id: 's-1', name: '赵书源' });
  assert.match(prompt, /通用剪贴板模式不代表已连接/);
  assert.match(prompt, /不得猜测或访问其他学生/);
});

test('prepared prompt packet is student-bound, hashed and short-lived', () => {
  const now = new Date('2026-10-19T00:00:00.000Z');
  const packet = createCompanionPromptPacket({ actionId: 'step_quiz', student: { id: 's-1', name: '测试学生' },
    target: { id: 'generic', capabilities: {} }, scope: 'conversation' }, now);
  assert.equal(packet.studentId, 's-1');
  assert.match(packet.promptId, /^[0-9a-f-]{36}$/);
  assert.match(packet.promptHash, /^[0-9a-f]{64}$/);
  assert.equal(Date.parse(packet.expiresAt) - Date.parse(packet.createdAt), 10 * 60 * 1000);
});
