'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPlanningGuidanceService } = require('../electron/planning-guidance.cjs');
const { validateTopicOutput, redact } = require('../electron/structured-generation.cjs');
function output(input) {
  return { candidates: ['science_innovation', 'social_practice'].map((category, index) => ({ category, title: `${input.profile.interests[0]}真实生成${index}`, realWorldProblem: '具体问题', fitReason: '符合兴趣但需要复核', inference: '推断而非能力结论', evidenceRefs: [input.evidence[0].ref], path: ['研究问题', '记录基线'], expectedOutcomes: ['报告'], durationWeeks: 4, difficulty: '中等', collaboration: '个人', resourceConditions: ['开放资源'], safetyEthics: ['保护隐私'], feasibility: '须核实资源', verifyItems: ['家长许可'] })) };
}
test('real generation input hides identity and output source references are bounded', () => {
  const student = { name: '测试学生', email: 'private@example.com', phone: '13800000000', school: '私立学校' };
  assert.doesNotMatch(redact('测试学生 private@example.com 13800000000 私立学校 D:\\secret\\report.md', student), /测试学生|private@example|138000|私立学校|D:\\/);
  const input = { profile: { interests: ['机器人'] }, evidence: [{ ref: 'E0', text: '个人兴趣：机器人' }] };
  const good = output(input); assert.equal(validateTopicOutput(good, input).length, 2);
  good.candidates[0].evidenceRefs = ['invented']; assert.throws(() => validateTopicOutput(good, input));
});
test('Agent topics deduplicate, preserve history on failure and reject changed profile after generation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-topics-'));
  let student = { id: 's1', name: '隐私学生', interests: ['机器人'], grade: '八年级' }, calls = 0, fail = false, release;
  const service = createPlanningGuidanceService({ resolveStudent: id => id === student.id ? { ...student } : null, listStudents: () => [student], listProjects: () => [], resolveStudentDir: () => root,
    topicGenerator: async ({ input }) => { calls++; if (fail) throw Error('offline'); if (release === 'defer') return new Promise(resolve => { release = () => resolve(output(input)); }); return output(input); } });
  try {
    const first = service.refreshAgentTopicSuggestions('s1'), second = service.refreshAgentTopicSuggestions('s1');
    assert.equal(first, second); const generated = await first; assert.equal(calls, 1); assert.equal(generated.current.generationMode, 'agent_evidence_based');
    assert.equal((await service.refreshAgentTopicSuggestions('s1')).unchanged, true);
    student = { ...student, interests: ['生态'] }; fail = true;
    const failed = await service.refreshAgentTopicSuggestions('s1'); assert.equal(failed.ok, false); assert.equal(failed.current.id, generated.current.id);
    fail = false; release = 'defer'; const changed = service.refreshAgentTopicSuggestions('s1'); student = { ...student, interests: ['金融'] }; release();
    const stale = await changed; assert.equal(stale.ok, false); assert.match(stale.message, /资料已变化/); assert.equal(stale.current.id, generated.current.id);
    assert.throws(() => service.refreshAgentTopicSuggestions('s2'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
