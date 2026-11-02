const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  TOPIC_SCHEMA,
  GUIDANCE_SCHEMA,
  computeAge,
  createPlanningGuidanceService,
  deidentifyResearchInput,
  shouldRunMonthlyCheck,
  validateResearchResult,
} = require('../electron/planning-guidance.cjs');

function fixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-planning-'));
  const clock = { value: new Date('2026-09-30T08:00:00.000Z') };
  const students = [
    { id: 'student-cn', name: '测试甲', phone: '13800000000', email: 'private@example.com', grade: '初二', school: '不发送的学校档案', goal: '科创', birthDate: '2012-10-01', currentRegion: '北京市', targetRegions: ['北京市'], planningRoutes: ['domestic'], targetStage: '高中', interests: ['机器人'], subjectStrengths: ['物理'], careerDirections: ['工程'] },
    { id: 'student-intl', name: '测试乙', grade: '高一', school: '另一所学校', goal: '国际方向', manualAgeBand: '15—17岁', currentRegion: '上海市', targetRegions: ['新加坡'], planningRoutes: ['international'], targetStage: '本科', interests: ['生态写作'], subjectStrengths: ['英语'], careerDirections: ['环境传播'] },
  ];
  const projects = [{ id: 'project-1', name: '传感器项目', type: '科创', status: 'active', studentIds: ['student-cn'], dashboard: { contributionStatus: 'reviewed' }, updatedAt: '2026-09-28T00:00:00.000Z' }];
  const provider = options.provider || null;
  const service = createPlanningGuidanceService({
    now: () => new Date(clock.value),
    resolveStudent: (id) => students.find((item) => item.id === id) || null,
    listStudents: () => students,
    listProjects: () => projects,
    resolveStudentDir: (student) => path.join(root, student.id, '.ai-manager'),
    evidenceProvider: (student) => student.id === 'student-cn' ? { sourceIds: ['growth:student-cn:evidence-1', 'report:student-cn:stage'], confirmedGrowthSignals: ['数据记录：2 条已确认依据'], learningSignals: ['正式学情报告显示持续记录行为'], reportIds: ['stage'] } : {},
    researchProviders: () => provider ? [provider] : [{ id: 'codex', label: 'Codex', available: true, authorized: false, webResearch: false, structuredResult: false, healthMessage: 'Not logged in' }],
  });
  return { root, clock, students, service, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('age is derived from birth date and never inferred from grade', () => {
  assert.equal(computeAge('2012-10-01', new Date('2026-09-30T08:00:00Z')), 13);
  assert.equal(computeAge('', new Date('2026-09-30T08:00:00Z')), null);
  assert.equal(computeAge('not-a-date', new Date('2026-09-30T08:00:00Z')), null);
});

test('guidance cancellation is deduplicated and cannot publish a late provider result', async () => {
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  const provider = { id:'fake',available:true,authorized:true,webResearch:true,structuredResult:true,search:() => { started(); return new Promise(resolve => { release=resolve; }); } };
  const {service,cleanup} = fixture({provider});
  try {
    const work=service.refreshGuidancePlan('student-cn'); await entered;
    assert.equal(service.refreshGuidancePlan('student-cn'),work);
    assert.match(service.cancelGuidanceResearch('student-cn').message,/已请求取消/);
    release(researchFixtureResult()); const result=await work;
    assert.equal(result.ok,false);assert.equal(result.receipt.code,'RESEARCH_CANCELLED');
    assert.equal(service.getGuidanceHistory('student-cn').versions.length,0);
  } finally {cleanup();}
});

test('deidentified research input excludes direct identity and raw private fields', () => {
  const { students, service, cleanup } = fixture();
  try {
    const snapshot = service.evidenceSnapshot(students[0]);
    const query = deidentifyResearchInput(students[0], snapshot);
    const serialized = JSON.stringify(query);
    assert.doesNotMatch(serialized, /测试甲|13800000000|private@example\.com|不发送的学校档案/);
    assert.match(serialized, /北京市/);
    assert.deepEqual(Object.keys(query).sort(), ['age', 'ageBand', 'careerDirections', 'confirmedGrowthSignals', 'currentRegion', 'grade', 'interests', 'learningSignals', 'preferences', 'projectSignals', 'routes', 'schema', 'subjectStrengths', 'targetRegions', 'targetStage'].sort());
  } finally { cleanup(); }
});

test('topic suggestions change with student interests strengths and career direction', () => {
  const { service, cleanup } = fixture();
  try {
    const domestic = service.refreshTopicSuggestions('student-cn').current;
    const international = service.refreshTopicSuggestions('student-intl').current;
    assert.notDeepEqual(domestic.candidates.map((item) => item.title), international.candidates.map((item) => item.title));
    assert.match(domestic.candidates.map((item) => item.title).join('\n'), /机器人|物理|工程/);
    assert.match(international.candidates.map((item) => item.title).join('\n'), /生态写作|英语|环境传播/);
    assert.ok(domestic.candidates.every((item) => item.studentEvidence.some((entry) => /个人兴趣/.test(entry.text))));
  } finally { cleanup(); }
});

test('opening suggestions after a profile change invalidates the old set and regenerates topic paths', () => {
  const { service, students, cleanup } = fixture();
  try {
    const first = service.refreshTopicSuggestions('student-cn').current;
    students[0].interests = ['金融'];
    students[0].careerDirections = ['经济研究'];
    const state = service.getTopicSuggestions('student-cn');
    assert.equal(state.needsRefresh, true);
    assert.equal(state.current, null);
    const updated = service.refreshTopicSuggestions('student-cn').current;
    assert.equal(updated.version, first.version + 1);
    assert.notDeepEqual(updated.candidates.map((item) => item.realWorldProblem), first.candidates.map((item) => item.realWorldProblem));
    assert.match(updated.candidates.map((item) => item.path.join(' ')).join(' '), /预算|消费/);
    assert.notEqual(updated.candidates[0].id, first.candidates[0].id);
    assert.equal(service.refreshTopicSuggestions('student-cn', { force: true }).unchanged, true);
  } finally { cleanup(); }
});

test('the same interest uses different subject methods and career exploration instead of identical cards', () => {
  const { service, students, cleanup } = fixture();
  try {
    students[1].interests = ['机器人'];
    students[1].careerDirections = ['文学创作'];
    const scienceStudent = service.refreshTopicSuggestions('student-cn').current;
    const writingStudent = service.refreshTopicSuggestions('student-intl').current;
    assert.match(scienceStudent.candidates[0].title, /物理视角/);
    assert.match(writingStudent.candidates[0].title, /英语视角/);
    assert.match(scienceStudent.candidates[0].path.join(' '), /测量、数据记录与重复验证/);
    assert.match(writingStudent.candidates[0].path.join(' '), /访谈、文本分析与来源核对/);
    assert.match(scienceStudent.candidates[3].title, /工程探索/);
    assert.match(writingStudent.candidates[3].title, /文学创作探索/);
  } finally { cleanup(); }
});

test('project context is usable without a new interest field, while a generic profile yields no shared template topics', () => {
  const { service, students, cleanup } = fixture();
  try {
    students[0].interests = [];
    students[0].careerDirections = [];
    students[0].goal = '科创';
    const projectBased = service.refreshTopicSuggestions('student-cn').current;
    assert.match(projectBased.candidates[0].title, /传感器项目/);
    students[1].interests = [];
    students[1].careerDirections = [];
    students[1].subjectStrengths = [];
    students[1].goal = '国际方向';
    const insufficient = service.refreshTopicSuggestions('student-intl').current;
    assert.equal(insufficient.candidates.length, 0);
    assert.match(insufficient.notice, /补充具体兴趣/);
  } finally { cleanup(); }
});

test('topic suggestions are versioned, grounded, student-scoped and unchanged without input changes', () => {
  const { service, cleanup } = fixture();
  try {
    const first = service.refreshTopicSuggestions('student-cn');
    assert.equal(first.ok, true);
    assert.equal(first.current.schema, TOPIC_SCHEMA);
    assert.equal(first.current.candidates.length, 4);
    assert.deepEqual(new Set(first.current.candidates.map((item) => item.category)), new Set(['science_innovation', 'social_practice']));
    assert.ok(first.current.candidates.every((item) => item.studentEvidence.some((entry) => entry.kind === 'fact')));
    assert.ok(first.current.candidates.every((item) => item.studentEvidence.some((entry) => entry.kind === 'inference')));
    assert.ok(first.current.candidates.every((item) => item.freshness.internetVerified === false));
    const second = service.refreshTopicSuggestions('student-cn');
    assert.equal(second.unchanged, true);
    assert.equal(second.current.id, first.current.id);
    assert.throws(() => service.refreshTopicSuggestions('unknown'), /未找到当前学生/);
  } finally { cleanup(); }
});

test('adopting the same suggestion restores one prepared draft and never creates a project', () => {
  const { service, cleanup } = fixture();
  try {
    const set = service.refreshTopicSuggestions('student-cn').current;
    const first = service.prepareProjectDraftFromSuggestion('student-cn', set.candidates[0].id);
    const second = service.prepareProjectDraftFromSuggestion('student-cn', set.candidates[0].id);
    assert.equal(first.ok, true);
    assert.equal(first.draft.status, 'prepared_only');
    assert.equal(second.restored, true);
    assert.equal(second.draft.id, first.draft.id);
    assert.deepEqual(second.draft.studentIds, ['student-cn']);
  } finally { cleanup(); }
});

test('research source validation requires real http URL and fetched time', () => {
  assert.equal(validateResearchResult({ sources: [{ url: 'not-a-url', title: 'bad' }] }).ok, false);
  const result = validateResearchResult({ query: 'test', fetchedAt: '2026-09-30T08:00:00Z', sources: [{ url: 'https://example.edu/admissions', title: 'Official admissions', official: true, region: 'CN', publishedAt: '2026-09-01T00:00:00Z' }] });
  assert.equal(result.ok, true);
  assert.equal(result.sources[0].url, 'https://example.edu/admissions');
  assert.equal(result.sources[0].official, true);
});

test('guidance keeps prior version when offline and does not create wording-only versions', async () => {
  let calls = 0;
  let online = true;
  const provider = {
    id: 'fake-research', label: 'Fake research', available: true, authorized: true, webResearch: true, structuredResult: true,
    async search() {
      calls += 1;
      if (!online) throw Object.assign(new Error('offline'), { code: 'OFFLINE' });
      return { query: 'deidentified query', fetchedAt: '2026-09-30T08:00:00Z', findings: ['官方要求以当年招生简章为准'], limitations: ['需核对适用届别'], sources: [{ url: 'https://example.edu/admissions', title: 'Admissions', publisher: 'Example University', official: true, region: 'international', publishedAt: '2026-09-01T00:00:00Z', fetchedAt: '2026-09-30T08:00:00Z', summary: 'Published admission requirements' }] };
    },
  };
  const { service, cleanup } = fixture({ provider });
  try {
    const first = await service.refreshGuidancePlan('student-cn', { trigger: 'manual' });
    assert.equal(first.ok, true);
    assert.equal(first.current.schema, GUIDANCE_SCHEMA);
    assert.equal(first.current.version, 1);
    assert.equal(first.current.sources[0].official, true);
    const unchanged = await service.refreshGuidancePlan('student-cn', { trigger: 'manual' });
    assert.equal(unchanged.unchanged, true);
    assert.equal(unchanged.current.id, first.current.id);
    online = false;
    const offline = await service.refreshGuidancePlan('student-cn', { trigger: 'manual' });
    assert.equal(offline.ok, false);
    assert.equal(offline.retainedPrevious, true);
    assert.equal(offline.current.id, first.current.id);
    assert.equal(calls, 3);
  } finally { cleanup(); }
});

test('no research provider records an unavailable receipt without inventing guidance', async () => {
  const { service, cleanup } = fixture();
  try {
    const result = await service.refreshGuidancePlan('student-intl', { trigger: 'manual' });
    assert.equal(result.ok, false);
    assert.equal(result.current, null);
    assert.equal(result.receipt.code, 'RESEARCH_CAPABILITY_UNAVAILABLE');
    const history = service.getGuidanceHistory('student-intl');
    assert.equal(history.versions.length, 0);
    assert.equal(history.checks[0].status, 'unavailable');
  } finally { cleanup(); }
});

test('monthly scheduling, preference save and read-only overview remain deterministic', () => {
  assert.equal(shouldRunMonthlyCheck('2026-08-01T00:00:00Z', new Date('2026-09-30T08:00:00Z')), true);
  assert.equal(shouldRunMonthlyCheck('2026-09-01T00:00:00Z', new Date('2026-09-30T08:00:00Z')), false);
  const { service, cleanup } = fixture();
  try {
    const saved = service.saveGuidancePreferences('student-cn', { routes: { domestic: true, hongkong_macau: true, international: false }, automaticMonthlyCheck: true, targetRegions: ['北京', '香港'] });
    assert.equal(saved.preferences.routes.hongkong_macau, false, 'profile routes cannot be overridden by legacy preferences');
    assert.equal(saved.preferences.routeSource, 'student-profile');
    assert.deepEqual(saved.preferences.targetRegions, ['北京市']);
    const tasks = service.taskCandidates();
    assert.ok(tasks.some((item) => item.taskType === 'topic_suggestion_refresh'));
    assert.ok(tasks.some((item) => item.taskType === 'guidance_research_check'));
    assert.ok(tasks.some((item) => item.taskType === 'guidance_plan_refresh'));
    const overview = service.getStudentOverview();
    assert.equal(overview.students.length, 2);
    assert.equal(overview.students.find((item) => item.id === 'student-cn').projectCount, 1);
    assert.equal(overview.students.find((item) => item.id === 'student-intl').projectCount, 0);
  } finally { cleanup(); }
});


test('a declared provider without an executable search cannot report ready', () => {
  const { service, cleanup } = fixture({ provider: { id: 'codex', available: true, authorized: true, webResearch: true, structuredResult: true } });
  try { assert.equal(service.getResearchCapabilityStatus().available, false); } finally { cleanup(); }
});

test('a provider still being checked is reported as checking rather than definitively unavailable', () => {
  const { service, cleanup } = fixture({ provider: {
    id: 'codex', label: 'Codex', available: true, authorized: false,
    healthPending: true, healthMessage: '正在检查 CLI 授权',
  } });
  try {
    const capability = service.getResearchCapabilityStatus();
    assert.equal(capability.available, false);
    assert.equal(capability.checking, true);
    assert.deepEqual(capability.checkingProviderIds, ['codex']);
    assert.match(capability.message, /正在核对/);
  } finally { cleanup(); }
});

test('initial research routes follow the student profile', () => {
  const { service, cleanup } = fixture();
  try {
    assert.equal(service.getGuidancePlan('student-intl').preferences.routes.international, true);
    assert.equal(service.getGuidancePlan('student-intl').preferences.routes.domestic, false);
  } finally { cleanup(); }
});

function researchFixtureResult() {
  return { fetchedAt: '2026-09-30T08:00:00Z', findings: ['合成公开事实'], sources: [{ url: 'https://example.edu/admissions', title: 'Synthetic admissions', summary: 'Synthetic requirements' }] };
}

test('legacy domestic defaults cannot override international profile and reading never rewrites history', async () => {
  let received;
  const provider = { id: 'fake', available: true, authorized: true, webResearch: true, structuredResult: true,
    search: async ({ queryInput }) => { received = queryInput; return researchFixtureResult(); } };
  const { root, service, students, cleanup } = fixture({ provider });
  try {
    students[1].currentRegion = '中国北京'; students[1].targetRegions = ['加拿大'];
    service.refreshTopicSuggestions('student-intl');
    const file = path.join(root, 'student-intl', '.ai-manager', 'planning-guidance', 'store.json');
    const store = JSON.parse(fs.readFileSync(file, 'utf8'));
    store.preferences = { routes: { domestic: true, hongkong_macau: false, international: false }, targetRegions: ['旧目的地'], updatedAt: '', automaticMonthlyCheck: true };
    store.guidanceVersions = [{ id: 'historic-v2', version: 2, routes: ['domestic'], targetRegions: ['加拿大'], findings: ['旧版 route domestic 原文'], evidenceSnapshot: service.evidenceSnapshot(students[1]) }];
    fs.writeFileSync(file, JSON.stringify(store));
    const before = fs.readFileSync(file, 'utf8');
    const state = service.getGuidancePlan('student-intl');
    assert.deepEqual(state.preferences.routes, { domestic: false, hongkong_macau: false, international: true });
    assert.deepEqual(state.preferences.targetRegions, ['加拿大']);
    assert.equal(state.configurationMismatch, true);
    assert.match(state.configurationWarning, /当前路径：国际.*历史版本路径：境内/);
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'read-only migration does not edit production records');
    const result = await service.refreshGuidancePlan('student-intl');
    assert.equal(result.ok, true); assert.equal(result.current.version, 3);
    assert.deepEqual(received.routes, ['international']); assert.deepEqual(received.targetRegions, ['加拿大']);
    assert.equal(received.currentRegion, '中国北京');
    assert.deepEqual(result.current.routes, received.routes);
    assert.deepEqual(result.current.targetRegions, received.targetRegions);
    assert.equal(service.getGuidancePlan('student-intl').configurationMismatch, false);
    assert.deepEqual(service.getGuidanceHistory('student-intl').versions[1], store.guidanceVersions[0]);
    assert.deepEqual(students[1].planningRoutes, ['international']);
  } finally { cleanup(); }
});

