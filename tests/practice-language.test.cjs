'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { checkedLanguageProfile, resolveLanguagePolicy } = require('../electron/practice-language.cjs');
const { createPracticeCards } = require('../electron/practice-cards.cjs');
const { practiceCardHtml } = require('../electron/practice-card-export.cjs');
const vm = require('node:vm');
const hostSource = require('node:fs').readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function hostFixture() {
  const state = { students: [{ id: 'a', name: '测试甲', languageProfile: { primaryLanguage: 'en', supportLanguage: 'zh-CN' } }], writes: 0 };
  const context = vm.createContext({ path, checkedLanguageProfile, studentActivity: require('../electron/student-automation-policy.cjs').studentActivity, sanitizeName: value => String(value), isKnownAgentSource: () => true, isActiveAgentTool: () => true,
    getStudentRootDir: name => path.join(os.tmpdir(), 'qa-no-write', name), getRawDir: name => name + '/raw', getSummaryDir: name => name + '/summary', normalizeMaterialSources: value => value || [],
    readStudentsIndex: () => state.students, ensureStudentLoginIds: students => ({ students }), assertStudentCapacity: () => {}, isDeepStrictEqual: require('node:util').isDeepStrictEqual,
    writeStudentsIndex: students => { state.students = JSON.parse(JSON.stringify(students)); state.writes++; }, readDevices: () => [], migrateTerminalDevices: () => ({ changed: false }), writeDevices: () => { throw Error('不得改动设备'); } });
  vm.runInContext(hostSource.slice(hostSource.indexOf('function toHostStudent(student)'), hostSource.indexOf('let planningGuidanceServiceInstance')), context);
  return { state, sync: value => JSON.parse(context.syncStudentsIndex(JSON.stringify(value))) };
}
test('real Windows student normalization preserves language preferences for older callers and validates explicit edits atomically', () => {
  const { state, sync } = hostFixture();
  assert.equal(sync([{ id: 'a', name: '测试甲', goal: '更新目标' }]).ok, true);
  assert.deepEqual(state.students[0].languageProfile, { primaryLanguage: 'en', supportLanguage: 'zh-CN' });
  state.students[0].activityStatus='paused';state.students[0].pauseAutomaticTasksWhenInactive=false;
  assert.equal(sync([{id:'a',name:'测试甲',goal:'旧客户端更新'}]).ok,true);
  assert.equal(state.students[0].activityStatus,'paused');assert.equal(state.students[0].pauseAutomaticTasksWhenInactive,false);
  assert.equal(sync([{ id: 'a', name: '测试甲', languageProfile: { primaryLanguage: 'zh-CN', supportLanguage: 'zh-CN' } }]).ok, true);
  assert.deepEqual(state.students[0].languageProfile, { primaryLanguage: 'zh-CN', supportLanguage: '' });
  const before = JSON.stringify(state.students), writes = state.writes;
  assert.equal(sync([{ id: 'a', name: '测试甲', languageProfile: { primaryLanguage: 'fr', supportLanguage: '' } }]).ok, false);
  assert.equal(JSON.stringify(state.students), before); assert.equal(state.writes, writes);
  assert.equal(sync([{ id: 'a', name: '测试甲', languageProfile: { primaryLanguage: '', supportLanguage: '' } }]).ok, true);
  assert.deepEqual(state.students[0].languageProfile, { primaryLanguage: '', supportLanguage: '' });
});
test('language preference edits leave the actual shared planning evidence fingerprint unchanged', () => {
  const { createPlanningGuidanceService } = require('../electron/planning-guidance.cjs');
  const student = { id: 'a', grade: '八年级', goal: '方程练习', languageProfile: { primaryLanguage: 'en', supportLanguage: '' } };
  const service = createPlanningGuidanceService({ now: () => new Date('2026-10-05T08:00:00Z'), resolveStudent: () => student, listStudents: () => [student], listProjects: () => [], resolveStudentDir: () => os.tmpdir(), evidenceProvider: () => ({ learningSignals: ['正式学习证据'], sourceIds: ['report:a'] }) });
  const initial = service.evidenceSnapshot(student).inputFingerprint;
  student.languageProfile = { primaryLanguage: 'zh-CN', supportLanguage: 'en' };
  assert.equal(service.evidenceSnapshot(student).inputFingerprint, initial);
});
const plan = { subject: '数学', range: 'week', minutes: 10, template: 'clear', focus: '方程', autoEnabled: false };
async function fixture(work) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'practice-language-'));
  const state = { profiles: { a: { primaryLanguage: 'en', supportLanguage: 'zh-CN' }, b: { primaryLanguage: 'zh-CN', supportLanguage: '' } }, calls: [], languagePassed: true, duringReview: null, subject: '数学' };
  const api = createPracticeCards({ resolveStudentDir: async id => { if (!['a', 'b'].includes(id)) throw Error('学生无效'); return path.join(root, id); },
    readLanguageProfile: async id => state.profiles[id],
    snapshot: async id => ({ languageProfile: state.profiles[id], profile: { grade: '八年级', currentRegion: '美国' }, inputFingerprint: 'unchanged-evidence', learningSignals: ['已发布：方程复习'], confirmedGrowthSignals: [], sourceIds: [`report:${id}`] }),
    generate: async request => {
      state.calls.push(request);
      if (request.schema.required.includes('passed')) { await state.duringReview?.(); return { passed: true, languagePassed: state.languagePassed, reason: state.languagePassed ? '内容和语言符合要求' : '题目语言不符合' }; }
      const english = request.input.languagePolicy.instructionLanguage === 'en';
      return { subject: state.subject, title: english ? 'Equation practice' : '方程练习', knowledgePoint: english ? 'Linear equations' : '一次方程', rationale: english ? 'Review the recorded practice goal.' : '复习有依据的知识点', minutes: 10, sourceRefs: ['E0'], prompt: english ? 'Solve 2x + 3 = 7.' : '解方程 2x + 3 = 7。', hint: english ? 'Subtract 3. 移项' : '两边减3', answer: 'x = 2', explanation: english ? 'Subtract 3, then divide by 2.' : '两边减3再除以2' };
    },
  });
  try { await api.savePlan('a', plan); await api.savePlan('b', plan); await work(api, state, root); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}
