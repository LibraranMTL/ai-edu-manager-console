const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const androidMain = path.join(root, 'android-standalone-manager', 'app', 'src', 'main');
const androidJava = path.join(androidMain, 'java', 'com', 'qxmatrix', 'edumanager', 'standalone');
const read = (file) => fs.readFileSync(file, 'utf8');

test('License Admin preserves offline License v3 QR images alongside online batches', () => {
  const packageJson = JSON.parse(read(path.join(root, 'tools', 'license-admin-app', 'package.json')));
  const html = read(path.join(root, 'tools', 'license-admin-app', 'renderer', 'index.html'));
  const renderer = read(path.join(root, 'tools', 'license-admin-app', 'renderer', 'renderer.js'));
  const preload = read(path.join(root, 'tools', 'license-admin-app', 'preload.cjs'));
  const main = read(path.join(root, 'tools', 'license-admin-app', 'main.cjs'));
  const bundle = path.join(root, 'tools', 'license-admin-app', 'renderer', 'qrcode.bundle.js');
  assert.equal(packageJson.version, '0.5.0');
  assert.match(html, /qrcode\.bundle\.js/);
  assert.match(html, /显示二维码/);
  assert.match(html, /保存二维码图片/);
  assert.match(renderer, /QRCode\.toDataURL/);
  assert.match(renderer, /errorCorrectionLevel: 'M'/);
  assert.match(renderer, /data-action="qr"/);
  assert.match(preload, /saveQr\(dataUrl, suggestedName\)/);
  assert.match(main, /data:image\\\/png;base64/);
  assert.match(main, /pngSignature/);
  assert.match(main, /showSaveDialogSync/);
  assert.equal(fs.existsSync(bundle), true);
  assert.ok(fs.statSync(bundle).size > 10_000);
});

test('Android standalone supports camera and gallery QR activation without a server', () => {
  const manifest = read(path.join(androidMain, 'AndroidManifest.xml'));
  const build = read(path.join(root, 'android-standalone-manager', 'app', 'build.gradle.kts'));
  const main = read(path.join(androidJava, 'MainActivity.kt'));
  const scanner = read(path.join(androidJava, 'LicenseQrScannerActivity.kt'));
  const payload = read(path.join(androidJava, 'LicenseQrPayload.kt'));
  assert.match(manifest, /android\.permission\.CAMERA/);
  assert.match(manifest, /android\.hardware\.camera\.any" android:required="false"/);
  assert.match(manifest, /\.LicenseQrScannerActivity/);
  assert.match(build, /com\.google\.mlkit:barcode-scanning/);
  assert.match(build, /androidx\.camera:camera-camera2/);
  assert.match(main, /themedButton\("扫码激活"\)/);
  assert.match(main, /themedButton\("从相册识别二维码"\)/);
  assert.match(main, /InputImage\.fromFilePath/);
  assert.match(main, /确认激活 Android 单机版/);
  assert.match(main, /runProductActivation\(token\)/);
  assert.match(main, /licenseManager\.activate\(code\)/);
  assert.match(scanner, /ImageAnalysis\.STRATEGY_KEEP_ONLY_LATEST/);
  assert.match(scanner, /Barcode\.FORMAT_QR_CODE/);
  assert.match(scanner, /识别过程完全在本机完成/);
  assert.doesNotMatch(scanner, /http:|https:|Socket|URLConnection/);
  assert.match(payload, /token\.startsWith\("AIE3\."\)/);
  assert.match(payload, /token\.any \{ it\.isWhitespace\(\) \}/);
});