test('profile route changes invalidate old guidance and offline refresh retains immutable previous version', async () => {
  let online = true;
  const provider = { id: 'fake', available: true, authorized: true, webResearch: true, structuredResult: true,
    search: async () => { if (!online) throw new Error('offline'); return researchFixtureResult(); } };
  const { service, students, cleanup } = fixture({ provider });
  try {
    const first = await service.refreshGuidancePlan('student-cn');
    students[0].planningRoutes = ['international', 'hongkong_macau']; students[0].targetRegions = ['加拿大', '香港'];
    const state = service.getGuidancePlan('student-cn');
    assert.equal(state.configurationMismatch, true);
    assert.equal(state.preferences.routes.domestic, false);
    assert.equal(state.preferences.routes.hongkong_macau, true);
    online = false;
    const failed = await service.refreshGuidancePlan('student-cn');
    assert.equal(failed.ok, false); assert.deepEqual(failed.current, first.current);
    assert.equal(service.getGuidancePlan('student-cn').configurationMismatch, true);
  } finally { cleanup(); }
});

test('missing profile fields preserve explicit legacy fallback and version destinations match research input', async () => {
  let received;
  const provider = { id: 'fake', available: true, authorized: true, webResearch: true, structuredResult: true,
    search: async ({ queryInput }) => { received = queryInput; return researchFixtureResult(); } };
  const { service, students, cleanup } = fixture({ provider });
  try {
    students[0].planningRoutes = []; students[0].targetRegions = [];
    const saved = service.saveGuidancePreferences('student-cn', { routes: { hongkong_macau: true }, targetRegions: ['香港'] });
    assert.equal(saved.preferences.routeSource, 'legacy-fallback');
    assert.equal(saved.preferences.routes.hongkong_macau, true);
    const first = await service.refreshGuidancePlan('student-cn');
    assert.deepEqual(received.routes, ['hongkong_macau']); assert.deepEqual(first.current.targetRegions, ['香港']);
    service.saveGuidancePreferences('student-cn', { automaticMonthlyCheck: false });
    const second = await service.refreshGuidancePlan('student-cn');
    assert.equal(second.unchanged, true, 'schedule-only saves do not create new research versions');
  } finally { cleanup(); }
});

