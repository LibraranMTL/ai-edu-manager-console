const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
test('download inbox APIs are async, licensed and use host confirmation / system recycle', () => {
  const main = read('electron/main.cjs'), preload = read('electron/preload.cjs');
  for (const method of ['getDownloadInboxSettings', 'configureDownloadInbox', 'listDownloadInboxFiles', 'deliverDownloadInboxFiles', 'trashDownloadInboxFiles', 'openDownloadInboxFolder']) {
    assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\('bridge:${method}'`));
    assert.match(main, new RegExp(`ipcMain\\.handle\\('bridge:${method}'[^\\n]+licensedInvoke`));
  }
  assert.match(main, /dialog\.showMessageBox[\s\S]*移入 Windows 回收站/); assert.match(main, /shell\.trashItem\(file\)/);
  assert.match(main, /knownFingerprint: operation\.fingerprint/);
  assert.match(main, /project\.studentIds\?\.map\(String\)\.includes/);
});
test('download public view stays reachable without a student and shares retain their original scope', () => {
  const main = read('src/main.tsx'), panel = read('src/DownloadInboxPanel.tsx');
  assert.match(main, /activeSection === 'share-capture' && \(/);
  assert.match(main, /label: '资料收件箱', section: 'share-capture'/);
  assert.match(main, /React\.lazy\(\(\) => import\('\.\/DownloadInboxPanel'\)/);
  assert.match(panel, /useState<'downloads' \| 'shares'>\('downloads'\)/);
  assert.match(panel, /CaptureInboxPanel key=\{`\$\{studentId\}:\$\{openSharesRequest\}`\}/);
  assert.match(panel, /useEffect\([^\n]+\[studentId\]/);
  assert.match(panel, /全选当前页/); assert.match(panel, /上一页/); assert.match(panel, /请选择学生/);
  assert.doesNotMatch(panel, /setInterval|watch\(/);
});
