'use strict';
// Read-only inventory of two isolated release stages. No pruning/deletion.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
function inventory(root) {
  const files = [];
  function visit(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isSymbolicLink()) throw Error('Inventory does not follow links');
      const file = path.join(dir, e.name);
      if (e.isDirectory()) visit(file);
      else if (e.isFile()) files.push({ path: path.relative(root, file).replaceAll('\\', '/'), bytes: fs.statSync(file).size,
        sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') });
    }
  }
  visit(root); return files;
}
function audit(beforeRoot, afterRoot) {
  const before = inventory(path.join(beforeRoot, 'out/win-unpacked')), after = inventory(path.join(afterRoot, 'out/win-unpacked'));
  const old = new Map(before.map(f => [f.path, f])), current = new Map(after.map(f => [f.path, f]));
  const protectedFiles = before.filter(f => !['AI Education Manager Console.exe', 'resources/app.asar'].includes(f.path));
  const mismatches = protectedFiles.filter(f => !current.has(f.path) || current.get(f.path).sha256 !== f.sha256).map(f => f.path);
  const duplicate = new Map(); for (const f of after) { const group = duplicate.get(f.sha256) || []; group.push(f); duplicate.set(f.sha256, group); }
  const bundled = ['course-custom-import.cjs', 'project-material-extract-worker.cjs', 'practice-rich-text.mjs', 'external-agent-lifecycle.cjs'].map(name => {
    const previous = fs.statSync(path.join(beforeRoot, 'electron', name)).size, bytes = fs.statSync(path.join(afterRoot, 'electron', name)).size;
    return { name, before: previous, after: bytes, saved: previous - bytes };
  });
  const applicationChanges = {};
  for (const folder of ['electron', 'dist']) {
    const prev = new Map(inventory(path.join(beforeRoot, folder)).map(f => [f.path, f]));
    const next = new Map(inventory(path.join(afterRoot, folder)).map(f => [f.path, f]));
    applicationChanges[folder] = { removed: [...prev.keys()].filter(n => !next.has(n)), added: [...next.keys()].filter(n => !prev.has(n)),
      modified: [...prev.keys()].filter(n => next.has(n) && prev.get(n).sha256 !== next.get(n).sha256), unchanged: [...prev.keys()].filter(n => next.has(n) && prev.get(n).sha256 === next.get(n).sha256).length };
  }
  return { schema: 'edu-manager.package-size-audit.v1', beforeRoot, afterRoot,
    uncompressedBefore: before.reduce((n, f) => n + f.bytes, 0), uncompressedAfter: after.reduce((n, f) => n + f.bytes, 0),
    asarBefore: old.get('resources/app.asar').bytes, asarAfter: current.get('resources/app.asar').bytes,
    protectedRuntimeFileCount: protectedFiles.length, protectedRuntimeIdentical: !mismatches.length, mismatches, bundled, applicationChanges,
    largestFiles: [...after].sort((a, b) => b.bytes - a.bytes).slice(0, 20), duplicateFiles: [...duplicate.values()].filter(g => g.length > 1),
    decision: 'Keep Electron graphics/media, all approved locales, PDF/OCR native runtimes and licenses. Only JS whitespace compression and maximum installer compression.' };
}
if (require.main === module) {
  const result = audit(path.resolve(process.argv[2]), path.resolve(process.argv[3]));
  if (process.argv[4]) fs.writeFileSync(path.resolve(process.argv[4]), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result)); if (!result.protectedRuntimeIdentical) process.exitCode = 1;
}
module.exports = { audit, inventory };
