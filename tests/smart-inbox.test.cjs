const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createSmartInbox, reasonGroup } = require('../electron/smart-inbox.cjs');
const P = require('../electron/smart-inbox-policy.cjs');
const context = { studentId: 'student-a', projects: [{ id: 'project-physics', name: '物理', studentIds: ['student-a', 'student-b'], categories: [{ categoryId: 'notes', name: '记录' }] }, { id: 'project-biology', name: '生物', studentIds: ['student-a'], categories: [] }] };
const target = { studentId: 'student-a', type: 'project', id: 'project-physics', categoryId: '' };
const suggestion = (text = 'project-physics') => ({ candidates: [{ ...target, score: .98, evidence: text, reason: '正文含明确项目编号' }], sensitive: false, conflict: false, reason: '建议物理项目' });
test('reason groups preserve unknown execution priority and classify legacy reviews for display', () => {
  assert.equal(reasonGroup({ status: 'execution_unknown', studentId: '', message: '没有足够的本机证据' }), 'execution_unknown');
  assert.equal(reasonGroup({ status: 'delivery_reconcile', studentId: 'student-a' }), 'receipt_review');
  assert.equal(reasonGroup({ status: 'review', studentId: 'student-a', message: '项目上下文过多，请指定来源投递项目' }), 'no_candidate');
  assert.equal(reasonGroup({ status: 'review', studentId: 'student-a', reasonCode: 'student_conflict' }), 'student_conflict');
  assert.equal(reasonGroup({ status: 'review', studentId: 'student-a', conversationKind: 'internal_task' }), 'internal_task');
});
test('weak lexical hints improve suggestions but never claim complete coverage or strong evidence', () => {
  const projects = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, name: `其他${i}`, summary: '' }));
  projects.push({ id: 'pendulum', name: '摆动实验研究', summary: '研究单摆周期与摆长关系', aliases: [] });
  const selected = P.selectRoutingCandidates({ context: { projects }, text: '测量摆锤来回运动的周期' });
  assert.ok(selected.candidateIds.includes('pendulum')); assert.equal(selected.strong, false); assert.equal(selected.complete, false);
});
test('small authorized scope includes unmatched competing projects before claiming complete coverage', () => {
  const projects = [{ id: 'a', name: '幼苗光照实验', summary: '幼苗观察' }, { id: 'b', name: '种子发芽研究', summary: '植物研究' }, { id: 'c', name: '音乐', summary: '' }];
  const selected = P.selectRoutingCandidates({ context: { projects }, text: '幼苗光照实验观察记录' });
  assert.deepEqual(new Set(selected.candidateIds), new Set(['a', 'b', 'c']));
  assert.equal(selected.complete, true); assert.equal(selected.strong, false);
});
async function confirmStudent(f, rows, studentId = 'student-a', requestId = 'confirm-student') {
  return f.engine.decide({ requestId, action: 'confirm_student', items: rows.map(r => ({ id: r.id, revision: r.revision, studentId })) });
}
async function fixture(t, overrides = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'smart-inbox-test-'));
  const source = path.join(dir, 'source'), destination = path.join(dir, 'destination'), directory = path.join(dir, 'state');
  await fs.mkdir(source); await fs.mkdir(destination);
  const calls = { extract: 0, classify: 0, deliver: 0, acquire: 0, forbidden: 0 };
  const host = { directory, stableAgeMs: 0, automaticAllowed: () => true,
    forbiddenRoots: () => { calls.forbidden++; return [destination]; },
    context: async id => { assert.ok(id === 'student-a' || id === ''); return { ...context, studentId: id }; },
    validateTarget: async value => { if (value.studentId !== 'student-a' || value.type === 'project' && !context.projects.some(p => p.id === value.id)) throw Error('目标越界'); return { targetName: 'test', value }; },
    extract: async item => { calls.extract++; return { text: await fs.readFile(item.snapshotPath, 'utf8'), warnings: [] }; },
    classify: async () => { calls.classify++; return suggestion(); },
    deliver: async (snapshot, _, entry, checkpoint) => {
      calls.deliver++; const file = path.join(destination, `${entry.target.id}-${entry.fingerprint.sha256}.txt`);
      await checkpoint({ destinationPath: file }); await fs.copyFile(snapshot, file);
      return { ok: true, path: file, recordId: entry.operationId };
    },
    acquire: () => { calls.acquire++; return () => {}; },
    events: async () => [],
    ...overrides,
  };
  const engine = createSmartInbox(host); await engine.init();
  t.after(async () => { await engine.close(); await fs.rm(dir, { recursive: true, force: true }); });
  const add = (data = {}) => engine.updateSource({ name: 'test', folder: source, studentId: 'student-a', enabled: true, automatic: true, ...data });
  const scan = async id => { await engine.requestScan(id); await engine.tick(); };
  const write = (name, text = '教育实验记录：project-physics。') => fs.writeFile(path.join(source, name), text);
  return { dir, source, destination, directory, calls, host, engine, add, scan, write };
}

test('reason group counts and filtering cover all pages within the source and student scope', async t => {
  const f = await fixture(t), source = await f.add({ studentId: '' });
  for (let i = 0; i < 27; i++) await f.write(`group-${i}.txt`, `synthetic ${i}`);
  await f.scan(source.id);
  const first = await f.engine.list({ sourceId: source.id, includeReasonCounts: true, reasonGroup: 'student_unknown' });
  assert.equal(first.reasonCounts.student_unknown, 27); assert.equal(first.total, 27); assert.equal(first.rows.length, 25);
  const second = await f.engine.list({ sourceId: source.id, includeReasonCounts: true, reasonGroup: 'student_unknown', page: 2 });
  assert.equal(second.rows.length, 2); assert.equal(second.reasonCounts.student_unknown, 27);
  assert.equal((await f.engine.list({ sourceId: source.id, reasonGroup: 'no_candidate' })).total, 0);
});
test('rule suggestion counts manual internal ignores and disappears after restoration', async t => {
  const f = await fixture(t), source = await f.add({ automatic: false });
  await f.write('internal.txt', JSON.stringify({ schema: 'edu-manager.agent-conversation-submission.v1', sourceAgent: 'codex',
    messages: [{ role: 'user', content: 'This is an app-generated request for a suggested next user message.' }] }));
  await f.scan(source.id);
  let row = (await f.engine.list()).rows[0];
  assert.equal((await f.engine.decide({ requestId: 'ignore-internal', action: 'ignore', items: [row] })).results[0].ok, true);
  let suggestions = await f.engine.listRuleSuggestions({ studentId: 'student-a' });
  assert.equal(suggestions.length, 1); assert.equal(suggestions[0].draft.enabled, false); assert.equal(suggestions[0].feedback.ignore, 1);
  row = (await f.engine.list({ status: 'ignored' })).rows[0];
  assert.equal((await f.engine.decide({ requestId: 'restore-internal', action: 'restore', items: [row] })).results[0].ok, true);
  suggestions = await f.engine.listRuleSuggestions({ studentId: 'student-a' }); assert.equal(suggestions.length, 0);
});

test('Agent restoration resumes only safe student blocked rows and reuses extraction', async t => {
  let available = false;
  const f = await fixture(t, { classify: async input => {
    await input.onStage({ stage: 'qualifying', providerId: 'codex', attemptId: 'synthetic-attempt' });
    if (!available) throw Object.assign(Error('login'), { code: 'AUTHENTICATION_REQUIRED', blockReason: {
      code: 'AUTHENTICATION_REQUIRED', category: 'agent', recoverable: true, stage: 'qualifying', message: 'login' } });
    await input.onStage({ stage: 'possibly_sent', providerId: 'codex' });
    await input.onResult(suggestion()); return suggestion();
  } });
  const s = await f.add(); await f.write('recover.txt'); await f.write('ignored.txt'); await f.scan(s.id);
  let rows = (await f.engine.list()).rows;
  const ignored = rows.find(r => r.name === 'ignored.txt');
  await f.engine.decide({ requestId: 'ignore-recovery', action: 'ignore', items: [ignored] });
  assert.equal(rows.every(r => r.blockReason.code === 'AUTHENTICATION_REQUIRED'), true);
  const extractionCount = f.calls.extract;
  available = true;
  const resumed = await f.engine.resumeAgent('student-a', 'recover-safe'); assert.equal(resumed.count, 1);
  await f.engine.tick();
  assert.equal(f.calls.extract, extractionCount); assert.equal(f.calls.deliver, 1);
  const delivered = (await f.engine.list({ status: 'delivered' })).rows[0]; assert.equal(delivered.execution.providerId, 'codex');
  assert.equal((await f.engine.list({ status: 'ignored' })).total, 1);
  assert.equal((await f.engine.resumeAgent('student-a', 'recover-safe-again')).count, 0);
});

test('paused source is excluded from automatic Agent restoration', async t => {
  const f = await fixture(t, { classify: async () => { throw Object.assign(Error('login'), { blockReason: { code: 'AUTHENTICATION_REQUIRED', recoverable: true } }); } });
  const s = await f.add(); await f.write('paused.txt'); await f.scan(s.id); await f.engine.pause(s.id);
  const resumed = await f.engine.resumeAgent('student-a', 'paused-recovery');
  assert.equal(resumed.count, 0); assert.equal(resumed.skipped, 1); assert.equal(resumed.skipReasons['来源暂停或已解除关联'], 1);
  assert.equal(f.calls.deliver, 0);
});

test('legacy pre-send auth migration backs up evidence and remains manually deliverable', async t => {
  const f = await fixture(t); const s = await f.add({ studentId: '' }); await f.write('legacy.txt'); await f.scan(s.id);
  const row = (await f.engine.list()).rows[0]; await f.engine.close();
  const file = path.join(f.directory, 'items', `${row.id}.json`), record = JSON.parse(await fs.readFile(file));
  record.message = 'WorkBuddy 后台通道未取得有效认证；桌面登录正常也不代表后台已获授权';
  await fs.writeFile(file, JSON.stringify(record)); await fs.unlink(path.join(f.directory, 'agent-recovery-migration-v2.json'));
  const restored = createSmartInbox(f.host); t.after(() => restored.close()); await restored.init();
  const migrated = await restored.detail(row.id); assert.equal(migrated.status, 'review');
  assert.equal(migrated.blockReason.recoverable, true); assert.equal(migrated.blockReason.stage, 'not_sent');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.directory, 'migration-backup-agent-v2', `${row.id}.json`))), record);
  const delivered = await restored.decide({ requestId: 'legacy-manual', action: 'correct', items: [{ id: migrated.id, revision: migrated.revision, target }] });
  assert.equal(delivered.results[0].ok, true); assert.equal((await restored.detail(row.id)).status, 'delivered');
});

