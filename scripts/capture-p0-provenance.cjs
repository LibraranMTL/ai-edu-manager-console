'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createSourceControlAudit } = require('./source-control-audit.cjs');
const { compactRuntimeSource } = require('./compact-windows-runtime.cjs');
const { resolvePnpmVirtualStore } = require('./pnpm-virtual-store.cjs');

const root = path.resolve(__dirname, '..');
const args = new Map(process.argv.slice(2).map(value => {
  const [key, ...rest] = value.replace(/^--/, '').split('='); return [key, rest.length ? rest.join('=') : true];
}));
const outputDir = path.resolve(root, String(args.get('output') || 'artifacts/p0-red-gate-20261025'));
const hashBuffer = value => crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
const hashFile = file => hashBuffer(fs.readFileSync(file));

function newestAudit() {
  const base = path.join(root, 'release', 'windows', 'candidates');
  const candidates = [];
  for (const directory of fs.readdirSync(base, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const folder = path.join(base, directory.name);
    for (const name of fs.readdirSync(folder)) if (name.endsWith('-build-audit.json')) {
      const file = path.join(folder, name); candidates.push({ file, at: fs.statSync(file).mtimeMs });
    }
  }
  candidates.sort((a, b) => b.at - a.at);
  if (!candidates.length) throw new Error('candidate_build_audit_not_found');
  return candidates[0].file;
}

function selectTargetProcess(processes, processId = 0) {
  const candidates = Array.isArray(processes) ? [...processes] : processes ? [processes] : [];
  const target = Number(processId || 0);
  if (target > 0) {
    const matched = candidates.find(process => Number(process.ProcessId) === target);
    if (!matched) throw new Error(`target_process_not_found:${target}`);
    return matched;
  }
  candidates.sort((left, right) => String(left.CreationDate || '').localeCompare(String(right.CreationDate || '')));
  return candidates[0] || null;
}

function runningMain(processId = 0) {
  const command = [
    "$p=Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'AI Education Manager Console.exe' -and $_.CommandLine -notmatch '--type=' };",
    "if($p){$p | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress}",
  ].join(' ');
  const text = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' }).trim();
  return selectTargetProcess(text ? JSON.parse(text) : [], processId);
}

function runningWrapper(processId = 0) {
  const command = [
    "$p=Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^AI-edu-manager-console-Windows-.*\\.exe$' };",
    "if($p){$p | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress}",
  ].join(' ');
  const text = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' }).trim();
  return selectTargetProcess(text ? JSON.parse(text) : [], processId);
}

function asarRuntime() {
  const electronBuilder = require.resolve('electron-builder');
  const modulePath = require.resolve('@electron/asar', { paths: [path.dirname(electronBuilder)] });
  return { modulePath, api: require(modulePath) };
}

function esbuildRuntime() {
  const pnpmRoot = resolvePnpmVirtualStore(root);
  const packageDir = fs.readdirSync(pnpmRoot).find(name => name.startsWith('esbuild@'));
  if (!packageDir) throw new Error('Unable to locate esbuild in the pnpm store.');
  return require(path.join(pnpmRoot, packageDir, 'node_modules', 'esbuild'));
}

function expectedRuntimeBuffer(relativePath, source, compact = value => value) {
  const normalized = String(relativePath || '').replaceAll('\\', '/');
  const compacted = /^(electron|cloud-report-service)\/.+\.cjs$/i.test(normalized)
    && path.basename(normalized).toLowerCase() !== 'license-trust-store.cjs';
  return Buffer.from(compacted ? compact(String(source || '')) : String(source || ''), 'utf8');
}

function classifyDiagnosticCandidate({ artifactAuditMatches, buildStatusMatches,
  runningArtifactMatches, runtimeFilesMatch, exeSha256 }) {
  if (artifactAuditMatches && buildStatusMatches && runningArtifactMatches && runtimeFilesMatch) {
    return {
      status: 'same_source_verified',
      candidateSha256: exeSha256,
      reason: '当前工作树、诊断构建审计和运行候选一致。',
    };
  }
  if (artifactAuditMatches && buildStatusMatches) {
    return {
      status: 'artifact_built_runtime_unverified',
      candidateSha256: exeSha256,
      reason: '诊断候选已由当前工作树构建并通过包审计，但尚未作为运行程序核验。',
    };
  }
  return {
    status: 'not_available',
    candidateSha256: '',
    reason: '尚未获得同时匹配当前工作树和构建审计的诊断候选。',
  };
}

function isRunningCandidateArtifact({ wrapperSha256, candidateSha256,
  runningAsarSha256, stagedAsarSha256 }) {
  const wrapperMatches = Boolean(wrapperSha256) && wrapperSha256 === candidateSha256;
  const stagedRuntimeMatches = Boolean(runningAsarSha256) && Boolean(stagedAsarSha256)
    && runningAsarSha256 === stagedAsarSha256;
  return wrapperMatches || stagedRuntimeMatches;
}

function markdown(report) {
  const lines = ['# P0候选版本来源对应表', '',
    `- 生成时间：${report.generatedAt}`,
    `- 对应状态：${report.mapping.status}`,
    `- 当前Git：${report.workspace.commit}`,
    `- 当前核验构建Git：${report.buildAudit.sourceControl.commit}`,
    `- 当前核验候选EXE：${report.candidate.exe.path}`,
    `- 当前核验候选EXE SHA-256：${report.candidate.exe.sha256}`,
    `- 运行包装器 SHA-256：${report.running?.wrapper?.sha256 || '未找到'}`,
    `- 运行包装器与候选一致：${report.mapping.runningArtifactMatches ? '是' : '否'}`,
    `- 运行app.asar SHA-256：${report.running?.asar?.sha256 || '未找到'}`, '',
    '## 证据链A：原始运行候选', '',
    `- 状态：${report.chains.originalCandidate.status}`,
    `- 构建Git：${report.chains.originalCandidate.buildCommit}`,
    `- 候选SHA-256：${report.chains.originalCandidate.candidateSha256}`,
    `- 曾核验为实际运行包：${report.chains.originalCandidate.observedRunningArtifactMatches ? '是' : '否'}`,
    '- 用途：保留原候选的可核验身份；故障性能基线必须另存原始样本，不把当前工作树的红灯直接归因给该候选。', '',
    '## 证据链B：当前源码诊断候选', '',
    `- 状态：${report.chains.diagnosticCandidate.status}`,
    `- 工作树Git：${report.chains.diagnosticCandidate.workspaceCommit}`,
    `- 诊断候选SHA-256：${report.chains.diagnosticCandidate.candidateSha256 || '尚未生成'}`,
    `- 原因：${report.chains.diagnosticCandidate.reason}`, '',
    '## 包内运行文件与当前工作树', '', '| 文件 | 当前源码 | 构建等价源码 | 包内源码 | 相同 |', '|---|---|---|---|---|'];
  for (const item of report.mapping.runtimeFiles) lines.push(`| ${item.file} | ${item.workspaceSourceSha256} | ${item.expectedPackagedSha256} | ${item.packagedSha256} | ${item.matches ? '是' : '否'} |`);
  lines.push('', '## 结论', '', report.mapping.message, '',
    '只有全部目标运行文件相同、构建状态哈希相同且候选哈希与构建审计一致，才允许把当前源码红灯与该候选的真实运行采样视为同一版本证据。', '');
  return lines.join('\n');
}

async function main() {
  const priorReportFile = path.join(outputDir, 'p0-candidate-provenance.json');
  let priorReport = null;
  try { priorReport = JSON.parse(fs.readFileSync(priorReportFile, 'utf8')); } catch {}
  const auditFile = path.resolve(root, String(args.get('audit') || newestAudit()));
  const audit = JSON.parse(fs.readFileSync(auditFile, 'utf8'));
  const originalAuditFile = path.resolve(root, String(args.get('original-audit')
    || priorReport?.originalAuditFile || priorReport?.auditFile || auditFile));
  const originalAudit = JSON.parse(fs.readFileSync(originalAuditFile, 'utf8'));
  const exe = path.resolve(audit.artifacts?.exe?.path || '');
  const zip = path.resolve(audit.artifacts?.zip?.path || '');
  const originalExe = path.resolve(originalAudit.artifacts?.exe?.path || '');
  if (!fs.existsSync(exe)) throw new Error('candidate_exe_not_found');
  if (!fs.existsSync(originalExe)) throw new Error('original_candidate_exe_not_found');
  const workspace = createSourceControlAudit(root);
  const mainProcessId = Number(args.get('main-pid') || 0);
  const wrapperProcessId = Number(args.get('wrapper-pid') || 0);
  if (!Number.isSafeInteger(mainProcessId) || mainProcessId < 0) throw new Error('invalid_main_process_id');
  if (!Number.isSafeInteger(wrapperProcessId) || wrapperProcessId < 0) throw new Error('invalid_wrapper_process_id');
  const running = runningMain(mainProcessId);
  const wrapper = runningWrapper(wrapperProcessId);
  const asarPath = running?.ExecutablePath ? path.join(path.dirname(running.ExecutablePath), 'resources', 'app.asar') : '';
  const stagedAsarPath = audit.stagingRoot
    ? path.join(path.resolve(audit.stagingRoot), 'out', 'win-unpacked', 'resources', 'app.asar') : '';
  const packaged = fs.existsSync(asarPath) ? asarRuntime() : null;
  const esbuild = packaged ? esbuildRuntime() : null;
  const runtimeFiles = ['electron/main.cjs', 'electron/smart-inbox.cjs', 'electron/smart-inbox-host.cjs',
    'electron/resource-coordinator.cjs', 'electron/task-store-service.cjs', 'electron/project-materials.cjs'];
  const comparisons = runtimeFiles.map(file => {
    const workspaceSource = fs.readFileSync(path.join(root, file));
    const workspaceSourceSha256 = hashBuffer(workspaceSource);
    const expectedPackaged = expectedRuntimeBuffer(file, workspaceSource.toString('utf8'),
      source => compactRuntimeSource(source, esbuild));
    const expectedPackagedSha256 = hashBuffer(expectedPackaged);
    let packagedSha256 = '', error = '';
    try { packagedSha256 = hashBuffer(packaged.api.extractFile(asarPath, file)); } catch (cause) { error = cause.message; }
    return { file, workspaceSourceSha256, expectedPackagedSha256, packagedSha256,
      matches: expectedPackagedSha256 === packagedSha256, error };
  });
  const exeSha256 = hashFile(exe), zipSha256 = fs.existsSync(zip) ? hashFile(zip) : '';
  const originalExeSha256 = hashFile(originalExe);
  const artifactAuditMatches = exeSha256 === String(audit.artifacts?.exe?.sha256 || '').toUpperCase()
    && (!zipSha256 || zipSha256 === String(audit.artifacts?.zip?.sha256 || '').toUpperCase());
  const originalArtifactAuditMatches = originalExeSha256 === String(originalAudit.artifacts?.exe?.sha256 || '').toUpperCase();
  const runningWrapperSha256 = wrapper?.ExecutablePath && fs.existsSync(wrapper.ExecutablePath) ? hashFile(wrapper.ExecutablePath) : '';
  const runningAsarSha256 = fs.existsSync(asarPath) ? hashFile(asarPath) : '';
  const stagedAsarSha256 = fs.existsSync(stagedAsarPath) ? hashFile(stagedAsarPath) : '';
  const runningArtifactMatches = isRunningCandidateArtifact({ wrapperSha256: runningWrapperSha256,
    candidateSha256: exeSha256, runningAsarSha256, stagedAsarSha256 });
  const originalRunningArtifactMatches = Boolean(runningWrapperSha256) && runningWrapperSha256 === originalExeSha256;
  const originalObservedRunningArtifactMatches = originalRunningArtifactMatches
    || priorReport?.chains?.originalCandidate?.observedRunningArtifactMatches === true
    || priorReport?.chains?.originalCandidate?.runningArtifactMatches === true;
  const runtimeFilesMatch = comparisons.every(item => item.matches);
  const buildStatusMatches = workspace.commit === audit.sourceControl?.commit
    && workspace.statusSha256 === String(audit.sourceControl?.statusSha256 || '').toUpperCase();
  const originalCandidateReady = originalArtifactAuditMatches && originalObservedRunningArtifactMatches;
  const diagnosticCandidate = classifyDiagnosticCandidate({ artifactAuditMatches, buildStatusMatches,
    runningArtifactMatches, runtimeFilesMatch, exeSha256 });
  const statusValue = runtimeFilesMatch && artifactAuditMatches && runningArtifactMatches && buildStatusMatches
    ? 'candidate_and_workspace_verified_same_source'
    : runtimeFilesMatch && artifactAuditMatches && runningArtifactMatches ? 'runtime_files_match_but_workspace_provenance_differs'
      : 'candidate_and_current_workspace_not_verified_same_source';
  const report = { schema: 2, generatedAt: new Date().toISOString(), auditFile, originalAuditFile, workspace, buildAudit: {
    version: audit.version, candidateTag: audit.candidateTag, builtAt: audit.builtAt, sourceControl: audit.sourceControl,
  }, candidate: { exe: { path: exe, bytes: fs.statSync(exe).size, sha256: exeSha256, auditMatches: exeSha256 === String(audit.artifacts?.exe?.sha256 || '').toUpperCase() },
    zip: { path: zip, bytes: fs.existsSync(zip) ? fs.statSync(zip).size : 0, sha256: zipSha256,
      auditMatches: !zipSha256 || zipSha256 === String(audit.artifacts?.zip?.sha256 || '').toUpperCase() } },
  running: running ? { process: running, wrapper: wrapper ? { ...wrapper, sha256: runningWrapperSha256,
    matchesAuditedCandidate: runningArtifactMatches } : null, asar: { path: asarPath, bytes: fs.existsSync(asarPath) ? fs.statSync(asarPath).size : 0,
    sha256: runningAsarSha256, stagedPath: stagedAsarPath, stagedSha256: stagedAsarSha256,
    matchesAuditedStage: Boolean(runningAsarSha256) && runningAsarSha256 === stagedAsarSha256 },
    asarReader: packaged?.modulePath || '' } : null,
  chains: {
    originalCandidate: { status: originalCandidateReady ? 'verified_artifact_identity' : 'unverified',
      buildCommit: originalAudit.sourceControl?.commit || '', candidateSha256: originalExeSha256,
      artifactAuditMatches: originalArtifactAuditMatches, runningArtifactMatches: originalRunningArtifactMatches,
      observedRunningArtifactMatches: originalObservedRunningArtifactMatches,
      runtimeAsarSha256: originalRunningArtifactMatches && fs.existsSync(asarPath) ? hashFile(asarPath)
        : priorReport?.chains?.originalCandidate?.runtimeAsarSha256 || '' },
    diagnosticCandidate: { status: diagnosticCandidate.status,
      workspaceCommit: workspace.commit, workspaceStatusSha256: workspace.statusSha256,
      candidateSha256: diagnosticCandidate.candidateSha256,
      reason: diagnosticCandidate.reason },
  },
  mapping: { status: statusValue, artifactAuditMatches, runningArtifactMatches, runtimeFilesMatch, buildStatusMatches, runtimeFiles: comparisons,
    message: statusValue === 'candidate_and_workspace_verified_same_source'
      ? '当前工作树、构建审计和正在运行候选的目标运行文件已建立一致映射。'
      : '当前工作树与正在运行候选不能视为同一版本证据；红灯结果必须标注为工作树证据，真实采样必须标注为候选包证据。' } };
  await fsp.mkdir(outputDir, { recursive: true });
  await fsp.writeFile(path.join(outputDir, 'p0-candidate-provenance.json'), JSON.stringify(report, null, 2));
  await fsp.writeFile(path.join(outputDir, 'p0-candidate-provenance.md'), markdown(report));
  process.stdout.write(`${JSON.stringify({ status: report.mapping.status, artifactAuditMatches, runningArtifactMatches, runtimeFilesMatch, buildStatusMatches, outputDir }, null, 2)}\n`);
}

module.exports = { classifyDiagnosticCandidate, expectedRuntimeBuffer, isRunningCandidateArtifact,
  selectTargetProcess };

if (require.main === module) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
