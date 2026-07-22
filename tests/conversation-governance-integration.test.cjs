const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

function functionBody(name, nextName) {
  const start = main.indexOf(`function ${name}`);
  const end = main.indexOf(`function ${nextName}`, start + 1);
  assert.ok(start >= 0 && end > start, `missing function boundary for ${name}`);
  return main.slice(start, end);
}

test('AI conversation extraction creates candidates and cannot append directly to formal knowledge', () => {
  const body = functionBody('saveConversationExtract', 'updateConversationKnowledgeCandidate');
  assert.match(body, /buildKnowledgeCandidates\(parsed/);
  assert.match(body, /mergeCandidateRegistry/);
  assert.doesNotMatch(body, /appendTextSection/);
  assert.doesNotMatch(body, /agentMemoryUnifiedPath/);
  assert.doesNotMatch(body, /agentSoulUnifiedPath/);
  assert.match(body, /未写入正式长期知识/);
});

test('Interaction, ConversationAsset and duplicate-safe immutable import are connected', () => {
  const body = functionBody('saveAgentConversationImport', 'selectAgentConversationFiles');
  assert.match(body, /normalizeConversationImport/);
  assert.match(body, /normalized\.interaction\.id/);
  assert.match(body, /normalized\.asset\.id/);
  assert.match(body, /deduplicated: true/);
  assert.match(body, /相同对话已经导入/);
});

test('candidate governance, promotion transaction, rollback and multi-source envelope cross the Electron bridge', () => {
  for (const method of [
    'updateConversationKnowledgeCandidate',
    'promoteConversationKnowledgeCandidates',
    'rollbackConversationPromotion',
    'ingestKnowledgeCandidateEnvelope',
  ]) {
    assert.match(main, new RegExp(`bridge:${method}`));
    assert.match(preload, new RegExp(`${method}\\(`));
    assert.match(ui, new RegExp(`${method}\\?`));
  }
  assert.match(main, /applyPromotionTransaction/);
  assert.match(main, /rollbackPromotionTransaction/);
  assert.match(main, /new Set\(\['conversation', 'screenshot', 'web', 'agent_result', 'manual'\]\)/);
});

test('ordinary UI exposes item-level evidence, conflicts, promotion and true transaction undo', () => {
  assert.match(ui, /P2 逐条候选治理/);
  assert.match(ui, /原文：/);
  assert.match(ui, /定位：/);
  assert.match(ui, />编辑与补证</);
  assert.match(ui, />标记冲突</);
  assert.match(ui, />事务晋升所选</);
  assert.match(ui, />撤销本次晋升</);
  assert.match(ui, /new Set\(selectedConversationCandidateIds\)/);
});