test('previous faulty v2 quarantine is repaired only for known pre-send evidence', async t => {
  const f = await fixture(t); const s = await f.add({ studentId: '' }); await f.write('legacy-v2.txt'); await f.scan(s.id);
  const row = (await f.engine.list()).rows[0]; await f.engine.close();
  const file = path.join(f.directory, 'items', `${row.id}.json`), record = JSON.parse(await fs.readFile(file));
  Object.assign(record, { status: 'execution_unknown', message: 'WorkBuddy 后台通道未取得有效认证；桌面登录正常也不代表后台已获授权',
    blockReason: { code: 'LEGACY_AGENT_BLOCKED', category: 'agent', recoverable: false, stage: 'legacy_unknown' } });
  await fs.writeFile(file, JSON.stringify(record)); await fs.unlink(path.join(f.directory, 'agent-recovery-migration-v3.json'));
  const restored = createSmartInbox(f.host); t.after(() => restored.close()); await restored.init();
  const repaired = await restored.detail(row.id); assert.equal(repaired.status, 'review'); assert.equal(repaired.blockReason.recoverable, true);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.directory, 'migration-backup-agent-v3', `${row.id}.json`))), record);
});

test('interrupted legacy migration resumes from its original backup without dispatching or changing unknown records', async t => {
  const f = await fixture(t); const s = await f.add({ studentId: '' });
  await f.write('legacy-interrupted.txt'); await f.write('legacy-unknown.txt'); await f.scan(s.id);
  const rows = (await f.engine.list()).rows, legacy = rows.find(r => r.name === 'legacy-interrupted.txt');
  const unknown = rows.find(r => r.name === 'legacy-unknown.txt'); await f.engine.close();
  const legacyFile = path.join(f.directory, 'items', `${legacy.id}.json`), unknownFile = path.join(f.directory, 'items', `${unknown.id}.json`);
  const original = JSON.parse(await fs.readFile(legacyFile));
  original.message = 'WorkBuddy 后台通道未取得有效认证；桌面登录正常也不代表后台已获授权';
  const uncertain = { ...JSON.parse(await fs.readFile(unknownFile)), status: 'execution_unknown', execution: { stage: 'possibly_sent' } };
  await fs.writeFile(legacyFile, JSON.stringify(original)); await fs.writeFile(unknownFile, JSON.stringify(uncertain));
  const backup = path.join(f.directory, 'migration-backup-agent-v2');
  await fs.mkdir(backup, { recursive: true }); await fs.writeFile(path.join(backup, `${legacy.id}.json`), JSON.stringify(original));
  await fs.unlink(path.join(f.directory, 'agent-recovery-migration-v2.json'));
  const restored = createSmartInbox(f.host); t.after(() => restored.close()); await restored.init();
  const migrated = await restored.detail(legacy.id), preserved = await restored.detail(unknown.id);
  assert.equal(migrated.blockReason.stage, 'not_sent'); assert.equal(migrated.revision, original.revision + 1);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(backup, `${legacy.id}.json`))), original);
  assert.equal(preserved.status, 'execution_unknown'); assert.equal(preserved.execution.stage, 'possibly_sent');
  assert.equal(f.calls.classify + f.calls.deliver, 0);
  await restored.close(); const restarted = createSmartInbox(f.host); t.after(() => restarted.close()); await restarted.init();
  assert.equal((await restarted.detail(legacy.id)).revision, migrated.revision);
  assert.equal((await restarted.detail(unknown.id)).status, 'execution_unknown');
});

test('legacy v3 migration backup can restore original bytes and migrate again without auto dispatch', async t => {
  const f = await fixture(t), source = await f.add({ studentId: '' });
  await f.write('rollback-v3.txt'); await f.scan(source.id);
  const row = (await f.engine.list()).rows[0]; await f.engine.close();
  const file = path.join(f.directory, 'items', `${row.id}.json`), original = JSON.parse(await fs.readFile(file));
  Object.assign(original, { status: 'execution_unknown', message: 'WorkBuddy 后台通道未取得有效认证；桌面登录正常也不代表后台已获授权',
    blockReason: { code: 'LEGACY_AGENT_BLOCKED', category: 'agent', recoverable: false, stage: 'legacy_unknown' } });
  const originalBytes = Buffer.from(JSON.stringify(original)); await fs.writeFile(file, originalBytes);
  const marker = path.join(f.directory, 'agent-recovery-migration-v3.json'); await fs.unlink(marker);
  const migrated = createSmartInbox(f.host); await migrated.init(); await migrated.close();
  const backup = path.join(f.directory, 'migration-backup-agent-v3', `${row.id}.json`);
  assert.deepEqual(await fs.readFile(backup), originalBytes);
  // Explicit rollback in the isolated fixture: restore the saved bytes and remove
  // only the migration marker so a new process can test a subsequent upgrade.
  await fs.copyFile(backup, file); assert.deepEqual(await fs.readFile(file), originalBytes); await fs.unlink(marker);
  const upgraded = createSmartInbox(f.host); t.after(() => upgraded.close()); await upgraded.init();
  assert.equal((await upgraded.detail(row.id)).blockReason.stage, 'not_sent');
  assert.deepEqual(await fs.readFile(backup), originalBytes); assert.equal(f.calls.classify + f.calls.deliver, 0);
});
test('v2 migration restart after record commit but before marker does not increment revision again', async t => {
  const f = await fixture(t), source = await f.add({ studentId: '' }); await f.write('v2-post-commit.txt'); await f.scan(source.id);
  const row = (await f.engine.list()).rows[0]; await f.engine.close();
  const file = path.join(f.directory, 'items', `${row.id}.json`), record = JSON.parse(await fs.readFile(file));
  record.message = 'WorkBuddy 后台通道未取得有效认证；桌面登录正常也不代表后台已获授权';
  await fs.writeFile(file, JSON.stringify(record)); const marker = path.join(f.directory, 'agent-recovery-migration-v2.json');
  await fs.unlink(marker); const first = createSmartInbox(f.host); await first.init();
  const migrated = await first.detail(row.id); await first.close(); await fs.unlink(marker);
  const resumed = createSmartInbox(f.host); t.after(() => resumed.close()); await resumed.init();
  assert.equal((await resumed.detail(row.id)).revision, migrated.revision);
  assert.equal((await resumed.detail(row.id)).blockReason.stage, 'not_sent');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.directory, 'migration-backup-agent-v2', `${row.id}.json`))), record);
  assert.equal(f.calls.classify + f.calls.deliver, 0);
});

test('missing shared original is marked by scan; removing a row is reversible and never needs original bytes', async t => {
  const f = await fixture(t), s = await f.add({ studentId: '' });
  await f.write('gone.docx'); await f.scan(s.id);
  await fs.unlink(path.join(f.source, 'gone.docx')); await f.scan(s.id);
  const row = (await f.engine.list()).rows[0]; assert.equal(row.originalMissing, true);
  assert.match(row.message, /原件已不存在/);
  const request = { requestId: 'remove-missing', action: 'ignore', items: [{ id: row.id, revision: row.revision }] };
  assert.equal((await f.engine.decide(request)).results[0].ok, true);
  assert.equal((await f.engine.decide(request)).results[0].ok, true);
  assert.equal((await f.engine.list()).total, 0);
  const ignored = (await f.engine.list({ status: 'ignored' })).rows[0];
  assert.equal((await f.engine.detail(row.id)).lastDecision.requestId, request.requestId);
  assert.equal((await f.engine.decide({ requestId: 'restore-missing', action: 'restore', items: [ignored] })).results[0].ok, true);
  assert.equal((await f.engine.list()).total, 1);
  assert.equal(f.calls.extract + f.calls.classify + f.calls.deliver, 0);
});

test('manual delivery marks a deleted conversation source missing and returns an actionable error', async t => {
  const fileState = { available: true };
  let eventFile = '';
  const f = await fixture(t, {
    events: async source => source.type === 'history'
      ? [{ locator: JSON.stringify({ sources: [{ assetId: 'asset-conversation' }] }), name: 'conversation.md' }]
      : [],
    resolveEvent: async () => {
      if (!fileState.available) throw Object.assign(Error('source deleted'), { code: 'original_missing' });
      return { path: eventFile, stat: await fs.lstat(eventFile) };
    },
  });
  eventFile = path.join(f.source, 'conversation.md');
  await fs.writeFile(eventFile, 'project-physics conversation');
  await f.engine.bootstrap({ students: [{ id: 'student-a', name: '测试学生' }] });
  const history = (await f.engine.sources()).sources.find(source => source.type === 'history');
  await f.engine.updateSource({ ...history, enabled: true, automatic: false });
  await f.engine.requestScan(history.id); await f.engine.tick();
  const row = (await f.engine.list()).rows[0];
  fileState.available = false;
  const result = await f.engine.decide({ requestId: 'deleted-conversation', action: 'correct', items: [{ id: row.id, revision: row.revision, target }] });
  assert.equal(result.results[0].ok, false);
  assert.match(result.results[0].message, /回收站|彻底删除/);
  const marked = await f.engine.detail(row.id);
  assert.equal(marked.originalMissing, true);
  assert.match(marked.message, /源会话/);
});

test('policy rejects extraction errors, truncation and missing original even with an explicit source target', () => {
  for (const item of [{ extractionBlocked: true }, { truncated: true }, { originalMissing: true }]) {
    assert.equal(P.automaticTarget({ source: { automatic: true, studentId: 'student-a', target }, item, context,
      text: 'project-physics', suggestion: suggestion(), rules: [] }), null);
  }
});

