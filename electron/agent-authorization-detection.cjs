'use strict';

const { completeCircuitProbe } = require('./task-executor-circuit.cjs');

function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

async function detectCodexAuthorization({
  confirmed = false,
  busy = false,
  busyReason = '',
  acquire,
  acquireBusyReason,
  refreshCapabilities,
  probe,
  readStore,
  writeStore,
  now = () => new Date().toISOString(),
} = {}) {
  if (confirmed !== true) return { ok: false, adapterId: 'codex', message: '检测可能消耗模型额度，需要用户主动确认。' };
  if (busy) return { ok: false, adapterId: 'codex', message: busyReason || '本地 Agent 正在执行另一个任务，请在完成后重试。' };
  const release = acquire?.();
  if (!release) return { ok: false, adapterId: 'codex', code: 'RESOURCE_BUSY',
    message: typeof acquireBusyReason === 'function' ? acquireBusyReason() : '当前资源不足，请稍后检测。' };
  try {
    const capabilities = await refreshCapabilities();
    const capability = capabilities?.codex || {};
    let store = clone(readStore());
    store.runtime ||= {};
    store.runtime.circuits ||= {};
    const at = now();
    if (!capability.available || !capability.authorized || !capability.exePath) {
      store.runtime.circuits.codex = {
        ...store.runtime.circuits.codex,
        version: 1,
        phase: 'authorization',
        failures: 0,
        until: '',
        updatedAt: at,
      };
      await writeStore(store);
      return {
        ok: false,
        adapterId: 'codex',
        authorized: false,
        automaticReady: false,
        message: capability.healthMessage || 'Codex CLI 尚未完成登录，请登录后重新检测。',
      };
    }
    const result = await probe(capability.exePath);
    store = clone(readStore());
    store.runtime ||= {}; store.runtime.circuits ||= {};
    store.runtime.circuits.codex = completeCircuitProbe(
      store.runtime.circuits.codex,
      result?.passed === true,
      Number.isFinite(Date.parse(at)) ? Date.parse(at) : Date.now(),
    );
    await writeStore(store);
    if (result?.passed === true) return {
      ok: true,
      adapterId: 'codex',
      authorized: true,
      automaticReady: true,
      message: 'Codex 登录和无工具结构化检测通过；授权熔断已解除。请明确选择未完成资料，再点击“重新分析”。',
    };
    return {
      ok: false,
      adapterId: 'codex',
      authorized: true,
      automaticReady: false,
      code: result?.code || '',
      message: `Codex 受控检测未通过：${result?.message || '未收到有效结构化结果'}。未发送学生资料，也未自动重派文档。`,
    };
  } catch (error) {
    return { ok: false, adapterId: 'codex', authorized: false, automaticReady: false, message: `Codex 后台检测失败：${error.message}。未发送学生资料，也未自动重派文档。` };
  } finally {
    release();
  }
}

module.exports = { detectCodexAuthorization };
