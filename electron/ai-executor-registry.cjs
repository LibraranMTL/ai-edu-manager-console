'use strict';
const fs = require('node:fs');
const manifests = require('./executor-adapter-manifests.cjs');
const PROFILES = manifests.PROFILE_SPECS;
const STRUCTURED_PROFILES = manifests.STRUCTURED_PROFILE_IDS;
const BUILTIN_STRUCTURED_EXECUTORS = manifests.BUILTIN_STRUCTURED_IDS;
function customToolsFrom(file) {
  try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); if (!Array.isArray(value.items)) throw Error('自定义工具配置无效'); return value.items; }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}
function executorRegistry(customTools = []) {
  return [...manifests.builtinExecutorManifests(), ...customTools.map(manifests.customExecutorManifest)];
}
function supportsProfile(id, profile, registry = executorRegistry()) {
  return Boolean(registry.find(item => item.id === id)?.automaticProfiles.includes(profile));
}
function routeProviders(global, profile, registry) {
  if (!global?.enabled) return [];
  const enabled = registry.filter(item => {
    const mode = global.providerModes?.[item.id] || (global.disabledProviders?.includes(item.id) ? 'disabled' : item.automaticProfiles.length ? 'automatic_preferred' : 'manual_only');
    const selectedProfiles = Array.isArray(global.providerProfiles?.[item.id]) ? global.providerProfiles[item.id] : item.automaticProfiles;
    return mode === 'automatic_preferred' && selectedProfiles.includes(profile) && supportsProfile(item.id, profile, registry);
  });
  const order = [...new Set([...(global.order || []), ...enabled.map(item => item.id)])];
  const agents = order.filter(id => id !== 'llm-api' && enabled.some(item => item.id === id));
  if (enabled.some(item => item.id === 'llm-api')) agents.push('llm-api');
  return agents;
}
module.exports = { PROFILES, STRUCTURED_PROFILES, BUILTIN_STRUCTURED_EXECUTORS, executorRegistry, supportsProfile, routeProviders, customToolsFrom };
