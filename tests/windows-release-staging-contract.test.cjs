const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const releaseScript = fs.readFileSync(path.join(root, 'scripts', 'build-windows-release.cjs'), 'utf8');
const installerScript = fs.readFileSync(path.join(root, 'scripts', 'build-windows-installer.cjs'), 'utf8');
const terminalReleaseScript = fs.readFileSync(path.join(root, 'scripts', 'build-windows-terminal-release.cjs'), 'utf8');
const pdfRuntimeScript = fs.readFileSync(path.join(root, 'scripts', 'build-project-material-pdf.cjs'), 'utf8');
const pdfWorker = fs.readFileSync(path.join(root, 'electron', 'project-material-pdf-worker.cjs'), 'utf8');

test('Windows release builds through an isolated local staging directory', () => {
  assert.match(packageJson.scripts['build:win'], /^pnpm typecheck && pnpm test:windows && pnpm audit:resources && pnpm verify:release-website && pnpm benchmark:assets:smoke && pnpm benchmark:projects:release && pnpm benchmark:tasks:release && node scripts\/build-windows-release\.cjs$/);
  assert.match(releaseScript, /assertReleaseWebsiteParity\(\)/);
  assert.match(releaseScript, /process\.env\.LOCALAPPDATA/);
  assert.match(releaseScript, /release-stage/);
  assert.match(releaseScript, /EDU_WINDOWS_CANDIDATE_TAG/);
  assert.match(releaseScript, /'windows', 'candidates', candidateTag/);
  assert.match(releaseScript, /const electronBuilderArgs = \['--projectDir', stageRoot/);
  assert.match(releaseScript, /runPackageBin\('electron-builder', 'electron-builder', electronBuilderArgs, \{/);
  assert.match(releaseScript, /ELECTRON_BUILDER_7Z_FILTER: 'BCJ2'/);
  assert.match(releaseScript, /process\.env\.EDU_ELECTRON_DIST/);
  assert.match(releaseScript, /EDU_ELECTRON_DIST must reference/);
  assert.match(releaseScript, /resolvePackageBin/);
  assert.match(releaseScript, /processExists\(Number\(lock\?\.pid\)\)/);
  assert.match(releaseScript, /Another Windows release build is active/);
  assert.doesNotMatch(releaseScript, /rmSync\(path\.join\(repoRoot, 'dist'/);
});

test('staged runtime is dependency-free after Vite has bundled renderer dependencies', () => {
  assert.match(releaseScript, /main: 'electron\/main\.cjs'/);
  assert.match(releaseScript, /files: \['dist\/\*\*\/\*', 'electron\/\*\*\/\*', 'shared\/\*\*\/\*', 'cloud-report-service\/\*\*\/\*', 'package\.json'\]/);
  assert.deepEqual(packageJson.build.files, ['dist/**/*', 'electron/**/*', 'shared/**/*', 'package.json']);
  assert.match(releaseScript, /copyDirectoryFiles\(path\.join\(repoRoot, 'shared'\), path\.join\(stageRoot, 'shared'\)\)/);
  assert.match(releaseScript, /Packaged workspace template catalog is missing/);
  assert.match(releaseScript, /Packaged workspace template catalog differs from source/);
  assert.doesNotMatch(releaseScript, /runtimePackage\.(?:dependencies|devDependencies)/);
  assert.match(releaseScript, /Minimal runtime package unexpectedly contains node_modules/);
  assert.match(releaseScript, /app\.asar exceeds 21 MiB/);
  assert.deepEqual(packageJson.build.asarUnpack, ['electron/invoke-agent.ps1', 'electron/capture-timeline-ocr.ps1', 'electron/project-knowledge-guard.ps1', 'electron/practice-print-gdi.ps1', 'electron/windows-firewall.ps1']);
  assert.match(releaseScript, /asarUnpack: \['electron\/invoke-agent\.ps1', 'electron\/capture-timeline-ocr\.ps1', 'electron\/project-knowledge-guard\.ps1', 'electron\/practice-print-gdi\.ps1', 'electron\/windows-firewall\.ps1'\]/);
  assert.match(releaseScript, /Packaged Agent parameter bridge is missing/);
  assert.match(releaseScript, /Packaged timeline OCR bridge is missing/);
  assert.match(releaseScript, /Packaged knowledge commit guard is missing/);
  assert.match(releaseScript, /Packaged Windows print compatibility bridge is missing or differs from source/);
  assert.match(releaseScript, /Packaged Windows firewall compatibility bridge is missing or differs from source/);
  assert.match(releaseScript, /bundleMaterialExtractor\(stageRoot, locateEsbuildModule\(\)\)/);
  assert.match(releaseScript, /stagePdfRuntime\(stageRoot\)/);
  assert.match(releaseScript, /extraResources: \[\{ from: 'material-pdf-runtime', to: 'material-pdf-runtime' \}\]/);
  assert.match(releaseScript, /pdfRuntime: pdfRuntimeAudit/);
  assert.match(releaseScript, /verifyPackagedCanvasRuntime\(unpackedRoot\)/);
  assert.match(releaseScript, /'cloud-report-service\/remote-result-contract\.cjs'/);
  assert.match(releaseScript, /'cloud-report-service\/v2-contract\.cjs'/);
  assert.match(releaseScript, /Packaged cloud result runtime is missing/);
  assert.match(releaseScript, /Packaged cloud result runtime differs from verified stage/);
  assert.match(pdfRuntimeScript, /`canvas\/\$\{name\}`/);
  assert.doesNotMatch(pdfRuntimeScript, /`node_modules\/@napi-rs\/canvas\/\$\{name\}`/);
  assert.match(pdfWorker, /path\.join\(runtimeRoot, 'canvas'\)/);
});

test('Windows release keeps the approved multilingual locale set', () => {
  for (const locale of ['zh-CN', 'zh-TW', 'en-US', 'en-GB', 'fr', 'es', 'es-419', 'ja', 'ko', 'vi', 'ms']) {
    assert.match(releaseScript, new RegExp(`['"]${locale}['"]`));
  }
  assert.match(releaseScript, /Electron locale mismatch/);
});

test('package size optimization preserves runtime behavior and legal notices', () => {
  assert.match(releaseScript, /compression: 'maximum'/);
  for (const script of [releaseScript, fs.readFileSync(path.join(root, 'scripts/build-project-material-extractor.cjs'), 'utf8'), fs.readFileSync(path.join(root, 'scripts/build-practice-runtime.cjs'), 'utf8')]) {
    assert.match(script, /minifyWhitespace: true/);
    assert.match(script, /legalComments: 'inline'/);
    assert.doesNotMatch(script, /minifyIdentifiers: true|minifySyntax: true/);
  }
  assert.match(releaseScript, /'electron\/agent-report-read.cjs'/);
  assert.match(pdfRuntimeScript, /\['cmaps', 'standard_fonts', 'wasm'\]/);
  assert.match(pdfRuntimeScript, /'LICENSE', 'package.json'/);
});

test('Windows host and student packages use the Robogala publisher metadata', () => {
  assert.match(releaseScript, /author: 'Robogala'/);
  assert.match(terminalReleaseScript, /author: 'Robogala'/);
  assert.doesNotMatch(releaseScript, /Jiamalan \(Beijing\)/);
  assert.doesNotMatch(terminalReleaseScript, /Jiamalan \(Beijing\)/);
});

test('Windows student package audits every local module required at startup', () => {
  assert.match(terminalReleaseScript, /'electron\/growth-markdown-summary\.cjs'/);
  assert.match(terminalReleaseScript, /'\\\\electron\\\\growth-markdown-summary\.cjs'/);
  const copy = terminalReleaseScript.indexOf("'electron/growth-markdown-summary.cjs'");
  const packageElectron = terminalReleaseScript.indexOf("[windows-terminal-release] package-electron");
  const audit = terminalReleaseScript.indexOf("'\\\\electron\\\\growth-markdown-summary.cjs'");
  const publish = terminalReleaseScript.indexOf('publishFile(stagedArtifact, releaseArtifact)');
  assert.ok(copy > 0 && packageElectron > copy && audit > packageElectron && publish > audit);
});

test('release artifacts are published only after package audits pass', () => {
  const asarAudit = releaseScript.indexOf('const asarFiles = asar.listPackage');
  const localeAudit = releaseScript.indexOf('Electron locale mismatch');
  const publish = releaseScript.indexOf('publishFile(stagedExe, releaseExe)');
  assert.ok(asarAudit > 0 && localeAudit > asarAudit && publish > localeAudit);
  assert.ok(releaseScript.indexOf('assertWindowsArtifactBudget(stagedExe)') < publish);
  assert.ok(releaseScript.indexOf('assertWindowsArtifactBudget(stagedZip)') < publish);
  assert.match(releaseScript, /bundleSkillArchiveRuntime\(repoRoot, stageRoot, locateEsbuildModule\(\)\)/);
  const skillsAudit = releaseScript.indexOf("'verify-skill-asar.cjs'");
  assert.ok(skillsAudit > asarAudit && skillsAudit < publish);
  assert.match(releaseScript, /skillRuntimeVerification,/);
  assert.match(releaseScript, /Copy verification failed/);
  assert.match(releaseScript, /Temporary release artifact remained after publish/);
  assert.match(releaseScript, /primary-artifact-locked-publish-optimized/);
  assert.match(releaseScript, /build-audit\.json/);
  assert.match(releaseScript, /artifactSizeWarningBytes: WINDOWS_ARTIFACT_WARNING_BYTES/);
  assert.match(releaseScript, /artifactSizeTargetBytes: WINDOWS_ARTIFACT_TARGET_BYTES/);
  assert.doesNotMatch(releaseScript, /artifactSizeLimitBytes/);
  assert.match(releaseScript, /auditWindowsResources\(\{ repoRoot, packagedRoot: unpackedRoot, strict: true \}\)/);
  assert.match(releaseScript, /resourceAudit:/);
});

test('a formal installer is blocked unless its extracted runtime passed the release acceptance gate', () => {
  assert.match(installerScript, /assertFormalRuntimeAccepted/);
  const runtimeHash = installerScript.indexOf('const runtimeAsarSha256 = sha256(runtimeAsar)');
  const acceptanceGate = installerScript.indexOf('assertFormalRuntimeAccepted({');
  const build = installerScript.indexOf('await build({');
  assert.ok(runtimeHash > 0 && acceptanceGate > runtimeHash && build > acceptanceGate);
  assert.match(installerScript, /EDU_WINDOWS_ACCEPTANCE_INDEX/);
});

test('same-version corrective candidates require an explicit narrowly named rebuild mode', () => {
  const source = fs.readFileSync(path.join(root, 'scripts', 'build-windows-release.cjs'), 'utf8');
  assert.match(source, /EDU_WINDOWS_CORRECTIVE_REBUILD/);
  assert.match(source, /candidateTag\.startsWith\(`\$\{version\}-corrective-`\)/);
  assert.match(source, /correctiveRebuild\s*&&\s*!candidateTag/);
});
