'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPlanningGuidanceService } = require('../electron/planning-guidance.cjs');
const contract = require('../electron/research-content.cjs');
const { outputSchema } = require('../electron/planning-research.cjs');
const url = 'https://example.edu/official-rules';
function result(sections, competitions) { return { fetchedAt: '2026-10-01T14:00:00Z', query: '合成研究', findings: ['合成研究总览'], limitations: [], sources: [{ url, official: true, title: '合成规则', summary: '合成官方规则' }], ...(sections ? { sections } : {}), ...(competitions ? { competitions } : {}) }; }
function sections() { return Object.fromEntries(Object.keys(contract.LABELS).map(key => [key, { ...Object.fromEntries(contract.COMMON.map(field => [field, []])), facts: [`${key}独立事实`], actions: [`${key}独立行动`], sourceUrls: [url], ...Object.fromEntries(contract.DETAILS[key].map(field => [field, [`${field}独立决策`]])) }])); }
function competition(input, overrides = {}) { return { name: `${input.interests[0]}合成比赛`, category: 'science_innovation', scope: 'domestic', organizer: '合成主办方', officialUrl: url, eligibility: '按当届年龄与地区核实', deadline: '2026-10-20', season: '2026合成赛季', fees: '未查明', matchReasons: [`兴趣：${input.interests[0]}；特长：${input.subjectStrengths[0]}；仅为推断`], preparation: ['结合兴趣形成研究问题并做复测'], risks: ['费用和安全须核实'], missing: ['需核对年龄资格'], sourceUrls: [url], ...overrides }; }
function fixture(search) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-supplement-'));
  const students = [{ id: 'a', name: '非敏感测试甲', school: '非公开学校甲', grade: '初二', digestTime: '21:30', interests: ['机器人'], subjectStrengths: ['物理'], careerDirections: ['工程'] }, { id: 'b', grade: '高一', interests: ['生态写作'], subjectStrengths: ['英语'] }];
  const clock = { now: new Date('2026-10-01T14:00:00Z') };
  const options = { now: () => new Date(clock.now), resolveStudent: id => students.find(x => x.id === id), listStudents: () => students, listProjects: () => [], resolveStudentDir: student => path.join(root, student.id), evidenceProvider: () => ({ learningSignals: ['含非敏感测试甲和非公开学校甲的合成报告'] }), researchProviders: () => [{ id: 'fake', available: true, authorized: true, webResearch: true, structuredResult: true, search }] };
  return { service: createPlanningGuidanceService(options), options, root, students, clock, close: () => fs.rmSync(root, { recursive: true, force: true }) };
}
test('research output requires four independent sections or dedicated competition contract', () => {
  assert.ok(outputSchema('guidance').required.includes('sections'));
  assert.ok(outputSchema('competition_recommendation').required.includes('competitions'));
  assert.equal(outputSchema('competition_recommendation').properties.sections, undefined);
  const valid = sections();
  assert.deepEqual(contract.sections(valid, [{ url }]), valid);
  valid.schools.sourceUrls = ['https://example.edu/unopened'];
  assert.throws(() => contract.sections(valid, [{ url }]), /未核验来源/);
  const duplicate = sections();
  duplicate.schools.facts = duplicate.pathways.facts; duplicate.schools.actions = duplicate.pathways.actions;
  duplicate.schools.schoolOptions = duplicate.pathways.routeOptions; duplicate.schools.eligibility = duplicate.pathways.milestones;
  assert.throws(() => contract.sections(duplicate, [{ url }]), /重复/);
});
test('actual host competition task dispatch has permitted student-scoped operations and a cancellable execution path', () => {
  const vm = require('node:vm');
  const { validatePermissionDeclaration } = require('../electron/task-protocol.cjs');
  const host = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const declaration = host.match(/const TASK_OPERATION_ALLOWLIST = ([\s\S]*?\n});/)[1];
  const allowlist = vm.runInNewContext(`(${declaration})`, { Set });
  assert.equal(validatePermissionDeclaration({ kind: 'competition_research_check', permissions: { read: ['D:/synthetic/a'], write: ['D:/synthetic/a/planning-guidance'], operations: ['read_planning_evidence', 'write_planning_suggestions'] } }, allowlist).ok, true);
  assert.match(host, /refreshed.kind === 'competition_research_check'\) return JSON.stringify\(\(await submitCompetitionResearchTask/);
  assert.match(host, /await taskChildProcesses.get\(taskId\)\?\.completion/);
  assert.match(host, /kill\(\) \{ this.killed = true; controller.abort\(\)/);
  assert.match(host, /void runCompetitionResearchSchedule\(\)/);
});
test('legacy plan upgrades to independent sections without editing history; unchanged sources do not create prose-only versions', async () => {
  let structured = false;
  const f = fixture(async () => result(structured ? sections() : undefined));
  try {
    const old = await f.service.refreshGuidancePlan('a'); assert.equal(old.current.sections, null);
    structured = true;
    const next = await f.service.refreshGuidancePlan('a'); assert.equal(next.current.version, 2); assert.equal(next.current.structureVersion, contract.VERSION);
    assert.equal((await f.service.refreshGuidancePlan('a')).unchanged, true);
    assert.equal(f.service.getGuidanceHistory('a').versions[1].sections, null);
    assert.deepEqual(f.service.getGuidancePlan('b').current, null);
  } finally { f.close(); }
});
test('competition personalization, redaction, monthly/node dedup, restart, offline and no-result history retention', async () => {
  let mode = 'valid'; const inputs = [];
  const f = fixture(async request => {
    inputs.push(request); if (mode === 'offline') throw Error('offline');
    return result(undefined, mode === 'empty' ? [] : [competition(request.queryInput)]);
  });
  try {
    const a = await f.service.refreshCompetitionRecommendations('a'); const b = await f.service.refreshCompetitionRecommendations('b');
    assert.notEqual(a.current.candidates[0].name, b.current.candidates[0].name);
    assert.equal(inputs[0].studentId, undefined);
    assert.doesNotMatch(JSON.stringify(inputs[0]), /非敏感测试甲|非公开学校甲/);
    assert.equal(f.service.competitionTaskCandidates().length, 0);
    assert.equal(f.service.getCompetitionRecommendations('a').current.candidates[0].status, 'verify_eligibility');
    assert.equal((await f.service.refreshCompetitionRecommendations('a')).receipt.status, 'unchanged');
    f.students[0].interests = ['天文']; assert.equal(f.service.competitionTaskCandidates()[0].trigger, 'evidence_changed');
    const changed = await f.service.refreshCompetitionRecommendations('a'); assert.equal(changed.current.version, 2);
    const restored = createPlanningGuidanceService(f.options); assert.equal(restored.getCompetitionRecommendations('a').current.id, changed.current.id);
    mode = 'offline'; const failed = await restored.refreshCompetitionRecommendations('a'); assert.equal(failed.ok, false); assert.equal(failed.current.id, changed.current.id);
    assert.equal(restored.competitionTaskCandidates().length, 0); // No fifteen-minute failure loop.
    f.clock.now = new Date('2026-10-02T15:00:00Z'); assert.ok(restored.competitionTaskCandidates().some(x => x.studentId === 'a'));
    mode = 'empty'; assert.equal((await restored.refreshCompetitionRecommendations('a')).receipt.status, 'no_results');
    f.clock.now = new Date('2026-11-01T14:00:00Z'); assert.equal(restored.competitionTaskCandidates().length, 2);
    restored.saveCompetitionPreferences('b', { automaticMonthlyCheck: false }); assert.equal(restored.competitionTaskCandidates().length, 1);
    assert.throws(() => restored.getCompetitionRecommendations('other'), /学生/);
  } finally { f.close(); }
});
test('competition rejects unsupported/unopened sources and labels past or unknown deadlines', () => {
  const input = { interests: ['合成'], subjectStrengths: ['科学'] }, source = [{ url, official: true }], now = new Date('2026-10-01');
  assert.throws(() => contract.competitions([competition(input)], [{ url, official: false }], now), /官方/);
  assert.equal(contract.competitions([competition(input, { deadline: '2026-09-01' })], source, now)[0].status, 'closed');
  assert.match(contract.competitions([competition(input, { deadline: '' })], source, now)[0].missing.join(' '), /不代表正在开放报名/);
  assert.throws(() => contract.competitions([competition(input, { deadline: 'invalid' })], source, now), /日期/);
});
test('competition concurrency and changed student evidence cannot overwrite a new scope', async () => {
  let resolve; let calls = 0;
  const f = fixture(request => { calls++; return new Promise(done => { resolve = () => done(result(undefined, [competition(request.queryInput)])); }); });
  try {
    const first = f.service.refreshCompetitionRecommendations('a'); const second = f.service.refreshCompetitionRecommendations('a'); assert.equal(calls, 1);
    f.students[0].interests = ['化学']; resolve(); const outcomes = await Promise.all([first, second]);
    assert.equal(outcomes[0].ok, false); assert.equal(outcomes[1].current, null); assert.match(outcomes[0].message, /资料.*变化/);
  } finally { f.close(); }
});
test('manual cancellation retains saved competition version and does not publish late results', async () => {
  let cancelMode = false, release;
  const f = fixture(request => cancelMode ? new Promise(done => { release = () => done(result(undefined, [competition(request.queryInput)])); }) : Promise.resolve(result(undefined, [competition(request.queryInput)])));
  try {
    const previous = await f.service.refreshCompetitionRecommendations('a'); cancelMode = true;
    const work = f.service.refreshCompetitionRecommendations('a'); f.service.cancelCompetitionResearch('a'); release();
    const outcome = await work; assert.equal(outcome.ok, false); assert.equal(outcome.current.id, previous.current.id); assert.match(outcome.message, /取消/);
    assert.throws(() => f.service.cancelCompetitionResearch('unknown'), /学生/);
  } finally { f.close(); }
});
test('render contract keeps dedicated guidance visible and mounts share dialog above clipping ancestors', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.tsx'), 'utf8');
  const panel = fs.readFileSync(path.join(__dirname, '..', 'src', 'PlanningResearchPanels.tsx'), 'utf8');
  const advanced = renderer.match(/<details className="guidance-advanced"[^>]*>[\s\S]*?<\/details>/)?.[0];
  assert.ok(advanced, 'research details remain available in a native disclosure');
  assert.doesNotMatch(advanced.split('>')[0], /\bopen\b/);
  assert.match(advanced, /<summary>高级/);
  assert.match(advanced, /research-capability-banner/);
  assert.match(advanced, /guidance-research-flow/);
  assert.match(advanced, /research-provider-list/);
  assert.match(renderer, /<\/details>\s*\{guidanceConfigurationWarning/);
  assert.match(renderer, /规划路径和目标地区以学生档案为准/);
  assert.doesNotMatch(renderer, /checked=\{guidancePreferences.routes\[route\]\}/);
  assert.match(panel, /preview && createPortal\(/);
  assert.match(panel, /document.querySelector\('\.app-shell'\) \|\| document.body\)/);
  assert.match(panel, /event.key === 'Escape'/);
  assert.match(panel, /autoFocus disabled=\{busy\}/);
});
test('cloud share exports summaries only, marks historic verification, strips known identity and rejects invalid kinds', async () => {
  const f = fixture(async () => result(sections()));
  try {
    f.service.refreshTopicSuggestions('a'); await f.service.refreshGuidancePlan('a');
    const topic = f.service.preparePlanningShare('a', 'topics'); const guidance = f.service.preparePlanningShare('a', 'guidance');
    assert.match(topic.name, /^选题建议.*\.md$/); assert.match(guidance.name, /^规划总览.*\.md$/);
    assert.doesNotMatch(topic.content + guidance.content, /evidenceSnapshot|非敏感测试甲|非公开学校甲|student:a|原始报告正文/);
    assert.match(guidance.content, /不表示刚刚联网核验/);
    assert.throws(() => f.service.preparePlanningShare('b', 'guidance'), /尚无/);
    assert.throws(() => f.service.preparePlanningShare('a', 'raw'), /类型/);
    assert.equal(f.service.preparePlanningShare('a', 'topics').sha256, topic.sha256);
  } finally { f.close(); }
});
