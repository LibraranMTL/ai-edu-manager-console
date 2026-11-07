const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateWindowsVersion } = require('./version-policy.cjs');
const { compileLifecycleHook } = require('./compile-lifecycle-hook.cjs');
const { resolvePnpmVirtualStore } = require('./pnpm-virtual-store.cjs');
const { createSourceControlAudit } = require('./source-control-audit.cjs');

const repoRoot = path.resolve(__dirname, '..');
const terminalVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'windows-terminal-version.json'), 'utf8'));
const version = String(terminalVersion.versionName);
validateWindowsVersion(version);
const candidateTag = String(process.env.EDU_WINDOWS_CANDIDATE_TAG || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
const artifactBase = `AI-edu-manager-student-terminal-Windows-${version}${candidateTag && candidateTag !== version ? `-${candidateTag}` : ''}`;
const artifactName = `${artifactBase}.exe`;
const stageBase = path.resolve(process.env.LOCALAPPDATA || os.tmpdir(), 'AI-Education-Manager', 'terminal-release-stage');
const stageRoot = path.resolve(stageBase, candidateTag ? `${version}-${candidateTag}` : version);
const stageOutput = path.join(stageRoot, 'out');
const candidateOutputDirectory = String(process.env.EDU_WINDOWS_TERMINAL_CANDIDATE_OUTPUT_DIR || '').trim();
const defaultReleaseDir = candidateTag
  ? path.join(repoRoot, 'release', 'windows-terminal', 'candidates', candidateTag)
  : path.join(repoRoot, 'release', 'windows-terminal');
const releaseDir = candidateOutputDirectory ? path.resolve(candidateOutputDirectory) : defaultReleaseDir;
const electronLanguages = ['zh-CN', 'en-US'];
// Keep the student terminal bounded and dependency-free. The original 5 MiB
// ceiling was reached by the published-course reader baseline (83 bytes left);
// this fixed 64 KiB allowance covers the rendered learning workbench only.
const terminalAsarBudgetBytes = 5 * 1024 * 1024 + 64 * 1024;

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

function minifyStagedMainProcess() {
  const esbuild = require('node:module').createRequire(require.resolve('vite/package.json'))('esbuild');
  const target = path.join(stageRoot, 'electron', 'terminal-main.cjs');
  const source = fs.readFileSync(target, 'utf8');
  const transformed = esbuild.transformSync(source, {
    loader: 'js',
    minify: true,
    target: 'node20',
    legalComments: 'none',
  });
  fs.writeFileSync(target, transformed.code, 'utf8');
}

function locateAsarModule() {
  const pnpmRoot = resolvePnpmVirtualStore(repoRoot);
  const packageDir = fs.readdirSync(pnpmRoot).find((name) => name.startsWith('@electron+asar@'));
  if (!packageDir) throw new Error('Unable to locate @electron/asar in the pnpm store.');
  return require(path.join(pnpmRoot, packageDir, 'node_modules', '@electron', 'asar'));
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

const publishCleanupWait = new Int32Array(new SharedArrayBuffer(4));

function removeTemporaryPublishFile(temporary) {
  let lastError = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      if (!fs.existsSync(temporary)) return;
    } catch (error) {
      lastError = error;
    }
    Atomics.wait(publishCleanupWait, 0, 0, 200);
  }
  throw new Error(`Unable to remove temporary terminal release artifact: ${temporary}${lastError ? ` (${lastError.message})` : ''}`);
}

function publishFile(source, destination) {
  const temporary = `${destination}.new`;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  removeTemporaryPublishFile(temporary);
  try {
    fs.copyFileSync(source, temporary);
    if (sha256(source) !== sha256(temporary)) throw new Error('Terminal artifact copy verification failed.');
    fs.copyFileSync(temporary, destination);
  } finally {
    removeTemporaryPublishFile(temporary);
  }
}

function writeRuntimePackage() {
  const electronVersion = JSON.parse(fs.readFileSync(require.resolve('electron/package.json'), 'utf8')).version;
  const runtimePackage = {
    name: 'edu-manager-student-terminal',
    version,
    private: true,
    description: 'AI Education Manager Windows student terminal',
    author: 'Robogala',
    main: 'electron/terminal-main.cjs',
    build: {
      appId: 'com.qxmatrix.edumanager.studentterminal',
      productName: 'AI Education Student Terminal',
      electronVersion,
      compression: 'normal',
      electronLanguages,
      directories: { output: 'out' },
      files: ['dist-terminal/**/*', 'electron/**/*', 'public/course-catalog/trusted-course-issuers.json', 'package.json'],
      win: {
        artifactName: `${artifactBase}.\${ext}`,
        icon: 'public/brand/robogala.ico',
        target: ['portable'],
      },
    },
  };
  fs.writeFileSync(path.join(stageRoot, 'package.json'), `${JSON.stringify(runtimePackage, null, 2)}\n`, 'utf8');
}

