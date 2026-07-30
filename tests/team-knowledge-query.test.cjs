const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createArchiveAccess } = require('../electron/archive-access.cjs');
const { normalizeAgentKnowledgeQuestion, normalizeKnowledgeResult } = require('../electron/agent-knowledge-query.cjs');
const { normalizeRemoteArchiveRequest, stableRemoteArchiveKey } = require('../electron/collaboration-remote-archive.cjs');

test('D4-B2 accepts an explicit team scope without weakening student and project scopes', () => {
  const team = normalizeAgentKnowledgeQuestion({ scopeType: 'team', question: '本周有哪些共同进展？' });
  assert.equal(team.scopeType, 'team');
  assert.equal(team.scopeId, 'team');
  assert.equal(team.queryScope, 'all_allowed');
  const exactRemoteStudent = normalizeAgentKnowledgeQuestion({
    scopeType: 'team',
    student: '赵书源',
    question: '查询赵书源数字手写作业的摘要',
  });
  assert.equal(exactRemoteStudent.student, '赵书源');
  assert.equal(exactRemoteStudent.scopeType, 'team');
  const remoteTeam = normalizeAgentKnowledgeQuestion({ scope: 'collaboration_team', question: '远端有哪些共同进展？' });
  assert.equal(remoteTeam.scopeType, 'team');
  assert.equal(remoteTeam.queryScope, 'collaboration_team');
  const currentStudent = normalizeAgentKnowledgeQuestion({ scope: 'current_student', scopeId: 'student-a', question: '最近进展？' });
  assert.equal(currentStudent.scopeType, 'student');
  assert.throws(
    () => normalizeAgentKnowledgeQuestion({ scopeType: 'all', scopeId: 'all', question: '越权查询' }),
    /student、project 或 team/,
  );
});

