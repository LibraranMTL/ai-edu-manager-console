const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateTopicOutput, redact } = require('./structured-generation.cjs');
const researchContent = require('./research-content.cjs');
const { createPlanningFavorites } = require('./planning-favorites.cjs');

function researchExecutionContext(request = {}) {
  const context = request.executionContext || {};
  return Object.fromEntries(['taskId', 'executionId', 'researchRunId'].filter(key => typeof context[key] === 'string')
    .map(key => [key, context[key].slice(0, 200)]));
}

const TOPIC_SCHEMA = 'edu-manager.topic-suggestion-set.v1';
const GUIDANCE_SCHEMA = 'edu-manager.guidance-plan-version.v1';
const SNAPSHOT_SCHEMA = 'edu-manager.planning-evidence-snapshot.v1';
const RESEARCH_RESULT_SCHEMA = 'research.search.v1';
const TOPIC_GENERATOR_VERSION = 'personalized-v2';

function iso(value = new Date()) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function hash(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function fingerprint(value) {
  return hash(JSON.stringify(stable(value)));
}

function cleanText(value, max = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeStringArray(value, max = 20, maxText = 160) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => cleanText(item, maxText)).filter(Boolean))].slice(0, max);
}

function computeAge(birthDate, now = new Date()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(birthDate || ''));
  if (!match) return null;
  const birth = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(birth.getTime()) || birth > now) return null;
  let age = now.getFullYear() - birth.getFullYear();
  if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age -= 1;
  return age >= 0 && age <= 120 ? age : null;
}

function normalizePlanningProfile(student, now = new Date()) {
  const routes = normalizeStringArray(student.planningRoutes, 3).filter((item) => ['domestic', 'hongkong_macau', 'international'].includes(item));
  const birthDate = /^\d{4}-\d{2}-\d{2}$/.test(String(student.birthDate || '')) ? String(student.birthDate) : '';
  return {
    birthDate,
    computedAge: computeAge(birthDate, now),
    manualAgeBand: cleanText(student.manualAgeBand, 40),
    currentRegion: cleanText(student.currentRegion, 120),
    targetRegions: normalizeStringArray(student.targetRegions, 12),
    planningRoutes: routes,
    targetStage: cleanText(student.targetStage, 100),
    planningPreferences: normalizeStringArray(student.planningPreferences, 20),
    interests: normalizeStringArray(student.interests, 20),
    subjectStrengths: normalizeStringArray(student.subjectStrengths, 20),
    careerDirections: normalizeStringArray(student.careerDirections, 20),
  };
}

function deidentifyResearchInput(student, snapshot) {
  const profile = normalizePlanningProfile(student);
  return {
    schema: 'edu-manager.deidentified-planning-query.v1',
    grade: cleanText(student.grade, 60),
    age: profile.computedAge,
    ageBand: profile.computedAge === null ? profile.manualAgeBand : '',
    currentRegion: profile.currentRegion,
    targetRegions: profile.targetRegions,
    routes: profile.planningRoutes,
    targetStage: profile.targetStage,
    preferences: profile.planningPreferences,
    interests: profile.interests,
    subjectStrengths: profile.subjectStrengths,
    careerDirections: profile.careerDirections,
    learningSignals: normalizeStringArray(snapshot?.learningSignals, 12, 1200),
    confirmedGrowthSignals: normalizeStringArray(snapshot?.confirmedGrowthSignals, 12, 500),
    projectSignals: (snapshot?.projects || []).slice(0, 20).map((item) => ({
      type: cleanText(item.type, 80),
      status: cleanText(item.status, 40),
      contributionStatus: cleanText(item.contributionStatus, 40),
    })),
  };
}

function researchSource(source, fetchedAt) {
  let url;
  try { url = new URL(String(source?.url || '')); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol)) return null;
  const publishedAt = cleanText(source.publishedAt || source.updatedAt, 40);
  const effectiveFetchedAt = cleanText(source.fetchedAt || fetchedAt, 40);
  if (!effectiveFetchedAt || Number.isNaN(Date.parse(effectiveFetchedAt))) return null;
  return {
    url: url.toString(),
    title: cleanText(source.title, 240) || url.hostname,
    publisher: cleanText(source.publisher, 160),
    official: Boolean(source.official),
    region: cleanText(source.region, 100),
    publishedAt: publishedAt && !Number.isNaN(Date.parse(publishedAt)) ? publishedAt : '',
    fetchedAt: effectiveFetchedAt,
    summary: cleanText(source.summary, 800),
  };
}

function validateResearchResult(result, now = new Date()) {
  if (!result?.fetchedAt || Number.isNaN(Date.parse(result.fetchedAt))) return { ok: false, code: 'RESEARCH_TIME_INVALID', message: '联网研究未返回有效抓取时间。', sources: [] };
  const fetchedAt = iso(result.fetchedAt);
  const sources = (Array.isArray(result?.sources) ? result.sources : []).map((item) => researchSource(item, fetchedAt)).filter(Boolean);
  if (!sources.length) return { ok: false, code: 'RESEARCH_SOURCES_INVALID', message: '联网研究未返回可核验的 URL 和抓取时间。', sources: [] };
  return {
    ok: true,
    schema: RESEARCH_RESULT_SCHEMA,
    query: cleanText(result.query, 500),
    fetchedAt,
    sources,
    findings: [...new Set((Array.isArray(result.findings) ? result.findings : []).map((item) => cleanText(item, 2000)).filter(Boolean))].slice(0, 50),
    limitations: normalizeStringArray(result.limitations, 20),
    sections: researchContent.sections(result.sections, sources),
    competitions: result.competitions,
  };
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
}

