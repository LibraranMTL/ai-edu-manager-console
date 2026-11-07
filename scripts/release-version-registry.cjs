const fs = require('node:fs');
const path = require('node:path');

const MANIFEST_PATHS = [
  'release/edu-manager-version.json',
  'release/网站文件/edu-manager-version.json',
  'release/windows/edu-manager-version.json',
];

function readText(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(root, relativePath) {
  return JSON.parse(readText(root, relativePath));
}

function loadRegistry(root) {
  const registry = readJson(root, 'release/release-version-registry.json');
  if (registry.schema !== 'edu-manager.release-version-registry.v1') {
    throw new Error(`Unsupported release version registry schema: ${registry.schema || 'missing'}`);
  }
  for (const product of ['windowsHost', 'windowsStudent', 'androidStudent', 'androidTeacher', 'androidStandalone', 'androidManager']) {
    if (!registry.products?.[product]) throw new Error(`Release version registry is missing products.${product}`);
  }
  return registry;
}

function publicUrl(filename) {
  return `https://www.greatbg.com/download/${filename}`;
}

function expectedManifestFields(registry) {
  const { windowsHost, windowsStudent, androidStudent, androidTeacher, androidStandalone, androidManager } = registry.products;
  return {
    versionCode: androidStudent.versionCode,
    versionName: androidStudent.versionName,
    windowsVersionCode: windowsHost.versionCode,
    windowsVersionName: windowsHost.versionName,
    windowsReleaseStatus: windowsHost.releaseStatus,
    windowsUrl: publicUrl(windowsHost.zipFilename),
    windowsTerminalVersionCode: windowsStudent.versionCode,
    windowsTerminalVersionName: windowsStudent.versionName,
    windowsTerminalReleaseStatus: windowsStudent.releaseStatus,
    windowsTerminalUrl: publicUrl(windowsStudent.filename),
    terminalApkUrl: publicUrl(androidStudent.filename),
    tabletTerminalVersionCode: androidStudent.versionCode,
    tabletTerminalVersionName: androidStudent.versionName,
    tabletTerminalApkUrl: publicUrl(androidStudent.filename),
    tabletTerminalSha256: androidStudent.sha256,
    teacherTerminalVersionCode: androidTeacher.versionCode,
    teacherTerminalVersionName: androidTeacher.versionName,
    teacherTerminalUrl: publicUrl(androidTeacher.filename),
    teacherTerminalSha256: androidTeacher.sha256,
    standaloneVersionCode: androidStandalone.versionCode,
    standaloneVersionName: androidStandalone.versionName,
    standaloneApkUrl: publicUrl(androidStandalone.filename),
    standaloneSha256: androidStandalone.sha256,
    managerApkVersionCode: androidManager.versionCode,
    managerApkVersionName: androidManager.versionName,
    managerApkReleaseStatus: androidManager.releaseStatus,
    apkUrl: publicUrl(androidStudent.filename),
  };
}

function expectedSnippets(registry) {
  const { windowsHost, windowsStudent, androidStudent, androidTeacher, androidStandalone } = registry.products;
  return [
    ['release/网站文件/download.html', `v${windowsHost.versionName}`],
    ['release/网站文件/download.html', `Windows v${windowsStudent.versionName} · Android v${androidStudent.versionName}`],
    ['release/网站文件/download.html', `v${androidTeacher.versionName}`],
    ['release/网站文件/download.html', `v${androidStandalone.versionName}`],
    ['release/网站文件/download.html', `../download/${windowsHost.setupFilename}`],
    ['release/网站文件/download.html', `../download/${windowsHost.portableFilename}`],
    ['release/网站文件/download.html', `../download/${windowsHost.zipFilename}`],
    ['release/网站文件/download.html', `../download/${windowsStudent.filename}`],
    ['release/网站文件/download.html', `../download/${androidStudent.filename}`],
    ['release/网站文件/download.html', `../download/${androidTeacher.filename}`],
    ['release/网站文件/download.html', `../download/${androidStandalone.filename}`],
    ['android-tablet-terminal/AndroidManifest.xml', `android:versionCode="${androidStudent.versionCode}"`],
    ['android-tablet-terminal/AndroidManifest.xml', `android:versionName="${androidStudent.versionName}"`],
    ['android-tablet-terminal/src/com/qxmatrix/eduterminal/MainActivity.java', `static final String VERSION_NAME = "${androidStudent.versionName}";`],
    ['android-tablet-terminal/src/com/qxmatrix/eduterminal/MainActivity.java', `static final int VERSION_CODE = ${androidStudent.versionCode};`],
    ['android-tablet-terminal/build.ps1', androidStudent.filename],
    ['android-teacher-terminal/AndroidManifest.xml', `android:versionCode="${androidTeacher.versionCode}"`],
    ['android-teacher-terminal/AndroidManifest.xml', `android:versionName="${androidTeacher.versionName}"`],
    ['android-teacher-terminal/src/com/qxmatrix/eduteacher/MainActivity.java', `static final String VERSION_NAME = "${androidTeacher.versionName}";`],
    ['android-teacher-terminal/src/com/qxmatrix/eduteacher/MainActivity.java', `static final int VERSION_CODE = ${androidTeacher.versionCode};`],
    ['android-teacher-terminal/build.ps1', androidTeacher.filename],
  ];
}

function collectVersionRegistryViolations(root, registry = loadRegistry(root)) {
  const violations = [];
  const fields = expectedManifestFields(registry);
  for (const relativePath of MANIFEST_PATHS) {
    const manifest = readJson(root, relativePath);
    for (const [field, expected] of Object.entries(fields)) {
      if (manifest[field] !== expected) {
        violations.push(`${relativePath}: ${field} must be ${JSON.stringify(expected)}, got ${JSON.stringify(manifest[field])}`);
      }
    }
  }
  for (const [relativePath, snippet] of expectedSnippets(registry)) {
    if (!readText(root, relativePath).includes(snippet)) violations.push(`${relativePath}: missing ${JSON.stringify(snippet)}`);
  }
  const packageVersion = readJson(root, 'package.json').version;
  if (packageVersion !== registry.products.windowsHost.versionName) {
    violations.push(`package.json: version must be ${registry.products.windowsHost.versionName}, got ${packageVersion}`);
  }
  const terminalVersion = readJson(root, 'windows-terminal-version.json');
  const windowsStudent = registry.products.windowsStudent;
  if (terminalVersion.versionCode !== windowsStudent.versionCode || terminalVersion.versionName !== windowsStudent.versionName || terminalVersion.releaseStatus !== windowsStudent.releaseStatus) {
    violations.push('windows-terminal-version.json must match products.windowsStudent in the release version registry');
  }
  return violations;
}

function replaceRequired(text, pattern, replacement, label) {
  if (!pattern.test(text)) throw new Error(`Unable to synchronize ${label}: expected source pattern is missing.`);
  return text.replace(pattern, replacement);
}

function synchronizeReleaseVersionFiles(root, registry = loadRegistry(root), { write = false } = {}) {
  const changed = [];
  const fields = expectedManifestFields(registry);
  for (const relativePath of MANIFEST_PATHS) {
    const absolutePath = path.join(root, relativePath);
    const manifest = readJson(root, relativePath);
    Object.assign(manifest, fields);
    const next = `${JSON.stringify(manifest, null, 2)}\n`;
    if (next !== fs.readFileSync(absolutePath, 'utf8')) {
      changed.push(relativePath);
      if (write) fs.writeFileSync(absolutePath, next, 'utf8');
    }
  }

  const { windowsHost, windowsStudent, androidStudent, androidTeacher } = registry.products;
  const textReplacements = [
    ['release/网站文件/download.html', /Windows v[^<]+ · Android v[^<]+/, `Windows v${windowsStudent.versionName} · Android v${androidStudent.versionName}`, 'student download version tag'],
    ['release/网站文件/download.html', /(<h2>Android 教师端<\/h2>\s*<span class="version-tag">)v[^<]+/, `$1v${androidTeacher.versionName}`, 'teacher download version tag'],
    ['release/网站文件/download.html', /AI-edu-manager-console-Windows-[^"/]+-Setup\.exe/g, windowsHost.setupFilename, 'Windows setup download filename'],
    ['release/网站文件/download.html', /AI-edu-manager-console-Windows-\d+\.\d+\.\d+\.exe/g, windowsHost.portableFilename, 'Windows portable download filename'],
    ['release/网站文件/download.html', /AI-edu-manager-console-Windows-[^"/]+\.zip/g, windowsHost.zipFilename, 'Windows ZIP download filename'],
    ['release/网站文件/download.html', /AI-edu-manager-student-terminal-Windows-[^"/]+\.exe/g, windowsStudent.filename, 'Windows student download filename'],
    ['release/网站文件/download.html', /AI-edu-manager-tablet-terminal-[^"/]+\.apk/g, androidStudent.filename, 'Android student download filename'],
    ['release/网站文件/download.html', /AI-edu-manager-teacher-terminal-[^"/]+\.apk/g, androidTeacher.filename, 'Android teacher download filename'],
    ['android-tablet-terminal/AndroidManifest.xml', /android:versionCode="\d+"/, `android:versionCode="${androidStudent.versionCode}"`, 'Android student manifest code'],
    ['android-tablet-terminal/AndroidManifest.xml', /android:versionName="[^"]+"/, `android:versionName="${androidStudent.versionName}"`, 'Android student manifest name'],
    ['android-tablet-terminal/src/com/qxmatrix/eduterminal/MainActivity.java', /static final String VERSION_NAME = "[^"]+";/, `static final String VERSION_NAME = "${androidStudent.versionName}";`, 'Android student source name'],
    ['android-tablet-terminal/src/com/qxmatrix/eduterminal/MainActivity.java', /static final int VERSION_CODE = \d+;/, `static final int VERSION_CODE = ${androidStudent.versionCode};`, 'Android student source code'],
    ['android-tablet-terminal/build.ps1', /AI-edu-manager-tablet-terminal-[^']+\.apk/g, androidStudent.filename, 'Android student build filename'],
    ['android-teacher-terminal/AndroidManifest.xml', /android:versionCode="\d+"/, `android:versionCode="${androidTeacher.versionCode}"`, 'Android teacher manifest code'],
    ['android-teacher-terminal/AndroidManifest.xml', /android:versionName="[^"]+"/, `android:versionName="${androidTeacher.versionName}"`, 'Android teacher manifest name'],
    ['android-teacher-terminal/src/com/qxmatrix/eduteacher/MainActivity.java', /static final String VERSION_NAME = "[^"]+";/, `static final String VERSION_NAME = "${androidTeacher.versionName}";`, 'Android teacher source name'],
    ['android-teacher-terminal/src/com/qxmatrix/eduteacher/MainActivity.java', /static final int VERSION_CODE = \d+;/, `static final int VERSION_CODE = ${androidTeacher.versionCode};`, 'Android teacher source code'],
    ['android-teacher-terminal/build.ps1', /AI-edu-manager-teacher-terminal-[^']+\.apk/g, androidTeacher.filename, 'Android teacher build filename'],
  ];
  const grouped = new Map();
  for (const [relativePath, pattern, replacement, label] of textReplacements) {
    if (!grouped.has(relativePath)) grouped.set(relativePath, []);
    grouped.get(relativePath).push([pattern, replacement, label]);
  }
  for (const [relativePath, replacements] of grouped) {
    const absolutePath = path.join(root, relativePath);
    const current = fs.readFileSync(absolutePath, 'utf8');
    let next = current;
    for (const [pattern, replacement, label] of replacements) next = replaceRequired(next, pattern, replacement, label);
    if (next !== current) {
      changed.push(relativePath);
      if (write) fs.writeFileSync(absolutePath, next, 'utf8');
    }
  }
  return [...new Set(changed)];
}

module.exports = { MANIFEST_PATHS, loadRegistry, expectedManifestFields, expectedSnippets, collectVersionRegistryViolations, synchronizeReleaseVersionFiles };
