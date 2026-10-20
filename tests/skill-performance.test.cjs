'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { SkillLibraryStore } = require('../electron/skill-library-store.cjs');
const { SkillLibraryService } = require('../electron/skill-library-service.cjs');

function catalogFixture(count = 100) {
  return { artifacts: Array.from({ length: count }, (_, i) => ({ artifactId: `a${i}`, currentVersionId: `v${i}`, kind: i % 2 ? 'skill' : 'plugin', identity: { name: `name${i}`, displayName: `名称${i}`, publisher: '测试' }, compatibility: ['codex'], tags: { system: ['documents'], semantic: ['semantic'], user: ['user'] } })),
    versions: Array.from({ length: count }, (_, i) => ({ versionId: `v${i}`, description: `description${i}` })),
    installations: Array.from({ length: count * 2 }, (_, i) => ({ installationId: `i${i}`, artifactId: `a${i % count}`, state: i % 3 ? 'restart_required' : 'uninstalled' })) };
}
function referenceList(catalog, query = {}) {
  const text = String(query.query || '').trim().toLowerCase(), provider = String(query.providerId || ''), kind = String(query.kind || '');
  return catalog.artifacts.map(artifact => ({ ...artifact, version: catalog.versions.find(v => v.versionId === artifact.currentVersionId), installations: catalog.installations.filter(i => i.artifactId === artifact.artifactId && i.state !== 'uninstalled') }))
    .filter(item => (!kind || item.kind === kind) && (!provider || item.compatibility.includes(provider)) && (!text || [item.identity.name, item.identity.displayName, item.identity.publisher, item.version?.description, ...item.tags.system, ...item.tags.semantic, ...item.tags.user].join(' ').toLowerCase().includes(text)));
}

test('linear catalog joins preserve filters, order, missing/duplicate versions and fresh edits', () => {
  const catalog = catalogFixture();
  catalog.versions.unshift({ versionId: 'v1', description: 'first duplicate wins' });
  catalog.artifacts[2].currentVersionId = 'missing';
  const store = { catalog: () => catalog };
  for (const query of [{}, { kind: 'plugin' }, { providerId: 'qclaw' }, { providerId: 'codex', query: ' 测试 ' }, { query: 'SEMANTIC' }, { query: 'user' }, { query: 'description4' }]) {
    assert.deepEqual(SkillLibraryStore.prototype.listArtifacts.call(store, query), referenceList(catalog, query));
  }
  catalog.versions[0].description = 'edited after first request';
  assert.equal(SkillLibraryStore.prototype.listArtifacts.call(store)[1].version.description, 'edited after first request');
});

test('catalog version/installation identifiers are visited linearly', () => {
  const catalog = catalogFixture(200);
  let versionReads = 0, installationReads = 0;
  for (const v of catalog.versions) { const id = v.versionId; Object.defineProperty(v, 'versionId', { get() { versionReads++; return id; }, enumerable: true }); }
  for (const i of catalog.installations) { const id = i.artifactId; Object.defineProperty(i, 'artifactId', { get() { installationReads++; return id; }, enumerable: true }); }
  SkillLibraryStore.prototype.listArtifacts.call({ catalog: () => catalog });
  assert.ok(versionReads <= 2 * catalog.versions.length);
  assert.ok(installationReads <= 2 * catalog.installations.length);
});

test('snapshot reads receipts once while preserving quarantine count and recent ordering', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-snapshot-perf-'));
  const service = new SkillLibraryService({ userDataDir: root, homeDir: root, codexHome: path.join(root, '.codex') });
  const receipts = Array.from({ length: 500 }, (_, i) => ({ receiptId: `r${i}`, status: i % 3 ? 'archived' : 'quarantined' }));
  let reads = 0;
  service.store.listReceipts = limit => { reads++; assert.equal(limit, 500); return receipts; };
  const snapshot = service.snapshot();
  assert.equal(reads, 1);
  assert.deepEqual(snapshot.recentReceipts, receipts.slice(0, 20));
  assert.equal(snapshot.counts.quarantined, receipts.filter(r => r.status === 'quarantined').length);
});

test('Skills view reuses search text and avoids duplicate post-scan snapshot requests', () => {
  const ui = fs.readFileSync(path.join(__dirname, '../src/SkillManagementPanel.tsx'), 'utf8');
  const scan = ui.slice(ui.indexOf('async function scan()'), ui.indexOf('async function chooseAndImport'));
  assert.doesNotMatch(scan, /invoke.*['"]snapshot['"]/);
  assert.match(ui, /searchableArtifacts = useMemo/);
  assert.match(ui, /useDeferredValue\(query\)/);
  assert.match(ui, /memo\(function DiscoveryRow/);
  assert.match(ui, /selectedDiscoveryIds\.has\(item.discoveryId\)/);
});

module.exports = { catalogFixture, referenceList };
