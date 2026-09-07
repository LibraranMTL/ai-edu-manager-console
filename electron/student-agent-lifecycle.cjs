const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  AUTO_CAPTURE_AGENT_IDS,
  lifecycleAdapter,
} = require('./agent-adapter-registry.cjs');

const MANAGED_MARKER = 'EDU-MANAGER-LIFECYCLE';
const PLUGIN_ID = 'edu-manager-lifecycle';
const TERMINAL_DESCRIPTOR_SCHEMA = 'edu-manager.student-terminal-lifecycle-capture.v1';
const TERMINAL_GRANT_PREFIX = 'terminal-device:';

function readJson(filePath, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function parseJsoncObject(value) {
  const source = String(value || '');
  let output = '';
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (current === '\n') {
        lineComment = false;
        output += current;
      }
      continue;
    }
    if (blockComment) {
      if (current === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (!inString && current === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (!inString && current === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    output += current;
    if (inString) {
      if (escaped) escaped = false;
      else if (current === '\\') escaped = true;
      else if (current === '"') inString = false;
    } else if (current === '"') {
      inString = true;
    }
  }
  return JSON.parse(output.replace(/,\s*([}\]])/g, '$1'));
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

function terminalLifecyclePaths(userDataDir) {
  const root = path.join(path.resolve(userDataDir), 'agent-lifecycle');
  return {
    root,
    descriptorPath: path.join(root, 'capture-descriptor.json'),
    hookPath: path.join(root, 'agent-lifecycle-hook.ps1'),
    queueDir: path.join(root, 'queue'),
  };
}

function terminalGrantId(deviceId) {
  return `${TERMINAL_GRANT_PREFIX}${String(deviceId || '').trim()}`;
}

function setTerminalLifecycleDescriptorEnabled(userDataDir, enabled) {
  const paths = terminalLifecyclePaths(userDataDir);
  if (!fs.existsSync(paths.descriptorPath)) return false;
  const descriptor = readJson(paths.descriptorPath, null);
  if (!descriptor?.lifecycleCapture) return false;
  descriptor.lifecycleCapture.enabled = Boolean(enabled);
  descriptor.updatedAt = new Date().toISOString();
  writeJsonAtomic(paths.descriptorPath, descriptor);
  return true;
}

function buildTerminalLifecycleDescriptor({ studentId, deviceId, queueDir, enabled }) {
  const scopeId = String(studentId || '').trim();
  const safeDeviceId = String(deviceId || '').trim();
  if (!scopeId || !safeDeviceId) throw new Error('个人终端自动会话采集缺少学生或设备身份。');
  return {
    schema: TERMINAL_DESCRIPTOR_SCHEMA,
    authentication: {
      type: 'student_terminal_session_relay',
      grantId: terminalGrantId(safeDeviceId),
    },
    lifecycleCapture: {
      schema: 'edu-manager.agent-lifecycle-capture.v1',
      enabled: Boolean(enabled),
      mode: 'event_queue',
      queueDir: path.resolve(queueDir),
      allowedAgents: [...AUTO_CAPTURE_AGENT_IDS],
      excludes: ['historical_sessions', 'system_prompts', 'tool_secrets', 'task_center_context'],
    },
    defaults: {
      scopeType: 'student',
      scopeId,
      scopePolicy: 'fixed_personal_terminal_student',
      deviceId: safeDeviceId,
    },
    ordinaryUserConfigurationRequired: false,
    updatedAt: new Date().toISOString(),
  };
}

function quoteHookCommandArgument(value) {
  return `"${String(value || '').replace(/"/g, '\\"')}"`;
}

function managedLifecycleHookCommand(sourceAgent, hookPath, descriptorPath) {
  return [
    'powershell.exe',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy Bypass',
    '-File',
    quoteHookCommandArgument(hookPath),
    '-Descriptor',
    quoteHookCommandArgument(descriptorPath),
    '-SourceAgent',
    sourceAgent,
    '-ManagedMarker',
    MANAGED_MARKER,
  ].join(' ');
}

function upsertLifecycleCommandHooks(configPath, sourceAgent, hookPath, descriptorPath) {
  let config = {};
  if (fs.existsSync(configPath)) {
    config = parseJsoncObject(fs.readFileSync(configPath, 'utf8'));
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Hook 配置不是有效对象。');
  }
  config.hooks = config.hooks && typeof config.hooks === 'object' && !Array.isArray(config.hooks) ? config.hooks : {};
  const command = managedLifecycleHookCommand(sourceAgent, hookPath, descriptorPath);
  const eventNames = lifecycleAdapter(sourceAgent)?.hookEvents || ['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd'];
  for (const eventName of eventNames) {
    const groups = Array.isArray(config.hooks[eventName]) ? config.hooks[eventName] : [];
    const cleaned = groups.map((group) => ({
      ...group,
      hooks: (Array.isArray(group?.hooks) ? group.hooks : []).filter((hook) => !String(hook?.command || '').includes(MANAGED_MARKER)),
    })).filter((group) => group.hooks.length);
    const handler = { type: 'command', command, timeout: 3 };
    if (['codex', 'claude-code'].includes(sourceAgent) && !['SessionEnd', 'Interrupt'].includes(eventName)) handler.async = true;
    config.hooks[eventName] = [...cleaned, { hooks: [handler] }];
  }
  writeJsonAtomic(configPath, config);
  return eventNames.every((eventName) => (
    (readJson(configPath, {})?.hooks?.[eventName] || []).some((group) => (
      (group?.hooks || []).some((hook) => String(hook?.command || '').includes(MANAGED_MARKER))
    ))
  ));
}

function disableLifecycleCommandHooks(configPath) {
  if (!fs.existsSync(configPath)) return false;
  const config = parseJsoncObject(fs.readFileSync(configPath, 'utf8'));
  if (!config?.hooks || typeof config.hooks !== 'object') return false;
  let changed = false;
  for (const eventName of Object.keys(config.hooks)) {
    if (!Array.isArray(config.hooks[eventName])) continue;
    const before = JSON.stringify(config.hooks[eventName]);
    config.hooks[eventName] = config.hooks[eventName].map((group) => ({
      ...group,
      hooks: (Array.isArray(group?.hooks) ? group.hooks : []).filter((hook) => !String(hook?.command || '').includes(MANAGED_MARKER)),
    })).filter((group) => group.hooks.length);
    if (!config.hooks[eventName].length) delete config.hooks[eventName];
    if (JSON.stringify(config.hooks[eventName]) !== before) changed = true;
  }
  if (changed) writeJsonAtomic(configPath, config);
  return changed;
}

function openClawLifecyclePluginSource(sourceAgent, descriptorPath) {
  return `import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const descriptorPath = ${JSON.stringify(descriptorPath)};
const sourceAgent = ${JSON.stringify(sourceAgent)};

function enqueue(hookEventName, event, context) {
  try {
    const descriptor = JSON.parse(fs.readFileSync(descriptorPath, "utf8"));
    const capture = descriptor.lifecycleCapture || {};
    if (capture.enabled !== true || !Array.isArray(capture.allowedAgents) || !capture.allowedAgents.includes(sourceAgent)) return;
    const queueDir = String(capture.queueDir || "");
    if (!queueDir) return;
    fs.mkdirSync(queueDir, { recursive: true });
    const capturedAt = new Date().toISOString();
    const envelope = {
      schema: "edu-manager.agent-lifecycle-event.v1",
      sourceAgent,
      scopeId: String(descriptor.defaults?.scopeId || ""),
      grantId: String(descriptor.authentication?.grantId || ""),
      capturedAt,
      payload: { hook_event_name: hookEventName, event, context },
    };
    const target = path.join(queueDir, capturedAt.replace(/\\D/g, "") + "-" + crypto.randomUUID() + ".json");
    const temporary = target + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(envelope), "utf8");
    fs.renameSync(temporary, target);
  } catch { /* Conversation flow must never be affected by capture. */ }
}

export default {
  id: "${PLUGIN_ID}",
  name: "Education Manager Lifecycle Capture",
  register(api) {
    for (const hookName of ["session_start", "message_received", "message_sent", "session_end"]) {
      api.on(hookName, async (event, context) => enqueue(hookName, event, context), { timeoutMs: 1000 });
    }
  },
};
`;
}

function installOpenClawLifecyclePlugin(configPath, sourceAgent, descriptorPath) {
  if (!fs.existsSync(configPath)) return false;
  const stateDir = path.dirname(configPath);
  const pluginDir = path.join(stateDir, 'plugins', PLUGIN_ID);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'index.ts'), openClawLifecyclePluginSource(sourceAgent, descriptorPath), 'utf8');
  writeJsonAtomic(path.join(pluginDir, 'openclaw.plugin.json'), {
    id: PLUGIN_ID,
    name: 'Education Manager Lifecycle Capture',
    version: '1.0.0',
    description: 'Captures only newly emitted personal-terminal student-authorized conversation lifecycle events.',
    main: 'index.ts',
    configSchema: { type: 'object', additionalProperties: false, properties: {} },
  });
  const config = parseJsoncObject(fs.readFileSync(configPath, 'utf8'));
  config.plugins = config.plugins && typeof config.plugins === 'object' && !Array.isArray(config.plugins) ? config.plugins : {};
  config.plugins.load = config.plugins.load && typeof config.plugins.load === 'object' && !Array.isArray(config.plugins.load) ? config.plugins.load : {};
  config.plugins.load.paths = Array.from(new Set([...(Array.isArray(config.plugins.load.paths) ? config.plugins.load.paths : []), pluginDir]));
  config.plugins.entries = config.plugins.entries && typeof config.plugins.entries === 'object' && !Array.isArray(config.plugins.entries) ? config.plugins.entries : {};
  config.plugins.entries[PLUGIN_ID] = {
    ...(config.plugins.entries[PLUGIN_ID] || {}),
    enabled: true,
    hooks: {
      ...(config.plugins.entries[PLUGIN_ID]?.hooks || {}),
      allowConversationAccess: true,
    },
  };
  if (Array.isArray(config.plugins.allow)) config.plugins.allow = Array.from(new Set([...config.plugins.allow, PLUGIN_ID]));
  writeJsonAtomic(configPath, config);
  const verified = readJson(configPath, {});
  return Boolean(verified?.plugins?.entries?.[PLUGIN_ID]?.enabled && (verified?.plugins?.load?.paths || []).includes(pluginDir));
}