test('D4-B2 bounded team index gives multiple scopes a fair share', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-team-index-'));
  const first = path.join(root, 'first');
  const second = path.join(root, 'second');
  try {
    fs.mkdirSync(first, { recursive: true });
    fs.mkdirSync(second, { recursive: true });
    fs.writeFileSync(path.join(first, 'FIRST-TEAM-MARKER.md'), 'FIRST-TEAM-MARKER', 'utf8');
    fs.writeFileSync(path.join(second, 'SECOND-TEAM-MARKER.md'), 'SECOND-TEAM-MARKER', 'utf8');
    const access = createArchiveAccess({
      maxResources: 2,
      descriptors: [
        { scopeType: 'student', scopeId: 'student-a', scopeName: '学生 A', root: first },
        { scopeType: 'student', scopeId: 'student-b', scopeName: '学生 B', root: second },
      ],
    });
    const primed = access.refresh();
    assert.equal(primed.resourceCount, 2);
    assert.equal(access.search({ query: 'FIRST-TEAM-MARKER' }).count, 1);
    assert.equal(access.search({ query: 'SECOND-TEAM-MARKER' }).count, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('D4-B2 result keeps per-resource student project node freshness and transport', () => {
  const query = normalizeAgentKnowledgeQuestion({ scopeType: 'team', question: 'TEAM-ATTRIBUTION-X1' });
  const result = normalizeKnowledgeResult(query, {
    ok: true,
    source: 'remote',
    transport: 'tailscale',
    response: {
      sourceNodeId: 'node-a',
      freshness: 'live',
      result: {
        resources: [{
          uri: 'edu://project/project-a/knowledge/progress.md',
          title: 'progress.md',
          scopeType: 'project',
          scopeId: 'project-a',
          studentId: 'student-a',
          studentName: '学生 A',
          projectId: 'project-a',
          projectName: '项目 A',
          sourceNodeId: 'node-a',
          freshness: 'live',
          transport: 'tailscale',
        }],
      },
    },
  });
  assert.equal(result.resources[0].studentName, '学生 A');
  assert.equal(result.resources[0].projectName, '项目 A');
  assert.equal(result.resources[0].sourceNodeId, 'node-a');
  assert.equal(result.resources[0].freshness, 'live');
  assert.equal(result.resources[0].transport, 'tailscale');
});

test('D4-B2 remote requests carry the team-policy bit into idempotency and receiver checks', () => {
  const base = {
    requesterNodeId: 'node-b',
    targetNodeId: 'node-a',
    bindingId: 'binding-1',
    scopeType: 'student',
    scopeId: 'student-a',
    queryType: 'context_bundle',
    query: 'TEAM-REMOTE-X1',
  };
  const ordinary = normalizeRemoteArchiveRequest(base);
  const team = normalizeRemoteArchiveRequest({
    ...base,
    scopeType: 'team',
    scopeId: 'team',
    searchQueries: ['TEAM-REMOTE-X1', 'REMOTE-X1'],
    studentSelector: 'student-b',
    teamQuery: true,
  });
  assert.equal(team.teamQuery, true);
  assert.equal(team.scopeType, 'team');
  assert.deepEqual(team.searchQueries, ['TEAM-REMOTE-X1', 'REMOTE-X1']);
  assert.equal(team.studentSelector, 'student-b');
  assert.notEqual(stableRemoteArchiveKey(ordinary), stableRemoteArchiveKey(team));
  assert.notEqual(stableRemoteArchiveKey(team), stableRemoteArchiveKey({ ...team, studentSelector: 'student-c' }));
  assert.throws(
    () => normalizeRemoteArchiveRequest({ ...base, scopeType: 'team', scopeId: 'team' }),
    /团队策略标记/,
  );
});

test('D4-B2 is one host-only policy shared by UI HTTP Codex and QClaw', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8');
  const terminalPreload = fs.readFileSync(path.join(__dirname, '..', 'electron', 'terminal-preload.cjs'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.tsx'), 'utf8');
  const mcp = fs.readFileSync(path.join(__dirname, '..', 'electron', 'agent-knowledge-mcp.ps1'), 'utf8');
  assert.match(main, /allowLocalTeamKnowledgeQuery: settings\.allowLocalTeamKnowledgeQuery === true/);
  assert.match(main, /allowRemoteTeamKnowledgeQuery: settings\.allowRemoteTeamKnowledgeQuery === true/);
  assert.match(main, /query\.scopeType === 'team' \? await queryTeamKnowledgeRoute/);
  assert.match(main, /request\.authContext\?\.type !== 'admin'/);
  assert.match(main, /request\.teamQuery && !teamKnowledgePolicy\(\)\.allowRemoteTeamKnowledgeQuery/);
  assert.match(main, /function resolveTeamRemoteHosts/);
  assert.match(main, /\[route\.peerNodeId, route\]/);
  assert.match(main, /scopeType: 'team'/);
  assert.match(main, /invokeIncomingTeamArchive/);
  assert.match(main, /annotateOutgoingTeamArchiveResult/);
  assert.match(main, /studentSelector: query\.student/);
  assert.match(main, /requireExplicitMatch: Boolean\(request\.studentSelector\)/);
  assert.match(main, /teamKnowledgeScopesForStudents/);
  assert.match(main, /scheduleTeamKnowledgeIndexWarmup/);
  assert.match(preload, /bridge:setTeamKnowledgePolicy/);
  assert.match(renderer, /允许本机团队知识查询/);
  assert.match(renderer, /允许远程协作团队知识查询/);
  assert.match(renderer, /edu-manager-agent-knowledge-query-scope/);
  assert.match(renderer, /当前学生及关联项目/);
  assert.match(renderer, /当前允许的全部范围/);
  assert.match(mcp, /if \(\$teamEnabled\) \{\s*\$body\.scopeType = 'team'/);
  assert.match(mcp, /\$body\.queryScope = 'all_allowed'/);
  assert.doesNotMatch(terminalPreload, /setTeamKnowledgePolicy|scopeType\s*=\s*['"]team/);
});
