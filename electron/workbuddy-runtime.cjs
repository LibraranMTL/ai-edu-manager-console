const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WORKBUDDY_AUTH_PROBE_TIMEOUT_MS = 30000;
const WORKBUDDY_CONNECTION_TIMEOUT_MS = 10000;

function firstExisting(candidates, exists = fs.existsSync) {
  return [...new Set((candidates || []).map((item) => String(item || '')).filter(Boolean))]
    .find((item) => exists(item)) || '';
}

function discoverWorkBuddyRuntime(exePath, options = {}) {
  const executable = String(exePath || '');
  const installDir = executable ? path.dirname(executable) : '';
  const findExecutable = typeof options.findExecutable === 'function' ? options.findExecutable : () => '';
  const runtimeEnv = options.env || process.env;
  const homeDir = String(options.homeDir || os.homedir());
  const configDir = firstExisting([
    runtimeEnv.WORKBUDDY_CONFIG_DIR,
    runtimeEnv.CODEBUDDY_CONFIG_DIR,
    homeDir && path.join(homeDir, '.workbuddy'),
    homeDir && path.join(homeDir, '.codebuddy'),
  ], options.exists || fs.existsSync) || (homeDir ? path.join(homeDir, '.workbuddy') : '');
  const endpointPath = configDir ? path.join(configDir, 'wbipc', 'endpoint.json') : '';
  let desktopSessionAvailable = false;
  if (endpointPath && (options.exists || fs.existsSync)(endpointPath)) {
    try {
      const endpoint = JSON.parse((options.readFile || fs.readFileSync)(endpointPath, 'utf8'));
      desktopSessionAvailable = /^\\\\\.\\pipe\\wbipc-[a-z0-9-]+$/i.test(String(endpoint?.endpoint || ''))
        && Boolean(String(endpoint?.ticket || '').trim());
    } catch {
      desktopSessionAvailable = false;
    }
  }
  const productConfigPath = firstExisting([
    installDir && path.join(installDir, 'resources', 'app.asar.unpacked', 'cli', 'product.json'),
  ], options.exists || fs.existsSync);
  const bundledCliPath = firstExisting([
    installDir && path.join(installDir, 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy'),
    installDir && path.join(installDir, 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy.js'),
    installDir && path.join(installDir, 'resources', 'app.asar.unpacked', 'cli', 'dist', 'codebuddy-headless.js'),
  ], options.exists || fs.existsSync);
  const directCliPath = bundledCliPath ? '' : String(findExecutable(['codebuddy.cmd', 'codebuddy.exe', 'codebuddy']) || '');
  const systemNodePath = bundledCliPath ? String(findExecutable(['node.exe', 'node']) || '') : '';
  const hostNodePath = bundledCliPath && !systemNodePath ? String(options.hostNodePath || '') : '';
  const nodePath = systemNodePath || hostNodePath;
  const mode = bundledCliPath ? 'node' : directCliPath ? 'direct' : '';
  return {
    available: Boolean(mode && (mode === 'direct' || nodePath)),
    exePath: executable,
    installDir,
    cliPath: bundledCliPath || directCliPath,
    productConfigPath,
    configDir,
    endpointPath,
    desktopSessionAvailable,
    nodePath,
    mode,
    useElectronNode: Boolean(mode === 'node' && !systemNodePath && hostNodePath),
  };
}

function buildWorkBuddyTaskDeepLink(runtime, options = {}) {
  if (!runtime?.exePath) return '';
  const prompt = String(options.command || '').trim();
  if (!prompt) return '';
  const url = new URL('workbuddy://task');
  url.searchParams.set('action', 'start');
  url.searchParams.set('prompt', prompt.slice(0, 8000));
  if (options.cwd) url.searchParams.set('cwd', path.resolve(String(options.cwd)));
  url.searchParams.set('welcomeMode', String(options.welcomeMode || 'work'));
  url.searchParams.set('permissionMode', options.permissionMode === 'fullAccess' ? 'fullAccess' : 'default');
  return url.toString();
}

function workBuddyRuntimeEnv(runtime, baseEnv = process.env) {
  const env = { ...baseEnv };
  if (runtime?.authRoot) Object.assign(env, { HOME: runtime.authRoot, USERPROFILE: runtime.authRoot,
    LOCALAPPDATA: path.join(runtime.authRoot, 'AppData', 'Local'), APPDATA: path.join(runtime.authRoot, 'AppData', 'Roaming') });
  if (runtime?.useElectronNode) env.ELECTRON_RUN_AS_NODE = '1';
  if (runtime?.productConfigPath) env.ACC_PRODUCT_CONFIG_PATH = runtime.productConfigPath;
  if (runtime?.mode === 'node' && runtime?.productConfigPath) env.CODEBUDDY_FORCE_LITE_WB_BUNDLE = '1';
  env.CODEBUDDY_DISABLE_IDE = '1';
  env.SERVER__HOST = '127.0.0.1';
  env.SERVER__PORT = '0';
  if (runtime?.configDir) {
    // A CLI launched by another Electron app does not reliably infer the
    // desktop-owned root. Reuse the existing WorkBuddy profile read-only.
    env.WORKBUDDY_CONFIG_DIR = runtime.configDir;
    env.CODEBUDDY_CONFIG_DIR = runtime.configDir;
  }
  return env;
}

function buildWorkBuddyInvocation(runtime, options = {}) {
  if (!runtime?.available || !runtime.cliPath) return null;
  const cwd = path.resolve(String(options.cwd || process.cwd()));
  const additionalRoots = [...new Set((options.additionalRoots || [])
    .map((item) => String(item || ''))
    .filter(Boolean)
    .map((item) => path.resolve(item))
    .filter((item) => item !== cwd))];
  const cliArgs = [
    '--print',
    '--input-format', 'text',
    '--output-format', 'json',
    '--permission-mode', String(options.permissionMode || 'acceptEdits'),
    '--tools', Array.isArray(options.tools) ? options.tools.join(',') : String(options.tools || 'Read,Glob,Grep,Write,Edit'),
    '--strict-mcp-config',
    '--mcp-config', '{"mcpServers":{}}',
    '--no-session-persistence',
    '--max-turns', String(Math.max(1, Math.min(40, Number(options.maxTurns || 12)))),
    ...(additionalRoots.length ? ['--add-dir', ...additionalRoots] : []),
  ];
  return {
    executable: runtime.mode === 'direct' ? runtime.cliPath : runtime.nodePath,
    args: runtime.mode === 'direct' ? cliArgs : [runtime.cliPath, ...cliArgs],
    cwd,
    stdinText: `${String(options.command || '').trim()}\n`,
    env: workBuddyRuntimeEnv(runtime, options.baseEnv),
  };
}

function workBuddyAuthenticationRequired(output = '', errorOutput = '') {
  return /authentication required|please use \/login|not logged in|unauthorized|login required|请.*登录|未登录/i
    .test(`${String(output || '')}\n${String(errorOutput || '')}`);
}

// Shared by readiness probes and real tasks: capability checks must not launch
// with broader permissions than the work they authorize.
function buildControlledWorkBuddyInvocation(runtime, options = {}) {
  const invocation = buildWorkBuddyInvocation(runtime, { ...options, additionalRoots: [], tools: [], permissionMode: 'dontAsk', maxTurns: 1 });
  return hardenControlledWorkBuddyInvocation(invocation);
}

function buildControlledWorkBuddyResearchInvocation(runtime, options = {}) {
  // WorkBuddy's authenticated desktop profile accepts WebSearch in dontAsk
  // mode. WebFetch is deliberately omitted: current desktop builds route it
  // through an interactive PreToolUse approval hook, which cannot be answered
  // by a background verification. The host independently fetches and verifies
  // the returned public HTTPS sources before accepting any research result.
  const invocation = buildWorkBuddyInvocation(runtime, { ...options, additionalRoots: [], tools: ['WebSearch'], permissionMode: 'dontAsk', maxTurns: Math.max(2, Math.min(12, Number(options.maxTurns || 8))) });
  return hardenControlledWorkBuddyInvocation(invocation);
}

function hardenControlledWorkBuddyInvocation(invocation) {
  if (!invocation) return null;
  invocation.args.push('--setting-sources', 'local', '--settings', '{"disableAllHooks":true}', '--no-plugin-management');
  // --no-plugin-management disables lifecycle operations, not plugin loading.
  // The install lane and the separate env-supplied inline lane are disabled too.
  for (const name of Object.keys(invocation.env)) if (/^(NODE_OPTIONS|NODE_PATH|CODEBUDDY_PLUGIN_DIRS|CLAUDE_PLUGIN_DIRS|CODEBUDDY_SESSION_SKILL_DIRS|CODEBUDDY_SESSION_ID|WORKBUDDY_SESSION_ID)$/i.test(name)) delete invocation.env[name];
  Object.assign(invocation.env, { CODEBUDDY_DISABLE_PLUGIN_INSTALLS: '1', CODEBUDDY_SKIP_BUILTIN_MARKETPLACE: '1',
    CODEBUDDY_DISABLE_HOT_RELOAD: '1', CODEBUDDY_DISABLE_AUTO_MEMORY: '1', CODEBUDDY_DISABLE_SYSTEM_REMINDER_MD: '1',
    CODEBUDDY_DISABLE_BUILTIN_SUBAGENTS: '1', CODEBUDDY_CODE_DISABLE_BACKGROUND_TASKS: '1', CODEBUDDY_DISABLE_CRON: '1',
    CODEBUDDY_IS_SANDBOX: '0',
    // Vendor approvals reject on expiry; they do not authorize on timeout.
    // No interactive reviewer is attached to a controlled background task.
    // Bound that wait below the task deadline without disabling protection.
    CBC_SANDBOX_APPROVAL_TIMEOUT_MS: '1000' });
  return invocation;
}

function workBuddyReadyResult(output, errorOutput = '', code = 0) {
  if (code !== 0 || workBuddyAuthenticationRequired(output, errorOutput)) return false;
  try {
    const value = workBuddyResultEnvelope(JSON.parse(String(output || '').trim()));
    // A startup log, tool-use event or successful exit is not a final answer.
    return value && !Array.isArray(value) && value.is_error !== true && !value.error
      && (!value.type || value.type === 'result') && (!value.subtype || value.subtype === 'success')
      && typeof value.result === 'string' && /^READY[.。]?$/.test(value.result.trim());
  } catch { return false; }
}

// Desktop lite returns a result object; the official full CLI returns an
// ordered Responses-style event array. Both must end in exactly one success.
// Never silently discard tool/error events to salvage an otherwise valid JSON.
function workBuddyResultEnvelope(value) {
  const events = Array.isArray(value) ? value : [value];
  if (!events.length || events.length > 1000) throw Error('WorkBuddy 返回事件集合无效');
  const safeTypes = new Set(['message', 'reasoning', 'result', 'text', 'input_text', 'output_text', 'summary_text', 'reasoning_text']);
  function check(node, depth = 0) {
    if (depth > 30) throw Error('WorkBuddy 返回结构过深');
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const child of node) check(child, depth + 1); return; }
    if (node.is_error || node.error || node.status === 'incomplete' || node.terminal_reason || node.role === 'tool' || node.role === 'function'
      || node.type && !safeTypes.has(node.type)) throw Error('WorkBuddy 返回了非受控事件');
    for (const field of ['tool_calls', 'permission_denials', 'function_call', 'tool_use', 'tool_result']) {
      if (node[field] && (!Array.isArray(node[field]) || node[field].length)) throw Error('WorkBuddy 返回了工具或权限事件');
    }
    for (const child of Object.values(node)) if (child && typeof child === 'object') check(child, depth + 1);
  }
  for (const event of events) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw Error('WorkBuddy 返回事件无效');
    if (Array.isArray(value) && !['message', 'reasoning', 'result'].includes(event.type)) throw Error('WorkBuddy 返回了未知事件');
    check(event);
  }
  const last = events.at(-1);
  if (Array.isArray(value) && (last.type !== 'result' || events.filter(e => e.type === 'result').length !== 1)) throw Error('WorkBuddy 缺少唯一最终结果');
  if (last.type && last.type !== 'result' || last.subtype && last.subtype !== 'success' || typeof last.result !== 'string') throw Error('WorkBuddy 没有返回有效最终结果');
  return last;
}

