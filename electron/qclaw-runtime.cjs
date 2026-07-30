const fs = require('fs');
const os = require('os');
const path = require('path');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}

function canonicalPath(value) {
  const resolved = path.resolve(String(value || '')).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function discoverQClawRuntime(exePath, options = {}) {
  const executable = String(exePath || '');
  const installDir = executable ? path.dirname(executable) : '';
  const resourcesDir = installDir ? path.join(installDir, 'resources') : '';
  const nodePath = resourcesDir ? path.join(resourcesDir, 'node', 'node.exe') : '';
  const cliPath = resourcesDir ? path.join(resourcesDir, 'openclaw', 'node_modules', 'openclaw', 'openclaw.mjs') : '';
  const homeDir = options.homeDir || os.homedir();
  const appDataDir = options.appDataDir || process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
  const stateDir = path.join(homeDir, '.qclaw');
  const configPath = path.join(stateDir, 'openclaw.json');
  const config = readJson(configPath);
  const port = Number(config?.gateway?.port || 0);
  const agents = Array.isArray(config?.agents?.list)
    ? config.agents.list.map((agent) => ({
      id: String(agent?.id || ''),
      name: String(agent?.name || ''),
      workspace: String(agent?.workspace || ''),
    })).filter((agent) => agent.id)
    : [];
  return {
    available: Boolean(executable
      && fs.existsSync(executable)
      && fs.existsSync(nodePath)
      && fs.existsSync(cliPath)
      && fs.existsSync(configPath)
      && port > 0),
    exePath: executable,
    installDir,
    resourcesDir,
    nodePath,
    cliPath,
    stateDir,
    configPath,
    userDataDir: path.join(appDataDir, 'QClaw'),
    port,
    agents,
  };
}

function normalizeAgentName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/ai教育管家|的教育管家|教育管家|ai助手|助手/g, '');
}

function selectQClawAgentId(runtime, task) {
  const agents = Array.isArray(runtime?.agents) ? runtime.agents : [];
  const knowledgeRoot = canonicalPath(task?.input?.knowledgeRoot || '');
  const workspaceMatch = knowledgeRoot
    ? agents.find((agent) => agent.workspace && canonicalPath(agent.workspace) === knowledgeRoot)
    : null;
  if (workspaceMatch) return workspaceMatch.id;
  const sourceName = normalizeAgentName(task?.sourceName || '');
  const nameMatch = sourceName
    ? agents.find((agent) => {
      const candidate = normalizeAgentName(agent.name);
      return candidate && (candidate.includes(sourceName) || sourceName.includes(candidate));
    })
    : null;
  return nameMatch?.id || agents.find((agent) => agent.id === 'main')?.id || agents[0]?.id || 'main';
}

function qclawRuntimeEnv(runtime, baseEnv = process.env) {
  return {
    ...baseEnv,
    OPENCLAW_STATE_DIR: runtime.stateDir,
    OPENCLAW_CONFIG_PATH: runtime.configPath,
    OPENCLAW_GATEWAY_PORT: String(runtime.port),
    QCLAW_BUNDLED_CONFIG_DIR: runtime.resourcesDir,
    QCLAW_USER_DATA_DIR: runtime.userDataDir,
  };
}

function upsertQClawNativeMcpServer(configPath, serverName, server, options = {}) {
  const config = readJson(configPath);
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('QClaw OpenClaw 配置不是有效对象。');
  }
  const currentMcp = config.mcp && typeof config.mcp === 'object' && !Array.isArray(config.mcp)
    ? config.mcp
    : {};
  const currentServers = currentMcp.servers
    && typeof currentMcp.servers === 'object'
    && !Array.isArray(currentMcp.servers)
    ? currentMcp.servers
    : {};
  const nextServers = { ...currentServers };
  if (options.replaceEducationManagerServers) {
    for (const key of Object.keys(nextServers)) {
      if (key === 'edu-manager-knowledge' || key.startsWith('edu-manager-knowledge-')) {
        delete nextServers[key];
      }
    }
  }
  config.mcp = {
    ...currentMcp,
    servers: {
      ...nextServers,
      [String(serverName)]: {
        command: String(server.command || ''),
        args: Array.isArray(server.args) ? server.args.map(String) : [],
        enabled: server.enabled !== false,
        connectTimeout: Math.max(1, Number(server.connectTimeout || 10)),
        timeout: Math.max(1, Number(server.timeout || 30)),
        toolFilter: {
          include: Array.isArray(server.allowedTools) ? server.allowedTools.map(String) : [],
        },
      },
    },
  };
  const currentTools = config.tools && typeof config.tools === 'object' && !Array.isArray(config.tools)
    ? config.tools
    : {};
  const alsoAllow = Array.isArray(currentTools.alsoAllow) ? currentTools.alsoAllow.map(String) : [];
  config.tools = {
    ...currentTools,
    alsoAllow: Array.from(new Set([...alsoAllow, 'bundle-mcp'])),
  };
  const sandboxMode = String(config?.agents?.defaults?.sandbox?.mode || '');
  const sandbox = currentTools.sandbox && typeof currentTools.sandbox === 'object' && !Array.isArray(currentTools.sandbox)
    ? currentTools.sandbox
    : null;
  if (sandbox && ['all', 'non-main'].includes(sandboxMode)) {
    const sandboxTools = sandbox.tools && typeof sandbox.tools === 'object' && !Array.isArray(sandbox.tools)
      ? sandbox.tools
      : {};
    const sandboxAlsoAllow = Array.isArray(sandboxTools.alsoAllow) ? sandboxTools.alsoAllow.map(String) : [];
    config.tools.sandbox = {
      ...sandbox,
      tools: {
        ...sandboxTools,
        alsoAllow: Array.from(new Set([...sandboxAlsoAllow, 'bundle-mcp'])),
      },
    };
  }
  writeJsonAtomic(configPath, config);
  const verified = readJson(configPath);
  return Boolean(verified?.mcp?.servers?.[serverName]?.enabled !== false
    && verified?.tools?.alsoAllow?.includes('bundle-mcp'));
}

module.exports = {
  discoverQClawRuntime,
  qclawRuntimeEnv,
  selectQClawAgentId,
  upsertQClawNativeMcpServer,
};