test('a readable document may route by substantive content evidence despite unrecognized pictures and formulas', () => {
  const text = '本次物理实验研究摆长与周期之间的关系，通过多次测量周期并对实验误差进行统计分析，形成实验报告。';
  const input = { source: { automatic: true, studentId: 'student-a', confidenceThreshold: .95 }, item: { extractionPartial: true }, context,
    text, suggestion: suggestion('研究摆长与周期之间的关系，通过多次测量周期') };
  assert.equal(P.automaticTarget(input).basis, 'verified_content_threshold');
  const provisional = P.automaticTarget({ ...input, source: { ...input.source, confidenceThreshold: .99 } });
  assert.equal(provisional, null);
  assert.equal(P.automaticTarget({ ...input, suggestion: { ...input.suggestion, conflict: true } }), null);
  assert.equal(P.automaticTarget({ ...input, suggestion: { ...input.suggestion, candidates: [...input.suggestion.candidates, { ...target, id: 'project-biology', score: .9 }] } }), null);
  assert.throws(() => P.confidenceThreshold(.5));
});

test('disappearing original during confirmation is reported, not success, and can be removed with new revision', async t => {
  const f = await fixture(t), s = await f.add({ studentId: '' });
  await f.write('gone.txt'); await f.scan(s.id); const rows = (await f.engine.list()).rows;
  await fs.unlink(path.join(f.source, 'gone.txt'));
  const result = await confirmStudent(f, rows); assert.equal(result.results[0].ok, false);
  assert.match(result.results[0].message, /原件已不存在/);
  const updated = (await f.engine.list()).rows[0]; assert.equal(updated.originalMissing, true); assert.equal(updated.studentId, '');
  assert.equal((await f.engine.decide({ requestId: 'remove-after-fail', action: 'ignore', items: [updated] })).results[0].ok, true);
  assert.equal(f.calls.classify + f.calls.deliver, 0);
});

test('missing original on retry cannot leave an infinite retry or dispatch Agent', async t => {
  const f = await fixture(t, { classify: async () => ({ ...suggestion(), candidates: [] }) }), s = await f.add();
  await f.write('gone.txt'); await f.scan(s.id); await fs.unlink(path.join(f.source, 'gone.txt'));
  const row = (await f.engine.list()).rows[0];
  const result = await f.engine.decide({ requestId: 'retry-gone', action: 'retry', items: [row] });
  assert.equal(result.results[0].ok, false); assert.equal((await f.engine.detail(row.id)).originalMissing, true);
  assert.equal(f.engine.hasPendingWork(), false); assert.equal(f.calls.deliver, 0);
});

for (const result of [
  { text: 'project-physics', warnings: ['未知提取异常'] },
  { text: 'project-physics', warnings: [], truncated: true },
  { text: '', warnings: [] },
]) test(`unsafe extraction remains blocked: ${JSON.stringify(result)}`, async t => {
  const f = await fixture(t, { extract: async () => result }), s = await f.add();
  await f.write('unsafe.docx'); await f.scan(s.id);
  assert.equal(f.calls.classify + f.calls.deliver, 0);
  assert.match((await f.engine.list()).rows[0].message, /未发送给Agent/);
});

test('legacy truncated cache is reassessed using full extractor cache; known notices survive cached retry', async t => {
  const warnings = ['仅提取文档可读正文；图片、图表、嵌入对象和版式不作为已完整识别的证据。'];
  let fullCacheCalls = 0;
  const f = await fixture(t, { extract: async () => { fullCacheCalls++; return { text: 'project-physics', warnings, coverage: 'complete' }; } });
  const s = await f.add({ studentId: '', automatic: false }); await f.write('old.docx'); await f.scan(s.id);
  const row = (await f.engine.list()).rows[0];
  const hash = (await require('../electron/project-materials.cjs').hashStableFile(path.join(f.source, 'old.docx'))).sha256;
  const cache = path.join(f.directory, 'extractions', `${P.digest(['student-a', hash, '.docx', 'v1'])}.json`);
  await fs.writeFile(cache, JSON.stringify({ sha256: hash, result: { text: 'project-physics', truncated: true } }));
  await confirmStudent(f, [row]); await f.engine.tick();
  const reviewed = (await f.engine.list({ studentId: 'student-a' })).rows[0];
  assert.equal(reviewed.proposedTarget.id, 'project-physics'); assert.equal(fullCacheCalls, 1);
  const request = { requestId: 'retry-cache', action: 'retry', items: [reviewed] };
  assert.equal((await f.engine.decide(request)).results[0].ok, true); await f.engine.tick();
  assert.equal(fullCacheCalls, 1); assert.equal(f.calls.classify, 1);
  assert.deepEqual((await f.engine.detail(row.id)).extractionWarnings, warnings);
  assert.equal((await f.engine.list({ studentId: 'student-b' })).total, 0);
});

test('schedule validates and advances interval, daily, weekly and manual deterministically', () => {
  const from = new Date(2026, 9, 12, 20, 1).getTime();
  assert.equal(P.nextRun({ ...P.DEFAULT_SCHEDULE, mode: 'manual' }, from), '');
  assert.equal(Date.parse(P.nextRun({ ...P.DEFAULT_SCHEDULE, mode: 'interval', minutes: 90 }, from)), from + 90 * 60000);
  const daily = new Date(P.nextRun(P.DEFAULT_SCHEDULE, from)); assert.equal(daily.getDate(), 13); assert.equal(daily.getHours(), 20);
  const weekly = new Date(P.nextRun({ ...P.DEFAULT_SCHEDULE, mode: 'weekly', weekday: 1 }, from)); assert.equal(weekly.getDate(), 19);
  assert.throws(() => P.schedule({ ...P.DEFAULT_SCHEDULE, minutes: 1 }));
  assert.throws(() => P.schedule({ ...P.DEFAULT_SCHEDULE, time: '25:00' }));
});

test('batch student confirmation only scopes selected files; verified AI route delivers without rebinding shared source', async t => {
  const f = await fixture(t); await f.write('a.txt'); await f.write('b.txt'); await f.write('unselected.txt');
  const s = await f.add({ studentId: '' }); await f.scan(s.id);
  const rows = (await f.engine.list()).rows.filter(r => r.name !== 'unselected.txt');
  const result = await confirmStudent(f, rows); assert.ok(result.results.every(r => r.ok));
  await f.engine.tick();
  assert.equal((await f.engine.list({ status: 'delivered' })).total, 2);
  assert.equal((await f.engine.sources()).sources.find(r => r.id === s.id).studentId, '');
  assert.equal((await f.engine.list()).rows[0].studentId, '');
  assert.equal(f.calls.deliver, 2); assert.equal(f.calls.classify, 1, 'same student extraction/recommendation cache reused');
  assert.deepEqual(await confirmStudent(f, rows), result, 'same request replays without second analysis');
  assert.equal(f.calls.deliver, 2);
});

test('confirmed student produces recommendations below the provisional project floor and retains manual delivery', async t => {
  const f = await fixture(t, { classify: async () => ({ ...suggestion(), candidates: [{ ...suggestion().candidates[0], score: .6 }] }) });
  await f.write('a.txt'); const s = await f.add({ studentId: '' }); await f.scan(s.id);
  await confirmStudent(f, (await f.engine.list()).rows); await f.engine.tick();
  const row = (await f.engine.list()).rows[0]; assert.equal(row.status, 'review'); assert.equal(row.proposedTarget.id, target.id); assert.equal(f.calls.deliver, 0);
  const accepted = await f.engine.decide({ requestId: 'manual', action: 'correct', items: [{ id: row.id, revision: row.revision, target }] });
  assert.equal(accepted.results[0].ok, true); assert.equal(f.calls.deliver, 1);
});

test('manual delivery accepts metadata-only identity drift when stable content still matches the captured fingerprint', async t => {
  const f = await fixture(t, { classify: async () => ({ ...suggestion(), candidates: [{ ...suggestion().candidates[0], score: .6 }] }) });
  await f.write('metadata-only.txt'); const source = await f.add({ studentId: 'student-a' }); await f.scan(source.id);
  const row = (await f.engine.list()).rows[0]; assert.equal(row.status, 'review');
  await f.engine.close();
  const recordFile = path.join(f.directory, 'items', `${row.id}.json`);
  const record = JSON.parse(await fs.readFile(recordFile, 'utf8'));
  record.identity = `${record.identity}:metadata-only-change`;
  await fs.writeFile(recordFile, JSON.stringify(record));
  const restored = createSmartInbox(f.host); t.after(() => restored.close()); await restored.init();
  const current = await restored.detail(row.id);
  const accepted = await restored.decide({ requestId: 'metadata-only-manual', action: 'correct', items: [{ id: current.id, revision: current.revision, target }] });
  assert.equal(accepted.results[0].ok, true, JSON.stringify(accepted)); assert.equal(f.calls.deliver, 1);
});

test('confirmation cannot change known student, reuse stale versions, or accept deleted students', async t => {
  const f = await fixture(t); await f.write('a.txt'); const s = await f.add({ studentId: '' }); await f.scan(s.id);
  const rows = (await f.engine.list()).rows;
  assert.equal((await confirmStudent(f, rows, 'missing', 'missing')).results[0].ok, false);
  await confirmStudent(f, rows); await f.engine.tick();
  assert.equal((await confirmStudent(f, rows, 'student-a', 'stale')).results[0].ok, false);
  const delivered = (await f.engine.list({ status: 'delivered' })).rows;
  assert.equal((await confirmStudent(f, delivered, 'student-b', 'wrong')).results[0].ok, false);
});

test('changed original is rejected before confirmation and before analysis after confirmation', async t => {
  let busy = false;
  const f = await fixture(t, { acquire: () => busy ? null : () => {} });
  await f.write('before.txt'); const s = await f.add({ studentId: '' }); await f.scan(s.id);
  const before = (await f.engine.list()).rows;
  await f.write('before.txt', 'changed before confirmation');
  assert.equal((await confirmStudent(f, before)).results[0].ok, false);
  await f.write('after.txt'); await f.scan(s.id);
  busy = true; const row = (await f.engine.list()).rows.find(r => r.name === 'after.txt');
  assert.equal((await confirmStudent(f, [row], 'student-a', 'after')).results[0].ok, true);
  await f.write('after.txt', 'changed after confirmation'); busy = false; await f.engine.tick();
  assert.equal(f.calls.classify, 0); assert.equal(f.calls.deliver, 0);
});

