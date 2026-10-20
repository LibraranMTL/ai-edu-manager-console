'use strict';
const path = require('node:path');

function bundleSkillArchiveRuntime(repoRoot, stageRoot, esbuild) {
  // Windows ships without node_modules; include yauzl and all transitive code.
  esbuild.buildSync({
    entryPoints: [path.join(repoRoot, 'electron', 'skill-archive-extractor.cjs')],
    outfile: path.join(stageRoot, 'electron', 'skill-archive-extractor.cjs'),
    bundle: true, platform: 'node', format: 'cjs', target: 'node20',
    sourcemap: false, minify: false, minifyWhitespace: true, legalComments: 'inline',
    external: ['electron'], logLevel: 'warning',
  });
}

module.exports = { bundleSkillArchiveRuntime };
