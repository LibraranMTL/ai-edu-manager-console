'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { inspectDirectory, EXCLUDED_DIRS } = require('./skill-package-inspector.cjs');

const PROVIDERS = new Set(['codex', 'workbuddy', 'qclaw']);

function existingDirectory(value) {
  try { return value && fs.existsSync(value) && fs.statSync(value).isDirectory(); } catch { return false; }
}

function providerRoots(providerId, options = {}) {
  const provider = String(providerId || '').toLowerCase();
  if (!PROVIDERS.has(provider)) throw Error('不支持的 Skill 来源');
  const home = path.resolve(options.homeDir || os.homedir());
  if (provider === 'codex') {
    const codexHome = path.resolve(options.codexHome || process.env.CODEX_HOME || path.join(home, '.codex'));
    return [
      { rootPath: path.join(codexHome, 'skills'), sourceKind: 'user', writable: true },
      { rootPath: path.join(home, '.agents', 'skills'), sourceKind: 'shared', writable: false },
    ];
  }
  if (provider === 'workbuddy') {
    return [
      { rootPath: path.join(home, '.workbuddy', 'skills'), sourceKind: 'desktop_profile', writable: false },
      { rootPath: path.join(home, '.codebuddy', 'skills'), sourceKind: 'official_user', writable: true },
    ];
  }
  return [
    { rootPath: path.join(home, '.qclaw', 'skills'), sourceKind: 'configured_user', writable: false },
    { rootPath: path.join(home, '.qclaw', 'plugin-skills'), sourceKind: 'configured_plugin_projection', writable: false },
  ];
}

function scanRoot(rootInfo, providerId, options = {}) {
  const maxCandidates = Math.max(1, Math.min(2000, Number(options.maxCandidates || 500)));
  const maxDepth = Math.max(1, Math.min(4, Number(options.maxDiscoveryDepth || 2)));
  const root = path.resolve(rootInfo.rootPath);
  if (!existingDirectory(root)) return { ...rootInfo, rootPath: root, status: 'missing', candidates: [], excluded: 0 };
  const realRoot = fs.realpathSync.native(root);
  const candidates = [];
  let visited = 0, excluded = 0;
  function visit(current, depth) {
    if (depth > maxDepth || candidates.length >= maxCandidates) return;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    const hasManifest = entries.some(entry => entry.isFile() && entry.name.toLowerCase() === 'skill.md');
    if (hasManifest) {
      try {
        const inspection = inspectDirectory(current, options);
        candidates.push({
          discoveryId: crypto.randomUUID(), providerId, sourceRoot: root, sourceKind: rootInfo.sourceKind,
          sourcePath: current, relativePath: path.relative(root, current).split(path.sep).join('/') || '.',
          kind: inspection.kind, identity: inspection.identity, treeSha256: inspection.treeSha256,
          manifestSha256: inspection.manifestSha256, fileCount: inspection.fileCount, totalBytes: inspection.totalBytes,
          riskFindings: inspection.riskFindings, inspectionStatus: inspection.inspectionStatus,
        });
      } catch (error) {
        candidates.push({ discoveryId: crypto.randomUUID(), providerId, sourceRoot: root, sourceKind: rootInfo.sourceKind,
          sourcePath: current, relativePath: path.relative(root, current).split(path.sep).join('/') || '.', status: 'unsupported', message: error.message });
      }
      return;
    }
    for (const entry of entries) {
      visited++;
      if (visited > 2000 || candidates.length >= maxCandidates) return;
      if (!entry.isDirectory() || entry.isSymbolicLink() || EXCLUDED_DIRS.has(entry.name.toLowerCase())) { excluded++; continue; }
      const child = path.join(current, entry.name);
      let real;
      try { real = fs.realpathSync.native(child); } catch { excluded++; continue; }
      if (real !== realRoot && !real.startsWith(realRoot + path.sep)) { excluded++; continue; }
      visit(child, depth + 1);
    }
  }
  visit(root, 0);
  return { ...rootInfo, rootPath: root, status: 'available', readOnly: !rootInfo.writable || providerId === 'qclaw', candidates, excluded, visited };
}

function scanProvider(providerId, options = {}) {
  const roots = providerRoots(providerId, options);
  const scanned = roots.map(root => scanRoot(root, providerId, options));
  return {
    providerId,
    scannedAt: new Date().toISOString(),
    readOnly: providerId === 'qclaw',
    installSupport: providerId === 'qclaw' ? 'export_only' : 'skill_only',
    roots: scanned.map(item => ({ rootPath: item.rootPath, sourceKind: item.sourceKind, writable: item.writable, status: item.status, readOnly: item.readOnly, count: item.candidates.length, excluded: item.excluded })),
    candidates: scanned.flatMap(item => item.candidates),
  };
}

function scanAllProviders(options = {}) {
  return ['codex', 'workbuddy', 'qclaw'].map(providerId => scanProvider(providerId, options));
}

function capabilities(providerId, options = {}) {
  const roots = providerRoots(providerId, options);
  const installed = roots.some(root => existingDirectory(path.dirname(root.rootPath)) || existingDirectory(root.rootPath));
  if (providerId === 'qclaw') return {
    providerId, installed, canScan: installed, canExport: installed, canInstallSkill: false, canInstallPlugin: false,
    canUpdate: false, canRollback: false, canUninstall: false, canVerifyInventory: false, requiresRestart: false,
    supportedScopes: [], reason: 'QClaw 本轮仅允许只读扫描与导出存档，不提供写回操作。',
  };
  const writableRoot = roots.find(root => root.writable);
  return {
    providerId, installed, canScan: true, canExport: true, canInstallSkill: Boolean(writableRoot), canInstallPlugin: false,
    canUpdate: Boolean(writableRoot), canRollback: Boolean(writableRoot), canUninstall: Boolean(writableRoot),
    canVerifyInventory: Boolean(writableRoot), requiresRestart: true, supportedScopes: ['user'],
    reason: providerId === 'workbuddy'
      ? '仅写入官方 CodeBuddy 用户级 ~/.codebuddy/skills；.workbuddy/skills 作为桌面来源只读扫描。'
      : '写入解析后的 Codex 用户级 Skills 根；插件缓存始终只读。',
  };
}

module.exports = { PROVIDERS, capabilities, providerRoots, scanAllProviders, scanProvider, scanRoot };