test('manual locks and unknown execution cannot be reset through student confirmation', async t => {
  const f = await fixture(t, { classify: async () => { throw Object.assign(Error('unknown'), { code: 'execution_unknown' }); } });
  await f.write('a.txt'); const s = await f.add({ studentId: '' }); await f.scan(s.id);
  await confirmStudent(f, (await f.engine.list()).rows); await f.engine.tick();
  const rows = (await f.engine.list()).rows; assert.equal(rows[0].status, 'execution_unknown');
  assert.equal((await confirmStudent(f, rows, 'student-a', 'blocked')).results[0].ok, false);
  await f.write('b.txt'); await f.scan(s.id);
  const b = (await f.engine.list()).rows.find(r => r.name === 'b.txt');
  await f.engine.decide({ requestId: 'ignore-b', action: 'ignore', items: [b] });
  const ignored = (await f.engine.list({ status: 'ignored' })).rows;
  await f.engine.decide({ requestId: 'restore-b', action: 'restore', items: ignored });
  assert.equal((await confirmStudent(f, [(await f.engine.list()).rows.find(r => r.name === 'b.txt')], 'student-a', 'locked')).results[0].ok, false);
});

test('confirmation respects source automatic setting regardless of content keywords', async t => {
  for (const sensitive of [true, false]) {
    const f = await fixture(t); await f.write('a.txt', sensitive ? '身份证 project-physics' : 'project-physics');
    const s = await f.add({ studentId: '', automatic: sensitive }); await f.scan(s.id);
    await confirmStudent(f, (await f.engine.list()).rows); await f.engine.tick();
    assert.equal((await f.engine.list({ status: sensitive ? 'delivered' : 'pending' })).rows[0].status, sensitive ? 'delivered' : 'review');
    assert.equal(f.calls.deliver, sensitive ? 1 : 0);
    assert.equal(f.calls.classify, 1);
  }
});

test('shared-source confirmations isolate same-content extraction and Agent context between students', async t => {
  const seen = [], extracted = [];
  const f = await fixture(t, { context: async studentId => ({ ...context, studentId }), validateTarget: async () => ({}),
    extract: async item => { extracted.push(item.studentId); return { text: 'project-physics', warnings: [] }; },
    classify: async ({ context: c }) => { seen.push(c.studentId); return { ...suggestion(), candidates: [{ ...suggestion().candidates[0], studentId: c.studentId }] }; } });
  await f.write('a.txt'); await f.write('b.txt'); const s = await f.add({ studentId: '' }); await f.scan(s.id);
  const rows = (await f.engine.list()).rows;
  await confirmStudent(f, [rows[0]], 'student-a', 'a'); await f.engine.tick();
  await confirmStudent(f, [rows[1]], 'student-b', 'b'); await f.engine.tick();
  assert.deepEqual(seen, ['student-a', 'student-b']); assert.deepEqual(extracted, ['student-a', 'student-b']);
  const delivered = (await f.engine.list({ status: 'delivered' })).rows;
  assert.equal(delivered.length, 2); assert.ok(delivered.every(r => r.target.studentId === r.studentId));
});

test('confirmation survives restart while waiting for resources, without rescanning or duplicate dispatch', async t => {
  let busy = true;
  const f = await fixture(t, { acquire: () => busy ? null : () => {} });
  await f.write('a.txt'); const s = await f.add({ studentId: '' }); await f.scan(s.id);
  const rows = (await f.engine.list()).rows; await confirmStudent(f, rows); await f.engine.close();
  busy = false; const resumed = createSmartInbox(f.host); f.engine = resumed; t.after(() => resumed.close());
  await resumed.tick(); assert.equal((await resumed.list({ status: 'delivered' })).total, 1); assert.equal(f.calls.deliver, 1);
  await confirmStudent(f, rows); await resumed.tick(); assert.equal(f.calls.deliver, 1);
});

