const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  invariant, identifier, positiveVersion, relativeMaterialPath,
} = require('./project-material-contract.cjs');
const { unchanged } = require('./project-materials.cjs');

const now = () => new Date().toISOString();
const clone = (value) => structuredClone(value);
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const cleanText = (value, limit) => String(value || '').trim().slice(0, limit);
const compare = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const WORKSPACE_PATH_RULE_VERSION = 'workspace-path-v1';

function strictKeys(value, allowed, code = 'invalid_classification_request') {
  invariant(value && typeof value === 'object' && !Array.isArray(value), code, '分类请求结构无效。');
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  invariant(!unknown, unknown && /path|file|move|delete|command|script|target/i.test(unknown)
    ? 'unsafe_classification_instruction' : code,
  unknown && /path|file|move|delete|command|script|target/i.test(unknown)
    ? '分类建议只能引用允许的分类ID，不能包含路径、移动、删除或执行指令。'
    : '分类请求包含不支持的字段。');
}

function recordRevision(value) {
  invariant(Number.isSafeInteger(value) && value >= 0, 'invalid_revision', '资料记录修订号无效。');
  return value;
}

function normalizedWorkspaceFolders(values, inboxRelativePath) {
  const inbox = String(inboxRelativePath || '收件箱').replace(/\\/g, '/').split('/')[0]
    .toLocaleLowerCase('zh-CN');
  const source = Array.isArray(values) ? values : [];
  const seen = new Set();
  const result = [];
  for (const value of source) {
    const relative = relativeMaterialPath(String(value || '').replace(/\\/g, '/'));
    const key = relative.toLocaleLowerCase('zh-CN');
    if (key === inbox || seen.has(key)) continue;
    seen.add(key);
    result.push(relative);
  }
  return result.slice(0, 100);
}

function actualWorkspaceFolders(project) {
  const workspacePath = String(project?.workspacePath || '').trim();
  if (!workspacePath) return [];
  const excluded = new Set([
    String(project.inboxRelativePath || '收件箱').replace(/\\/g, '/').split('/')[0],
    '研究暂存', '.edu-manager',
  ].map((value) => value.toLocaleLowerCase('zh-CN')));
  const managerPath = String(project.managerPath || '').trim();
  if (managerPath) {
    const relativeManager = path.relative(path.resolve(workspacePath), path.resolve(managerPath));
    if (relativeManager && !relativeManager.startsWith('..') && !path.isAbsolute(relativeManager)) {
      excluded.add(relativeManager.replace(/\\/g, '/').split('/')[0].toLocaleLowerCase('zh-CN'));
    }
  }
  let entries;
  try {
    entries = fs.readdirSync(path.resolve(workspacePath), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()
    && !entry.name.startsWith('.') && !excluded.has(entry.name.toLocaleLowerCase('zh-CN')))
    .map((entry) => entry.name).slice(0, 200);
}

function workspaceFolders(project) {
  const configured = normalizedWorkspaceFolders(project.workspaceFolders, project.inboxRelativePath);
  const actual = normalizedWorkspaceFolders(actualWorkspaceFolders(project), project.inboxRelativePath);
  if (!actual.length) return configured;
  const actualByKey = new Map(actual.map((value) => [value.toLocaleLowerCase('zh-CN'), value]));
  const configuredKeys = new Set(configured.map((value) => value.toLocaleLowerCase('zh-CN')));
  const retained = configured.map((value) => actualByKey.get(value.toLocaleLowerCase('zh-CN')))
    .filter(Boolean);
  const discovered = actual.filter((value) => !configuredKeys.has(value.toLocaleLowerCase('zh-CN')))
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));
  return [...retained, ...discovered].slice(0, 100);
}

function categoryMatchesFolder(category, folder) {
  const key = folder.toLocaleLowerCase('zh-CN');
  return [category.relativePath, category.name, ...(Array.isArray(category.aliases) ? category.aliases : [])]
    .some((value) => String(value || '').toLocaleLowerCase('zh-CN') === key);
}

