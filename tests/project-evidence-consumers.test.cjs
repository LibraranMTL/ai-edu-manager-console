const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createEvidenceContext } = require('./fixtures/project-evidence-runtime.cjs');
const { createProjectMaterialHost } = require('../electron/project-material-host.cjs');
const { projectStudentGrowthCandidates, mergeGrowthCandidates } = require('../electron/growth-source-linker.cjs');
const { buildGrowthIndexV2, parseLegacyGrowthEvidenceMarkdown } = require('../electron/growth-model.cjs');
const { growthSourceFingerprint } = require('../electron/growth-index-consistency.cjs');
const references = require('../electron/project-evidence-reference.cjs');
const reports = require('../electron/report-evidence-resolver.cjs');
const publication = require('../electron/report-auto-publication.cjs');
const archives = require('../electron/report-evidence-archive.cjs');
const { writeArchiveVersion } = require('../electron/education-archive-version.cjs');
const currentViews = require('../electron/growth-current-view.cjs');
const compatibility = require('../electron/education-growth-compatibility.cjs');
const { buildStudentGrowthSummary } = require('../electron/student-growth-summary.cjs');
const { growthIndexNeedsRebuild } = require('../electron/growth-index-consistency.cjs');
const mainSource = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function bind(scope, name) {
  const start = new RegExp(`(?:async )?function ${name}\\(`).exec(mainSource).index;
  scope[name] = Function('scope', `with (scope) { return (${mainSource.slice(start, mainSource.indexOf('\n}', start) + 2)}); }`)(scope);
}
async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'edu-evidence-consumer-'));
  t.after(async () => { assert.equal(path.dirname(root), await fsp.realpath(os.tmpdir())); assert.ok(path.basename(root).startsWith('edu-evidence-consumer-')); await fsp.rm(root, { recursive: true, force: true }); });
  const project = { id: 'p1', name: 'Synthetic', status: 'active', studentIds: ['s1'], studentEvidence: [], materialStorageMode: 'workspace-v1',
    workspacePath: path.join(root, 'workspace'), rawPath: path.join(root, 'legacy'), managerPath: path.join(root, 'manager'), knowledgeRootPath: path.join(root, 'knowledge') };
  for (const [key, dir] of Object.entries({ summaryPath: '摘要库', conceptPath: '概念库', entityPath: '实体库', contributionPath: '知识贡献' })) project[key] = path.join(project.knowledgeRootPath, dir);
  project.promotionPath = path.join(project.contributionPath, 'application.md');
  await fsp.mkdir(project.workspacePath); await fsp.mkdir(project.contributionPath, { recursive: true });
  fs.writeFileSync(project.promotionPath, 'not individual evidence');
  const original = path.join(project.workspacePath, 'source.txt'); fs.writeFileSync(original, 'original version one');
  const host = createProjectMaterialHost(project);
  const register = () => host.store.registerFiles([{ location: { kind: 'workspace', rootId: 'workspace', relativePath: 'source.txt' } }]);
  await register();
  const evidence = { ability: '分析', observation: 'synthetic observation', confidence: '人工核对', status: 'verified', sourcePaths: [original] };
  const main = createEvidenceContext({ root, project, evidence });
  const preview = await main.call(); const committed = await main.call(evidence, preview.bindingId); assert.equal(committed.ok, true, committed.message);
  const student = main.context.readStudentsIndex()[0]; const current = main.context.readProjects()[0];
  const merged = mergeGrowthCandidates(main.context.readGrowthEvidenceReview(), projectStudentGrowthCandidates({ studentId: 's1', projects: [current] }));
  const index = buildGrowthIndexV2({ student, growthDir: main.growthDir, review: merged.review, projects: [current] });
  index.sourceFingerprint = growthSourceFingerprint(merged.review, [current]);
  const report = path.join(root, 'report.md');
  const content = `---\nstudent_id: s1\ngrowth_fingerprint: ${index.sourceFingerprint}\n---\n结论。[依据:${index.evidence[0].id}]`;
  fs.writeFileSync(report, content); fs.writeFileSync(main.context.growthIndexPath(), JSON.stringify(index));
  const opened = [];
  Object.assign(main.context, references, reports, publication, archives, currentViews, compatibility, {
    buildStudentGrowthSummary, growthSourceFingerprint, growthIndexNeedsRebuild,
    educationArchiveVersionRoot: () => path.join(root, 'archive-versions'),
    findStudentByKey: (id) => id === 's1' ? student : null, findStudent: (id) => id === 's1' ? student : null,
    LEARNING_REPORTS: [{ id: 'weekly' }], learningReportPathForStudent: () => report,
    safeReadJson: (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : fallback,
    findCaptureTimelineKnowledgeLinks: () => [], captureCenterRootPath: () => root,
    canonicalTaskPath: (file) => path.resolve(file), shell: { showItemInFolder: (file) => opened.push(file) },
    reportEvidenceSourceResolver: () => { throw new Error('fixed evidence must not use legacy path resolver'); },
  });
  for (const name of ['fixedReportEvidenceSources', 'reportEvidenceSourceValues', 'reportProjectsForStudent', 'reportEligibleEvidence',
    'reportEvidenceSourceAccessible', 'validateReportAutoPublication', 'learningReportEvidence', 'openLearningReportEvidenceSource',
    'growthReadSources', 'queueGrowthRefreshOnRead', 'growthIndexReadResult', 'getGrowthIndex', 'getGrowthModelSnapshot', 'handleStudentGrowthSummary',
    'isPublicArchiveFile', 'handleArchiveFile']) bind(main.context, name);
  return { root, project: current, host, original, register, evidence, main, student, index, report, content, opened,
    resolve: (options = {}) => references.resolveFixedEvidenceSources({ studentId: 's1', project: current, evidence: index.evidence[0], index: main.context.readProjectMaterialIndexSync(current), ...options }) };
}

