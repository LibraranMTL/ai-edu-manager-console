'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('project list projection excludes unbounded detail fields and remains below IPC limit', () => {
  const { projectListProjection } = require('../electron/project-list-projection.cjs');
  const projects = Array.from({ length: 14 }, (_, index) => ({
    id: `project-${index + 1}`,
    name: `项目 ${index + 1}`,
    type: index % 2 ? 'research' : 'portfolio',
    status: 'active',
    studentIds: [`student-${index % 4}`],
    studentNames: [`学生 ${index % 4}`],
    workspaceTemplateId: index % 2 ? 'research' : 'portfolio',
    workspaceTemplateName: index % 2 ? '研究项目' : '作品集项目',
    workspaceMode: 'managed',
    description: 'x'.repeat(index === 0 ? 1_000_000 : 80_000),
    objective: '不得进入列表投影',
    projectRootPath: `D:/private/project-${index + 1}`,
    assetIds: Array.from({ length: 226 }, (_, assetIndex) => `asset-${index}-${assetIndex}`),
    studentEvidence: Array.from({ length: 300 }, () => ({ observation: '大字段证据' })),
    workspaceScanSnapshot: { secret: { size: 100 } },
    digestState: {
      status: 'pending',
      pendingCount: 7,
      rawFileCount: 12,
      pendingFiles: Array.from({ length: 500 }, () => ({ path: 'D:/private/source.pdf' })),
    },
    dashboard: {
      rawMaterialCount: 12,
      pendingKnowledgeCount: 3,
      contributionReady: true,
      riskCount: 1,
      riskReasons: ['待补资料'],
    },
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
    stagingSummary: { total: 10, accepted: 4, pending: 6 },
  }));

  const items = projects.map((project) => projectListProjection(project, project.stagingSummary));
  const body = JSON.stringify({ ok: true, items, total: items.length });

  assert.equal(items.length, 14);
  assert.ok(Buffer.byteLength(body, 'utf8') < 2 * 1024 * 1024);
  assert.deepEqual(items[0].studentIds, ['student-0']);
  assert.equal(items[0].dashboard.pendingStagingCount, 6);
  assert.equal(items[0].dashboard.acceptedStagingCount, 4);
  assert.equal(items[0].digestState.pendingCount, 7);
  for (const forbidden of [
    'description', 'objective', 'projectRootPath', 'workspacePath', 'knowledgeRootPath',
    'assetIds', 'studentEvidence', 'workspaceScanSnapshot', 'stagingItems', 'pendingFiles', 'riskReasons',
  ]) assert.equal(body.includes(`"${forbidden}"`), false, `${forbidden} leaked into project list`);
  assert.equal(body.includes('D:/private/'), false);
  assert.equal(projects[0].description.length, 1_000_000, 'projection must not mutate detail data');
});

test('bounded project IPC response reports measured size without returning oversized content', () => {
  const { PROJECT_IPC_LIMIT_BYTES, boundedProjectIpcJson } = require('../electron/project-ipc-response.cjs');
  const raw = boundedProjectIpcJson(
    { ok: true, items: [{ id: 'large', payload: 'x'.repeat(PROJECT_IPC_LIMIT_BYTES) }] },
    { logger: { warn() {} } },
  );
  const result = JSON.parse(raw);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'project_ipc_payload_too_large');
  assert.equal(result.limitBytes, PROJECT_IPC_LIMIT_BYTES);
  assert.ok(result.responseBytes > PROJECT_IPC_LIMIT_BYTES);
  assert.equal(raw.includes('xxxx'), false);
});

test('renderer exposes a distinct project-list load error instead of presenting an empty list', () => {
  const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
  assert.match(ui, /const \[projectListError, setProjectListError\]/);
  assert.match(ui, /result\.code === 'project_ipc_payload_too_large'/);
  assert.match(ui, /项目列表载荷过大/);
  assert.match(ui, /projectListError \? '未加载' : `\$\{projects\.length\} 个`/);
  assert.match(ui, /role="alert"[\s\S]{0,300}projectListError\.message/);
});
