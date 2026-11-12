'use strict';

const crypto = require('node:crypto');
const { watch } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { REPORTS, uploadPublishedReports } = require('./cloud-report-sync.cjs');
const { sourceProof } = require('./cloud-device-proof.cjs');
const { DEFAULT_CLOUD_SERVER, checkedServerUrl, cloudRequestUrl } = require('./cloud-endpoint.cjs');

const DEFAULT_PROFILE_FIELDS = Object.freeze(['displayName', 'grade', 'school', 'learningGoal', 'currentRegion', 'phone', 'email', 'birthday', 'address', 'guardian']);
const MATERIAL_CATEGORIES = Object.freeze(['learning_report', 'learning_material', 'topic_suggestion', 'competition_recommendation', 'learning_card']);
const DEFAULT_MATERIAL_CATEGORIES = Object.freeze(['learning_report']);

function usesV2UploadScope(binding) {
  return Number(binding?.contractVersion || 1) >= 2;
}

function normalizedUploadScope(input = {}) {
  const requestedProfileFields = Array.isArray(input.profileFields) ? input.profileFields : DEFAULT_PROFILE_FIELDS;
  const profileFields = DEFAULT_PROFILE_FIELDS.filter(field => requestedProfileFields.includes(field));
  if (!profileFields.includes('displayName')) profileFields.unshift('displayName');
  const requestedMaterialCategories = Array.isArray(input.materialCategories) ? input.materialCategories : DEFAULT_MATERIAL_CATEGORIES;
  const materialCategories = MATERIAL_CATEGORIES.filter(category => requestedMaterialCategories.includes(category));
  const authorizationPurpose = ['document_sync', 'expert_interpretation'].includes(input.authorizationPurpose)
    ? input.authorizationPurpose : 'document_sync';
  const requestedExpiry = Number(input.authorizationExpiresAt || 0);
  const authorizationExpiresAt = Number.isSafeInteger(requestedExpiry) && requestedExpiry > Date.now() + 5 * 60 * 1000
    ? requestedExpiry : Date.now() + 90 * 24 * 60 * 60 * 1000;
  return { profileFields, materialCategories, authorizationPurpose, authorizationExpiresAt };
}

async function request(base, route, token = '', options = {}) {
  const method = options.method || 'GET';
  const response = await fetch(cloudRequestUrl(base, route), {
    redirect: 'error',
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `云端请求失败（HTTP ${response.status}）`), { status: response.status });
  return data;
}