function setOpenClawLifecyclePluginEnabled(configPath, enabled) {
  if (!fs.existsSync(configPath)) return false;
  const config = parseJsoncObject(fs.readFileSync(configPath, 'utf8'));
  if (!config?.plugins?.entries?.[PLUGIN_ID]) return false;
  config.plugins.entries[PLUGIN_ID].enabled = Boolean(enabled);
  writeJsonAtomic(configPath, config);
  return true;
}

function hermesHomeDir(homeDir = os.homedir(), env = process.env) {
  const candidates = [
    env.HERMES_HOME,
    path.join(homeDir, '.hermes'),
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'hermes') : '',
    path.join(homeDir, 'AppData', 'Local', 'hermes'),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, 'config.yaml')))
    || candidates.find((candidate) => fs.existsSync(candidate))
    || candidates[0];
}

function hermesLifecyclePluginSource(descriptorPath) {
  return `"""Education Manager lifecycle capture for authorized personal-terminal student turns."""
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

DESCRIPTOR_PATH = Path(${JSON.stringify(descriptorPath)})
SOURCE_AGENT = "hermes"

def _enqueue(hook_event_name, **kwargs):
    try:
        if not DESCRIPTOR_PATH.exists():
            return None
        descriptor = json.loads(DESCRIPTOR_PATH.read_text(encoding="utf-8-sig"))
        capture = descriptor.get("lifecycleCapture") or {}
        if capture.get("enabled") is not True or SOURCE_AGENT not in (capture.get("allowedAgents") or []):
            return None
        session_id = str(kwargs.get("session_id") or "").strip()
        queue_dir = Path(str(capture.get("queueDir") or ""))
        if not session_id or not str(queue_dir):
            return None
        payload = {"hook_event_name": hook_event_name, "session_id": session_id, "model": str(kwargs.get("model") or "")[:240], "platform": str(kwargs.get("platform") or "")[:120]}
        if hook_event_name == "pre_llm_call":
            payload["user_message"] = str(kwargs.get("user_message") or "")[:20000]
        elif hook_event_name == "post_llm_call":
            payload["assistant_response"] = str(kwargs.get("assistant_response") or "")[:20000]
        elif hook_event_name == "on_session_finalize":
            payload["completed"] = True
        captured_at = datetime.now(timezone.utc).isoformat()
        envelope = {"schema": "edu-manager.agent-lifecycle-event.v1", "sourceAgent": SOURCE_AGENT, "scopeId": str((descriptor.get("defaults") or {}).get("scopeId") or ""), "grantId": str((descriptor.get("authentication") or {}).get("grantId") or ""), "capturedAt": captured_at, "payload": payload}
        queue_dir.mkdir(parents=True, exist_ok=True)
        target = queue_dir / (datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f") + "-" + uuid.uuid4().hex + ".json")
        temporary = Path(str(target) + ".tmp")
        temporary.write_text(json.dumps(envelope, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        temporary.replace(target)
    except Exception:
        return None
    return None

def register(ctx):
    ctx.register_hook("on_session_start", lambda session_id=None, model=None, platform=None, **kwargs: _enqueue("on_session_start", session_id=session_id, model=model, platform=platform, **kwargs))
    ctx.register_hook("pre_llm_call", lambda session_id=None, user_message=None, **kwargs: _enqueue("pre_llm_call", session_id=session_id, user_message=user_message, **kwargs))
    ctx.register_hook("post_llm_call", lambda session_id=None, assistant_response=None, **kwargs: _enqueue("post_llm_call", session_id=session_id, assistant_response=assistant_response, **kwargs))
    ctx.register_hook("on_session_finalize", lambda session_id=None, **kwargs: _enqueue("on_session_finalize", session_id=session_id, **kwargs))
`;
}

