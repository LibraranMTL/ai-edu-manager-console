'use strict';
const fs = require('node:fs');
const path = require('node:path');
function compactRuntimeSource(source, esbuild) {
  return esbuild.transformSync(source, { loader: 'js', minifyWhitespace: true,
    minifyIdentifiers: false, minifySyntax: false, legalComments: 'inline', charset: 'utf8' }).code;
}
function compactWindowsRuntime(stageRoot, esbuild) {
  const audit = { files: 0, beforeBytes: 0, afterBytes: 0, identifiersPreserved: true, syntaxOptimizations: false };
  for (const folder of ['electron', 'cloud-report-service']) {
    const root = path.join(stageRoot, folder);
    if (!fs.existsSync(root)) continue;
    for (const name of fs.readdirSync(root, { recursive: true })) {
      const target = path.join(root, name);
      if (!name.endsWith('.cjs') || !fs.statSync(target).isFile()) continue;
      // Keep trust policy source literal for the independent license-closure audit.
      if (path.basename(name) === 'license-trust-store.cjs') continue;
      const source = fs.readFileSync(target, 'utf8'), result = compactRuntimeSource(source, esbuild);
      audit.files++; audit.beforeBytes += Buffer.byteLength(source); audit.afterBytes += Buffer.byteLength(result);
      fs.writeFileSync(target, result);
    }
  }
  return audit;
}
module.exports = { compactRuntimeSource, compactWindowsRuntime };
