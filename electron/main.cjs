const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const { desktopCapturer, globalShortcut, Menu, Tray } = require('electron');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawn, spawnSync, execFileSync } = require('child_process');
const {
  TASK_PROTOCOL_VERSION,
  TASK_STATUS_TRANSITIONS,
  cronOccurrence,
  selectPreviousDailyFeedback,
  selectFallbackAdapter,
  validateDailyActionDocument,
  validateExternalTaskResultIdentity,
  validatePermissionDeclaration,
  validateTaskTransition,
} = require('./task-protocol.cjs');
const {
  CAPTURE_POLICIES,
  CAPTURE_PROTOCOL_VERSION,
  captureSaveDecision,
  normalizeCaptureOptions,
} = require('./capture-protocol.cjs');

let mainWindow;
let qclawOpened = false;
let marvisOpened = false;
let hohuOpened = false;
let openclawOpened = false;
let imaCopilotOpened = false;
let workbuddyOpened = false;
let codexOpened = false;
let claudeCodeOpened = false;
let obsidianOpened = false;
let hostServer = null;
let hostServiceStartedAt = '';
let hostServiceLastError = '';
let todayUploadCount = 0;
let uploadCountDate = new Date().toISOString().slice(0, 10);
const taskChildProcesses = new Map();
let taskSchedulerTimer = null;
let taskSchedulerStartupTimer = null;
let taskSchedulerRunning = false;
let adapterCapabilityCache = { at: 0, value: null, refreshing: null };
let activeCaptureRuntime = null;
let captureTray = null;
let captureControlWindow = null;
let openClawCronSyncState = { at: 0, promise: null, result: null };
let uninstallEntriesCache = { at: 0, value: [] };
const executablePathCache = new Map();
const agentToolInstallCache = new Map();

const APP_VERSION = app.getVersion();
const DEFAULT_HOST_PORT = 18777;
const AGENT_TOOL_IDS = ['qclaw', 'marvis', 'hohu', 'openclaw', 'ima.copilot', 'workbuddy', 'codex', 'claude-code', 'chatgpt', 'claude', 'doubao', 'coze', 'fastgpt'];
const WEB_AGENT_TOOL_URLS = {
  'ima.copilot': 'https://ima.qq.com/',
  workbuddy: 'https://www.workbuddy.ai/',
  chatgpt: 'https://chatgpt.com/',
  claude: 'https://claude.ai/',
  doubao: 'https://www.doubao.com/',
  coze: 'https://www.coze.cn/',
  fastgpt: 'https://fastgpt.in/',
};
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
  '.pdf', '.txt', '.md',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.csv', '.zip',
]);
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const studentsPath = () => path.join(app.getPath('userData'), 'students.json');
const devicesPath = () => path.join(app.getPath('userData'), 'devices.json');
const uploadRecordsPath = () => path.join(app.getPath('userData'), 'upload-records.json');
const hostTimelinePath = () => path.join(app.getPath('userData'), 'host-timeline.json');
const assetIndexPath = () => path.join(app.getPath('userData'), 'asset-index.json');
const assetGovernanceReportPath = () => path.join(app.getPath('userData'), 'asset-governance-report.md');
const projectsPath = () => path.join(app.getPath('userData'), 'projects.json');
const knowledgeGraphReportPath = () => path.join(app.getPath('userData'), 'knowledge-graph-report.md');
const projectContributionAuditPath = () => path.join(app.getPath('userData'), 'project-contribution-audit.md');
const taskCenterDirPath = () => path.join(defaultStudentBaseDir(), '.edu-manager', 'task-center');
const taskStorePath = () => path.join(taskCenterDirPath(), 'tasks.json');
const taskEventLogPath = () => path.join(taskCenterDirPath(), 'events.jsonl');
const taskExecutionDirPath = () => path.join(taskCenterDirPath(), 'executions');
const taskManualOutboxPath = () => path.join(taskCenterDirPath(), 'manual-outbox');
const qclawTaskInboxPath = () => path.join(taskCenterDirPath(), 'qclaw-inbox');
const qclawTaskResultPath = () => path.join(taskCenterDirPath(), 'qclaw-results');
const openClawCronRegistryPath = () => path.join(taskCenterDirPath(), 'openclaw-managed-cron.json');
const LICENSE_SIGNING_SECRET = 'ai-edu-manager-offline-license-v1';
let activePairSession = null;

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
}

function taskAutomationEnabled() {
  return readSettings().taskAutomationEnabled !== false;
}

function setTaskAutomationEnabled(enabled) {
  const nextEnabled = Boolean(enabled);
  const settings = readSettings();
  settings.taskAutomationEnabled = nextEnabled;
  writeSettings(settings);
  if (nextEnabled) {
    refreshAdapterCapabilities(true);
    startUnifiedTaskScheduler();
  } else {
    stopUnifiedTaskScheduler();
  }
  appendTaskEvent('', 'task_automation_mode_changed', { enabled: nextEnabled, mode: nextEnabled ? 'automatic' : 'manual' });
  return JSON.stringify({
    ok: true,
    automationEnabled: nextEnabled,
    executionMode: nextEnabled ? 'automatic' : 'manual',
    message: nextEnabled
      ? '自动运行已开启，统一任务中心将按计划调度任务。'
      : '已切换为仅手动模式；现有运行任务不会中断，后续自动扫描、调度和 Agent 探测已停止。',
  });
}

function ensureApiToken() {
  const settings = readSettings();
  if (!settings.apiToken) {
    settings.apiToken = crypto.randomBytes(24).toString('hex');
    writeSettings(settings);
  }
  return settings.apiToken;
}

function licenseSignature(payload) {
  return crypto
    .createHash('sha256')
    .update(`${LICENSE_SIGNING_SECRET}|${payload}`)
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();
}

function normalizeLicenseCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, '');
}

function planLabel(plan) {
  const value = String(plan || '').toUpperCase();
  if (value === 'FAMILY') return '家庭版';
  if (value === 'PRO') return '专业版';
  if (value === 'ORG') return '机构版';
  if (value === 'TRIAL') return '试用版';
  return value || '未知版本';
}

function parseLicenseCode(code) {
  const normalized = normalizeLicenseCode(code);
  const parts = normalized.split('-');
  if (parts.length !== 7 || parts[0] !== 'AIE') {
    return { ok: false, message: '激活码格式不正确。格式：AIE-套餐-到期日-学生数-设备数-随机码-签名。' };
  }
  const [, plan, expires, studentLimitRaw, deviceLimitRaw, token, signature] = parts;
  if (!/^[A-Z0-9]{3,16}$/.test(plan)) return { ok: false, message: '激活码套餐字段不正确。' };
  if (!(expires === 'PERM' || /^\d{8}$/.test(expires))) return { ok: false, message: '激活码到期日不正确。' };
  const studentLimit = Number(studentLimitRaw);
  const deviceLimit = Number(deviceLimitRaw);
  if (!Number.isInteger(studentLimit) || studentLimit < 1 || studentLimit > 9999) return { ok: false, message: '激活码学生数不正确。' };
  if (!Number.isInteger(deviceLimit) || deviceLimit < 1 || deviceLimit > 9999) return { ok: false, message: '激活码设备数不正确。' };
  if (!/^[A-Z0-9]{6,24}$/.test(token)) return { ok: false, message: '激活码随机码不正确。' };
  const payload = ['AIE', plan, expires, studentLimitRaw, deviceLimitRaw, token].join('|');
  const expected = licenseSignature(payload);
  if (signature !== expected) return { ok: false, message: '激活码校验失败，请确认是否复制完整。' };
  const expiresAt = expires === 'PERM'
    ? ''
    : `${expires.slice(0, 4)}-${expires.slice(4, 6)}-${expires.slice(6, 8)}T23:59:59.999+08:00`;
  if (expiresAt && Date.now() > new Date(expiresAt).getTime()) {
    return { ok: false, message: '激活码已过期。', expired: true };
  }
  return {
    ok: true,
    license: {
      status: 'active',
      plan,
      planLabel: planLabel(plan),
      expiresAt,
      studentLimit,
      deviceLimit,
      token,
      codeHash: crypto.createHash('sha256').update(normalized).digest('hex'),
      activatedAt: new Date().toISOString(),
    },
  };
}

function publicLicenseStatus(rawLicense) {
  const license = rawLicense || readSettings().license || null;
  if (!license) {
    return {
      status: 'inactive',
      active: false,
      planLabel: '未激活',
      message: 'Windows 主机尚未激活。平板终端会跟随主机授权状态。',
    };
  }
  const expiresAt = license.expiresAt || '';
  const expired = Boolean(expiresAt && Date.now() > new Date(expiresAt).getTime());
  return {
    ...license,
    status: expired ? 'expired' : (license.status || 'active'),
    active: !expired && (license.status || 'active') === 'active',
    planLabel: license.planLabel || planLabel(license.plan),
    expiresAt,
    codeHash: license.codeHash ? `${license.codeHash.slice(0, 8)}...${license.codeHash.slice(-6)}` : '',
    message: expired ? '许可证已过期，请续费后重新激活。' : 'Windows 主机已激活，平板终端跟随主机授权。',
  };
}

function licenseRequiredPayload(action = '正式功能') {
  const license = publicLicenseStatus();
  if (license.active) return null;
  return {
    ok: false,
    code: 'LICENSE_REQUIRED',
    license,
    message: `${license.message || 'Windows 主机尚未激活。'}请先在系统设置中输入授权码后再使用${action}。`,
  };
}

function licenseRequiredJson(action) {
  const payload = licenseRequiredPayload(action);
  return payload ? JSON.stringify(payload) : null;
}

function getLicenseStatus() {
  return JSON.stringify({ ok: true, license: publicLicenseStatus() });
}

function activateLicense(code) {
  const parsed = parseLicenseCode(code);
  if (!parsed.ok) return JSON.stringify({ ok: false, message: parsed.message, license: publicLicenseStatus() });
  const settings = readSettings();
  settings.license = parsed.license;
  writeSettings(settings);
  appendHostTimeline({
    type: 'license_activated',
    title: 'License activated',
    detail: `${parsed.license.planLabel} · students ${parsed.license.studentLimit} · devices ${parsed.license.deviceLimit}`,
  });
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  return JSON.stringify({ ok: true, message: '激活成功。平板终端将跟随 Windows 主机授权状态。', license: publicLicenseStatus(parsed.license), status: JSON.parse(getHostServiceStatus()) });
}

function deactivateLicense() {
  const settings = readSettings();
  delete settings.license;
  writeSettings(settings);
  if (hostServer) stopHostService();
  appendHostTimeline({ type: 'license_deactivated', title: 'License deactivated', detail: 'Local license was removed.' });
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  return JSON.stringify({ ok: true, message: '已移除本机许可证。', license: publicLicenseStatus(), status: JSON.parse(getHostServiceStatus()) });
}

function readDevices() {
  try {
    const parsed = JSON.parse(fs.readFileSync(devicesPath(), 'utf8'));
    return Array.isArray(parsed.devices) ? parsed.devices : [];
  } catch {
    return [];
  }
}

function writeDevices(devices) {
  fs.mkdirSync(path.dirname(devicesPath()), { recursive: true });
  fs.writeFileSync(devicesPath(), JSON.stringify({ devices }, null, 2), 'utf8');
}

function readUploadRecords() {
  try {
    const parsed = JSON.parse(fs.readFileSync(uploadRecordsPath(), 'utf8'));
    return Array.isArray(parsed.records) ? parsed.records : [];
  } catch {
    return [];
  }
}

function writeUploadRecords(records) {
  fs.mkdirSync(path.dirname(uploadRecordsPath()), { recursive: true });
  fs.writeFileSync(uploadRecordsPath(), JSON.stringify({ records: records.slice(0, 200) }, null, 2), 'utf8');
}

function normalizeUploadStatus(status) {
  const value = String(status || '').trim();
  if (['pending_digest', 'submitted', 'digesting', 'processed', 'failed', 'ignored'].includes(value)) return value;
  return 'pending_digest';
}

function isOpenDigestStatus(status) {
  return ['pending_digest', 'submitted', 'digesting'].includes(normalizeUploadStatus(status));
}

function studentManagerDir(student) {
  const root = student.rootPath || getStudentRootDir(student.name);
  return path.join(root, '.edu-manager');
}

function studentMaterialsPath(student) {
  return path.join(studentManagerDir(student), 'materials.json');
}

function studentDigestStatePath(student) {
  return path.join(studentManagerDir(student), 'digest-state.json');
}

function studentAiManagerDir(student) {
  const root = student.rootPath || getStudentRootDir(student.name);
  return path.join(root, '.ai-manager');
}

function studentWorkspaceMetadataPath(student) {
  return path.join(studentAiManagerDir(student), 'metadata.json');
}

function studentWorkspacePathmapPath(student) {
  return path.join(studentAiManagerDir(student), 'pathmap.json');
}

function studentWorkspaceHealthReportPath(student) {
  return path.join(studentAiManagerDir(student), 'health-report.md');
}

function studentWorkspaceMigrationLogPath(student) {
  return path.join(studentAiManagerDir(student), 'migration-log.md');
}

function studentScheduleLedgerPath(student) {
  return path.join(studentAiManagerDir(student), 'schedule-ledger.json');
}

function studentMaintenanceReportPath(student) {
  return path.join(studentAiManagerDir(student), 'maintenance-report.md');
}

function allStudentsPathHealthReportPath() {
  return path.join(app.getPath('userData'), 'path-health', 'all-students-health-report.md');
}

function growthEvidenceReviewPath(student) {
  return path.join(growthModelDirForStudent(student), '成长证据审核.json');
}

function growthIndexPath(student) {
  return path.join(growthModelDirForStudent(student), 'growth-index.json');
}

function growthIndexMarkdownPath(student) {
  return path.join(growthModelDirForStudent(student), 'growth-index.md');
}

function projectPromotionRunLogPath(project) {
  const paths = projectPathsFor(project.name, project.projectRootPath, project);
  return path.join(paths.contributionPath, 'promotion-run-log.json');
}

function projectPromotionAuditPath(project) {
  const paths = projectPathsFor(project.name, project.projectRootPath, project);
  return path.join(paths.contributionPath, '贡献冲突与回滚记录.md');
}

function stableWorkspaceId(student) {
  const seed = `${student.id || ''}|${student.name || ''}|${student.rootPath || getStudentRootDir(student.name)}`;
  return `student-kb-${sha1Text(seed).slice(0, 12)}`;
}

function studentWorkspacePathmap(student) {
  const rootPath = student.rootPath || getStudentRootDir(student.name);
  const rawPath = student.rawPath || getRawDir(student.name);
  const summaryPath = student.summaryPath || getSummaryDir(student.name);
  const agentPath = student.agentPath || path.join(rootPath, 'AGENT.md');
  const outputPath = student.outputPath || path.join(rootPath, '输出结果');
  return {
    '@KB_ROOT': rootPath,
    '@AGENT_FILE': agentPath,
    '@RAW_DIR': rawPath,
    '@SUMMARY_DIR': summaryPath,
    '@OUTPUT_DIR': outputPath,
    '@GROWTH_DIR': growthModelDirForStudent(student),
    '@ASSET_ROOT': path.join(studentAiManagerDir(student), 'assets'),
  };
}

function safeReadJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function ensureStudentWorkspaceConfig(student) {
  const normalized = toHostStudent(student);
  const aiDir = studentAiManagerDir(normalized);
  fs.mkdirSync(aiDir, { recursive: true });
  const now = new Date().toISOString();
  const metadataFile = studentWorkspaceMetadataPath(normalized);
  const currentMetadata = safeReadJson(metadataFile, {});
  const metadata = {
    workspaceId: currentMetadata.workspaceId || normalized.workspaceId || stableWorkspaceId(normalized),
    workspaceType: 'studentKnowledgeBase',
    schemaVersion: '2.2',
    appVersion: APP_VERSION,
    studentId: normalized.id,
    studentName: normalized.name,
    knowledgeBaseMode: normalized.knowledgeBaseMode,
    agentTool: normalized.agentTool,
    createdAt: currentMetadata.createdAt || normalized.createdAt || now,
    updatedAt: now,
  };
  fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2), 'utf8');
  const pathmap = {
    version: 1,
    workspaceId: metadata.workspaceId,
    updatedAt: now,
    paths: studentWorkspacePathmap(normalized),
  };
  fs.writeFileSync(studentWorkspacePathmapPath(normalized), JSON.stringify(pathmap, null, 2), 'utf8');
  return { metadata, pathmap, metadataPath: metadataFile, pathmapPath: studentWorkspacePathmapPath(normalized) };
}

function resolveStudentLogicalPath(student, targetPath) {
  try {
    const normalized = toHostStudent(student);
    const workspace = ensureStudentWorkspaceConfig(normalized);
    const resolvedTarget = path.resolve(String(targetPath || ''));
    const entries = Object.entries(workspace.pathmap.paths || {})
      .filter(([, value]) => value)
      .sort((a, b) => String(b[1]).length - String(a[1]).length);
    for (const [logicalKey, physicalPath] of entries) {
      const resolvedBase = path.resolve(String(physicalPath || ''));
      if (!isPathInside(resolvedBase, resolvedTarget)) continue;
      const relative = path.relative(resolvedBase, resolvedTarget);
      const logicalPath = relative ? `${logicalKey}/${relative.replace(/\\/g, '/')}` : logicalKey;
      return {
        ok: true,
        workspaceId: workspace.metadata.workspaceId,
        logicalPath,
        physicalPath: targetPath,
        logicalKey,
        pathmapPath: workspace.pathmapPath,
      };
    }
    return {
      ok: false,
      workspaceId: workspace.metadata.workspaceId,
      logicalPath: '',
      physicalPath: targetPath,
      message: '目标路径不在当前学生工作空间路径映射中。',
      pathmapPath: workspace.pathmapPath,
    };
  } catch (error) {
    return { ok: false, logicalPath: '', physicalPath: targetPath, message: error.message };
  }
}

function resolveStudentPathFromLogical(studentId, logicalPath) {
  try {
    const student = readStudentsIndex().find((item) => String(item.id) === String(studentId));
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const normalized = toHostStudent(student);
    const workspace = ensureStudentWorkspaceConfig(normalized);
    const value = String(logicalPath || '').trim();
    const key = Object.keys(workspace.pathmap.paths || {})
      .sort((a, b) => b.length - a.length)
      .find((item) => value === item || value.startsWith(`${item}/`) || value.startsWith(`${item}\\`));
    if (!key) return JSON.stringify({ ok: false, message: '无法识别逻辑路径。', pathmap: workspace.pathmap });
    const rest = value.slice(key.length).replace(/^[/\\]+/, '');
    const physicalPath = rest ? path.join(workspace.pathmap.paths[key], rest) : workspace.pathmap.paths[key];
    return JSON.stringify({
      ok: true,
      workspaceId: workspace.metadata.workspaceId,
      logicalPath: value,
      physicalPath,
      exists: pathExists(physicalPath),
      pathmapPath: workspace.pathmapPath,
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `解析逻辑路径失败：${error.message}` });
  }
}

function pathExists(targetPath) {
  try {
    return Boolean(targetPath && fs.existsSync(targetPath));
  } catch {
    return false;
  }
}

function isPathInside(parentPath, childPath) {
  try {
    const parent = path.resolve(parentPath);
    const child = path.resolve(childPath);
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  } catch {
    return false;
  }
}

function cleanDetectedWindowsPath(value) {
  return String(value || '')
    .replace(/[，。；;,.、)）\]】}"'`]+$/g, '')
    .trim();
}

function readSmallTextFile(filePath, maxBytes = 2 * 1024 * 1024) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > maxBytes) return '';
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function collectRuleFilesForPathHealth(student) {
  const root = student.rootPath || getStudentRootDir(student.name);
  const candidates = [
    student.agentPath || path.join(root, 'AGENT.md'),
    path.join(root, 'AGENTS.md'),
    path.join(root, 'CLAUDE.md'),
    path.join(root, 'Claude.md'),
    path.join(root, 'IMA.md'),
    path.join(root, 'WorkBuddy.md'),
    path.join(root, 'Agent设定', 'UnifiedSoul.md'),
    path.join(root, 'Agent记忆', 'UnifiedMemory.md'),
  ];
  const ruleDir = path.join(root, 'Agent规则');
  try {
    if (fs.existsSync(ruleDir)) {
      for (const entry of fs.readdirSync(ruleDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
          candidates.push(path.join(ruleDir, entry.name));
        }
      }
    }
  } catch {
    // Ignore optional rule directory read errors; the health check reports core path failures separately.
  }
  return Array.from(new Set(candidates.map((item) => path.resolve(item)))).filter(pathExists);
}

function scanAbsolutePathsInRuleFiles(student) {
  const files = collectRuleFilesForPathHealth(student);
  const knownPaths = Object.values(studentWorkspacePathmap(student)).filter(Boolean);
  const seen = new Set();
  const findings = [];
  const windowsPathRe = /[A-Za-z]:[\\/][^\r\n<>"|]+/g;
  for (const filePath of files) {
    const text = readSmallTextFile(filePath);
    if (!text) continue;
    const matches = text.match(windowsPathRe) || [];
    for (const rawMatch of matches) {
      const detectedPath = cleanDetectedWindowsPath(rawMatch);
      if (!detectedPath) continue;
      const key = `${filePath}|${detectedPath}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const exists = pathExists(detectedPath);
      const matchesCurrentPath = knownPaths.some((knownPath) => isPathInside(knownPath, detectedPath) || isPathInside(detectedPath, knownPath));
      findings.push({
        filePath,
        detectedPath,
        exists,
        matchesCurrentPath,
        status: exists && matchesCurrentPath ? 'ok' : 'warning',
      });
    }
  }
  return findings;
}

function replacementForDetectedPath(student, detectedPath) {
  const value = String(detectedPath || '').replace(/\//g, '\\').toLowerCase();
  const rootName = path.basename(student.rootPath || getStudentRootDir(student.name)).toLowerCase();
  const name = sanitizeName(student.name).toLowerCase();
  if (value.endsWith('\\agent.md') || value.endsWith('/agent.md')) return '@AGENT_FILE';
  if (value.includes('原始资料库') || value.includes('raw') || value.includes('materials')) return '@RAW_DIR';
  if (value.includes('学情分析汇总') || value.includes('summary') || value.includes('report') || value.includes('汇总')) return '@SUMMARY_DIR';
  if (value.includes('输出结果') || value.includes('output') || value.includes('result')) return '@OUTPUT_DIR';
  if (value.includes('成长模型') || value.includes('growth')) return '@GROWTH_DIR';
  if (rootName && value.includes(rootName)) return '@KB_ROOT';
  if (name && (value.includes(`${name}知识库`.toLowerCase()) || value.includes(`${name}知識庫`.toLowerCase()))) return '@KB_ROOT';
  return '';
}

function repairStudentStalePaths(studentId) {
  try {
    const student = readStudentsIndex().find((item) => String(item.id) === String(studentId));
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const normalized = toHostStudent(student);
    ensureStudentWorkspaceConfig(normalized);
    const stalePaths = scanAbsolutePathsInRuleFiles(normalized).filter((item) => item.status !== 'ok');
    if (!stalePaths.length) return JSON.stringify({ ok: true, changedFiles: [], skipped: [], message: '未检测到需要修复的旧绝对路径。' });
    const byFile = new Map();
    const skipped = [];
    for (const item of stalePaths) {
      const replacement = replacementForDetectedPath(normalized, item.detectedPath);
      if (!replacement) {
        skipped.push({ ...item, reason: '无法确定逻辑路径替换目标' });
        continue;
      }
      if (!byFile.has(item.filePath)) byFile.set(item.filePath, []);
      byFile.get(item.filePath).push({ ...item, replacement });
    }
    const changedFiles = [];
    for (const [filePath, replacements] of byFile.entries()) {
      const original = readSmallTextFile(filePath);
      if (!original) continue;
      let next = original;
      for (const item of replacements) {
        next = next.split(item.detectedPath).join(item.replacement);
      }
      if (next === original) continue;
      const backupPath = `${filePath}.bak-${timestampForFilename()}`;
      fs.copyFileSync(filePath, backupPath);
      fs.writeFileSync(filePath, next, 'utf8');
      changedFiles.push({
        filePath,
        backupPath,
        replacementCount: replacements.length,
      });
    }
    const report = JSON.parse(checkStudentPathHealth(studentId));
    return JSON.stringify({
      ok: true,
      changedFiles,
      skipped,
      reportPath: report.reportPath,
      message: changedFiles.length
        ? `已备份并修复 ${changedFiles.length} 个规则/设定文件中的旧路径；${skipped.length} 条路径未自动处理。`
        : `没有可自动修复的旧路径；${skipped.length} 条路径需要人工确认。`,
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `修复旧路径失败：${error.message}` });
  }
}

function markdownTableCell(value) {
  return String(value ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

function buildStudentPathHealthMarkdown(student, payload) {
  const checkRows = payload.checks.map((check) => `| ${markdownTableCell(check.label)} | ${markdownTableCell(check.kind)} | ${check.exists ? '是' : '否'} | ${check.insideRoot ? '是' : '否'} | ${markdownTableCell(check.path)} | ${markdownTableCell(check.message)} |`).join('\n');
  const staleRows = payload.stalePaths.length > 0
    ? payload.stalePaths.map((item) => `| ${markdownTableCell(path.basename(item.filePath))} | ${markdownTableCell(item.detectedPath)} | ${item.exists ? '是' : '否'} | ${item.matchesCurrentPath ? '是' : '否'} | ${markdownTableCell(item.filePath)} |`).join('\n')
    : '| 暂无 | 暂无 | - | - | - |';
  const pathmapRows = Object.entries(payload.pathmap.paths || {}).map(([key, value]) => `| ${markdownTableCell(key)} | ${markdownTableCell(value)} |`).join('\n');
  return `# ${student.name} 知识库路径健康报告

生成时间：${new Date().toISOString()}

状态：${payload.status}

${payload.message}

## 核心路径

| 项目 | 类型 | 存在 | 位于知识库内 | 路径 | 说明 |
| --- | --- | --- | --- | --- | --- |
${checkRows}

## 当前主机路径映射

| 逻辑路径 | 当前主机路径 |
| --- | --- |
${pathmapRows}

## 规则文件中的绝对路径

| 文件 | 检测到的路径 | 路径存在 | 匹配当前知识库 | 文件位置 |
| --- | --- | --- | --- | --- |
${staleRows}

## 建议

- 若发现旧主机绝对路径，请优先更新 Agent 工具中的 Soul / 角色设定 / 长期背景。
- 不建议自动批量替换旧规则文件；先确认旧路径是否仍有同步或备份用途。
- 长期写入知识库的规则文件建议使用 @KB_ROOT、@RAW_DIR、@SUMMARY_DIR、@AGENT_FILE 等逻辑路径，并参考 .ai-manager/pathmap.json。
`;
}

function checkStudentPathHealth(studentId) {
  try {
    const student = readStudentsIndex().find((item) => String(item.id) === String(studentId));
    if (!student) return JSON.stringify({ ok: false, status: 'error', message: '未找到学生。' });
    const normalized = toHostStudent(student);
    const workspace = ensureStudentWorkspaceConfig(normalized);
    const rootPath = normalized.rootPath || getStudentRootDir(normalized.name);
    const checks = [
      { label: '知识库根目录', kind: 'directory', path: rootPath, required: true },
      { label: 'AGENT.md', kind: 'file', path: normalized.agentPath || path.join(rootPath, 'AGENT.md'), required: true },
      { label: '原始资料库', kind: 'directory', path: normalized.rawPath || getRawDir(normalized.name), required: true },
      { label: '学情分析汇总', kind: 'directory', path: normalized.summaryPath || getSummaryDir(normalized.name), required: true },
      { label: '输出结果', kind: 'directory', path: normalized.outputPath || path.join(rootPath, '输出结果'), required: false },
      { label: '成长模型', kind: 'directory', path: growthModelDirForStudent(normalized), required: false },
      { label: '.ai-manager/metadata.json', kind: 'file', path: workspace.metadataPath, required: true },
      { label: '.ai-manager/pathmap.json', kind: 'file', path: workspace.pathmapPath, required: true },
    ].map((item) => {
      const exists = pathExists(item.path);
      const insideRoot = item.label === '知识库根目录' ? exists : isPathInside(rootPath, item.path);
      const status = !exists && item.required ? 'error' : !insideRoot ? 'warning' : 'ok';
      const message = !exists
        ? (item.required ? '缺失，需要修复或重新指定。' : '可选路径尚未创建。')
        : (!insideRoot ? '路径不在当前知识库根目录下，请确认是否为接管目录。' : '正常');
      return { ...item, exists, insideRoot, status, message };
    });
    const stalePaths = scanAbsolutePathsInRuleFiles(normalized).filter((item) => item.status !== 'ok');
    const missingCount = checks.filter((item) => item.status === 'error').length;
    const warningCount = checks.filter((item) => item.status === 'warning').length;
    const stalePathCount = stalePaths.length;
    const status = missingCount > 0 ? 'error' : (warningCount > 0 || stalePathCount > 0 ? 'warning' : 'ok');
    const message = status === 'ok'
      ? '知识库核心路径与当前主机映射正常。'
      : `发现 ${missingCount} 个缺失路径、${warningCount} 个路径提醒、${stalePathCount} 条疑似旧主机绝对路径。`;
    const payload = {
      ok: status !== 'error',
      status,
      message,
      rootPath,
      metadataPath: workspace.metadataPath,
      pathmapPath: workspace.pathmapPath,
      reportPath: studentWorkspaceHealthReportPath(normalized),
      checks,
      stalePaths,
      pathmap: workspace.pathmap,
      summary: {
        totalChecks: checks.length,
        missingCount,
        warningCount,
        stalePathCount,
      },
    };
    fs.writeFileSync(payload.reportPath, buildStudentPathHealthMarkdown(normalized, payload), 'utf8');
    fs.appendFileSync(studentWorkspaceMigrationLogPath(normalized), `\n- ${new Date().toISOString()} 路径健康检查：${message}\n`, 'utf8');
    return JSON.stringify(payload);
  } catch (error) {
    return JSON.stringify({ ok: false, status: 'error', message: `知识库路径核对失败：${error.message}` });
  }
}

function ensureStudentManagerFiles(student) {
  const managerDir = studentManagerDir(student);
  fs.mkdirSync(managerDir, { recursive: true });
  const materialsFile = studentMaterialsPath(student);
  const digestFile = studentDigestStatePath(student);
  if (!fs.existsSync(materialsFile)) {
    fs.writeFileSync(materialsFile, JSON.stringify({ version: 1, studentId: String(student.id || ''), materials: [] }, null, 2), 'utf8');
  }
  if (!fs.existsSync(digestFile)) {
    fs.writeFileSync(digestFile, JSON.stringify({
      version: 1,
      studentId: String(student.id || ''),
      status: 'idle',
      lastDigestAt: '',
      pendingCount: 0,
      submittedCount: 0,
      processedCount: 0,
      message: '尚未执行资料消化。',
    }, null, 2), 'utf8');
  }
  ensureAgentCenter(student);
  ensureStudentWorkspaceConfig(student);
}

function readStudentMaterials(student) {
  try {
    ensureStudentManagerFiles(student);
    const parsed = JSON.parse(fs.readFileSync(studentMaterialsPath(student), 'utf8'));
    return Array.isArray(parsed.materials) ? parsed.materials : [];
  } catch {
    return [];
  }
}

function writeStudentMaterials(student, materials) {
  fs.mkdirSync(studentManagerDir(student), { recursive: true });
  fs.writeFileSync(studentMaterialsPath(student), JSON.stringify({
    version: 1,
    studentId: String(student.id || ''),
    studentName: student.name || '',
    updatedAt: new Date().toISOString(),
    materials: materials.slice(0, 1000),
  }, null, 2), 'utf8');
}

function readStudentDigestState(student) {
  try {
    ensureStudentManagerFiles(student);
    return JSON.parse(fs.readFileSync(studentDigestStatePath(student), 'utf8'));
  } catch {
    return {};
  }
}

function writeStudentDigestState(student, patch) {
  fs.mkdirSync(studentManagerDir(student), { recursive: true });
  const current = readStudentDigestState(student);
  const materials = readStudentMaterials(student);
  const next = {
    version: 1,
    studentId: String(student.id || ''),
    studentName: student.name || '',
    ...current,
    ...patch,
    pendingCount: materials.filter((item) => normalizeUploadStatus(item.status) === 'pending_digest').length,
    submittedCount: materials.filter((item) => ['submitted', 'digesting'].includes(normalizeUploadStatus(item.status))).length,
    processedCount: materials.filter((item) => normalizeUploadStatus(item.status) === 'processed').length,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(studentDigestStatePath(student), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function materialRecordFromUpload(record) {
  const relativePath = record.path && record.rawPath ? path.relative(record.rawPath, record.path).replace(/\\/g, '/') : record.filename;
  return {
    id: record.id,
    fileName: record.filename,
    path: relativePath || record.filename,
    absolutePath: record.path || '',
    size: Number(record.size || 0),
    sha1: record.sha1 || '',
    uploadedAt: record.uploadedAt || new Date().toISOString(),
    sourceDevice: record.deviceName || record.deviceId || '主机控制台',
    sourceDeviceId: record.deviceId || '',
    sourcePath: record.sourcePath || '',
    sourceName: record.sourceName || '',
    status: normalizeUploadStatus(record.status),
    statusUpdatedAt: record.statusUpdatedAt || new Date().toISOString(),
    digestedAt: record.digestedAt || '',
    digestBatchId: record.digestBatchId || '',
  };
}

function upsertStudentMaterialsFromUploads(student, uploadRecords) {
  if (!student || !uploadRecords.length) return;
  const existing = readStudentMaterials(student);
  const byId = new Map(existing.map((item) => [String(item.id), item]));
  uploadRecords.forEach((record) => {
    byId.set(String(record.id), { ...byId.get(String(record.id)), ...materialRecordFromUpload(record) });
  });
  writeStudentMaterials(student, Array.from(byId.values()).sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || ''))));
  const openCount = Array.from(byId.values()).filter((item) => isOpenDigestStatus(item.status)).length;
  writeStudentDigestState(student, {
    status: openCount > 0 ? 'pending' : 'idle',
    message: openCount > 0 ? `有 ${openCount} 份资料等待 QClaw 消化。` : '暂无待消化资料。',
  });
}

function syncStudentMaterialsFromUploadRecords(student) {
  const records = readUploadRecords().filter((record) => String(record.studentId) === String(student.id));
  upsertStudentMaterialsFromUploads(student, records.map((record) => ({ ...record, rawPath: student.rawPath || getRawDir(student.name) })));
  return readStudentMaterials(student);
}

function sha1File(file) {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return '';
  }
}

function readAssetIndex() {
  try {
    const parsed = JSON.parse(fs.readFileSync(assetIndexPath(), 'utf8'));
    return Array.isArray(parsed.assets) ? parsed.assets : [];
  } catch {
    return [];
  }
}

function writeAssetIndex(assets) {
  fs.mkdirSync(path.dirname(assetIndexPath()), { recursive: true });
  fs.writeFileSync(assetIndexPath(), JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    assets: assets.slice(0, 5000),
  }, null, 2), 'utf8');
}

function readProjects() {
  try {
    const parsed = JSON.parse(fs.readFileSync(projectsPath(), 'utf8'));
    return Array.isArray(parsed.projects) ? parsed.projects : [];
  } catch {
    return [];
  }
}

function writeProjects(projects) {
  fs.mkdirSync(path.dirname(projectsPath()), { recursive: true });
  fs.writeFileSync(projectsPath(), JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    projects,
  }, null, 2), 'utf8');
}

function materialTypeForFile(filename) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) return 'image';
  if (ext === '.pdf') return 'pdf';
  if (['.doc', '.docx'].includes(ext)) return 'word';
  if (['.xls', '.xlsx', '.csv'].includes(ext)) return 'sheet';
  if (['.ppt', '.pptx'].includes(ext)) return 'slide';
  if (['.md', '.txt'].includes(ext)) return 'text';
  if (ext === '.zip') return 'archive';
  return ext ? ext.slice(1) : 'file';
}

function normalizeAssetReference(reference) {
  if (!reference || typeof reference !== 'object') return null;
  return {
    id: String(reference.id || `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`),
    spaceType: String(reference.spaceType || 'student'),
    spaceId: String(reference.spaceId || ''),
    spaceName: String(reference.spaceName || ''),
    workspaceId: String(reference.workspaceId || ''),
    logicalPath: String(reference.logicalPath || ''),
    role: String(reference.role || 'raw'),
    path: String(reference.path || ''),
    source: String(reference.source || ''),
    linkedAt: String(reference.linkedAt || new Date().toISOString()),
  };
}

function mergeUnique(values) {
  return Array.from(new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean)));
}

function upsertAssetFromFile(filePath, context = {}) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return null;
  const sha1 = sha1File(filePath);
  const now = new Date().toISOString();
  const assets = readAssetIndex();
  let logicalRef = { workspaceId: '', logicalPath: '' };
  if (context.studentId) {
    const student = readStudentsIndex().find((item) => String(item.id) === String(context.studentId));
    if (student) {
      const resolved = resolveStudentLogicalPath(student, filePath);
      logicalRef = { workspaceId: resolved.workspaceId || '', logicalPath: resolved.logicalPath || '' };
    }
  }
  const existingIndex = sha1
    ? assets.findIndex((item) => String(item.sha1 || '') === sha1)
    : assets.findIndex((item) => path.resolve(item.path || '') === path.resolve(filePath));
  const reference = normalizeAssetReference({
    id: context.referenceId,
    spaceType: context.spaceType || 'student',
    spaceId: context.studentId || context.projectId || context.spaceId || '',
    spaceName: context.studentName || context.projectName || context.spaceName || '',
    workspaceId: context.workspaceId || logicalRef.workspaceId || '',
    logicalPath: context.logicalPath || logicalRef.logicalPath || '',
    role: context.role || 'raw',
    path: filePath,
    source: context.sourceName || context.uploadSource || '',
  });
  const base = existingIndex >= 0 ? assets[existingIndex] : {};
  const references = [
    ...(Array.isArray(base.references) ? base.references : []),
    ...(reference ? [reference] : []),
  ];
  const dedupedReferences = Array.from(new Map(references.map((item) => [
    `${item.spaceType}|${item.spaceId}|${item.role}|${item.path}`,
    item,
  ])).values());
  const linkedStudents = mergeUnique([
    ...(Array.isArray(base.linkedStudents) ? base.linkedStudents : []),
    context.studentId || '',
  ]);
  const linkedProjects = mergeUnique([
    ...(Array.isArray(base.linkedProjects) ? base.linkedProjects : []),
    context.projectId || '',
  ]);
  const asset = {
    assetId: base.assetId || `asset-${(sha1 || crypto.randomBytes(8).toString('hex')).slice(0, 16)}`,
    filename: path.basename(filePath),
    sha1,
    size: stat.size,
    type: materialTypeForFile(filePath),
    path: filePath,
    ownerStudentId: base.ownerStudentId || context.studentId || '',
    ownerStudentName: base.ownerStudentName || context.studentName || '',
    linkedStudents,
    linkedProjects,
    references: dedupedReferences,
    sourcePath: context.sourcePath || base.sourcePath || '',
    sourceName: context.sourceName || base.sourceName || context.deviceName || '主机控制台',
    sourceType: context.sourceType || base.sourceType || 'local_file',
    captureSessionId: context.captureSessionId || base.captureSessionId || '',
    captureItemId: context.captureItemId || base.captureItemId || '',
    uploadedAt: base.uploadedAt || context.uploadedAt || now,
    updatedAt: now,
    status: context.status || base.status || 'active',
  };
  if (existingIndex >= 0) assets[existingIndex] = asset;
  else assets.unshift(asset);
  writeAssetIndex(assets);
  return asset;
}

function assetVersionGroups(assets) {
  const groups = new Map();
  for (const asset of assets || []) {
    const key = `${asset.ownerStudentId || 'global'}|${String(asset.filename || '').toLowerCase()}`;
    const current = groups.get(key) || [];
    current.push(asset);
    groups.set(key, current);
  }
  return groups;
}

function registerAssetsFromUploadRecords(records) {
  const assets = [];
  for (const record of records || []) {
    const asset = upsertAssetFromFile(record.path, {
      studentId: String(record.studentId || ''),
      studentName: record.studentName || '',
      sourcePath: record.sourcePath || '',
      sourceName: record.sourceName || record.deviceName || '主机控制台',
      sourceType: record.captureSessionId ? 'windows_screenshot' : (record.sourceType || 'local_file'),
      captureSessionId: record.captureSessionId || '',
      captureItemId: record.captureItemId || '',
      deviceName: record.deviceName || '',
      uploadedAt: record.uploadedAt || '',
      referenceId: record.id,
      role: 'student_raw',
      status: 'active',
    });
    if (asset) assets.push(asset);
  }
  return assets;
}

function assetIndexSummary() {
  const assets = readAssetIndex();
  const shaCounts = new Map();
  const versionGroups = assetVersionGroups(assets);
  assets.forEach((asset) => {
    if (!asset.sha1) return;
    shaCounts.set(asset.sha1, (shaCounts.get(asset.sha1) || 0) + 1);
  });
  return {
    ok: true,
    assets: assets.map((asset) => ({
      ...asset,
      duplicateCount: asset.sha1 ? shaCounts.get(asset.sha1) || 1 : 1,
      referenceCount: Array.isArray(asset.references) ? asset.references.length : 0,
      versionCount: (versionGroups.get(`${asset.ownerStudentId || 'global'}|${String(asset.filename || '').toLowerCase()}`) || []).length,
      versionGroupKey: `${asset.ownerStudentId || 'global'}|${String(asset.filename || '').toLowerCase()}`,
    })),
    total: assets.length,
    duplicateGroups: Array.from(shaCounts.values()).filter((count) => count > 1).length,
  };
}

function cleanupAssetReferences(assetId) {
  try {
    const assets = readAssetIndex();
    const index = assets.findIndex((asset) => String(asset.assetId) === String(assetId));
    if (index < 0) return JSON.stringify({ ok: false, message: '未找到资产。' });
    const asset = assets[index];
    const references = Array.isArray(asset.references) ? asset.references : [];
    const before = references.length;
    const nextReferences = Array.from(new Map(references
      .filter((ref) => !ref.path || fs.existsSync(ref.path))
      .map((ref) => [`${ref.spaceType}|${ref.spaceId}|${ref.role}|${ref.path}`, ref])).values());
    assets[index] = {
      ...asset,
      references: nextReferences,
      linkedStudents: mergeUnique(nextReferences.filter((ref) => ref.spaceType === 'student').map((ref) => ref.spaceId)),
      linkedProjects: mergeUnique(nextReferences.filter((ref) => ref.spaceType === 'project').map((ref) => ref.spaceId)),
      updatedAt: new Date().toISOString(),
      governanceAction: '',
      governanceReason: '',
    };
    writeAssetIndex(assets);
    appendHostTimeline({ type: 'asset_references_cleaned', title: 'Asset references cleaned', detail: asset.filename, count: before - nextReferences.length });
    return JSON.stringify({
      ...assetIndexSummary(),
      ok: true,
      removed: before - nextReferences.length,
      message: `已清理 ${before - nextReferences.length} 条失效或重复引用。`,
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `清理资产引用失败：${error.message}` });
  }
}

function createAssetVersionSnapshot(assetId) {
  try {
    const assets = readAssetIndex();
    const asset = assets.find((item) => String(item.assetId) === String(assetId));
    if (!asset) return JSON.stringify({ ok: false, message: '未找到资产。' });
    const key = `${asset.ownerStudentId || 'global'}|${String(asset.filename || '').toLowerCase()}`;
    const group = (assetVersionGroups(assets).get(key) || []).sort((a, b) => String(a.uploadedAt || '').localeCompare(String(b.uploadedAt || '')));
    const report = `# ${asset.filename} 版本关系快照\n\n生成时间：${new Date().toISOString()}\n\n| 序号 | 资产编号 | SHA-1 | 大小 | 路径 | 上传时间 | 引用数 |\n| ---: | --- | --- | ---: | --- | --- | ---: |\n${group.map((item, index) => `| ${index + 1} | ${mdCell(item.assetId)} | ${mdCell(item.sha1 || '-')} | ${Number(item.size || 0)} | ${mdCell(item.path)} | ${mdCell(item.uploadedAt || '-')} | ${Array.isArray(item.references) ? item.references.length : 0} |`).join('\n') || '| 1 | - | - | 0 | - | - | 0 |'}\n\n> 版本快照只记录同学生、同文件名资产之间的关系，不会移动、删除或覆盖任何物理文件。\n`;
    const file = path.join(app.getPath('userData'), 'asset-version-snapshots', `${safeFilename(asset.filename)}-${timestampForFilename()}.md`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, report, 'utf8');
    appendHostTimeline({ type: 'asset_version_snapshot', title: 'Asset version snapshot', detail: asset.filename, count: group.length });
    return JSON.stringify({ ok: true, path: file, content: report, count: group.length, message: `已生成 ${group.length} 条版本关系快照。` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `生成版本快照失败：${error.message}` });
  }
}

function markAssetGovernanceDecision(assetId, decision, note = '') {
  try {
    const allowed = {
      keep: '保留',
      duplicate_watch: '重复观察',
      manual_review: '人工处理',
      archive_watch: '归档观察',
      resolved: '已处理',
    };
    const nextDecision = allowed[String(decision)] ? String(decision) : 'manual_review';
    const assets = readAssetIndex();
    const index = assets.findIndex((asset) => String(asset.assetId) === String(assetId));
    if (index < 0) return JSON.stringify({ ok: false, message: '未找到资产。' });
    const now = new Date().toISOString();
    const asset = assets[index];
    assets[index] = {
      ...asset,
      governanceDecision: nextDecision,
      governanceDecisionLabel: allowed[nextDecision],
      governanceDecisionNote: String(note || ''),
      governanceDecisionAt: now,
      governanceStatus: nextDecision === 'resolved' ? 'resolved' : asset.governanceStatus || 'reviewed',
      updatedAt: now,
    };
    writeAssetIndex(assets);
    const decisionFile = path.join(app.getPath('userData'), 'asset-governance-decisions.md');
    writeTextIfMissing(decisionFile, `# 文件资产治理人工决策记录\n\n| 时间 | 资产 | 文件 | 决策 | 备注 | 路径 |\n| --- | --- | --- | --- | --- | --- |\n`);
    fs.appendFileSync(decisionFile, `| ${now} | ${mdCell(asset.assetId)} | ${mdCell(asset.filename)} | ${mdCell(allowed[nextDecision])} | ${mdCell(note || '-')} | ${mdCell(asset.path)} |\n`, 'utf8');
    appendHostTimeline({ type: 'asset_governance_decision', title: 'Asset governance decision', detail: `${asset.filename} ${allowed[nextDecision]}`, count: 1 });
    return JSON.stringify({
      ...assetIndexSummary(),
      ok: true,
      decision: nextDecision,
      decisionLabel: allowed[nextDecision],
      decisionPath: decisionFile,
      message: `已将「${asset.filename}」标记为：${allowed[nextDecision]}。`,
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `标记资产治理决策失败：${error.message}` });
  }
}

function analyzeAssetGovernance() {
  try {
    const assets = readAssetIndex();
    const now = new Date().toISOString();
    const shaGroups = new Map();
    for (const asset of assets) {
      if (!asset.sha1) continue;
      const current = shaGroups.get(asset.sha1) || [];
      current.push(asset);
      shaGroups.set(asset.sha1, current);
    }
    const keepBySha = new Map();
    for (const [sha1, group] of shaGroups.entries()) {
      if (group.length <= 1) continue;
      const sorted = [...group].sort((a, b) => {
        const existsDiff = Number(fs.existsSync(b.path || '')) - Number(fs.existsSync(a.path || ''));
        if (existsDiff) return existsDiff;
        const refDiff = (Array.isArray(b.references) ? b.references.length : 0) - (Array.isArray(a.references) ? a.references.length : 0);
        if (refDiff) return refDiff;
        return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
      });
      keepBySha.set(sha1, sorted[0]?.assetId || '');
    }
    const nextAssets = assets.map((asset) => {
      const references = Array.isArray(asset.references) ? asset.references : [];
      const referenceKeys = references.map((ref) => `${ref.spaceType}|${ref.spaceId}|${ref.role}|${ref.path}`);
      const duplicateReferenceCount = referenceKeys.length - new Set(referenceKeys).size;
      const staleReferenceCount = references.filter((ref) => ref.path && !fs.existsSync(ref.path)).length;
      const missingFile = Boolean(asset.path && !fs.existsSync(asset.path));
      const duplicateAssetCount = asset.sha1 ? (shaGroups.get(asset.sha1) || []).length : 1;
      let governanceAction = '无需处理';
      let riskLevel = 'low';
      const reasons = [];
      if (missingFile && references.length === 0) {
        governanceAction = '建议移出索引';
        riskLevel = 'high';
        reasons.push('资产物理文件不存在，且没有引用记录。');
      } else if (missingFile) {
        governanceAction = '建议修复路径或重新补建索引';
        riskLevel = 'high';
        reasons.push('资产主路径不存在，但仍有关联引用。');
      }
      if (duplicateAssetCount > 1) {
        governanceAction = governanceAction === '无需处理' ? '建议合并重复资产记录' : `${governanceAction}；建议合并重复资产记录`;
        riskLevel = riskLevel === 'high' ? 'high' : 'medium';
        reasons.push(`发现 ${duplicateAssetCount} 条相同 SHA-1 的资产记录。`);
      }
      if (staleReferenceCount > 0) {
        governanceAction = governanceAction === '无需处理' ? '建议清理失效引用' : `${governanceAction}；建议清理失效引用`;
        riskLevel = riskLevel === 'high' ? 'high' : 'medium';
        reasons.push(`${staleReferenceCount} 条引用路径不存在。`);
      }
      if (duplicateReferenceCount > 0) {
        governanceAction = governanceAction === '无需处理' ? '建议去重引用' : `${governanceAction}；建议去重引用`;
        riskLevel = riskLevel === 'high' ? 'high' : 'medium';
        reasons.push(`${duplicateReferenceCount} 条引用疑似重复。`);
      }
      if (!missingFile && references.length === 0) {
        governanceAction = governanceAction === '无需处理' ? '建议补充引用或归档观察' : governanceAction;
        riskLevel = riskLevel === 'low' ? 'medium' : riskLevel;
        reasons.push('资产存在但没有学生或项目引用。');
      }
      return {
        ...asset,
        governanceAction,
        governanceReason: reasons.join(' ') || '资产路径和引用关系正常。',
        governanceRisk: riskLevel,
        staleReferenceCount,
        duplicateReferenceCount,
        duplicateAssetCount,
        recommendedKeepAssetId: asset.sha1 ? keepBySha.get(asset.sha1) || '' : '',
        governanceReviewedAt: now,
      };
    });
    writeAssetIndex(nextAssets);
    const issueAssets = nextAssets.filter((asset) => asset.governanceAction && asset.governanceAction !== '无需处理');
    const duplicateGroups = Array.from(shaGroups.values()).filter((group) => group.length > 1);
    const missingCount = nextAssets.filter((asset) => asset.path && !fs.existsSync(asset.path)).length;
    const staleRefCount = nextAssets.reduce((total, asset) => total + Number(asset.staleReferenceCount || 0), 0);
    const rowsFor = (list) => list.map((asset) => `| ${mdCell(asset.filename)} | ${mdCell(asset.governanceRisk)} | ${mdCell(asset.governanceAction)} | ${mdCell(asset.governanceReason)} | ${mdCell(asset.recommendedKeepAssetId || '-')} | ${mdCell(asset.path)} |`).join('\n') || '| 暂无 | - | - | - | - | - |';
    const report = `# 文件资产中心治理建议

生成时间：${new Date(now).toLocaleString('zh-CN')}

## 总览

| 指标 | 数量 |
| --- | ---: |
| 资产总数 | ${nextAssets.length} |
| 需治理资产 | ${issueAssets.length} |
| 重复资产组 | ${duplicateGroups.length} |
| 主路径不存在 | ${missingCount} |
| 失效引用 | ${staleRefCount} |

## 治理清单

| 文件 | 风险 | 建议 | 理由 | 建议保留资产 | 路径 |
| --- | --- | --- | --- | --- | --- |
${rowsFor(issueAssets)}

## 全量资产检查结果

| 文件 | 风险 | 建议 | 理由 | 建议保留资产 | 路径 |
| --- | --- | --- | --- | --- | --- |
${rowsFor(nextAssets)}

## 处理原则

- 本报告只提供治理建议，不会自动删除、移动、合并任何物理文件。
- 对重复文件，优先保留路径存在、引用次数更多、更新时间更新的资产记录。
- 对失效引用，建议先确认原文件是否迁移，再通过“扫描并补建资产索引”刷新。
`;
    fs.writeFileSync(assetGovernanceReportPath(), report, 'utf8');
    appendHostTimeline({ type: 'asset_governance_analyzed', title: 'Asset governance analyzed', detail: `${issueAssets.length} issue asset(s)`, count: issueAssets.length });
    return JSON.stringify({
      ...assetIndexSummary(),
      reportPath: assetGovernanceReportPath(),
      content: report,
      issueCount: issueAssets.length,
      missingCount,
      staleReferenceCount: staleRefCount,
      message: `已生成资产治理建议：需治理 ${issueAssets.length} 个资产，重复组 ${duplicateGroups.length} 组，失效引用 ${staleRefCount} 条。`,
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `生成资产治理建议失败：${error.message}` });
  }
}

function collectFilesRecursive(current, files, depth) {
  if (!current || depth < 0 || !fs.existsSync(current)) return;
  let entries = [];
  try {
    entries = fs.readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      collectFilesRecursive(full, files, depth - 1);
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
}

function isAllowedMaterialFile(filePath) {
  return isAllowedUploadFile(path.basename(filePath));
}

function rebuildAssetIndex() {
  const existing = readAssetIndex();
  const next = new Map(existing.map((asset) => [asset.assetId, asset]));
  const uploadRecords = readUploadRecords();
  registerAssetsFromUploadRecords(uploadRecords);
  const students = readStudentsIndex();
  for (const student of students) {
    const materials = readStudentMaterials(student);
    for (const material of materials) {
      if (material.absolutePath && fs.existsSync(material.absolutePath)) {
        const asset = upsertAssetFromFile(material.absolutePath, {
          studentId: String(student.id || ''),
          studentName: student.name || '',
          sourcePath: material.sourcePath || '',
          sourceName: material.sourceName || '学生原始资料库',
          uploadedAt: material.uploadedAt || '',
          referenceId: material.id || '',
          role: 'student_raw',
        });
        if (asset) next.set(asset.assetId, asset);
      }
    }
    const rawDir = student.rawPath || getRawDir(student.name);
    if (rawDir && fs.existsSync(rawDir)) {
      const rawFiles = [];
      collectFilesRecursive(rawDir, rawFiles, 8);
      for (const rawFile of rawFiles) {
        if (!isAllowedMaterialFile(rawFile)) continue;
        const asset = upsertAssetFromFile(rawFile, {
          studentId: String(student.id || ''),
          studentName: student.name || '',
          sourceName: '学生原始资料库扫描',
          role: 'student_raw_scanned',
          referenceId: `scan-${student.id}-${crypto.createHash('sha1').update(rawFile).digest('hex').slice(0, 12)}`,
        });
        if (asset) next.set(asset.assetId, asset);
      }
    }
  }
  const projects = readProjects().map(normalizeProject);
  for (const project of projects) {
    const rawDir = project.rawPath || projectPathsFor(project.name, project.projectRootPath, project).rawPath;
    if (!rawDir || !fs.existsSync(rawDir)) continue;
    const rawFiles = [];
    collectFilesRecursive(rawDir, rawFiles, 8);
    for (const rawFile of rawFiles) {
      if (!isAllowedMaterialFile(rawFile)) continue;
      const asset = upsertAssetFromFile(rawFile, {
        projectId: String(project.id || ''),
        projectName: project.name || '',
        sourceName: '项目原始资料库扫描',
        role: 'project_raw_scanned',
        referenceId: `scan-${project.id}-${crypto.createHash('sha1').update(rawFile).digest('hex').slice(0, 12)}`,
      });
      if (asset) next.set(asset.assetId, asset);
    }
  }
  readAssetIndex().forEach((asset) => next.set(asset.assetId, asset));
  writeAssetIndex(Array.from(next.values()).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))));
  const summary = assetIndexSummary();
  appendHostTimeline({ type: 'asset_index_rebuilt', title: 'Asset index rebuilt', detail: `${summary.total} asset(s)` });
  return JSON.stringify({ ...summary, message: `已补建资产索引，共 ${summary.total} 个资产。` });
}

function isPathInside(parent, child) {
  try {
    const relative = path.relative(parent, child);
    return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
  } catch {
    return false;
  }
}

function normalizeMaterialSources(sources) {
  return (Array.isArray(sources) ? sources : [])
    .map((source, index) => {
      const sourcePath = String(source?.path || '').trim();
      if (!sourcePath) return null;
      return {
        id: String(source?.id || crypto.createHash('sha1').update(sourcePath).digest('hex').slice(0, 12)),
        name: String(source?.name || path.basename(sourcePath) || `来源目录 ${index + 1}`),
        path: sourcePath,
        enabled: source?.enabled !== false,
        lastScannedAt: String(source?.lastScannedAt || ''),
      };
    })
    .filter(Boolean);
}

function pickMaterialSourceDir() {
  try {
    const result = dialog.showOpenDialogSync(mainWindow, {
      title: '选择资料来源目录',
      properties: ['openDirectory'],
    });
    if (!result || !result[0]) return JSON.stringify({ ok: false, message: '未选择资料来源目录。' });
    const sourcePath = result[0];
    return JSON.stringify({
      ok: true,
      source: {
        id: crypto.createHash('sha1').update(sourcePath).digest('hex').slice(0, 12),
        name: path.basename(sourcePath) || sourcePath,
        path: sourcePath,
        enabled: true,
      },
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `选择资料来源目录失败：${error.message}` });
  }
}

function walkMaterialFiles(root, options = {}) {
  const maxDepth = Number(options.maxDepth ?? 4);
  const maxFiles = Number(options.maxFiles ?? 500);
  const files = [];
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length && files.length < maxFiles) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < maxDepth && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          stack.push({ dir: fullPath, depth: current.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile() || !isAllowedUploadFile(entry.name)) continue;
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size <= 0 || stat.size > MAX_UPLOAD_BYTES) continue;
        files.push({ path: fullPath, name: entry.name, size: stat.size, modified: stat.mtimeMs });
      } catch {
        // Ignore files that disappear during scanning.
      }
      if (files.length >= maxFiles) break;
    }
  }
  return files.sort((a, b) => Number(b.modified || 0) - Number(a.modified || 0));
}

function scanMaterialSources(studentId, sourcesJson) {
  const student = findStudentByKey(studentId);
  if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
  try {
    const parsed = JSON.parse(sourcesJson || '[]');
    const sources = normalizeMaterialSources(parsed).filter((source) => source.enabled);
    if (!sources.length) return JSON.stringify({ ok: true, files: [], message: '尚未启用资料来源目录。' });
    const rawPath = student.rawPath || getRawDir(student.name);
    const materialHashes = new Set(readStudentMaterials(student).map((item) => String(item.sha1 || '')).filter(Boolean));
    const uploadHashes = new Set(readUploadRecords().filter((record) => String(record.studentId) === String(student.id)).map((record) => String(record.sha1 || '')).filter(Boolean));
    const seenPaths = new Set();
    const files = [];
    for (const source of sources) {
      if (!fs.existsSync(source.path)) {
        files.push({
          id: source.id,
          sourceId: source.id,
          sourceName: source.name,
          path: source.path,
          name: source.name,
          size: 0,
          modified: 0,
          type: '目录不可访问',
          status: 'failed',
          importable: false,
          reason: '来源目录不存在或不可访问',
        });
        continue;
      }
      for (const file of walkMaterialFiles(source.path, { maxDepth: 4, maxFiles: 500 })) {
        if (seenPaths.has(file.path) || isPathInside(rawPath, file.path)) continue;
        seenPaths.add(file.path);
        const sha1 = sha1File(file.path);
        const imported = Boolean(sha1 && (materialHashes.has(sha1) || uploadHashes.has(sha1)));
        files.push({
          id: crypto.createHash('sha1').update(`${source.id}|${file.path}`).digest('hex'),
          sourceId: source.id,
          sourceName: source.name,
          path: file.path,
          name: file.name,
          size: file.size,
          modified: file.modified,
          type: path.extname(file.name).slice(1).toUpperCase() || '文件',
          sha1,
          status: imported ? 'imported' : 'new',
          importable: !imported,
          reason: imported ? '已导入，默认跳过' : '',
        });
      }
    }
    const limited = files.sort((a, b) => Number(b.modified || 0) - Number(a.modified || 0)).slice(0, 200);
    return JSON.stringify({
      ok: true,
      files: limited,
      scannedAt: new Date().toISOString(),
      message: limited.length ? `已扫描到 ${limited.length} 个可识别资料文件。` : '来源目录中暂未发现可导入资料文件。',
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `扫描资料来源目录失败：${error.message}` });
  }
}

function findSourceForPath(sources, filePath) {
  const normalized = normalizeMaterialSources(sources);
  return normalized.find((source) => filePath === source.path || isPathInside(source.path, filePath)) || null;
}

function importMaterialSourceFiles(studentId, pathsJson) {
  const student = findStudentByKey(studentId);
  if (!student) return JSON.stringify({ ok: false, imported: 0, skipped: 0, failed: 0, message: '未找到学生。' });
  try {
    const paths = JSON.parse(pathsJson || '[]');
    if (!Array.isArray(paths) || !paths.length) return JSON.stringify({ ok: false, imported: 0, skipped: 0, failed: 0, message: '请先选择要导入的资料文件。' });
    const rawPath = student.rawPath || getRawDir(student.name);
    fs.mkdirSync(rawPath, { recursive: true });
    const existingHashes = new Set(readStudentMaterials(student).map((item) => String(item.sha1 || '')).filter(Boolean));
    readUploadRecords()
      .filter((record) => String(record.studentId) === String(student.id))
      .forEach((record) => {
        if (record.sha1) existingHashes.add(String(record.sha1));
      });
    const saved = [];
    let skipped = 0;
    let failed = 0;
    const sourceList = normalizeMaterialSources(student.materialSources);
    for (const sourcePath of paths.map((item) => String(item || '')).filter(Boolean)) {
      try {
        if (!fs.existsSync(sourcePath)) {
          failed += 1;
          continue;
        }
        const stat = fs.statSync(sourcePath);
        assertUploadFileAllowed(path.basename(sourcePath), stat.size);
        const hash = sha1File(sourcePath);
        if (hash && existingHashes.has(hash)) {
          skipped += 1;
          continue;
        }
        const target = uniqueTargetFile(rawPath, path.basename(sourcePath));
        fs.copyFileSync(sourcePath, target);
        const source = findSourceForPath(sourceList, sourcePath);
        const targetHash = sha1File(target);
        if (targetHash) existingHashes.add(targetHash);
        saved.push({
          id: `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
          studentId: String(student.id),
          studentName: student.name,
          filename: path.basename(target),
          size: stat.size,
          path: target,
          rawPath,
          sha1: targetHash,
          sourcePath,
          sourceName: source?.name || path.basename(path.dirname(sourcePath)) || '资料来源目录',
          deviceId: 'admin',
          deviceName: '主机控制台',
          uploadedAt: new Date().toISOString(),
        });
      } catch {
        failed += 1;
      }
    }
    if (saved.length) {
      addUploadRecords(saved);
      notify('onNativeHostServiceChanged', getHostServiceStatus());
    }
    return JSON.stringify({
      ok: saved.length > 0,
      imported: saved.length,
      skipped,
      failed,
      records: saved,
      message: saved.length
        ? `已导入 ${saved.length} 个文件到「${student.name}原始资料库」${skipped ? `，跳过 ${skipped} 个重复文件` : ''}${failed ? `，${failed} 个文件失败` : ''}。`
        : skipped
          ? `没有新文件导入，已跳过 ${skipped} 个重复文件。`
          : '没有文件被成功导入。',
    });
  } catch (error) {
    return JSON.stringify({ ok: false, imported: 0, skipped: 0, failed: 0, message: `导入资料来源文件失败：${error.message}` });
  }
}

function getMaterialImportRecords(studentId) {
  const records = readUploadRecords()
    .filter((record) => String(record.studentId) === String(studentId))
    .map((record) => ({
      id: String(record.id || ''),
      studentId: String(record.studentId || ''),
      sourcePath: record.sourcePath || '',
      sourceName: record.sourceName || record.deviceName || record.deviceId || '未知来源',
      targetPath: record.path || '',
      fileName: record.filename || path.basename(record.path || ''),
      fileSize: Number(record.size || 0),
      fileHash: record.sha1 || '',
      importedAt: record.uploadedAt || '',
      status: normalizeUploadStatus(record.status),
      reason: record.sourcePath ? '' : '来自平板上传或手动导入',
    }))
    .sort((a, b) => String(b.importedAt || '').localeCompare(String(a.importedAt || '')))
    .slice(0, 100);
  return JSON.stringify({ ok: true, records });
}

function addUploadRecords(records) {
  if (!records.length) return;
  const stamped = records.map((record) => ({
    status: 'pending_digest',
    statusUpdatedAt: new Date().toISOString(),
    ...record,
  }));
  writeUploadRecords([...stamped, ...readUploadRecords()]);
  registerAssetsFromUploadRecords(stamped);
  const students = readStudentsIndex();
  const grouped = new Map();
  stamped.forEach((record) => {
    const key = String(record.studentId || '');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(record);
  });
  grouped.forEach((items, studentId) => {
    const student = students.find((item) => String(item.id) === studentId);
    if (student) upsertStudentMaterialsFromUploads(student, items.map((item) => ({ ...item, rawPath: student.rawPath || getRawDir(student.name) })));
  });
  appendHostTimeline({
    type: 'materials_uploaded',
    title: 'Materials uploaded',
    detail: `${stamped.length} file(s) uploaded and indexed`,
    studentId: stamped[0]?.studentId || '',
    studentName: stamped[0]?.studentName || '',
    count: stamped.length,
  });
}

function readHostTimeline() {
  try {
    const parsed = JSON.parse(fs.readFileSync(hostTimelinePath(), 'utf8'));
    return Array.isArray(parsed.events) ? parsed.events : [];
  } catch {
    return [];
  }
}

function writeHostTimeline(events) {
  fs.mkdirSync(path.dirname(hostTimelinePath()), { recursive: true });
  fs.writeFileSync(hostTimelinePath(), JSON.stringify({ events: events.slice(0, 300) }, null, 2), 'utf8');
}

function appendHostTimeline(event) {
  const next = {
    id: `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    at: new Date().toISOString(),
    ...event,
  };
  writeHostTimeline([next, ...readHostTimeline()]);
  return next;
}

function getHostTimeline() {
  return JSON.stringify({ ok: true, events: readHostTimeline() });
}

function setHostUploadRecordStatus(recordId, status) {
  const nextStatus = normalizeUploadStatus(status);
  const records = readUploadRecords();
  const index = records.findIndex((item) => String(item.id) === String(recordId));
  if (index < 0) return JSON.stringify({ ok: false, message: 'Upload record not found.' });
  const now = new Date().toISOString();
  records[index] = {
    ...records[index],
    status: nextStatus,
    statusUpdatedAt: now,
    ...(nextStatus === 'processed' ? { digestedAt: now } : {}),
  };
  writeUploadRecords(records);
  const student = readStudentsIndex().find((item) => String(item.id) === String(records[index].studentId));
  if (student) upsertStudentMaterialsFromUploads(student, [{ ...records[index], rawPath: student.rawPath || getRawDir(student.name) }]);
  appendHostTimeline({
    type: 'upload_status_changed',
    title: 'Upload status changed',
    detail: `${records[index].filename || ''} -> ${nextStatus}`,
    studentId: records[index].studentId || '',
    studentName: records[index].studentName || '',
    recordId: records[index].id,
    status: nextStatus,
  });
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  return JSON.stringify({ ok: true, record: records[index], status: JSON.parse(getHostServiceStatus()) });
}

function markStudentDigestSubmitted(studentId) {
  const now = new Date().toISOString();
  let updated = 0;
  const records = readUploadRecords().map((record) => {
    if (String(record.studentId) !== String(studentId) || record.status === 'processed') return record;
    updated += 1;
    return { ...record, status: 'submitted', statusUpdatedAt: now };
  });
  writeUploadRecords(records);
  const student = readStudentsIndex().find((item) => String(item.id) === String(studentId));
  if (student) {
    syncStudentMaterialsFromUploadRecords(student);
    writeStudentDigestState(student, {
      status: 'digesting',
      digestSubmittedAt: now,
      message: `已提交 QClaw 消化，等待结果同步。`,
    });
  }
  appendHostTimeline({
    type: 'digest_submitted',
    title: 'Digest command submitted',
    detail: `${updated} upload record(s) marked as submitted`,
    studentId: String(studentId || ''),
    studentName: student?.name || '',
    count: updated,
  });
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  return JSON.stringify({ ok: true, updated, status: JSON.parse(getHostServiceStatus()), records });
}

function latestFileMtime(files) {
  let latest = 0;
  for (const file of files) {
    try {
      if (fs.existsSync(file)) latest = Math.max(latest, fs.statSync(file).mtimeMs);
    } catch {
      // Ignore inaccessible files.
    }
  }
  return latest;
}

function normalizeDigestStateStatus(status) {
  const value = String(status || '').toLowerCase();
  if (['completed', 'complete', 'success', 'processed', 'digested', 'done'].includes(value)) return 'completed';
  if (['failed', 'error'].includes(value)) return 'failed';
  if (['digesting', 'running', 'submitted'].includes(value)) return 'digesting';
  if (['pending', 'waiting'].includes(value)) return 'pending';
  return value || 'idle';
}

function fileContainsAny(file, patterns) {
  try {
    if (!fs.existsSync(file)) return false;
    const text = fs.readFileSync(file, 'utf8');
    return patterns.some((pattern) => pattern.test(text));
  } catch {
    return false;
  }
}

function inferDigestCompletedFromSummary(summaryPath, sinceMs) {
  if (!summaryPath || !sinceMs) return false;
  const logFile = path.join(summaryPath, 'log.md');
  const indexFile = path.join(summaryPath, 'index.md');
  const latest = latestFileMtime([logFile, indexFile]);
  if (!latest || latest < sinceMs) return false;
  return fileContainsAny(logFile, [/消化完成|处理完成|已完成|无新增资料|已更新|摘要|沉淀/])
    || fileContainsAny(indexFile, [/updated|更新|摘要|综合|学情|报告/]);
}

function syncStudentDigestResult(studentId, options = {}) {
  const student = readStudentsIndex().find((item) => String(item.id) === String(studentId));
  if (!student) return JSON.stringify({ ok: false, message: 'Student not found.' });
  syncStudentMaterialsFromUploadRecords(student);
  const now = new Date().toISOString();
  const state = readStudentDigestState(student);
  const digestStatus = normalizeDigestStateStatus(state.status);
  const rawPath = student.rawPath || getRawDir(student.name);
  const summaryPath = student.summaryPath || getSummaryDir(student.name);
  const digestFile = studentDigestStatePath(student);
  const allRecords = readUploadRecords();
  const studentRecords = allRecords.filter((record) => String(record.studentId) === String(studentId));
  const latestSubmittedMs = Math.max(
    state.digestSubmittedAt ? Date.parse(state.digestSubmittedAt) || 0 : 0,
    ...studentRecords
      .filter((record) => ['submitted', 'digesting'].includes(normalizeUploadStatus(record.status)))
      .map((record) => Date.parse(record.statusUpdatedAt || record.uploadedAt || '') || 0),
  );
  const latestDigestMs = Math.max(
    state.lastDigestAt ? Date.parse(state.lastDigestAt) || 0 : 0,
    latestFileMtime([
      digestFile,
      path.join(summaryPath, 'log.md'),
      path.join(summaryPath, 'index.md'),
    ]),
  );
  const inferredCompleted = inferDigestCompletedFromSummary(summaryPath, latestSubmittedMs);
  const effectiveDigestStatus = inferredCompleted && digestStatus !== 'failed' ? 'completed' : digestStatus;
  const digestedNames = new Set(
    []
      .concat(Array.isArray(state.digestedFiles) ? state.digestedFiles : [])
      .concat(Array.isArray(state.processedFiles) ? state.processedFiles : [])
      .map((item) => path.basename(String(item || '')).toLowerCase())
      .filter(Boolean),
  );
  let changed = 0;
  const batchId = state.digestBatchId || `digest-${Date.now()}`;
  const timeoutMs = 4 * 60 * 60 * 1000;
  const timedOutCount = studentRecords.filter((record) =>
    ['submitted', 'digesting'].includes(normalizeUploadStatus(record.status))
    && (Date.now() - (Date.parse(record.statusUpdatedAt || record.uploadedAt || '') || Date.now())) > timeoutMs
  ).length;
  const records = allRecords.map((record) => {
    if (String(record.studentId) !== String(studentId) || normalizeUploadStatus(record.status) === 'processed') return record;
    const uploadedMs = record.uploadedAt ? Date.parse(record.uploadedAt) || 0 : 0;
    const nameMatched = digestedNames.size > 0 && digestedNames.has(path.basename(String(record.filename || '')).toLowerCase());
    const timeMatched = latestDigestMs > 0 && uploadedMs > 0 && uploadedMs <= latestDigestMs;
    const submittedMatched = options.forceSubmitted && normalizeUploadStatus(record.status) === 'submitted';
    if (effectiveDigestStatus === 'failed') {
      changed += 1;
      return { ...record, status: 'failed', statusUpdatedAt: now };
    }
    if (effectiveDigestStatus === 'completed' && (nameMatched || (digestedNames.size === 0 && timeMatched) || submittedMatched || inferredCompleted)) {
      changed += 1;
      return { ...record, status: 'processed', statusUpdatedAt: now, digestedAt: state.lastDigestAt || now, digestBatchId: batchId };
    }
    return record;
  });
  writeUploadRecords(records);
  syncStudentMaterialsFromUploadRecords(student);
  const openCount = records.filter((record) => String(record.studentId) === String(studentId) && isOpenDigestStatus(record.status)).length;
  const reportHealth = learningReportHealthSummary(LEARNING_REPORTS.map((report) => learningReportRecord(student, report)));
  const reportReminder = reportHealth.ok ? '学情报告状态正常。' : reportHealth.message;
  const nextState = writeStudentDigestState(student, {
    status: effectiveDigestStatus === 'completed' && openCount === 0 ? 'completed' : timedOutCount > 0 ? 'timeout' : openCount > 0 ? 'pending' : 'idle',
    lastDigestAt: effectiveDigestStatus === 'completed' ? (state.lastDigestAt || (latestDigestMs ? new Date(latestDigestMs).toISOString() : now)) : (state.lastDigestAt || ''),
    digestBatchId: batchId,
    message: changed > 0
      ? `已同步 QClaw 消化结果，${changed} 份资料标记为已消化。请检查四份学情报告是否已更新。${reportReminder}`
      : timedOutCount > 0
        ? `有 ${timedOutCount} 份资料提交消化超过 4 小时未完成。请检查 QClaw 任务、digest-state.json 和 log.md。`
      : openCount > 0
        ? `仍有 ${openCount} 份资料待消化；如 QClaw 已完成，请确认 digest-state.json 或 log.md 已更新。`
        : '暂无待消化资料。',
    rawPath,
    summaryPath,
    reportHealth,
  });
  appendHostTimeline({
    type: 'digest_synced',
    title: 'Digest result synced',
    detail: nextState.message,
    studentId: String(studentId || ''),
    studentName: student.name || '',
    count: changed,
  });
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  return JSON.stringify({ ok: true, updated: changed, state: nextState, records, status: JSON.parse(getHostServiceStatus()) });
}

function isAllowedUploadFile(filename) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  return Boolean(ext) && ALLOWED_UPLOAD_EXTENSIONS.has(ext);
}

function assertUploadFileAllowed(filename, size) {
  if (!isAllowedUploadFile(filename)) {
    throw new Error(`Unsupported file type: ${filename || 'unnamed file'}`);
  }
  if (Number(size || 0) > MAX_UPLOAD_BYTES) {
    throw new Error(`File is too large: ${filename || 'unnamed file'}`);
  }
}

function escapeCsvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function getHostUploadRecords() {
  return JSON.stringify({ ok: true, records: readUploadRecords() });
}

function exportHostUploadRecords() {
  const records = readUploadRecords();
  const header = ['上传时间', '学生', '设备', '文件名', '大小', '文件路径'];
  const rows = records.map((record) => [
    record.uploadedAt || '',
    record.studentName || '',
    record.deviceName || '',
    record.filename || '',
    record.size || '',
    record.path || '',
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map(escapeCsvCell).join(','))
    .join('\r\n');
  const filename = `AI教育管家上传记录-${new Date().toISOString().slice(0, 10)}.csv`;
  const target = path.join(downloadsDir(), filename);
  fs.writeFileSync(target, `\uFEFF${csv}`, 'utf8');
  return JSON.stringify({ ok: true, path: target, count: records.length });
}

function openHostUploadRecord(recordId) {
  const record = readUploadRecords().find((item) => String(item.id) === String(recordId));
  if (!record || !record.path) return JSON.stringify({ ok: false, message: '未找到该上传记录。' });
  if (!fs.existsSync(record.path)) return JSON.stringify({ ok: false, message: '文件已不存在或路径不可访问。' });
  shell.showItemInFolder(record.path);
  return JSON.stringify({ ok: true });
}

function clearHostUploadRecords() {
  writeUploadRecords([]);
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  return JSON.stringify({ ok: true, status: JSON.parse(getHostServiceStatus()) });
}

function timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function backupHostData(studentsJson) {
  try {
    let backupStudents = readStudentsIndex();
    if (studentsJson) {
      const parsedStudents = JSON.parse(studentsJson);
      if (!Array.isArray(parsedStudents)) throw new Error('学生档案备份数据格式无效。');
      backupStudents = parsedStudents;
    }
    const payload = {
      kind: 'ai-edu-manager-host-backup',
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      settings: readSettings(),
      students: backupStudents,
      devices: readDevices(),
      uploadRecords: readUploadRecords(),
      assets: readAssetIndex(),
      projects: readProjects(),
      timeline: readHostTimeline(),
    };
    const target = path.join(downloadsDir(), `AI-edu-manager-host-backup-${timestampForFilename()}.json`);
    fs.writeFileSync(target, JSON.stringify(payload, null, 2), 'utf8');
    appendHostTimeline({ type: 'backup_created', title: 'Backup created', detail: target });
    return JSON.stringify({ ok: true, path: target });
  } catch (error) {
    return JSON.stringify({ ok: false, message: error.message });
  }
}

function restoreHostData() {
  try {
    const result = dialog.showOpenDialogSync(mainWindow, {
      title: 'Select host backup file',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!result || !result[0]) return JSON.stringify({ ok: false, message: 'No backup file selected.' });
    const parsed = JSON.parse(fs.readFileSync(result[0], 'utf8'));
    if (parsed.kind !== 'ai-edu-manager-host-backup') throw new Error('Unsupported backup file.');
    if (parsed.settings && typeof parsed.settings === 'object') writeSettings(parsed.settings);
    if (Array.isArray(parsed.students)) writeStudentsIndex(parsed.students.map(toHostStudent));
    if (Array.isArray(parsed.devices)) writeDevices(parsed.devices);
    if (Array.isArray(parsed.uploadRecords)) writeUploadRecords(parsed.uploadRecords);
    if (Array.isArray(parsed.assets)) writeAssetIndex(parsed.assets);
    if (Array.isArray(parsed.projects)) writeProjects(parsed.projects);
    if (Array.isArray(parsed.timeline)) writeHostTimeline(parsed.timeline);
    appendHostTimeline({ type: 'backup_restored', title: 'Backup restored', detail: result[0] });
    notify('onNativeHostServiceChanged', getHostServiceStatus());
    return JSON.stringify({
      ok: true,
      path: result[0],
      students: Array.isArray(parsed.students) ? parsed.students.length : 0,
      devices: Array.isArray(parsed.devices) ? parsed.devices.length : 0,
      uploadRecords: Array.isArray(parsed.uploadRecords) ? parsed.uploadRecords.length : 0,
      assets: Array.isArray(parsed.assets) ? parsed.assets.length : 0,
      projects: Array.isArray(parsed.projects) ? parsed.projects.length : 0,
      studentRecords: Array.isArray(parsed.students) ? parsed.students : [],
      status: JSON.parse(getHostServiceStatus()),
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: error.message });
  }
}

function resetHostApiToken() {
  const settings = readSettings();
  settings.apiToken = crypto.randomBytes(24).toString('hex');
  writeSettings(settings);
  appendHostTimeline({ type: 'api_token_reset', title: 'API token reset', detail: 'Admin API token was regenerated.' });
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  return JSON.stringify({ ok: true, apiToken: settings.apiToken, status: JSON.parse(getHostServiceStatus()) });
}

function exportHostLogs() {
  try {
    const payload = {
      kind: 'ai-edu-manager-host-diagnostics',
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      status: JSON.parse(getHostServiceStatus()),
      diagnostics: JSON.parse(getHostServiceDiagnostics()),
      students: readStudentsIndex(),
      devices: readDevices().map(publicDevice),
      uploadRecords: readUploadRecords(),
      assets: readAssetIndex(),
      projects: readProjects(),
      timeline: readHostTimeline(),
      paths: {
        userData: app.getPath('userData'),
        studentBaseDir: defaultStudentBaseDir(),
      },
    };
    const target = path.join(downloadsDir(), `AI-edu-manager-host-diagnostics-${timestampForFilename()}.json`);
    fs.writeFileSync(target, JSON.stringify(payload, null, 2), 'utf8');
    return JSON.stringify({ ok: true, path: target });
  } catch (error) {
    return JSON.stringify({ ok: false, message: error.message });
  }
}

function openStudentRawDir(studentId) {
  const student = readStudentsIndex().find((item) => String(item.id) === String(studentId));
  if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
  const target = student.rawPath || getRawDir(student.name);
  fs.mkdirSync(target, { recursive: true });
  shell.openPath(target);
  return JSON.stringify({ ok: true, path: target });
}

function openProjectSpace(projectId, space) {
  try {
    const project = readProjects().find((item) => String(item.id) === String(projectId));
    if (!project) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    const ensured = project.status === 'sealed' ? normalizeProject(project) : ensureProjectWorkspace(project);
    const targets = {
      root: { path: ensured.projectRootPath, label: '项目根目录' },
      workspace: { path: ensured.workspacePath, label: '项目工作空间' },
      raw: { path: ensured.rawPath, label: '项目原始资料库' },
      knowledge: { path: ensured.knowledgeRootPath, label: '项目知识空间' },
    };
    const selected = targets[String(space || '')];
    if (!selected?.path) return JSON.stringify({ ok: false, message: '不支持打开该项目目录。' });
    const target = selected.path;
    if (!fs.existsSync(target) && project.status === 'sealed') return JSON.stringify({ ok: false, message: '封存项目的目录不存在，需先恢复项目后才能补建。' });
    fs.mkdirSync(target, { recursive: true });
    shell.openPath(target).catch(() => {});
    return JSON.stringify({
      ok: true,
      path: target,
      message: `已打开${selected.label}。`,
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `打开项目空间失败：${error.message}` });
  }
}

function migrateStudentWorkspace(studentId, newName) {
  try {
    const students = readStudentsIndex();
    const index = students.findIndex((item) => String(item.id) === String(studentId));
    if (index < 0) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const student = students[index];
    const cleanName = sanitizeName(newName || student.name);
    const oldRoot = student.rootPath || getStudentRootDir(student.name);
    const oldRaw = student.rawPath || getRawDir(student.name);
    const oldSummary = student.summaryPath || getSummaryDir(student.name);
    const newRoot = getStudentRootDir(cleanName);
    const newRaw = getRawDir(cleanName);
    const newSummary = getSummaryDir(cleanName);

    if (path.resolve(oldRoot) !== path.resolve(newRoot)) {
      if (fs.existsSync(newRoot)) return JSON.stringify({ ok: false, message: `目标知识库目录已存在：${newRoot}` });
      fs.mkdirSync(path.dirname(newRoot), { recursive: true });
      if (fs.existsSync(oldRoot)) fs.renameSync(oldRoot, newRoot);
      else fs.mkdirSync(newRoot, { recursive: true });
    }

    const movedOldRaw = path.join(newRoot, path.basename(oldRaw));
    const movedOldSummary = path.join(newRoot, path.basename(oldSummary));
    if (path.resolve(movedOldRaw) !== path.resolve(newRaw) && fs.existsSync(movedOldRaw) && !fs.existsSync(newRaw)) {
      fs.renameSync(movedOldRaw, newRaw);
    }
    if (path.resolve(movedOldSummary) !== path.resolve(newSummary) && fs.existsSync(movedOldSummary) && !fs.existsSync(newSummary)) {
      fs.renameSync(movedOldSummary, newSummary);
    }
    fs.mkdirSync(newRaw, { recursive: true });
    fs.mkdirSync(newSummary, { recursive: true });

    const nextStudent = {
      ...student,
      name: cleanName,
      rootPath: newRoot,
      rawPath: newRaw,
      summaryPath: newSummary,
      agentPath: path.join(newRoot, 'AGENT.md'),
      outputPath: path.join(newRoot, '输出结果'),
    };
    fs.mkdirSync(nextStudent.outputPath, { recursive: true });
    ensureStudentWorkspaceConfig(nextStudent);
    students[index] = nextStudent;
    writeStudentsIndex(students);
    notify('onNativeHostServiceChanged', getHostServiceStatus());
    return JSON.stringify({ ok: true, name: cleanName, rootPathLabel: newRoot, rawPath: newRaw, summaryPath: newSummary, agentPath: nextStudent.agentPath, outputPath: nextStudent.outputPath });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `迁移知识库目录失败：${error.message}` });
  }
}

function hashDeviceToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function createDeviceToken() {
  return `edt_${crypto.randomBytes(24).toString('hex')}`;
}

function publicDevice(device) {
  const records = readUploadRecords().filter((record) => String(record.deviceId || '') === String(device.id || ''));
  const lastSeenAt = device.lastSeenAt || '';
  const lastSeenMs = lastSeenAt ? Date.now() - Date.parse(lastSeenAt) : 0;
  return {
    id: device.id,
    name: device.name || '平板设备',
    tokenPreview: device.tokenPreview || '',
    allowedStudentIds: Array.isArray(device.allowedStudentIds) ? device.allowedStudentIds : [],
    allowedAllStudents: Boolean(device.allowedAllStudents),
    autoAuthorizeNewStudents: Boolean(device.autoAuthorizeNewStudents),
    authorizationStatus: device.revoked
      ? 'revoked'
      : (device.allowedAllStudents || (Array.isArray(device.allowedStudentIds) && device.allowedStudentIds.length > 0) ? 'approved' : 'pending'),
    revoked: Boolean(device.revoked),
    createdAt: device.createdAt || '',
    lastSeenAt,
    lastSeenAgoMs: Number.isFinite(lastSeenMs) ? lastSeenMs : 0,
    online: Boolean(!device.revoked && Number.isFinite(lastSeenMs) && lastSeenMs >= 0 && lastSeenMs <= 2 * 60 * 1000),
    lastIp: device.lastIp || '',
    lastUserAgent: device.lastUserAgent || '',
    uploadCount: records.length,
    lastUploadAt: records[0]?.uploadedAt || '',
  };
}

function createPairCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function getPairSession(forceNew = false) {
  const now = Date.now();
  if (!forceNew && activePairSession && activePairSession.expiresAtMs > now) return activePairSession;
  activePairSession = {
    pairCode: createPairCode(),
    createdAt: new Date(now).toISOString(),
    expiresAtMs: now + 10 * 60 * 1000,
  };
  activePairSession.expiresAt = new Date(activePairSession.expiresAtMs).toISOString();
  return activePairSession;
}

function getPairPayload() {
  const info = getConnectionInfo();
  const session = getPairSession();
  return {
    type: 'AI_EDU_MANAGER_PAIR',
    version: APP_VERSION,
    serverUrl: info.serverUrl,
    lanUrls: info.lanUrls,
    tailscaleUrl: info.tailscaleUrl,
    tailscaleUrls: info.tailscaleUrls,
    connectionMode: info.connectionMode,
    port: info.port,
    pairCode: session.pairCode,
    expiresAt: session.expiresAt,
  };
}

function deviceByBearerToken(token) {
  const tokenHash = hashDeviceToken(token);
  return readDevices().find((device) => device.tokenHash === tokenHash && !device.revoked);
}

function requestClientIp(request) {
  const forwarded = String(request?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const remote = String(request?.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  return forwarded || remote;
}

function requestUserAgent(request) {
  return String(request?.headers?.['user-agent'] || '').slice(0, 160);
}

function touchDevice(deviceId, request) {
  const devices = readDevices();
  const index = devices.findIndex((device) => device.id === deviceId);
  if (index < 0) return;
  const lastIp = requestClientIp(request);
  const lastUserAgent = requestUserAgent(request);
  devices[index] = {
    ...devices[index],
    lastSeenAt: new Date().toISOString(),
    lastIp: lastIp || devices[index].lastIp || '',
    lastUserAgent: lastUserAgent || devices[index].lastUserAgent || '',
  };
  writeDevices(devices);
}

function getHostDevices() {
  return JSON.stringify({ ok: true, devices: readDevices().map(publicDevice) });
}

function revokeHostDevice(deviceId) {
  const devices = readDevices();
  const index = devices.findIndex((device) => String(device.id) === String(deviceId));
  if (index < 0) return JSON.stringify({ ok: false, message: '未找到设备。' });
  devices[index] = { ...devices[index], revoked: true, revokedAt: new Date().toISOString() };
  writeDevices(devices);
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  return JSON.stringify({ ok: true, message: '设备已撤销。', devices: devices.map(publicDevice), status: JSON.parse(getHostServiceStatus()) });
}

function restoreHostDevice(deviceId) {
  const devices = readDevices();
  const index = devices.findIndex((device) => String(device.id) === String(deviceId));
  if (index < 0) return JSON.stringify({ ok: false, message: '未找到设备。' });
  if (!devices[index].revoked) return JSON.stringify({ ok: false, message: '设备当前未撤销。' });
  const license = publicLicenseStatus();
  const activeCount = devices.filter((device) => !device.revoked).length;
  if (license.deviceLimit && activeCount >= Number(license.deviceLimit)) {
    return JSON.stringify({ ok: false, message: `授权设备数已达上限（${license.deviceLimit} 台），请先撤销其他设备。` });
  }
  devices[index] = {
    ...devices[index],
    revoked: false,
    revokedAt: '',
    restoredAt: new Date().toISOString(),
  };
  writeDevices(devices);
  appendHostTimeline({ type: 'device_restored', title: 'Device restored', detail: devices[index].name || devices[index].id });
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  return JSON.stringify({ ok: true, message: '设备已恢复。', devices: devices.map(publicDevice), status: JSON.parse(getHostServiceStatus()) });
}

function deleteHostDevice(deviceId) {
  const devices = readDevices();
  const target = devices.find((device) => String(device.id) === String(deviceId));
  if (!target) return JSON.stringify({ ok: false, message: '未找到设备。' });
  if (!target.revoked) return JSON.stringify({ ok: false, message: '请先撤销设备，再删除设备记录。' });
  const nextDevices = devices.filter((device) => String(device.id) !== String(deviceId));
  writeDevices(nextDevices);
  appendHostTimeline({ type: 'device_deleted', title: 'Revoked device record deleted', detail: target.name || target.id });
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  return JSON.stringify({ ok: true, message: '已删除撤销设备记录。', devices: nextDevices.map(publicDevice), status: JSON.parse(getHostServiceStatus()) });
}

function renameHostDevice(deviceId, name) {
  const cleanName = String(name || '').trim().slice(0, 40);
  if (!cleanName) return JSON.stringify({ ok: false, message: '设备名称不能为空。' });
  const devices = readDevices();
  const index = devices.findIndex((device) => String(device.id) === String(deviceId));
  if (index < 0) return JSON.stringify({ ok: false, message: '未找到设备。' });
  devices[index] = { ...devices[index], name: cleanName };
  writeDevices(devices);
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  return JSON.stringify({ ok: true, message: '设备已重命名。', devices: devices.map(publicDevice), status: JSON.parse(getHostServiceStatus()) });
}

function setHostDeviceStudentAccess(deviceId, studentIdsJson) {
  let studentIds = [];
  try {
    const parsed = JSON.parse(studentIdsJson || '[]');
    studentIds = Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return JSON.stringify({ ok: false, message: '学生授权范围格式错误。' });
  }
  const validIds = new Set(readStudentsIndex().map((student) => String(student.id)));
  const allowedStudentIds = studentIds.filter((id) => validIds.has(String(id)));
  const devices = readDevices();
  const index = devices.findIndex((device) => String(device.id) === String(deviceId));
  if (index < 0) return JSON.stringify({ ok: false, message: '未找到设备。' });
  devices[index] = { ...devices[index], allowedStudentIds };
  writeDevices(devices);
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  return JSON.stringify({ ok: true, devices: devices.map(publicDevice), status: JSON.parse(getHostServiceStatus()) });
}

function setHostDeviceAccessMode(deviceId, optionsJson) {
  let options = {};
  try {
    options = JSON.parse(optionsJson || '{}');
  } catch {
    return JSON.stringify({ ok: false, message: '设备授权选项格式错误。' });
  }
  const devices = readDevices();
  const index = devices.findIndex((device) => String(device.id) === String(deviceId));
  if (index < 0) return JSON.stringify({ ok: false, message: '未找到设备。' });
  const validIds = readStudentsIndex().map((student) => String(student.id));
  const allowedAllStudents = Boolean(options.allowedAllStudents);
  const autoAuthorizeNewStudents = Boolean(options.autoAuthorizeNewStudents);
  devices[index] = {
    ...devices[index],
    allowedAllStudents,
    autoAuthorizeNewStudents,
    allowedStudentIds: allowedAllStudents || autoAuthorizeNewStudents ? validIds : (Array.isArray(devices[index].allowedStudentIds) ? devices[index].allowedStudentIds : []),
  };
  writeDevices(devices);
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  return JSON.stringify({ ok: true, devices: devices.map(publicDevice), status: JSON.parse(getHostServiceStatus()) });
}

function getHostServicePort() {
  const settings = readSettings();
  const port = Number(settings.hostServicePort || DEFAULT_HOST_PORT);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_HOST_PORT;
}

function setHostServicePort(port) {
  const locked = licenseRequiredJson('主机服务');
  if (locked) return locked;
  const nextPort = Number(port);
  if (!Number.isInteger(nextPort) || nextPort < 1024 || nextPort > 65535) {
    return JSON.stringify({ ok: false, message: '端口必须是 1024-65535 之间的数字' });
  }
  const settings = readSettings();
  settings.hostServicePort = nextPort;
  writeSettings(settings);
  if (hostServer) {
    const server = hostServer;
    hostServer = null;
    server.close(() => {
      startHostService();
    });
    return JSON.stringify({ ok: true, status: JSON.parse(getHostServiceStatus()), message: '端口已保存，主机服务正在重启。' });
  }
  return JSON.stringify({ ok: true, status: JSON.parse(getHostServiceStatus()) });
}

function sanitizeName(value) {
  return String(value || '学生').trim().replace(/[\\/:*?"<>|]/g, '').slice(0, 24) || '学生';
}

function notify(callbackName, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.executeJavaScript(
    `window.${callbackName} && window.${callbackName}(${JSON.stringify(payload)})`,
  ).catch(() => {});
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: 'AI教育管家控制台',
    backgroundColor: '#f6f8f7',
    icon: path.join(__dirname, '..', 'dist', 'brand', 'robogala.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

function downloadsDir() {
  return app.getPath('downloads') || path.join(os.homedir(), 'Downloads');
}

function defaultStudentBaseDir() {
  const settings = readSettings();
  if (settings.studentBaseDir) return settings.studentBaseDir;
  return process.platform === 'win32'
    ? 'D:\\学生资料'
    : path.join(app.getPath('documents') || path.join(os.homedir(), 'Documents'), '学生资料');
}

function captureCenterRootPath() {
  return path.join(defaultStudentBaseDir(), '.edu-manager', 'capture-center');
}

function captureSessionsPath() {
  return path.join(captureCenterRootPath(), 'capture-sessions.json');
}

function captureInboxRootPath() {
  return path.join(captureCenterRootPath(), 'inbox');
}

function readCaptureStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(captureSessionsPath(), 'utf8'));
    return {
      version: Number(parsed.version || CAPTURE_PROTOCOL_VERSION),
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    };
  } catch {
    return { version: CAPTURE_PROTOCOL_VERSION, sessions: [] };
  }
}

function writeCaptureStore(store) {
  fs.mkdirSync(captureCenterRootPath(), { recursive: true });
  fs.writeFileSync(captureSessionsPath(), JSON.stringify({
    version: CAPTURE_PROTOCOL_VERSION,
    updatedAt: new Date().toISOString(),
    sessions: (store.sessions || []).slice(0, 200),
  }, null, 2), 'utf8');
}

function persistCaptureSession(session) {
  const store = readCaptureStore();
  const index = store.sessions.findIndex((item) => String(item.id) === String(session.id));
  const clean = {
    ...session,
    items: (session.items || []).slice(0, 1500),
    updatedAt: new Date().toISOString(),
  };
  if (index >= 0) store.sessions[index] = clean;
  else store.sessions.unshift(clean);
  writeCaptureStore(store);
  return clean;
}

function captureCenterStateObject() {
  const store = readCaptureStore();
  const activeSession = activeCaptureRuntime?.session || null;
  return {
    ok: true,
    protocolVersion: CAPTURE_PROTOCOL_VERSION,
    policies: Object.values(CAPTURE_POLICIES),
    activeSession,
    sessions: store.sessions.slice(0, 30),
    inboxPath: captureInboxRootPath(),
  };
}

function getCaptureCenterState() {
  return JSON.stringify(captureCenterStateObject());
}

function notifyCaptureChanged() {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('capture:changed', JSON.stringify(captureCenterStateObject()));
    }
    updateCaptureTray();
    updateCaptureControlWindow();
  } catch {
    // Capture remains available even if the renderer is being reloaded.
  }
}

function captureTrayIconPath() {
  const built = path.join(__dirname, '..', 'dist', 'brand', 'robogala.ico');
  const source = path.join(__dirname, '..', 'public', 'brand', 'robogala.ico');
  return fs.existsSync(built) ? built : source;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function updateCaptureTray() {
  if (!captureTray || captureTray.isDestroyed()) return;
  const session = activeCaptureRuntime?.session;
  const active = Boolean(session);
  captureTray.setToolTip(active
    ? `AI教育管家 · ${session.status === 'paused' ? '采集已暂停' : '正在采集'} · 已保留 ${session.screenshotCount} 张`
    : 'AI教育管家 · 屏幕资料采集');
  captureTray.setContextMenu(Menu.buildFromTemplate([
    { label: active ? `${session.status === 'paused' ? '采集已暂停' : '正在采集'} · ${session.sourceName}` : '当前没有采集会话', enabled: false },
    { type: 'separator' },
    { label: '打开教育管家', click: showMainWindow },
    { label: '打开采集箱', click: () => openCaptureInbox(session?.id || '') },
    { type: 'separator' },
    { label: '重点截取', enabled: active, click: () => { if (activeCaptureRuntime) void highlightCaptureSession(activeCaptureRuntime.session.id); } },
    {
      label: session?.status === 'paused' ? '继续采集' : '暂停采集',
      enabled: active,
      click: () => {
        if (!activeCaptureRuntime) return;
        if (activeCaptureRuntime.session.status === 'paused') resumeCaptureSession(activeCaptureRuntime.session.id);
        else pauseCaptureSession(activeCaptureRuntime.session.id);
      },
    },
    { label: '结束并整理', enabled: active, click: () => { if (activeCaptureRuntime) void stopCaptureSession(activeCaptureRuntime.session.id); } },
  ]));
}

function createCaptureTray() {
  if (captureTray && !captureTray.isDestroyed()) return;
  const iconPath = captureTrayIconPath();
  if (!fs.existsSync(iconPath)) return;
  captureTray = new Tray(iconPath);
  captureTray.on('click', showMainWindow);
  updateCaptureTray();
}

function captureControlHtml(session) {
  const paused = session.status === 'paused';
  const sourceName = String(session.sourceName || '屏幕').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;font-family:"Microsoft YaHei",sans-serif;background:transparent;color:#172a27}
    .bar{height:68px;padding:10px 12px;display:flex;align-items:center;gap:10px;background:#fbfaff;border:1px solid #d9ccff;border-left:4px solid #7c3aed;border-radius:8px;box-shadow:0 12px 30px rgba(56,35,91,.22);-webkit-app-region:drag}
    .state{min-width:0;flex:1;display:grid;gap:2px}.state strong{font-size:13px}.state span{font-size:11px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .dot{width:9px;height:9px;border-radius:50%;background:${paused ? '#d97706' : '#ef4444'};box-shadow:0 0 0 4px ${paused ? 'rgba(217,119,6,.12)' : 'rgba(239,68,68,.12)'}}
    button{width:34px;height:34px;border:1px solid #d9ccff;background:white;color:#6d28d9;border-radius:6px;font-size:15px;cursor:pointer;-webkit-app-region:no-drag}button:hover{background:#f1eaff}button.end{color:#b42318;border-color:#fecaca}
  </style></head><body><div class="bar"><i class="dot"></i><div class="state"><strong>${paused ? '采集已暂停' : '正在采集'} · ${session.screenshotCount} 张</strong><span>${sourceName}</span></div>
  <button title="重点截取" id="highlight">★</button><button title="${paused ? '继续采集' : '暂停采集'}" id="pause">${paused ? '▶' : 'Ⅱ'}</button><button title="打开采集箱" id="folder">▣</button><button class="end" title="结束并整理" id="stop">■</button></div>
  <script>const id=${JSON.stringify(session.id)};document.getElementById('highlight').onclick=()=>window.AndroidBridge.highlightCaptureSession(id);document.getElementById('pause').onclick=()=>window.AndroidBridge.${paused ? 'resumeCaptureSession' : 'pauseCaptureSession'}(id);document.getElementById('folder').onclick=()=>window.AndroidBridge.openCaptureInbox(id);document.getElementById('stop').onclick=()=>window.AndroidBridge.stopCaptureSession(id);</script></body></html>`;
}

function updateCaptureControlWindow() {
  const session = activeCaptureRuntime?.session;
  if (!session) {
    if (captureControlWindow && !captureControlWindow.isDestroyed()) captureControlWindow.close();
    captureControlWindow = null;
    return;
  }
  if (!captureControlWindow || captureControlWindow.isDestroyed()) {
    captureControlWindow = new BrowserWindow({
      width: 450,
      height: 68,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    captureControlWindow.setAlwaysOnTop(true, 'floating');
    captureControlWindow.once('ready-to-show', () => captureControlWindow?.showInactive());
    captureControlWindow.on('closed', () => { captureControlWindow = null; });
  }
  captureControlWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(captureControlHtml(session))}`);
}

async function listCaptureSources() {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true,
    });
    return JSON.stringify({
      ok: true,
      sources: sources.map((source) => ({
        id: source.id,
        name: source.name,
        type: source.id.startsWith('screen:') ? 'screen' : 'window',
        thumbnail: source.thumbnail?.isEmpty() ? '' : source.thumbnail.toDataURL(),
      })),
    });
  } catch (error) {
    return JSON.stringify({ ok: false, sources: [], message: `读取屏幕来源失败：${error.message}` });
  }
}

function captureImageSignature(image) {
  const sample = image.resize({ width: 16, height: 16, quality: 'good' }).toBitmap();
  const signature = [];
  for (let offset = 0; offset + 3 < sample.length; offset += 4) {
    const blue = sample[offset];
    const green = sample[offset + 1];
    const red = sample[offset + 2];
    signature.push(Math.round((red * 0.299) + (green * 0.587) + (blue * 0.114)));
  }
  return signature;
}

async function captureSourceImage(sourceId, sourceType) {
  const sources = await desktopCapturer.getSources({
    types: [sourceType === 'screen' ? 'screen' : 'window'],
    thumbnailSize: { width: 1920, height: 1080 },
    fetchWindowIcons: false,
  });
  const source = sources.find((item) => item.id === sourceId);
  if (!source || source.thumbnail.isEmpty()) throw new Error('采集来源已关闭或不可用。');
  return source.thumbnail;
}

async function captureFrame(runtime, input = {}) {
  if (!runtime || runtime !== activeCaptureRuntime || runtime.busy || runtime.session.status !== 'capturing') return null;
  runtime.busy = true;
  try {
    const image = await captureSourceImage(runtime.session.sourceId, runtime.session.sourceType);
    const signature = captureImageSignature(image);
    const now = Date.now();
    const decision = captureSaveDecision(runtime, {
      now,
      signature,
      force: Boolean(input.force),
      highlight: Boolean(input.highlight),
      options: runtime.session.options,
    });
    runtime.session.candidateFrameCount += 1;
    if (!decision.save) {
      runtime.session.deduplicatedCount += 1;
      runtime.session.lastDecision = decision.reason;
      if (runtime.session.candidateFrameCount % 10 === 0) persistCaptureSession(runtime.session);
      notifyCaptureChanged();
      return decision;
    }

    const capturedAt = new Date(now).toISOString();
    const itemId = `capture-item-${now}-${crypto.randomBytes(3).toString('hex')}`;
    const fileName = `capture-${capturedAt.replace(/[-:.TZ]/g, '').slice(0, 14)}-${itemId.slice(-6)}.png`;
    fs.mkdirSync(runtime.session.inboxPath, { recursive: true });
    const filePath = path.join(runtime.session.inboxPath, fileName);
    fs.writeFileSync(filePath, image.toPNG());
    const asset = upsertAssetFromFile(filePath, {
      studentId: runtime.session.studentId,
      studentName: runtime.session.studentName,
      projectId: runtime.session.projectId,
      projectName: runtime.session.projectName,
      spaceType: 'capture_session',
      spaceId: runtime.session.id,
      spaceName: runtime.session.name,
      role: 'capture_candidate',
      sourcePath: runtime.session.sourceName,
      sourceName: `${runtime.session.sourceName} · 屏幕采集`,
      sourceType: 'windows_screenshot',
      captureSessionId: runtime.session.id,
      captureItemId: itemId,
      status: 'candidate',
      uploadedAt: capturedAt,
    });
    const item = {
      id: itemId,
      assetId: asset?.assetId || '',
      filename: fileName,
      path: filePath,
      capturedAt,
      reason: decision.reason,
      difference: Number(decision.difference || 0),
      isHighlighted: Boolean(input.highlight),
      ocrStatus: 'pending',
      archiveStatus: 'candidate',
    };
    runtime.session.items.push(item);
    runtime.session.screenshotCount += 1;
    if (item.isHighlighted) runtime.session.highlightedCount += 1;
    runtime.session.lastCapturedAt = capturedAt;
    runtime.session.lastDecision = decision.reason;
    runtime.lastSavedAt = now;
    runtime.lastSavedSignature = signature;
    persistCaptureSession(runtime.session);
    notifyCaptureChanged();
    return { ...decision, item };
  } catch (error) {
    runtime.session.lastError = error.message;
    persistCaptureSession(runtime.session);
    notifyCaptureChanged();
    return { save: false, reason: 'capture_error', message: error.message };
  } finally {
    runtime.busy = false;
  }
}

function scheduleCaptureRuntime(runtime) {
  if (runtime.timer) clearInterval(runtime.timer);
  runtime.timer = setInterval(() => { void captureFrame(runtime); }, runtime.session.options.sampleIntervalMs);
  if (runtime.stopTimer) clearTimeout(runtime.stopTimer);
  const remaining = Math.max(1000, new Date(runtime.session.plannedEndAt).getTime() - Date.now());
  runtime.stopTimer = setTimeout(() => { void stopCaptureSession(runtime.session.id, 'duration_complete'); }, remaining);
}

async function startCaptureSession(optionsJson) {
  try {
    if (activeCaptureRuntime) return JSON.stringify({ ok: false, message: '已有采集会话正在运行，请先结束当前会话。' });
    const input = JSON.parse(optionsJson || '{}');
    const sourceId = String(input.sourceId || '');
    if (!sourceId) return JSON.stringify({ ok: false, message: '请选择采集屏幕或应用窗口。' });
    const sourcesResult = JSON.parse(await listCaptureSources());
    const source = (sourcesResult.sources || []).find((item) => item.id === sourceId);
    if (!source) return JSON.stringify({ ok: false, message: '选中的采集来源当前不可用。' });
    const student = readStudentsIndex().find((item) => String(item.id) === String(input.studentId || ''));
    if (!student) return JSON.stringify({ ok: false, message: '请选择资料所属学生。' });
    const project = readProjects().find((item) => String(item.id) === String(input.projectId || ''));
    const now = new Date();
    const options = normalizeCaptureOptions(input);
    const id = `capture-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const session = {
      id,
      protocolVersion: CAPTURE_PROTOCOL_VERSION,
      name: String(input.name || `${student.name}屏幕采集-${now.toLocaleString('zh-CN')}`),
      platform: 'windows',
      sourceId,
      sourceName: source.name,
      sourceType: source.type,
      studentId: String(student.id),
      studentName: student.name,
      projectId: project ? String(project.id) : '',
      projectName: project?.name || '',
      options,
      status: 'capturing',
      startedAt: now.toISOString(),
      plannedEndAt: new Date(now.getTime() + (options.durationMinutes * 60 * 1000)).toISOString(),
      endedAt: '',
      screenshotCount: 0,
      candidateFrameCount: 0,
      deduplicatedCount: 0,
      highlightedCount: 0,
      items: [],
      inboxPath: path.join(captureInboxRootPath(), id),
      ocrStatus: 'not_started',
      archiveStatus: 'candidate',
    };
    fs.mkdirSync(session.inboxPath, { recursive: true });
    persistCaptureSession(session);
    const runtime = { session, busy: false, timer: null, stopTimer: null, lastSavedAt: 0, lastSavedSignature: null };
    activeCaptureRuntime = runtime;
    scheduleCaptureRuntime(runtime);
    await captureFrame(runtime, { force: true });
    return JSON.stringify({ ok: true, session: runtime.session, message: `已开始采集“${source.name}”。` });
  } catch (error) {
    activeCaptureRuntime = null;
    return JSON.stringify({ ok: false, message: `启动屏幕采集失败：${error.message}` });
  }
}

function pauseCaptureSession(sessionId) {
  const runtime = activeCaptureRuntime;
  if (!runtime || (sessionId && String(runtime.session.id) !== String(sessionId))) return JSON.stringify({ ok: false, message: '没有可暂停的采集会话。' });
  runtime.session.status = 'paused';
  runtime.session.pausedAt = new Date().toISOString();
  persistCaptureSession(runtime.session);
  notifyCaptureChanged();
  return JSON.stringify({ ok: true, session: runtime.session, message: '采集已暂停。' });
}

function resumeCaptureSession(sessionId) {
  const runtime = activeCaptureRuntime;
  if (!runtime || (sessionId && String(runtime.session.id) !== String(sessionId))) return JSON.stringify({ ok: false, message: '没有可继续的采集会话。' });
  runtime.session.status = 'capturing';
  runtime.session.resumedAt = new Date().toISOString();
  persistCaptureSession(runtime.session);
  notifyCaptureChanged();
  return JSON.stringify({ ok: true, session: runtime.session, message: '采集已继续。' });
}

async function highlightCaptureSession(sessionId) {
  const runtime = activeCaptureRuntime;
  if (!runtime || (sessionId && String(runtime.session.id) !== String(sessionId))) return JSON.stringify({ ok: false, message: '没有正在运行的采集会话。' });
  const previousStatus = runtime.session.status;
  runtime.session.status = 'capturing';
  const result = await captureFrame(runtime, { force: true, highlight: true });
  runtime.session.status = previousStatus;
  persistCaptureSession(runtime.session);
  return JSON.stringify({ ok: Boolean(result?.save), result, session: runtime.session, message: result?.save ? '已保存重点页面。' : '重点页面保存失败。' });
}

async function stopCaptureSession(sessionId, reason = 'manual') {
  const runtime = activeCaptureRuntime;
  if (!runtime || (sessionId && String(runtime.session.id) !== String(sessionId))) return JSON.stringify({ ok: false, message: '没有可结束的采集会话。' });
  if (runtime.timer) clearInterval(runtime.timer);
  if (runtime.stopTimer) clearTimeout(runtime.stopTimer);
  runtime.session.status = 'completed';
  runtime.session.endedAt = new Date().toISOString();
  runtime.session.endReason = reason;
  runtime.session.archiveStatus = 'awaiting_review';
  persistCaptureSession(runtime.session);
  activeCaptureRuntime = null;
  notifyCaptureChanged();
  return JSON.stringify({ ok: true, session: runtime.session, message: `采集已结束，共保留 ${runtime.session.screenshotCount} 张有效截图。` });
}

function openCaptureInbox(sessionId = '') {
  const session = sessionId
    ? readCaptureStore().sessions.find((item) => String(item.id) === String(sessionId))
    : activeCaptureRuntime?.session;
  const target = session?.inboxPath || captureInboxRootPath();
  fs.mkdirSync(target, { recursive: true });
  shell.openPath(target);
  return JSON.stringify({ ok: true, path: target });
}

function promoteCaptureSession(sessionId) {
  try {
    const store = readCaptureStore();
    const session = store.sessions.find((item) => String(item.id) === String(sessionId));
    if (!session) return JSON.stringify({ ok: false, message: '未找到采集会话。' });
    if (!['completed', 'promoted'].includes(session.status)) return JSON.stringify({ ok: false, message: '请先结束采集，再晋升资料。' });
    if (session.status === 'promoted') return JSON.stringify({ ok: true, imported: session.promotedFiles?.length || 0, session, message: '该采集会话已经晋升。' });
    const student = readStudentsIndex().find((item) => String(item.id) === String(session.studentId));
    if (!student) return JSON.stringify({ ok: false, message: '采集会话关联的学生不存在。' });
    const rawDir = student.rawPath || getRawDir(student.name);
    fs.mkdirSync(rawDir, { recursive: true });
    const records = [];
    for (const item of session.items || []) {
      if (!item.path || !fs.existsSync(item.path)) continue;
      const target = uniqueTargetFile(rawDir, item.filename || path.basename(item.path));
      fs.copyFileSync(item.path, target);
      const stat = fs.statSync(target);
      records.push({
        id: `capture-upload-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        studentId: String(student.id),
        studentName: student.name,
        filename: path.basename(target),
        path: target,
        sourcePath: item.path,
        sourceName: `屏幕采集 · ${session.sourceName}`,
        deviceName: 'Windows 屏幕采集器',
        size: stat.size,
        sha1: sha1File(target),
        uploadedAt: new Date().toISOString(),
        captureSessionId: session.id,
        captureItemId: item.id,
      });
      item.archiveStatus = 'promoted';
      item.promotedPath = target;
    }
    if (records.length) addUploadRecords(records);
    session.status = 'promoted';
    session.archiveStatus = 'student_raw';
    session.promotedAt = new Date().toISOString();
    session.promotedFiles = records.map((record) => record.path);
    persistCaptureSession(session);
    notifyCaptureChanged();
    return JSON.stringify({ ok: true, imported: records.length, session, message: `已将 ${records.length} 张截图晋升到 ${student.name} 原始资料库，等待资料消化。` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `晋升采集资料失败：${error.message}` });
  }
}

function registerCaptureShortcuts() {
  const shortcuts = [
    ['CommandOrControl+Shift+1', () => {
      if (activeCaptureRuntime) void captureFrame(activeCaptureRuntime, { force: true });
      else if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
    }],
    ['CommandOrControl+Shift+2', () => {
      if (!activeCaptureRuntime) return;
      if (activeCaptureRuntime.session.status === 'paused') resumeCaptureSession(activeCaptureRuntime.session.id);
      else pauseCaptureSession(activeCaptureRuntime.session.id);
    }],
    ['CommandOrControl+Shift+3', () => {
      if (activeCaptureRuntime) void highlightCaptureSession(activeCaptureRuntime.session.id);
    }],
  ];
  shortcuts.forEach(([accelerator, handler]) => {
    try { globalShortcut.register(accelerator, handler); } catch { /* A conflicting shortcut should not block the app. */ }
  });
}

function setStudentBaseDir(dir) {
  const settings = readSettings();
  settings.studentBaseDir = dir;
  settings.archiveRoot = dir;
  writeSettings(settings);
}

function getStorageConfig() {
  const baseDir = defaultStudentBaseDir();
  try {
    fs.mkdirSync(baseDir, { recursive: true });
  } catch {
    // The UI can still show the intended directory; writes report detailed errors later.
  }
  return JSON.stringify({
    platform: process.platform === 'win32' ? 'windows' : process.platform,
    baseDir,
    usesAbsolutePaths: true,
    pathSeparator: path.sep,
    hostServicePort: getHostServicePort(),
    taskAutomationEnabled: taskAutomationEnabled(),
  });
}

function getStudentRootDir(studentName) {
  return path.join(defaultStudentBaseDir(), `${sanitizeName(studentName)}知识库`);
}

function getRawDir(studentName) {
  const cleanName = sanitizeName(studentName);
  return path.join(getStudentRootDir(cleanName), `${cleanName}原始资料库`);
}

function getSummaryDir(studentName) {
  const cleanName = sanitizeName(studentName);
  return path.join(getStudentRootDir(cleanName), `${cleanName}学情分析汇总`);
}

function projectsBaseDir() {
  return path.join(defaultStudentBaseDir(), '学习项目');
}

function projectKnowledgeRoot(projectName) {
  return path.join(projectsBaseDir(), `${sanitizeName(projectName)}项目知识库`);
}

function projectPathsFor(projectName, rootPath, project = {}) {
  const cleanName = sanitizeName(projectName || '学习项目');
  const storageName = sanitizeName(project.storageName || cleanName);
  const root = rootPath || projectKnowledgeRoot(cleanName);
  const linkedWorkspace = String(project.workspaceMode || '') === 'linked' && String(project.workspacePath || '').trim()
    ? path.resolve(String(project.workspacePath))
    : '';
  const workspacePath = linkedWorkspace || path.join(root, '项目工作空间');
  return {
    projectRootPath: root,
    managerPath: path.join(root, '.edu-manager'),
    workspacePath,
    stagingPath: linkedWorkspace ? path.join(root, '研究暂存') : path.join(workspacePath, '研究暂存'),
    knowledgeRootPath: path.join(root, '项目知识空间'),
    rawPath: path.join(root, '项目知识空间', `${storageName}项目原始资料库`),
    conceptPath: path.join(root, '项目知识空间', '概念库'),
    entityPath: path.join(root, '项目知识空间', '实体库'),
    summaryPath: path.join(root, '项目知识空间', '摘要库'),
    qaPath: path.join(root, '项目知识空间', '问答精华库'),
    synthesisPath: path.join(root, '项目知识空间', '综合汇总库'),
    reportPath: path.join(root, '项目知识空间', '项目报告'),
    contributionPath: path.join(root, '项目知识空间', '知识贡献'),
    outputPath: path.join(root, '输出结果'),
    agentPath: path.join(root, 'AGENT.md'),
  };
}

const PROJECT_WORKSPACE_TEMPLATES = [
  {
    id: 'general',
    name: '通用学习项目',
    description: '适合普通作业、短期专题和轻量研究。',
    folders: ['资料', '进展', '团队成员', '成果'],
  },
  {
    id: 'subject',
    name: '学科专题',
    description: '适合课程学习、错题复盘和阶段总结。',
    folders: ['课程资料', '作业与反馈', '错题与问题', '阶段总结', '成果'],
  },
  {
    id: 'competition',
    name: '竞赛 / 活动',
    description: '适合比赛、活动、作品集和团队协作。',
    folders: ['赛事规则', '参考资料', '方案设计', '团队协作', '过程记录', '提交成果'],
  },
  {
    id: 'research',
    name: '研究项目',
    description: '适合论文、实验、调研和文献综述。',
    folders: ['文献资料', '研究问题', '数据与实验', '分析过程', '成果论文'],
  },
  {
    id: 'writing',
    name: '写作项目',
    description: '适合作文、论文、文书、演讲稿和长文创作。',
    folders: ['参考资料', '选题策划', '写作大纲', '写作规则', '草稿', '修改反馈', '定稿'],
  },
  {
    id: 'application',
    name: '升学申请',
    description: '适合学校申请、文书素材和申请复盘。',
    folders: ['学校与项目', '申请材料', '文书素材', '推荐与反馈', '结果与复盘'],
  },
];

const PROJECT_TEMPLATE_V2_STRATEGIES = {
  general: { knowledgeStrategy: '提取核心概念、关键实体、阶段摘要和可复用问答。', growthStrategy: '关注主动学习、问题解决和成果表达。', deliverables: ['项目总结', '最终成果'] },
  subject: { knowledgeStrategy: '聚焦学科概念、错误模式、解题方法和改进点。', growthStrategy: '关注学科理解、迁移应用和学习策略。', deliverables: ['阶段总结', '学科成果'] },
  competition: { knowledgeStrategy: '提取赛事要求、方案选择、技术路线、反馈和最终决策。', growthStrategy: '关注创新、协作、项目推进和公开表达。', deliverables: ['参赛作品', '演示材料', '项目复盘'] },
  research: { knowledgeStrategy: '提取研究问题、文献缺口、方法、数据证据、局限与结论。', growthStrategy: '关注研究设计、证据推理、数据分析和学术写作。', deliverables: ['文献综述', '研究报告', '反思'] },
  writing: { knowledgeStrategy: '提取主题、论点、证据、结构、表达规则和修订理由。', growthStrategy: '关注逻辑表达、受众意识、修订能力和写作风格。', deliverables: ['定稿', '修订说明'] },
  application: { knowledgeStrategy: '提取申请要求、经历证据、个人叙事、院校匹配和反馈。', growthStrategy: '关注自我认知、领导力、沟通和长期目标。', deliverables: ['申请材料包', '文书', '申请复盘'] },
};

function sanitizeWorkspaceFolderName(value) {
  return String(value || '')
    .replace(/[\\/:*?"<>|\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

const WINDOWS_RESERVED_FOLDER = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

function validateWorkspaceFolders(folders) {
  const source = Array.isArray(folders) ? folders : String(folders || '').split(/\r?\n|[,，;；]/);
  const errors = [];
  const seen = new Set();
  const normalized = [];
  for (const raw of source) {
    const value = String(raw || '').trim();
    if (!value || value === '研究暂存') continue;
    if (/[\\/:*?"<>|\x00-\x1F]/.test(value)) errors.push(`“${value}”包含 Windows 文件夹非法字符。`);
    if (WINDOWS_RESERVED_FOLDER.test(value)) errors.push(`“${value}”是 Windows 保留名称。`);
    if (value.endsWith('.') || value.endsWith(' ')) errors.push(`“${value}”不能以句点或空格结尾。`);
    const clean = sanitizeWorkspaceFolderName(value);
    const key = clean.toLocaleLowerCase('zh-CN');
    if (seen.has(key)) errors.push(`文件夹名称重复：“${clean}”。`);
    if (clean && !seen.has(key)) {
      seen.add(key);
      normalized.push(clean);
    }
  }
  if (normalized.length > 24) errors.push('工作空间文件夹最多 24 个。');
  return { ok: errors.length === 0, folders: normalized.slice(0, 24), errors };
}

function normalizeWorkspaceFolders(folders) {
  const source = Array.isArray(folders)
    ? folders
    : String(folders || '').split(/\r?\n|[,，;；]/);
  return mergeUnique(source.map(sanitizeWorkspaceFolderName))
    .filter((folder) => folder && folder !== '研究暂存')
    .slice(0, 24);
}

function projectWorkspaceTemplateFor(templateId) {
  const template = PROJECT_WORKSPACE_TEMPLATES.find((item) => item.id === String(templateId || '')) || PROJECT_WORKSPACE_TEMPLATES[0];
  return { ...template, ...(PROJECT_TEMPLATE_V2_STRATEGIES[template.id] || PROJECT_TEMPLATE_V2_STRATEGIES.general) };
}

function projectWorkspaceFoldersFor(project) {
  const customFolders = normalizeWorkspaceFolders(project.workspaceFolders);
  if (customFolders.length) return customFolders;
  return projectWorkspaceTemplateFor(project.workspaceTemplateId).folders;
}

function projectWorkspaceIndexTemplate(project) {
  const paths = projectPathsFor(project.name, project.projectRootPath, project);
  const template = projectWorkspaceTemplateFor(project.workspaceTemplateId);
  const folders = projectWorkspaceFoldersFor(project);
  const rows = folders.map((folder) => `| ${folder} | ${path.join(paths.workspacePath, folder)} |`).join('\n');
  return `# ${project.name} 项目工作空间结构\n\n> 本文件描述的是“项目工作空间”的人工项目管理目录结构，不是“项目知识空间”的 LLM Wiki schema。\n\n- 工作空间模板：${project.workspaceTemplateName || template.name}\n- 项目工作空间：${paths.workspacePath}\n- 研究暂存层：${paths.stagingPath}\n- 项目知识空间：${paths.knowledgeRootPath}\n\n## 工作空间文件夹\n\n| 文件夹 | 路径 |\n| --- | --- |\n${rows || '| 暂无 | - |'}\n\n## 边界说明\n\n- 项目工作空间：用于按项目管理习惯收集资料、进展、团队协作、成果等内容。\n- 研究暂存层：用于候选资料收集、AI 初筛、治理和资产晋升。\n- 项目知识空间：固定使用 LLM Wiki 结构，包括项目原始资料库、概念库、实体库、摘要库、问答精华库、综合汇总库、项目报告和知识贡献。\n- 修改本模板只会影响项目工作空间下的文件夹，不会改变项目知识空间目录结构。\n`;
}

function writeProjectWorkspaceIndex(project) {
  const normalized = normalizeProject(project);
  const paths = projectPathsFor(normalized.name, normalized.projectRootPath, normalized);
  const targetDir = normalized.workspaceMode === 'linked' ? paths.managerPath : paths.workspacePath;
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, '工作空间结构.md'), projectWorkspaceIndexTemplate(normalized), 'utf8');
}

function projectAgentTemplate(project, students) {
  const paths = projectPathsFor(project.name, project.projectRootPath, project);
  const studentLines = (students || []).map((student) => `- ${student.name}：${student.rootPath || getStudentRootDir(student.name)}`).join('\n') || '- 暂未绑定学生';
  return `# ${project.name} 项目教育管家 AGENT.md\n\n## 项目定位\n\n本目录是学习项目「${project.name}」的独立 LLM Wiki 知识空间，用于围绕项目资料进行消化、摘要、概念/实体抽取、问答沉淀和综合分析。\n\n## 绑定学生\n\n${studentLines}\n\n## 项目目录\n\n- 项目工作空间：${paths.workspacePath}\n- 项目原始资料库：${paths.rawPath}\n- 摘要库：${paths.summaryPath}\n- 概念库：${paths.conceptPath}\n- 实体库：${paths.entityPath}\n- 问答精华库：${paths.qaPath}\n- 综合汇总库：${paths.synthesisPath}\n- 项目报告：${paths.reportPath}\n- 知识贡献：${paths.contributionPath}\n\n## 工作规则\n\n1. 所有项目资料消化只围绕本项目知识空间执行，不要直接写入学生主档案。\n2. 只有在用户确认“知识贡献申请”后，才把项目结论发布到学生主档案或成长模型。\n3. 原始资料必须保留来源路径、资产编号或文件名，不要删除、移动用户原始文件。\n4. 每次资料消化后更新项目 index.md 和 log.md。\n5. 如果没有新增资料，请在 log.md 中记录“无新增项目资料”，不要重复生成摘要。\n\n## 可执行命令\n\n- /消化项目资料：读取「${paths.rawPath}」中的新资料，更新项目知识空间。\n- /生成知识贡献申请：基于项目知识空间生成「${path.join(paths.contributionPath, '知识贡献申请.md')}」。\n`;
}

function projectBindingIndexTemplate(project, students) {
  const paths = projectPathsFor(project.name, project.projectRootPath, project);
  const studentLines = (students || []).map((student) => [
    `## ${student.name}`,
    '',
    `- 学生ID：${student.id}`,
    `- 学生知识库：${student.rootPath || getStudentRootDir(student.name)}`,
    `- 原始资料库：${student.rawPath || getRawDir(student.name)}`,
    `- 学情分析汇总：${student.summaryPath || getSummaryDir(student.name)}`,
  ].join('\n')).join('\n\n') || '暂无绑定学生。';
  return `# ${project.name} 项目绑定学生\n\n更新时间：${new Date().toLocaleString('zh-CN')}\n\n本文件由控制台生成，用于记录学习项目当前绑定的学生。修改项目绑定学生时会更新本文件；不会自动覆盖 AGENT.md。\n\n## 项目路径\n\n- 项目知识空间：${paths.knowledgeRootPath}\n- 项目原始资料库：${paths.rawPath}\n- 知识贡献目录：${paths.contributionPath}\n\n## 绑定学生\n\n${studentLines}\n`;
}

function writeProjectBindingIndex(project) {
  const normalized = normalizeProject(project);
  const paths = projectPathsFor(normalized.name, normalized.projectRootPath, normalized);
  fs.mkdirSync(paths.knowledgeRootPath, { recursive: true });
  const students = readStudentsIndex().filter((student) => normalized.studentIds.includes(String(student.id)));
  fs.writeFileSync(path.join(paths.knowledgeRootPath, '绑定学生.md'), projectBindingIndexTemplate(normalized, students), 'utf8');
}

function projectStagingStatusLabel(status) {
  if (status === 'collected') return '已收集';
  if (status === 'screened') return '已初筛';
  if (status === 'selected') return '选入分析';
  if (status === 'analyzed') return '已分析';
  if (status === 'promoted') return '已晋升';
  if (status === 'discarded') return '已归档/丢弃';
  return status || '已收集';
}

function normalizeProjectStagingItem(item) {
  const now = new Date().toISOString();
  return {
    id: String(item?.id || `staging-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`),
    filename: String(item?.filename || path.basename(String(item?.path || '暂存资料'))),
    path: String(item?.path || ''),
    size: Number(item?.size || 0),
    type: String(item?.type || materialTypeForFile(item?.filename || item?.path || '')),
    sha1: String(item?.sha1 || ''),
    status: String(item?.status || 'collected'),
    sourceStrategy: String(item?.sourceStrategy || 'full_copy'),
    reviewStatus: String(item?.reviewStatus || 'pending'),
    reviewNote: String(item?.reviewNote || ''),
    reviewedAt: String(item?.reviewedAt || ''),
    sourcePath: String(item?.sourcePath || ''),
    addedAt: String(item?.addedAt || now),
    updatedAt: String(item?.updatedAt || now),
    promotedAt: String(item?.promotedAt || ''),
    promotedAssetId: String(item?.promotedAssetId || ''),
    aiAction: String(item?.aiAction || ''),
    aiReason: String(item?.aiReason || ''),
    aiScore: item?.aiScore === undefined || item?.aiScore === '' ? '' : Number(item.aiScore),
    aiReviewedAt: String(item?.aiReviewedAt || ''),
    duplicateCount: Number(item?.duplicateCount || 1),
    stagingAgeDays: item?.stagingAgeDays === undefined || item?.stagingAgeDays === '' ? '' : Number(item.stagingAgeDays),
    governanceAction: String(item?.governanceAction || ''),
    governanceReason: String(item?.governanceReason || ''),
    governanceReviewedAt: String(item?.governanceReviewedAt || ''),
  };
}

function writeProjectStagingIndex(project) {
  const normalized = normalizeProject(project);
  const paths = projectPathsFor(normalized.name, normalized.projectRootPath, normalized);
  fs.mkdirSync(paths.stagingPath, { recursive: true });
  const items = (normalized.stagingItems || []).map(normalizeProjectStagingItem);
  fs.writeFileSync(path.join(paths.stagingPath, 'staging-index.json'), JSON.stringify({
    version: 1,
    projectId: normalized.id,
    projectName: normalized.name,
    updatedAt: new Date().toISOString(),
    items,
  }, null, 2), 'utf8');
  const rows = items.map((item) => `| ${item.filename} | ${projectStagingStatusLabel(item.status)} | ${item.type} | ${item.size} | ${item.aiAction || '-'} | ${String(item.aiReason || '').replace(/\|/g, '/')} | ${item.governanceAction || '-'} | ${String(item.governanceReason || '').replace(/\|/g, '/')} | ${item.path} |`).join('\n') || '| 暂无 | - | - | - | - | - | - | - | - |';
  fs.writeFileSync(path.join(paths.stagingPath, '研究暂存清单.md'), `# ${normalized.name} 研究暂存清单\n\n> 暂存层用于收集和筛选项目研究资料；未晋升前不会进入正式文件资产中心。\n\n| 文件 | 状态 | 类型 | 大小 | AI建议 | AI理由 | 治理建议 | 治理理由 | 路径 |\n| --- | --- | --- | ---: | --- | --- | --- | --- | --- |\n${rows}\n`, 'utf8');
}

function collectProjectRawFiles(rawPath) {
  const files = [];
  const walk = (dir) => {
    if (!dir || !fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.edu-manager' || entry.name === 'node_modules') continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        const stat = fs.statSync(fullPath);
        files.push({
          filename: entry.name,
          path: fullPath,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          sha1: sha1File(fullPath),
          relativePath: path.relative(rawPath, fullPath).replace(/\\/g, '/'),
        });
      }
    }
  };
  walk(rawPath);
  return files.sort((a, b) => String(a.path).localeCompare(String(b.path)));
}

function projectDigestStatePath(project) {
  const paths = projectPathsFor(project.name, project.projectRootPath, project);
  return path.join(paths.managerPath, 'project-digest-state.json');
}

function readProjectDigestState(project) {
  const paths = projectPathsFor(project.name, project.projectRootPath, project);
  let parsed = {};
  try {
    parsed = JSON.parse(fs.readFileSync(projectDigestStatePath({ ...project, ...paths }), 'utf8'));
  } catch {
    parsed = {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {};
  const rawFiles = collectProjectRawFiles(paths.rawPath);
  const legacyDigested = new Set(Array.isArray(parsed.digestedFiles) ? parsed.digestedFiles.map(String) : []);
  const digestManifest = parsed.digestManifest && typeof parsed.digestManifest === 'object' && !Array.isArray(parsed.digestManifest) ? parsed.digestManifest : {};
  const pendingFiles = rawFiles.filter((file) => {
    const previous = digestManifest[file.relativePath];
    if (previous && String(previous.sha1 || '') === file.sha1) return false;
    return !(legacyDigested.has(file.path) || legacyDigested.has(file.sha1));
  }).map((file) => ({ ...file, changeType: digestManifest[file.relativePath] ? 'modified' : 'added' }));
  const status = parsed.status || (pendingFiles.length > 0 ? 'pending' : 'idle');
  return {
    version: 2,
    projectId: String(project.id || ''),
    projectName: String(project.name || ''),
    status,
    message: parsed.message || (pendingFiles.length > 0 ? `有 ${pendingFiles.length} 份项目资料待消化。` : '暂无待消化项目资料。'),
    rawPath: paths.rawPath,
    digestFile: projectDigestStatePath({ ...project, ...paths }),
    rawFileCount: rawFiles.length,
    pendingCount: pendingFiles.length,
    submittedCount: ['submitted', 'digesting'].includes(status) ? pendingFiles.length : 0,
    lastDigestAt: parsed.lastDigestAt || '',
    digestSubmittedAt: parsed.digestSubmittedAt || '',
    digestBatchId: parsed.digestBatchId || '',
    pendingFiles: pendingFiles.slice(0, 100).map((file) => ({
      filename: file.filename,
      path: file.path,
      size: file.size,
      sha1: file.sha1,
      relativePath: file.relativePath,
      changeType: file.changeType,
    })),
    digestedFiles: Array.isArray(parsed.digestedFiles) ? parsed.digestedFiles : [],
    digestManifest,
    submittedFiles: Array.isArray(parsed.submittedFiles) ? parsed.submittedFiles : [],
    digestBatches: Array.isArray(parsed.digestBatches) ? parsed.digestBatches : [],
    updatedAt: parsed.updatedAt || '',
  };
}

function writeProjectDigestState(project, patch) {
  const paths = projectPathsFor(project.name, project.projectRootPath, project);
  fs.mkdirSync(paths.managerPath, { recursive: true });
  const current = readProjectDigestState({ ...project, ...paths });
  const next = {
    ...current,
    ...patch,
    version: 2,
    projectId: String(project.id || ''),
    projectName: String(project.name || ''),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(projectDigestStatePath({ ...project, ...paths }), JSON.stringify(next, null, 2), 'utf8');
  return readProjectDigestState({ ...project, ...paths, digestState: next });
}

function normalizeProject(project) {
  const cleanName = sanitizeName(project.name || '学习项目');
  const storageName = sanitizeName(project.storageName || project.name || '学习项目');
  const createdAt = project.createdAt || new Date().toISOString();
  const studentIds = Array.isArray(project.studentIds) ? project.studentIds.map(String) : [];
  const workspaceMode = String(project.workspaceMode || 'managed') === 'linked' ? 'linked' : 'managed';
  const paths = projectPathsFor(cleanName, project.projectRootPath, { ...project, storageName, workspaceMode });
  const workspaceTemplate = projectWorkspaceTemplateFor(project.workspaceTemplateId);
  const workspaceFolders = projectWorkspaceFoldersFor(project);
  const fileDigestState = readProjectDigestState({ ...project, name: cleanName, projectRootPath: paths.projectRootPath });
  const digestState = project.digestState && typeof project.digestState === 'object'
    ? { ...project.digestState, ...fileDigestState }
    : fileDigestState;
  return {
    id: String(project.id || `project-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`),
    name: cleanName,
    storageName,
    type: String(project.type || '学习项目'),
    description: String(project.description || ''),
    objective: String(project.objective || ''),
    status: String(project.status || 'active'),
    studentIds,
    studentNames: Array.isArray(project.studentNames) ? project.studentNames.map(String) : [],
    agentTool: String(project.agentTool || 'qclaw'),
    projectRootPath: paths.projectRootPath,
    managerPath: paths.managerPath,
    workspacePath: paths.workspacePath,
    workspaceMode,
    stagingPath: paths.stagingPath,
    knowledgeRootPath: paths.knowledgeRootPath,
    rawPath: paths.rawPath,
    conceptPath: paths.conceptPath,
    entityPath: paths.entityPath,
    summaryPath: paths.summaryPath,
    qaPath: paths.qaPath,
    synthesisPath: paths.synthesisPath,
    reportPath: paths.reportPath,
    contributionPath: paths.contributionPath,
    agentPath: paths.agentPath,
    outputPath: paths.outputPath,
    workspaceTemplateId: String(project.workspaceTemplateId || workspaceTemplate.id),
    workspaceTemplateName: String(project.workspaceTemplateName || workspaceTemplate.name),
    workspaceFolders,
    knowledgeStrategy: String(project.knowledgeStrategy || ''),
    growthStrategy: String(project.growthStrategy || ''),
    deliverables: Array.isArray(project.deliverables) ? project.deliverables.map(String).filter(Boolean) : [],
    duplicatedFrom: String(project.duplicatedFrom || ''),
    studentEvidence: Array.isArray(project.studentEvidence) ? project.studentEvidence.map((item) => ({
      studentId: String(item?.studentId || ''),
      ability: String(item?.ability || ''),
      observation: String(item?.observation || ''),
      status: String(item?.status || 'draft'),
      updatedAt: String(item?.updatedAt || ''),
    })).filter((item) => item.studentId) : [],
    automation: {
      enabled: false,
      onWorkspaceChange: project.automation?.onWorkspaceChange !== false,
      onStatusChange: Boolean(project.automation?.onStatusChange),
      intervalMinutes: Math.max(15, Math.min(10080, Number(project.automation?.intervalMinutes || 1440))),
      nextRunAt: String(project.automation?.nextRunAt || ''),
      lastRunAt: String(project.automation?.lastRunAt || ''),
      lastReason: String(project.automation?.lastReason || ''),
    },
    workspaceLastScannedAt: project.workspaceLastScannedAt || '',
    promotionPath: project.promotionPath || path.join(paths.contributionPath, '知识贡献申请.md'),
    assetIds: Array.isArray(project.assetIds) ? project.assetIds.map(String) : [],
    stagingItems: Array.isArray(project.stagingItems) ? project.stagingItems.map(normalizeProjectStagingItem) : [],
    digestState,
    createdAt,
    updatedAt: project.updatedAt || createdAt,
    archivedAt: project.archivedAt || '',
    sealedAt: project.sealedAt || '',
    sealedSnapshotPath: project.sealedSnapshotPath || '',
    publishedAt: project.publishedAt || '',
  };
}

function ensureProjectWorkspace(project) {
  const normalized = normalizeProject(project);
  const paths = projectPathsFor(normalized.name, normalized.projectRootPath, normalized);
  const workspaceFolderDirs = normalized.workspaceMode === 'linked'
    ? []
    : projectWorkspaceFoldersFor(normalized).map((folder) => path.join(paths.workspacePath, folder));
  [
    projectsBaseDir(),
    paths.workspacePath,
    paths.stagingPath,
    ...workspaceFolderDirs,
    paths.managerPath,
    paths.knowledgeRootPath,
    paths.rawPath,
    paths.conceptPath,
    paths.entityPath,
    paths.summaryPath,
    paths.qaPath,
    paths.synthesisPath,
    paths.reportPath,
    paths.contributionPath,
    paths.outputPath,
  ].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
  const students = readStudentsIndex().filter((student) => normalized.studentIds.includes(String(student.id)));
  writeTextIfMissing(paths.agentPath, projectAgentTemplate(normalized, students));
  writeProjectWorkspaceIndex(normalized);
  writeProjectBindingIndex(normalized);
  writeTextIfMissing(path.join(paths.knowledgeRootPath, 'index.md'), `# ${normalized.name} 项目知识空间\n\n- 项目原始资料库：${paths.rawPath}\n- 综合汇总库：${paths.synthesisPath}\n- 知识贡献：${paths.contributionPath}\n`);
  writeTextIfMissing(path.join(paths.knowledgeRootPath, 'log.md'), `# ${normalized.name} 项目处理日志\n\n`);
  const ensured = { ...normalized, ...paths };
  writeProjectStagingIndex(ensured);
  return ensured;
}

function getProjects() {
  const projects = readProjects().map(normalizeProject).map((project) => {
    const records = readProjectKnowledgeReview(project).records;
    const knowledgeKinds = new Set(records.filter((item) => !['rejected', 'invalid'].includes(item.status)).map((item) => item.kind));
    const knowledgeCoverage = Math.round((knowledgeKinds.size / 5) * 100);
    const riskReasons = [
      !project.studentIds.length ? '未绑定学生' : '',
      !project.assetIds.length ? '无正式资产' : '',
      project.digestState?.pendingCount ? `${project.digestState.pendingCount} 份资料待消化` : '',
      project.digestState?.status === 'failed' ? '自动消化失败' : '',
      !fs.existsSync(project.workspacePath) ? '工作空间路径失效' : '',
      records.some((item) => ['ai_generated', 'pending_review'].includes(item.status) && Date.now() - Date.parse(item.generatedAt || 0) > 7 * 86400000) ? '知识待审核超过 7 天' : '',
    ].filter(Boolean);
    return {
      ...project,
      dashboard: {
        knowledgeCount: records.length,
        pendingKnowledgeCount: records.filter((item) => ['ai_generated', 'pending_review'].includes(item.status)).length,
        pendingStagingCount: (project.stagingItems || []).filter((item) => !['promoted', 'discarded'].includes(item.status)).length,
        acceptedStagingCount: (project.stagingItems || []).filter((item) => item.reviewStatus === 'accepted' && !item.promotedAssetId).length,
        contributionReady: fs.existsSync(project.promotionPath || ''),
        contributionStatus: project.publishedAt ? 'published' : fs.existsSync(project.promotionPath || '') ? 'ready' : 'not_generated',
        knowledgeCoverage,
        riskCount: riskReasons.length,
        riskReasons,
      },
    };
  });
  return JSON.stringify({ ok: true, projects });
}

function createProject(optionsJson) {
  try {
    const options = JSON.parse(optionsJson || '{}');
    if (!String(options.name || '').trim()) return JSON.stringify({ ok: false, message: '请填写项目名称。' });
    const students = readStudentsIndex();
    const studentIds = Array.isArray(options.studentIds) ? options.studentIds.map(String) : [];
    const selectedStudents = students.filter((student) => studentIds.includes(String(student.id)));
    const validation = validateWorkspaceFolders(options.workspaceFolders);
    if (!validation.ok) return JSON.stringify({ ok: false, message: validation.errors.join(' ') });
    const workspaceMode = options.workspaceMode === 'linked' ? 'linked' : 'managed';
    const workspacePath = workspaceMode === 'linked' ? path.resolve(String(options.workspacePath || '')) : '';
    if (workspaceMode === 'linked' && (!workspacePath || !fs.existsSync(workspacePath) || !fs.statSync(workspacePath).isDirectory())) {
      return JSON.stringify({ ok: false, message: '请选择一个存在的项目文件夹作为工作空间。' });
    }
    const existingBinding = readProjects().map(normalizeProject).find((item) => workspaceMode === 'linked'
      && String(item.workspacePath || '').toLocaleLowerCase('zh-CN') === workspacePath.toLocaleLowerCase('zh-CN'));
    if (existingBinding) return JSON.stringify({ ok: false, message: `该文件夹已绑定学习项目“${existingBinding.name}”。` });
    const project = ensureProjectWorkspace(normalizeProject({
      name: options.name,
      storageName: options.name,
      type: options.type || '学习项目',
      description: options.description || '',
      objective: options.objective || '',
      status: options.status || 'active',
      studentIds,
      studentNames: selectedStudents.map((student) => student.name),
      workspaceTemplateId: options.workspaceTemplateId || 'general',
      workspaceTemplateName: options.workspaceTemplateName || projectWorkspaceTemplateFor(options.workspaceTemplateId).name,
      workspaceFolders: validation.folders,
      workspaceMode,
      workspacePath,
      knowledgeStrategy: options.knowledgeStrategy || '',
      growthStrategy: options.growthStrategy || '',
      agentTool: String(options.agentTool || 'qclaw'),
      deliverables: Array.isArray(options.deliverables) ? options.deliverables.map(String).filter(Boolean) : [],
    }));
    const projects = readProjects().map(normalizeProject);
    writeProjects([project, ...projects.filter((item) => String(item.id) !== String(project.id))]);
    appendHostTimeline({ type: 'project_created', title: 'Project created', detail: project.name, count: 1 });
    return JSON.stringify({ ok: true, project, projects: readProjects().map(normalizeProject), message: `已创建学习项目：${project.projectRootPath}` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `创建学习项目失败：${error.message}` });
  }
}

function updateProjectMetadata(projectId, metadataJson) {
  try {
    const access = mutableProject(projectId, '编辑项目');
    if (access.error) return access.error;
    const metadata = JSON.parse(metadataJson || '{}');
    const name = sanitizeName(metadata.name || access.project.name);
    if (!name) return JSON.stringify({ ok: false, message: '项目名称不能为空。' });
    const now = new Date().toISOString();
    const projects = readProjects().map(normalizeProject);
    let updated = null;
    const nextProjects = projects.map((project) => {
      if (String(project.id) !== String(projectId)) return project;
      updated = normalizeProject({
        ...project,
        name,
        type: String(metadata.type || project.type),
        description: String(metadata.description ?? project.description ?? ''),
        objective: String(metadata.objective ?? project.objective ?? ''),
        knowledgeStrategy: String(metadata.knowledgeStrategy ?? project.knowledgeStrategy ?? ''),
        growthStrategy: String(metadata.growthStrategy ?? project.growthStrategy ?? ''),
        agentTool: String(metadata.agentTool || project.agentTool || 'qclaw'),
        updatedAt: now,
      });
      return updated;
    });
    writeProjects(nextProjects);
    writeProjectBindingIndex(updated);
    appendHostTimeline({ type: 'project_metadata_updated', title: 'Project metadata updated', detail: updated.name });
    return JSON.stringify({ ok: true, project: updated, projects: nextProjects, message: '项目信息已更新；物理目录保持不变。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `编辑项目失败：${error.message}` });
  }
}

function removeProjectRecord(projectId) {
  try {
    const projects = readProjects().map(normalizeProject);
    const project = projects.find((item) => String(item.id) === String(projectId));
    if (!project) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    const removedAt = new Date().toISOString();
    fs.mkdirSync(project.managerPath, { recursive: true });
    fs.writeFileSync(path.join(project.managerPath, '项目记录已移除.json'), JSON.stringify({
      version: 1,
      removedAt,
      project,
      note: '仅从教育管家项目索引移除；工作空间、知识空间、资产与审计文件均保留。',
    }, null, 2), 'utf8');
    const nextProjects = projects.filter((item) => String(item.id) !== String(projectId));
    writeProjects(nextProjects);
    appendHostTimeline({ type: 'project_record_removed', title: 'Project record removed', detail: project.name });
    return JSON.stringify({ ok: true, projects: nextProjects, preservedPath: project.projectRootPath, message: `已移除项目记录“${project.name}”，所有物理文件均已保留。` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `删除项目记录失败：${error.message}` });
  }
}

function relocateProjectWorkspace(projectId) {
  try {
    const access = mutableProject(projectId, '重新定位工作空间');
    if (access.error) return access.error;
    const selected = dialog.showOpenDialogSync(mainWindow, { title: '重新定位项目工作空间', properties: ['openDirectory'] });
    if (!selected?.[0]) return JSON.stringify({ ok: false, cancelled: true, message: '已取消项目路径重新定位。' });
    const workspacePath = path.resolve(selected[0]);
    const conflict = readProjects().map(normalizeProject).find((item) => String(item.id) !== String(projectId) && path.resolve(item.workspacePath).toLocaleLowerCase('zh-CN') === workspacePath.toLocaleLowerCase('zh-CN'));
    if (conflict) return JSON.stringify({ ok: false, message: `该文件夹已绑定项目“${conflict.name}”。` });
    const previousPath = access.project.workspacePath;
    const result = updateProjectRecord(projectId, (project) => ({ ...project, workspaceMode: 'linked', workspacePath, previousWorkspacePath: previousPath, workspaceRelocatedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
    const ensured = ensureProjectWorkspace(result.project);
    writeProjectBindingIndex(ensured);
    appendHostTimeline({ type: 'project_workspace_relocated', title: 'Project workspace relocated', detail: `${ensured.name}: ${previousPath} -> ${workspacePath}` });
    return JSON.stringify({ ok: true, project: ensured, projects: readProjects().map(normalizeProject), message: '项目工作空间已重新定位；项目知识空间和历史记录保持不变。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `项目路径重新定位失败：${error.message}` });
  }
}

function findRemovedProjectSnapshots() {
  const snapshots = [];
  const root = projectsBaseDir();
  if (!fs.existsSync(root)) return snapshots;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const snapshotPath = path.join(root, entry.name, '.edu-manager', '项目记录已移除.json');
    if (!fs.existsSync(snapshotPath)) continue;
    const parsed = safeReadJson(snapshotPath, null);
    if (parsed?.project) snapshots.push({ snapshotPath, removedAt: parsed.removedAt || '', project: normalizeProject(parsed.project) });
  }
  return snapshots;
}

function getRemovedProjects() {
  try {
    const activeIds = new Set(readProjects().map((item) => String(item.id)));
    const removed = findRemovedProjectSnapshots().filter((item) => !activeIds.has(String(item.project.id)));
    return JSON.stringify({ ok: true, removed, message: `发现 ${removed.length} 个可恢复的项目记录。` });
  } catch (error) {
    return JSON.stringify({ ok: false, removed: [], message: `读取已移除项目失败：${error.message}` });
  }
}

function restoreRemovedProject(snapshotPath) {
  try {
    const resolved = path.resolve(String(snapshotPath || ''));
    const allowedRoot = path.resolve(projectsBaseDir()).toLocaleLowerCase('zh-CN');
    if (!resolved.toLocaleLowerCase('zh-CN').startsWith(allowedRoot) || path.basename(resolved) !== '项目记录已移除.json') return JSON.stringify({ ok: false, message: '无效的项目恢复快照。' });
    const parsed = safeReadJson(resolved, null);
    if (!parsed?.project) return JSON.stringify({ ok: false, message: '项目恢复快照不完整。' });
    const project = normalizeProject(parsed.project);
    const projects = readProjects().map(normalizeProject);
    if (projects.some((item) => String(item.id) === String(project.id))) return JSON.stringify({ ok: false, message: '该项目记录已存在。' });
    const restored = normalizeProject({ ...project, restoredAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    writeProjects([restored, ...projects]);
    fs.writeFileSync(path.join(path.dirname(resolved), `项目记录恢复-${timestampForFilename()}.json`), JSON.stringify({ restoredAt: new Date().toISOString(), source: resolved, projectId: restored.id }, null, 2), 'utf8');
    appendHostTimeline({ type: 'project_record_restored', title: 'Project record restored', detail: restored.name });
    return JSON.stringify({ ok: true, project: restored, projects: readProjects().map(normalizeProject), message: `已恢复项目记录“${restored.name}”。` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `恢复项目记录失败：${error.message}` });
  }
}

function exportProjectPackage(projectId) {
  try {
    const project = readProjects().map(normalizeProject).find((item) => String(item.id) === String(projectId));
    if (!project) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    const target = dialog.showSaveDialogSync(mainWindow, { title: '导出学习项目包', defaultPath: `${sanitizeName(project.name)}.edu-project.json`, filters: [{ name: '教育管家项目包', extensions: ['json'] }] });
    if (!target) return JSON.stringify({ ok: false, cancelled: true, message: '已取消导出。' });
    const payload = { format: 'edu-manager-project', version: 2, exportedAt: new Date().toISOString(), project: { name: project.name, type: project.type, description: project.description, objective: project.objective, workspaceTemplateId: project.workspaceTemplateId, workspaceTemplateName: project.workspaceTemplateName, workspaceFolders: project.workspaceFolders, knowledgeStrategy: project.knowledgeStrategy, growthStrategy: project.growthStrategy, deliverables: project.deliverables, studentIds: project.studentIds }, exclusions: ['workspace files', 'assets', 'knowledge outputs', 'student evidence', 'promotion history'] };
    fs.writeFileSync(target, JSON.stringify(payload, null, 2), 'utf8');
    return JSON.stringify({ ok: true, path: target, message: '项目结构与策略已导出；未包含资料、资产或历史贡献。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `导出项目失败：${error.message}` });
  }
}

function importProjectPackage() {
  try {
    const selected = dialog.showOpenDialogSync(mainWindow, { title: '导入学习项目包', properties: ['openFile'], filters: [{ name: '教育管家项目包', extensions: ['json'] }] });
    if (!selected?.[0]) return JSON.stringify({ ok: false, cancelled: true, message: '已取消导入。' });
    const payload = safeReadJson(selected[0], null);
    if (payload?.format !== 'edu-manager-project' || !payload.project?.name) return JSON.stringify({ ok: false, message: '不是有效的教育管家项目包。' });
    const source = payload.project;
    const importedName = `${sanitizeName(source.name)} 导入`;
    const validStudents = readStudentsIndex().filter((student) => (source.studentIds || []).map(String).includes(String(student.id)));
    const project = ensureProjectWorkspace(normalizeProject({ name: importedName, storageName: importedName, type: source.type, description: source.description, objective: source.objective, status: 'draft', studentIds: validStudents.map((student) => String(student.id)), studentNames: validStudents.map((student) => student.name), workspaceTemplateId: source.workspaceTemplateId, workspaceTemplateName: source.workspaceTemplateName, workspaceFolders: source.workspaceFolders, knowledgeStrategy: source.knowledgeStrategy, growthStrategy: source.growthStrategy, deliverables: source.deliverables, importedFrom: selected[0], assetIds: [], stagingItems: [], studentEvidence: [], automation: { enabled: false } }));
    const projects = [project, ...readProjects().map(normalizeProject)];
    writeProjects(projects);
    return JSON.stringify({ ok: true, project, projects, message: `已导入项目“${project.name}”；资料和历史贡献未被复制。` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `导入项目失败：${error.message}` });
  }
}

function duplicateProject(projectId, name) {
  try {
    const source = readProjects().map(normalizeProject).find((item) => String(item.id) === String(projectId));
    if (!source) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    const copyName = sanitizeName(name || `${source.name} 副本`);
    const students = readStudentsIndex().filter((student) => source.studentIds.includes(String(student.id)));
    const project = ensureProjectWorkspace(normalizeProject({
      name: copyName,
      storageName: copyName,
      type: source.type,
      description: source.description,
      objective: source.objective,
      status: 'draft',
      studentIds: source.studentIds,
      studentNames: students.map((student) => student.name),
      workspaceTemplateId: source.workspaceTemplateId,
      workspaceTemplateName: source.workspaceTemplateName,
      workspaceFolders: source.workspaceFolders,
      workspaceMode: 'managed',
      knowledgeStrategy: source.knowledgeStrategy,
      growthStrategy: source.growthStrategy,
      duplicatedFrom: source.id,
      assetIds: [],
      stagingItems: [],
      studentEvidence: [],
      automation: { ...source.automation, enabled: false, nextRunAt: '' },
    }));
    const projects = readProjects().map(normalizeProject);
    const nextProjects = [project, ...projects];
    writeProjects(nextProjects);
    appendHostTimeline({ type: 'project_duplicated', title: 'Project duplicated', detail: `${source.name} -> ${project.name}` });
    return JSON.stringify({ ok: true, project, projects: nextProjects, message: `已复制项目结构为“${project.name}”；未复制资料、资产、知识内容或历史贡献。` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `复制项目失败：${error.message}` });
  }
}

function updateProjectStudentEvidence(projectId, studentId, evidenceJson) {
  try {
    const access = mutableProject(projectId, '更新学生独立成长证据');
    if (access.error) return access.error;
    if (!access.project.studentIds.includes(String(studentId))) return JSON.stringify({ ok: false, message: '该学生未绑定到当前项目。' });
    const evidence = JSON.parse(evidenceJson || '{}');
    const now = new Date().toISOString();
    const result = updateProjectRecord(projectId, (project) => ({
      ...project,
      studentEvidence: [
        ...(project.studentEvidence || []).filter((item) => String(item.studentId) !== String(studentId)),
        { studentId: String(studentId), ability: String(evidence.ability || ''), observation: String(evidence.observation || ''), status: String(evidence.status || 'draft'), updatedAt: now },
      ],
      updatedAt: now,
    }));
    const student = readStudentsIndex().find((item) => String(item.id) === String(studentId));
    if (student) {
      const evidenceDir = path.join(result.project.contributionPath, '学生独立成长证据');
      fs.mkdirSync(evidenceDir, { recursive: true });
      fs.writeFileSync(path.join(evidenceDir, `${sanitizeName(student.name)}-${studentId}.md`), `# ${student.name} · ${result.project.name}\n\n- 能力维度：${evidence.ability || '待补充'}\n- 状态：${evidence.status || 'draft'}\n- 更新时间：${now}\n\n## 独立观察\n\n${evidence.observation || '待补充'}\n`, 'utf8');
      appendGrowthEvidenceCandidate(student, {
        id: `project-student-${result.project.id}-${studentId}`,
        title: `${result.project.name}·${evidence.ability || '待标注能力'}`,
        ability: String(evidence.ability || '待标注'),
        content: String(evidence.observation || '待补充'),
        projectId: result.project.id,
        projectName: result.project.name,
        sourcePath: evidenceDir,
        status: evidence.status === 'verified' || evidence.status === 'published' ? 'confirmed' : evidence.status === 'rejected' ? 'rejected' : 'pending',
        confidence: evidence.status === 'verified' || evidence.status === 'published' ? '人工确认' : '待审核',
      });
    }
    return JSON.stringify({ ok: true, project: result.project, projects: result.projects, message: '学生独立成长证据已保存；项目知识仍由所有参与学生共享。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `保存学生成长证据失败：${error.message}` });
  }
}

function pickProjectWorkspaceDir() {
  try {
    const result = dialog.showOpenDialogSync(mainWindow, {
      title: '选择已有项目文件夹',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (!result || !result[0]) return JSON.stringify({ ok: false, cancelled: true, message: '未选择项目文件夹。' });
    const target = path.resolve(result[0]);
    const bound = readProjects().map(normalizeProject).find((item) => String(item.workspacePath || '').toLocaleLowerCase('zh-CN') === target.toLocaleLowerCase('zh-CN'));
    return JSON.stringify({ ok: true, path: target, alreadyBound: Boolean(bound), projectName: bound?.name || '', message: bound ? `该文件夹已绑定项目“${bound.name}”。` : '已选择已有项目文件夹。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `选择项目文件夹失败：${error.message}` });
  }
}

function applyProjectWorkspaceTemplate(projectId, templateId, foldersJson, templateName, templateV2Json) {
  try {
    const template = projectWorkspaceTemplateFor(templateId);
    let templateV2 = {};
    try { templateV2 = JSON.parse(templateV2Json || '{}'); } catch { templateV2 = {}; }
    let parsedFolders = [];
    try {
      parsedFolders = JSON.parse(foldersJson || '[]');
    } catch {
      parsedFolders = [];
    }
    const validation = validateWorkspaceFolders(parsedFolders);
    if (!validation.ok) return JSON.stringify({ ok: false, message: validation.errors.join(' ') });
    const workspaceFolders = validation.folders;
    const folders = workspaceFolders.length ? workspaceFolders : template.folders;
    const now = new Date().toISOString();
    const projects = readProjects().map(normalizeProject);
    const currentProject = projects.find((project) => String(project.id) === String(projectId));
    if (currentProject?.status === 'sealed') return JSON.stringify({ ok: false, message: '项目已封存，请先恢复为“进行中”后再修改工作空间。' });
    let updated = null;
    const nextProjects = projects.map((project) => {
      if (String(project.id) !== String(projectId)) return project;
      updated = {
        ...project,
        workspaceTemplateId: template.id,
        workspaceTemplateName: String(templateName || template.name),
        workspaceFolders: folders,
        knowledgeStrategy: String(templateV2.knowledgeStrategy || template.knowledgeStrategy || project.knowledgeStrategy || ''),
        growthStrategy: String(templateV2.growthStrategy || template.growthStrategy || project.growthStrategy || ''),
        deliverables: Array.isArray(templateV2.deliverables) ? templateV2.deliverables.map(String).filter(Boolean) : (template.deliverables || project.deliverables),
        updatedAt: now,
      };
      return updated;
    });
    if (!updated) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    const ensured = ensureProjectWorkspace(updated);
    writeProjects(nextProjects.map((project) => (String(project.id) === String(projectId) ? ensured : project)));
    appendHostTimeline({
      type: 'project_workspace_template_applied',
      title: 'Project workspace template applied',
      detail: `${ensured.name} -> ${template.name}`,
      count: folders.length,
    });
    return JSON.stringify({
      ok: true,
      project: ensured,
      projects: readProjects().map(normalizeProject),
      message: `已应用项目工作空间模板：${template.name}，补建 ${folders.length} 个工作空间文件夹。`,
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `应用项目工作空间模板失败：${error.message}` });
  }
}

function updateProjectStatus(projectId, status) {
  try {
    const allowed = new Set(['draft', 'active', 'pending_review', 'pending_archive', 'archived', 'published', 'sealed']);
    const nextStatus = allowed.has(String(status || '')) ? String(status) : 'active';
    const now = new Date().toISOString();
    const projects = readProjects().map(normalizeProject);
    let updated = null;
    const transitions = {
      draft: new Set(['active', 'sealed']),
      active: new Set(['pending_review', 'pending_archive', 'sealed']),
      pending_review: new Set(['active', 'pending_archive', 'sealed']),
      pending_archive: new Set(['active', 'archived', 'sealed']),
      archived: new Set(['active', 'published', 'sealed']),
      published: new Set(['active', 'sealed']),
      sealed: new Set(['active']),
    };
    const currentProject = projects.find((project) => String(project.id) === String(projectId));
    if (!currentProject) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    if (currentProject.status !== nextStatus && !transitions[currentProject.status]?.has(nextStatus)) {
      return JSON.stringify({ ok: false, message: `不能从“${currentProject.status}”直接切换到“${nextStatus}”。` });
    }
    const nextProjects = projects.map((project) => {
      if (String(project.id) !== String(projectId)) return project;
      updated = {
        ...project,
        status: nextStatus,
        updatedAt: now,
        ...(nextStatus === 'archived' ? { archivedAt: project.archivedAt || now } : {}),
        ...(nextStatus === 'published' ? { publishedAt: project.publishedAt || now } : {}),
        ...(nextStatus === 'sealed' ? { sealedAt: now } : {}),
      };
      return updated;
    });
    if (!updated) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    if (updated.automation?.enabled && updated.automation.onStatusChange && currentProject.status !== nextStatus && nextStatus !== 'sealed') {
      updated.digestState = writeProjectDigestState(updated, { status: 'pending', message: `项目阶段已变更为 ${nextStatus}，等待增量消化。`, triggerReason: 'status_change' });
      const updatedIndex = nextProjects.findIndex((item) => String(item.id) === String(projectId));
      nextProjects[updatedIndex] = normalizeProject(updated);
    }
    if (nextStatus === 'sealed') {
      const ensured = ensureProjectWorkspace(updated);
      const snapshotDir = path.join(ensured.managerPath, '封存快照');
      fs.mkdirSync(snapshotDir, { recursive: true });
      const snapshotPath = path.join(snapshotDir, `snapshot-${now.replace(/[:.]/g, '-')}.json`);
      const snapshot = {
        version: 1,
        sealedAt: now,
        project: ensured,
        workspaceFiles: collectProjectRawFiles(ensured.workspacePath).map(({ filename, path: filePath, size, sha1 }) => ({ filename, path: filePath, size, sha1 })),
        knowledgeFiles: collectProjectRawFiles(ensured.knowledgeRootPath).map(({ filename, path: filePath, size, sha1 }) => ({ filename, path: filePath, size, sha1 })),
        unfinished: (ensured.stagingItems || []).filter((item) => !['promoted', 'discarded'].includes(item.status)).map((item) => ({ id: item.id, filename: item.filename, status: item.status })),
      };
      fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf8');
      updated.sealedSnapshotPath = snapshotPath;
      const index = nextProjects.findIndex((item) => String(item.id) === String(projectId));
      nextProjects[index] = { ...updated };
    }
    writeProjects(nextProjects);
    appendHostTimeline({ type: 'project_status_updated', title: 'Project status updated', detail: `${updated.name} -> ${nextStatus}` });
    return JSON.stringify({ ok: true, project: updated, projects: nextProjects, message: `项目状态已更新为：${nextStatus}` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `更新项目状态失败：${error.message}` });
  }
}

function mutableProject(projectId, action) {
  const project = readProjects().map(normalizeProject).find((item) => String(item.id) === String(projectId));
  if (!project) return { error: JSON.stringify({ ok: false, message: '未找到学习项目。' }) };
  if (project.status === 'sealed') return { error: JSON.stringify({ ok: false, message: `项目已封存，不能${action}。请先恢复为“进行中”。` }) };
  return { project };
}

function scanProjectWorkspace(projectId) {
  try {
    const access = mutableProject(projectId, '扫描或修改工作空间资料');
    if (access.error) return access.error;
    const project = ensureProjectWorkspace(access.project);
    const excludedRoots = [project.stagingPath, project.knowledgeRootPath, project.managerPath].map((item) => path.resolve(item).toLocaleLowerCase('zh-CN'));
    const files = collectProjectRawFiles(project.workspacePath)
      .filter((file) => !excludedRoots.some((root) => path.resolve(file.path).toLocaleLowerCase('zh-CN').startsWith(root)))
      .filter((file) => !['工作空间结构.md', 'desktop.ini', 'thumbs.db'].includes(file.filename.toLocaleLowerCase('zh-CN')))
      .slice(0, 2000);
    const existing = new Map((project.stagingItems || []).map((item) => [String(item.sourcePath || item.path).toLocaleLowerCase('zh-CN'), item]));
    let added = 0;
    let updatedCount = 0;
    let missing = 0;
    const scannedPaths = new Set();
    const stagingItems = [...(project.stagingItems || [])];
    for (const file of files) {
      const key = String(file.path).toLocaleLowerCase('zh-CN');
      scannedPaths.add(key);
      const current = existing.get(key);
      if (current) {
        const index = stagingItems.findIndex((item) => item.id === current.id);
        stagingItems[index] = normalizeProjectStagingItem({ ...current, size: file.size, sha1: file.sha1, updatedAt: new Date().toISOString() });
        updatedCount += 1;
      } else {
        stagingItems.push(normalizeProjectStagingItem({
          filename: file.filename,
          path: file.path,
          sourcePath: file.path,
          size: file.size,
          sha1: file.sha1,
          status: 'collected',
          sourceStrategy: 'reference_only',
          reviewStatus: 'pending',
        }));
        added += 1;
      }
    }
    const workspacePrefix = path.resolve(project.workspacePath).toLocaleLowerCase('zh-CN');
    for (let index = 0; index < stagingItems.length; index += 1) {
      const item = stagingItems[index];
      const sourceKey = String(item.sourcePath || '').toLocaleLowerCase('zh-CN');
      if (sourceKey.startsWith(workspacePrefix) && !scannedPaths.has(sourceKey) && !item.promotedAssetId) {
        stagingItems[index] = normalizeProjectStagingItem({ ...item, status: 'discarded', governanceAction: '来源已移除', governanceReason: '工作空间扫描未发现原文件，请核对是否移动或删除。', governanceReviewedAt: new Date().toISOString() });
        missing += 1;
      }
    }
    const now = new Date().toISOString();
    const nextProjects = readProjects().map(normalizeProject).map((item) => String(item.id) === String(projectId) ? { ...project, stagingItems, workspaceLastScannedAt: now, updatedAt: now } : item);
    writeProjects(nextProjects);
    const updatedProject = nextProjects.find((item) => String(item.id) === String(projectId));
    if (added > 0 && updatedProject.automation?.enabled && updatedProject.automation?.onWorkspaceChange) {
      updatedProject.digestState = writeProjectDigestState(updatedProject, { status: 'pending', message: `工作空间新增 ${added} 份资料，等待增量消化。`, triggerReason: 'workspace_change' });
      const projectIndex = nextProjects.findIndex((item) => String(item.id) === String(projectId));
      nextProjects[projectIndex] = normalizeProject(updatedProject);
      writeProjects(nextProjects);
    }
    writeProjectStagingIndex(updatedProject);
    return JSON.stringify({ ok: true, project: normalizeProject(updatedProject), projects: nextProjects.map(normalizeProject), scanned: files.length, added, updated: updatedCount, missing, message: `工作空间扫描完成：发现 ${files.length} 份文件，新增 ${added} 份候选资料，标记 ${missing} 份来源缺失。` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `扫描项目工作空间失败：${error.message}` });
  }
}

function reviewProjectStagingItems(projectId, itemIdsJson, decision, sourceStrategy, note) {
  try {
    const access = mutableProject(projectId, '审核暂存资料');
    if (access.error) return access.error;
    const ids = new Set(JSON.parse(itemIdsJson || '[]').map(String));
    if (!ids.size) return JSON.stringify({ ok: false, message: '请先选择要审核的资料。' });
    const allowedDecisions = new Set(['accepted', 'rejected', 'pending']);
    const allowedStrategies = new Set(['full_copy', 'reference_only', 'snapshot']);
    const nextDecision = allowedDecisions.has(decision) ? decision : 'pending';
    const nextStrategy = allowedStrategies.has(sourceStrategy) ? sourceStrategy : 'reference_only';
    const now = new Date().toISOString();
    const projects = readProjects().map(normalizeProject);
    let updated = null;
    const nextProjects = projects.map((project) => {
      if (String(project.id) !== String(projectId)) return project;
      updated = {
        ...project,
        stagingItems: (project.stagingItems || []).map((item) => ids.has(item.id) ? normalizeProjectStagingItem({
          ...item,
          reviewStatus: nextDecision,
          reviewNote: String(note || ''),
          reviewedAt: now,
          sourceStrategy: nextStrategy,
          status: nextDecision === 'accepted' && item.status === 'collected' ? 'selected' : nextDecision === 'rejected' ? 'discarded' : item.status,
        }) : item),
        updatedAt: now,
      };
      return updated;
    });
    writeProjects(nextProjects);
    writeProjectStagingIndex(updated);
    return JSON.stringify({ ok: true, project: normalizeProject(updated), projects: nextProjects.map(normalizeProject), message: `已审核 ${ids.size} 份资料，处理结果：${nextDecision}。` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `审核暂存资料失败：${error.message}` });
  }
}

function projectKnowledgeReviewPath(project) {
  return path.join(project.managerPath || projectPathsFor(project.name, project.projectRootPath, project).managerPath, 'knowledge-review.json');
}

function readProjectKnowledgeReview(project) {
  let saved = { records: [] };
  try {
    saved = JSON.parse(fs.readFileSync(projectKnowledgeReviewPath(project), 'utf8'));
  } catch {
    saved = { records: [] };
  }
  const savedMap = new Map((Array.isArray(saved.records) ? saved.records : []).map((record) => [String(record.path).toLocaleLowerCase('zh-CN'), record]));
  const categories = [
    ['concept', project.conceptPath],
    ['entity', project.entityPath],
    ['summary', project.summaryPath],
    ['qa', projectPathsFor(project.name, project.projectRootPath, project).qaPath],
    ['synthesis', projectPathsFor(project.name, project.projectRootPath, project).synthesisPath],
  ];
  const records = [];
  for (const [kind, dir] of categories) {
    for (const file of collectProjectRawFiles(dir).filter((item) => /\.(md|txt|json)$/i.test(item.filename))) {
      const current = savedMap.get(String(file.path).toLocaleLowerCase('zh-CN')) || {};
      records.push({
        id: String(current.id || `knowledge-${crypto.createHash('sha1').update(file.path).digest('hex').slice(0, 12)}`),
        kind,
        title: String(current.title || path.basename(file.filename, path.extname(file.filename))),
        path: file.path,
        sourceAssets: Array.isArray(current.sourceAssets) ? current.sourceAssets : project.assetIds || [],
        status: String(current.status || 'ai_generated'),
        confidence: String(current.confidence || 'medium'),
        model: String(current.model || ''),
        promptVersion: String(current.promptVersion || ''),
        reviewNote: String(current.reviewNote || ''),
        reviewedAt: String(current.reviewedAt || ''),
        generatedAt: String(current.generatedAt || new Date(file.mtimeMs).toISOString()),
        size: file.size,
      });
    }
  }
  return { version: 1, projectId: project.id, updatedAt: new Date().toISOString(), records };
}

function getProjectKnowledgeReview(projectId) {
  try {
    const project = readProjects().map(normalizeProject).find((item) => String(item.id) === String(projectId));
    if (!project) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    const review = readProjectKnowledgeReview(project);
    if (project.status !== 'sealed') {
      fs.mkdirSync(project.managerPath, { recursive: true });
      fs.writeFileSync(projectKnowledgeReviewPath(project), JSON.stringify(review, null, 2), 'utf8');
    }
    return JSON.stringify({ ok: true, ...review, message: `已读取 ${review.records.length} 条项目知识资产。` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `读取知识资产审核失败：${error.message}` });
  }
}

function updateProjectKnowledgeReview(projectId, recordIdsJson, status, note) {
  try {
    const access = mutableProject(projectId, '审核知识资产');
    if (access.error) return access.error;
    const ids = new Set(JSON.parse(recordIdsJson || '[]').map(String));
    if (!ids.size) return JSON.stringify({ ok: false, message: '请先选择知识资产。' });
    const allowed = new Set(['ai_generated', 'pending_review', 'verified', 'published', 'rejected', 'invalid']);
    if (!allowed.has(String(status))) return JSON.stringify({ ok: false, message: '无效的知识审核状态。' });
    const review = readProjectKnowledgeReview(access.project);
    const now = new Date().toISOString();
    review.records = review.records.map((record) => ids.has(record.id) ? { ...record, status, reviewNote: String(note || ''), reviewedAt: now } : record);
    review.updatedAt = now;
    fs.mkdirSync(access.project.managerPath, { recursive: true });
    fs.writeFileSync(projectKnowledgeReviewPath(access.project), JSON.stringify(review, null, 2), 'utf8');
    return JSON.stringify({ ok: true, ...review, message: `已更新 ${ids.size} 条知识资产的审核状态。` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `更新知识资产审核失败：${error.message}` });
  }
}

const KNOWLEDGE_CANONICAL_ALIASES = new Map([
  ['experimental design', '实验设计'], ['experiment design', '实验设计'], ['实验方法设计', '实验设计'],
  ['data analysis', '数据分析'], ['data processing', '数据分析'], ['数据处理', '数据分析'],
  ['critical thinking', '批判性思维'], ['research ability', '研究能力'], ['research skills', '研究能力'],
  ['teamwork', '团队协作'], ['collaboration', '团队协作'], ['communication', '沟通表达'],
]);

function canonicalKnowledgeName(value) {
  const cleaned = String(value || '').trim().toLocaleLowerCase('zh-CN').replace(/[\s_\-/\\]+/g, ' ').replace(/[()（）【】\[\]：:，,。.]/g, '').trim();
  return KNOWLEDGE_CANONICAL_ALIASES.get(cleaned) || cleaned.replace(/(能力|技能|概念|方法)$/g, '').trim();
}

function knowledgeNameSimilarity(left, right) {
  if (left === right) return 1;
  if (!left || !right) return 0;
  if (left.includes(right) || right.includes(left)) return Math.min(left.length, right.length) / Math.max(left.length, right.length);
  const a = new Set(left.split(/\s+/).filter(Boolean));
  const b = new Set(right.split(/\s+/).filter(Boolean));
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / Math.max(1, new Set([...a, ...b]).size);
}

function buildCrossProjectKnowledgeIndex() {
  try {
    const projects = readProjects().map(normalizeProject);
    const groups = new Map();
    for (const project of projects) {
      const review = readProjectKnowledgeReview(project);
      for (const record of review.records.filter((item) => ['concept', 'entity'].includes(item.kind) && !['rejected', 'invalid'].includes(item.status))) {
        const canonical = canonicalKnowledgeName(record.title);
        if (!canonical) continue;
        const key = `${record.kind}:${canonical}`;
        const current = groups.get(key) || { id: key, kind: record.kind, canonicalName: record.title, projects: [], records: [] };
        if (!current.projects.some((item) => item.projectId === project.id)) current.projects.push({ projectId: project.id, projectName: project.name });
        current.records.push({ projectId: project.id, recordId: record.id, title: record.title, path: record.path, status: record.status });
        groups.set(key, current);
      }
      for (const evidence of project.studentEvidence || []) {
        const canonical = canonicalKnowledgeName(evidence.ability);
        if (!canonical) continue;
        const key = `ability:${canonical}`;
        const current = groups.get(key) || { id: key, kind: 'ability', canonicalName: evidence.ability, projects: [], records: [] };
        if (!current.projects.some((item) => item.projectId === project.id)) current.projects.push({ projectId: project.id, projectName: project.name });
        current.records.push({ projectId: project.id, studentId: evidence.studentId, title: evidence.ability, status: evidence.status, observation: evidence.observation });
        groups.set(key, current);
      }
    }
    const candidates = Array.from(groups.values());
    for (let index = 0; index < candidates.length; index += 1) {
      const target = candidates[index];
      if (!target) continue;
      for (let otherIndex = index + 1; otherIndex < candidates.length; otherIndex += 1) {
        const other = candidates[otherIndex];
        if (!other || other.kind !== target.kind) continue;
        const similarity = knowledgeNameSimilarity(canonicalKnowledgeName(target.canonicalName), canonicalKnowledgeName(other.canonicalName));
        if (similarity < 0.72) continue;
        target.projects = [...new Map([...target.projects, ...other.projects].map((item) => [item.projectId, item])).values()];
        target.records.push(...other.records.map((record) => ({ ...record, normalizationConfidence: similarity })));
        target.aliases = Array.from(new Set([...(target.aliases || []), other.canonicalName]));
        candidates[otherIndex] = null;
      }
    }
    const linkedGroups = candidates.filter(Boolean).filter((group) => group.projects.length > 1).sort((a, b) => b.projects.length - a.projects.length || a.canonicalName.localeCompare(b.canonicalName));
    const outputDir = path.join(projectsBaseDir(), '_跨项目知识关联');
    fs.mkdirSync(outputDir, { recursive: true });
    const payload = { version: 1, generatedAt: new Date().toISOString(), totalGroups: groups.size, linkedGroups };
    fs.writeFileSync(path.join(outputDir, 'cross-project-index.json'), JSON.stringify(payload, null, 2), 'utf8');
    const rows = linkedGroups.map((group) => `| ${group.kind} | ${String(group.canonicalName).replace(/\|/g, '/')} | ${group.projects.map((item) => item.projectName).join('、')} | ${group.records.length} |`).join('\n') || '| 暂无 | - | - | 0 |';
    fs.writeFileSync(path.join(outputDir, '跨项目知识关联.md'), `# 跨项目知识关联\n\n> 统一识别多个学习项目中重复出现的概念、实体与能力证据。原知识文件保持不变，本索引只建立关联。\n\n| 类型 | 统一名称 | 关联项目 | 记录数 |\n| --- | --- | --- | ---: |\n${rows}\n`, 'utf8');
    return JSON.stringify({ ok: true, ...payload, outputDir, message: `已生成跨项目知识关联：${linkedGroups.length} 个跨项目主题。` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `生成跨项目知识关联失败：${error.message}` });
  }
}

function updateProjectAutomation(projectId, automationJson) {
  try {
    const access = mutableProject(projectId, '更新项目自动化');
    if (access.error) return access.error;
    const input = JSON.parse(automationJson || '{}');
    const now = Date.now();
    const intervalMinutes = Math.max(15, Math.min(10080, Number(input.intervalMinutes || 1440)));
    const result = updateProjectRecord(projectId, (project) => ({
      ...project,
      automation: {
        enabled: Boolean(input.enabled),
        onWorkspaceChange: input.onWorkspaceChange !== false,
        onStatusChange: Boolean(input.onStatusChange),
        intervalMinutes,
        nextRunAt: input.enabled ? new Date(now + intervalMinutes * 60000).toISOString() : '',
        lastRunAt: project.automation?.lastRunAt || '',
        lastReason: project.automation?.lastReason || '',
      },
      updatedAt: new Date().toISOString(),
    }));
    return JSON.stringify({ ok: true, project: result.project, projects: result.projects, message: input.enabled ? `项目自动化已启用，每 ${intervalMinutes} 分钟检查一次。` : '项目自动化已关闭。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `更新项目自动化失败：${error.message}` });
  }
}

function runProjectAutomationSweep() {
  const now = Date.now();
  const dueProjects = readProjects().map(normalizeProject).filter((project) => project.status !== 'sealed' && project.automation?.enabled && (!project.automation.nextRunAt || Date.parse(project.automation.nextRunAt) <= now));
  const results = [];
  for (const project of dueProjects) {
    let scanResult = { ok: false, added: 0, message: '' };
    try {
      scanResult = JSON.parse(scanProjectWorkspace(project.id));
    } catch {
      scanResult = { ok: false, added: 0, message: '自动扫描结果解析失败。' };
    }
    let execution = { ok: false, message: '无待消化资料。' };
    const scannedProject = readProjects().map(normalizeProject).find((item) => String(item.id) === String(project.id));
    if (scannedProject?.digestState?.pendingCount > 0 && scannedProject.digestState.status !== 'digesting') {
      try { execution = JSON.parse(executeProjectDigest(project.id)); } catch { execution = { ok: false, message: '自动执行结果解析失败。' }; }
    }
    const refreshed = readProjects().map(normalizeProject);
    const intervalMinutes = project.automation.intervalMinutes || 1440;
    const nextProjects = refreshed.map((item) => String(item.id) === String(project.id) ? normalizeProject({
      ...item,
      automation: { ...item.automation, lastRunAt: new Date().toISOString(), lastReason: 'scheduled', nextRunAt: new Date(now + intervalMinutes * 60000).toISOString() },
    }) : item);
    writeProjects(nextProjects);
    results.push({ projectId: project.id, ok: Boolean(scanResult.ok), added: Number(scanResult.added || 0), executionOk: Boolean(execution.ok), message: `${scanResult.message || ''} ${execution.message || ''}`.trim() });
  }
  return results;
}

function updateProjectStudents(projectId, studentIdsJson) {
  try {
    const access = mutableProject(projectId, '调整绑定学生');
    if (access.error) return access.error;
    const parsed = JSON.parse(studentIdsJson || '[]');
    const requestedIds = Array.isArray(parsed) ? parsed.map(String) : [];
    const allStudents = readStudentsIndex();
    const validIds = new Set(allStudents.map((student) => String(student.id)));
    const studentIds = mergeUnique(requestedIds.filter((id) => validIds.has(id)));
    const selectedStudents = allStudents.filter((student) => studentIds.includes(String(student.id)));
    const now = new Date().toISOString();
    const projects = readProjects().map(normalizeProject);
    let updated = null;
    const nextProjects = projects.map((project) => {
      if (String(project.id) !== String(projectId)) return project;
      updated = {
        ...project,
        studentIds,
        studentNames: selectedStudents.map((student) => student.name),
        updatedAt: now,
      };
      return updated;
    });
    if (!updated) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    writeProjects(nextProjects);
    ensureProjectWorkspace(updated);
    writeProjectBindingIndex(updated);
    appendHostTimeline({
      type: 'project_students_updated',
      title: 'Project students updated',
      detail: `${updated.name} -> ${updated.studentNames.join('、') || '未绑定学生'}`,
      count: updated.studentIds.length,
    });
    return JSON.stringify({
      ok: true,
      project: normalizeProject(updated),
      projects: readProjects().map(normalizeProject),
      message: `项目绑定学生已更新：${updated.studentNames.join('、') || '未绑定学生'}`,
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `更新项目绑定学生失败：${error.message}` });
  }
}

function importProjectAssets(projectId, assetIdsJson) {
  try {
    const access = mutableProject(projectId, '导入项目资产');
    if (access.error) return access.error;
    const project = readProjects().map(normalizeProject).find((item) => String(item.id) === String(projectId));
    if (!project) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    const assetIds = JSON.parse(assetIdsJson || '[]');
    if (!Array.isArray(assetIds) || !assetIds.length) return JSON.stringify({ ok: false, message: '请先选择要导入项目知识空间的资产。' });
    const ensured = ensureProjectWorkspace(project);
    const assets = readAssetIndex();
    const imported = [];
    const skipped = [];
    for (const assetId of assetIds.map(String)) {
      const asset = assets.find((item) => String(item.assetId) === assetId);
      if (!asset || !asset.path || !fs.existsSync(asset.path)) {
        skipped.push(assetId);
        continue;
      }
      const target = uniqueTargetFile(ensured.rawPath, asset.filename || path.basename(asset.path));
      fs.copyFileSync(asset.path, target);
      const linked = upsertAssetFromFile(target, {
        spaceType: 'project',
        projectId: project.id,
        projectName: project.name,
        sourcePath: asset.path,
        sourceName: '资产中心',
        role: 'project_raw',
        referenceId: `${project.id}-${asset.assetId}`,
      });
      if (linked) imported.push(linked.assetId);
    }
    const projects = readProjects().map(normalizeProject);
    const nextProjects = projects.map((item) => String(item.id) === String(project.id)
      ? { ...item, assetIds: mergeUnique([...(item.assetIds || []), ...assetIds.map(String)]), updatedAt: new Date().toISOString() }
      : item);
    writeProjects(nextProjects);
    appendHostTimeline({ type: 'project_assets_imported', title: 'Project assets imported', detail: project.name, count: imported.length });
    return JSON.stringify({
      ok: imported.length > 0,
      imported: imported.length,
      skipped: skipped.length,
      project: nextProjects.find((item) => String(item.id) === String(project.id)),
      message: imported.length ? `已导入 ${imported.length} 个资产到项目原始资料库。` : '没有资产被导入。',
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `导入项目资料失败：${error.message}` });
  }
}

function importProjectRawFiles(projectId) {
  try {
    const access = mutableProject(projectId, '导入项目原始资料');
    if (access.error) return access.error;
    const project = readProjects().map(normalizeProject).find((item) => String(item.id) === String(projectId));
    if (!project) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    const ensured = ensureProjectWorkspace(project);
    const files = dialog.showOpenDialogSync(mainWindow, {
      title: '导入到项目原始资料库',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '学习资料', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'txt', 'md', 'zip'] },
        { name: '全部文件', extensions: ['*'] },
      ],
    });
    if (!files || !files.length) return JSON.stringify({ ok: false, message: '未选择项目资料。' });
    const imported = [];
    const skipped = [];
    for (const source of files) {
      if (!source || !fs.existsSync(source)) {
        skipped.push(source || '');
        continue;
      }
      const stat = fs.statSync(source);
      if (!stat.isFile()) {
        skipped.push(source);
        continue;
      }
      const target = uniqueTargetFile(ensured.rawPath, path.basename(source));
      fs.copyFileSync(source, target);
      const asset = upsertAssetFromFile(target, {
        spaceType: 'project',
        projectId: ensured.id,
        projectName: ensured.name,
        sourcePath: source,
        sourceName: '项目直接导入',
        role: 'project_raw_direct',
        referenceId: `${ensured.id}-direct-${sha1File(target) || crypto.randomBytes(4).toString('hex')}`,
      });
      if (asset) imported.push(asset.assetId);
    }
    if (!imported.length) return JSON.stringify({ ok: false, skipped: skipped.length, message: '没有项目资料被导入。' });
    const now = new Date().toISOString();
    const digestState = writeProjectDigestState(ensured, {
      status: 'pending',
      message: `有 ${imported.length} 份新项目资料待消化。`,
    });
    let result = updateProjectRecord(ensured.id, (item) => ({
      ...item,
      assetIds: mergeUnique([...(item.assetIds || []), ...imported]),
      digestState,
      updatedAt: now,
    }));
    appendHostTimeline({ type: 'project_raw_imported', title: 'Project raw files imported', detail: ensured.name, count: imported.length });
    return JSON.stringify({
      ok: true,
      imported: imported.length,
      skipped: skipped.length,
      project: result.project,
      projects: result.projects,
      digestState,
      message: `已导入 ${imported.length} 份资料到项目原始资料库，并标记为待消化。请复制命令后粘贴到所选 Agent。`,
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `导入项目原始资料失败：${error.message}` });
  }
}

function getProjectDigestCommand(projectId) {
  try {
    const project = readProjects().map(normalizeProject).find((item) => String(item.id) === String(projectId));
    if (!project) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    const ensured = ensureProjectWorkspace(project);
    const state = readProjectDigestState(ensured);
    const agentToolNames = { qclaw: 'QClaw', marvis: 'Marvis', hohu: 'Hohu', 'ima.copilot': 'IMA Copilot', workbuddy: 'WorkBuddy', codex: 'Codex', claude: 'Claude Code', gemini: 'Gemini CLI' };
    const agentToolName = agentToolNames[ensured.agentTool] || ensured.agentTool || '所选 Agent';
    const command = `/消化项目资料

请围绕学习项目「${ensured.name}」执行项目资料消化。

项目原始资料库：
${ensured.rawPath}

项目知识空间：
${ensured.knowledgeRootPath}

请更新以下目录：
- 摘要库：${ensured.summaryPath}
- 概念库：${projectPathsFor(ensured.name, ensured.projectRootPath).conceptPath}
- 实体库：${projectPathsFor(ensured.name, ensured.projectRootPath).entityPath}
- 问答精华库：${projectPathsFor(ensured.name, ensured.projectRootPath).qaPath}
- 综合汇总库：${path.join(ensured.knowledgeRootPath, '综合汇总库')}
- 项目报告：${path.join(ensured.knowledgeRootPath, '项目报告')}

工作规则：
1. 只处理本项目资料，不要直接写入学生主档案。
2. 所有摘要、概念、实体、问答和综合结论都要保留来源文件名或路径。
3. 完成后更新项目 index.md 和 log.md。
4. 完成后写入以下状态文件，便于控制台同步：
${state.digestFile}

状态文件 JSON 格式：
{
  "version": 2,
  "status": "completed",
  "digestBatchId": "${state.digestBatchId || '请保留控制台提交批次 ID'}",
  "lastDigestAt": "当前 ISO 时间",
  "message": "项目资料已消化完成",
  "digestedFiles": [{"relativePath":"相对项目原始资料库的路径","sha1":"对应待处理清单中的 SHA-1"}]
}

待消化资料：
${(state.pendingFiles || []).map((file) => `- ${file.relativePath || file.filename} | ${file.changeType || 'added'} | SHA-1 ${file.sha1} | ${file.path}`).join('\n') || '- 暂无待消化资料，请检查项目原始资料库。'}
`;
    return JSON.stringify({ ok: true, command, digestState: state, agentTool: ensured.agentTool, message: `已生成消化指令，请粘贴到 ${agentToolName}。` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `生成项目资料消化指令失败：${error.message}` });
  }
}

function executeProjectDigest(projectId) {
  try {
    const access = mutableProject(projectId, '执行项目资料消化');
    if (access.error) return access.error;
    const project = ensureProjectWorkspace(access.project);
    const current = readProjectDigestState(project);
    if (current.status === 'digesting') return JSON.stringify({ ok: false, message: '该项目正在执行消化，请勿重复提交。' });
    upsertTaskCandidates(buildTaskCenterCandidates());
    const taskId = taskStableId('project_digest', 'project', project.id);
    const result = JSON.parse(executeTaskByAdapter(taskId, project.agentTool || ''));
    if (!result.ok) return JSON.stringify(result);
    const stateStatus = result.task?.status === 'running' ? 'digesting' : result.task?.status === 'waiting_result' ? 'submitted' : current.status;
    const dispatchedDigest = readProjectDigestState(project);
    const state = writeProjectDigestState(project, {
      status: stateStatus,
      digestSubmittedAt: result.task?.startedAt || taskNow(),
      digestBatchId: dispatchedDigest.digestBatchId || current.digestBatchId || '',
      message: result.message || '项目资料消化已交由 AgentExecutionAdapter 处理。',
    });
    updateProjectRecord(projectId, (item) => ({ ...item, digestState: state, updatedAt: taskNow() }));
    appendHostTimeline({ type: 'project_digest_dispatched', title: 'Project digest dispatched', detail: `${project.name} -> ${result.task?.adapterId || 'manual'}` });
    return JSON.stringify({ ...result, project: { ...project, digestState: state }, projects: readProjects().map(normalizeProject), digestState: state, message: `${result.message} 项目消化已解除 Codex 硬编码。` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `执行项目消化失败：${error.message}` });
  }
}

function markProjectDigestSubmitted(projectId) {
  try {
    const access = mutableProject(projectId, '提交项目资料消化');
    if (access.error) return access.error;
    const project = readProjects().map(normalizeProject).find((item) => String(item.id) === String(projectId));
    if (!project) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    const ensured = ensureProjectWorkspace(project);
    const now = new Date().toISOString();
    const current = readProjectDigestState(ensured);
    if (!current.pendingCount) return JSON.stringify({ ok: false, message: '当前没有待消化资料，无需重复提交。' });
    if (['submitted', 'digesting'].includes(current.status)) return JSON.stringify({ ok: false, message: `批次 ${current.digestBatchId || ''} 已提交，请先同步结果。` });
    const batchId = `project-digest-${timestampForFilename()}`;
    const state = writeProjectDigestState(ensured, {
      status: 'submitted',
      digestSubmittedAt: now,
      digestBatchId: batchId,
      submittedFiles: (current.pendingFiles || []).map((file) => ({ relativePath: file.relativePath, path: file.path, sha1: file.sha1, size: file.size })),
      message: '项目资料消化指令已提交给 Agent，等待完成后同步。',
    });
    const result = updateProjectRecord(ensured.id, (item) => ({ ...item, digestState: state, updatedAt: now }));
    appendHostTimeline({ type: 'project_digest_submitted', title: 'Project digest submitted', detail: ensured.name, count: state.pendingCount || 0 });
    return JSON.stringify({ ok: true, project: result.project, projects: result.projects, digestState: state, message: state.message });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `标记项目消化提交失败：${error.message}` });
  }
}

function syncProjectDigestResult(projectId) {
  try {
    const access = mutableProject(projectId, '同步项目消化结果');
    if (access.error) return access.error;
    const project = readProjects().map(normalizeProject).find((item) => String(item.id) === String(projectId));
    if (!project) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    const ensured = ensureProjectWorkspace(project);
    const paths = projectPathsFor(ensured.name, ensured.projectRootPath, ensured);
    const current = readProjectDigestState(ensured);
    const rawFiles = collectProjectRawFiles(paths.rawPath);
    const diskState = safeReadJson(projectDigestStatePath(ensured), {});
    const hasCompletionSignal = diskState.status === 'completed'
      && (!current.digestBatchId || !diskState.digestBatchId || diskState.digestBatchId === current.digestBatchId);
    let nextPatch = {};
    if (hasCompletionSignal) {
      const explicit = Array.isArray(diskState.digestedFiles) ? diskState.digestedFiles : [];
      const submitted = Array.isArray(current.submittedFiles) ? current.submittedFiles : [];
      const confirmations = explicit.length ? explicit : submitted;
      const confirmedKeys = new Set(confirmations.flatMap((item) => typeof item === 'string'
        ? [item]
        : [item.relativePath, item.path, item.sha1].filter(Boolean)).map(String));
      const confirmed = rawFiles.filter((file) => confirmedKeys.has(file.relativePath) || confirmedKeys.has(file.path) || confirmedKeys.has(file.sha1));
      if (!confirmed.length) return JSON.stringify({ ok: false, message: 'Agent 已写完成状态，但未提供与当前批次匹配的 digestedFiles，未更新消化清单。' });
      const completedAt = new Date().toISOString();
      const digestManifest = { ...(current.digestManifest || {}) };
      for (const file of confirmed) {
        digestManifest[file.relativePath] = { sha1: file.sha1, size: file.size, mtimeMs: file.mtimeMs, digestedAt: completedAt, batchId: current.digestBatchId || '' };
      }
      nextPatch = {
        status: 'completed',
        lastDigestAt: completedAt,
        message: `已同步 ${confirmed.length} 份资料的精确消化结果。`,
        digestedFiles: confirmed.map((file) => file.path),
        digestManifest,
        submittedFiles: [],
        digestBatches: [...(current.digestBatches || []), {
          id: current.digestBatchId || `digest-${Date.now()}`,
          submittedAt: current.digestSubmittedAt || '',
          completedAt,
          files: confirmed.map((file) => ({ relativePath: file.relativePath, sha1: file.sha1 })),
        }].slice(-50),
      };
    } else if (current.status === 'submitted' || current.status === 'digesting') {
      nextPatch = {
        status: 'digesting',
        message: '尚未检测到完成标记；请确认 Agent 已更新 log.md 或 project-digest-state.json。',
      };
    } else if (current.pendingCount > 0) {
      nextPatch = {
        status: 'pending',
        message: `仍有 ${current.pendingCount} 份项目资料待消化。`,
      };
    } else {
      nextPatch = {
        status: 'idle',
        message: '暂无待消化项目资料。',
      };
    }
    const state = writeProjectDigestState(ensured, nextPatch);
    const result = updateProjectRecord(ensured.id, (item) => ({ ...item, digestState: state, updatedAt: new Date().toISOString() }));
    appendHostTimeline({ type: 'project_digest_synced', title: 'Project digest synced', detail: `${ensured.name} -> ${state.status}`, count: state.pendingCount || 0 });
    return JSON.stringify({ ok: true, project: result.project, projects: result.projects, digestState: state, message: state.message });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `同步项目消化结果失败：${error.message}` });
  }
}

function updateProjectRecord(projectId, updater) {
  const projects = readProjects().map(normalizeProject);
  let updated = null;
  const nextProjects = projects.map((project) => {
    if (String(project.id) !== String(projectId)) return project;
    updated = normalizeProject(updater(project));
    return updated;
  });
  if (!updated) return { projects, project: null };
  writeProjects(nextProjects);
  writeProjectStagingIndex(updated);
  return { projects: nextProjects, project: updated };
}

function importProjectStagingFiles(projectId) {
  try {
    const access = mutableProject(projectId, '导入研究暂存资料');
    if (access.error) return access.error;
    const project = access.project;
    const ensured = ensureProjectWorkspace(project);
    const files = dialog.showOpenDialogSync(mainWindow, {
      title: '导入到项目研究暂存',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '学习资料', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'txt', 'md', 'zip'] },
        { name: '全部文件', extensions: ['*'] },
      ],
    });
    if (!files || !files.length) return JSON.stringify({ ok: false, message: '未选择暂存资料。' });
    const now = new Date().toISOString();
    const imported = [];
    for (const source of files) {
      if (!source || !fs.existsSync(source)) continue;
      const stat = fs.statSync(source);
      if (!stat.isFile()) continue;
      const target = uniqueTargetFile(ensured.stagingPath, path.basename(source));
      fs.copyFileSync(source, target);
      const sha1 = sha1File(target);
      imported.push(normalizeProjectStagingItem({
        id: `staging-${(sha1 || crypto.createHash('sha1').update(`${source}|${target}|${now}`).digest('hex')).slice(0, 12)}-${crypto.randomBytes(3).toString('hex')}`,
        filename: path.basename(target),
        path: target,
        size: stat.size,
        type: materialTypeForFile(target),
        sha1,
        status: 'collected',
        sourceStrategy: 'full_copy',
        sourcePath: source,
        addedAt: now,
        updatedAt: now,
      }));
    }
    if (!imported.length) return JSON.stringify({ ok: false, message: '没有资料被导入暂存层。' });
    const result = updateProjectRecord(project.id, (item) => ({
      ...item,
      stagingItems: [...(item.stagingItems || []), ...imported],
      updatedAt: now,
    }));
    appendHostTimeline({ type: 'project_staging_imported', title: 'Project staging imported', detail: project.name, count: imported.length });
    return JSON.stringify({
      ok: true,
      imported: imported.length,
      project: result.project,
      projects: result.projects,
      message: `已导入 ${imported.length} 份资料到研究暂存层，暂未进入正式资产中心。`,
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `导入研究暂存失败：${error.message}` });
  }
}

function updateProjectStagingStatus(projectId, itemIdsJson, status) {
  try {
    const access = mutableProject(projectId, '更新暂存资料状态');
    if (access.error) return access.error;
    const allowed = new Set(['collected', 'screened', 'selected', 'analyzed', 'promoted', 'discarded']);
    const nextStatus = allowed.has(String(status || '')) ? String(status) : 'collected';
    const itemIds = JSON.parse(itemIdsJson || '[]');
    if (!Array.isArray(itemIds) || !itemIds.length) return JSON.stringify({ ok: false, message: '请先选择暂存资料。' });
    const now = new Date().toISOString();
    const result = updateProjectRecord(projectId, (project) => ({
      ...project,
      stagingItems: (project.stagingItems || []).map((item) => itemIds.includes(item.id)
        ? { ...item, status: nextStatus, updatedAt: now }
        : item),
      updatedAt: now,
    }));
    if (!result.project) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    appendHostTimeline({ type: 'project_staging_status_updated', title: 'Project staging status updated', detail: `${result.project.name} -> ${nextStatus}`, count: itemIds.length });
    return JSON.stringify({
      ok: true,
      updated: itemIds.length,
      project: result.project,
      projects: result.projects,
      message: `已将 ${itemIds.length} 份暂存资料标记为：${projectStagingStatusLabel(nextStatus)}。`,
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `更新暂存资料状态失败：${error.message}` });
  }
}

function promoteProjectStagingItems(projectId, itemIdsJson) {
  try {
    const access = mutableProject(projectId, '晋升暂存资料');
    if (access.error) return access.error;
    const itemIds = JSON.parse(itemIdsJson || '[]');
    if (!Array.isArray(itemIds) || !itemIds.length) return JSON.stringify({ ok: false, message: '请先选择要晋升的暂存资料。' });
    const project = access.project;
    const ensured = ensureProjectWorkspace(project);
    const now = new Date().toISOString();
    const promoted = [];
    const skipped = [];
    const nextItems = (ensured.stagingItems || []).map((item) => {
      if (!itemIds.includes(item.id)) return item;
      if (!item.path || !fs.existsSync(item.path)) {
        skipped.push(item.id);
        return item;
      }
      if (item.reviewStatus !== 'accepted') {
        skipped.push(item.id);
        return item;
      }
      const strategy = ['full_copy', 'reference_only', 'snapshot'].includes(item.sourceStrategy) ? item.sourceStrategy : 'reference_only';
      let assetPath = item.path;
      if (strategy !== 'reference_only') {
        assetPath = uniqueTargetFile(ensured.rawPath, item.filename || path.basename(item.path));
        fs.copyFileSync(item.path, assetPath);
      }
      const asset = upsertAssetFromFile(assetPath, {
        spaceType: 'project',
        projectId: ensured.id,
        projectName: ensured.name,
        sourcePath: item.path,
        sourceName: strategy === 'reference_only' ? '项目来源引用' : strategy === 'snapshot' ? '项目关键快照' : '研究暂存晋升',
        role: strategy === 'reference_only' ? 'project_source_reference' : strategy === 'snapshot' ? 'project_source_snapshot' : 'project_raw_promoted',
        referenceId: `${ensured.id}-${item.id}`,
      });
      if (strategy === 'reference_only') {
        const baseName = sanitizeName(path.basename(item.filename || item.path, path.extname(item.filename || item.path)));
        const sourceRecordPath = path.join(ensured.rawPath, `来源记录-${baseName}-${item.id}.md`);
        fs.writeFileSync(sourceRecordPath, `# ${item.filename || path.basename(item.path)}\n\n- 保存策略：仅来源记录\n- 来源路径：${item.sourcePath || item.path}\n- 文件资产：${asset?.assetId || '待登记'}\n- SHA-1：${item.sha1 || ''}\n- 人工审核：${item.reviewNote || '已接受'}\n- 登记时间：${now}\n`, 'utf8');
      }
      if (asset) promoted.push(asset.assetId);
      return {
        ...item,
        status: 'promoted',
        promotedAssetId: asset?.assetId || item.promotedAssetId || '',
        promotedAt: now,
        updatedAt: now,
      };
    });
    const pendingDigestState = promoted.length > 0
      ? writeProjectDigestState(ensured, {
        status: 'pending',
        message: `有 ${promoted.length} 份新晋升项目资料待消化。`,
        triggerReason: 'staging_promotion',
      })
      : ensured.digestState;
    let result = updateProjectRecord(ensured.id, (item) => ({
      ...item,
      stagingItems: nextItems,
      assetIds: mergeUnique([...(item.assetIds || []), ...promoted]),
      digestState: pendingDigestState,
      updatedAt: now,
    }));
    appendHostTimeline({ type: 'project_staging_promoted', title: 'Project staging promoted', detail: ensured.name, count: promoted.length });
    return JSON.stringify({
      ok: promoted.length > 0,
      promoted: promoted.length,
      skipped: skipped.length,
      project: result.project,
      projects: result.projects,
      message: promoted.length
        ? `已按保存策略晋升 ${promoted.length} 份暂存资料为正式资产，并进入项目原始资料库和待消化队列。请复制命令后粘贴到所选 Agent。`
        : '没有暂存资料被晋升；请先完成人工接受并选择保存策略。',
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `晋升暂存资料失败：${error.message}` });
  }
}

function parseAiScreeningJson(content) {
  const repairJsonBackslashes = (value) => String(value || '').replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
  const normalized = String(content || '')
    .replace(/^\uFEFF/, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
  const fenced = normalized.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : normalized;
  const firstObject = candidate.indexOf('{');
  const lastObject = candidate.lastIndexOf('}');
  const firstArray = candidate.indexOf('[');
  const lastArray = candidate.lastIndexOf(']');
  const objectJson = firstObject >= 0 && lastObject > firstObject ? candidate.slice(firstObject, lastObject + 1) : '';
  const arrayJson = firstArray >= 0 && lastArray > firstArray ? candidate.slice(firstArray, lastArray + 1) : '';
  const rawAttempts = [candidate.trim(), objectJson.trim(), arrayJson.trim()].filter(Boolean);
  const attempts = [...rawAttempts, ...rawAttempts.map(repairJsonBackslashes)];
  let lastError = null;
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('未找到 JSON 内容');
}

function normalizeAiScreeningStatus(value) {
  const text = String(value || '').trim().toLowerCase();
  if (['promote', 'promotion', 'promoted', '晋升', '建议晋升', '正式资产'].includes(text)) return 'selected';
  if (['select', 'selected', 'analysis', 'analyze', '分析', '选入分析', '采用'].includes(text)) return 'selected';
  if (['screen', 'screened', '初筛', '已初筛', '候选'].includes(text)) return 'screened';
  if (['analyzed', '分析完成', '已分析'].includes(text)) return 'analyzed';
  if (['discard', 'discarded', 'skip', 'ignore', '丢弃', '跳过', '忽略', '低价值'].includes(text)) return 'discarded';
  if (['collect', 'collected', '收集', '已收集'].includes(text)) return 'collected';
  return '';
}

function normalizeAiScreeningAction(value, fallbackStatus) {
  const text = String(value || '').trim();
  const lower = text.toLowerCase();
  if (['select', 'selected', 'promote', 'promotion', 'promoted'].includes(lower)) return '建议选入分析';
  if (['screen', 'screened'].includes(lower)) return '建议保留候选';
  if (['discard', 'discarded', 'skip', 'ignore'].includes(lower)) return '建议丢弃/归档';
  if (['analyzed', 'analysis'].includes(lower)) return '已分析';
  if (text) return text;
  if (fallbackStatus === 'selected') return '建议选入分析';
  if (fallbackStatus === 'discarded') return '建议丢弃/归档';
  if (fallbackStatus === 'screened') return '建议保留候选';
  if (fallbackStatus === 'analyzed') return '已分析';
  return '';
}

function screeningRecommendationsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.recommendations)) return payload.recommendations;
  if (Array.isArray(payload.candidates)) return payload.candidates;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.results)) return payload.results;
  return [];
}

function importProjectStagingAiScreening(projectId) {
  try {
    const access = mutableProject(projectId, '导入 AI 初筛结果');
    if (access.error) return access.error;
    const project = readProjects().map(normalizeProject).find((item) => String(item.id) === String(projectId));
    if (!project) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    const ensured = ensureProjectWorkspace(project);
    const files = dialog.showOpenDialogSync(mainWindow, {
      title: '导入 AI 初筛结果',
      properties: ['openFile'],
      filters: [
        { name: 'AI 初筛结果', extensions: ['json', 'txt', 'md'] },
        { name: '全部文件', extensions: ['*'] },
      ],
    });
    if (!files || !files[0]) return JSON.stringify({ ok: false, message: '未选择 AI 初筛结果文件。' });
    const raw = fs.readFileSync(files[0], 'utf8');
    const payload = parseAiScreeningJson(raw);
    const recommendations = screeningRecommendationsFromPayload(payload);
    if (!recommendations.length) return JSON.stringify({ ok: false, message: 'AI 初筛结果中没有 recommendations / candidates / items / results 数组。' });
    const now = new Date().toISOString();
    const byId = new Map();
    const bySha1 = new Map();
    const byFilename = new Map();
    const byPath = new Map();
    for (const rec of recommendations) {
      if (!rec || typeof rec !== 'object') continue;
      const keys = [
        rec.id,
        rec.itemId,
        rec.stagingId,
      ].filter(Boolean).map(String);
      keys.forEach((key) => byId.set(key, rec));
      if (rec.sha1) bySha1.set(String(rec.sha1), rec);
      if (rec.filename || rec.name) byFilename.set(String(rec.filename || rec.name).toLowerCase(), rec);
      if (rec.path || rec.sourcePath) {
        byPath.set(path.resolve(String(rec.path || rec.sourcePath)).toLowerCase(), rec);
        byPath.set(String(rec.path || rec.sourcePath).toLowerCase(), rec);
      }
    }
    let matched = 0;
    const nextItems = (ensured.stagingItems || []).map((item) => {
      const rec = byId.get(item.id)
        || (item.sha1 ? bySha1.get(item.sha1) : null)
        || byFilename.get(String(item.filename || '').toLowerCase())
        || byPath.get(path.resolve(String(item.path || '')).toLowerCase())
        || byPath.get(String(item.sourcePath || '').toLowerCase());
      if (!rec) return item;
      matched += 1;
      const status = normalizeAiScreeningStatus(rec.status || rec.action || rec.recommendation || rec.decision);
      const reasons = Array.isArray(rec.reasons) ? rec.reasons.join('；') : '';
      const reason = String(rec.reason || rec.aiReason || reasons || rec.preview || '').slice(0, 1000);
      const score = Number(rec.score);
      return {
        ...item,
        status: status || item.status,
        aiAction: normalizeAiScreeningAction(rec.action || rec.recommendation || rec.decision, status),
        aiReason: reason,
        aiScore: rec.score === undefined || rec.score === '' || !Number.isFinite(score) ? item.aiScore : score,
        aiReviewedAt: now,
        updatedAt: now,
      };
    });
    const result = updateProjectRecord(ensured.id, (item) => ({
      ...item,
      stagingItems: nextItems,
      updatedAt: now,
    }));
    fs.writeFileSync(path.join(ensured.stagingPath, `AI初筛结果-${now.slice(0, 10)}.json`), JSON.stringify(payload, null, 2), 'utf8');
    appendHostTimeline({ type: 'project_staging_ai_screening_imported', title: 'Project staging AI screening imported', detail: ensured.name, count: matched });
    return JSON.stringify({
      ok: matched > 0,
      matched,
      total: recommendations.length,
      project: result.project,
      projects: result.projects,
      message: matched > 0 ? `已导入 AI 初筛结果，匹配 ${matched}/${recommendations.length} 份暂存资料。` : 'AI 初筛结果没有匹配到当前项目的暂存资料。',
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `导入 AI 初筛结果失败：${error.message}` });
  }
}

function analyzeProjectStagingGovernance(projectId) {
  try {
    const access = mutableProject(projectId, '生成暂存治理建议');
    if (access.error) return access.error;
    const project = readProjects().map(normalizeProject).find((item) => String(item.id) === String(projectId));
    if (!project) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    const ensured = ensureProjectWorkspace(project);
    const now = new Date();
    const nowIso = now.toISOString();
    const items = (ensured.stagingItems || []).map(normalizeProjectStagingItem);
    const shaGroups = new Map();
    const nameSizeGroups = new Map();
    for (const item of items) {
      if (item.sha1) {
        const current = shaGroups.get(item.sha1) || [];
        current.push(item);
        shaGroups.set(item.sha1, current);
      }
      const nameSizeKey = `${String(item.filename || '').toLowerCase()}::${Number(item.size || 0)}`;
      if (item.filename && item.size) {
        const current = nameSizeGroups.get(nameSizeKey) || [];
        current.push(item);
        nameSizeGroups.set(nameSizeKey, current);
      }
    }

    const statusCounts = {};
    const nextItems = items.map((item) => {
      const addedMs = Date.parse(item.addedAt || '');
      const ageDays = Number.isFinite(addedMs) ? Math.max(0, Math.floor((now.getTime() - addedMs) / 86400000)) : 0;
      const nameSizeKey = `${String(item.filename || '').toLowerCase()}::${Number(item.size || 0)}`;
      const duplicateCount = Math.max(
        item.sha1 ? (shaGroups.get(item.sha1)?.length || 1) : 1,
        nameSizeGroups.get(nameSizeKey)?.length || 1,
      );
      statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
      let governanceAction = '保留观察';
      let governanceReason = '暂无明确治理动作，继续保留在研究暂存层。';
      if (item.status === 'promoted') {
        governanceAction = '已晋升，无需处理';
        governanceReason = '资料已经晋升为正式资产，暂存副本仅用于研究过程追溯。';
      } else if (item.status === 'discarded') {
        governanceAction = '建议归档清理';
        governanceReason = '资料已标记为归档/丢弃，可在项目结束后统一清理或转入低价值资料归档。';
      } else if (duplicateCount > 1 && !['selected', 'analyzed'].includes(item.status)) {
        governanceAction = '建议检查重复';
        governanceReason = `发现 ${duplicateCount} 份疑似重复资料；如内容一致，建议只保留一份候选。`;
      } else if (item.status === 'collected' && ageDays >= 30) {
        governanceAction = '建议复核';
        governanceReason = `已收集 ${ageDays} 天仍未初筛，建议复核是否仍需进入项目分析。`;
      } else if (item.status === 'screened' && ageDays >= 45) {
        governanceAction = '建议决定去留';
        governanceReason = `已初筛 ${ageDays} 天仍未选入分析，建议确认晋升、继续候选或归档。`;
      } else if (item.status === 'selected') {
        governanceAction = '建议分析或晋升';
        governanceReason = '资料已选入分析，可交给 Agent 消化，或在确认后晋升为正式资产。';
      } else if (item.status === 'analyzed') {
        governanceAction = '建议晋升';
        governanceReason = '资料已完成 AI 分析，如支撑项目结论，建议晋升为正式资产。';
      }
      return {
        ...item,
        duplicateCount,
        stagingAgeDays: ageDays,
        governanceAction,
        governanceReason,
        governanceReviewedAt: nowIso,
        updatedAt: nowIso,
      };
    });

    const duplicateItems = nextItems.filter((item) => Number(item.duplicateCount || 1) > 1);
    const cleanupCandidates = nextItems.filter((item) => ['建议归档清理', '建议检查重复', '建议复核', '建议决定去留'].includes(item.governanceAction));
    const actionCounts = nextItems.reduce((acc, item) => {
      acc[item.governanceAction] = (acc[item.governanceAction] || 0) + 1;
      return acc;
    }, {});
    const rowsFor = (list) => list.map((item) => `| ${item.filename} | ${projectStagingStatusLabel(item.status)} | ${item.duplicateCount || 1} | ${item.stagingAgeDays || 0} | ${item.governanceAction || '-'} | ${String(item.governanceReason || '').replace(/\|/g, '/')} | ${item.path} |`).join('\n') || '| 暂无 | - | - | - | - | - | - |';
    const report = `# ${ensured.name} 研究暂存治理建议

更新时间：${now.toLocaleString('zh-CN')}

> 本报告用于识别研究暂存层中的重复资料、长期未处理资料和可归档候选。控制台不会自动删除任何文件；所有清理动作都需要管理员人工确认。

## 总览

| 指标 | 数量 |
| --- | ---: |
| 暂存资料总数 | ${nextItems.length} |
| 重复候选 | ${duplicateItems.length} |
| 需要治理候选 | ${cleanupCandidates.length} |
| 已收集 | ${statusCounts.collected || 0} |
| 已初筛 | ${statusCounts.screened || 0} |
| 选入分析 | ${statusCounts.selected || 0} |
| 已分析 | ${statusCounts.analyzed || 0} |
| 已晋升 | ${statusCounts.promoted || 0} |
| 已归档/丢弃 | ${statusCounts.discarded || 0} |

## 治理动作分布

${Object.entries(actionCounts).map(([action, count]) => `- ${action}：${count}`).join('\n') || '- 暂无'}

## 重复候选

| 文件 | 状态 | 重复数 | 暂存天数 | 建议 | 理由 | 路径 |
| --- | --- | ---: | ---: | --- | --- | --- |
${rowsFor(duplicateItems)}

## 清理/复核候选

| 文件 | 状态 | 重复数 | 暂存天数 | 建议 | 理由 | 路径 |
| --- | --- | ---: | ---: | --- | --- | --- |
${rowsFor(cleanupCandidates)}

## 全量治理清单

| 文件 | 状态 | 重复数 | 暂存天数 | 建议 | 理由 | 路径 |
| --- | --- | ---: | ---: | --- | --- | --- |
${rowsFor(nextItems)}
`;
    fs.writeFileSync(path.join(ensured.stagingPath, '研究暂存治理建议.md'), report, 'utf8');
    const result = updateProjectRecord(ensured.id, (item) => ({
      ...item,
      stagingItems: nextItems,
      updatedAt: nowIso,
    }));
    appendHostTimeline({ type: 'project_staging_governance_analyzed', title: 'Project staging governance analyzed', detail: ensured.name, count: cleanupCandidates.length });
    return JSON.stringify({
      ok: true,
      project: result.project,
      projects: result.projects,
      duplicateCount: duplicateItems.length,
      cleanupCandidateCount: cleanupCandidates.length,
      reportPath: path.join(ensured.stagingPath, '研究暂存治理建议.md'),
      content: report,
      message: `已生成研究暂存治理建议：重复候选 ${duplicateItems.length} 份，需要治理 ${cleanupCandidates.length} 份。`,
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `生成研究暂存治理建议失败：${error.message}` });
  }
}

function mdCell(value) {
  return String(value === undefined || value === null || value === '' ? '-' : value).replace(/\r?\n/g, ' ').replace(/\|/g, '/');
}

function reportProjectStatusLabel(status) {
  if (status === 'draft') return '草稿';
  if (status === 'active') return '进行中';
  if (status === 'pending_archive') return '待归档';
  if (status === 'archived') return '已归档';
  if (status === 'published') return '已发布';
  if (status === 'sealed') return '已封存';
  return status || '进行中';
}

function graphNodeId(prefix, value) {
  return `${prefix}_${crypto.createHash('sha1').update(String(value || prefix)).digest('hex').slice(0, 10)}`;
}

function graphLabel(value) {
  return String(value === undefined || value === null || value === '' ? '-' : value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ');
}

function generateKnowledgeArchitectureReport() {
  try {
    const generatedAt = new Date().toISOString();
    const students = readStudentsIndex();
    const projects = readProjects().map(normalizeProject);
    const assetSummary = assetIndexSummary();
    const assets = Array.isArray(assetSummary.assets) ? assetSummary.assets : [];
    const studentsById = new Map(students.map((student) => [String(student.id), student]));
    const assetsById = new Map(assets.map((asset) => [String(asset.assetId), asset]));
    const projectAssetRefs = projects.reduce((total, project) => total + (project.assetIds || []).length, 0);
    const stagingItems = projects.flatMap((project) => (project.stagingItems || []).map((item) => ({ project, item: normalizeProjectStagingItem(item) })));
    const promotedStagingCount = stagingItems.filter(({ item }) => item.status === 'promoted' || item.promotedAssetId).length;
    const aiScreenedCount = stagingItems.filter(({ item }) => item.aiAction || item.aiReason).length;
    const publishedProjects = projects.filter((project) => project.publishedAt || project.status === 'published');
    const archivedProjects = projects.filter((project) => project.archivedAt || project.status === 'archived');
    const unboundProjects = projects.filter((project) => !project.studentIds.length);
    const projectWithoutAssets = projects.filter((project) => !(project.assetIds || []).length && !(project.stagingItems || []).some((item) => item.promotedAssetId));
    const stalePromotionProjects = projects.filter((project) => ['pending_archive', 'archived'].includes(project.status) && !project.publishedAt);
    const auditItems = [
      ...unboundProjects.map((project) => ({
        id: `unbound-${project.id}`,
        type: 'unbound_student',
        severity: 'high',
        projectId: project.id,
        projectName: project.name,
        title: '未绑定学生',
        message: '项目尚未绑定学生，无法发布到学生成长模型。',
        suggestedAction: '先绑定学生，再生成贡献申请。',
      })),
      ...projectWithoutAssets.map((project) => ({
        id: `no-assets-${project.id}`,
        type: 'no_assets',
        severity: 'medium',
        projectId: project.id,
        projectName: project.name,
        title: '无正式资产',
        message: '项目没有正式资产引用，也没有已晋升暂存资料。',
        suggestedAction: '从资产中心加入资料，或把研究暂存资料晋升为正式资产。',
      })),
      ...stalePromotionProjects.map((project) => ({
        id: `stale-promotion-${project.id}`,
        type: 'stale_promotion',
        severity: 'medium',
        projectId: project.id,
        projectName: project.name,
        title: '待发布贡献',
        message: `项目处于 ${reportProjectStatusLabel(project.status)}，但尚未发布到成长模型。`,
        suggestedAction: '打开归档确认清单，执行归档后发布到成长模型。',
      })),
    ];

    const projectRows = projects.map((project) => {
      const studentNames = project.studentIds.map((id) => studentsById.get(String(id))?.name || id).join('、') || project.studentNames?.join('、') || '未绑定';
      return `| ${mdCell(project.name)} | ${mdCell(project.type)} | ${mdCell(reportProjectStatusLabel(project.status))} | ${mdCell(studentNames)} | ${(project.assetIds || []).length} | ${(project.stagingItems || []).length} | ${project.promotionPath ? '是' : '否'} | ${project.publishedAt ? '是' : '否'} |`;
    }).join('\n') || '| 暂无 | - | - | - | - | - | - | - |';

    const assetRows = projects.flatMap((project) => (project.assetIds || []).map((assetId) => {
      const asset = assetsById.get(String(assetId));
      return `| ${mdCell(project.name)} | ${mdCell(asset?.filename || assetId)} | ${mdCell(asset?.type || '-')} | ${mdCell(asset?.ownerStudentName || '-')} | ${mdCell(asset?.path || '-')} |`;
    })).join('\n') || '| 暂无 | - | - | - | - |';

    const stagingRows = stagingItems.map(({ project, item }) => `| ${mdCell(project.name)} | ${mdCell(item.filename)} | ${mdCell(projectStagingStatusLabel(item.status))} | ${mdCell(item.aiAction)} | ${mdCell(item.governanceAction)} | ${mdCell(item.promotedAssetId)} | ${mdCell(item.sourcePath || item.path)} |`).join('\n') || '| 暂无 | - | - | - | - | - | - |';

    const riskRows = [
      ...unboundProjects.map((project) => `| 未绑定学生 | ${mdCell(project.name)} | 项目尚未绑定学生，无法发布到学生成长模型。 |`),
      ...projectWithoutAssets.map((project) => `| 无正式资产 | ${mdCell(project.name)} | 项目没有正式资产引用，也没有已晋升暂存资料。 |`),
      ...stalePromotionProjects.map((project) => `| 待发布贡献 | ${mdCell(project.name)} | 项目处于 ${mdCell(reportProjectStatusLabel(project.status))}，但尚未发布到成长模型。 |`),
    ].join('\n') || '| 暂无明显风险 | - | - |';

    const nodeLines = new Map();
    const classLines = new Map();
    const graphNodes = new Map();
    const edgeLines = [];
    const addNode = (id, label, className, targetType, targetId) => {
      nodeLines.set(id, `  ${id}["${graphLabel(label)}"]`);
      if (className) classLines.set(id, `  class ${id} ${className};`);
      if (targetType && targetId) graphNodes.set(id, {
        nodeId: id,
        type: targetType,
        entityId: String(targetId),
        label: String(label),
      });
    };
    const addEdge = (from, label, to) => {
      if (edgeLines.length < 180) edgeLines.push(`  ${from} -->|"${graphLabel(label)}"| ${to}`);
    };
    for (const student of students.slice(0, 80)) {
      addNode(graphNodeId('student', student.id), `学生：${student.name}`, 'studentNode', 'student', student.id);
    }
    for (const project of projects.slice(0, 80)) {
      const projectNode = graphNodeId('project', project.id);
      addNode(projectNode, `项目：${project.name}`, 'projectNode', 'project', project.id);
      for (const studentId of (project.studentIds || []).slice(0, 12)) {
        const student = studentsById.get(String(studentId));
        const studentNode = graphNodeId('student', studentId);
        addNode(studentNode, `学生：${student?.name || studentId}`, 'studentNode', 'student', studentId);
        addEdge(studentNode, '绑定项目', projectNode);
      }
      for (const assetId of (project.assetIds || []).slice(0, 20)) {
        const asset = assetsById.get(String(assetId));
        const assetNode = graphNodeId('asset', assetId);
        addNode(assetNode, `资产：${asset?.filename || assetId}`, 'assetNode', 'asset', assetId);
        addEdge(projectNode, '引用资产', assetNode);
      }
      if (project.publishedAt || project.status === 'published') {
        const growthNode = graphNodeId('growth', project.id);
        addNode(growthNode, `成长沉淀：${project.name}`, 'growthNode', 'growth', project.id);
        addEdge(projectNode, '发布贡献', growthNode);
      }
    }
    const mermaid = [
      '```mermaid',
      'graph LR',
      '  classDef studentNode fill:#e0f2fe,stroke:#0284c7,color:#0f172a;',
      '  classDef projectNode fill:#fce7f3,stroke:#db2777,color:#3f102b;',
      '  classDef assetNode fill:#ecfdf5,stroke:#059669,color:#103f2b;',
      '  classDef growthNode fill:#fef3c7,stroke:#d97706,color:#4a2b05;',
      ...Array.from(nodeLines.values()),
      ...edgeLines,
      ...Array.from(classLines.values()),
      '```',
    ].join('\n');

    const graphReport = `# 教育管家知识关系图 v1

生成时间：${generatedAt}

> 本报告由 Windows 主机控制台生成，用于把学生、学习项目、文件资产、研究暂存层和知识贡献之间的关系可视化。报告只读生成，不会自动修改任何学生档案、项目或资产文件。

## 总览

| 指标 | 数量 |
| --- | ---: |
| 学生 | ${students.length} |
| 学习项目 | ${projects.length} |
| 文件资产 | ${assets.length} |
| 项目资产引用 | ${projectAssetRefs} |
| 研究暂存资料 | ${stagingItems.length} |
| AI 初筛资料 | ${aiScreenedCount} |
| 已晋升暂存资料 | ${promotedStagingCount} |
| 已归档项目 | ${archivedProjects.length} |
| 已发布项目 | ${publishedProjects.length} |

## 关系图

${mermaid}
`;

    const auditReport = `# 项目贡献审计索引

生成时间：${generatedAt}

## 项目清单

| 项目 | 类型 | 状态 | 绑定学生 | 正式资产 | 暂存资料 | 贡献申请 | 已发布 |
| --- | --- | --- | --- | ---: | ---: | --- | --- |
${projectRows}

## 项目资产引用

| 项目 | 资产 | 类型 | 所属学生 | 路径 |
| --- | --- | --- | --- | --- |
${assetRows}

## 研究暂存与晋升

| 项目 | 暂存资料 | 状态 | AI建议 | 治理建议 | 晋升资产 | 来源路径 |
| --- | --- | --- | --- | --- | --- | --- |
${stagingRows}

## 风险与待办

| 类型 | 对象 | 建议 |
| --- | --- | --- |
${riskRows}

## 审计说明

- “引用资产”表示项目知识空间使用文件资产，但不代表已经进入学生主档案。
- “发布贡献”表示项目贡献已经发布到学生综合汇总或成长模型相关索引。
- “研究暂存”是候选资料层，未晋升前不应视为正式文件资产。
`;

    fs.mkdirSync(path.dirname(knowledgeGraphReportPath()), { recursive: true });
    fs.writeFileSync(knowledgeGraphReportPath(), graphReport, 'utf8');
    fs.writeFileSync(projectContributionAuditPath(), auditReport, 'utf8');
    appendHostTimeline({
      type: 'knowledge_graph_report_generated',
      title: 'Knowledge graph report generated',
      detail: `${projects.length} projects · ${assets.length} assets`,
      count: projects.length,
    });
    return JSON.stringify({
      ok: true,
      reportPath: knowledgeGraphReportPath(),
      auditPath: projectContributionAuditPath(),
      content: `${graphReport}\n\n---\n\n${auditReport}`,
      summary: {
        students: students.length,
        projects: projects.length,
        assets: assets.length,
        projectAssetRefs,
        stagingItems: stagingItems.length,
        aiScreenedCount,
        promotedStagingCount,
        publishedProjects: publishedProjects.length,
      },
      auditItems,
      graphNodes: Array.from(graphNodes.values()),
      message: `已生成知识关系图和项目贡献审计索引：${knowledgeGraphReportPath()}`,
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `生成知识关系图失败：${error.message}` });
  }
}

function projectStagingEvidenceItems(project) {
  return (project.stagingItems || []).map(normalizeProjectStagingItem).filter((item) => (
    ['selected', 'analyzed', 'promoted'].includes(item.status)
    || /选入|晋升|分析|采用/.test(`${item.aiAction || ''}${item.governanceAction || ''}`)
  ));
}

function stagingEvidenceContent(project, item) {
  return [
    `- 项目：${project.name}`,
    `- 暂存资料：${item.filename}`,
    `- 暂存状态：${projectStagingStatusLabel(item.status)}`,
    `- AI建议：${item.aiAction || '待补充'}`,
    `- AI理由：${item.aiReason || '待补充'}`,
    `- 治理建议：${item.governanceAction || '待补充'}`,
    `- 治理理由：${item.governanceReason || '待补充'}`,
    `- 来源路径：${item.sourcePath || item.path || '-'}`,
    `- 正式资产编号：${item.promotedAssetId || '尚未晋升'}`,
    '- 支撑能力：待 Agent 或管理员确认',
    '- 可信度：待人工确认',
  ].join('\n');
}

function generateProjectPromotion(projectId) {
  try {
    const access = mutableProject(projectId, '生成知识贡献申请');
    if (access.error) return access.error;
    const project = readProjects().map(normalizeProject).find((item) => String(item.id) === String(projectId));
    if (!project) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    const ensured = ensureProjectWorkspace(project);
    const students = readStudentsIndex().filter((student) => ensured.studentIds.includes(String(student.id)));
    const rawAssets = readAssetIndex().filter((asset) => (asset.references || []).some((ref) => ref.spaceType === 'project' && String(ref.spaceId) === String(ensured.id)));
    const stagingEvidence = projectStagingEvidenceItems(ensured);
    const governanceItems = (ensured.stagingItems || []).filter((item) => item.governanceAction || item.aiAction).map(normalizeProjectStagingItem);
    const today = new Date().toISOString().slice(0, 10);
    const studentTargets = students.map((student) => `- ${student.name}：${student.summaryPath || getSummaryDir(student.name)}；成长模型：${path.join(student.summaryPath || getSummaryDir(student.name), '成长模型')}`).join('\n') || '- 暂未绑定学生';
    const assetLines = rawAssets.map((asset) => `- [ ] ${asset.filename}（${asset.assetId}，${asset.type}，${asset.path}）`).join('\n') || '- [ ] 待补充项目资料资产。';
    const stagingTable = stagingEvidence.map((item) => `| ${mdCell(item.filename)} | ${mdCell(projectStagingStatusLabel(item.status))} | ${mdCell(item.aiAction)} | ${mdCell(item.governanceAction)} | ${mdCell(item.promotedAssetId || '尚未晋升')} | ${mdCell(item.sourcePath || item.path)} |`).join('\n') || '| 暂无 | - | - | - | - | - |';
    const governanceTable = governanceItems.map((item) => `| ${mdCell(item.filename)} | ${mdCell(projectStagingStatusLabel(item.status))} | ${mdCell(item.aiReason)} | ${mdCell(item.governanceReason)} | ${mdCell(item.sourcePath || item.path)} |`).join('\n') || '| 暂无 | - | - | - | - |';
    const growthDraft = stagingEvidence.map((item) => `### ${item.filename}\n\n${stagingEvidenceContent(ensured, item)}`).join('\n\n') || '暂无可自动形成草稿的暂存资料。请先完成 AI 初筛、治理建议或晋升。';
    const content = `---\ntype: project_knowledge_promotion\nproject: ${ensured.name}\ncreated: ${today}\nstatus: draft\n---\n\n# ${ensured.name} 知识贡献申请\n\n## 绑定学生与目标位置\n\n${studentTargets}\n\n## 建议归档文件\n\n${assetLines}\n\n## 研究暂存证据\n\n| 文件 | 状态 | AI建议 | 治理建议 | 资产编号 | 来源路径 |\n| --- | --- | --- | --- | --- | --- |\n${stagingTable}\n\n## AI 初筛与治理摘要\n\n| 文件 | 状态 | AI理由 | 治理理由 | 来源路径 |\n| --- | --- | --- | --- | --- |\n${governanceTable}\n\n## 建议进入学生主档案的知识\n\n### 摘要\n\n- [ ] 待 AI 从项目摘要库中提取可进入学生主档案的摘要。\n\n### 概念\n\n- [ ] 待 AI 从项目概念库中提取可长期保留的概念。\n\n### 实体\n\n- [ ] 待 AI 从项目实体库中提取关键人物、机构、赛事或作品。\n\n### 问答精华\n\n- [ ] 待 AI 从项目问答精华库中提取可复用问答。\n\n### 综合结论\n\n- [ ] 待 AI 从项目综合汇总库中提取稳定结论。\n\n## 成长证据草稿\n\n${growthDraft}\n\n## 忽略项\n\n- [ ] 临时文件、重复文件、草稿或低价值材料。\n\n## 冲突提示\n\n- [ ] 是否与学生主档案已有结论冲突：待检查。\n\n## 人工确认动作\n\n请逐项选择：引用 / 发布 / 吸收 / 跳过。v1 不自动覆盖学生主档案，确认后再由管理员复制到对应学生知识库。\n`;
    fs.mkdirSync(path.dirname(ensured.promotionPath), { recursive: true });
    fs.writeFileSync(ensured.promotionPath, content, 'utf8');
    appendHostTimeline({ type: 'project_promotion_generated', title: 'Project promotion generated', detail: ensured.name, count: rawAssets.length });
    return JSON.stringify({ ok: true, path: ensured.promotionPath, content, message: `已生成知识贡献申请：${ensured.promotionPath}` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `生成知识贡献申请失败：${error.message}` });
  }
}

function projectPromotionPlan(projectId) {
  try {
    const project = readProjects().map(normalizeProject).find((item) => String(item.id) === String(projectId));
    if (!project) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    const ensured = ensureProjectWorkspace(project);
    const students = readStudentsIndex().filter((student) => ensured.studentIds.includes(String(student.id)));
    const rawAssets = readAssetIndex().filter((asset) => (asset.references || []).some((ref) => ref.spaceType === 'project' && String(ref.spaceId) === String(ensured.id)));
    const stagingEvidence = projectStagingEvidenceItems(ensured).slice(0, 80);
    const items = [];
    for (const asset of rawAssets) {
      items.push({
        id: `asset-${asset.assetId}`,
        kind: 'file',
        title: asset.filename || path.basename(asset.path || ''),
        sourcePath: asset.path || '',
        assetId: asset.assetId,
        defaultAction: 'reference',
        action: 'reference',
        allowedActions: ['reference', 'absorb', 'skip'],
        targetHint: '学生原始资料库或项目贡献记录',
        content: `项目文件资产：${asset.filename || asset.assetId}`,
      });
    }
    const knowledgeKinds = [
      { id: 'summary', title: '项目摘要贡献', sourcePath: ensured.summaryPath, targetHint: '学生综合汇总 / 摘要索引' },
      { id: 'concept', title: '项目概念贡献', sourcePath: path.join(ensured.knowledgeRootPath, '概念库'), targetHint: '学生综合汇总 / 概念索引' },
      { id: 'entity', title: '项目实体贡献', sourcePath: path.join(ensured.knowledgeRootPath, '实体库'), targetHint: '学生综合汇总 / 实体索引' },
      { id: 'qa', title: '项目问答精华贡献', sourcePath: path.join(ensured.knowledgeRootPath, '问答精华库'), targetHint: '学生综合汇总 / 问答精华' },
      { id: 'synthesis', title: '项目综合结论贡献', sourcePath: path.join(ensured.knowledgeRootPath, '综合汇总库'), targetHint: '学生综合汇总' },
      { id: 'growth', title: '项目成长证据贡献', sourcePath: ensured.promotionPath, targetHint: '学生成长模型 / 成长证据' },
    ];
    for (const item of knowledgeKinds) {
      items.push({
        id: `knowledge-${item.id}`,
        kind: item.id === 'growth' ? 'growth' : 'knowledge',
        title: item.title,
        sourcePath: item.sourcePath,
        defaultAction: 'publish',
        action: 'publish',
        allowedActions: ['publish', 'skip'],
        targetHint: item.targetHint,
        content: `${item.title}：请由 Agent 根据 ${item.sourcePath} 提取稳定内容后写入学生主档案。`,
      });
    }
    for (const item of stagingEvidence) {
      items.push({
        id: `staging-growth-${item.id}`,
        kind: 'growth',
        title: `成长证据草稿：${item.filename}`,
        sourcePath: item.sourcePath || item.path || '',
        assetId: item.promotedAssetId || '',
        defaultAction: 'publish',
        action: 'publish',
        allowedActions: ['publish', 'skip'],
        targetHint: '学生成长模型 / 成长证据草稿',
        content: stagingEvidenceContent(ensured, item),
      });
    }
    return JSON.stringify({
      ok: true,
      project: ensured,
      students: students.map((student) => ({ id: student.id, name: student.name, summaryPath: student.summaryPath || getSummaryDir(student.name), rawPath: student.rawPath || getRawDir(student.name) })),
      items,
      message: `已生成 ${items.length} 条归档确认项。`,
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `生成归档清单失败：${error.message}` });
  }
}

function createArchiveFileTransaction() {
  const snapshots = new Map();
  return {
    snapshot(file) {
      if (!file || snapshots.has(file)) return;
      snapshots.set(file, fs.existsSync(file) ? fs.readFileSync(file) : null);
    },
    rollback() {
      for (const [file, content] of [...snapshots.entries()].reverse()) {
        if (content === null) {
          if (fs.existsSync(file)) fs.rmSync(file, { force: true });
        } else {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, content);
        }
      }
    },
  };
}

function performProjectPromotionPlan(projectId, planJson, taskContext = null) {
  let fileTransaction = null;
  try {
    const access = mutableProject(projectId, '执行归档');
    if (access.error) return access.error;
    const projects = readProjects().map(normalizeProject);
    const project = projects.find((item) => String(item.id) === String(projectId));
    if (!project) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    const ensured = ensureProjectWorkspace(project);
    let plan = {};
    try {
      plan = JSON.parse(planJson || '{}');
    } catch {
      return JSON.stringify({ ok: false, message: '归档清单不是有效 JSON。' });
    }
    const items = Array.isArray(plan.items) ? plan.items : [];
    if (!items.length) return JSON.stringify({ ok: false, message: '归档清单为空。' });
    const students = readStudentsIndex().filter((student) => ensured.studentIds.includes(String(student.id)));
    if (!students.length) return JSON.stringify({ ok: false, message: '该学习项目尚未绑定学生，无法执行归档。' });
    const authorization = authorizeInternalTaskOperation(taskContext, 'execute_archive_plan', [
      projectsPath(),
      ensured.contributionPath,
      ...students.flatMap((student) => [toHostStudent(student).rootPath || getStudentRootDir(student.name), student.rawPath || getRawDir(student.name), student.summaryPath || getSummaryDir(student.name), growthModelDirForStudent(toHostStudent(student))]),
    ]);
    if (!authorization.ok) return JSON.stringify({ ok: false, blocked: true, message: authorization.message });
    const digestState = readProjectDigestState(ensured);
    const unresolvedStaging = (ensured.stagingItems || []).filter((item) => !['promoted', 'discarded'].includes(String(item.status)));
    const knowledgeReview = readProjectKnowledgeReview(ensured);
    const unresolvedKnowledge = knowledgeReview.records.filter((record) => ['ai_generated', 'pending_review'].includes(String(record.status)));
    const gateIssues = [];
    if (Number(digestState.pendingCount || 0) > 0 || ['submitted', 'digesting', 'failed'].includes(String(digestState.status))) gateIssues.push(`项目消化尚未收口（${digestState.pendingCount || 0} 份待处理，状态 ${digestState.status}）`);
    if (unresolvedStaging.length) gateIssues.push(`${unresolvedStaging.length} 份暂存资料尚未晋升或排除`);
    if (unresolvedKnowledge.length) gateIssues.push(`${unresolvedKnowledge.length} 条知识资产尚未审核`);
    if (gateIssues.length) return JSON.stringify({ ok: false, gateIssues, message: `归档闸门未通过：${gateIssues.join('；')}。` });
    const missingSources = items.filter((item) => String(item.action || item.defaultAction) === 'absorb' && String(item.kind) === 'file')
      .map((item) => String(item.sourcePath || ''))
      .filter((sourcePath) => !sourcePath || !fs.existsSync(sourcePath));
    if (missingSources.length) return JSON.stringify({ ok: false, message: `归档预检失败：${missingSources.length} 个吸收动作的源文件不存在。`, missingSources });
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();
    const transactionId = `archive-${timestampForFilename()}-${crypto.randomBytes(3).toString('hex')}`;
    const priorRuns = readProjectPromotionRunLog(ensured).runs || [];
    const completedActionKeys = new Set(priorRuns.filter((run) => run.status === 'completed').flatMap((run) => (run.results || []).filter((result) => result.ok !== false).map((result) => result.actionKey).filter(Boolean)));
    const knowledgeTargets = { concept: '概念库', entity: '实体库', summary: '摘要库', qa: '咨询精华库', synthesis: '综合库' };
    writeProjects(projects.map((item) => String(item.id) === String(ensured.id) ? { ...item, status: 'archiving', archiveTransactionId: transactionId, updatedAt: now } : item));
    const executionLog = path.join(ensured.contributionPath || projectPathsFor(ensured.name, ensured.projectRootPath, ensured).contributionPath, '归档执行日志.md');
    fileTransaction = createArchiveFileTransaction();
    fileTransaction.snapshot(executionLog);
    writeTextIfMissing(executionLog, `# ${ensured.name} 归档执行日志\n\n| 时间 | 学生 | 条目 | 类型 | 动作 | 来源 | 目标 |\n| --- | --- | --- | --- | --- | --- | --- |\n`);
    const results = [];
    for (const student of students) {
      const summaryPath = student.summaryPath || getSummaryDir(student.name);
      const rawPath = student.rawPath || getRawDir(student.name);
      const growth = ensureGrowthModelForStudent(student);
      const archiveRecordFile = path.join(summaryPath, '项目归档记录.md');
      const contributionSummaryFile = path.join(summaryPath, '项目贡献汇总.md');
      const contributionDetailFile = path.join(summaryPath, '项目贡献明细.md');
      const growthDraftFile = path.join(growth.dir, '成长证据草稿.md');
      [archiveRecordFile, contributionSummaryFile, contributionDetailFile, growthDraftFile, path.join(growth.dir, '成长证据.md'), path.join(growth.dir, '项目贡献.md')].forEach((file) => fileTransaction.snapshot(file));
      writeTextIfMissing(archiveRecordFile, `# ${student.name} 项目归档记录\n\n| 时间 | 项目 | 条目 | 类型 | 动作 | 来源 | 目标 |\n| --- | --- | --- | --- | --- | --- | --- |\n`);
      writeTextIfMissing(contributionSummaryFile, `# ${student.name} 项目贡献汇总\n\n记录已发布到学生主档案的学习项目知识贡献。\n\n| 日期 | 项目 | 贡献内容 | 动作 | 来源路径 |\n| --- | --- | --- | --- | --- |\n`);
      writeTextIfMissing(contributionDetailFile, `# ${student.name} 项目贡献明细\n\n记录项目归档确认清单的逐项处理结果，便于回溯来源、目标和动作。\n\n| 日期 | 项目 | 类型 | 条目 | 动作 | 来源路径 | 目标 |\n| --- | --- | --- | --- | --- | --- | --- |\n`);
      writeTextIfMissing(growthDraftFile, `# ${student.name} 成长证据草稿\n\n本文件收集来自项目知识贡献申请和研究暂存层的候选成长证据，需由 Agent 或管理员确认后再沉淀为稳定成长模型。\n\n`);
      for (const rawItem of items) {
        const item = {
          id: String(rawItem.id || ''),
          kind: String(rawItem.kind || 'knowledge'),
          title: String(rawItem.title || '未命名条目'),
          action: String(rawItem.action || rawItem.defaultAction || 'skip'),
          sourcePath: String(rawItem.sourcePath || ''),
          assetId: rawItem.assetId ? String(rawItem.assetId) : '',
          content: String(rawItem.content || rawItem.title || ''),
        };
        const sourceVersion = item.sourcePath && fs.existsSync(item.sourcePath) ? sha1File(item.sourcePath) : sha1Text(item.content);
        const actionKey = sha1Text([ensured.id, student.id, item.id, item.action, sourceVersion].join('|'));
        if (completedActionKeys.has(actionKey)) {
          results.push({ studentId: student.id, itemId: item.id, action: item.action, actionKey, target: '', ok: true, idempotent: true, message: '相同来源版本已执行，跳过重复写入。' });
          continue;
        }
        if (item.action === 'skip') {
          const line = `| ${now} | ${ensured.name} | ${item.title} | ${item.kind} | 跳过 | ${item.sourcePath || item.assetId || '-'} | - |`;
          fs.appendFileSync(archiveRecordFile, `${line}\n`, 'utf8');
          fs.appendFileSync(contributionDetailFile, `| ${today} | ${mdCell(ensured.name)} | ${mdCell(item.kind)} | ${mdCell(item.title)} | 跳过 | ${mdCell(item.sourcePath || item.assetId || '-')} | - |\n`, 'utf8');
          fs.appendFileSync(executionLog, `| ${now} | ${student.name} | ${item.title} | ${item.kind} | 跳过 | ${item.sourcePath || item.assetId || '-'} | - |\n`, 'utf8');
           results.push({ studentId: student.id, itemId: item.id, action: 'skip', actionKey, target: '', ok: true });
          continue;
        }
        let target = '';
        if (item.kind === 'file' && item.action === 'absorb') {
          if (!item.sourcePath || !fs.existsSync(item.sourcePath)) {
            results.push({ studentId: student.id, itemId: item.id, action: item.action, actionKey, ok: false, message: '源文件不存在' });
            continue;
          }
          target = uniqueTargetFile(rawPath, path.basename(item.sourcePath));
          fileTransaction.snapshot(target);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.copyFileSync(item.sourcePath, target);
          upsertAssetFromFile(target, {
            studentId: student.id,
            studentName: student.name,
            sourcePath: item.sourcePath,
            sourceName: ensured.name,
            role: 'student_raw_absorbed_from_project',
            referenceId: `${student.id}-${ensured.id}-${item.id}`,
          });
        } else if (item.kind === 'growth' && item.action === 'publish') {
          target = path.join(growth.dir, '成长证据.md');
          appendTextSection(growthDraftFile, `${ensured.name} · ${item.title} · ${today}`, `${item.content}\n\n来源：${item.sourcePath || ensured.knowledgeRootPath}\n动作：成长证据草稿\n状态：待确认`);
          appendTextSection(target, `${ensured.name} · ${item.title} · ${today}`, `${item.content}\n\n来源：${item.sourcePath || ensured.knowledgeRootPath}\n动作：发布\n可信度：待人工确认`);
          appendGrowthEvidenceCandidate(student, {
            projectId: ensured.id,
            projectName: ensured.name,
            title: item.title,
            content: item.content,
            sourcePath: item.sourcePath || ensured.knowledgeRootPath,
            confidence: '待人工确认',
          });
        } else if (item.action === 'publish' && knowledgeTargets[item.kind]) {
          const verifiedRecords = knowledgeReview.records.filter((record) => record.kind === item.kind && ['verified', 'published'].includes(String(record.status)));
          const targetDir = path.join(summaryPath, knowledgeTargets[item.kind]);
          fs.mkdirSync(targetDir, { recursive: true });
          const written = [];
          for (const record of verifiedRecords) {
            if (!record.path || !fs.existsSync(record.path)) continue;
            const content = fs.readFileSync(record.path, 'utf8');
            const recordHash = sha1Text(content);
            const recordKey = sha1Text([ensured.id, student.id, record.id, recordHash].join('|'));
            if (completedActionKeys.has(recordKey)) continue;
            const filename = `${sanitizeName(record.title || path.parse(record.path).name)}__${ensured.storageName}.md`;
            const recordTarget = path.join(targetDir, filename);
            fileTransaction.snapshot(recordTarget);
            const frontmatter = `---\nsource_project: "${ensured.name.replace(/"/g, '\\"')}"\nsource_project_id: "${ensured.id}"\nsource_record_id: "${record.id}"\nsource_path: "${String(record.path).replace(/"/g, '\\"')}"\nsource_sha1: "${recordHash}"\npublished_at: "${now}"\n---\n\n`;
            if (!fs.existsSync(recordTarget) || sha1Text(fs.readFileSync(recordTarget, 'utf8')) !== sha1Text(frontmatter + content)) fs.writeFileSync(recordTarget, frontmatter + content, 'utf8');
            written.push(recordTarget);
            results.push({ studentId: student.id, itemId: record.id, action: 'publish', actionKey: recordKey, target: recordTarget, ok: true, knowledgeKind: record.kind });
          }
          target = written.join('；') || targetDir;
        } else if (item.action === 'publish') {
          target = contributionSummaryFile;
          fs.appendFileSync(target, `| ${today} | ${ensured.name} | ${item.title} | 发布 | ${item.sourcePath || ensured.knowledgeRootPath} |\n`, 'utf8');
        } else if (item.action === 'reference') {
          target = archiveRecordFile;
        } else {
          target = archiveRecordFile;
        }
        const actionLabel = item.action === 'absorb' ? '吸收' : item.action === 'publish' ? '发布' : item.action === 'reference' ? '引用' : item.action;
        const source = item.sourcePath || item.assetId || ensured.knowledgeRootPath;
        const line = `| ${now} | ${ensured.name} | ${item.title} | ${item.kind} | ${actionLabel} | ${source} | ${target || '-'} |`;
        fs.appendFileSync(archiveRecordFile, `${line}\n`, 'utf8');
        fs.appendFileSync(contributionDetailFile, `| ${today} | ${mdCell(ensured.name)} | ${mdCell(item.kind)} | ${mdCell(item.title)} | ${mdCell(actionLabel)} | ${mdCell(source)} | ${mdCell(target || '-')} |\n`, 'utf8');
        fs.appendFileSync(executionLog, `| ${now} | ${student.name} | ${item.title} | ${item.kind} | ${actionLabel} | ${source} | ${target || '-'} |\n`, 'utf8');
        if (item.action === 'publish' || item.action === 'absorb') {
          appendTextSection(path.join(growth.dir, '项目贡献.md'), `${ensured.name} · ${item.title} · ${today}`, `- 动作：${actionLabel}\n- 来源：${source}\n- 目标：${target || '-'}\n- 内容：${item.content}`);
        }
        results.push({ studentId: student.id, itemId: item.id, action: item.action, actionKey, target, ok: true });
      }
    }
    const failures = results.filter((result) => result.ok === false);
    const nextProjects = projects.map((item) => String(item.id) === String(ensured.id)
      ? { ...item, status: failures.length ? 'archive_failed' : 'archived', archivedAt: failures.length ? '' : now, archiveFailure: failures.map((failure) => failure.message).join('；'), updatedAt: now, promotionPath: ensured.promotionPath }
      : item);
    writeProjects(nextProjects);
    appendProjectPromotionRun(ensured, {
      type: 'execute_plan',
      status: failures.length ? 'failed' : 'completed',
      transactionId,
      results,
      rollbackHint: failures.length ? '本次归档存在失败项，项目未进入已归档状态。' : '可在贡献审计中按本次运行记录回滚。',
    });
    appendHostTimeline({ type: 'project_promotion_plan_executed', title: 'Project promotion plan executed', detail: ensured.name, count: results.length });
    return JSON.stringify({
      ok: failures.length === 0,
      project: nextProjects.find((item) => String(item.id) === String(ensured.id)),
      results,
      executionLog,
      message: failures.length ? `归档失败：${failures.length} 项未完成，项目状态已标记为“归档失败”。` : `已幂等执行 ${results.length} 条归档动作，并将审核通过的知识逐项写入学生知识库。`,
    });
  } catch (error) {
    try { fileTransaction?.rollback(); } catch { /* Preserve the original archive error. */ }
    try {
      const failedAt = new Date().toISOString();
      const projects = readProjects().map(normalizeProject);
      writeProjects(projects.map((item) => String(item.id) === String(projectId) ? { ...item, status: 'archive_failed', archiveFailure: error.message, updatedAt: failedAt } : item));
      const project = projects.find((item) => String(item.id) === String(projectId));
      if (project) appendProjectPromotionRun(project, { type: 'execute_plan', status: 'failed', error: error.message, failedAt });
    } catch {
      // Preserve the original archive error when recording the failure also fails.
    }
    return JSON.stringify({ ok: false, message: `执行归档清单失败：${error.message}` });
  }
}

function readProjectPromotionRunLog(project) {
  const parsed = safeReadJson(projectPromotionRunLogPath(project), {});
  return {
    version: 1,
    updatedAt: parsed.updatedAt || '',
    runs: Array.isArray(parsed.runs) ? parsed.runs : [],
  };
}

function writeProjectPromotionRunLog(project, log) {
  const file = projectPromotionRunLogPath(project);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    runs: (log.runs || []).slice(0, 120),
  }, null, 2), 'utf8');
}

function appendProjectPromotionRun(project, run) {
  const ensured = ensureProjectWorkspace(project);
  const log = readProjectPromotionRunLog(ensured);
  const entry = {
    id: `promotion-run-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    projectId: ensured.id,
    projectName: ensured.name,
    at: new Date().toISOString(),
    ...run,
  };
  log.runs.unshift(entry);
  writeProjectPromotionRunLog(ensured, log);
  return entry;
}

function getProjectPromotionAudit(projectId) {
  try {
    const project = readProjects().map(normalizeProject).find((item) => String(item.id) === String(projectId));
    if (!project) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    const ensured = ensureProjectWorkspace(project);
    const students = readStudentsIndex().filter((student) => ensured.studentIds.includes(String(student.id)));
    const conflicts = [];
    for (const student of students) {
      const summaryPath = student.summaryPath || getSummaryDir(student.name);
      const growth = ensureGrowthModelForStudent(student);
      const targets = [
        path.join(summaryPath, '项目贡献汇总.md'),
        path.join(summaryPath, '项目贡献明细.md'),
        path.join(summaryPath, '项目归档记录.md'),
        path.join(growth.dir, '项目贡献.md'),
        path.join(growth.dir, '成长证据.md'),
      ];
      for (const target of targets) {
        if (!fs.existsSync(target)) continue;
        const content = readSmallTextFile(target, 512 * 1024);
        if (content.includes(ensured.name)) {
          conflicts.push({
            studentId: student.id,
            studentName: student.name,
            type: 'existing_project_record',
            severity: 'medium',
            target,
            message: `目标文件已包含「${ensured.name}」记录，重复发布前建议核对。`,
          });
        }
      }
    }
    const runLog = readProjectPromotionRunLog(ensured);
    const rolledBackRuns = runLog.runs.filter((run) => run.status === 'rolled_back' || run.rolledBackAt);
    const report = `# ${ensured.name} 贡献冲突与回滚记录\n\n生成时间：${new Date().toISOString()}\n\n## 冲突预览\n\n| 学生 | 风险 | 目标 | 说明 |\n| --- | --- | --- | --- |\n${conflicts.map((item) => `| ${mdCell(item.studentName)} | ${mdCell(item.severity)} | ${mdCell(item.target)} | ${mdCell(item.message)} |`).join('\n') || '| 暂无 | - | - | - |'}\n\n## 执行记录\n\n| 时间 | 类型 | 状态 | 回滚提示 |\n| --- | --- | --- | --- |\n${runLog.runs.map((run) => `| ${mdCell(run.at)} | ${mdCell(run.type)} | ${mdCell(run.status)} | ${mdCell(run.rollbackHint || '-')} |`).join('\n') || '| 暂无 | - | - | - |'}\n\n## 回滚记录\n\n| 回滚时间 | 执行记录 | 方式 | 影响 |\n| --- | --- | --- | --- |\n${rolledBackRuns.map((run) => `| ${mdCell(run.rolledBackAt || run.at)} | ${mdCell(run.id)} | ${mdCell(run.rollbackMode || 'safe_mark_only')} | ${mdCell((run.rollbackRows || []).map((row) => `${row.studentName}: ${row.revertedEvidenceCount || 0} 条证据`).join('、') || '暂无成长证据变化')} |`).join('\n') || '| 暂无 | - | - | - |'}\n`;
    fs.mkdirSync(path.dirname(projectPromotionAuditPath(ensured)), { recursive: true });
    fs.writeFileSync(projectPromotionAuditPath(ensured), report, 'utf8');
    return JSON.stringify({ ok: true, conflicts, runLog, path: projectPromotionAuditPath(ensured), content: report, message: `发现 ${conflicts.length} 条贡献冲突提醒。` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `读取贡献审计失败：${error.message}` });
  }
}

function performRollbackProjectPromotionRun(projectId, runId, taskContext = null) {
  try {
    const access = mutableProject(projectId, '回滚知识贡献');
    if (access.error) return access.error;
    const project = readProjects().map(normalizeProject).find((item) => String(item.id) === String(projectId));
    if (!project) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    const ensured = ensureProjectWorkspace(project);
    const log = readProjectPromotionRunLog(ensured);
    const run = log.runs.find((item) => String(item.id) === String(runId));
    if (!run) return JSON.stringify({ ok: false, message: '未找到贡献执行记录。' });
    if (run.status === 'rolled_back') {
      return JSON.stringify({ ...JSON.parse(getProjectPromotionAudit(projectId)), message: '该执行记录已经标记为回滚。' });
    }
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const affectedStudentIds = mergeUnique([
      ...(Array.isArray(run.results) ? run.results.map((item) => String(item.studentId || '')).filter(Boolean) : []),
      ...(Array.isArray(run.published) ? run.published.map((item) => String(item.studentId || '')).filter(Boolean) : []),
      ...(ensured.studentIds || []).map(String),
    ]);
    const students = readStudentsIndex().filter((student) => affectedStudentIds.includes(String(student.id)));
    const authorization = authorizeInternalTaskOperation(taskContext, 'rollback_promotion', [
      ensured.contributionPath,
      ...students.map((student) => toHostStudent(student).rootPath || getStudentRootDir(student.name)),
    ]);
    if (!authorization.ok) return JSON.stringify({ ok: false, blocked: true, message: authorization.message });
    const rollbackRows = [];
    for (const student of students) {
      const normalized = toHostStudent(student);
      const growth = ensureGrowthModelForStudent(normalized);
      const review = readGrowthEvidenceReview(normalized);
      let changed = 0;
      for (const candidate of review.candidates) {
        if (String(candidate.projectId || '') !== String(ensured.id)) continue;
        if (candidate.status === 'rejected') continue;
        candidate.previousStatusBeforeRollback = candidate.status;
        candidate.status = 'rejected';
        candidate.note = [candidate.note, `由知识贡献回滚自动标记：${run.id}`].filter(Boolean).join('；');
        candidate.updatedAt = now;
        changed += 1;
      }
      if (changed > 0) writeGrowthEvidenceReview(normalized, review);
      const rollbackText = `- 回滚时间：${now}\n- 项目：${ensured.name}\n- 执行记录：${run.id}\n- 回滚方式：安全标记，不删除物理文件\n- 成长证据候选回退：${changed} 条\n- 原状态：${run.status}`;
      appendTextSection(path.join(growth.dir, '项目贡献.md'), `${ensured.name} · 贡献回滚 · ${today}`, rollbackText);
      const summaryPath = normalized.summaryPath || getSummaryDir(normalized.name);
      const detailFile = path.join(summaryPath, '项目贡献明细.md');
      writeTextIfMissing(detailFile, `# ${normalized.name} 项目贡献明细\n\n记录项目归档确认清单的逐项处理结果，便于回溯来源、目标和动作。\n\n| 日期 | 项目 | 类型 | 条目 | 动作 | 来源路径 | 目标 |\n| --- | --- | --- | --- | --- | --- | --- |\n`);
      fs.appendFileSync(detailFile, `| ${today} | ${mdCell(ensured.name)} | rollback | ${mdCell(run.id)} | 回滚标记 | ${mdCell(projectPromotionRunLogPath(ensured))} | ${mdCell(growth.dir)} |\n`, 'utf8');
      rollbackRows.push({ studentId: normalized.id, studentName: normalized.name, revertedEvidenceCount: changed, growthDir: growth.dir });
    }
    run.previousStatusBeforeRollback = run.status;
    run.status = 'rolled_back';
    run.rolledBackAt = now;
    run.rollbackMode = 'safe_mark_only';
    run.rollbackHint = '已安全标记回滚；不会自动删除已复制或已发布的物理文件。请根据贡献明细人工核对是否需要清理。';
    run.rollbackRows = rollbackRows;
    writeProjectPromotionRunLog(ensured, log);
    appendTextSection(projectPromotionAuditPath(ensured), `贡献回滚 · ${today} · ${run.id}`, `- 回滚方式：安全标记，不删除物理文件\n- 影响学生：${rollbackRows.map((item) => `${item.studentName}（证据 ${item.revertedEvidenceCount} 条）`).join('、') || '暂无'}\n- 建议：如需物理撤销，请根据项目贡献明细逐项人工处理。`);
    appendHostTimeline({ type: 'project_promotion_rolled_back', title: 'Project promotion rolled back', detail: ensured.name, count: rollbackRows.length });
    const audit = JSON.parse(getProjectPromotionAudit(projectId));
    return JSON.stringify({
      ...audit,
      ok: true,
      rollbackRows,
      message: `已安全标记回滚：影响 ${rollbackRows.length} 个学生，成长证据候选回退 ${rollbackRows.reduce((total, item) => total + Number(item.revertedEvidenceCount || 0), 0)} 条。`,
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `回滚知识贡献失败：${error.message}` });
  }
}

function performPublishProjectPromotion(projectId, taskContext = null) {
  try {
    const access = mutableProject(projectId, '发布知识贡献');
    if (access.error) return access.error;
    const projects = readProjects().map(normalizeProject);
    const project = projects.find((item) => String(item.id) === String(projectId));
    if (!project) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    const ensured = ensureProjectWorkspace(project);
    const students = readStudentsIndex().filter((student) => ensured.studentIds.includes(String(student.id)));
    if (!students.length) return JSON.stringify({ ok: false, message: '该学习项目尚未绑定学生，无法发布到成长模型。' });
    const authorization = authorizeInternalTaskOperation(taskContext, 'publish_growth_evidence', [
      projectsPath(),
      ensured.contributionPath,
      ...students.flatMap((student) => [toHostStudent(student).rootPath || getStudentRootDir(student.name), student.summaryPath || getSummaryDir(student.name), growthModelDirForStudent(toHostStudent(student))]),
    ]);
    if (!authorization.ok) return JSON.stringify({ ok: false, blocked: true, message: authorization.message });
    const generated = JSON.parse(generateProjectPromotion(projectId));
    if (!generated.ok && !fs.existsSync(ensured.promotionPath)) return JSON.stringify({ ok: false, message: generated.message || '知识贡献申请不存在，无法发布。' });
    const promotionPath = generated.path || ensured.promotionPath;
    const promotionContent = fs.existsSync(promotionPath) ? fs.readFileSync(promotionPath, 'utf8') : generated.content || '';
    const today = new Date().toISOString().slice(0, 10);
    const published = [];
    for (const student of students) {
      const growth = ensureGrowthModelForStudent(student);
      const summaryPath = student.summaryPath || getSummaryDir(student.name);
      const projectSummaryFile = path.join(summaryPath, '项目贡献汇总.md');
      const projectDetailFile = path.join(summaryPath, '项目贡献明细.md');
      const growthDraftFile = path.join(growth.dir, '成长证据草稿.md');
      const projectLine = `| ${today} | ${ensured.name} | 知识贡献申请已发布，等待 Agent 或管理员逐项整理 | 发布 | ${promotionPath} |`;
      const evidenceLine = `| ${today} | ${ensured.name} 知识贡献申请已发布 | ${promotionPath} | 待标注 | 待确认 |`;
      appendTextSection(path.join(growth.dir, '项目贡献.md'), `${ensured.name} 发布记录 ${today}`, `${projectLine}\n\n来源项目知识空间：${ensured.knowledgeRootPath}`);
      appendTextSection(growthDraftFile, `${ensured.name} 成长证据草稿 ${today}`, `- 来源项目：${ensured.name}\n- 贡献申请：${promotionPath}\n- 暂存治理建议：${path.join(ensured.stagingPath, '研究暂存治理建议.md')}\n- 状态：待 Agent 或管理员从贡献申请中提取具体能力、兴趣、趋势和证据。\n`);
      appendTextSection(path.join(growth.dir, '成长证据.md'), `${ensured.name} 成长证据 ${today}`, `${evidenceLine}\n\n请后续由 Agent 根据贡献申请提取具体能力、兴趣、趋势和证据。`);
      appendGrowthEvidenceCandidate(student, {
        projectId: ensured.id,
        projectName: ensured.name,
        title: `${ensured.name} 知识贡献申请已发布`,
        content: `贡献申请：${promotionPath}`,
        sourcePath: promotionPath,
        confidence: '待确认',
      });
      writeTextIfMissing(projectSummaryFile, `# ${student.name} 项目贡献汇总\n\n记录已发布到学生主档案的学习项目知识贡献。\n\n| 日期 | 项目 | 贡献内容 | 动作 | 来源路径 |\n| --- | --- | --- | --- | --- |\n`);
      writeTextIfMissing(projectDetailFile, `# ${student.name} 项目贡献明细\n\n记录项目归档确认清单的逐项处理结果，便于回溯来源、目标和动作。\n\n| 日期 | 项目 | 类型 | 条目 | 动作 | 来源路径 | 目标 |\n| --- | --- | --- | --- | --- | --- | --- |\n`);
      fs.appendFileSync(projectSummaryFile, `${projectLine}\n`, 'utf8');
      fs.appendFileSync(projectDetailFile, `| ${today} | ${mdCell(ensured.name)} | promotion | 知识贡献申请已发布 | 发布 | ${mdCell(promotionPath)} | ${mdCell(growth.dir)} |\n`, 'utf8');
      published.push({ studentId: student.id, studentName: student.name, growthDir: growth.dir, projectSummaryFile });
    }
    const nextProjects = projects.map((item) => String(item.id) === String(ensured.id)
      ? { ...item, status: 'published', publishedAt: new Date().toISOString(), promotionPath, updatedAt: new Date().toISOString() }
      : item);
    writeProjects(nextProjects);
    appendProjectPromotionRun(ensured, {
      type: 'publish_promotion',
      status: 'completed',
      published,
      rollbackHint: '如需撤销，请根据项目贡献汇总、项目贡献明细和成长证据审核记录人工标记为驳回或回滚。',
    });
    appendHostTimeline({ type: 'project_promotion_published', title: 'Project promotion published', detail: ensured.name, count: published.length });
    return JSON.stringify({
      ok: true,
      project: nextProjects.find((item) => String(item.id) === String(ensured.id)),
      path: promotionPath,
      content: promotionContent,
      published,
      message: `已发布「${ensured.name}」知识贡献到 ${published.length} 个学生的成长模型。`,
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `发布知识贡献失败：${error.message}` });
  }
}

function projectPromotionPermissionScope(project) {
  const ensured = ensureProjectWorkspace(project);
  const students = readStudentsIndex().filter((student) => ensured.studentIds.includes(String(student.id)));
  return {
    read: [ensured.knowledgeRootPath, ensured.rawPath, ensured.promotionPath].filter(Boolean),
    write: [
      projectsPath(),
      ensured.contributionPath,
      ...students.flatMap((student) => [
        toHostStudent(student).rootPath || getStudentRootDir(student.name),
        student.rawPath || getRawDir(student.name),
        student.summaryPath || getSummaryDir(student.name),
        growthModelDirForStudent(toHostStudent(student)),
      ]),
    ].filter(Boolean),
  };
}

function queueProjectPromotionOperation(projectId, operation, planJson = '', extraInput = {}) {
  try {
    const project = readProjects().map(normalizeProject).find((item) => String(item.id) === String(projectId));
    if (!project) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    const scope = projectPromotionPermissionScope(project);
    let plan = null;
    if (operation === 'execute_archive_plan') {
      try { plan = JSON.parse(planJson || '{}'); }
      catch { return JSON.stringify({ ok: false, message: '归档清单不是有效 JSON。' }); }
      if (!Array.isArray(plan.items) || !plan.items.length) return JSON.stringify({ ok: false, message: '归档清单为空。' });
    }
    const kind = operation === 'publish_growth_evidence' ? 'growth_publish' : operation === 'rollback_promotion' ? 'promotion_rollback' : 'project_promotion';
    const id = taskStableId(kind, 'project', project.id);
    const store = readTaskStore();
    const current = store.tasks.find((item) => item.id === id);
    if (current && ['approved', 'running', 'waiting_result', 'reviewing'].includes(current.status)) {
      return JSON.stringify({ ok: false, task: current, message: '该高风险任务已经在审批或执行流程中，请前往任务中心处理。' });
    }
    const task = normalizeTaskEnvelope({
      ...(current || {}),
      id,
      title: operation === 'publish_growth_evidence' ? `${project.name}发布到成长模型` : operation === 'rollback_promotion' ? `${project.name}安全回滚贡献记录` : `${project.name}执行归档清单`,
      kind,
      sourceType: 'project',
      sourceId: String(project.id),
      sourceName: project.name,
      status: 'pending',
      trigger: 'manual',
      priority: 'high',
      riskLevel: 'high',
      executor: 'internal',
      requestedExecutor: 'internal',
      executionMode: 'internal',
      input: { projectId: String(project.id), operation, plan, ...extraInput, requestedAt: taskNow() },
      expectedOutput: { type: 'internal_operation', operation },
      permissions: { read: scope.read, write: scope.write, operations: [operation] },
      approval: { required: true, status: 'pending' },
      result: null,
      error: null,
      executionId: '',
      adapterId: '',
      completedAt: '',
      detail: operation === 'publish_growth_evidence'
        ? '发布成长证据属于高风险操作，必须在任务中心审批后执行。'
        : operation === 'rollback_promotion'
          ? '回滚会修改贡献和成长证据审核状态，必须在任务中心审批后执行；不会删除物理文件。'
        : '批量归档和写入学生档案属于高风险操作，必须在任务中心审批后执行。',
      action: operation,
    }, current || {});
    const index = store.tasks.findIndex((item) => item.id === id);
    if (index >= 0) store.tasks[index] = task;
    else store.tasks.push(task);
    appendTaskEvent(task.id, 'high_risk_operation_requested', { operation, projectId: project.id, approvalRequired: true });
    writeTaskStore(store);
    notify('onNativeTaskCenterChanged', JSON.stringify({ taskId: task.id, status: task.status }));
    return JSON.stringify({ ok: true, queued: true, task, message: '已创建高风险任务。请前往任务中心批准并执行，审批前不会写入学生档案。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `创建高风险任务失败：${error.message}` });
  }
}

function executeProjectPromotionPlan(projectId, planJson) {
  return queueProjectPromotionOperation(projectId, 'execute_archive_plan', planJson);
}

function publishProjectPromotion(projectId) {
  return queueProjectPromotionOperation(projectId, 'publish_growth_evidence');
}

function rollbackProjectPromotionRun(projectId, runId) {
  return queueProjectPromotionOperation(projectId, 'rollback_promotion', '', { runId: String(runId || '') });
}

function listProjectArchiveFiles(projectId) {
  try {
    const project = readProjects().map(normalizeProject).find((item) => String(item.id) === String(projectId));
    if (!project) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    const target = project.knowledgeRootPath;
    const files = [];
    collectMarkdownFiles(target, target, files, 8);
    return JSON.stringify({ ok: true, folder: target, files });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `读取项目档案失败：${error.message}` });
  }
}

const LEARNING_REPORTS = [
  {
    id: 'profile',
    title: '整体画像',
    fileName: '整体画像.md',
    type: 'learning_profile',
    target: '家长 / 教师 / 学生',
    summaryHeading: '一句话画像',
    sections: ['一句话画像', '学习优势', '当前短板', '兴趣与动力', '学习习惯与执行力', '适合的学习方式', '家长沟通注意点', '依据来源'],
  },
  {
    id: 'changes',
    title: '历史变化',
    fileName: '历史变化.md',
    type: 'learning_change',
    target: '家长 / 教师',
    summaryHeading: '最近 7 天变化',
    sections: ['最近 7 天变化', '最近 30 天变化', '能力变化', '习惯变化', '问题变化', '目标变化', '依据来源'],
  },
  {
    id: 'daily',
    title: '每日行动建议',
    fileName: '每日行动建议.md',
    type: 'daily_action',
    target: '学生 / 家长 / 教师',
    summaryHeading: '今日重点',
    sections: ['今日重点', '给学生', '给家长', '给老师', '今日不建议做的事', '观察点', '依据来源'],
  },
  {
    id: 'stage',
    title: '阶段总结',
    fileName: '阶段总结.md',
    type: 'stage_summary',
    target: '家长 / 教师',
    summaryHeading: '本阶段核心进展',
    sections: ['本阶段核心进展', '主要问题', '关键证据', '下一阶段目标', '建议行动', '依据来源'],
  },
];

function learningReportDirForStudent(student) {
  const summaryPath = student.summaryPath || getSummaryDir(student.name);
  return path.join(summaryPath, '学情报告');
}

function growthModelDirForStudent(student) {
  const summaryPath = student.summaryPath || getSummaryDir(student.name);
  return path.join(summaryPath, '成长模型');
}

function ensureGrowthModelForStudent(student) {
  const dir = growthModelDirForStudent(student);
  fs.mkdirSync(dir, { recursive: true });
  const files = [
    {
      name: 'index.md',
      content: `# ${student.name} 成长模型\n\n本目录记录学生能力、兴趣、趋势、证据来源和项目贡献来源。学情报告优先引用这里的稳定结论。\n\n- 能力画像：能力画像.md\n- 成长证据：成长证据.md\n- 成长证据草稿：成长证据草稿.md\n- 项目贡献：项目贡献.md\n`,
    },
    {
      name: '能力画像.md',
      content: `# ${student.name} 能力画像\n\n## 学术能力\n\n- 待补充。\n\n## 通用能力\n\n- 待补充。\n\n## 兴趣方向\n\n- 待补充。\n\n## 可信度说明\n\n- 每条判断应标注证据来源、项目来源和更新时间。\n`,
    },
    {
      name: '成长证据.md',
      content: `# ${student.name} 成长证据\n\n| 日期 | 证据 | 来源资料/项目 | 支撑能力 | 可信度 |\n| --- | --- | --- | --- | --- |\n| 待补充 | 待补充 | 待补充 | 待补充 | 待确认 |\n`,
    },
    {
      name: '成长证据草稿.md',
      content: `# ${student.name} 成长证据草稿\n\n本文件收集来自项目知识贡献申请和研究暂存层的候选成长证据，需由 Agent 或管理员确认后再沉淀为稳定成长模型。\n`,
    },
    {
      name: '项目贡献.md',
      content: `# ${student.name} 项目贡献\n\n记录从学习项目知识空间发布到学生主档案或成长模型的贡献申请。\n\n| 日期 | 项目 | 贡献内容 | 动作 | 来源路径 |\n| --- | --- | --- | --- | --- |\n| 待补充 | 待补充 | 待补充 | 引用/发布/吸收/跳过 | 待补充 |\n`,
    },
  ];
  const created = [];
  for (const item of files) {
    const file = path.join(dir, item.name);
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, item.content, 'utf8');
      created.push(item.name);
    }
  }
  return { dir, created };
}

const TASK_TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'blocked', 'cancelled', 'timed_out']);

function taskNow() {
  return new Date().toISOString();
}

function taskToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function taskLocalDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function taskStableId(kind, sourceType, sourceId, suffix = '') {
  const seed = [kind, sourceType, sourceId, suffix].filter(Boolean).join('|');
  return `task-${kind}-${sha1Text(seed).slice(0, 12)}`;
}

function normalizeTaskStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  const aliases = {
    scheduled: 'queued',
    waiting: 'waiting_result',
    completed: 'succeeded',
    success: 'succeeded',
    digesting: 'running',
    submitted: 'waiting_result',
    idle: 'queued',
  };
  const normalized = aliases[value] || value;
  return Object.prototype.hasOwnProperty.call(TASK_STATUS_TRANSITIONS, normalized) ? normalized : 'pending';
}

function taskStatusGroup(status) {
  const normalized = normalizeTaskStatus(status);
  if (['draft', 'pending', 'approved', 'blocked', 'failed', 'timed_out'].includes(normalized)) return 'actionable';
  if (['running', 'waiting_result', 'reviewing'].includes(normalized)) return 'running';
  if (normalized === 'queued') return 'scheduled';
  if (normalized === 'succeeded') return 'completed';
  return 'actionable';
}

function taskRiskForKind(kind) {
  if (['project_promotion', 'growth_publish', 'promotion_rollback', 'asset_delete', 'bulk_archive'].includes(String(kind || ''))) return 'high';
  if (['knowledge_review', 'project_digest'].includes(String(kind || ''))) return 'medium';
  return 'low';
}

function taskRequiresApproval(task) {
  return task?.riskLevel === 'high' || ['project_promotion', 'growth_publish'].includes(String(task?.kind || ''));
}

const TASK_OPERATION_ALLOWLIST = {
  daily_action: new Set(['read', 'create_draft']),
  student_digest: new Set(['read', 'write_knowledge']),
  maintenance_lint: new Set(['read', 'create_report']),
  project_digest: new Set(['read', 'write_project_knowledge']),
  knowledge_review: new Set(['review_knowledge']),
  openclaw_cron: new Set(['execute_scheduled_task']),
  project_promotion: new Set(['execute_archive_plan', 'archive_project']),
  growth_publish: new Set(['publish_growth_evidence']),
  promotion_rollback: new Set(['rollback_promotion']),
};

function canonicalTaskPath(value) {
  if (!value) return '';
  try { return path.resolve(String(value)); }
  catch { return '';
  }
}

function taskPathWithin(candidate, root) {
  const target = canonicalTaskPath(candidate);
  const base = canonicalTaskPath(root);
  if (!target || !base) return false;
  const relative = path.relative(base, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function taskPathAllowed(candidate, roots) {
  return (roots || []).some((root) => taskPathWithin(candidate, root));
}

function validateTaskPermissionDeclaration(task) {
  return validatePermissionDeclaration(task, TASK_OPERATION_ALLOWLIST);
}

function authorizeInternalTaskOperation(taskContext, operation, targetRoots = []) {
  if (!taskContext?.taskId || !taskContext?.executionId) return { ok: false, message: '内部高风险操作只能由任务中心调用。' };
  const task = readTaskStore().tasks.find((item) => item.id === String(taskContext.taskId));
  if (!task || task.executionId !== String(taskContext.executionId)) return { ok: false, message: '任务执行上下文无效或已过期。' };
  if (task.status !== 'running' || task.approval?.status !== 'approved') return { ok: false, message: '高风险任务尚未批准或不在执行状态。' };
  const check = validateTaskPermissionDeclaration(task);
  if (!check.ok) return check;
  if (!check.permissions.operations.includes(operation)) return { ok: false, message: `任务未授权操作：${operation}` };
  const outside = targetRoots.filter(Boolean).find((target) => !taskPathAllowed(target, check.permissions.write));
  if (outside) return { ok: false, message: `内部操作目标超出批准的写入范围：${outside}` };
  return { ok: true, task, permissions: check.permissions };
}

function normalizeTaskEnvelope(task, current = {}) {
  const now = taskNow();
  const sourceType = String(task?.sourceType || current.sourceType || 'system');
  const sourceId = String(task?.sourceId || current.sourceId || 'system');
  const kind = String(task?.kind || current.kind || 'generic');
  const id = String(task?.id || current.id || taskStableId(kind, sourceType, sourceId, task?.scheduleKey || ''));
  const riskLevel = String(task?.riskLevel || current.riskLevel || taskRiskForKind(kind));
  const merged = {
    protocolVersion: TASK_PROTOCOL_VERSION,
    id,
    title: String(task?.title || current.title || '未命名任务'),
    kind,
    sourceType,
    sourceId,
    sourceName: String(task?.sourceName || current.sourceName || ''),
    status: normalizeTaskStatus(task?.status || current.status || 'pending'),
    statusGroup: '',
    trigger: String(task?.trigger || current.trigger || 'manual'),
    priority: String(task?.priority || current.priority || 'normal'),
    riskLevel,
    executor: String(task?.executor || current.executor || 'manual'),
    requestedExecutor: String(task?.requestedExecutor || current.requestedExecutor || task?.executor || 'manual'),
    executionMode: String(task?.executionMode || current.executionMode || 'manual'),
    scheduledAt: String(task?.scheduledAt || current.scheduledAt || ''),
    deadlineAt: String(task?.deadlineAt || current.deadlineAt || ''),
    timeoutSeconds: Math.max(30, Number(task?.timeoutSeconds || current.timeoutSeconds || 900)),
    heartbeatTimeoutSeconds: Math.max(30, Number(task?.heartbeatTimeoutSeconds || current.heartbeatTimeoutSeconds || Math.min(Number(task?.timeoutSeconds || current.timeoutSeconds || 900), 180))),
    idempotencyKey: String(task?.idempotencyKey || current.idempotencyKey || `${kind}:${sourceType}:${sourceId}:${task?.scheduleKey || 'current'}`),
    input: task?.input && typeof task.input === 'object' ? task.input : (current.input || {}),
    expectedOutput: task?.expectedOutput && typeof task.expectedOutput === 'object' ? task.expectedOutput : (current.expectedOutput || {}),
    permissions: task?.permissions && typeof task.permissions === 'object' ? task.permissions : (current.permissions || { read: [], write: [], operations: [] }),
    detail: String(task?.detail || current.detail || ''),
    action: String(task?.action || current.action || ''),
    count: Math.max(0, Number(task?.count ?? current.count ?? 0)),
    approval: task?.approval && typeof task.approval === 'object' ? task.approval : (current.approval || { required: riskLevel === 'high', status: riskLevel === 'high' ? 'pending' : 'not_required' }),
    result: task?.result && typeof task.result === 'object' ? task.result : (current.result || null),
    attempt: Math.max(0, Number(task?.attempt ?? current.attempt ?? 0)),
    maxAttempts: Math.max(1, Number(task?.maxAttempts || current.maxAttempts || 3)),
    retryBackoffSeconds: Math.max(0, Number(task?.retryBackoffSeconds ?? current.retryBackoffSeconds ?? 30)),
    autoRetry: Boolean(task?.autoRetry ?? current.autoRetry ?? true),
    routingMode: String(task?.routingMode || current.routingMode || 'smart'),
    routeAttempts: Array.isArray(task?.routeAttempts) ? task.routeAttempts : (Array.isArray(current.routeAttempts) ? current.routeAttempts : []),
    createdAt: String(current.createdAt || task?.createdAt || now),
    updatedAt: String(task?.updatedAt || now),
    startedAt: String(task?.startedAt || current.startedAt || ''),
    completedAt: String(task?.completedAt || current.completedAt || ''),
    lastHeartbeatAt: String(task?.lastHeartbeatAt || current.lastHeartbeatAt || ''),
    nextRetryAt: String(task?.nextRetryAt || current.nextRetryAt || ''),
    executionId: String(task?.executionId || current.executionId || ''),
    adapterId: String(task?.adapterId || current.adapterId || ''),
    routeDecision: task?.routeDecision && typeof task.routeDecision === 'object' ? task.routeDecision : (current.routeDecision || null),
    error: task?.error && typeof task.error === 'object' ? task.error : (current.error || null),
  };
  merged.statusGroup = taskStatusGroup(merged.status);
  return merged;
}

function ensureTaskCenterWorkspace() {
  for (const dir of [taskCenterDirPath(), taskExecutionDirPath(), taskManualOutboxPath(), qclawTaskInboxPath(), qclawTaskResultPath()]) fs.mkdirSync(dir, { recursive: true });
  const readme = path.join(taskCenterDirPath(), 'README.md');
  const readmeContent = `# AI 教育管家统一任务中心\n\n协议版本：${TASK_PROTOCOL_VERSION}\n\n- tasks.json：标准任务包与执行历史。\n- events.jsonl：只追加的任务事件审计日志。\n- executions：自动执行日志。\n- qclaw-inbox：QClaw 待领取任务包。\n- qclaw-results：QClaw 领取回执与结果回写目录。\n- manual-outbox：不支持自动接口时的人工任务包。\n- migration-backups：协议升级前的任务账本备份。\n\nQClaw 领取任务时，可写入 \`<taskId>.claim.json\`，必须包含 protocolVersion、taskId、executionId、agentId 和 claimedAt。完成后写入 \`<taskId>.result.json\`：\n\n\`\`\`json\n{\n  "protocolVersion": "${TASK_PROTOCOL_VERSION}",\n  "taskId": "任务 ID",\n  "executionId": "任务包中的 executionId",\n  "status": "completed",\n  "message": "执行摘要",\n  "artifacts": [{ "path": "产物路径" }],\n  "validation": { "passed": true }\n}\n\`\`\`\n\n协议版本、任务 ID、执行批次任一不匹配时，结果会进入 rejected 目录，不会改变任务状态。所有结果仍需由任务中心校验和审核，Agent 不得直接发布高风险结果。\n`;
  if (!fs.existsSync(readme) || !fs.readFileSync(readme, 'utf8').includes(`协议版本：${TASK_PROTOCOL_VERSION}`)) fs.writeFileSync(readme, readmeContent, 'utf8');
}

function readTaskStore() {
  ensureTaskCenterWorkspace();
  const parsed = safeReadJson(taskStorePath(), {});
  if (parsed.protocolVersion && parsed.protocolVersion !== TASK_PROTOCOL_VERSION && fs.existsSync(taskStorePath())) {
    const backupDir = path.join(taskCenterDirPath(), 'migration-backups');
    const backupPath = path.join(backupDir, `tasks-${String(parsed.protocolVersion).replace(/[^0-9A-Za-z._-]/g, '_')}-to-${TASK_PROTOCOL_VERSION}.json`);
    if (!fs.existsSync(backupPath)) {
      fs.mkdirSync(backupDir, { recursive: true });
      fs.copyFileSync(taskStorePath(), backupPath);
    }
  }
  return {
    protocolVersion: TASK_PROTOCOL_VERSION,
    updatedAt: String(parsed.updatedAt || ''),
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map((task) => normalizeTaskEnvelope(task, task)) : [],
    history: Array.isArray(parsed.history) ? parsed.history : [],
  };
}

function writeTaskStore(store) {
  const normalized = {
    protocolVersion: TASK_PROTOCOL_VERSION,
    updatedAt: taskNow(),
    tasks: (store.tasks || []).map((task) => normalizeTaskEnvelope(task, task)),
    history: (store.history || []).slice(0, 1000),
  };
  writeJsonFile(taskStorePath(), normalized);
  return normalized;
}

function appendTaskEvent(taskId, type, detail = {}, executionId = '') {
  fs.mkdirSync(path.dirname(taskEventLogPath()), { recursive: true });
  const event = { id: `event-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, taskId: String(taskId || ''), executionId: String(executionId || ''), type: String(type || 'updated'), at: taskNow(), detail };
  fs.appendFileSync(taskEventLogPath(), `${JSON.stringify(event)}\n`, 'utf8');
  return event;
}

function transitionTaskInStore(store, taskId, nextStatus, patch = {}, eventType = 'status_changed') {
  const index = store.tasks.findIndex((task) => String(task.id) === String(taskId));
  if (index < 0) return { ok: false, message: '未找到任务。' };
  const current = store.tasks[index];
  const normalizedNext = normalizeTaskStatus(nextStatus);
  const transitionValidation = validateTaskTransition(normalizeTaskStatus(current.status), normalizedNext);
  if (!transitionValidation.ok) return transitionValidation;
  const now = taskNow();
  const next = normalizeTaskEnvelope({
    ...current,
    ...patch,
    status: normalizedNext,
    updatedAt: now,
    ...(normalizedNext === 'running' && !current.startedAt ? { startedAt: now, lastHeartbeatAt: now } : {}),
    ...(TASK_TERMINAL_STATUSES.has(normalizedNext) ? { completedAt: now } : {}),
  }, current);
  store.tasks[index] = next;
  store.history.unshift({
    id: `history-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    taskId: next.id,
    executionId: next.executionId,
    kind: next.kind,
    title: next.title,
    sourceType: next.sourceType,
    sourceId: next.sourceId,
    sourceName: next.sourceName,
    executor: next.executor,
    status: next.status,
    at: now,
    detail: patch.message || patch.error?.message || patch.result?.summary || '',
    approval: patch.approval || null,
    metrics: patch.result?.metrics || null,
    fileChanges: patch.result?.fileChanges || [],
    validation: patch.result?.validation || null,
  });
  appendTaskEvent(next.id, eventType, { from: current.status, to: next.status, ...patch }, next.executionId);
  return { ok: true, task: next };
}

function upsertTaskCandidates(candidates) {
  const store = readTaskStore();
  const byId = new Map(store.tasks.map((task) => [String(task.id), task]));
  let changed = false;
  for (const candidate of candidates) {
    const current = byId.get(String(candidate.id));
    if (!current) {
      const created = normalizeTaskEnvelope(candidate);
      store.tasks.push(created);
      byId.set(created.id, created);
      changed = true;
      appendTaskEvent(created.id, 'task_created', { kind: created.kind, sourceType: created.sourceType, sourceId: created.sourceId });
      continue;
    }
    const sourceStatus = normalizeTaskStatus(candidate.status);
    const preserveExecution = ['running', 'waiting_result', 'reviewing'].includes(current.status);
    const preserveTerminal = TASK_TERMINAL_STATUSES.has(current.status) && Number(candidate.count || 0) === 0;
    const nextStatus = preserveExecution || preserveTerminal ? current.status : sourceStatus;
    const preserveRequestedOperation = taskRequiresApproval(current) && current.input?.operation && !TASK_TERMINAL_STATUSES.has(current.status);
    const merged = normalizeTaskEnvelope({
      ...candidate,
      status: nextStatus,
      input: preserveRequestedOperation ? current.input : candidate.input,
      expectedOutput: preserveRequestedOperation ? current.expectedOutput : candidate.expectedOutput,
      permissions: preserveRequestedOperation ? current.permissions : candidate.permissions,
      result: current.result,
      approval: current.approval,
      attempt: current.attempt,
      createdAt: current.createdAt,
      executionId: current.executionId,
      adapterId: current.adapterId,
      routeDecision: current.routeDecision,
      routeAttempts: current.routeAttempts,
      error: current.error,
    }, current);
    const comparableCurrent = { ...current, updatedAt: '' };
    const comparableMerged = { ...merged, updatedAt: '' };
    if (JSON.stringify(comparableCurrent) === JSON.stringify(comparableMerged)) continue;
    const index = store.tasks.findIndex((task) => task.id === current.id);
    store.tasks[index] = merged;
    byId.set(merged.id, merged);
    changed = true;
  }
  return changed ? writeTaskStore(store) : store;
}

function dailyActionDraftPath(student, taskId) {
  return path.join(studentAiManagerDir(student), 'task-center', 'daily-action-drafts', `${taskId}.md`);
}

function dailyActionFeedbackPath(student) {
  return path.join(studentAiManagerDir(student), 'task-center', 'daily-action-feedback.json');
}

function readDailyActionFeedback(student) {
  const parsed = safeReadJson(dailyActionFeedbackPath(student), {});
  return Array.isArray(parsed.entries) ? parsed.entries : [];
}

function buildDailyActionTask(student) {
  const normalized = toHostStudent(student);
  const day = taskToday();
  const report = LEARNING_REPORTS.find((item) => item.id === 'daily');
  const officialPath = learningReportPathForStudent(normalized, report);
  const stat = fs.existsSync(officialPath) ? fs.statSync(officialPath) : null;
  const officialContent = stat ? readSmallTextFile(officialPath, 512 * 1024) : '';
  const reportStatus = frontmatterValue(officialContent, 'status').toLowerCase();
  const reportUpdated = frontmatterValue(officialContent, 'updated');
  const updatedToday = Boolean(stat
    && taskLocalDate(stat.mtime) === day
    && reportUpdated === day
    && reportStatus === 'published');
  const id = taskStableId('daily_action', 'student', normalized.id, day);
  const boundProjects = readProjects().map(normalizeProject)
    .filter((project) => (project.studentIds || []).map(String).includes(String(normalized.id)))
    .map((project) => ({ id: project.id, name: project.name, status: project.status, pendingDigest: Number(project.digestState?.pendingCount || 0), contributionStatus: project.dashboard?.contributionStatus || '' }));
  const relatedProjectIds = new Set(boundProjects.map((project) => String(project.id)));
  const unfinishedTasks = readTaskStore().tasks
    .filter((task) => task.statusGroup !== 'completed'
      && ((task.sourceType === 'student' && String(task.sourceId) === String(normalized.id))
        || (task.sourceType === 'project' && relatedProjectIds.has(String(task.sourceId)))))
    .map((task) => ({ id: task.id, title: task.title, status: task.status, priority: task.priority, deadlineAt: task.deadlineAt || '' }))
    .slice(0, 20);
  return normalizeTaskEnvelope({
    id,
    title: `${normalized.name}每日行动建议`,
    kind: 'daily_action',
    sourceType: 'student',
    sourceId: String(normalized.id),
    sourceName: normalized.name,
    status: updatedToday ? 'succeeded' : 'pending',
    trigger: 'schedule',
    priority: 'high',
    riskLevel: 'low',
    executor: String(normalized.agentTool || 'qclaw'),
    requestedExecutor: String(normalized.agentTool || 'qclaw'),
    executionMode: 'adapter',
    scheduledAt: String(normalized.digestTime || '21:30'),
    scheduleKey: day,
    idempotencyKey: `daily_action:${normalized.id}:${day}`,
    input: {
      date: day,
      studentId: String(normalized.id),
      studentName: normalized.name,
      knowledgeRoot: normalized.rootPath || getStudentRootDir(normalized.name),
      summaryPath: normalized.summaryPath || getSummaryDir(normalized.name),
      growthPath: growthModelDirForStudent(normalized),
      previousFeedback: selectPreviousDailyFeedback(readDailyActionFeedback(normalized), day, 3),
      projects: boundProjects,
      unfinishedTasks,
    },
    expectedOutput: { type: 'markdown', draftPath: dailyActionDraftPath(normalized, id), publishPath: officialPath, requiredSections: ['今日重点', '给学生', '给家长', '给老师', '今日不建议做的事', '观察点', '依据来源'] },
    permissions: { read: [normalized.rootPath || getStudentRootDir(normalized.name)], write: [dailyActionDraftPath(normalized, id)], operations: ['read', 'create_draft'] },
    detail: updatedToday ? '今日行动建议已发布。' : '根据最新学情、项目状态和前一日反馈生成今日建议，完成后进入人工审核。',
    action: 'daily_action',
    approval: { required: false, status: 'not_required' },
  });
}

function taskCommandFor(task) {
  if (task.kind === 'project_digest') {
    const parsed = JSON.parse(getProjectDigestCommand(task.sourceId));
    return parsed.ok ? parsed.command : '';
  }
  const student = task.sourceType === 'student' ? readStudentsIndex().find((item) => String(item.id) === String(task.sourceId)) : null;
  if (task.kind === 'daily_action' && student) {
    const normalized = toHostStudent(student);
    const expectedDate = String(task.input?.date || taskToday());
    const feedback = Array.isArray(task.input?.previousFeedback)
      ? task.input.previousFeedback
      : selectPreviousDailyFeedback(readDailyActionFeedback(normalized), expectedDate, 3);
    return `请为学生「${normalized.name}」生成 ${expectedDate} 的每日行动建议。\n\n读取范围：\n- 学生知识库：${normalized.rootPath || getStudentRootDir(normalized.name)}\n- 学情分析汇总：${normalized.summaryPath || getSummaryDir(normalized.name)}\n- 成长模型：${growthModelDirForStudent(normalized)}\n\n绑定项目状态：\n${task.input?.projects?.length ? JSON.stringify(task.input.projects, null, 2) : '暂无绑定项目。'}\n\n未完成任务：\n${task.input?.unfinishedTasks?.length ? JSON.stringify(task.input.unfinishedTasks, null, 2) : '暂无未完成任务。'}\n\n前序反馈：\n${feedback.length ? JSON.stringify(feedback, null, 2) : '暂无反馈。'}\n\n必须包含：今日重点、给学生、给家长、给老师、今日不建议做的事、观察点、依据来源。每个章节必须有实质内容；建议必须具体、当天可执行，并标注依据；不确定内容标注“待观察”。\n\n只把草稿写入：${task.expectedOutput?.draftPath}\n不要直接覆盖正式报告。文件必须以如下 YAML frontmatter 开头：\n---\ndate: ${expectedDate}\ngenerated_at: 当前 ISO 时间\nstatus: pending_review\n---\n\n完成后确认文件存在。`;
  }
  if (task.kind === 'student_digest' && student) {
    const normalized = toHostStudent(student);
    return `/消化\n\n请按照 ${normalized.agentPath || path.join(normalized.rootPath || getStudentRootDir(normalized.name), 'AGENT.md')} 的规则，处理 ${normalized.rawPath || getRawDir(normalized.name)} 中尚未消化的资料，并更新摘要、概念、实体、问答、综合汇总、成长模型和学情报告。完成后更新 ${studentDigestStatePath(normalized)}。`;
  }
  if (task.kind === 'maintenance_lint' && student) {
    const normalized = toHostStudent(student);
    return `请检查学生「${normalized.name}」知识库的路径、规则文件、索引、来源引用、断链和成长模型健康度。知识库：${normalized.rootPath || getStudentRootDir(normalized.name)}。只生成检查报告，不删除或覆盖原文件。`;
  }
  return String(task.input?.command || task.detail || task.title || '');
}

function probeExecutable(executable, args, timeout = 2500) {
  if (!executable) return { ok: false, output: '', error: 'executable_not_found' };
  try {
    const shim = resolveNodeCommandShim(executable, args);
    const target = shim?.executable || executable;
    const targetArgs = shim?.args || args;
    const scripted = !shim && /\.(cmd|bat|ps1)$/i.test(executable);
    const result = spawnSync(target, targetArgs, { windowsHide: true, shell: scripted, encoding: 'utf8', timeout });
    return { ok: result.status === 0, output: `${result.stdout || ''}\n${result.stderr || ''}`.trim(), status: result.status, error: result.error?.message || '' };
  } catch (error) {
    return { ok: false, output: '', error: error.message };
  }
}

function probeExecutableAsync(executable, args, timeout = 5000) {
  if (!executable) return Promise.resolve({ ok: false, output: '', error: 'executable_not_found' });
  return new Promise((resolve) => {
    let child;
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try { child?.kill(); } catch { /* The process may already have exited. */ }
      finish({ ok: false, output: `${stdout}\n${stderr}`.trim(), error: `timeout_after_${timeout}ms`, timedOut: true });
    }, timeout);
    try {
      child = spawnAdapterProcess(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout?.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-20000); });
      child.stderr?.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-20000); });
      child.on('error', (error) => finish({ ok: false, output: `${stdout}\n${stderr}`.trim(), error: error.message }));
      child.on('exit', (status) => finish({ ok: Number(status) === 0, output: `${stdout}\n${stderr}`.trim(), status: Number(status), error: '' }));
    } catch (error) {
      finish({ ok: false, output: '', error: error.message });
    }
  });
}

function parseOpenClawModelReadiness(modelProbe) {
  if (!modelProbe?.ok) return { ready: false, model: '', message: '未读取到默认模型配置' };
  let configured = String(modelProbe.output || '').trim();
  try {
    const parsed = JSON.parse(configured);
    configured = String(parsed.primary || parsed.model || configured);
  } catch { /* Plain-text model identifiers are also valid. */ }
  configured = configured.replace(/^"|"$/g, '');
  if (!configured) return { ready: false, model: '', message: '默认模型为空' };
  return { ready: true, model: configured, message: `模型 ${configured}` };
}

async function verifyOpenClawModel(modelProbe) {
  const parsed = parseOpenClawModelReadiness(modelProbe);
  if (!parsed.ready || !parsed.model.startsWith('ollama/')) return parsed;
  const model = parsed.model.slice('ollama/'.length);
  const ollama = findExecutableInPath(['ollama.exe', 'ollama']);
  const list = ollama ? await probeExecutableAsync(ollama, ['list'], 5000) : { ok: false, output: '' };
  const ready = Boolean(list.ok && list.output.split(/\r?\n/).some((line) => line.trim().startsWith(model)));
  return { ready, model: parsed.model, message: ready ? `模型 ${parsed.model} 已就绪` : `模型 ${parsed.model} 未安装或 Ollama 不可用` };
}

function baseAdapterCapabilities(previous = {}) {
  const codex = findAgentToolInstall('codex');
  const openclawCli = findExecutableInPath(['openclaw.cmd', 'openclaw.exe', 'openclaw']);
  const qclaw = findAgentToolInstall('qclaw');
  const previousCodex = previous.codex || {};
  const previousOpenClaw = previous.openclaw || {};
  return {
    internal: { id: 'internal', label: '教育管家内部执行器', available: true, authorized: true, automatic: true, cli: false, gateway: false, gatewayHealthy: true, cron: false, polling: false, inbox: false, cancel: false, structuredResult: true, permissionEnforcement: 'strict', hidden: true, exePath: '' },
    codex: { id: 'codex', label: 'Codex', available: Boolean(codex.installed && codex.exePath), authorized: previousCodex.exePath === codex.exePath ? previousCodex.authorized !== false : Boolean(codex.installed && codex.exePath), automatic: true, cli: true, gateway: false, gatewayHealthy: false, cron: false, polling: true, inbox: false, cancel: true, structuredResult: false, permissionEnforcement: 'workspace', healthPending: true, healthMessage: previousCodex.exePath === codex.exePath && previousCodex.healthMessage ? previousCodex.healthMessage : 'CLI 已发现，后台验证配置与授权', exePath: codex.exePath || '' },
    openclaw: { id: 'openclaw', label: 'OpenClaw', available: Boolean(openclawCli), authorized: previousOpenClaw.exePath === openclawCli ? Boolean(previousOpenClaw.authorized) : false, automatic: true, cli: Boolean(openclawCli), gateway: previousOpenClaw.exePath === openclawCli ? Boolean(previousOpenClaw.gateway) : false, gatewayHealthy: previousOpenClaw.exePath === openclawCli ? Boolean(previousOpenClaw.gatewayHealthy) : false, cron: previousOpenClaw.exePath === openclawCli ? Boolean(previousOpenClaw.cron) : false, polling: true, inbox: false, cancel: true, structuredResult: true, permissionEnforcement: 'declared_and_validated', healthPending: true, healthMessage: previousOpenClaw.exePath === openclawCli && previousOpenClaw.healthMessage ? previousOpenClaw.healthMessage : 'CLI 已发现，后台验证模型与 Gateway', model: previousOpenClaw.model || '', exePath: openclawCli || '' },
    qclaw: { id: 'qclaw', label: 'QClaw', available: Boolean(qclaw.installed), authorized: Boolean(qclaw.installed), automatic: false, cli: false, gateway: false, gatewayHealthy: false, cron: false, polling: true, inbox: true, cancel: false, structuredResult: true, permissionEnforcement: 'task_packet', exePath: qclaw.exePath || '' },
    manual: { id: 'manual', label: '人工执行', available: true, authorized: true, automatic: false, cli: false, gateway: false, gatewayHealthy: false, cron: false, polling: false, inbox: true, cancel: false, structuredResult: true, permissionEnforcement: 'human_review', exePath: '' },
  };
}

function refreshAdapterCapabilities(force = false) {
  if (!taskAutomationEnabled() && !force) return Promise.resolve(adapterCapabilityCache.value || baseAdapterCapabilities());
  if (adapterCapabilityCache.refreshing) return adapterCapabilityCache.refreshing;
  if (!force && adapterCapabilityCache.value && Date.now() - adapterCapabilityCache.at < 5 * 60 * 1000) return Promise.resolve(adapterCapabilityCache.value);
  const base = baseAdapterCapabilities(adapterCapabilityCache.value || {});
  adapterCapabilityCache.value = base;
  const promise = (async () => {
    const codex = base.codex;
    const openclaw = base.openclaw;
    const [codexAuth, openclawHelp, openclawModel, gatewayHelp, cronHelp] = await Promise.all([
      codex.exePath ? probeExecutableAsync(codex.exePath, ['login', 'status'], 4000) : Promise.resolve({ ok: false, output: '' }),
      openclaw.exePath ? probeExecutableAsync(openclaw.exePath, ['agent', '--help'], 5000) : Promise.resolve({ ok: false, output: '' }),
      openclaw.exePath ? probeExecutableAsync(openclaw.exePath, ['config', 'get', 'agents.defaults.model'], 7000) : Promise.resolve({ ok: false, output: '' }),
      openclaw.exePath ? probeExecutableAsync(openclaw.exePath, ['gateway', '--help'], 5000) : Promise.resolve({ ok: false, output: '' }),
      openclaw.exePath ? probeExecutableAsync(openclaw.exePath, ['cron', '--help'], 5000) : Promise.resolve({ ok: false, output: '' }),
    ]);
    const codexAuthHealthy = Boolean(codexAuth.ok
      && !/(error loading configuration|unknown variant|not logged in|unauthorized|authentication failed)/i.test(String(codexAuth.output || '')));
    const [openclawModelReady, gatewayStatus] = await Promise.all([
      verifyOpenClawModel(openclawModel),
      gatewayHelp.ok ? probeExecutableAsync(openclaw.exePath, ['gateway', 'status'], 6000) : Promise.resolve({ ok: false, output: '' }),
    ]);
    const value = {
      ...base,
      codex: { ...codex, authorized: codexAuthHealthy, healthPending: false, healthMessage: codexAuthHealthy ? 'CLI 已授权' : `CLI 配置或授权异常${codexAuth.output || codexAuth.error ? `：${String(codexAuth.output || codexAuth.error).slice(0, 160)}` : ''}` },
      openclaw: { ...openclaw, available: Boolean(openclaw.exePath && openclawHelp.ok), authorized: Boolean(openclaw.exePath && openclawHelp.ok && openclawModelReady.ready), cli: Boolean(openclaw.exePath && openclawHelp.ok), gateway: Boolean(gatewayHelp.ok), gatewayHealthy: Boolean(gatewayStatus.ok), cron: Boolean(cronHelp.ok), healthPending: false, healthMessage: !openclawModelReady.ready ? openclawModelReady.message : gatewayHelp.ok ? (gatewayStatus.ok ? `Gateway 正常；${openclawModelReady.message}` : `CLI 本地模式；${openclawModelReady.message}`) : `仅 CLI；${openclawModelReady.message}`, model: openclawModelReady.model },
    };
    adapterCapabilityCache = { at: Date.now(), value, refreshing: null };
    return value;
  })().catch((error) => {
    const value = adapterCapabilityCache.value || base;
    adapterCapabilityCache = { at: Date.now(), value, refreshing: null };
    appendTaskEvent('', 'adapter_capability_refresh_failed', { message: error.message });
    return value;
  });
  adapterCapabilityCache.refreshing = promise;
  return promise;
}

function adapterCapabilities(force = false) {
  if (!adapterCapabilityCache.value) adapterCapabilityCache.value = baseAdapterCapabilities();
  if (taskAutomationEnabled() || force) void refreshAdapterCapabilities(force);
  return adapterCapabilityCache.value;
}

function routeTask(task, requestedExecutor = '', excludedAdapters = []) {
  const capabilities = adapterCapabilities();
  const requestedInput = String(requestedExecutor || task.requestedExecutor || task.executor || 'manual');
  const routingMode = ['auto', 'smart'].includes(requestedInput) ? 'smart' : requestedInput === 'rule' ? 'rule' : requestedInput === 'confirm' ? 'confirm' : 'fixed';
  const requested = routingMode === 'fixed' ? requestedInput : '';
  const excluded = new Set((excludedAdapters || []).map(String));
  const history = readTaskStore().history || [];
  const candidates = Object.values(capabilities).filter((adapter) => !adapter.hidden || requested === adapter.id).map((adapter) => {
    let score = adapter.available && adapter.authorized && !excluded.has(adapter.id) ? 40 : -1000;
    if (requested && adapter.id === requested) score += 50;
    if (adapter.automatic) score += 20;
    if (task.kind === 'daily_action' && adapter.id === 'openclaw') score += 15;
    if (task.kind === 'project_digest' && ['openclaw', 'codex'].includes(adapter.id)) score += 10;
    if (task.riskLevel === 'high' && adapter.id === 'manual') score += 20;
    if (adapter.id === 'manual' && task.riskLevel !== 'high') score -= 30;
    if (routingMode === 'rule') {
      if (task.kind === 'daily_action' && adapter.id === 'openclaw') score += 40;
      if (['student_digest', 'project_digest'].includes(task.kind) && adapter.id === 'codex') score += 35;
      if (task.executionMode === 'inbox' && adapter.id === 'qclaw') score += 35;
    }
    const executions = history.filter((entry) => entry.executor === adapter.id && entry.taskId && ['succeeded', 'failed', 'timed_out', 'cancelled'].includes(String(entry.status)));
    const successes = executions.filter((entry) => entry.status === 'succeeded').length;
    const successRate = executions.length ? successes / executions.length : 0.5;
    const qualityScore = Math.round(successRate * 20);
    const costWeight = adapter.id === 'manual' ? 3 : adapter.id === 'qclaw' ? 6 : adapter.id === 'openclaw' ? 8 : 10;
    const speedScore = adapter.automatic ? 20 : adapter.inbox ? 10 : 5;
    const declaredPaths = [...(task.permissions?.read || []), ...(task.permissions?.write || [])];
    const localOnly = declaredPaths.some((item) => /^[A-Za-z]:[\\/]/.test(String(item)));
    const dataBoundaryScore = adapter.permissionEnforcement === 'strict' ? 20 : adapter.id === 'manual' ? 15 : localOnly && adapter.id === 'codex' ? 12 : adapter.available ? 8 : 0;
    const deadlineMs = task.deadlineAt ? Date.parse(task.deadlineAt) - Date.now() : Number.POSITIVE_INFINITY;
    const deadlineScore = deadlineMs < 15 * 60 * 1000 ? (adapter.automatic ? 15 : -10) : 0;
    score += qualityScore + speedScore + dataBoundaryScore - costWeight;
    score += deadlineScore;
    return { adapterId: adapter.id, label: adapter.label, score, available: adapter.available && adapter.authorized && !excluded.has(adapter.id), authorized: adapter.authorized, mode: adapter.automatic ? 'automatic' : adapter.inbox ? 'inbox' : 'manual', successRate, qualityScore, speedScore, dataBoundaryScore, deadlineScore, costWeight, excluded: excluded.has(adapter.id) };
  }).sort((a, b) => b.score - a.score);
  const selected = candidates.find((candidate) => candidate.available) || candidates.find((candidate) => candidate.adapterId === 'manual');
  const reason = routingMode === 'smart'
    ? `智能路由选择 ${selected?.label || '人工执行'}：综合能力、授权、数据边界、截止时间、历史成功率和成本。`
    : routingMode === 'rule'
      ? `规则路由选择 ${selected?.label || '人工执行'}：按任务类型和执行模式匹配预设执行器。`
      : routingMode === 'confirm'
        ? `已生成执行器推荐：${selected?.label || '人工执行'}，等待人工确认后再提交。`
    : selected?.adapterId === requested
      ? '使用任务指定执行器。'
      : `指定执行器不可使用，已降级为 ${selected?.label || '人工执行'}。`;
  return { mode: routingMode, requestedExecutor: requested || requestedInput, selectedAdapter: selected?.adapterId || 'manual', reason, candidates, excludedAdapters: [...excluded], confirmationRequired: routingMode === 'confirm', decidedAt: taskNow() };
}

function writeTaskPacket(task, dir, command) {
  fs.mkdirSync(dir, { recursive: true });
  const packetPath = path.join(dir, `${task.id}.task.json`);
  const promptPath = path.join(dir, `${task.id}.prompt.md`);
  writeJsonFile(packetPath, { ...task, command, exportedAt: taskNow() });
  fs.writeFileSync(promptPath, `# ${task.title}\n\n任务 ID：${task.id}\n协议版本：${task.protocolVersion}\n\n${command}\n\n## 结果回写\n\n请返回 TaskResult JSON，并保留 taskId、executionId、status、artifacts、validation 和 message。\n`, 'utf8');
  return { packetPath, promptPath };
}

function validateTaskArtifacts(task, startedAt = '', resultPayload = null) {
  const payloadPaths = Array.isArray(resultPayload?.artifacts)
    ? resultPayload.artifacts.map((item) => typeof item === 'string' ? item : item?.path).filter(Boolean)
    : [];
  const paths = [...new Set([
    task.expectedOutput?.draftPath,
    task.expectedOutput?.publishPath,
    task.expectedOutput?.path,
    ...payloadPaths,
  ].filter(Boolean))];
  const artifacts = paths.map((file) => {
    const exists = fs.existsSync(file);
    const stat = exists ? fs.statSync(file) : null;
    return { path: file, exists, size: stat?.size || 0, modifiedAt: stat?.mtime?.toISOString() || '' };
  });
  let valid = artifacts.some((item) => item.exists && item.size > 0 && (!startedAt || Date.parse(item.modifiedAt) >= Date.parse(startedAt) - 1000));
  const schemaErrors = [];
  if (task.kind === 'daily_action') {
    const draft = artifacts.find((item) => item.path === task.expectedOutput?.draftPath);
    valid = Boolean(draft?.exists && draft.size > 0 && (!startedAt || Date.parse(draft.modifiedAt) >= Date.parse(startedAt) - 1000));
    if (valid) {
      const content = fs.readFileSync(draft.path, 'utf8');
      const schema = validateDailyActionDocument(content, {
        expectedDate: String(task.input?.date || ''),
        requiredSections: task.expectedOutput?.requiredSections || [],
      });
      schemaErrors.push(...schema.errors);
      valid = schemaErrors.length === 0;
    }
  }
  return { valid, artifacts, schemaErrors, checkedAt: taskNow(), message: valid ? '产物与输出结构校验通过。' : schemaErrors.length ? `输出结构校验失败：${schemaErrors.join('；')}。` : '未检测到符合要求的新产物。' };
}

function normalizeTaskResult(task, payload = {}, validation = null, defaults = {}) {
  const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts : (validation?.artifacts || []);
  const startedAt = String(task.startedAt || defaults.startedAt || '');
  const completedAt = String(payload.completedAt || defaults.completedAt || taskNow());
  const durationMs = startedAt ? Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)) : 0;
  return {
    protocolVersion: TASK_PROTOCOL_VERSION,
    taskId: task.id,
    executionId: String(payload.executionId || task.executionId || defaults.executionId || ''),
    status: String(payload.status || defaults.status || 'reviewing'),
    adapterId: String(payload.adapterId || task.adapterId || defaults.adapterId || task.executor || 'manual'),
    summary: String(payload.summary || payload.message || defaults.summary || '任务已返回结果。'),
    message: String(payload.message || defaults.message || ''),
    output: payload.output ?? defaults.output ?? '',
    errorOutput: payload.errorOutput ?? defaults.errorOutput ?? '',
    structuredOutput: payload.structuredOutput ?? payload.data ?? defaults.structuredOutput ?? null,
    artifacts,
    fileChanges: Array.isArray(payload.fileChanges) ? payload.fileChanges : artifacts.filter((item) => item?.exists !== false && item?.path).map((item) => ({ path: item.path, operation: 'created_or_updated', modifiedAt: item.modifiedAt || '' })),
    logReference: String(payload.logReference || payload.logPath || defaults.logReference || task.result?.logPath || ''),
    validation: validation || payload.validation || { valid: false, message: '尚未校验。' },
    failureReason: payload.failureReason || defaults.failureReason || null,
    retry: { attempt: task.attempt, maxAttempts: task.maxAttempts, nextRetryAt: task.nextRetryAt || '', ...(payload.retry || {}) },
    metrics: { durationMs, estimatedCost: Number(payload.metrics?.estimatedCost || defaults.estimatedCost || 0), qualityScore: validation?.valid ? 100 : 0, ...(payload.metrics || {}) },
    completedAt,
    importedFrom: payload.importedFrom || defaults.importedFrom || '',
  };
}

function estimatedAdapterCost(adapterId, durationMs = 0) {
  const base = { internal: 0, manual: 0, qclaw: 0.1, openclaw: 0.2, codex: 0.4 }[String(adapterId || '')] ?? 0.2;
  return Number((base + Math.max(0, durationMs) / 3600000 * base).toFixed(4));
}

function validateTaskCompletion(task, startedAt = '', resultPayload = null) {
  if (task.kind === 'project_digest') {
    let domainSync;
    try { domainSync = JSON.parse(syncProjectDigestResult(task.sourceId)); }
    catch { domainSync = { ok: false, message: '项目消化结果同步失败。' }; }
    const status = String(domainSync?.digestState?.status || '');
    return { valid: Boolean(domainSync?.ok && ['completed', 'idle'].includes(status)), artifacts: [], checkedAt: taskNow(), message: domainSync?.message || '项目消化结果同步完成。', domainSync };
  }
  if (task.kind === 'student_digest') {
    let domainSync;
    try { domainSync = JSON.parse(syncStudentDigestResult(task.sourceId, { forceSubmitted: true })); }
    catch { domainSync = { ok: false, message: '学生消化结果同步失败。' }; }
    const status = String(domainSync?.state?.status || '');
    return { valid: Boolean(domainSync?.ok && ['completed', 'idle'].includes(status)), artifacts: [], checkedAt: taskNow(), message: domainSync?.message || domainSync?.state?.message || '学生消化结果同步完成。', domainSync };
  }
  return validateTaskArtifacts(task, startedAt, resultPayload);
}

function finalizeAdapterExecution(taskId, executionId, adapterId, code, output, errorOutput = '') {
  const store = readTaskStore();
  const task = store.tasks.find((item) => item.id === taskId);
  if (!task || task.executionId !== executionId || !['running', 'waiting_result'].includes(task.status)) return;
  const validation = Number(code) === 0
    ? validateTaskCompletion(task, task.startedAt)
    : { valid: false, artifacts: [], checkedAt: taskNow(), message: `Agent 退出码 ${code}。` };
  const successful = Number(code) === 0 && validation.valid;
  const result = normalizeTaskResult(task, {
    executionId,
    status: successful ? 'reviewing' : 'failed',
    adapterId,
    summary: Number(code) === 0 ? (validation.valid ? 'Agent 执行完成，等待审核。' : validation.message) : `Agent 退出码 ${code}。`,
    output: String(output || '').slice(-20000),
    errorOutput: String(errorOutput || '').slice(-10000),
    structuredOutput: validation.domainSync || null,
    artifacts: validation.artifacts,
    logReference: task.result?.logPath || '',
    failureReason: successful ? null : { category: Number(code) === 0 ? 'validation' : code === -1 ? 'launch' : 'process', code: `EXIT_${code}`, detail: String(errorOutput || validation.message || '').slice(-2000) },
  }, validation, { estimatedCost: estimatedAdapterCost(adapterId, task.startedAt ? Date.now() - Date.parse(task.startedAt) : 0) });
  const nextStatus = result.status;
  const retryDelayMs = Math.max(0, Number(task.retryBackoffSeconds || 0)) * 1000;
  const nextRetryAt = !successful && task.autoRetry !== false ? new Date(Date.now() + retryDelayMs).toISOString() : '';
  transitionTaskInStore(store, taskId, nextStatus, { result, nextRetryAt, error: nextStatus === 'failed' ? { code: `EXIT_${code}`, message: result.summary } : null, lastHeartbeatAt: taskNow() }, 'adapter_completed');
  writeTaskStore(store);
  notify('onNativeTaskCenterChanged', JSON.stringify({ taskId, status: nextStatus }));
  if (!successful && task.autoRetry !== false) setTimeout(() => fallbackTaskAfterFailure(taskId, adapterId, result.summary), Math.min(retryDelayMs, 30000) + 100);
}

function fallbackTaskAfterFailure(taskId, failedAdapter, reason = '') {
  try {
    const store = readTaskStore();
    const task = store.tasks.find((item) => item.id === String(taskId));
    if (!task || !['failed', 'timed_out', 'blocked'].includes(task.status)) return { ok: false, skipped: true };
    const attempted = [...new Set([...(task.routeAttempts || []), String(failedAdapter || '')].filter(Boolean))];
    const decision = routeTask(task, 'auto', attempted);
    const nextAdapter = selectFallbackAdapter(decision, attempted, task.attempt, task.maxAttempts);
    const retryAt = taskNow();
    const prepared = transitionTaskInStore(store, task.id, 'approved', {
      routeDecision: { ...decision, selectedAdapter: nextAdapter, reason: `${reason || '执行失败'}；自动降级为 ${adapterCapabilities()[nextAdapter]?.label || '人工执行'}。` },
      routeAttempts: attempted,
      nextRetryAt: retryAt,
      error: null,
      completedAt: '',
    }, 'runtime_fallback_prepared');
    if (!prepared.ok) return prepared;
    writeTaskStore(store);
    appendTaskEvent(task.id, 'runtime_fallback', { failedAdapter, nextAdapter, reason, attempt: task.attempt }, task.executionId);
    return JSON.parse(executeTaskByAdapter(task.id, nextAdapter));
  } catch (error) {
    appendTaskEvent(taskId, 'runtime_fallback_failed', { failedAdapter, reason, error: error.message });
    return { ok: false, message: error.message };
  }
}

function commandWrapperPath() {
  return path.join(__dirname, 'invoke-agent.ps1');
}

function ensureCommandWrapper() {
  const file = commandWrapperPath();
  if (!fs.existsSync(file)) throw new Error(`Agent 参数桥接器不存在：${file}`);
  return file;
}

function resolveNodeCommandShim(executable, args) {
  if (!/\.cmd$/i.test(executable) || !fs.existsSync(executable)) return null;
  const content = fs.readFileSync(executable, 'utf8');
  const match = content.match(/"%dp0%\\([^"\r\n]+\.(?:mjs|cjs|js))"\s+%\*/i);
  if (!match) return null;
  const script = path.resolve(path.dirname(executable), match[1].replace(/\\/g, path.sep));
  if (!fs.existsSync(script)) return null;
  const bundledNode = path.join(path.dirname(executable), 'node.exe');
  return { executable: fs.existsSync(bundledNode) ? bundledNode : process.execPath, args: [script, ...args] };
}

function spawnAdapterProcess(executable, args, options = {}) {
  const nodeShim = resolveNodeCommandShim(executable, args);
  if (nodeShim) return spawn(nodeShim.executable, nodeShim.args, { ...options, shell: false });
  if (/\.(cmd|bat|ps1)$/i.test(executable)) {
    const encodedArgs = Buffer.from(JSON.stringify(args), 'utf8').toString('base64');
    return spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ensureCommandWrapper(), '-Executable', executable, '-ArgsBase64', encodedArgs], { ...options, shell: false });
  }
  return spawn(executable, args, { ...options, shell: false });
}

function heartbeatTask(taskId, executionId, detail = '') {
  const running = taskChildProcesses.get(String(taskId));
  const now = Date.now();
  if (running && now - Number(running.lastHeartbeatWrite || 0) < 5000) return;
  const store = readTaskStore();
  const task = store.tasks.find((item) => item.id === String(taskId));
  if (!task || task.executionId !== String(executionId) || !['running', 'waiting_result'].includes(task.status)) return;
  task.lastHeartbeatAt = taskNow();
  task.updatedAt = task.lastHeartbeatAt;
  writeTaskStore(store);
  if (running) running.lastHeartbeatWrite = now;
  appendTaskEvent(task.id, 'adapter_heartbeat', { adapterId: task.adapterId, detail: String(detail || '').slice(0, 200) }, executionId);
}

function launchCommandAdapter(task, adapterId, executable, args, cwd, stdinText = '') {
  const store = readTaskStore();
  const executionId = `run-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const logDir = path.join(taskExecutionDirPath(), task.id);
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, `${executionId}.log`);
  const transition = transitionTaskInStore(store, task.id, 'running', { executionId, adapterId, executor: adapterId, executionMode: 'automatic', attempt: task.attempt + 1, startedAt: taskNow(), lastHeartbeatAt: taskNow(), error: null, result: { logPath } }, 'adapter_started');
  if (!transition.ok) return transition;
  writeTaskStore(store);
  fs.writeFileSync(logPath, `task: ${task.id}\nexecution: ${executionId}\nadapter: ${adapterId}\nstarted: ${taskNow()}\n\n`, 'utf8');
  const child = spawnAdapterProcess(executable, args, { cwd: cwd || taskCenterDirPath(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  taskChildProcesses.set(task.id, { child, executionId, adapterId, startedAt: taskNow(), lastHeartbeatWrite: Date.now() });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); fs.appendFileSync(logPath, chunk); heartbeatTask(task.id, executionId, 'stdout'); });
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); fs.appendFileSync(logPath, chunk); heartbeatTask(task.id, executionId, 'stderr'); });
  if (stdinText) child.stdin?.end(stdinText, 'utf8');
  else child.stdin?.end();
  child.on('error', (error) => {
    taskChildProcesses.delete(task.id);
    finalizeAdapterExecution(task.id, executionId, adapterId, -1, stdout, `${stderr}\n${error.message}`);
  });
  child.on('exit', (code) => {
    taskChildProcesses.delete(task.id);
    finalizeAdapterExecution(task.id, executionId, adapterId, Number(code), stdout, stderr);
  });
  return { ok: true, task: transition.task, executionId, logPath, message: `已通过 ${adapterId} 启动任务。` };
}

function submitOpenClawTask(task, command) {
  const capability = adapterCapabilities().openclaw;
  if (!capability.available || !capability.exePath) return { ok: false, unavailable: true, message: 'OpenClaw CLI 不可用。' };
  const sessionKey = `agent:main:edu-task-${task.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(-40)}`;
  const modeArgs = capability.gatewayHealthy ? [] : ['--local'];
  return launchCommandAdapter(task, 'openclaw', capability.exePath, ['agent', ...modeArgs, '--message', command, '--json', '--timeout', String(task.timeoutSeconds), '--session-key', sessionKey], task.input?.knowledgeRoot || taskCenterDirPath());
}

function submitCodexTask(task, command) {
  const capability = adapterCapabilities().codex;
  if (!capability.available || !capability.exePath) return { ok: false, unavailable: true, message: 'Codex CLI 不可用。' };
  const cwd = canonicalTaskPath(task.input?.knowledgeRoot || (task.sourceType === 'project' ? readProjects().map(normalizeProject).find((item) => String(item.id) === task.sourceId)?.knowledgeRootPath : '') || taskCenterDirPath());
  const writableRoots = [...new Set((task.permissions?.write || []).map(canonicalTaskPath).filter(Boolean))];
  const addDirArgs = writableRoots.filter((root) => !taskPathWithin(root, cwd)).flatMap((root) => ['--add-dir', root]);
  const args = ['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', '--ephemeral', '-C', cwd, ...addDirArgs, '-'];
  return launchCommandAdapter(task, 'codex', capability.exePath, args, cwd, command);
}

function submitQClawTask(task, command) {
  const store = readTaskStore();
  const executionId = `qclaw-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const transition = transitionTaskInStore(store, task.id, 'waiting_result', { executionId, adapterId: 'qclaw', executor: 'qclaw', executionMode: 'inbox', attempt: task.attempt + 1, startedAt: taskNow(), lastHeartbeatAt: taskNow(), result: null }, 'qclaw_inbox_prepared');
  if (!transition.ok) return transition;
  const packet = writeTaskPacket(transition.task, qclawTaskInboxPath(), command);
  transition.task.result = normalizeTaskResult(transition.task, { executionId, status: 'waiting_result', artifacts: [] }, null, { summary: '任务已写入 QClaw 收件箱。' });
  transition.task.result.packet = packet;
  writeTaskStore(store);
  appendTaskEvent(task.id, 'qclaw_inbox_written', { executionId, packet }, executionId);
  return transition.ok ? { ok: true, task: transition.task, packet, message: '任务已写入 QClaw 任务收件箱，等待领取和结果回写。' } : transition;
}

function submitManualTask(task, command, reason = '') {
  const store = readTaskStore();
  const executionId = `manual-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const transition = transitionTaskInStore(store, task.id, 'waiting_result', {
    executionId,
    adapterId: 'manual',
    executor: 'manual',
    executionMode: 'manual',
    attempt: task.attempt + 1,
    startedAt: taskNow(),
    lastHeartbeatAt: taskNow(),
    result: null,
  }, 'manual_execution_prepared');
  if (transition.ok) {
    const packet = writeTaskPacket(transition.task, taskManualOutboxPath(), command);
    clipboard.writeText(command);
    transition.task.result = normalizeTaskResult(transition.task, { executionId, status: 'manual_required', artifacts: [] }, null, { summary: '任务已降级为人工执行。' });
    transition.task.result.packet = packet;
    writeTaskStore(store);
    appendTaskEvent(task.id, 'manual_packet_exported', { executionId, packet }, executionId);
    return { ok: true, task: transition.task, packet, command, fallback: true, message: `${reason || '任务已转为人工执行。'}任务指令已复制，并导出人工任务包。` };
  }
  return transition;
}

function submitInternalTask(task) {
  const store = readTaskStore();
  const executionId = `internal-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const transition = transitionTaskInStore(store, task.id, 'running', { executionId, adapterId: 'internal', executor: 'internal', executionMode: 'internal', attempt: task.attempt + 1, startedAt: taskNow(), lastHeartbeatAt: taskNow(), error: null }, 'internal_operation_started');
  if (!transition.ok) return transition;
  writeTaskStore(store);
  const context = { taskId: task.id, executionId };
  let operationResult;
  if (task.input?.operation === 'execute_archive_plan') operationResult = JSON.parse(performProjectPromotionPlan(task.sourceId, JSON.stringify(task.input?.plan || {}), context));
  else if (task.input?.operation === 'publish_growth_evidence') operationResult = JSON.parse(performPublishProjectPromotion(task.sourceId, context));
  else if (task.input?.operation === 'rollback_promotion') operationResult = JSON.parse(performRollbackProjectPromotionRun(task.sourceId, task.input?.runId, context));
  else operationResult = { ok: false, message: `未知内部操作：${task.input?.operation || '-'}` };
  const nextStore = readTaskStore();
  const current = nextStore.tasks.find((item) => item.id === task.id);
  const changedPaths = [...new Set([
    ...(operationResult.results || []).map((item) => item.target),
    ...(operationResult.published || []).flatMap((item) => [item.growthDir, item.projectSummaryFile]),
    operationResult.executionLog,
    operationResult.path,
  ].filter(Boolean))];
  const artifacts = changedPaths.map((file) => ({ path: file, exists: fs.existsSync(file), size: fs.existsSync(file) && fs.statSync(file).isFile() ? fs.statSync(file).size : 0, modifiedAt: fs.existsSync(file) ? fs.statSync(file).mtime.toISOString() : '' }));
  const validation = { valid: Boolean(operationResult.ok), artifacts, checkedAt: taskNow(), message: operationResult.message || (operationResult.ok ? '内部操作校验通过。' : '内部操作失败。') };
  const result = normalizeTaskResult(current || transition.task, { status: operationResult.ok ? 'reviewing' : 'failed', structuredOutput: operationResult, artifacts, fileChanges: changedPaths.map((file) => ({ path: file, operation: 'created_or_updated' })) }, validation, { adapterId: 'internal', executionId, summary: operationResult.message });
  const nextStatus = operationResult.ok ? 'reviewing' : 'failed';
  const completed = transitionTaskInStore(nextStore, task.id, nextStatus, { result, lastHeartbeatAt: taskNow(), error: operationResult.ok ? null : { code: 'INTERNAL_OPERATION_FAILED', message: operationResult.message || '内部操作失败。' } }, 'internal_operation_completed');
  writeTaskStore(nextStore);
  notify('onNativeTaskCenterChanged', JSON.stringify({ taskId: task.id, status: nextStatus }));
  return { ...completed, message: operationResult.ok ? '内部操作已执行，等待结果审核。' : operationResult.message };
}

function getAgentExecutionAdapters() {
  const common = { status: adapterTaskStatus, readResult: adapterTaskResult };
  return {
    internal: { ...common, id: 'internal', capabilities: () => adapterCapabilities().internal, submit: (task, command) => submitInternalTask(task, command), cancel: () => ({ ok: false, message: '内部同步操作不可中途取消。' }), health: () => adapterCapabilities().internal },
    openclaw: { ...common, id: 'openclaw', capabilities: () => adapterCapabilities().openclaw, submit: (task, command) => submitOpenClawTask(task, command), cancel: (task) => cancelRunningAdapterTask(task.id), health: () => adapterCapabilities(true).openclaw },
    codex: { ...common, id: 'codex', capabilities: () => adapterCapabilities().codex, submit: (task, command) => submitCodexTask(task, command), cancel: (task) => cancelRunningAdapterTask(task.id), health: () => adapterCapabilities(true).codex },
    qclaw: { ...common, id: 'qclaw', capabilities: () => adapterCapabilities().qclaw, submit: (task, command) => submitQClawTask(task, command), cancel: () => ({ ok: false, message: 'QClaw 收件箱任务需要在 QClaw 侧停止。' }), health: () => adapterCapabilities(true).qclaw },
    manual: { ...common, id: 'manual', capabilities: () => adapterCapabilities().manual, submit: (task, command, context = {}) => submitManualTask(task, command, context.reason), cancel: () => ({ ok: true }), health: () => adapterCapabilities().manual },
  };
}

function cancelRunningAdapterTask(taskId) {
  const running = taskChildProcesses.get(String(taskId));
  if (!running?.child || running.child.killed) return { ok: false, message: '没有正在运行的进程。' };
  running.child.kill();
  taskChildProcesses.delete(String(taskId));
  return { ok: true };
}

function adapterTaskStatus(task) {
  const running = taskChildProcesses.get(String(task?.id || ''));
  return { ok: true, taskId: task?.id || '', status: running?.child && !running.child.killed ? 'running' : task?.status || 'unknown', executionId: task?.executionId || '', lastHeartbeatAt: task?.lastHeartbeatAt || '' };
}

function adapterTaskResult(task) {
  return { ok: Boolean(task?.result), taskId: task?.id || '', result: task?.result || null };
}

function executeTaskByAdapter(taskId, requestedExecutor = '') {
  try {
    const store = readTaskStore();
    const task = store.tasks.find((item) => String(item.id) === String(taskId));
    if (!task) return JSON.stringify({ ok: false, message: '未找到任务。' });
    const permissionCheck = validateTaskPermissionDeclaration(task);
    if (!permissionCheck.ok) return JSON.stringify({ ok: false, blocked: true, message: permissionCheck.message });
    if (['running', 'waiting_result'].includes(task.status)) return JSON.stringify({ ok: false, message: '任务已经在执行或等待结果。' });
    if (taskRequiresApproval(task) && task.approval?.status !== 'approved') return JSON.stringify({ ok: false, approvalRequired: true, message: '该任务属于高风险操作，必须先审批。' });
    if (['draft', 'pending', 'failed', 'blocked', 'timed_out', 'cancelled'].includes(task.status)) {
      const approvalStatus = taskRequiresApproval(task) ? task.approval?.status : 'not_required';
      const transition = transitionTaskInStore(store, task.id, 'approved', { approval: { ...(task.approval || {}), required: taskRequiresApproval(task), status: approvalStatus } }, 'task_prepared');
      if (!transition.ok) return JSON.stringify(transition);
      writeTaskStore(store);
    }
    const refreshed = readTaskStore().tasks.find((item) => item.id === task.id);
    if (refreshed.kind === 'project_digest') {
      const project = readProjects().map(normalizeProject).find((item) => String(item.id) === refreshed.sourceId);
      if (project) {
        const ensured = ensureProjectWorkspace(project);
        const currentDigest = readProjectDigestState(ensured);
        if (currentDigest.pendingCount > 0 && !['submitted', 'digesting'].includes(currentDigest.status)) {
          const batchId = `task-digest-${timestampForFilename()}`;
          const digestState = writeProjectDigestState(ensured, {
            status: 'submitted',
            digestSubmittedAt: taskNow(),
            digestBatchId: batchId,
            submittedFiles: (currentDigest.pendingFiles || []).map((file) => ({ relativePath: file.relativePath, path: file.path, sha1: file.sha1, size: file.size })),
            message: '项目资料消化已由统一任务中心提交。',
          });
          updateProjectRecord(project.id, (item) => ({ ...item, digestState, updatedAt: taskNow() }));
        }
      }
    }
    const routeDecision = routeTask(refreshed, requestedExecutor);
    if (routeDecision.confirmationRequired) {
      const confirmStore = readTaskStore();
      const confirmTask = confirmStore.tasks.find((item) => item.id === refreshed.id);
      Object.assign(confirmTask, { routeDecision, routingMode: 'confirm', updatedAt: taskNow() });
      writeTaskStore(confirmStore);
      return JSON.stringify({ ok: true, confirmationRequired: true, task: confirmTask, routeDecision, message: `${routeDecision.reason}请在执行器下拉框中确认具体执行器。` });
    }
    const adapterId = routeDecision.selectedAdapter;
    const command = taskCommandFor(refreshed);
    const nextStore = readTaskStore();
    const taskIndex = nextStore.tasks.findIndex((item) => item.id === refreshed.id);
    nextStore.tasks[taskIndex] = normalizeTaskEnvelope({ ...refreshed, routeDecision, routingMode: routeDecision.mode, adapterId, executor: adapterId, executionMode: adapterId === 'internal' ? 'internal' : adapterId === 'manual' ? 'manual' : adapterId === 'qclaw' ? 'inbox' : 'automatic', routeAttempts: [...new Set([...(refreshed.routeAttempts || []), adapterId])] }, refreshed);
    writeTaskStore(nextStore);
    const routedTask = readTaskStore().tasks.find((item) => item.id === refreshed.id);
    const adapter = getAgentExecutionAdapters()[adapterId] || getAgentExecutionAdapters().manual;
    const capability = adapter.capabilities();
    const selectedAdapter = capability.available && capability.authorized ? adapter : getAgentExecutionAdapters().manual;
    const result = selectedAdapter.submit(routedTask, command, { reason: selectedAdapter.id === adapterId ? routeDecision.reason : `${routeDecision.reason}所选适配器当前不可用，已降级。` });
    return JSON.stringify(result);
  } catch (error) {
    return JSON.stringify({ ok: false, message: `执行任务失败：${error.message}` });
  }
}

function approveTask(taskId, decision, note = '') {
  try {
    const store = readTaskStore();
    const task = store.tasks.find((item) => item.id === String(taskId));
    if (!task) return JSON.stringify({ ok: false, message: '未找到任务。' });
    const approved = String(decision) === 'approved';
    if (task.status === 'reviewing') {
      if (!approved) {
        const rejected = transitionTaskInStore(store, task.id, 'failed', { approval: { required: true, status: 'rejected', note, reviewedAt: taskNow(), reviewedBy: 'local-user' }, error: { code: 'REVIEW_REJECTED', message: note || '任务结果审核未通过。' } }, 'result_rejected');
        writeTaskStore(store);
        return JSON.stringify({ ...rejected, message: '任务结果已驳回，可修正后重试。' });
      }
      if (task.kind === 'daily_action') {
        const approvalValidation = validateTaskCompletion(task, task.startedAt, task.result);
        if (!approvalValidation.valid) return JSON.stringify({ ok: false, message: `草稿复核失败，不能发布：${approvalValidation.message}` });
        const draftPath = task.expectedOutput?.draftPath;
        const publishPath = task.expectedOutput?.publishPath;
        if (!draftPath || !publishPath || !fs.existsSync(draftPath)) return JSON.stringify({ ok: false, message: '每日行动建议草稿不存在，不能发布。' });
        fs.mkdirSync(path.dirname(publishPath), { recursive: true });
        const draft = fs.readFileSync(draftPath, 'utf8');
        const today = String(task.input?.date || taskToday());
        let published = draft;
        if (/^---\s*$/m.test(published)) {
          published = /^status:\s*.*$/im.test(published)
            ? published.replace(/^status:\s*.*$/im, 'status: published')
            : published.replace(/^---\s*$/m, '---\nstatus: published');
          published = /^updated:\s*.*$/im.test(published)
            ? published.replace(/^updated:\s*.*$/im, `updated: ${today}`)
            : published.replace(/^---\s*$/m, `---\nupdated: ${today}`);
        } else {
          published = `---\ntype: daily_action\ntarget: 学生 / 家长 / 教师\nupdated: ${today}\nstatus: published\n---\n\n${published}`;
        }
        fs.writeFileSync(publishPath, published, 'utf8');
      }
      const accepted = transitionTaskInStore(store, task.id, 'succeeded', { approval: { required: true, status: 'approved', note, reviewedAt: taskNow(), reviewedBy: 'local-user' }, result: { ...(task.result || {}), publishedAt: taskNow(), reviewNote: note } }, 'result_approved');
      writeTaskStore(store);
      return JSON.stringify({ ...accepted, message: '任务结果已审核并发布。' });
    }
    const nextApproval = { required: taskRequiresApproval(task), status: approved ? 'approved' : 'rejected', note: String(note || ''), reviewedAt: taskNow(), reviewedBy: 'local-user' };
    if (!approved) {
      const rejected = transitionTaskInStore(store, task.id, 'cancelled', { approval: nextApproval }, 'execution_rejected');
      writeTaskStore(store);
      return JSON.stringify({ ...rejected, message: '任务执行申请已拒绝。' });
    }
    const nextStatus = task.status === 'pending' ? 'approved' : task.status;
    const accepted = transitionTaskInStore(store, task.id, nextStatus, { approval: nextApproval }, 'execution_approved');
    writeTaskStore(store);
    return JSON.stringify({ ...accepted, message: '任务已批准，可以执行。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `审批任务失败：${error.message}` });
  }
}

function retryTask(taskId) {
  try {
    const store = readTaskStore();
    const task = store.tasks.find((item) => item.id === String(taskId));
    if (!task) return JSON.stringify({ ok: false, message: '未找到任务。' });
    if (!['failed', 'blocked', 'timed_out', 'cancelled'].includes(task.status)) return JSON.stringify({ ok: false, message: '只有失败、阻塞、超时或已取消任务可以重试。' });
    if (task.attempt >= task.maxAttempts) return JSON.stringify({ ok: false, message: `已达到最大重试次数 ${task.maxAttempts}。` });
    const transition = transitionTaskInStore(store, task.id, 'pending', { error: null, result: null, executionId: '', adapterId: '', routeAttempts: [], nextRetryAt: '', completedAt: '' }, 'task_retried');
    writeTaskStore(store);
    return JSON.stringify({ ...transition, message: '任务已重置为待处理。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `重试任务失败：${error.message}` });
  }
}

function cancelTask(taskId, note = '') {
  try {
    const store = readTaskStore();
    const task = store.tasks.find((item) => item.id === String(taskId));
    const adapter = task ? getAgentExecutionAdapters()[task.adapterId] : null;
    if (adapter?.cancel) adapter.cancel(task);
    const transition = transitionTaskInStore(store, String(taskId), 'cancelled', { error: { code: 'CANCELLED', message: String(note || '用户取消任务。') } }, 'task_cancelled');
    if (transition.ok) writeTaskStore(store);
    return JSON.stringify({ ...transition, message: transition.ok ? '任务已取消。' : transition.message });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `取消任务失败：${error.message}` });
  }
}

function importTaskResult(taskId) {
  try {
    const selected = dialog.showOpenDialogSync(mainWindow, { title: '导入 Agent 任务结果', properties: ['openFile'], filters: [{ name: 'TaskResult JSON', extensions: ['json'] }] });
    if (!selected?.[0]) return JSON.stringify({ ok: false, message: '未选择结果文件。' });
    const payload = safeReadJson(selected[0], null);
    const store = readTaskStore();
    const task = store.tasks.find((item) => item.id === String(taskId));
    const identity = validateExternalTaskResultIdentity(task, payload);
    if (!identity.ok) {
      appendTaskEvent(taskId, 'external_result_rejected', { source: 'manual_import', file: selected[0], code: identity.code, message: identity.message }, task?.executionId || '');
      return JSON.stringify({ ok: false, rejected: true, code: identity.code, message: identity.message });
    }
    const validation = validateTaskCompletion(task, task.startedAt, payload);
    const nextStatus = payload.status === 'failed' || !validation.valid ? 'failed' : 'reviewing';
    const result = normalizeTaskResult(task, { ...payload, importedFrom: selected[0], status: nextStatus }, validation, { importedFrom: selected[0] });
    const transition = transitionTaskInStore(store, task.id, nextStatus, { result, error: nextStatus === 'failed' ? { code: 'RESULT_INVALID', message: payload.message || validation.message } : null }, 'task_result_imported');
    writeTaskStore(store);
    return JSON.stringify({ ...transition, message: nextStatus === 'reviewing' ? '结果已导入，等待审核。' : '结果已导入，但校验未通过。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `导入任务结果失败：${error.message}` });
  }
}

function quarantineQClawPayload(file, reason) {
  const rejectedDir = path.join(qclawTaskResultPath(), 'rejected');
  fs.mkdirSync(rejectedDir, { recursive: true });
  const parsed = path.parse(file);
  const nonce = crypto.randomBytes(3).toString('hex');
  const target = path.join(rejectedDir, `${parsed.name}-${timestampForFilename()}-${nonce}${parsed.ext}`);
  fs.renameSync(file, target);
  writeJsonFile(`${target}.reason.json`, { rejectedAt: taskNow(), source: file, reason });
  return target;
}

function syncQClawTaskResults() {
  try {
    fs.mkdirSync(qclawTaskResultPath(), { recursive: true });
    const claimFiles = fs.readdirSync(qclawTaskResultPath()).filter((name) => name.endsWith('.claim.json'));
    const files = fs.readdirSync(qclawTaskResultPath()).filter((name) => name.endsWith('.result.json'));
    const store = readTaskStore();
    let imported = 0;
    let claimed = 0;
    let rejected = 0;
    for (const name of claimFiles) {
      const file = path.join(qclawTaskResultPath(), name);
      const payload = safeReadJson(file, null);
      const task = store.tasks.find((item) => item.id === String(payload?.taskId || ''));
      const identity = validateExternalTaskResultIdentity(task, payload, { allowedStatuses: ['waiting_result'] });
      if (!identity.ok) {
        const rejectedPath = quarantineQClawPayload(file, identity);
        appendTaskEvent(payload?.taskId || '', 'qclaw_claim_rejected', { code: identity.code, message: identity.message, rejectedPath }, task?.executionId || '');
        rejected += 1;
        continue;
      }
      if (task.result?.claimFile === file) continue;
      const transition = transitionTaskInStore(store, task.id, 'running', { lastHeartbeatAt: taskNow(), result: { ...(task.result || {}), claimFile: file, claimedBy: payload.agentId || 'qclaw', claimedAt: payload.claimedAt || taskNow() } }, 'qclaw_task_claimed');
      if (transition.ok) claimed += 1;
    }
    for (const name of files) {
      const file = path.join(qclawTaskResultPath(), name);
      const payload = safeReadJson(file, null);
      const task = store.tasks.find((item) => item.id === String(payload?.taskId || ''));
      const identity = validateExternalTaskResultIdentity(task, payload);
      if (!identity.ok) {
        const rejectedPath = quarantineQClawPayload(file, identity);
        appendTaskEvent(payload?.taskId || '', 'qclaw_result_rejected', { code: identity.code, message: identity.message, rejectedPath }, task?.executionId || '');
        rejected += 1;
        continue;
      }
      if (task.result?.resultFile === file) continue;
      const validation = validateTaskCompletion(task, task.startedAt, payload);
      const nextStatus = payload.status === 'failed' || !validation.valid ? 'failed' : 'reviewing';
      const result = normalizeTaskResult(task, { ...payload, resultFile: file, status: nextStatus }, validation, { importedFrom: file });
      result.resultFile = file;
      const transition = transitionTaskInStore(store, task.id, nextStatus, { result, error: nextStatus === 'failed' ? { code: 'QCLAW_RESULT_INVALID', message: payload.message || validation.message } : null }, 'qclaw_result_synced');
      if (transition.ok) imported += 1;
    }
    writeTaskStore(store);
    return JSON.stringify({ ok: true, claimed, imported, rejected, inboxPath: qclawTaskInboxPath(), resultPath: qclawTaskResultPath(), message: imported || claimed || rejected ? `QClaw 同步完成：领取 ${claimed} 项，结果 ${imported} 项，拒绝过期或无效包 ${rejected} 项。` : '没有新的 QClaw 任务领取或结果。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `同步 QClaw 结果失败：${error.message}` });
  }
}

function submitDailyActionFeedback(taskId, status, note = '') {
  try {
    const store = readTaskStore();
    const task = store.tasks.find((item) => item.id === String(taskId));
    if (!task || task.kind !== 'daily_action') return JSON.stringify({ ok: false, message: '未找到每日行动建议任务。' });
    if (task.status !== 'succeeded') return JSON.stringify({ ok: false, message: '每日行动建议尚未审核发布，不能提交完成反馈。' });
    const normalizedStatus = String(status || 'completed');
    if (!['completed', 'partial', 'skipped'].includes(normalizedStatus)) return JSON.stringify({ ok: false, message: '反馈状态只能是 completed、partial 或 skipped。' });
    const student = readStudentsIndex().find((item) => String(item.id) === task.sourceId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const normalized = toHostStudent(student);
    const feedbackDate = String(task.input?.date || taskToday());
    const entries = readDailyActionFeedback(normalized).filter((entry) => !(String(entry.taskId || '') === task.id && String(entry.date || '') === feedbackDate));
    entries.unshift({ taskId: task.id, date: feedbackDate, status: normalizedStatus, note: String(note || ''), submittedAt: taskNow() });
    writeJsonFile(dailyActionFeedbackPath(normalized), { version: 1, updatedAt: taskNow(), entries: entries.slice(0, 90) });
    appendTaskEvent(task.id, 'daily_action_feedback', { status: normalizedStatus, note, date: feedbackDate });
    return JSON.stringify({ ok: true, message: '完成反馈已保存，将作为下一次每日行动建议的输入。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `保存行动反馈失败：${error.message}` });
  }
}

function enforceTaskTimeouts(store) {
  const now = Date.now();
  let changed = false;
  for (const task of store.tasks) {
    if (!['running', 'waiting_result'].includes(task.status) || !task.startedAt) continue;
    const heartbeatAt = Date.parse(task.lastHeartbeatAt || task.startedAt);
    const executionTimeoutAt = Date.parse(task.startedAt) + Number(task.timeoutSeconds || 900) * 1000;
    const heartbeatTimeoutAt = heartbeatAt + Number(task.heartbeatTimeoutSeconds || task.timeoutSeconds || 900) * 1000;
    const timeoutAt = Math.min(executionTimeoutAt, heartbeatTimeoutAt);
    if (now <= timeoutAt) continue;
    const running = taskChildProcesses.get(task.id);
    if (running?.child && !running.child.killed) {
      try { running.child.kill(); } catch { /* Timeout state still applies. */ }
      taskChildProcesses.delete(task.id);
    }
    const heartbeatLost = heartbeatTimeoutAt <= executionTimeoutAt;
    const error = { code: heartbeatLost ? 'HEARTBEAT_LOST' : 'TASK_TIMEOUT', message: heartbeatLost ? `任务超过 ${task.heartbeatTimeoutSeconds} 秒没有心跳。` : `任务超过 ${task.timeoutSeconds} 秒未完成。` };
    const nextRetryAt = task.autoRetry !== false ? new Date(now + Number(task.retryBackoffSeconds || 0) * 1000).toISOString() : '';
    const transition = transitionTaskInStore(store, task.id, 'timed_out', { error, nextRetryAt }, heartbeatLost ? 'task_heartbeat_lost' : 'task_timed_out');
    if (transition.ok) {
      changed = true;
      if (task.autoRetry !== false) setTimeout(() => fallbackTaskAfterFailure(task.id, task.adapterId, error.message), Math.min(Number(task.retryBackoffSeconds || 0) * 1000, 30000) + 100);
    }
  }
  return changed;
}

function getTaskCenterCapabilities() {
  const adapters = adapterCapabilities();
  const automationEnabled = taskAutomationEnabled();
  return JSON.stringify({ ok: true, protocolVersion: TASK_PROTOCOL_VERSION, adapters, automationEnabled, executionMode: automationEnabled ? 'automatic' : 'manual', qclawInboxPath: qclawTaskInboxPath(), qclawResultPath: qclawTaskResultPath(), taskStorePath: taskStorePath() });
}

function isManagedOpenClawCronJob(job) {
  const name = String(job?.name || '');
  const owner = String(job?.metadata?.owner || job?.payload?.metadata?.owner || '');
  return /^\[教育管家\]/.test(name) || owner === 'edu-manager';
}

function managedOpenClawCronDefinition(job) {
  const payload = job?.payload || {};
  const schedule = job?.schedule || payload.schedule || {};
  const command = String(payload.message || payload.command || job?.message || job?.command || '');
  const permissions = payload.permissions || job?.permissions || {};
  const expectedOutput = payload.expectedOutput || job.expectedOutput || {};
  const declaredTimezone = String(schedule?.tz || schedule?.timezone || '');
  const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const reads = Array.isArray(permissions.read) ? permissions.read.filter((item) => path.isAbsolute(String(item))) : [];
  const writes = Array.isArray(permissions.write) ? permissions.write.filter((item) => path.isAbsolute(String(item))) : [];
  if (!job?.id || !command || !cronOccurrence(schedule) || (declaredTimezone && declaredTimezone !== localTimezone) || (!reads.length && !writes.length) || !(expectedOutput.path || expectedOutput.draftPath)) return null;
  return {
    id: String(job.id),
    name: String(job.name || job.id),
    schedule,
    command,
    permissions: { read: reads, write: writes, operations: ['execute_scheduled_task'] },
    expectedOutput,
    adoptedAt: taskNow(),
    source: 'openclaw_cron',
  };
}

function readManagedOpenClawCronRegistry() {
  const parsed = safeReadJson(openClawCronRegistryPath(), {});
  return { version: 1, updatedAt: String(parsed.updatedAt || ''), jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [] };
}

function writeManagedOpenClawCronRegistry(registry) {
  writeJsonFile(openClawCronRegistryPath(), { version: 1, updatedAt: taskNow(), jobs: registry.jobs || [] });
}

function managedOpenClawCronCandidates(registry, now = Date.now()) {
  return (registry.jobs || []).map((job) => {
    const occurrence = cronOccurrence(job.schedule, now);
    if (!occurrence) return null;
    return normalizeTaskEnvelope({
      id: taskStableId('openclaw_cron', 'system', job.id, occurrence.key),
      title: `OpenClaw 定时任务：${job.name}`,
      kind: 'openclaw_cron',
      sourceType: 'system',
      sourceId: job.id,
      sourceName: 'OpenClaw Cron（任务中心托管）',
      status: 'pending',
      trigger: 'schedule',
      executor: 'openclaw',
      requestedExecutor: 'auto',
      executionMode: 'adapter',
      scheduledAt: occurrence.scheduledAt,
      scheduleKey: occurrence.key,
      idempotencyKey: `openclaw_cron:${job.id}:${occurrence.key}`,
      input: { command: job.command, externalSchedule: job.schedule, importedFrom: 'openclaw_cron', adopted: true },
      expectedOutput: job.expectedOutput || { type: 'external_schedule_event' },
      permissions: job.permissions,
      detail: 'OpenClaw 原定时任务已停用，由统一任务中心按原计划生成执行批次并统一审核。',
      action: 'openclaw_cron',
    });
  }).filter(Boolean);
}

function syncOpenClawCronTasks(force = false) {
  if (!taskAutomationEnabled()) return Promise.resolve({ ok: true, skipped: true, message: '仅手动模式未执行 OpenClaw Cron 同步。' });
  if (openClawCronSyncState.promise) return openClawCronSyncState.promise;
  if (!force && openClawCronSyncState.result && Date.now() - openClawCronSyncState.at < 10 * 60 * 1000) return Promise.resolve({ ...openClawCronSyncState.result, throttled: true });
  const promise = (async () => {
    const capability = adapterCapabilities().openclaw;
    const registry = readManagedOpenClawCronRegistry();
    let adopted = 0;
    let observed = 0;
    let probeMessage = '';
    if (capability.healthPending) {
      await refreshAdapterCapabilities(true);
    }
    if (!taskAutomationEnabled()) {
      const result = { ok: true, skipped: true, message: '同步过程中切换为仅手动模式，未接管 OpenClaw Cron。' };
      openClawCronSyncState = { at: Date.now(), promise: null, result };
      return result;
    }
    const refreshedCapability = adapterCapabilities().openclaw;
    if (refreshedCapability.cron && refreshedCapability.gatewayHealthy && refreshedCapability.exePath) {
      const probe = await probeExecutableAsync(refreshedCapability.exePath, ['cron', 'list', '--all', '--json', '--timeout', '5000'], 7000);
      if (probe.ok) {
        try {
          const parsed = JSON.parse(probe.output);
          const jobs = Array.isArray(parsed) ? parsed : Array.isArray(parsed.jobs) ? parsed.jobs : [];
          const byId = new Map(registry.jobs.map((job) => [String(job.id), job]));
          for (const job of jobs) {
            if (!isManagedOpenClawCronJob(job)) { observed += 1; continue; }
            const definition = managedOpenClawCronDefinition(job);
            if (!definition) {
              appendTaskEvent('', 'openclaw_cron_adoption_rejected', { jobId: job.id, name: job.name, reason: '托管任务必须提供命令、受支持且与本机一致的时区、绝对读写权限和明确产物路径。' });
              continue;
            }
            byId.set(definition.id, { ...(byId.get(definition.id) || {}), ...definition });
            registry.jobs = [...byId.values()];
            writeManagedOpenClawCronRegistry(registry);
            if (job.enabled !== false) {
              const disabled = await probeExecutableAsync(refreshedCapability.exePath, ['cron', 'disable', definition.id, '--timeout', '5000'], 7000);
              if (!disabled.ok) {
                appendTaskEvent('', 'openclaw_cron_adoption_failed', { jobId: definition.id, message: disabled.output || disabled.error || '停用外部 Cron 失败。' });
                byId.delete(definition.id);
                registry.jobs = [...byId.values()];
                writeManagedOpenClawCronRegistry(registry);
                continue;
              }
            }
            adopted += 1;
          }
          registry.jobs = [...byId.values()];
          writeManagedOpenClawCronRegistry(registry);
        } catch {
          probeMessage = 'OpenClaw Cron 返回的不是有效 JSON。';
        }
      } else {
        probeMessage = probe.error || probe.output || '读取 OpenClaw Cron 失败。';
      }
    } else {
      probeMessage = 'OpenClaw Gateway/Cron 当前不可用，继续使用已接管的任务中心计划。';
    }
    const candidates = managedOpenClawCronCandidates(registry);
    if (candidates.length) upsertTaskCandidates(candidates);
    const result = { ok: true, adopted, observed, count: candidates.length, registryPath: openClawCronRegistryPath(), message: `任务中心托管 ${registry.jobs.length} 个 OpenClaw Cron，生成 ${candidates.length} 个当前执行批次。${probeMessage ? ` ${probeMessage}` : ''}` };
    openClawCronSyncState = { at: Date.now(), promise: null, result };
    return result;
  })().catch((error) => {
    const result = { ok: false, message: `OpenClaw Cron 同步失败：${error.message}` };
    openClawCronSyncState = { at: Date.now(), promise: null, result };
    return result;
  });
  openClawCronSyncState.promise = promise;
  return promise;
}

function openTaskCenterPath(kind = 'root') {
  try {
    const target = kind === 'qclaw-inbox' ? qclawTaskInboxPath()
      : kind === 'qclaw-results' ? qclawTaskResultPath()
        : kind === 'manual-outbox' ? taskManualOutboxPath()
          : kind === 'events' ? taskEventLogPath()
            : taskCenterDirPath();
    const folder = path.extname(target) ? path.dirname(target) : target;
    fs.mkdirSync(folder, { recursive: true });
    shell.openPath(folder);
    return JSON.stringify({ ok: true, path: folder, message: `已打开 ${folder}` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `打开任务目录失败：${error.message}` });
  }
}

function scheduledTimeReached(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return true;
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes() >= Number(match[1]) * 60 + Number(match[2]);
}

async function runUnifiedTaskScheduler() {
  if (taskSchedulerRunning) return { ok: true, skipped: true, message: '上一轮统一任务调度仍在运行。' };
  if (!taskAutomationEnabled()) return { ok: true, skipped: true, message: '当前为仅手动模式，未运行自动调度。' };
  taskSchedulerRunning = true;
  try {
    if (!publicLicenseStatus().active) return { ok: false, skipped: true, message: '许可证未激活，自动任务未执行。' };
    runProjectAutomationSweep();
    syncQClawTaskResults();
    await syncOpenClawCronTasks();
    if (!taskAutomationEnabled()) return { ok: true, skipped: true, message: '调度过程中已切换为仅手动模式，未启动新任务。' };
    const store = upsertTaskCandidates(buildTaskCenterCandidates());
    if (enforceTaskTimeouts(store)) writeTaskStore(store);
    const retryDue = readTaskStore().tasks.filter((task) => ['failed', 'timed_out', 'blocked'].includes(task.status)
      && task.autoRetry !== false
      && task.nextRetryAt
      && Date.parse(task.nextRetryAt) <= Date.now());
    for (const task of retryDue) fallbackTaskAfterFailure(task.id, task.adapterId, task.error?.message || '计划重试');
    const due = readTaskStore().tasks.filter((task) => ['daily_action', 'openclaw_cron'].includes(task.kind)
      && ['pending', 'approved', 'queued'].includes(task.status)
      && Number(task.attempt || 0) === 0
      && (task.kind === 'openclaw_cron' ? Date.parse(task.scheduledAt || '') <= Date.now() : scheduledTimeReached(task.scheduledAt)));
    const results = due.map((task) => {
      try { return JSON.parse(executeTaskByAdapter(task.id, 'auto')); }
      catch (error) { return { ok: false, taskId: task.id, message: error.message }; }
    });
    if (results.length) appendHostTimeline({ type: 'unified_task_scheduler', title: 'Unified task scheduler', detail: `due tasks ${results.length}`, count: results.length });
    notify('onNativeTaskCenterChanged', JSON.stringify({ scheduled: results.length, at: taskNow() }));
    return { ok: true, results, message: results.length ? `已调度 ${results.length} 个到期任务。` : '当前没有到期的统一任务。' };
  } catch (error) {
    return { ok: false, message: `统一任务调度失败：${error.message}` };
  } finally {
    taskSchedulerRunning = false;
  }
}

function startUnifiedTaskScheduler() {
  stopUnifiedTaskScheduler();
  if (process.env.EDU_DISABLE_TASK_SCHEDULER === '1' || !taskAutomationEnabled()) return;
  taskSchedulerStartupTimer = setTimeout(() => { void runUnifiedTaskScheduler(); }, 8000);
  taskSchedulerTimer = setInterval(() => { void runUnifiedTaskScheduler(); }, 60 * 1000);
}

function stopUnifiedTaskScheduler() {
  if (taskSchedulerStartupTimer) clearTimeout(taskSchedulerStartupTimer);
  if (taskSchedulerTimer) clearInterval(taskSchedulerTimer);
  taskSchedulerStartupTimer = null;
  taskSchedulerTimer = null;
}

function readStudentScheduleLedger(student) {
  const file = studentScheduleLedgerPath(student);
  const parsed = safeReadJson(file, {});
  return {
    version: 1,
    updatedAt: parsed.updatedAt || '',
    entries: Array.isArray(parsed.entries) ? parsed.entries : [],
  };
}

function writeStudentScheduleLedger(student, ledger) {
  const file = studentScheduleLedgerPath(student);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    entries: (ledger.entries || []).slice(0, 300),
  }, null, 2), 'utf8');
}

function recordScheduledTaskAction(studentId, kind, commandText) {
  try {
    const student = readStudentsIndex().find((item) => String(item.id) === String(studentId));
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const normalized = toHostStudent(student);
    ensureStudentWorkspaceConfig(normalized);
    const now = new Date().toISOString();
    const day = now.slice(0, 10);
    const taskKind = String(kind || 'digest');
    const commandHash = sha1Text(String(commandText || '')).slice(0, 16);
    const ledger = readStudentScheduleLedger(normalized);
    const duplicate = ledger.entries.find((entry) => entry.day === day && entry.kind === taskKind && entry.commandHash === commandHash);
    if (duplicate) {
      duplicate.lastCopiedAt = now;
      duplicate.copyCount = Number(duplicate.copyCount || 1) + 1;
      duplicate.status = 'copied';
      writeStudentScheduleLedger(normalized, ledger);
      return JSON.stringify({ ok: true, duplicate: true, ledger, message: '今日同类指令已记录，本次只更新复制次数。' });
    }
    ledger.entries.unshift({
      id: `task-${day}-${taskKind}-${commandHash}`,
      day,
      kind: taskKind,
      commandHash,
      status: 'copied',
      copiedAt: now,
      lastCopiedAt: now,
      copyCount: 1,
      studentId: normalized.id,
      studentName: normalized.name,
      digestTime: normalized.digestTime,
    });
    writeStudentScheduleLedger(normalized, ledger);
    appendHostTimeline({ type: 'scheduled_task_recorded', title: 'Scheduled task recorded', detail: `${normalized.name} ${taskKind}`, count: 1 });
    return JSON.stringify({ ok: true, duplicate: false, ledger, message: '已写入定时任务去重账本。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `写入定时任务账本失败：${error.message}` });
  }
}

function getStudentScheduleLedger(studentId) {
  try {
    const student = readStudentsIndex().find((item) => String(item.id) === String(studentId));
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const normalized = toHostStudent(student);
    const ledger = readStudentScheduleLedger(normalized);
    const reportPath = studentMaintenanceReportPath(normalized);
    return JSON.stringify({
      ok: true,
      ledger,
      reportPath,
      reportExists: fs.existsSync(reportPath),
      message: `已读取 ${ledger.entries.length} 条定时任务记录。`,
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `读取定时任务账本失败：${error.message}` });
  }
}

function buildTaskCenterCandidates() {
  const students = readStudentsIndex().map(toHostStudent);
  const projects = readProjects().map(normalizeProject);
  const tasks = [];
  for (const student of students) {
    const pendingCount = Math.max(0, Number(student.pendingDigestCount || 0));
    const digestStatus = String(student.digestStatus || '').toLowerCase();
    tasks.push(normalizeTaskEnvelope({
      id: taskStableId('student_digest', 'student', student.id),
      title: `${student.name}每日资料消化`, kind: 'student_digest', sourceType: 'student', sourceId: String(student.id), sourceName: student.name,
      status: digestStatus === 'digesting' ? 'running' : digestStatus === 'submitted' ? 'waiting_result' : pendingCount > 0 ? 'pending' : 'queued',
      trigger: 'schedule', executor: String(student.agentTool || 'qclaw'), requestedExecutor: String(student.agentTool || 'qclaw'), executionMode: 'adapter',
      scheduledAt: String(student.digestTime || '21:30'), count: pendingCount,
      input: { studentId: String(student.id), knowledgeRoot: student.rootPath || getStudentRootDir(student.name), rawPath: student.rawPath || getRawDir(student.name) },
      expectedOutput: { type: 'digest_state', path: studentDigestStatePath(student) },
      permissions: { read: [student.rootPath || getStudentRootDir(student.name)], write: [student.summaryPath || getSummaryDir(student.name), studentDigestStatePath(student)], operations: ['read', 'write_knowledge'] },
      detail: pendingCount > 0 ? `有 ${pendingCount} 份资料等待消化。` : '当前没有新增资料，按每日计划检查。', action: 'student_digest',
    }));
    tasks.push(buildDailyActionTask(student));
    tasks.push(normalizeTaskEnvelope({
      id: taskStableId('maintenance_lint', 'student', student.id),
      title: `${student.name}知识库维护检查`, kind: 'maintenance_lint', sourceType: 'student', sourceId: String(student.id), sourceName: student.name,
      status: 'queued', trigger: 'schedule', executor: String(student.agentTool || 'qclaw'), requestedExecutor: String(student.agentTool || 'qclaw'), executionMode: 'adapter', scheduledAt: '每周',
      input: { studentId: String(student.id), knowledgeRoot: student.rootPath || getStudentRootDir(student.name) },
      expectedOutput: { type: 'markdown', path: studentMaintenanceReportPath(student) },
      permissions: { read: [student.rootPath || getStudentRootDir(student.name)], write: [studentMaintenanceReportPath(student)], operations: ['read', 'create_report'] },
      detail: '检查路径、规则、索引、断链和成长模型健康度。', action: 'student_maintenance',
    }));
  }
  for (const project of projects) {
    const digestState = project.digestState || {};
    const pendingDigest = Math.max(0, Number(digestState.pendingCount || 0));
    const digestStatus = String(digestState.status || 'idle');
    tasks.push(normalizeTaskEnvelope({
      id: taskStableId('project_digest', 'project', project.id),
      title: `${project.name}项目资料消化`, kind: 'project_digest', sourceType: 'project', sourceId: String(project.id), sourceName: project.name,
      status: digestStatus === 'digesting' ? 'running' : digestStatus === 'submitted' ? 'waiting_result' : digestStatus === 'failed' ? 'blocked' : pendingDigest > 0 ? 'pending' : 'queued',
      trigger: project.automation?.enabled ? 'schedule' : 'manual', executor: String(project.agentTool || 'qclaw'), requestedExecutor: String(project.agentTool || 'qclaw'), executionMode: 'adapter',
      scheduledAt: project.automation?.enabled ? String(project.automation.nextRunAt || '等待调度') : '', count: pendingDigest,
      input: { projectId: String(project.id), knowledgeRoot: project.knowledgeRootPath, rawPath: project.rawPath },
      expectedOutput: { type: 'project_digest_state', path: projectDigestStatePath(project) },
      permissions: { read: [project.rawPath, project.knowledgeRootPath].filter(Boolean), write: [project.knowledgeRootPath, projectDigestStatePath(project)].filter(Boolean), operations: ['read', 'write_project_knowledge'] },
      detail: pendingDigest > 0 ? `有 ${pendingDigest} 份正式资料等待 Agent 消化。` : '当前没有待消化的项目资料。', action: 'project_digest', riskLevel: 'medium',
    }));
    const pendingKnowledge = Math.max(0, Number(project.dashboard?.pendingKnowledgeCount || 0));
    if (pendingKnowledge > 0) tasks.push(normalizeTaskEnvelope({
      id: taskStableId('knowledge_review', 'project', project.id),
      title: `${project.name}知识资产审核`, kind: 'knowledge_review', sourceType: 'project', sourceId: String(project.id), sourceName: project.name,
      status: 'pending', trigger: 'event', executor: 'human-review', requestedExecutor: 'manual', executionMode: 'review', count: pendingKnowledge,
      detail: `有 ${pendingKnowledge} 条概念、实体、摘要或结论等待审核。`, action: 'project_knowledge', riskLevel: 'medium',
      permissions: { read: [project.knowledgeRootPath].filter(Boolean), write: [project.knowledgeRootPath].filter(Boolean), operations: ['review_knowledge'] },
    }));
    const contributionStatus = String(project.dashboard?.contributionStatus || '');
    const promotionTargets = readStudentsIndex().filter((student) => (project.studentIds || []).map(String).includes(String(student.id))).map((student) => growthModelDirForStudent(toHostStudent(student)));
    if (project.dashboard?.contributionReady || contributionStatus || project.archivedAt) tasks.push(normalizeTaskEnvelope({
      id: taskStableId('project_promotion', 'project', project.id),
      title: `${project.name}知识贡献与归档`, kind: 'project_promotion', sourceType: 'project', sourceId: String(project.id), sourceName: project.name,
      status: project.publishedAt ? 'succeeded' : 'pending', trigger: 'event', executor: 'human-review', requestedExecutor: 'manual', executionMode: 'review', riskLevel: 'high',
      detail: project.publishedAt ? '项目贡献已发布到成长模型。' : '高风险发布任务，审批后才能进入学生档案或成长模型。', action: 'project_promotion',
      permissions: { read: [project.knowledgeRootPath].filter(Boolean), write: promotionTargets, operations: ['publish_growth_evidence', 'archive_project'] },
      approval: { required: true, status: project.publishedAt ? 'approved' : 'pending' },
    }));
  }
  return tasks;
}

function getTaskCenter() {
  const performanceStartedAt = Date.now();
  const performanceMarks = {};
  try {
    syncQClawTaskResults();
    performanceMarks.qclawSyncMs = Date.now() - performanceStartedAt;
    let store = upsertTaskCandidates(buildTaskCenterCandidates());
    performanceMarks.candidateBuildMs = Date.now() - performanceStartedAt - performanceMarks.qclawSyncMs;
    if (enforceTaskTimeouts(store)) store = writeTaskStore(store);
    const tasks = store.tasks.slice().sort((a, b) => {
      const groupOrder = { actionable: 0, running: 1, scheduled: 2, completed: 3 };
      return Number(groupOrder[a.statusGroup] ?? 9) - Number(groupOrder[b.statusGroup] ?? 9) || String(b.updatedAt).localeCompare(String(a.updatedAt));
    });
    const legacyHistory = [];
    for (const student of readStudentsIndex().map(toHostStudent)) {
      const ledger = readStudentScheduleLedger(student);
      legacyHistory.push(...ledger.entries.map((entry) => ({ ...entry, sourceType: 'student', sourceId: String(student.id), sourceName: student.name, executor: String(student.agentTool || 'qclaw'), at: entry.lastCopiedAt || entry.copiedAt || entry.day || '' })));
    }
    const history = [...store.history, ...legacyHistory].sort((a, b) => String(b.at || b.lastCopiedAt || b.copiedAt || b.day || '').localeCompare(String(a.at || a.lastCopiedAt || a.copiedAt || a.day || ''))).slice(0, 300);
    const summary = {
      total: tasks.length,
      actionable: tasks.filter((task) => task.statusGroup === 'actionable').length,
      running: tasks.filter((task) => task.statusGroup === 'running').length,
      scheduled: tasks.filter((task) => task.statusGroup === 'scheduled').length,
      completed: tasks.filter((task) => task.statusGroup === 'completed').length,
    };
    const automationEnabled = taskAutomationEnabled();
    const capabilities = adapterCapabilities();
    performanceMarks.totalMs = Date.now() - performanceStartedAt;
    return JSON.stringify({ ok: true, protocolVersion: TASK_PROTOCOL_VERSION, generatedAt: taskNow(), tasks, history, summary, capabilities, automationEnabled, executionMode: automationEnabled ? 'automatic' : 'manual', performance: performanceMarks, taskStorePath: taskStorePath(), qclawInboxPath: qclawTaskInboxPath(), qclawResultPath: qclawTaskResultPath(), message: `任务中心已汇总 ${tasks.length} 项标准任务和 ${history.length} 条执行记录；当前为${automationEnabled ? '自动运行' : '仅手动'}模式。` });
  } catch (error) {
    return JSON.stringify({ ok: false, tasks: [], history: [], message: `读取任务中心失败：${error.message}` });
  }
}

function generateStudentMaintenanceReport(studentId) {
  try {
    const student = readStudentsIndex().find((item) => String(item.id) === String(studentId));
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const normalized = toHostStudent(student);
    const health = JSON.parse(checkStudentPathHealth(studentId));
    const ledger = readStudentScheduleLedger(normalized);
    const assets = readAssetIndex().filter((asset) =>
      String(asset.ownerStudentId || '') === String(normalized.id)
      || (Array.isArray(asset.linkedStudents) && asset.linkedStudents.includes(String(normalized.id)))
      || (Array.isArray(asset.references) && asset.references.some((ref) => ref.spaceType === 'student' && String(ref.spaceId) === String(normalized.id)))
    );
    const materials = readStudentMaterials(normalized);
    const openMaterials = materials.filter((item) => isOpenDigestStatus(item.status));
    const staleAssetRefs = assets.reduce((total, asset) => total + (Array.isArray(asset.references) ? asset.references.filter((ref) => ref.path && !fs.existsSync(ref.path)).length : 0), 0);
    const recentEntries = ledger.entries.slice(0, 12).map((entry) => `| ${mdCell(entry.day)} | ${mdCell(entry.kind)} | ${mdCell(entry.status)} | ${entry.copyCount || 1} | ${mdCell(entry.lastCopiedAt || entry.copiedAt || '-')} |`).join('\n') || '| 暂无 | - | - | - | - |';
    const report = `# ${normalized.name} 定时维护报告\n\n生成时间：${new Date().toISOString()}\n\n## 总览\n\n| 项目 | 状态 |\n| --- | --- |\n| 路径健康 | ${mdCell(health.status || 'unknown')} |\n| 路径提醒 | ${mdCell(health.message || '-')} |\n| 待消化资料 | ${openMaterials.length} |\n| 资产记录 | ${assets.length} |\n| 失效资产引用 | ${staleAssetRefs} |\n| 账本记录 | ${ledger.entries.length} |\n\n## 最近定时任务账本\n\n| 日期 | 类型 | 状态 | 复制次数 | 最近复制 |\n| --- | --- | --- | ---: | --- |\n${recentEntries}\n\n## 维护建议\n\n- 若“待消化资料”大于 0，请先执行定时消化，再同步结果。\n- 若“路径健康”为 warning/error，请在知识库路径核对中查看并修复旧主机路径。\n- 若存在失效资产引用，请进入文件资产中心执行治理建议和清理失效引用。\n- 若成长证据草稿长期未确认，请进入 Growth Layer 完成审核。\n`;
    fs.mkdirSync(path.dirname(studentMaintenanceReportPath(normalized)), { recursive: true });
    fs.writeFileSync(studentMaintenanceReportPath(normalized), report, 'utf8');
    appendHostTimeline({ type: 'student_maintenance_report', title: 'Student maintenance report generated', detail: normalized.name, count: openMaterials.length });
    return JSON.stringify({ ok: true, path: studentMaintenanceReportPath(normalized), content: report, message: `已生成「${normalized.name}」定时维护报告。` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `生成定时维护报告失败：${error.message}` });
  }
}

function checkAllStudentsPathHealth() {
  try {
    const students = readStudentsIndex().map(toHostStudent);
    const reports = [];
    for (const student of students) {
      try {
        const report = JSON.parse(checkStudentPathHealth(student.id));
        reports.push({
          studentId: student.id,
          studentName: student.name,
          status: report.status || 'unknown',
          message: report.message || '',
          rootPath: report.rootPath || student.rootPath || getStudentRootDir(student.name),
          reportPath: report.reportPath || '',
          metadataPath: report.metadataPath || '',
          pathmapPath: report.pathmapPath || '',
          summary: report.summary || {},
        });
      } catch (error) {
        reports.push({
          studentId: student.id,
          studentName: student.name,
          status: 'error',
          message: error.message,
          rootPath: student.rootPath || getStudentRootDir(student.name),
          reportPath: '',
          metadataPath: '',
          pathmapPath: '',
          summary: {},
        });
      }
    }
    const statusRank = { error: 3, warning: 2, ok: 1 };
    const overallStatus = reports.some((item) => item.status === 'error')
      ? 'error'
      : reports.some((item) => item.status === 'warning')
        ? 'warning'
        : 'ok';
    const rows = reports
      .sort((a, b) => (statusRank[b.status] || 0) - (statusRank[a.status] || 0) || a.studentName.localeCompare(b.studentName, 'zh-CN'))
      .map((item) => `| ${mdCell(item.studentName)} | ${mdCell(item.status)} | ${Number(item.summary?.missingCount || 0)} | ${Number(item.summary?.warningCount || 0)} | ${Number(item.summary?.stalePathCount || 0)} | ${mdCell(item.message || '-')} | ${mdCell(item.rootPath)} | ${mdCell(item.reportPath || '-')} |`)
      .join('\n') || '| 暂无学生 | - | 0 | 0 | 0 | - | - | - |';
    const content = `# 所有学生知识库路径核对总报告\n\n生成时间：${new Date().toISOString()}\n\n## 总览\n\n| 指标 | 数量 |\n| --- | ---: |\n| 学生数 | ${reports.length} |\n| 正常 | ${reports.filter((item) => item.status === 'ok').length} |\n| 警告 | ${reports.filter((item) => item.status === 'warning').length} |\n| 错误 | ${reports.filter((item) => item.status === 'error').length} |\n\n## 明细\n\n| 学生 | 状态 | 缺失项 | 警告项 | 旧路径 | 说明 | 根目录 | 学生报告 |\n| --- | --- | ---: | ---: | ---: | --- | --- | --- |\n${rows}\n\n## 建议\n\n- 若“旧路径”大于 0，请进入对应学生执行“修复旧主机路径”。\n- 若“缺失项”大于 0，请先确认同步盘是否完成同步，再补建缺失目录或重新接管知识库。\n- 本报告只核对路径与配置，不会移动、删除、覆盖任何知识库文件。\n`;
    const file = allStudentsPathHealthReportPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
    appendHostTimeline({ type: 'all_students_path_health', title: 'All students path health checked', detail: overallStatus, count: reports.length });
    return JSON.stringify({ ok: true, status: overallStatus, reports, path: file, content, message: `已完成 ${reports.length} 个学生的路径核对，总体状态：${overallStatus}。` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `批量核对学生路径失败：${error.message}` });
  }
}

function readGrowthEvidenceReview(student) {
  const file = growthEvidenceReviewPath(student);
  const parsed = safeReadJson(file, {});
  return {
    version: 1,
    updatedAt: parsed.updatedAt || '',
    candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
  };
}

function writeGrowthEvidenceReview(student, review) {
  const file = growthEvidenceReviewPath(student);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    candidates: review.candidates || [],
  }, null, 2), 'utf8');
}

function appendGrowthEvidenceCandidate(student, candidate) {
  const normalized = toHostStudent(student);
  ensureGrowthModelForStudent(normalized);
  const review = readGrowthEvidenceReview(normalized);
  const content = String(candidate.content || candidate.title || '').trim();
  const seed = `${normalized.id}|${candidate.projectId || ''}|${candidate.title || ''}|${content}|${candidate.sourcePath || ''}`;
  const evidenceId = String(candidate.id || `evidence-${sha1Text(seed).slice(0, 14)}`);
  const existing = review.candidates.find((item) => item.id === evidenceId);
  if (existing) {
    Object.assign(existing, {
      projectId: String(candidate.projectId || existing.projectId || ''),
      projectName: String(candidate.projectName || existing.projectName || ''),
      title: String(candidate.title || existing.title || '未命名成长证据'),
      content,
      sourcePath: String(candidate.sourcePath || existing.sourcePath || ''),
      status: String(candidate.status || existing.status || 'pending'),
      confidence: String(candidate.confidence || existing.confidence || '待确认'),
      ability: String(candidate.ability || existing.ability || '待标注'),
      updatedAt: new Date().toISOString(),
    });
    writeGrowthEvidenceReview(normalized, review);
    return existing;
  }
  const item = {
    id: evidenceId,
    studentId: normalized.id,
    studentName: normalized.name,
    projectId: String(candidate.projectId || ''),
    projectName: String(candidate.projectName || ''),
    title: String(candidate.title || '未命名成长证据'),
    content,
    sourcePath: String(candidate.sourcePath || ''),
    status: String(candidate.status || 'pending'),
    confidence: String(candidate.confidence || '待确认'),
    ability: String(candidate.ability || '待标注'),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  review.candidates.unshift(item);
  writeGrowthEvidenceReview(normalized, review);
  return item;
}

function getGrowthEvidenceReview(studentId) {
  try {
    const student = readStudentsIndex().find((item) => String(item.id) === String(studentId));
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const normalized = toHostStudent(student);
    ensureGrowthModelForStudent(normalized);
    const review = readGrowthEvidenceReview(normalized);
    return JSON.stringify({ ok: true, review, path: growthEvidenceReviewPath(normalized), message: `已读取 ${review.candidates.length} 条成长证据候选。` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `读取成长证据审核失败：${error.message}` });
  }
}

function rebuildGrowthIndex(studentId) {
  try {
    const student = readStudentsIndex().find((item) => String(item.id) === String(studentId));
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const normalized = toHostStudent(student);
    const growth = ensureGrowthModelForStudent(normalized);
    const review = readGrowthEvidenceReview(normalized);
    const projects = readProjects().map(normalizeProject).filter((project) => (project.studentIds || []).map(String).includes(String(normalized.id)));
    const abilities = new Map();
    const projectEvidenceCount = new Map();
    for (const candidate of review.candidates) {
      const ability = String(candidate.ability || '待标注');
      const item = abilities.get(ability) || {
        name: ability,
        total: 0,
        pending: 0,
        confirmed: 0,
        watching: 0,
        rejected: 0,
        projectNames: new Set(),
        evidenceIds: [],
      };
      item.total += 1;
      if (candidate.status === 'confirmed') item.confirmed += 1;
      else if (candidate.status === 'watching') item.watching += 1;
      else if (candidate.status === 'rejected') item.rejected += 1;
      else item.pending += 1;
      if (candidate.projectName) item.projectNames.add(candidate.projectName);
      item.evidenceIds.push(candidate.id);
      abilities.set(ability, item);
      if (candidate.projectId) projectEvidenceCount.set(String(candidate.projectId), (projectEvidenceCount.get(String(candidate.projectId)) || 0) + 1);
    }
    const abilityList = Array.from(abilities.values()).map((item) => ({
      name: item.name,
      evidenceCount: item.total,
      pendingCount: item.pending,
      confirmedCount: item.confirmed,
      watchingCount: item.watching,
      rejectedCount: item.rejected,
      projectNames: Array.from(item.projectNames),
      evidenceIds: item.evidenceIds,
    })).sort((a, b) => b.evidenceCount - a.evidenceCount || a.name.localeCompare(b.name, 'zh-CN'));
    const projectList = projects.map((project) => ({
      projectId: project.id,
      projectName: project.name,
      status: project.status || 'active',
      evidenceCount: projectEvidenceCount.get(String(project.id)) || 0,
      knowledgeRootPath: project.knowledgeRootPath,
      promotionPath: project.promotionPath || '',
      publishedAt: project.publishedAt || '',
    }));
    const index = {
      version: 1,
      studentId: normalized.id,
      studentName: normalized.name,
      updatedAt: new Date().toISOString(),
      growthDir: growth.dir,
      sourceFiles: {
        evidenceReview: growthEvidenceReviewPath(normalized),
        evidenceMd: path.join(growth.dir, '成长证据.md'),
        projectContributionMd: path.join(growth.dir, '项目贡献.md'),
      },
      summary: {
        evidenceCount: review.candidates.length,
        pendingCount: review.candidates.filter((item) => !['confirmed', 'watching', 'rejected'].includes(String(item.status))).length,
        confirmedCount: review.candidates.filter((item) => item.status === 'confirmed').length,
        watchingCount: review.candidates.filter((item) => item.status === 'watching').length,
        rejectedCount: review.candidates.filter((item) => item.status === 'rejected').length,
        abilityCount: abilityList.length,
        projectCount: projectList.length,
      },
      abilities: abilityList,
      projects: projectList,
      evidence: review.candidates.map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        ability: item.ability || '待标注',
        projectId: item.projectId || '',
        projectName: item.projectName || '',
        sourcePath: item.sourcePath || '',
        confidence: item.confidence || '',
        updatedAt: item.updatedAt || item.createdAt || '',
      })),
    };
    fs.mkdirSync(path.dirname(growthIndexPath(normalized)), { recursive: true });
    fs.writeFileSync(growthIndexPath(normalized), JSON.stringify(index, null, 2), 'utf8');
    const abilityRows = abilityList.map((item) => `| ${mdCell(item.name)} | ${item.evidenceCount} | ${item.confirmedCount} | ${item.watchingCount} | ${item.pendingCount} | ${item.rejectedCount} | ${mdCell(item.projectNames.join('、') || '-')} |`).join('\n') || '| 暂无 | 0 | 0 | 0 | 0 | 0 | - |';
    const projectRows = projectList.map((item) => `| ${mdCell(item.projectName)} | ${mdCell(item.status)} | ${item.evidenceCount} | ${mdCell(item.publishedAt || '-')} | ${mdCell(item.knowledgeRootPath || '-')} |`).join('\n') || '| 暂无 | - | 0 | - | - |';
    const markdown = `# ${normalized.name} 成长模型结构化索引\n\n生成时间：${index.updatedAt}\n\n## 总览\n\n| 指标 | 数量 |\n| --- | ---: |\n| 成长证据候选 | ${index.summary.evidenceCount} |\n| 已确认 | ${index.summary.confirmedCount} |\n| 观察中 | ${index.summary.watchingCount} |\n| 待审核 | ${index.summary.pendingCount} |\n| 已驳回/回滚 | ${index.summary.rejectedCount} |\n| 能力维度 | ${index.summary.abilityCount} |\n| 关联项目 | ${index.summary.projectCount} |\n\n## 能力维度\n\n| 能力 | 证据 | 已确认 | 观察中 | 待审核 | 驳回/回滚 | 来源项目 |\n| --- | ---: | ---: | ---: | ---: | ---: | --- |\n${abilityRows}\n\n## 关联项目\n\n| 项目 | 状态 | 证据数 | 发布时间 | 知识空间 |\n| --- | --- | ---: | --- | --- |\n${projectRows}\n\n> 该索引由教育管家控制台生成，用于把散落在成长证据、项目贡献和知识贡献中的记录结构化。它不会覆盖原始 Markdown 内容。\n`;
    fs.writeFileSync(growthIndexMarkdownPath(normalized), markdown, 'utf8');
    appendHostTimeline({ type: 'growth_index_rebuilt', title: 'Growth index rebuilt', detail: normalized.name, count: review.candidates.length });
    return JSON.stringify({ ok: true, index, path: growthIndexPath(normalized), markdownPath: growthIndexMarkdownPath(normalized), content: markdown, message: `已重建「${normalized.name}」成长模型结构化索引。` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `重建成长模型结构化索引失败：${error.message}` });
  }
}

function getGrowthIndex(studentId) {
  try {
    const student = readStudentsIndex().find((item) => String(item.id) === String(studentId));
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const normalized = toHostStudent(student);
    const file = growthIndexPath(normalized);
    if (!fs.existsSync(file)) return rebuildGrowthIndex(studentId);
    const index = safeReadJson(file, {});
    const content = fs.existsSync(growthIndexMarkdownPath(normalized)) ? readSmallTextFile(growthIndexMarkdownPath(normalized), 512 * 1024) : '';
    return JSON.stringify({ ok: true, index, path: file, markdownPath: growthIndexMarkdownPath(normalized), content, message: '已读取成长模型结构化索引。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `读取成长模型结构化索引失败：${error.message}` });
  }
}

function updateGrowthEvidenceStatus(studentId, evidenceId, status, note = '') {
  try {
    const student = readStudentsIndex().find((item) => String(item.id) === String(studentId));
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const normalized = toHostStudent(student);
    ensureGrowthModelForStudent(normalized);
    const review = readGrowthEvidenceReview(normalized);
    const nextStatus = ['pending', 'confirmed', 'watching', 'rejected'].includes(String(status)) ? String(status) : 'pending';
    const item = review.candidates.find((candidate) => String(candidate.id) === String(evidenceId));
    if (!item) return JSON.stringify({ ok: false, message: '未找到成长证据候选。' });
    item.status = nextStatus;
    item.note = String(note || item.note || '');
    item.updatedAt = new Date().toISOString();
    writeGrowthEvidenceReview(normalized, review);
    if (nextStatus === 'confirmed') {
      const growth = ensureGrowthModelForStudent(normalized);
      fs.appendFileSync(path.join(growth.dir, '成长证据.md'), `| ${new Date().toISOString().slice(0, 10)} | ${mdCell(item.title)} | ${mdCell(item.sourcePath || item.projectName || '-')} | ${mdCell(item.ability || '待标注')} | ${mdCell(item.confidence || '人工确认')} |\n`, 'utf8');
    }
    appendHostTimeline({ type: 'growth_evidence_reviewed', title: 'Growth evidence reviewed', detail: `${normalized.name} ${nextStatus}`, count: 1 });
    return JSON.stringify({ ok: true, review, message: `已将成长证据标记为：${nextStatus}。` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `更新成长证据状态失败：${error.message}` });
  }
}

function learningReportPathForStudent(student, report) {
  return path.join(learningReportDirForStudent(student), report.fileName);
}

function learningReportTemplate(student, report) {
  const today = new Date().toISOString().slice(0, 10);
  const body = report.sections.map((section) => {
    if (section === report.summaryHeading) return `## ${section}\n\n待生成。`;
    return `## ${section}\n\n- 待补充。`;
  }).join('\n\n');
  const growthDir = growthModelDirForStudent(student);
  return `---\ntype: ${report.type}\ntarget: ${report.target}\nupdated: ${today}\nstatus: draft\ngrowth_model: ${growthDir}\n---\n\n# ${report.title}\n\n> 本报告属于 Growth Layer 的呈现输出。生成和更新时，请优先读取成长模型、综合汇总库和已确认的项目知识贡献记录。\n\n## 成长证据来源\n\n- 成长模型：${growthDir}\n- 能力画像：${path.join(growthDir, '能力画像.md')}\n- 成长证据：${path.join(growthDir, '成长证据.md')}\n- 项目贡献：${path.join(growthDir, '项目贡献.md')}\n\n## 项目贡献来源\n\n- 待补充已确认的项目知识贡献申请。\n\n${body}\n`;
}

function ensureLearningReportsForStudent(student) {
  const reportDir = learningReportDirForStudent(student);
  fs.mkdirSync(reportDir, { recursive: true });
  ensureGrowthModelForStudent(student);
  const created = [];
  for (const report of LEARNING_REPORTS) {
    const file = learningReportPathForStudent(student, report);
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, learningReportTemplate(student, report), 'utf8');
      created.push(report.fileName);
    }
  }
  return { reportDir, created };
}

function frontmatterValue(content, key) {
  const match = new RegExp(`^${key}:\\s*(.+)$`, 'im').exec(String(content || ''));
  return match ? match[1].trim() : '';
}

function extractSectionSummary(content, heading) {
  const text = String(content || '');
  const escaped = String(heading || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, 'i').exec(text);
  const raw = (match?.[1] || text.replace(/^---[\s\S]*?---/, '')).trim();
  const line = raw
    .split(/\r?\n/)
    .map((item) => item.replace(/^[-*]\s*/, '').trim())
    .find((item) => item && !/^待(生成|补充)/.test(item));
  return (line || '待生成').slice(0, 120);
}

function reportHasEvidence(content) {
  const evidence = extractSectionSummary(content, '依据来源');
  return Boolean(evidence && evidence !== '待生成' && !/^待(生成|补充)/.test(evidence));
}

function learningReportRecord(student, report) {
  const file = learningReportPathForStudent(student, report);
  const exists = fs.existsSync(file);
  const content = exists ? fs.readFileSync(file, 'utf8') : learningReportTemplate(student, report);
  const stat = exists ? fs.statSync(file) : null;
  const status = frontmatterValue(content, 'status') || (/(待生成|待补充)/.test(content) ? 'draft' : 'active');
  const updatedMs = stat ? stat.mtimeMs : 0;
  const staleDays = updatedMs ? Math.floor((Date.now() - updatedMs) / (24 * 60 * 60 * 1000)) : null;
  const evidenceOk = reportHasEvidence(content);
  const stale = Boolean(staleDays !== null && staleDays >= 14);
  const warnings = [];
  if (!exists) warnings.push('报告文件缺失');
  if (status === 'draft') warnings.push('仍是草稿状态');
  if (stale) warnings.push(`已 ${staleDays} 天未更新`);
  if (!evidenceOk) warnings.push('缺少有效依据来源');
  return {
    id: report.id,
    title: report.title,
    fileName: report.fileName,
    path: `学情报告/${report.fileName}`,
    absolutePath: file,
    exists,
    updatedAt: stat ? stat.mtime.toISOString() : '',
    status,
    stale,
    staleDays,
    evidenceOk,
    health: warnings.length ? 'warning' : 'ok',
    warnings,
    summary: extractSectionSummary(content, report.summaryHeading),
  };
}

function learningReportHealthSummary(reports) {
  const missingCount = reports.filter((report) => !report.exists).length;
  const draftCount = reports.filter((report) => report.status === 'draft').length;
  const staleCount = reports.filter((report) => report.stale).length;
  const evidenceMissingCount = reports.filter((report) => !report.evidenceOk).length;
  const warnings = [];
  if (missingCount) warnings.push(`${missingCount} 份报告缺失`);
  if (draftCount) warnings.push(`${draftCount} 份报告仍是草稿`);
  if (staleCount) warnings.push(`${staleCount} 份报告超过 14 天未更新`);
  if (evidenceMissingCount) warnings.push(`${evidenceMissingCount} 份报告缺少依据来源`);
  return {
    ok: warnings.length === 0,
    missingCount,
    draftCount,
    staleCount,
    evidenceMissingCount,
    warnings,
    message: warnings.length ? `学情报告需要检查：${warnings.join('；')}。` : '学情报告状态正常。',
  };
}

function templateLibraryDir() {
  return path.join(defaultStudentBaseDir(), '模板库');
}

function templateSystemDir() {
  return path.join(templateLibraryDir(), 'system');
}

function templateCustomDir() {
  return path.join(templateLibraryDir(), 'custom', 'current');
}

function templateMetaPath() {
  return path.join(templateCustomDir(), 'template-meta.json');
}

function templateFileKeys() {
  return ['AGENT.md', 'Soul.md', 'Memory.md', 'init-step-1.md', 'init-step-2.md', 'digest-prompt.md', 'consult-prompt.md'];
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeTemplateFiles(dir, templates, overwrite) {
  fs.mkdirSync(dir, { recursive: true });
  for (const key of templateFileKeys()) {
    const file = path.join(dir, key);
    if (!overwrite && fs.existsSync(file)) continue;
    fs.writeFileSync(file, String(templates[key] || ''), 'utf8');
  }
}

function readTemplateFiles(dir) {
  const templates = {};
  for (const key of templateFileKeys()) {
    const file = path.join(dir, key);
    templates[key] = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  }
  return templates;
}

function ensureTemplateLibrary(systemTemplates) {
  fs.mkdirSync(templateLibraryDir(), { recursive: true });
  writeTemplateFiles(templateSystemDir(), systemTemplates || {}, true);
  fs.mkdirSync(templateCustomDir(), { recursive: true });
}

function getTemplateCenter(systemTemplatesJson) {
  try {
    const systemTemplates = parseJsonObject(systemTemplatesJson);
    ensureTemplateLibrary(systemTemplates);
    const settings = readSettings();
    const activeTemplate = settings.activeTemplate === 'custom' ? 'custom' : 'system';
    return JSON.stringify({
      ok: true,
      activeTemplate,
      templateRoot: templateLibraryDir(),
      systemPath: templateSystemDir(),
      customPath: templateCustomDir(),
      system: readTemplateFiles(templateSystemDir()),
      custom: readTemplateFiles(templateCustomDir()),
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `读取模板库失败：${error.message}` });
  }
}

function saveCustomTemplates(templatesJson) {
  try {
    const templates = parseJsonObject(templatesJson);
    ensureTemplateLibrary(templates);
    writeTemplateFiles(templateCustomDir(), templates, true);
    fs.writeFileSync(templateMetaPath(), JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      keys: templateFileKeys(),
    }, null, 2), 'utf8');
    const settings = readSettings();
    settings.activeTemplate = 'custom';
    writeSettings(settings);
    return JSON.stringify({ ok: true, activeTemplate: 'custom', customPath: templateCustomDir(), message: '已保存为当前自定义模板。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `保存模板失败：${error.message}` });
  }
}

function restoreSystemTemplates(systemTemplatesJson) {
  try {
    const systemTemplates = parseJsonObject(systemTemplatesJson);
    ensureTemplateLibrary(systemTemplates);
    const settings = readSettings();
    settings.activeTemplate = 'system';
    writeSettings(settings);
    return JSON.stringify({ ok: true, activeTemplate: 'system', systemPath: templateSystemDir(), message: '已恢复系统默认模板。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `恢复默认模板失败：${error.message}` });
  }
}

function agentMemoryDir(student) {
  return path.join(student.rootPath || getStudentRootDir(student.name), 'Agent记忆');
}

function agentSoulDir(student) {
  return path.join(student.rootPath || getStudentRootDir(student.name), 'Agent设定');
}

function agentRulesDir(student) {
  return path.join(student.rootPath || getStudentRootDir(student.name), 'Agent规则');
}

function agentKnowledgeCenterDir(student) {
  return path.join(student.rootPath || getStudentRootDir(student.name), 'Agent知识管理');
}

function agentSourceRegistryDir(student) {
  return path.join(agentKnowledgeCenterDir(student), '来源记录');
}

function agentSourceRegistryPath(student) {
  return path.join(agentSourceRegistryDir(student), 'source-registry.json');
}

function agentConversationDir(student) {
  return path.join(agentKnowledgeCenterDir(student), '对话历史');
}

function agentConversationImportsDir(student) {
  return path.join(agentConversationDir(student), 'imports');
}

function agentConversationExtractsDir(student) {
  return path.join(agentConversationDir(student), 'extracts');
}

function agentMemoryUnifiedPath(student) {
  return path.join(agentMemoryDir(student), 'UnifiedMemory.md');
}

function agentSoulUnifiedPath(student) {
  return path.join(agentSoulDir(student), 'UnifiedSoul.md');
}

function agentSourceDir(baseDir, tool) {
  return path.join(baseDir, 'sources', AGENT_TOOL_IDS.includes(tool) ? tool : 'qclaw');
}

function sha1Text(value) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex');
}

function snapshotCurrentFile(file, snapshotsDir) {
  if (!fs.existsSync(file)) return '';
  fs.mkdirSync(snapshotsDir, { recursive: true });
  const target = path.join(snapshotsDir, `${timestampForFilename()}-${path.basename(file)}`);
  fs.copyFileSync(file, target);
  return target;
}

function rulePathJoin(root, ...parts) {
  const base = String(root || '');
  if (base.startsWith('@')) return [base, ...parts].filter(Boolean).join('/');
  return path.join(base, ...parts);
}

function studentLogicalRulePaths() {
  return {
    root: '@KB_ROOT',
    raw: '@RAW_DIR',
    summary: '@SUMMARY_DIR',
    agent: '@AGENT_FILE',
    output: '@OUTPUT_DIR',
    growth: '@GROWTH_DIR',
  };
}

function learningReportProtocolText(summaryPath) {
  const reportDir = rulePathJoin(summaryPath || '', '学情报告');
  const growthDir = rulePathJoin(summaryPath || '', '成长模型');
  return `## 学情报告 Protocol\n\n学情报告是 Growth Layer 的成果表达层，不替代摘要库、实体库、概念库、综合库和咨询精华库。更新报告前，应优先读取成长模型、综合汇总库和已确认的项目知识贡献记录。\n\n成长模型位置：\n\n- ${rulePathJoin(growthDir, '能力画像.md')}\n- ${rulePathJoin(growthDir, '成长证据.md')}\n- ${rulePathJoin(growthDir, '项目贡献.md')}\n\n完成资料消化、综合分析或咨询沉淀后，如果发现对用户有直接价值的结论，请检查并更新：\n\n- ${rulePathJoin(reportDir, '整体画像.md')}\n- ${rulePathJoin(reportDir, '历史变化.md')}\n- ${rulePathJoin(reportDir, '每日行动建议.md')}\n- ${rulePathJoin(reportDir, '阶段总结.md')}\n\n写作要求：\n\n1. 面向家长、学生、教师可读，避免内部技术术语。\n2. 每份报告顶部保留更新时间、适用对象、状态。\n3. 结论必须对应学情分析汇总、成长模型或项目贡献中的依据来源。\n4. “每日行动建议”必须分为：给学生、给家长、给老师。\n5. 不确定判断标注“待观察”，不要写成定论。\n6. 不要删除原有报告内容；判断发生变化时，在“历史变化”或“阶段总结”中说明变化原因。\n7. 当天无新增资料时，也可以根据已有档案更新“每日行动建议”，但要注明依据。\n`;
}

function defaultRuleFileContent(student, fileName) {
  const cleanName = sanitizeName(student.name);
  const rootPath = student.rootPath || getStudentRootDir(cleanName);
  const agentPath = student.agentPath || path.join(rootPath, 'AGENT.md');
  const logical = studentLogicalRulePaths();
  const lower = String(fileName || '').toLowerCase();
  if (lower === 'agent.md' && fs.existsSync(agentPath)) return fs.readFileSync(agentPath, 'utf8');
  return `# ${cleanName} ${fileName}\n\n## 工作规则\n\n该 Agent 的工作协议使用：${logical.agent}\n后续所有学习资料消化都围绕该学生知识库执行。\n\n当前主机真实路径请读取 ${logical.root}/.ai-manager/pathmap.json；跨主机同步时不要把本文件中的逻辑路径替换为某台电脑的绝对路径。\n\n${learningReportProtocolText(logical.summary)}\n## 规则说明\n\n请将本文件作为该学生智能体的规则性 Markdown 文件维护。若当前 Agent 工具支持多个规则文件，可把本文件内容同步到对应工具的规则、系统提示词或项目指令中。\n`;
}

function defaultUnifiedMemory(student) {
  const cleanName = sanitizeName(student.name);
  return `# ${cleanName} AI教育管家 UnifiedMemory\n\n## 学生画像\n\n- 姓名：${cleanName}\n- 年级：${student.grade || ''}\n- 学校：${student.school || ''}\n- 当前核心目标：${student.goal || ''}\n\n## 长期观察\n\n- 待补充。\n`;
}

function defaultUnifiedSoul(student) {
  const cleanName = sanitizeName(student.name);
  const logical = studentLogicalRulePaths();
  return `# ${cleanName} AI教育管家 UnifiedSoul\n\n你是「${cleanName} AI教育管家」，负责长期维护该学生学情档案，并把零散学习资料沉淀为可追溯、可复用的学情知识库。\n\n## 工作规则\n\n该 Agent 的工作协议使用：${logical.agent}\n后续所有学习资料消化都围绕该学生知识库执行。\n\n当前主机真实路径请读取 ${logical.root}/.ai-manager/pathmap.json；如果当前 Agent 工具不能解析逻辑路径，请从控制台复制“当前主机工作规则”。\n`;
}

function writeJsonFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function extractJsonLikeText(value) {
  const text = String(value || '')
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .trim();
  if (!text) return '';
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const firstObject = text.indexOf('{');
  const lastObject = text.lastIndexOf('}');
  const firstArray = text.indexOf('[');
  const lastArray = text.lastIndexOf(']');
  if (firstObject >= 0 && lastObject > firstObject) return text.slice(firstObject, lastObject + 1);
  if (firstArray >= 0 && lastArray > firstArray) return text.slice(firstArray, lastArray + 1);
  return text;
}

function appendAgentSourceRecord(student, record) {
  try {
    fs.mkdirSync(agentSourceRegistryDir(student), { recursive: true });
    const file = agentSourceRegistryPath(student);
    const existing = readJsonFile(file, { version: 1, records: [] });
    const records = Array.isArray(existing.records) ? existing.records : [];
    const now = new Date().toISOString();
    records.unshift({
      id: record.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      studentId: String(student.id || ''),
      assetType: record.assetType || 'memory',
      tool: AGENT_TOOL_IDS.includes(record.tool) ? record.tool : 'qclaw',
      sourceType: record.sourceType || 'manualPaste',
      sourcePath: record.sourcePath || '',
      targetPath: record.targetPath || '',
      importedAt: record.importedAt || now,
      hash: record.hash || '',
      confidence: Number.isFinite(Number(record.confidence)) ? Number(record.confidence) : undefined,
      confirmed: record.confirmed !== false,
      notes: record.notes || '',
    });
    writeJsonFile(file, { version: 1, updatedAt: now, records: records.slice(0, 500) });
  } catch {
    // Source registry should never block the primary user action.
  }
}

function getAgentSourceRegistry(studentId) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    fs.mkdirSync(agentSourceRegistryDir(student), { recursive: true });
    const registry = readJsonFile(agentSourceRegistryPath(student), { version: 1, records: [] });
    return JSON.stringify({
      ok: true,
      path: agentSourceRegistryPath(student),
      records: Array.isArray(registry.records) ? registry.records : [],
      message: '已读取来源记录。',
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `读取来源记录失败：${error.message}` });
  }
}

function rollbackAgentSourceRecord(studentId, recordId) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const file = agentSourceRegistryPath(student);
    const registry = readJsonFile(file, { version: 1, records: [] });
    const records = Array.isArray(registry.records) ? registry.records : [];
    const target = records.find((record) => String(record.id) === String(recordId));
    if (!target) return JSON.stringify({ ok: false, message: '未找到要撤销的来源记录。' });
    const nextRecords = records.filter((record) => String(record.id) !== String(recordId));
    writeJsonFile(file, {
      ...registry,
      version: 1,
      updatedAt: new Date().toISOString(),
      records: nextRecords,
    });
    return JSON.stringify({
      ok: true,
      path: file,
      removed: target,
      records: nextRecords,
      message: '已撤销来源记录。目标文件未删除，如需处理请在知识库中手动确认。',
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `撤销来源记录失败：${error.message}` });
  }
}

function ensureAgentCenter(student) {
  const memoryDir = agentMemoryDir(student);
  const soulDir = agentSoulDir(student);
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.mkdirSync(soulDir, { recursive: true });
  for (const tool of AGENT_TOOL_IDS) {
    fs.mkdirSync(path.join(agentSourceDir(memoryDir, tool), 'snapshots'), { recursive: true });
    fs.mkdirSync(path.join(agentSourceDir(soulDir, tool), 'snapshots'), { recursive: true });
  }
  if (!fs.existsSync(agentMemoryUnifiedPath(student))) {
    fs.writeFileSync(agentMemoryUnifiedPath(student), defaultUnifiedMemory(student), 'utf8');
  }
  if (!fs.existsSync(agentSoulUnifiedPath(student))) {
    fs.writeFileSync(agentSoulUnifiedPath(student), defaultUnifiedSoul(student), 'utf8');
  }
  importExistingAgentFile(student, 'Memory.md', memoryDir, 'current.Memory.md');
  importExistingAgentFile(student, 'Soul.md', soulDir, 'current.Soul.md');
  refreshAgentCenterIndexes(student);
}

function importExistingAgentFile(student, filename, baseDir, currentName) {
  const tool = AGENT_TOOL_IDS.includes(student.agentTool) ? student.agentTool : 'qclaw';
  const source = path.join(student.rootPath || getStudentRootDir(student.name), filename);
  const target = path.join(agentSourceDir(baseDir, tool), currentName);
  if (fs.existsSync(source) && !fs.existsSync(target)) {
    fs.copyFileSync(source, target);
  }
}

function listSourceEntries(baseDir, currentName, mode) {
  return AGENT_TOOL_IDS.map((tool) => {
    const currentPath = path.join(agentSourceDir(baseDir, tool), currentName);
    const content = fs.existsSync(currentPath) ? fs.readFileSync(currentPath, 'utf8') : '';
    return {
      tool,
      mode,
      currentPath,
      lastSyncedAt: fs.existsSync(currentPath) ? fs.statSync(currentPath).mtime.toISOString() : '',
      hash: content ? sha1Text(content) : '',
      exists: Boolean(content),
    };
  });
}

function refreshAgentCenterIndexes(student) {
  const memorySources = listSourceEntries(agentMemoryDir(student), 'current.Memory.md', 'paste');
  const soulSources = listSourceEntries(agentSoulDir(student), 'current.Soul.md', 'paste');
  writeJsonFile(path.join(agentMemoryDir(student), 'memory-index.json'), {
    version: 1,
    studentId: String(student.id || ''),
    unifiedMemoryPath: agentMemoryUnifiedPath(student),
    sources: memorySources,
    updatedAt: new Date().toISOString(),
  });
  writeJsonFile(path.join(agentSoulDir(student), 'soul-index.json'), {
    version: 1,
    studentId: String(student.id || ''),
    unifiedSoulPath: agentSoulUnifiedPath(student),
    sources: soulSources,
    updatedAt: new Date().toISOString(),
  });
}

function mergeMemoryContents(chunks) {
  const seenLines = new Set();
  const merged = ['# 统一学生记忆', '', '## 合并记忆'];
  const conflicts = [];
  for (const chunk of chunks) {
    const lines = String(chunk.content || '').split(/\r?\n/).map((line) => line.trimEnd());
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || /^#\s/.test(trimmed)) continue;
      const key = trimmed.replace(/\s+/g, ' ').toLowerCase();
      if (seenLines.has(key)) continue;
      seenLines.add(key);
      if (/冲突|不一致|待确认/.test(trimmed)) conflicts.push(`- [${chunk.tool}] ${trimmed}`);
      else merged.push(line);
    }
  }
  if (conflicts.length) {
    merged.push('', '## 待确认冲突', ...conflicts);
  }
  return `${merged.join('\n').trim()}\n`;
}

function getAgentCenter(studentId) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    ensureAgentCenter(student);
    const memoryIndex = readJsonFile(path.join(agentMemoryDir(student), 'memory-index.json'), {});
    const soulIndex = readJsonFile(path.join(agentSoulDir(student), 'soul-index.json'), {});
    return JSON.stringify({
      ok: true,
      memoryDir: agentMemoryDir(student),
      soulDir: agentSoulDir(student),
      unifiedMemoryPath: agentMemoryUnifiedPath(student),
      unifiedSoulPath: agentSoulUnifiedPath(student),
      unifiedMemory: fs.readFileSync(agentMemoryUnifiedPath(student), 'utf8'),
      unifiedSoul: fs.readFileSync(agentSoulUnifiedPath(student), 'utf8'),
      memoryIndex,
      soulIndex,
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `读取 Agent 中枢失败：${error.message}` });
  }
}

function saveAgentMemorySource(studentId, tool, content, mode) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    ensureAgentCenter(student);
    const safeTool = AGENT_TOOL_IDS.includes(tool) ? tool : 'qclaw';
    const dir = agentSourceDir(agentMemoryDir(student), safeTool);
    const file = path.join(dir, 'current.Memory.md');
    const snapshot = snapshotCurrentFile(file, path.join(dir, 'snapshots'));
    fs.writeFileSync(file, String(content || ''), 'utf8');
    appendAgentSourceRecord(student, {
      assetType: 'memory',
      tool: safeTool,
      sourceType: mode === 'file' ? 'fileImport' : 'manualPaste',
      targetPath: file,
      hash: sha1Text(content || ''),
      confidence: mode === 'file' ? 80 : 70,
      notes: '保存来源 Memory',
    });
    refreshAgentCenterIndexes(student);
    return JSON.stringify({ ok: true, currentPath: file, snapshot, hash: sha1Text(content || ''), message: '已保存来源 Memory。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `保存来源 Memory 失败：${error.message}` });
  }
}

function mergeAgentMemory(studentId) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    ensureAgentCenter(student);
    const chunks = [];
    for (const tool of AGENT_TOOL_IDS) {
      const file = path.join(agentSourceDir(agentMemoryDir(student), tool), 'current.Memory.md');
      if (fs.existsSync(file)) chunks.push({ tool, content: fs.readFileSync(file, 'utf8') });
    }
    const unified = chunks.length ? mergeMemoryContents(chunks) : defaultUnifiedMemory(student);
    fs.writeFileSync(agentMemoryUnifiedPath(student), unified, 'utf8');
    refreshAgentCenterIndexes(student);
    return JSON.stringify({ ok: true, unifiedMemory: unified, unifiedMemoryPath: agentMemoryUnifiedPath(student), message: `已合并 ${chunks.length} 个来源 Memory。` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `合并统一记忆失败：${error.message}` });
  }
}

function saveUnifiedMemory(studentId, content) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    ensureAgentCenter(student);
    fs.writeFileSync(agentMemoryUnifiedPath(student), String(content || ''), 'utf8');
    refreshAgentCenterIndexes(student);
    return JSON.stringify({ ok: true, unifiedMemoryPath: agentMemoryUnifiedPath(student), message: '已保存统一记忆。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `保存统一记忆失败：${error.message}` });
  }
}

function saveAgentSoulSource(studentId, tool, content) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    ensureAgentCenter(student);
    const safeTool = AGENT_TOOL_IDS.includes(tool) ? tool : 'qclaw';
    const dir = agentSourceDir(agentSoulDir(student), safeTool);
    const file = path.join(dir, 'current.Soul.md');
    const snapshot = snapshotCurrentFile(file, path.join(dir, 'snapshots'));
    fs.writeFileSync(file, String(content || ''), 'utf8');
    appendAgentSourceRecord(student, {
      assetType: 'persona',
      tool: safeTool,
      sourceType: 'manualPaste',
      targetPath: file,
      hash: sha1Text(content || ''),
      confidence: 70,
      notes: '保存来源 Soul',
    });
    refreshAgentCenterIndexes(student);
    return JSON.stringify({ ok: true, currentPath: file, snapshot, hash: sha1Text(content || ''), message: '已保存来源 Soul 备份。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `保存来源 Soul 失败：${error.message}` });
  }
}

function saveUnifiedSoul(studentId, content) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    ensureAgentCenter(student);
    fs.writeFileSync(agentSoulUnifiedPath(student), String(content || ''), 'utf8');
    refreshAgentCenterIndexes(student);
    return JSON.stringify({ ok: true, unifiedSoulPath: agentSoulUnifiedPath(student), message: '已保存统一 Soul。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `保存统一 Soul 失败：${error.message}` });
  }
}

function compareAgentSoulSource(studentId, tool) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    ensureAgentCenter(student);
    const safeTool = AGENT_TOOL_IDS.includes(tool) ? tool : 'qclaw';
    const sourceFile = path.join(agentSourceDir(agentSoulDir(student), safeTool), 'current.Soul.md');
    const unified = fs.existsSync(agentSoulUnifiedPath(student)) ? fs.readFileSync(agentSoulUnifiedPath(student), 'utf8') : '';
    const source = fs.existsSync(sourceFile) ? fs.readFileSync(sourceFile, 'utf8') : '';
    const unifiedLines = new Set(unified.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    const sourceLines = new Set(source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    const onlyUnified = Array.from(unifiedLines).filter((line) => !sourceLines.has(line)).slice(0, 80);
    const onlySource = Array.from(sourceLines).filter((line) => !unifiedLines.has(line)).slice(0, 80);
    return JSON.stringify({ ok: true, onlyUnified, onlySource, message: onlyUnified.length || onlySource.length ? '检测到差异。' : '未检测到明显差异。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `对比 Soul 失败：${error.message}` });
  }
}

const DEFAULT_AGENT_RULE_FILES = ['AGENT.md', 'AGENTS.md', 'CLAUDE.md', 'QClaw.md', 'OpenClaw.md', 'Marvis.md', 'Hohu.md', 'IMA.md', 'ima.copilot.md', 'WorkBuddy.md', 'RULES.md'];
const LEGACY_AGENT_RULE_FILES = ['Claude.md', 'Claud.md'];

function normalizeRuleFileName(fileName) {
  const safe = path.basename(String(fileName || '').trim());
  if (!/^[^\\/:*?"<>|]+\.md$/i.test(safe)) return '';
  return safe;
}

function listAgentRuleFiles(student) {
  const root = student.rootPath || getStudentRootDir(student.name);
  const known = new Map();
  for (const fileName of DEFAULT_AGENT_RULE_FILES) known.set(fileName.toLowerCase(), fileName);
  try {
    if (fs.existsSync(root)) {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue;
        const lower = entry.name.toLowerCase();
        if (
          DEFAULT_AGENT_RULE_FILES.map((item) => item.toLowerCase()).includes(lower) ||
          LEGACY_AGENT_RULE_FILES.map((item) => item.toLowerCase()).includes(lower) ||
          /(agent|claude|claud|claw|marvis|hohu|ima|copilot|workbuddy|rule|rules|system|prompt|指令|规则)/i.test(entry.name)
        ) known.set(lower, entry.name);
      }
    }
  } catch {
    // Keep default entries if the directory cannot be listed.
  }
  return Array.from(known.values()).map((fileName) => {
    const filePath = path.join(root, fileName);
    const exists = fs.existsSync(filePath);
    const stat = exists ? fs.statSync(filePath) : null;
    const content = exists ? fs.readFileSync(filePath, 'utf8') : defaultRuleFileContent(student, fileName);
    return {
      fileName,
      path: filePath,
      exists,
      size: stat ? stat.size : 0,
      mtime: stat ? stat.mtime.toISOString() : '',
      content,
      hash: content ? sha1Text(content) : '',
    };
  });
}

function getAgentRules(studentId) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    fs.mkdirSync(agentRulesDir(student), { recursive: true });
    return JSON.stringify({
      ok: true,
      rootPath: student.rootPath || getStudentRootDir(student.name),
      rulesDir: agentRulesDir(student),
      files: listAgentRuleFiles(student),
      message: '已读取智能体规则文件。',
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `读取规则文件失败：${error.message}` });
  }
}

function saveAgentRuleFile(studentId, fileName, content) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const safeName = normalizeRuleFileName(fileName);
    if (!safeName) return JSON.stringify({ ok: false, message: '规则文件名无效，只能保存当前知识库根目录下的 .md 文件。' });
    const root = student.rootPath || getStudentRootDir(student.name);
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(path.join(agentRulesDir(student), 'snapshots'), { recursive: true });
    const file = path.join(root, safeName);
    const snapshot = snapshotCurrentFile(file, path.join(agentRulesDir(student), 'snapshots'));
    fs.writeFileSync(file, String(content || ''), 'utf8');
    appendAgentSourceRecord(student, {
      assetType: 'rule',
      tool: student.agentTool || 'qclaw',
      sourceType: snapshot ? 'manualPaste' : 'manualPaste',
      targetPath: file,
      hash: sha1Text(content || ''),
      confidence: 100,
      notes: `保存规则文件 ${safeName}`,
    });
    return JSON.stringify({
      ok: true,
      fileName: safeName,
      path: file,
      snapshot,
      files: listAgentRuleFiles(student),
      message: `已保存规则文件 ${safeName}。`,
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `保存规则文件失败：${error.message}` });
  }
}

function ruleFileTemplateIntro(student, fileName) {
  const cleanName = sanitizeName(student.name);
  const p = studentLogicalRulePaths();
  const lower = String(fileName || '').toLowerCase();
  if (lower === 'agents.md') {
    return `# ${cleanName} 教育管家项目说明（AGENTS.md）\n\n本目录是学生「${cleanName}」的 AI 教育管家知识库，供 Codex 或其他本地项目型 Agent 使用。\n\n## 工作规则\n\n- 该 Agent 的工作协议使用：${p.agent}\n- 后续所有学习资料消化都围绕该学生知识库执行。\n- 原始资料库是输入层：${p.raw}\n- 学情分析汇总是知识层：${p.summary}\n- 输出结果是临时交付层：${p.output}\n- 所有新增、修改和总结必须遵守 AGENT.md 中的证据追溯、索引更新和 log 记录规则。\n\n${learningReportProtocolText(p.summary)}\n`;
  }
  if (lower === 'claude.md' || lower === 'claud.md') {
    return `# ${cleanName} 教育管家 Claude Code 规则\n\n本文件用于 Claude Code 在该学生知识库目录中工作。\n\n## 工作规则\n\n该 Agent 的工作协议使用：${p.agent}\n后续所有学习资料消化都围绕该学生知识库执行。\n\n请优先读取 AGENT.md，再处理原始资料库与学情分析汇总。不要移动、删除用户原始资料。\n\n${learningReportProtocolText(p.summary)}\n`;
  }
  if (lower === 'ima.md' || lower === 'ima.copilot.md') {
    return `# ${cleanName} 教育管家 ima.copilot 规则\n\n本文件用于 ima.copilot 围绕该学生知识库进行搜、读、写和资料消化协作。\n\n## 工作规则\n\n该 Agent 的工作协议使用：${p.agent}\n后续所有学习资料消化都围绕该学生知识库执行。\n\n请优先读取 AGENT.md，再处理原始资料库与学情分析汇总。不要移动、删除用户原始资料。\n\n${learningReportProtocolText(p.summary)}\n`;
  }
  if (lower === 'workbuddy.md') {
    return `# ${cleanName} 教育管家 WorkBuddy 规则\n\n本文件用于 WorkBuddy 在该学生知识库目录中执行资料整理、报告生成和后续跟进。\n\n## 工作规则\n\n该 Agent 的工作协议使用：${p.agent}\n后续所有学习资料消化都围绕该学生知识库执行。\n\n请优先读取 AGENT.md，再处理原始资料库与学情分析汇总。不要移动、删除用户原始资料。\n\n${learningReportProtocolText(p.summary)}\n`;
  }
  return defaultRuleFileContent(student, fileName);
}

function generateAgentRuleFile(studentId, fileName) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const safeName = normalizeRuleFileName(fileName);
    if (!safeName) return JSON.stringify({ ok: false, message: '规则文件名无效。' });
    const root = student.rootPath || getStudentRootDir(student.name);
    const agentPath = student.agentPath || path.join(root, 'AGENT.md');
    const agentContent = fs.existsSync(agentPath) ? fs.readFileSync(agentPath, 'utf8') : defaultRuleFileContent(student, 'AGENT.md');
    const generated = `${ruleFileTemplateIntro(student, safeName).trim()}\n\n## AGENT.md 基础协议摘录\n\n\`\`\`markdown\n${agentContent.slice(0, 12000)}\n\`\`\`\n`;
    return saveAgentRuleFile(studentId, safeName, generated);
  } catch (error) {
    return JSON.stringify({ ok: false, message: `生成规则模板失败：${error.message}` });
  }
}

function compareAgentRuleFiles(studentId, baseName, targetName) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const root = student.rootPath || getStudentRootDir(student.name);
    const baseFile = path.join(root, normalizeRuleFileName(baseName) || 'AGENT.md');
    const targetFile = path.join(root, normalizeRuleFileName(targetName) || '');
    const base = fs.existsSync(baseFile) ? fs.readFileSync(baseFile, 'utf8') : '';
    const target = fs.existsSync(targetFile) ? fs.readFileSync(targetFile, 'utf8') : '';
    const baseLines = new Set(base.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    const targetLines = new Set(target.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    const onlyBase = Array.from(baseLines).filter((line) => !targetLines.has(line)).slice(0, 120);
    const onlyTarget = Array.from(targetLines).filter((line) => !baseLines.has(line)).slice(0, 120);
    return JSON.stringify({ ok: true, onlyBase, onlyTarget, message: onlyBase.length || onlyTarget.length ? '检测到规则差异。' : '未检测到明显差异。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `对比规则文件失败：${error.message}` });
  }
}

const AGENT_KNOWLEDGE_SCAN = {
  maxDepth: 6,
  maxFiles: 1200,
  maxEntries: 12000,
  maxCandidates: 80,
  maxReadBytes: 256 * 1024,
  maxImportBytes: 5 * 1024 * 1024,
};

function agentKnowledgeScanRoots() {
  const home = os.homedir();
  const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const toolNames = ['QClaw', 'OpenClaw', 'Hohu', 'Marvis', 'IMA', 'ima.copilot', 'WorkBuddy', 'Codex', 'Claude'];
  const roots = [
    path.join(home, '.qclaw'),
    path.join(home, '.openclaw'),
    path.join(home, '.hohu'),
    path.join(home, '.marvis'),
    path.join(home, '.ima'),
    path.join(home, '.ima.copilot'),
    path.join(home, '.workbuddy'),
    path.join(home, '.codex'),
    path.join(home, '.claude'),
  ];
  for (const base of [roaming, local]) {
    for (const toolName of toolNames) roots.push(path.join(base, toolName));
  }
  return Array.from(new Set(roots)).filter((root) => fs.existsSync(root));
}

function shouldSkipAgentScanDir(name) {
  return [
    '.git',
    'node_modules',
    'cache',
    'code cache',
    'gpucache',
    'shadercache',
    'logs',
    'log',
    'tmp',
    'temp',
    'crashpad',
    'blob_storage',
    'session storage',
    'service worker',
  ].includes(String(name || '').toLowerCase());
}

function inferAgentToolFromPath(filePath) {
  const lower = String(filePath || '').toLowerCase();
  if (lower.includes('claude-code') || lower.includes('.claude')) return 'claude-code';
  if (lower.includes('ima.copilot') || lower.includes('\\ima\\') || lower.includes('/ima/') || lower.includes('.ima')) return 'ima.copilot';
  if (lower.includes('workbuddy') || lower.includes('work-buddy')) return 'workbuddy';
  if (lower.includes('chatgpt') || lower.includes('openai')) return 'chatgpt';
  if (lower.includes('doubao') || lower.includes('豆包')) return 'doubao';
  if (lower.includes('fastgpt')) return 'fastgpt';
  if (lower.includes('coze')) return 'coze';
  if (lower.includes('claude')) return 'claude';
  if (lower.includes('codex')) return 'codex';
  if (lower.includes('openclaw')) return 'openclaw';
  if (lower.includes('marvis')) return 'marvis';
  if (lower.includes('hohu')) return 'hohu';
  if (lower.includes('qclaw')) return 'qclaw';
  return 'qclaw';
}

function inferAgentKnowledgeKind(fileName) {
  const lower = String(fileName || '').toLowerCase();
  if (/^(agents|agent|claude|claud|qclaw|openclaw|marvis|hohu|ima|ima\.copilot|workbuddy|rules?)\.(md|txt)$/i.test(lower)) return 'rule';
  if (/(conversation|chat|history|transcript|对话|聊天|会话)/i.test(lower)) return 'conversation';
  if (/^(memory|long[-_ ]?term[-_ ]?memory|memories)\.(md|txt|json)$/.test(lower) || lower.includes('memory')) return 'memory';
  if (/^(soul|persona|role|system|prompt|profile)\.(md|txt|json)$/.test(lower) || /(soul|persona|role|system|人设|角色)/i.test(lower)) return 'soul';
  return '';
}

function readTextPreview(filePath, maxBytes = AGENT_KNOWLEDGE_SCAN.maxReadBytes) {
  const stat = fs.statSync(filePath);
  const bytes = Math.min(stat.size, maxBytes);
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    fs.readSync(fd, buffer, 0, bytes, 0);
    return buffer.toString('utf8').replace(/\u0000/g, '').trim();
  } finally {
    fs.closeSync(fd);
  }
}

function scoreAgentKnowledgeCandidate(student, filePath, fileName, kind, content) {
  const lowerPath = String(filePath || '').toLowerCase();
  const lowerName = String(fileName || '').toLowerCase();
  const text = String(content || '');
  const lowerText = text.toLowerCase();
  const reasons = [];
  let score = 0;
  const add = (points, reason) => {
    score += points;
    reasons.push(reason);
  };
  if (student.name && text.includes(student.name)) add(60, `内容包含学生姓名「${student.name}」`);
  if (student.agentName && text.includes(student.agentName)) add(50, '内容包含 Agent 名称');
  if (student.rootPath && text.includes(student.rootPath)) add(45, '内容包含知识库根目录');
  if (student.agentPath && text.includes(student.agentPath)) add(35, '内容包含 AGENT.md 完整路径');
  if (lowerText.includes('agent.md')) add(22, '内容提到 AGENT.md');
  if (/原始资料库|学情分析汇总|学习资料消化|知识库/.test(text)) add(20, '内容包含教育管家知识库关键词');
  if (AGENT_TOOL_IDS.some((tool) => lowerPath.includes(tool))) add(14, '路径命中 Agent 工具目录');
  if ((kind === 'memory' && lowerName === 'memory.md') || (kind === 'soul' && lowerName === 'soul.md') || (kind === 'rule' && /^(agent|agents|claude)\.md$/.test(lowerName))) add(12, '文件名为标准名称');
  if (lowerPath.includes(String(student.name || '').toLowerCase())) add(10, '路径包含学生姓名');
  return { score, reasons };
}

function walkAgentKnowledgeFiles(root, results, stats, depth = 0) {
  if (
    depth > AGENT_KNOWLEDGE_SCAN.maxDepth ||
    stats.files >= AGENT_KNOWLEDGE_SCAN.maxFiles ||
    stats.entries >= AGENT_KNOWLEDGE_SCAN.maxEntries
  ) return;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    stats.entries += 1;
    if (stats.files >= AGENT_KNOWLEDGE_SCAN.maxFiles || stats.entries >= AGENT_KNOWLEDGE_SCAN.maxEntries) return;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!shouldSkipAgentScanDir(entry.name)) walkAgentKnowledgeFiles(fullPath, results, stats, depth + 1);
      continue;
    }
    if (!entry.isFile()) continue;
    const kind = inferAgentKnowledgeKind(entry.name);
    if (!kind) continue;
    stats.files += 1;
    results.push({ path: fullPath, name: entry.name, kind });
  }
}

function scanAgentKnowledgeFiles(studentId) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const roots = agentKnowledgeScanRoots();
    const rawCandidates = [];
    const stats = { files: 0, entries: 0 };
    for (const root of roots) walkAgentKnowledgeFiles(root, rawCandidates, stats);
    const candidates = [];
    for (const item of rawCandidates) {
      try {
        const stat = fs.statSync(item.path);
        if (stat.size > AGENT_KNOWLEDGE_SCAN.maxImportBytes) continue;
        const preview = readTextPreview(item.path);
        const scored = scoreAgentKnowledgeCandidate(student, item.path, item.name, item.kind, preview);
        candidates.push({
          ...item,
          tool: inferAgentToolFromPath(item.path),
          score: scored.score,
          reasons: scored.reasons,
          mtime: stat.mtime.toISOString(),
          size: stat.size,
          preview: preview.slice(0, 900),
        });
      } catch {
        // Ignore files that disappear or cannot be decoded during scanning.
      }
    }
    candidates.sort((a, b) => b.score - a.score || String(b.mtime).localeCompare(String(a.mtime)));
    return JSON.stringify({
      ok: true,
      scannedRoots: roots,
      candidates: candidates.slice(0, AGENT_KNOWLEDGE_SCAN.maxCandidates),
      message: roots.length
        ? `已扫描 ${roots.length} 个工具目录，找到 ${candidates.length} 个候选记忆/人设文件。`
        : '未找到常见 Agent 工具目录，可手动粘贴导入。',
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `扫描 Agent 记忆文件失败：${error.message}` });
  }
}

function importAgentKnowledgeFile(studentId, filePath, tool, kind) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const safeTool = AGENT_TOOL_IDS.includes(tool) ? tool : inferAgentToolFromPath(filePath);
    const safeKind = ['soul', 'rule', 'conversation'].includes(kind) ? kind : 'memory';
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return JSON.stringify({ ok: false, message: '候选文件不存在或不可读取。' });
    }
    const stat = fs.statSync(filePath);
    if (stat.size > AGENT_KNOWLEDGE_SCAN.maxImportBytes) {
      return JSON.stringify({ ok: false, message: '候选文件过大，请手动打开确认后粘贴导入。' });
    }
    const content = fs.readFileSync(filePath, 'utf8');
    if (safeKind === 'soul') return saveAgentSoulSource(student.id, safeTool, content);
    if (safeKind === 'rule') return saveAgentRuleFile(student.id, path.basename(filePath), content);
    if (safeKind === 'conversation') return saveAgentConversationImport(student.id, content, safeTool, filePath);
    return saveAgentMemorySource(student.id, safeTool, content, 'file');
  } catch (error) {
    return JSON.stringify({ ok: false, message: `导入 Agent 文件失败：${error.message}` });
  }
}

function conversationIndexPath(student) {
  return path.join(agentConversationDir(student), 'conversation-index.json');
}

function refreshConversationIndex(student, entry) {
  fs.mkdirSync(agentConversationDir(student), { recursive: true });
  const indexFile = conversationIndexPath(student);
  const current = readJsonFile(indexFile, { version: 1, imports: [], extracts: [] });
  if (entry?.type === 'import') current.imports = [entry, ...(Array.isArray(current.imports) ? current.imports : [])].slice(0, 200);
  if (entry?.type === 'extract') current.extracts = [entry, ...(Array.isArray(current.extracts) ? current.extracts : [])].slice(0, 200);
  current.updatedAt = new Date().toISOString();
  writeJsonFile(indexFile, current);
  return current;
}

function getAgentConversationCenter(studentId) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    fs.mkdirSync(agentConversationImportsDir(student), { recursive: true });
    fs.mkdirSync(agentConversationExtractsDir(student), { recursive: true });
    const index = readJsonFile(conversationIndexPath(student), { version: 1, imports: [], extracts: [] });
    return JSON.stringify({
      ok: true,
      conversationDir: agentConversationDir(student),
      importsDir: agentConversationImportsDir(student),
      extractsDir: agentConversationExtractsDir(student),
      index,
      message: '已读取对话历史中心。',
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `读取对话历史失败：${error.message}` });
  }
}

function saveAgentConversationImport(studentId, content, tool = 'qclaw', sourcePath = '') {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const safeTool = AGENT_TOOL_IDS.includes(tool) ? tool : 'qclaw';
    fs.mkdirSync(agentConversationImportsDir(student), { recursive: true });
    const file = path.join(agentConversationImportsDir(student), `${timestampForFilename()}-${safeTool}-conversation.md`);
    fs.writeFileSync(file, String(content || ''), 'utf8');
    const hash = sha1Text(content || '');
    refreshConversationIndex(student, {
      type: 'import',
      path: file,
      sourcePath,
      tool: safeTool,
      importedAt: new Date().toISOString(),
      hash,
      size: Buffer.byteLength(String(content || ''), 'utf8'),
    });
    appendAgentSourceRecord(student, {
      assetType: 'conversation',
      tool: safeTool,
      sourceType: sourcePath ? 'fileImport' : 'manualPaste',
      sourcePath,
      targetPath: file,
      hash,
      confidence: 70,
      notes: '导入对话历史',
    });
    return JSON.stringify({ ok: true, path: file, message: '已保存对话历史导入记录。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `保存对话历史失败：${error.message}` });
  }
}

function selectAgentConversationFiles(studentId, tool = 'qclaw') {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const safeTool = AGENT_TOOL_IDS.includes(tool) ? tool : 'qclaw';
    const result = dialog.showOpenDialogSync(mainWindow, {
      title: '选择对话历史文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '对话历史文件', extensions: ['md', 'txt', 'json'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (!result || result.length === 0) {
      return JSON.stringify({ ok: false, cancelled: true, message: '未选择对话历史文件。' });
    }
    const imports = [];
    const combinedParts = [];
    for (const filePath of result) {
      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) continue;
        if (stat.size > 5 * 1024 * 1024) {
          imports.push({ ok: false, sourcePath: filePath, message: '文件超过 5MB，已跳过。' });
          continue;
        }
        const content = fs.readFileSync(filePath, 'utf8');
        const imported = JSON.parse(saveAgentConversationImport(student.id, content, safeTool, filePath));
        imports.push({ ...imported, sourcePath: filePath, size: stat.size });
        if (imported.ok) {
          combinedParts.push(`\n\n# 来源文件：${path.basename(filePath)}\n\n${content}`);
        }
      } catch (error) {
        imports.push({ ok: false, sourcePath: filePath, message: error.message });
      }
    }
    const successCount = imports.filter((item) => item.ok).length;
    return JSON.stringify({
      ok: successCount > 0,
      imports,
      combinedContent: combinedParts.join('\n\n---\n'),
      message: successCount > 0
        ? `已导入 ${successCount} 个对话历史文件。`
        : '没有可导入的对话历史文件。',
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `选择对话历史文件失败：${error.message}` });
  }
}

function appendTextSection(file, title, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const section = `\n\n## ${title}\n\n${String(content || '').trim()}\n`;
  fs.appendFileSync(file, section, 'utf8');
}

function saveConversationExtract(studentId, extractJson, tool = 'qclaw') {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const safeTool = AGENT_TOOL_IDS.includes(tool) ? tool : 'qclaw';
    ensureAgentCenter(student);
    let parsed = {};
    try {
      parsed = JSON.parse(extractJsonLikeText(extractJson || '{}'));
    } catch {
      return JSON.stringify({ ok: false, message: '提取结果不是有效 JSON。请确认只粘贴 JSON，或包含 JSON 的代码块。' });
    }
    fs.mkdirSync(agentConversationExtractsDir(student), { recursive: true });
    const extractFile = path.join(agentConversationExtractsDir(student), `${timestampForFilename()}-${safeTool}-extract.json`);
    writeJsonFile(extractFile, parsed);
    const memoryItems = Array.isArray(parsed.memoryCandidates) ? parsed.memoryCandidates : Array.isArray(parsed.memories) ? parsed.memories : [];
    const soulItems = Array.isArray(parsed.soulSuggestions) ? parsed.soulSuggestions : Array.isArray(parsed.personaSuggestions) ? parsed.personaSuggestions : [];
    const qaItems = Array.isArray(parsed.qaHighlights) ? parsed.qaHighlights : Array.isArray(parsed.qa) ? parsed.qa : [];
    const todoItems = Array.isArray(parsed.todos) ? parsed.todos : Array.isArray(parsed.followUps) ? parsed.followUps : [];
    const changed = [];
    if (memoryItems.length) {
      appendTextSection(agentMemoryUnifiedPath(student), `对话提取记忆 ${new Date().toLocaleString('zh-CN')}`, memoryItems.map((item) => `- ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n'));
      changed.push('UnifiedMemory.md');
    }
    if (soulItems.length) {
      appendTextSection(agentSoulUnifiedPath(student), `对话提取人设建议 ${new Date().toLocaleString('zh-CN')}`, soulItems.map((item) => `- ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n'));
      changed.push('UnifiedSoul.md');
    }
    if (qaItems.length) {
      const qaDir = path.join(student.summaryPath || getSummaryDir(student.name), '咨询精华库');
      fs.mkdirSync(qaDir, { recursive: true });
      const qaFile = path.join(qaDir, `对话提取-${timestampForFilename()}.md`);
      fs.writeFileSync(qaFile, `# ${student.name} 对话咨询精华\n\n${qaItems.map((item) => `- ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n')}\n`, 'utf8');
      changed.push(qaFile);
    }
    if (todoItems.length) {
      const todoFile = path.join(student.outputPath || path.join(student.rootPath || getStudentRootDir(student.name), '输出结果'), '待办.md');
      appendTextSection(todoFile, `对话提取待办 ${new Date().toLocaleString('zh-CN')}`, todoItems.map((item) => `- ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n'));
      changed.push(todoFile);
    }
    refreshConversationIndex(student, {
      type: 'extract',
      path: extractFile,
      tool: safeTool,
      importedAt: new Date().toISOString(),
      hash: sha1Text(JSON.stringify(parsed)),
      memoryCount: memoryItems.length,
      soulCount: soulItems.length,
      qaCount: qaItems.length,
      todoCount: todoItems.length,
    });
    appendAgentSourceRecord(student, {
      assetType: 'extract',
      tool: safeTool,
      sourceType: 'conversationExtract',
      targetPath: extractFile,
      hash: sha1Text(JSON.stringify(parsed)),
      confidence: 80,
      notes: `对话提取写入：${changed.join('、')}`,
    });
    return JSON.stringify({ ok: true, path: extractFile, changed, message: `已保存提取结果，写入 ${changed.length} 项教育资产。` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `保存对话提取失败：${error.message}` });
  }
}

function readStudentsIndex() {
  try {
    const parsed = JSON.parse(fs.readFileSync(studentsPath(), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getStudentsIndex() {
  return JSON.stringify({ ok: true, students: readStudentsIndex() });
}

function writeStudentsIndex(students) {
  fs.mkdirSync(path.dirname(studentsPath()), { recursive: true });
  fs.writeFileSync(studentsPath(), JSON.stringify(students, null, 2), 'utf8');
}

function findStudentByKey(studentKey) {
  const key = String(studentKey || '');
  const cleanName = sanitizeName(key);
  return readStudentsIndex().find((student) => String(student.id) === key || student.name === cleanName) || null;
}

function toHostStudent(student) {
  const cleanName = sanitizeName(student.name);
  const createdAt = student.createdAt || new Date().toISOString();
  const channel = String(student.remoteChannel || 'none').toLowerCase();
  const remoteChannel = ['none', 'wecom', 'qq', 'both'].includes(channel) ? channel : 'none';
  const bindingStatus = String(student.remoteBindingStatus || 'unbound').toLowerCase();
  const remoteBindingStatus = ['unbound', 'pending', 'bound'].includes(bindingStatus) ? bindingStatus : 'unbound';
  const tool = String(student.agentTool || 'qclaw').toLowerCase();
  const agentTool = AGENT_TOOL_IDS.includes(tool) ? tool : 'qclaw';
  const mode = String(student.knowledgeBaseMode || 'standard').toLowerCase() === 'adopted' ? 'adopted' : 'standard';
  const rootPath = student.rootPath || getStudentRootDir(cleanName);
  const rawPath = student.rawPath || getRawDir(cleanName);
  const summaryPath = student.summaryPath || getSummaryDir(cleanName);
  const agentPath = student.agentPath || path.join(rootPath, 'AGENT.md');
  const outputPath = student.outputPath || path.join(rootPath, '输出结果');
  const bindingMode = String(student.agentBindingMode || (agentTool === 'marvis' ? 'mainChat' : 'subAgent'));
  const memoryDir = path.join(rootPath, 'Agent记忆');
  const soulDir = path.join(rootPath, 'Agent设定');
  const memoryConfig = student.memoryConfig && typeof student.memoryConfig === 'object' ? student.memoryConfig : {};
  const soulConfig = student.soulConfig && typeof student.soulConfig === 'object' ? student.soulConfig : {};
  const templateProfile = student.templateProfile && typeof student.templateProfile === 'object' ? student.templateProfile : {};
  return {
    ...student,
    id: String(student.id || `${cleanName}-${Date.now()}`),
    name: cleanName,
    grade: String(student.grade || ''),
    school: String(student.school || ''),
    phone: String(student.phone || ''),
    email: String(student.email || ''),
    goal: String(student.goal || ''),
    digestTime: String(student.digestTime || '21:30'),
    agentTool,
    agentBindingMode: ['subAgent', 'mainChat'].includes(bindingMode) ? bindingMode : 'subAgent',
    agentName: String(student.agentName || ''),
    agentNote: String(student.agentNote || ''),
    knowledgeBaseMode: mode,
    rootPath,
    rawPath,
    summaryPath,
    agentPath,
    outputPath,
    memoryConfig: {
      unifiedMemoryPath: memoryConfig.unifiedMemoryPath || path.join(memoryDir, 'UnifiedMemory.md'),
      lastMergedAt: memoryConfig.lastMergedAt || '',
      sources: Array.isArray(memoryConfig.sources) ? memoryConfig.sources : [],
    },
    soulConfig: {
      unifiedSoulPath: soulConfig.unifiedSoulPath || path.join(soulDir, 'UnifiedSoul.md'),
      lastDistributedAt: soulConfig.lastDistributedAt || '',
      sources: Array.isArray(soulConfig.sources) ? soulConfig.sources : [],
    },
    templateProfile: {
      activeTemplate: templateProfile.activeTemplate === 'custom' ? 'custom' : 'system',
      customTemplatePath: templateProfile.customTemplatePath || '',
    },
    materialSources: normalizeMaterialSources(student.materialSources),
    adoptedAt: String(student.adoptedAt || ''),
    remoteChannel,
    remoteContact: String(student.remoteContact || ''),
    remoteNote: String(student.remoteNote || ''),
    remoteBindingStatus,
    remoteBoundAt: String(student.remoteBoundAt || ''),
    createdAt,
  };
}

function syncStudentsIndex(studentsJson) {
  try {
    const parsed = JSON.parse(studentsJson || '[]');
    if (!Array.isArray(parsed)) throw new Error('学生数据格式不是数组');
    const students = parsed.map(toHostStudent);
    writeStudentsIndex(students);
    const validIds = new Set(students.map((student) => String(student.id)));
    const devices = readDevices();
    let changed = false;
    const nextDevices = devices.map((device) => {
      if (device.allowedAllStudents || device.autoAuthorizeNewStudents) {
        changed = true;
        return { ...device, allowedStudentIds: Array.from(validIds) };
      }
      if (!Array.isArray(device.allowedStudentIds)) return device;
      const allowedStudentIds = device.allowedStudentIds.filter((id) => validIds.has(String(id)));
      if (allowedStudentIds.length !== device.allowedStudentIds.length) changed = true;
      return { ...device, allowedStudentIds };
    });
    if (changed) writeDevices(nextDevices);
    return JSON.stringify({ ok: true, count: students.length });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `同步学生索引失败：${error.message}` });
  }
}

function safeFilename(filename) {
  const base = path.basename(String(filename || `资料-${Date.now()}`));
  return base.replace(/[\\/:*?"<>|]/g, '_').trim() || `资料-${Date.now()}`;
}

function uniqueTargetFile(dir, filename) {
  const parsed = path.parse(safeFilename(filename));
  let target = path.join(dir, `${parsed.name}${parsed.ext}`);
  if (!fs.existsSync(target)) return target;
  const suffix = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  target = path.join(dir, `${parsed.name}-${suffix}${parsed.ext}`);
  if (!fs.existsSync(target)) return target;
  return path.join(dir, `${parsed.name}-${suffix}-${Math.random().toString(36).slice(2, 7)}${parsed.ext}`);
}

function resolveInside(root, relativePath) {
  const rel = String(relativePath || '').replace(/\\/g, '/');
  if (!rel || rel.includes('\0') || rel.startsWith('/') || path.isAbsolute(rel) || rel.split('/').includes('..')) {
    throw new Error('非法文件路径');
  }
  const rootResolved = path.resolve(root);
  const full = path.resolve(rootResolved, rel);
  if (full !== rootResolved && !full.startsWith(`${rootResolved}${path.sep}`)) {
    throw new Error('文件路径越界');
  }
  return full;
}

function interfacePriority(name, address) {
  const lowerName = String(name || '').toLowerCase();
  const parts = String(address || '').split('.').map((part) => Number(part));
  let score = 100;
  if (parts[0] === 192 && parts[1] === 168) score = 10;
  else if (parts[0] === 10) score = 20;
  else if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) score = 30;
  else if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) score = 80;

  if (/wlan|wi-?fi|wireless|ethernet|以太/.test(lowerName)) score -= 5;
  if (/tailscale|zerotier|vEthernet|vmware|virtualbox|docker|hyper-v/i.test(String(name || ''))) score += 100;
  return score;
}

function isTailscaleInterface(name, address) {
  const lowerName = String(name || '').toLowerCase();
  const parts = String(address || '').split('.').map((part) => Number(part));
  return lowerName.includes('tailscale') || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
}

function getNetworkUrls(port, mode) {
  const candidates = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry && entry.family === 'IPv4' && !entry.internal) {
        const isTailscale = isTailscaleInterface(name, entry.address);
        if (mode === 'lan' && isTailscale) continue;
        if (mode === 'tailscale' && !isTailscale) continue;
        candidates.push({
          url: `http://${entry.address}:${port}`,
          score: interfacePriority(name, entry.address),
        });
      }
    }
  }
  return candidates
    .sort((a, b) => a.score - b.score || a.url.localeCompare(b.url))
    .map((item) => item.url)
    .filter((url, index, list) => list.indexOf(url) === index);
}

function getLanUrls(port) {
  return getNetworkUrls(port, 'lan');
}

function getTailscaleUrls(port) {
  return getNetworkUrls(port, 'tailscale');
}

function getHostConnectionMode() {
  const settings = readSettings();
  const mode = String(settings.hostConnectionMode || 'lan_tailscale');
  return ['lan_only', 'lan_tailscale', 'manual'].includes(mode) ? mode : 'lan_tailscale';
}

function hostStudentStats() {
  return readStudentsIndex().map((student) => {
    const rawPath = student.rawPath || getRawDir(student.name);
    const summaryPath = student.summaryPath || getSummaryDir(student.name);
    const records = readUploadRecords().filter((record) => String(record.studentId) === String(student.id));
    const state = readStudentDigestState(student);
    return {
      id: String(student.id),
      name: student.name,
      rawFileCount: countFiles(rawPath),
      archiveFileCount: countMarkdownFiles(summaryPath),
      pendingDigestCount: records.filter((record) => normalizeUploadStatus(record.status) === 'pending_digest').length,
      submittedDigestCount: records.filter((record) => ['submitted', 'digesting'].includes(normalizeUploadStatus(record.status))).length,
      processedDigestCount: records.filter((record) => normalizeUploadStatus(record.status) === 'processed').length,
      lastDigestAt: state.lastDigestAt || '',
      digestStatus: state.status || 'idle',
      digestMessage: state.message || '',
    };
  });
}

function getConnectionInfo() {
  const port = getHostServicePort();
  const lanUrls = getLanUrls(port);
  const tailscaleUrls = getTailscaleUrls(port);
  const serverUrl = lanUrls[0] || `http://127.0.0.1:${port}`;
  return {
    serverUrl,
    lanUrls,
    tailscaleUrl: tailscaleUrls[0] || '',
    tailscaleUrls,
    connectionMode: getHostConnectionMode(),
    apiToken: ensureApiToken(),
    port,
  };
}

function getHostConnectionInfo() {
  const pairPayload = getPairPayload();
  return JSON.stringify({
    ...getConnectionInfo(),
    pairCode: pairPayload.pairCode,
    pairExpiresAt: pairPayload.expiresAt,
    pairPayload,
    pairPayloadText: JSON.stringify(pairPayload),
  });
}

function initStudentWorkspace(studentName, agentMd, indexMd, logMd) {
  try {
    const cleanName = sanitizeName(studentName);
    const root = getStudentRootDir(cleanName);
    const raw = getRawDir(cleanName);
    const summary = getSummaryDir(cleanName);
    fs.mkdirSync(path.join(root, '输出结果'), { recursive: true });
    fs.mkdirSync(raw, { recursive: true });
    fs.mkdirSync(path.join(raw, '图片'), { recursive: true });
    fs.mkdirSync(summary, { recursive: true });
    fs.mkdirSync(path.join(summary, '摘要库'), { recursive: true });
    fs.mkdirSync(path.join(summary, '概念库'), { recursive: true });
    fs.mkdirSync(path.join(summary, '实体库'), { recursive: true });
    fs.mkdirSync(path.join(summary, '综合库'), { recursive: true });
    fs.mkdirSync(path.join(summary, '咨询精华库'), { recursive: true });
    fs.mkdirSync(path.join(root, '.edu-manager'), { recursive: true });
    fs.writeFileSync(path.join(root, 'AGENT.md'), agentMd || '', 'utf8');
    writeTextIfMissing(path.join(summary, 'index.md'), indexMd || '');
    writeTextIfMissing(path.join(summary, 'log.md'), logMd || '');
    const pseudoStudent = { id: cleanName, name: cleanName, rootPath: root, rawPath: raw, summaryPath: summary };
    ensureLearningReportsForStudent(pseudoStudent);
    ensureStudentManagerFiles(pseudoStudent);
    writeStudentDigestState(pseudoStudent, {
      status: 'idle',
      rawPath: raw,
      summaryPath: summary,
      message: '知识库已初始化，等待上传资料。',
    });
    return JSON.stringify({
      ok: true,
      rootPathLabel: root,
      rootPath: root,
      rawPath: raw,
      summaryPath: summary,
      agentPath: path.join(root, 'AGENT.md'),
      outputPath: path.join(root, '输出结果'),
      rawCount: countFiles(raw),
      markdownCount: countMarkdownFiles(summary),
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `初始化本机知识库失败：${error.message}` });
  }
}

function selectKnowledgeBaseRoot() {
  try {
    const selected = dialog.showOpenDialogSync(mainWindow, {
      title: '选择已有学生知识库根目录',
      properties: ['openDirectory'],
    });
    if (!selected || !selected[0]) return JSON.stringify({ ok: false, message: '未选择已有知识库目录。' });
    return JSON.stringify({ ok: true, path: selected[0] });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `选择目录失败：${error.message}` });
  }
}

function dirNameMatches(name, keywords) {
  const lower = String(name || '').toLowerCase();
  return keywords.some((keyword) => lower.includes(String(keyword).toLowerCase()));
}

function findKnowledgeDir(root, preferredName, keywords) {
  const preferred = path.join(root, preferredName);
  if (fs.existsSync(preferred) && fs.statSync(preferred).isDirectory()) return preferred;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return '';
  }
  for (const entry of entries) {
    if (entry.isDirectory() && dirNameMatches(entry.name, keywords)) return path.join(root, entry.name);
  }
  return '';
}

function scanExistingKnowledgeBase(rootPath, studentName) {
  try {
    const cleanName = sanitizeName(studentName);
    if (!String(rootPath || '').trim()) return JSON.stringify({ ok: false, message: '请先填写已有知识库根目录。' });
    const root = path.resolve(String(rootPath || ''));
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      return JSON.stringify({ ok: false, message: `未找到已有知识库目录：${rootPath || ''}` });
    }
    const agentPath = path.join(root, 'AGENT.md');
    const rawPath = findKnowledgeDir(root, `${cleanName}原始资料库`, ['原始资料库', '原始资料', 'raw', 'materials', '资料库']);
    const summaryPath = findKnowledgeDir(root, `${cleanName}学情分析汇总`, ['学情分析汇总', '汇总', 'summary', 'report', '分析', '综合']);
    const outputPath = findKnowledgeDir(root, '输出结果', ['输出结果', '输出', 'result']);
    const indexPath = summaryPath ? path.join(summaryPath, 'index.md') : '';
    const logPath = summaryPath ? path.join(summaryPath, 'log.md') : '';
    const reportDir = summaryPath ? path.join(summaryPath, '学情报告') : '';
    const reportFiles = Object.fromEntries(LEARNING_REPORTS.map((report) => [
      report.id,
      Boolean(reportDir && fs.existsSync(path.join(reportDir, report.fileName))),
    ]));
    return JSON.stringify({
      ok: true,
      rootPath: root,
      agentPath,
      rawPath,
      summaryPath,
      outputPath,
      indexPath,
      logPath,
      reportDir,
      reportFiles,
      checks: {
        agentMd: fs.existsSync(agentPath),
        rawDir: Boolean(rawPath && fs.existsSync(rawPath)),
        summaryDir: Boolean(summaryPath && fs.existsSync(summaryPath)),
        outputDir: Boolean(outputPath && fs.existsSync(outputPath)),
        indexMd: Boolean(indexPath && fs.existsSync(indexPath)),
        logMd: Boolean(logPath && fs.existsSync(logPath)),
        learningReportDir: Boolean(reportDir && fs.existsSync(reportDir)),
        learningReports: Object.values(reportFiles).every(Boolean),
      },
      message: '已扫描已有知识库目录。',
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `扫描已有知识库失败：${error.message}` });
  }
}

function resolveAdoptedPath(root, candidate, fallbackName) {
  const rootResolved = path.resolve(root);
  const target = path.resolve(String(candidate || path.join(rootResolved, fallbackName)));
  if (target !== rootResolved && !target.startsWith(`${rootResolved}${path.sep}`)) {
    throw new Error(`路径必须位于知识库根目录内：${target}`);
  }
  return target;
}

function ensureAdoptedKnowledgeBase(optionsJson) {
  try {
    const options = JSON.parse(optionsJson || '{}');
    const cleanName = sanitizeName(options.studentName || '学生');
    if (!String(options.rootPath || '').trim()) return JSON.stringify({ ok: false, message: '请先填写已有知识库根目录。' });
    const root = path.resolve(String(options.rootPath || ''));
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      return JSON.stringify({ ok: false, message: `未找到已有知识库目录：${options.rootPath || ''}` });
    }
    const rawPath = resolveAdoptedPath(root, options.rawPath, `${cleanName}原始资料库`);
    const summaryPath = resolveAdoptedPath(root, options.summaryPath, `${cleanName}学情分析汇总`);
    const outputPath = resolveAdoptedPath(root, options.outputPath, '输出结果');
    const agentPath = resolveAdoptedPath(root, options.agentPath, 'AGENT.md');
    fs.mkdirSync(rawPath, { recursive: true });
    fs.mkdirSync(summaryPath, { recursive: true });
    fs.mkdirSync(outputPath, { recursive: true });
    fs.mkdirSync(path.join(summaryPath, '摘要库'), { recursive: true });
    fs.mkdirSync(path.join(summaryPath, '概念库'), { recursive: true });
    fs.mkdirSync(path.join(summaryPath, '实体库'), { recursive: true });
    fs.mkdirSync(path.join(summaryPath, '综合库'), { recursive: true });
    fs.mkdirSync(path.join(summaryPath, '咨询精华库'), { recursive: true });
    if (!fs.existsSync(agentPath) || options.overwriteAgent) {
      if (fs.existsSync(agentPath) && options.overwriteAgent) {
        const backup = `${agentPath}.bak-${timestampForFilename()}`;
        fs.copyFileSync(agentPath, backup);
      }
      fs.mkdirSync(path.dirname(agentPath), { recursive: true });
      fs.writeFileSync(agentPath, options.agentMd || '', 'utf8');
    }
    writeTextIfMissing(path.join(summaryPath, 'index.md'), options.indexMd || '');
    writeTextIfMissing(path.join(summaryPath, 'log.md'), options.logMd || '');
    const pseudoStudent = {
      id: cleanName,
      name: cleanName,
      rootPath: root,
      rawPath,
      summaryPath,
      agentPath,
      outputPath,
      knowledgeBaseMode: 'adopted',
    };
    ensureLearningReportsForStudent(pseudoStudent);
    ensureStudentManagerFiles(pseudoStudent);
    writeStudentDigestState(pseudoStudent, {
      status: 'idle',
      rawPath,
      summaryPath,
      message: '已接管已有知识库，等待上传资料。',
    });
    return scanExistingKnowledgeBase(root, cleanName);
  } catch (error) {
    return JSON.stringify({ ok: false, message: `补齐已有知识库失败：${error.message}` });
  }
}

function writeTextIfMissing(file, content) {
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content || '', 'utf8');
}

function countFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    count += entry.isDirectory() ? countFiles(full) : 1;
  }
  return count;
}

function countMarkdownFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) count += countMarkdownFiles(full);
    else if (entry.name.toLowerCase().endsWith('.md')) count += 1;
  }
  return count;
}

function exportTextFile(filename, content) {
  const safeName = filename && filename.trim() ? filename.replace(/[\\/:*?"<>|]/g, '_') : 'AI教育管家初始化包.json';
  const dir = path.join(downloadsDir(), 'AI教育管家');
  const target = path.join(dir, safeName);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(target, content || '', 'utf8');
    return JSON.stringify({ ok: true, uri: target });
  } catch (error) {
    return JSON.stringify({ ok: false, error: error.message });
  }
}

function importFiles(studentKey) {
  const student = findStudentByKey(studentKey);
  const cleanName = sanitizeName(student?.name || studentKey);
  dialog.showOpenDialog(mainWindow, {
    title: '选择要导入的学习资料',
    properties: ['openFile', 'multiSelections'],
  }).then((result) => {
    if (result.canceled || !result.filePaths.length) {
      notify('onNativeImportResult', { ok: false, imported: 0, message: '未选择资料。' });
      return;
    }
    const targetDir = student?.rawPath || getRawDir(cleanName);
    fs.mkdirSync(targetDir, { recursive: true });
    let imported = 0;
    const saved = [];
    for (const source of result.filePaths) {
      try {
        const target = uniqueFile(targetDir, path.basename(source).replace(/[\\/:*?"<>|]/g, '_'));
        fs.copyFileSync(source, target);
        const stat = fs.statSync(target);
        saved.push({
          id: `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
          studentId: String(student?.id || cleanName),
          studentName: student?.name || cleanName,
          filename: path.basename(target),
          size: stat.size,
          path: target,
          rawPath: targetDir,
          sha1: sha1File(target),
          sourcePath: source,
          sourceName: '主机手动导入',
          deviceId: 'admin',
          deviceName: '主机控制台',
          uploadedAt: new Date().toISOString(),
        });
        imported += 1;
      } catch {
        // Continue copying the rest.
      }
    }
    if (saved.length) addUploadRecords(saved);
    notify('onNativeImportResult', {
      ok: imported > 0,
      imported,
      message: imported > 0 ? `已导入 ${imported} 个文件到「${cleanName}原始资料库」。` : '没有文件被成功导入。',
    });
  }).catch((error) => notify('onNativeImportResult', { ok: false, imported: 0, message: `导入失败：${error.message}` }));
  return true;
}

function uniqueFile(dir, filename) {
  const initial = path.join(dir, filename);
  if (!fs.existsSync(initial)) return initial;
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  return path.join(dir, `${base}-${Date.now()}${ext}`);
}

function queryUninstallEntries() {
  if (process.platform !== 'win32') return [];
  if (uninstallEntriesCache.value.length && Date.now() - uninstallEntriesCache.at < 10 * 60 * 1000) return uninstallEntriesCache.value;
  const roots = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ];
  const entries = [];
  for (const root of roots) {
    try {
      const output = execFileSync('reg', ['query', root, '/s'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 8000,
      });
      let current = null;
      for (const rawLine of output.split(/\r?\n/)) {
        const line = rawLine.trimEnd();
        if (!line) continue;
        if (/^HKEY_/i.test(line)) {
          current = { key: line };
          entries.push(current);
          continue;
        }
        const match = line.match(/^\s+([^\s]+)\s+REG_\w+\s+(.*)$/);
        if (current && match) current[match[1]] = match[2].trim();
      }
    } catch {
      // Registry access can fail on restricted machines; filesystem probing is the fallback.
    }
  }
  uninstallEntriesCache = { at: Date.now(), value: entries };
  return entries;
}

function normalizeExePath(value) {
  if (!value) return '';
  const match = String(value).match(/"?([A-Za-z]:\\[^"]+?\.exe)"?/i);
  return match ? match[1] : '';
}

function findExecutableInPath(names) {
  const key = names.join('|').toLowerCase();
  const cached = executablePathCache.get(key);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000 && (!cached.value || fs.existsSync(cached.value))) return cached.value;
  for (const name of names) {
    try {
      const result = spawnSync('where.exe', [name], { encoding: 'utf8', windowsHide: true });
      const first = String(result.stdout || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      if (first && fs.existsSync(first)) {
        executablePathCache.set(key, { at: Date.now(), value: first });
        return first;
      }
    } catch {
      // Ignore PATH lookup failures.
    }
  }
  executablePathCache.set(key, { at: Date.now(), value: '' });
  return '';
}

function findVersionedExecutable(root, exeNames) {
  try {
    if (!root || !fs.existsSync(root)) return '';
    for (const exeName of exeNames) {
      const direct = path.join(root, exeName);
      if (fs.existsSync(direct)) return direct;
    }
    const directories = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
      .slice(0, 40);
    for (const directory of directories) {
      for (const exeName of exeNames) {
        const candidate = path.join(root, directory, exeName);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  } catch {
    // Installation discovery falls back to the registry and deep search.
  }
  return '';
}

function findAgentToolInstallUncached(toolId) {
  const toolMeta = {
    qclaw: {
      displayNeedle: 'qclaw',
      exeNames: ['QClaw.exe'],
      roots: [
        'D:\\Program Files\\QClaw',
        'C:\\Program Files\\QClaw',
        path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'QClaw'),
        path.join(os.homedir(), 'AppData', 'Local', 'QClaw'),
      ],
    },
    marvis: {
      displayNeedle: 'marvis',
      exeNames: ['MarvisLauncher.exe', 'Marvis.exe'],
      roots: [
        'D:\\Program Files\\Tencent\\Marvis',
        'C:\\Program Files\\Tencent\\Marvis',
        'D:\\Program Files\\Marvis',
        'C:\\Program Files\\Marvis',
        path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Marvis'),
        path.join(os.homedir(), 'AppData', 'Local', 'Marvis'),
      ],
    },
    hohu: {
      displayNeedle: 'hohu',
      exeNames: ['Hohu.exe', 'HohuAI.exe', 'Hohu.ai.exe', 'HohuLauncher.exe'],
      roots: [
        'D:\\Program Files\\Hohu',
        'C:\\Program Files\\Hohu',
        'D:\\Program Files\\Hohu.ai',
        'C:\\Program Files\\Hohu.ai',
        path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Hohu'),
        path.join(os.homedir(), 'AppData', 'Local', 'Hohu'),
      ],
    },
    openclaw: {
      displayNeedle: 'openclaw',
      exeNames: ['OpenClaw.exe', 'OpenClawLauncher.exe', 'OpenClaw Launcher.exe'],
      roots: [
        'D:\\Program Files\\OpenClaw',
        'C:\\Program Files\\OpenClaw',
        path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'OpenClaw'),
        path.join(os.homedir(), 'AppData', 'Local', 'OpenClaw'),
      ],
    },
    'ima.copilot': {
      displayNeedle: 'ima',
      exeNames: ['ima.exe', 'IMA.exe', 'ima.copilot.exe', 'ima-copilot.exe', 'imaCopilot.exe', 'TencentIMA.exe'],
      roots: [
        'D:\\Program Files\\Tencent\\IMA',
        'C:\\Program Files\\Tencent\\IMA',
        'D:\\Program Files\\IMA',
        'C:\\Program Files\\IMA',
        'D:\\Program Files\\ima.copilot',
        'C:\\Program Files\\ima.copilot',
        path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'IMA'),
        path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'ima.copilot'),
        path.join(os.homedir(), 'AppData', 'Local', 'IMA'),
        path.join(os.homedir(), 'AppData', 'Local', 'ima.copilot'),
      ],
    },
    workbuddy: {
      displayNeedle: 'workbuddy',
      exeNames: ['WorkBuddy.exe', 'workbuddy.exe', 'TencentWorkBuddy.exe', 'WorkBuddyLauncher.exe', 'WorkBuddy Launcher.exe'],
      roots: [
        'D:\\Program Files\\Tencent\\WorkBuddy',
        'C:\\Program Files\\Tencent\\WorkBuddy',
        'D:\\Program Files\\WorkBuddy',
        'C:\\Program Files\\WorkBuddy',
        path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'WorkBuddy'),
        path.join(os.homedir(), 'AppData', 'Local', 'WorkBuddy'),
      ],
    },
    codex: {
      displayNeedle: 'codex',
      exeNames: ['codex.cmd', 'codex.exe', 'codex'],
      roots: [
        path.join(os.homedir(), 'AppData', 'Roaming', 'npm'),
        path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'codex'),
        path.join(os.homedir(), '.codex'),
      ],
    },
    'claude-code': {
      displayNeedle: 'claude',
      exeNames: ['claude.cmd', 'claude.exe', 'claude'],
      roots: [
        path.join(os.homedir(), 'AppData', 'Roaming', 'npm'),
        path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'claude'),
        path.join(os.homedir(), '.claude'),
      ],
    },
  };
  const meta = toolMeta[toolId] || toolMeta.qclaw;
  const displayNeedle = meta.displayNeedle;
  const exeNames = meta.exeNames;
  const matchesRegistryEntry = (entry) => {
    const haystack = `${entry.DisplayName || ''} ${entry.InstallLocation || ''} ${entry.DisplayIcon || ''}`.toLowerCase();
    if (toolId === 'ima.copilot') {
      return /\bima(\.copilot)?\b|tencent\s*ima|腾讯.*ima/i.test(haystack);
    }
    return haystack.includes(displayNeedle);
  };
  if (toolId === 'codex' || toolId === 'claude-code') {
    const pathExe = findExecutableInPath(exeNames);
    if (pathExe) {
      return {
        installed: true,
        version: '',
        exePath: pathExe,
        installLocation: path.dirname(pathExe),
      };
    }
  }
  for (const root of Array.from(new Set(meta.roots.filter(Boolean)))) {
    const exe = findVersionedExecutable(root, exeNames);
    if (exe) {
      return { installed: true, version: '', exePath: exe, installLocation: path.dirname(exe) };
    }
  }
  const registryEntries = queryUninstallEntries().filter(matchesRegistryEntry);
  const roots = [];
  for (const entry of registryEntries) {
    const iconExe = normalizeExePath(entry.DisplayIcon);
    if (iconExe && exeNames.some((name) => path.basename(iconExe).toLowerCase() === name.toLowerCase()) && fs.existsSync(iconExe)) {
      return {
        installed: true,
        version: entry.DisplayVersion || '',
        exePath: iconExe,
        installLocation: entry.InstallLocation || path.dirname(iconExe),
      };
    }
    if (entry.InstallLocation) roots.push(entry.InstallLocation);
    if (iconExe) roots.push(path.dirname(iconExe));
  }
  roots.push(...meta.roots);
  for (const root of Array.from(new Set(roots.filter(Boolean)))) {
    const exe = findVersionedExecutable(root, exeNames);
    if (exe) {
      const entry = registryEntries[0] || {};
      return {
        installed: true,
        version: entry.DisplayVersion || '',
        exePath: exe,
        installLocation: entry.InstallLocation || path.dirname(exe),
      };
    }
  }
  return {
    installed: registryEntries.length > 0,
    version: registryEntries[0]?.DisplayVersion || '',
    exePath: '',
    installLocation: registryEntries[0]?.InstallLocation || '',
  };
}

function findAgentToolInstall(toolId) {
  const cached = agentToolInstallCache.get(toolId);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000 && (!cached.value.exePath || fs.existsSync(cached.value.exePath))) return cached.value;
  const value = findAgentToolInstallUncached(toolId);
  agentToolInstallCache.set(toolId, { at: Date.now(), value });
  return value;
}

function findTailscaleInstall() {
  const registryEntries = queryUninstallEntries().filter((entry) => {
    const haystack = `${entry.DisplayName || ''} ${entry.InstallLocation || ''} ${entry.DisplayIcon || ''}`.toLowerCase();
    return haystack.includes('tailscale');
  });
  const exeNames = ['tailscale-ipn.exe', 'tailscale.exe', 'Tailscale.exe'];
  const roots = [
    'C:\\Program Files\\Tailscale',
    'C:\\Program Files (x86)\\Tailscale',
    path.join(os.homedir(), 'AppData', 'Local', 'Tailscale'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Tailscale'),
  ];
  for (const entry of registryEntries) {
    const iconExe = normalizeExePath(entry.DisplayIcon);
    if (iconExe && fs.existsSync(iconExe)) {
      return {
        installed: true,
        version: entry.DisplayVersion || '',
        exePath: iconExe,
        installLocation: entry.InstallLocation || path.dirname(iconExe),
      };
    }
    if (entry.InstallLocation) roots.unshift(entry.InstallLocation);
  }
  for (const root of Array.from(new Set(roots.filter(Boolean)))) {
    const exe = findVersionedExecutable(root, exeNames);
    if (exe) {
      const entry = registryEntries[0] || {};
      return {
        installed: true,
        version: entry.DisplayVersion || '',
        exePath: exe,
        installLocation: entry.InstallLocation || path.dirname(exe),
      };
    }
  }
  return {
    installed: registryEntries.length > 0,
    version: registryEntries[0]?.DisplayVersion || '',
    exePath: '',
    installLocation: registryEntries[0]?.InstallLocation || '',
  };
}

function getAgentToolInstallStatus() {
  const qclaw = findAgentToolInstall('qclaw');
  const marvis = findAgentToolInstall('marvis');
  const hohu = findAgentToolInstall('hohu');
  const openclaw = findAgentToolInstall('openclaw');
  const imaCopilot = findAgentToolInstall('ima.copilot');
  const workbuddy = findAgentToolInstall('workbuddy');
  const codex = findAgentToolInstall('codex');
  const claudeCode = findAgentToolInstall('claude-code');
  const webTool = (url, label = '网页入口') => ({ installed: true, version: label, exePath: url, installLocation: url });
  const tailscale = findTailscaleInstall();
  return JSON.stringify({
    qclaw,
    marvis,
    hohu,
    openclaw,
    imaCopilot,
    workbuddy,
    codex,
    claudeCode,
    chatgpt: webTool(WEB_AGENT_TOOL_URLS.chatgpt),
    claude: webTool(WEB_AGENT_TOOL_URLS.claude),
    doubao: webTool(WEB_AGENT_TOOL_URLS.doubao),
    coze: webTool(WEB_AGENT_TOOL_URLS.coze, '平台入口'),
    fastgpt: webTool(WEB_AGENT_TOOL_URLS.fastgpt, '平台入口'),
    tailscale,
    anyInstalled: true,
    recommendedTool: qclaw.installed ? 'qclaw' : (openclaw.installed ? 'openclaw' : (workbuddy.installed ? 'workbuddy' : (hohu.installed ? 'hohu' : (imaCopilot.installed ? 'ima.copilot' : (marvis.installed ? 'marvis' : (codex.installed ? 'codex' : (claudeCode.installed ? 'claude-code' : 'qclaw'))))))),
  });
}

function findFile(root, filename, depth) {
  if (depth < 0 || !root || !fs.existsSync(root)) return null;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) return full;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = findFile(path.join(root, entry.name), filename, depth - 1);
    if (found) return found;
  }
  return null;
}

function openApp(appName) {
  if (appName === 'obsidian') {
    obsidianOpened = true;
    shell.openExternal('obsidian://open').catch(() => {
      shell.openPath('C:\\Program Files\\Obsidian\\Obsidian.exe').catch(() => {});
    });
    return true;
  }
  if (appName === 'qclaw') {
    const exe = findAgentToolInstall('qclaw').exePath;
    qclawOpened = true;
    if (exe && fs.existsSync(exe)) {
      spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
    } else {
      shell.openExternal('qclaw://').catch(() => shell.openExternal('https://qclaw.qq.com/').catch(() => {}));
    }
    return true;
  }
  if (appName === 'marvis') {
    const exe = findAgentToolInstall('marvis').exePath;
    marvisOpened = true;
    if (exe && fs.existsSync(exe)) {
      spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
    } else {
      shell.openExternal('https://marvis.qq.com/').catch(() => {});
    }
    return true;
  }
  if (appName === 'hohu') {
    const exe = findAgentToolInstall('hohu').exePath;
    hohuOpened = true;
    if (exe && fs.existsSync(exe)) {
      spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
    } else {
      shell.openExternal('https://hohu.ai/').catch(() => {});
    }
    return true;
  }
  if (appName === 'openclaw') {
    const exe = findAgentToolInstall('openclaw').exePath;
    openclawOpened = true;
    if (exe && fs.existsSync(exe)) {
      spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
    } else {
      shell.openExternal('openclaw://').catch(() => shell.openExternal('https://openclaw.ai/').catch(() => {}));
    }
    return true;
  }
  if (appName === 'ima.copilot') {
    const exe = findAgentToolInstall('ima.copilot').exePath;
    imaCopilotOpened = true;
    if (exe && fs.existsSync(exe)) {
      spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
    } else {
      shell.openExternal('https://ima.qq.com/').catch(() => {});
    }
    return true;
  }
  if (appName === 'workbuddy') {
    const exe = findAgentToolInstall('workbuddy').exePath;
    workbuddyOpened = true;
    if (exe && fs.existsSync(exe)) {
      spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
    } else {
      shell.openExternal('https://www.workbuddy.ai/').catch(() => {});
    }
    return true;
  }
  if (appName === 'codex') {
    codexOpened = true;
    const exe = findAgentToolInstall('codex').exePath;
    if (exe && fs.existsSync(exe)) {
      shell.openPath(defaultStudentBaseDir()).catch(() => {});
    } else {
      shell.openExternal('https://chatgpt.com/codex').catch(() => {});
    }
    return true;
  }
  if (appName === 'claude-code') {
    claudeCodeOpened = true;
    const exe = findAgentToolInstall('claude-code').exePath;
    if (exe && fs.existsSync(exe)) {
      shell.openPath(defaultStudentBaseDir()).catch(() => {});
    } else {
      shell.openExternal('https://www.anthropic.com/claude-code').catch(() => {});
    }
    return true;
  }
  if (WEB_AGENT_TOOL_URLS[appName]) {
    shell.openExternal(WEB_AGENT_TOOL_URLS[appName]).catch(() => {});
    return true;
  }
  if (appName === 'tailscale') {
    const exe = findTailscaleInstall().exePath;
    if (exe && fs.existsSync(exe)) {
      spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
    } else {
      shell.openExternal('https://tailscale.com/download/windows').catch(() => {});
    }
    return true;
  }
  return false;
}

function openExternalUrl(url) {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  shell.openExternal(url).catch(() => {});
  return true;
}

function openStudentRootDir(studentId) {
  try {
    const student = findStudentByKey(studentId);
    const dir = student?.rootPath || (student ? getStudentRootDir(student.name) : '');
    if (!dir) return JSON.stringify({ ok: false, message: '未找到学生知识库目录。' });
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir).catch(() => {});
    return JSON.stringify({ ok: true, path: dir, message: '已打开学生知识库目录。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `打开学生知识库目录失败：${error.message}` });
  }
}

function pickArchiveRoot() {
  dialog.showOpenDialog(mainWindow, {
    title: '选择学生资料根目录',
    properties: ['openDirectory'],
  }).then((result) => {
    if (result.canceled || !result.filePaths[0]) {
      notify('onNativeArchiveRootSelected', JSON.stringify({ ok: false, message: '未选择学生资料根目录' }));
      return;
    }
    setStudentBaseDir(result.filePaths[0]);
    notify('onNativeArchiveRootSelected', JSON.stringify({ ok: true, uri: result.filePaths[0] }));
  }).catch((error) => {
    notify('onNativeArchiveRootSelected', JSON.stringify({ ok: false, message: error.message }));
  });
  return true;
}

function getArchiveRootStatus() {
  const root = defaultStudentBaseDir();
  if (root && fs.existsSync(root)) return JSON.stringify({ ok: true, uri: root });
  return JSON.stringify({ ok: false, message: '尚未创建学生资料目录' });
}

function listMarkdownFiles(studentKey) {
  try {
    const student = findStudentByKey(studentKey);
    const target = student?.summaryPath || getSummaryDir(student?.name || studentKey);
    if (!fs.existsSync(target)) return JSON.stringify({ ok: false, message: `未找到 ${target}` });
    const files = [];
    collectMarkdownFiles(target, target, files, 8);
    return JSON.stringify({ ok: true, folder: target, storageMode: 'windows_documents', files });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `读取档案失败：${error.message}` });
  }
}

function collectMarkdownFiles(root, current, files, depth) {
  if (depth < 0) return;
  let entries;
  try {
    entries = fs.readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      collectMarkdownFiles(root, full, files, depth - 1);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      const stat = fs.statSync(full);
      files.push({
        id: full,
        name: entry.name,
        path: path.relative(root, full).replace(/\\/g, '/'),
        modified: stat.mtimeMs,
      });
    }
  }
}

function readMarkdownFile(documentId) {
  try {
    if (!documentId || !fs.existsSync(documentId)) return JSON.stringify({ ok: false, message: '未找到文件' });
    return JSON.stringify({ ok: true, content: fs.readFileSync(documentId, 'utf8') });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `读取 Markdown 失败：${error.message}` });
  }
}

function listLearningReports(studentKey) {
  try {
    const student = findStudentByKey(studentKey);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const license = publicLicenseStatus();
    const ensured = license.active
      ? ensureLearningReportsForStudent(student)
      : { reportDir: learningReportDirForStudent(student), created: [] };
    const reports = LEARNING_REPORTS.map((report) => learningReportRecord(student, report));
    const health = learningReportHealthSummary(reports);
    return JSON.stringify({
      ok: true,
      studentId: String(student.id),
      folder: ensured.reportDir,
      reports,
      health,
      created: ensured.created,
      message: ensured.created.length ? `已补建 ${ensured.created.length} 个报告模板。${health.message}` : health.message,
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `读取学情报告失败：${error.message}` });
  }
}

function readLearningReport(studentKey, reportId) {
  try {
    const student = findStudentByKey(studentKey);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const license = publicLicenseStatus();
    if (license.active) ensureLearningReportsForStudent(student);
    const report = LEARNING_REPORTS.find((item) => item.id === String(reportId));
    if (!report) return JSON.stringify({ ok: false, message: '未找到报告类型。' });
    const file = learningReportPathForStudent(student, report);
    if (!fs.existsSync(file)) {
      if (!license.active) return JSON.stringify({ ok: false, message: '未激活状态仅支持浏览已存在的学情报告。请激活后补建报告模板。' });
      fs.writeFileSync(file, learningReportTemplate(student, report), 'utf8');
    }
    return JSON.stringify({
      ok: true,
      ...learningReportRecord(student, report),
      content: fs.readFileSync(file, 'utf8'),
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `读取学情报告正文失败：${error.message}` });
  }
}

function ensureLearningReports(studentKey) {
  try {
    const student = findStudentByKey(studentKey);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const ensured = ensureLearningReportsForStudent(student);
    const reports = LEARNING_REPORTS.map((report) => learningReportRecord(student, report));
    const health = learningReportHealthSummary(reports);
    return JSON.stringify({
      ok: true,
      folder: ensured.reportDir,
      created: ensured.created,
      reports,
      health,
      message: ensured.created.length ? `已补建：${ensured.created.join('、')}。${health.message}` : health.message,
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `补建学情报告失败：${error.message}` });
  }
}

function ensureGrowthModel(studentKey) {
  try {
    const student = findStudentByKey(studentKey);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const result = ensureGrowthModelForStudent(student);
    return JSON.stringify({
      ok: true,
      folder: result.dir,
      created: result.created,
      message: result.created.length ? `已补建成长模型文件：${result.created.join('、')}` : '成长模型文件已存在。',
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `补建成长模型失败：${error.message}` });
  }
}

function resetUploadCounterIfNeeded() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== uploadCountDate) {
    uploadCountDate = today;
    todayUploadCount = 0;
  }
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  response.end(JSON.stringify(body));
}

function readRequestBuffer(request, maxBytes = 300 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('上传文件过大。'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function parseJsonBody(request) {
  return readRequestBuffer(request, 1024 * 1024).then((buffer) => {
    if (!buffer.length) return {};
    return JSON.parse(buffer.toString('utf8'));
  });
}

function parseMultipartFiles(buffer, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  const boundary = boundaryMatch && (boundaryMatch[1] || boundaryMatch[2]);
  if (!boundary) throw new Error('缺少 multipart boundary。');
  const delimiter = Buffer.from(`--${boundary}`);
  const files = [];
  let cursor = 0;
  while (cursor < buffer.length) {
    const partStart = buffer.indexOf(delimiter, cursor);
    if (partStart < 0) break;
    let bodyStart = partStart + delimiter.length;
    if (buffer.slice(bodyStart, bodyStart + 2).toString() === '--') break;
    if (buffer.slice(bodyStart, bodyStart + 2).toString() === '\r\n') bodyStart += 2;
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), bodyStart);
    if (headerEnd < 0) break;
    const headersText = buffer.slice(bodyStart, headerEnd).toString('utf8');
    let partEnd = buffer.indexOf(delimiter, headerEnd + 4);
    if (partEnd < 0) partEnd = buffer.length;
    let content = buffer.slice(headerEnd + 4, partEnd);
    if (content.slice(-2).toString() === '\r\n') content = content.slice(0, -2);
    const disposition = headersText.split(/\r\n/).find((line) => /^content-disposition:/i.test(line)) || '';
    const filenameMatch = /filename\*?=(?:UTF-8''([^;\r\n]+)|"([^"]*)"|([^;\r\n]+))/i.exec(disposition);
    const filename = filenameMatch && decodeURIComponent(filenameMatch[1] || filenameMatch[2] || filenameMatch[3] || '').trim();
    if (filename) files.push({ filename, content });
    cursor = partEnd;
  }
  return files;
}

function authContext(request) {
  const header = String(request.headers.authorization || '');
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const token = match ? match[1].trim() : '';
  if (!token) return null;
  if (token === ensureApiToken()) {
    return { type: 'admin', allowedStudentIds: null };
  }
  const device = deviceByBearerToken(token);
  if (!device) return null;
  touchDevice(device.id, request);
  return {
    type: 'device',
    deviceId: device.id,
    deviceName: device.name || '平板设备',
    allowedStudentIds: Array.isArray(device.allowedStudentIds) ? device.allowedStudentIds.map(String) : [],
    allowedAllStudents: Boolean(device.allowedAllStudents),
  };
}

function requireAuth(request, response) {
  const auth = authContext(request);
  if (!auth) {
    sendJson(response, 401, { ok: false, message: 'Unauthorized' });
    return false;
  }
  const locked = licenseRequiredPayload('平板协作服务');
  if (locked) {
    sendJson(response, 402, locked);
    return false;
  }
  request.authContext = auth;
  return true;
}

function isStudentAllowed(request, studentId) {
  const auth = request.authContext;
  if (!auth || auth.type === 'admin') return true;
  if (auth.allowedAllStudents) return true;
  return auth.allowedStudentIds.includes(String(studentId));
}

function requireStudentAccess(request, response, studentId) {
  if (!requireAuth(request, response)) return false;
  if (!isStudentAllowed(request, studentId)) {
    sendJson(response, 403, { ok: false, message: '当前设备没有访问该学生档案的权限。' });
    return false;
  }
  return true;
}

function findStudent(studentId) {
  return readStudentsIndex().find((student) => String(student.id) === String(studentId));
}

function handleHealth(_request, response) {
  sendJson(response, 200, {
    ok: true,
    version: APP_VERSION,
    hostName: os.hostname(),
    port: getHostServicePort(),
    license: publicLicenseStatus(),
  });
}

function handleStudents(request, response) {
  if (!requireAuth(request, response)) return;
  const students = readStudentsIndex().filter((student) => isStudentAllowed(request, student.id)).map((student) => {
    const rawPath = student.rawPath || getRawDir(student.name);
    const summaryPath = student.summaryPath || getSummaryDir(student.name);
    const records = readUploadRecords().filter((record) => String(record.studentId) === String(student.id));
    const state = readStudentDigestState(student);
    return {
      ...student,
      rawFileCount: countFiles(rawPath),
      archiveFileCount: countMarkdownFiles(summaryPath),
      pendingDigestCount: records.filter((record) => normalizeUploadStatus(record.status) === 'pending_digest').length,
      submittedDigestCount: records.filter((record) => ['submitted', 'digesting'].includes(normalizeUploadStatus(record.status))).length,
      processedDigestCount: records.filter((record) => normalizeUploadStatus(record.status) === 'processed').length,
      lastDigestAt: state.lastDigestAt || '',
      digestStatus: state.status || 'idle',
      digestMessage: state.message || '',
    };
  });
  const auth = request.authContext;
  const requiresApproval = auth.type === 'device'
    && !auth.allowedAllStudents
    && (!Array.isArray(auth.allowedStudentIds) || auth.allowedStudentIds.length === 0);
  sendJson(response, 200, {
    ok: true,
    students,
    authorization: {
      type: auth.type,
      deviceId: auth.deviceId || '',
      deviceName: auth.deviceName || '',
      requiresApproval,
      allowedStudentCount: auth.type === 'admin' ? readStudentsIndex().length : students.length,
    },
  });
}

function projectAllowed(request, project) {
  if (!request.authContext || request.authContext.type === 'admin') return true;
  if (request.authContext.allowedAllStudents) return true;
  const allowed = new Set(request.authContext.allowedStudentIds || []);
  return (project.studentIds || []).some((id) => allowed.has(String(id)));
}

function handleAssets(request, response) {
  if (!requireAuth(request, response)) return;
  const summary = assetIndexSummary();
  const allowedStudentIds = request.authContext.type === 'admin' || request.authContext.allowedAllStudents
    ? null
    : new Set(request.authContext.allowedStudentIds || []);
  const assets = allowedStudentIds
    ? summary.assets.filter((asset) => (asset.linkedStudents || []).some((id) => allowedStudentIds.has(String(id))))
    : summary.assets;
  sendJson(response, 200, { ...summary, assets, total: assets.length });
}

function handleProjects(request, response) {
  if (!requireAuth(request, response)) return;
  const projects = readProjects().map(normalizeProject).filter((project) => projectAllowed(request, project));
  sendJson(response, 200, { ok: true, projects });
}

async function handleProjectCreate(request, response) {
  if (!requireAuth(request, response)) return;
  if (request.authContext?.type !== 'admin') {
    sendJson(response, 403, { ok: false, message: '只有 Windows 主机管理员可以新建学习项目。' });
    return;
  }
  try {
    const body = await parseJsonBody(request);
    sendJson(response, 200, JSON.parse(createProject(JSON.stringify(body))));
  } catch (error) {
    sendJson(response, 400, { ok: false, message: error.message });
  }
}

async function handleProjectMaterialUpload(request, response, projectId) {
  if (!requireAuth(request, response)) return;
  const project = readProjects().map(normalizeProject).find((item) => String(item.id) === String(projectId));
  if (!project) {
    sendJson(response, 404, { ok: false, message: '未找到学习项目。' });
    return;
  }
  if (!projectAllowed(request, project)) {
    sendJson(response, 403, { ok: false, message: '当前设备没有访问该学习项目的权限。' });
    return;
  }
  try {
    const ensured = ensureProjectWorkspace(project);
    const buffer = await readRequestBuffer(request);
    const files = parseMultipartFiles(buffer, request.headers['content-type'] || '');
    if (!files.length) throw new Error('没有收到文件。');
    const saved = [];
    for (const file of files) {
      assertUploadFileAllowed(file.filename, file.content.length);
      const target = uniqueTargetFile(ensured.rawPath, file.filename);
      fs.writeFileSync(target, file.content);
      const stat = fs.statSync(target);
      const asset = upsertAssetFromFile(target, {
        projectId: ensured.id,
        projectName: ensured.name,
        sourceName: request.authContext?.deviceName || '项目上传',
        role: 'project_raw',
        uploadedAt: new Date().toISOString(),
        referenceId: `${ensured.id}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      });
      saved.push({
        filename: path.basename(target),
        path: target,
        size: stat.size,
        sha1: asset?.sha1 || sha1File(target),
        assetId: asset?.assetId || '',
      });
    }
    const projects = readProjects().map(normalizeProject);
    writeProjects(projects.map((item) => String(item.id) === String(ensured.id)
      ? { ...item, assetIds: mergeUnique([...(item.assetIds || []), ...saved.map((file) => file.assetId)]), updatedAt: new Date().toISOString() }
      : item));
    appendHostTimeline({ type: 'project_materials_uploaded', title: 'Project materials uploaded', detail: ensured.name, count: saved.length });
    sendJson(response, 200, { ok: true, projectId: ensured.id, files: saved, count: saved.length });
  } catch (error) {
    sendJson(response, 400, { ok: false, message: `上传项目资料失败：${error.message}` });
  }
}

function handleProjectArchiveFiles(request, response, projectId) {
  if (!requireAuth(request, response)) return;
  const project = readProjects().map(normalizeProject).find((item) => String(item.id) === String(projectId));
  if (!project) {
    sendJson(response, 404, { ok: false, message: '未找到学习项目。' });
    return;
  }
  if (!projectAllowed(request, project)) {
    sendJson(response, 403, { ok: false, message: '当前设备没有访问该学习项目的权限。' });
    return;
  }
  sendJson(response, 200, JSON.parse(listProjectArchiveFiles(projectId)));
}

function handleProjectPromotion(request, response, projectId) {
  if (!requireAuth(request, response)) return;
  if (request.authContext?.type !== 'admin') {
    sendJson(response, 403, { ok: false, message: '只有 Windows 主机管理员可以生成知识贡献申请。' });
    return;
  }
  sendJson(response, 200, JSON.parse(generateProjectPromotion(projectId)));
}

function handleProjectPromotionPublish(request, response, projectId) {
  if (!requireAuth(request, response)) return;
  if (request.authContext?.type !== 'admin') {
    sendJson(response, 403, { ok: false, message: '只有 Windows 主机管理员可以发布知识贡献。' });
    return;
  }
  sendJson(response, 200, JSON.parse(publishProjectPromotion(projectId)));
}

function handleProjectPromotionPlan(request, response, projectId) {
  if (!requireAuth(request, response)) return;
  if (request.authContext?.type !== 'admin') {
    sendJson(response, 403, { ok: false, message: '只有 Windows 主机管理员可以生成归档确认清单。' });
    return;
  }
  sendJson(response, 200, JSON.parse(projectPromotionPlan(projectId)));
}

function handleProjectPromotionExecute(request, response, projectId) {
  if (!requireAuth(request, response)) return;
  if (request.authContext?.type !== 'admin') {
    sendJson(response, 403, { ok: false, message: '只有 Windows 主机管理员可以执行归档确认清单。' });
    return;
  }
  parseJsonBody(request)
    .then((body) => sendJson(response, 200, JSON.parse(executeProjectPromotionPlan(projectId, JSON.stringify(body || {})))))
    .catch((error) => sendJson(response, 400, { ok: false, message: `读取归档确认清单失败：${error.message}` }));
}

function isPublicArchiveFile(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/').toLowerCase();
  const name = path.basename(normalized);
  if (!name.endsWith('.md')) return false;
  if (['agent.md', 'log.md', 'soul.md', 'memory.md', 'config.md', 'settings.md'].includes(name)) return false;
  if (normalized.includes('/.obsidian/') || normalized.includes('/.trash/')) return false;
  return true;
}

function handleArchiveFiles(request, response, studentId) {
  if (!requireStudentAccess(request, response, studentId)) return;
  const student = findStudent(studentId);
  if (!student) {
    sendJson(response, 404, { ok: false, message: '未找到学生' });
    return;
  }
  const summaryPath = student.summaryPath || getSummaryDir(student.name);
  if (!fs.existsSync(summaryPath)) {
    sendJson(response, 200, { ok: true, folder: summaryPath, files: [] });
    return;
  }
  const files = [];
  collectMarkdownFiles(summaryPath, summaryPath, files, 8);
  sendJson(response, 200, { ok: true, folder: summaryPath, files: files.filter((file) => isPublicArchiveFile(file.path)) });
}

function handleArchiveFile(request, response, studentId, url) {
  if (!requireStudentAccess(request, response, studentId)) return;
  const student = findStudent(studentId);
  if (!student) {
    sendJson(response, 404, { ok: false, message: '未找到学生' });
    return;
  }
  try {
    const summaryPath = student.summaryPath || getSummaryDir(student.name);
    const relativePath = url.searchParams.get('path') || '';
    if (!isPublicArchiveFile(relativePath)) throw new Error('该文件不在平板端档案浏览范围内。');
    const target = resolveInside(summaryPath, relativePath);
    if (!target.toLowerCase().endsWith('.md')) throw new Error('只允许读取 Markdown 文件');
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error('文件不存在');
    sendJson(response, 200, {
      ok: true,
      path: path.relative(summaryPath, target).replace(/\\/g, '/'),
      content: fs.readFileSync(target, 'utf8'),
    });
  } catch (error) {
    sendJson(response, 400, { ok: false, message: error.message });
  }
}

function handleLearningReports(request, response, studentId) {
  if (!requireStudentAccess(request, response, studentId)) return;
  const student = findStudent(studentId);
  if (!student) {
    sendJson(response, 404, { ok: false, message: '未找到学生' });
    return;
  }
  try {
    const ensured = ensureLearningReportsForStudent(student);
    const reports = LEARNING_REPORTS.map((report) => learningReportRecord(student, report));
    sendJson(response, 200, {
      ok: true,
      studentId: String(studentId),
      folder: ensured.reportDir,
      reports,
      health: learningReportHealthSummary(reports),
    });
  } catch (error) {
    sendJson(response, 400, { ok: false, message: error.message });
  }
}

function handleLearningReportFile(request, response, studentId, reportId) {
  if (!requireStudentAccess(request, response, studentId)) return;
  const student = findStudent(studentId);
  if (!student) {
    sendJson(response, 404, { ok: false, message: '未找到学生' });
    return;
  }
  try {
    ensureLearningReportsForStudent(student);
    const report = LEARNING_REPORTS.find((item) => item.id === String(reportId));
    if (!report) throw new Error('未找到报告类型。');
    const file = learningReportPathForStudent(student, report);
    sendJson(response, 200, {
      ok: true,
      ...learningReportRecord(student, report),
      content: fs.readFileSync(file, 'utf8'),
    });
  } catch (error) {
    sendJson(response, 400, { ok: false, message: error.message });
  }
}

function handleDigestStatus(request, response, studentId) {
  if (!requireStudentAccess(request, response, studentId)) return;
  const student = findStudent(studentId);
  if (!student) {
    sendJson(response, 404, { ok: false, message: 'Student not found.' });
    return;
  }
  const records = readUploadRecords().filter((record) => String(record.studentId) === String(studentId));
  const state = readStudentDigestState(student);
  sendJson(response, 200, {
    ok: true,
    studentId: String(studentId),
    pendingCount: records.filter((record) => normalizeUploadStatus(record.status) === 'pending_digest').length,
    submittedCount: records.filter((record) => ['submitted', 'digesting'].includes(normalizeUploadStatus(record.status))).length,
    processedCount: records.filter((record) => normalizeUploadStatus(record.status) === 'processed').length,
    lastUploadAt: records.map((record) => record.uploadedAt || '').sort().pop() || '',
    lastDigestAt: state.lastDigestAt || '',
    digestStatus: state.status || 'idle',
    message: state.message || '',
  });
}

async function handleMaterialUpload(request, response, studentId, url) {
  if (!requireStudentAccess(request, response, studentId)) return;
  const student = findStudent(studentId);
  if (!student) {
    sendJson(response, 404, { ok: false, message: '未找到学生' });
    return;
  }
  const rawPath = student.rawPath || getRawDir(student.name);
  fs.mkdirSync(rawPath, { recursive: true });
  try {
    const contentType = String(request.headers['content-type'] || '');
    const buffer = await readRequestBuffer(request);
    const saved = [];
    if (/multipart\/form-data/i.test(contentType)) {
      const files = parseMultipartFiles(buffer, contentType);
      if (!files.length) throw new Error('multipart request has no file parts.');
      for (const file of files) {
        assertUploadFileAllowed(file.filename, file.content.length);
        const target = uniqueTargetFile(rawPath, file.filename);
        fs.writeFileSync(target, file.content);
        saved.push({ filename: path.basename(target), path: target, size: file.content.length });
      }
    } else {
      const filename = url.searchParams.get('filename') || 'upload.bin';
      assertUploadFileAllowed(filename, buffer.length);
      const target = uniqueTargetFile(rawPath, filename);
      fs.writeFileSync(target, buffer);
      saved.push({ filename: path.basename(target), path: target, size: buffer.length });
    }
    resetUploadCounterIfNeeded();
    todayUploadCount += saved.length;
    addUploadRecords(saved.map((item) => ({
      id: `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      studentId: String(studentId),
      studentName: student.name,
      filename: item.filename,
      size: item.size,
      path: item.path,
      rawPath,
      sha1: sha1File(item.path),
      deviceId: request.authContext?.deviceId || 'admin',
      deviceName: request.authContext?.deviceName || '主机控制台',
      sourceType: url.searchParams.get('sourceType') || 'remote_upload',
      captureSessionId: url.searchParams.get('captureSessionId') || '',
      captureItemId: url.searchParams.get('captureItemId') || '',
      uploadedAt: new Date().toISOString(),
    })));
    const rawFileCount = countFiles(rawPath);
    notify('onNativeHostServiceChanged', getHostServiceStatus());
    sendJson(response, 200, {
      ok: true,
      imported: saved.length,
      files: saved,
      filename: saved[0]?.filename,
      path: saved[0]?.path,
      size: saved.reduce((total, item) => total + item.size, 0),
      rawFileCount,
      todayUploadCount,
    });
  } catch (error) {
    sendJson(response, 400, { ok: false, message: `Save upload failed: ${error.message}` });
  }
}
/*
  stream.on('error', (error) => {
    failed = true;
    sendJson(response, 500, { ok: false, message: `保存上传资料失败：${error.message}` });
  });
  stream.on('finish', () => {
    if (failed) return;
    resetUploadCounterIfNeeded();
    todayUploadCount += 1;
    const rawFileCount = countFiles(rawPath);
    sendJson(response, 200, {
      ok: true,
      filename: path.basename(target),
      path: target,
      size,
      rawFileCount,
      todayUploadCount,
    });
  });
}

*/
async function handlePairConfirm(request, response) {
  try {
    const body = await parseJsonBody(request);
    const pairCode = String(body.pairCode || '').trim();
    const session = getPairSession();
    if (!pairCode || pairCode !== session.pairCode || session.expiresAtMs <= Date.now()) {
      sendJson(response, 403, { ok: false, message: '配对码无效或已过期。' });
      return;
    }
    const license = publicLicenseStatus();
    if (!license.active) {
      sendJson(response, 402, { ok: false, message: license.message || 'Windows 主机尚未激活，请先在主机端输入授权码。', license });
      return;
    }
    const existingStudents = readStudentsIndex();
    const deviceId = String(body.deviceId || `device-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
    const activeDevices = readDevices().filter((item) => !item.revoked && String(item.id) !== deviceId);
    if (license.deviceLimit && activeDevices.length >= Number(license.deviceLimit)) {
      sendJson(response, 403, { ok: false, message: `授权设备数已达上限（${license.deviceLimit} 台）。请在 Windows 主机端撤销旧设备或升级授权。`, license });
      return;
    }
    if (license.studentLimit && existingStudents.length > Number(license.studentLimit)) {
      sendJson(response, 403, { ok: false, message: `当前学生数 ${existingStudents.length} 已超过授权上限（${license.studentLimit} 位）。请升级授权或减少学生后再绑定。`, license });
      return;
    }
    const allowedStudentIds = Array.isArray(body.allowedStudentIds) && body.allowedStudentIds.length
      ? body.allowedStudentIds.map(String).filter((id) => existingStudents.some((student) => String(student.id) === id))
      : existingStudents.map((student) => String(student.id));
    const token = createDeviceToken();
    const device = {
      id: deviceId,
      name: String(body.deviceName || body.name || '平板设备').slice(0, 80),
      tokenHash: hashDeviceToken(token),
      tokenPreview: `${token.slice(0, 7)}...${token.slice(-6)}`,
      allowedStudentIds,
      allowedAllStudents: true,
      autoAuthorizeNewStudents: true,
      revoked: false,
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      lastIp: requestClientIp(request),
      lastUserAgent: requestUserAgent(request),
    };
    const devices = readDevices().filter((item) => item.id !== device.id);
    devices.push(device);
    writeDevices(devices);
    activePairSession = null;
    notify('onNativeHostServiceChanged', getHostServiceStatus());
    sendJson(response, 200, {
      ok: true,
      token,
      device: publicDevice(device),
      students: existingStudents,
    });
  } catch (error) {
    sendJson(response, 400, { ok: false, message: `Pair confirm failed: ${error.message}` });
  }
}

async function handleDeviceEnroll(request, response) {
  if (!requireAuth(request, response)) return;
  if (request.authContext?.type !== 'admin') {
    sendJson(response, 403, { ok: false, message: '只有主机连接信息可以登记新设备。' });
    return;
  }
  try {
    const body = await parseJsonBody(request);
    const license = publicLicenseStatus();
    const deviceId = String(body.deviceId || `device-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`).slice(0, 120);
    const devices = readDevices();
    const activeDevices = devices.filter((item) => !item.revoked && String(item.id) !== deviceId);
    if (license.deviceLimit && activeDevices.length >= Number(license.deviceLimit)) {
      sendJson(response, 403, { ok: false, message: `授权设备数已达上限（${license.deviceLimit} 台）。请撤销旧设备或升级授权。` });
      return;
    }
    const token = createDeviceToken();
    const device = {
      id: deviceId,
      name: String(body.deviceName || body.name || '平板设备').trim().slice(0, 80) || '平板设备',
      tokenHash: hashDeviceToken(token),
      tokenPreview: `${token.slice(0, 7)}...${token.slice(-6)}`,
      allowedStudentIds: [],
      allowedAllStudents: false,
      autoAuthorizeNewStudents: false,
      revoked: false,
      createdAt: devices.find((item) => String(item.id) === deviceId)?.createdAt || new Date().toISOString(),
      enrolledAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      lastIp: requestClientIp(request),
      lastUserAgent: requestUserAgent(request),
    };
    writeDevices([...devices.filter((item) => String(item.id) !== deviceId), device]);
    appendHostTimeline({ type: 'device_enrolled', title: 'Tablet awaiting authorization', detail: device.name, deviceId });
    notify('onNativeHostServiceChanged', getHostServiceStatus());
    sendJson(response, 200, {
      ok: true,
      token,
      requiresApproval: true,
      message: '设备已登记，请在 Windows 主机端授权学生。',
      device: publicDevice(device),
    });
  } catch (error) {
    sendJson(response, 400, { ok: false, message: `设备登记失败：${error.message}` });
  }
}

function handleDeviceHeartbeat(request, response) {
  if (!requireAuth(request, response)) return;
  const auth = request.authContext;
  const device = auth?.type === 'device'
    ? readDevices().find((item) => String(item.id) === String(auth.deviceId))
    : null;
  sendJson(response, 200, {
    ok: true,
    at: new Date().toISOString(),
    device: device ? publicDevice(device) : null,
    studentCount: readStudentsIndex().length,
  });
}

function handleHostRequest(request, response) {
  if (request.method === 'OPTIONS') {
    sendJson(response, 200, { ok: true });
    return;
  }
  let url;
  try {
    url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  } catch {
    sendJson(response, 400, { ok: false, message: 'Bad Request' });
    return;
  }

  const pathname = decodeURIComponent(url.pathname);
  if (request.method === 'GET' && pathname === '/api/health') {
    handleHealth(request, response);
    return;
  }
  if (request.method === 'POST' && pathname === '/api/pair/confirm') {
    handlePairConfirm(request, response);
    return;
  }
  if (request.method === 'POST' && pathname === '/api/device/enroll') {
    handleDeviceEnroll(request, response);
    return;
  }
  if (request.method === 'POST' && pathname === '/api/device/heartbeat') {
    handleDeviceHeartbeat(request, response);
    return;
  }
  if (request.method === 'GET' && pathname === '/api/students') {
    handleStudents(request, response);
    return;
  }
  if (request.method === 'GET' && pathname === '/api/assets') {
    handleAssets(request, response);
    return;
  }
  if (request.method === 'GET' && pathname === '/api/projects') {
    handleProjects(request, response);
    return;
  }
  if (request.method === 'POST' && pathname === '/api/projects') {
    handleProjectCreate(request, response);
    return;
  }
  const projectMaterialMatch = pathname.match(/^\/api\/projects\/([^/]+)\/materials$/);
  if (request.method === 'POST' && projectMaterialMatch) {
    handleProjectMaterialUpload(request, response, projectMaterialMatch[1]);
    return;
  }
  const projectArchiveFilesMatch = pathname.match(/^\/api\/projects\/([^/]+)\/archive\/files$/);
  if (request.method === 'GET' && projectArchiveFilesMatch) {
    handleProjectArchiveFiles(request, response, projectArchiveFilesMatch[1]);
    return;
  }
  const projectPromotionMatch = pathname.match(/^\/api\/projects\/([^/]+)\/promotion$/);
  if (request.method === 'POST' && projectPromotionMatch) {
    handleProjectPromotion(request, response, projectPromotionMatch[1]);
    return;
  }
  const projectPromotionPublishMatch = pathname.match(/^\/api\/projects\/([^/]+)\/promotion\/publish$/);
  if (request.method === 'POST' && projectPromotionPublishMatch) {
    handleProjectPromotionPublish(request, response, projectPromotionPublishMatch[1]);
    return;
  }
  const projectPromotionPlanMatch = pathname.match(/^\/api\/projects\/([^/]+)\/promotion\/plan$/);
  if (request.method === 'GET' && projectPromotionPlanMatch) {
    handleProjectPromotionPlan(request, response, projectPromotionPlanMatch[1]);
    return;
  }
  const projectPromotionExecuteMatch = pathname.match(/^\/api\/projects\/([^/]+)\/promotion\/execute$/);
  if (request.method === 'POST' && projectPromotionExecuteMatch) {
    handleProjectPromotionExecute(request, response, projectPromotionExecuteMatch[1]);
    return;
  }
  const materialMatch = pathname.match(/^\/api\/students\/([^/]+)\/materials$/);
  if (request.method === 'POST' && materialMatch) {
    handleMaterialUpload(request, response, materialMatch[1], url);
    return;
  }
  const reportsMatch = pathname.match(/^\/api\/students\/([^/]+)\/reports$/);
  if (request.method === 'GET' && reportsMatch) {
    handleLearningReports(request, response, reportsMatch[1]);
    return;
  }
  const reportFileMatch = pathname.match(/^\/api\/students\/([^/]+)\/reports\/([^/]+)$/);
  if (request.method === 'GET' && reportFileMatch) {
    handleLearningReportFile(request, response, reportFileMatch[1], reportFileMatch[2]);
    return;
  }
  const archiveFilesMatch = pathname.match(/^\/api\/students\/([^/]+)\/archive\/files$/);
  if (request.method === 'GET' && archiveFilesMatch) {
    handleArchiveFiles(request, response, archiveFilesMatch[1]);
    return;
  }
  const archiveFileMatch = pathname.match(/^\/api\/students\/([^/]+)\/archive\/file$/);
  if (request.method === 'GET' && archiveFileMatch) {
    handleArchiveFile(request, response, archiveFileMatch[1], url);
    return;
  }
  const digestStatusMatch = pathname.match(/^\/api\/students\/([^/]+)\/digest-status$/);
  if (request.method === 'GET' && digestStatusMatch) {
    handleDigestStatus(request, response, digestStatusMatch[1]);
    return;
  }
  sendJson(response, 404, { ok: false, message: 'Not Found' });
}

function startHostService() {
  const locked = licenseRequiredJson('主机服务');
  if (locked) {
    hostServiceLastError = JSON.parse(locked).message;
    return JSON.stringify({ ...JSON.parse(getHostServiceStatus()), ok: false, message: hostServiceLastError });
  }
  if (hostServer) return getHostServiceStatus();
  ensureApiToken();
  const port = getHostServicePort();
  try {
    hostServer = http.createServer(handleHostRequest);
    hostServer.on('error', (error) => {
      hostServiceLastError = error.message;
      hostServer = null;
      notify('onNativeHostServiceChanged', getHostServiceStatus());
    });
    hostServer.listen(port, '0.0.0.0', () => {
      hostServiceStartedAt = new Date().toISOString();
      hostServiceLastError = '';
      notify('onNativeHostServiceChanged', getHostServiceStatus());
    });
    return getHostServiceStatus();
  } catch (error) {
    hostServer = null;
    hostServiceLastError = error.message;
    return getHostServiceStatus();
  }
}

function stopHostService() {
  if (!hostServer) return getHostServiceStatus();
  const server = hostServer;
  hostServer = null;
  server.close(() => {
    notify('onNativeHostServiceChanged', getHostServiceStatus());
  });
  return getHostServiceStatus();
}

function repairHostService() {
  const messages = [];
  try {
    fs.mkdirSync(defaultStudentBaseDir(), { recursive: true });
    messages.push('学生资料根目录已确认。');
  } catch (error) {
    messages.push(`学生资料根目录不可写：${error.message}`);
  }
  ensureApiToken();
  messages.push('API Token 已确认。');
  if (hostServer) {
    const server = hostServer;
    hostServer = null;
    server.close(() => {
      startHostService();
      notify('onNativeHostServiceChanged', getHostServiceStatus());
    });
    return JSON.stringify({
      ok: true,
      message: `${messages.join(' ')} 主机服务正在重启，请稍后刷新状态。`,
      status: JSON.parse(getHostServiceStatus()),
    });
  }
  const status = JSON.parse(startHostService());
  return JSON.stringify({
    ok: Boolean(status.running),
    message: `${messages.join(' ')} ${status.running ? '主机服务已启动。' : '主机服务启动失败，请查看诊断结果。'}`,
    status,
  });
}

function getHostServiceStatus() {
  resetUploadCounterIfNeeded();
  const info = getConnectionInfo();
  const pairPayload = getPairPayload();
  return JSON.stringify({
    running: Boolean(hostServer),
    port: info.port,
    serverUrl: info.serverUrl,
    lanUrls: info.lanUrls,
    tailscaleUrl: info.tailscaleUrl,
    tailscaleUrls: info.tailscaleUrls,
    connectionMode: info.connectionMode,
    apiToken: info.apiToken,
    pairCode: pairPayload.pairCode,
    pairExpiresAt: pairPayload.expiresAt,
    pairPayload,
    pairPayloadText: JSON.stringify(pairPayload),
    devices: readDevices().map(publicDevice),
    studentCount: readStudentsIndex().length,
    students: hostStudentStats(),
    todayUploadCount,
    recentUploads: readUploadRecords().slice(0, 8),
    license: publicLicenseStatus(),
    startedAt: hostServiceStartedAt,
    lastError: hostServiceLastError,
  });
}

function getHostServiceDiagnostics() {
  resetUploadCounterIfNeeded();
  const info = getConnectionInfo();
  const students = readStudentsIndex();
  const devices = readDevices();
  const activeDevices = devices.filter((device) => !device.revoked);
  const checks = [
    {
      label: '主机服务',
      ok: Boolean(hostServer),
      detail: hostServer ? `运行中，端口 ${info.port}` : '未启动。需要平板连接时，请先启动主机服务。',
      suggestion: hostServer ? '保持控制台打开即可。' : '在首页选择“主机-平板模式”，点击“启动服务”。',
    },
    {
      label: '局域网地址',
      ok: info.lanUrls.length > 0,
      detail: info.lanUrls.length > 0 ? info.lanUrls.join('；') : '没有检测到可用于平板访问的局域网地址。',
      suggestion: info.lanUrls.length > 0 ? '平板需连接同一 Wi-Fi，并使用二维码或扫码内容绑定。' : '检查电脑是否连接 Wi-Fi/网线，或稍后刷新服务状态。',
    },
    {
      label: 'Tailscale 地址',
      ok: info.tailscaleUrls.length > 0,
      detail: info.tailscaleUrls.length > 0 ? info.tailscaleUrls.join('；') : '未检测到 Tailscale 100.x 地址。',
      suggestion: info.tailscaleUrls.length > 0 ? '平板和主机加入同一个 Tailscale 网络后，可作为局域网失败时的远程回退地址。' : '如需远程连接，请先安装并登录 Tailscale；仅局域网使用可忽略。',
    },
    {
      label: 'API Token',
      ok: Boolean(info.apiToken),
      detail: info.apiToken ? `已生成：${info.apiToken.slice(0, 8)}...${info.apiToken.slice(-6)}` : '未生成。',
      suggestion: info.apiToken ? '无需手动输入，平板扫码配对后会自动保存设备 token。' : '启动主机服务后会自动生成。',
    },
    {
      label: '学生索引',
      ok: students.length > 0,
      detail: students.length > 0 ? `${students.length} 位学生可供授权。` : '还没有同步学生，请先初始化或新建学生。',
      suggestion: students.length > 0 ? '可在设备列表中勾选每台平板可访问的学生。' : '先在 Windows 控制台初始化或新建教育管家。',
    },
    {
      label: '平板设备',
      ok: activeDevices.length > 0,
      detail: activeDevices.length > 0 ? `${activeDevices.length} 台有效设备，${devices.length - activeDevices.length} 台已撤销。` : '暂无有效绑定设备。',
      suggestion: activeDevices.length > 0 ? '如资料串学生，请检查设备的学生访问范围。' : '打开平板终端，点击“扫码绑定主机”。',
    },
    {
      label: '最近错误',
      ok: !hostServiceLastError,
      detail: hostServiceLastError || '无。',
      suggestion: hostServiceLastError ? '若提示端口占用，请更换端口；若平板连不上，请检查防火墙和同一网络。' : '暂无需要处理的服务错误。',
    },
  ];
  return JSON.stringify({
    ok: checks.every((check) => check.ok),
    checkedAt: new Date().toISOString(),
    serverUrl: info.serverUrl,
    port: info.port,
    todayUploadCount,
    checks,
  });
}

function checkUpdate(manifestUrl, currentVersionCode) {
  const urls = String(manifestUrl || '').split('|').filter(Boolean);
  const tryUrl = (index) => {
    const url = urls[index];
    if (!url) {
      notify('onNativeUpdateResult', JSON.stringify({ hasUpdate: false, message: '更新检查失败：所有更新地址均不可用' }));
      return;
    }
    https.get(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try {
          const json = JSON.parse(body);
          const downloadUrl = json.windowsUrl || json.windows?.url || json.exeUrl || json.apkUrl;
          const nextVersionCode = Number(json.windowsVersionCode || json.versionCode || 0);
          const minimumVersionCode = Number(json.minimumWindowsVersionCode || json.minimumVersionCode || 0);
          const hasUpdate = nextVersionCode > Number(currentVersionCode) && Boolean(downloadUrl);
          notify('onNativeUpdateResult', JSON.stringify({
            ...json,
            versionCode: nextVersionCode,
            minimumVersionCode,
            forceUpdate: Boolean(json.forceWindowsUpdate || (minimumVersionCode && Number(currentVersionCode) < minimumVersionCode)),
            apkUrl: downloadUrl,
            windowsUrl: downloadUrl,
            notes: json.windowsNotes || json.notes,
            hasUpdate,
            message: hasUpdate ? undefined : '当前已是最新版本',
          }));
        } catch {
          tryUrl(index + 1);
        }
      });
    }).on('error', () => tryUrl(index + 1));
  };
  tryUrl(0);
  return true;
}

function downloadAndInstallUpdate(downloadUrl) {
  return openExternalUrl(downloadUrl);
}

function licensedIpc(event, action, handler) {
  const locked = licenseRequiredJson(action);
  if (locked) {
    event.returnValue = locked;
    return;
  }
  event.returnValue = handler();
}

ipcMain.on('bridge:copyText', (_event, value) => clipboard.writeText(String(value || '')));
ipcMain.on('bridge:exportTextFile', (event, filename, content) => { licensedIpc(event, '导出初始化文档', () => exportTextFile(filename, content)); });
ipcMain.on('bridge:importFiles', (event, studentName) => { licensedIpc(event, '导入资料', () => importFiles(studentName)); });
ipcMain.on('bridge:pickMaterialSourceDir', (event) => { licensedIpc(event, '资料来源目录', () => pickMaterialSourceDir()); });
ipcMain.on('bridge:scanMaterialSources', (event, studentId, sourcesJson) => { licensedIpc(event, '资料来源目录扫描', () => scanMaterialSources(studentId, sourcesJson)); });
ipcMain.on('bridge:importMaterialSourceFiles', (event, studentId, pathsJson) => { licensedIpc(event, '导入资料', () => importMaterialSourceFiles(studentId, pathsJson)); });
ipcMain.on('bridge:getMaterialImportRecords', (event, studentId) => { event.returnValue = getMaterialImportRecords(studentId); });
ipcMain.on('bridge:getAssetIndex', (event) => { event.returnValue = JSON.stringify(assetIndexSummary()); });
ipcMain.on('bridge:rebuildAssetIndex', (event) => { licensedIpc(event, '资产索引补建', () => rebuildAssetIndex()); });
ipcMain.on('bridge:analyzeAssetGovernance', (event) => { licensedIpc(event, '资产治理建议', () => analyzeAssetGovernance()); });
ipcMain.on('bridge:cleanupAssetReferences', (event, assetId) => { licensedIpc(event, '资产引用清理', () => cleanupAssetReferences(assetId)); });
ipcMain.on('bridge:createAssetVersionSnapshot', (event, assetId) => { licensedIpc(event, '资产版本快照', () => createAssetVersionSnapshot(assetId)); });
ipcMain.on('bridge:markAssetGovernanceDecision', (event, assetId, decision, note) => { licensedIpc(event, '资产治理人工决策', () => markAssetGovernanceDecision(assetId, decision, note)); });
ipcMain.on('bridge:generateKnowledgeArchitectureReport', (event) => { licensedIpc(event, '知识关系图生成', () => generateKnowledgeArchitectureReport()); });
ipcMain.on('bridge:getProjects', (event) => { event.returnValue = getProjects(); });
ipcMain.on('bridge:createProject', (event, optionsJson) => { licensedIpc(event, '学习项目创建', () => createProject(optionsJson)); });
ipcMain.on('bridge:updateProjectMetadata', (event, projectId, metadataJson) => { licensedIpc(event, '编辑学习项目', () => updateProjectMetadata(projectId, metadataJson)); });
ipcMain.on('bridge:removeProjectRecord', (event, projectId) => { licensedIpc(event, '删除学习项目记录', () => removeProjectRecord(projectId)); });
ipcMain.on('bridge:relocateProjectWorkspace', (event, projectId) => { licensedIpc(event, '项目路径重新定位', () => relocateProjectWorkspace(projectId)); });
ipcMain.on('bridge:getRemovedProjects', (event) => { licensedIpc(event, '已移除项目读取', () => getRemovedProjects()); });
ipcMain.on('bridge:restoreRemovedProject', (event, snapshotPath) => { licensedIpc(event, '项目记录恢复', () => restoreRemovedProject(snapshotPath)); });
ipcMain.on('bridge:exportProjectPackage', (event, projectId) => { licensedIpc(event, '项目导出', () => exportProjectPackage(projectId)); });
ipcMain.on('bridge:importProjectPackage', (event) => { licensedIpc(event, '项目导入', () => importProjectPackage()); });
ipcMain.on('bridge:duplicateProject', (event, projectId, name) => { licensedIpc(event, '复制学习项目', () => duplicateProject(projectId, name)); });
ipcMain.on('bridge:updateProjectStudentEvidence', (event, projectId, studentId, evidenceJson) => { licensedIpc(event, '学生独立成长证据', () => updateProjectStudentEvidence(projectId, studentId, evidenceJson)); });
ipcMain.on('bridge:buildCrossProjectKnowledgeIndex', (event) => { licensedIpc(event, '跨项目知识关联', () => buildCrossProjectKnowledgeIndex()); });
ipcMain.on('bridge:pickProjectWorkspaceDir', (event) => { licensedIpc(event, '选择已有项目文件夹', () => pickProjectWorkspaceDir()); });
ipcMain.on('bridge:updateProjectStatus', (event, projectId, status) => { licensedIpc(event, '学习项目状态更新', () => updateProjectStatus(projectId, status)); });
ipcMain.on('bridge:updateProjectStudents', (event, projectId, studentIdsJson) => { licensedIpc(event, '学习项目绑定学生', () => updateProjectStudents(projectId, studentIdsJson)); });
ipcMain.on('bridge:applyProjectWorkspaceTemplate', (event, projectId, templateId, foldersJson, templateName, templateV2Json) => { licensedIpc(event, '项目模板 V2', () => applyProjectWorkspaceTemplate(projectId, templateId, foldersJson, templateName, templateV2Json)); });
ipcMain.on('bridge:openProjectSpace', (event, projectId, space) => { licensedIpc(event, '打开学习项目空间', () => openProjectSpace(projectId, space)); });
ipcMain.on('bridge:scanProjectWorkspace', (event, projectId) => { licensedIpc(event, '扫描项目工作空间', () => scanProjectWorkspace(projectId)); });
ipcMain.on('bridge:reviewProjectStagingItems', (event, projectId, itemIdsJson, decision, sourceStrategy, note) => { licensedIpc(event, '项目资料人工审核', () => reviewProjectStagingItems(projectId, itemIdsJson, decision, sourceStrategy, note)); });
ipcMain.on('bridge:getProjectKnowledgeReview', (event, projectId) => { licensedIpc(event, '读取项目知识资产审核', () => getProjectKnowledgeReview(projectId)); });
ipcMain.on('bridge:updateProjectKnowledgeReview', (event, projectId, recordIdsJson, status, note) => { licensedIpc(event, '项目知识资产审核', () => updateProjectKnowledgeReview(projectId, recordIdsJson, status, note)); });
ipcMain.on('bridge:importProjectAssets', (event, projectId, assetIdsJson) => { licensedIpc(event, '项目资料导入', () => importProjectAssets(projectId, assetIdsJson)); });
ipcMain.on('bridge:importProjectRawFiles', (event, projectId) => { licensedIpc(event, '项目原始资料导入', () => importProjectRawFiles(projectId)); });
ipcMain.on('bridge:getProjectDigestCommand', (event, projectId) => { licensedIpc(event, '项目消化指令', () => getProjectDigestCommand(projectId)); });
ipcMain.on('bridge:markProjectDigestSubmitted', (event, projectId) => { licensedIpc(event, '项目消化提交标记', () => markProjectDigestSubmitted(projectId)); });
ipcMain.on('bridge:syncProjectDigestResult', (event, projectId) => { licensedIpc(event, '项目消化结果同步', () => syncProjectDigestResult(projectId)); });
ipcMain.on('bridge:importProjectStagingFiles', (event, projectId) => { licensedIpc(event, '项目研究暂存导入', () => importProjectStagingFiles(projectId)); });
ipcMain.on('bridge:updateProjectStagingStatus', (event, projectId, itemIdsJson, status) => { licensedIpc(event, '项目研究暂存状态', () => updateProjectStagingStatus(projectId, itemIdsJson, status)); });
ipcMain.on('bridge:promoteProjectStagingItems', (event, projectId, itemIdsJson) => { licensedIpc(event, '项目研究暂存晋升', () => promoteProjectStagingItems(projectId, itemIdsJson)); });
ipcMain.on('bridge:importProjectStagingAiScreening', (event, projectId) => { licensedIpc(event, '项目研究暂存 AI 初筛导入', () => importProjectStagingAiScreening(projectId)); });
ipcMain.on('bridge:analyzeProjectStagingGovernance', (event, projectId) => { licensedIpc(event, '项目研究暂存治理建议', () => analyzeProjectStagingGovernance(projectId)); });
ipcMain.on('bridge:generateProjectPromotion', (event, projectId) => { licensedIpc(event, '知识贡献申请', () => generateProjectPromotion(projectId)); });
ipcMain.on('bridge:getProjectPromotionPlan', (event, projectId) => { licensedIpc(event, '归档确认清单', () => projectPromotionPlan(projectId)); });
ipcMain.on('bridge:getProjectPromotionAudit', (event, projectId) => { licensedIpc(event, '知识贡献审计', () => getProjectPromotionAudit(projectId)); });
ipcMain.on('bridge:executeProjectPromotionPlan', (event, projectId, planJson) => { licensedIpc(event, '执行归档确认清单', () => executeProjectPromotionPlan(projectId, planJson)); });
ipcMain.on('bridge:publishProjectPromotion', (event, projectId) => { licensedIpc(event, '知识贡献发布', () => publishProjectPromotion(projectId)); });
ipcMain.on('bridge:rollbackProjectPromotionRun', (event, projectId, runId) => { licensedIpc(event, '知识贡献回滚', () => rollbackProjectPromotionRun(projectId, runId)); });
ipcMain.on('bridge:initStudentWorkspace', (event, studentName, agentMd, indexMd, logMd) => {
  licensedIpc(event, '初始化教育管家', () => initStudentWorkspace(studentName, agentMd, indexMd, logMd));
});
ipcMain.on('bridge:openApp', (event, appName) => { event.returnValue = openApp(appName); });
ipcMain.on('bridge:openExternalUrl', (event, url) => { event.returnValue = openExternalUrl(url); });
ipcMain.on('bridge:getAppStatus', (event) => {
  event.returnValue = JSON.stringify({ qclawOpened, marvisOpened, hohuOpened, openclawOpened, imaCopilotOpened, workbuddyOpened, codexOpened, claudeCodeOpened, obsidianOpened });
});
ipcMain.on('bridge:getStorageConfig', (event) => { event.returnValue = getStorageConfig(); });
ipcMain.on('bridge:getTemplateCenter', (event, systemTemplatesJson) => { event.returnValue = getTemplateCenter(systemTemplatesJson); });
ipcMain.on('bridge:saveCustomTemplates', (event, templatesJson) => { licensedIpc(event, '模板管理', () => saveCustomTemplates(templatesJson)); });
ipcMain.on('bridge:restoreSystemTemplates', (event, systemTemplatesJson) => { licensedIpc(event, '模板管理', () => restoreSystemTemplates(systemTemplatesJson)); });
ipcMain.on('bridge:getAgentCenter', (event, studentId) => { event.returnValue = getAgentCenter(studentId); });
ipcMain.on('bridge:saveAgentMemorySource', (event, studentId, tool, content, mode) => { licensedIpc(event, '智能体记忆管理', () => saveAgentMemorySource(studentId, tool, content, mode)); });
ipcMain.on('bridge:mergeAgentMemory', (event, studentId) => { licensedIpc(event, '智能体记忆管理', () => mergeAgentMemory(studentId)); });
ipcMain.on('bridge:saveUnifiedMemory', (event, studentId, content) => { licensedIpc(event, '智能体记忆管理', () => saveUnifiedMemory(studentId, content)); });
ipcMain.on('bridge:saveAgentSoulSource', (event, studentId, tool, content) => { licensedIpc(event, '智能体设定管理', () => saveAgentSoulSource(studentId, tool, content)); });
ipcMain.on('bridge:saveUnifiedSoul', (event, studentId, content) => { licensedIpc(event, '智能体设定管理', () => saveUnifiedSoul(studentId, content)); });
ipcMain.on('bridge:compareAgentSoulSource', (event, studentId, tool) => { event.returnValue = compareAgentSoulSource(studentId, tool); });
ipcMain.on('bridge:scanAgentKnowledgeFiles', (event, studentId) => { event.returnValue = scanAgentKnowledgeFiles(studentId); });
ipcMain.on('bridge:importAgentKnowledgeFile', (event, studentId, filePath, tool, kind) => { licensedIpc(event, '智能体知识导入', () => importAgentKnowledgeFile(studentId, filePath, tool, kind)); });
ipcMain.on('bridge:getAgentRules', (event, studentId) => { event.returnValue = getAgentRules(studentId); });
ipcMain.on('bridge:saveAgentRuleFile', (event, studentId, fileName, content) => { licensedIpc(event, '智能体规则文件管理', () => saveAgentRuleFile(studentId, fileName, content)); });
ipcMain.on('bridge:generateAgentRuleFile', (event, studentId, fileName) => { licensedIpc(event, '智能体规则文件管理', () => generateAgentRuleFile(studentId, fileName)); });
ipcMain.on('bridge:compareAgentRuleFiles', (event, studentId, baseName, targetName) => { event.returnValue = compareAgentRuleFiles(studentId, baseName, targetName); });
ipcMain.on('bridge:getAgentSourceRegistry', (event, studentId) => { event.returnValue = getAgentSourceRegistry(studentId); });
ipcMain.on('bridge:rollbackAgentSourceRecord', (event, studentId, recordId) => { licensedIpc(event, '智能体知识管理', () => rollbackAgentSourceRecord(studentId, recordId)); });
ipcMain.on('bridge:getAgentConversationCenter', (event, studentId) => { event.returnValue = getAgentConversationCenter(studentId); });
ipcMain.on('bridge:saveAgentConversationImport', (event, studentId, content, tool, sourcePath) => { licensedIpc(event, '对话历史导入', () => saveAgentConversationImport(studentId, content, tool, sourcePath)); });
ipcMain.on('bridge:selectAgentConversationFiles', (event, studentId, tool) => { licensedIpc(event, '对话历史导入', () => selectAgentConversationFiles(studentId, tool)); });
ipcMain.on('bridge:saveConversationExtract', (event, studentId, extractJson, tool) => { licensedIpc(event, '对话历史提取', () => saveConversationExtract(studentId, extractJson, tool)); });
ipcMain.on('bridge:openStudentRootDir', (event, studentId) => { licensedIpc(event, '打开学生知识库目录', () => openStudentRootDir(studentId)); });
ipcMain.on('bridge:checkStudentPathHealth', (event, studentId) => { licensedIpc(event, '知识库路径核对', () => checkStudentPathHealth(studentId)); });
ipcMain.on('bridge:repairStudentStalePaths', (event, studentId) => { licensedIpc(event, '知识库路径修复', () => repairStudentStalePaths(studentId)); });
ipcMain.on('bridge:checkAllStudentsPathHealth', (event) => { licensedIpc(event, '批量知识库路径核对', () => checkAllStudentsPathHealth()); });
ipcMain.on('bridge:resolveStudentPath', (event, studentId, logicalPath) => { event.returnValue = resolveStudentPathFromLogical(studentId, logicalPath); });
ipcMain.on('bridge:getLicenseStatus', (event) => { event.returnValue = getLicenseStatus(); });
ipcMain.on('bridge:activateLicense', (event, code) => { event.returnValue = activateLicense(code); });
ipcMain.on('bridge:deactivateLicense', (event) => { event.returnValue = deactivateLicense(); });
ipcMain.on('bridge:getAgentToolInstallStatus', (event) => { event.returnValue = getAgentToolInstallStatus(); });
ipcMain.on('bridge:checkUpdate', (event, manifestUrl, currentVersionCode) => {
  event.returnValue = checkUpdate(manifestUrl, currentVersionCode);
});
ipcMain.on('bridge:downloadAndInstallUpdate', (event, downloadUrl) => {
  event.returnValue = downloadAndInstallUpdate(downloadUrl);
});
ipcMain.on('bridge:pickArchiveRoot', (event) => { licensedIpc(event, '更换资料根目录', () => pickArchiveRoot()); });
ipcMain.on('bridge:getArchiveRootStatus', (event) => { event.returnValue = getArchiveRootStatus(); });
ipcMain.on('bridge:listMarkdownFiles', (event, studentName) => { event.returnValue = listMarkdownFiles(studentName); });
ipcMain.on('bridge:readMarkdownFile', (event, documentId) => { event.returnValue = readMarkdownFile(documentId); });
ipcMain.on('bridge:listLearningReports', (event, studentId) => { event.returnValue = listLearningReports(studentId); });
ipcMain.on('bridge:readLearningReport', (event, studentId, reportId) => { event.returnValue = readLearningReport(studentId, reportId); });
ipcMain.on('bridge:ensureLearningReports', (event, studentId) => { licensedIpc(event, '学情报告模板补建', () => ensureLearningReports(studentId)); });
ipcMain.on('bridge:ensureGrowthModel', (event, studentId) => { licensedIpc(event, '成长模型补建', () => ensureGrowthModel(studentId)); });
ipcMain.on('bridge:getGrowthEvidenceReview', (event, studentId) => { event.returnValue = getGrowthEvidenceReview(studentId); });
ipcMain.on('bridge:updateGrowthEvidenceStatus', (event, studentId, evidenceId, status, note) => { licensedIpc(event, '成长证据审核', () => updateGrowthEvidenceStatus(studentId, evidenceId, status, note)); });
ipcMain.on('bridge:rebuildGrowthIndex', (event, studentId) => { licensedIpc(event, '成长模型结构化索引', () => rebuildGrowthIndex(studentId)); });
ipcMain.on('bridge:getGrowthIndex', (event, studentId) => { event.returnValue = getGrowthIndex(studentId); });
ipcMain.on('bridge:getStudents', (event) => { event.returnValue = getStudentsIndex(); });
ipcMain.on('bridge:syncStudents', (event, studentsJson) => { licensedIpc(event, '学生档案同步', () => syncStudentsIndex(studentsJson)); });
ipcMain.on('bridge:selectKnowledgeBaseRoot', (event) => { licensedIpc(event, '接管已有知识库', () => selectKnowledgeBaseRoot()); });
ipcMain.on('bridge:scanKnowledgeBase', (event, rootPath, studentName) => { event.returnValue = scanExistingKnowledgeBase(rootPath, studentName); });
ipcMain.on('bridge:ensureAdoptedKnowledgeBase', (event, optionsJson) => { licensedIpc(event, '接管已有知识库', () => ensureAdoptedKnowledgeBase(optionsJson)); });
ipcMain.on('bridge:getHostServiceStatus', (event) => { event.returnValue = getHostServiceStatus(); });
ipcMain.on('bridge:getHostServiceDiagnostics', (event) => { event.returnValue = getHostServiceDiagnostics(); });
ipcMain.on('bridge:repairHostService', (event) => { licensedIpc(event, '主机服务修复', () => repairHostService()); });
ipcMain.on('bridge:startHostService', (event) => { licensedIpc(event, '主机服务', () => startHostService()); });
ipcMain.on('bridge:stopHostService', (event) => { event.returnValue = stopHostService(); });
ipcMain.on('bridge:setHostServicePort', (event, port) => { licensedIpc(event, '主机服务端口设置', () => setHostServicePort(port)); });
ipcMain.on('bridge:getHostConnectionInfo', (event) => { event.returnValue = getHostConnectionInfo(); });
ipcMain.on('bridge:getHostDevices', (event) => { event.returnValue = getHostDevices(); });
ipcMain.on('bridge:getHostUploadRecords', (event) => { event.returnValue = getHostUploadRecords(); });
ipcMain.on('bridge:exportHostUploadRecords', (event) => { event.returnValue = exportHostUploadRecords(); });
ipcMain.on('bridge:openHostUploadRecord', (event, recordId) => { event.returnValue = openHostUploadRecord(recordId); });
ipcMain.on('bridge:clearHostUploadRecords', (event) => { licensedIpc(event, '上传记录维护', () => clearHostUploadRecords()); });
ipcMain.on('bridge:setHostUploadRecordStatus', (event, recordId, status) => { licensedIpc(event, '上传记录状态维护', () => setHostUploadRecordStatus(recordId, status)); });
ipcMain.on('bridge:markStudentDigestSubmitted', (event, studentId) => { licensedIpc(event, '资料消化任务', () => markStudentDigestSubmitted(studentId)); });
ipcMain.on('bridge:syncStudentDigestResult', (event, studentId) => { licensedIpc(event, '资料消化结果同步', () => syncStudentDigestResult(studentId, { forceSubmitted: true })); });
ipcMain.on('bridge:recordScheduledTaskAction', (event, studentId, kind, commandText) => { licensedIpc(event, '定时任务账本', () => recordScheduledTaskAction(studentId, kind, commandText)); });
ipcMain.on('bridge:getStudentScheduleLedger', (event, studentId) => { event.returnValue = getStudentScheduleLedger(studentId); });
ipcMain.on('bridge:getTaskCenter', (event) => { event.returnValue = getTaskCenter(); });
ipcMain.on('bridge:getTaskCenterCapabilities', (event) => { event.returnValue = getTaskCenterCapabilities(); });
ipcMain.on('bridge:setTaskAutomationEnabled', (event, enabled) => { licensedIpc(event, '任务自动运行模式', () => setTaskAutomationEnabled(enabled)); });
ipcMain.on('bridge:executeTask', (event, taskId, executor) => { licensedIpc(event, '执行任务中心任务', () => executeTaskByAdapter(taskId, executor)); });
ipcMain.on('bridge:approveTask', (event, taskId, decision, note) => { licensedIpc(event, '任务审批', () => approveTask(taskId, decision, note)); });
ipcMain.on('bridge:retryTask', (event, taskId) => { licensedIpc(event, '任务重试', () => retryTask(taskId)); });
ipcMain.on('bridge:cancelTask', (event, taskId, note) => { licensedIpc(event, '取消任务', () => cancelTask(taskId, note)); });
ipcMain.on('bridge:importTaskResult', (event, taskId) => { licensedIpc(event, '导入任务结果', () => importTaskResult(taskId)); });
ipcMain.on('bridge:syncQClawTaskResults', (event) => { licensedIpc(event, '同步 QClaw 任务结果', () => syncQClawTaskResults()); });
ipcMain.on('bridge:submitDailyActionFeedback', (event, taskId, status, note) => { licensedIpc(event, '每日行动反馈', () => submitDailyActionFeedback(taskId, status, note)); });
ipcMain.on('bridge:openTaskCenterPath', (event, kind) => { event.returnValue = openTaskCenterPath(kind); });
ipcMain.on('bridge:generateStudentMaintenanceReport', (event, studentId) => { licensedIpc(event, '定时维护报告', () => generateStudentMaintenanceReport(studentId)); });
ipcMain.on('bridge:getHostTimeline', (event) => { event.returnValue = getHostTimeline(); });
ipcMain.on('bridge:backupHostData', (event, studentsJson) => { licensedIpc(event, '主机数据备份', () => backupHostData(studentsJson)); });
ipcMain.on('bridge:restoreHostData', (event) => { licensedIpc(event, '主机数据恢复', () => restoreHostData()); });
ipcMain.on('bridge:resetHostApiToken', (event) => { licensedIpc(event, '重置 API Token', () => resetHostApiToken()); });
ipcMain.on('bridge:exportHostLogs', (event) => { event.returnValue = exportHostLogs(); });
ipcMain.on('bridge:openStudentRawDir', (event, studentId) => { licensedIpc(event, '打开原始资料库', () => openStudentRawDir(studentId)); });
ipcMain.on('bridge:migrateStudentWorkspace', (event, studentId, newName) => { licensedIpc(event, '学生知识库迁移', () => migrateStudentWorkspace(studentId, newName)); });
ipcMain.on('bridge:renameHostDevice', (event, deviceId, name) => { licensedIpc(event, '设备管理', () => renameHostDevice(deviceId, name)); });
ipcMain.on('bridge:revokeHostDevice', (event, deviceId) => { licensedIpc(event, '设备管理', () => revokeHostDevice(deviceId)); });
ipcMain.on('bridge:restoreHostDevice', (event, deviceId) => { licensedIpc(event, '设备管理', () => restoreHostDevice(deviceId)); });
ipcMain.on('bridge:deleteHostDevice', (event, deviceId) => { licensedIpc(event, '设备管理', () => deleteHostDevice(deviceId)); });
ipcMain.on('bridge:setHostDeviceStudentAccess', (event, deviceId, studentIdsJson) => {
  licensedIpc(event, '设备授权管理', () => setHostDeviceStudentAccess(deviceId, studentIdsJson));
});
ipcMain.on('bridge:setHostDeviceAccessMode', (event, deviceId, optionsJson) => {
  licensedIpc(event, '设备授权管理', () => setHostDeviceAccessMode(deviceId, optionsJson));
});
ipcMain.on('bridge:getCaptureCenterState', (event) => { event.returnValue = getCaptureCenterState(); });
ipcMain.on('bridge:openCaptureInbox', (event, sessionId) => { event.returnValue = openCaptureInbox(sessionId); });
ipcMain.handle('bridge:listCaptureSources', async () => listCaptureSources());
ipcMain.handle('bridge:startCaptureSession', async (_event, optionsJson) => {
  const locked = licenseRequiredJson('屏幕资料采集');
  return locked || startCaptureSession(optionsJson);
});
ipcMain.handle('bridge:pauseCaptureSession', async (_event, sessionId) => pauseCaptureSession(sessionId));
ipcMain.handle('bridge:resumeCaptureSession', async (_event, sessionId) => resumeCaptureSession(sessionId));
ipcMain.handle('bridge:highlightCaptureSession', async (_event, sessionId) => highlightCaptureSession(sessionId));
ipcMain.handle('bridge:stopCaptureSession', async (_event, sessionId) => stopCaptureSession(sessionId));
ipcMain.handle('bridge:promoteCaptureSession', async (_event, sessionId) => {
  const locked = licenseRequiredJson('屏幕采集资料晋升');
  return locked || promoteCaptureSession(sessionId);
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    createWindow();
    createCaptureTray();
    registerCaptureShortcuts();
    if (process.env.EDU_DISABLE_TASK_SCHEDULER !== '1' && taskAutomationEnabled()) {
      void refreshAdapterCapabilities(true);
      startUnifiedTaskScheduler();
    }
  });
}

app.on('before-quit', () => {
  globalShortcut.unregisterAll();
  if (captureControlWindow && !captureControlWindow.isDestroyed()) captureControlWindow.destroy();
  captureControlWindow = null;
  if (captureTray && !captureTray.isDestroyed()) captureTray.destroy();
  captureTray = null;
  if (activeCaptureRuntime) {
    if (activeCaptureRuntime.timer) clearInterval(activeCaptureRuntime.timer);
    if (activeCaptureRuntime.stopTimer) clearTimeout(activeCaptureRuntime.stopTimer);
    activeCaptureRuntime.session.status = 'interrupted';
    activeCaptureRuntime.session.endedAt = new Date().toISOString();
    activeCaptureRuntime.session.endReason = 'app_closed';
    persistCaptureSession(activeCaptureRuntime.session);
    activeCaptureRuntime = null;
  }
  stopUnifiedTaskScheduler();
  for (const running of taskChildProcesses.values()) {
    try { if (running?.child && !running.child.killed) running.child.kill(); } catch { /* App shutdown continues. */ }
  }
  taskChildProcesses.clear();
  if (hostServer) {
    hostServer.close();
    hostServer = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