function createCloudReportRuntime({ dataDir, protect, unprotect, resolveReportDir, resolveStudentProfile,
  ensureLocalStudentFromCloudProfile, resolveProductEntitlement }) {
  if (!dataDir || !protect || !unprotect || !resolveReportDir) throw new Error('缺少云同步运行时依赖');
  const v2ProfileEnabled = typeof resolveStudentProfile === 'function';
  const autoBindingEnabled = typeof ensureLocalStudentFromCloudProfile === 'function';
  const autoEnrollmentEnabled = typeof resolveProductEntitlement === 'function' && v2ProfileEnabled;
  const stateFile = path.join(dataDir, 'cloud-report-state.json');
  const cacheRoot = path.join(dataDir, 'cloud-report-cache');
  const materialOutboxRoot = path.join(dataDir, 'cloud-material-outbox');
  const timers = new Map();
  const inFlight = new Map();
  const syncJobs = new Map();
  const watchers = new Map();
  const rerun = new Set();
  const documentUploads = new Map();
  let materialFlushTimer = null;
  let materialFlushRunning = false;
  let state = { version: 1, serverUrl: '', sourceToken: '', sourceDeviceId: '', viewerToken: '', bindings: {},
    cloudBindings: {}, pendingReceipts: [], syncCursors: {}, bindingIssues: {}, uploadScopePreferences: {}, sourceBindingKeys: {},
    healthObjectScopes: {}, materialOutbox: [], expertConsultationDrafts: {} };
  let saveChain = Promise.resolve();
  let closed = false;

  async function save() {
    const snapshot = JSON.stringify(state);
    saveChain = saveChain.catch(() => {}).then(async () => {
      await fs.mkdir(dataDir, { recursive: true });
      const temp = `${stateFile}.${crypto.randomUUID()}.tmp`;
      try { await fs.writeFile(temp, snapshot, { encoding: 'utf8', flag: 'wx', mode: 0o600 }); await fs.rename(temp, stateFile); }
      finally { await fs.rm(temp, { force: true }); }
    });
    await saveChain;
  }
  function token(kind) {
    const encrypted = kind === 'source' ? state.sourceToken : state.viewerToken;
    return encrypted ? unprotect(encrypted) : '';
  }
  function viewerProof(method, route) {
    if (!state.viewerPrivateKey || !state.viewerDeviceId) throw new Error('本机下载许可缺少设备私钥，请重新配对');
    const timestamp = String(Date.now());
    const nonce = crypto.randomBytes(18).toString('base64url');
    const signature = crypto.sign('sha256', Buffer.from(`${method}\n${route}\n${timestamp}\n${nonce}`),
      unprotect(state.viewerPrivateKey)).toString('base64url');
    return { 'x-cloud-device-id': state.viewerDeviceId, 'x-cloud-timestamp': timestamp,
      'x-cloud-nonce': nonce, 'x-cloud-signature': signature };
  }
  function sourceHeaders(method, route, body = '') {
    if (!state.sourcePrivateKey || !state.sourceDeviceId) throw new Error('来源许可缺少设备私钥，请重新开通');
    return sourceProof(state.sourceDeviceId, unprotect(state.sourcePrivateKey), method, route, body);
  }
  function sourceRequest(route, body) {
    return request(state.serverUrl, route, token('source'), { method: 'POST', body,
      headers: sourceHeaders('POST', route, JSON.stringify(body)) });
  }
  async function load() {
    try {
      const parsed = JSON.parse(await fs.readFile(stateFile, 'utf8'));
      if (parsed.version === 1 && parsed.bindings && typeof parsed.bindings === 'object') state = parsed;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (state.viewerToken && (!state.viewerPrivateKey || !state.viewerDeviceId)) {
      state.viewerToken = ''; state.viewerPrivateKey = ''; state.viewerDeviceId = '';
      await save();
    }
    state.cloudBindings ||= {};
    state.pendingReceipts ||= [];
    state.syncCursors ||= {};
    state.bindingIssues ||= {};
    state.uploadScopePreferences ||= {};
    state.sourceBindingKeys ||= {};
    state.healthObjectScopes ||= {};
    state.materialOutbox ||= [];
    state.expertConsultationDrafts ||= {};
    for (const [studentId, binding] of Object.entries(state.bindings)) {
      if (usesV2UploadScope(binding)) {
        binding.profileFields = DEFAULT_PROFILE_FIELDS.filter(field => (binding.profileFields || DEFAULT_PROFILE_FIELDS).includes(field));
        if (!binding.profileFields.includes('displayName')) binding.profileFields.unshift('displayName');
        binding.materialCategories = MATERIAL_CATEGORIES.filter(category => (binding.materialCategories || DEFAULT_MATERIAL_CATEGORIES).includes(category));
      }
      if (!state.sourcePrivateKey || binding.sourceDeviceId !== state.sourceDeviceId) {
        binding.enabled = false; binding.lastError = '请重新开通带设备签名的来源许可'; continue;
      }
      if (binding.enabled) { schedule(studentId, 3000); void ensureWatcher(studentId); }
      else if (binding.pendingServerWriteState === false) schedule(studentId, 3000);
    }
    if (state.viewerToken) setTimeout(() => { void reconcileAuthorizedStudents().catch(() => {}); void flushPendingReceipts().catch(() => {}); }, 3000);
    if (state.materialOutbox.length) scheduleMaterialOutbox(3000);
  }
  async function ensureWatcher(studentId) {
    if (watchers.has(studentId) || !state.bindings[studentId]?.enabled) return;
    try {
      const dir = await resolveReportDir(studentId);
      if (!dir) return;
      const watcher = watch(dir, { persistent: false }, (_event, filename) => {
        if (!filename || REPORTS.some(item => item.filename === String(filename))) schedule(studentId, 1500);
      });
      watcher.on('error', () => { watchers.delete(studentId); watcher.close(); });
      watchers.set(studentId, watcher);
    } catch { /* Startup reconciliation and publication events remain available. */ }
  }
  async function enrollSource({ serverUrl, enrollmentCode, localStudentId, profileFields = DEFAULT_PROFILE_FIELDS,
    materialCategories = DEFAULT_MATERIAL_CATEGORIES }) {
    const base = checkedServerUrl(serverUrl);
    const reportDir = await resolveReportDir(localStudentId);
    if (!reportDir) throw new Error('本机学生不存在');
    if (state.serverUrl && state.serverUrl !== base) throw new Error('当前设备已绑定另一云端地址');
    const existing = Boolean(state.sourceToken && state.sourcePrivateKey);
    if (!state.sourcePrivateKey) {
      const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1',
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
      state.sourcePrivateKey = protect(keys.privateKey); await save();
    }
    const selectedScope = normalizedUploadScope({ profileFields, materialCategories });
    const selectedProfileFields = selectedScope.profileFields;
    const selectedMaterialCategories = selectedScope.materialCategories;
    const publicKey = crypto.createPublicKey(unprotect(state.sourcePrivateKey)).export({ type: 'spki', format: 'pem' });
    const legacyCode = String(enrollmentCode || '').trim().toUpperCase();
    let route;
    let body;
    if (legacyCode) {
      route = '/v1/source-enrollments/redeem';
      body = { enrollmentCode: legacyCode,
        ...(v2ProfileEnabled ? { contractVersion: 2, profileFields: selectedProfileFields, materialCategories: selectedMaterialCategories } : {}),
        publicKey };
    } else {
      if (!autoEnrollmentEnabled) throw new Error('当前版本不能自动开通云同步');
      const entitlement = await resolveProductEntitlement();
      if (!entitlement?.active || !String(entitlement.licenseToken || '').startsWith('AIE3.')) throw new Error('需要有效的 Windows License v3 才能开通云同步');
      const profile = await resolveStudentProfile(localStudentId);
      if (!profile) throw new Error('本机学生不存在');
      if (!state.sourceBindingKeys[localStudentId]) state.sourceBindingKeys[localStudentId] = protect(crypto.randomBytes(32).toString('base64url'));
      route = '/v2/source-auto-enroll';
      body = { licenseToken: entitlement.licenseToken, deviceId: entitlement.deviceId,
        bindingKey: unprotect(state.sourceBindingKeys[localStudentId]), displayName: profile.displayName || profile.name,
        contractVersion: 2, profileFields: selectedProfileFields, materialCategories: selectedMaterialCategories, publicKey };
      await save();
    }
    let result;
    try { result = await request(base, route, existing ? token('source') : '',
      { method: 'POST', body, headers: existing ? sourceHeaders('POST', route, JSON.stringify(body)) : {} }); }
    catch (error) {
      if (!existing || error.status !== 401) throw error;
      result = await request(base, route, '', { method: 'POST', body });
    }
    state.serverUrl = base;
    state.sourceToken = protect(result.deviceToken);
    state.sourceDeviceId = result.deviceId;
    state.uploadScopePreferences[localStudentId] = selectedScope;
    state.bindings[localStudentId] = { cloudStudentId: result.cloudStudentId, sourceDeviceId: result.deviceId, enabled: true, hashes: {},
      contractVersion: v2ProfileEnabled ? 2 : 1, profileFields: selectedProfileFields, materialCategories: selectedMaterialCategories,
      pendingServerWriteState: null, lastSyncAt: 0, lastError: '' };
    await save();
    if (v2ProfileEnabled) {
      state.bindings[localStudentId].pendingUploadScope = selectedScope;
      await save();
      await reconcileUploadScope(localStudentId);
      await syncStudentProfile(localStudentId, true);
    }
    void ensureWatcher(localStudentId);
    schedule(localStudentId, 0);
    return { cloudStudentId: result.cloudStudentId, enabled: true };
  }
  async function syncStudentProfile(localStudentId, force = false) {
    const binding = state.bindings[localStudentId];
    if (!binding?.enabled || !usesV2UploadScope(binding)) return null;
    const source = await resolveStudentProfile(localStudentId);
    if (!source) throw new Error('本机学生基础信息不存在');
    const profile = {
      displayName: source.displayName || source.name,
      grade: source.grade, school: source.school, learningGoal: source.learningGoal || source.goal,
      currentRegion: source.currentRegion, phone: source.phone, email: source.email,
      birthday: source.birthday || source.birthDate, address: source.address,
      guardian: typeof source.guardian === 'string' ? source.guardian : source.guardian ? JSON.stringify(source.guardian) : '',
    };
    for (const key of Object.keys(profile)) if (!binding.profileFields.includes(key) || !String(profile[key] || '').trim()) delete profile[key];
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(Object.keys(profile).sort().map(key => [key, profile[key]]))).digest('hex');
    if (!force && binding.profileFingerprint === fingerprint) return { unchanged: true, profileRevisionId: binding.profileRevisionId || '' };
    const route = `/v2/students/${binding.cloudStudentId}/profile`;
    const result = await sourceRequest(route, { profile, fields: Object.keys(profile) });
    binding.profileFingerprint = fingerprint;
    binding.profileRevisionId = result.profileRevisionId;
    binding.profileSyncedAt = Date.now();
    await save();
    return result;
  }
  async function reconcileWriteState(studentId) {
    const binding = state.bindings[studentId];
    if (!binding || binding.pendingServerWriteState === null) return;
    await sourceRequest('/v1/grants/write-state', { cloudStudentId: binding.cloudStudentId, enabled: binding.pendingServerWriteState });
    binding.pendingServerWriteState = null;
    await save();
  }
  async function reconcileUploadScope(studentId) {
    const binding = state.bindings[studentId];
    const pending = binding?.pendingUploadScope;
    if (!pending || !usesV2UploadScope(binding)) return;
    const result = await sourceRequest('/v2/source-upload-scope', {
      cloudStudentId: binding.cloudStudentId,
      profileFields: pending.profileFields,
      materialCategories: pending.materialCategories,
      authorizationPurpose: pending.authorizationPurpose,
      authorizationExpiresAt: pending.authorizationExpiresAt,
    });
    binding.profileFields = result.profileFields;
    binding.materialCategories = result.materialCategories;
    binding.authorizationPurpose = result.authorizationPurpose;
    binding.authorizationExpiresAt = result.authorizationExpiresAt;
    binding.pendingUploadScope = null;
    binding.profileFingerprint = '';
    binding.lastError = '';
    await save();
  }
  async function setUploadScope(studentId, input = {}) {
    const binding = state.bindings[studentId];
    if (!binding && !(await resolveReportDir(studentId))) throw new Error('本机学生不存在');
    const { profileFields, materialCategories, authorizationPurpose, authorizationExpiresAt } = normalizedUploadScope(input);
    state.uploadScopePreferences[studentId] = { profileFields, materialCategories };
    if (!binding || !usesV2UploadScope(binding)) {
      await save();
      return status(studentId);
    }
    binding.pendingUploadScope = { profileFields, materialCategories, authorizationPurpose, authorizationExpiresAt };
    await save();
    try { await reconcileUploadScope(studentId); }
    catch (error) {
      binding.lastError = `上传范围待云端确认：${error.message}`;
      await save();
      if (binding.enabled) schedule(studentId, 30000);
      throw error;
    }
    if (binding.enabled) schedule(studentId, 0);
    return status(studentId);
  }
  async function setUpload(studentId, enabled) {
    const binding = state.bindings[studentId];
    if (!binding) throw new Error('请先为本机学生开通云端报告');
    if (typeof enabled !== 'boolean') throw new Error('上传开关无效');
    binding.enabled = enabled;
    binding.pendingServerWriteState = enabled;
    if (!enabled) {
      clearTimeout(timers.get(studentId));
      timers.delete(studentId);
      inFlight.get(studentId)?.abort();
      watchers.get(studentId)?.close();
      watchers.delete(studentId);
    }
    await save();
    try { await reconcileWriteState(studentId); }
    catch (error) { binding.lastError = `云端开关待同步：${error.message}`; await save(); }
    if (enabled) { void ensureWatcher(studentId); schedule(studentId, 0); }
    else if (binding.pendingServerWriteState === false) schedule(studentId, 30000);
    return { enabled: binding.enabled, pendingServerWriteState: binding.pendingServerWriteState, lastError: binding.lastError };
  }
  function schedule(studentId, delayMs = 1000) {
    if (closed || timers.has(studentId)) return;
    timers.set(studentId, setTimeout(() => {
      timers.delete(studentId);
      void syncStudent(studentId);
    }, delayMs));
  }
  function syncStudent(studentId) {
    if (syncJobs.has(studentId)) { rerun.add(studentId); return syncJobs.get(studentId); }
    const job = performSyncStudent(studentId).finally(() => { if (syncJobs.get(studentId) === job) syncJobs.delete(studentId); });
    syncJobs.set(studentId, job);
    return job;
  }
  async function syncNow(studentId) {
    const binding = state.bindings[studentId];
    if (!binding?.enabled || binding.sourceDeviceId !== state.sourceDeviceId) throw new Error('当前学生没有已启用的本机上传授权');
    if (!await resolveReportDir(studentId)) throw new Error('本机学生不存在');
    clearTimeout(timers.get(studentId)); timers.delete(studentId);
    await syncStudent(studentId);
    return status(studentId);
  }
  async function performSyncStudent(studentId) {
    if (closed) return;
    if (inFlight.has(studentId)) { rerun.add(studentId); return; }
    const binding = state.bindings[studentId];
    if (!binding) return;
    const controller = new AbortController();
    inFlight.set(studentId, controller);
    try {
      await reconcileWriteState(studentId);
      await reconcileUploadScope(studentId);
      if (!binding.enabled || controller.signal.aborted) return;
      const reportDir = await resolveReportDir(studentId);
      if (!reportDir) throw new Error('本机学生目录不存在');
      await syncStudentProfile(studentId);
      const reportsAuthorized = !usesV2UploadScope(binding) || binding.materialCategories?.includes('learning_report');
      const result = reportsAuthorized
        ? await uploadPublishedReports({ serverUrl: state.serverUrl, deviceToken: token('source'),
          reportDir, localStudentId: studentId, cloudStudentId: binding.cloudStudentId,
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
          proof: sourceHeaders, knownHashes: binding.hashes || {} })
        : { hashes: binding.hashes || {}, serverVerifiedAt: binding.serverVerifiedAt || 0,
          uploaded: [], unchanged: [], readyCount: 0, skipped: [] };
      binding.hashes = result.hashes;
      binding.retryCount = 0;
      binding.lastSyncAt = Date.now();
      binding.serverVerifiedAt = result.serverVerifiedAt;
      binding.lastError = '';
      binding.lastUploaded = result.uploaded.length;
      binding.lastUnchanged = result.unchanged.length;
      binding.lastReady = result.readyCount;
      binding.skipped = result.skipped;
      if (result.uploaded.length > 0) delete state.expertConsultationDrafts?.[studentId];
      await save();
    } catch (error) {
      binding.lastError = String(error.message || error);
      await save();
      binding.retryCount = Math.min(8, (binding.retryCount || 0) + 1);
      if (!closed && (!error.status || error.status >= 500 || error.status === 429) && (binding.enabled || binding.pendingServerWriteState === false)) {
        schedule(studentId, Math.min(900000, 30000 * 2 ** binding.retryCount));
      }
    } finally { inFlight.delete(studentId); if (rerun.delete(studentId) && binding.enabled) schedule(studentId); }
  }
  async function createPairing(serverUrl) {
    const base = checkedServerUrl(serverUrl);
    if (state.serverUrl && state.serverUrl !== base) throw new Error('当前设备已绑定另一云端地址');
    const pair = state.viewerPrivateKey ? null : crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const publicKey = pair ? pair.publicKey : crypto.createPublicKey(unprotect(state.viewerPrivateKey))
      .export({ type: 'spki', format: 'pem' }).toString();
    const result = await request(base, '/v1/pairings', state.viewerToken ? token('viewer') : '', {
      method: 'POST', body: { publicKey },
      headers: state.viewerToken ? viewerProof('POST', '/v1/pairings') : {},
    });
    state.serverUrl = base;
    state.viewerToken = protect(result.deviceToken);
    state.viewerPrivateKey = protect(pair ? pair.privateKey : unprotect(state.viewerPrivateKey));
    state.viewerDeviceId = result.deviceId;
    await save();
    return { pairingCode: result.pairingCode, expiresAt: result.expiresAt, deviceId: result.deviceId };
  }
  async function approvePairing(pairingCode, localStudentIds, options = {}) {
    if (!state.sourceToken) throw new Error('本机尚未开通学生报告上传');
    const ids = [...new Set(Array.isArray(localStudentIds) ? localStudentIds : [])];
    if (!ids.length || ids.length > 20) throw new Error('请选择要授权的学生');
    const cloudStudentIds = ids.map(id => {
      const binding = state.bindings[id];
      if (!binding || !binding.enabled) throw new Error('选择的学生尚未开通上传');
      return binding.cloudStudentId;
    });
    const singleBinding = ids.length === 1 ? state.bindings[ids[0]] : null;
    return sourceRequest('/v1/pairings/approve', { pairingCode: String(pairingCode || '').trim(), cloudStudentIds,
      ...(v2ProfileEnabled ? {
        contractVersion: 2,
        profileFields: DEFAULT_PROFILE_FIELDS.filter(field => (options.profileFields || singleBinding?.profileFields || DEFAULT_PROFILE_FIELDS).includes(field)),
        materialCategories: MATERIAL_CATEGORIES.filter(category => (options.materialCategories || singleBinding?.materialCategories || DEFAULT_MATERIAL_CATEGORIES).includes(category)),
        healthObjectScope: Array.isArray(options.healthObjectScope) ? options.healthObjectScope : [],
      } : {}),
    });
  }
  async function listCloudStudents() {
    if (!state.viewerToken) return [];
    const students = (await request(state.serverUrl, '/v1/students', token('viewer'),
      { headers: viewerProof('GET', '/v1/students') })).students
      .filter(item => item.scope === 'cloud_document.read');
    state.cachedStudentNames ||= {};
    let changed = false;
    for (const student of students) {
      if (state.cachedStudentNames[student.id] !== student.displayName) {
        state.cachedStudentNames[student.id] = student.displayName;
        changed = true;
      }
    }
    if (changed) await save();
    if (autoBindingEnabled) await reconcileAuthorizedStudents(students);
    return students.map(student => ({ ...student, localBinding: state.cloudBindings[student.id] || null,
      bindingIssue: state.bindingIssues[student.id] || '' }));
  }
  async function removeCloudStudent(cloudStudentId) {
    if (!state.viewerToken) throw new Error('本机尚未开通云端下载许可');
    const id = String(cloudStudentId || '');
    if (!/^[a-zA-Z0-9_-]{8,96}$/.test(id)) throw new Error('云端学生标识无效');
    const route = `/v1/viewer/students/${id}`;
    const result = await request(state.serverUrl, route, token('viewer'), {
      method: 'DELETE', headers: viewerProof('DELETE', route),
    });
    delete state.cloudBindings[id];
    delete state.bindingIssues[id];
    delete state.syncCursors[id];
    await save();
    return result;
  }
  async function reconcileAuthorizedStudents(provided) {
    if (!state.viewerToken) return [];
    const students = provided || (await request(state.serverUrl, '/v1/students', token('viewer'),
      { headers: viewerProof('GET', '/v1/students') })).students.filter(item => item.scope === 'cloud_document.read');
    const outcomes = [];
    for (const student of students) {
      if (!student.profileRevisionId) continue;
      const existing = state.cloudBindings[student.id];
      if (existing?.profileRevisionId === student.profileRevisionId) { outcomes.push(existing); continue; }
      try {
        const profileRoute = `/v2/students/${student.id}/profile`;
        const profile = await request(state.serverUrl, profileRoute, token('viewer'), { headers: viewerProof('GET', profileRoute) });
        if (!autoBindingEnabled) continue;
        const ensured = await ensureLocalStudentFromCloudProfile(profile);
        if (!ensured?.localStudentId) throw new Error(ensured?.message || '未能建立本机学生档案');
        const receiptRoute = `/v2/students/${student.id}/binding-receipts`;
        const binding = await request(state.serverUrl, receiptRoute, token('viewer'), { method: 'POST',
          headers: viewerProof('POST', receiptRoute), body: { localStudentId: ensured.localStudentId, profileRevisionId: profile.profileRevisionId } });
        state.cloudBindings[student.id] = { ...binding, status: ensured.status || 'ready', updatedAt: Date.now() };
        delete state.bindingIssues[student.id];
        outcomes.push(state.cloudBindings[student.id]);
      } catch (error) {
        state.bindingIssues[student.id] = String(error.message || error);
        outcomes.push({ cloudStudentId: student.id, status: 'needs_review', message: state.bindingIssues[student.id] });
      }
    }
    await save();
    return outcomes;
  }
  async function queueTransferReceipt(input) {
    const idempotencyKey = input.idempotencyKey || `download:${input.cloudStudentId}:${input.objectType}:${input.objectId}:${input.revisionId || ''}`;
    if (!state.pendingReceipts.some(item => item.idempotencyKey === idempotencyKey)) {
      state.pendingReceipts.push({ ...input, idempotencyKey, queuedAt: Date.now() });
      await save();
    }
    await flushPendingReceipts();
  }
  async function flushPendingReceipts() {
    if (!state.viewerToken || !state.pendingReceipts.length) return;
    for (const receipt of [...state.pendingReceipts]) {
      const route = '/v2/transfer-receipts';
      try {
        await request(state.serverUrl, route, token('viewer'), { method: 'POST', headers: viewerProof('POST', route), body: receipt });
        state.pendingReceipts = state.pendingReceipts.filter(item => item.idempotencyKey !== receipt.idempotencyKey);
        await save();
      } catch (error) {
        if (error.status && error.status < 500 && error.status !== 429) {
          receipt.lastError = String(error.message || error);
          await save();
        }
        break;
      }
    }
  }
  async function refreshChanges(cloudStudentId) {
    const cursor = state.syncCursors[cloudStudentId] || '';
    const route = `/v2/students/${cloudStudentId}/changes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`;
    const result = await request(state.serverUrl, route, token('viewer'), { headers: viewerProof('GET', route) });
    state.syncCursors[cloudStudentId] = result.nextCursor || cursor;
    await save();
    return result;
  }
  async function listCachedStudents() {
    let entries;
    try { entries = await fs.readdir(cacheRoot, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return entries.filter(entry => entry.isDirectory() && /^cs_[a-f0-9]{32}$/.test(entry.name))
      .map(entry => ({ cloudStudentId: entry.name, displayName: state.cachedStudentNames?.[entry.name] || entry.name }));
  }
  async function clearCloudCache(cloudStudentId) {
    if (!/^cs_[a-f0-9]{32}$/.test(cloudStudentId)) throw new Error('云端学生标识无效');
    const target = path.resolve(cacheRoot, cloudStudentId);
    if (path.dirname(target) !== path.resolve(cacheRoot)) throw new Error('缓存目录范围无效');
    let stat;
    try { stat = await fs.lstat(target); }
    catch (error) { if (error.code === 'ENOENT') return { cleared: false }; throw error; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('缓存目录不是可信目录');
    await fs.rm(target, { recursive: true, force: false });
    return { cleared: true };
  }
  async function listCloudReports(cloudStudentId, cursor = '') {
    if (!state.viewerToken) throw new Error('尚未开通云端学生下载许可');
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const route = `/v1/students/${encodeURIComponent(cloudStudentId)}/reports${query}`;
    const listed = await request(state.serverUrl, route, token('viewer'), { headers: viewerProof('GET', route) });
    return { ...listed, reports: listed.reports.filter(item => item.originDeviceId !== state.sourceDeviceId) };
  }
  async function listCloudDocuments(cloudStudentId) {
    return (await listCloudDocumentPage(cloudStudentId)).documents;
  }
  async function listCloudDocumentPage(cloudStudentId, cursor = '') {
    if (!state.viewerToken) throw new Error('尚未开通云端学生下载许可');
    if (!/^cs_[a-f0-9]{32}$/.test(cloudStudentId)) throw new Error('云端学生标识无效');
    const route = `/v1/students/${cloudStudentId}/documents${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`;
    return request(state.serverUrl, route, token('viewer'), { headers: viewerProof('GET', route) });
  }
  async function downloadCloudReport(cloudStudentId, revisionId) {
    if (!/^cs_[a-f0-9]{32}$/.test(cloudStudentId) || !/^rev_[a-f0-9]{48}$/.test(revisionId)) throw new Error('云端报告标识无效');
    const route = `/v1/reports/${revisionId}/content`;
    const response = await fetch(cloudRequestUrl(state.serverUrl, route),
      { redirect: 'error', headers: { authorization: `Bearer ${token('viewer')}`, ...viewerProof('GET', route) }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）`);
    if (response.headers.get('x-cloud-student-id') !== cloudStudentId) throw new Error('报告学生归属不一致');
    if (response.headers.get('x-origin-device-id') === state.sourceDeviceId) throw new Error('本机报告已有原件，无需再次下载');
    const reportType = response.headers.get('x-report-type');
    if (!['learning_profile', 'learning_change', 'weekly_action', 'stage_summary'].includes(reportType)) throw new Error('云端报告类型无效');
    const expectedSha = response.headers.get('x-content-sha256');
    if (!/^[a-f0-9]{64}$/.test(expectedSha || '')) throw new Error('云端报告缺少内容校验值');
    const content = Buffer.from(await response.arrayBuffer());
    if (content.length > 2 * 1024 * 1024 || crypto.createHash('sha256').update(content).digest('hex') !== expectedSha) {
      throw new Error('云端报告校验失败');
    }
    const dir = path.join(cacheRoot, cloudStudentId, reportType);
    await fs.mkdir(dir, { recursive: true });
    const target = path.join(dir, `${revisionId}.md`);
    const temp = `${target}.${crypto.randomUUID()}.tmp`;
    try { await fs.writeFile(temp, content, { flag: 'wx' }); await fs.rename(temp, target); }
    finally { await fs.rm(temp, { force: true }); }
    await queueTransferReceipt({ cloudStudentId, objectType: 'learning_report', objectId: revisionId,
      revisionId, action: 'download', status: 'downloaded' });
    return { path: target, content: content.toString('utf8'), revisionId };
  }
  async function downloadCloudDocument(cloudStudentId, documentId) {
    if (!/^cs_[a-f0-9]{32}$/.test(cloudStudentId) || !/^doc_[a-f0-9]{32}$/.test(documentId)) {
      throw new Error('云端文档标识无效');
    }
    if (!state.viewerToken) throw new Error('尚未开通云端学生下载许可');
    const route = `/v1/documents/${documentId}/content`;
    const response = await fetch(cloudRequestUrl(state.serverUrl, route),
      { redirect: 'error', headers: { authorization: `Bearer ${token('viewer')}`, ...viewerProof('GET', route) }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）`);
    if (response.headers.get('x-cloud-student-id') !== cloudStudentId) throw new Error('文档学生归属不一致');
    const contentType = String(response.headers.get('content-type') || '').split(';')[0];
    const extensions = { 'text/markdown': '.md', 'application/pdf': '.pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx' };
    const suffix = extensions[contentType];
    if (!suffix) throw new Error('云端文档类型无效');
    const expectedSha = response.headers.get('x-content-sha256');
    if (!/^[a-f0-9]{64}$/.test(expectedSha || '')) throw new Error('云端文档缺少校验值');
    const content = Buffer.from(await response.arrayBuffer());
    if (!content.length || content.length > 20 * 1024 * 1024 ||
        crypto.createHash('sha256').update(content).digest('hex') !== expectedSha) {
      throw new Error('云端文档校验失败');
    }
    const dir = path.join(cacheRoot, cloudStudentId, 'documents');
    await fs.mkdir(dir, { recursive: true });
    const target = path.join(dir, `${documentId}${suffix}`);
    const temp = `${target}.${crypto.randomUUID()}.tmp`;
    try { await fs.writeFile(temp, content, { flag: 'wx' }); await fs.rename(temp, target); }
    finally { await fs.rm(temp, { force: true }); }
    await queueTransferReceipt({ cloudStudentId, objectType: 'document', objectId: documentId,
      action: 'download', status: 'downloaded' });
    return { path: target, contentType, content: contentType === 'text/markdown' && content.length <= 512 * 1024
      ? content.toString('utf8') : '', documentId };
  }
  async function uploadCloudMaterial(localStudentId, material) {
    const binding = state.bindings[localStudentId];
    if (!binding?.enabled || !usesV2UploadScope(binding)) throw new Error('当前学生尚未开通新版资料同步');
    const category = String(material?.category || '');
    if (!binding.materialCategories?.includes(category)) throw new Error('该资料类别未授权上传');
    const bytes = Buffer.isBuffer(material.bytes) ? material.bytes : Buffer.from(String(material.content || ''), 'utf8');
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('资料大小无效');
    const materialId = String(material.materialId || '');
    const idempotencyKey = String(material.idempotencyKey || '');
    if (!/^[A-Za-z0-9:_-]{8,160}$/.test(materialId) || !/^[A-Za-z0-9:_-]{8,200}$/.test(idempotencyKey)) throw new Error('资料标识或提交编号无效');
    const route = `/v2/students/${binding.cloudStudentId}/materials`;
    const response = await fetch(cloudRequestUrl(state.serverUrl, route), { redirect: 'error', method: 'POST',
      headers: { authorization: `Bearer ${token('source')}`, ...sourceHeaders('POST', route, bytes),
        'content-type': material.contentType || 'text/markdown', 'x-document-name': encodeURIComponent(String(material.displayName || '资料.md')),
        'x-material-category': category, 'x-material-id': materialId, 'x-idempotency-key': idempotencyKey,
        ...(material.projectId ? { 'x-project-id': String(material.projectId), 'x-scope-fingerprint': String(material.scopeFingerprint || '') } : {}) },
      body: bytes, signal: AbortSignal.timeout(60000) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `资料同步失败（HTTP ${response.status}）`);
    return result;
  }
  async function setHealthUploadScope(localStudentId, objectScope) {
    const binding = state.bindings[localStudentId];
    if (!binding?.enabled || binding.sourceDeviceId !== state.sourceDeviceId) throw new Error('当前学生尚未开通云端来源许可');
    const route = '/v2/source-health-scope';
    const result = await request(state.serverUrl, route, token('source'), { method: 'POST', headers: sourceHeaders('POST', route),
      body: { cloudStudentId: binding.cloudStudentId, objectScope } });
    state.healthObjectScopes[localStudentId] = result.objectScope || [];
    await save();
    return result;
  }
  async function uploadHealthRecord(localStudentId, record) {
    const binding = state.bindings[localStudentId];
    if (!binding?.enabled || binding.sourceDeviceId !== state.sourceDeviceId) throw new Error('当前学生尚未开通云端来源许可');
    const bytes = Buffer.isBuffer(record?.bytes) ? record.bytes : await fs.readFile(String(record?.path || ''));
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('健康资料大小无效');
    const healthRecordId = String(record?.healthRecordId || '');
    const idempotencyKey = String(record?.idempotencyKey || '');
    const route = `/v2/students/${binding.cloudStudentId}/health-records`;
    const response = await fetch(cloudRequestUrl(state.serverUrl, route), { redirect: 'error', method: 'POST', headers: {
      authorization: `Bearer ${token('source')}`, ...sourceHeaders('POST', route, bytes),
      'content-type': String(record?.contentType || 'text/markdown'), 'x-document-name': encodeURIComponent(String(record?.displayName || '健康资料.md')),
      'x-health-record-id': healthRecordId, 'x-idempotency-key': idempotencyKey,
    }, body: bytes, signal: AbortSignal.timeout(60000) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `健康资料同步失败（HTTP ${response.status}）`);
    return result;
  }
  async function listCloudHealthRecords(cloudStudentId, cursor = '') {
    if (!state.viewerToken) throw new Error('尚未开通云端学生下载许可');
    const route = `/v2/students/${cloudStudentId}/health-records${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`;
    return request(state.serverUrl, route, token('viewer'), { headers: viewerProof('GET', route) });
  }
  function scheduleMaterialOutbox(delay = 1000) {
    if (closed || materialFlushTimer) return;
    materialFlushTimer = setTimeout(() => {
      materialFlushTimer = null;
      void flushMaterialOutbox().catch(() => {});
    }, Math.max(0, delay));
    materialFlushTimer.unref?.();
  }
  async function queueCloudMaterial(localStudentId, material) {
    const binding = state.bindings[localStudentId];
    if (!binding?.enabled || !usesV2UploadScope(binding)) return { queued: false, reason: 'cloud_sync_disabled' };
    const category = String(material?.category || '');
    if (!binding.materialCategories?.includes(category)) return { queued: false, reason: 'category_not_authorized' };
    const bytes = Buffer.isBuffer(material.bytes) ? material.bytes : Buffer.from(String(material.content || ''), 'utf8');
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('资料大小无效');
    const idempotencyKey = String(material.idempotencyKey || '');
    if (!/^[A-Za-z0-9:_-]{8,200}$/.test(idempotencyKey)) throw new Error('资料提交编号无效');
    const existing = state.materialOutbox.find(item => item.localStudentId === localStudentId && item.idempotencyKey === idempotencyKey);
    if (existing) return { queued: true, duplicate: true, queueId: existing.queueId };
    await fs.mkdir(materialOutboxRoot, { recursive: true });
    const queueId = crypto.createHash('sha256').update(`${localStudentId}\n${idempotencyKey}`).digest('hex');
    const objectPath = path.join(materialOutboxRoot, `${queueId}.bin`);
    const temp = `${objectPath}.${crypto.randomUUID()}.tmp`;
    try { await fs.writeFile(temp, bytes, { flag: 'wx', mode: 0o600 }); await fs.rename(temp, objectPath); }
    finally { await fs.rm(temp, { force: true }); }
    state.materialOutbox.push({ queueId, localStudentId, idempotencyKey, objectPath, attempts: 0, createdAt: Date.now(),
      material: { ...material, bytes: undefined, content: undefined } });
    await save(); scheduleMaterialOutbox(0);
    return { queued: true, duplicate: false, queueId };
  }
  async function flushMaterialOutbox() {
    if (closed || materialFlushRunning || !state.materialOutbox.length) return { processed: 0, pending: state.materialOutbox.length };
    materialFlushRunning = true;
    let processed = 0;
    try {
      for (const item of [...state.materialOutbox].slice(0, 20)) {
        try {
          const bytes = await fs.readFile(item.objectPath);
          await uploadCloudMaterial(item.localStudentId, { ...item.material, idempotencyKey: item.idempotencyKey, bytes });
          state.materialOutbox = state.materialOutbox.filter(candidate => candidate.queueId !== item.queueId);
          await fs.rm(item.objectPath, { force: true }); processed += 1;
        } catch (error) {
          item.attempts = Number(item.attempts || 0) + 1;
          item.lastError = String(error.message || error).slice(0, 500);
          item.retryAt = Date.now() + Math.min(15 * 60 * 1000, 15000 * (2 ** Math.min(item.attempts, 6)));
          break;
        }
      }
      await save();
    } finally {
      materialFlushRunning = false;
      if (state.materialOutbox.length) {
        const delay = Math.max(1000, Number(state.materialOutbox[0].retryAt || 0) - Date.now());
        scheduleMaterialOutbox(delay);
      }
    }
    return { processed, pending: state.materialOutbox.length };
  }
  async function listCloudMaterials(cloudStudentId, { category = '', history = false, cursor = '' } = {}) {
    if (!state.viewerToken) throw new Error('尚未开通云端学生下载许可');
    const query = new URLSearchParams();
    if (category) query.set('category', category);
    if (history) query.set('history', '1');
    if (cursor) query.set('cursor', cursor);
    const route = `/v2/students/${cloudStudentId}/materials${query.size ? `?${query}` : ''}`;
    return request(state.serverUrl, route, token('viewer'), { headers: viewerProof('GET', route) });
  }
  async function downloadCloudMaterial(cloudStudentId, revisionId) {
    if (!/^cs_[a-f0-9]{32}$/.test(cloudStudentId) || !/^material_rev_[a-f0-9]{48}$/.test(revisionId)) throw new Error('云端资料标识无效');
    const route = `/v2/material-revisions/${revisionId}/content`;
    const response = await fetch(cloudRequestUrl(state.serverUrl, route), { redirect: 'error',
      headers: { authorization: `Bearer ${token('viewer')}`, ...viewerProof('GET', route) }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`资料下载失败（HTTP ${response.status}）`);
    if (response.headers.get('x-cloud-student-id') !== cloudStudentId) throw new Error('资料学生归属不一致');
    const expectedSha = response.headers.get('x-content-sha256');
    const content = Buffer.from(await response.arrayBuffer());
    if (!/^[a-f0-9]{64}$/.test(expectedSha || '') || crypto.createHash('sha256').update(content).digest('hex') !== expectedSha) throw new Error('云端资料校验失败');
    const category = String(response.headers.get('x-material-category') || '');
    const extensions = { 'text/markdown': '.md', 'application/pdf': '.pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx' };
    const contentType = String(response.headers.get('content-type') || '').split(';')[0];
    const suffix = extensions[contentType];
    if (!MATERIAL_CATEGORIES.includes(category) || !suffix) throw new Error('云端资料类别或类型无效');
    const dir = path.join(cacheRoot, cloudStudentId, 'materials', category);
    await fs.mkdir(dir, { recursive: true });
    const target = path.join(dir, `${revisionId}${suffix}`);
    const temp = `${target}.${crypto.randomUUID()}.tmp`;
    try { await fs.writeFile(temp, content, { flag: 'wx' }); await fs.rename(temp, target); }
    finally { await fs.rm(temp, { force: true }); }
    await queueTransferReceipt({ cloudStudentId, objectType: category, objectId: response.headers.get('x-material-id') || '',
      revisionId, action: 'download', status: 'downloaded' });
    return { path: target, revisionId, category, contentType, content: contentType === 'text/markdown' && content.length <= 512 * 1024 ? content.toString('utf8') : '' };
  }
  function cloudStudentIdsForLocalStudents(localStudentIds) {
    const resolved = [];
    for (const localStudentId of [...new Set((Array.isArray(localStudentIds) ? localStudentIds : []).map(String))]) {
      const sourceBinding = state.bindings[localStudentId];
      const viewerBinding = Object.entries(state.cloudBindings).find(([, binding]) => String(binding?.localStudentId || '') === localStudentId);
      const cloudStudentId = sourceBinding?.cloudStudentId || viewerBinding?.[0] || '';
      if (!cloudStudentId) throw new Error(`项目学生 ${localStudentId} 尚未建立云端稳定身份绑定`);
      resolved.push(cloudStudentId);
    }
    return [...new Set(resolved)].sort();
  }
  async function issueRemoteAgentSession({ provider, cloudStudentId, cloudStudentIds, projectId = '', scopeFingerprint = '',
    taskId, executionId, taskType, idempotencyKey, materialCategories = DEFAULT_MATERIAL_CATEGORIES,
    lifetimeMs = 15 * 60 * 1000 }) {
    if (!state.viewerToken) throw new Error('尚未开通本机云端下载许可');
    if (!['codex', 'workbuddy'].includes(provider)) throw new Error('远程 Agent 仅支持 Codex 或 WorkBuddy');
    const route = '/v2/agent-sessions';
    return request(state.serverUrl, route, token('viewer'), { method: 'POST', headers: viewerProof('POST', route),
      body: { provider, cloudStudentId, cloudStudentIds, projectId, scopeFingerprint, taskId, executionId, taskType, idempotencyKey,
        materialCategories: MATERIAL_CATEGORIES.filter(category => materialCategories.includes(category)), lifetimeMs } });
  }
  async function remoteAgentSessionStatus(sessionId) {
    if (!state.viewerToken) throw new Error('尚未开通本机云端下载许可');
    const route = `/v2/agent-sessions/${sessionId}`;
    return request(state.serverUrl, route, token('viewer'), { headers: viewerProof('GET', route) });
  }
  async function revokeRemoteAgentSession(sessionId) {
    if (!state.viewerToken) throw new Error('尚未开通本机云端下载许可');
    const route = '/v2/agent-sessions/revoke';
    return request(state.serverUrl, route, token('viewer'), { method: 'POST', headers: viewerProof('POST', route), body: { sessionId } });
  }
  async function listCloudInbox(cursor = '') {
    if (!state.viewerToken) return { submissions: [], nextCursor: '' };
    const route = `/v2/inbox${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`;
    return request(state.serverUrl, route, token('viewer'), { headers: viewerProof('GET', route) });
  }
  async function leaseCloudInboxSubmission(submissionId) {
    if (!state.viewerToken) throw new Error('尚未开通本机云端下载许可');
    const route = `/v2/inbox/${submissionId}/lease`;
    return request(state.serverUrl, route, token('viewer'), { method: 'POST', headers: viewerProof('POST', route), body: {} });
  }
  async function downloadCloudInboxAttachment(submissionId, attachmentId, leaseId) {
    if (!state.viewerToken) throw new Error('尚未开通本机云端下载许可');
    const route = `/v2/inbox/${submissionId}/attachments/${attachmentId}`;
    const response = await fetch(cloudRequestUrl(state.serverUrl, route), { redirect: 'error', headers: {
      authorization: `Bearer ${token('viewer')}`, ...viewerProof('GET', route), 'x-inbox-lease-id': leaseId,
    }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || `成果附件下载失败（HTTP ${response.status}）`); }
    const content = Buffer.from(await response.arrayBuffer());
    const contentSha256 = crypto.createHash('sha256').update(content).digest('hex');
    if (contentSha256 !== response.headers.get('x-content-sha256')) throw new Error('成果附件下载校验失败');
    return { content, contentSha256, contentType: response.headers.get('content-type') || 'application/octet-stream' };
  }
  async function settleCloudInboxSubmission(submissionId, { leaseId, status, reason = '' }) {
    if (!state.viewerToken) throw new Error('尚未开通本机云端下载许可');
    const route = `/v2/inbox/${submissionId}/settle`;
    return request(state.serverUrl, route, token('viewer'), { method: 'POST', headers: viewerProof('POST', route),
      body: { leaseId, status, reason } });
  }
  function uploadSharedDocument(localStudentId, document) {
    const key = `${localStudentId}:${document.sha256}`;
    if (documentUploads.has(key)) return documentUploads.get(key);
    const promise = performDocumentUpload(localStudentId, document).finally(() => documentUploads.delete(key));
    documentUploads.set(key, promise); return promise;
  }
  async function performDocumentUpload(localStudentId, document) {
    const binding = state.bindings[localStudentId];
    if (!binding?.enabled || binding.sourceDeviceId !== state.sourceDeviceId || !await resolveReportDir(localStudentId)) throw new Error('请先为当前学生开通并启用云端来源许可');
    const cloudStudentId = binding.cloudStudentId;
    const content = Buffer.from(String(document.content || ''), 'utf8');
    const sha = crypto.createHash('sha256').update(content).digest('hex');
    if (!content.length || content.length > 512 * 1024 || sha !== document.sha256 || !/^[^\\/\x00-\x1f]{1,116}\.md$/.test(document.name)) throw new Error('分享文档摘要或校验值无效');
    const route = `/v1/students/${cloudStudentId}/documents`;
    // Reconcile even after an unknown upload outcome/restart, without re-uploading identical content.
    let cursor = ''; const seen = new Set(), deadline = AbortSignal.timeout(60000);
    do {
      const listingRoute = `${route}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`;
      if (seen.has(cursor) || seen.size >= 10) throw new Error('分享核对分页超出安全限额，请在云端核对已有文档');
      seen.add(cursor);
      const page = await request(state.serverUrl, listingRoute, token('source'), { headers: sourceHeaders('GET', listingRoute), signal: deadline });
      const prior = page.documents?.find(x => x.contentSha256 === sha && x.displayName === document.name);
      if (prior) return { ok: true, documentId: prior.documentId, cloudStudentId, duplicate: true, message: '相同摘要已在云端其他文档中，未重复上传。' };
      if (cursor && page.nextCursor === cursor) throw new Error('云端文档分页无效');
      cursor = page.nextCursor || '';
    } while (cursor);
    if (closed || state.bindings[localStudentId] !== binding || !binding.enabled || binding.cloudStudentId !== cloudStudentId || !await resolveReportDir(localStudentId)) throw new Error('学生或云端许可已变化，取消分享');
    const response = await fetch(cloudRequestUrl(state.serverUrl, route), { redirect: 'error', method: 'POST',
      headers: { authorization: `Bearer ${token('source')}`, ...sourceHeaders('POST', route, content), 'content-type': 'text/markdown', 'x-document-name': encodeURIComponent(document.name) }, body: content, signal: AbortSignal.any([deadline, AbortSignal.timeout(30000)]) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `分享失败（HTTP ${response.status}）`);
    if (result.contentSha256 !== sha || !/^doc_[a-f0-9]{32}$/.test(result.documentId || '')) throw new Error('云端分享回执校验失败，请重试核对；不代表尚未上传');
    return { ok: true, documentId: result.documentId, cloudStudentId, duplicate: false, message: '已分享到云端文档的其他文档；接收设备仍需对应学生的下载许可。' };
  }
  function settings() {
    return { serverUrl: state.serverUrl || DEFAULT_CLOUD_SERVER, bound: Boolean(state.sourceToken || state.viewerToken) };
  }
  async function saveSettings(serverUrl) {
    const base = checkedServerUrl(serverUrl);
    if (settings().bound && state.serverUrl !== base) throw new Error('设备已绑定另一服务，请先在原服务撤销许可；不能将凭据发送到新地址');
    state.serverUrl = base;
    await save();
    return settings();
  }
  async function checkConnection(serverUrl = settings().serverUrl) {
    const base = checkedServerUrl(serverUrl);
    const health = await request(base, '/health');
    if (health.ok !== true || health.service !== 'edu-cloud-documents') throw new Error('地址不是可信的教育管家云端文档服务');
    return { reachable: true, serverUrl: base, checkedAt: Date.now(), version: health.version };
  }
  function status(studentId) {
    const binding = state.bindings[studentId];
    const savedUploadScope = state.uploadScopePreferences?.[studentId] || null;
    return binding ? { configured: binding.sourceDeviceId === state.sourceDeviceId, enabled: binding.enabled, cloudStudentId: binding.cloudStudentId,
      lastSyncAt: binding.lastSyncAt, serverVerifiedAt: binding.serverVerifiedAt || 0, syncing: syncJobs.has(studentId), lastError: binding.lastError, skipped: binding.skipped || [],
      lastUploaded: binding.lastUploaded || 0, lastUnchanged: binding.lastUnchanged || 0, lastReady: binding.lastReady || 0,
      pendingServerWriteState: binding.pendingServerWriteState,
      profileFields: binding.profileFields || DEFAULT_PROFILE_FIELDS,
      materialCategories: binding.materialCategories || DEFAULT_MATERIAL_CATEGORIES,
      healthObjectScope: state.healthObjectScopes?.[studentId] || [],
      pendingUploadScope: binding.pendingUploadScope || null, savedUploadScope,
      uploadScopePersistence: usesV2UploadScope(binding)
        ? (binding.pendingUploadScope ? 'pending_cloud' : 'cloud_confirmed') : 'local_requires_upgrade' } : { configured: false, enabled: false,
        profileFields: DEFAULT_PROFILE_FIELDS, materialCategories: DEFAULT_MATERIAL_CATEGORIES, healthObjectScope: state.healthObjectScopes?.[studentId] || [], savedUploadScope,
        uploadScopePersistence: savedUploadScope ? 'local_requires_enrollment' : 'default' };
  }
  function expertAuthorizationVersion(studentId) {
    const id = String(studentId || '');
    const profile = v2ProfileEnabled ? resolveStudentProfile(id) : null;
    if (!profile || profile.archived === true || profile.status === 'archived') return '';
    const binding = state.bindings[id];
    if (!binding || binding.sourceDeviceId !== state.sourceDeviceId || !binding.enabled) return '';
    return `cloud-upload:${binding.cloudStudentId || ''}:${binding.serverVerifiedAt || 0}:${binding.pendingUploadScope ? 'pending' : 'confirmed'}`;
  }
  function normalizeExpertDraft(studentId, input = {}) {
    const id = String(studentId || '').trim();
    if (!id) throw new Error('当前学生不存在');
    const profileFields = DEFAULT_PROFILE_FIELDS.filter((field) => (Array.isArray(input.profileFields) ? input.profileFields : []).includes(field));
    if (!profileFields.includes('displayName')) profileFields.unshift('displayName');
    const materialCategories = MATERIAL_CATEGORIES.filter((category) => (Array.isArray(input.materialCategories) ? input.materialCategories : []).includes(category));
    const sourcePage = ['windows_home', 'windows_report'].includes(String(input.sourcePage || '')) ? String(input.sourcePage) : '';
    const suggestedMaterialCategories = MATERIAL_CATEGORIES.filter((category) => (Array.isArray(input.suggestedMaterialCategories) ? input.suggestedMaterialCategories : []).includes(category));
    return { schema: 'edu-manager.expert-consultation-draft.v1', studentId: id, purpose: 'expert_learning_interpretation',
      profileFields, materialCategories, updatedAt: new Date().toISOString(),
      ...(sourcePage ? { sourcePage } : {}),
      ...(input.reportType ? { reportType: String(input.reportType).slice(0, 80) } : {}),
      ...(input.reportRevision ? { reportRevision: String(input.reportRevision).slice(0, 160) } : {}),
      ...(suggestedMaterialCategories.length ? { suggestedMaterialCategories } : {}),
      ...(input.reviewedAuthorizationVersion ? { reviewedAuthorizationVersion: String(input.reviewedAuthorizationVersion).slice(0, 160) } : {}) };
  }
  function getExpertConsultationDraft(studentId) {
    const id = String(studentId || '').trim();
    const draft = state.expertConsultationDrafts?.[id] || null;
    const authorizationVersion = expertAuthorizationVersion(id);
    return { draft, authorizationVersion, authorizationValid: Boolean(authorizationVersion),
      reviewed: Boolean(draft && authorizationVersion && draft.reviewedAuthorizationVersion === authorizationVersion) };
  }
  async function saveExpertConsultationDraft(studentId, input = {}) {
    const draft = normalizeExpertDraft(studentId, input);
    state.expertConsultationDrafts[draft.studentId] = draft;
    await save();
    return getExpertConsultationDraft(draft.studentId);
  }
  async function clearExpertConsultationDraft(studentId) {
    const id = String(studentId || '').trim();
    const existed = Boolean(state.expertConsultationDrafts?.[id]);
    delete state.expertConsultationDrafts[id];
    await save();
    return { cleared: existed, studentId: id };
  }
  function close() {
    closed = true;
    for (const timer of timers.values()) clearTimeout(timer);
    for (const controller of inFlight.values()) controller.abort();
    for (const watcher of watchers.values()) watcher.close();
    if (materialFlushTimer) clearTimeout(materialFlushTimer);
  }
  return { load, close, enrollSource, setUpload, setUploadScope, schedule, syncStudent, syncNow, status, settings, saveSettings, checkConnection,
    createPairing, approvePairing, listCloudStudents, removeCloudStudent, listCloudReports, downloadCloudReport,
    listCloudDocuments, listCloudDocumentPage, downloadCloudDocument, listCachedStudents, clearCloudCache, uploadSharedDocument,
    syncStudentProfile, reconcileAuthorizedStudents, refreshChanges, flushPendingReceipts,
    uploadCloudMaterial, queueCloudMaterial, flushMaterialOutbox, listCloudMaterials, downloadCloudMaterial,
    setHealthUploadScope, uploadHealthRecord, listCloudHealthRecords,
    cloudStudentIdsForLocalStudents, issueRemoteAgentSession, remoteAgentSessionStatus, revokeRemoteAgentSession, listCloudInbox,
    leaseCloudInboxSubmission, downloadCloudInboxAttachment, settleCloudInboxSubmission,
    getExpertConsultationDraft, saveExpertConsultationDraft, clearExpertConsultationDraft };
}

module.exports = { createCloudReportRuntime, checkedServerUrl, DEFAULT_PROFILE_FIELDS, MATERIAL_CATEGORIES, DEFAULT_MATERIAL_CATEGORIES,
  usesV2UploadScope };
