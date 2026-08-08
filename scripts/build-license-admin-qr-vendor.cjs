const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const repoRoot = path.resolve(__dirname, '..');
const vitePackage = require.resolve('vite/package.json', { paths: [repoRoot] });
const viteRequire = createRequire(vitePackage);
const esbuild = viteRequire('esbuild');
const entry = require.resolve('qrcode/lib/browser.js', { paths: [repoRoot] });
const outfile = path.join(repoRoot, 'tools', 'license-admin-app', 'renderer', 'qrcode.bundle.js');

esbuild.buildSync({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'browser',
  format: 'iife',
  globalName: 'QRCode',
  legalComments: 'inline',
  banner: { js: '/* qrcode 1.5.4 (MIT) - bundled locally for offline License v3 QR generation. */' },
});

if (!fs.existsSync(outfile) || fs.statSync(outfile).size < 10_000) {
  throw new Error('License Admin QR vendor bundle was not generated correctly.');
}
process.stdout.write(`Generated ${path.relative(repoRoot, outfile)}\n`);
