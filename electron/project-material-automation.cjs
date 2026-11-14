const crypto = require('node:crypto');
const path = require('node:path');
const { invariant } = require('./project-material-contract.cjs');
const { unchanged } = require('./project-materials.cjs');
const { createProjectMaterialClassification,
  reconcileWorkspacePathClassifications } = require('./project-material-classification.cjs');
const { resolveAutomationFeatureFlags } = require('./automation-feature-flags.cjs');
const AUTOMATION_FEATURES = resolveAutomationFeatureFlags();

const MATERIAL_AUTOMATION_PIPELINE_VERSION = 'project-material-v1';
const SYSTEM_GENERATED_NAMES = new Set([
  '工作空间结构.md',
  'staging-index.json',
  '研究暂存清单.md',
  '研究暂存治理建议.md',
]);

function normalizedPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function isSystemGeneratedMaterialPath(value) {
  const relative = normalizedPath(value);
  const parts = relative.split('/').filter(Boolean);
  return parts.some((part) => part.toLocaleLowerCase('zh-CN') === '.edu-manager')
    || SYSTEM_GENERATED_NAMES.has(parts.at(-1) || '')
    || (parts.at(-1) || '').endsWith('.tmp')
    || (parts.at(-1) || '').endsWith('.transaction-log');
}

function projectMaterialRecordKind(record) {
  const relative = normalizedPath(record?.location?.relativePath);
  if (isSystemGeneratedMaterialPath(relative)) return 'system_generated';
  return record?.recordKind === 'system_generated' ? 'system_generated' : 'user_material';
}

function materialContentGroupId(projectId, sha256) {
  if (!/^[a-f0-9]{64}$/i.test(String(sha256 || ''))) return '';
  return `content-${crypto.createHash('sha256').update(`${projectId}|${String(sha256).toLowerCase()}`)
    .digest('hex').slice(0, 24)}`;
}

function inspectStore(store, options = {}) {
  return typeof store.inspect === 'function' ? store.inspect(options) : store.read(options);
}

function normalizeMaterialAutomation(project) {
  const current = project?.materialAutomation && typeof project.materialAutomation === 'object'
    ? project.materialAutomation : null;
  const inherited = !current && project?.materialOrganization?.enabled === true;
  const source = current || {};
  return {
    enabled: source.enabled === true || inherited,
    processingPaused: source.processingPaused === true,
    autoAdoptPathClassified: source.autoAdoptPathClassified !== false && (Boolean(current) || inherited),
    autoDigest: source.autoDigest !== false && (Boolean(current) || inherited),
    maxBatch: Math.max(1, Math.min(20, Number(source.maxBatch || project?.materialOrganization?.maxBatch || 20))),
    onWorkspaceChange: source.onWorkspaceChange !== false,
    intervalMinutes: Math.max(15, Math.min(10080,
      Number(source.intervalMinutes || project?.materialOrganization?.intervalMinutes || 1440))),
    nextRunAt: String(source.nextRunAt || ''),
    migratedFromMaterialOrganization: inherited,
    authorizationId: String(source.authorizationId || project?.materialOrganization?.authorizationId || ''),
    authorizedAt: String(source.authorizedAt || project?.materialOrganization?.authorizedAt || ''),
    authorizedBy: String(source.authorizedBy || project?.materialOrganization?.authorizedBy || ''),
    lastRunAt: String(source.lastRunAt || ''),
    lastStatus: String(source.lastStatus || ''),
    lastMessage: String(source.lastMessage || ''),
    projectionVersion: String(source.projectionVersion || ''),
    needsRepair: source.needsRepair === true,
  };
}

