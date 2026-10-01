'use strict';

const crypto = require('node:crypto');
const { watch } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { REPORTS, uploadPublishedReports } = require('./cloud-report-sync.cjs');
const { sourceProof } = require('./cloud-device-proof.cjs');
const { DEFAULT_CLOUD_SERVER, checkedServerUrl, cloudRequestUrl } = require('./cloud-endpoint.cjs');

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

function createCloudReportRuntime({ dataDir, protect, unprotect, resolveReportDir }) {
  if (!dataDir || !protect || !unprotect || !resolveReportDir) throw new Error('缺少云同步运行时依赖');
  const stateFile = path.join(dataDir, 'cloud-report-state.json');
  const cacheRoot = path.join(dataDir, 'cloud-report-cache');
  const timers = new Map();
  const inFlight = new Map();
  const syncJobs = new Map();
  const watchers = new Map();
  const rerun = new Set();
  const documentUploads = new Map();
  let state = { version: 1, serverUrl: '', sourceToken: '', sourceDeviceId: '', viewerToken: '', bindings: {} };
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
    for (const [studentId, binding] of Object.entries(state.bindings)) {
      if (!state.sourcePrivateKey || binding.sourceDeviceId !== state.sourceDeviceId) {
        binding.enabled = false; binding.lastError = '请重新开通带设备签名的来源许可'; continue;
      }
      if (binding.enabled) { schedule(studentId, 3000); void ensureWatcher(studentId); }
      else if (binding.pendingServerWriteState === false) schedule(studentId, 3000);
    }
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
  async function enrollSource({ serverUrl, enrollmentCode, localStudentId }) {
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
    const body = { enrollmentCode: String(enrollmentCode || '').trim().toUpperCase(),
      publicKey: crypto.createPublicKey(unprotect(state.sourcePrivateKey)).export({ type: 'spki', format: 'pem' }) };
    const route = '/v1/source-enrollments/redeem';
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
    state.bindings[localStudentId] = { cloudStudentId: result.cloudStudentId, sourceDeviceId: result.deviceId, enabled: true, hashes: {},
      pendingServerWriteState: null, lastSyncAt: 0, lastError: '' };
    await save();
    void ensureWatcher(localStudentId);
    schedule(localStudentId, 0);
    return { cloudStudentId: result.cloudStudentId, enabled: true };
  }
  async function reconcileWriteState(studentId) {
    const binding = state.bindings[studentId];
    if (!binding || binding.pendingServerWriteState === null) return;
    await sourceRequest('/v1/grants/write-state', { cloudStudentId: binding.cloudStudentId, enabled: binding.pendingServerWriteState });
    binding.pendingServerWriteState = null;
    await save();
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
      if (!binding.enabled || controller.signal.aborted) return;
      const reportDir = await resolveReportDir(studentId);
      if (!reportDir) throw new Error('本机学生目录不存在');
      const result = await uploadPublishedReports({ serverUrl: state.serverUrl, deviceToken: token('source'),
        reportDir, localStudentId: studentId, cloudStudentId: binding.cloudStudentId,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
        proof: sourceHeaders, knownHashes: binding.hashes || {} });
      binding.hashes = result.hashes;
      binding.retryCount = 0;
      binding.lastSyncAt = Date.now();
      binding.serverVerifiedAt = result.serverVerifiedAt;
      binding.lastError = '';
      binding.lastUploaded = result.uploaded.length;
      binding.lastUnchanged = result.unchanged.length;
      binding.lastReady = result.readyCount;
      binding.skipped = result.skipped;
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
  async function approvePairing(pairingCode, localStudentIds) {
    if (!state.sourceToken) throw new Error('本机尚未开通学生报告上传');
    const ids = [...new Set(Array.isArray(localStudentIds) ? localStudentIds : [])];
    if (!ids.length || ids.length > 20) throw new Error('请选择要授权的学生');
    const cloudStudentIds = ids.map(id => {
      const binding = state.bindings[id];
      if (!binding || !binding.enabled) throw new Error('选择的学生尚未开通上传');
      return binding.cloudStudentId;
    });
    return sourceRequest('/v1/pairings/approve', { pairingCode: String(pairingCode || '').trim(), cloudStudentIds });
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
    return students;
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
    return { path: target, contentType, content: contentType === 'text/markdown' && content.length <= 512 * 1024
      ? content.toString('utf8') : '', documentId };
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
    return binding ? { configured: binding.sourceDeviceId === state.sourceDeviceId, enabled: binding.enabled, cloudStudentId: binding.cloudStudentId,
      lastSyncAt: binding.lastSyncAt, serverVerifiedAt: binding.serverVerifiedAt || 0, syncing: syncJobs.has(studentId), lastError: binding.lastError, skipped: binding.skipped || [],
      lastUploaded: binding.lastUploaded || 0, lastUnchanged: binding.lastUnchanged || 0, lastReady: binding.lastReady || 0,
      pendingServerWriteState: binding.pendingServerWriteState } : { configured: false, enabled: false };
  }
  function close() {
    closed = true;
    for (const timer of timers.values()) clearTimeout(timer);
    for (const controller of inFlight.values()) controller.abort();
    for (const watcher of watchers.values()) watcher.close();
  }
  return { load, close, enrollSource, setUpload, schedule, syncStudent, syncNow, status, settings, saveSettings, checkConnection,
    createPairing, approvePairing, listCloudStudents, listCloudReports, downloadCloudReport,
    listCloudDocuments, listCloudDocumentPage, downloadCloudDocument, listCachedStudents, clearCloudCache, uploadSharedDocument };
}

module.exports = { createCloudReportRuntime, checkedServerUrl };
