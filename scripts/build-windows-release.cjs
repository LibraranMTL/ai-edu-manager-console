const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateWindowsVersion } = require('./version-policy.cjs');

const repoRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const version = String(packageJson.version);
validateWindowsVersion(version);
const changelog = fs.readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8');
if (!changelog.includes(`## [${version}]`)) {
  throw new Error(`CHANGELOG.md 缺少 Windows ${version} 更新记录。`);
}
for (const manifestPath of [
  path.join(repoRoot, 'release', 'edu-manager-version.json'),
  path.join(repoRoot, 'release', 'windows', 'edu-manager-version.json'),
]) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (String(manifest.windowsVersionName || '') !== version) {
    throw new Error(`${manifestPath} 的 Windows 版本与 package.json 不一致。`);
  }
}
const artifactBase = `AI-edu-manager-console-Windows-${version}`;
const localAppData = process.env.LOCALAPPDATA || os.tmpdir();
const stageBase = path.resolve(localAppData, 'AI-Education-Manager', 'release-stage');
const stageRoot = path.resolve(stageBase, version);
const stageDist = path.join(stageRoot, 'dist');
const stageOutput = path.join(stageRoot, 'out');
const releaseDir = path.join(repoRoot, 'release', 'windows');
const lockPath = path.join(stageBase, 'build.lock');
const phaseLogPath = path.join(stageBase, 'build-phases.log');
const electronLanguages = ['zh-CN', 'zh-TW', 'en-US', 'en-GB', 'fr', 'es', 'es-419', 'ja', 'ko', 'vi', 'ms'];

function assertInside(target, parent, label) {
  const resolvedTarget = path.resolve(target);
  const resolvedParent = path.resolve(parent);
  if (resolvedTarget !== resolvedParent && !resolvedTarget.startsWith(`${resolvedParent}${path.sep}`)) {
    throw new Error(`${label} escaped its expected directory: ${resolvedTarget}`);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (options.capture) process.stderr.write(`${result.stdout || ''}${result.stderr || ''}`);
    throw new Error(`${command} exited with code ${result.status}`);
  }
  return result;
}

function resolvePackageBin(packageName, binName = packageName) {
  const manifestPath = require.resolve(`${packageName}/package.json`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const relativeBin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[binName];
  if (!relativeBin) throw new Error(`Unable to resolve the ${binName} CLI from ${packageName}.`);
  return path.resolve(path.dirname(manifestPath), relativeBin);
}

function runPackageBin(packageName, binName, args) {
  return run(process.execPath, [resolvePackageBin(packageName, binName), ...args]);
}

function walkFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const queue = [root];
  while (queue.length) {
    const current = queue.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  }
  return files;
}

function directorySize(root) {
  return walkFiles(root).reduce((total, file) => total + fs.statSync(file).size, 0);
}

function recordPhase(phase) {
  const line = `${new Date().toISOString()} ${phase}\n`;
  fs.appendFileSync(phaseLogPath, line, 'utf8');
  process.stdout.write(`[windows-release] ${phase}\n`);
}

function copyDirectoryFiles(sourceRoot, destinationRoot) {
  for (const source of walkFiles(sourceRoot)) {
    const relative = path.relative(sourceRoot, source);
    const destination = path.join(destinationRoot, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex').toUpperCase();
}

function reachableDistAssets(distRoot) {
  const assetsRoot = path.join(distRoot, 'assets');
  const names = fs.existsSync(assetsRoot)
    ? fs.readdirSync(assetsRoot).filter((name) => fs.statSync(path.join(assetsRoot, name)).isFile())
    : [];
  const queue = [];
  const reached = new Set();
  const indexText = fs.readFileSync(path.join(distRoot, 'index.html'), 'utf8');
  for (const name of names) if (indexText.includes(name)) queue.push(name);
  while (queue.length) {
    const name = queue.pop();
    if (reached.has(name)) continue;
    reached.add(name);
    if (!/\.(?:js|css|html|map)$/i.test(name)) continue;
    const content = fs.readFileSync(path.join(assetsRoot, name), 'utf8');
    for (const candidate of names) {
      if (!reached.has(candidate) && content.includes(candidate)) queue.push(candidate);
    }
  }
  return { names, reached };
}

function locateAsarModule() {
  const pnpmRoot = path.join(repoRoot, 'node_modules', '.pnpm');
  const packageDir = fs.readdirSync(pnpmRoot).find((name) => name.startsWith('@electron+asar@'));
  if (!packageDir) throw new Error('Unable to locate @electron/asar in the pnpm store.');
  return require(path.join(pnpmRoot, packageDir, 'node_modules', '@electron', 'asar'));
}

function writeRuntimePackage() {
  const electronVersion = JSON.parse(fs.readFileSync(require.resolve('electron/package.json'), 'utf8')).version;
  const runtimePackage = {
    name: packageJson.name,
    version,
    private: true,
    description: 'AI Education Manager Windows host console',
    author: 'Jiamalan (Beijing) Technology Co., Ltd.',
    main: 'electron/main.cjs',
    build: {
      appId: 'com.qxmatrix.edumanager.desktop',
      productName: 'AI Education Manager Console',
      electronVersion,
      compression: 'normal',
      electronLanguages,
      directories: { output: 'out' },
      files: ['dist/**/*', 'electron/**/*', 'package.json'],
      asarUnpack: ['electron/invoke-agent.ps1'],
      win: {
        artifactName: 'AI-edu-manager-console-Windows-${version}.${ext}',
        icon: 'public/brand/robogala.ico',
        target: ['portable'],
      },
    },
  };
  fs.writeFileSync(path.join(stageRoot, 'package.json'), `${JSON.stringify(runtimePackage, null, 2)}\n`, 'utf8');
}

function createZip(exePath, zipPath) {
  const command = [
    `Compress-Archive -LiteralPath '${exePath.replaceAll("'", "''")}'`,
    `-DestinationPath '${zipPath.replaceAll("'", "''")}'`,
    '-CompressionLevel Optimal -Force',
  ].join(' ');
  run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]);
}