function parseWorkBuddyJsonPayload(result) {
  // An optional single presentation fence is not an output-schema relaxation.
  // Candidate-bearing output remains exact. A risk-blocked no-candidate object
  // may be followed by provider prose; return only the leading object so the
  // host can retain it for manual review without issuing another Agent call.
  const text = String(result).trim(), fence = /^```(?:json)?\r?\n([\s\S]*?)\r?\n```$/.exec(text);
  const opening = /^```(?:json)?\r?\n/.exec(text);
  const openOnly = !fence && opening && (text.match(/```/g) || []).length === 1 ? text.slice(opening[0].length) : '';
  const payload = fence ? fence[1] : openOnly || text;
  try { return JSON.parse(payload); } catch (error) {
    if (!payload.startsWith('{')) throw error;
    let depth = 0, quoted = false, escaped = false, end = -1;
    for (let index = 0; index < payload.length; index++) {
      const char = payload[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') { quoted = true; continue; }
      if (char === '{' || char === '[') depth++;
      else if (char === '}' || char === ']') {
        depth--;
        if (depth === 0) { end = index + 1; break; }
        if (depth < 0) break;
      }
    }
    if (end < 0 || !payload.slice(end).trim()) throw error;
    const value = JSON.parse(payload.slice(0, end));
    if (!value || !Array.isArray(value.candidates) || value.candidates.length
      || value.sensitive !== true && value.conflict !== true) throw error;
    return value;
  }
}

