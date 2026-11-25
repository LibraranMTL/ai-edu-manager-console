'use strict';
// Read-only collection. The output contains private source text and belongs in local artifacts.
const fs = require('node:fs');
const path = require('node:path');
const { digest } = require('../electron/smart-inbox-policy.cjs');
const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? '' : args[index + 1]; };
const directory = option('--root'), output = option('--output');
if (!directory || !output) throw Error('Provide --root <inbox directory> and --output <local corpus.json>');
const root = path.resolve(directory), destination = path.resolve(output);
if (destination === root || destination.startsWith(root + path.sep)) throw Error('Evaluation output must be outside the live inbox');
const readRecords = name => fs.readdirSync(path.join(root, name)).filter(file => file.endsWith('.json'))
  .map(file => JSON.parse(fs.readFileSync(path.join(root, name, file), 'utf8')));
const texts = new Map(readRecords('extractions').filter(record => record.sha256 && record.result?.text)
  .map(record => [record.sha256, record.result.text]));
const sources = new Map(readRecords('sources').map(record => [record.id, record]));
const groups = new Map(), seen = new Set();
for (const item of readRecords('items').sort((a, b) => digest(a.id).localeCompare(digest(b.id)))) {
  const text = texts.get(item.fingerprint?.sha256);
  if (!text) continue;
  let conversation;
  try { conversation = JSON.parse(text); } catch { conversation = null; }
  const session = conversation?.sessionId || item.conversationSessionId || item.fingerprint.sha256;
  const groupId = digest(session);
  if (seen.has(groupId)) continue;
  seen.add(groupId);
  const source = sources.get(item.sourceId), stratum = [item.sourceType, item.status, item.reasonCode || 'legacy'].join('/');
  const list = groups.get(stratum) || [];
  list.push({ id: digest([item.id, item.fingerprint.sha256]), groupId,
    split: parseInt(groupId.slice(0, 8), 16) % 10 < 6 ? 'development' : 'held_out', stratum,
    sourceType: item.sourceType, studentId: item.studentId, ownershipBasis: source?.ownershipBasis || 'legacy_scope',
    sourceAutomatic: source?.automatic === true, sha256: item.fingerprint.sha256,
    previousStatus: item.status, previousReason: item.reasonCode || '', previousSuggestion: item.suggestion || null,
    text, expected: null, labelEvidence: '', labelStatus: 'pending' });
  groups.set(stratum, list);
}
const cases = [], limit = Math.max(100, Number(option('--limit')) || 100);
while (cases.length < limit && [...groups.values()].some(list => list.length)) {
  for (const list of groups.values()) if (list.length && cases.length < limit) cases.push(list.shift());
}
if (cases.length < 100) throw Error(`Only ${cases.length} independent readable records available; need 100`);
const corpus = { schema: 'edu-manager.smart-inbox-private-evaluation.v1', collectedAt: new Date().toISOString(),
  sourceDirectory: root, independentCases: cases.length, labeling: 'Developer labels require source evidence; disputed subjects remain pending.', cases };
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, JSON.stringify(corpus, null, 2));
console.log(JSON.stringify({ output: destination, cases: cases.length,
  development: cases.filter(item => item.split === 'development').length, heldOut: cases.filter(item => item.split === 'held_out').length }));