function runHermesPluginCommand(executable, action) {
  if (!executable || !fs.existsSync(executable)) return { ok: false, message: '未找到 Hermes CLI。' };
  const result = spawnSync(executable, ['plugins', action, PLUGIN_ID], {
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true,
    shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable),
  });
  return { ok: result.status === 0, message: String(result.stderr || result.stdout || '').trim().slice(0, 1000) };
}

function installHermesLifecyclePlugin(homeDir, descriptorPath, executable, env = process.env) {
  if (!executable || !fs.existsSync(executable)) return false;
  const pluginDir = path.join(hermesHomeDir(homeDir, env), 'plugins', PLUGIN_ID);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'plugin.yaml'), [
    `name: ${PLUGIN_ID}`,
    'version: 1.0.0',
    'description: Captures only newly emitted personal-terminal student-authorized conversation turns.',
    'provides_hooks:',
    '  - on_session_start',
    '  - pre_llm_call',
    '  - post_llm_call',
    '  - on_session_finalize',
    '',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(pluginDir, '__init__.py'), hermesLifecyclePluginSource(descriptorPath), 'utf8');
  const enabled = runHermesPluginCommand(executable, 'enable');
  if (!enabled.ok) throw new Error(enabled.message || 'Hermes 插件启用失败。');
  return true;
}