test('changing profile route during research rejects the obsolete response', async () => {
  let release;
  const provider = { id: 'fake', available: true, authorized: true, webResearch: true, structuredResult: true,
    search: () => new Promise(resolve => { release = resolve; }) };
  const { service, students, cleanup } = fixture({ provider });
  try {
    const pending = service.refreshGuidancePlan('student-cn');
    students[0].planningRoutes = ['international'];
    release(researchFixtureResult());
    const result = await pending;
    assert.equal(result.receipt.code, 'RESEARCH_INPUT_CHANGED');
    assert.equal(service.getGuidancePlan('student-cn').current, null);
  } finally { cleanup(); }
});

test('concurrent research is deduplicated and changed preferences cannot be overwritten', async () => {
  let release; let calls = 0;
  const provider = { id: 'codex', available: true, authorized: true, webResearch: true, structuredResult: true,
    search: () => { calls += 1; return new Promise((resolve) => { release = resolve; }); } };
  const { service, cleanup } = fixture({ provider });
  try {
    const first = service.refreshGuidancePlan('student-cn');
    const duplicate = service.refreshGuidancePlan('student-cn');
    assert.equal(calls, 1);
    service.saveGuidancePreferences('student-cn', { routes: { domestic: false, international: true }, focusAreas: ['计算机'] });
    release({ fetchedAt: '2026-09-30T08:00:00Z', findings: ['不应写入的旧结论'], sources: [{ url: 'https://example.edu/a', summary: 'old request' }] });
    const [a,b] = await Promise.all([first,duplicate]);
    assert.equal(a.receipt.code, 'RESEARCH_INPUT_CHANGED'); assert.equal(b.ok, false);
    assert.equal(service.getGuidancePlan('student-cn').current, null);
    assert.deepEqual(service.getGuidancePlan('student-cn').preferences.focusAreas, ['计算机']);
  } finally { cleanup(); }
});


test('research findings retain conclusions and qualifications beyond short profile field limits', () => {
  const finding = '升学路径｜' + '已核实的公开要求。'.repeat(25) + '推断限制：仍需补充学生成绩，不能判断录取概率。';
  const result = validateResearchResult({ fetchedAt: '2026-09-30T08:00:00Z', findings: [finding], sources: [{ url: 'https://example.edu/admissions', summary: 'Official requirements' }] });
  assert.equal(result.ok, true); assert.equal(result.findings[0], finding);
});