function categoryDefinitions(project, index) {
  const folders = workspaceFolders(project);
  const existing = Array.isArray(index.categories) ? index.categories.map(clone) : [];
  if (!folders.length) return existing;
  const definitions = existing.map((item) => ({ ...item,
    aliases: Array.isArray(item.aliases) ? item.aliases : [] }));
  const usedIds = new Set(definitions.map((item) => item.categoryId));
  const managedDefinitions = definitions.filter((item) => item.templateSource === 'workspace-template');
  const usedManagedIds = new Set();
  let nextSlot = managedDefinitions.reduce((maximum, item) => Math.max(maximum,
    Number.isSafeInteger(item.templateSlot) ? item.templateSlot : -1), -1) + 1;
  for (const folder of folders) {
    let managed = managedDefinitions.find((item) => !usedManagedIds.has(item.categoryId)
      && categoryMatchesFolder(item, folder));
    if (!managed) managed = managedDefinitions.find((item) => !usedManagedIds.has(item.categoryId));
    if (managed) {
      if (managed.name !== folder) managed.aliases = [...new Set([...managed.aliases, managed.name])].slice(-20);
      managed.name = folder;
      managed.relativePath = folder;
      managed.active = true;
      usedManagedIds.add(managed.categoryId);
      continue;
    }
    const slot = nextSlot++;
    let categoryId = `workspace-slot-${String(slot + 1).padStart(2, '0')}`;
    let suffix = 2;
    while (usedIds.has(categoryId)) categoryId = `workspace-slot-${String(slot + 1).padStart(2, '0')}-${suffix++}`;
    usedIds.add(categoryId);
    const created = { categoryId, name: folder, relativePath: folder, active: true,
      templateSource: 'workspace-template', templateSlot: slot, aliases: [] };
    definitions.push(created);
    managedDefinitions.push(created);
    usedManagedIds.add(categoryId);
  }
  for (const item of definitions) {
    if (item.templateSource === 'workspace-template' && !usedManagedIds.has(item.categoryId)) item.active = false;
  }
  return definitions;
}

function categoryForWorkspacePath(relativePath, categories, inboxRelativePath = '收件箱') {
  let relative;
  try { relative = relativeMaterialPath(relativePath); } catch { return null; }
  const parts = relative.split('/');
  if (parts.length < 2) return null;
  const folder = parts[0];
  const inbox = String(inboxRelativePath || '收件箱').replace(/\\/g, '/').split('/')[0]
    .toLocaleLowerCase('zh-CN');
  if (folder.toLocaleLowerCase('zh-CN') === inbox) return null;
  const matches = (categories || []).filter((category) => category.active !== false
    && categoryMatchesFolder(category, folder));
  return matches.length === 1 ? matches[0] : null;
}

