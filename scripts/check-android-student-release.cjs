const fs = require('node:fs');
const cp = require('node:child_process');
const read = file => fs.readFileSync(file, 'utf8');
const release = JSON.parse(read('release/android-student-release.json'));
const fail = message => { throw new Error(message); };
if (!Number.isInteger(release.versionCode) || release.versionCode < 103) fail('Android student version code cannot fall below 103');
const url = `https://www.greatbg.com/download/${release.filename}`;
for (const file of ['release/edu-manager-version.json', 'release/windows/edu-manager-version.json', 'release/网站文件/edu-manager-version.json']) {
  const m = JSON.parse(read(file));
  for (const [key, value] of Object.entries({versionCode: release.versionCode, versionName: release.versionName, tabletTerminalVersionCode: release.versionCode, tabletTerminalVersionName: release.versionName, tabletTerminalApkUrl: url, terminalApkUrl: url, apkUrl: url, tabletTerminalSha256: release.sha256})) {
    if (m[key] !== value) fail(`${file}: ${key} differs from Android student release`);
  }
}
for (const [file, value] of [
  ['release/网站文件/download.html', `Android v${release.versionName}`],
  ['release/网站文件/download.html', `../download/${release.filename}`],
  ['android-tablet-terminal/AndroidManifest.xml', `android:versionCode="${release.versionCode}"`],
  ['android-tablet-terminal/AndroidManifest.xml', `android:versionName="${release.versionName}"`],
  ['android-tablet-terminal/src/com/qxmatrix/eduterminal/MainActivity.java', `static final String VERSION_NAME = "${release.versionName}";`],
  ['android-tablet-terminal/src/com/qxmatrix/eduterminal/MainActivity.java', `static final int VERSION_CODE = ${release.versionCode};`],
  ['android-tablet-terminal/build.ps1', `$versionName = '${release.versionName}'`],
]) if (!read(file).includes(value)) fail(`${file}: missing ${value}`);
const base = process.env.RELEASE_BASE_REF;
if (base) {
  const previous = JSON.parse(cp.execFileSync('git', ['show', `${base}:release/android-student-release.json`], {encoding:'utf8'}));
  if (release.versionCode < previous.versionCode) fail('Android student release version rollback');
  if (release.versionCode === previous.versionCode && JSON.stringify(release) !== JSON.stringify(previous)) fail('Android student release was changed without a version increment');
}
console.log(`Android student release ${release.versionName} (${release.versionCode}) is consistent`);
