const fs = require('node:fs');
const path = require('node:path');
function bundlePracticeRuntime(stageRoot, esbuild, {minify=false} = {}) {
  const root = path.resolve(__dirname, '..');
  esbuild.buildSync({ entryPoints: [path.join(root, 'electron/practice-rich-text.mjs')], outfile: path.join(stageRoot, 'electron/practice-rich-text.mjs'),
    bundle: true, minify, minifyWhitespace: true, legalComments: 'inline', platform: 'node', format: 'esm', target: 'node22', logLevel: 'warning' });
  const css = require.resolve('katex/dist/katex.min.css');
  const destination = path.join(stageRoot, 'electron/practice-katex');
  fs.mkdirSync(path.join(destination, 'fonts'), { recursive: true });
  fs.copyFileSync(css, path.join(destination, 'katex.min.css'));
  for (const name of fs.readdirSync(path.join(path.dirname(css), 'fonts'))) {
    if (/^KaTeX_[A-Za-z0-9_-]+\.(woff2?|ttf)$/.test(name)) fs.copyFileSync(path.join(path.dirname(css), 'fonts', name), path.join(destination, 'fonts', name));
  }
}
module.exports = { bundlePracticeRuntime };
