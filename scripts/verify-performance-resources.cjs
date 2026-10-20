'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const pnpm = path.join(root, 'node_modules/.pnpm');
const asar = require(path.join(pnpm, fs.readdirSync(pnpm).find(n => n.startsWith('@electron+asar@')), 'node_modules/@electron/asar'));
const { compactPng } = require('./compact-png-resources.cjs');
const [baselineRoot, candidateRoot, output] = process.argv.slice(2).map(p => path.resolve(p));
assert.ok(baselineRoot && candidateRoot && output, 'baseline stage, candidate stage, output required');
function inventory(root) {
  return fs.readdirSync(root, { recursive: true }).filter(n => fs.statSync(path.join(root, n)).isFile()).map(n => n.replaceAll('\\', '/')).sort();
}
const baseline = path.join(baselineRoot, 'out/win-unpacked'), candidate = path.join(candidateRoot, 'out/win-unpacked');
const before = inventory(baseline), after = inventory(candidate);
assert.deepEqual(after, before, 'all loose runtime resources retained');
const allowedChanges = ['AI Education Manager Console.exe', 'resources/app.asar', 'resources/material-pdf-runtime/manifest.json',
  'resources/material-pdf-runtime/pdfjs/legacy/build/pdf.mjs', 'resources/material-pdf-runtime/pdfjs/legacy/build/pdf.worker.mjs'];
const changed = after.filter(n => !fs.readFileSync(path.join(baseline, n)).equals(fs.readFileSync(path.join(candidate, n))));
assert.ok(changed.every(n => allowedChanges.includes(n)), 'unexpected loose resource modification');
const oldAsar = path.join(baseline, 'resources/app.asar'), newAsar = path.join(candidate, 'resources/app.asar');
const runtimeEntries = file => asar.listPackage(file).map(n => n.replaceAll('\\', '/')).filter(n => n.startsWith('/electron/')).sort();
const oldEntries = runtimeEntries(oldAsar), newEntries = runtimeEntries(newAsar);
assert.ok(oldEntries.length > 100); assert.deepEqual(newEntries, oldEntries, 'all Electron app runtime files retained');
let pngFilesVerified = 0;
for (const name of inventory(path.join(candidateRoot, 'dist')).filter(n => n.endsWith('.png'))) {
  const expected = compactPng(fs.readFileSync(path.join(baselineRoot, 'dist', name)));
  assert.ok(asar.extractFile(newAsar, path.join('dist', name)).equals(expected), `packaged PNG preservation: ${name}`);
  pngFilesVerified++;
}
const report = { verifiedAt: new Date().toISOString(), baselineRoot, candidateRoot, looseRuntimeFiles: after.length,
  changedLooseFiles: changed, electronRuntimeEntries: newEntries.length, pngFilesVerified,
  missingFiles: [], unchangedNativeFontsLocalesAndLegalFiles: true, pngScanlinesMetadataAndTrailerPreserved: true };
fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
