const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const main = fs.readFileSync(path.resolve(__dirname, '..', 'electron', 'main.cjs'), 'utf8');

for (const functionName of [
  'writeSettings',
  'writeHostIdentity',
  'writePairRequests',
  'writeDevices',
  'writeUploadRecords',
  'writeStudentMaterials',
  'writeHostTimeline',
  'writeCaptureStore',
  'writeJsonFile',
  'writeStudentsIndex',
]) {
  test(`${functionName} persists JSON through the atomic writer`, () => {
    const body = main.match(new RegExp(`function ${functionName}\\([^)]*\\) \\{([\\s\\S]*?)\\n\\}`))?.[1] || '';
    assert.match(body, /writeJsonAtomic\(/);
    assert.doesNotMatch(body, /fs\.writeFileSync\(/);
  });
}

test('writeProjects persists production data through SQLite without rewriting projects.json', () => {
  const body = main.match(/function writeProjects\([^)]*\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(body, /projectStateStore\(\)\.replaceAll\(projects\)/);
  assert.doesNotMatch(body, /fs\.writeFileSync\(/);
  assert.doesNotMatch(body, /writeJsonAtomic\(/);
});

test('writeAssetIndex persists production data through SQLite and keeps virtual transaction writes atomic', () => {
  const body = main.match(/function writeAssetIndex\([^)]*\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(body, /assetStore\(\)\.replaceAll\(assets\)/);
  assert.match(body, /writeJsonAtomic\(assetIndexPath\(\), payload\)/);
});

test('student and project digest state replacement is atomic', () => {
  const studentBody = main.match(/function writeStudentDigestState\([^)]*\) \{([\s\S]*?)\n\}/)?.[1] || '';
  const projectBody = main.match(/function writeProjectDigestState\([^)]*\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(studentBody, /writeJsonAtomic\(studentDigestStatePath\(student\), next\)/);
  assert.match(projectBody, /writeJsonAtomic\(projectDigestStatePath\(\{ \.\.\.project, \.\.\.paths \}\), next\)/);
});