test('waiting reason is saved on resource denial; listing is read-only and successful resume clears reason', async t => {
  let paused = true, acquired = 0;
  const f = await fixture(t, { acquire: () => { acquired++; return paused ? null : () => {}; }, waitingReason: () => '该学生已暂停，自动分析暂停' });
  await f.write('a.txt'); const s = await f.add(); await f.scan(s.id);
  assert.match((await f.engine.list()).rows[0].reason, /已暂停/);
  const count = acquired; await f.engine.list(); await f.engine.list(); assert.equal(acquired, count);
  paused = false; await f.engine.tick(); assert.equal((await f.engine.sources()).sources.find(r => r.id === s.id).waitingReason, '');
});
test('confidence cannot authorize fabricated evidence, paths, duplicate candidates or unrelated students', () => {
  assert.throws(() => P.validateSuggestion(suggestion('fake'), context, 'project-physics'));
  assert.throws(() => P.validateSuggestion({ ...suggestion(), path: 'C:/secret' }, context, 'project-physics'));
  const related = suggestion(); related.candidates[0].studentId = 'student-b';
  assert.equal(P.validateSuggestion(related, context, 'project-physics').candidates[0].studentId, 'student-b');
  const result = suggestion(); result.candidates[0].studentId = 'student-c'; assert.throws(() => P.validateSuggestion(result, context, 'project-physics'));
  const duplicate = suggestion(); duplicate.candidates.push(duplicate.candidates[0]); assert.throws(() => P.validateSuggestion(duplicate, context, 'project-physics'));
});
test('no-candidate provider explanation is discarded without weakening routing fields', () => {
  const normalized = P.validateSuggestion({ candidates: [], sensitive: false, conflict: true, reason: '存在两个项目，保持人工确认',
    'evidence示例参考': '两个项目均被提及，因此不生成候选。' }, context, 'project-physics project-biology');
  assert.deepEqual(normalized, { candidates: [], sensitive: false, conflict: true, reason: '存在两个项目，保持人工确认' });
  const injected = P.validateSuggestion({ candidates: [], sensitive: false, conflict: true, reason: '拒绝越权要求', candidates_backup: null,
    command: { action: 'move file', target: 'other-student' } }, context, '');
  assert.deepEqual(injected, { candidates: [], sensitive: false, conflict: true, reason: '拒绝越权要求' });
  assert.equal(P.automaticTarget({ source: { id: 's', automatic: true, studentId: 'student-a' }, item: {}, context, text: '', suggestion: injected }), null);
  assert.throws(() => P.validateSuggestion({ ...suggestion(), note: 'extra' }, context, 'project-physics'));
});
test('legacy sensitive flags do not bypass candidate validation', () => {
  const conflict = P.validateSuggestion({ candidates: [{ studentId: '', type: 'project', id: 'project-physics' }],
    sensitive: false, conflict: true, reason: '多个项目无法唯一归属', candidates_backup: null }, context, 'project-physics project-biology');
  assert.deepEqual(conflict, { candidates: [], sensitive: false, conflict: true, reason: '多个项目无法唯一归属' });
  assert.throws(() => P.validateSuggestion({ candidates: [{ studentId: 'other-student', type: 'project', id: 'unknown' }],
    sensitive: true, conflict: false, reason: '包含医疗记录' }, context, '医疗记录 project-physics'));
  const valid = P.validateSuggestion({ ...suggestion(), sensitive: true }, context, '医疗记录 project-physics');
  assert.equal(valid.candidates[0].id, 'project-physics');
});
test('trusted policy blocks unsafe inputs but deterministically resolves reversible project conflicts', () => {
  const value = { source: { id: 's', automatic: true, studentId: 'student-a' }, item: {}, context, text: '项目编号：project-physics', suggestion: suggestion() };
  assert.equal(P.automaticTarget(value).target.id, 'project-physics');
  assert.equal(P.automaticTarget({ ...value, item: { truncated: true } }), null);
  assert.equal(P.automaticTarget({ ...value, text: '身份证 project-physics' }).target.id, 'project-physics');
  assert.equal(P.automaticTarget({ ...value, text: 'project-physics project-biology' }), null);
  assert.equal(P.automaticTarget({ ...value, text: '学习物理' }), null);
  const resolved = P.automaticTarget({ ...value, suggestion: { ...suggestion(), conflict: true } });
  assert.equal(resolved, null);
});
test('same content and historical association outrank AI and remain deterministic', () => {
  const hash = 'a'.repeat(64);
  const exactContext = { ...context, projects: context.projects.map(project => project.id === 'project-physics'
    ? { ...project, materialTerms: [{ sha256: hash, title: '摆长实验.md' }], historicalAssociations: [{ sha256: hash }] }
    : project) };
  const resolved = P.automaticTarget({ source: { automatic: true, studentId: 'student-a' },
    item: { fingerprint: { sha256: hash } }, context: exactContext, text: '普通资料正文，不含项目编号。',
    suggestion: { candidates: [], sensitive: false, conflict: false, reason: '' } });
  assert.equal(resolved.basis, 'same_content_history');
  assert.equal(resolved.target.id, 'project-physics');
});
test('multiple explicit projects wait for AI theme ranking, then use a stable provisional inbox', () => {
  const text = 'project-physics 与 project-biology 的跨学科研究，主主题为细胞代谢与酶活性变化。';
  const empty = { candidates: [], sensitive: false, conflict: false, reason: '' };
  assert.equal(P.automaticTarget({ source: { automatic: true, studentId: 'student-a' }, item: {}, context,
    text, suggestion: empty, classificationAttempted: false }), null);
  const ranked = P.automaticTarget({ source: { automatic: true, studentId: 'student-a' }, item: {}, context, text,
    suggestion: { candidates: [{ studentId: 'student-a', type: 'project', id: 'project-biology', categoryId: '',
      score: .7, evidence: '主主题为细胞代谢与酶活性变化', reason: '正文主主题匹配' }], sensitive: false, conflict: true, reason: '跨项目' },
    classificationAttempted: true });
  assert.equal(ranked, null);
});
test('bounded context retains explicit late project and refuses ambiguous large context', () => {
  const projects = Array.from({ length: 10 }, (_, i) => ({ id: `project-${i}`, name: `项目${i}`, identifiers: [`project-${i}`], categories: [], materialTerms: Array.from({ length: 200 }, () => ({ title: 'x'.repeat(200) })) }));
  const context = { studentId: 'student-a', projects, profile: {} };
  const result = P.boundedRoutingContext(context, '正文明确关联 project-9');
  assert.deepEqual(result.candidateIds, ['project-9']);
  assert.ok(Buffer.byteLength(JSON.stringify(result.context)) < 100 * 1024);
  assert.equal(P.boundedRoutingContext(context, '没有明确项目标识').context, null);
});
test('Chinese fragment recall remains weak and does not exclude other projects', () => {
  const projects = Array.from({ length: 7 }, (_, i) => ({ id: `p-${i}`, name: i === 6 ? '课程学习工作台' : `其他项目${i}`, summary: '' }));
  const result = P.selectRoutingCandidates({ context: { projects }, text: '设计课程学习流程，完善学习工作内容' });
  assert.ok(result.candidateIds.includes('p-6'));
  assert.equal(result.complete, false);
  assert.equal(result.strong, false);
});
test('weak evidence recalls all projects before loading selected details and cannot auto deliver', async t => {
  const projects = Array.from({ length: 8 }, (_, i) => ({ id: `candidate-${i}`, name: `研究${i}`, studentIds: ['student-a'], identifiers: [`candidate-${i}`], categories: [] }));
  const seen = [];
  const f = await fixture(t, { context: async (id, options = {}) => ({ studentId: id, profile: {},
    projects: options.mode === 'details' ? projects.filter(p => options.projectIds.includes(p.id)) : projects }),
    classify: async ({ context: value }) => { seen.push(value.projects.map(p => p.id));
      return { candidates: [{ studentId: 'student-a', type: 'project', id: 'candidate-7', categoryId: '', score: .98,
        evidence: '有关绘画与材料实验的具体内容', reason: '主题相关' }], sensitive: false, conflict: false, reason: '建议' }; } });
  const source = await f.add(); await f.write('recall.md', '有关绘画与材料实验的具体内容，继续探索制作过程。'); await f.scan(source.id);
  assert.equal(seen[0].length, 8); assert.deepEqual(seen[1], ['candidate-7']);
  assert.equal(f.calls.deliver, 0); const row = (await f.engine.list()).rows[0];
  assert.equal(row.status, 'review'); assert.equal(row.proposedTarget.id, 'candidate-7');
});
test('three authorized projects reach classifier even if only one has a local hint', async t => {
  const projects = [{ id: 'p-a', name: '幼苗光照实验' }, { id: 'p-b', name: '植物生长观察' }, { id: 'p-c', name: '音乐编曲' }]
    .map(p => ({ ...p, studentIds: ['student-a'], identifiers: [p.id], categories: [] }));
  const seen = [];
  const f = await fixture(t, { context: async (id, options = {}) => ({ studentId: id, profile: {},
    projects: options.mode === 'details' ? projects.filter(p => options.projectIds.includes(p.id)) : projects }),
    classify: async ({ context: value }) => { seen.push(value.projects.map(p => p.id));
      return { candidates: [], sensitive: false, conflict: true, reason: '存在相似项目，请人工确认' }; } });
  const source = await f.add(); await f.write('ambiguous.txt', '幼苗光照实验中的植物生长观察记录，需要比较另一个项目。'); await f.scan(source.id);
  assert.deepEqual(new Set(seen[0]), new Set(projects.map(p => p.id)));
  assert.equal(f.calls.deliver, 0); assert.equal((await f.engine.list()).rows[0].status, 'review');
});
test('conflicting candidates are exposed and require an explicit manual target', async t => {
  const text = 'project-physics 和 project-biology 的实验记录，两个项目均有关联。';
  const f = await fixture(t, { classify: async () => ({ candidates: [
    { ...target, score: .9, evidence: 'project-physics', reason: '物理项目' },
    { studentId: 'student-a', type: 'project', id: 'project-biology', categoryId: '', score: .9, evidence: 'project-biology', reason: '生物项目' },
  ], sensitive: false, conflict: true, reason: '两个项目均有关联' }) });
  const source = await f.add(); await f.write('conflict.txt', text); await f.scan(source.id);
  const row = (await f.engine.list()).rows[0]; assert.equal(row.suggestionConflict, true);
  assert.deepEqual(new Set(row.candidateTargets.map(value => value.id)), new Set(['project-physics', 'project-biology']));
  const accepted = await f.engine.decide({ requestId: 'conflict-accept', action: 'accept', items: [row] });
  assert.equal(accepted.results[0].ok, false); assert.match(accepted.results[0].message, /手动指定/); assert.equal(f.calls.deliver, 0);
  const corrected = await f.engine.decide({ requestId: 'conflict-manual', action: 'correct', items: [{ ...row, target }] });
  assert.equal(corrected.results[0].ok, true); assert.equal(f.calls.deliver, 1);
});
test('user rules honor priority, fail closed on conflict, and never ignore explicit project evidence', () => {
  const base = { id: 'rule-a', name: '系统会话', studentId: 'student-a', sourceId: 'source-a', enabled: true,
    priority: 10, action: 'ignore', includeWords: ['内部会话'], excludeWords: [], pathIncludes: [], extensions: ['.md'], projectAliases: [], version: 1 };
  const input = { source: { id: 'source-a', studentId: 'student-a' }, item: { studentId: 'student-a', name: 'a.md', locator: 'sessions/a.md' }, context };
  assert.equal(P.matchUserRules({ ...input, rules: [base], text: '内部会话缓存' }).action, 'ignore');
  assert.equal(P.matchUserRules({ ...input, rules: [base], text: '内部会话 project-physics' }).status, 'conflict');
  const targetRule = { ...base, id: 'rule-b', name: '投递', action: 'deliver', target, includeWords: ['内部会话'] };
  assert.equal(P.matchUserRules({ ...input, rules: [base, targetRule], text: '内部会话' }).status, 'conflict');
  assert.throws(() => P.validateUserRule({ ...base, includeWords: [], extensions: [], sourceId: '' }), /忽略规则|至少需要/);
});
test('two-stage routing loads only an explicit late candidate even when detailed project data exceeds 100 KiB', async t => {
  const projects = Array.from({ length: 10 }, (_, index) => ({ id: `project-${index}`, name: `项目${index}`, studentIds: ['student-a'],
    identifiers: [`project-${index}`], categories: [], materialTerms: [], knowledgeTerms: [], historicalAssociations: [] }));
  const seen = [];
  const f = await fixture(t, {
    context: async (id, options = {}) => {
      seen.push(options.mode || 'full');
      const selected = options.mode === 'details' ? projects.filter(project => options.projectIds.includes(project.id)) : projects;
      return { studentId: id, projects: selected.map(project => ({ ...project,
        materialTerms: options.mode === 'details' ? Array.from({ length: 500 }, () => ({ title: 'x'.repeat(300) })) : [] })), profile: {} };
    },
    classify: async input => {
      assert.deepEqual(input.context.projects.map(project => project.id), ['project-9']);
      return { candidates: [{ studentId: 'student-a', type: 'project', id: 'project-9', categoryId: '', score: .9,
        evidence: 'project-9', reason: '明确项目' }], sensitive: false, conflict: false, reason: '候选内判断' };
    },
    validateTarget: async value => ({ value }),
  });
  const source = await f.add({ automatic: false }); await f.write('late.md', '正文明确关联 project-9，并包含足够的学习资料内容。'); await f.scan(source.id);
  const row = (await f.engine.list()).rows[0], detail = await f.engine.detail(row.id);
  assert.deepEqual(detail.routingScope.candidateIds, ['project-9']);
  assert.equal(detail.routingScope.totalProjects, 10); assert.ok(seen.includes('light')); assert.ok(seen.includes('details'));
});
test('configured ignore rule is recoverable and read-only trial requires explicit confirmation before queuing', async t => {
  const f = await fixture(t); const source = await f.add({ automatic: true });
  const rule = await f.engine.saveUserRule({ name: '内部会话忽略', studentId: 'student-a', sourceId: source.id, action: 'ignore',
    enabled: true, priority: 20, includeWords: ['内部会话'], excludeWords: [], pathIncludes: [], extensions: ['.md'], projectAliases: [] });
  assert.equal(rule.version, 1); await f.write('internal.md', '内部会话缓存，不属于学习项目。'); await f.scan(source.id);
  const ignored = (await f.engine.list({ status: 'ignored' })).rows[0]; assert.ok(ignored);
  assert.match((await f.engine.detail(ignored.id)).message, /未删除原件/);
  await f.engine.decide({ requestId: 'restore-user-rule', action: 'restore', items: [{ id: ignored.id, revision: ignored.revision }] });
  const restored = (await f.engine.list()).rows[0];
  const trial = await f.engine.previewBacklog({ itemIds: [restored.id] });
  assert.equal(trial.results[0].suggestedAction, 'ignore'); assert.equal((await f.engine.detail(restored.id)).status, 'review');
  await assert.rejects(() => f.engine.applyPreview({ previewId: trial.previewId, itemIds: [restored.id] }), /明确确认/);
  const applied = await f.engine.applyPreview({ previewId: trial.previewId, itemIds: [restored.id], confirmed: true });
  assert.equal(applied.results[0].ok, true);
});
test('draft rule preview cannot enqueue work before the rule is saved', async t => {
  const f = await fixture(t); const source = await f.add({ automatic: false });
  await f.write('draft.md', '内部任务'); await f.scan(source.id);
  const row = (await f.engine.list()).rows[0];
  const trial = await f.engine.previewBacklog({ itemIds: [row.id], rule: { name: '草稿', studentId: 'student-a', sourceId: source.id,
    action: 'ignore', enabled: true, includeWords: ['内部任务'] } });
  await assert.rejects(() => f.engine.applyPreview({ previewId: trial.previewId, itemIds: [row.id], confirmed: true }), /草稿/);
  assert.equal((await f.engine.detail(row.id)).status, 'review');
});
test('student conflict prevents source binding and user rules from auto delivery', async t => {
  const f = await fixture(t, { studentHints: () => [{ id: 'student-a', name: '甲同学' }, { id: 'student-b', name: '乙同学' }] });
  const source = await f.add({ target }); await f.write('conflict.md', '乙同学 project-physics'); await f.scan(source.id);
  assert.equal(f.calls.deliver, 0); assert.equal(f.calls.classify, 0);
  assert.match((await f.engine.list()).rows[0].message, /其他学生/);
});
test('explicit internal-task rule ignores only a recognized pure system conversation', async t => {
  const f = await fixture(t); const source = await f.add();
  await f.engine.saveUserRule({ name: '内部消息', studentId: 'student-a', sourceId: source.id, action: 'ignore', enabled: true,
    conversationKind: 'internal_task', sourceAgent: 'codex' });
  const request = { role: 'user', content: 'This is an app-generated request for a suggested next user message. Example' };
  await f.write('pure.md', JSON.stringify({ schema: 'edu-manager.agent-conversation-submission.v1', sourceAgent: 'codex', messages: [request] }));
  await f.write('mixed.md', JSON.stringify({ schema: 'edu-manager.agent-conversation-submission.v1', sourceAgent: 'codex', messages: [request, { role: 'user', content: 'project-physics' }] }));
  await f.scan(source.id);
  const ignored = (await f.engine.list({ status: 'ignored' })).rows;
  assert.deepEqual(ignored.map(row => row.name), ['pure.md']);
});
test('legacy sensitive flags do not override an authorized shared project', () => {
  const text = '医疗记录，资料属于 project-biology。';
  const local = P.automaticTarget({ source: { automatic: true, studentId: 'student-a',
    target: { studentId: 'student-a', type: 'project', id: 'project-biology', categoryId: '' } }, item: {}, context,
    text, suggestion: { candidates: [], sensitive: false, conflict: false, reason: '' }, sensitiveLocalOnly: true });
  assert.equal(local.target.id, 'project-biology'); assert.deepEqual(local.linkedStudentIds, ['student-a']);
  const cross = P.automaticTarget({ source: { automatic: true, studentId: 'student-a', target }, item: {}, context,
    text: '医疗记录，资料属于 project-physics。', suggestion: { candidates: [], sensitive: false, conflict: false, reason: '' }, sensitiveLocalOnly: true });
  assert.equal(cross.target.id, 'project-physics');
});
test('explicit bound target delivers once, keeps original and unchanged scans do not extract/hash/model', async t => {
  const f = await fixture(t); await f.write('lesson.txt'); const source = await f.add({ target });
  await f.scan(source.id);
  assert.equal((await f.engine.list({ status: 'delivered' })).total, 1);
  assert.equal(f.calls.deliver, 1); assert.equal(f.calls.classify, 0);
  assert.match(await fs.readFile(path.join(f.source, 'lesson.txt'), 'utf8'), /project-physics/);
  const stats = (await f.engine.sources()).statistics;
  await f.scan(source.id); assert.deepEqual((await f.engine.sources()).statistics, stats);
});
test('identical same-student project documents reuse a verified receipt but retain two associations', async t => {
  const associations = [];
  const f = await fixture(t, { canReuseReceipt: () => true, registerAssociation: async item => { associations.push(item.id); return { reused: true }; } });
  const source = await f.add({ target }); await f.write('one.txt', '相同 project-physics 内容'); await f.write('two.txt', '相同 project-physics 内容');
  await f.scan(source.id); const delivered = (await f.engine.list({ status: 'delivered' })).rows;
  assert.equal(delivered.length, 2); assert.equal(f.calls.deliver, 1); assert.equal(new Set(associations).size, 2);
  const details = await Promise.all(delivered.map(row => f.engine.detail(row.id)));
  assert.equal(details.filter(item => item.reusedReceiptFrom).length, 1);
});
test('unbound student queues review without extraction or cloud; manual target is validated', async t => {
  const f = await fixture(t); await f.write('lesson.txt'); const source = await f.add({ studentId: '' }); await f.scan(source.id);
  const row = (await f.engine.list()).rows[0]; assert.equal(row.status, 'review'); assert.equal(f.calls.classify, 0); assert.equal(f.calls.extract, 0);
  const result = await f.engine.decide({ requestId: 'choose-student', action: 'correct', items: [{ id: row.id, revision: row.revision, target }] });
  assert.equal(result.results[0].ok, true);
});
test('new shared sources can auto-attribute an explicit project without choosing a student', async t => {
  const f = await fixture(t); await f.write('shared-project.txt');
  const source = await f.add({ studentId: '', autoAttributeShared: true }); await f.scan(source.id);
  const delivered = (await f.engine.list({ status: 'delivered' })).rows[0];
  assert.equal(delivered.target.id, 'project-physics');
  assert.equal(delivered.target.studentId, 'student-a');
  assert.deepEqual(delivered.target.linkedStudentIds, ['student-a', 'student-b']);
  assert.equal(f.calls.classify, 0);
});
test('shared sources use AI topic evidence before falling back to the automatic retry pool', async t => {
  const evidence = '研究摆长与周期之间的关系';
  const f = await fixture(t, { classify: async () => {
    f.calls.classify++;
    return suggestion(evidence);
  } });
  await f.write('shared-topic.txt', `实验主主题是${evidence}，并记录多轮测量、数据对照、误差分析和实验结论，最终形成完整项目研究报告。`);
  const source = await f.add({ studentId: '', autoAttributeShared: true });
  await f.scan(source.id);
  const delivered = (await f.engine.list({ status: 'delivered' })).rows[0];
  assert.equal(delivered.target.id, 'project-physics');
  assert.deepEqual(delivered.target.linkedStudentIds, ['student-a', 'student-b']);
  assert.equal(f.calls.classify, 1);
});
test('unresolved shared material is retried automatically instead of creating an approval task', async t => {
  const f = await fixture(t, { classify: async () => {
    f.calls.classify++;
    return { candidates: [], sensitive: false, conflict: false, reason: '暂无可信项目证据' };
  } });
  await f.write('shared-unknown.txt', '一份暂时无法与现有项目匹配的普通学习资料，保留等待后续上下文。');
  const source = await f.add({ studentId: '', autoAttributeShared: true });
  await f.scan(source.id);
  const row = (await f.engine.list()).rows[0];
  assert.equal(row.status, 'retry');
  assert.match(row.message, /自动暂存池/);
  assert.equal(f.calls.classify, 1);
});
test('source binding applies equally to content with legacy sensitive keywords', async t => {
  const f = await fixture(t); await f.write('private.txt', '身份证 project-physics'); await f.write('conflict.txt', 'project-biology project-physics');
  const s = await f.add({ target }); await f.scan(s.id);
  assert.equal(f.calls.deliver, 2); assert.equal((await f.engine.list()).total, 0);
});
test('vendor sensitive refusal is a manual review with original preserved and no automatic redispatch', async t => {
  let attempts = 0;
  const f = await fixture(t, { classify: async () => {
    attempts++;
    throw Object.assign(Error('敏感内容未获授权'), { code: 'SENSITIVE_REVIEW_REQUIRED', stopConfirmed: true });
  } });
  await f.write('lesson.txt'); const s = await f.add(); await f.scan(s.id);
  assert.equal((await f.engine.list()).rows[0].status, 'review');
  await f.engine.tick(); await f.scan(s.id);
  assert.equal(attempts, 1); assert.equal(f.calls.deliver, 0);
  assert.equal(await fs.readFile(path.join(f.source, 'lesson.txt'), 'utf8'), '教育实验记录：project-physics。');
});

