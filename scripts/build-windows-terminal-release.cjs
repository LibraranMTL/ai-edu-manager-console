const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateWindowsVersion } = require('./version-policy.cjs');

const repoRoot = path.resolve(__dirname, '..');
const sourcePackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const version = String(sourcePackage.version);
validateWindowsVersion(version);
const artifactName = `AI-edu-manager-student-terminal-Windows-${version}.exe`;
const stageBase = path.resolve(process.env.LOCALAPPDATA || os.tmpdir(), 'AI-Education-Manager', 'terminal-release-stage');
const stageRoot = path.resolve(stageBase, version);
const stageOutput = path.join(stageRoot, 'out');
const releaseDir = path.join(repoRoot, 'release', 'windows-terminal');
const electronLanguages = ['zh-CN', 'en-US'];

function assertInside(target, parent) {
  const resolvedTarget = path.resolve(target);
  const resolvedParent = path.resolve(parent);
  if (resolvedTarget !== resolvedParent && !resolvedTarget.startsWith(`${resolvedParent}${path.sep}`)) {
    throw new Error(`Terminal stage escaped its expected directory: ${resolvedTarget}`);
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with code ${result.status}`);
}

function resolvePackageBin(packageName, binName = packageName) {
  const manifestPath = require.resolve(`${packageName}/package.json`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const relativeBin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[binName];
  if (!relativeBin) throw new Error(`Unable to resolve ${binName} from ${packageName}.`);
  return path.resolve(path.dirname(manifestPath), relativeBin);
}

function runPackageBin(packageName, binName, args) {
  run(process.execPath, [resolvePackageBin(packageName, binName), ...args]);
}

function copyFile(relativePath) {
  const source = path.join(repoRoot, relativePath);
  const destination = path.join(stageRoot, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function locateAsarModule() {
  const pnpmRoot = path.join(repoRoot, 'node_modules', '.pnpm');
  const packageDir = fs.readdirSync(pnpmRoot).find((name) => name.startsWith('@electron+asar@'));
  if (!packageDir) throw new Error('Unable to locate @electron/asar in the pnpm store.');
  return require(path.join(pnpmRoot, packageDir, 'node_modules', '@electron', 'asar'));
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function publishFile(source, destination) {
  const temporary = `${destination}.new`;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  try {
    fs.copyFileSync(source, temporary);
    if (sha256(source) !== sha256(temporary)) throw new Error('Terminal artifact copy verification failed.');
    fs.copyFileSync(temporary, destination);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function writeRuntimePackage() {
  const electronVersion = JSON.parse(fs.readFileSync(require.resolve('electron/package.json'), 'utf8')).version;
  const runtimePackage = {
    name: 'edu-manager-student-terminal',
    version,
    private: true,
    description: 'AI Education Manager Windows student terminal',
    author: 'Jiamalan (Beijing) Technology Co., Ltd.',
    main: 'electron/terminal-main.cjs',
    build: {
      appId: 'com.qxmatrix.edumanager.studentterminal',
      productName: 'AI Education Student Terminal',
      electronVersion,
      compression: 'normal',
      electronLanguages,
      directories: { output: 'out' },
      files: ['dist-terminal/**/*', 'electron/**/*', 'package.json'],
      win: {
        artifactName: 'AI-edu-manager-student-terminal-Windows-${version}.${ext}',
        icon: 'public/brand/robogala.ico',
        target: ['portable'],
      },
    },
  };
  fs.writeFileSync(path.join(stageRoot, 'package.json'), `${JSON.stringify(runtimePackage, null, 2)}\n`, 'utf8');
}

function build() {
  assertInside(stageRoot, stageBase);
  fs.mkdirSync(stageBase, { recursive: true });
  fs.rmSync(stageRoot, { recursive: true, force: true });
  fs.mkdirSync(stageRoot, { recursive: true });

  process.stdout.write('[windows-terminal-release] build-renderer\n');
  runPackageBin('vite', 'vite', ['build', '--config', path.join(repoRoot, 'vite.terminal.config.ts'), '--outDir', path.join(stageRoot, 'dist-terminal'), '--emptyOutDir']);

  process.stdout.write('[windows-terminal-release] copy-minimal-runtime\n');
  for (const relative of [
    'electron/terminal-main.cjs',
    'electron/terminal-preload.cjs',
    'electron/terminal-upload.cjs',
    'public/brand/robogala.ico',
  ]) copyFile(relative);
  writeRuntimePackage();

  process.stdout.write('[windows-terminal-release] package-electron\n');
  runPackageBin('electron-builder', 'electron-builder', ['--projectDir', stageRoot, '--win', 'portable', '--x64']);

  const stagedArtifact = path.join(stageOutput, artifactName);
  const asarPath = path.join(stageOutput, 'win-unpacked', 'resources', 'app.asar');
  if (!fs.existsSync(stagedArtifact) || !fs.existsSync(asarPath)) throw new Error('Terminal package did not produce the expected files.');
  const asar = locateAsarModule();
  const asarFiles = asar.listPackage(asarPath);
  const nodeModuleFiles = asarFiles.filter((name) => /^\\node_modules(?:\\|$)/.test(name));
  if (nodeModuleFiles.length) throw new Error(`Terminal package unexpectedly contains node_modules (${nodeModuleFiles.length}).`);
  for (const expected of [
    '\\electron\\terminal-main.cjs',
    '\\electron\\terminal-preload.cjs',
    '\\electron\\terminal-upload.cjs',
    '\\dist-terminal\\terminal.html',
  ]) {
    if (!asarFiles.includes(expected)) throw new Error(`Terminal package is missing ${expected}.`);
  }
  const asarBytes = fs.statSync(asarPath).size;
  if (asarBytes > 3 * 1024 * 1024) throw new Error(`Terminal app.asar exceeds 3 MiB: ${asarBytes}`);

  const releaseArtifact = path.join(releaseDir, artifactName);
  publishFile(stagedArtifact, releaseArtifact);
  const audit = {
    version,
    builtAt: new Date().toISOString(),
    stagingRoot: stageRoot,
    electronLanguages,
    package: { asarBytes, asarFiles: asarFiles.length, nodeModuleFiles: nodeModuleFiles.length },
    artifact: { path: releaseArtifact, bytes: fs.statSync(releaseArtifact).size, sha256: sha256(releaseArtifact) },
  };
  fs.writeFileSync(path.join(releaseDir, `${artifactName.replace(/\.exe$/, '')}-build-audit.json`), `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  process.stdout.write(`[windows-terminal-release] complete\n${JSON.stringify(audit, null, 2)}\n`);
}

try {
  build();
} catch (error) {
  process.stderr.write(`Windows terminal staging build failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
}