function topicCandidate(id, category, student, snapshot, overrides = {}) {
  const profile = normalizePlanningProfile(student);
  const region = profile.currentRegion || '所在地区';
  const grade = cleanText(student.grade, 40) || '当前学段';
  const confirmed = snapshot.confirmedGrowthSignals[0] || '尚待从已确认成长证据中补充优势依据';
  return {
    id,
    category,
    title: overrides.title,
    realWorldProblem: overrides.realWorldProblem,
    fitReason: `${grade}学生可从${region}的真实情境切入；${overrides.fitReason || confirmed}。`,
    studentEvidence: [
      { kind: 'fact', text: `档案年级：${grade}`, sourceId: `student:${student.id}:grade` },
      student.goal ? { kind: 'fact', text: `档案目标：${cleanText(student.goal, 160)}`, sourceId: `student:${student.id}:goal` } : { kind: 'missing', text: '档案目标尚未填写', sourceId: '' },
      profile.currentRegion ? { kind: 'fact', text: `当前地区：${profile.currentRegion}`, sourceId: `student:${student.id}:currentRegion` } : { kind: 'missing', text: '当前地区尚未填写', sourceId: '' },
      profile.interests.length ? { kind: 'fact', text: `个人兴趣：${profile.interests.join('、')}`, sourceId: `student:${student.id}:interests` } : { kind: 'missing', text: '个人兴趣尚未填写', sourceId: '' },
      profile.subjectStrengths.length ? { kind: 'fact', text: `学科特长：${profile.subjectStrengths.join('、')}`, sourceId: `student:${student.id}:subjectStrengths` } : { kind: 'missing', text: '学科特长尚未填写', sourceId: '' },
      profile.careerDirections.length ? { kind: 'fact', text: `职业方向：${profile.careerDirections.join('、')}`, sourceId: `student:${student.id}:careerDirections` } : { kind: 'missing', text: '职业方向尚未填写', sourceId: '' },
      profile.planningPreferences.length ? { kind: 'fact', text: `规划偏好：${profile.planningPreferences.join('、')}`, sourceId: `student:${student.id}:planningPreferences` } : { kind: 'missing', text: '规划偏好尚未填写', sourceId: '' },
      profile.targetStage ? { kind: 'fact', text: `目标阶段：${profile.targetStage}`, sourceId: `student:${student.id}:targetStage` } : { kind: 'missing', text: '目标阶段尚未填写', sourceId: '' },
      snapshot.projects.length ? { kind: 'fact', text: `关联项目：${snapshot.projects.map((item) => item.name).filter(Boolean).slice(0, 3).join('、')}`, sourceId: `project:${snapshot.projects[0].id}` } : { kind: 'missing', text: '尚无关联项目活动', sourceId: '' },
      snapshot.confirmedGrowthSignals.length ? { kind: 'fact', text: confirmed, sourceId: snapshot.sourceIds.find((item) => item.includes('growth')) || '' } : { kind: 'missing', text: '尚无可用于确定能力结论的已确认成长证据', sourceId: '' },
      { kind: 'inference', text: overrides.inference, sourceId: '' },
    ],
    path: overrides.path,
    expectedOutcomes: overrides.expectedOutcomes,
    durationWeeks: overrides.durationWeeks,
    difficulty: overrides.difficulty,
    collaboration: overrides.collaboration,
    regionScope: profile.currentRegion || '待补充',
    resourceConditions: overrides.resourceConditions,
    safetyEthics: overrides.safetyEthics,
    feasibility: overrides.feasibility,
    verifyItems: overrides.verifyItems,
    freshness: { generatedAt: snapshot.updatedAt, evidenceUpdatedAt: snapshot.updatedAt, internetVerified: false },
  };
}