function createWorkBuddyProbeCache({ probe = probeWorkBuddyAuthorization, now = Date.now } = {}) {
  const cached = new Map(), pending = new Map();
  const keyOf = runtime => JSON.stringify([runtime.cliPath, runtime.nodePath, runtime.configDir, runtime.version || '', runtime.authVersion || 0]);
  return {
    invalidate(runtime) { cached.delete(keyOf(runtime)); },
    async detect(runtime, options = {}) {
      const key = keyOf(runtime);
      if (pending.has(key)) return pending.get(key);
      const item = cached.get(key);
      if (!options.force && item && item.until > now()) return item.result;
      const work = Promise.resolve().then(() => probe(runtime, options)).then(result => {
        cached.set(key, { result, until: now() + (result.authorized ? 30 : 5) * 60000 });
        return result;
      }).finally(() => pending.delete(key));
      pending.set(key, work);
      return work;
    },
  };
}

function probeWorkBuddyAuthorization(runtime, options = {}) {
  if (!runtime?.available || !runtime.cliPath) {
    return Promise.resolve({ available: false, authorized: false, code: -1, output: '', errorOutput: '', message: 'WorkBuddy CLI 不可用。' });
  }
  // Never probe in a student directory or repository with local instructions.
  const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-workbuddy-probe-'));
  const invocation = buildControlledWorkBuddyInvocation(runtime, {
    cwd: probeRoot,
    command: 'Only reply with READY.',
    maxTurns: 1,
    permissionMode: 'dontAsk',
    tools: [],
    baseEnv: options.baseEnv || process.env,
  });
  // A freshly authorized official CLI may need more than 12 seconds to load
  // its first model response. Keep this bounded, but do not mislabel that
  // normal initialization as missing authentication.
  const timeoutMs = Math.max(3000, Math.min(WORKBUDDY_AUTH_PROBE_TIMEOUT_MS,
    Number(options.timeoutMs || WORKBUDDY_AUTH_PROBE_TIMEOUT_MS)));
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let child, timedOut = false, stopTimer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      timer.cancel();
      clearTimeout(stopTimer);
      resolve(result);
    };
    const timer = require('./task-active-deadlines.cjs').taskActiveDeadlines.schedule(() => {
      timedOut = true;
      try { child?.kill(); } catch { /* Stop request is not confirmation. */ }
      if (!settled) stopTimer = setTimeout(() => finish({ available: true, authorized: false, code: -1,
        output: stdout, errorOutput: stderr, timedOut: true, stopConfirmed: false, executionUnknown: true,
        message: 'WorkBuddy 授权探测超时，进程停止尚未确认；请核对，不自动重派。' }), 5000);
    }, timeoutMs);
    try {
      child = (options.spawnProcess || spawn)(invocation.executable, invocation.args, {
        cwd: invocation.cwd,
        env: invocation.env,
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-20000); });
      child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-20000); });
      child.once('error', (error) => finish({ available: false, authorized: false, code: -1, output: stdout, errorOutput: `${stderr}\n${error.message}`.trim(), message: `WorkBuddy CLI 启动失败：${error.message}` }));
      child.once('close', (code) => {
        // Remove only our empty directory. Never recursively delete Agent output.
        try { fs.rmdirSync(probeRoot); } catch { /* Keep unexpected output for diagnosis. */ }
        if (timedOut) return finish({ available: true, authorized: false, code: Number(code), output: stdout,
          errorOutput: stderr, timedOut: true, stopConfirmed: true, message: 'WorkBuddy 授权探测超时，已确认进程停止。' });
        const authRequired = workBuddyAuthenticationRequired(stdout, stderr);
        const authorized = workBuddyReadyResult(stdout, stderr, code);
        finish({
          available: true,
          authorized,
          code: Number(code),
          output: stdout,
          errorOutput: stderr,
          authRequired,
          message: authorized ? 'WorkBuddy 受控后台认证已通过。' : authRequired ? 'WorkBuddy 后台尚未取得有效认证；桌面登录正常不代表后台已获授权。' : `WorkBuddy 登录态探测失败（退出码 ${code}）。`,
        });
      });
      child.stdin.end(invocation.stdinText);
    } catch (error) {
      finish({ available: false, authorized: false, code: -1, output: stdout, errorOutput: error.message, message: `WorkBuddy CLI 启动失败：${error.message}` });
    }
  });
}

