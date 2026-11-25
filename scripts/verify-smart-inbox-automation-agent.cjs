'use strict';
// Real provider, isolated synthetic sources and destinations.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createSmartInbox } = require('../electron/smart-inbox.cjs');
const { createRoutingAgent } = require('../electron/smart-inbox-agent.cjs');
const [executable, model, reportFile] = process.argv.slice(2);
if (!executable || !path.isAbsolute(executable) || !model || !reportFile) throw Error('Provide absolute CLI path, configured model and report path');
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-inbox-automation-agent-'));
  const source = path.join(root, 'source'), destination = path.join(root, 'destination');
  await fs.mkdir(source); await fs.mkdir(destination);
  const studentId = 'synthetic-student-a';
  const projects = Array.from({ length: 8 }, (_, index) => ({ id: `synthetic-project-${index}`, name: index === 7 ? '单摆周期实验' : `合成音乐项目${index}`,
    summary: index === 7 ? '研究悬线长度和往返摆动周期的关系，分析实验测量误差。' : '音乐练习、演奏和节奏研究。',
    studentIds: [studentId], identifiers: [`synthetic-project-${index}`], categories: [] }));
  const calls = [], agent = createRoutingAgent({ select: async () => ({ id: 'codex', executable, model }) });
  const engine = createSmartInbox({ directory: path.join(root, 'state'), stableAgeMs: 0,
    forbiddenRoots: () => [destination], automaticAllowed: () => true, acquire: () => () => {},
    studentHints: () => [{ id: studentId, name: '合成学生甲' }, { id: 'synthetic-student-b', name: '合成学生乙' }],
    context: async (id, options = {}) => ({ studentId: id, projects: options.mode === 'details'
      ? projects.filter(project => options.projectIds.includes(project.id)) : projects }),
    validateTarget: async target => {
      if (target.studentId !== studentId || target.type === 'project' && !projects.some(project => project.id === target.id)) throw Error('synthetic scope mismatch');
      return target;
    },
    extract: async item => ({ text: await fs.readFile(item.snapshotPath, 'utf8'), warnings: [] }),
    classify: async input => { calls.push({ itemId: input.itemId, purpose: input.context.purpose }); return agent.classify(input); },
    deliver: async (snapshot, target, item, checkpoint) => {
      const file = path.join(destination, `${item.id}.txt`); await checkpoint({ destinationPath: file });
      await fs.copyFile(snapshot, file); return { ok: true, path: file, recordId: item.id };
    }, events: async () => [],
  });
  try {
    const cases = [
      { name: 'raw-learning.txt', expected: 'student', text: '合成学生甲今天完成了二次方程配方法的数学练习。这份笔记逐步记录如何把方程移项、两边同时加上一次项系数一半的平方，并检验方程的两个解。资料是一份普通数学学习笔记，与音乐或单摆实验项目无关。' },
      { name: 'project.txt', expected: 'project', text: '合成学生甲在单摆周期实验中改变悬线长度，分别测量十次来回摆动的总时间，再计算平均周期。研究内容对应 synthetic-project-7。本文保存实验记录、控制变量方法和计时误差分析，准备比较周期平方与悬线长度的关系。' },
      { name: 'foreign-subject.txt', expected: 'review', text: '本资料主体是合成学生乙，合成学生甲只是帮助录入。合成学生乙完成了二次方程练习，记录了配方法、因式分解和验根步骤。这里所有学习成果均属于合成学生乙，请保留这一主体差异。' },
      { name: 'internal.txt', expected: 'ignored', text: JSON.stringify({ schema: 'edu-manager.agent-conversation-submission.v1', sourceAgent: 'codex', messages: [
        { role: 'user', content: 'This is an app-generated request for a suggested next user message. The user did not write this message.' },
        { role: 'assistant', content: 'A generated composer suggestion.' }] }) },
    ];
    const registered = await engine.updateSource({ folder: source, name: '合成自动化验收', studentId, enabled: true, automatic: true });
    for (const entry of cases) await fs.writeFile(path.join(source, entry.name), entry.text);
    await engine.requestScan(registered.id); await engine.tick();
    const state = [...(await engine.list()).rows, ...(await engine.list({ status: 'delivered' })).rows, ...(await engine.list({ status: 'ignored' })).rows];
    const results = cases.map(entry => {
      const item = state.find(row => row.name === entry.name);
      const actual = item?.status === 'delivered' ? item.target.type : item?.status;
      return { name: entry.name, expected: entry.expected, actual, correct: actual === entry.expected, reason: item?.reasonCode || '' };
    });
    const report = { schema: 'edu-manager.inbox-automation-live-agent.v1', syntheticOnly: true, model, cases: results,
      calls, passed: results.every(result => result.correct), boundary: 'Real Agent with synthetic data through the inbox engine. Does not measure real student routing accuracy.' };
    await fs.mkdir(path.dirname(path.resolve(reportFile)), { recursive: true });
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
    if (!report.passed) process.exitCode = 1;
  } finally { await engine.close(); await fs.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
