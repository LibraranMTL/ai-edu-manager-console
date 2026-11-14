'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createProjectWorkspaceChangeScheduler } = require('../electron/project-workspace-change-scheduler.cjs');

function activeProject() {
  return { id: 'project-1', workspacePath: 'D:/workspace', status: 'active',
    materialMigrationState: 'complete', materialAutomation: { enabled: true,
      processingPaused: false, onWorkspaceChange: true } };
}

test('event handling only marks the source and enqueues heavy work', async () => {
  let queuedJob = null;
  let resolveCalls = 0;
  const dirty = [];
  const scheduler = createProjectWorkspaceChangeScheduler({
    getProject: () => activeProject(),
    markSourceDirty: (...args) => dirty.push(args),
    enqueue: (_projectId, job) => { queuedJob = job; return Promise.resolve({ queued: true }); },
    resolveChangedFiles: async () => { resolveCalls += 1; return { files: [{ relativePath: '收件箱/new.md' }], needsFullScan: false }; },
    scanChangedFiles: async () => ({ ok: true }),
    scanFullWorkspace: async () => ({ ok: true }),
  });

  const result = await scheduler.handle({ projectId: 'project-1', relativePaths: ['收件箱/new.md'] });
  assert.deepEqual(result, { queued: true });
  assert.equal(resolveCalls, 0);
  assert.equal(typeof queuedJob, 'function');
  assert.deepEqual(dirty, [['project', 'project-1', 'workspace_change_observed']]);
});

test('queued work uses targeted scanning for concrete file paths', async () => {
  let queuedJob = null;
  const targeted = [];
  const scheduler = createProjectWorkspaceChangeScheduler({
    getProject: () => activeProject(),
    markSourceDirty: () => {},
    enqueue: (_projectId, job) => { queuedJob = job; return Promise.resolve({ queued: true }); },
    resolveChangedFiles: async () => ({ files: [{ relativePath: '收件箱/new.md' }], needsFullScan: false }),
    scanChangedFiles: async (project, files) => { targeted.push({ project, files }); return { ok: true, mode: 'targeted' }; },
    scanFullWorkspace: async () => { throw new Error('full scan must not run'); },
  });
  await scheduler.handle({ projectId: 'project-1', relativePaths: ['收件箱/new.md'] });
  const result = await queuedJob();
  assert.equal(result.mode, 'targeted');
  assert.equal(targeted.length, 1);
  assert.equal(targeted[0].files.length, 1);
});

test('unknown, missing or directory events fall back to the resource-gated scan', async () => {
  let queuedJob = null;
  let fullScans = 0;
  const scheduler = createProjectWorkspaceChangeScheduler({
    getProject: () => activeProject(),
    markSourceDirty: () => {},
    enqueue: (_projectId, job) => { queuedJob = job; return Promise.resolve({ queued: true }); },
    resolveChangedFiles: async () => ({ files: [], needsFullScan: true }),
    scanChangedFiles: async () => { throw new Error('targeted scan must not run'); },
    scanFullWorkspace: async () => { fullScans += 1; return { ok: true, mode: 'full' }; },
  });
  await scheduler.handle({ projectId: 'project-1', relativePaths: [], unknownPath: true });
  const result = await queuedJob();
  assert.equal(result.mode, 'full');
  assert.equal(fullScans, 1);
});

test('disabled automation drops change notifications without queuing work', async () => {
  let queued = 0;
  const scheduler = createProjectWorkspaceChangeScheduler({
    getProject: () => ({ ...activeProject(), materialAutomation: { enabled: false,
      processingPaused: false, onWorkspaceChange: true } }),
    markSourceDirty: () => {},
    enqueue: () => { queued += 1; },
    resolveChangedFiles: async () => ({ files: [], needsFullScan: false }),
    scanChangedFiles: async () => {},
    scanFullWorkspace: async () => {},
  });
  const result = await scheduler.handle({ projectId: 'project-1', relativePaths: ['a.md'] });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'automation_disabled');
  assert.equal(queued, 0);
});

