const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { hashStableFile } = require('../electron/project-materials.cjs');
const { createInboxCleanup } = require('../electron/smart-inbox-cleanup.cjs');
const { assessContent, readableContent, quoteExists, parseRoutingResult } = require('../electron/smart-inbox-content.cjs');
const P = require('../electron/smart-inbox-policy.cjs');
const internal = JSON.stringify({ schema: 'edu-manager.agent-conversation-submission.v1', messages: [
  { role: 'user', content: 'This is an app-generated request for a suggested next user message.' }] });
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-cleanup-r7-')), items = new Map(), sources = new Map([['source', { id: 'source', enabled: true }]]);
  let time = Date.now();
  for (const dir of ['snapshots', 'extractions']) await fs.mkdir(path.join(root, dir));
  const cleanup = createInboxCleanup({ root, items, sources, save: async (_, item) => { items.set(item.id, structuredClone(item)); return item; },
    now: () => time, withItemLock: (_, work) => work(), host: { automaticAllowed: () => true, acquire: async () => () => {} }, verifyOriginal: async () => {} });
  await cleanup.init();
  t.after(async () => { assert.equal(path.dirname(root), await fs.realpath(os.tmpdir())); assert.ok(path.basename(root).startsWith('edu-cleanup-r7-')); await fs.rm(root, { recursive: true, force: true }); });
  async function add(id = 'a', text = internal) {
    const dir = path.join(root, 'snapshots', id); await fs.mkdir(dir);
    const file = path.join(dir, 'note.md'); await fs.writeFile(file, text);
    const item = { id, sourceId: 'source', studentId: 's', sourceType: 'session', revision: 1, name: 'note.md',
      status: 'review', snapshotPath: file, fingerprint: await hashStableFile(file) };
    items.set(id, item); return cleanup.recycle(item, 'internal_task');
  }
  return { root, items, sources, cleanup, add, advance: days => { time += days * 86400000; } };
}
test('shared local policy preserves mixed requests, reports, images and failed extraction', () => {
  assert.equal(assessContent({ text: internal, name: 'a.md' }).action, 'recycle');
  assert.equal(assessContent({ text: internal, name: 'a.md', blocked: true }).action, 'recover');
  const mixed = JSON.parse(internal); mixed.messages.push({ role: 'user', content: '请生成学习报告并保存成果。' });
  assert.equal(assessContent({ text: JSON.stringify(mixed), name: 'a.md' }).action, 'classify');
  assert.equal(assessContent({ text: '', name: 'scan.pdf', size: 123 }).action, 'recover');
  assert.equal(assessContent({ text: '', name: 'scan.jpg', size: 123 }).action, 'recover');
  assert.equal(assessContent({ text: ' \n\t', name: 'empty.txt', size: 3 }).reason, 'empty_content');
  assert.equal(assessContent({ text: '', name: 'empty.bin', size: 0 }).reason, 'empty_content');
  assert.equal(assessContent({ text: '没有匹配项目的真实记录', name: 'a.md' }).action, 'classify');
});
test('decoded multiline quotes remain grounded to individual source messages', () => {
  const raw = JSON.stringify({ schema: 'edu-manager.agent-conversation-submission.v1', messages: [{ role: 'user', content: '学生：甲\n实验“记录”' }] });
  assert.equal(quoteExists(raw, '学生：甲\n实验“记录”'), true);
  assert.equal(quoteExists(raw, '伪造的证据'), false);
  assert.equal(quoteExists(raw, '[user]\n学生：甲'), false);
  assert.ok(readableContent(raw).text.includes('学生：甲\n实验“记录”'));
  assert.deepEqual(parseRoutingResult('```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => parseRoutingResult('抱歉，无法处理'), { code: 'ROUTING_JSON_INVALID' });
});
test('typed validation accepts grounded quotes but rejects invented and foreign subjects', () => {
  const raw = JSON.stringify({ schema: 'edu-manager.agent-conversation-submission.v1', messages: [{ role: 'user', content: '第一行\n第二行' }] });
  const value = { candidates: [], conflict: false, sensitive: false, reason: '', assessment: { kind: 'unknown', studentId: '', evidence: '第一行\n第二行',
    subjectEvidence: '', score: .5, tags: [], checkedProjectIds: [], competingProjectIds: [] } };
  assert.ok(P.validateSuggestion(value, { studentId: 's', projects: [] }, raw));
  assert.throws(() => P.validateSuggestion({ ...value, assessment: { ...value.assessment, studentId: 'foreign' } }, { studentId: 's', projects: [] }, raw), { code: 'ROUTING_STUDENT_SCOPE' });
  assert.throws(() => P.validateSuggestion({ ...value, assessment: { ...value.assessment, evidence: 'invented' } }, { studentId: 's', projects: [] }, raw), { code: 'ROUTING_QUOTE_MISMATCH' });
});

test('legacy captured probes require exact templates and mixed requests remain substantive', () => {
  const wrap = messages => JSON.stringify({ schema: 'edu-manager.agent-conversation-submission.v1', messages });
  const user = { role: 'user', content: 'Windows 学生端会话采集验收提问 WINCAP-WORKBUDDY-20261115-1123' };
  assert.equal(assessContent({ text: wrap([user]), sourceType: 'session', name: 'a.md' }).reason, 'capture_probe');
  assert.equal(assessContent({ text: wrap([user, { role: 'user', content: '请分析学生报告。' }]), sourceType: 'session', name: 'a.md' }).action, 'classify');
  assert.equal(assessContent({ text: wrap([user]), sourceType: 'folder', name: 'a.md' }).action, 'classify');
});

test('non-authorizing subject commentary is discarded without weakening candidate evidence', () => {
  const value = { candidates: [], sensitive: false, conflict: false, reason: '', assessment: { kind: 'internal', studentId: '',
    evidence: '原始正文内容', subjectEvidence: '正文没有主体，因此我无法判断。', tags: [], score: .99, checkedProjectIds: [], competingProjectIds: [] } };
  const context = { studentId: 's', projects: [] };
  assert.equal(P.validateSuggestion(value, context, '原始正文内容').assessment.subjectEvidence, '');
  assert.throws(() => P.validateSuggestion({ ...value, assessment: { ...value.assessment, studentId: 's' } }, context, '原始正文内容'), { code: 'ROUTING_QUOTE_MISMATCH' });
  assert.throws(() => P.validateSuggestion({ ...value, assessment: { ...value.assessment, evidence: '不存在的正文' } }, context, '原始正文内容'), { code: 'ROUTING_QUOTE_MISMATCH' });
});
test('30 day cleanup removes only verified managed copies and is idempotent', async t => {
  const f = await fixture(t), item = await f.add();
  const original = path.join(f.root, 'user-original.md'); await fs.writeFile(original, internal);
  await f.cleanup.sweep(); await fs.access(item.snapshotPath);
  f.advance(29); await f.cleanup.sweep(); await fs.access(item.snapshotPath);
  f.advance(1); await f.cleanup.sweep(); await assert.rejects(fs.access(item.snapshotPath)); await fs.access(original);
  const after = f.items.get(item.id); assert.equal(after.cleanup.stage, 'purged'); assert.ok(after.cleanup.releasedBytes > 0);
  f.advance(1); await f.cleanup.sweep(); assert.equal(f.items.get(item.id).cleanup.releasedBytes, after.cleanup.releasedBytes);
});
test('restore cancels purge and marks content retained', async t => {
  const f = await fixture(t), item = await f.add(); await f.cleanup.restore({ id: item.id, revision: item.revision });
  f.advance(31); await f.cleanup.sweep(); await fs.access(item.snapshotPath);
  assert.equal(f.items.get(item.id).manualLocked, true); assert.equal(f.items.get(item.id).cleanup.stage, 'restored');
});
test('changed bytes, manual locks, unknown execution and expired switches retain copies', async t => {
  const f = await fixture(t);
  const changed = await f.add('changed'), locked = await f.add('locked'), unknown = await f.add('unknown');
  await fs.writeFile(changed.snapshotPath, '真实内容');
  f.items.set(locked.id, { ...locked, manualLocked: true });
  f.items.set(unknown.id, { ...unknown, execution: { stage: 'possibly_sent' } });
  f.advance(31); await f.cleanup.sweep();
  for (const item of [changed, locked, unknown]) await fs.access(item.snapshotPath);
  const disabled = await f.add('disabled'); await f.cleanup.update({ expirationCleanup: false });
  f.advance(31); await f.cleanup.sweep(); await fs.access(disabled.snapshotPath);
});
test('shared extraction caches survive while another record references them', async t => {
  const f = await fixture(t), item = await f.add();
  const cache = path.join(f.root, 'extractions', `${'a'.repeat(64)}.json`);
  await fs.writeFile(cache, JSON.stringify({ sha256: item.fingerprint.sha256, studentId: 's', result: { text: internal } }));
  f.items.set('other', { id: 'other', status: 'review', studentId: 's', fingerprint: item.fingerprint });
  f.advance(31); await f.cleanup.sweep(); await fs.access(cache);
});
test('cleanup refuses paths outside its item-owned snapshot directory', async t => {
  const f = await fixture(t), item = await f.add(), original = path.join(f.root, 'original.md');
  await fs.writeFile(original, internal); f.items.set(item.id, { ...item, snapshotPath: original });
  f.advance(31); await f.cleanup.sweep(); await fs.access(original);
  assert.match(f.items.get(item.id).cleanup.lastError, /超出/);
});
test('restart resumes an unlink-before-commit journal without deleting a user original', async t => {
  const f = await fixture(t), item = await f.add();
  await fs.writeFile(path.join(f.root, 'cleanup-journal', 'a.json'), JSON.stringify({ id: 'a', files: [{ file: item.snapshotPath, kind: 'snapshot', state: 'prepared', bytes: item.fingerprint.size }] }));
  await fs.unlink(item.snapshotPath); f.advance(31); await f.cleanup.sweep();
  assert.equal(f.items.get('a').cleanup.stage, 'purged'); assert.equal(f.items.get('a').snapshotPath, '');
});

test('one cleanup round releases at most twenty items', async t => {
  const f = await fixture(t); for (let n = 0; n < 21; n++) await f.add(`item-${n}`);
  f.advance(31); await f.cleanup.sweep();
  assert.equal([...f.items.values()].filter(i => i.cleanup.stage === 'purged').length, 20);
  f.advance(1); await f.cleanup.sweep();
  assert.equal([...f.items.values()].filter(i => i.cleanup.stage === 'purged').length, 21);
});

test('directory links cannot redirect cleanup into user originals', async t => {
  const f = await fixture(t), item = await f.add();
  const outside = path.join(f.root, 'user-files'); await fs.mkdir(outside);
  const file = path.join(outside, 'original.md'); await fs.writeFile(file, internal);
  const link = path.join(f.root, 'snapshots', 'linked'); await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  f.items.set(item.id, { ...item, snapshotPath: path.join(link, 'original.md') });
  f.advance(31); await f.cleanup.sweep(); await fs.access(file);
  assert.ok(f.items.get(item.id).cleanup.lastError);
});

test('one sweep stays within five MiB and resumes remaining shared-cache work', async t => {
  const f = await fixture(t), item = await f.add();
  for (const letter of ['a', 'b', 'c']) await fs.writeFile(path.join(f.root, 'extractions', `${letter.repeat(64)}.json`),
    JSON.stringify({ sha256: item.fingerprint.sha256, studentId: 's', result: { text: 'x'.repeat(2 * 1024 * 1024 - 200) } }));
  f.advance(31); await f.cleanup.sweep();
  assert.ok(f.items.get('a').cleanup.releasedBytes <= 5 * 1024 * 1024);
  assert.equal((await fs.readdir(path.join(f.root, 'extractions'))).length, 1);
  assert.equal(f.items.get('a').cleanup.stage, 'recycled');
  f.advance(1); await f.cleanup.sweep();
  assert.equal(f.items.get('a').cleanup.stage, 'purged');
});