test('confirmation survives candidate merge, growth projection and report navigation as the original fixed version', async (t) => {
  const f = await fixture(t); const item = f.index.evidence[0];
  assert.equal(item.status, 'confirmed'); assert.equal(item.sourceBinding.bindingId, f.project.studentEvidence[0].sourceBinding.bindingId);
  assert.equal(item.sourceMaterials[0].version, 1); assert.equal(item.requiresProjectConfirmation, true);
  fs.writeFileSync(f.original, 'version two must not replace proof'); await f.register();
  const source = f.resolve({ verifyBytes: true })[0]; assert.equal(source.version, 1); assert.equal(source.currentVersion, 2);
  assert.equal(fs.readFileSync(source.location, 'utf8'), 'original version one');
  const cards = f.main.context.learningReportEvidence('s1', 'weekly'); assert.equal(cards.ok, true, cards.message);
  assert.equal(cards.cards[0].sources[0].version, 1);
  const opened = JSON.parse(f.main.context.openLearningReportEvidenceSource('s1', 'weekly', item.id, 0));
  assert.equal(opened.ok, true, opened.message); assert.deepEqual(f.opened, [source.location]);
  assert.equal(f.main.context.validateReportAutoPublication({ sourceId: 's1', input: { growthFingerprint: f.index.sourceFingerprint } }, f.content).valid, true);
  assert.deepEqual(parseLegacyGrowthEvidenceMarkdown(fs.readFileSync(path.join(f.main.growthDir, '成长证据.md'), 'utf8')), []);
});

