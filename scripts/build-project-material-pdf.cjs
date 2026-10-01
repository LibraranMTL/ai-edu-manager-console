const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');

function filesUnder(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error('PDF runtime staging must not contain links.');
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}
function stagePdfRuntime(stageRoot) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('The current PDF release target is Windows x64.');
  const root = path.join(stageRoot, 'material-pdf-runtime');
  const pdf = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const canvas = path.dirname(require.resolve('@napi-rs/canvas/package.json'));
  const native = createRequire(path.join(canvas, 'package.json')).resolve('@napi-rs/canvas-win32-x64-msvc');
  function copy(source, relative) {
    const target = path.join(root, relative); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  for (const name of ['pdf.mjs', 'pdf.worker.mjs']) copy(path.join(pdf, 'legacy', 'build', name), `pdfjs/legacy/build/${name}`);
  for (const dir of ['cmaps', 'standard_fonts', 'wasm']) {
    for (const file of filesUnder(path.join(pdf, dir))) copy(file, path.join('pdfjs', dir, path.relative(path.join(pdf, dir), file)));
  }
  for (const name of ['LICENSE', 'package.json']) copy(path.join(pdf, name), `pdfjs/${name}`);
  // PDF.js resolves this one explicitly pinned native renderer package using
  // normal Node resolution. It is isolated from the app.asar runtime and is
  // shipped as an audited extraResource, never installed on the user's PC.
  // Keep the audited native renderer outside a directory named node_modules.
  // electron-builder applies dependency pruning rules to nested node_modules
  // folders even when they are supplied through extraResources, which would
  // otherwise silently remove this runtime from the packaged application.
  for (const name of ['index.js', 'geometry.js', 'js-binding.js', 'load-image.js', 'package.json', 'LICENSE']) {
    copy(path.join(canvas, name), `canvas/${name}`);
  }
  copy(native, 'canvas/skia.win32-x64-msvc.node');
  const entries = filesUnder(root).map((file) => ({ path: path.relative(root, file).replaceAll('\\', '/'),
    size: fs.statSync(file).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }));
  const bytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (bytes > 64 * 1024 * 1024) throw new Error('PDF runtime exceeds its 64 MiB audited budget.');
  const manifest = { schema: 'edu-manager.pdf-runtime.v1', pdfjs: '6.3.289', canvas: '1.0.9', platform: 'win32-x64', bytes, entries };
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return root;
}
function auditPdfRuntime(root, expectedRoot) {
  const manifest = JSON.parse(fs.readFileSync(path.join(expectedRoot, 'manifest.json')));
  const allowed = new Set(['manifest.json', ...manifest.entries.map((entry) => entry.path)]);
  for (const file of filesUnder(root)) {
    if (!allowed.has(path.relative(root, file).replaceAll('\\', '/'))) throw new Error(`Unexpected PDF runtime file: ${file}`);
  }
  for (const entry of manifest.entries) {
    const data = fs.readFileSync(path.join(root, entry.path));
    if (data.length !== entry.size || crypto.createHash('sha256').update(data).digest('hex') !== entry.sha256) throw new Error(`PDF runtime mismatch: ${entry.path}`);
  }
  if (!fs.readFileSync(path.join(root, 'manifest.json')).equals(fs.readFileSync(path.join(expectedRoot, 'manifest.json')))) throw new Error('PDF runtime manifest mismatch.');
  return { bytes: manifest.bytes, files: manifest.entries.length, pdfjs: manifest.pdfjs, canvas: manifest.canvas };
}
module.exports = { stagePdfRuntime, auditPdfRuntime };