function automationDisposition(project, record) {
  const kind = projectMaterialRecordKind(record);
  if (kind === 'system_generated') return { state: 'ignored', reasons: ['system_generated'] };
  if (['missing', 'unavailable'].includes(record.availability)) {
    return { state: 'error', reasons: [record.availability === 'missing' ? 'source_missing' : 'source_unavailable'] };
  }
  if (record.processing?.state === 'skipped_unsupported') {
    return { state: 'completed', reasons: ['skipped_unsupported'] };
  }
  if (['failed', 'unsupported', 'failed_retryable', 'failed_terminal', 'execution_unknown', 'needs_user_action'].includes(record.processing?.state)) {
    return { state: 'error', reasons: ['processing_failed'] };
  }
  if (record.fingerprintConflict === true || !/^[a-f0-9]{64}$/i.test(String(record.sha256 || ''))) {
    return { state: 'confirmation', reasons: [record.fingerprintConflict ? 'fingerprint_conflict' : 'fingerprint_incomplete'] };
  }
  if (record.adoption?.state === 'accepted') {
    const complete = record.processing?.state === 'completed'
      && record.processing?.processedVersion === record.version;
    return { state: complete ? 'completed' : 'processing', reasons: complete ? []
      : [record.classification?.categoryId ? 'pending_digest' : 'pending_digest_provisional_category'] };
  }
  if (record.adoption?.state === 'excluded') return { state: 'completed', reasons: [] };
  if (record.classification?.manualLocked) return { state: 'confirmation', reasons: ['manual_locked'] };
  if (record.location?.kind !== 'workspace' || record.location?.rootId !== 'workspace') {
    return { state: 'confirmation', reasons: ['outside_workspace'] };
  }
  const projectStudents = new Set((project?.studentIds || []).map(String));
  const crossScope = (record.sources || []).some((source) => source.studentId
    && !projectStudents.has(String(source.studentId)));
  if (crossScope) return { state: 'confirmation', reasons: ['scope_conflict'] };
  const classification = record.classification || {};
  // The workspace already proves project ownership. Category uncertainty is a
  // reversible local decision, so it must not block project adoption/digestion;
  // the file remains in the project inbox and may be reclassified later.
  if (!classification.categoryId) return AUTOMATION_FEATURES.provisionalProjectInbox
    ? { state: 'auto_ready', reasons: ['provisional_project_inbox'] }
    : { state: 'confirmation', reasons: ['needs_classification'] };
  const pathReady = classification.source === 'workspace_path' && Boolean(classification.categoryId);
  const aiReady = classification.source === 'ai' && classification.confidence === 'high'
    && Boolean(classification.categoryId) && classification.hostValidated === true;
  if (pathReady || aiReady) return { state: 'auto_ready', reasons: [] };
  return { state: 'confirmation', reasons: [classification.categoryId ? 'classification_confirmation' : 'needs_classification'] };
}

function projectMaterialAutomationOverview(project, index, job = null) {
  let businessMaterialCount = 0, systemGeneratedCount = 0, acceptedCount = 0;
  let autoReady = 0, autoCompleted = 0, processing = 0, needsConfirmation = 0, errors = 0;
  let digestPendingReferenceCount = 0;
  const unique = new Set(), pendingDigest = new Set();
  for (const record of index.materials || []) {
    if (projectMaterialRecordKind(record) !== 'user_material') { systemGeneratedCount++; continue; }
    businessMaterialCount++;
    const sha256 = String(record.sha256 || '').toLowerCase();
    if (/^[a-f0-9]{64}$/.test(sha256)) unique.add(sha256);
    if (record.adoption?.state === 'accepted') {
      acceptedCount++;
      if (!['completed', 'skipped_unsupported'].includes(record.processing?.state)
        || (record.processing?.state === 'completed' && record.processing?.processedVersion !== record.version)) {
        digestPendingReferenceCount++;
        if (sha256) pendingDigest.add(sha256);
      }
    }
    const disposition = automationDisposition(project, record);
    if (disposition.state === 'auto_ready') autoReady++;
    else if (disposition.state === 'completed') autoCompleted++;
    else if (disposition.state === 'processing') processing++;
    else if (disposition.state === 'confirmation') needsConfirmation++;
    else if (disposition.state === 'error') errors++;
  }
  return {
    projectId: project.id,
    registryRevision: index.revision,
    businessMaterialCount,
    uniqueContentCount: unique.size,
    systemGeneratedCount,
    acceptedCount,
    autoReady,
    autoCompleted,
    processing,
    needsConfirmation,
    errors,
    digestPendingContentCount: pendingDigest.size,
    digestPendingReferenceCount,
    automation: normalizeMaterialAutomation(project),
    job: job ? { jobId: job.jobId, status: job.status, phase: job.phase,
      processed: job.processed, total: job.total, message: job.message } : null,
  };
}

