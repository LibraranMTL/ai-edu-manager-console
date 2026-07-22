const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
const vite = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
const packageJson = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
const cleanDist = fs.readFileSync(path.join(root, 'scripts', 'clean-dist.cjs'), 'utf8');

test('QR generation is loaded only when a QR code is requested', () => {
  assert.doesNotMatch(renderer, /import QRCode from 'qrcode'/);
  assert.match(renderer, /const loadQrCode = \(\) => import\('qrcode'\)/);
  assert.match(renderer, /await loadQrCode\(\)/);
});

test('stable framework and icon dependencies build as cacheable chunks', () => {
  assert.match(vite, /manualChunks\(id\)/);
  assert.match(vite, /return 'vendor-react'/);
  assert.match(vite, /return 'vendor-icons'/);
  assert.match(vite, /return 'feature-qrcode'/);
});

test('dist cleanup removes stale hashed assets with a scoped recursive cleaner', () => {
  assert.match(packageJson, /"clean:dist": "node scripts\/clean-dist\.cjs"/);
  assert.match(cleanDist, /path\.basename\(distPath\) !== 'dist'/);
  assert.match(cleanDist, /fs\.unlinkSync\(target\)/);
  assert.match(cleanDist, /fs\.rmdirSync\(target\)/);
});