test('draft/rejected project changes cannot inherit an older confirmed status or old binding', async (t) => {
  const f = await fixture(t); const previous = { candidates: f.index.evidence };
  const project = structuredClone(f.project); Object.assign(project.studentEvidence[0], { status: 'draft', observation: 'new unconfirmed observation', sourceBinding: undefined });
  const incoming = projectStudentGrowthCandidates({ studentId: 's1', projects: [project] });
  const merged = mergeGrowthCandidates(previous, incoming).review.candidates[0];
  assert.equal(merged.status, 'pending'); assert.equal(merged.sourceBinding, null); assert.deepEqual(merged.sourceMaterials, []);
  assert.equal(merged.requiresProjectConfirmation, true); assert.equal(merged.sourcePath, '');
  project.studentEvidence[0].status = 'rejected';
  assert.equal(mergeGrowthCandidates(previous, projectStudentGrowthCandidates({ studentId: 's1', projects: [project] })).review.candidates[0].status, 'rejected');
  const changedText = structuredClone(f.project); changedText.studentEvidence[0].observation = 'not the confirmed observation';
  assert.equal(projectStudentGrowthCandidates({ studentId: 's1', projects: [changedText] })[0].status, 'pending');
});

test('fixed binding/version changes invalidate growth fingerprints even when display paths and timestamps do not change', async (t) => {
  const f = await fixture(t); const review = { candidates: f.index.evidence }; const before = growthSourceFingerprint(review, [f.project]);
  const changed = structuredClone(review); changed.candidates[0].sourceMaterials[0].version++;
  assert.notEqual(growthSourceFingerprint(changed, [f.project]), before);
  const project = structuredClone(f.project); project.studentEvidence[0].sourceBinding.evidenceHash = 'a'.repeat(64);
  assert.notEqual(growthSourceFingerprint(review, [project]), before);
  const projection = references.fixedEvidenceProjection({ ...f.index.evidence[0], sourceBinding: { ...f.index.evidence[0].sourceBinding, unsafePath: 'C:/secret' } });
  assert.equal(projection.sourceBinding.unsafePath, undefined);
});

test('withdrawn, tampered or foreign fixed evidence never falls back to existing source paths or project promotion', async (t) => {
  const f = await fixture(t); const item = f.index.evidence[0];
  assert.deepEqual(f.main.context.reportEvidenceSourceValues(f.student, [f.project], { ...item, sourcePath: f.original }), []);
  assert.deepEqual(reports.splitEvidenceSources({ sourceBinding: { invalid: true }, sourcePath: f.original }), []);
  assert.throws(() => f.resolve({ studentId: 'another' }), { code: 'forbidden' });
  const source = f.resolve()[0]; await fsp.chmod(source.location, 0o600); fs.writeFileSync(source.location, 'tampered');
  assert.throws(() => f.resolve({ verifyBytes: true }), { code: 'source_changed' });
  assert.equal(JSON.parse(f.main.context.openLearningReportEvidenceSource('s1', 'weekly', item.id)).ok, false); assert.deepEqual(f.opened, []);
  assert.equal(f.main.context.validateReportAutoPublication({ sourceId: 's1', input: { growthFingerprint: f.index.sourceFingerprint } }, f.content).valid, false);
  await f.host.store.mutate((index) => { index.materials[0].adoption.state = 'excluded'; });
  assert.equal(f.main.context.learningReportEvidence('s1', 'weekly').ok, false);
});

test('report from another growth revision does not silently display current fixed observation or open its version', async (t) => {
  const f = await fixture(t); fs.writeFileSync(f.report, f.content.replace(f.index.sourceFingerprint, 'older-fingerprint'));
  const result = f.main.context.learningReportEvidence('s1', 'weekly');
  assert.equal(result.ok, false); assert.deepEqual(result.cards, []); assert.deepEqual(result.missingIds, [f.index.evidence[0].id]);
  assert.equal(JSON.parse(f.main.context.openLearningReportEvidenceSource('s1', 'weekly', f.index.evidence[0].id)).ok, false);
  assert.match(fs.readFileSync(f.report, 'utf8'), /older-fingerprint/);
});

test('fixed source validation uses a bounded aggregate byte budget and metadata browsing does not read original contents', async (t) => {
  const f = await fixture(t);
  assert.throws(() => f.resolve({ verifyBytes: true, budget: { remaining: 1 } }), { code: 'source_limit' });
  const source = f.resolve()[0]; await fsp.unlink(f.original);
  assert.equal(f.main.context.reportEligibleEvidence(f.student).ids.length, 1);
  assert.equal(f.resolve({ verifyBytes: true })[0].location, source.location);
});

