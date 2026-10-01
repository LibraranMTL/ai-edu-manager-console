const test = require('node:test');
const assert = require('node:assert/strict');
const { currentGrowthReadView, currentGrowthReviewView, currentGrowthMarkdown, createGrowthSourceReader } = require('../electron/growth-current-view.cjs');
const { buildStudentGrowthSummary } = require('../electron/student-growth-summary.cjs');

const student = { id: 's1', name: 'Synthetic' };
const project = { id: 'p1', name: 'Current project', studentIds: ['s1'], materialStorageMode: 'workspace-v1' };
const fixed = { id: 'e1', projectId: 'p1', projectName: 'Stale project name', title: 'Fixed evidence', content: 'Observation',
  status: 'confirmed', ability: 'Research', confidence: 'Reviewed', requiresProjectConfirmation: true,
  sourceBinding: { schema: 'edu-manager.project-evidence-binding.v1', projectId: 'p1', studentId: 's1',
    bindingId: `evidence-binding-${'a'.repeat(64)}`, evidenceHash: 'b'.repeat(64), unsafePath: 'D:/private' },
  sourceMaterials: [{ materialId: 'm1', version: 1, sha256: 'c'.repeat(64) }], updatedAt: '2026-09-29T00:00:00.000Z' };
const legacy = { id: 'legacy', title: 'Other observation', content: 'Non-project evidence', status: 'watching', ability: 'Reading' };
const index = { studentId: 's1', updatedAt: '2026-09-29T01:00:00.000Z', sourceFingerprint: 'original', evidence: [fixed, legacy],
  summary: { confirmedCount: 999, evidenceCount: 999 }, abilities: [{ name: 'Research', maturity: 'established', confirmedCount: 999 }],
  projects: [{ projectId: 'p1', projectName: 'Stale project name', confirmedEvidenceCount: 999 }] };
const source = { available: true, materialId: 'm1', version: 1, sha256: 'c'.repeat(64), location: 'D:/private/snapshot' };

test('read view recomputes aggregates from currently permitted evidence without modifying the saved index', () => {
  const before = JSON.stringify(index);
  const result = currentGrowthReadView({ student, index, projects: [project], resolveFixedSources: () => [source] });
  assert.equal(result.summary.evidenceCount, 2); assert.equal(result.summary.confirmedCount, 1);
  assert.equal(result.abilities.find((item) => item.name === 'Research').maturity, 'emerging');
  assert.equal(result.projects[0].projectName, project.name);
  assert.deepEqual(result.evidence[0].sourceMaterials, [{ materialId: 'm1', version: 1, sha256: 'c'.repeat(64) }]);
  assert.equal(result.evidence[0].sourceBinding.unsafePath, undefined);
  assert.equal(result.sourceFingerprint, 'original'); assert.equal(result.readView.persisted, false);
  assert.equal(JSON.stringify(index), before);
});

test('withdrawn fixed evidence is removed from observations, ability counts and the generated read-only Markdown', () => {
  const result = currentGrowthReadView({ student, index, projects: [project], resolveFixedSources: () => [] });
  assert.deepEqual(result.evidence.map((item) => item.id), ['legacy']);
  assert.equal(result.summary.confirmedCount, 0); assert.equal(result.projects[0].confirmedEvidenceCount, 0);
  assert.equal(result.projects[0].reviewStatus, 'not_started');
  assert.doesNotMatch(JSON.stringify(result.abilities), /Research/);
  assert.doesNotMatch(currentGrowthMarkdown(student, result), /Research|999|Stale project name/);
});

test('no resolver means unverified; missing fixed flags on a new-mode project cannot select legacy path fallback', () => {
  const old = { ...fixed, sourceBinding: undefined, requiresProjectConfirmation: false, sourcePath: 'D:/exists' };
  const result = currentGrowthReadView({ student, index: { ...index, evidence: [old] }, projects: [project] });
  assert.equal(result.summary.evidenceCount, 0);
  const missingProject = currentGrowthReadView({ student, index, projects: [] });
  assert.equal(missingProject.projects.length, 0); assert.equal(missingProject.evidence.length, 1);
  assert.throws(() => currentGrowthReadView({ student, index: { ...index, studentId: 's2' } }), { code: 'cross_student_index' });
});

test('terminal summary retains fixed identity/version but never includes local resolver paths or pending aggregates', () => {
  const result = currentGrowthReadView({ student, index: { ...index, evidence: [...index.evidence, { id: 'secret', status: 'pending', ability: 'Private pending ability' }] },
    projects: [project], resolveFixedSources: () => [source], visibleOnly: true });
  const summary = buildStudentGrowthSummary(student, result);
  assert.equal(summary.recentEvidence[0].evidenceId, 'e1'); assert.equal(summary.recentEvidence[0].sourceMaterials[0].version, 1);
  assert.equal(summary.recentEvidence[0].sourceBinding.studentId, 's1');
  assert.equal(summary.summary.evidenceCount, 2);
  assert.doesNotMatch(JSON.stringify(summary), /D:\/|unsafePath|Private pending ability|secret/);
  assert.throws(() => buildStudentGrowthSummary({ id: 's2' }, result), /不属于/);
});

test('review display downgrades unavailable confirmation without rewriting recorded status or granting generic confirmation', () => {
  const review = { candidates: [fixed] }; const before = JSON.stringify(review);
  const displayed = currentGrowthReviewView({ student, review, projects: [project], resolveFixedSources: () => [] });
  assert.equal(displayed.candidates[0].status, 'pending'); assert.equal(displayed.candidates[0].recordedStatus, 'confirmed');
  assert.equal(displayed.candidates[0].requiresProjectConfirmation, true);
  assert.equal(displayed.candidates[0].sourceResolution, 'fixed_unavailable');
  assert.equal(JSON.stringify(review), before);
  assert.deepEqual(currentGrowthReviewView({ student, review, projects: [] }).candidates, []);
});

test('request-local reader rejects out-of-scope and incomplete records before registry IO and caches broken registries', () => {
  let reads = 0;
  const reader = createGrowthSourceReader({ student, projects: [project], readProjectIndex: () => { reads++; throw new Error('broken'); } });
  assert.deepEqual(reader.resolveFixedSources({ ...fixed, projectId: 'foreign' }), []);
  assert.deepEqual(reader.resolveFixedSources({ ...fixed, status: 'pending' }), []); assert.equal(reads, 0);
  assert.deepEqual(reader.resolveFixedSources(fixed), []); assert.deepEqual(reader.resolveFixedSources(fixed), []); assert.equal(reads, 1);
});