test('source settings cannot cross student or target scope; arbitrary managed paths rejected', async t => {
  const f = await fixture(t);
  await assert.rejects(f.add({ target: { ...target, studentId: 'student-b' } }), /不一致/);
  await assert.rejects(f.add({ folder: f.destination }), /受管/);
  await assert.rejects(f.add({ originalMode: 'archive' }), /中转/);
  const s = await f.add(); await assert.rejects(f.add(), /已经/);
  await f.engine.pause(s.id); assert.equal((await f.engine.sources()).sources[0].enabled, false);
});
test('a source nested above managed folders skips those subtrees and does not recursively import output', async t => {
  const f = await fixture(t); await fs.writeFile(path.join(f.destination, 'not-source.txt'), 'project-physics');
  const s = await f.add({ folder: f.dir, recursive: true, target }); await f.write('lesson.txt'); await f.scan(s.id);
  assert.equal((await f.engine.list({ status: 'delivered' })).total, 1);
});
test('versioned bulk decisions replay once and reject changed requests or stale rows', async t => {
  const f = await fixture(t); await f.write('lesson.txt'); const s = await f.add({ automatic: false }); await f.scan(s.id);
  const row = (await f.engine.list()).rows[0];
  const req = { requestId: 'decision-1', action: 'accept', items: [{ id: row.id, revision: row.revision }] };
  const result = await f.engine.decide(req); assert.equal(result.results[0].ok, true);
  assert.deepEqual(await f.engine.decide(req), result); assert.equal(f.calls.deliver, 1);
  await assert.rejects(f.engine.decide({ ...req, action: 'ignore' }), /不同操作/);
  assert.equal((await f.engine.decide({ ...req, requestId: 'stale' })).results[0].ok, false);
});
test('changed source file is never delivered using a stale recommendation', async t => {
  const f = await fixture(t); await f.write('lesson.txt'); const s = await f.add({ automatic: false }); await f.scan(s.id);
  const row = (await f.engine.list()).rows[0]; await f.write('lesson.txt', '修改后的不同版本');
  const result = await f.engine.decide({ requestId: 'stale-source', action: 'accept', items: [{ id: row.id, revision: row.revision }] });
  assert.equal(result.results[0].ok, false); assert.equal(f.calls.deliver, 0);
});
test('ignore and conditional restore never delete original or invoke classifier', async t => {
  const f = await fixture(t); await f.write('lesson.txt'); const s = await f.add({ studentId: '' }); await f.scan(s.id);
  const row = (await f.engine.list()).rows[0];
  await f.engine.decide({ requestId: 'ignore', action: 'ignore', items: [{ id: row.id, revision: row.revision }] });
  assert.equal((await f.engine.list()).total, 0); assert.equal((await f.engine.list({ status: 'ignored' })).total, 1);
  const result = await f.engine.decide({ requestId: 'restore', action: 'restore', items: [{ id: row.id, revision: row.revision + 1 }] });
  assert.equal(result.results[0].ok, true); await fs.access(path.join(f.source, 'lesson.txt')); assert.equal(f.calls.classify, 0);
});
test('verified staging delivery keeps one managed original and correction reuses it', async t => {
  const f = await fixture(t); await f.write('lesson.txt'); const s = await f.add({ target, staging: true, originalMode: 'archive' });
  await f.scan(s.id); const row = (await f.engine.list({ status: 'delivered' })).rows[0];
  await assert.rejects(fs.access(path.join(f.source, 'lesson.txt'))); await assert.rejects(fs.access(path.join(f.source, '已投递')));
  const stored = await f.engine.detail(row.id); assert.equal(stored.snapshotPath, ''); assert.equal(stored.archivePath, '');
  assert.equal(await f.engine.openOriginal(row.id), stored.receipt.path); await fs.access(stored.receipt.path);
  const corrected = await f.engine.decide({ requestId: 'move-project', action: 'correct', items: [{ id: row.id, revision: row.revision, target: { ...target, id: 'project-biology' } }] });
  assert.equal(corrected.results[0].ok, true, JSON.stringify(corrected)); assert.equal(f.calls.deliver, 2);
});
test('ordinary retained source keeps its original but releases the internal snapshot', async t => {
  const f = await fixture(t); await f.write('keep.txt'); const s = await f.add({ target, staging: false, originalMode: 'keep' });
  await f.scan(s.id); const row = (await f.engine.list({ status: 'delivered' })).rows[0], stored = await f.engine.detail(row.id);
  await fs.access(path.join(f.source, 'keep.txt')); assert.equal(stored.snapshotPath, ''); await fs.access(stored.receipt.path);
});
test('upgrade removes verified historical archive and snapshot duplicates but keeps the registered original', async t => {
  const f = await fixture(t); await f.write('old.txt'); const s = await f.add({ target, staging: true, originalMode: 'archive' }); await f.scan(s.id);
  const row = (await f.engine.list({ status: 'delivered' })).rows[0]; await f.engine.close();
  const file = path.join(f.directory, 'items', `${row.id}.json`), record = JSON.parse(await fs.readFile(file));
  const archiveDir = path.join(f.source, '已投递'), archivePath = path.join(archiveDir, 'old-copy.txt'), snapshotPath = path.join(f.directory, 'snapshots', `${row.id}-old.txt`);
  await fs.mkdir(archiveDir, { recursive: true }); await fs.copyFile(record.receipt.path, archivePath); await fs.copyFile(record.receipt.path, snapshotPath);
  record.archivePath = archivePath; record.snapshotPath = snapshotPath; delete record.storageOptimization;
  await fs.writeFile(file, JSON.stringify(record)); await fs.unlink(path.join(f.directory, 'delivered-copy-cleanup-v4.json'));
  const restored = createSmartInbox(f.host); t.after(() => restored.close()); await restored.init();
  const cleaned = await restored.detail(row.id); assert.equal(cleaned.archivePath, ''); assert.equal(cleaned.snapshotPath, '');
  await assert.rejects(fs.access(archivePath)); await assert.rejects(fs.access(snapshotPath)); await fs.access(cleaned.receipt.path);
  assert.equal(await restored.openOriginal(row.id), cleaned.receipt.path);
});
test('v4 resumes after snapshot removal before metadata commit and preserves verified receipt', async t => {
  const f = await fixture(t); await f.write('v4-interrupted.txt'); const s = await f.add({ target }); await f.scan(s.id);
  const row = (await f.engine.list({ status: 'delivered' })).rows[0]; await f.engine.close();
  const file = path.join(f.directory, 'items', `${row.id}.json`), record = JSON.parse(await fs.readFile(file));
  const snapshot = path.join(f.directory, 'snapshots', `${row.id}-old.txt`);
  await fs.copyFile(record.receipt.path, snapshot); record.snapshotPath = snapshot; delete record.storageOptimization;
  const originalBytes = Buffer.from(JSON.stringify(record)); await fs.writeFile(file, originalBytes);
  const backupDir = path.join(f.directory, 'migration-backup-storage-v4'); await fs.mkdir(backupDir, { recursive: true });
  await fs.writeFile(path.join(backupDir, `${row.id}.json`), originalBytes);
  await fs.unlink(snapshot); await fs.unlink(path.join(f.directory, 'delivered-copy-cleanup-v4.json'));
  const resumed = createSmartInbox(f.host); t.after(() => resumed.close()); await resumed.init();
  const item = await resumed.detail(row.id); assert.equal(item.snapshotPath, '');
  assert.equal(item.receipt.path, record.receipt.path); await fs.access(item.receipt.path);
  assert.deepEqual(await fs.readFile(path.join(backupDir, `${row.id}.json`)), originalBytes);
  assert.equal(f.calls.deliver, 1);
});
test('v4 skips cleanup when receipt bytes change and retains the historical snapshot', async t => {
  const f = await fixture(t); await f.write('v4-mismatch.txt'); const s = await f.add({ target }); await f.scan(s.id);
  const row = (await f.engine.list({ status: 'delivered' })).rows[0]; await f.engine.close();
  const file = path.join(f.directory, 'items', `${row.id}.json`), record = JSON.parse(await fs.readFile(file));
  const snapshot = path.join(f.directory, 'snapshots', `${row.id}-old.txt`); await fs.copyFile(record.receipt.path, snapshot);
  record.snapshotPath = snapshot; await fs.writeFile(file, JSON.stringify(record));
  await fs.writeFile(record.receipt.path, 'changed synthetic destination');
  await fs.unlink(path.join(f.directory, 'delivered-copy-cleanup-v4.json'));
  const resumed = createSmartInbox(f.host); t.after(() => resumed.close()); await resumed.init();
  assert.equal((await resumed.detail(row.id)).snapshotPath, snapshot); await fs.access(snapshot);
  const marker = JSON.parse(await fs.readFile(path.join(f.directory, 'delivered-copy-cleanup-v4.json')));
  assert.equal(marker.skipped, 1); assert.equal(marker.cleaned, 0); assert.equal(f.calls.deliver, 1);
});
test('interrupted model executions are quarantined and cannot be retried or forcibly delivered', async t => {
  const f = await fixture(t, { classify: async () => { throw Object.assign(Error('执行状态未知'), { code: 'execution_unknown' }); } });
  await f.write('lesson.txt'); const s = await f.add(); await f.scan(s.id);
  const row = (await f.engine.list()).rows[0]; assert.equal(row.status, 'execution_unknown');
  for (const action of ['retry', 'correct', 'reconcile']) assert.equal((await f.engine.decide({ requestId: action, action, items: [{ id: row.id, revision: row.revision, target }] })).results[0].ok, false);
  await f.scan(s.id); assert.equal(f.calls.deliver, 0);
});