async function historicalFixture(t) {
  const f = await fixture(t);
  f.archive = writeArchiveVersion({ rootDir: f.main.context.educationArchiveVersionRoot(), student: f.student,
    growthIndex: f.index, reports: [{ id: 'weekly', content: f.content }], createdAt: '2026-09-29T01:00:00.000Z' });
  fs.writeFileSync(f.original, 'updated version two'); await f.register();
  const updated = { ...f.evidence, observation: 'a different current observation' };
  const preview = await f.main.call(updated); assert.equal(preview.needsSourceConfirmation, true, preview.message);
  const confirmed = await f.main.call(updated, preview.bindingId); assert.equal(confirmed.ok, true, confirmed.message);
  const current = f.main.context.readProjects()[0];
  const merged = mergeGrowthCandidates(f.main.context.readGrowthEvidenceReview(), projectStudentGrowthCandidates({ studentId: 's1', projects: [current] }));
  const currentIndex = buildGrowthIndexV2({ student: f.student, growthDir: f.main.growthDir, review: merged.review, projects: [current] });
  currentIndex.sourceFingerprint = growthSourceFingerprint(merged.review, [current]);
  fs.writeFileSync(f.main.context.growthIndexPath(), JSON.stringify(currentIndex));
  assert.equal(currentIndex.evidence[0].id, f.index.evidence[0].id);
  assert.notEqual(currentIndex.sourceFingerprint, f.index.sourceFingerprint);
  return { ...f, current, currentIndex };
}

test('historical report resolves its archived observation and fixed v1 after same-ID evidence is reconfirmed against v2', async (t) => {
  const f = await historicalFixture(t); const indexBefore = fs.readFileSync(f.main.context.growthIndexPath());
  const reportBefore = fs.readFileSync(f.report); const latestBefore = fs.readFileSync(path.join(f.main.context.educationArchiveVersionRoot(), 'latest.json'));
  // Metadata query must not invoke full project normalization or original-file scanning.
  f.main.context.normalizeProject = () => { throw new Error('report browsing must remain metadata-only'); };
  const result = f.main.context.learningReportEvidence('s1', 'weekly');
  assert.equal(result.ok, true, result.message); assert.equal(result.historical, true);
  assert.equal(result.archiveVersionId, f.archive.versionId);
  assert.equal(result.cards[0].summary, f.evidence.observation);
  assert.notEqual(result.cards[0].summary, f.currentIndex.evidence[0].content);
  const source = result.cards[0].sources[0];
  assert.equal(source.version, 1); assert.equal(source.currentVersion, 2); assert.equal(source.historical, true);
  assert.equal(source.bindingId, f.index.evidence[0].sourceBinding.bindingId);
  assert.equal(JSON.parse(f.main.context.openLearningReportEvidenceSource('s1', 'weekly', f.index.evidence[0].id)).ok, true);
  assert.equal(fs.readFileSync(f.opened[0], 'utf8'), 'original version one');
  assert.deepEqual(fs.readFileSync(f.report), reportBefore);
  assert.deepEqual(fs.readFileSync(f.main.context.growthIndexPath()), indexBefore);
  assert.deepEqual(fs.readFileSync(path.join(f.main.context.educationArchiveVersionRoot(), 'latest.json')), latestBefore);
  assert.equal(f.main.context.validateReportAutoPublication({ sourceId: 's1', input: { growthFingerprint: f.currentIndex.sourceFingerprint } }, f.content).valid, false);
  fs.writeFileSync(path.join(f.archive.versionDir, 'education-archive.json'), 'archive changed after the cards were shown');
  assert.equal(JSON.parse(f.main.context.openLearningReportEvidenceSource('s1', 'weekly', f.index.evidence[0].id)).ok, false);
  assert.equal(f.opened.length, 1, 'opening again must re-read the archive instead of trusting a prior card');
});

