const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { resolvePnpmVirtualStore } = require('./pnpm-virtual-store.cjs');

const repoRoot = path.resolve(__dirname, '..');
const auditPath = path.join(repoRoot, 'release', 'windows', 'AI-edu-manager-console-Windows-0.17.9-build-audit.json');
const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
const stageRoot = path.resolve(audit.stagingRoot);
const appAsar = path.join(stageRoot, 'out', 'win-unpacked', 'resources', 'app.asar');

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function walk(root, prefix = '') {
  if (!fs.existsSync(root)) return [];
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...walk(absolute, relative));
    else if (entry.isFile()) result.push({ absolute, relative });
  }
  return result;
}

function manifest(entries) {
  const sorted = [...entries].sort((left, right) => left.relative.localeCompare(right.relative, 'en'));
  const digest = crypto.createHash('sha256');
  let bytes = 0;
  for (const entry of sorted) {
    const size = fs.statSync(entry.absolute).size;
    bytes += size;
    digest.update(`${entry.relative}\0${size}\0${hashFile(entry.absolute)}\n`, 'utf8');
  }
  return { files: sorted.length, bytes, manifestSha256: digest.digest('hex').toUpperCase() };
}

function fromRoots(root, directories, files) {
  const entries = directories.flatMap((relative) => walk(path.join(root, relative), relative));
  for (const relative of files) {
    const absolute = path.join(root, relative);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
      entries.push({ absolute, relative: relative.replaceAll('\\', '/') });
    }
  }
  return entries;
}

function asarModule() {
  const packages = resolvePnpmVirtualStore(repoRoot);
  const folder = fs.readdirSync(packages).find((name) => name.startsWith('@electron+asar@'));
  if (!folder) throw new Error('@electron/asar is not installed');
  return require(path.join(packages, folder, 'node_modules', '@electron', 'asar'));
}

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', windowsHide: true }).trim();
}

function run() {
  const releaseExe = path.resolve(audit.artifacts.exe.path);
  const exeHash = hashFile(releaseExe);
  if (exeHash !== audit.artifacts.exe.sha256) throw new Error('0.17.9 EXE hash differs from release audit');
  if (!fs.existsSync(appAsar)) throw new Error('0.17.9 staged app.asar is missing');

  const stageEntries = fromRoots(stageRoot, ['electron', 'dist', 'public'], ['package.json', 'pnpm-lock.yaml']);
  const stageManifest = manifest(stageEntries);
  const asar = asarModule();
  const packagedPaths = asar.listPackage(appAsar);
  const mismatch = [];
  let comparedFiles = 0;
  for (const packagedPath of packagedPaths) {
    const relative = packagedPath.replace(/^\\/, '').replaceAll('\\', '/');
    const staged = path.join(stageRoot, relative);
    if (!fs.existsSync(staged) || !fs.statSync(staged).isFile()) continue;
    comparedFiles += 1;
    const packaged = asar.extractFile(appAsar, path.join(...relative.split('/')));
    const stagedBytes = fs.readFileSync(staged);
    if (relative === 'package.json') {
      const expected = JSON.parse(stagedBytes.toString('utf8'));
      delete expected.build; // electron-builder removes packaging-only configuration.
      if (JSON.stringify(JSON.parse(packaged.toString('utf8'))) !== JSON.stringify(expected)) mismatch.push(relative);
    } else if (!packaged.equals(stagedBytes)) mismatch.push(relative);
  }
  if (mismatch.length) throw new Error(`Staged runtime differs from packaged app.asar: ${mismatch.slice(0, 5).join(', ')}`);

  const currentEntries = fromRoots(repoRoot, ['electron', 'src', 'public', 'scripts'], [
    'package.json', 'pnpm-lock.yaml', 'index.html', 'vite.config.ts', 'vite.terminal.config.ts',
    'tsconfig.json', 'CHANGELOG.md', 'release/edu-manager-version.json',
    'release/windows/edu-manager-version.json',
  ]);
  const sourceManifest = manifest(currentEntries);
  const status = git(['status', '--porcelain=v1', '--untracked-files=all']);
  const output = {
    schema: 'edu-manager.windows-p1-baseline-audit.v1',
    auditedAt: new Date().toISOString(),
    released: {
      version: audit.version,
      exeSha256: exeHash,
      buildCommit: audit.sourceControl.commit,
      dirtyAtBuild: audit.sourceControl.dirty,
      exactEditableSourceRecovered: false,
      stagedRuntime: stageManifest,
      packagedAsarSha256: hashFile(appAsar),
      comparedPackagedFiles: comparedFiles,
      packageMismatches: mismatch.length,
    },
    currentDevelopmentInput: {
      gitCommit: git(['rev-parse', 'HEAD']),
      statusSha256: crypto.createHash('sha256').update(status, 'utf8').digest('hex').toUpperCase(),
      dirty: Boolean(status),
      ...sourceManifest,
      nodeVersion: process.version,
    },
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

run();
