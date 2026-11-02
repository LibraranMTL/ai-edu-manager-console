const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateWindowsVersion } = require('./version-policy.cjs');
const { compileLifecycleHook } = require('./compile-lifecycle-hook.cjs');
const { bundleSkillArchiveRuntime } = require('./build-skill-runtime.cjs');
const { WINDOWS_ARTIFACT_WARNING_BYTES, WINDOWS_ARTIFACT_TARGET_BYTES, inspectWindowsArtifactBudget, assertWindowsArtifactBudget } = require('./windows-artifact-budget.cjs');
const { auditWindowsResources } = require('./audit-windows-resources.cjs');
const { compactWindowsRuntime } = require('./compact-windows-runtime.cjs');
const { compactPngResources } = require('./compact-png-resources.cjs');
const { resolvePnpmVirtualStore } = require('./pnpm-virtual-store.cjs');
const { createSourceControlAudit } = require('./source-control-audit.cjs');

const repoRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const version = String(packageJson.version);
validateWindowsVersion(version);
const candidateTag = String(process.env.EDU_WINDOWS_CANDIDATE_TAG || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
const correctiveRebuild = process.env.EDU_WINDOWS_CORRECTIVE_REBUILD === '1';
if (correctiveRebuild && !candidateTag) {
  throw new Error('EDU_WINDOWS_CORRECTIVE_REBUILD requires an isolated candidate tag.');
}
if (correctiveRebuild && !candidateTag.startsWith(`${version}-corrective-`)) {
  throw new Error(`Corrective candidate tag must start with ${version}-corrective-.`);
}
const changelog = fs.readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8');
if (!changelog.includes(`## [${version}]`)) {
  throw new Error(`CHANGELOG.md 缺少 Windows ${version} 更新记录。`);
}
for (const manifestPath of [
  path.join(repoRoot, 'release', 'edu-manager-version.json'),
  path.join(repoRoot, 'release', 'windows', 'edu-manager-version.json'),
]) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!candidateTag && String(manifest.windowsVersionName || '') !== version) {
    throw new Error(`${manifestPath} 的 Windows 版本与 package.json 不一致。`);
  }
  if (candidateTag && !['stable', 'release'].includes(String(manifest.windowsReleaseStatus || '').toLowerCase())) {
    throw new Error(`${manifestPath} 必须继续指向正式版；候选构建不得改写线上更新清单。`);
  }
  if (candidateTag && String(manifest.windowsVersionName || '') === version && !correctiveRebuild) {
    throw new Error(`${manifestPath} 已指向本次候选版本；请恢复上一正式版后再构建候选。`);
  }
  if (correctiveRebuild && String(manifest.windowsVersionName || '') !== version) {
    throw new Error(`${manifestPath} 与同版本纠偏构建 ${version} 不一致。`);
  }
  if (candidateTag && String(manifest.windowsUrl || '').includes(candidateTag)) {
    throw new Error(`${manifestPath} 不得指向候选标识 ${candidateTag}。`);
  }
}
const artifactBase = `AI-edu-manager-console-Windows-${version}${candidateTag && candidateTag !== version ? `-${candidateTag}` : ''}`;
const localAppData = process.env.LOCALAPPDATA || os.tmpdir();
const stageBase = path.resolve(localAppData, 'AI-Education-Manager', 'release-stage');
const stageRoot = path.resolve(stageBase, candidateTag ? `${version}-${candidateTag}` : version);
const stageDist = path.join(stageRoot, 'dist');
const stageOutput = path.join(stageRoot, 'out');
const releaseDir = candidateTag
  ? path.join(repoRoot, 'release', 'windows', 'candidates', candidateTag)
  : path.join(repoRoot, 'release', 'windows');
const lockPath = path.join(stageBase, 'build.lock');
const phaseLogPath = path.join(stageBase, 'build-phases.log');
const electronLanguages = ['zh-CN', 'zh-TW', 'en-US', 'en-GB', 'fr', 'es', 'es-419', 'ja', 'ko', 'vi', 'ms'];
const cloudReportRuntime = [
  'cloud-report-service/remote-result-contract.cjs',
  'cloud-report-service/v2-contract.cjs',
];

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
    env: options.env || process.env,
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

