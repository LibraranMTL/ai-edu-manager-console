'use strict';

const fs = require('node:fs');
const path = require('node:path');

function materialIdsFor(entry = {}) {
  return [entry.materialId, ...(Array.isArray(entry.materialIds) ? entry.materialIds : [])]
    .map(value => String(value || '').trim())
    .filter(Boolean);
}

function summarizeProjectMaterialRegistry(registry = {}) {
  const committed = new Set((registry.commits || []).flatMap(materialIdsFor));
  const acceptedReceipts = new Set((registry.receipts || [])
    .filter(item => ['accepted', 'completed', 'committed', 'succeeded'].includes(String(item?.status || item?.state || '').toLowerCase()))
    .flatMap(materialIdsFor));
  let completed = 0;
  let completedElapsedMs = 0;
  let failed = 0;
  let unknown = 0;
  const items = [];
  for (const material of registry.materials || []) {
    const materialId = String(material?.materialId || '');
    const state = String(material?.processing?.state || '').toLowerCase();
    const provedByCommit = materialId && committed.has(materialId);
    const provedByReceiptAndCommit = provedByCommit && acceptedReceipts.has(materialId);
    const isCompleted = ['completed', 'committed', 'succeeded'].includes(state)
      || provedByCommit
      || provedByReceiptAndCommit;
    const isFailed = ['failed_terminal', 'failed_retryable', 'needs_user_action'].includes(state);
    if (isCompleted) {
      completed += 1;
      const started = Date.parse(material?.createdAt || '');
      const finished = Date.parse(material?.processing?.completedAt || '');
      if (Number.isFinite(started) && Number.isFinite(finished) && finished >= started) completedElapsedMs += finished - started;
    }
    else if (isFailed) failed += 1;
    else if (!['', 'no_work', 'ignored', 'skipped_unsupported'].includes(state)) unknown += 1;
    items.push({ materialId, state, completed: isCompleted, errorCode: String(material?.processing?.error?.code || '') });
  }
  return {
    total: items.length,
    completed,
    completedElapsedMs,
    failed,
    unknown,
    businessCompleted: completed > 0 && failed === 0 && unknown === 0,
    items,
  };
}

function findRegistries(fixtureRoot) {
  const projectData = path.join(path.resolve(fixtureRoot), 'project-data');
  if (!fs.existsSync(projectData)) return [];
  return fs.readdirSync(projectData, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(projectData, entry.name, '.edu-manager', 'project-materials', 'registry.json'))
    .filter(file => fs.existsSync(file));
}

function summarizeFixture(fixtureRoot) {
  const registries = findRegistries(fixtureRoot).map(file => {
    const summary = summarizeProjectMaterialRegistry(JSON.parse(fs.readFileSync(file, 'utf8')));
    return { path: file, ...summary };
  });
  return {
    schema: 'edu.p0.agent-business-result.v1',
    fixtureRoot: path.resolve(fixtureRoot),
    registryCount: registries.length,
    completed: registries.reduce((sum, item) => sum + item.completed, 0),
    completedElapsedMs: registries.reduce((sum, item) => sum + item.completedElapsedMs, 0),
    failed: registries.reduce((sum, item) => sum + item.failed, 0),
    unknown: registries.reduce((sum, item) => sum + item.unknown, 0),
    businessCompleted: registries.length > 0 && registries.every(item => item.businessCompleted),
    registries,
  };
}

if (require.main === module) {
  const fixtureRoot = process.argv[2];
  if (!fixtureRoot) {
    console.error('usage: node agent-0228-business-result.cjs <fixtureRoot>');
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify(summarizeFixture(fixtureRoot))}\n`);
}

module.exports = { summarizeProjectMaterialRegistry, summarizeFixture };