test('historical reading rechecks current membership, rejection and source adoption; no sensitive old cards survive loss of scope', async (t) => {
  const f = await historicalFixture(t);
  const deny = () => {
    const result = f.main.context.learningReportEvidence('s1', 'weekly');
    assert.equal(result.ok, false); assert.deepEqual(result.cards, []);
    assert.equal(JSON.parse(f.main.context.openLearningReportEvidenceSource('s1', 'weekly', f.index.evidence[0].id)).ok, false);
  };
  f.main.context.writeProjects([{ ...f.current, studentIds: [] }]); deny();
  const rejected = structuredClone(f.current); rejected.studentEvidence[0].status = 'rejected';
  f.main.context.writeProjects([rejected]); deny();
  f.main.context.writeProjects([f.current]);
  await f.host.store.mutate((index) => { index.materials[0].adoption.state = 'excluded'; }); deny();
  assert.deepEqual(f.opened, []);
});

test('historical lookup resolves only cited records and reads each current project registry once per request', async (t) => {
  const f = await historicalFixture(t);
  const oldIndex = structuredClone(f.index);
  oldIndex.evidence.push({ ...oldIndex.evidence[0], id: 'not-cited', projectId: 'not-cited-project' });
  oldIndex.evidence.push({ ...oldIndex.evidence[0], id: 'second-cited' });
  // Replace the synthetic archive with a new version containing an unrelated record;
  // change the growth fingerprint and report together so this is not an ambiguous version.
  oldIndex.sourceFingerprint = 'bounded-history';
  const content = `${f.content.replace(f.index.sourceFingerprint, oldIndex.sourceFingerprint)}\n[依据:second-cited]`;
  writeArchiveVersion({ rootDir: f.main.context.educationArchiveVersionRoot(), student: f.student, growthIndex: oldIndex,
    reports: [{ id: 'weekly', content }], createdAt: '2026-09-29T03:00:00.000Z' });
  fs.writeFileSync(f.report, content);
  const readIndex = f.main.context.readProjectMaterialIndexSync;
  const resolveHistory = f.main.context.resolveHistoricalEvidenceSources;
  let reads = 0, resolves = 0;
  f.main.context.readProjectMaterialIndexSync = (project) => { reads++; return readIndex(project); };
  f.main.context.resolveHistoricalEvidenceSources = (options) => { resolves++; return resolveHistory(options); };
  assert.equal(f.main.context.learningReportEvidence('s1', 'weekly').ok, true);
  assert.equal(reads, 1); assert.equal(resolves, 2);
  fs.writeFileSync(f.report, content.replace(/\[依据:[^\]]+\]/gu, ''));
  f.main.context.readArchivedReportEvidence = () => { throw new Error('uncited legacy report must not enumerate archives'); };
  assert.equal(f.main.context.learningReportEvidence('s1', 'weekly').legacy, true);
});

test('historical proof cannot be forged or mutated through returned index data; source bytes are rechecked at open', async (t) => {
  const f = await historicalFixture(t);
  const loaded = archives.readArchivedReportEvidence({ rootDir: f.main.context.educationArchiveVersionRoot(), studentId: 's1', reportId: 'weekly', content: f.content });
  assert.equal(loaded.ok, true); const options = { archive: loaded.archive, studentId: 's1', project: f.current,
    evidence: f.index.evidence[0], index: f.main.context.readProjectMaterialIndexSync(f.current) };
  assert.throws(() => references.resolveHistoricalEvidenceSources({ ...options, archive: JSON.parse(JSON.stringify(loaded.archive)) }), { code: 'archive_unverified' });
  const returned = archives.archivedReportIndex(loaded.archive, 's1'); returned.evidence[0].content = 'modified by caller';
  assert.equal(archives.archivedReportIndex(loaded.archive, 's1').evidence[0].content, f.evidence.observation);
  assert.throws(() => references.resolveHistoricalEvidenceSources({ ...options, evidence: returned.evidence[0] }), { code: 'evidence_changed' });
  assert.throws(() => archives.archivedReportIndex(loaded.archive, 'another-student'), { code: 'archive_unverified' });
  const source = references.resolveHistoricalEvidenceSources(options)[0];
  await fsp.chmod(source.location, 0o600); fs.writeFileSync(source.location, 'corrupt fixed historical bytes');
  assert.equal(JSON.parse(f.main.context.openLearningReportEvidenceSource('s1', 'weekly', f.index.evidence[0].id)).ok, false);
  assert.deepEqual(f.opened, []);
});