function personalizedTopicSuggestions(student, snapshot) {
  const profile = normalizePlanningProfile(student);
  const meaningful = (value) => {
    const text = cleanText(value, 80);
    const distinctive = text.replace(/日常|学习|资料|整理|成长|发展|项目|活动|规划|方向|待定|综合|能力|提高|提升|科创|实践|升学|社会|国际|暂无|未来/g, '').replace(/[，。、与和\s]/g, '');
    return text && distinctive.length >= 2;
  };
  const project = snapshot.projects.find((item) => meaningful(item.name));
  const focus = [profile.interests[0], profile.careerDirections[0], profile.planningPreferences[0], student.goal, project?.name, profile.subjectStrengths[0], snapshot.confirmedGrowthSignals[0]].find(meaningful);
  if (!focus) return [];
  const focusText = cleanText(focus, 60);
  const strength = cleanText(profile.subjectStrengths[0], 40);
  const career = cleanText(profile.careerDirections[0], 40);
  const strengthMethod = /语文|英语|语言|历史|地理|写作/.test(strength) ? '访谈、文本分析与来源核对'
    : /数学|物理|化学|生物|信息|编程/.test(strength) ? '测量、数据记录与重复验证'
    : strength ? `以“${strength}”为切入点设计可复核的方法` : '选择一个可复核的观察方法';
  const region = profile.currentRegion || '本地社区';
  const signals = [focusText, profile.careerDirections.join(' '), project?.name === focus ? project.name : '', student.goal === focus ? student.goal : ''].join(' ');
  const domain = /机器人|编程|人工智能|工程|传感器|机械/.test(signals) ? 'engineering'
    : /生态|环境|自然|气候|植物|动物|可持续/.test(signals) ? 'ecology'
    : /金融|经济|商业|消费|理财|创业/.test(signals) ? 'finance'
    : /写作|文学|阅读|语言|设计|艺术|音乐|历史|文化/.test(signals) ? 'culture'
    : /运动|体育|健康|医学|营养/.test(signals) ? 'wellbeing' : 'open';
  const themes = {
    engineering: { object: '校园日常任务', measure: '操作次数与完成时间', prototype: '低成本自动化原型', access: '青少年科技活动', action: '科技工具使用指南', safety: '设备用电及机械结构由成人核验' },
    ecology: { object: '校园或社区环境', measure: '同一地点的可重复环境指标', prototype: '低成本环境观察工具', access: '社区自然教育资源', action: '低干预环保行动', safety: '不采集受保护动植物，不进入危险区域' },
    finance: { object: '青少年日常消费选择', measure: '匿名情境下的预算与选择差异', prototype: '预算记录与决策辅助原型', access: '青少年财商教育资源', action: '消费信息辨识工作坊', safety: '不收集真实账户、交易记录或家庭财务信息；不提供投资建议' },
    culture: { object: '本地阅读与文化体验', measure: '匿名反馈与理解任务完成情况', prototype: '互动阅读或地方故事展示原型', access: '图书馆和公共文化资源', action: '地方故事共创活动', safety: '访谈和作品使用须取得同意，保留作者署名' },
    wellbeing: { object: '青少年日常运动安排', measure: '自愿记录的活动可达性与体验', prototype: '活动计划与反馈工具原型', access: '社区公共运动资源', action: '低门槛运动参与活动', safety: '不采集健康诊断，不以参与数据判断个人身体能力' },
    open: { object: `与“${focusText}”相关的真实问题`, measure: '可由学生自行复测的一个指标', prototype: `“${focusText}”主题的纸面或数字原型`, access: `与“${focusText}”相关的本地公共资源`, action: `“${focusText}”主题的学生参与活动`, safety: '不记录可识别个人信息；现场活动先确认许可' },
  }[domain];
  const basis = [
    `档案中的主题线索“${focusText}”`,
    profile.subjectStrengths.length ? `档案填写的学科特长“${profile.subjectStrengths[0]}”` : '尚缺学科特长信息',
    snapshot.learningSignals.length ? `学情资料线索“${snapshot.learningSignals[0]}”（需查看原报告确认具体知识点）` : '尚缺可用于选题的学情报告线索',
    snapshot.confirmedGrowthSignals.length ? `已确认成长依据“${snapshot.confirmedGrowthSignals[0]}”` : '尚缺已确认成长依据',
    profile.careerDirections.length ? `职业探索方向“${profile.careerDirections[0]}”` : '职业方向尚未填写',
    project ? `已有项目“${project.name}”` : '尚无关联项目',
    profile.targetStage ? `目标阶段“${profile.targetStage}”` : '目标阶段尚未填写',
    profile.planningRoutes.length ? `规划路径“${profile.planningRoutes.join('、')}”` : '规划路径尚未填写',
    profile.targetRegions.length ? `意向地区“${profile.targetRegions.join('、')}”` : '意向地区尚未填写',
    project?.objective ? `已有项目目标“${project.objective}”` : '尚无可引用的项目目标',
  ].join('；');
  const make = (id, category, data) => topicCandidate(`${id}-${snapshot.inputFingerprint.slice(0, 12)}`, category, student, snapshot, {
    ...data,
    fitReason: `${basis}；选题适配仍需学生确认`,
    inference: `依据${basis}形成候选研究方向；这不是已证实的能力或升学收益`,
    resourceConditions: ['纸笔或常用数字工具', '经许可的观察场地'],
    safetyEthics: [themes.safety, '不公布参与者身份及原始记录'],
    verifyItems: ['学生是否愿意持续投入该主题', '现场或访谈许可', '可用资源和真实问题边界'],
    feasibility: `先围绕${themes.object}完成一个小样本验证，再决定是否扩展。`,
  });
  return [
    make('science-observation', 'science_innovation', { title: `${focusText}：${themes.object}的可测量问题${strength ? `（${strength}视角）` : ''}`, realWorldProblem: `${themes.object}缺少可比较的${themes.measure}记录；需检验${strengthMethod}能否帮助解释差异。`, path: [project?.objective ? `从已有项目目标“${project.objective}”拆出一个可独立研究的问题` : `明确${themes.object}中的一个具体问题`, `结合档案填写的特长“${strength || '待确认'}”，采用${strengthMethod}`, `记录${themes.measure}的基线`, '控制一个变量做小规模对照', '复测并说明误差与局限'], expectedOutcomes: ['研究问题与数据表', '对照分析图', '复测记录'], durationWeeks: 5, difficulty: '中等', collaboration: '个人或2—3人团队' }),
    make('science-prototype', 'science_innovation', { title: `${focusText}：${themes.prototype}的设计与迭代${project ? `（衔接${project.name}）` : ''}`, realWorldProblem: `${themes.object}中的实际需求尚缺可测试的简易工具。`, path: ['访谈需求并取得同意', project?.objective ? `结合已有项目目标“${project.objective}”界定原型边界` : `确认${themes.object}的使用边界`, `制作${themes.prototype}`, '用同一任务检验第一版', '根据反馈迭代并记录无效设计'], expectedOutcomes: ['需求记录', '原型', '两轮测试与迭代说明'], durationWeeks: 6, difficulty: '入门至中等', collaboration: '个人或团队' }),
    make('social-access', 'social_practice', { title: `${region}${themes.access}可达性调研`, realWorldProblem: `${themes.access}的开放时间、参与门槛与学生实际需求可能不一致。`, path: [`核对${themes.access}的公开信息`, '制定匿名观察或访谈提纲', '记录不同条件下的参与门槛', '提出有证据边界的改进建议'], expectedOutcomes: ['资源清单', '匿名观察记录', '改进建议摘要'], durationWeeks: 4, difficulty: '入门', collaboration: '2—4人团队优先' }),
    make('social-action', 'social_practice', { title: `${focusText}：${themes.action}的小规模实践${career ? `（${career}探索）` : ''}`, realWorldProblem: `${themes.object}相关倡议缺少参与反馈和复核。`, path: ['和场地负责人确认活动边界', career ? `说明活动与档案所填“${career}”职业探索方向的关联及局限` : '确认参与者关心的实际问题', '记录开展前的匿名基线', `开展一次${themes.action}`, '收集自愿反馈并复核变化'], expectedOutcomes: ['活动方案', '匿名反馈', '效果与限制报告'], durationWeeks: 4, difficulty: '入门', collaboration: '个人或团队' }),
  ];
}

function defaultPreferences(student = {}) {
  const selected = normalizePlanningProfile(student).planningRoutes;
  const routes = selected.length ? Object.fromEntries(['domestic', 'hongkong_macau', 'international'].map((route) => [route, selected.includes(route)])) : { domestic: true, hongkong_macau: false, international: false };
  return { routes, automaticMonthlyCheck: true, targetRegions: normalizePlanningProfile(student).targetRegions, focusAreas: [], updatedAt: '' };
}

// A saved default from before profile editing must never override the student's
// explicit route or destination. Legacy preferences are fallback-only.
function effectivePreferences(student, saved = {}) {
  saved = saved && typeof saved === 'object' ? saved : {};
  const profile = normalizePlanningProfile(student);
  const defaults = defaultPreferences(student);
  const routes = profile.planningRoutes.length ? defaults.routes : {
    domestic: Boolean(saved.routes?.domestic ?? defaults.routes.domestic),
    hongkong_macau: Boolean(saved.routes?.hongkong_macau ?? defaults.routes.hongkong_macau),
    international: Boolean(saved.routes?.international ?? defaults.routes.international),
  };
  if (!Object.values(routes).some(Boolean)) routes.domestic = true;
  return { ...defaults, ...saved, routes,
    targetRegions: profile.targetRegions.length ? profile.targetRegions : normalizeStringArray(saved.targetRegions, 12),
    focusAreas: normalizeStringArray(saved.focusAreas, 20),
    routeSource: profile.planningRoutes.length ? 'student-profile' : 'legacy-fallback',
  };
}

function researchPreferencesFingerprint(preferences) {
  // Saving scheduling settings or updating a timestamp is not a new research input.
  return fingerprint({ routes: preferences.routes, targetRegions: preferences.targetRegions, focusAreas: preferences.focusAreas });
}

function shouldRunMonthlyCheck(lastCheckAt, now = new Date()) {
  if (!lastCheckAt || Number.isNaN(Date.parse(lastCheckAt))) return true;
  const last = new Date(lastCheckAt);
  return last.getFullYear() !== now.getFullYear() || last.getMonth() !== now.getMonth();
}

