'use strict';

const fs = require('node:fs');
const path = require('node:path');

function automationEnabled(project) {
  const automation = project?.materialAutomation || {};
  return Boolean(project?.id && project?.workspacePath
    && project.status !== 'sealed'
    && project.materialMigrationState !== 'running'
    && automation.enabled
    && !automation.processingPaused
    && automation.onWorkspaceChange !== false);
}

function normalizedRelativePath(value) {
  const normalized = String(value || '').replaceAll('\\', '/').replace(/^\/+/, '').trim();
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) return '';
  return normalized;
}

function createProjectWorkspaceChangeMonitor({
  watch = fs.watch,
  existsSync = fs.existsSync,
  resolvePath = path.resolve,
  debounceMs = 2_000,
  onDirty,
  onError = () => {},
  platform = process.platform,
} = {}) {
  if (typeof onDirty !== 'function') throw new TypeError('onDirty is required');
  const watchers = new Map();
  const pending = new Map();
  let closed = false;

  function report(error, context) {
    try { onError(error, context); } catch { /* diagnostics must not crash the watcher */ }
  }

  function clearPending(projectId) {
    const entry = pending.get(projectId);
    if (entry?.timer) clearTimeout(entry.timer);
    pending.delete(projectId);
  }

  function closeWatcher(projectId) {
    const entry = watchers.get(projectId);
    if (entry) {
      try { entry.watcher.close(); } catch { /* stale Windows watchers can already be closed */ }
      watchers.delete(projectId);
    }
    clearPending(projectId);
  }

  function schedule(target, eventType, filename) {
    if (closed || !watchers.has(target.projectId)) return;
    let entry = pending.get(target.projectId);
    if (!entry) {
      entry = { projectId: target.projectId, root: target.root, paths: new Set(),
        eventTypes: new Set(), unknownPath: false, timer: null };
      pending.set(target.projectId, entry);
    }
    const relativePath = normalizedRelativePath(filename);
    if (relativePath) entry.paths.add(relativePath);
    else entry.unknownPath = true;
    if (eventType) entry.eventTypes.add(String(eventType));
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      pending.delete(target.projectId);
      const batch = {
        projectId: target.projectId,
        workspacePath: target.root,
        relativePaths: [...entry.paths].sort(),
        eventTypes: [...entry.eventTypes].sort(),
        unknownPath: entry.unknownPath,
        observedAt: new Date().toISOString(),
      };
      Promise.resolve(onDirty(batch)).catch(error => report(error, {
        projectId: target.projectId,
        workspacePath: target.root,
        phase: 'dirty_callback',
      }));
    }, Math.max(10, Number(debounceMs) || 0));
    entry.timer.unref?.();
  }

  function reconcile(projects = []) {
    if (closed) return { watcherCount: 0, pendingProjects: 0 };
    const desired = new Map();
    for (const project of Array.isArray(projects) ? projects : []) {
      if (!automationEnabled(project)) continue;
      const root = resolvePath(String(project.workspacePath || ''));
      if (!root || !existsSync(root)) continue;
      desired.set(String(project.id), { projectId: String(project.id), root });
    }
    for (const [projectId, current] of watchers.entries()) {
      const target = desired.get(projectId);
      if (!target || target.root.toLocaleLowerCase() !== current.root.toLocaleLowerCase()) closeWatcher(projectId);
    }
    for (const [projectId, target] of desired.entries()) {
      if (watchers.has(projectId)) continue;
      try {
        const watcher = watch(target.root, { recursive: platform === 'win32', persistent: false },
          (eventType, filename) => schedule(target, eventType, filename));
        watcher.on?.('error', error => {
          closeWatcher(projectId);
          report(error, { projectId, workspacePath: target.root, phase: 'watch' });
        });
        watchers.set(projectId, { ...target, watcher });
      } catch (error) {
        report(error, { projectId, workspacePath: target.root, phase: 'watch_start' });
      }
    }
    return status();
  }

  function status() {
    return { watcherCount: watchers.size, pendingProjects: pending.size, closed };
  }

  function close() {
    if (closed) return;
    closed = true;
    for (const projectId of [...watchers.keys()]) closeWatcher(projectId);
    for (const projectId of [...pending.keys()]) clearPending(projectId);
  }

  return { reconcile, status, close };
}

module.exports = { automationEnabled, normalizedRelativePath, createProjectWorkspaceChangeMonitor };

