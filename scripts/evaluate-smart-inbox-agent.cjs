'use strict';
// Sends only an explicitly synthetic fixture to the selected authorized CLI.
const fs = require('node:fs');
const path = require('node:path');
const { createRoutingAgent } = require('../electron/smart-inbox-agent.cjs');
const { automaticTarget } = require('../electron/smart-inbox-policy.cjs');
const args = process.argv.slice(2);
const executable = args[0];
const reportPath = args[1] && !args[1].startsWith('--') ? path.resolve(args[1]) : '';
const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : ''; };
const fixturePath = path.resolve(option('--fixture') || path.join(__dirname, '../tests/fixtures/smart-inbox-live-evaluation-v2.json'));
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const adapterId = args.includes('--workbuddy') ? 'workbuddy' : 'codex';
if (!executable || !path.isAbsolute(executable)) throw Error('需提供已授权分类 Agent 可执行文件的绝对路径');
const requestedIds = option('--ids');
const ids = new Set((requestedIds || fixture.cases.map(value => value.id).join(',')).split(',').filter(Boolean));
const projects = fixture.projects.map(p => ({ ...p, studentIds: [fixture.studentId], identifiers: [p.id, p.name, ...p.aliases], categories: [], materialTerms: [], knowledgeTerms: [] }));
const context = { studentId: fixture.studentId, projects, profile: { summary: '', source: 'synthetic' } };
let runtime = null;
let runtimeReady = Promise.resolve();
if (adapterId === 'workbuddy') {
  const workBuddy = require('../electron/workbuddy-runtime.cjs');
  // `executable` is the authorized CLI descriptor path.  Runtime discovery
  // needs the desktop installation to locate its product configuration and
  // node launcher; never mistake the two paths for one another.
  const desktopExecutable = option('--desktop-exe') || process.env.WORKBUDDY_DESKTOP_EXE || 'D:/Program Files/WorkBuddy/WorkBuddy.exe';
  runtime = workBuddy.discoverWorkBuddyRuntime(desktopExecutable, { findExecutable: () => process.execPath });
  if (!runtime.available) throw Error('未找到 WorkBuddy 桌面运行时；可通过 --desktop-exe 指定 WorkBuddy.exe');
  if (args.includes('--host-auth')) {
    const directory = path.join(process.env.APPDATA, 'edu-manager-launcher', 'classification-auth');
    const auth = require('../electron/classification-auth.cjs').createClassificationAuth({ directory });
    runtimeReady = auth.read('workbuddy').then(descriptor => {
      runtime = auth.apply(runtime, descriptor);
    });
  }
}
const agent = createRoutingAgent({ select: async () => { await runtimeReady; return { id: adapterId, executable, runtime, model: option('--model') || undefined }; } });
(async () => {
  const results = [];
  for (const value of fixture.cases.filter(item => ids.has(item.id))) {
    try {
      const result = await agent.classify({ context, text: value.text, executionId: `synthetic-eval-${value.id}` });
      const suggestedProjects = result.candidates.filter(candidate => candidate.type === 'project').map(candidate => candidate.id);
      const automatic = automaticTarget({ source: { id: 'live-evaluation', automatic: true, studentId: fixture.studentId }, item: {}, context,
        text: value.text, suggestion: result, classificationAttempted: true });
      const expectedIds = value.projectIds || (value.projectId ? [value.projectId] : []);
      const requiredPresent = expectedIds.every(id => suggestedProjects.includes(id));
      const exactSingle = value.kind === 'single' && requiredPresent && !result.conflict && suggestedProjects.length === 1;
      const safeSingleAction = value.kind === 'single' && expectedIds.length === 1 && !result.conflict
        && automatic?.target?.id === expectedIds[0];
      const safeConflict = value.kind === 'conflict' && requiredPresent && result.conflict === true && !automatic;
      const safeNone = value.kind === 'none' && suggestedProjects.length === 0 && !automatic;
      results.push({ id: value.id, kind: value.kind || (expectedIds.length ? 'single' : 'none'), expectedIds, projects: suggestedProjects,
        candidates: result.candidates.map(candidate => ({ id: candidate.id, type: candidate.type, score: candidate.score })),
        conflict: result.conflict, automaticTarget: automatic?.target?.id || null, candidateStrict: exactSingle || safeConflict || safeNone,
        correct: safeSingleAction || safeConflict || safeNone });
      console.log(`完成 ${value.id}`);
    } catch (error) { results.push({ id: value.id, kind: value.kind, expectedIds: value.projectIds || [], error: error.code || error.message, correct: false }); console.log(`失败 ${value.id}: ${error.code || 'error'} ${String(error.message || '').slice(0, 300)}`); }
  }
  const group = kind => results.filter(result => result.kind === kind);
  const single = group('single'), conflict = group('conflict'), none = group('none');
  const countCorrect = group => group.filter(result => result.correct).length;
  const errors = results.filter(r => r.error).length;
  const strict = results.filter(result => result.candidateStrict).length;
  const report = { schema: 'edu-manager.smart-inbox-live-agent-evaluation.v2', fixture: path.basename(fixturePath), syntheticOnly: true,
    adapter: adapterId, cases: results.length, byKind: { single: { correct: countCorrect(single), strictCandidates: single.filter(result => result.candidateStrict).length, total: single.length },
      conflict: { correct: countCorrect(conflict), total: conflict.length }, none: { correct: countCorrect(none), total: none.length } },
    correct: results.filter(result => result.correct).length, strictCandidateCorrect: strict, errors, results,
    boundary: '真实已授权 Agent 对人工指定预期的合成资料的探索性评测；不是独立标注集，不代表真实学生资料准确率。' };
  report.accuracy = { correct: report.correct, total: results.length, rate: results.length ? report.correct / results.length : 0 };
  report.candidatePurity = { correct: strict, total: results.length, rate: results.length ? strict / results.length : 0 };
  if (reportPath) fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (errors || results.some(result => !result.correct)) process.exitCode = 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