async function reconcileWorkspacePathClassifications(project, store, { materialIds } = {}) {
  const requestedIds = Array.isArray(materialIds) && materialIds.length ? new Set(materialIds) : null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const baseline = typeof store.inspect === 'function'
      ? await store.inspect({ fresh: attempt > 0 }) : await store.read({ fresh: attempt > 0 });
    const definitions = categoryDefinitions(project, baseline);
    const currentCategories = (baseline.categories || []).map((item) => ({ ...item,
      aliases: Array.isArray(item.aliases) ? item.aliases : [] }));
    const previewCounts = { classified: 0, reclassified: 0, cleared: 0, unchanged: 0,
      skippedManual: 0, skippedOtherSource: 0 };
    let previewChanged = !compare(currentCategories, definitions);
    for (const material of baseline.materials || []) {
      if (material.location?.kind !== 'workspace' || material.location?.rootId !== 'workspace'
        || (requestedIds && !requestedIds.has(material.materialId))) continue;
      const classification = material.classification || { categoryId: '', tags: [], source: '', manualLocked: false };
      if (classification.manualLocked) { previewCounts.skippedManual++; continue; }
      const matched = categoryForWorkspacePath(material.location.relativePath, definitions,
        project.inboxRelativePath);
      const pathManaged = classification.source === 'workspace_path';
      if (matched && (!classification.categoryId || pathManaged)) {
        const categoryChanged = classification.categoryId !== matched.categoryId;
        const stateChanged = material.organizationState !== 'classified';
        if (!categoryChanged && !stateChanged && pathManaged) { previewCounts.unchanged++; continue; }
        if (categoryChanged && pathManaged) previewCounts.reclassified++;
        else previewCounts.classified++;
        previewChanged = true;
        continue;
      }
      if (!matched && pathManaged) { previewCounts.cleared++; previewChanged = true; continue; }
      if (matched && classification.categoryId && !pathManaged) previewCounts.skippedOtherSource++;
      else previewCounts.unchanged++;
    }
    if (!previewChanged) return { projectId: project.id, ruleVersion: WORKSPACE_PATH_RULE_VERSION,
      categoriesUpdated: false, ...previewCounts, registryRevision: baseline.revision, unchanged: true };
    try {
      const changedAt = now();
      const committed = await store.mutate((index) => {
        let changed = !compare(currentCategories, definitions);
        if (changed) index.categories = clone(definitions);
        const counts = { classified: 0, reclassified: 0, cleared: 0, unchanged: 0,
          skippedManual: 0, skippedOtherSource: 0 };
        for (const material of index.materials || []) {
          if (material.location?.kind !== 'workspace' || material.location?.rootId !== 'workspace'
            || (requestedIds && !requestedIds.has(material.materialId))) continue;
          const classification = material.classification || { categoryId: '', tags: [], source: '', manualLocked: false };
          if (classification.manualLocked) { counts.skippedManual++; continue; }
          const matched = categoryForWorkspacePath(material.location.relativePath, definitions,
            project.inboxRelativePath);
          const pathManaged = classification.source === 'workspace_path';
          if (matched && (!classification.categoryId || pathManaged)) {
            const categoryChanged = classification.categoryId !== matched.categoryId;
            const stateChanged = material.organizationState !== 'classified';
            if (!categoryChanged && !stateChanged && pathManaged) { counts.unchanged++; continue; }
            material.classification = { ...classification, categoryId: matched.categoryId,
              tags: Array.isArray(classification.tags) ? classification.tags : [], source: 'workspace_path',
              manualLocked: false, actorId: 'workspace-scan', changedAt,
              ruleVersion: WORKSPACE_PATH_RULE_VERSION };
            material.organizationState = 'classified';
            material.recordRevision++;
            material.updatedAt = changedAt;
            for (const suggestion of index.classificationSuggestions || []) {
              if (suggestion.materialId === material.materialId && suggestion.status === 'pending') {
                suggestion.status = 'stale'; suggestion.reviewedAt = changedAt;
              }
            }
            if (categoryChanged && pathManaged) counts.reclassified++;
            else counts.classified++;
            changed = true;
            continue;
          }
          if (!matched && pathManaged) {
            material.classification = { categoryId: '', tags: [], source: '', manualLocked: false,
              actorId: 'workspace-scan', changedAt, ruleVersion: WORKSPACE_PATH_RULE_VERSION };
            material.organizationState = 'unclassified';
            material.recordRevision++;
            material.updatedAt = changedAt;
            counts.cleared++;
            changed = true;
            continue;
          }
          if (matched && classification.categoryId && !pathManaged) counts.skippedOtherSource++;
          else counts.unchanged++;
        }
        const response = { projectId: project.id, ruleVersion: WORKSPACE_PATH_RULE_VERSION,
          categoriesUpdated: !compare(currentCategories, definitions), ...counts };
        return changed ? response : unchanged(response);
      }, baseline.revision);
      return { ...committed.result, registryRevision: committed.revision,
        unchanged: Boolean(committed.unchanged) };
    } catch (error) {
      if (error.code !== 'revision_conflict' || attempt) throw error;
    }
  }
  throw Object.assign(new Error('目录分类同步冲突，请刷新后重试。'), { code: 'revision_conflict' });
}

