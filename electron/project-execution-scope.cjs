'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CONTRACT_VERSION = 'edu-manager.agent-capabilities.v2';

function normalizedStudentIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'en'));
}

function canonicalExistingDirectory(value) {
  const absolute = path.resolve(String(value || ''));
  const resolved = fs.realpathSync.native(absolute);
  if (!fs.statSync(resolved).isDirectory()) throw Object.assign(new Error('项目知识空间不是有效目录。'), { code: 'PROJECT_SCOPE_INVALID' });
  return resolved;
}

function stableScopePayload({ projectId, studentIds, knowledgeRootPath, globalPolicyRevision, taskProfile }) {
  return {
    contractVersion: CONTRACT_VERSION,
    scopeType: 'project',
    projectId: String(projectId || ''),
    studentIds: normalizedStudentIds(studentIds),
    knowledgeRootPath: String(knowledgeRootPath || ''),
    readRoots: [String(knowledgeRootPath || '')],
    writeRoots: [String(knowledgeRootPath || '')],
    globalPolicyRevision: Number(globalPolicyRevision || 0),
    taskProfile: String(taskProfile || ''),
  };
}

function scopeFingerprint(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(stableScopePayload(payload))).digest('hex');
}

function buildProjectExecutionScope({ project, globalPolicy, students = [], taskProfile, now = () => new Date().toISOString() }) {
  if (!globalPolicy?.enabled || Number(globalPolicy.version || 0) < 1) {
    throw Object.assign(new Error('项目尚未迁移到全局授权。'), { code: 'PROJECT_SCOPE_LEGACY' });
  }
  if (!project?.id || ['archived', 'sealed'].includes(String(project.status || ''))) {
    throw Object.assign(new Error('项目已归档或不可执行。'), { code: 'PROJECT_SCOPE_INVALID' });
  }
  const studentIds = normalizedStudentIds(project.studentIds);
  if (!studentIds.length) throw Object.assign(new Error('项目没有有效成员。'), { code: 'PROJECT_SCOPE_INVALID' });
  const active = new Map((Array.isArray(students) ? students : []).map(student => [String(student.id), student]));
  if (studentIds.some(id => !active.has(id) || active.get(id).archived || active.get(id).status === 'archived')) {
    throw Object.assign(new Error('项目成员已停用或不存在。'), { code: 'PROJECT_SCOPE_INVALID' });
  }
  const knowledgeRootPath = canonicalExistingDirectory(project.knowledgeRootPath);
  const payload = stableScopePayload({
    projectId: project.id,
    studentIds,
    knowledgeRootPath,
    globalPolicyRevision: globalPolicy.version,
    taskProfile,
  });
  return {
    ...payload,
    memberFingerprint: crypto.createHash('sha256').update(JSON.stringify(studentIds)).digest('hex'),
    scopeFingerprint: scopeFingerprint(payload),
    createdAt: now(),
  };
}

function sameProjectExecutionScope(frozen, current) {
  return Boolean(frozen && current
    && frozen.contractVersion === CONTRACT_VERSION
    && frozen.scopeFingerprint === current.scopeFingerprint
    && frozen.projectId === current.projectId);
}

function pathWithinProjectScope(candidate, scope) {
  if (!scope || scope.contractVersion !== CONTRACT_VERSION) return false;
  let target;
  try {
    const absolute = path.resolve(String(candidate || ''));
    if (fs.existsSync(absolute)) target = fs.realpathSync.native(absolute);
    else {
      let parent = path.dirname(absolute);
      while (parent !== path.dirname(parent) && !fs.existsSync(parent)) parent = path.dirname(parent);
      const realParent = fs.realpathSync.native(parent);
      target = path.join(realParent, path.relative(parent, absolute));
    }
  } catch { return false; }
  let root;
  try { root = fs.realpathSync.native(path.resolve(String(scope.knowledgeRootPath || ''))); } catch { return false; }
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function projectScopePermissions(scope) {
  if (!scope || scope.contractVersion !== CONTRACT_VERSION || !pathWithinProjectScope(scope.knowledgeRootPath, scope)) {
    throw Object.assign(new Error('项目执行范围无效。'), { code: 'PROJECT_SCOPE_INVALID' });
  }
  return { read: [scope.knowledgeRootPath], write: [scope.knowledgeRootPath], operations: ['read', 'write_project_knowledge'] };
}

module.exports = {
  CONTRACT_VERSION,
  normalizedStudentIds,
  buildProjectExecutionScope,
  sameProjectExecutionScope,
  pathWithinProjectScope,
  projectScopePermissions,
  scopeFingerprint,
};