async function probeWorkBuddyConnection(runtime, options = {}) {
  const startedAt = Date.now();
  const installed = Boolean(runtime?.exePath || runtime?.cliPath || runtime?.available);
  if (!installed) return { installed: false, authenticated: false, connected: false, latencyMs: 0,
    code: 'not_installed', message: '未检测到 WorkBuddy。' };
  // The desktop endpoint is a local, read-only connection fact. Do not send a
  // prompt, consume model quota, or run a task qualification from this path.
  let authenticated = Boolean(runtime?.desktopSessionAvailable);
  let connected = authenticated;
  if (typeof options.ping === 'function') {
    const timeoutMs = Math.max(250, Math.min(WORKBUDDY_CONNECTION_TIMEOUT_MS, Number(options.timeoutMs || WORKBUDDY_CONNECTION_TIMEOUT_MS)));
    const timeout = new Promise(resolve => setTimeout(() => resolve({ connected: false, timedOut: true }), timeoutMs));
    const checked = await Promise.race([Promise.resolve(options.ping(runtime)), timeout]);
    connected = checked?.connected === true;
    authenticated = checked?.authenticated === true || authenticated;
  }
  const latencyMs = Math.max(0, Date.now() - startedAt);
  const code = connected ? 'connected' : authenticated ? 'unreachable' : 'authentication_required';
  return { installed, authenticated, connected, latencyMs, code,
    message: connected ? 'WorkBuddy 本地连接可用。任务合同需单独验证。'
      : authenticated ? 'WorkBuddy 已认证，但本地连接当前不可达。' : 'WorkBuddy 已安装，但尚未检测到已认证的桌面会话。' };
}

module.exports = {
  WORKBUDDY_AUTH_PROBE_TIMEOUT_MS,
  WORKBUDDY_CONNECTION_TIMEOUT_MS,
  workBuddyReadyResult,
  workBuddyResultEnvelope,
  parseWorkBuddyJsonPayload,
  createWorkBuddyProbeCache,
  buildWorkBuddyTaskDeepLink,
  buildWorkBuddyInvocation,
  buildControlledWorkBuddyInvocation,
  buildControlledWorkBuddyResearchInvocation,
  discoverWorkBuddyRuntime,
  probeWorkBuddyAuthorization,
  probeWorkBuddyConnection,
  workBuddyAuthenticationRequired,
  workBuddyRuntimeEnv,
};
