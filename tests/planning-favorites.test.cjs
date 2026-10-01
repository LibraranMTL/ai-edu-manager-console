const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPlanningGuidanceService } = require('../electron/planning-guidance.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-favorites-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const students = [{ id: 'a', interests: ['机器人'], grade: '八年级' }, { id: 'b', interests: ['阅读'], grade: '八年级' }];
  let at = new Date('2026-10-01T00:00:00Z');
  const options = { resolveStudent: id => students.find(student => student.id === id), resolveStudentDir: student => path.join(root, student.id), now: () => at };
  const service = createPlanningGuidanceService(options);
  const topicSet = service.refreshTopicSuggestions('a').current;
  const competition = { id: 'c1', name: '合成科创竞赛', category: 'science_innovation', scope: 'international', organizer: '测试机构', officialUrl: 'https://example.edu/competition', eligibility: '仅为合成测试', deadline: '2026-01-01', season: '测试届', fees: '未知', status: 'closed', matchReasons: ['测试依据'], preparation: ['核对规则'], risks: [], missing: ['核对年龄'], sourceUrls: ['https://example.edu/competition'] };
  const competitionSet = { id: 'cv1', studentId: 'a', version: 1, createdAt: at.toISOString(), verifiedAt: at.toISOString(), candidates: [competition], sources: [{ url: competition.officialUrl, title: '合成来源', fetchedAt: at.toISOString(), official: true }, { url: 'https://example.edu/unrelated', title: '无关来源' }] };
  const storeFile = id => path.join(root, id, 'planning-guidance/store.json');
  const favoriteFile = id => path.join(root, id, 'planning-guidance/favorites.json');
  function patchStore(id, patch) { const file = storeFile(id); const store = JSON.parse(fs.readFileSync(file, 'utf8')); fs.writeFileSync(file, JSON.stringify({ ...store, ...patch })); }
  patchStore('a', { competitionSets: [competitionSet] });
  const saveTopic = () => service.setPlanningFavorite('a', 'topics', topicSet.id, topicSet.candidates[0].id, true);
  return { root, students, service, options, topicSet, competitionSet, patchStore, favoriteFile, saveTopic, clock: () => { at = new Date('2026-10-02T00:00:00Z'); } };
}
test('legacy students get an empty favorites list without creating a directory', t => {
  const f = fixture(t); assert.deepEqual(f.service.getPlanningFavorites('b', 'topics').favorites, []); assert.equal(fs.existsSync(path.join(f.root, 'b')), false);
});
test('topic favorites survive service restart with exact candidate and version', t => {
  const f = fixture(t), result = f.saveTopic(); assert.equal(result.ok, true);
  const saved = createPlanningGuidanceService(f.options).getPlanningFavorites('a', 'topics').favorites[0];
  assert.deepEqual(saved.candidate, f.topicSet.candidates[0]); assert.equal(saved.versionId, f.topicSet.id); assert.equal(saved.version, 1);
});
test('repeated save is idempotent and does not change original timestamp or file', t => {
  const f = fixture(t); f.saveTopic(); const original = fs.readFileSync(f.favoriteFile('a'), 'utf8'); f.clock();
  assert.equal(f.saveTopic().unchanged, true); assert.equal(fs.readFileSync(f.favoriteFile('a'), 'utf8'), original);
});
test('favorites remain after recommendations refresh and version pruning', t => {
  const f = fixture(t); f.saveTopic(); f.students[0].interests = ['生态']; f.service.refreshTopicSuggestions('a'); f.patchStore('a', { topicSets: [] });
  assert.deepEqual(f.service.getPlanningFavorites('a', 'topics').favorites[0].candidate, f.topicSet.candidates[0]);
});
test('historical favorite adoption only prepares the same idempotent project draft', t => {
  const f = fixture(t); f.saveTopic(); f.patchStore('a', { topicSets: [] });
  const first = f.service.prepareProjectDraftFromSuggestion('a', f.topicSet.candidates[0].id);
  assert.equal(first.draft.status, 'prepared_only'); assert.deepEqual(first.draft.studentIds, ['a']);
  const again = f.service.prepareProjectDraftFromSuggestion('a', f.topicSet.candidates[0].id);
  assert.equal(again.restored, true); assert.equal(first.draft.id, again.draft.id);
});
test('canceling favorites cannot delete recommendation history or prepared drafts', t => {
  const f = fixture(t); f.saveTopic(); const draft = f.service.prepareProjectDraftFromSuggestion('a', f.topicSet.candidates[0].id).draft;
  assert.equal(f.service.setPlanningFavorite('a', 'topics', f.topicSet.id, f.topicSet.candidates[0].id, false).favorites.length, 0);
  assert.equal(f.service.getTopicSuggestions('a').current.id, f.topicSet.id);
  assert.equal(f.service.prepareProjectDraftFromSuggestion('a', f.topicSet.candidates[0].id).draft.id, draft.id);
});
test('adoption selects the displayed saved version rather than a newer same-id candidate', t => {
  const f = fixture(t); f.saveTopic(); const candidate = f.topicSet.candidates[0];
  const newer = {...f.topicSet,id:'topic-new-version',version:2,candidates:[{...candidate,title:'新版标题'}]}; f.patchStore('a', {topicSets:[newer,f.topicSet]});
  assert.equal(f.service.prepareProjectDraftFromSuggestion('a',candidate.id,f.topicSet.id).draft.name,candidate.title);
  f.patchStore('a',{drafts:{}});
  assert.equal(f.service.prepareProjectDraftFromSuggestion('a',candidate.id,newer.id).draft.name,'新版标题');
  assert.equal(f.service.prepareProjectDraftFromSuggestion('a',candidate.id,'nonexistent').ok,false);
});
test('competition favorite retains official references and expired deadline without unrelated sources', t => {
  const f = fixture(t); const result = f.service.setPlanningFavorite('a', 'competitions', 'cv1', 'c1', true);
  assert.equal(result.favorites[0].candidate.deadline, '2026-01-01'); assert.equal(result.favorites[0].sources.length, 1);
  f.patchStore('a', { competitionSets: [] }); assert.equal(f.service.getPlanningFavorites('a', 'competitions').favorites.length, 1);
});
test('topics and competitions are independent even when candidate ids coincide', t => {
  const f = fixture(t); f.competitionSet.candidates[0].id = f.topicSet.candidates[0].id; f.patchStore('a', { competitionSets: [f.competitionSet] }); f.saveTopic();
  f.service.setPlanningFavorite('a', 'competitions', 'cv1', f.topicSet.candidates[0].id, true);
  f.service.setPlanningFavorite('a', 'topics', f.topicSet.id, f.topicSet.candidates[0].id, false);
  assert.equal(f.service.getPlanningFavorites('a', 'competitions').favorites.length, 1);
});
test('another student cannot read or save the first student candidate', t => {
  const f = fixture(t); f.saveTopic(); assert.equal(f.service.getPlanningFavorites('b', 'topics').favorites.length, 0);
  assert.throws(() => f.service.setPlanningFavorite('b', 'topics', f.topicSet.id, f.topicSet.candidates[0].id, true), { code: 'FAVORITE_NOT_FOUND' });
});
test('student authority is rechecked for each read and write', t => {
  const f = fixture(t); f.saveTopic(); f.students.splice(0, 1);
  assert.throws(() => f.service.getPlanningFavorites('a', 'topics'), { code: 'STUDENT_SCOPE_INVALID' });
  assert.throws(() => f.saveTopic(), { code: 'STUDENT_SCOPE_INVALID' });
});
test('kind parameters inherited from Object prototype are rejected', t => {
  const f = fixture(t); for (const kind of ['__proto__', 'constructor', 'guidance', '']) assert.throws(() => f.service.getPlanningFavorites('a', kind), { code: 'FAVORITE_KIND_INVALID' });
});
test('version owner mismatch is rejected even inside the selected student directory', t => {
  const f = fixture(t); f.topicSet.studentId = 'b'; f.patchStore('a', { topicSets: [f.topicSet] });
  assert.throws(() => f.saveTopic(), { code: 'FAVORITE_NOT_FOUND' }); assert.equal(fs.existsSync(f.favoriteFile('a')), false);
});
test('favorites cap returns an explicit error without dropping old records', t => {
  const f = fixture(t); f.saveTopic(); const file = f.favoriteFile('a'); const value = JSON.parse(fs.readFileSync(file)); const seed = value.favorites[0];
  value.favorites = Array.from({length:500}, (_, index) => ({...seed, candidateId:`saved-${index}`,candidate:{...seed.candidate,id:`saved-${index}`}})); fs.writeFileSync(file, JSON.stringify(value)); const original = fs.readFileSync(file, 'utf8');
  assert.throws(() => f.saveTopic(), { code: 'FAVORITE_LIMIT' }); assert.equal(fs.readFileSync(file, 'utf8'), original);
});
test('only explicit boolean state and host-resolved versions are accepted', t => {
  const f = fixture(t); assert.throws(() => f.service.setPlanningFavorite('a', 'topics', f.topicSet.id, f.topicSet.candidates[0].id, 'true'), { code: 'FAVORITE_INPUT_INVALID' });
  assert.throws(() => f.service.setPlanningFavorite('a', 'topics', 'wrong-version', f.topicSet.candidates[0].id, true), { code: 'FAVORITE_NOT_FOUND' });
});
test('swapped student favorites and corrupted JSON are not silently overwritten', t => {
  const f = fixture(t); f.saveTopic(); const file = f.favoriteFile('a'); const good = JSON.parse(fs.readFileSync(file)); good.studentId = 'b'; fs.writeFileSync(file, JSON.stringify(good));
  assert.throws(() => f.service.getPlanningFavorites('a', 'topics'), { code: 'FAVORITE_STORE_INVALID' });
  fs.writeFileSync(file, '{'); assert.throws(() => f.saveTopic()); assert.equal(fs.readFileSync(file, 'utf8'), '{');
});
test('no raw evidence snapshot, profile, or arbitrary extra candidate fields are copied', t => {
  const f = fixture(t); f.topicSet.candidates[0].rawConversation = 'private'; f.topicSet.evidenceSnapshot = { profile: 'private' }; f.patchStore('a', { topicSets: [f.topicSet] }); f.saveTopic();
  assert.doesNotMatch(fs.readFileSync(f.favoriteFile('a'), 'utf8'), /rawConversation|evidenceSnapshot|private/);
});
test('a stale research-store write cannot overwrite a concurrently saved favorite', t => {
  const f = fixture(t); const stale = JSON.parse(fs.readFileSync(path.join(f.root, 'a/planning-guidance/store.json'))); f.saveTopic(); f.patchStore('a', stale);
  assert.equal(f.service.getPlanningFavorites('a', 'topics').favorites.length, 1);
});
test('oversized candidates reject explicitly without discarding existing favorites', t => {
  const f = fixture(t); f.saveTopic(); const original = fs.readFileSync(f.favoriteFile('a'), 'utf8'); f.topicSet.candidates[1].title = 'x'.repeat(70000); f.patchStore('a', { topicSets: [f.topicSet] });
  assert.throws(() => f.service.setPlanningFavorite('a', 'topics', f.topicSet.id, f.topicSet.candidates[1].id, true), { code: 'FAVORITE_LIMIT' }); assert.equal(fs.readFileSync(f.favoriteFile('a'), 'utf8'), original);
});
test('planning folder junction cannot escape the student controlled directory', t => {
  const f = fixture(t); const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-favorite-external-')); t.after(() => fs.rmSync(elsewhere, { recursive: true, force: true }));
  fs.mkdirSync(path.join(f.root, 'b')); fs.symlinkSync(elsewhere, path.join(f.root, 'b/planning-guidance'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => f.service.getPlanningFavorites('b', 'topics'), { code: 'FAVORITE_PATH_INVALID' }); assert.deepEqual(fs.readdirSync(elsewhere), []);
});
test('favorites use licensed async IPC and both views expose student-scoped lists', () => {
  const root = path.join(__dirname, '..'); const main = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8'); const preload = fs.readFileSync(path.join(root, 'electron/preload.cjs'), 'utf8');
  for (const method of ['getPlanningFavorites', 'setPlanningFavorite']) { assert.match(main, new RegExp(`ipcMain.handle\\('bridge:${method}'.*licensedInvoke`)); assert.match(preload, new RegExp(`ipcRenderer.invoke\\('bridge:${method}'`)); }
  assert.match(fs.readFileSync(path.join(root, 'src/TopicSuggestionsPanel.tsx'), 'utf8'), /我的收藏/);
  assert.match(fs.readFileSync(path.join(root, 'src/PlanningResearchPanels.tsx'), 'utf8'), /我的收藏比赛/);
  assert.match(fs.readFileSync(path.join(root, 'src/planning-favorites.ts'), 'utf8'), /epoch.current !== requestEpoch/);
});