function listProjectMaterialExceptions(project, index, request = {}) {
  const offset = Number(request.offset || 0);
  const limit = Number(request.limit || 50);
  invariant(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit)
    && limit > 0 && limit <= 100, 'invalid_pagination', '异常资料分页参数无效。');
  const reason = String(request.reason || '');
  const rows = [];
  for (const record of index.materials || []) {
    const disposition = automationDisposition(project, record);
    if (!['confirmation', 'error'].includes(disposition.state)) continue;
    if (reason && !disposition.reasons.includes(reason)) continue;
    rows.push({
      materialId: record.materialId,
      version: record.version,
      recordRevision: record.recordRevision,
      title: path.posix.basename(normalizedPath(record.location?.relativePath)),
      logicalPath: normalizedPath(record.location?.relativePath),
      recordKind: projectMaterialRecordKind(record),
      automationDisposition: disposition.state,
      reasons: disposition.reasons,
      sha256: record.sha256,
      contentGroupId: materialContentGroupId(project.id, record.sha256),
      categoryId: record.classification?.categoryId || '',
      manualLocked: Boolean(record.classification?.manualLocked),
      availability: record.availability || 'available',
      updatedAt: record.updatedAt || record.createdAt || '',
    });
  }
  rows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)
    || left.logicalPath.localeCompare(right.logicalPath, 'zh-CN'));
  return { projectId: project.id, registryRevision: index.revision, total: rows.length,
    offset, limit, items: rows.slice(offset, offset + limit) };
}

async function tagProjectMaterialKinds(store) {
  const baseline = await inspectStore(store, { fresh: true });
  if (!(baseline.materials || []).some((record) => record.recordKind !== projectMaterialRecordKind(record)
    || ['unsupported', 'failed'].includes(record.processing?.state))) {
    return { result: { changed: 0 }, revision: baseline.revision, unchanged: true };
  }
  const result = await store.mutate((index) => {
    let changed = 0;
    for (const record of index.materials || []) {
      const kind = projectMaterialRecordKind(record);
      const legacyState = record.processing?.state;
      if (record.recordKind === kind && !['unsupported', 'failed'].includes(legacyState)) continue;
      record.recordKind = kind;
      if (legacyState === 'unsupported') record.processing = { ...record.processing, state: 'skipped_unsupported' };
      if (legacyState === 'failed') record.processing = { ...record.processing, state: 'failed_terminal' };
      record.recordRevision++;
      record.updatedAt = new Date().toISOString();
      changed++;
    }
    return changed ? { changed } : unchanged({ changed: 0 });
  }, baseline.revision);
  return result;
}

async function applyHighConfidenceSuggestions(store) {
  const baseline = await inspectStore(store);
  if (!(baseline.classificationSuggestions || []).some((suggestion) => suggestion.status === 'pending'
    && suggestion.source === 'ai' && suggestion.confidence === 'high'
    && suggestion.needsConfirmation === false)) {
    return { result: { applied: 0 }, revision: baseline.revision, unchanged: true };
  }
  return store.mutate((index) => {
    let applied = 0;
    const changedAt = new Date().toISOString();
    for (const suggestion of index.classificationSuggestions || []) {
      if (suggestion.status !== 'pending' || suggestion.source !== 'ai'
        || suggestion.confidence !== 'high' || suggestion.needsConfirmation !== false) continue;
      const record = index.materials.find((item) => item.materialId === suggestion.materialId);
      const validCategory = index.categories.some((item) => item.categoryId === suggestion.categoryId
        && item.active !== false);
      if (!record || !validCategory || record.version !== suggestion.version
        || record.recordRevision !== suggestion.recordRevision || record.classification?.manualLocked
        || projectMaterialRecordKind(record) !== 'user_material') {
        suggestion.status = 'stale'; suggestion.reviewedAt = changedAt;
        continue;
      }
      record.classification = { ...(record.classification || {}), categoryId: suggestion.categoryId,
        tags: Array.isArray(suggestion.tags) ? suggestion.tags : [], source: 'ai', confidence: 'high',
        hostValidated: true, manualLocked: false, actorId: 'material-automation', changedAt,
        ruleVersion: suggestion.ruleVersion || '' };
      record.organizationState = 'classified';
      record.recordRevision++;
      record.updatedAt = changedAt;
      suggestion.status = 'accepted'; suggestion.reviewedAt = changedAt;
      suggestion.reviewedBy = 'material-automation';
      applied++;
    }
    return applied ? { applied } : unchanged({ applied: 0 });
  }, baseline.revision);
}

function aiClassificationCandidates(project, index, limit) {
  const pending = new Set((index.classificationSuggestions || [])
    .filter((item) => item.status === 'pending' && item.source === 'ai')
    .map((item) => item.materialId));
  return (index.materials || []).filter((record) => {
    if (pending.has(record.materialId) || projectMaterialRecordKind(record) !== 'user_material') return false;
    if (record.adoption?.state !== 'candidate' || record.classification?.manualLocked
      || record.classification?.categoryId) return false;
    if (record.location?.kind !== 'workspace' || record.location?.rootId !== 'workspace') return false;
    if (!/^[a-f0-9]{64}$/i.test(String(record.sha256 || '')) || record.fingerprintConflict === true) return false;
    const disposition = automationDisposition(project, record);
    return disposition.reasons.includes('needs_classification')
      || disposition.reasons.includes('provisional_project_inbox');
  }).slice(0, limit);
}

