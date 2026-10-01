const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const promotion = require('../../electron/project-material-promotion.cjs');
const host = require('../../electron/project-material-host.cjs');
const evidenceApi = require('../../electron/project-material-evidence.cjs');
const { createProjectArchiveTransactions } = require('../../electron/project-archive-transaction.cjs');
const { mergeAssetReferences } = require('../../electron/asset-statistics.cjs');
const hash = (value, algorithm = 'sha256') => crypto.createHash(algorithm).update(value).digest('hex');
const main = fs.readFileSync(path.join(__dirname, '../../electron/main.cjs'), 'utf8');
function extract(name) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(main); assert.ok(match, name);
  const end = main.indexOf('\n}', match.index);
  assert.ok(end > match.index, `${name} terminator`);
  return main.slice(match.index, end + 2);
}

function mainContext(f, overrides = {}) {
  const projectFile = path.join(f.root, 'projects.json');
  const assetFile = path.join(f.root, 'asset-index.json');
  const runFile = path.join(f.project.contributionPath, 'promotion-run-log.json');
  fs.writeFileSync(projectFile, JSON.stringify([structuredClone(f.project), { id: 'other', note: 'before' }]));
  const readProjects = () => { const data = JSON.parse(fs.readFileSync(projectFile)); return Array.isArray(data) ? data : data.projects; };
  const context = { ...host, ...promotion, ...evidenceApi, createProjectArchiveTransactions, mergeAssetReferences, fs, path, crypto,
    projectArchiveStartupReady: true, projectArchiveStartupManager: () => ({ register: async () => {}, complete: async () => {} }),
    projectArchiveRuntime: { run: (work) => work(), recover: (work) => work(), markPrepared() {}, assertFile() {}, status: () => ({ ready: true }) },
    normalizeProject: (item) => item, readProjects, writeProjects: (value) => fs.writeFileSync(projectFile, JSON.stringify(value)),
    mutableProject: () => ({ project: readProjects()[0] }), ensureProjectWorkspace: (p) => p,
    readStudentsIndex: () => [f.student],
    assetIndexPath: () => assetFile,
    resolveStudentLogicalPath: () => ({ workspaceId: 'synthetic', logicalPath: 'synthetic' }),
    readProjectKnowledgeReview: () => ({ records: [] }), projectCompletionGate: () => ({ ok: true }),
    projectsPath: () => path.join(f.root, 'projects.json'), toHostStudent: (s) => s,
    growthRefreshStatePath: () => path.join(f.root, 'growth-refresh.json'),
    markGrowthDirty: (_state, ids) => ({ dirty: ids }), normalizeGrowthRefreshState: (state) => state, scheduleGrowthRefresh() {},
    projectDigestLookupCache: {}, projectKnowledgeReviewPath: () => path.join(f.project.managerPath, 'knowledge-review.json'),
    growthModelDirForStudent: () => path.join(f.student.rootPath, 'growth'),
    authorizeInternalTaskOperation: () => ({ ok: true, task: { sourceType: 'project', sourceId: f.project.id }, permissions: { read: [f.root] } }),
    taskPathAllowed: (target, roots) => roots.some((root) => target.startsWith(root)), licenseRequiredJson: () => null,
    projectPromotionRunLogPath: () => runFile,
    readProjectPromotionRunLog: () => fs.existsSync(runFile) ? JSON.parse(fs.readFileSync(runFile)) : { runs: [] },
    appendProjectPromotionRun: (_project, run) => fs.writeFileSync(runFile, JSON.stringify({ runs: [run] })),
    appendHostTimeline() {}, timestampForFilename: () => 'synthetic',
    sanitizeName: (name) => name,
    ensureGrowthModelForStudent: () => { const dir = path.join(f.student.rootPath, 'growth'); fs.mkdirSync(dir, { recursive: true }); return { dir }; },
    writeTextIfMissing: (file, text, io = fs) => { io.mkdirSync(path.dirname(file), { recursive: true }); if (!io.existsSync(file)) io.writeFileSync(file, text); },
    mdCell: (value) => String(value).replaceAll('|', '/'),
    readSmallTextFile: (file) => fs.readFileSync(file, 'utf8'),
    sha1Text: (value) => hash(value, 'sha1'), sha1File: (file) => fs.statSync(file).isFile() ? hash(fs.readFileSync(file), 'sha1') : '',
    uniqueTargetFile: (root, name, io = fs) => { let candidate = path.join(root, name); let index = 0; while (io.existsSync(candidate)) candidate = path.join(root, `${++index}-${name}`); return candidate; },
    appendTextSection: () => { throw new Error('file absorption must not assert personal contribution'); },
    ...overrides };
  // Execute filesystem failure/rollback paths in the same realm as the host.
  for (const name of ['projectPromotionPlan', 'projectPromotionPermissionScope', 'prepareAndPerformProjectPromotion', 'createArchiveFileTransaction', 'performProjectPromotionPlan', 'appendConfirmedGrowthEvidence',
    'projectPublicationTransactionHost', 'finishProjectPublicationTransaction', 'readAssetIndex', 'writeAssetIndex', 'upsertAssetFromFile', 'normalizeAssetReference', 'mergeUnique', 'materialTypeForFile']) {
    context[name] = Function('scope', `with (scope) { return (${extract(name)}); }`)(context);
  }
  function useRealGrowthHelpers() {
    context.growthEvidenceReviewPath = () => path.join(f.student.rootPath, 'growth', 'review.json');
    context.readGrowthEvidenceReview = (_student, io = fs) => io.existsSync(context.growthEvidenceReviewPath()) ? JSON.parse(io.readFileSync(context.growthEvidenceReviewPath())) : { candidates: [] };
    context.writeGrowthEvidenceReview = (_student, review, { fileIo = fs } = {}) => fileIo.writeFileSync(context.growthEvidenceReviewPath(), JSON.stringify(review));
    for (const name of ['ensureGrowthModelForStudent', 'appendGrowthEvidenceCandidate', 'appendTextSection']) {
      context[name] = Function('scope', `with (scope) { return (${extract(name)}); }`)(context);
    }
  }
  return { context, projectFile, assetFile, runFile, useRealGrowthHelpers, get runs() { return context.readProjectPromotionRunLog().runs; },
    get assets() { return context.readAssetIndex(); }, get projects() { return readProjects(); },
    mutateProjects(callback) { const projects = readProjects(); callback(projects); context.writeProjects(projects); },
    execute: (input = f.input()) => Promise.resolve(context.performProjectPromotionPlan(f.project.id, JSON.stringify(input), { taskId: 'task1', executionId: 'run1' })).then(JSON.parse) };
}

module.exports = { createPromotionContext: mainContext };