test('actual terminal summary revalidates fixed sources and removes withdrawn observations and aggregate counts without disk writes', async (t) => {
  const f = await fixture(t); const ctx = f.main.context; const replies = [];
  ctx.requireStudentAccess = () => true; ctx.sendJson = (_response, code, payload) => replies.push({ code, payload });
  const indexBytes = fs.readFileSync(ctx.growthIndexPath()); const reviewBytes = fs.readFileSync(f.main.reviewFile);
  ctx.normalizeProject = () => { throw new Error('summary must not scan original folders'); };
  ctx.handleStudentGrowthSummary({}, {}, 's1');
  assert.equal(replies.at(-1).code, 200); assert.equal(replies.at(-1).payload.summary.confirmedCount, 1);
  assert.equal(replies.at(-1).payload.recentEvidence[0].sourceBinding.bindingId, f.index.evidence[0].sourceBinding.bindingId);
  assert.equal(replies.at(-1).payload.recentEvidence[0].sourceMaterials[0].version, 1);
  assert.doesNotMatch(JSON.stringify(replies.at(-1).payload), /sourcePath|relativePath|managerPath|workspacePath/);
  await f.host.store.mutate((index) => { index.materials[0].adoption.state = 'excluded'; });
  ctx.handleStudentGrowthSummary({}, {}, 's1');
  assert.equal(replies.at(-1).code, 200); assert.equal(replies.at(-1).payload.summary.confirmedCount, 0);
  assert.deepEqual(replies.at(-1).payload.recentEvidence, []); assert.deepEqual(replies.at(-1).payload.abilities, []);
  assert.equal(replies.at(-1).payload.projects[0].confirmedEvidenceCount, 0);
  assert.deepEqual(fs.readFileSync(ctx.growthIndexPath()), indexBytes); assert.deepEqual(fs.readFileSync(f.main.reviewFile), reviewBytes);
  const reads = replies.length; ctx.requireStudentAccess = () => false;
  ctx.safeReadJson = () => { throw new Error('unauthorized summary must not read any index'); };
  ctx.handleStudentGrowthSummary({}, {}, 's1'); assert.equal(replies.length, reads);
});

test('actual host quick/index reads use current aggregates and schedule missing/stale refresh without recovery, scanning or rewriting archives', async (t) => {
  const f = await fixture(t); const ctx = f.main.context; const dirty = [];
  ctx.markGrowthStudentsDirty = (ids, reason) => dirty.push({ ids, reason });
  ctx.normalizeProject = () => { throw new Error('no full normalization'); };
  ctx.rebuildGrowthIndex = () => { throw new Error('no synchronous rebuild'); };
  const indexBytes = fs.readFileSync(ctx.growthIndexPath());
  await f.host.store.mutate((index) => { index.materials[0].adoption.state = 'excluded'; });
  for (const name of ['getGrowthIndex', 'getGrowthModelSnapshot']) {
    const result = JSON.parse(ctx[name]('s1')); assert.equal(result.ok, true, result.message);
    assert.equal(result.index.summary.confirmedCount, 0); assert.doesNotMatch(result.content, /分析/);
    assert.equal(result.index.readView.persisted, false);
  }
  const snapshot = JSON.parse(ctx.getGrowthModelSnapshot('s1'));
  assert.equal(snapshot.review.candidates[0].recordedStatus, 'confirmed'); assert.equal(snapshot.review.candidates[0].status, 'pending');
  assert.deepEqual(fs.readFileSync(ctx.growthIndexPath()), indexBytes);
  assert.ok(dirty.some((entry) => entry.reason === 'stale_index_on_read'));
  fs.unlinkSync(ctx.growthIndexPath());
  const missing = JSON.parse(ctx.getGrowthIndex('s1')); assert.equal(missing.index, null); assert.equal(missing.refreshPending, true);
  assert.equal(fs.existsSync(ctx.growthIndexPath()), false);
  const beforeCount = dirty.length;
  for (const status of ['dirty', 'running']) {
    ctx.readGrowthRefreshState = () => ({ entries: { s1: { status, generation: 3, nextAttemptAt: 'future' } } });
    ctx.getGrowthIndex('s1'); ctx.getGrowthModelSnapshot('s1');
  }
  assert.equal(dirty.length, beforeCount, 'page reads must not reset backoff or invalidate an in-flight refresh generation');
});

