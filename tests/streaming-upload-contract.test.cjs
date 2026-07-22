const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const windowsTerminal = fs.readFileSync(path.join(root, 'electron', 'terminal-main.cjs'), 'utf8');
const androidTerminal = fs.readFileSync(path.join(root, 'android-tablet-terminal', 'src', 'com', 'qxmatrix', 'eduterminal', 'MainActivity.java'), 'utf8');

test('host raw student and project uploads stream to bounded temporary files', () => {
  assert.match(main, /require\('\.\/streaming-upload\.cjs'\)/);
  assert.match(main, /streamRequestToFile\(request, \{ targetPath: target, maxBytes: MAX_UPLOAD_BYTES, expectedBytes \}\)/);
  assert.match(main, /function readRequestBuffer\(request, maxBytes = MAX_UPLOAD_BYTES \+ 1024 \* 1024\)/);
  assert.doesNotMatch(main, /function readRequestBuffer\(request, maxBytes = 300 \* 1024 \* 1024\)/);
});

test('Windows and Android terminals use raw streaming uploads', () => {
  assert.match(windowsTerminal, /'Content-Type': 'application\/octet-stream'/);
  assert.match(windowsTerminal, /fs\.createReadStream\(filePath\)/);
  assert.match(androidTerminal, /setRequestProperty\("Content-Type", "application\/octet-stream"\)/);
  assert.match(androidTerminal, /setChunkedStreamingMode\(16384\)/);
  const postFileBody = androidTerminal.match(/JSONObject postFile\([\s\S]*?\n    \}/)?.[0] || '';
  assert.doesNotMatch(postFileBody, /multipart\/form-data|Content-Disposition/);
});

test('host keeps bounded multipart parsing for older terminal versions', () => {
  assert.match(main, /parseMultipartFiles\(await readRequestBuffer\(request\), contentType\)/);
  assert.match(main, /const buffer = await readRequestBuffer\(request\);/);
  assert.match(main, /parseMultipartFiles\(buffer, contentType\)/);
});
