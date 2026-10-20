'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { writeJsonAtomic } = require('./project-materials.cjs');
const SCHEMA = 'edu-manager.agent-control.v4';
const registryService = require('./ai-executor-registry.cjs');
const PROFILES = Object.freeze(Object.fromEntries(Object.entries(registryService.PROFILES).map(([id, spec]) => [id,
  { ...spec, providers: registryService.executorRegistry().filter(p => p.automaticProfiles.includes(id)).map(p => p.id) }])));
// Compatibility export; inbound permissions have one authoritative R21 catalog.
const GLOBAL_CAPABILITIES = require('./external-agent-connector.cjs').PERMISSIONS.map(p => p.id);
const PROVIDER_MODES = Object.freeze(['automatic_preferred', 'manual_only', 'disabled']);
function globalDefaults(primary = 'workbuddy') { return { enabled: false, version: 0, order: [...new Set([primary, 'workbuddy', 'codex'])], disabledProviders: [], providerModes: {}, providerProfiles: {}, desktopHandoff: true, authorizedAt: '', captureEpoch: '', capturedConversationRouting: { enabled: true, authorizedAt: '' } }; }
function normalizeGlobal(global, registry = registryService.executorRegistry()) {
  const value = { ...global, disabledProviders: Array.isArray(global?.disabledProviders) ? global.disabledProviders : [], providerModes: { ...(global?.providerModes || {}) }, providerProfiles: { ...(global?.providerProfiles || {}) } };
  value.capturedConversationRouting = {
    enabled: typeof global?.capturedConversationRouting?.enabled === 'boolean' ? global.capturedConversationRouting.enabled : Boolean(global?.enabled),
    authorizedAt: String(global?.capturedConversationRouting?.authorizedAt || ''),
  };
  const known = new Set(registry.map(provider => provider.id));
  value.providerModes = Object.fromEntries(Object.entries(value.providerModes).filter(([id]) => known.has(id)));
  value.providerProfiles = Object.fromEntries(Object.entries(value.providerProfiles).filter(([id]) => known.has(id)));
  for (const provider of registry) {
    value.providerModes[provider.id] ||= value.disabledProviders.includes(provider.id) ? 'disabled' : provider.automaticProfiles.length ? 'automatic_preferred' : 'manual_only';
    if (!Array.isArray(value.providerProfiles[provider.id])) value.providerProfiles[provider.id] = provider.automaticProfiles.slice();
    else value.providerProfiles[provider.id] = [...new Set(value.providerProfiles[provider.id])].filter(id => provider.automaticProfiles.includes(id));
  }
  value.disabledProviders = registry.filter(provider => value.providerModes[provider.id] === 'disabled').map(provider => provider.id);
  return value;
}
function key(scope, profile) { return JSON.stringify([String(scope.studentId), String(scope.projectId || ''), profile]); }
function fail(code, message) { return Object.assign(new Error(message), { code }); }
function legacyPolicy(student, profile, project) {
  const primary = ['learning_card_generation.v1', 'research.v1'].includes(profile) ? 'codex' : String(project?.agentTool || student?.agentTool || '');
  const backup = profile === 'classification_readonly.v1' && student?.classificationFallback?.enabled ? student.classificationFallback.providerId : '';
  return { primary, fallbacks: backup && backup !== primary ? [backup] : [], enabled: true, desktopHandoff: false, version: 0, inherited: true };
}
function resolvePolicy(store, scope, profile, student, project, registry = registryService.executorRegistry()) {
  if (!PROFILES[profile]) throw fail('UNKNOWN_PROFILE', '不支持的任务类型');
  if (store.global) {
    const providers = registryService.routeProviders(store.global, profile, registry);
    return { primary: providers[0] || '', fallbacks: providers.slice(1), enabled: store.global.enabled,
      desktopHandoff: store.global.desktopHandoff, version: store.global.version, inherited: false, global: true, providers };
  }
  const exact = store.policies[key(scope, profile)];
  const parent = scope.projectId ? store.policies[key({ studentId: scope.studentId }, profile)] : null;
  if (parent?.enabled === false) return { ...parent, inherited: true, version: 0, parentVersion: parent.version };
  return exact || (parent ? { ...parent, inherited: true, version: 0, parentVersion: parent.version } : legacyPolicy(student, profile, project));
}
function providersFor(policy, profile) {
  if (policy.global) return policy.enabled ? policy.providers || [] : [];
  return policy.enabled ? [...new Set([policy.primary, ...(policy.fallbacks || [])])].filter(id => PROFILES[profile]?.providers.includes(id)) : [];
}
function createAgentControlStore(file) {
  let queue = Promise.resolve();
  const read = () => {
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (![SCHEMA, 'edu-manager.agent-control.v3', 'edu-manager.agent-control.v2', 'edu-manager.agent-control.v1'].includes(value.schema) || !value.policies || Array.isArray(value.policies)) throw Error('invalid schema');
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') return { schema: SCHEMA, revision: 0, policies: {}, history: [] };
      throw fail('CONTROL_STORE_INVALID', 'Agent 设置无法读取，请恢复备份；未使用默认权限继续执行。');
    }
  };
  return { read,
    migrate(registry = registryService.executorRegistry()) {
      const operation = queue.then(async () => {
        const store = read();
        if (!store.global) {
          if (store.schema !== SCHEMA) {
            store.schema = SCHEMA;
            store.revision = Number(store.revision || 0) + 1;
            await fs.promises.mkdir(path.dirname(file), { recursive: true });
            await writeJsonAtomic(file, store);
          }
          return null;
        }
        if (store.schema === SCHEMA && typeof store.global.capturedConversationRouting?.enabled === 'boolean') return normalizeGlobal(store.global, registry);
        const at = new Date().toISOString();
        const previous = normalizeGlobal(store.global, registry);
        const routing = {
          enabled: Boolean(store.global.enabled),
          authorizedAt: store.global.enabled ? at : '',
        };
        const next = { ...previous, version: Number(previous.version || 0) + 1, updatedAt: at, capturedConversationRouting: routing };
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        if (fs.existsSync(file) && !fs.existsSync(file + '.pre-v4.bak')) await fs.promises.copyFile(file, file + '.pre-v4.bak', fs.constants.COPYFILE_EXCL);
        store.schema = SCHEMA;
        store.global = next;
        store.revision = Number(store.revision || 0) + 1;
        store.history = [...(store.history || []), { scope: { type: 'global' }, profile: 'captured_conversation_routing', policy: next, previous, at, migration: 'v4' }].slice(-200);
        await writeJsonAtomic(file, store);
        return next;
      });
      queue = operation.catch(() => {}); return operation;
    },
    saveGlobal(input, registry = registryService.executorRegistry()) {
      const operation = queue.then(async () => {
        const store = read(), prior = normalizeGlobal(store.global || globalDefaults(input.order?.[0]), registry);
        if (Number(input.version) !== prior.version) throw fail('POLICY_CONFLICT', '设置已变化，请刷新后重试');
        if (typeof input.enabled !== 'boolean' || !Array.isArray(input.order) || !Array.isArray(input.disabledProviders)) throw fail('INVALID_POLICY', '全局设置无效');
        const requestedRouting = input.capturedConversationRouting || prior.capturedConversationRouting;
        if (typeof requestedRouting?.enabled !== 'boolean') throw fail('INVALID_POLICY', '自动会话资料路由设置无效');
        const known = new Set(registry.map(p => p.id));
        if ([...input.order, ...input.disabledProviders].some(id => !known.has(id))) throw fail('UNSUPPORTED_PROVIDER', '工具已变化，请刷新列表');
        const requestedModes = { ...prior.providerModes, ...(input.providerModes || {}) };
        const requestedProfiles = { ...prior.providerProfiles, ...(input.providerProfiles || {}) };
        if (Object.keys(requestedModes).some(id => !known.has(id)) || Object.keys(requestedProfiles).some(id => !known.has(id))) throw fail('UNSUPPORTED_PROVIDER', '工具已变化，请刷新列表');
        for (const provider of registry) {
          const mode = input.disabledProviders.includes(provider.id) ? 'disabled'
            : requestedModes[provider.id] || (provider.automaticProfiles.length ? 'automatic_preferred' : 'manual_only');
          if (!PROVIDER_MODES.includes(mode) || mode === 'automatic_preferred' && !provider.automaticProfiles.length || mode === 'manual_only' && !provider.handoff) throw fail('INVALID_POLICY', `${provider.label} 不支持所选执行方式`);
          const profiles = requestedProfiles[provider.id] || provider.automaticProfiles;
          if (!Array.isArray(profiles) || profiles.some(id => !provider.automaticProfiles.includes(id))) throw fail('INVALID_POLICY', `${provider.label} 的任务合同设置无效`);
          requestedModes[provider.id] = mode;
          requestedProfiles[provider.id] = [...new Set(profiles)];
        }
        const at = new Date().toISOString(), newlyEnabled = input.enabled && !prior.enabled;
        const routingNewlyEnabled = input.enabled && requestedRouting.enabled && (newlyEnabled || !prior.capturedConversationRouting.enabled);
        const next = { enabled: input.enabled, order: [...new Set(input.order)].filter(id => id !== 'llm-api'),
          disabledProviders: registry.filter(provider => requestedModes[provider.id] === 'disabled').map(provider => provider.id),
          providerModes: requestedModes, providerProfiles: requestedProfiles, desktopHandoff: input.desktopHandoff !== false,
          version: prior.version + 1, updatedAt: at, authorizedAt: newlyEnabled ? at : prior.authorizedAt,
          captureEpoch: newlyEnabled ? require('node:crypto').randomUUID() : prior.captureEpoch,
          capturedConversationRouting: { enabled: requestedRouting.enabled,
            authorizedAt: routingNewlyEnabled ? at : String(requestedRouting.authorizedAt || prior.capturedConversationRouting.authorizedAt || '') } };
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        if (fs.existsSync(file) && !fs.existsSync(file + '.pre-global.bak')) await fs.promises.copyFile(file, file + '.pre-global.bak', fs.constants.COPYFILE_EXCL);
        if (!store.global) { store.legacyPolicies = store.policies; store.policies = {}; }
        store.schema = SCHEMA; store.global = next; store.revision++;
        store.history = [...(store.history || []), { scope: { type: 'global' }, profile: 'all', policy: next, previous: prior, at }].slice(-200);
        await writeJsonAtomic(file, store); return next;
      });
      queue = operation.catch(() => {}); return operation;
    },
    save(scope, profile, input) {
      const operation = queue.then(async () => {
        const spec = PROFILES[profile];
        if (scope.projectId && profile !== 'digest_host_mediated.v1') throw fail('INVALID_SCOPE', '此任务只使用学生级授权');
        if (!spec || !scope.studentId || typeof input.enabled !== 'boolean' || typeof input.desktopHandoff !== 'boolean') throw fail('INVALID_POLICY', '无效的 Agent 策略');
        const primary = String(input.primary || '');
        const fallbacks = [...new Set(input.fallbacks || [])];
        if (!spec.providers.includes(primary) || fallbacks.some(id => !spec.providers.includes(id) || id === primary) || (input.desktopHandoff && !spec.handoff)) throw fail('UNSUPPORTED_PROVIDER', '该 Agent 尚不支持此任务类型');
        if (input.confirmed !== true) throw fail('CONSENT_REQUIRED', '请确认此学生的任务授权范围');
        const store = read(), id = key(scope, profile), previous = store.policies[id];
        if (store.global) throw fail('GLOBAL_POLICY_ACTIVE', '请在 AI 接入与调度中心修改全局设置');
        if (Number(input.version) !== Number(previous?.version || 0)) throw fail('POLICY_CONFLICT', '设置已变化，请刷新后重试');
        const next = { primary, fallbacks, enabled: input.enabled, desktopHandoff: input.desktopHandoff,
          version: Number(previous?.version || 0) + 1, updatedAt: new Date().toISOString(), inherited: false };
        // Back up the complete old control store before its first change. Existing
        // student/project files and vendor credentials are never rewritten here.
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        if (fs.existsSync(file) && !fs.existsSync(file + '.pre-update.bak')) await fs.promises.copyFile(file, file + '.pre-update.bak', fs.constants.COPYFILE_EXCL);
        store.policies[id] = next; store.revision++;
        store.history = [...(store.history || []), { scope, profile, previous: previous || null, policy: next, at: next.updatedAt }].slice(-200);
        await writeJsonAtomic(file, store); return next;
      });
      queue = operation.catch(() => {}); return operation;
    },
  };
}
// Only explicit pre-send failures permit failover. Unknown exceptions and any
// execution accepted by a provider end this dispatch, even if its result fails.
const PRE_SEND = new Set(['AUTHENTICATION_REQUIRED', 'WORKBUDDY_QUALIFICATION_REQUIRED', 'AGENT_CONTRACT_REQUIRED', 'AGENT_INPUT_TOO_LARGE', 'AGENT_UNAVAILABLE', 'agent_unavailable', 'EXECUTOR_CIRCUIT_OPEN', 'controlled_adapter_required', 'LLM_API_CONFIGURATION_REQUIRED', 'LLM_API_AUTHENTICATION_REQUIRED', 'LLM_API_REJECTED', 'CLI_CONTRACT_REQUIRED']);
function safeToRetry(error) {
  return error?.stage === 'not_sent' && !['cancelled', 'AGENT_CANCELLED', 'AGENT_POLICY_CHANGED', 'AGENT_SCOPE_DENIED'].includes(error.code)
    || (PRE_SEND.has(error?.code) && !['unknown', 'possibly_sent', 'sent', 'accepted'].includes(error?.stage))
    || error?.stopConfirmed === true && error?.retrySafe === true;
}
async function dispatchAgent({ policy, profile, requested = '', attempt, handoff, record, current }) {
  const allowed = providersFor(policy, profile);
  const fixed = requested && !['auto', 'smart', 'rule', 'confirm'].includes(requested);
  const providers = fixed ? allowed.filter(id => id === requested) : allowed;
  const attempts = [];
  if (!policy.enabled || fixed && !providers.length) return { ok: false, code: 'AGENT_SCOPE_DENIED', message: '此任务未授权可用执行器，请前往 AI 接入与调度中心设置。', attempts };
  for (const providerId of providers) {
    if (current && !current(policy)) return { ok: false, code: 'AGENT_POLICY_CHANGED', message: '执行期间授权已变化，请重新检查任务。', attempts };
    await record({ providerId, attempts: [...attempts], stage: 'qualifying' });
    const result = await attempt(providerId);
    const safe = PRE_SEND.has(result.code) && !result.executionId && !result.task?.executionId
      && !['possibly_sent', 'sent', 'accepted', 'unknown'].includes(result.stage);
    const entry = { providerId, code: result.code || '', stage: result.ok ? 'accepted' : safe ? 'not_sent' : 'unknown' };
    attempts.push(entry);
    await record({ providerId, attempts: [...attempts], stage: entry.stage });
    if (result.ok || !safe) return { ...result, attempts };
  }
  if (policy.desktopHandoff && PROFILES[profile].handoff && (!current || current(policy))) {
    await record({ providerId: 'manual', attempts: [...attempts], stage: 'desktop_handoff' });
    return { ...await handoff(), attempts };
  }
  return { ok: false, code: 'AGENT_ROUTE_BLOCKED', message: '已授权的后台执行器暂不可用。请在 Agent 接入与调度中心恢复授权或启用桌面手工交接。', attempts };
}
module.exports = { SCHEMA, PROFILES, GLOBAL_CAPABILITIES, PROVIDER_MODES, globalDefaults, normalizeGlobal, createAgentControlStore, resolvePolicy, providersFor, dispatchAgent, legacyPolicy, safeToRetry };