async function requestAiClassifications(project, store, options, limit) {
  if (typeof options.requestAiSuggestions !== 'function') return { attempted: 0, recorded: 0,
    needsConfirmation: 0, failed: [] };
  const index = await inspectStore(store);
  const candidates = aiClassificationCandidates(project, index, limit);
  if (!candidates.length) return { attempted: 0, recorded: 0, needsConfirmation: 0, failed: [] };
  const response = await options.requestAiSuggestions({ project, registryRevision: index.revision,
    candidates: structuredClone(candidates), categories: structuredClone((index.categories || [])
      .filter((item) => item.active !== false)) });
  const suggestions = Array.isArray(response?.suggestions) ? response.suggestions : [];
  const failed = Array.isArray(response?.failed) ? response.failed : [];
  if (!suggestions.length) return { attempted: candidates.length, recorded: 0,
    needsConfirmation: 0, failed };
  const service = createProjectMaterialClassification(project, store);
  await service.ensureWorkspaceCategories();
  const fingerprint = suggestions.map((item) => [item.materialId, item.expectedVersion,
    item.expectedRecordRevision, item.categoryId, item.confidence]);
  const recorded = await service.recordSuggestions(suggestions, {
    actorId: 'material-automation-ai', source: 'ai', canSuggest: true,
    ruleVersion: String(response.ruleVersion || 'project-material-ai-v1'),
    requestId: `material-ai-${crypto.createHash('sha256').update(JSON.stringify([
      project.id, index.revision, fingerprint,
    ])).digest('hex').slice(0, 32)}`,
  });
  const successful = recorded.results.filter((item) => item.ok);
  return { attempted: candidates.length, recorded: successful.length,
    needsConfirmation: suggestions.filter((item) => item.confidence !== 'high'
      || item.needsConfirmation !== false).length,
    failed: [...failed, ...recorded.results.filter((item) => !item.ok)] };
}

async function runProjectMaterialAutomation(project, store, options = {}) {
  const configuration = normalizeMaterialAutomation(project);
  invariant(configuration.enabled || options.reason === 'manual', 'automation_disabled',
    '此项目尚未授权资料自动处理。');
  await tagProjectMaterialKinds(store);
  await reconcileWorkspacePathClassifications(project, store);
  await applyHighConfidenceSuggestions(store);
  let index = await inspectStore(store);
  const limit = Math.min(configuration.maxBatch, Math.max(1, Number(options.maxBatch || configuration.maxBatch)));
  const ai = await requestAiClassifications(project, store, options,
    Math.min(limit, Math.max(1, Number(options.maxAiBatch || 5))));
  if (ai.recorded) {
    await applyHighConfidenceSuggestions(store);
    index = await inspectStore(store);
  }
  const candidates = configuration.autoAdoptPathClassified
    ? index.materials.filter((record) => automationDisposition(project, record).state === 'auto_ready') : [];
  const selected = candidates.slice(0, limit);
  const results = [];
  if (selected.length) {
    const changes = selected.map((record) => ({ materialId: record.materialId, expectedVersion: record.version,
      expectedRecordRevision: record.recordRevision, state: 'accepted' }));
    const committed = await store.decideAdoption(changes, {
      actorId: 'material-automation',
      reason: '目录与项目分类唯一匹配，主机稳定性复核通过后自动采用。',
      expectedRevision: index.revision,
      idempotencyKey: String(options.idempotencyKey || `material-auto-${index.revision}`),
    });
    results.push(...committed.result);
    index = await inspectStore(store);
  }
  return { configuration, processed: selected.length, ai,
    adopted: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok),
    remaining: Math.max(0, candidates.length - selected.length),
    overview: projectMaterialAutomationOverview(project, index),
  };
}

module.exports = {
  MATERIAL_AUTOMATION_PIPELINE_VERSION,
  SYSTEM_GENERATED_NAMES,
  isSystemGeneratedMaterialPath,
  projectMaterialRecordKind,
  materialContentGroupId,
  normalizeMaterialAutomation,
  automationDisposition,
  projectMaterialAutomationOverview,
  listProjectMaterialExceptions,
  tagProjectMaterialKinds,
  applyHighConfidenceSuggestions,
  aiClassificationCandidates,
  requestAiClassifications,
  runProjectMaterialAutomation,
};
