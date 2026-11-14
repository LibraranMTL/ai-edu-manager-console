'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createSmartInbox } = require('./smart-inbox.cjs');
const { createProjectMaterialExtractor, reuseMaterialExtraction, EXTRACTOR_VERSION } = require('./project-material-extract.cjs');
const { hashStableFile } = require('./project-materials.cjs');
const { createProjectMaterialClassification, categoryDefinitions } = require('./project-material-classification.cjs');
const { createRoutingAgent } = require('./smart-inbox-agent.cjs');
const { digest, studentScopeMatches } = require('./smart-inbox-policy.cjs');
const { createIntakeAssociations } = require('./smart-inbox-associations.cjs');

function createSmartInboxHost(h) {
  const routing = createRoutingAgent(h.agent);
  const associations = createIntakeAssociations(h);
  const extractors = new Map();
  const student = id => { const s = h.student(id); if (!s || s.archived || s.status === 'archived') throw Error('学生不存在或已归档'); return s; };
  function extraction(item) {
    const scope = digest(item.studentId || item.sourceId);
    let extractor = extractors.get(scope);
    if (!extractor) {
      const projectId = `inbox-${scope}`;
      const store = { projectId, directory: path.join(h.directory, 'scope-cache', scope),
        async resolve(id, version) {
          if (version !== 1) throw Error('资料快照版本无效');
          const value = await engine.detail(id);
          if (digest(value.studentId || value.sourceId) !== scope || !value.snapshotPath) throw Error('提取超出学生范围');
          const fingerprint = await hashStableFile(value.snapshotPath);
          if (fingerprint.sha256 !== value.fingerprint.sha256) throw Error('快照发生变化');
          return { path: value.snapshotPath, size: fingerprint.size, sha256: fingerprint.sha256, location: { relativePath: value.name } };
        } };
      extractor = { projectId, value: createProjectMaterialExtractor({ store }) }; extractors.set(scope, extractor);
    }
    return { value: extractor.value, input: { projectId: extractor.projectId, materialId: item.id, version: 1,
      path: item.snapshotPath, size: item.fingerprint.size, sha256: item.fingerprint.sha256, location: { relativePath: item.name } } };
  }
  async function handoffExtraction(item) {
    if (!item.studentId || item.studentId !== item.target.studentId || item.target.type !== 'project') return { reused: false, reason: 'no_student_project_scope' };
    const p = h.projects().find(p => String(p.id) === item.target.id);
    if (!p || !h.isWorkspace(p)) return { reused: false, reason: 'legacy_target' };
    const baseline = { workspacePath: p.workspacePath, managerPath: p.managerPath };
    const store = h.materialHost(p).store;
    const index = await store.read(), m = index.materials.find(m => m.materialId === item.receipt.recordId);
    if (!m) return { reused: false, reason: 'missing_registration' };
    const authorize = async () => {
      student(item.studentId);
      if (h.canWrite?.() === false) return false;
      const live = h.projects().find(v => String(v.id) === p.id);
      if (!live || !live.studentIds?.map(String).includes(item.studentId) || ['sealed', 'archived'].includes(live.status)
        || live.workspacePath !== baseline.workspacePath || live.managerPath !== baseline.managerPath) return false;
      const current = await engine.detail(item.id), sources = await engine.sources();
      const source = sources.sources.find(s => s.id === item.sourceId);
      if (!studentScopeMatches(current, source) || current.studentId !== item.studentId
        || current.fingerprint?.sha256 !== item.fingerprint.sha256 || current.operationId !== item.operationId
        || current.target?.studentId !== item.studentId || current.target?.id !== p.id || current.receipt?.recordId !== item.receipt.recordId) return false;
      const data = await store.read(), material = data.materials.find(v => v.materialId === m.materialId);
      return material?.version === m.version && material.sha256 === item.fingerprint.sha256 && material.adoption.state === 'accepted'
        && (data.intakeAssociations || []).some(a => a.active && a.itemId === item.id && a.studentId === item.studentId
          && a.materialId === m.materialId && a.version === m.version && a.sha256 === item.fingerprint.sha256);
    };
    const from = extraction(item);
    return reuseMaterialExtraction({ source: from.value, sourceInput: from.input,
      destination: createProjectMaterialExtractor({ store }), destinationInput: await store.resolve(m.materialId, m.version),
      sourceStudentId: item.studentId, studentId: item.target.studentId, authorize });
  }
  async function readProjectCategories(project) {
    if (typeof h.materialCategories === 'function') return await h.materialCategories(project) || [];
    return await h.materialHost(project).store.readCategories?.() || [];
  }
  async function context(id, options = {}) {
    const s = id ? student(id) : null, projects = [];
    const mode = options.mode || 'full';
    const requested = new Set((options.projectIds || []).map(String));
    if (mode === 'details' && (requested.size < 1 || requested.size > 5)) throw Error('候选项目范围无效');
    const candidates = h.projects().filter(p => !['sealed', 'archived'].includes(p.status)
      && (!id || p.studentIds?.map(String).includes(String(id))));
    for (const p of candidates) {
      const activeStudentIds = [...new Set((p.studentIds || []).map(String).filter(studentId => {
        if (typeof h.studentActive === 'function') return h.studentActive(studentId) !== false;
        try { student(studentId); return true; } catch { return false; }
      }))].sort();
      if (!activeStudentIds.length || id && !activeStudentIds.includes(String(id))) continue;
      const base = { id: String(p.id), name: p.name, summary: String(p.description || p.goal || '').slice(0, 600),
        studentIds: activeStudentIds,
        identifiers: [...new Set([String(p.id), String(p.name || ''), ...(p.aliases || [])].filter(value => value.length >= 3))],
        aliases: [...new Set((p.aliases || []).map(String).filter(Boolean))], recentActivityAt: String(p.updatedAt || '') };
      if (mode === 'light' || mode === 'details' && !requested.has(String(p.id))) {
        if (mode === 'light') projects.push(base);
        continue;
      }
      const routingContext = h.isWorkspace(p) && typeof h.materialRoutingContext === 'function'
        ? await h.materialRoutingContext(p) : null;
      const categories = routingContext?.categories || (h.isWorkspace(p) ? await readProjectCategories(p) : []);
      const index = { categories };
      projects.push({ ...base,
        categories: h.isWorkspace(p) ? categoryDefinitions(p, index).map(c => ({ categoryId: c.categoryId, name: c.name })) : [],
        materialTerms: (routingContext?.materialTerms || []).slice(0, 200),
        knowledgeTerms: (routingContext?.knowledgeTerms || []).slice(0, 100),
        historicalAssociations: (routingContext?.historicalAssociations || []).slice(0, 200),
        recentActivityAt: String(p.updatedAt || routingContext?.updatedAt || '') });
    }
    // Explicit account fields only; never send a full student record, raw paths,
    // credentials or another student's profile to the classifier.
    return { studentId: String(s?.id || ''), basic: { grade: String(s?.grade || ''), curriculum: String(s?.curriculum || '') }, projects,
      profile: s ? { summary: String(s.interests || '').slice(0, 600), source: 'student_account', confirmed: false,
        growth: mode === 'light' ? null : await h.profile?.(s) || null } : { summary: '', source: 'shared_intake', confirmed: false, growth: null },
      contextMode: mode, totalProjects: candidates.length };
  }
  async function fingerprintProjects(id, sha256) {
    if (!/^[a-f0-9]{64}$/i.test(String(sha256 || ''))) return [];
    student(id);
    const matches = [];
    for (const project of h.projects().filter(project => !['sealed', 'archived'].includes(project.status)
      && project.studentIds?.map(String).includes(String(id)))) {
      if (!h.isWorkspace(project) || typeof h.materialRoutingContext !== 'function') continue;
      const routing = await h.materialRoutingContext(project);
      if ((routing?.historicalAssociations || []).some(association => association.sha256 === sha256)) matches.push(String(project.id));
    }
    return matches;
  }
  async function workspaceCandidates(id, paths) {
    if (!id) return []; student(id);
    const actual = [];
    for (const value of paths || []) {
      if (!value || !path.isAbsolute(value)) continue;
      try { actual.push((await fs.realpath(value)).toLocaleLowerCase()); } catch { /* unavailable hints are not evidence */ }
    }
    if (!actual.length) return [];
    const matches = [];
    for (const project of h.projects().filter(p => !['sealed', 'archived'].includes(p.status) && p.studentIds?.map(String).includes(String(id)))) {
      if (!project.workspacePath || !path.isAbsolute(project.workspacePath)) continue;
      try { if (actual.includes((await fs.realpath(project.workspacePath)).toLocaleLowerCase())) matches.push(String(project.id)); } catch { /* no match */ }
    }
    return matches;
  }
  async function resolveEvent(source, locator) {
    student(source.studentId);
    if (source.type === 'share') return h.capture().resolveStored(source.studentId, locator);
    const request = JSON.parse(locator);
    const resolved = h.resolveConversation(student(source.studentId), request);
    if (!resolved) throw Object.assign(Error('源会话已移入回收站或彻底删除，不能继续投递；如仍在回收站，请先恢复会话。'), { code: 'original_missing' });
    const file = resolved.asset.storedPath, stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('会话资料不是普通文件');
    const { realDirectory } = require('./download-inbox.cjs'); await realDirectory(path.dirname(file));
    return { path: file, stat };
  }
  const engine = createSmartInbox({
    directory: h.directory, forbiddenRoots: h.forbiddenRoots, context, fingerprintProjects, workspaceCandidates, automaticAllowed: h.automaticAllowed,
    studentHints: () => (h.students?.() || []).filter(s => !s.archived && s.status !== 'archived').map(s => ({ id: String(s.id), name: String(s.name || '') })),
    routingV2Enabled: h.routingV2Enabled !== false,
    canReuseReceipt: target => { const project = h.projects().find(p => String(p.id) === target.id); return Boolean(project && h.isWorkspace(project)); },
    acquire: h.acquire, waitingReason: h.waitingReason, beginBatch: h.beginBatch, endBatch: h.endBatch,
    settleItems: h.settleItems, changed: h.changed, onError: h.onError,
    extractorVersion: EXTRACTOR_VERSION,
    validateTarget: async t => {
      const value = await h.validateTarget(t);
      if (t.categoryId) {
        const p = value.project;
        if (!p || !h.isWorkspace(p)) throw Error('此目标不支持项目逻辑分类');
        const index = { categories: await readProjectCategories(p) };
        if (!categoryDefinitions(p, index).some(c => c.categoryId === t.categoryId)) throw Error('项目分类已变化');
      }
      return value;
    },
    async events(source) {
      student(source.studentId);
      if (source.type === 'share') return (await h.capture().listStored(source.studentId))
        .filter(i => ['share', 'android_share', 'student_web', 'auto_folder'].includes(i.sourceChannel) && !['trashed', 'delivered'].includes(i.status))
        .map(i => ({ locator: i.itemId, name: i.originalName }));
      const entries = await h.conversations(student(source.studentId));
      const activationAt = Date.parse(source.activationAt || '');
      return entries.filter(e => e.lifecycleStatus !== 'trashed'
        && e.sourceScopeType !== 'project'
        && !['already_scoped', 'before_authorization'].includes(e.routingDisposition)
        && (!Number.isFinite(activationAt) || (() => {
          const eventAt = Date.parse(e.capturedSessionStartedAt || e.importedAt || '');
          return Number.isFinite(eventAt) && eventAt >= activationAt;
        })())
        && Boolean(e.sourceType === 'authorized_lifecycle') === (source.type === 'session')
        && !e.alreadyDelivered)
        .map(e => ({ name: path.basename(e.path || `${e.assetId}.md`), locator: JSON.stringify({ assetId: e.assetId, sourceScopeType: e.sourceScopeType, sourceScopeId: e.sourceScopeId }) }));
    },
    resolveEvent,
    async extract(item) {
      const from = extraction(item); return from.value.extract(from.input);
    },
    classify: input => routing.classify(input),
    prepareAssociation: item => associations.prepare(item),
    async registerAssociation(item) {
      await associations.bind(item);
      // Optimization failure never undoes a successful receipt or permits a
      // partial result. Digestion then uses its normal verified extractor.
      try { return await handoffExtraction(item); }
      catch (error) { return { reused: false, reason: error.code || 'handoff_unavailable' }; }
    },
    async deliver(snapshot, target, item, checkpoint) {
      if (['history', 'session'].includes(item.sourceType)) {
        const result = JSON.parse(await h.deliverConversation(item.target.studentId, JSON.stringify({ sources: [JSON.parse(item.locator)], targetType: item.target.type, targetId: item.target.id || item.target.studentId }),
          { path: snapshot, sha256: item.fingerprint.sha256, assetId: JSON.parse(item.locator).assetId,
            intakeAssociation: { itemId: item.id, operationId: item.operationId } }));
        if (!result.ok) throw Error(result.message);
        const receipt = (result.results || result.deliveries || []).find(r => r.path);
        if (!receipt) throw Error('会话投递缺少可核验回执');
        return { ok: true, path: receipt.path, recordId: receipt.materialId || receipt.id, projectId: item.target.id, studentId: item.target.studentId };
      }
      return h.deliver(snapshot, target, item, checkpoint);
    },
    async applyCategory(item, automatic) {
      const p = h.projects().find(p => String(p.id) === item.target.id);
      if (!p || !h.isWorkspace(p)) throw Error('项目分类目标不可用');
      const store = h.materialHost(p).store, classification = createProjectMaterialClassification(p, store);
      await classification.ensureWorkspaceCategories();
      const material = (await store.read()).materials.find(m => m.materialId === item.receipt.recordId);
      if (!material) throw Error('分类资料登记不存在');
      if (material.classification?.manualLocked && automatic && material.classification.categoryId !== item.target.categoryId) throw Error('已有人工分类锁定，请确认后纠正；未覆盖人工决定');
      if (material.classification?.categoryId === item.target.categoryId) return;
      const result = await classification.applyBatch([{ materialId: material.materialId, expectedVersion: material.version,
        expectedRecordRevision: material.recordRevision, categoryId: item.target.categoryId, tags: [], decision: 'correct' }],
      { actorId: automatic ? 'smart-inbox-rule' : 'host-user', idempotencyKey: item.operationId, canWrite: true, automatic });
      if (result.results.some(r => !r.ok)) throw Error('投递完成，分类待重新核对');
    },
    async acknowledge(source, item) {
      if (source.type === 'share') await h.capture().acknowledgeStored(source.studentId, item.locator, item.fingerprint.sha256, item.receipt, item.target);
    },
    correctAssociation: async (item, previous) => {
      const result = await associations.withdraw(item, previous);
      await h.recordCorrection?.(item, previous, result); return result;
    },
    reconcile: item => h.reconcile(item),
  });
  return { engine, context, workspaceCandidates, routing, async initialize() {
    await engine.bootstrap({ legacy: await h.legacySettings(), students: h.students() }); await engine.recover();
  } };
}
module.exports = { createSmartInboxHost };
