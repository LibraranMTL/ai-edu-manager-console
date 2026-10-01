'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createCaptureInbox } = require('../electron/capture-inbox.cjs');
const { projectPublishedReport, snapshotPublishedReports, inspectPublishedReport } = require('../electron/cloud-report-sync.cjs');
const { COMPETITIONS_SCHEMA, competitions } = require('../electron/research-content.cjs');
const { outputSchema } = require('../electron/planning-research.cjs');

function report(metadata, body = '## 本阶段进展\n\n- 合成已确认的持续学习证据，不代表真实学生。') {
  return `---\n${metadata}\nupdated: 2026-10-01\nstatus: published\nstudent_id: synthetic-a\n---\n\n# 合成报告\n\n${body}\n`;
}

test('drop directory registers actual received files, retains recoverable originals and isolates students', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-drop-inbox-'));
  let deliveries = 0;
  const create = () => createCaptureInbox({ resolveStudentDir: async id => { if (!['a', 'b'].includes(id)) throw Error('invalid student'); return path.join(root, id); }, deliver: async () => { deliveries++; return { ok: true }; } });
  try {
    let inbox = create();
    const info = await inbox.info('a');
    fs.writeFileSync(path.join(info.incomingPath, '网页分享摘要.md'), '# 合成外部投递资料');
    fs.writeFileSync(path.join(info.incomingPath, '不执行.exe'), 'not executed');
    fs.mkdirSync(path.join(info.incomingPath, '不递归'));
    const list = await inbox.list('a');
    assert.equal(list.length, 1); assert.equal(list[0].sourceChannel, 'auto_folder');
    assert.equal(list[0].originalName, '网页分享摘要.md'); assert.equal(list[0].status, 'ready');
    assert.equal(fs.existsSync(path.join(info.incomingPath, '网页分享摘要.md')), false);
    assert.equal(fs.readdirSync(info.receivedPath).length, 1);
    assert.equal(fs.readFileSync(path.join(info.receivedPath, fs.readdirSync(info.receivedPath)[0]), 'utf8'), '# 合成外部投递资料');
    assert.equal((await inbox.info('a')).skipped.length, 2);
    assert.deepEqual(await inbox.list('b'), []);
    inbox = create(); assert.equal((await inbox.list('a')).length, 1);
    fs.writeFileSync(path.join(info.incomingPath, '网页分享摘要.md'), '# 合成外部投递资料');
    assert.equal((await inbox.list('a')).length, 1, 'same name and bytes resume the same receipt');
    await inbox.change('a', [list[0].itemId], 'trash');
    assert.equal(deliveries, 0); assert.equal((await inbox.list('a'))[0].status, 'trashed');
    await inbox.change('a', [list[0].itemId], 'restore');
    await inbox.change('a', [list[0].itemId], 'deliver', { type: 'student' });
    assert.equal(deliveries, 1); assert.equal((await inbox.list('a'))[0].status, 'delivered');
    await assert.rejects(inbox.info('../other'));
    assert.equal(fs.existsSync(path.join(info.incomingPath, '不执行.exe')), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('shared directory access refuses redirected directory links', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-drop-link-'));
  const outside = path.join(root, 'outside'); fs.mkdirSync(outside);
  const inbox = createCaptureInbox({ resolveStudentDir: async () => path.join(root, 'a'), deliver: async () => ({ ok: true }) });
  try {
    const info = await inbox.info('a'); fs.rmdirSync(info.incomingPath);
    fs.symlinkSync(outside, info.incomingPath, 'junction');
    await assert.rejects(inbox.list('a'), /符号链接/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('current published report schemas project to canonical cloud types without modifying source files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-cloud-projection-'));
  const entries = {
    '整体画像.md': report('report_type: learning_profile'),
    '历史变化.md': report('report_type: learning_changes'),
    '每日行动建议.md': report('date: 2026-10-01\ngrowth_fingerprint: confirmed-synthetic'),
    '阶段总结.md': report('report_type: 阶段总结'),
  };
  try {
    for (const [name, content] of Object.entries(entries)) fs.writeFileSync(path.join(root, name), content);
    const snapshot = await snapshotPublishedReports({ reportDir: root, localStudentId: 'synthetic-a', cloudStudentId: 'cs_synthetic' });
    assert.equal(snapshot.ready.length, 4); assert.deepEqual(snapshot.skipped, []);
    assert.deepEqual(snapshot.ready.map(x => x.reportType), ['learning_profile', 'learning_change', 'weekly_action', 'stage_summary']);
    for (const item of snapshot.ready) {
      assert.match(item.content, new RegExp(`^---\\ntype: ${item.reportType}\\n`));
      assert.equal(fs.readFileSync(path.join(root, item.filename), 'utf8'), entries[item.filename]);
      assert.equal(item.sourceSha256, crypto.createHash('sha256').update(entries[item.filename]).digest('hex'));
      assert.equal(item.contentSha256, crypto.createHash('sha256').update(item.content).digest('hex'));
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('cloud projection strips local URI, drive, UNC and home references but retains official web links and evidence', () => {
  const raw = report('report_type: learning_profile', '- 合成正式依据\n- [本机依据](D:\\学生资料\\原报告.md)\n- 文件：file:///C:/private/file.md\n- 本地：D:/private/学生资料.txt\n- 本地：\\\\server\\private\\file.md\n- 本地：/Users/student/private.md\n- [官方公开来源](https://example.edu/official)');
  assert.equal(inspectPublishedReport(raw, 'synthetic-a', 'learning_profile').ok, false);
  const projected = projectPublishedReport(raw, 'synthetic-a', 'learning_profile');
  assert.equal(projected.ok, true); assert.equal(projected.removedPaths, true);
  assert.doesNotMatch(projected.content, /D:[\\/]|file:\/\/|C:[\\/]|\\\\server|\/Users\/student/);
  assert.match(projected.content, /合成正式依据/); assert.match(projected.content, /https:\/\/example.edu\/official/);
  assert.match(raw, /D:\\/);
});

test('projection fails closed for drafts, wrong ownership, unknown or conflicting report types and untyped reports', () => {
  for (const raw of [
    report('report_type: learning_profile').replace('status: published', 'status: pending_review'),
    report('report_type: learning_profile').replace('student_id: synthetic-a', 'student_id: other'),
    report('report_type: made_up'), report('type: learning_profile\nreport_type: learning_changes'), report(''),
  ]) assert.equal(projectPublishedReport(raw, 'synthetic-a', 'learning_profile').ok, false);
  assert.equal(projectPublishedReport(report('date: 2026-10-01'), 'synthetic-a', 'weekly_action').ok, false);
  assert.equal(projectPublishedReport(report('report_type: learning_stage'), 'synthetic-a', 'stage_summary').ok, true);
});

test('competition generation schema constrains enums before research; diagnostics name the invalid field', () => {
  const schema = outputSchema('competition_recommendation').properties.competitions.items;
  assert.deepEqual(schema.properties.category.enum, ['science_innovation', 'social_practice']);
  assert.deepEqual(schema.properties.scope.enum, ['domestic', 'international']);
  assert.deepEqual(schema, COMPETITIONS_SCHEMA.items);
  const item = { name: '合成比赛', category: '科创', scope: 'domestic' };
  assert.throws(() => competitions([item], [], new Date()), error => error.code === 'COMPETITION_INVALID_FIELD' && error.field === 'category');
  assert.throws(() => competitions([{ ...item, category: 'science_innovation', scope: '全球' }], [], new Date()), /scope/);
  assert.throws(() => competitions([null], [], new Date()), /结构化对象/);
});

test('renderer and async host bridges expose real received directory and per-file upload status', () => {
  const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
  const panel = read('src/CaptureInboxPanel.tsx'), cloud = read('src/CloudDocumentsPanel.tsx'), main = read('electron/main.cjs'), preload = read('electron/preload.cjs');
  assert.match(panel, /当前学生分享接收目录/); assert.match(panel, /已收到的/);
  assert.match(panel, /<summary>高级：本机文件补录<\/summary>/);
  assert.match(panel, /'share', 'student_web', 'auto_folder', 'android_share'/);
  assert.match(cloud, /报告未上传原因/); assert.match(cloud, /立即检查并上传/);
  for (const method of ['captureInboxInfo', 'captureInboxOpen', 'cloudReportSyncNow']) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\('bridge:${method}'`));
    assert.match(preload, new RegExp(`${method}\\([^)]*\\) \\{[\\s\\S]{0,180}ipcRenderer\\.invoke`));
  }
});