function findExecutable(names, options = {}) {
  const spawn = options.spawnSync || spawnSync;
  for (const name of names) {
    const result = spawn('where.exe', [name], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
    if (result.status === 0) {
      const candidate = String(result.stdout || '').split(/\r?\n/).map((item) => item.trim()).find(Boolean);
      if (candidate) return candidate;
    }
  }
  return '';
}

function firstExisting(candidates) {
  return candidates.filter(Boolean).find((candidate) => fs.existsSync(candidate)) || '';
}

function detectLifecycleAgents(options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const env = options.env || process.env;
  const localAppData = env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
  const programFiles = [env.ProgramFiles, env['ProgramFiles(x86)'], 'C:\\Program Files', 'D:\\Program Files'].filter(Boolean);
  const command = (names) => findExecutable(names, options);
  const codexExe = command(['codex.cmd', 'codex.exe', 'codex']);
  const workBuddyExe = command(['codebuddy.cmd', 'workbuddy.exe', 'codebuddy']) || firstExisting(programFiles.flatMap((root) => [path.join(root, 'WorkBuddy', 'WorkBuddy.exe'), path.join(root, 'Tencent', 'WorkBuddy', 'WorkBuddy.exe')]));
  const claudeExe = command(['claude.cmd', 'claude.exe', 'claude-code.cmd', 'claude-code.exe']);
  const openClawExe = command(['openclaw.cmd', 'openclaw.exe', 'openclaw']);
  const hermesExe = command(['hermes.cmd', 'hermes.exe', 'hermes']) || firstExisting([path.join(homeDir, '.local', 'bin', 'hermes.exe'), path.join(localAppData, 'hermes', 'hermes.exe')]);
  const qclawConfig = path.join(homeDir, '.qclaw', 'openclaw.json');
  const openclawConfig = path.join(homeDir, '.openclaw', 'openclaw.json');
  return {
    codex: { installed: Boolean(codexExe || fs.existsSync(path.join(homeDir, '.codex'))), exePath: codexExe },
    qclaw: { installed: fs.existsSync(qclawConfig), configPath: qclawConfig },
    workbuddy: { installed: Boolean(workBuddyExe || fs.existsSync(path.join(homeDir, '.workbuddy')) || fs.existsSync(path.join(homeDir, '.codebuddy'))), exePath: workBuddyExe },
    openclaw: { installed: Boolean(openClawExe || fs.existsSync(openclawConfig)), exePath: openClawExe, configPath: openclawConfig },
    'claude-code': { installed: Boolean(claudeExe || fs.existsSync(path.join(homeDir, '.claude'))), exePath: claudeExe },
    hermes: { installed: Boolean(hermesExe || fs.existsSync(hermesHomeDir(homeDir, env))), exePath: hermesExe },
  };
}

function lifecycleConfigPaths(homeDir) {
  return {
    codex: [path.join(homeDir, '.codex', 'hooks.json')],
    workbuddy: [path.join(homeDir, '.workbuddy', 'settings.json'), path.join(homeDir, '.codebuddy', 'settings.json')],
    'claude-code': [path.join(homeDir, '.claude', 'settings.json')],
    qclaw: [path.join(homeDir, '.qclaw', 'openclaw.json')],
    openclaw: [path.join(homeDir, '.openclaw', 'openclaw.json')],
  };
}

function disableTerminalLifecycleRegistrations(options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const configs = lifecycleConfigPaths(homeDir);
  for (const configPath of [...configs.codex, ...configs.workbuddy, ...configs['claude-code']]) disableLifecycleCommandHooks(configPath);
  for (const configPath of [...configs.qclaw, ...configs.openclaw]) setOpenClawLifecyclePluginEnabled(configPath, false);
  const detected = options.detectedAgents || detectLifecycleAgents(options);
  if (detected.hermes?.exePath) runHermesPluginCommand(detected.hermes.exePath, 'disable');
}

function reconcileTerminalLifecycle(options = {}) {
  const userDataDir = path.resolve(options.userDataDir);
  const homeDir = options.homeDir || os.homedir();
  const paths = terminalLifecyclePaths(userDataDir);
  fs.mkdirSync(paths.queueDir, { recursive: true });
  fs.copyFileSync(options.hookSourcePath, paths.hookPath);
  const descriptor = buildTerminalLifecycleDescriptor({
    studentId: options.studentId,
    deviceId: options.deviceId,
    queueDir: paths.queueDir,
    enabled: options.enabled,
  });
  writeJsonAtomic(paths.descriptorPath, descriptor);
  if (!options.enabled) {
    disableTerminalLifecycleRegistrations({ ...options, homeDir });
    return { enabled: false, paths, registrations: {} };
  }
  const detected = options.detectedAgents || detectLifecycleAgents({ ...options, homeDir });
  const configs = lifecycleConfigPaths(homeDir);
  const registrations = {};
  const warnings = [];
  for (const agentId of AUTO_CAPTURE_AGENT_IDS) {
    const install = detected[agentId] || { installed: false };
    registrations[agentId] = { installed: Boolean(install.installed), connected: false };
    if (!install.installed) continue;
    try {
      if (agentId === 'codex' || agentId === 'workbuddy' || agentId === 'claude-code') {
        const targets = configs[agentId].filter((configPath) => agentId !== 'workbuddy' || fs.existsSync(path.dirname(configPath)));
        const effectiveTargets = targets.length ? targets : [configs[agentId][0]];
        const connectedTargets = effectiveTargets.map((configPath) => (
          upsertLifecycleCommandHooks(configPath, agentId, paths.hookPath, paths.descriptorPath)
        ));
        registrations[agentId].connected = connectedTargets.some(Boolean);
      } else if (agentId === 'qclaw' || agentId === 'openclaw') {
        registrations[agentId].connected = installOpenClawLifecyclePlugin(configs[agentId][0], agentId, paths.descriptorPath);
      } else if (agentId === 'hermes') {
        registrations[agentId].connected = installHermesLifecyclePlugin(homeDir, paths.descriptorPath, install.exePath, options.env || process.env);
      }
    } catch (error) {
      registrations[agentId].warning = String(error.message || error).slice(0, 500);
      warnings.push(`${agentId}: ${registrations[agentId].warning}`);
    }
  }
  return { enabled: true, paths, registrations, warnings };
}

async function drainTerminalLifecycleQueue(options = {}) {
  const queueDir = path.resolve(options.queueDir);
  if (!fs.existsSync(queueDir)) return { processed: 0, discarded: 0, deferred: 0, pending: 0 };
  const expectedScopeId = String(options.studentId || '').trim();
  const expectedGrantId = terminalGrantId(options.deviceId);
  const files = fs.readdirSync(queueDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort()
    .slice(0, Math.max(1, Math.min(200, Number(options.limit || 100))));
  const result = { processed: 0, discarded: 0, deferred: 0, pending: files.length };
  for (const name of files) {
    const filePath = path.join(queueDir, name);
    let envelope;
    try {
      envelope = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      try { fs.unlinkSync(filePath); } catch {}
      result.discarded += 1;
      continue;
    }
    if (
      envelope?.schema !== 'edu-manager.agent-lifecycle-event.v1'
      || String(envelope.scopeId || '') !== expectedScopeId
      || String(envelope.grantId || '') !== expectedGrantId
      || !AUTO_CAPTURE_AGENT_IDS.includes(String(envelope.sourceAgent || '').toLowerCase())
    ) {
      try { fs.unlinkSync(filePath); } catch {}
      result.discarded += 1;
      continue;
    }
    try {
      await options.postEnvelope(envelope);
      fs.unlinkSync(filePath);
      result.processed += 1;
    } catch {
      result.deferred += 1;
      break;
    }
  }
  result.pending = fs.existsSync(queueDir)
    ? fs.readdirSync(queueDir, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.json')).length
    : 0;
  return result;
}

module.exports = {
  MANAGED_MARKER,
  PLUGIN_ID,
  TERMINAL_DESCRIPTOR_SCHEMA,
  TERMINAL_GRANT_PREFIX,
  buildTerminalLifecycleDescriptor,
  detectLifecycleAgents,
  disableLifecycleCommandHooks,
  disableTerminalLifecycleRegistrations,
  drainTerminalLifecycleQueue,
  installOpenClawLifecyclePlugin,
  lifecycleConfigPaths,
  managedLifecycleHookCommand,
  parseJsoncObject,
  reconcileTerminalLifecycle,
  setOpenClawLifecyclePluginEnabled,
  setTerminalLifecycleDescriptorEnabled,
  terminalGrantId,
  terminalLifecyclePaths,
  upsertLifecycleCommandHooks,
};
