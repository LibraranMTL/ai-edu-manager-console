const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const { invariant, MaterialError } = require('./project-material-contract.cjs');
const key = (file) => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);

function createProjectArchiveRuntime({ onBlocked = () => {} } = {}) {
  const local = new AsyncLocalStorage();
  const activityLocal = new AsyncLocalStorage();
  const activities = new Set();
  let maintenanceCompletion = null;
  let phase = 'ready', owner = null, prepared = null, lastError = null;
  const protectedFiles = new Set();
  const owns = () => owner !== null && local.getStore() === owner;
  function assertAccess() {
    if (phase === 'ready' || owns()) return;
    throw new MaterialError(phase === 'blocked' ? 'archive_recovery_required' : 'archive_busy',
      phase === 'blocked' ? '项目归档中断，已暂停相关业务，请从主机资料恢复入口处理。'
        : phase === 'maintenance' ? '主机正在备份或迁移资料，请稍后重试。' : '正在提交或恢复项目资料，请稍后重试。');
  }
  function assertFile(file) { if (file && (phase === 'maintenance' || protectedFiles.has(key(file)))) assertAccess(); }
  function track(work) {
    assertAccess();
    // Each invocation owns its lifetime, including fire-and-forget children.
    const activity = {}; activities.add(activity);
    try {
      const result = activityLocal.run(activity, work);
      if (result?.then) return Promise.resolve(result).finally(() => activities.delete(activity));
      activities.delete(activity); return result;
    } catch (error) { activities.delete(activity); throw error; }
  }
  async function maintenance(work) {
    invariant(phase === 'ready' && !owner, 'archive_busy', '已有资料提交、恢复或迁移正在执行。');
    const caller = activityLocal.getStore();
    invariant([...activities].every((item) => item === caller), 'archive_busy', '还有业务操作正在处理，请稍后重试迁移；原任务未被取消。');
    const token = {}; owner = token; phase = 'maintenance';
    let finish;
    maintenanceCompletion = new Promise((resolve) => { finish = resolve; });
    try { return await local.run(token, work); }
    finally {
      // Maintenance itself does not authorize bypassing a prepared archive.
      if (prepared) blocked(new MaterialError('archive_recovery_required', '迁移期间产生了未结算归档，请核对恢复状态。'));
      else { phase = 'ready'; owner = null; protectedFiles.clear(); }
      maintenanceCompletion = null; finish();
    }
  }
  function markPrepared(entry, entries) {
    invariant(owns(), 'archive_context_required', '事务登记必须处于当前提交或恢复上下文。');
    prepared = { id: entry.id, projectId: entry.projectId };
    for (const target of entries || []) protectedFiles.add(key(target.path));
  }
  function blocked(error) {
    phase = 'blocked'; owner = null;
    lastError = { code: error.code || 'archive_interrupted', message: error.message };
    // Notifications must not retain a capability inherited from the writer.
    local.run(null, () => { try { onBlocked(status()); } catch { /* Diagnostics cannot hide the original failure. */ } });
  }
  function status() { return structuredClone({ phase, ready: phase === 'ready', transaction: prepared, error: lastError, activeOperations: activities.size }); }
  async function run(work) {
    if (owns()) return work();
    assertAccess(); const token = {}; owner = token; phase = 'committing'; prepared = null;
    try {
      const result = await local.run(token, work);
      phase = 'ready'; owner = null; prepared = null; lastError = null; protectedFiles.clear(); return result;
    } catch (error) {
      if (prepared) blocked(error);
      else { phase = 'ready'; owner = null; protectedFiles.clear(); }
      throw error;
    }
  }
  async function recover(work) {
    invariant(!owner, 'archive_busy', '已有资料提交或恢复正在执行。');
    const token = {}; owner = token; phase = 'recovering';
    try {
      const result = await local.run(token, work);
      if (!result?.ready) { blocked(new MaterialError('archive_recovery_required', result?.issues?.[0]?.message || '资料恢复未完成。')); return result; }
      phase = 'ready'; owner = null; prepared = null; lastError = null; protectedFiles.clear(); return result;
    } catch (error) { blocked(error); throw error; }
  }
  return { run, recover, markPrepared, assertAccess, assertFile, status, owns, track, maintenance,
    whenMaintenanceEnds: () => maintenanceCompletion || Promise.resolve() };
}

function createArchiveIpcGate(native, runtime, { exempt = [], maintenanceExempt = [] } = {}) {
  const allowed = new Set(exempt);
  const maintenanceAllowed = new Set(maintenanceExempt);
  const denied = (channel) => {
    if (allowed.has(channel) && (runtime.status().phase !== 'maintenance' || maintenanceAllowed.has(channel))) return null;
    try { runtime.assertAccess(); return null; }
    catch (error) { return JSON.stringify({ ok: false, code: error.code, message: error.message, retryable: error.code === 'archive_busy' }); }
  };
  return {
    handle(channel, handler) { return native.handle(channel, (event, ...args) => denied(channel)
      || (allowed.has(channel) && !runtime.status().ready ? handler(event, ...args) : runtime.track(() => handler(event, ...args)))); },
    on(channel, handler) { return native.on(channel, (event, ...args) => {
      const error = denied(channel); if (error) { event.returnValue = error; return; }
      return allowed.has(channel) && !runtime.status().ready ? handler(event, ...args) : runtime.track(() => handler(event, ...args));
    }); },
  };
}

function createArchiveHttpGate(runtime, handler, sendJson) {
  return (request, response) => {
    if (request.method === 'OPTIONS') return handler(request, response);
    const failed = (error) => {
      if (response.destroyed) return;
      if (response.headersSent) { response.destroy(); return; }
      const busy = ['archive_busy', 'archive_recovery_required'].includes(error.code);
      sendJson(response, busy ? 503 : 500, { ok: false, code: busy ? error.code : 'REQUEST_FAILED',
        retryable: error.code === 'archive_busy', message: busy ? error.message : '请求处理失败，请核对处理结果后重试。' });
    };
    try {
      const result = runtime.track(async () => {
        let settle;
        const finished = new Promise((resolve) => { settle = resolve; });
        response.once('finish', settle); response.once('close', settle);
        try {
          // A disconnected client is not proof that the async handler stopped
          // writing. Keep admission until BOTH the handler and response settle.
          await handler(request, response);
          if (!response.writableFinished && !response.destroyed) await finished;
        } finally { response.off('finish', settle); response.off('close', settle); }
      });
      Promise.resolve(result).catch(failed);
    } catch (error) { failed(error); }
  };
}
module.exports = { createProjectArchiveRuntime, createArchiveIpcGate, createArchiveHttpGate };
