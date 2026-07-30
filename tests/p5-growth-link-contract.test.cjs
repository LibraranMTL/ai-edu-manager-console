const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const model = fs.readFileSync(path.join(root, 'electron', 'growth-model.cjs'), 'utf8');

test('validated student governance links to one idempotent growth refresh path', () => {
  assert.match(main, /const growthLink = linkGovernedStudentKnowledgeToGrowth\(student, governanceRun\)/);
  assert.match(main, /governedStudentGrowthCandidates\(/);
  assert.match(main, /mergeGrowthCandidates\(readGrowthEvidenceReview\(normalized\), candidates\)/);
  assert.match(main, /writeGrowthEvidenceReview\(normalized, merged\.review\)/);
  assert.match(main, /markGrowthStudentsDirty\(\[student\.id\], 'growth_evidence_changed'\)/);
  assert.match(main, /projectStudentGrowthCandidates\(/);
  assert.match(main, /writeGrowthEvidenceReview\(normalized, review, \{ markDirty: false \}\)/);
});

test('system observations retain verification provenance in the growth index', () => {
  assert.match(model, /epistemicType: item\.epistemicType/);
  assert.match(model, /sourceKind: item\.sourceKind/);
  assert.match(model, /systemVerification: item\.systemVerification/);
});