function normalizeTags(values, allowedTagIds) {
  invariant(values === undefined || Array.isArray(values), 'invalid_tags', '分类标签无效。');
  const tags = [...new Set((values || []).map((value) => identifier(String(value), '标签ID')))];
  invariant(tags.length <= 16, 'invalid_tags', '每份资料最多使用16个标签。');
  const missing = tags.find((tag) => !allowedTagIds.has(tag));
  invariant(!missing, 'tag_missing', '分类标签不在项目允许范围内。');
  return tags;
}

function ensureState(index) {
  index.classificationSuggestions ||= [];
  index.classificationOperations ||= [];
  index.classificationReceipts ||= [];
  invariant(index.classificationSuggestions.length <= 5000
    && index.classificationOperations.length <= 5000
    && index.classificationReceipts.length <= 10000,
  'classification_capacity', '项目分类操作记录已达到安全上限，请先在主机归档操作记录。');
}

function receipt(index, kind, actorId, idempotencyKey, payloadHash) {
  const found = index.classificationReceipts.find((item) => item.kind === kind
    && item.actorId === actorId && item.idempotencyKey === idempotencyKey);
  if (!found) return null;
  invariant(found.payloadHash === payloadHash, 'idempotency_conflict', '同一请求编号已用于不同的分类操作。');
  return found;
}