test('exhausted unknown execution is not reconciled or rewritten by a normal source scan', async t => {
  let reconcileCalls = 0;
  const f = await fixture(t, {
    classify: async () => { throw Object.assign(Error('execution may have been sent'), { code: 'execution_unknown' }); },
    reconcile: async () => { reconcileCalls++; return null; },
  });
  await f.write('unknown-exhausted.txt'); const source = await f.add(); await f.scan(source.id);
  const row = (await f.engine.list()).rows[0];
  await f.engine.close();
  const itemFile = path.join(f.directory, 'items', `${row.id}.json`);
  const exhausted = JSON.parse(await fs.readFile(itemFile, 'utf8'));
  Object.assign(exhausted, { reconcileAttempts: 3, nextReconcileAt: '', message: '自动核对已暂停，请人工核对。' });
  await fs.writeFile(itemFile, JSON.stringify(exhausted));
  const before = await fs.readFile(itemFile, 'utf8');
  const restored = createSmartInbox(f.host); t.after(() => restored.close()); await restored.init();
  await restored.requestScan(source.id); await restored.tick();
  assert.equal(reconcileCalls, 0);
  assert.equal(await fs.readFile(itemFile, 'utf8'), before);
});

test('exhausted unknown execution can be audit-archived without deleting evidence', async t => {
  const f = await fixture(t, { classify: async () => { throw Object.assign(Error('unknown'), { code: 'execution_unknown' }); } });
  await f.write('unknown-archive.txt'); const source = await f.add(); await f.scan(source.id);
  const row = (await f.engine.list()).rows[0]; const original = await f.engine.detail(row.id);
  await f.engine.close();
  const itemFile = path.join(f.directory, 'items', `${row.id}.json`), record = JSON.parse(await fs.readFile(itemFile, 'utf8'));
  Object.assign(record, { reconcileAttempts: 3, nextReconcileAt: '' }); await fs.writeFile(itemFile, JSON.stringify(record));
  const restored = createSmartInbox(f.host); t.after(() => restored.close()); await restored.init();
  const current = await restored.detail(row.id);
  const result = await restored.decide({ requestId: 'archive-exhausted', action: 'archive_unknown', items: [{ id: row.id, revision: current.revision }] });
  assert.equal(result.results[0].ok, true);
  assert.equal((await restored.list()).total, 0);
  const archived = await restored.detail(row.id);
  assert.equal(archived.status, 'ignored');
  assert.equal(archived.unknownResolution.disposition, 'abandoned');
  assert.equal(archived.unknownResolution.executionId, original.executionId);
  assert.equal(archived.executionId, original.executionId);
  await fs.access(archived.snapshotPath);
});

