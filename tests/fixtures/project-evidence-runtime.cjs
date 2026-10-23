const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const evidenceApi = require('../../electron/project-material-evidence.cjs');
const hostApi = require('../../electron/project-material-host.cjs');
const { createProjectArchiveTransactions } = require('../../electron/project-archive-transaction.cjs');
const { createProjectMaterialAccess } = require('../../electron/project-material-access.cjs');
const { verifiedStudentEvidenceForPublication } = require('../../electron/project-evidence.cjs');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const mainSource = fs.readFileSync(path.join(__dirname, '../../electron/main.cjs'), 'utf8');
function extract(name) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(mainSource); assert.ok(match, name);
  return mainSource.slice(match.index, mainSource.indexOf('\n}', match.index) + 2);
}
function mainContext(f, overrides = {}, { reuseProject = false } = {}) {
  const projectFile = path.join(f.root, 'projects.json');
  if (!reuseProject) fs.writeFileSync(projectFile, JSON.stringify([f.project]));
  const student = { id: 's1', name: 'Synthetic Student', rootPath: path.join(f.root, 'student'),
    rawPath: path.join(f.root, 'student', 'raw'), summaryPath: path.join(f.root, 'student', 'summary') };
  const growthDir = path.join(student.rootPath, 'growth');
  const reviewFile = path.join(growthDir, 'review.json');
  const webContents = { mainFrame: {} }; const event = { sender: webContents, senderFrame: webContents.mainFrame };
  const runs = []; const runFile = path.join(f.project.contributionPath, 'promotion-run-log.json');
  const readProjectRows = () => { const data = JSON.parse(fs.readFileSync(projectFile)); return Array.isArray(data) ? data : data.projects; };
  const writeProjectRows = (rows) => fs.writeFileSync(projectFile, JSON.stringify(rows));
  const projectStore = {
    get: (id) => readProjectRows().find((item) => String(item.id) === String(id)) || null,
    listMetadata: () => readProjectRows(),
    upsert: (next) => writeProjectRows(readProjectRows().map((item) => String(item.id) === String(next.id) ? next : item)),
  };
  const context = { ...evidenceApi, ...hostApi, createProjectArchiveTransactions, createProjectMaterialAccess, verifiedStudentEvidenceForPublication, fs, path, crypto,
    projectArchiveStartupReady: true, projectArchiveStartupManager: () => ({ register: async () => {}, complete: async () => {} }),
    projectArchiveRuntime: { run: (work) => work(), recover: (work) => work(), markPrepared() {}, assertFile() {}, status: () => ({ ready: true }) },
    mainWindow: { isDestroyed: () => false, webContents },
    readProjects: readProjectRows, readProjectMetadata: readProjectRows, writeProjects: writeProjectRows,
    assertProjectStateReady() {}, projectStateStore: () => projectStore,
    changedGrowthProjectStudentIds: () => [], markGrowthStudentsDirty() {},
    normalizeProject: (p) => p, normalizeProjectMetadata: (p) => p, writeProjectStagingIndex() {},
    projectsPath: () => projectFile, assetIndexPath: () => path.join(f.root, 'assets.json'), readStudentsIndex: () => [student], toHostStudent: (s) => s,
    growthEvidenceReviewPath: () => reviewFile, growthModelDirForStudent: () => growthDir,
    growthIndexPath: () => path.join(growthDir, 'index.json'), growthIndexMarkdownPath: () => path.join(growthDir, 'index.md'),
    readGrowthEvidenceReview: (_student, io = fs) => io.existsSync(reviewFile) ? JSON.parse(io.readFileSync(reviewFile)) : { candidates: [] },
    writeGrowthEvidenceReview: (_student, review, { fileIo = fs } = {}) => fileIo.writeFileSync(reviewFile, JSON.stringify(review)),
    ensureGrowthModelForStudent: () => { fs.mkdirSync(growthDir, { recursive: true }); return { dir: growthDir }; },
    readSmallTextFile: (file) => fs.readFileSync(file, 'utf8'), sanitizeName: (value) => value,
    mdCell: (value) => String(value).replaceAll('|', '/'), sha1Text: hash,
    licenseRequiredJson: () => null, appendHostTimeline() {}, rebuildGrowthIndex: () => JSON.stringify({ ok: true, index: {} }),
    ensureProjectWorkspace: (project) => project, projectCompletionGate: () => ({ ok: true }),
    authorizeInternalTaskOperation: () => ({ ok: true, task: { sourceType: 'project', sourceId: 'p1' }, permissions: { read: [f.root] } }),
    taskPathAllowed: (file, roots) => roots.some((root) => file.startsWith(root)),
    generateProjectPromotion: (_project, io = fs) => { io.writeFileSync(f.project.promotionPath, '# Synthetic promotion'); return JSON.stringify({ ok: true, path: f.project.promotionPath }); },
    writeTextIfMissing: (file, text, io = fs) => { io.mkdirSync(path.dirname(file), { recursive: true }); if (!io.existsSync(file)) io.writeFileSync(file, text); },
    appendTextSection: (file, title, text, io = fs) => { io.mkdirSync(path.dirname(file), { recursive: true }); io.appendFileSync(file, `\n## ${title}\n${text}\n`); },
    growthRefreshStatePath: () => path.join(f.root, 'growth-refresh.json'), readGrowthRefreshState: () => ({}),
    markGrowthDirty: (_state, ids) => ({ dirty: ids }), normalizeGrowthRefreshState: (state) => state, scheduleGrowthRefresh() {},
    projectPromotionRunLogPath: () => runFile, readProjectPromotionRunLog: () => fs.existsSync(runFile) ? JSON.parse(fs.readFileSync(runFile)) : { runs: [] },
    appendProjectPromotionRun: (_project, run) => runs.push(run),
    projectDigestLookupCache: {}, ...overrides };
  for (const name of ['mutableProject', 'localProjectSourceAccess', 'growthTransactionSnapshot', 'restoreGrowthTransaction',
    'updateProjectRecord', 'ensureGrowthModelForStudent', 'appendGrowthEvidenceCandidate', 'appendConfirmedGrowthEvidence',
    'updateProjectStudentEvidence', 'updateProjectStudentEvidenceAsync', 'projectEvidenceConfirmationTransactionHost', 'finishProjectEvidenceConfirmation',
    'requiresFixedProjectEvidenceConfirmation', 'updateGrowthEvidenceStatus', 'applyAutomaticGrowthEvidencePlan',
    'projectPromotionPermissionScope', 'projectPublicationTransactionHost', 'finishProjectPublicationTransaction', 'prepareAndPublishProjectPromotion', 'performPublishProjectPromotion']) {
    context[name] = Function('scope', `with (scope) { return (${extract(name)}); }`)(context);
  }
  return { context, event, reviewFile, growthDir, projectFile, get runs() { return fs.existsSync(runFile) ? JSON.parse(fs.readFileSync(runFile)).runs : runs; },
    call: (evidence = f.evidence, bindingId = '') => context.updateProjectStudentEvidenceAsync(event, 'p1', 's1', JSON.stringify(evidence), bindingId).then(JSON.parse) };
}
module.exports = { createEvidenceContext: mainContext };
