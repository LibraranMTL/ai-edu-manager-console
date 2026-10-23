const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

function installerConfig(version, output, icon, candidateTag = '') {
  const artifactSuffix = candidateTag ? `-${candidateTag}` : '';
  return {
    appId: 'com.qxmatrix.edumanager.desktop',
    productName: 'AI Education Manager Console',
    directories: { output },
    win: { target: ['nsis'], icon, artifactName: `AI-edu-manager-console-Windows-${version}${artifactSuffix}-Setup.` + '${ext}' },
    nsis: {
      oneClick: false, perMachine: false, selectPerMachineByDefault: false,
      allowElevation: false, allowToChangeInstallationDirectory: false,
      createDesktopShortcut: true, createStartMenuShortcut: true,
      shortcutName: 'AI教育管家 Windows主机版',
      uninstallDisplayName: 'AI教育管家 Windows主机版',
      deleteAppDataOnUninstall: false, runAfterFinish: false,
      installerLanguages: ['zh_CN', 'en_US'], language: '2052',
      differentialPackage: false,
    },
    publish: null,
  };
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function treeHashes(root) {
  const result = {};
  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) walk(file);
      else if (item.isFile()) result[path.relative(root, file)] = sha256(file);
    }
  }
  walk(root);
  return result;
}

async function main() {
  const repo = path.resolve(__dirname, '..');
  const auditPath = path.resolve(process.argv[2] || '');
  if (!process.argv[2]) throw new Error('Pass the build-audit.json of the user-accepted portable package.');
  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  const version = String(audit.version || '');
  require('./version-policy.cjs').validateWindowsVersion(version);
  const candidateTag = String(process.env.EDU_WINDOWS_INSTALLER_TAG || audit.candidateTag || '')
    .trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const source = audit.artifacts.exe;
  if (fs.statSync(source.path).size !== source.bytes || sha256(source.path) !== source.sha256) {
    throw new Error('Accepted portable package does not match its audit.');
  }
  const stagePackage = JSON.parse(fs.readFileSync(path.join(audit.stagingRoot, 'package.json'), 'utf8'));
  if (stagePackage.name !== 'edu-manager-launcher' || stagePackage.version !== version || stagePackage.author !== 'Robogala') {
    throw new Error('Runtime identity/version/publisher mismatch.');
  }
  const output = candidateTag
    ? path.join(repo, 'release', 'windows', 'candidates', candidateTag, 'installer')
    : path.join(repo, 'release', 'windows', `installer-${version}`);
  if (fs.existsSync(output)) throw new Error(`Refusing to overwrite an existing installer delivery: ${output}`);
  // Extract the exact accepted EXE instead of rebuilding from the dirty tree.
  const cache = path.join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache', '7zip@1.0.0');
  const sevenZip = fs.readdirSync(cache).map(name => path.join(cache, name, 'bin', '7za.exe')).find(file => fs.existsSync(file));
  if (!sevenZip) throw new Error('Cached electron-builder 7za.exe was not found.');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-installer-'));
  const unpacked = path.join(temporary, 'accepted-runtime');
  const extraction = spawnSync(sevenZip, ['x', source.path, `-o${unpacked}`, '-y'], { encoding: 'utf8', windowsHide: true });
  if (extraction.status !== 0) throw new Error(`Portable extraction failed: ${extraction.stderr}`);
  const runtimeExe = path.join(unpacked, 'AI Education Manager Console.exe');
  const runtimeAsar = path.join(unpacked, 'resources', 'app.asar');
  if (!fs.existsSync(runtimeExe) || !fs.existsSync(runtimeAsar)) throw new Error('Accepted runtime payload is incomplete.');
  const before = treeHashes(unpacked);
  const config = installerConfig(version, output, path.join(repo, 'public', 'brand', 'robogala.ico'), candidateTag);
  const { build, Platform, Arch } = require('electron-builder');
  await build({ projectDir: audit.stagingRoot, prepackaged: unpacked,
    targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64), config, publish: 'never' });
  const after = treeHashes(unpacked);
  for (const [file, hash] of Object.entries(before)) {
    if (after[file] !== hash) throw new Error(`Accepted runtime was modified during packaging: ${file}`);
  }
  const installer = path.join(output, `AI-edu-manager-console-Windows-${version}${candidateTag ? `-${candidateTag}` : ''}-Setup.exe`);
  const report = {
    version, candidateTag, createdAt: new Date().toISOString(),
    status: candidateTag ? 'local-candidate-installer' : 'local-user-accepted-installer',
    sourceAudit: auditPath, sourceControl: audit.sourceControl,
    sourcePortable: source, runtimeAsarSha256: sha256(runtimeAsar),
    unchangedRuntimeFiles: Object.keys(before).length,
    installer: { path: installer, bytes: fs.statSync(installer).size, sha256: sha256(installer) },
    config, published: false, installedOnDevelopmentMachine: false, temporary,
  };
  fs.writeFileSync(path.join(output, 'installer-audit.json'), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

module.exports = { installerConfig };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
