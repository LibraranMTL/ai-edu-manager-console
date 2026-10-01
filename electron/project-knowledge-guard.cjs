const path = require('node:path');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { MaterialError, invariant } = require('./project-material-contract.cjs');

// FileShare.None guards official knowledge while the host commits its source
// ledger. Source streams deny writers/deleters for the same short interval.
// A process crash can leave a partially written file; the caller's durable
// journal and preimage backups therefore remain necessary for recovery.
function openKnowledgeGuard(request, { timeoutMs = 30000, spawnProcess = spawn } = {}) {
  invariant(process.platform === 'win32', 'guard_unavailable', '当前平台没有已验证的知识文件提交保护器。');
  const script = path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'project-knowledge-guard.ps1');
  const child = spawnProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const messages = [];
  const listeners = [];
  let closed = false;
  let failure = null;
  let stderr = '';
  let finalized = false;
  let aborted = null;
  let exitResolve;
  const exited = new Promise((resolve) => { exitResolve = resolve; });
  function flush() {
    while (listeners.length && messages.length) listeners.shift().resolve(messages.shift());
    if (failure || closed) while (listeners.length) listeners.shift().reject(failure || new MaterialError('guard_closed', '知识提交保护器提前退出。'));
  }
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    try {
      const message = JSON.parse(line);
      if (message.state === 'finalized') finalized = true;
      if (message.state === 'aborted') aborted = message;
      messages.push(message);
    }
    catch { failure = new MaterialError('guard_protocol', '知识提交保护器返回了无效响应。'); }
    flush();
  });
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4096); });
  child.stdin.on('error', (error) => { failure = error; flush(); });
  child.on('error', (error) => { failure = new MaterialError('guard_unavailable', error.message); flush(); });
  child.on('close', (code) => { closed = true; clearTimeout(timer); exitResolve(code); flush(); });
  const timer = setTimeout(() => {
    failure = new MaterialError('guard_timeout', '知识提交超时，已停止写入并保留恢复日志。');
    child.stdin.end(); // EOF asks the helper to restore its preimages.
    const killTimer = setTimeout(() => { if (!closed) child.kill(); }, 5000);
    killTimer.unref();
    flush();
  }, timeoutMs);
  timer.unref();
  child.stdin.write(`${JSON.stringify({ ...request, schema: 'edu-manager.knowledge-guard.v1' })}\n`);
  async function next(expected) {
    const message = messages.length ? messages.shift()
      : await new Promise((resolve, reject) => { listeners.push({ resolve, reject }); flush(); });
    if (message.state !== expected) {
      const code = /SOURCE_CHANGED/.test(message.message) ? 'source_changed'
        : /KNOWLEDGE_CONFLICT/.test(message.message) ? 'knowledge_conflict'
          : /OUTPUT_CHANGED/.test(message.message) ? 'output_changed'
            : /LINKED_PATH|PATH_OUTSIDE_ROOT/.test(message.message) ? 'invalid_path' : 'guard_busy_or_failed';
      throw new MaterialError(code, '知识文件暂不可安全提交。', { phase: message.phase, reason: message.message || stderr });
    }
    return message;
  }
  return {
    ready: () => next('ready'),
    async write() { child.stdin.write('commit\n'); return next('written'); },
    async finalize() {
      child.stdin.end('finalize\n'); await next('finalized');
      invariant(await exited === 0, 'guard_closed', '知识提交保护器结束异常，需要核对恢复日志。');
    },
    async abort() {
      if (!closed) child.stdin.end('abort\n');
      await exited;
      return { interrupted: !aborted && !finalized, rollbackFailures: aborted?.rollbackFailures || [] };
    },
    async terminate() { if (!closed) child.kill(); await exited; },
  };
}

module.exports = { openKnowledgeGuard };
