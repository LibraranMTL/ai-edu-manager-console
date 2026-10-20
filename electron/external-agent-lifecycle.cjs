'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const NAME = 'edu-manager-knowledge';
const START = `# EDU-MANAGER-KNOWLEDGE-MCP:${NAME}:START`, END = `# EDU-MANAGER-KNOWLEDGE-MCP:${NAME}:END`;
const marker = /# EDU-MANAGER-KNOWLEDGE-MCP:edu-manager-knowledge:START[^\S\r\n]*\r?\n[\s\S]*?# EDU-MANAGER-KNOWLEDGE-MCP:edu-manager-knowledge:END/g;
const conflict = () => Error('连接配置存在同名、并列或无法识别的教育管家服务。未覆盖其他配置，请先在 Agent 设置中移除重复项后重试。');
function registrations(home, host, codexHome) {
  if (host === 'codex') return [path.join(codexHome || path.join(home, '.codex'), 'config.toml')];
  if (host === 'workbuddy') {
    const files = [path.join(home, '.workbuddy', 'mcp.json'), path.join(home, '.codebuddy', '.mcp.json')].filter(fs.existsSync);
    return files.length ? files : [path.join(home, '.workbuddy', 'mcp.json')];
  }
  throw Error('UNSUPPORTED_HOST');
}
function read(file) {
  if (!fs.existsSync(file)) return null;
  if (fs.lstatSync(file).isSymbolicLink()) throw Error('连接配置是符号链接，请在 Agent 中手动配置');
  return fs.readFileSync(file, 'utf8');
}
function managedServer(server) {
  return server && Array.isArray(server.args) && server.args.some(a => typeof a === 'string' && /(?:^|[\\/])(?:agent-knowledge-mcp\.ps1|external-agent-mcp\.cjs)$/i.test(a));
}
function transform(before, host, command, args, remove = false) {
  let source = before ?? '';
  if (host === 'codex') {
    const parse = text => require('smol-toml').parse(text.replace(/^\uFEFF/, ''));
    const parsed = parse(source);
    if (Object.entries(parsed.mcp_servers || {}).some(([k, v]) => k !== NAME && (k.startsWith('edu-manager-') || managedServer(v)))) throw conflict();
    if (!Object.hasOwn(parsed.mcp_servers || {}, NAME)) {
      // Codex may remove a table but leave its marker comment. Only remove
      // exact marker lines when parsing proves no value (e.g. a multiline
      // string containing a marker) changes. No unrelated TOML is rewritten.
      const cleaned = source.replace(/^[\t ]*# EDU-MANAGER-KNOWLEDGE-MCP:edu-manager-knowledge:(?:START|END)[\t ]*(?:\r?\n|$)/gm, '');
      if (!isDeepStrictEqual(parsed, parse(cleaned))) throw conflict();
      source = cleaned;
    }
    const matches = source.match(marker) || [], outside = source.replace(marker, '');
    // Unmanaged quoted/dotted/inline definitions are conflicts, never appended
    // over or parsed with lossy substitutions. Preserve unrelated TOML bytes.
    if (matches.length > 1 || Object.hasOwn(parse(outside).mcp_servers || {}, NAME) ||
        (source.match(/# EDU-MANAGER-KNOWLEDGE-MCP:edu-manager-knowledge:START/g) || []).length !== matches.length ||
        (source.match(/# EDU-MANAGER-KNOWLEDGE-MCP:edu-manager-knowledge:END/g) || []).length !== matches.length) throw conflict();
    if (matches.length && ((matches[0].match(/^\s*\[/gm) || []).length !== 1 || !/^\[mcp_servers\.edu-manager-knowledge\]\r?$/m.test(matches[0]))) throw conflict();
    // A marker is not authority to erase unrelated settings, even if a host
    // has moved them between the comments during a config rewrite.
    if (matches.length) {
      const expected = parse(source); delete expected.mcp_servers[NAME];
      if (!Object.keys(expected.mcp_servers).length) delete expected.mcp_servers;
      const actual = parse(outside);
      if (actual.mcp_servers && !Object.keys(actual.mcp_servers).length) delete actual.mcp_servers;
      if (!isDeepStrictEqual(expected, actual)) throw conflict();
    }
    const block = remove ? '' : `${START}\n[mcp_servers.${NAME}]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}\nstartup_timeout_sec = 20\ntool_timeout_sec = 120\nenabled = true\n${END}`;
    const after = matches.length ? source.replace(marker, block) : remove ? source : source + (source && !source.endsWith('\n') ? '\n' : '') + block + '\n';
    require('smol-toml').parse(after.replace(/^\uFEFF/, ''));
    return after;
  }
  const config = source ? JSON.parse(source.replace(/^\uFEFF/, '')) : {};
  if (!config || typeof config !== 'object' || Array.isArray(config) || config.mcpServers !== undefined && (!config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers))) throw Error('MCP 配置格式无效，请先修复原配置');
  const servers = config.mcpServers || {};
  if (Object.entries(servers).some(([k, v]) => k !== NAME && (k.startsWith('edu-manager-') || managedServer(v)))) throw conflict();
  if (servers[NAME] && !managedServer(servers[NAME])) throw conflict();
  if (remove) { if (!servers[NAME]) return source; delete servers[NAME]; }
  else servers[NAME] = { command, args, description: '教育管家统一知识连接：全局授权、会话学生范围', type: 'stdio' };
  config.mcpServers = servers;
  return JSON.stringify(config, null, 2) + '\n';
}
function updateText(file, host, command, args) { return transform(read(file), host, command, args); }
function launchArgs({ bridgePath, descriptorPath, connectionConfig }) {
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', bridgePath, '-Descriptor', descriptorPath, '-ConnectorConfig', connectionConfig];
}
function plan(options, remove = false) {
  const { home, host, projectConfigPaths = [] } = options;
  const directNode = Boolean(options.runtimeExecutable && options.runtimeScript && !options.useElectronNode);
  const command = directNode ? options.runtimeExecutable : 'powershell.exe';
  const args = directNode ? [options.runtimeScript, options.connectionConfig] : launchArgs(options);
  const primary = registrations(home, host, options.codexHome);
  // Remove owned project overrides from known education workspaces; otherwise
  // they shadow the unified global server with a fixed-student credential.
  const files = [...new Set([...primary, ...(host === 'codex' ? projectConfigPaths.filter(fs.existsSync) : [])])];
  return files.map(file => {
    const before = read(file);
    try { return { file, before, after: transform(before, host, command, args, remove || !primary.includes(file)) }; }
    catch (error) { throw Error(`${file}：${error.message}`); }
  });
}
function commit(plans) {
  const changed = [], backups = [];
  try {
    for (const p of plans) {
      if ((p.before ?? '') === p.after) continue;
      if (read(p.file) !== p.before) throw Error('配置刚被其他程序修改，请刷新后重试');
      fs.mkdirSync(path.dirname(p.file), { recursive: true });
      if (p.before !== null) { const backup = p.file + '.pre-r21-' + crypto.randomUUID() + '.bak'; fs.copyFileSync(p.file, backup, fs.constants.COPYFILE_EXCL); backups.push(backup); }
      const temp = p.file + '.r21-' + crypto.randomUUID();
      try {
        fs.writeFileSync(temp, p.after, { flag: 'wx', mode: 0o600 });
        if (read(p.file) !== p.before) throw Error('配置刚被其他程序修改，请刷新后重试');
        fs.renameSync(temp, p.file); changed.push(p);
      } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    }
  } catch (error) {
    for (const p of changed.reverse()) if (read(p.file) === p.after) {
      if (p.before === null) fs.unlinkSync(p.file); else fs.writeFileSync(p.file, p.before);
    }
    throw error;
  }
  return { files: plans.map(p => p.file), backups, changed: changed.length };
}
function install(options) { return { ...commit(plan(options)), host: options.host, serverName: NAME, installedAt: new Date().toISOString(), status: 'configured_restart_required' }; }
function uninstall(options) { return { ...commit(plan(options, true)), host: options.host, serverName: NAME, status: 'uninstalled', uninstalledAt: new Date().toISOString() }; }
function inspect(options) {
  try { const plans = plan(options); return { status: plans.every(p => (p.before ?? '') === p.after) ? 'configured' : 'repair_required', files: plans.map(p => p.file) }; }
  catch (error) { return { status: 'configuration_conflict', message: error.message }; }
}
function inspectRemoval(options) {
  try {
    const plans = plan(options, true);
    const parse = text => options.host === 'codex' ? require('smol-toml').parse((text || '').replace(/^\uFEFF/, '')) : text ? JSON.parse(text.replace(/^\uFEFF/, '')) : {};
    return { status: plans.every(p => isDeepStrictEqual(parse(p.before), parse(p.after))) ? 'removed' : 'removal_required', files: plans.map(p => p.file) };
  } catch (error) { return { status: 'configuration_conflict', message: error.message }; }
}
// Verify the expected application-owned launch chain, never an arbitrary
// executable discovered in an edited config. Health does not read student data.
async function verify(options, { timeoutMs = 20000 } = {}) {
  const check = inspect(options);
  if (check.status !== 'configured') throw Error(check.message || '连接配置缺失或已变化，请先安装或修复');
  const { spawn } = require('node:child_process'), readline = require('node:readline');
  const directNode = Boolean(options.runtimeExecutable && options.runtimeScript && !options.useElectronNode);
  const child = spawn(directNode ? options.runtimeExecutable : 'powershell.exe', directNode ? [options.runtimeScript, options.connectionConfig] : launchArgs(options), { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let next = 0, total = 0; const pending = new Map();
  const lines = readline.createInterface({ input: child.stdout });
  const fail = message => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error(message)); } pending.clear(); };
  child.on('error', () => fail('无法启动本机 MCP，请使用修复连接'));
  child.on('close', () => fail('MCP 进程提前退出，请启动教育管家并修复连接'));
  child.stdin.on('error', () => fail('MCP 输入通道已关闭')); child.stderr.resume();
  lines.on('line', line => {
    total += line.length;
    if (total > 2 * 1024 * 1024) { fail('MCP 返回过大'); child.kill(); return; }
    try { const value = JSON.parse(line), p = pending.get(value.id); if (p) { clearTimeout(p.timer); pending.delete(value.id); value.error ? p.reject(Error('MCP 授权或主机连接验证失败，请检查授权和主机服务')) : p.resolve(value.result); } }
    catch { fail('MCP 返回格式无效'); }
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(Error('连接验证超时，请确认教育管家主机服务正在运行')); }, timeoutMs);
    pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  try {
    const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'edu-connector-diagnostic', version: '1' } });
    if (init?.serverInfo?.name !== NAME) throw Error('MCP 服务身份不匹配');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const tools = await rpc('tools/list', {});
    if (!tools?.tools?.some(t => t.name === 'education_connector_health')) throw Error('连接器版本过旧，请修复连接');
    const nonce = crypto.randomUUID();
    const result = await rpc('tools/call', { name: 'education_connector_health', arguments: { nonce } });
    const value = JSON.parse(result?.content?.[0]?.text || '{}');
    if (result?.isError || !value.ok || value.nonce !== nonce || value.connectionId !== options.connectionId) throw Error('主机凭据或连接身份验证失败');
    return { status: 'bridge_verified', verifiedAt: new Date().toISOString(), toolCount: tools.tools.length,
      message: '本机 MCP 握手、工具列表与授权主机往返验证通过（未读取学生资料）。请重启 Agent 后在新对话调用连接状态，完成宿主侧验收。' };
  } finally {
    lines.close(); fail('验证结束'); child.stdin.end();
    if (process.platform === 'win32' && child.pid) { const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); killer.on('error', () => child.kill()); }
    else child.kill();
  }
}
module.exports = { install, uninstall, inspect, inspectRemoval, verify, plan, updateText, registrations, NAME };
