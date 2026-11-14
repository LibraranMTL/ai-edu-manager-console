'use strict';

const { automationEnabled } = require('./project-workspace-change-monitor.cjs');

function createProjectWorkspaceChangeScheduler({
  getProject,
  markSourceDirty,
  enqueue,
  resolveChangedFiles,
  scanChangedFiles,
  scanFullWorkspace,
} = {}) {
  for (const [name, dependency] of Object.entries({ getProject, markSourceDirty, enqueue,
    resolveChangedFiles, scanChangedFiles, scanFullWorkspace })) {
    if (typeof dependency !== 'function') throw new TypeError(`${name} is required`);
  }

  async function handle(batch = {}) {
    const projectId = String(batch.projectId || '');
    const project = getProject(projectId);
    if (!automationEnabled(project)) return { ok: true, skipped: true, reason: 'automation_disabled' };
    markSourceDirty('project', projectId, 'workspace_change_observed');
    return enqueue(projectId, async () => {
      const latest = getProject(projectId);
      if (!automationEnabled(latest)) return { ok: true, skipped: true, reason: 'automation_disabled' };
      if (batch.unknownPath) return scanFullWorkspace(latest, batch);
      const changed = await resolveChangedFiles(latest.workspacePath, batch.relativePaths || []);
      if (changed.needsFullScan) return scanFullWorkspace(latest, { ...batch, changed });
      if (!changed.files.length) return { ok: true, skipped: true, reason: 'no_material_files' };
      return scanChangedFiles(latest, changed.files, batch);
    });
  }

  return { handle };
}

module.exports = { createProjectWorkspaceChangeScheduler };