function build() {
  const sourceControl = createSourceControlAudit(repoRoot);
  if (sourceControl.dirty) {
    throw new Error(`Windows student candidate requires a clean source commit; found ${sourceControl.changedPathCount} changed paths.`);
  }
  assertInside(stageRoot, stageBase);
  if (candidateOutputDirectory && !candidateTag) throw new Error('EDU_WINDOWS_TERMINAL_CANDIDATE_OUTPUT_DIR requires EDU_WINDOWS_CANDIDATE_TAG.');
  const releaseArtifactPath = path.join(releaseDir, artifactName);
  if (releaseArtifactPath.length > 240) throw new Error(`Windows student candidate output path is too long (${releaseArtifactPath.length}); set EDU_WINDOWS_TERMINAL_CANDIDATE_OUTPUT_DIR to a short absolute directory.`);
  fs.mkdirSync(stageBase, { recursive: true });
  fs.rmSync(stageRoot, { recursive: true, force: true });
  fs.mkdirSync(stageRoot, { recursive: true });

  process.stdout.write('[windows-terminal-release] build-renderer\n');
  runPackageBin('vite', 'vite', ['build', '--config', path.join(repoRoot, 'vite.terminal.config.ts'), '--outDir', path.join(stageRoot, 'dist-terminal'), '--emptyOutDir']);

  process.stdout.write('[windows-terminal-release] copy-minimal-runtime\n');
  for (const relative of [
    'electron/terminal-main.cjs',
    'electron/terminal-preload.cjs',
    'electron/terminal-companion.html',
    'electron/terminal-companion-preload.cjs',
    'electron/terminal-companion-renderer.js',
    'electron/companion-popover.html',
    'electron/companion-popover-preload.cjs',
    'electron/companion-popover-renderer.js',
    'electron/companion-toolbar.cjs',
    'electron/terminal-agent-bridge.cjs',
    'electron/terminal-agent-mcp.cjs',
    'electron/terminal-practice-drafts.cjs',
    'electron/practice-card-export.cjs',
    'electron/practice-language-labels.json',
    'electron/practice-print-window.cjs',
    'electron/practice-print-preload.cjs',
    'electron/capture-control-window.cjs',
    'electron/student-agent-lifecycle.cjs',
    'electron/agent-adapter-registry.cjs',
    'electron/capture-protocol.cjs',
    'electron/agent-lifecycle-hook.ps1',
    'electron/agent-lifecycle-hook.cs',
    'electron/terminal-upload.cjs',
    'electron/growth-markdown-summary.cjs',
    'electron/pairing-protocol.cjs',
    'electron/lan-discovery.cjs',
    'electron/terminal-lan-pairing.cjs',
    'electron/terminal-connection.cjs',
    'electron/windows-tailscale.cjs',
    'electron/course-browser.cjs',
    'electron/course-catalog.cjs',
    'electron/course-trust-policy.cjs',
    'electron/student-course-trust.cjs',
    'public/course-catalog/trusted-course-issuers.json',
    'public/brand/robogala.ico',
  ]) copyFile(relative);
  minifyStagedMainProcess();
  compileLifecycleHook(path.join(stageRoot, 'electron', 'agent-lifecycle-hook.cs'), path.join(stageRoot, 'electron', 'agent-lifecycle-hook.exe'));
  require('./build-practice-runtime.cjs').bundlePracticeRuntime(stageRoot, require('node:module').createRequire(require.resolve('vite/package.json'))('esbuild'), {minify:true});
  writeRuntimePackage();

  process.stdout.write('[windows-terminal-release] package-electron\n');
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
  runPackageBin('electron-builder', 'electron-builder', electronBuilderArgs);

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
    '\\electron\\terminal-companion.html',
    '\\electron\\terminal-companion-preload.cjs',
    '\\electron\\terminal-companion-renderer.js',
    '\\electron\\companion-popover.html',
    '\\electron\\companion-popover-preload.cjs',
    '\\electron\\companion-popover-renderer.js',
    '\\electron\\companion-toolbar.cjs',
    '\\electron\\terminal-agent-bridge.cjs',
    '\\electron\\terminal-agent-mcp.cjs',
    '\\electron\\terminal-practice-drafts.cjs',
    '\\electron\\practice-card-export.cjs',
    '\\electron\\practice-print-window.cjs',
    '\\electron\\practice-print-preload.cjs',
    '\\electron\\practice-rich-text.mjs',
    '\\electron\\capture-control-window.cjs',
    '\\electron\\student-agent-lifecycle.cjs',
    '\\electron\\agent-adapter-registry.cjs',
    '\\electron\\capture-protocol.cjs',
    '\\electron\\agent-lifecycle-hook.ps1',
    '\\electron\\agent-lifecycle-hook.exe',
    '\\electron\\terminal-upload.cjs',
    '\\electron\\growth-markdown-summary.cjs',
    '\\electron\\pairing-protocol.cjs',
    '\\electron\\lan-discovery.cjs',
    '\\electron\\terminal-lan-pairing.cjs',
    '\\electron\\terminal-connection.cjs',
    '\\electron\\windows-tailscale.cjs',
    '\\electron\\course-browser.cjs',
    '\\electron\\course-catalog.cjs',
    '\\electron\\course-trust-policy.cjs',
    '\\electron\\student-course-trust.cjs',
    '\\public\\course-catalog\\trusted-course-issuers.json',
    '\\dist-terminal\\terminal.html',
  ]) {
    if (!asarFiles.includes(expected)) throw new Error(`Terminal package is missing ${expected}.`);
  }
  const asarBytes = fs.statSync(asarPath).size;
  // Publication reader adds lazy PDF.js (~1.7 MiB) and bundled offline math fonts.
  // The independently enforced no-node_modules check above remains the dependency boundary.
  if (asarBytes > terminalAsarBudgetBytes) throw new Error(`Terminal app.asar exceeds ${(terminalAsarBudgetBytes / 1024 / 1024).toFixed(4)} MiB: ${asarBytes}`);
  for (const pattern of [/StudentPublishedCards-.*\.js$/, /pdf\.worker.*\.mjs$/, /KaTeX_Main-Regular.*\.woff2$/]) {
    if (!asarFiles.some(name=>pattern.test(name))) throw new Error(`Terminal publication reader asset missing: ${pattern}`);
  }

  const releaseArtifact = path.join(releaseDir, artifactName);
  publishFile(stagedArtifact, releaseArtifact);
  const zipArtifact=path.join(releaseDir, `${artifactBase}.zip`);
  run('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Compress-Archive -LiteralPath '${releaseArtifact.replaceAll("'","''")}' -DestinationPath '${zipArtifact.replaceAll("'","''")}' -Force`]);
  const audit = {
    version,
    candidateTag,
    builtAt: new Date().toISOString(),
    sourceControl,
    baseline: {
      version: '0.18.8',
      versionCode: 238,
      candidateTag: 'windows-student-learning-cockpit-r4-20261105',
      exeSha256: 'D9947CB3067C1259A967B7E2DBCE7825D22D89498D8630076C5B315061B549AC',
    },
    publicCourseContract: {
      manifest: 'edu-manager.public-course-manifest.v1',
      projection: 'student-course-projection.v2',
      trustPolicyRevision: 'course-trust-transition-2026-11-06-v1',
    },
    stagingRoot: stageRoot,
    electronLanguages,
    package: { asarBytes, asarFiles: asarFiles.length, nodeModuleFiles: nodeModuleFiles.length },
    artifact: { path: releaseArtifact, bytes: fs.statSync(releaseArtifact).size, sha256: sha256(releaseArtifact) },
    zip: { path: zipArtifact, bytes: fs.statSync(zipArtifact).size, sha256: sha256(zipArtifact) },
  };
  fs.writeFileSync(path.join(releaseDir, `${artifactName.replace(/\.exe$/, '')}-build-audit.json`), `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  for (const artifact of [releaseArtifact, zipArtifact]) {
    removeTemporaryPublishFile(`${artifact}.new`);
  }
  process.stdout.write(`[windows-terminal-release] complete\n${JSON.stringify(audit, null, 2)}\n`);
}

try {
  build();
} catch (error) {
  process.stderr.write(`Windows terminal staging build failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
}