test('explicit unknown restart preserves the old execution audit and creates a new execution id', async t => {
  let calls = 0;
  const f = await fixture(t, { classify: async input => {
    calls++;
    if (calls === 1) throw Object.assign(Error('unknown'), { code: 'execution_unknown' });
    await input.onResult(suggestion()); return suggestion();
  } });
  await f.write('unknown-restart.txt'); const source = await f.add(); await f.scan(source.id);
  const row = (await f.engine.list()).rows[0], oldExecutionId = (await f.engine.detail(row.id)).executionId;
  await f.engine.close();
  const itemFile = path.join(f.directory, 'items', `${row.id}.json`), record = JSON.parse(await fs.readFile(itemFile, 'utf8'));
  Object.assign(record, { reconcileAttempts: 3, nextReconcileAt: '' }); await fs.writeFile(itemFile, JSON.stringify(record));
  const restored = createSmartInbox(f.host); t.after(() => restored.close()); await restored.init();
  const current = await restored.detail(row.id);
  const result = await restored.decide({ requestId: 'restart-exhausted', action: 'restart_unknown', items: [{ id: row.id, revision: current.revision }] });
  assert.equal(result.results[0].ok, true);
  await restored.tick();
  const completed = await restored.detail(row.id);
  assert.notEqual(completed.executionId, oldExecutionId);
  assert.equal(completed.executionHistory.at(-1).executionId, oldExecutionId);
  assert.equal(completed.executionHistory.at(-1).resolution, 'user_requested_new_execution');
  assert.equal(completed.status, 'delivered');
});
test('failed delivery without a receipt never reimports blindly; receipt reconciliation completes once', async t => {
  let receipt;
  const f = await fixture(t, { deliver: async (snapshot, _, item) => { const file = path.join(path.dirname(snapshot), 'registered.txt'); await fs.copyFile(snapshot, file); receipt = { ok: true, path: file, recordId: 'registered' }; throw Error('回执返回前中断'); }, reconcile: async () => receipt });
  await f.write('lesson.txt'); const s = await f.add({ target }); await f.scan(s.id);
  const row = (await f.engine.list()).rows[0]; assert.equal(row.status, 'delivery_reconcile');
  const result = await f.engine.decide({ requestId: 'reconcile', action: 'reconcile', items: [{ id: row.id, revision: row.revision }] });
  assert.equal(result.results[0].ok, true); assert.equal((await f.engine.list({ status: 'delivered' })).total, 1);
});
test('migration is idempotent and never enables automation or changes original settings', async t => {
  const f = await fixture(t); await f.engine.bootstrap({ legacy: { folder: f.source, schema: 'DownloadInboxSettings.v1' }, students: [{ id: 'student-a', name: '测试学生' }] });
  await f.engine.bootstrap({ legacy: { folder: f.source }, students: [{ id: 'student-a', name: '测试学生' }] });
  const state = await f.engine.sources(); assert.equal(state.sources.length, 4); assert.ok(state.sources.every(s => !s.enabled && !s.automatic));
  await fs.access(path.join(f.directory, 'legacy-settings-backup.json')); assert.equal(f.calls.extract, 0);
});
test('v1 bootstrap resumes after legacy-settings backup and never enables the migrated source', async t => {
  const f = await fixture(t); const legacy = { folder: f.source, enabled: true, automatic: true, synthetic: 'legacy-original' };
  const backup = path.join(f.directory, 'legacy-settings-backup.json');
  await fs.writeFile(backup, JSON.stringify(legacy));
  await f.engine.bootstrap({ legacy, students: [] });
  let sources = (await f.engine.sources()).sources.filter(item => item.id === 'legacy-download');
  assert.equal(sources.length, 1); assert.equal(sources[0].enabled, false); assert.equal(sources[0].automatic, false);
  assert.deepEqual(JSON.parse(await fs.readFile(backup)), legacy);
  await f.engine.bootstrap({ legacy, students: [] });
  sources = (await f.engine.sources()).sources.filter(item => item.id === 'legacy-download');
  assert.equal(sources.length, 1); assert.equal(f.calls.classify + f.calls.deliver, 0);
});
test('late folder permission failure affects its source and retains readable paginated state', async t => {
  const f = await fixture(t); const s = await f.add(); await fs.rename(f.source, f.source + '-gone'); await f.scan(s.id);
  assert.match((await f.engine.sources()).sources[0].error, /ENOENT/); assert.equal((await f.engine.list()).total, 0);
});
test('repeated acceptance of a single file cannot create an automatic learned rule', async t => {
  const f = await fixture(t); await f.write('lesson.txt'); const s = await f.add({ automatic: false }); await f.scan(s.id);
  for (let n = 0; n < 3; n++) { const row = (await f.engine.list({ status: n ? 'delivered' : 'pending' })).rows[0];
    assert.equal((await f.engine.decide({ requestId: `accept-${n}`, action: 'accept', items: [{ id: row.id, revision: row.revision }] })).results[0].ok, true); }
  const files = await fs.readdir(path.join(f.directory, 'rules')); const rule = JSON.parse(await fs.readFile(path.join(f.directory, 'rules', files[0]), 'utf8'));
  assert.equal(rule.count, 1); assert.equal(rule.active, false);
});
test('three distinct confirmations learn a scoped exact rule; correction disables it immediately', async t => {
  const f = await fixture(t); const s = await f.add({ automatic: false });
  for (let n = 0; n < 3; n++) { await f.write(`${n}.txt`, `project-physics 第${n}次实验`); await f.scan(s.id);
    const row = (await f.engine.list()).rows[0]; await f.engine.decide({ requestId: `accept-${n}`, action: 'accept', items: [{ id: row.id, revision: row.revision }] }); }
  const files = await fs.readdir(path.join(f.directory, 'rules')), file = path.join(f.directory, 'rules', files[0]);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).active, true);
  const row = (await f.engine.list({ status: 'delivered' })).rows[0]; await f.engine.decide({ requestId: 'correct', action: 'correct', items: [{ id: row.id, revision: row.revision, target: { ...target, id: 'project-biology' } }] });
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).active, false);
});

test('existing importer sees the durable checkpoint on its operation object', async t => {
  const f = await fixture(t, { deliver: async (snapshot, _, operation, checkpoint) => {
    await checkpoint({ destinationPath: path.join(f.destination, 'registered.txt') });
    assert.equal(operation.destinationPath, path.join(f.destination, 'registered.txt'));
    await fs.copyFile(snapshot, operation.destinationPath);
    return { ok: true, recordId: 'existing-importer', path: operation.destinationPath };
  } });
  await f.write('lesson.txt'); const s = await f.add({ target }); await f.scan(s.id);
  assert.equal((await f.engine.list({ status: 'delivered' })).total, 1);
});

test('unavailable legacy folder is retained disabled without blocking other sources', async t => {
  const f = await fixture(t);
  await f.engine.bootstrap({ legacy: { folder: path.join(f.dir, 'missing') }, students: [{ id: 'student-a', name: '测试' }] });
  const state = await f.engine.sources(); assert.equal(state.sources.length, 4); assert.equal(state.error, '');
  assert.match(state.sources.find(s => s.id === 'legacy-download').error, /暂不可用/);
  const s = await f.add({ target }); await f.write('lesson.txt'); await f.scan(s.id);
  assert.equal((await f.engine.list({ status: 'delivered' })).total, 1);
});

test('manual queue resumes after resource denial while scheduled automation remains paused', async t => {
  let permitted = false, batches = 0;
  const f = await fixture(t, { automaticAllowed: () => false, acquire: () => permitted ? () => {} : null, beginBatch: () => ++batches });
  const s = await f.add({ target }); await f.write('lesson.txt'); await f.scan(s.id);
  assert.equal(f.calls.extract, 0); assert.equal(f.engine.hasPendingWork(), true);
  permitted = true; await f.engine.tick();
  assert.equal(batches, 1); assert.equal((await f.engine.list()).rows[0].status, 'review');
  assert.equal(f.calls.deliver, 0); assert.equal(f.engine.hasPendingWork(), false);
});

test('restart reconciles in-flight records without dispatching a new execution', async t => {
  const f = await fixture(t); await f.write('lesson.txt'); const s = await f.add({ automatic: false }); await f.scan(s.id);
  const row = (await f.engine.list()).rows[0], file = path.join(f.directory, 'items', row.id + '.json');
  const stored = JSON.parse(await fs.readFile(file, 'utf8')); stored.status = 'analyzing';
  await fs.writeFile(file, JSON.stringify(stored));
  const recovered = createSmartInbox(f.host); t.after(() => recovered.close()); await recovered.recover();
  await recovered.tick(); assert.equal((await recovered.list()).rows[0].status, 'review');
  assert.equal(f.calls.classify, 1);
});

test('interrupted association withdrawal is reconciled before another reroute, without recopying', async t => {
  let fail = true, withdrawals = 0;
  const f = await fixture(t, { correctAssociation: async () => {
    withdrawals++; if (fail) throw Error('association projection interrupted');
    return { status: 'retained', retained: true, reasons: ['knowledge_reference'] };
  } });
  await f.write('lesson.txt'); const s = await f.add({ target }); await f.scan(s.id);
  const first = (await f.engine.list({ status: 'delivered' })).rows[0];
  const moved = await f.engine.decide({ requestId: 'move', action: 'correct', items: [{ id: first.id, revision: first.revision, target: { ...target, id: 'project-biology' } }] });
  assert.equal(moved.results[0].ok, false, JSON.stringify(moved)); assert.equal(f.calls.deliver, 2, JSON.stringify(moved));
  const pending = (await f.engine.list()).rows[0]; assert.equal(pending.status, 'archive_pending');
  const blocked = await f.engine.decide({ requestId: 'another-move', action: 'correct', items: [{ id: pending.id, revision: pending.revision, target }] });
  assert.equal(blocked.results[0].ok, false); assert.equal(f.calls.deliver, 2);
  fail = false;
  const reconciled = await f.engine.decide({ requestId: 'resume', action: 'reconcile', items: [{ id: pending.id, revision: pending.revision }] });
  assert.equal(reconciled.results[0].ok, true); assert.equal(f.calls.deliver, 2); assert.equal(withdrawals, 2);
  const final = (await f.engine.list({ status: 'delivered' })).rows[0]; assert.match(final.reason, /保留/);
});