function runPackageBin(packageName, binName, args, options = {}) {
  return run(process.execPath, [resolvePackageBin(packageName, binName), ...args], options);
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

const privateKeyHeaderPattern = new RegExp(`-{5}BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-{5}`);
const secretPatterns = [
  { name: 'private_pem', pattern: privateKeyHeaderPattern },
  { name: 'license_v2_token', pattern: /AIE2\.[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{40,}/ },
];

function scanSecretSignatures(files, label) {
  const findings = [];
  for (const file of files) {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 400 * 1024 * 1024) continue;
    const content = fs.readFileSync(file).toString('latin1');
    for (const rule of secretPatterns) if (rule.pattern.test(content)) findings.push({ file, rule: rule.name });
  }
  if (findings.length) throw new Error(`${label} secret scan failed: ${findings.map((item) => `${item.rule}:${item.file}`).join(', ')}`);
  return { label, files: files.length, findings: 0 };
}

function assertWindowsLicenseClosure(runtimeRoot, label) {
  const mainPath = path.join(runtimeRoot, 'electron', 'main.cjs');
  const trustPath = path.join(runtimeRoot, 'electron', 'license-trust-store.cjs');
  const policyPath = path.join(runtimeRoot, 'electron', 'windows-license-policy.cjs');
  for (const required of [mainPath, trustPath, policyPath]) {
    if (!fs.existsSync(required)) throw new Error(`${label} is missing Windows License closure runtime: ${required}`);
  }
  const main = fs.readFileSync(mainPath, 'utf8');
  for (const forbidden of ['LICENSE_SIGNING_SECRET', 'AI_EDU_LICENSE_TRUSTED_ISSUERS', 'verifyLicenseTokenV2']) {
    if (main.includes(forbidden)) throw new Error(`${label} still contains forbidden Windows License compatibility path: ${forbidden}`);
  }
  const trust = fs.readFileSync(trustPath, 'utf8');
  if (!trust.includes("policy: 'packaged_only'") || trust.includes('function importBundle')) {
    throw new Error(`${label} does not enforce packaged-only License trust.`);
  }
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
  const pnpmRoot = resolvePnpmVirtualStore(repoRoot);
  const packageDir = fs.readdirSync(pnpmRoot).find((name) => name.startsWith('@electron+asar@'));
  if (!packageDir) throw new Error('Unable to locate @electron/asar in the pnpm store.');
  return require(path.join(pnpmRoot, packageDir, 'node_modules', '@electron', 'asar'));
}

function locateEsbuildModule() {
  const pnpmRoot = resolvePnpmVirtualStore(repoRoot);
  const packageDir = fs.readdirSync(pnpmRoot).find((name) => name.startsWith('esbuild@'));
  if (!packageDir) throw new Error('Unable to locate esbuild in the pnpm store.');
  return require(path.join(pnpmRoot, packageDir, 'node_modules', 'esbuild'));
}

function bundleCourseImportRuntime() {
  const esbuild = locateEsbuildModule();
  esbuild.buildSync({
    entryPoints: [path.join(repoRoot, 'electron', 'course-custom-import.cjs')],
    outfile: path.join(stageRoot, 'electron', 'course-custom-import.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    sourcemap: false,
    minify: false,
    minifyWhitespace: true,
    legalComments: 'inline',
    external: ['electron'],
    logLevel: 'warning',
  });
}
function bundleConnectorLifecycleRuntime() {
  locateEsbuildModule().buildSync({ entryPoints: [path.join(repoRoot, 'electron', 'external-agent-lifecycle.cjs')],
    outfile: path.join(stageRoot, 'electron', 'external-agent-lifecycle.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node20',
    sourcemap: false, minify: false, minifyWhitespace: true, legalComments: 'inline', external: ['electron'], logLevel: 'warning' });
}

function writeRuntimePackage() {
  const electronVersion = JSON.parse(fs.readFileSync(require.resolve('electron/package.json'), 'utf8')).version;
  const runtimePackage = {
    name: packageJson.name,
    version,
    private: true,
    description: 'AI Education Manager Windows host console',
    author: 'Robogala',
    main: 'electron/main.cjs',
    build: {
      appId: 'com.qxmatrix.edumanager.desktop',
      productName: 'AI Education Manager Console',
      electronVersion,
      compression: 'maximum',
      electronLanguages,
      directories: { output: 'out' },
      files: ['dist/**/*', 'electron/**/*', 'shared/**/*', 'cloud-report-service/**/*', 'package.json'],
      extraResources: [{ from: 'material-pdf-runtime', to: 'material-pdf-runtime' }],
      asarUnpack: ['electron/invoke-agent.ps1', 'electron/capture-timeline-ocr.ps1', 'electron/project-knowledge-guard.ps1', 'electron/practice-print-gdi.ps1', 'electron/windows-firewall.ps1'],
      win: {
        artifactName: `${artifactBase}.\${ext}`,
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
    const sourceControl = createSourceControlAudit(repoRoot);
    fs.writeFileSync(phaseLogPath, '', 'utf8');
    recordPhase('audit-required-resources-source');
    const sourceResourceAudit = auditWindowsResources({ repoRoot, strict: true });
    recordPhase('secret-scan-source');
    assertWindowsLicenseClosure(repoRoot, 'source');
    const sourceSecretAudit = scanSecretSignatures([
      ...walkFiles(path.join(repoRoot, 'electron')),
      ...walkFiles(path.join(repoRoot, 'shared')),
      ...walkFiles(path.join(repoRoot, 'src')),
      ...walkFiles(path.join(repoRoot, 'public')),
      ...cloudReportRuntime.map((relative) => path.join(repoRoot, relative)),
      ...walkFiles(path.join(repoRoot, 'tools', 'license-admin-app')),
      ...walkFiles(path.join(repoRoot, 'scripts')),
    ], 'source');
    recordPhase('clear-stage');
    fs.rmSync(stageRoot, { recursive: true, force: true });
    fs.mkdirSync(stageRoot, { recursive: true });

    recordPhase('build-renderer');
    runPackageBin('vite', 'vite', ['build', '--outDir', stageDist, '--emptyOutDir']);
    const pngCompaction = compactPngResources(stageDist);

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
    const stagedElectron = path.join(stageRoot, 'electron');
    copyDirectoryFiles(path.join(repoRoot, 'electron'), stagedElectron);
    copyDirectoryFiles(path.join(repoRoot, 'shared'), path.join(stageRoot, 'shared'));
    for (const relative of cloudReportRuntime) {
      const destination = path.join(stageRoot, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(repoRoot, relative), destination);
    }
    // Student/teacher terminal entry points are delivered as separate products.
    // Excluding them from the host keeps the host runtime bounded without weakening
    // any host capability or raising the package-size safety limit.
    for (const terminalEntry of ['terminal-main.cjs', 'terminal-preload.cjs']) {
      const target = path.join(stagedElectron, terminalEntry);
      assertInside(target, stagedElectron, 'terminal entry cleanup');
      fs.rmSync(target, { force: true });
    }
    compileLifecycleHook(path.join(stageRoot, 'electron', 'agent-lifecycle-hook.cs'), path.join(stageRoot, 'electron', 'agent-lifecycle-hook.exe'));
    bundleCourseImportRuntime();
    bundleConnectorLifecycleRuntime();
    bundleSkillArchiveRuntime(repoRoot, stageRoot, locateEsbuildModule());
    require('./build-practice-runtime.cjs').bundlePracticeRuntime(stageRoot, locateEsbuildModule());
    require('./build-project-material-extractor.cjs').bundleMaterialExtractor(stageRoot, locateEsbuildModule());
    require('./build-project-material-pdf.cjs').stagePdfRuntime(stageRoot);
    fs.mkdirSync(path.join(stageRoot, 'public', 'brand'), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, 'public', 'brand', 'robogala.ico'), path.join(stageRoot, 'public', 'brand', 'robogala.ico'));
    const runtimeCompaction = compactWindowsRuntime(stageRoot, locateEsbuildModule());
    recordPhase('write-runtime-package');
    writeRuntimePackage();
    recordPhase('secret-scan-stage');
    assertWindowsLicenseClosure(stageRoot, 'staged runtime');
    const stageSecretAudit = scanSecretSignatures(walkFiles(stageRoot), 'staged runtime');

    recordPhase('package-electron');
    const electronBuilderArgs = ['--projectDir', stageRoot, '--win', 'portable', '--x64'];
    const configuredElectronDist = String(process.env.EDU_ELECTRON_DIST || '').trim();
    if (configuredElectronDist) {
      const electronDist = path.resolve(configuredElectronDist);
      if (!fs.existsSync(electronDist) || !fs.statSync(electronDist).isFile()) {
        throw new Error(`EDU_ELECTRON_DIST does not point to a local Electron zip: ${electronDist}`);
      }
      const expectedElectronZip = `electron-v${JSON.parse(fs.readFileSync(require.resolve('electron/package.json'), 'utf8')).version}-win32-x64.zip`;
      if (path.basename(electronDist) !== expectedElectronZip) {
        throw new Error(`EDU_ELECTRON_DIST must reference ${expectedElectronZip}.`);
      }
      electronBuilderArgs.push(`--config.electronDist=${electronDist}`);
    }
    // BCJ2 is a reversible x86-code filter supported by the pinned builder.
    // It changes archive encoding only; no runtime files or features are removed.
    runPackageBin('electron-builder', 'electron-builder', electronBuilderArgs, {
      env: { ...process.env, ELECTRON_BUILDER_7Z_FILTER: 'BCJ2' },
    });

    const unpackedRoot = path.join(stageOutput, 'win-unpacked');
    const appAsar = path.join(unpackedRoot, 'resources', 'app.asar');
    const stagedExe = path.join(stageOutput, `${artifactBase}.exe`);
    if (!fs.existsSync(appAsar) || !fs.existsSync(stagedExe)) throw new Error('electron-builder did not produce the expected Windows artifacts.');

    recordPhase('audit-package');
    const asar = locateAsarModule();
    const pdfRuntimeAudit = require('./build-project-material-pdf.cjs').auditPdfRuntime(
      path.join(unpackedRoot, 'resources', 'material-pdf-runtime'), path.join(stageRoot, 'material-pdf-runtime'));
    const asarFiles = asar.listPackage(appAsar);
    const packagedNodeModules = asarFiles.filter((name) => /^\\node_modules(?:\\|$)/.test(name));
    if (packagedNodeModules.length) throw new Error(`Minimal runtime package unexpectedly contains node_modules (${packagedNodeModules.length} entries).`);
    if (!asarFiles.includes('\\electron\\main.cjs') || !asarFiles.includes('\\dist\\index.html')) {
      throw new Error('Packaged app is missing its main process or renderer entry.');
    }
    const workspaceTemplateCatalog = '\\shared\\project-workspace-templates.json';
    if (!asarFiles.includes(workspaceTemplateCatalog)) throw new Error('Packaged workspace template catalog is missing.');
    const packagedWorkspaceTemplates = asar.extractFile(appAsar, 'shared/project-workspace-templates.json');
    const stagedWorkspaceTemplates = fs.readFileSync(path.join(stageRoot, 'shared', 'project-workspace-templates.json'));
    if (!stagedWorkspaceTemplates.equals(packagedWorkspaceTemplates)) {
      throw new Error('Packaged workspace template catalog differs from source.');
    }
    for (const terminalEntry of ['\\electron\\terminal-main.cjs', '\\electron\\terminal-preload.cjs']) {
      if (asarFiles.includes(terminalEntry)) throw new Error(`Host package unexpectedly contains separate terminal entry: ${terminalEntry}`);
    }
    for (const relative of ['electron/growth-current-view.cjs', 'electron/report-evidence-archive.cjs', 'electron/project-evidence-reference.cjs', 'electron/project-archive-runtime.cjs', 'electron/project-archive-startup.cjs', 'electron/project-archive-transaction.cjs', 'electron/project-material-evidence.cjs', 'electron/project-material-access.cjs', 'electron/project-material-promotion.cjs', 'electron/project-material-extract.cjs', 'electron/project-material-extract-worker.cjs',
      'electron/project-material-pdf.cjs', 'electron/project-material-pdf-worker.cjs']) {
      if (!asarFiles.includes(`\\${relative.replaceAll('/', '\\')}`)) throw new Error(`Packaged material extraction runtime is missing: ${relative}`);
      const staged = fs.readFileSync(path.join(stageRoot, relative));
      const packaged = asar.extractFile(appAsar, relative);
      if (!staged.equals(packaged)) throw new Error(`Packaged material extraction runtime differs from verified stage: ${relative}`);
    }
    const externalAgentRuntime = [
      'electron/external-agent-connector.cjs',
      'electron/external-agent-host.cjs',
      'electron/external-agent-mcp.cjs',
      'electron/external-agent-install.cjs',
      'electron/agent-report-read.cjs',
      'electron/external-agent-writes.cjs',
      'electron/external-processing-receipt.cjs',
    ];
    for (const relative of externalAgentRuntime) {
      if (!asarFiles.includes(`\\${relative.replaceAll('/', '\\')}`)) {
        throw new Error(`Packaged external Agent connector runtime is missing: ${relative}`);
      }
      const staged = fs.readFileSync(path.join(stageRoot, relative));
      const packaged = asar.extractFile(appAsar, relative);
      if (!staged.equals(packaged)) {
        throw new Error(`Packaged external Agent connector runtime differs from verified stage: ${relative}`);
      }
    }
    const assetIndexRuntime = [
      'electron/asset-index-store.cjs',
      'electron/asset-index-worker.cjs',
      'electron/asset-state-worker.cjs',
      'electron/asset-governance-worker.cjs',
      'electron/asset-duplicate-governance.cjs',
      'electron/file-fingerprint.cjs',
    ];
    for (const relative of assetIndexRuntime) {
      if (!asarFiles.includes(`\\${relative.replaceAll('/', '\\')}`)) {
        throw new Error(`Packaged SQLite asset index runtime is missing: ${relative}`);
      }
      const staged = fs.readFileSync(path.join(stageRoot, relative));
      const packaged = asar.extractFile(appAsar, relative);
      if (!staged.equals(packaged)) {
        throw new Error(`Packaged SQLite asset index runtime differs from verified stage: ${relative}`);
      }
    }
    const performanceStorageRuntime = [
      'electron/project-state-store.cjs',
      'electron/project-state-worker.cjs',
      'electron/project-state-io-client.cjs',
      'electron/project-state-io-worker.cjs',
      'electron/project-material-automation-client.cjs',
      'electron/project-material-automation-worker.cjs',
      'electron/task-state-store.cjs',
      'electron/task-store-writer.cjs',
      'electron/task-io-worker.cjs',
      'electron/resource-coordinator.cjs',
      'electron/task-schedule-window.cjs',
      'electron/knowledge-projection-worker.cjs',
    ];
    for (const relative of performanceStorageRuntime) {
      if (!asarFiles.includes(`\\${relative.replaceAll('/', '\\')}`)) {
        throw new Error(`Packaged performance storage runtime is missing: ${relative}`);
      }
      const staged = fs.readFileSync(path.join(stageRoot, relative));
      const packaged = asar.extractFile(appAsar, relative);
      if (!staged.equals(packaged)) {
        throw new Error(`Packaged performance storage runtime differs from verified stage: ${relative}`);
      }
    }
    const skillLibraryRuntime = [
      'electron/skill-package-inspector.cjs',
      'electron/skill-library-store.cjs',
      'electron/skill-discovery-adapters.cjs',
      'electron/skill-install-adapters.cjs',
      'electron/skill-archive-extractor.cjs',
      'electron/skill-scan-worker.cjs',
      'electron/skill-library-service.cjs',
    ];
    for (const relative of skillLibraryRuntime) {
      if (!asarFiles.includes(`\\${relative.replaceAll('/', '\\')}`)) {
        throw new Error(`Packaged Skill library runtime is missing: ${relative}`);
      }
      const staged = fs.readFileSync(path.join(stageRoot, relative));
      const packaged = asar.extractFile(appAsar, relative);
      if (!staged.equals(packaged)) {
        throw new Error(`Packaged Skill library runtime differs from verified stage: ${relative}`);
      }
    }
    for (const relative of cloudReportRuntime) {
      if (!asarFiles.includes(`\\${relative.replaceAll('/', '\\')}`)) {
        throw new Error(`Packaged cloud result runtime is missing: ${relative}`);
      }
      const staged = fs.readFileSync(path.join(stageRoot, relative));
      const packaged = asar.extractFile(appAsar, relative);
      if (!staged.equals(packaged)) {
        throw new Error(`Packaged cloud result runtime differs from verified stage: ${relative}`);
      }
    }
    const packagedRendererText = asarFiles
      .filter((name) => /^\\dist\\assets\\.*\.js$/i.test(name))
      .map((name) => asar.extractFile(appAsar, name.replace(/^\\/, '')).toString('utf8'))
      .join('\n');
    if (!packagedRendererText.includes('外部 Agent 连接器')) {
      throw new Error('Packaged renderer is missing the external Agent connector settings entry.');
    }
    for (const marker of ['Skills管理', 'Skill存档管理', 'QClaw']) {
      if (!packagedRendererText.includes(marker)) {
        throw new Error(`Packaged renderer is missing the Skill management marker: ${marker}`);
      }
    }
    for (const required of [
      '\\electron\\agent-lifecycle-hook.exe',
      '\\electron\\course-package-v2.cjs',
      '\\electron\\platform-course-drafts.cjs',
      '\\electron\\license-entitlements.cjs',
      '\\electron\\license-trust-store.cjs',
      '\\electron\\windows-license-policy.cjs',
      '\\electron\\platform-key-manager.cjs',
      '\\electron\\platform-publish-approval.cjs',
      '\\dist\\license\\trusted-issuers.json',
      '\\dist\\course-catalog\\public-key.pem',
    ]) {
      if (!asarFiles.includes(required)) throw new Error(`Packaged app is missing platform course security runtime: ${required}`);
    }
    const unpackedAgentBridge = path.join(unpackedRoot, 'resources', 'app.asar.unpacked', 'electron', 'invoke-agent.ps1');
    if (!fs.existsSync(unpackedAgentBridge)) {
      throw new Error(`Packaged Agent parameter bridge is missing: ${unpackedAgentBridge}`);
    }
    const unpackedTimelineOcr = path.join(unpackedRoot, 'resources', 'app.asar.unpacked', 'electron', 'capture-timeline-ocr.ps1');
    if (!fs.existsSync(unpackedTimelineOcr)) {
      throw new Error(`Packaged timeline OCR bridge is missing: ${unpackedTimelineOcr}`);
    }
    const unpackedKnowledgeGuard = path.join(unpackedRoot, 'resources', 'app.asar.unpacked', 'electron', 'project-knowledge-guard.ps1');
    if (!fs.existsSync(unpackedKnowledgeGuard)) {
      throw new Error(`Packaged knowledge commit guard is missing: ${unpackedKnowledgeGuard}`);
    }
    if (sha256(unpackedKnowledgeGuard) !== sha256(path.join(repoRoot, 'electron', 'project-knowledge-guard.ps1'))) {
      throw new Error('Packaged knowledge commit guard differs from the verified source');
    }
    const unpackedPrintBridge = path.join(unpackedRoot, 'resources', 'app.asar.unpacked', 'electron', 'practice-print-gdi.ps1');
    if (!fs.existsSync(unpackedPrintBridge) || sha256(unpackedPrintBridge) !== sha256(path.join(repoRoot, 'electron', 'practice-print-gdi.ps1'))) {
      throw new Error('Packaged Windows print compatibility bridge is missing or differs from source');
    }
    const unpackedFirewallBridge = path.join(unpackedRoot, 'resources', 'app.asar.unpacked', 'electron', 'windows-firewall.ps1');
    if (!fs.existsSync(unpackedFirewallBridge) || sha256(unpackedFirewallBridge) !== sha256(path.join(repoRoot, 'electron', 'windows-firewall.ps1'))) {
      throw new Error('Packaged Windows firewall compatibility bridge is missing or differs from source');
    }
    const asarBytes = fs.statSync(appAsar).size;
    if (asarBytes > 21 * 1024 * 1024) throw new Error(`app.asar exceeds 21 MiB: ${(asarBytes / 1024 / 1024).toFixed(2)} MiB`);
    recordPhase('secret-scan-package');
    const packageSecretAudit = scanSecretSignatures([appAsar, stagedExe], 'packaged artifacts');

    const syntaxDir = path.join(stageRoot, 'syntax-check');
    fs.mkdirSync(syntaxDir, { recursive: true });
    for (const relative of ['electron/main.cjs', 'electron/preload.cjs', 'electron/course-custom-import.cjs']) {
      const target = path.join(syntaxDir, path.basename(relative));
      fs.writeFileSync(target, asar.extractFile(appAsar, relative));
      run(process.execPath, ['--check', target]);
    }
    const isolatedSkillRuntime = path.join(syntaxDir, 'skill-runtime');
    fs.mkdirSync(isolatedSkillRuntime, { recursive: true });
    for (const relative of skillLibraryRuntime) {
      fs.writeFileSync(path.join(isolatedSkillRuntime, path.basename(relative)), asar.extractFile(appAsar, relative));
    }
    const isolatedService = path.join(isolatedSkillRuntime, 'skill-library-service.cjs');
    run(process.execPath, ['-e', `require(${JSON.stringify(isolatedService)})`]);
    const skillRuntimeReport = path.join(stageRoot, 'skill-packaged-runtime-verification.json');
    run(process.execPath, [path.join(repoRoot, 'scripts', 'verify-skill-asar.cjs'), path.join(appAsar, 'electron'), skillRuntimeReport]);
    const skillRuntimeVerification = JSON.parse(fs.readFileSync(skillRuntimeReport, 'utf8'));
    const packagedCourseImport = asar.extractFile(appAsar, 'electron/course-custom-import.cjs').toString('utf8');
    if (/require\((['"])exceljs\1\)/.test(packagedCourseImport)) {
      throw new Error('Packaged course import runtime still depends on an external exceljs module.');
    }
    const packagedMain = asar.extractFile(appAsar, 'electron/main.cjs').toString('utf8');
    for (const marker of ['teacher-terminal-v1', 'teacherTerminalStudentRecord']) {
      if (!packagedMain.includes(marker)) {
        throw new Error(`Packaged Windows host is missing teacher-terminal support: ${marker}`);
      }
    }
    if (!/deviceRole\s*===\s*['"]teacher['"]/.test(packagedMain)) throw new Error('Packaged Windows host is missing teacher role check');

    const localeDir = path.join(unpackedRoot, 'locales');
    const locales = fs.readdirSync(localeDir).filter((name) => name.endsWith('.pak')).map((name) => name.replace(/\.pak$/, '')).sort();
    const expectedLocales = [...electronLanguages].sort();
    if (JSON.stringify(locales) !== JSON.stringify(expectedLocales)) {
      throw new Error(`Electron locale mismatch. Expected ${expectedLocales.join(', ')}, found ${locales.join(', ')}`);
    }
    recordPhase('audit-required-resources-package');
    const packagedResourceAudit = auditWindowsResources({ repoRoot, packagedRoot: unpackedRoot, strict: true });

    recordPhase('create-zip');
    const stagedZip = path.join(stageOutput, `${artifactBase}.zip`);
    createZip(stagedExe, stagedZip);
    assertWindowsArtifactBudget(stagedExe);
    assertWindowsArtifactBudget(stagedZip);
    const stagedArtifactBudgets = {
      exe: inspectWindowsArtifactBudget(stagedExe),
      zip: inspectWindowsArtifactBudget(stagedZip),
    };
    for (const budget of Object.values(stagedArtifactBudgets)) {
      if (budget.status !== 'ok') process.stderr.write(`[windows-release] package-size-${budget.status} ${path.basename(budget.file)} ${budget.bytes}/${budget.targetBytes} bytes; advisory warning threshold ${budget.warningBytes}\n`);
    }
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
      candidateTag,
      artifactSizeWarningBytes: WINDOWS_ARTIFACT_WARNING_BYTES,
      artifactSizeTargetBytes: WINDOWS_ARTIFACT_TARGET_BYTES,
      archiveCodeFilter: 'BCJ2',
      runtimeCompaction,
      pngCompaction,
      builtAt: new Date().toISOString(),
      sourceControl,
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
        pdfRuntime: pdfRuntimeAudit,
        asarFiles: asarFiles.length,
        nodeModuleFiles: packagedNodeModules.length,
        agentBridge: unpackedAgentBridge,
        externalAgentConnectorRuntime: externalAgentRuntime,
        assetIndexRuntime,
        performanceStorageRuntime,
        skillLibraryRuntime,
        skillRuntimeVerification,
        cloudReportRuntime,
        teacherTerminalSupport: true,
        unpackedBytes: directorySize(unpackedRoot),
      },
      secretScan: {
        source: sourceSecretAudit,
        stage: stageSecretAudit,
        package: packageSecretAudit,
      },
      resourceAudit: {
        source: sourceResourceAudit,
        package: packagedResourceAudit,
      },
      artifacts: {
        exe: { path: releaseExe, bytes: fs.statSync(releaseExe).size, sha256: sha256(releaseExe), budget: stagedArtifactBudgets.exe },
        zip: { path: releaseZip, bytes: fs.statSync(releaseZip).size, sha256: sha256(releaseZip), budget: stagedArtifactBudgets.zip },
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
