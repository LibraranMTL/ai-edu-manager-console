'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { SkillLibraryStore } = require('../electron/skill-library-store.cjs');
const baselineFile = path.resolve(process.argv[2]);
const reportFile = path.resolve(process.argv[3]);
const Baseline = require(baselineFile).SkillLibraryStore;
const count = 5000;
const catalog = {
  artifacts: Array.from({ length: count }, (_, i) => ({ artifactId: `a${i}`, currentVersionId: `v${i}`, kind: 'skill', identity: { name: `name${i}`, displayName: `合成 Skill ${i}`, publisher: 'fixture' }, tags: { system: ['education'], semantic: [], user: [] }, compatibility: ['codex', 'workbuddy'] })),
  versions: Array.from({ length: count * 2 }, (_, i) => ({ versionId: `v${i}`, description: `合成简介 ${i}` })),
  installations: Array.from({ length: count * 2 }, (_, i) => ({ installationId: `i${i}`, artifactId: `a${i % count}`, state: i % 3 ? 'restart_required' : 'uninstalled' })),
};
const store = { catalog: () => catalog };
function run(Type) { return Type.prototype.listArtifacts.call(store, {}); }
async function sample(Type) {
  const started = performance.now();
  const tick = new Promise(resolve => setTimeout(() => resolve(performance.now() - started), 0));
  const result = run(Type), durationMs = performance.now() - started;
  assert.equal(result.length, count);
  return { durationMs, timerDelayMs: await tick };
}
async function main() {
  assert.deepEqual(run(SkillLibraryStore), run(Baseline));
  const before = [], after = [];
  for (let i = 0; i < 9; i++) {
    if (i % 2) { after.push(await sample(SkillLibraryStore)); before.push(await sample(Baseline)); }
    else { before.push(await sample(Baseline)); after.push(await sample(SkillLibraryStore)); }
  }
  const median = (samples, field) => samples.map(s => s[field]).sort((a, b) => a - b)[4];
  const summary = samples => ({ medianMs: median(samples, 'durationMs'), medianTimerDelayMs: median(samples, 'timerDelayMs') });
  const report = { schema: 'edu-manager.skill-list-performance.v1', createdAt: new Date().toISOString(), baselineFile, fixture: { artifacts: count, versions: catalog.versions.length, installations: catalog.installations.length },
    equalityPassed: true, before: summary(before), after: summary(after), samples: { before, after }, boundary: 'Synthetic in-memory join benchmark; not end-to-end UI or disk timings.' };
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
