const fs = require('node:fs');
const { createRequire } = require('node:module');
const parse = createRequire(require.resolve('vite'))('rollup/parseAst').parseAst;
const source = fs.readFileSync('electron/main.cjs', 'utf8');
const root = parse(source);
const functions = [], calls = [];
function walk(node, owner, parent) {
  if (!node || typeof node !== 'object') return;
  if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) {
    owner = { node, parent, name: node.id?.name || (parent?.type === 'VariableDeclarator' ? parent.id.name : ''), owner };
    functions.push(owner);
  }
  if (node.type === 'CallExpression' && node.callee.type === 'Identifier') calls.push({ node, owner, name: node.callee.name });
  for (const [key, child] of Object.entries(node)) {
    if (key === 'parent') continue;
    if (Array.isArray(child)) child.forEach(n => walk(n, owner, node));
    else if (child && typeof child === 'object') walk(child, owner, node);
  }
}
walk(root);
const asyncNames = new Set(['writeTaskStore']), changed = new Set();
for (let again = true; again;) {
  again = false;
  for (const call of calls) if (asyncNames.has(call.name) && call.owner && !changed.has(call.owner)) {
    changed.add(call.owner);
    if (call.owner.name && !asyncNames.has(call.owner.name)) { asyncNames.add(call.owner.name); again = true; }
  }
}
console.log(JSON.stringify({ functions: changed.size, named: [...asyncNames], anonymous: [...changed].filter(f => !f.name).map(f => ({ line: source.slice(0, f.node.start).split('\n').length, parent: f.parent?.type, in: f.owner?.name })) }, null, 2));
