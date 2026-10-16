'use strict';
// Run only with Electron RUN_AS_NODE. All evidence and students are synthetic.
const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
async function run() {
  const archive = path.resolve(process.argv[2]), source = path.resolve(process.argv[3]);
  assert.equal(path.basename(archive), 'app.asar');
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  for (const name of ['practice-cards.cjs', 'practice-language.cjs', 'structured-generation.cjs']) {
    assert.equal(hash(await fs.readFile(path.join(archive, 'electron', name))), hash(await fs.readFile(path.join(source, 'electron', name))));
  }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-card-repair-package-'));
  let calls = 0;
  try {
    const api = require(path.join(archive, 'electron/practice-cards.cjs')).createPracticeCards({
      resolveStudentDir: async () => root,
      snapshot: async () => ({ profile: { grade: '12' }, inputFingerprint: 'synthetic', learningSignals: ['Confirmed synthetic review goal'], confirmedGrowthSignals: [], sourceIds: ['synthetic'] }),
      generate: async ({ schema }) => {
        calls++;
        if (schema.required.includes('passed')) return { passed: calls === 4, languagePassed: true, reason: calls === 2 ? '提示不符合整数平方结构' : '已独立复核' };
        return { title: '整数练习', subject: '数学', knowledgePoint: '整除', rationale: '基于合成复习需求', minutes: 10, sourceRefs: ['E0'], prompt: '证明 8 整除 8(n+1)^2，n 为整数。', hint: calls === 1 ? '考虑连续整数' : '考虑整数的平方', answer: '平方为整数', explanation: '八倍整数可以被八整除。' };
      },
    });
    const result = await api.generate('synthetic-student');
    assert.equal(calls, 4);
    assert.equal(result.card.review.repairCount, 1);
    assert.equal(result.card.content.answer, undefined);
    assert.equal(result.card.content.hint, '考虑整数的平方');
    const report = { ok: true, electron: process.versions.electron, sourceFilesMatched: 3, calls, repairCount: 1, realStudentAccess: false, liveModelCall: false };
    if (process.argv[4]) { const reportPath = path.resolve(process.argv[4]); await fs.mkdir(path.dirname(reportPath), { recursive: true }); await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`); }
    console.log(JSON.stringify(report));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}
run().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); });
