'use strict';

const crypto = require('node:crypto');

const SCHEMA = 'edu-manager.project-history-backfill.v1';
const POLICY_VERSION = 'project-history-backfill-v1';

function eligibleProject(project) {
  const automation = project?.materialAutomation || {};
  return Boolean(project?.id && automation.enabled && !automation.processingPaused
    && !['sealed', 'archived'].includes(String(project.status || '')));
}

function orderedProjectIds(projects = []) {
  return projects.filter(eligibleProject).map((project) => String(project.id)).sort((a, b) => a.localeCompare(b));
}

function nextBackfillProject(projects, checkpoint = {}) {
  const ids = orderedProjectIds(projects);
  if (!ids.length) return null;
  const current = String(checkpoint.projectId || '');
  if (current && ids.includes(current) && Number(checkpoint.remaining || 0) > 0) return current;
  const after = String(checkpoint.completedProjectId || current || '');
  return ids.find((id) => id > after) || ids[0];
}

function stableBatchKey(projectId, checkpoint = {}) {
  const generation = Math.max(1, Number(checkpoint.generation || 1));
  const batch = Math.max(0, Number(checkpoint.batch || 0)) + 1;
  const digest = crypto.createHash('sha256').update(JSON.stringify({
    projectId: String(projectId), generation, batch, policyVersion: POLICY_VERSION,
  })).digest('hex').slice(0, 32);
  return `history-backfill:${projectId}:${digest}`;
}

function beginProjectCheckpoint(projectId, previous = {}, now = new Date().toISOString()) {
  const same = String(previous.projectId || '') === String(projectId) && !previous.completedAt;
  return {
    schema: SCHEMA,
    policyVersion: POLICY_VERSION,
    generation: same ? Math.max(1, Number(previous.generation || 1))
      : Math.max(1, Number(previous.generation || 0) + 1),
    projectId: String(projectId),
    completedProjectId: String(previous.completedProjectId || ''),
    batch: same ? Math.max(0, Number(previous.batch || 0)) : 0,
    processed: same ? Math.max(0, Number(previous.processed || 0)) : 0,
    remaining: same ? Math.max(0, Number(previous.remaining || 0)) : 0,
    startedAt: same ? String(previous.startedAt || now) : now,
    updatedAt: now,
    completedAt: '',
  };
}

function completeBatch(checkpoint, result = {}, now = new Date().toISOString()) {
  const remaining = Math.max(0, Number(result.remaining || 0));
  const completed = remaining === 0;
  return {
    ...checkpoint,
    batch: checkpoint.batch + 1,
    processed: checkpoint.processed + Math.max(0, Number(result.processed || result.adopted || 0)),
    remaining,
    completedProjectId: completed ? checkpoint.projectId : checkpoint.completedProjectId,
    updatedAt: now,
    completedAt: completed ? now : '',
  };
}

module.exports = {
  SCHEMA,
  POLICY_VERSION,
  eligibleProject,
  orderedProjectIds,
  nextBackfillProject,
  stableBatchKey,
  beginProjectCheckpoint,
  completeBatch,
};
