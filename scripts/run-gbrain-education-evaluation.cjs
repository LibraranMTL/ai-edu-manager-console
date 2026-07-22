const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { createGbrainEvaluationAdapter } = require('../electron/gbrain-evaluation-adapter.cjs');
const { createGbrainCliEvaluationTransport } = require('../electron/gbrain-cli-evaluation-transport.cjs');
const { createLlmWikiKnowledgeEngine } = require('../electron/llm-wiki-knowledge-engine.cjs');

const workspaceRoot = path.resolve(__dirname, '..');
const evaluationRoot = path.join(workspaceRoot, '.gbrain-evaluation');
const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const gbrainHome = path.join(evaluationRoot, 'runs', runId, 'runtime');
const namespace = `edu-manager-synthetic-eval-${runId}`;
const fixturePath = path.join(workspaceRoot, 'tests', 'fixtures', 'knowledge-engine', 'education-synthetic-v1.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const transport = createGbrainCliEvaluationTransport({ workspaceRoot, evaluationRoot, gbrainHome });
const initialization = transport.initialize();
const gbrainVersion = transport.version();
const engine = createGbrainEvaluationAdapter({ transport, namespace, engineVersion: gbrainVersion.replace(/^gbrain\s+/i, '') });
const results = [];

function evidence(id, sourceUri, excerpt) {
  return { id, sourceUri, excerpt, observedAt: '2026-07-20' };
}

function confirmedClaim(id, subjectId, predicate, value, evidenceItem, overrides = {}) {
  return {
    id,
    subjectId,
    predicate,
    value,
    status: 'confirmed',
    evidence: [evidenceItem],
    confidence: 'medium',
    createdAt: '2026-07-20T01:00:00.000Z',
    updatedAt: '2026-07-20T01:00:00.000Z',
    synthetic: true,
    ...overrides,
  };
}

async function scenario(id, title, fn) {
  const started = Date.now();
  try {
    const evidenceValue = await fn();
    results.push({ id, title, status: 'passed', durationMs: Date.now() - started, evidence: evidenceValue || {} });
  } catch (error) {
    results.push({
      id,
      title,
      status: 'failed',
      durationMs: Date.now() - started,
      error: { name: error.name, code: error.code || '', message: error.message, details: error.details || {} },
    });
  }
}

function capturePage(kind, id, body, extraFrontmatter = '') {
  const slug = `${namespace}/${kind}/${id}`;
  const content = `---\ntype: note\nschema: edu-manager.synthetic-entity.v1\nentity_id: ${JSON.stringify(id)}\nsynthetic: true\n${extraFrontmatter}---\n# ${id}\n\n${body}\n`;
  transport.execute('capture', { namespace, slug, content, synthetic: true });
  return slug;
}

function mcpProbe() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, GBRAIN_HOME: gbrainHome, GBRAIN_NO_ONBOARD_NUDGE: '1' };
    for (const key of ['OPENAI_API_KEY', 'ZEROENTROPY_API_KEY', 'VOYAGE_API_KEY', 'ANTHROPIC_API_KEY']) delete env[key];
    const child = spawn(transport.gbrainPath, ['serve'], { cwd: workspaceRoot, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const messages = new Map();
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch { /* process may already be gone */ }
      if (error) reject(error); else resolve(value);
    };
    const maybeFinish = () => {
      const listed = messages.get(2);
      const searched = messages.get(3);
      if (!listed || !searched) return;
      const tools = Array.isArray(listed.result?.tools) ? listed.result.tools : [];
      const names = tools.map((item) => item.name);
      assert.ok(names.includes('search'), 'MCP tools/list 未包含 search');
      assert.ok(names.includes('get_page'), 'MCP tools/list 未包含 get_page');
      assert.ok(searched.result && !searched.error, 'MCP tools/call search 失败');
      finish(null, { toolCount: tools.length, hasSearch: true, hasGetPage: true, searchResponseReceived: true, stderr: stderr.trim().slice(0, 1000) });
    };
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim().startsWith('{')) continue;
        try {
          const message = JSON.parse(line);
          if (typeof message.id !== 'undefined') messages.set(Number(message.id), message);
          if (Number(message.id) === 1) {
            child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
            child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
            child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search', arguments: { query: 'candidatevisibilitytoken', limit: 5 } } })}\n`);
          }
          maybeFinish();
        } catch { /* ignore non-protocol stdout */ }
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => finish(error));
    child.on('exit', (code) => {
      if (!settled) finish(new Error(`GBrain MCP server exited before verification (code ${code}): ${stderr.slice(0, 1000)}`));
    });
    const timer = setTimeout(() => finish(new Error(`GBrain MCP verification timed out. stderr=${stderr.slice(0, 1000)}`)), 20000);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'edu-manager-p0-eval', version: '1.0.0' } } })}\n`);
  });
}

async function main() {
  assert.equal(fixture.synthetic, true);
  assert.equal(fixture.scenarios.length, 10);
  const health = engine.health();
  assert.equal(health.checks.find((item) => item.name === 'connection')?.status, 'ok');
  assert.match(health.checks.find((item) => item.name === 'search_mode')?.message || '', /conservative/);

  await scenario(fixture.scenarios[0].id, fixture.scenarios[0].title, () => {
    const asset = { id: 'source-synthetic-immutable', uri: 'fixture://student-a/immutable', title: '虚构不可变观察', content: 'immutabilitytoken 虚构学生 A 的原始观察。', synthetic: true };
    const first = engine.importAsset(asset);
    const duplicate = engine.importAsset(asset);
    assert.equal(first.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    assert.throws(() => engine.importAsset({ ...asset, content: 'immutabilitytoken 被修改的虚构内容。' }), (error) => error.code === 'IMMUTABLE_SOURCE_CONFLICT');
    return { slug: first.slug, duplicate: duplicate.duplicate, conflictBlocked: true, sha256: first.sha256 };
  });

  await scenario(fixture.scenarios[1].id, fixture.scenarios[1].title, () => {
    assert.throws(() => engine.upsertClaim({ id: 'claim-synthetic-no-evidence', subjectId: 'student-synthetic-a', predicate: 'learning.preference', value: 'evidencetoken', status: 'confirmed', synthetic: true }), (error) => error.code === 'CONFIRMED_WITHOUT_EVIDENCE');
    const saved = engine.upsertClaim(confirmedClaim('claim-synthetic-evidence', 'student-synthetic-a', 'learning.evidence', 'evidencetoken 图形整理观察', evidence('evidence-synthetic-001', 'fixture://student-a/immutable', '三次虚构练习')));
    const read = engine.getClaim(saved.claim.id);
    assert.equal(read.evidence[0].sourceUri, 'fixture://student-a/immutable');
    return { claimId: read.id, evidenceId: read.evidence[0].id, sourceUri: read.evidence[0].sourceUri, missingEvidenceBlocked: true };
  });

  await scenario(fixture.scenarios[2].id, fixture.scenarios[2].title, () => {
    engine.upsertClaim(confirmedClaim('claim-synthetic-visible', 'student-synthetic-a', 'learning.visibility', 'candidatevisibilitytoken confirmed', evidence('evidence-synthetic-visible', 'fixture://student-a/visible', '已确认虚构证据')));
    engine.upsertClaim({ id: 'claim-synthetic-candidate', subjectId: 'student-synthetic-a', predicate: 'learning.visibility', value: 'candidatevisibilitytoken candidate', status: 'candidate', evidence: [], createdAt: '2026-07-20T02:00:00.000Z', updatedAt: '2026-07-20T02:00:00.000Z', synthetic: true });
    const ordinary = engine.search('candidatevisibilitytoken', { subjectId: 'student-synthetic-a' });
    const candidates = engine.search('candidatevisibilitytoken', { subjectId: 'student-synthetic-a', statuses: ['candidate'] });
    assert.deepEqual(ordinary.results.map((item) => item.claim.id), ['claim-synthetic-visible']);
    assert.deepEqual(candidates.results.map((item) => item.claim.id), ['claim-synthetic-candidate']);
    return { ordinaryClaimIds: ordinary.results.map((item) => item.claim.id), authorizedCandidateIds: candidates.results.map((item) => item.claim.id) };
  });

  await scenario(fixture.scenarios[3].id, fixture.scenarios[3].title, () => {
    const left = engine.upsertClaim(confirmedClaim('claim-synthetic-conflict-left', 'student-synthetic-a', 'learning.observation', 'conflictobservationtoken 更偏好独立完成', evidence('evidence-synthetic-conflict-left', 'fixture://student-a/session-1', '虚构会话一')));
    const right = engine.upsertClaim(confirmedClaim('claim-synthetic-conflict-right', 'student-synthetic-a', 'learning.observation', 'conflictobservationtoken 更偏好协作完成', evidence('evidence-synthetic-conflict-right', 'fixture://student-a/session-2', '虚构会话二')));
    const relation = engine.upsertRelationship({ id: 'relationship-synthetic-conflict', fromId: left.claim.id, toId: right.claim.id, fromSlug: left.slug, toSlug: right.slug, type: 'conflicts_with', context: '两条虚构观察应并存等待复核', synthetic: true });
    const found = engine.search('conflictobservationtoken', { subjectId: 'student-synthetic-a' });
    assert.equal(found.results.length, 2);
    const links = transport.execute('get_links', { namespace, slug: left.slug });
    assert.ok(Array.isArray(links) && links.some((item) => String(item.to_slug || item.to || '').includes(right.claim.id)));
    return { claimIds: found.results.map((item) => item.claim.id).sort(), relationshipId: relation.relationship.id, nativeLinkCount: links.length };
  });

  await scenario(fixture.scenarios[4].id, fixture.scenarios[4].title, () => {
    const base = confirmedClaim('claim-synthetic-temporal', 'student-synthetic-a', 'learning.preference', 'temporalrevisiontoken 第一版观察', evidence('evidence-synthetic-temporal-1', 'fixture://student-a/day-1', '第一天虚构记录'));
    engine.upsertClaim(base);
    const revised = engine.upsertClaim({ ...base, value: 'temporalrevisiontoken 第二版观察', evidence: [evidence('evidence-synthetic-temporal-2', 'fixture://student-a/day-2', '第二天虚构记录')], updatedAt: '2026-07-21T02:00:00.000Z' });
    const current = engine.getClaim(base.id);
    assert.equal(current.id, base.id);
    assert.match(current.value, /第二版/);
    assert.ok(revised.historySlug);
    const history = transport.execute('list_pages', { namespace, pathPrefix: `${namespace}/claim-history/${base.id}/` });
    assert.ok(history.length >= 1);
    return { claimId: current.id, currentUpdatedAt: current.updatedAt, historySlug: revised.historySlug, historyCount: history.length };
  });

  await scenario(fixture.scenarios[5].id, fixture.scenarios[5].title, () => {
    const studentSlug = capturePage('subjects', 'student-synthetic-a', 'relationshipgraphtoken 虚构学生主体。', 'subject_id: "student-synthetic-a"\n');
    const projectSlug = capturePage('projects', 'project-synthetic-graph', 'relationshipgraphtoken 虚构学习项目。', 'project_id: "project-synthetic-graph"\n');
    const relation = engine.upsertRelationship({ id: 'relationship-synthetic-participates', fromId: 'student-synthetic-a', toId: 'project-synthetic-graph', fromSlug: studentSlug, toSlug: projectSlug, type: 'participates_in', context: '虚构学生参与虚构项目', synthetic: true });
    const graph = transport.execute('traverse_graph', { namespace, slug: studentSlug, depth: 2, direction: 'both' });
    assert.ok(Array.isArray(graph) && graph.length >= 1);
    return { relationshipId: relation.relationship.id, fromSlug: studentSlug, toSlug: projectSlug, graphRows: graph.length };
  });

  await scenario(fixture.scenarios[6].id, fixture.scenarios[6].title, () => {
    engine.upsertClaim(confirmedClaim('claim-synthetic-isolation-a', 'student-synthetic-a', 'learning.isolation', 'studentisolationtoken A', evidence('evidence-synthetic-isolation-a', 'fixture://student-a/isolation', '虚构 A')));
    engine.upsertClaim(confirmedClaim('claim-synthetic-isolation-b', 'student-synthetic-b', 'learning.isolation', 'studentisolationtoken B', evidence('evidence-synthetic-isolation-b', 'fixture://student-b/isolation', '虚构 B')));
    const a = engine.search('studentisolationtoken', { subjectId: 'student-synthetic-a' });
    const b = engine.search('studentisolationtoken', { subjectId: 'student-synthetic-b' });
    const explicitCrossProfile = engine.search('studentisolationtoken', {});
    assert.deepEqual(a.results.map((item) => item.claim.subjectId), ['student-synthetic-a']);
    assert.deepEqual(b.results.map((item) => item.claim.subjectId), ['student-synthetic-b']);
    assert.equal(explicitCrossProfile.results.length, 2);
    return { studentAClaimIds: a.results.map((item) => item.claim.id), studentBClaimIds: b.results.map((item) => item.claim.id), explicitCrossProfileCount: explicitCrossProfile.results.length, boundary: 'adapter-filter; AgentPolicy remains product responsibility' };
  });

  await scenario(fixture.scenarios[7].id, fixture.scenarios[7].title, () => {
    engine.upsertClaim({ id: 'claim-synthetic-sensitive', subjectId: 'student-synthetic-a', predicate: 'identity.sensitive-field', value: 'sensitivepolicytoken 虚构敏感字段', status: 'candidate', evidence: [evidence('evidence-synthetic-sensitive', 'fixture://student-a/sensitive', '虚构敏感内容')], createdAt: '2026-07-20T03:00:00.000Z', updatedAt: '2026-07-20T03:00:00.000Z', synthetic: true });
    const ordinary = engine.search('sensitivepolicytoken', { subjectId: 'student-synthetic-a' });
    const privileged = engine.search('sensitivepolicytoken', { subjectId: 'student-synthetic-a', statuses: ['candidate'] });
    assert.equal(ordinary.results.length, 0);
    assert.equal(privileged.results.length, 1);
    return { ordinaryCount: 0, explicitlyAuthorizedCount: 1, boundary: 'GBrain stores the page; product AgentPolicy decides field visibility' };
  });

  await scenario(fixture.scenarios[8].id, fixture.scenarios[8].title, () => {
    const correction = engine.appendEvent({ id: 'event-synthetic-correction', subjectId: 'student-synthetic-a', type: 'student_correction', status: 'submitted', summary: 'appealeventtoken 学生提交虚构纠正', actorId: 'student-synthetic-a', occurredAt: '2026-07-20T09:00:00.000Z', synthetic: true });
    const appeal = engine.appendEvent({ id: 'event-synthetic-appeal', subjectId: 'student-synthetic-a', type: 'guardian_appeal', status: 'resolved', summary: 'appealeventtoken 监护人虚构申诉已处理', actorId: 'guardian-synthetic-a', resolvedBy: 'reviewer-synthetic-001', occurredAt: '2026-07-21T09:00:00.000Z', synthetic: true });
    const correctionTimeline = transport.execute('get_timeline', { namespace, slug: correction.slug });
    const appealTimeline = transport.execute('get_timeline', { namespace, slug: appeal.slug });
    assert.ok(correctionTimeline.length >= 1);
    assert.ok(appealTimeline.length >= 1);
    return { eventIds: [correction.event.id, appeal.event.id], correctionTimelineRows: correctionTimeline.length, appealTimelineRows: appealTimeline.length, resolvedBy: appeal.event.resolvedBy };
  });

  await scenario(fixture.scenarios[9].id, fixture.scenarios[9].title, () => {
    const exported = engine.exportSnapshot({ exportId: `education-synthetic-${runId}` });
    assert.ok(fs.existsSync(exported.jsonPath));
    assert.ok(exported.snapshot.pages.some((page) => page.slug === `${namespace}/claims/claim-synthetic-temporal`));
    const fallbackRoot = path.join(evaluationRoot, 'fallback-wiki', runId);
    fs.mkdirSync(fallbackRoot, { recursive: true });
    const fallback = createLlmWikiKnowledgeEngine({ rootPath: fallbackRoot });
    fallback.importAsset({ id: 'source-synthetic-immutable', uri: 'fixture://student-a/immutable', title: '虚构不可变观察', content: 'immutabilitytoken 虚构学生 A 的原始观察。', synthetic: true });
    const fallbackExport = fallback.exportSnapshot({ exportId: `fallback-${runId}` });
    const disabledEngine = createGbrainEvaluationAdapter({ namespace, engineVersion: gbrainVersion, transport: { execute() { throw new Error('synthetic engine disabled'); } } });
    assert.throws(() => disabledEngine.health(), /disabled/);
    assert.equal(fallback.health().counts.sources, 1);
    assert.equal(fallbackExport.snapshot.sources[0].id, 'source-synthetic-immutable');
    return { gbrainExportDir: exported.exportDir, gbrainJsonPath: exported.jsonPath, gbrainPageCount: exported.snapshot.pageCount, fallbackEngineId: fallback.engineId, stableSourceId: fallbackExport.snapshot.sources[0].id, markdownAndJson: true };
  });

  let mcp;
  try { mcp = { status: 'passed', ...(await mcpProbe()) }; } catch (error) { mcp = { status: 'failed', error: error.message }; }
  const report = {
    schema: 'edu-manager.gbrain-live-evaluation.v1',
    runId,
    ranAt: new Date().toISOString(),
    datasetId: fixture.datasetId,
    syntheticOnly: true,
    namespace,
    gbrainVersion,
    searchMode: 'conservative',
    embeddingsConfigured: false,
    initialization,
    health: { status: health.status, healthScore: health.health_score, brainChecksScore: health.brain_checks_score, connection: health.checks.find((item) => item.name === 'connection'), schemaVersion: health.checks.find((item) => item.name === 'schema_version') },
    scenarios: results,
    mcp,
    summary: { passed: results.filter((item) => item.status === 'passed').length, failed: results.filter((item) => item.status === 'failed').length, total: results.length },
  };
  const resultsRoot = path.join(evaluationRoot, 'results');
  fs.mkdirSync(resultsRoot, { recursive: true });
  const jsonPath = path.join(resultsRoot, `${runId}.json`);
  const latestPath = path.join(resultsRoot, 'latest.json');
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const lines = [
    '# GBrain P0 live evaluation', '',
    `- Run: ${runId}`,
    `- Version: ${gbrainVersion}`,
    `- Namespace: ${namespace}`,
    `- Scenarios: ${report.summary.passed}/${report.summary.total} passed`,
    `- MCP: ${mcp.status}`,
    '',
    '| Scenario | Status | Duration |', '| --- | --- | ---: |',
    ...results.map((item) => `| ${item.id} ${item.title} | ${item.status} | ${item.durationMs} ms |`),
  ];
  fs.writeFileSync(path.join(resultsRoot, 'latest.md'), `${lines.join('\n')}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ ...report.summary, mcp: mcp.status, runId, jsonPath }, null, 2)}\n`);
  if (report.summary.failed || mcp.status !== 'passed') process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