function publishFile(source, destination) {
  const temporary = `${destination}.new`;
  if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  try {
    fs.copyFileSync(source, temporary);
    if (sha256(source) !== sha256(temporary)) throw new Error(`Copy verification failed for ${path.basename(destination)}`);
    fs.copyFileSync(temporary, destination);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  if (fs.existsSync(temporary)) throw new Error(`Temporary publish file was not removed: ${temporary}`);
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function acquireBuildLock() {
  if (fs.existsSync(lockPath)) {
    let lock = null;
    try {
      lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    } catch {
      // Invalid lock files are stale and can be replaced safely.
    }
    if (processExists(Number(lock?.pid))) {
      throw new Error(`Another Windows release build is active (PID ${lock.pid}).`);
    }
    fs.rmSync(lockPath, { force: true });
  }
  const lockHandle = fs.openSync(lockPath, 'wx');
  fs.writeFileSync(lockHandle, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), version }));
  return lockHandle;
}

function build() {
  fs.mkdirSync(stageBase, { recursive: true });
  assertInside(stageRoot, stageBase, 'Stage root');
  const lockHandle = acquireBuildLock();
  try {
    fs.writeFileSync(phaseLogPath, '', 'utf8');
    recordPhase('clear-stage');
    fs.rmSync(stageRoot, { recursive: true, force: true });
    fs.mkdirSync(stageRoot, { recursive: true });

    recordPhase('build-renderer');
    runPackageBin('vite', 'vite', ['build', '--outDir', stageDist, '--emptyOutDir']);

    recordPhase('audit-renderer');
    const distFiles = walkFiles(stageDist);
    const distBytes = directorySize(stageDist);
    const reachability = reachableDistAssets(stageDist);
    const unreachable = reachability.names.filter((name) => !reachability.reached.has(name));
    if (distFiles.length > 200) throw new Error(`Staged dist has too many files: ${distFiles.length}`);
    if (distBytes > 20 * 1024 * 1024) throw new Error(`Staged dist exceeds 20 MiB: ${(distBytes / 1024 / 1024).toFixed(2)} MiB`);
    if (unreachable.length > Math.max(3, Math.ceil(reachability.names.length * 0.05))) {
      throw new Error(`Staged dist contains ${unreachable.length} unreachable assets.`);
    }

    recordPhase('copy-runtime-files');
    copyDirectoryFiles(path.join(repoRoot, 'electron'), path.join(stageRoot, 'electron'));
    fs.mkdirSync(path.join(stageRoot, 'public', 'brand'), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, 'public', 'brand', 'robogala.ico'), path.join(stageRoot, 'public', 'brand', 'robogala.ico'));
    recordPhase('write-runtime-package');
    writeRuntimePackage();

    recordPhase('package-electron');
    runPackageBin('electron-builder', 'electron-builder', ['--projectDir', stageRoot, '--win', 'portable', '--x64']);

    const unpackedRoot = path.join(stageOutput, 'win-unpacked');
    const appAsar = path.join(unpackedRoot, 'resources', 'app.asar');
    const stagedExe = path.join(stageOutput, `${artifactBase}.exe`);
    if (!fs.existsSync(appAsar) || !fs.existsSync(stagedExe)) throw new Error('electron-builder did not produce the expected Windows artifacts.');

    recordPhase('audit-package');
    const asar = locateAsarModule();
    const asarFiles = asar.listPackage(appAsar);
    const packagedNodeModules = asarFiles.filter((name) => /^\\node_modules(?:\\|$)/.test(name));
    if (packagedNodeModules.length) throw new Error(`Minimal runtime package unexpectedly contains node_modules (${packagedNodeModules.length} entries).`);
    if (!asarFiles.includes('\\electron\\main.cjs') || !asarFiles.includes('\\dist\\index.html')) {
      throw new Error('Packaged app is missing its main process or renderer entry.');
    }
    const unpackedAgentBridge = path.join(unpackedRoot, 'resources', 'app.asar.unpacked', 'electron', 'invoke-agent.ps1');
    if (!fs.existsSync(unpackedAgentBridge)) {
      throw new Error(`Packaged Agent parameter bridge is missing: ${unpackedAgentBridge}`);
    }
    const asarBytes = fs.statSync(appAsar).size;
    if (asarBytes > 20 * 1024 * 1024) throw new Error(`app.asar exceeds 20 MiB: ${(asarBytes / 1024 / 1024).toFixed(2)} MiB`);

    const syntaxDir = path.join(stageRoot, 'syntax-check');
    fs.mkdirSync(syntaxDir, { recursive: true });
    for (const relative of ['electron/main.cjs', 'electron/preload.cjs']) {
      const target = path.join(syntaxDir, path.basename(relative));
      fs.writeFileSync(target, asar.extractFile(appAsar, relative));
      run(process.execPath, ['--check', target]);
    }

    const localeDir = path.join(unpackedRoot, 'locales');
    const locales = fs.readdirSync(localeDir).filter((name) => name.endsWith('.pak')).map((name) => name.replace(/\.pak$/, '')).sort();
    const expectedLocales = [...electronLanguages].sort();
    if (JSON.stringify(locales) !== JSON.stringify(expectedLocales)) {
      throw new Error(`Electron locale mismatch. Expected ${expectedLocales.join(', ')}, found ${locales.join(', ')}`);
    }

    recordPhase('create-zip');
    const stagedZip = path.join(stageOutput, `${artifactBase}.zip`);
    createZip(stagedExe, stagedZip);
    fs.mkdirSync(releaseDir, { recursive: true });
    let effectiveReleaseDir = releaseDir;
    let releaseExe = path.join(effectiveReleaseDir, `${artifactBase}.exe`);
    let releaseZip = path.join(effectiveReleaseDir, `${artifactBase}.zip`);
    recordPhase('publish-artifacts');
    try {
      publishFile(stagedExe, releaseExe);
      publishFile(stagedZip, releaseZip);
    } catch (error) {
      if (!['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
      effectiveReleaseDir = path.join(releaseDir, 'optimized');
      fs.mkdirSync(effectiveReleaseDir, { recursive: true });
      releaseExe = path.join(effectiveReleaseDir, `${artifactBase}.exe`);
      releaseZip = path.join(effectiveReleaseDir, `${artifactBase}.zip`);
      recordPhase('primary-artifact-locked-publish-optimized');
      publishFile(stagedExe, releaseExe);
      publishFile(stagedZip, releaseZip);
    }

    const audit = {
      version,
      builtAt: new Date().toISOString(),
      stagingRoot: stageRoot,
      electronLanguages,
      dist: {
        files: distFiles.length,
        bytes: distBytes,
        assetFiles: reachability.names.length,
        reachableAssets: reachability.reached.size,
        unreachableAssets: unreachable,
      },
      package: {
        asarBytes,
        asarFiles: asarFiles.length,
        nodeModuleFiles: packagedNodeModules.length,
        agentBridge: unpackedAgentBridge,
        unpackedBytes: directorySize(unpackedRoot),
      },
      artifacts: {
        exe: { path: releaseExe, bytes: fs.statSync(releaseExe).size, sha256: sha256(releaseExe) },
        zip: { path: releaseZip, bytes: fs.statSync(releaseZip).size, sha256: sha256(releaseZip) },
      },
    };
    const auditPath = path.join(effectiveReleaseDir, `${artifactBase}-build-audit.json`);
    fs.writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
    for (const artifact of [releaseExe, releaseZip]) {
      if (fs.existsSync(`${artifact}.new`)) throw new Error(`Temporary release artifact remained after publish: ${artifact}.new`);
    }
    recordPhase('complete');
    process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
  } finally {
    fs.closeSync(lockHandle);
    fs.rmSync(lockPath, { force: true });
  }
}

try {
  build();
} catch (error) {
  process.stderr.write(`Windows staging build failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
}
