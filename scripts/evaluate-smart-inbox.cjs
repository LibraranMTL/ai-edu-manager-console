'use strict';
const fs = require('node:fs');
const path = require('node:path');
const P = require('../electron/smart-inbox-policy.cjs');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../tests/fixtures/smart-inbox-evaluation-v1.json'), 'utf8'));
const projects = fixture.projects.map(project => ({ ...project, studentIds: [fixture.studentId], identifiers: [project.id, project.name, ...project.aliases], categories: [] }));
const context = { studentId: fixture.studentId, projects };
const results = fixture.cases.map(item => {
  const selected = P.selectRoutingCandidates({ context, text: item.text });
  const automatic = P.automaticTarget({ source: { automatic: true, studentId: fixture.studentId }, item: {}, context, text: item.text,
    suggestion: { candidates: [], sensitive: false, conflict: false, reason: '' }, classificationAttempted: false });
  return { id: item.id, expected: item.projectId, candidateIds: selected.candidateIds, complete: selected.complete,
    autoTarget: automatic?.target?.id || null };
});
const positive = results.filter(item => item.expected), negative = results.filter(item => !item.expected);
const found = positive.filter(item => item.candidateIds.includes(item.expected)).length;
const wrongAuto = results.filter(item => item.autoTarget && item.autoTarget !== item.expected).length;
const heldOut = results.filter(item => item.id.startsWith('h'));
const heldOutPositive = heldOut.filter(item => item.expected);
console.log(JSON.stringify({ fixture: 'synthetic-manually-specified-v1-extended', cases: results.length, positives: positive.length, negatives: negative.length,
  localRecallAt5: { found, total: positive.length, rate: found / positive.length }, wrongAutomaticDecisions: wrongAuto,
  heldOutRecallAt5: { found: heldOutPositive.filter(item => item.candidateIds.includes(item.expected)).length, total: heldOutPositive.length },
  negativeWithLocalCandidates: negative.filter(item => item.candidateIds.length).length,
  unmatchedPositiveIds: positive.filter(item => !item.candidateIds.includes(item.expected)).map(item => item.id),
  boundary: '本机规则和候选召回离线评测；未调用真实Agent，不代表真实数据准确率或全项目智能召回准确率。' }, null, 2));
if (wrongAuto) process.exitCode = 1;
