const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  discoverQClawRuntime,
  qclawRuntimeEnv,
  selectQClawAgentId,
  upsertQClawNativeMcpServer,
} = require('../electron/qclaw-runtime.cjs');

test('QClaw runtime discovery separates installation from a usable local gateway runtime', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-qclaw-runtime-'));
  const installDir = path.join(root, 'QClaw', 'v1');
  const resourcesDir = path.join(installDir, 'resources');
  const nodePath = path.join(resourcesDir, 'node', 'node.exe');
  const cliPath = path.join(resourcesDir, 'openclaw', 'node_modules', 'openclaw', 'openclaw.mjs');
  const homeDir = path.join(root, 'home');
  const appDataDir = path.join(root, 'appdata');
  fs.mkdirSync(path.dirname(nodePath), { recursive: true });
  fs.mkdirSync(path.dirname(cliPath), { recursive: true });
  fs.mkdirSync(path.join(homeDir, '.qclaw'), { recursive: true });
  fs.writeFileSync(path.join(installDir, 'QClaw.exe'), '');
  fs.writeFileSync(nodePath, '');
  fs.writeFileSync(cliPath, '');
  fs.writeFileSync(path.join(homeDir, '.qclaw', 'openclaw.json'), JSON.stringify({
    gateway: { port: 51331 },
    agents: { list: [{ id: 'main', name: 'QClaw' }, { id: 'student-1', name: '赵书源 AI教育管家', workspace: 'D:\\students\\zhao' }] },
  }));

  const runtime = discoverQClawRuntime(path.join(installDir, 'QClaw.exe'), { homeDir, appDataDir });
  assert.equal(runtime.available, true);
  assert.equal(runtime.port, 51331);
  assert.equal(selectQClawAgentId(runtime, { sourceName: '赵书源', input: { knowledgeRoot: 'D:\\other' } }), 'student-1');
  assert.equal(selectQClawAgentId(runtime, { sourceName: '未知学生', input: { knowledgeRoot: 'D:\\other' } }), 'main');
  const env = qclawRuntimeEnv(runtime, { KEEP: 'yes' });
  assert.equal(env.KEEP, 'yes');
  assert.equal(env.OPENCLAW_GATEWAY_PORT, '51331');
  assert.equal(env.OPENCLAW_STATE_DIR, path.join(homeDir, '.qclaw'));
});

test('Education Manager is merged into the QClaw native MCP registry without removing existing servers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-qclaw-native-mcp-'));
  const configPath = path.join(root, 'openclaw.json');
  try {
    fs.writeFileSync(configPath, JSON.stringify({
      gateway: { port: 51331 },
      mcp: { servers: { existing: { command: 'existing.exe', args: [] } } },
    }), 'utf8');
    const registered = upsertQClawNativeMcpServer(configPath, 'edu-manager-knowledge-student1', {
      command: 'powershell.exe',
      args: ['-File', 'bridge.ps1'],
      allowedTools: ['query_education_knowledge', 'submit_education_conversation'],
    });
    assert.equal(registered, true);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(config.mcp.servers.existing.command, 'existing.exe');
    assert.equal(config.mcp.servers['edu-manager-knowledge-student1'].enabled, true);
    assert.deepEqual(
      config.mcp.servers['edu-manager-knowledge-student1'].toolFilter.include,
      ['query_education_knowledge', 'submit_education_conversation'],
    );
    assert.ok(config.tools.alsoAllow.includes('bundle-mcp'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('activating one student replaces stale Education Manager servers but preserves unrelated QClaw MCP servers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qclaw-native-active-student-'));
  const configPath = path.join(root, 'openclaw.json');
  try {
    fs.writeFileSync(configPath, JSON.stringify({
      mcp: {
        servers: {
          calendar: { command: 'calendar.exe', enabled: true },
          'edu-manager-knowledge-old-student': { command: 'old.exe', enabled: true },
        },
      },
    }), 'utf8');
    const registered = upsertQClawNativeMcpServer(configPath, 'edu-manager-knowledge', {
      command: 'powershell.exe',
      args: ['-File', 'bridge.ps1'],
      allowedTools: ['query_education_knowledge', 'submit_education_conversation'],
    }, { replaceEducationManagerServers: true });
    assert.equal(registered, true);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.ok(config.mcp.servers.calendar);
    assert.equal(config.mcp.servers['edu-manager-knowledge-old-student'], undefined);
    assert.ok(config.mcp.servers['edu-manager-knowledge']);
    assert.ok(config.tools.alsoAllow.includes('bundle-mcp'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