function createPlanningGuidanceService(options) {
  const now = options.now || (() => new Date());
  const resolveStudent = options.resolveStudent;
  const listStudents = options.listStudents || (() => []);
  const listProjects = options.listProjects || (() => []);
  const resolveStudentDir = options.resolveStudentDir;
  const evidenceProvider = options.evidenceProvider || (() => ({}));
  const researchProviders = options.researchProviders || (() => []);
  const authorizeResearch = options.authorizeResearch || (() => {});
  const pendingGuidance = new Map();
  const pendingTopics = new Map();
  const pendingCompetitions = new Map();

  function requireStudent(studentId) {
    const student = resolveStudent(String(studentId || ''));
    if (!student || String(student.id) !== String(studentId || '')) {
      const error = new Error('未找到当前学生，或学生范围已变化。');
      error.code = 'STUDENT_SCOPE_INVALID';
      throw error;
    }
    return student;
  }

  function planningDir(student) { return path.join(resolveStudentDir(student), 'planning-guidance'); }
  function fileFor(student, name) { return path.join(planningDir(student), name); }
  function readStore(student) {
    return readJson(fileFor(student, 'store.json'), { schema: 'edu-manager.planning-guidance-store.v1', topicSets: [], guidanceVersions: [], checks: [], drafts: {}, preferences: defaultPreferences(student) });
  }
  function writeStore(student, store) {
    writeJsonAtomic(fileFor(student, 'store.json'), { ...store, schema: 'edu-manager.planning-guidance-store.v1', updatedAt: iso(now()) });
  }
  const favorites = createPlanningFavorites({ requireStudent, resolveStudentDir, readStore, now });

  function evidenceSnapshot(student, projectList = listProjects()) {
    const at = iso(now());
    const profile = normalizePlanningProfile(student, now());
    const projects = projectList.filter((project) => (project.studentIds || []).map(String).includes(String(student.id))).map((project) => ({
      id: String(project.id), name: cleanText(project.name, 120), type: cleanText(project.type, 80), objective: cleanText(project.objective, 160), status: cleanText(project.status, 40), updatedAt: cleanText(project.updatedAt, 40), contributionStatus: cleanText(project.dashboard?.contributionStatus || (project.publishedAt ? 'published' : ''), 40),
    }));
    const evidence = evidenceProvider(student) || {};
    const sourceIds = [
      `student:${student.id}:profile`,
      ...projects.map((project) => `project:${project.id}`),
      ...normalizeStringArray(evidence.sourceIds, 100),
    ];
    const payload = {
      schema: SNAPSHOT_SCHEMA,
      studentId: String(student.id),
      profile: { grade: cleanText(student.grade, 60), goal: cleanText(student.goal, 300), ...profile },
      projects,
      learningSignals: normalizeStringArray(evidence.learningSignals, 20, 1200),
      confirmedGrowthSignals: normalizeStringArray(evidence.confirmedGrowthSignals, 20, 500),
      reportIds: normalizeStringArray(evidence.reportIds, 50),
      sourceIds,
      confirmedOnly: true,
      updatedAt: at,
    };
    return { ...payload, inputFingerprint: fingerprint({ ...payload, updatedAt: undefined }) };
  }

  function getTopicSuggestions(studentId) {
    const student = requireStudent(studentId);
    const store = readStore(student);
    const current = store.topicSets[0] || null;
    const snapshot = evidenceSnapshot(student);
    const expectedGenerator = options.topicGenerator ? 'agent-personalized-v1' : TOPIC_GENERATOR_VERSION;
    const needsRefresh = !current || current.inputFingerprint !== snapshot.inputFingerprint || current.generatorVersion !== expectedGenerator;
    return { ok: true, current: needsRefresh && !options.topicGenerator ? null : current, needsRefresh, historyCount: store.topicSets.length, draftSuggestionIds: Object.keys(store.drafts || {}), message: needsRefresh && current ? '学生资料或生成方式已更新；历史建议保留，但尚未完成最新 Agent 生成。' : '' };
  }

  function refreshTopicSuggestions(studentId, request = {}) {
    const student = requireStudent(studentId);
    const snapshot = evidenceSnapshot(student);
    const store = readStore(student);
    const existing = store.topicSets[0];
    if (existing?.inputFingerprint === snapshot.inputFingerprint && existing.generatorVersion === TOPIC_GENERATOR_VERSION) {
      return { ok: true, unchanged: true, current: existing, message: '学生资料与确认依据没有实质变化，保留当前建议版本。' };
    }
    const createdAt = iso(now());
    const candidates = personalizedTopicSuggestions(student, snapshot);
    const set = {
      schema: TOPIC_SCHEMA,
      id: `topic-${createdAt.replace(/\D/g, '').slice(0, 14)}-${snapshot.inputFingerprint.slice(0, 8)}`,
      version: Number(existing?.version || 0) + 1,
      studentId: String(student.id),
      generatorVersion: TOPIC_GENERATOR_VERSION,
      inputFingerprint: snapshot.inputFingerprint,
      evidenceSnapshot: snapshot,
      createdAt,
      candidates,
      generationMode: 'local_evidence_based',
      notice: candidates.length ? '候选由当前学生的兴趣、规划、项目和已确认依据生成；未进行互联网事实核验。采用只会准备项目草稿。' : '当前仅有通用年级/地区资料，无法形成有学生特色的选题。请在学生档案补充具体兴趣、职业方向、规划偏好或项目目标。',
    };
    store.topicSets = [set, ...(store.topicSets || [])].slice(0, 50);
    store.checks = [{ id: `topic-check-${Date.now()}`, taskType: 'topic_suggestion_refresh', studentId: String(student.id), status: 'succeeded', at: createdAt, inputFingerprint: snapshot.inputFingerprint }, ...(store.checks || [])].slice(0, 200);
    writeStore(student, store);
    return { ok: true, unchanged: false, current: set, message: candidates.length ? `已根据当前学生资料生成 ${candidates.length} 个待选主题。` : '个性化资料不足，暂不生成通用模板题目。' };
  }

  function refreshAgentTopicSuggestions(studentId, request = {}) {
    if (!options.topicGenerator) return Promise.resolve(refreshTopicSuggestions(studentId, request));
    const student = requireStudent(studentId), snapshot = evidenceSnapshot(student);
    const key = `${student.id}:${snapshot.inputFingerprint}`;
    if (pendingTopics.has(key)) return pendingTopics.get(key);
    const work = (async () => {
      const previous = readStore(student).topicSets[0];
      if (previous?.inputFingerprint === snapshot.inputFingerprint && previous.generatorVersion === 'agent-personalized-v1') return { ok: true, unchanged: true, current: previous, message: '输入没有实质变化，保留当前 Agent 建议。' };
      const receipt = { id: `topic-agent-${crypto.randomUUID()}`, taskType: 'topic_suggestion_refresh', studentId: String(student.id), inputFingerprint: snapshot.inputFingerprint, at: iso(now()) };
      try {
        const local = personalizedTopicSuggestions(student, snapshot);
        if (!local.length) throw Error('缺少个人兴趣、职业方向或可追溯学生依据，暂不生成通用选题');
        const evidence = local[0].studentEvidence.filter(item => item.kind === 'fact').map((item, index) => ({ ref: `E${index}`, text: redact(item.text, student), sourceId: item.sourceId }));
        snapshot.learningSignals.forEach((text, index) => evidence.push({ ref: `L${index}`, text: redact(text, student), sourceId: snapshot.sourceIds.filter(id => id.startsWith('report:'))[index] || snapshot.sourceIds[0] }));
        const input = { profile: JSON.parse(redact(deidentifyResearchInput(student, snapshot), student)), evidence: evidence.map(({ sourceId, ...item }) => item),
          projects: snapshot.projects.map(item => ({ type: item.type, objective: redact(item.objective, student), status: item.status })) };
        const result = await options.topicGenerator({ input, signal: request.signal,
          instruction: '根据兴趣、学科特长、升学路径、职业方向、报告与已确认成长证据设计 2—8 个真正个性化课题；科创和社会实践都要有。解释取舍、具体实施路径、安全伦理和待核实项。evidenceRefs 只能引用输入 ref。推断不能当档案事实。' });
        const generated = validateTopicOutput(result, input);
        const currentStudent = requireStudent(studentId);
        if (evidenceSnapshot(currentStudent).inputFingerprint !== snapshot.inputFingerprint) throw Error('生成期间学生资料已变化，结果未保存，请重试');
        const createdAt = iso(now()), store = readStore(student);
        const set = { schema: TOPIC_SCHEMA, id: `topic-agent-${crypto.randomUUID()}`, version: Number(store.topicSets[0]?.version || 0) + 1,
          studentId: String(student.id), inputFingerprint: snapshot.inputFingerprint, generatorVersion: 'agent-personalized-v1', generationMode: 'agent_evidence_based', evidenceSnapshot: snapshot, createdAt,
          candidates: generated.map((value, index) => ({ ...value, id: `topic-${hash(`${key}:${value.title}:${index}`).slice(0, 24)}`, regionScope: snapshot.profile.currentRegion || '待补充',
            studentEvidence: [...value.evidenceRefs.map(ref => { const item = evidence.find(item => item.ref === ref); return { kind: 'fact', text: item.text, sourceId: item.sourceId }; }), { kind: 'inference', text: value.inference, sourceId: '' }],
            freshness: { generatedAt: createdAt, evidenceUpdatedAt: snapshot.updatedAt, internetVerified: false } })),
          notice: '已由 Agent 依据本学生去标识证据生成并通过结构与来源范围校验；不是确定性能力或升学结论。未联网核验具体政策，采用只准备草稿。' };
        store.topicSets = [set, ...store.topicSets].slice(0, 50); store.checks = [{ ...receipt, status: 'succeeded' }, ...store.checks].slice(0, 200); writeStore(student, store);
        return { ok: true, current: set, message: '个性化 Agent 选题已生成。' };
      } catch (error) {
        const store = readStore(requireStudent(studentId)); store.checks = [{ ...receipt, status: 'failed', message: cleanText(error.message, 300) }, ...store.checks].slice(0, 200); writeStore(student, store);
        return { ok: false, current: store.topicSets[0] || null, message: `最新生成未完成：${error.message}；历史建议保留。` };
      }
    })().finally(() => pendingTopics.delete(key));
    pendingTopics.set(key, work); return work;
  }

  function prepareProjectDraftFromSuggestion(studentId, suggestionId, versionId) {
    const student = requireStudent(studentId);
    const store = readStore(student);
    const saved = favorites.getPlanningFavorites(studentId, 'topics').favorites.find(item => item.candidateId === String(suggestionId || '') && (!versionId || item.versionId === versionId));
    const candidate = (versionId && saved?.candidate)
      || (store.topicSets || []).filter(set => !versionId || set.id === versionId).flatMap(set => set.candidates || []).find(item => item.id === String(suggestionId || ''))
      || saved?.candidate;
    if (!candidate) return { ok: false, code: 'SUGGESTION_NOT_FOUND', message: '未找到该建议，可能已切换学生或版本。' };
    const existing = store.drafts?.[candidate.id];
    if (existing) return { ok: true, restored: true, draft: existing, message: '已恢复同一建议对应的项目草稿，没有重复创建项目。' };
    const draft = {
      id: `suggestion-draft-${hash(`${student.id}|${candidate.id}`).slice(0, 20)}`,
      suggestionId: candidate.id,
      studentId: String(student.id),
      name: candidate.title,
      type: candidate.category === 'science_innovation' ? '科创项目' : '社会实践',
      description: candidate.realWorldProblem,
      objective: candidate.expectedOutcomes.join('、'),
      researchQuestion: candidate.realWorldProblem,
      workspaceTemplateId: candidate.category === 'science_innovation' ? 'research' : 'standard',
      growthStrategy: `依据：${candidate.fitReason}。仅记录后续确认的过程证据，不从单次成功推断稳定能力。`,
      deliverables: candidate.expectedOutcomes,
      studentIds: [String(student.id)],
      createdAt: iso(now()),
      status: 'prepared_only',
    };
    store.drafts = { ...(store.drafts || {}), [candidate.id]: draft };
    writeStore(student, store);
    return { ok: true, restored: false, draft, message: '已准备项目草稿；点击原有“创建学习项目”后才会创建项目。' };
  }

  function getResearchCapabilityStatus() {
    const providers = researchProviders().map((provider) => ({
      id: cleanText(provider.id, 80), label: cleanText(provider.label || provider.id, 120), available: Boolean(provider.available), authorized: Boolean(provider.authorized), webResearch: Boolean(provider.webResearch && typeof provider.search === 'function'), structuredResult: Boolean(provider.structuredResult && typeof provider.search === 'function'), healthMessage: cleanText(provider.healthMessage, 300),
    }));
    const usable = providers.filter((item) => item.available && item.authorized && item.webResearch && item.structuredResult);
    return { ok: true, available: usable.length > 0, providers, usableProviderIds: usable.map((item) => item.id), checkedAt: iso(now()), message: usable.length ? `可用联网研究执行器：${usable.map((item) => item.label).join('、')}` : '未发现已登录并接通研究接口的执行器。请登录 Codex CLI 后重试。' };
  }

  function getGuidancePlan(studentId) {
    const student = requireStudent(studentId);
    const store = readStore(student);
    const preferences = effectivePreferences(student, store.preferences);
    const current = store.guidanceVersions[0] || null;
    const routes = Object.keys(preferences.routes).filter((route) => preferences.routes[route]);
    const configurationMismatch = Boolean(current && (
      fingerprint([...(current.routes || [])].sort()) !== fingerprint([...routes].sort()) ||
      fingerprint([...(current.targetRegions || [])].sort()) !== fingerprint([...preferences.targetRegions].sort())
    ));
    const labels = { domestic: '境内', hongkong_macau: '港澳', international: '国际' };
    const configurationWarning = configurationMismatch
      ? `历史规划使用的路径或目标地区与当前档案不一致。当前路径：${routes.map((route) => labels[route]).join('、')}；历史版本路径：${(current.routes || []).map((route) => labels[route] || route).join('、') || '未记录'}。旧版原文已保留，请点击“手动更新”按当前资料重新联网核验。`
      : '';
    return { ok: true, current, preferences, configurationMismatch, configurationWarning, latestCheck: store.checks.find((item) => item.taskType === 'guidance_research_check') || null };
  }

  function refreshGuidancePlan(studentId, request = {}) {
    const key = String(studentId);
    if (pendingGuidance.has(key)) return pendingGuidance.get(key).promise;
    const controller = new AbortController();
    const signal = request.signal ? AbortSignal.any([controller.signal, request.signal]) : controller.signal;
    const promise = performGuidanceRefresh(studentId, { ...request, signal }).finally(() => pendingGuidance.delete(key));
    pendingGuidance.set(key, { promise, controller });
    return promise;
  }

  function cancelGuidanceResearch(studentId) {
    requireStudent(studentId);
    const task = pendingGuidance.get(String(studentId)); task?.controller.abort();
    return { ok: true, message: task ? '已请求取消规划研究；历史版本不受影响。' : '当前没有执行中的规划研究。' };
  }
  async function performGuidanceRefresh(studentId, request = {}) {
    const student = requireStudent(studentId);
    const snapshot = evidenceSnapshot(student);
    let store = readStore(student);
    const preferences = effectivePreferences(student, store.preferences);
    const preferencesFingerprint = researchPreferencesFingerprint(preferences);
    const guidanceInputFingerprint = fingerprint({ evidence: snapshot.inputFingerprint, preferences: preferencesFingerprint });
    const capabilities = getResearchCapabilityStatus();
    const checkedAt = iso(now());
    const baseReceipt = { ...researchExecutionContext(request), id: `guidance-check-${Date.now()}-${snapshot.inputFingerprint.slice(0, 8)}`, taskType: 'guidance_research_check', studentId: String(student.id), trigger: cleanText(request.trigger || 'manual', 40), checkedAt, inputFingerprint: guidanceInputFingerprint };
    const provider = researchProviders().find((item) => capabilities.usableProviderIds.includes(item.id) && typeof item.search === 'function');
    if (!provider) {
      const receipt = { ...baseReceipt, status: 'unavailable', code: 'RESEARCH_CAPABILITY_UNAVAILABLE', message: capabilities.message };
      store.checks = [receipt, ...(store.checks || [])].slice(0, 200);
      writeStore(student, store);
      return { ok: false, retainedPrevious: Boolean(store.guidanceVersions[0]), current: store.guidanceVersions[0] || null, capability: capabilities, receipt, message: store.guidanceVersions[0] ? '未完成最新联网核验；已保留上一有效版本。' : '尚无规划版本；请连接可用研究执行器后点击手动更新。' };
    }
    try {
      const queryInput = deidentifyResearchInput(student, snapshot);
      queryInput.routes = Object.keys(preferences.routes).filter((route) => preferences.routes[route]);
      queryInput.targetRegions = preferences.targetRegions;
      queryInput.focusAreas = preferences.focusAreas;
      queryInput.purpose = 'guidance';
      authorizeResearch(studentId);
      const raw = await provider.search({ schema: 'research.search.request.v1', queryInput: JSON.parse(redact(queryInput, student)), timeoutMs: 300_000, signal: request.signal });
      authorizeResearch(studentId);
      if (request.signal?.aborted) throw Object.assign(new Error('研究已取消，历史版本不受影响。'), { code: 'RESEARCH_CANCELLED' });
      const currentStudent = requireStudent(studentId);
      const latestStore = readStore(currentStudent);
      if (evidenceSnapshot(currentStudent).inputFingerprint !== snapshot.inputFingerprint || researchPreferencesFingerprint(effectivePreferences(currentStudent, latestStore.preferences)) !== preferencesFingerprint) {
        throw Object.assign(new Error('研究期间学生资料或规划设置已变化，请重新更新。'), { code: 'RESEARCH_INPUT_CHANGED' });
      }
      store = latestStore;
      const research = validateResearchResult(raw, now());
      if (!research.ok) throw Object.assign(new Error(research.message), { code: research.code });
      const sourceFingerprint = fingerprint(research.sources.map((item) => ({ url: item.url, publishedAt: item.publishedAt, summary: item.summary })));
      const current = store.guidanceVersions[0];
      if (current?.inputFingerprint === guidanceInputFingerprint && current?.sourceFingerprint === sourceFingerprint && (current?.structureVersion || null) === (research.sections ? researchContent.VERSION : null)) {
        const receipt = { ...baseReceipt, status: 'unchanged', sourceFingerprint, providerId: provider.id, message: '输入和来源没有实质变化，未生成措辞不同的新版本。' };
        store.checks = [receipt, ...(store.checks || [])].slice(0, 200);
        writeStore(student, store);
        return { ok: true, unchanged: true, current, receipt, capability: capabilities, message: receipt.message };
      }
      const profile = normalizePlanningProfile(student, now());
      const findings = research.findings.length ? research.findings : research.sources.map((item) => item.summary).filter(Boolean);
      const version = {
        schema: GUIDANCE_SCHEMA,
        structureVersion: research.sections ? researchContent.VERSION : null,
        sections: research.sections,
        id: `guidance-${checkedAt.replace(/\D/g, '').slice(0, 14)}-${sourceFingerprint.slice(0, 8)}`,
        version: Number(current?.version || 0) + 1,
        studentId: String(student.id),
        inputFingerprint: guidanceInputFingerprint,
        sourceFingerprint,
        evidenceSnapshot: snapshot,
        createdAt: checkedAt,
        verifiedAt: research.fetchedAt,
        researchProviderId: provider.id,
        routes: queryInput.routes,
        currentRegion: profile.currentRegion,
        targetRegions: queryInput.targetRegions,
        studentBasis: [cleanText(student.grade, 60), ...snapshot.confirmedGrowthSignals].filter(Boolean),
        findings,
        sources: research.sources,
        conditions: ['招生与培养要求以对应主管部门和院校最新官方页面为准', '学生目标、地区或项目经历变化后应立即复核'],
        limitations: [...research.limitations, ...(snapshot.confirmedGrowthSignals.length ? [] : ['当前已确认成长证据不足，不能据此形成确定性能力结论'])],
        alternatives: ['保留至少一条不同路径的备选方案', '无法完成最新联网核验时继续使用上一有效版本，不自动执行申请'],
        nearTermActions: ['补齐档案中的目标地区与规划路径', '核对官方来源的适用届别和截止时间', '选择一项可在四周内积累新证据的学习或项目行动'],
        reviewAt: new Date(now().getFullYear(), now().getMonth() + 1, 1).toISOString(),
        changesFromPrevious: current ? ['学生输入或官方来源发生实质变化，已生成新版本'] : ['首次生成经联网核验的规划版本'],
        status: 'verified',
      };
      const receipt = { ...baseReceipt, status: 'succeeded', providerId: provider.id, sourceFingerprint, guidanceVersionId: version.id };
      store.guidanceVersions = [version, ...(store.guidanceVersions || [])].slice(0, 100);
      store.checks = [receipt, ...(store.checks || [])].slice(0, 200);
      writeStore(student, store);
      return { ok: true, unchanged: false, current: version, receipt, capability: capabilities, message: '已生成新的联网核验规划版本。' };
    } catch (error) {
      store = readStore(requireStudent(studentId));
      const receipt = { ...baseReceipt, status: 'failed', code: cleanText(error.code || 'RESEARCH_FAILED', 80), message: cleanText(error.message, 500) };
      store.checks = [receipt, ...(store.checks || [])].slice(0, 200);
      writeStore(student, store);
      return { ok: false, retainedPrevious: Boolean(store.guidanceVersions[0]), current: store.guidanceVersions[0] || null, capability: capabilities, receipt, message: `${receipt.message} ${store.guidanceVersions[0] ? '已保留上一有效版本。' : '尚未生成规划版本。'}` };
    }
  }

  function getCompetitionRecommendations(studentId) {
    const student = requireStudent(studentId), store = readStore(student);
    const current = store.competitionSets?.[0] || null;
    return { ok: true, current, versions: store.competitionSets || [], preferences: { automaticMonthlyCheck: true, ...(store.competitionPreferences || {}) }, latestCheck: (store.checks || []).find(x => x.taskType === 'competition_research_check') || null,
      needsRefresh: Boolean(current && current.inputFingerprint !== evidenceSnapshot(student).inputFingerprint) };
  }
  function saveCompetitionPreferences(studentId, patch = {}) {
    const student = requireStudent(studentId), store = readStore(student);
    store.competitionPreferences = { automaticMonthlyCheck: patch.automaticMonthlyCheck !== false };
    writeStore(student, store); return getCompetitionRecommendations(studentId);
  }
  function refreshCompetitionRecommendations(studentId, request = {}) {
    const key = String(studentId);
    if (pendingCompetitions.has(key)) return pendingCompetitions.get(key).promise;
    const controller = new AbortController();
    const signal = request.signal ? AbortSignal.any([controller.signal, request.signal]) : controller.signal;
    const promise = performCompetitionRefresh(studentId, { ...request, signal }).finally(() => pendingCompetitions.delete(key));
    pendingCompetitions.set(key, { promise, controller }); return promise;
  }
  function cancelCompetitionResearch(studentId) {
    requireStudent(studentId);
    const pending = pendingCompetitions.get(String(studentId));
    pending?.controller.abort();
    return { ok: true, message: pending ? '已请求取消比赛研究；历史版本不受影响。' : '当前没有执行中的比赛研究。' };
  }
  async function performCompetitionRefresh(studentId, request) {
    const student = requireStudent(studentId), snapshot = evidenceSnapshot(student);
    let store = readStore(student);
    const preferencesFingerprint = fingerprint(store.competitionPreferences || {});
    const checkedAt = iso(now());
    const base = { ...researchExecutionContext(request), id: `competition-check-${crypto.randomUUID()}`, taskType: 'competition_research_check', studentId: String(student.id), checkedAt, inputFingerprint: snapshot.inputFingerprint, trigger: cleanText(request.trigger || 'manual', 40) };
    try {
      const capability = getResearchCapabilityStatus();
      const provider = researchProviders().find(x => capability.usableProviderIds.includes(x.id));
      if (!provider) throw new Error(capability.message);
      const queryInput = JSON.parse(redact({ ...deidentifyResearchInput(student, snapshot), purpose: 'competition_recommendation' }, student));
      authorizeResearch(studentId);
      const raw = await provider.search({ schema: 'research.search.request.v1', queryInput, timeoutMs: 180000, signal: request.signal });
      authorizeResearch(studentId);
      if (request.signal?.aborted) throw new Error('比赛研究已取消');
      const latestStudent = requireStudent(studentId);
      store = readStore(latestStudent);
      if (evidenceSnapshot(latestStudent).inputFingerprint !== snapshot.inputFingerprint || fingerprint(store.competitionPreferences || {}) !== preferencesFingerprint) throw new Error('研究期间学生资料或比赛更新设置已变化，请重新更新');
      const research = validateResearchResult(raw, now());
      if (!research.ok) throw new Error(research.message);
      const candidates = researchContent.competitions(research.competitions, research.sources, now());
      const current = store.competitionSets?.[0] || null;
      const sourceFingerprint = fingerprint(research.sources.map(x => ({ url: x.url, summary: x.summary, publishedAt: x.publishedAt })));
      let receipt, version = current;
      if (!candidates.length) receipt = { ...base, status: 'no_results', message: '本次未找到可核验且匹配的比赛，保留历史版本；历史版本不表示仍在报名。' };
      else if (current?.inputFingerprint === snapshot.inputFingerprint && current.sourceFingerprint === sourceFingerprint) receipt = { ...base, status: 'unchanged', message: '学生资料与官方来源未变，只保存检查回执。' };
      else {
        version = { schema: 'edu-manager.competition-recommendation-set.v1', id: `competitions-${crypto.randomUUID()}`, version: Number(current?.version || 0) + 1, studentId: String(student.id), inputFingerprint: snapshot.inputFingerprint, sourceFingerprint, createdAt: checkedAt, verifiedAt: research.fetchedAt, candidates, sources: research.sources, limitations: research.limitations, providerId: provider.id };
        store.competitionSets = [version, ...(store.competitionSets || [])];
        receipt = { ...base, status: 'succeeded', versionId: version.id, message: '已保存个性化比赛推荐版本；不自动报名。' };
      }
      store.checks = [receipt, ...(store.checks || [])].slice(0, 200); writeStore(latestStudent, store);
      return { ...getCompetitionRecommendations(studentId), current: version, receipt, message: receipt.message };
    } catch (error) {
      store = readStore(requireStudent(studentId));
      const receipt = { ...base, status: 'failed', code: cleanText(error.code || 'COMPETITION_RESEARCH_FAILED', 80), message: cleanText(error.message, 500) };
      store.checks = [receipt, ...(store.checks || [])].slice(0, 200); writeStore(student, store);
      return { ...getCompetitionRecommendations(studentId), ok: false, receipt, message: `${receipt.message}；未完成最新联网核验，保留历史版本。` };
    }
  }
  function preparePlanningShare(studentId, kind) {
    if (!['topics', 'guidance'].includes(kind)) throw new Error('不支持的分享类型');
    const student = requireStudent(studentId), store = readStore(student);
    const value = kind === 'topics' ? store.topicSets[0] : store.guidanceVersions[0];
    const check = store.checks.find(x => x.taskType === 'guidance_research_check');
    return { ok: true, ...researchContent.shareDocument(kind, value, student, check) };
  }
  function competitionTaskCandidates() {
    const candidates = [];
    for (const student of listStudents()) {
      const store = readStore(student);
      if (store.competitionPreferences?.automaticMonthlyCheck === false) continue;
      const snapshot = evidenceSnapshot(student);
      const last = (store.checks || []).find(x => x.taskType === 'competition_research_check');
      const monthly = shouldRunMonthlyCheck(last?.checkedAt, now());
      const changed = last?.inputFingerprint !== snapshot.inputFingerprint;
      const retry = last?.status === 'failed' && now().getTime() - Date.parse(last.checkedAt) >= 86400000;
      if (monthly || changed || retry) candidates.push({ taskType: 'competition_research_check', studentId: String(student.id), sourceName: student.name, scheduledAt: student.digestTime || '21:30', due: true,
        idempotencyKey: `competition_research_check:${student.id}:${snapshot.inputFingerprint}:${now().getFullYear()}-${now().getMonth() + 1}`, trigger: changed ? 'evidence_changed' : 'monthly' });
    }
    return candidates;
  }
  function getGuidanceHistory(studentId) {
    const student = requireStudent(studentId);
    const store = readStore(student);
    return { ok: true, versions: store.guidanceVersions || [], checks: store.checks || [] };
  }

  function saveGuidancePreferences(studentId, patch = {}) {
    const student = requireStudent(studentId);
    const store = readStore(student);
    const routes = patch.routes && typeof patch.routes === 'object' ? {
      domestic: Boolean(patch.routes.domestic), hongkong_macau: Boolean(patch.routes.hongkong_macau), international: Boolean(patch.routes.international),
    } : { ...defaultPreferences(student).routes, ...(store.preferences?.routes || {}) };
    if (!Object.values(routes).some(Boolean)) routes.domestic = true;
    store.preferences = effectivePreferences(student, {
      ...defaultPreferences(student), ...(store.preferences || {}), routes,
      automaticMonthlyCheck: patch.automaticMonthlyCheck === undefined ? store.preferences?.automaticMonthlyCheck !== false : Boolean(patch.automaticMonthlyCheck),
      targetRegions: normalizeStringArray(patch.targetRegions ?? store.preferences?.targetRegions, 12),
      focusAreas: normalizeStringArray(patch.focusAreas ?? store.preferences?.focusAreas, 20),
      updatedAt: iso(now()),
    });
    writeStore(student, store);
    return { ok: true, preferences: store.preferences, message: '规划更新偏好已保存。' };
  }

  function taskCandidates() {
    const result = [];
    const projectList = listProjects();
    for (const student of listStudents()) {
      const store = readStore(student);
      const snapshot = evidenceSnapshot(student, projectList);
      const topicCurrent = store.topicSets?.[0];
      result.push({ taskType: 'topic_suggestion_refresh', studentId: String(student.id), sourceName: student.name, due: !topicCurrent || topicCurrent.inputFingerprint !== snapshot.inputFingerprint || topicCurrent.generatorVersion !== TOPIC_GENERATOR_VERSION, idempotencyKey: `topic_suggestion_refresh:${student.id}:${TOPIC_GENERATOR_VERSION}:${snapshot.inputFingerprint}` });
      const lastCheck = (store.checks || []).find((item) => item.taskType === 'guidance_research_check');
      if ((store.preferences?.automaticMonthlyCheck ?? true) && shouldRunMonthlyCheck(lastCheck?.checkedAt, now())) {
        result.push({ taskType: 'guidance_research_check', studentId: String(student.id), sourceName: student.name, due: true, idempotencyKey: `guidance_research_check:${student.id}:${now().getFullYear()}-${String(now().getMonth() + 1).padStart(2, '0')}` });
        result.push({ taskType: 'guidance_plan_refresh', studentId: String(student.id), sourceName: student.name, due: true, idempotencyKey: `guidance_plan_refresh:${student.id}:${snapshot.inputFingerprint}:${now().getFullYear()}-${String(now().getMonth() + 1).padStart(2, '0')}` });
      }
    }
    return [...result, ...competitionTaskCandidates()];
  }

  function getStudentOverview() {
    const projects = listProjects();
    return { ok: true, generatedAt: iso(now()), students: listStudents().map((student) => ({
      id: String(student.id), name: cleanText(student.name, 100), grade: cleanText(student.grade, 60), school: cleanText(student.school, 120), currentRegion: cleanText(student.currentRegion, 120), targetStage: cleanText(student.targetStage, 100), pendingDigestCount: Number(student.pendingDigestCount || 0), lastDigestAt: cleanText(student.lastDigestAt, 40), projectCount: projects.filter((project) => (project.studentIds || []).map(String).includes(String(student.id))).length,
    })) };
  }

  return { evidenceSnapshot, getTopicSuggestions, refreshTopicSuggestions, refreshAgentTopicSuggestions, prepareProjectDraftFromSuggestion, getGuidancePlan, refreshGuidancePlan, getGuidanceHistory, saveGuidancePreferences, getResearchCapabilityStatus, getStudentOverview, taskCandidates,
    getCompetitionRecommendations, refreshCompetitionRecommendations, cancelCompetitionResearch, cancelGuidanceResearch, saveCompetitionPreferences, competitionTaskCandidates, preparePlanningShare, ...favorites };
}

module.exports = {
  GUIDANCE_SCHEMA,
  RESEARCH_RESULT_SCHEMA,
  SNAPSHOT_SCHEMA,
  TOPIC_SCHEMA,
  computeAge,
  createPlanningGuidanceService,
  deidentifyResearchInput,
  normalizePlanningProfile,
  shouldRunMonthlyCheck,
  validateResearchResult,
};
