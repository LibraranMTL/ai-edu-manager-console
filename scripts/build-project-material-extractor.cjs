const path = require('node:path');
const fs = require('node:fs');

// Bundle worker dependencies explicitly: the portable runtime intentionally
// ships without node_modules. Keep the relative worker filename unchanged.
function bundleMaterialExtractor(stageRoot, esbuild) {
  const outfile = path.join(stageRoot, 'electron', 'project-material-extract-worker.cjs');
  esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'electron', 'project-material-extract-worker.cjs')],
    outfile, bundle: true, platform: 'node', format: 'cjs', target: 'node24', sourcemap: false,
    minify: false, minifyWhitespace: true, legalComments: 'inline', logLevel: 'warning' });
  if (!fs.statSync(outfile).size) throw new Error('Material extraction worker bundle is empty.');
  return outfile;
}
module.exports = { bundleMaterialExtractor };
