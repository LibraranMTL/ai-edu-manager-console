'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { inspectDirectory, sha256 } = require('./skill-package-inspector.cjs');

const INSTALL_PROVIDERS = new Set(['codex', 'workbuddy']);

function isWithin(root, candidate) {
  const a = path.resolve(root), b = path.resolve(candidate);
  return b === a || b.startsWith(a + path.sep);
}

function targetRoot(providerId, options = {}) {
  const provider = String(providerId || '').toLowerCase();
  if (!INSTALL_PROVIDERS.has(provider)) throw Error('该 Agent 不支持本地 Skill 安装');
  const home = path.resolve(options.homeDir || os.homedir());
  if (provider === 'codex') return path.join(path.resolve(options.codexHome || process.env.CODEX_HOME || path.join(home, '.codex')), 'skills');
  return path.join(home, '.codebuddy', 'skills');
}

function safeSkillDirectoryName(value) {
  const name = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(name)) throw Error('Skill 安装目录名无效');
  return name;
}

function fingerprintIfPresent(target) {
  if (!fs.existsSync(target)) return '';
  try { return inspectDirectory(target).treeSha256; } catch { return 'unmanaged-or-invalid'; }
}

function planHash(plan) {
  const stable = { schema: plan.schema, artifactId: plan.artifactId, versionId: plan.versionId, providerId: plan.providerId,
    scope: plan.scope, targetPath: plan.targetPath, objectTreeSha256: plan.objectTreeSha256, beforeFingerprint: plan.beforeFingerprint,
    adapterVersion: plan.adapterVersion, expiresAt: plan.expiresAt };
  return sha256(Buffer.from(JSON.stringify(stable), 'utf8'));
}

function previewInstall({ artifact, version, existingInstallation, libraryRoot, providerId, scope = 'user', options = {} }) {
  if (!artifact || !version || artifact.currentVersionId !== version.versionId) throw Error('Skill 版本不存在或已变化');
  if (artifact.kind !== 'skill') throw Error('本轮不支持插件安装');
  if (scope !== 'user') throw Error('首版只支持用户级 Skill 安装');
  const root = targetRoot(providerId, options);
  const targetPath = path.join(root, safeSkillDirectoryName(artifact.identity.name));
  if (!isWithin(root, targetPath)) throw Error('安装目标越出受管 Skills 根');
  const payloadPath = path.join(libraryRoot, ...String(version.archiveObjectPath || '').split('/'));
  if (!isWithin(libraryRoot, payloadPath) || !fs.existsSync(payloadPath)) throw Error('存档对象不存在或路径无效');
  const archived = inspectDirectory(payloadPath);
  if (archived.treeSha256 !== version.treeSha256) throw Error('存档对象哈希不一致，安装已停止');
  const beforeFingerprint = fingerprintIfPresent(targetPath);
  if (beforeFingerprint && (!existingInstallation || existingInstallation.installedFingerprint !== beforeFingerprint)) {
    throw Error('目标目录存在未受教育管家管理的内容或已被修改，拒绝覆盖');
  }
  const now = Date.now();
  const plan = {
    schema: 'edu-manager.skill-install-plan.v1', planId: crypto.randomUUID(), artifactId: artifact.artifactId,
    versionId: version.versionId, providerId, scope, targetPath, targetRoot: root, payloadPath,
    objectTreeSha256: version.treeSha256, beforeFingerprint, adapterVersion: 1,
    changes: { add: version.fileCount, replace: beforeFingerprint ? version.fileCount : 0, preserve: 0 },
    riskFindings: version.riskFindings || [], requiresRestart: true, rollbackAvailable: Boolean(existingInstallation),
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 10 * 60 * 1000).toISOString(),
  };
  plan.planHash = planHash(plan);
  return plan;
}

function copyPayload(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(target, entry.name);
    if (entry.isSymbolicLink()) throw Error('安装载荷包含符号链接');
    if (entry.isDirectory()) copyPayload(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    else throw Error('安装载荷包含特殊文件');
  }
}

