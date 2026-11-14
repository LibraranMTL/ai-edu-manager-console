'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createProjectWorkspaceChangeMonitor } = require('../electron/project-workspace-change-monitor.cjs');

function project(root, overrides = {}) {
  return {
    id: 'project-1',
    status: 'active',
    workspacePath: root,
    materialMigrationState: 'complete',
    materialAutomation: {
      enabled: true,
      processingPaused: false,
      onWorkspaceChange: true,
    },
    ...overrides,
  };
}

test('workspace changes are debounced and only emit a lightweight dirty batch', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-watch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const watchers = [];
  const batches = [];
  const monitor = createProjectWorkspaceChangeMonitor({
    debounceMs: 15,
    watch: (_root, options, listener) => {
      const watcher = { options, listener, closeCount: 0, handlers: {},
        close() { this.closeCount += 1; }, on(name, handler) { this.handlers[name] = handler; } };
      watchers.push(watcher);
      return watcher;
    },
    onDirty: async batch => { batches.push(batch); },
  });
  t.after(() => monitor.close());

  monitor.reconcile([project(root)]);
  assert.equal(watchers.length, 1);
  assert.equal(watchers[0].options.persistent, false);
  for (let index = 0; index < 100; index += 1) {
    watchers[0].listener('change', '收件箱/new.md');
  }
  watchers[0].listener('rename', '收件箱/other.md');
  await new Promise(resolve => setTimeout(resolve, 40));

  assert.equal(batches.length, 1);
  assert.equal(batches[0].projectId, 'project-1');
  assert.deepEqual(batches[0].relativePaths, ['收件箱/new.md', '收件箱/other.md']);
  assert.deepEqual(batches[0].eventTypes, ['change', 'rename']);
  assert.equal(monitor.status().pendingProjects, 0);
});

test('disabled, paused and removed projects do not retain watchers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-watch-'));
  const watchers = [];
  const monitor = createProjectWorkspaceChangeMonitor({
    watch: (_root, _options, listener) => {
      const watcher = { listener, closeCount: 0, close() { this.closeCount += 1; }, on() {} };
      watchers.push(watcher);
      return watcher;
    },
    onDirty: async () => {},
  });
  try {
    monitor.reconcile([project(root)]);
    assert.equal(monitor.status().watcherCount, 1);
    monitor.reconcile([project(root, { materialAutomation: { enabled: true,
      processingPaused: true, onWorkspaceChange: true } })]);
    assert.equal(monitor.status().watcherCount, 0);
    assert.equal(watchers[0].closeCount, 1);
    monitor.reconcile([project(root, { materialAutomation: { enabled: false,
      processingPaused: false, onWorkspaceChange: true } })]);
    assert.equal(monitor.status().watcherCount, 0);
  } finally {
    monitor.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('watch errors close only the affected project and are reported', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-watch-'));
  const errors = [];
  let watcher;
  const monitor = createProjectWorkspaceChangeMonitor({
    watch: (_root, _options, listener) => {
      watcher = { listener, closeCount: 0, handlers: {}, close() { this.closeCount += 1; },
        on(name, handler) { this.handlers[name] = handler; } };
      return watcher;
    },
    onDirty: async () => {},
    onError: (error, context) => errors.push({ error, context }),
  });
  try {
    monitor.reconcile([project(root)]);
    watcher.handlers.error(new Error('watch failed'));
    assert.equal(monitor.status().watcherCount, 0);
    assert.equal(watcher.closeCount, 1);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].context.projectId, 'project-1');
  } finally {
    monitor.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

