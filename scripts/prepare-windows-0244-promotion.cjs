'use strict';
// Promote the approved r2, with a separately verified version-code-only correction.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const root = path.join(repo, 'artifacts/windows-0244-promotion');
const output = path.join(root, 'publish');
const candidateTag = process.argv[2] || '0.24.4-self-activation-r2';
assert.ok(['0.24.4-self-activation-r2','0.24.4-corrective-self-activation-release-r1'].includes(candidateTag));
const candidate = path.join(repo, 'release/windows/candidates',candidateTag);
const basename = 'AI-edu-manager-console-Windows-0.24.4';
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const audit = read(path.join(candidate, basename + '-' + candidateTag + '-build-audit.json'));
const installer = read(path.join(candidate, 'installer/installer-audit.json'));
const verified = read(path.join(candidate, 'installer/payload-verification.json'));
const qa = read('D:/AI-Education-Manager/acceptance/activation-isolated-20261125-1795585539648/result.json');
assert.equal(qa.versions.windows, '0.24.4-self-activation-r2');
assert.ok(Object.values(qa.checks).every(value => value === true));
assert.ok(Object.values(qa.protection).every(value => value === true));
if(candidateTag==='0.24.4-self-activation-r2')assert.equal(installer.runtimeAsarSha256.toLowerCase(), qa.provenance.windowsAsarSha256.toLowerCase());
else {
  const compared=read(path.join(root,'runtime-comparison.json'));
  assert.equal(compared.passed,true);
  assert.equal(compared.oldAsarSha256,qa.provenance.windowsAsarSha256.toLowerCase());
  assert.equal(compared.newAsarSha256,installer.runtimeAsarSha256.toLowerCase());
  const corrected=read(path.join(root,'corrective-ui-acceptance.json'));assert.equal(corrected.passed,true);assert.equal(corrected.currentVersionCode,283);
}
assert.equal(verified.exactRuntimePayloadMatch, true);
assert.equal(verified.installerSha256, sha(installer.installer.path));
assert.equal(sha(audit.artifacts.exe.path), audit.artifacts.exe.sha256);
assert.equal(sha(installer.sourcePortable.path), sha(audit.artifacts.exe.path));
fs.mkdirSync(output, { recursive: true });
fs.copyFileSync(audit.artifacts.exe.path, path.join(output, basename + '.exe'));
fs.copyFileSync(installer.installer.path, path.join(output, basename + '-Setup.exe'));
const cache = path.join(process.env.LOCALAPPDATA, 'electron-builder/Cache/7zip@1.0.0');
const sevenZip = fs.readdirSync(cache).map(name => path.join(cache, name, 'bin/7za.exe')).find(file => fs.existsSync(file));
assert.ok(sevenZip, 'cached 7za required');
const zip = path.join(output, basename + '.zip');
assert.ok(!fs.existsSync(zip), 'refuse to overwrite an existing promotion ZIP');
execFileSync(sevenZip, ['a', '-tzip', '-mx=0', zip, basename + '.exe'], { cwd: output, windowsHide: true, stdio: 'pipe' });
const extracted = path.join(root, 'zip-verification');
execFileSync(sevenZip, ['x', zip, '-o' + extracted, '-y'], { windowsHide: true, stdio: 'pipe' });
assert.equal(sha(path.join(extracted, basename + '.exe')), sha(audit.artifacts.exe.path));
const oldManifest = read(path.join(root, 'before/download-manifest.json'));
assert.equal(oldManifest.windowsVersionName, '0.24.3');
assert.equal(oldManifest.windowsVersionCode, 282);
const next = { ...oldManifest,
  windowsVersionCode: 283, windowsVersionName: '0.24.4', windowsReleaseStatus: 'stable',
  windowsUrl: 'https://www.greatbg.com/download/' + basename + '.zip',
  windowsInstallerUrl: 'https://www.greatbg.com/download/' + basename + '-Setup.exe',
  windowsPortableUrl: 'https://www.greatbg.com/download/' + basename + '.exe',
  windowsNotes: '新增联网自助激活，无需发送设备码；保留原设备码授权和同设备恢复。资料收件箱支持确定性自动回收、分类与投递回执恢复，原件及有效证据保留。Windows程序未进行Authenticode签名。',
  windowsSha256: sha(zip), windowsInstallerSha256: sha(path.join(output, basename + '-Setup.exe')),
  windowsPortableSha256: sha(path.join(output, basename + '.exe')),
  notes: String(oldManifest.notes || '').replace('Windows 主机端 0.24.3', 'Windows 主机端 0.24.4'),
};
for (const key of Object.keys(oldManifest)) if (!key.startsWith('windows') && key !== 'notes') assert.deepEqual(next[key], oldManifest[key], key);
assert.equal(next.standaloneVersionName, '1.3.8');
const manifestText = JSON.stringify(next, null, 2) + '\n';
for (const relative of ['release/edu-manager-version.json', 'release/windows/edu-manager-version.json', 'release/网站文件/edu-manager-version.json']) {
  fs.writeFileSync(path.join(repo, relative), manifestText);
}
fs.writeFileSync(path.join(output, 'edu-manager-version.json'), manifestText);
const pageFile = path.join(repo, 'release/网站文件/download.html');
let html = fs.readFileSync(pageFile, 'utf8');
assert.ok(html.includes('Windows-0.24.3-Setup.exe') || html.includes('Windows-0.24.4-Setup.exe'));
if (!html.includes('v0.24.4 · 自助激活与智能收件箱')) html = html.replaceAll('AI-edu-manager-console-Windows-0.24.3', basename)
  .replace('v0.24.3 · 专注模式', 'v0.24.4 · 自助激活与智能收件箱')
  .replace('专注模式可通过已授权的 Codex 或 WorkBuddy 请求开启，由本机管理密码确认。支持本机应用限制、网站规则和屏幕采集密码保护。Edge 和 Chrome 首次接入时在浏览器确认扩展目录，之后重启浏览器可保留扩展。',
    '购买激活码后，安装并在许可证授权页输入即可联网自助激活，无需发送设备码；原设备码授权继续支持。资料收件箱可自动归集，确定无业务内容的资料自动回收并保留30天，分类和投递异常继续核验恢复。用户原件、有效证据和正式成果保持保留。');