test('minimal profiles validate codes, collapse identical languages and never infer from region', () => {
  assert.equal(checkedLanguageProfile(undefined), undefined);
  assert.deepEqual(checkedLanguageProfile({ primaryLanguage: 'en', supportLanguage: 'en' }), { primaryLanguage: 'en', supportLanguage: '' });
  for (const value of [{ primaryLanguage: 'fr' }, { supportLanguage: 'en' }, { primaryLanguage: '<script>' }, 'en', []]) assert.throws(() => checkedLanguageProfile(value));
  const old = resolveLanguagePolicy(undefined, '数学');
  assert.equal(old.instructionLanguage, 'zh-CN'); assert.equal(old.resolvedFrom, 'legacy_default');
  const explicit = resolveLanguagePolicy({ primaryLanguage: 'en', supportLanguage: 'zh-CN' }, '英语');
  assert.equal(explicit.targetLanguage, 'en');
  const previous = resolveLanguagePolicy(undefined, '语文', explicit);
  assert.equal(previous.instructionLanguage, 'en'); assert.equal(previous.targetLanguage, 'zh-CN'); assert.equal(previous.resolvedFrom, 'previous_card');
});
test('generation and its second review receive the same language contract, isolated per student', async () => fixture(async (api, state) => {
  const [a, duplicate] = await Promise.all([api.generate('a'), api.generate('a')]);
  assert.equal(a.card.id, duplicate.card.id); assert.equal(state.calls.length, 2);
  assert.equal(a.card.languagePolicy.instructionLanguage, 'en'); assert.equal(a.card.languagePolicy.supportLanguage, 'zh-CN');
  assert.match(state.calls[0].instruction, /禁止逐行复制/);
  assert.match(state.calls[1].instruction, /languagePassed=false/);
  assert.equal(state.calls[1].input.languagePolicy.instructionLanguage, 'en');
  assert.equal(a.card.content.answer, undefined);
  assert.equal((await api.generate('b')).card.languagePolicy.instructionLanguage, 'zh-CN');
  await assert.rejects(api.exportCard('b', a.card.id));
}));
test('language changes supersede only unstarted cards and toggling back creates a usable version', async () => fixture(async (api, state) => {
  const first = (await api.generate('a')).card;
  state.profiles.a = { primaryLanguage: 'zh-CN', supportLanguage: '' };
  const second = (await api.generate('a')).card;
  assert.notEqual(first.id, second.id); assert.equal((await api.dashboard('a')).current.id, second.id);
  assert.equal((await api.dashboard('a')).history.find(card => card.id === first.id).status, 'superseded');
  state.profiles.a = { primaryLanguage: 'en', supportLanguage: 'zh-CN' };
  const third = (await api.generate('a')).card;
  assert.notEqual(third.id, first.id); assert.equal(third.status, 'ready');
  await api.start('a', third.id);
  state.profiles.a = { primaryLanguage: 'zh-CN', supportLanguage: '' };
  await api.generate('a');
  const dashboard = await api.dashboard('a');
  assert.equal(dashboard.current.id, third.id); assert.equal(dashboard.current.languagePolicy.instructionLanguage, 'en');
  assert.equal(dashboard.languagePolicy.instructionLanguage, 'zh-CN');
}));
test('language change during generation rejects stale output without replacing the valid card', async () => fixture(async (api, state) => {
  const first = (await api.generate('a')).card;
  state.profiles.a = { primaryLanguage: 'zh-CN', supportLanguage: '' };
  state.duringReview = () => { state.profiles.a = { primaryLanguage: 'en', supportLanguage: '' }; };
  await assert.rejects(api.generate('a'), /学习语言已变化/);
  assert.equal((await api.dashboard('a')).history.length, 1);
  assert.equal((await api.dashboard('a')).current.id, first.id);
}));
test('language review failure preserves previous card; missing language review cannot pass', async () => fixture(async (api, state) => {
  const first = (await api.generate('a')).card;
  state.profiles.a = { primaryLanguage: 'zh-CN', supportLanguage: '' };
  state.languagePassed = false;
  await assert.rejects(api.generate('a'), /复核未通过/);
  state.languagePassed = undefined;
  await assert.rejects(api.generate('a'), /复核未通过/);
  assert.equal((await api.dashboard('a')).current.id, first.id);
}));
test('automatic subject resolves English target while preserving Chinese instructions', async () => fixture(async (api, state) => {
  state.subject = '英语'; state.profiles.a = { primaryLanguage: 'zh-CN', supportLanguage: '' };
  await api.savePlan('a', { ...plan, subject: '自动' });
  const card = (await api.generate('a')).card;
  assert.equal(card.languagePolicy.targetLanguage, 'en'); assert.equal(card.languagePolicy.instructionLanguage, 'zh-CN');
  assert.equal(state.calls[1].input.languagePolicy.targetLanguage, 'en');
  assert.match(practiceCardHtml(card), /class="box prompt" lang="en"/);
}));
test('changing only assistance language updates fingerprint and does not mutate completed cards', async () => fixture(async (api, state) => {
  const first = (await api.generate('a')).card;
  await api.start('a', first.id);
  await api.submit('a', first.id, { attemptId: 'language-answer-1', answer: 'x=2', difficulty: 'right', confidence: 3 });
  state.profiles.a = { primaryLanguage: 'en', supportLanguage: '' };
  const second = (await api.generate('a')).card;
  assert.notEqual(second.id, first.id); assert.notEqual(second.languagePolicy.fingerprint, first.languagePolicy.fingerprint);
  const completed = (await api.dashboard('a')).history.find(card => card.id === first.id);
  assert.equal(completed.status, 'completed'); assert.equal(completed.languagePolicy.supportLanguage, 'zh-CN');
}));
test('old cards remain readable/exportable and dashboards avoid rescanning learning evidence', async () => fixture(async (api, state, root) => {
  const card = (await api.generate('a')).card;
  state.profiles.a = undefined;
  assert.equal((await api.dashboard('a')).languagePolicy.resolvedFrom, 'previous_card');
  const storePath = path.join(root, 'a', 'practice-cards', 'store.json');
  const store = JSON.parse(await fs.readFile(storePath, 'utf8')); delete store.cards[0].languagePolicy;
  await fs.writeFile(storePath, JSON.stringify(store));
  const old = await api.exportCard('a', card.id);
  assert.match(practiceCardHtml(old), /html lang="zh-CN"/);
  assert.equal((await api.dashboard('a')).languagePolicy.resolvedFrom, 'legacy_default');
  assert.equal(state.calls.length, 2);
}));
test('English exports localize fixed labels and exclude answers, attempts and provenance', () => {
  const card = { id: 'example', studentId: 'PRIVATE-ID', status: 'completed', sourceIds: ['PRIVATE-PATH'],
    languagePolicy: resolveLanguagePolicy({ primaryLanguage: 'en', supportLanguage: 'zh-CN' }, '数学'),
    content: { title: 'Equation practice', subject: '数学', knowledgePoint: 'Linear equations', minutes: 10, rationale: 'Review equations', prompt: 'Solve 2x + 3 = 7.', answer: 'PRIVATE-ANSWER', explanation: 'PRIVATE-EXPLANATION' } };
  const html = practiceCardHtml(card);
  assert.match(html, /html lang="en"/); assert.match(html, /Mathematics/); assert.match(html, /My response/);
  assert.doesNotMatch(html, /PRIVATE-|为什么练|练习题目|我的作答/);
});
test('new language replaces an unstarted legacy card only after successful review', async () => fixture(async (api, state, root) => {
  state.profiles.a = undefined;
  const first = (await api.generate('a')).card;
  const storePath = path.join(root, 'a', 'practice-cards', 'store.json');
  const store = JSON.parse(await fs.readFile(storePath, 'utf8')); delete store.cards[0].languagePolicy;
  store.cards[0].generationKey = 'pre-language-version';
  await fs.writeFile(storePath, JSON.stringify(store));
  state.profiles.a = { primaryLanguage: 'en', supportLanguage: '' };
  state.languagePassed = false;
  await assert.rejects(api.generate('a'), /复核未通过/);
  assert.equal((await api.dashboard('a')).current.id, first.id);
  state.languagePassed = true;
  const second = (await api.generate('a')).card;
  const dashboard = await api.dashboard('a');
  assert.equal(dashboard.current.id, second.id);
  assert.equal(dashboard.history.find(card => card.id === first.id).status, 'superseded');
}));