function createProjectMaterialClassification(project, store) {
  identifier(project?.id, '项目ID');
  invariant(store && typeof store.read === 'function' && typeof store.mutate === 'function',
    'classification_store_missing', '项目分类服务缺少资料登记。');
  const allowedTagIds = new Set((project.materialTagDefinitions || [])
    .filter((item) => item?.active !== false)
    .map((item) => identifier(String(item.tagId), '标签ID')));

  async function ensureWorkspaceCategories() {
    for (let attempt = 0; attempt < 2; attempt++) {
      const index = typeof store.inspect === 'function'
        ? await store.inspect({ fresh: attempt > 0 }) : await store.read({ fresh: attempt > 0 });
      const definitions = categoryDefinitions(project, index);
      const current = (index.categories || []).map((item) => ({ ...item,
        aliases: Array.isArray(item.aliases) ? item.aliases : [] }));
      if (compare(current, definitions)) return { categories: current, revision: index.revision, unchanged: true };
      try {
        const committed = await store.setCategories(definitions, index.revision);
        return { categories: committed.result, revision: committed.revision, unchanged: false };
      } catch (error) {
        if (error.code !== 'revision_conflict' || attempt) throw error;
      }
    }
    throw Object.assign(new Error('分类初始化冲突，请刷新后重试。'), { code: 'revision_conflict' });
  }

  function normalizeSuggestion(item) {
    strictKeys(item, new Set(['materialId', 'expectedVersion', 'expectedRecordRevision',
      'categoryId', 'tags', 'reason', 'needsConfirmation', 'confidence', 'evidence']));
    const confidence = String(item.confidence || 'medium');
    invariant(['low', 'medium', 'high'].includes(confidence), 'invalid_confidence', '分类建议置信度无效。');
    const evidence = Array.isArray(item.evidence)
      ? item.evidence.map((value) => cleanText(value, 200)).filter(Boolean).slice(0, 8) : [];
    return {
      materialId: identifier(item.materialId, '资料ID'),
      expectedVersion: positiveVersion(item.expectedVersion),
      expectedRecordRevision: recordRevision(item.expectedRecordRevision),
      categoryId: identifier(item.categoryId, '分类ID'),
      tags: normalizeTags(item.tags, allowedTagIds),
      reason: cleanText(item.reason, 500),
      needsConfirmation: item.needsConfirmation !== false,
      confidence,
      evidence,
    };
  }

  async function recordSuggestions(items, { actorId, ruleVersion, requestId, source = 'ai', canSuggest = true } = {}) {
    identifier(actorId, '建议人ID');
    identifier(ruleVersion, '规则版本');
    identifier(requestId, '请求ID');
    invariant(canSuggest, 'forbidden', '当前身份不能提交此项目的分类建议。');
    invariant(['ai', 'member', 'rule'].includes(source), 'invalid_classification_source', '分类建议来源无效。');
    invariant(Array.isArray(items) && items.length > 0 && items.length <= 200,
      'invalid_batch', '每批分类建议须包含1至200项。');
    const normalized = items.map(normalizeSuggestion);
    invariant(new Set(normalized.map((item) => item.materialId)).size === normalized.length,
      'duplicate_material', '同一批分类建议不能重复资料。');
    const payloadHash = hash({ projectId: project.id, actorId, ruleVersion, source, items: normalized });
    const committed = await store.mutate((index) => {
      ensureState(index);
      const replay = receipt(index, 'suggest', actorId, requestId, payloadHash);
      if (replay) return unchanged(replay.response);
      const results = normalized.map((item) => {
        const material = index.materials.find((record) => record.materialId === item.materialId);
        if (!material) return { materialId: item.materialId, ok: false, code: 'material_missing' };
        if (material.version !== item.expectedVersion || material.recordRevision !== item.expectedRecordRevision) {
          return { materialId: item.materialId, ok: false, code: 'version_conflict' };
        }
        if (!index.categories.some((category) => category.categoryId === item.categoryId && category.active)) {
          return { materialId: item.materialId, ok: false, code: 'category_missing' };
        }
        if (material.classification?.manualLocked) {
          return { materialId: item.materialId, ok: false, code: 'manual_locked' };
        }
        const suggestionId = `classification-suggestion-${hash([
          project.id, item.materialId, item.expectedVersion, item.expectedRecordRevision,
          item.categoryId, item.tags, ruleVersion,
        ]).slice(0, 32)}`;
        let suggestion = index.classificationSuggestions.find((entry) => entry.suggestionId === suggestionId);
        if (!suggestion) {
          suggestion = { suggestionId, projectId: project.id, materialId: item.materialId,
            version: item.expectedVersion, recordRevision: item.expectedRecordRevision,
            categoryId: item.categoryId, tags: item.tags, reason: item.reason,
            needsConfirmation: item.needsConfirmation, ruleVersion, source, actorId,
            confidence: item.confidence, evidence: item.evidence,
            status: 'pending', createdAt: now() };
          index.classificationSuggestions.push(suggestion);
        }
        return { materialId: item.materialId, ok: true, suggestionId,
          categoryId: item.categoryId, status: suggestion.status };
      });
      const response = { projectId: project.id, requestId, ruleVersion, results };
      index.classificationReceipts.push({ kind: 'suggest', actorId, idempotencyKey: requestId,
        payloadHash, createdAt: now(), response: clone(response) });
      return response;
    });
    return { ...committed.result, registryRevision: committed.revision,
      idempotentReplay: Boolean(committed.unchanged) };
  }

  function normalizeAction(item) {
    strictKeys(item, new Set(['materialId', 'expectedVersion', 'expectedRecordRevision',
      'categoryId', 'tags', 'suggestionId', 'decision']));
    const decision = String(item.decision || 'correct');
    invariant(['accept', 'correct'].includes(decision), 'invalid_classification_decision', '分类处理决定无效。');
    return {
      materialId: identifier(item.materialId, '资料ID'),
      expectedVersion: positiveVersion(item.expectedVersion),
      expectedRecordRevision: recordRevision(item.expectedRecordRevision),
      categoryId: identifier(item.categoryId, '分类ID'),
      tags: normalizeTags(item.tags, allowedTagIds),
      suggestionId: item.suggestionId ? identifier(item.suggestionId, '建议ID') : '',
      decision,
    };
  }

  async function applyBatch(items, { actorId, idempotencyKey, canWrite = false, automatic = false } = {}) {
    identifier(actorId, '操作人ID');
    identifier(idempotencyKey, '请求ID');
    invariant(Array.isArray(items) && items.length > 0 && items.length <= 200,
      'invalid_batch', '每批分类操作须包含1至200项。');
    const normalized = items.map(normalizeAction);
    invariant(new Set(normalized.map((item) => item.materialId)).size === normalized.length,
      'duplicate_material', '同一批分类操作不能重复资料。');
    if (!canWrite) return { projectId: project.id, idempotencyKey, registryRevision: (await store.read()).revision,
      results: normalized.map((item) => ({ materialId: item.materialId, ok: false, code: 'forbidden' })) };
    const payloadHash = hash({ projectId: project.id, actorId, items: normalized, ...(automatic ? { automatic: true } : {}) });
    const operationId = `classification-operation-${hash([project.id, actorId, idempotencyKey]).slice(0, 32)}`;
    const committed = await store.mutate((index) => {
      ensureState(index);
      const replay = receipt(index, 'apply', actorId, idempotencyKey, payloadHash);
      if (replay) return unchanged(replay.response);
      const operationItems = [];
      const results = normalized.map((item) => {
        const material = index.materials.find((record) => record.materialId === item.materialId);
        if (!material) return { materialId: item.materialId, ok: false, code: 'material_missing' };
        if (material.version !== item.expectedVersion || material.recordRevision !== item.expectedRecordRevision) {
          return { materialId: item.materialId, ok: false, code: 'version_conflict' };
        }
        const category = index.categories.find((entry) => entry.categoryId === item.categoryId && entry.active);
        if (!category) return { materialId: item.materialId, ok: false, code: 'category_missing' };
        const suggestion = item.suggestionId
          ? index.classificationSuggestions.find((entry) => entry.suggestionId === item.suggestionId) : null;
        if (item.suggestionId && (!suggestion || suggestion.status !== 'pending'
          || suggestion.materialId !== item.materialId || suggestion.version !== item.expectedVersion
          || suggestion.recordRevision !== item.expectedRecordRevision)) {
          return { materialId: item.materialId, ok: false, code: 'stale_suggestion' };
        }
        if (item.decision === 'accept' && (!suggestion || suggestion.categoryId !== item.categoryId
          || !compare(suggestion.tags, item.tags))) {
          return { materialId: item.materialId, ok: false, code: 'suggestion_mismatch' };
        }
        if (automatic && material.classification?.manualLocked) return { materialId: item.materialId, ok: false, code: 'manual_locked' };
        const before = { classification: clone(material.classification || {
          categoryId: '', tags: [], source: '', manualLocked: false }),
          organizationState: material.organizationState || 'unclassified' };
        const after = { classification: { ...before.classification,
          categoryId: item.categoryId, tags: item.tags, source: automatic ? 'rule' : 'manual', manualLocked: !automatic,
          actorId, changedAt: now(), ruleVersion: suggestion?.ruleVersion || '' },
          organizationState: 'classified' };
        let changed = false;
        if (!compare(before, after)) {
          material.classification = after.classification;
          material.organizationState = after.organizationState;
          material.recordRevision++;
          material.updatedAt = now();
          changed = true;
          operationItems.push({ materialId: material.materialId, version: material.version,
            before, after: clone(after), beforeRecordRevision: item.expectedRecordRevision,
            afterRecordRevision: material.recordRevision });
        }
        if (suggestion) {
          suggestion.status = item.decision === 'accept' ? 'accepted' : 'corrected';
          suggestion.reviewedAt = now();
          suggestion.reviewedBy = actorId;
          suggestion.appliedCategoryId = item.categoryId;
        }
        for (const other of index.classificationSuggestions) {
          if (other.status === 'pending' && other.materialId === item.materialId
            && (!suggestion || other.suggestionId !== suggestion.suggestionId)) {
            other.status = 'stale'; other.reviewedAt = now();
          }
        }
        return { materialId: item.materialId, ok: true, unchanged: !changed,
          categoryId: item.categoryId, recordRevision: material.recordRevision };
      });
      index.classificationOperations.push({ operationId, projectId: project.id, actorId,
        idempotencyKey, createdAt: now(), items: operationItems, undoneAt: '' });
      const response = { projectId: project.id, idempotencyKey, operationId, results };
      index.classificationReceipts.push({ kind: 'apply', actorId, idempotencyKey,
        payloadHash, createdAt: now(), response: clone(response) });
      return response;
    });
    return { ...committed.result, registryRevision: committed.revision,
      idempotentReplay: Boolean(committed.unchanged) };
  }

  async function undo(operationId, { actorId, idempotencyKey, canWrite = false } = {}) {
    identifier(operationId, '分类操作ID');
    identifier(actorId, '操作人ID');
    identifier(idempotencyKey, '请求ID');
    invariant(canWrite, 'forbidden', '当前身份不能撤销此项目的分类操作。');
    const payloadHash = hash({ projectId: project.id, operationId, actorId });
    const committed = await store.mutate((index) => {
      ensureState(index);
      const replay = receipt(index, 'undo', actorId, idempotencyKey, payloadHash);
      if (replay) return unchanged(replay.response);
      const operation = index.classificationOperations.find((item) => item.operationId === operationId);
      invariant(operation, 'operation_missing', '未找到该分类操作。');
      const results = operation.items.map((item) => {
        const material = index.materials.find((entry) => entry.materialId === item.materialId);
        if (!material) return { materialId: item.materialId, ok: false, code: 'material_missing' };
        const current = { classification: clone(material.classification || {}),
          organizationState: material.organizationState || 'unclassified' };
        if (material.version !== item.version || material.recordRevision !== item.afterRecordRevision
          || !compare(current, item.after)) {
          return { materialId: item.materialId, ok: false, code: 'undo_conflict' };
        }
        material.classification = clone(item.before.classification);
        material.organizationState = item.before.organizationState;
        material.recordRevision++;
        material.updatedAt = now();
        item.undoneAt = now();
        item.undoRecordRevision = material.recordRevision;
        return { materialId: item.materialId, ok: true, recordRevision: material.recordRevision };
      });
      if (results.some((item) => item.ok)) operation.undoneAt = now();
      const response = { projectId: project.id, idempotencyKey, operationId, results };
      index.classificationReceipts.push({ kind: 'undo', actorId, idempotencyKey,
        payloadHash, createdAt: now(), response: clone(response) });
      return response;
    });
    return { ...committed.result, registryRevision: committed.revision,
      idempotentReplay: Boolean(committed.unchanged) };
  }

  async function listSuggestions({ status = 'pending', offset = 0, limit = 50, materialIds } = {}) {
    invariant(['pending', 'accepted', 'corrected', 'stale', 'all'].includes(status),
      'invalid_suggestion_status', '分类建议状态筛选无效。');
    invariant(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit)
      && limit > 0 && limit <= 100, 'invalid_pagination', '分类建议分页参数无效。');
    const index = await store.read();
    const items = (index.classificationSuggestions || [])
      .filter((item) => status === 'all' || item.status === status)
      .filter((item) => !(materialIds instanceof Set) || materialIds.has(item.materialId))
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
    return { projectId: project.id, registryRevision: index.revision, total: items.length,
      offset, limit, items: items.slice(offset, offset + limit).map((item) => ({
        suggestionId: item.suggestionId, materialId: item.materialId, version: item.version,
        recordRevision: item.recordRevision, categoryId: item.categoryId, tags: item.tags,
        reason: item.reason, needsConfirmation: item.needsConfirmation, ruleVersion: item.ruleVersion,
        confidence: item.confidence || 'medium', evidence: item.evidence || [],
        source: item.source, status: item.status, createdAt: item.createdAt,
      })) };
  }

  return { ensureWorkspaceCategories, recordSuggestions, applyBatch, undo, listSuggestions };
}

module.exports = { createProjectMaterialClassification, categoryDefinitions, workspaceFolders,
  categoryForWorkspacePath, reconcileWorkspacePathClassifications, WORKSPACE_PATH_RULE_VERSION };
