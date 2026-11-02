'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProjectReportStore } = require('../electron/project-report-state.cjs');
const { createProjectReportService } = require('../electron/project-report-service.cjs');

const NOW = '2026-11-02T08:00:00.000Z';
function project(revision = 1) { return { id: 'project-demo', revision, name: '虚构项目', type: '研究项目', status: 'active',
  objective: '完成一次可复核实验', description: '', studentIds: ['student-a'], studentEvidence: [] }; }
function registry() { return { projectId: 'project-demo', revision: 2, updatedAt: NOW, materials: [{ materialId: 'material-1', version: 1,
  recordRevision: 1, sha256: 'a'.repeat(64), size: 200, location: { kind: 'workspace', rootId: 'workspace', relativePath: '过程文档/实验记录.md' },
  availability: 'available', adoption: { state: 'accepted' }, processing: { state: 'completed', processedVersion: 1 }, links: { knowledge: [] } }],
  knowledge: [], evidenceBindings: [] }; }

test('opening an empty M1 report is read-only and explicit refresh is idempotent', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-report-service-'));
  const store = createProjectReportStore({ dbPath: path.join(root, 'project-report-state.sqlite3'), now: () => Date.parse(NOW) });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  let projectReads = 0, registryReads = 0;
  const service = createProjectReportService({ store, now: () => Date.parse(NOW),
    loadProject: async () => { projectReads += 1; return structuredClone(project()); },
    loadRegistry: async () => { registryReads += 1; return structuredClone(registry()); },
    authorizationVersion: (value) => `project:${value.revision}` });
  const reader = { role: 'admin', readerId: 'fixture-admin', allowedStudentIds: ['student-a'] };
  const generation = store.state().generation;
  const empty = await service.get(reader, 'project-demo', NOW);
  assert.equal(empty.status, 'empty');
  assert.equal(store.state().generation, generation);
  assert.equal(registryReads, 0, 'opening a report must not read the material registry');
  const first = await service.refresh({ projectId: 'project-demo', actorRole: 'admin', actorId: 'fixture-admin' }, reader, 'project-demo', NOW);
  const afterFirst = store.state().generation;
  const second = await service.refresh({ projectId: 'project-demo', actorRole: 'admin', actorId: 'fixture-admin' }, reader, 'project-demo', NOW);
  assert.equal(first.versionId, second.versionId);
  assert.equal(store.state().generation, afterFirst);
  assert.equal(store.listProjectReportVersions('project-demo').length, 1);
  assert.ok(projectReads >= 5);
});

test('authorization changes stop old content immediately without regenerating it', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-report-auth-'));
  const store = createProjectReportStore({ dbPath: path.join(root, 'project-report-state.sqlite3'), now: () => Date.parse(NOW) });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  let revision = 1;
  const service = createProjectReportService({ store, now: () => Date.parse(NOW),
    loadProject: async () => structuredClone(project(revision)), loadRegistry: async () => structuredClone(registry()),
    authorizationVersion: (value) => `project:${value.revision}` });
  const reader = { role: 'admin', readerId: 'fixture-admin', allowedStudentIds: ['student-a'] };
  await service.refresh({ projectId: 'project-demo', actorRole: 'admin', actorId: 'fixture-admin' }, reader, 'project-demo', NOW);
  revision = 2;
  const hidden = await service.get(reader, 'project-demo', NOW);
  assert.equal(hidden.status, 'authorization_changed');
  assert.equal(hidden.claims.length, 0);
});