const rollback = `\n            <details><summary>上一正式版 0.24.3 · 回退下载</summary><p>回退前请备份资料和授权。0.24.3不支持新的自助激活码，使用新授权的客户回退前请先联系售后核验。</p><p><a href="../download/AI-edu-manager-console-Windows-0.24.3-Setup.exe">0.24.3安装版</a> · <a href="../download/AI-edu-manager-console-Windows-0.24.3.exe">0.24.3便携版</a> · <a href="../download/AI-edu-manager-console-Windows-0.24.3.zip">0.24.3 ZIP</a></p></details>`;
const cardStart = html.indexOf('<h2>Windows 主机端</h2>');
const cardEnd = html.indexOf('</article>', cardStart);
assert.ok(cardStart >= 0 && cardEnd > cardStart);
if(!html.includes('上一正式版 0.24.3'))html = html.slice(0, cardEnd) + rollback + '\n          ' + html.slice(cardEnd);
assert.ok(html.includes('../download/AI-edu-manager-console-Windows-0.24.3-Setup.exe'), 'rollback installer must retain previous version');
assert.ok(!html.includes('AI-edu-license-admin-Windows-0.5.0'));
assert.ok(!html.includes('Android-Standalone-1.3.9'));
fs.writeFileSync(pageFile, html);
fs.copyFileSync(pageFile, path.join(output, 'download.html'));
for (const name of ['windows-host-manual.html', 'windows-manual.html']) fs.copyFileSync(path.join(repo, 'release/网站文件', name), path.join(output, name));
for (const name of [basename + '.exe', basename + '.zip', basename + '-Setup.exe']) {
  for (const dir of ['release/windows', 'release/download']) {
    fs.mkdirSync(path.join(repo, dir), { recursive: true });
    const target = path.join(repo, dir, name);
    assert.ok(!fs.existsSync(target), 'formal name already exists: ' + target);
    fs.copyFileSync(path.join(output, name), target);
  }
}
const mappings = [
  ...[basename + '.exe', basename + '.zip', basename + '-Setup.exe'].map(name => ({ name, target: 'download/' + name })),
  {name: 'edu-manager-version.json', target: 'download/edu-manager-version.json'},
  {name: 'edu-manager-version.json', target: 'education/edu-manager-version.json'},
  {name: 'download.html', target: 'education/download.html'},
  {name: 'windows-host-manual.html', target: 'education/windows-host-manual.html'},
  {name: 'windows-manual.html', target: 'education/windows-manual.html'},
];
const inventory = mappings.map(row => ({...row, bytes: fs.statSync(path.join(output, row.name)).size, sha256: sha(path.join(output, row.name))}));
fs.writeFileSync(path.join(output, 'inventory.json'), JSON.stringify(inventory, null, 2));
const names = [...new Set(inventory.map(row => row.name))];
fs.writeFileSync(path.join(output, 'SHA256SUMS'), names.map(name => sha(path.join(output, name)).toLowerCase() + '  ' + name).join('\n') + '\n');
const promotion = { version: '0.24.4', versionCode: 283, from: '0.24.4-self-activation-r2',packagedCandidate:candidateTag,
  runtimeAsarSha256: installer.runtimeAsarSha256, sourceAudit: path.relative(repo, candidate),
  portableUnchanged: true, portableIdentityNote:'byte-identical to the packaged candidate; corrective derivation from original r2 is separately verified',installerRuntimeFilesIdentical: verified.identicalAcceptedRuntimeFiles,
  zipContainsCanonicalNameWithIdenticalExe: true, nonWindowsFieldsMatchAuthoritativeManifest: true,
  installerWizardExecuted: false, legacyP0FullRecoveryMatrixRerun: false,
  releaseAuthorization: 'User explicitly requested formal promotion of the validated Windows r2 on 2026-11-25',
  publicSigningStatus: 'NotSigned', published: false, inventory };
fs.writeFileSync(path.join(root, 'promotion-audit.json'), JSON.stringify(promotion, null, 2));
console.log(JSON.stringify({prepared: true, version: next.windowsVersionName, windowsCode: next.windowsVersionCode, androidKept: next.standaloneVersionName, files: inventory.map(row => ({target:row.target,bytes:row.bytes,sha256:row.sha256}))}, null, 2));
