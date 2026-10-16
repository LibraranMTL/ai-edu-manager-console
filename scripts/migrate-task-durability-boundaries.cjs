// One-time mechanical migration, restricted to reviewed execution boundaries.
const fs = require('node:fs');
const { createRequire } = require('node:module');
const { parseAst } = createRequire(require.resolve('vite'))('rollup/parseAst');
const file = 'electron/main.cjs', raw = fs.readFileSync(file, 'utf8'), source = raw.replace(/^\uFEFF/, ''), ast = parseAst(source);
const selected = new Set(['launchCommandAdapter', 'submitProjectMaterialTask', 'submitWorkBuddyTask', 'submitModernAgentTask',
  'submitQClawInboxTask', 'submitQClawTask', 'submitManualTask', 'submitAgentHandoffTask', 'submitInternalTask', 'submitResearchTask',
  'executeTaskByAdapterCore', 'finalizeAdapterExecution', 'detectWorkBuddyBackgroundAuthorization']);
const awaited = new Set(['launchCommandAdapter','submitProjectMaterialTask','submitWorkBuddyTask','submitQClawInboxTask',
  'submitManualTask','submitAgentHandoffTask','submitResearchTask','submitCompetitionResearchTask','submitGuidanceResearchTask','finalizeAdapterExecution']);
const edits = [], asyncOwners = new Set();
function walk(node, owners = [], parent) {
  if (!node || typeof node !== 'object') return;
  if (['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type)) owners = [...owners, node];
  const inside = owners.some(n => selected.has(n.id?.name));
  if (inside && node.type === 'CallExpression' && node.callee.type === 'Identifier') {
    if (node.callee.name === 'writeTaskStore') {
      edits.push([node.callee.start, node.callee.end, 'writeTaskStoreDurably']);
      if (parent?.type !== 'AwaitExpression') { edits.push([node.start,node.start,'(await '], [node.end,node.end,')']); asyncOwners.add(owners.at(-1)); }
    } else if (awaited.has(node.callee.name) && parent?.type !== 'AwaitExpression') {
      edits.push([node.start,node.start,'(await '], [node.end,node.end,')']); asyncOwners.add(owners.at(-1));
    }
  }
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) child.forEach(n => walk(n, owners, node));
    else if (child && typeof child === 'object') walk(child, owners, node);
  }
}
walk(ast);
for (const node of asyncOwners) if (!node.async) edits.push([node.start,node.start,'async ']);
let output = source;
for (const [start,end,text] of edits.sort((a,b) => b[0]-a[0] || b[1]-a[1])) output = output.slice(0,start)+text+output.slice(end);
try { parseAst(output); } catch (error) { console.error(output.slice(error.pos - 240, error.pos + 240)); throw error; }
fs.writeFileSync(file, (raw.startsWith('\uFEFF') ? '\uFEFF' : '') + output);
console.log(`Migrated ${edits.length} syntax edits across ${asyncOwners.size} durability boundaries.`);
