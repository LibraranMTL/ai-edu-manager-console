const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { performance } = require('node:perf_hooks');
const { createLlmWikiKnowledgeEngine } = require('../electron/llm-wiki-knowledge-engine.cjs');

const repoRoot = path.resolve(__dirname, '..');
const evaluationRoot = path.join(repoRoot, '.gbrain-evaluation');
const fixturePath = path.join(repoRoot, 'tests', 'fixtures', 'knowledge-engine', 'education-synthetic-v1.json');
const gbrainResultPath = path.join(evaluationRoot, 'results', 'latest.json');
const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const comparisonRoot = path.join(evaluationRoot, 'comparisons', runId);
const wikiRoot = path.join(comparisonRoot, 'llm-wiki');
const results = [];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function evidence(id, sourceUri, excerpt) {
  return { id, sourceUri, excerpt, observedAt: '2026-07-20T01:00:00.000Z', synthetic: true };
}

function confirmedClaim(id, subjectId, predicate, value, evidenceItem) {
  return {
    id,
    subjectId,
    predicate,
    value,
    status: 'confirmed',
    evidence: [evidenceItem],
    confidence: 'high',
    createdAt: '2026-07-20T01:00:00.000Z',
    updatedAt: '2026-07-20T01:00:00.000Z',
    synthetic: true,
  };
}

async function scenario(definition, fn) {
  const startedAt = performance.now();
  try {
    const evidenceResult = await fn();
    results.push({
      id: definition.id,
      title: definition.title,
      status: 'passed',
      durationMs: Number((performance.now() - startedAt).toFixed(3)),
      evidence: evidenceResult,
    });
  } catch (error) {
    results.push({
      id: definition.id,
      title: definition.title,
      status: 'failed',
      durationMs: Number((performance.now() - startedAt).toFixed(3)),
      error: error.stack || error.message,
    });
  }
}