test('legacy terminal Markdown fallback uses current fixed sources instead of stale saved aggregate text', async (t) => {
  const f = await fixture(t); const ctx = f.main.context; const replies = [];
  f.student.summaryPath = f.root;
  ctx.requireStudentAccess = () => true; ctx.sendJson = (_response, code, payload) => replies.push({ code, payload });
  ctx.resolveInside = (root, relative) => { const file = path.resolve(root, relative); assert.ok(file.startsWith(`${root}${path.sep}`)); return file; };
  const markdown = ctx.growthIndexMarkdownPath(); fs.writeFileSync(markdown, 'STALE AGGREGATE: confirmed=999');
  const url = new URL(`https://fixture.invalid/archive/file?path=${encodeURIComponent(path.relative(f.root, markdown))}`);
  ctx.handleArchiveFile({}, {}, 's1', url); assert.equal(replies.at(-1).code, 200);
  assert.doesNotMatch(replies.at(-1).payload.content, /STALE|999/); assert.match(replies.at(-1).payload.content, /分析/);
  await f.host.store.mutate((index) => { index.materials[0].adoption.state = 'excluded'; });
  ctx.handleArchiveFile({}, {}, 's1', url); assert.equal(replies.at(-1).code, 200);
  assert.doesNotMatch(replies.at(-1).payload.content, /分析|STALE|999/);
  assert.equal(fs.readFileSync(markdown, 'utf8'), 'STALE AGGREGATE: confirmed=999');
});

test('compatibility view verifies fixed identity against the current registry but does not invent human audit', async (t) => {
  const f = await fixture(t); const candidate = { ...f.index.evidence[0], studentId: 's1',
    review: { reviewerRole: 'teacher', reviewerId: 'synthetic-teacher', reviewedAt: '2026-09-29T00:00:00.000Z' } };
  const map = (item) => compatibility.mapGrowthEvidenceReviewToEducationClaims({ student: f.student, review: { candidates: [item] }, ...f.main.context.growthReadSources(f.student) });
  let result = map(candidate); assert.equal(result.claims[0].status, 'confirmed'); assert.equal(result.validation[0].ok, true);
  assert.equal(result.claims[0].sourceResolution, 'fixed_metadata_verified');
  assert.equal(result.claims[0].sourceBinding.bindingId, candidate.sourceBinding.bindingId);
  result = map({ ...candidate, review: undefined }); assert.equal(result.claims[0].status, 'candidate');
  assert.ok(result.issues.some((issue) => issue.code === 'LEGACY_REVIEW_AUDIT_MISSING'));
  await f.host.store.mutate((index) => { index.materials[0].adoption.state = 'excluded'; });
  result = map(candidate); assert.equal(result.claims[0].status, 'candidate'); assert.equal(result.claims[0].sourceResolution, 'fixed_unavailable');
  assert.equal(result.growthEvidence[0].sourceBinding.bindingId, candidate.sourceBinding.bindingId);
});