function executeInstall(plan, { libraryRoot, backupRoot, currentPlanHash, options = {} } = {}) {
  if (!plan || plan.schema !== 'edu-manager.skill-install-plan.v1' || plan.planHash !== currentPlanHash || plan.planHash !== planHash(plan)) throw Error('安装计划无效或已被修改');
  if (Date.parse(plan.expiresAt) <= Date.now()) throw Error('安装预览已过期，请重新预览');
  const root = targetRoot(plan.providerId, options);
  const expectedTarget = path.join(root, safeSkillDirectoryName(path.basename(plan.targetPath)));
  if (path.resolve(expectedTarget) !== path.resolve(plan.targetPath) || !isWithin(root, plan.targetPath)) throw Error('Agent 安装目标已变化，请重新预览');
  const payload = path.resolve(plan.payloadPath);
  if (!isWithin(libraryRoot, payload) || inspectDirectory(payload).treeSha256 !== plan.objectTreeSha256) throw Error('存档对象哈希已变化');
  if (fingerprintIfPresent(plan.targetPath) !== plan.beforeFingerprint) throw Error('安装目标在预览后发生变化，请重新预览');

  fs.mkdirSync(root, { recursive: true });
  const installationId = crypto.randomUUID();
  const temp = path.join(root, `.edu-skill-staging-${installationId}`);
  const localRollback = path.join(root, `.edu-skill-rollback-${installationId}`);
  const durableBackup = path.join(backupRoot, plan.providerId, installationId, 'payload');
  let oldMoved = false, installed = false;
  try {
    copyPayload(payload, temp);
    if (inspectDirectory(temp).treeSha256 !== plan.objectTreeSha256) throw Error('安装临时副本哈希校验失败');
    if (plan.beforeFingerprint) {
      fs.mkdirSync(path.dirname(durableBackup), { recursive: true });
      copyPayload(plan.targetPath, durableBackup);
      if (inspectDirectory(durableBackup).treeSha256 !== plan.beforeFingerprint) throw Error('原版本备份校验失败');
      fs.renameSync(plan.targetPath, localRollback); oldMoved = true;
    }
    fs.renameSync(temp, plan.targetPath); installed = true;
    const installedFingerprint = inspectDirectory(plan.targetPath).treeSha256;
    if (installedFingerprint !== plan.objectTreeSha256) throw Error('安装后目标哈希校验失败');
    if (oldMoved && fs.existsSync(localRollback)) fs.rmSync(localRollback, { recursive: true, force: true });
    return {
      schema: 'edu-manager.skill-installation.v1', installationId, artifactId: plan.artifactId, versionId: plan.versionId,
      providerId: plan.providerId, scope: plan.scope, targetPath: plan.targetPath, adapterVersion: 1,
      planHash: plan.planHash, beforeFingerprint: plan.beforeFingerprint, installedFingerprint,
      state: 'restart_required', installedAt: new Date().toISOString(), verifiedAt: '',
      backupReceiptId: plan.beforeFingerprint ? installationId : '', backupPath: plan.beforeFingerprint ? durableBackup : '',
    };
  } catch (error) {
    try {
      if (installed && fs.existsSync(plan.targetPath) && fingerprintIfPresent(plan.targetPath) === plan.objectTreeSha256) fs.rmSync(plan.targetPath, { recursive: true, force: true });
      if (oldMoved && fs.existsSync(localRollback) && !fs.existsSync(plan.targetPath)) fs.renameSync(localRollback, plan.targetPath);
    } catch { error.recoveryRequired = true; }
    throw error;
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp, { recursive: true, force: true });
  }
}

function verifyInstallation(record, options = {}) {
  if (!record || !INSTALL_PROVIDERS.has(record.providerId)) throw Error('安装记录无效');
  const root = targetRoot(record.providerId, options);
  if (!isWithin(root, record.targetPath)) throw Error('安装记录目标越出受管根目录');
  const current = fingerprintIfPresent(record.targetPath);
  if (!current) return { state: 'verification_failed', message: '目标 Skill 目录不存在。' };
  if (current !== record.installedFingerprint) return { state: 'verification_failed', message: '目标 Skill 已被其他程序修改。' };
  return {
    state: 'inventory_detected', verifiedAt: new Date().toISOString(),
    message: '目标 Agent 的持久 Skill 根已发现该版本；仍需重启或新会话触发验证，不能仅凭目录存在宣称可用。',
  };
}

function rollbackInstallation(record, { backupRoot, options = {} } = {}) {
  if (!record?.backupPath || !isWithin(backupRoot, record.backupPath) || !fs.existsSync(record.backupPath)) throw Error('没有可用的受管备份');
  if (fingerprintIfPresent(record.targetPath) !== record.installedFingerprint) throw Error('目标 Skill 已被修改，拒绝覆盖回滚');
  const root = targetRoot(record.providerId, options);
  if (!isWithin(root, record.targetPath)) throw Error('回滚目标越出受管根目录');
  const temp = path.join(root, `.edu-skill-rollback-stage-${crypto.randomUUID()}`);
  const replaced = path.join(root, `.edu-skill-replaced-${crypto.randomUUID()}`);
  copyPayload(record.backupPath, temp);
  const restoredFingerprint = inspectDirectory(temp).treeSha256;
  fs.renameSync(record.targetPath, replaced);
  try { fs.renameSync(temp, record.targetPath); }
  catch (error) { fs.renameSync(replaced, record.targetPath); throw error; }
  if (fs.existsSync(replaced)) fs.rmSync(replaced, { recursive: true, force: true });
  return { ...record, state: 'rolled_back', rolledBackAt: new Date().toISOString(), installedFingerprint: restoredFingerprint };
}

function uninstallInstallation(record, options = {}) {
  const root = targetRoot(record.providerId, options);
  if (!isWithin(root, record.targetPath)) throw Error('卸载目标越出受管根目录');
  if (fingerprintIfPresent(record.targetPath) !== record.installedFingerprint) throw Error('目标 Skill 已被修改，拒绝自动卸载');
  const removed = path.join(root, `.edu-skill-uninstalled-${record.installationId}`);
  fs.renameSync(record.targetPath, removed);
  return { ...record, state: 'uninstalled', uninstalledAt: new Date().toISOString(), retainedRecoveryPath: removed };
}

module.exports = {
  INSTALL_PROVIDERS,
  executeInstall,
  fingerprintIfPresent,
  planHash,
  previewInstall,
  rollbackInstallation,
  safeSkillDirectoryName,
  targetRoot,
  uninstallInstallation,
  verifyInstallation,
};