async function main() {
  if (!fs.existsSync(gbrainResultPath)) {
    throw new Error(`缺少 GBrain 实测结果：${gbrainResultPath}`);
  }

  const fixture = readJson(fixturePath);
  const gbrain = readJson(gbrainResultPath);
  assert.equal(fixture.synthetic, true);
  assert.equal(fixture.scenarios.length, 10);
  assert.equal(gbrain.datasetId, fixture.datasetId);
  assert.equal(gbrain.summary.total, 10);

  fs.mkdirSync(wikiRoot, { recursive: true });
  const engine = createLlmWikiKnowledgeEngine({ rootPath: wikiRoot });
  const overallStartedAt = performance.now();

  await scenario(fixture.scenarios[0], () => {
    const asset = {
      id: 'source-synthetic-immutable',
      uri: 'fixture://student-a/immutable',
      title: '虚构不可变观察',
      content: 'immutabilitytoken 虚构学生 A 的原始观察。',
      synthetic: true,
    };
    const first = engine.importAsset(asset);
    const duplicate = engine.importAsset(asset);
    assert.equal(first.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    assert.throws(
      () => engine.importAsset({ ...asset, content: 'immutabilitytoken 被修改的虚构内容。' }),
      (error) => error.code === 'IMMUTABLE_SOURCE_CONFLICT',
    );
    return { sourceId: first.source.id, duplicate: true, conflictBlocked: true, sha256: first.source.sha256 };
  });

  await scenario(fixture.scenarios[1], () => {
    assert.throws(
      () => engine.upsertClaim({ id: 'claim-synthetic-no-evidence', subjectId: 'student-synthetic-a', predicate: 'learning.preference', value: 'evidencetoken', status: 'confirmed', synthetic: true }),
      (error) => error.code === 'CONFIRMED_WITHOUT_EVIDENCE',
    );
    const saved = engine.upsertClaim(confirmedClaim(
      'claim-synthetic-evidence',
      'student-synthetic-a',
      'learning.evidence',
      'evidencetoken 图形整理观察',
      evidence('evidence-synthetic-001', 'fixture://student-a/immutable', '三次虚构练习'),
    ));
    const read = engine.getClaim(saved.claim.id);
    assert.equal(read.evidence[0].sourceUri, 'fixture://student-a/immutable');
    return { claimId: read.id, evidenceId: read.evidence[0].id, sourceUri: read.evidence[0].sourceUri, missingEvidenceBlocked: true };
  });

  await scenario(fixture.scenarios[2], () => {
    engine.upsertClaim(confirmedClaim('claim-synthetic-visible', 'student-synthetic-a', 'learning.visibility', 'candidatevisibilitytoken confirmed', evidence('evidence-synthetic-visible', 'fixture://student-a/visible', '已确认虚构证据')));
    engine.upsertClaim({ id: 'claim-synthetic-candidate', subjectId: 'student-synthetic-a', predicate: 'learning.visibility', value: 'candidatevisibilitytoken candidate', status: 'candidate', evidence: [], createdAt: '2026-07-20T02:00:00.000Z', updatedAt: '2026-07-20T02:00:00.000Z', synthetic: true });
    const ordinary = engine.search('candidatevisibilitytoken', { subjectId: 'student-synthetic-a' });
    const candidates = engine.search('candidatevisibilitytoken', { subjectId: 'student-synthetic-a', statuses: ['candidate'] });
    assert.deepEqual(ordinary.results.map((item) => item.claim.id), ['claim-synthetic-visible']);
    assert.deepEqual(candidates.results.map((item) => item.claim.id), ['claim-synthetic-candidate']);
    return { ordinaryClaimIds: ordinary.results.map((item) => item.claim.id), authorizedCandidateIds: candidates.results.map((item) => item.claim.id) };
  });

  await scenario(fixture.scenarios[3], () => {
    const left = engine.upsertClaim(confirmedClaim('claim-synthetic-conflict-left', 'student-synthetic-a', 'learning.observation', 'conflictobservationtoken 更偏好独立完成', evidence('evidence-synthetic-conflict-left', 'fixture://student-a/session-1', '虚构会话一')));
    const right = engine.upsertClaim(confirmedClaim('claim-synthetic-conflict-right', 'student-synthetic-a', 'learning.observation', 'conflictobservationtoken 更偏好协作完成', evidence('evidence-synthetic-conflict-right', 'fixture://student-a/session-2', '虚构会话二')));
    const relation = engine.upsertRelationship({ id: 'relationship-synthetic-conflict', fromId: left.claim.id, toId: right.claim.id, type: 'conflicts_with', context: '两条虚构观察应并存等待复核', synthetic: true });
    const found = engine.search('conflictobservationtoken', { subjectId: 'student-synthetic-a' });
    assert.equal(found.results.length, 2);
    return { claimIds: found.results.map((item) => item.claim.id).sort(), relationshipId: relation.relationship.id, relationshipStored: true };
  });

  await scenario(fixture.scenarios[4], () => {
    const base = confirmedClaim('claim-synthetic-temporal', 'student-synthetic-a', 'learning.preference', 'temporalrevisiontoken 第一版观察', evidence('evidence-synthetic-temporal-1', 'fixture://student-a/day-1', '第一天虚构记录'));
    engine.upsertClaim(base);
    const revised = engine.upsertClaim({ ...base, value: 'temporalrevisiontoken 第二版观察', evidence: [evidence('evidence-synthetic-temporal-2', 'fixture://student-a/day-2', '第二天虚构记录')], updatedAt: '2026-07-21T02:00:00.000Z' });
    const current = engine.getClaim(base.id);
    const historyDir = path.join(wikiRoot, '.edu-manager', 'knowledge-engine-v1', 'claim-history', base.id);
    const historyCount = fs.readdirSync(historyDir).filter((name) => name.endsWith('.json')).length;
    assert.equal(current.id, base.id);
    assert.match(current.value, /第二版/);
    assert.ok(historyCount >= 1);
    return { claimId: current.id, currentUpdatedAt: current.updatedAt, revision: revised.claim.revision, historyCount };
  });

  await scenario(fixture.scenarios[5], () => {
    const relation = engine.upsertRelationship({ id: 'relationship-synthetic-participates', fromId: 'student-synthetic-a', toId: 'project-synthetic-graph', type: 'participates_in', context: '虚构学生参与虚构项目', synthetic: true });
    const exported = engine.exportSnapshot({ exportId: `relationship-check-${runId}` });
    const restored = exported.snapshot.relationships.find((item) => item.id === relation.relationship.id);
    assert.equal(restored.fromId, 'student-synthetic-a');
    assert.equal(restored.toId, 'project-synthetic-graph');
    return { relationshipId: restored.id, fromId: restored.fromId, toId: restored.toId, recoverableFromExport: true };
  });

  await scenario(fixture.scenarios[6], () => {
    engine.upsertClaim(confirmedClaim('claim-synthetic-isolation-a', 'student-synthetic-a', 'learning.isolation', 'studentisolationtoken A', evidence('evidence-synthetic-isolation-a', 'fixture://student-a/isolation', '虚构 A')));
    engine.upsertClaim(confirmedClaim('claim-synthetic-isolation-b', 'student-synthetic-b', 'learning.isolation', 'studentisolationtoken B', evidence('evidence-synthetic-isolation-b', 'fixture://student-b/isolation', '虚构 B')));
    const a = engine.search('studentisolationtoken', { subjectId: 'student-synthetic-a' });
    const b = engine.search('studentisolationtoken', { subjectId: 'student-synthetic-b' });
    const crossProfile = engine.search('studentisolationtoken', {});
    assert.deepEqual(a.results.map((item) => item.claim.subjectId), ['student-synthetic-a']);
    assert.deepEqual(b.results.map((item) => item.claim.subjectId), ['student-synthetic-b']);
    assert.equal(crossProfile.results.length, 2);
    return { studentAClaimIds: a.results.map((item) => item.claim.id), studentBClaimIds: b.results.map((item) => item.claim.id), explicitCrossProfileCount: crossProfile.results.length, boundary: 'engine-filter; AgentPolicy remains product responsibility' };
  });

  await scenario(fixture.scenarios[7], () => {
    engine.upsertClaim({ id: 'claim-synthetic-sensitive', subjectId: 'student-synthetic-a', predicate: 'identity.sensitive-field', value: 'sensitivepolicytoken 虚构敏感字段', status: 'candidate', evidence: [evidence('evidence-synthetic-sensitive', 'fixture://student-a/sensitive', '虚构敏感内容')], createdAt: '2026-07-20T03:00:00.000Z', updatedAt: '2026-07-20T03:00:00.000Z', synthetic: true });
    const ordinary = engine.search('sensitivepolicytoken', { subjectId: 'student-synthetic-a' });
    const privileged = engine.search('sensitivepolicytoken', { subjectId: 'student-synthetic-a', statuses: ['candidate'] });
    assert.equal(ordinary.results.length, 0);
    assert.equal(privileged.results.length, 1);
    return { ordinaryCount: ordinary.results.length, explicitlyAuthorizedCount: privileged.results.length, boundary: 'engine stores data; AgentPolicy decides field visibility' };
  });

  await scenario(fixture.scenarios[8], () => {
    const correction = engine.appendEvent({ id: 'event-synthetic-correction', subjectId: 'student-synthetic-a', type: 'student_correction', status: 'submitted', summary: 'appealeventtoken 学生提交虚构纠正', actorId: 'student-synthetic-a', occurredAt: '2026-07-20T09:00:00.000Z', synthetic: true });
    const appeal = engine.appendEvent({ id: 'event-synthetic-appeal', subjectId: 'student-synthetic-a', type: 'guardian_appeal', status: 'resolved', summary: 'appealeventtoken 监护人虚构申诉已处理', actorId: 'guardian-synthetic-a', resolvedBy: 'reviewer-synthetic-001', occurredAt: '2026-07-21T09:00:00.000Z', synthetic: true });
    const exported = engine.exportSnapshot({ exportId: `event-check-${runId}` });
    const eventIds = exported.snapshot.events.map((item) => item.id);
    assert.ok(eventIds.includes(correction.event.id));
    assert.ok(eventIds.includes(appeal.event.id));
    return { eventIds: [correction.event.id, appeal.event.id], ledgerEventCount: exported.snapshot.events.length, resolvedBy: appeal.event.resolvedBy };
  });

  await scenario(fixture.scenarios[9], () => {
    const exported = engine.exportSnapshot({ exportId: `education-synthetic-${runId}` });
    const jsonPath = path.join(exported.exportDir, 'snapshot.json');
    const markdownPath = path.join(exported.exportDir, 'README.md');
    assert.ok(fs.existsSync(jsonPath));
    assert.ok(fs.existsSync(markdownPath));
    assert.ok(exported.snapshot.claims.some((item) => item.id === 'claim-synthetic-temporal'));
    const readOnly = createLlmWikiKnowledgeEngine({ rootPath: wikiRoot, readOnly: true });
    assert.equal(readOnly.health().ok, true);
    assert.equal(readOnly.getClaim('claim-synthetic-temporal').id, 'claim-synthetic-temporal');
    return { exportDir: exported.exportDir, jsonPath, markdownPath, stableClaimId: 'claim-synthetic-temporal', readOnlyFallback: true };
  });

  const llmWikiDurationMs = Number((performance.now() - overallStartedAt).toFixed(3));
  const gbrainScenarioDurationMs = gbrain.scenarios.reduce((sum, item) => sum + Number(item.durationMs || 0), 0);
  const llmWikiPassed = results.filter((item) => item.status === 'passed').length;
  const gbrainPassed = gbrain.scenarios.filter((item) => item.status === 'passed').length;
  const report = {
    schema: 'edu-manager.knowledge-engine-comparison.v1',
    runId,
    ranAt: new Date().toISOString(),
    datasetId: fixture.datasetId,
    syntheticOnly: true,
    comparisonScope: {
      llmWiki: 'in-process local JSON/Markdown engine, exact keyword search',
      gbrain: `GBrain ${gbrain.gbrainVersion}, conservative PGLite, per-operation CLI transport`,
      embeddingsCompared: false,
      warning: '耗时反映当前集成路径，不是数据库内核微基准；GBrain 每次操作的 CLI 冷启动占主要成本。',
    },
    llmWiki: {
      engineVersion: engine.engineVersion,
      health: engine.health(),
      scenarios: results,
      summary: { passed: llmWikiPassed, failed: results.length - llmWikiPassed, total: results.length },
      scenarioDurationMs: Number(results.reduce((sum, item) => sum + item.durationMs, 0).toFixed(3)),
      overallDurationMs: llmWikiDurationMs,
    },
    gbrain: {
      runId: gbrain.runId,
      version: gbrain.gbrainVersion,
      searchMode: gbrain.searchMode,
      embeddingsConfigured: gbrain.embeddingsConfigured,
      health: gbrain.health,
      scenarios: gbrain.scenarios,
      summary: { passed: gbrainPassed, failed: gbrain.scenarios.length - gbrainPassed, total: gbrain.scenarios.length },
      scenarioDurationMs: gbrainScenarioDurationMs,
      mcp: gbrain.mcp,
    },
  };

  const reportPath = path.join(comparisonRoot, 'comparison.json');
  const latestPath = path.join(evaluationRoot, 'comparisons', 'latest.json');
  writeJson(reportPath, report);
  writeJson(latestPath, report);
  process.stdout.write(`${JSON.stringify({ reportPath, latestPath, llmWiki: report.llmWiki.summary, gbrain: report.gbrain.summary, llmWikiDurationMs, gbrainScenarioDurationMs }, null, 2)}\n`);
  if (llmWikiPassed !== results.length || gbrainPassed !== gbrain.scenarios.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
