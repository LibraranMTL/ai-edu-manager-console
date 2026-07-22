const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const { desktopCapturer, globalShortcut, Menu, Tray } = require('electron');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const dgram = require('dgram');
const crypto = require('crypto');
const { mergeAssetReferences, recentAssetTrend } = require('./asset-statistics.cjs');
const { lanDiscoveryBroadcastTargets } = require('./lan-discovery.cjs');
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
const { parseDigestReceipt } = require('./digest-receipt.cjs');
const { buildDigestBatch, digestIdempotencyKey, readDigestBatch, writeJsonAtomic } = require('./digest-batch.cjs');
const { validateDigestResult } = require('./digest-result.cjs');
const { createDigestOrchestrator, digestUserStatus, isDigestTask, shouldAutoAccept, userStatusLabel } = require('./digest-orchestrator.cjs');
const { parseJsonText } = require('./json-file.cjs');
const { buildGrowthIndexV2, parseLegacyGrowthEvidenceMarkdown } = require('./growth-model.cjs');
const { growthIndexNeedsRebuild, growthSourceFingerprint, legacyReportCandidate } = require('./growth-index-consistency.cjs');
const { mapGrowthEvidenceReviewToEducationClaims, mapGrowthIndexV2ToDomainSnapshot } = require('./education-growth-compatibility.cjs');
const { buildGrowthEvidenceBatchPlan } = require('./growth-evidence-risk.cjs');
const {
  CANDIDATE_REGISTRY_SCHEMA,
  MAX_PROMOTION_BATCH,
  assessCandidateRisk,
  buildKnowledgeCandidates,
  canPromoteCandidate,
  hashText: sha256Text,
  mergeCandidateRegistry,
  normalizeConversationImport,
  stableId: stableGovernanceId,
  updateCandidate,
} = require('./conversation-governance.cjs');
const {
  applyPromotionTransaction,
  reapplyPromotionTransaction,
  rollbackInterruptedPromotionTransaction,
  rollbackPromotionTransaction,
} = require('./conversation-promotion-transaction.cjs');
const { verifiedStudentEvidenceForPublication } = require('./project-evidence.cjs');
const { normalizeProjectStudentEvidencePayload } = require('./project-student-evidence-adapter.cjs');
const { buildProjectReviewPackage } = require('./project-flow-orchestrator.cjs');
const { compactDigestTaskStore } = require('./task-store-compaction.cjs');
const { nextKnowledgeReviewState, nextStagingReviewState, projectCompletionIssues, reconcileDigestControlState, validateDigestReceipt } = require('./project-integrity.cjs');
const { PROJECT_SCREENING_PARSER_VERSION, buildProjectScreeningPreview } = require('./project-screening.cjs');
const { completionBlockers, singleStudentEvidenceDraft } = require('./project-completion.cjs');
const { weekRange, monthRange, reportIsCurrent, validateSectionedDraft, publishReviewedReport } = require('./learning-report-workflow.cjs');
const { collectWorkspaceFiles, isPathInside: canonicalIsPathInside, sha1FileAsync, validateWorkspaceRebind } = require('./project-workspace.cjs');
const { adoptionPathmap, scanProjectKnowledgeBase } = require('./project-knowledge-adoption.cjs');
const { markUploadRecordsRemoved } = require('./upload-record-governance.cjs');
const { createDirectoryCountCache } = require('./directory-count-cache.cjs');
const { streamRequestToFile } = require('./streaming-upload.cjs');
const {
  PAIR_PROTOCOL_VERSION,
  createPairRequest,
  machineCode,
  machineCodeConflict,
  nextPairRequestStatus,
  normalizePairRequest,
  verifyRequestToken,
} = require('./pairing-protocol.cjs');
const {
  ensureStudentLoginIds,
  isValidStudentLoginId,
  migrateTerminalDevices,
  normalizeHostUsageMode,
  normalizeStudentLoginId,
  normalizeTerminalMode,
  studentLoginQrPayload,
} = require('./student-terminal-session.cjs');

let mainWindow;
const activeProjectWorkspaceScans = new Map();
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
let hostDiscoverySocket = null;
const discoveredLanTablets = new Map();
const studentSessions = new Map();
let lastTabletDiscoveryAt = '';
let hostServiceStartedAt = '';
let hostServiceLastError = '';
let todayUploadCount = 0;
let uploadCountDate = new Date().toISOString().slice(0, 10);
const taskChildProcesses = new Map();
let taskSchedulerTimer = null;
let taskSchedulerStartupTimer = null;
let taskSchedulerRunning = false;
let digestWorkflowTimer = null;
let digestWorkflowRunning = false;
let adapterCapabilityCache = { at: 0, value: null, refreshing: null };
let activeCaptureRuntime = null;
let captureTray = null;
let captureControlWindow = null;
let openClawCronSyncState = { at: 0, promise: null, result: null };
let uninstallEntriesCache = { at: 0, value: [] };
let projectDigestLookupCache = { mtimeMs: -1, size: -1, projects: [] };
const executablePathCache = new Map();
const agentToolInstallCache = new Map();
const hostDirectoryCountCache = createDirectoryCountCache({ ttlMs: 5 * 60 * 1000 });

const APP_VERSION = app.getVersion();
const DEFAULT_HOST_PORT = 18777;
const HOST_DISCOVERY_PORT = 18778;
const HOST_DISCOVERY_REQUEST_V1 = 'AI_EDU_MANAGER_DISCOVER_V1';
const HOST_DISCOVERY_REQUEST_V2 = 'AI_EDU_MANAGER_DISCOVER';
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
const hostIdentityPath = () => path.join(app.getPath('userData'), 'host-identity.json');
const pairRequestsPath = () => path.join(app.getPath('userData'), 'pair-requests.json');
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
  writeJsonAtomic(settingsPath(), settings);
}

function getHostUsageMode() {
  return normalizeHostUsageMode(readSettings().usageMode, 'host');
}

function setHostUsageMode(mode) {
  const usageMode = normalizeHostUsageMode(mode, 'host');
  const settings = readSettings();
  writeSettings({ ...settings, usageMode });
  appendHostTimeline({ type: 'usage_mode_changed', title: 'Usage mode changed', detail: usageMode });
  if (usageMode === 'host' && hostServer) stopHostService();
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  return JSON.stringify({ ok: true, usageMode, status: JSON.parse(getHostServiceStatus()), message: usageMode === 'host_terminal' ? '已切换为主机-终端模式。' : '已切换为主机模式。' });
}

function writeHostIdentity(identity) {
  writeJsonAtomic(hostIdentityPath(), identity);
}

function getHostIdentity() {
  const current = safeReadJson(hostIdentityPath(), {});
  const hostId = String(current.hostId || `host-${crypto.randomUUID()}`);
  const identity = {
    hostId,
    machineCode: String(current.machineCode || machineCode('host', hostId)),
    displayName: String(current.displayName || os.hostname() || 'AI教育管家主机').trim().slice(0, 80) || 'AI教育管家主机',
    createdAt: current.createdAt || new Date().toISOString(),
    updatedAt: current.updatedAt || current.createdAt || new Date().toISOString(),
  };
  if (!current.hostId || !current.machineCode || !current.displayName) writeHostIdentity(identity);
  return identity;
}

function renameHostIdentity(displayName) {
  const cleanName = String(displayName || '').trim().slice(0, 80);
  if (!cleanName) return JSON.stringify({ ok: false, message: '主机名称不能为空。' });
  const identity = { ...getHostIdentity(), displayName: cleanName, updatedAt: new Date().toISOString() };
  writeHostIdentity(identity);
  appendHostTimeline({ type: 'host_identity_renamed', title: 'Host identity renamed', detail: cleanName });
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  return JSON.stringify({ ok: true, identity, message: '主机名称已更新，固定主机码保持不变。', status: JSON.parse(getHostServiceStatus()) });
}

function readPairRequests() {
  const parsed = safeReadJson(pairRequestsPath(), { requests: [] });
  const now = Date.now();
  return (Array.isArray(parsed.requests) ? parsed.requests : [])
    .map((request) => normalizePairRequest(request, now))
    .filter(Boolean)
    .slice(0, 100);
}

function writePairRequests(requests) {
  writeJsonAtomic(pairRequestsPath(), { requests: requests.slice(0, 100) });
}

function publicPairRequest(request) {
  if (!request) return null;
  const { requestTokenHash, issuedToken, issuedTokenExpiresAt, ...safe } = request;
  return safe;
}

function refreshPairRequests() {
  const before = safeReadJson(pairRequestsPath(), { requests: [] }).requests || [];
  const requests = readPairRequests();
  if (JSON.stringify(before) !== JSON.stringify(requests)) {
    const expiredIds = new Set(requests.filter((item) => item.status === 'expired').map((item) => String(item.requestId)));
    for (const item of before) {
      if (item.status !== 'expired' && expiredIds.has(String(item.requestId))) {
        appendHostTimeline({ type: 'device_pair_v2_expired', title: 'Device connection request expired', detail: item.tabletName || item.requestId, deviceId: item.tabletId || '' });
      }
    }
    writePairRequests(requests);
  }
  return requests;
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
    const input = Array.isArray(parsed.devices) ? parsed.devices : [];
    const migrated = migrateTerminalDevices(input, readStudentsIndex().map((student) => String(student.id)));
    if (migrated.changed) writeDevices(migrated.devices);
    return migrated.devices;
  } catch {
    return [];
  }
}

function writeDevices(devices) {
  writeJsonAtomic(devicesPath(), { devices });
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
  writeJsonAtomic(uploadRecordsPath(), { records: records.slice(0, 200) });
  hostDirectoryCountCache.clear();
}

function normalizeUploadStatus(status) {
  const value = String(status || '').trim();
  if (['pending_digest', 'submitted', 'digesting', 'processed', 'failed', 'ignored', 'removed'].includes(value)) return value;
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

function studentDigestManifestPath(student) {
  return path.join(studentManagerDir(student), 'digest-manifest.json');
}

function studentDigestReceiptPath(student) {
  return path.join(studentManagerDir(student), 'digest-receipt.json');
}

function studentDigestBatchPath(student) {
  return path.join(studentManagerDir(student), 'digest-batch.json');
}

function studentDigestReviewReceiptPath(student) {
  return path.join(studentManagerDir(student), 'digest-review-receipt.json');
}

function studentDigestReviewRequestPath(student) {
  return path.join(studentManagerDir(student), 'digest-review-request.json');
}

function studentDigestAuditPath(student) {
  return path.join(studentManagerDir(student), 'digest-audit.json');
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
    return parseJsonText(fs.readFileSync(filePath, 'utf8'));
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
  writeJsonAtomic(studentMaterialsPath(student), {
    version: 1,
    studentId: String(student.id || ''),
    studentName: student.name || '',
    updatedAt: new Date().toISOString(),
    materials: materials.slice(0, 1000),
  });
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
  writeJsonAtomic(studentDigestStatePath(student), next);
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
  const materials = Array.from(byId.values()).sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')));
  writeStudentMaterials(student, materials);
  const pendingCount = materials.filter((item) => normalizeUploadStatus(item.status) === 'pending_digest').length;
  const submittedCount = materials.filter((item) => ['submitted', 'digesting'].includes(normalizeUploadStatus(item.status))).length;
  const currentState = readStudentDigestState(student);
  const currentStatus = normalizeDigestStateStatus(currentState.status);
  const latestSubmittedMs = Math.max(0, ...materials
    .filter((item) => ['submitted', 'digesting'].includes(normalizeUploadStatus(item.status)))
    .map((item) => Date.parse(item.statusUpdatedAt || item.uploadedAt || '') || 0));
  const lastDigestMs = Date.parse(currentState.lastDigestAt || '') || 0;
  const completedCoversSubmitted = currentStatus === 'completed'
    && lastDigestMs > 0
    && lastDigestMs >= latestSubmittedMs;
  const nextStatus = pendingCount > 0
    ? currentStatus === 'partial' ? 'partial' : 'pending'
    : submittedCount > 0
      ? completedCoversSubmitted ? 'completed' : currentStatus === 'failed' ? 'failed' : 'digesting'
      : currentStatus === 'completed' ? 'completed' : currentStatus === 'failed' ? 'failed' : 'idle';
  const nextMessage = pendingCount > 0
    ? currentStatus === 'partial' ? currentState.message || `已有部分资料完成，剩余 ${pendingCount} 份可重试。` : `有 ${pendingCount} 份资料尚未提交消化。`
    : submittedCount > 0
      ? completedCoversSubmitted
        ? currentState.message || `Agent 已完成消化，等待控制台同步 ${submittedCount} 份资料。`
        : currentStatus === 'failed'
          ? currentState.message || 'Agent 消化失败，请检查回执后重试。'
          : `${submittedCount} 份资料已提交，等待 Agent 完成并写回回执。`
      : currentStatus === 'completed'
        ? currentState.message || '最近一批资料已完成消化。'
        : currentStatus === 'failed'
          ? currentState.message || '最近一批资料存在识别失败项，请查看覆盖审计。'
          : '暂无待消化资料。';
  writeStudentDigestState(student, {
    status: nextStatus,
    message: nextMessage,
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
  writeJsonAtomic(assetIndexPath(), {
    version: 1,
    updatedAt: new Date().toISOString(),
    assets: assets.slice(0, 5000),
  });
}

function readProjects() {
  try {
    const parsed = JSON.parse(fs.readFileSync(projectsPath(), 'utf8'));
    return Array.isArray(parsed.projects) ? parsed.projects : [];
  } catch {
    return [];
  }
}

function readProjectsForDigestLookup() {
  try {
    const stat = fs.statSync(projectsPath());
    if (projectDigestLookupCache.mtimeMs === stat.mtimeMs && projectDigestLookupCache.size === stat.size) {
      return projectDigestLookupCache.projects;
    }
    const projects = readProjects().map(normalizeProject);
    projectDigestLookupCache = { mtimeMs: stat.mtimeMs, size: stat.size, projects };
    return projects;
  } catch {
    projectDigestLookupCache = { mtimeMs: -1, size: -1, projects: [] };
    return [];
  }
}

function writeProjects(projects) {
  writeJsonAtomic(projectsPath(), {
    version: 1,
    updatedAt: new Date().toISOString(),
    projects,
  });
  projectDigestLookupCache = { mtimeMs: -1, size: -1, projects: [] };
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
  const dedupedReferences = mergeAssetReferences(references);
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
    recentTrend: recentAssetTrend(assets),
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

function importMaterialSourceFiles(studentId, pathsJson, targetJson = '') {
  const student = findStudentByKey(studentId);
  if (!student) return JSON.stringify({ ok: false, imported: 0, skipped: 0, failed: 0, message: '未找到学生。' });
  try {
    const paths = JSON.parse(pathsJson || '[]');
    if (!Array.isArray(paths) || !paths.length) return JSON.stringify({ ok: false, imported: 0, skipped: 0, failed: 0, message: '请先选择要导入的资料文件。' });
    let target = {};
    try { target = JSON.parse(targetJson || '{}'); } catch { target = {}; }
    const targetProject = target.type === 'project'
      ? readProjects().map(normalizeProject).find((item) => String(item.id) === String(target.id || ''))
      : null;
    if (target.type === 'project' && (!targetProject || !(targetProject.studentIds || []).map(String).includes(String(student.id)))) {
      return JSON.stringify({ ok: false, imported: 0, skipped: 0, failed: 0, message: '所选项目不存在或未绑定当前学生。' });
    }
    if (targetProject?.status === 'sealed') {
      return JSON.stringify({ ok: false, imported: 0, skipped: 0, failed: 0, message: '所选项目已封存，不能继续导入资料。' });
    }
    const ensuredProject = targetProject ? ensureProjectWorkspace(targetProject) : null;
    const rawPath = ensuredProject?.rawPath || student.rawPath || getRawDir(student.name);
    fs.mkdirSync(rawPath, { recursive: true });
    const existingHashes = new Set((ensuredProject ? collectProjectRawFiles(rawPath) : readStudentMaterials(student)).map((item) => String(item.sha1 || '')).filter(Boolean));
    if (!ensuredProject) {
      readUploadRecords()
        .filter((record) => String(record.studentId) === String(student.id))
        .forEach((record) => {
          if (record.sha1) existingHashes.add(String(record.sha1));
        });
    }
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
        const record = {
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
          sourceType: 'host_material_source',
          uploadedAt: new Date().toISOString(),
        };
        if (ensuredProject) {
          const asset = upsertAssetFromFile(target, {
            studentId: String(student.id),
            studentName: student.name,
            projectId: ensuredProject.id,
            projectName: ensuredProject.name,
            spaceType: 'project',
            sourcePath,
            sourceName: record.sourceName,
            sourceType: 'host_material_source',
            role: 'project_raw_direct',
            referenceId: `${ensuredProject.id}-source-${targetHash || crypto.randomBytes(4).toString('hex')}`,
          });
          record.assetId = asset?.assetId || '';
          record.projectId = ensuredProject.id;
          record.projectName = ensuredProject.name;
        }
        saved.push(record);
      } catch {
        failed += 1;
      }
    }
    if (saved.length) {
      if (ensuredProject) {
        const now = new Date().toISOString();
        const digestState = writeProjectDigestState(ensuredProject, {
          status: 'pending',
          message: `有 ${saved.length} 份主机导入资料待消化。`,
          triggerReason: 'host_material_source',
        });
        writeProjects(readProjects().map(normalizeProject).map((item) => String(item.id) === String(ensuredProject.id)
          ? projectWithNewInputs({ ...item, assetIds: mergeUnique([...(item.assetIds || []), ...saved.map((record) => record.assetId)]), digestState, updatedAt: now }, 'host_material_source', now)
          : item));
      } else {
        addUploadRecords(saved);
      }
      notify('onNativeHostServiceChanged', getHostServiceStatus());
    }
    return JSON.stringify({
      ok: saved.length > 0,
      imported: saved.length,
      skipped,
      failed,
      records: saved,
      targetType: ensuredProject ? 'project' : 'student',
      targetId: ensuredProject?.id || String(student.id),
      targetName: ensuredProject?.name || student.name,
      message: saved.length
        ? `已导入 ${saved.length} 个文件到「${ensuredProject ? `${ensuredProject.name}项目原始资料库` : `${student.name}原始资料库`}」${skipped ? `，跳过 ${skipped} 个重复文件` : ''}${failed ? `，${failed} 个文件失败` : ''}。`
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
    .filter((record) => normalizeUploadStatus(record.status) !== 'removed')
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
      reason: record.sourcePath ? '' : '来自学生终端上传或手动导入',
    }))
    .sort((a, b) => String(b.importedAt || '').localeCompare(String(a.importedAt || '')))
    .slice(0, 100);
  return JSON.stringify({ ok: true, records });
}

function removeMaterialImportRecords(studentId, recordIdsJson) {
  const student = readStudentsIndex().find((item) => String(item.id) === String(studentId));
  if (!student) return JSON.stringify({ ok: false, removed: 0, message: '未找到学生档案。' });
  let recordIds = [];
  try { recordIds = JSON.parse(recordIdsJson || '[]'); } catch { recordIds = []; }
  if (!Array.isArray(recordIds) || !recordIds.length) return JSON.stringify({ ok: false, removed: 0, message: '请先选择要移除的资料记录。' });
  const current = readUploadRecords();
  const result = markUploadRecordsRemoved(current, { studentId, recordIds });
  if (!result.removed.length) {
    const reason = result.blocked.length
      ? '所选资料已经提交、正在消化或已完成，为保护批次和审计记录不能移除。'
      : '没有找到可移除的资料记录。';
    return JSON.stringify({ ok: false, removed: 0, blocked: result.blocked, missing: result.missing, message: reason });
  }
  writeUploadRecords(result.records);
  upsertStudentMaterialsFromUploads(student, result.removed.map((record) => ({ ...record, rawPath: student.rawPath || getRawDir(student.name) })));
  appendHostTimeline({
    type: 'upload_records_removed',
    title: 'Upload records removed',
    detail: `${result.removed.length} record(s) removed without deleting physical files`,
    studentId: String(student.id),
    studentName: student.name,
    count: result.removed.length,
  });
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  return JSON.stringify({
    ok: true,
    removed: result.removed.length,
    blocked: result.blocked,
    missing: result.missing,
    retainedPaths: result.removed.map((record) => record.path).filter(Boolean),
    message: `已从活动资料列表移除 ${result.removed.length} 条记录；物理文件和文件资产均保留。${result.blocked.length ? ` 另有 ${result.blocked.length} 条因已进入消化流程而未移除。` : ''}`,
  });
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
  writeJsonAtomic(hostTimelinePath(), { events: events.slice(0, 300) });
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

function registerStudentDigestBatch(studentId, options = {}) {
  const student = readStudentsIndex().find((item) => String(item.id) === String(studentId));
  if (!student) return { ok: false, message: '未找到学生档案。' };
  const normalized = toHostStudent(student);
  syncStudentMaterialsFromUploadRecords(normalized);
  const currentState = readStudentDigestState(normalized);
  const existingBatch = readDigestBatch(studentDigestBatchPath(normalized));
  if (['submitted', 'digesting'].includes(normalizeDigestStateStatus(currentState.status)) && currentState.digestBatchId && existingBatch?.batchId === currentState.digestBatchId) {
    return { ok: true, reused: true, student: normalized, batch: existingBatch, state: currentState, message: '当前消化批次已在处理中。' };
  }
  const allRecords = readUploadRecords();
  const rawRoot = normalized.rawPath || getRawDir(normalized.name);
  const pending = allRecords.filter((record) => String(record.studentId) === String(studentId)
    && (normalizeUploadStatus(record.status) === 'pending_digest'
      || (options.includeSubmitted && ['submitted', 'digesting'].includes(normalizeUploadStatus(record.status)))));
  if (!pending.length) return { ok: false, skipped: true, message: '当前没有待处理资料。' };
  const files = pending.map((record) => {
    const absolutePath = String(record.path || '');
    const relativePath = absolutePath && rawRoot ? path.relative(rawRoot, absolutePath).replace(/\\/g, '/') : String(record.filename || '');
    const sha1 = String(record.sha1 || sha1File(absolutePath)).toLowerCase();
    return { materialId: String(record.id || ''), relativePath, path: absolutePath, sha1, size: Number(record.size || 0) };
  });
  const unreadable = files.find((file) => !file.path || !fs.existsSync(file.path) || !file.sha1);
  if (unreadable) return { ok: false, message: `资料无法读取，未建立批次：${unreadable.relativePath || unreadable.materialId}` };
  const now = new Date().toISOString();
  const batch = buildDigestBatch({
    scope: { type: 'student', id: String(normalized.id), name: normalized.name },
    files,
    batchId: options.batchId || `student-digest-${timestampForFilename()}-${crypto.randomBytes(3).toString('hex')}`,
    createdAt: now,
    submittedAt: now,
    status: 'submitted',
    output: {
      knowledgeRoot: normalized.rootPath || getStudentRootDir(normalized.name),
      receiptPath: studentDigestReceiptPath(normalized),
      requiredArtifacts: [path.join(normalized.summaryPath || getSummaryDir(normalized.name), 'index.md'), path.join(normalized.summaryPath || getSummaryDir(normalized.name), 'log.md')],
    },
  });
  const receiptPath = studentDigestReceiptPath(normalized);
  if (fs.existsSync(receiptPath)) {
    fs.copyFileSync(receiptPath, `${receiptPath}.previous-${timestampForFilename()}.bak`);
    fs.rmSync(receiptPath, { force: true });
  }
  writeJsonAtomic(studentDigestBatchPath(normalized), batch);
  const submittedIds = new Set(batch.files.map((file) => file.materialId));
  const records = allRecords.map((record) => submittedIds.has(String(record.id || ''))
    ? { ...record, sha1: batch.files.find((file) => file.materialId === String(record.id || ''))?.sha1 || record.sha1 || '', status: 'submitted', statusUpdatedAt: now, digestBatchId: batch.batchId }
    : record);
  writeUploadRecords(records);
  syncStudentMaterialsFromUploadRecords(normalized);
  const state = writeStudentDigestState(normalized, {
    status: 'submitted',
    digestSubmittedAt: now,
    digestBatchId: batch.batchId,
    digestBatchPath: studentDigestBatchPath(normalized),
    receiptPath,
    submittedFiles: batch.files,
    completionPolicy: 'auto_after_validation',
    message: `${batch.files.length} 份资料已进入自动处理。`,
  });
  appendHostTimeline({ type: 'digest_submitted', title: 'Student digest submitted', detail: `${batch.files.length} file(s) frozen in strict batch`, studentId: String(studentId), studentName: normalized.name, count: batch.files.length, batchId: batch.batchId });
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  notify('onNativeDigestWorkflowChanged', JSON.stringify({ scopeType: 'student', scopeId: String(studentId), status: 'processing', batchId: batch.batchId }));
  return { ok: true, updated: batch.files.length, batchId: batch.batchId, batch, state, student: normalized, records, status: JSON.parse(getHostServiceStatus()), message: state.message };
}

function markStudentDigestSubmitted(studentId) {
  try {
    return JSON.stringify(registerStudentDigestBatch(studentId));
  } catch (error) {
    return JSON.stringify({ ok: false, message: `建立学生消化批次失败：${error.message}` });
  }
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

function syncStrictStudentDigestResult(student, state, batch, options = {}) {
  const receipt = readStudentDigestReceipt(student);
  if (receipt?._receiptInvalid) return { ok: false, strict: true, state, message: `Agent 回执无法解析：${receipt._receiptError}` };
  const allRecords = readUploadRecords();
  const rawRoot = student.rawPath || getRawDir(student.name);
  const currentFiles = batch.files.map((file) => {
    const record = allRecords.find((item) => String(item.id || '') === String(file.materialId || ''));
    const absolutePath = String(record?.path || file.path || path.join(rawRoot, file.relativePath));
    return { ...file, path: absolutePath, sha1: sha1File(absolutePath) };
  });
  const validation = validateDigestResult({
    batch,
    receipt,
    currentFiles,
    requireMaterialId: true,
    allowedArtifactRoots: [student.summaryPath || getSummaryDir(student.name), student.rootPath || getStudentRootDir(student.name)],
  });
  if (!validation.ok) {
    const nextState = writeStudentDigestState(student, {
      status: options.markFailed ? 'failed' : 'digesting',
      message: validation.message,
      strictValidation: { ok: false, code: validation.code, rejected: validation.rejected || [], checkedAt: new Date().toISOString() },
    });
    return { ok: false, strict: true, validation, state: nextState, records: allRecords, message: validation.message };
  }
  const batchStartedAt = Date.parse(batch.submittedAt || batch.createdAt || '') || 0;
  const requiredArtifacts = Array.isArray(batch.output?.requiredArtifacts) ? batch.output.requiredArtifacts : [];
  const freshArtifacts = requiredArtifacts.filter((file) => {
    try {
      const stat = fs.statSync(file);
      return stat.isFile() && stat.size > 0 && (!batchStartedAt || stat.mtimeMs >= batchStartedAt - 1000);
    } catch {
      return false;
    }
  });
  if (requiredArtifacts.length && !freshArtifacts.length) {
    const message = '逐文件回执已匹配，但没有检测到本批次更新的知识产物，暂不结算。';
    const nextState = writeStudentDigestState(student, { status: 'digesting', message, strictValidation: { ok: false, code: 'artifacts_not_updated', checkedAt: new Date().toISOString() } });
    return { ok: false, strict: true, validation: { ...validation, ok: false, code: 'artifacts_not_updated' }, state: nextState, records: allRecords, message };
  }
  const confirmedIds = new Set(validation.confirmed.map((file) => String(file.materialId || '')));
  const remainingIds = new Set(validation.remaining.map((file) => String(file.materialId || '')));
  const completedAt = new Date().toISOString();
  const records = allRecords.map((record) => {
    if (String(record.studentId) !== String(student.id) || String(record.digestBatchId || '') !== String(batch.batchId)) return record;
    if (confirmedIds.has(String(record.id || ''))) return { ...record, status: 'processed', statusUpdatedAt: completedAt, digestedAt: completedAt, digestBatchId: batch.batchId };
    if (remainingIds.has(String(record.id || ''))) return { ...record, status: 'pending_digest', statusUpdatedAt: completedAt, digestBatchId: '' };
    return record;
  });
  writeUploadRecords(records);
  syncStudentMaterialsFromUploadRecords(student);
  const nextBatch = {
    ...batch,
    status: validation.fullyCompleted ? 'completed' : 'partial',
    completedAt,
    history: [...(batch.history || []), {
      at: completedAt,
      status: validation.fullyCompleted ? 'completed' : 'partial',
      confirmed: validation.confirmed.map((file) => ({ materialId: file.materialId, relativePath: file.relativePath, sha1: file.sha1 })),
      remaining: validation.remaining.map((file) => ({ materialId: file.materialId, relativePath: file.relativePath, sha1: file.sha1 })),
      rejected: validation.rejected || [],
    }].slice(-20),
  };
  writeJsonAtomic(studentDigestBatchPath(student), nextBatch);
  const previousBatches = Array.isArray(state.digestBatches) ? state.digestBatches : [];
  const nextState = writeStudentDigestState(student, {
    status: validation.fullyCompleted ? 'completed' : 'partial',
    lastDigestAt: completedAt,
    lastDigestBatchId: batch.batchId,
    digestBatchId: '',
    digestSubmittedAt: '',
    submittedFiles: [],
    message: validation.fullyCompleted
      ? `已自动完成 ${validation.confirmed.length} 份资料的严格消化校验。`
      : `已完成 ${validation.confirmed.length} 份资料，另有 ${validation.remaining.length} 份可重试。`,
    strictValidation: { ok: true, code: validation.code, confirmedCount: validation.confirmed.length, remainingCount: validation.remaining.length, rejected: validation.rejected || [], artifacts: freshArtifacts, checkedAt: completedAt },
    digestBatches: [...previousBatches, { id: batch.batchId, submittedAt: batch.submittedAt || batch.createdAt, completedAt, status: validation.fullyCompleted ? 'completed' : 'partial', confirmedCount: validation.confirmed.length, remainingCount: validation.remaining.length }].slice(-50),
  });
  appendHostTimeline({ type: 'digest_auto_completed', title: 'Student digest automatically validated', detail: nextState.message, studentId: String(student.id), studentName: student.name, count: validation.confirmed.length, batchId: batch.batchId });
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  notify('onNativeDigestWorkflowChanged', JSON.stringify({ scopeType: 'student', scopeId: String(student.id), status: validation.fullyCompleted ? 'completed' : 'partial', batchId: batch.batchId }));
  return { ok: true, strict: true, updated: validation.confirmed.length, validation, state: nextState, records, status: JSON.parse(getHostServiceStatus()), message: nextState.message };
}

function syncStudentDigestResult(studentId, options = {}) {
  const student = readStudentsIndex().find((item) => String(item.id) === String(studentId));
  if (!student) return JSON.stringify({ ok: false, message: 'Student not found.' });
  // Read the Agent receipt before refreshing upload records. Material refreshes
  // update counters and must never erase a completed receipt from the Agent.
  const state = readStudentDigestState(student);
  const strictBatch = readDigestBatch(studentDigestBatchPath(student));
  if (strictBatch && String(strictBatch.batchId || '') === String(state.digestBatchId || '') && ['submitted', 'digesting'].includes(normalizeDigestStateStatus(state.status))) {
    return JSON.stringify(syncStrictStudentDigestResult(student, state, strictBatch, options));
  }
  syncStudentMaterialsFromUploadRecords(student);
  const now = new Date().toISOString();
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

function readDigestReceiptFile(file) {
  if (!fs.existsSync(file)) return {};
  try {
    const source = fs.readFileSync(file, 'utf8');
    const result = parseDigestReceipt(source);
    if (!result.ok || !result.value || typeof result.value !== 'object') {
      return {
        _receiptInvalid: true,
        _receiptError: result.repairError || result.originalError || '回执格式无效。',
      };
    }
    if (!result.repaired) return result.value;
    const backupPath = `${file}.invalid-${timestampForFilename()}.bak`;
    fs.copyFileSync(file, backupPath);
    fs.writeFileSync(file, JSON.stringify(result.value, null, 2), 'utf8');
    return {
      ...result.value,
      _receiptNormalized: true,
      _receiptBackupPath: backupPath,
      _receiptOriginalError: result.originalError,
    };
  } catch (error) {
    return { _receiptInvalid: true, _receiptError: error.message };
  }
}

function readStudentDigestReceipt(student) {
  return readDigestReceiptFile(studentDigestReceiptPath(student));
}

function readStudentDigestReviewReceipt(student) {
  return readDigestReceiptFile(studentDigestReviewReceiptPath(student));
}

function readStudentDigestManifest(student) {
  try {
    const file = studentDigestManifestPath(student);
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function digestReceiptEntries(state, receipt) {
  const explicit = Array.isArray(receipt.items) ? receipt.items : [];
  const legacy = []
    .concat(Array.isArray(state.digestedFiles) ? state.digestedFiles : [])
    .map((item) => typeof item === 'string'
      ? { fileName: path.basename(item), relativePath: item, status: 'covered', confidence: 1 }
      : { ...item, fileName: item.fileName || item.filename || path.basename(item.relativePath || item.path || ''), status: item.status || 'covered' });
  return [...explicit, ...legacy];
}

function digestReceiptMatch(record, entries) {
  const recordId = String(record.id || '');
  const recordName = path.basename(String(record.filename || record.path || '')).toLowerCase();
  const recordSha1 = String(record.sha1 || '').toLowerCase();
  const exactId = entries.find((entry) => {
    const entryId = String(entry.id || entry.recordId || '');
    return recordId && entryId && recordId === entryId;
  });
  if (exactId) return exactId;
  const exactSha1 = entries.find((entry) => {
    const entrySha1 = String(entry.sha1 || '').toLowerCase();
    return recordSha1 && entrySha1 && recordSha1 === entrySha1;
  });
  if (exactSha1) return exactSha1;
  return entries.find((entry) => {
    const entryName = path.basename(String(entry.fileName || entry.filename || entry.relativePath || entry.path || '')).toLowerCase();
    return recordName && entryName && recordName === entryName;
  });
}

function fileUpdatedAt(file) {
  try {
    return fs.statSync(file).mtime.toISOString();
  } catch {
    return '';
  }
}

function validateStudentDigestReviewReceipt(student, reviewRequest, reviewReceipt) {
  const receiptPath = studentDigestReviewReceiptPath(student);
  const entries = digestReceiptEntries({}, reviewReceipt);
  if (!reviewRequest?.reviewRunId) return { ok: false, message: '', entries };
  const requestedAt = Date.parse(reviewRequest.requestedAt || '');
  const receiptUpdatedAt = Date.parse(fileUpdatedAt(receiptPath) || '');
  const expectedIds = new Set((Array.isArray(reviewRequest.selectedItemIds) ? reviewRequest.selectedItemIds : []).map(String));
  const receivedIds = entries.map((entry) => String(entry.id || entry.recordId || '')).filter(Boolean);
  const receivedIdSet = new Set(receivedIds);
  const missingIds = [...expectedIds].filter((id) => !receivedIdSet.has(id));
  const invalidStatusCount = entries.filter((entry) => !normalizeAuditCoverageStatus(entry.status)).length;
  if (reviewReceipt._receiptInvalid) return { ok: false, message: `二次复核回执无法解析：${reviewReceipt._receiptError}`, entries };
  if (!fs.existsSync(receiptPath)) return { ok: false, message: '尚未发现 Agent 写入的二次复核回执。', entries };
  if (String(reviewReceipt.reviewRunId || '') !== String(reviewRequest.reviewRunId)) return { ok: false, message: '二次复核回执不属于当前复核轮次，已拒绝同步。', entries };
  if (String(reviewReceipt.digestBatchId || '') !== String(reviewRequest.digestBatchId || '')) return { ok: false, message: '二次复核回执与当前消化批次不一致，已拒绝同步。', entries };
  if (Number.isFinite(requestedAt) && (!Number.isFinite(receiptUpdatedAt) || receiptUpdatedAt + 2000 < requestedAt)) return { ok: false, message: '二次复核回执早于当前复核请求，仍是旧结果。', entries };
  if (receivedIds.length !== receivedIdSet.size) return { ok: false, message: '二次复核回执包含重复资料 ID，暂不结算。', entries };
  if (missingIds.length) return { ok: false, message: `二次复核回执缺少 ${missingIds.length} 个所选资料 ID，暂不结算。`, entries };
  if (invalidStatusCount) return { ok: false, message: `二次复核回执有 ${invalidStatusCount} 条无效状态，暂不结算。`, entries };
  return { ok: true, message: '', entries };
}

function normalizeAuditCoverageStatus(value) {
  const status = String(value || '').toLowerCase();
  if (['covered', 'complete', 'completed', 'processed', 'success', 'digested'].includes(status)) return 'covered';
  if (['partial', 'low_confidence', 'uncertain'].includes(status)) return 'partial';
  if (['failed', 'unreadable', 'error'].includes(status)) return 'failed';
  if (['skipped', 'duplicate', 'ignored'].includes(status)) return 'skipped';
  return '';
}

function buildStudentDigestAudit(studentId, options = {}) {
  const student = readStudentsIndex().find((item) => String(item.id) === String(studentId));
  if (!student) return { ok: false, message: '未找到学生档案。' };
  syncStudentMaterialsFromUploadRecords(student);
  const state = readStudentDigestState(student);
  const receipt = readStudentDigestReceipt(student);
  const reviewReceipt = readStudentDigestReviewReceipt(student);
  const reviewRequest = safeReadJson(studentDigestReviewRequestPath(student), null);
  const reviewValidation = validateStudentDigestReviewReceipt(student, reviewRequest, reviewReceipt);
  const entries = [
    ...(reviewValidation.ok ? reviewValidation.entries : []),
    ...digestReceiptEntries(state, receipt),
  ];
  const previousManifest = readStudentDigestManifest(student);
  const manifestIds = new Set((Array.isArray(previousManifest.items) ? previousManifest.items : []).map((item) => String(item.id || '')).filter(Boolean));
  const records = readUploadRecords()
    .filter((record) => String(record.studentId) === String(studentId) && !['ignored', 'removed'].includes(normalizeUploadStatus(record.status)))
    .filter((record) => !state.digestBatchId
      || String(record.digestBatchId || '') === String(state.digestBatchId)
      || isOpenDigestStatus(record.status)
      || manifestIds.has(String(record.id))
      || Boolean(digestReceiptMatch(record, entries)));
  const items = records.map((record) => {
    const matched = digestReceiptMatch(record, entries);
    const receiptStatus = normalizeAuditCoverageStatus(matched?.status);
    const sourceExists = Boolean(record.path && fs.existsSync(record.path));
    const recordStatus = normalizeUploadStatus(record.status);
    let coverageStatus = receiptStatus;
    if (!sourceExists) coverageStatus = 'missing_source';
    else if (!coverageStatus && recordStatus === 'processed') coverageStatus = 'unverified';
    else if (!coverageStatus && ['submitted', 'digesting'].includes(recordStatus)) coverageStatus = 'waiting';
    else if (!coverageStatus && recordStatus === 'failed') coverageStatus = 'failed';
    else if (!coverageStatus) coverageStatus = 'pending';
    const confidence = Number(matched?.confidence);
    return {
      id: String(record.id),
      fileName: record.filename || path.basename(record.path || ''),
      path: record.path || '',
      sha1: record.sha1 || '',
      size: Number(record.size || 0),
      extension: path.extname(record.filename || record.path || '').toLowerCase(),
      isImage: /\.(png|jpe?g|webp|bmp|gif|heic)$/i.test(record.filename || record.path || ''),
      sourceExists,
      recordStatus,
      coverageStatus,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
      topics: Array.isArray(matched?.topics) ? matched.topics : [],
      artifacts: Array.isArray(matched?.artifacts) ? matched.artifacts : [],
      notes: matched?.notes || matched?.message || '',
      uploadedAt: record.uploadedAt || '',
      statusUpdatedAt: record.statusUpdatedAt || '',
      digestBatchId: record.digestBatchId || state.digestBatchId || '',
    };
  });
  const counts = items.reduce((result, item) => {
    result[item.coverageStatus] = (result[item.coverageStatus] || 0) + 1;
    return result;
  }, {});
  const coveredCount = counts.covered || 0;
  const reviewStatuses = new Set(['partial', 'failed', 'missing_source', 'unverified', 'waiting', 'pending']);
  const reviewItems = items.filter((item) => reviewStatuses.has(item.coverageStatus));
  const audit = {
    version: 2,
    studentId: String(student.id),
    studentName: student.name,
    digestBatchId: state.digestBatchId || receipt.digestBatchId || '',
    generatedAt: new Date().toISOString(),
    receiptPath: studentDigestReceiptPath(student),
    receiptUpdatedAt: fileUpdatedAt(studentDigestReceiptPath(student)),
    reviewReceiptPath: studentDigestReviewReceiptPath(student),
    reviewReceiptUpdatedAt: fileUpdatedAt(studentDigestReviewReceiptPath(student)),
    reviewRequestPath: studentDigestReviewRequestPath(student),
    reviewRunId: reviewReceipt.reviewRunId || '',
    reviewReceiptAccepted: reviewValidation.ok,
    reviewReceiptMessage: reviewValidation.message,
    manifestPath: studentDigestManifestPath(student),
    auditPath: studentDigestAuditPath(student),
    totalCount: items.length,
    imageCount: items.filter((item) => item.isImage).length,
    coveredCount,
    reviewCount: reviewItems.length,
    coverageRate: items.length ? Math.round((coveredCount / items.length) * 100) : 100,
    counts,
    items,
    receiptNormalized: Boolean(receipt._receiptNormalized),
    receiptInvalid: Boolean(receipt._receiptInvalid),
    reviewReceiptInvalid: Boolean(reviewReceipt._receiptInvalid),
    receiptMessage: receipt._receiptNormalized
      ? `Agent 回执包含未转义文本，已自动规范化；原文件备份于 ${receipt._receiptBackupPath}。`
      : receipt._receiptInvalid
        ? `Agent 回执无法解析：${receipt._receiptError}`
        : '',
    message: receipt._receiptInvalid
      ? `Agent 回执格式错误，暂不能同步复核数据：${receipt._receiptError}`
      : reviewReceipt._receiptInvalid
        ? `二次复核回执格式错误，暂不能同步复核数据：${reviewReceipt._receiptError}`
      : items.length
      ? reviewItems.length
        ? `${receipt._receiptNormalized ? '已自动修复 Agent 回执。' : ''}覆盖率 ${Math.round((coveredCount / items.length) * 100)}%，发现 ${reviewItems.length} 份资料需要二次核对。`
        : `本批 ${items.length} 份资料均已有逐文件覆盖回执。`
      : '当前批次没有可审计资料。',
  };
  if (options.write !== false) {
    fs.mkdirSync(studentManagerDir(student), { recursive: true });
    fs.writeFileSync(studentDigestManifestPath(student), JSON.stringify({
      version: 1,
      studentId: audit.studentId,
      studentName: audit.studentName,
      digestBatchId: audit.digestBatchId,
      generatedAt: audit.generatedAt,
      items: items.map(({ id, fileName, path: filePath, sha1, size, extension, isImage, uploadedAt }) => ({ id, fileName, path: filePath, sha1, size, extension, isImage, uploadedAt })),
    }, null, 2), 'utf8');
    fs.writeFileSync(studentDigestAuditPath(student), JSON.stringify(audit, null, 2), 'utf8');
  }
  return { ok: true, audit };
}

function buildStudentDigestAuditPrompt(student, audit, selectedIds = [], reviewRequest = {}) {
  const selected = new Set((Array.isArray(selectedIds) ? selectedIds : []).map(String));
  const candidates = audit.items.filter((item) => selected.size ? selected.has(String(item.id)) : item.coverageStatus !== 'covered' && item.coverageStatus !== 'skipped');
  const files = candidates.map((item) => `- ID ${item.id} | ${item.fileName} | ${item.sha1 || '无 SHA-1'} | 当前状态 ${item.coverageStatus} | ${item.path}`).join('\n') || '- 暂无需要复核的资料';
  return `请对「${student.name}」本批资料执行独立的消化覆盖复核。不要只复述第一次摘要，也不要删除、移动或覆盖原始资料。

知识库根目录：${student.rootPath || getStudentRootDir(student.name)}
消化清单：${audit.manifestPath}
第一次回执：${audit.receiptPath}
覆盖审计：${audit.auditPath}
复核请求：${audit.reviewRequestPath}
二次复核回执：${audit.reviewReceiptPath}

需要复核的资料：
${files}

逐份执行：
1. 确认文件可以打开；图片必须进行视觉识别，必要时结合 OCR，不得仅凭文件名判断。
2. 提取主要主题、题目、数学公式、表格和手写批注；如内容模糊必须标记 partial 或 failed。
3. 核对第一次知识成果是否覆盖这些内容，并列出遗漏内容及应补充的知识文件。
4. 将补充结果写入知识空间对应目录，并在来源中保留文件名和 SHA-1。
5. 将所有被选资料的逐文件回执写入 ${audit.reviewReceiptPath}。必须实际写入该文件，不要只在对话中报告，也不要覆盖第一次回执。格式：
{
  "version": 2,
  "reviewRunId": "${reviewRequest.reviewRunId || ''}",
  "digestBatchId": "${audit.digestBatchId}",
  "completedAt": "ISO 时间",
  "items": [
    {
      "id": "消化清单中的资料 ID",
      "fileName": "原始文件名",
      "sha1": "清单中的 SHA-1",
      "status": "covered | partial | failed | skipped",
      "confidence": 0.0,
      "topics": ["识别出的主题"],
      "artifacts": ["新增或更新的知识文件"],
      "notes": "遗漏、模糊、重复或补充说明"
    }
  ]
}

每个所选 ID 都必须有且只有一条回执，即使失败也要写入 failed。完成后明确报告：复核总数、完整覆盖数、部分识别数、失败数、补充了哪些知识内容。`;
}

function generateStudentDigestAudit(studentId, selectedIdsJson = '[]') {
  const result = buildStudentDigestAudit(studentId, { write: true });
  if (!result.ok) return JSON.stringify(result);
  const student = readStudentsIndex().find((item) => String(item.id) === String(studentId));
  let selectedIds = [];
  try { selectedIds = JSON.parse(selectedIdsJson || '[]'); } catch { selectedIds = []; }
  const selected = new Set((Array.isArray(selectedIds) ? selectedIds : []).map(String));
  const candidateIds = result.audit.items
    .filter((item) => selected.size ? selected.has(String(item.id)) : !['covered', 'skipped'].includes(item.coverageStatus))
    .map((item) => String(item.id));
  const reviewRequest = {
    version: 2,
    reviewRunId: `review-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    digestBatchId: result.audit.digestBatchId,
    requestedAt: new Date().toISOString(),
    selectedItemIds: candidateIds,
    reviewReceiptPath: result.audit.reviewReceiptPath,
  };
  fs.mkdirSync(studentManagerDir(student), { recursive: true });
  const previousReviewReceipt = studentDigestReviewReceiptPath(student);
  if (fs.existsSync(previousReviewReceipt)) {
    fs.copyFileSync(previousReviewReceipt, `${previousReviewReceipt}.previous-${timestampForFilename()}.bak`);
    fs.rmSync(previousReviewReceipt, { force: true });
  }
  fs.writeFileSync(studentDigestReviewRequestPath(student), JSON.stringify(reviewRequest, null, 2), 'utf8');
  return JSON.stringify({
    ...result,
    reviewRequest,
    prompt: buildStudentDigestAuditPrompt(student, result.audit, candidateIds, reviewRequest),
  });
}

function syncStudentDigestAudit(studentId) {
  const student = readStudentsIndex().find((item) => String(item.id) === String(studentId));
  if (!student) return JSON.stringify({ ok: false, message: '未找到学生档案。' });
  const reviewRequest = safeReadJson(studentDigestReviewRequestPath(student), null);
  const reviewReceipt = readStudentDigestReviewReceipt(student);
  const initial = buildStudentDigestAudit(studentId, { write: true });
  if (!initial.ok) return JSON.stringify(initial);
  if (!reviewRequest?.reviewRunId) {
    return JSON.stringify({
      ...initial,
      synced: false,
      updated: 0,
      message: '尚未生成有效的二次复核请求。请先选择待复核资料并复制二次核对指令，再让 Agent 执行。',
    });
  }
  const reviewValidation = validateStudentDigestReviewReceipt(student, reviewRequest, reviewReceipt);
  if (!reviewValidation.ok) {
    return JSON.stringify({
      ...initial,
      synced: false,
      updated: 0,
      message: `${reviewValidation.message} 请将刚复制的指令交给 Agent 完整执行后再同步。`,
    });
  }
  const coverageById = new Map(initial.audit.items.map((item) => [String(item.id), item.coverageStatus]));
  const now = new Date().toISOString();
  let updated = 0;
  const records = readUploadRecords().map((record) => {
    if (String(record.studentId) !== String(studentId)) return record;
    const coverageStatus = coverageById.get(String(record.id));
    let status = '';
    if (coverageStatus === 'covered') status = 'processed';
    else if (['failed', 'partial', 'missing_source'].includes(coverageStatus)) status = 'failed';
    else if (coverageStatus === 'skipped') status = 'ignored';
    if (!status || normalizeUploadStatus(record.status) === status) return record;
    updated += 1;
    return {
      ...record,
      status,
      statusUpdatedAt: now,
      digestAuditStatus: coverageStatus,
      ...(status === 'processed' ? { digestedAt: now } : {}),
    };
  });
  writeUploadRecords(records);
  syncStudentMaterialsFromUploadRecords(student);
  const unresolvedCount = initial.audit.items.filter((item) => ['unverified', 'waiting', 'pending'].includes(item.coverageStatus)).length;
  const failedCount = initial.audit.items.filter((item) => ['failed', 'partial', 'missing_source'].includes(item.coverageStatus)).length;
  writeStudentDigestState(student, {
    status: unresolvedCount > 0 ? 'pending' : failedCount > 0 ? 'failed' : 'completed',
    lastDigestAt: initial.audit.coveredCount > 0 ? now : readStudentDigestState(student).lastDigestAt || '',
    message: unresolvedCount > 0
      ? `复核回执已同步，仍有 ${unresolvedCount} 份资料缺少可结算回执。`
      : failedCount > 0
        ? `复核回执已同步：${initial.audit.coveredCount} 份完整覆盖，${failedCount} 份识别失败或来源缺失。`
        : `复核回执已同步，本批 ${initial.audit.coveredCount} 份资料均完整覆盖。`,
  });
  const result = buildStudentDigestAudit(studentId, { write: true });
  if (result.ok) {
    appendHostTimeline({
      type: 'digest_audit_synced',
      title: 'Digest coverage audit synced',
      detail: result.audit.message,
      studentId: String(studentId || ''),
      studentName: result.audit.studentName,
      count: result.audit.reviewCount,
    });
  }
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  return JSON.stringify({
    ...result,
    synced: true,
    message: result.ok ? `复核结果已同步，更新 ${updated} 条资料状态。${result.audit.message || ''}` : result.message,
    updated,
    records,
    status: JSON.parse(getHostServiceStatus()),
  });
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
      hostIdentity: getHostIdentity(),
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
    if (parsed.hostIdentity && typeof parsed.hostIdentity === 'object') {
      const restoredHostId = String(parsed.hostIdentity.hostId || '').trim();
      const restoredCode = String(parsed.hostIdentity.machineCode || '').trim();
      if (restoredHostId && restoredCode === machineCode('host', restoredHostId)) {
        writeHostIdentity({
          hostId: restoredHostId,
          machineCode: restoredCode,
          displayName: String(parsed.hostIdentity.displayName || os.hostname() || 'AI教育管家主机').trim().slice(0, 80),
          createdAt: parsed.hostIdentity.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }
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
    machineCode: device.machineCode || machineCode('tablet', device.id),
    tokenPreview: device.tokenPreview || '',
    terminalMode: normalizeTerminalMode(device.terminalMode, 'shared'),
    boundStudentId: String(device.boundStudentId || ''),
    activeStudentId: activeStudentIdForDevice(device.id),
    capabilities: Array.isArray(device.capabilities) ? device.capabilities : [],
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
    pairedProtocolVersion: Number(device.pairedProtocolVersion || 1),
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

function discoveryPayload(protocolVersion = PAIR_PROTOCOL_VERSION) {
  const info = getConnectionInfo();
  const identity = getHostIdentity();
  return {
    type: 'AI_EDU_MANAGER_DISCOVERY',
    protocolVersion,
    role: 'host',
    deviceId: identity.hostId,
    machineCode: identity.machineCode,
    displayName: identity.displayName,
    hostName: identity.displayName,
    appVersion: APP_VERSION,
    port: info.port,
    serverUrl: info.serverUrl,
    lanUrls: info.lanUrls,
    capabilities: protocolVersion >= 2 ? ['pair-request-v2', 'bidirectional-discovery-v2'] : [],
  };
}

function rememberDiscoveredTablet(payload, remote) {
  if (payload?.role !== 'tablet' || !payload.deviceId) return false;
  const identityKey = `tablet:${payload.deviceId}`;
  const existing = discoveredLanTablets.get(identityKey);
  const next = {
    role: 'tablet',
    deviceId: String(payload.deviceId),
    machineCode: String(payload.machineCode || machineCode('tablet', payload.deviceId)),
    displayName: String(payload.displayName || payload.deviceName || 'Android 平板').slice(0, 80),
    appVersion: String(payload.appVersion || ''),
    capabilities: Array.isArray(payload.capabilities) ? payload.capabilities : [],
    address: String(remote.address || ''),
    discoveryPort: Number(payload.discoveryPort || remote.port || HOST_DISCOVERY_PORT),
    lastSeenAt: new Date().toISOString(),
  };
  discoveredLanTablets.set(identityKey, { ...existing, ...next });
  return true;
}

function sendHostDiscoveryResponse(socket, remote, protocolVersion = PAIR_PROTOCOL_VERSION) {
  const payload = Buffer.from(JSON.stringify(discoveryPayload(protocolVersion)), 'utf8');
  socket.send(payload, remote.port, remote.address, () => {});
}

function handleHostDiscoveryMessage(socket, message, remote) {
  const text = String(message || '').trim();
  if (text === HOST_DISCOVERY_REQUEST_V1) {
    sendHostDiscoveryResponse(socket, remote, 1);
    return;
  }
  let payload;
  try { payload = JSON.parse(text); } catch { return; }
  if (payload.type === HOST_DISCOVERY_REQUEST_V2 && Number(payload.protocolVersion || 0) >= 2) {
    if (['host', 'all'].includes(String(payload.searchRole || 'host'))) {
      sendHostDiscoveryResponse(socket, remote, PAIR_PROTOCOL_VERSION);
    }
    return;
  }
  if (payload.type === 'AI_EDU_MANAGER_DISCOVERY' && Number(payload.protocolVersion || 0) >= 2) {
    if (rememberDiscoveredTablet(payload, remote)) notify('onNativeHostServiceChanged', getHostServiceStatus());
  }
}

function startHostDiscovery() {
  if (hostDiscoverySocket) return;
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  hostDiscoverySocket = socket;
  socket.on('message', (message, remote) => {
    handleHostDiscoveryMessage(socket, message, remote);
  });
  socket.on('error', (error) => {
    hostServiceLastError = `局域网发现服务异常：${error.message}`;
    try { socket.close(); } catch {}
    if (hostDiscoverySocket === socket) hostDiscoverySocket = null;
    notify('onNativeHostServiceChanged', getHostServiceStatus());
  });
  socket.bind(HOST_DISCOVERY_PORT, '0.0.0.0', () => {
    try { socket.setBroadcast(true); } catch {}
  });
}

function findLanTablets() {
  if (!hostDiscoverySocket) return JSON.stringify({ ok: false, message: '请先启动主机服务，再查找局域网平板。' });
  discoveredLanTablets.clear();
  lastTabletDiscoveryAt = new Date().toISOString();
  const requestId = `discover-${crypto.randomUUID()}`;
  const request = Buffer.from(JSON.stringify({
    type: HOST_DISCOVERY_REQUEST_V2,
    protocolVersion: PAIR_PROTOCOL_VERSION,
    requestId,
    searchRole: 'tablet',
  }), 'utf8');
  try {
    const targets = lanDiscoveryBroadcastTargets();
    for (const target of targets) {
      hostDiscoverySocket.send(request, HOST_DISCOVERY_PORT, target, (error) => {
        if (error) {
          hostServiceLastError = `向 ${target} 发送平板发现广播失败：${error.message}`;
          notify('onNativeHostServiceChanged', getHostServiceStatus());
        }
      });
    }
    appendHostTimeline({ type: 'tablet_discovery_started', title: 'Tablet discovery started', detail: `${requestId} -> ${targets.join(', ')}` });
    return JSON.stringify({ ok: true, requestId, broadcastTargets: targets, message: `已通过 ${targets.length} 个广播地址查找局域网平板，请让平板打开“等待主机连接”页面。`, status: JSON.parse(getHostServiceStatus()) });
  } catch (error) {
    hostServiceLastError = `发送局域网平板发现广播失败：${error.message}`;
    return JSON.stringify({ ok: false, message: hostServiceLastError, status: JSON.parse(getHostServiceStatus()) });
  }
}

function stopHostDiscovery() {
  const socket = hostDiscoverySocket;
  hostDiscoverySocket = null;
  if (!socket) return;
  try { socket.close(); } catch {}
}

function deviceByBearerToken(token) {
  const tokenHash = hashDeviceToken(token);
  return readDevices().find((device) => device.tokenHash === tokenHash && !device.revoked);
}

const STUDENT_SESSION_IDLE_MS = 10 * 60 * 1000;

function cleanupStudentSessions() {
  const now = Date.now();
  for (const [tokenHash, session] of studentSessions.entries()) {
    if (now - Number(session.lastSeenAtMs || session.createdAtMs || 0) > STUDENT_SESSION_IDLE_MS) studentSessions.delete(tokenHash);
  }
}

function studentSessionByBearerToken(token, touch = true) {
  cleanupStudentSessions();
  const tokenHash = hashDeviceToken(token);
  const session = studentSessions.get(tokenHash);
  if (!session) return null;
  const device = readDevices().find((item) => String(item.id) === String(session.deviceId) && !item.revoked);
  const student = readStudentsIndex().find((item) => String(item.id) === String(session.studentId));
  if (!device || !student) {
    studentSessions.delete(tokenHash);
    return null;
  }
  if (touch) session.lastSeenAtMs = Date.now();
  return { ...session, tokenHash, device, student };
}

function clearStudentSessionsForDevice(deviceId) {
  for (const [tokenHash, session] of studentSessions.entries()) {
    if (String(session.deviceId) === String(deviceId)) studentSessions.delete(tokenHash);
  }
}

function activeStudentIdForDevice(deviceId) {
  cleanupStudentSessions();
  const active = [...studentSessions.values()].find((session) => String(session.deviceId) === String(deviceId));
  return active ? String(active.studentId) : '';
}

function createStudentSession(device, student) {
  clearStudentSessionsForDevice(device.id);
  const token = `eds_${crypto.randomBytes(24).toString('hex')}`;
  const tokenHash = hashDeviceToken(token);
  const now = Date.now();
  const session = {
    sessionId: `student-session-${crypto.randomUUID()}`,
    deviceId: String(device.id),
    studentId: String(student.id),
    terminalMode: normalizeTerminalMode(device.terminalMode, 'shared'),
    createdAt: new Date(now).toISOString(),
    createdAtMs: now,
    lastSeenAtMs: now,
  };
  studentSessions.set(tokenHash, session);
  return { token, session };
}

function publicStudentSession(session) {
  return {
    sessionId: session.sessionId,
    deviceId: session.deviceId,
    studentId: session.studentId,
    terminalMode: session.terminalMode,
    createdAt: session.createdAt,
    idleTimeoutSeconds: Math.floor(STUDENT_SESSION_IDLE_MS / 1000),
  };
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
  clearStudentSessionsForDevice(deviceId);
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
  clearStudentSessionsForDevice(deviceId);
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
  const terminalMode = allowedStudentIds.length === 1 ? 'personal' : 'shared';
  devices[index] = {
    ...devices[index],
    terminalMode,
    boundStudentId: terminalMode === 'personal' ? allowedStudentIds[0] : '',
    allowedStudentIds: terminalMode === 'personal' ? allowedStudentIds : [],
    allowedAllStudents: terminalMode === 'shared',
    autoAuthorizeNewStudents: terminalMode === 'shared',
  };
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
  const requestedMode = options.terminalMode || (options.allowedAllStudents || options.autoAuthorizeNewStudents ? 'shared' : 'personal');
  const terminalMode = normalizeTerminalMode(requestedMode, 'shared');
  const requestedBoundStudentId = String(options.boundStudentId || devices[index].boundStudentId || '');
  const boundStudentId = terminalMode === 'personal' && validIds.includes(requestedBoundStudentId) ? requestedBoundStudentId : '';
  devices[index] = {
    ...devices[index],
    terminalMode,
    boundStudentId,
    allowedAllStudents: terminalMode === 'shared',
    autoAuthorizeNewStudents: terminalMode === 'shared',
    allowedStudentIds: boundStudentId ? [boundStudentId] : [],
    modeUpdatedAt: new Date().toISOString(),
  };
  clearStudentSessionsForDevice(deviceId);
  writeDevices(devices);
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  return JSON.stringify({ ok: true, devices: devices.map(publicDevice), status: JSON.parse(getHostServiceStatus()) });
}

function setHostDeviceTerminalMode(deviceId, terminalMode, boundStudentId = '') {
  return setHostDeviceAccessMode(deviceId, JSON.stringify({ terminalMode, boundStudentId }));
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
  writeJsonAtomic(captureSessionsPath(), {
    version: CAPTURE_PROTOCOL_VERSION,
    updatedAt: new Date().toISOString(),
    sessions: (store.sessions || []).slice(0, 200),
  });
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

function promoteCaptureSession(sessionId, requestedTarget = '') {
  try {
    const store = readCaptureStore();
    const session = store.sessions.find((item) => String(item.id) === String(sessionId));
    if (!session) return JSON.stringify({ ok: false, message: '未找到采集会话。' });
    if (!['completed', 'promoted'].includes(session.status)) return JSON.stringify({ ok: false, message: '请先结束采集，再晋升资料。' });
    if (session.status === 'promoted') return JSON.stringify({ ok: true, imported: session.promotedFiles?.length || 0, session, message: '该采集会话已经晋升。' });
    const student = readStudentsIndex().find((item) => String(item.id) === String(session.studentId));
    if (!student) return JSON.stringify({ ok: false, message: '采集会话关联的学生不存在。' });
    const targetMode = ['project_raw', 'student_raw'].includes(String(requestedTarget))
      ? String(requestedTarget)
      : (session.projectId ? 'project_raw' : 'student_raw');
    let ensuredProject = null;
    if (targetMode === 'project_raw') {
      if (!session.projectId) return JSON.stringify({ ok: false, message: '该采集会话未关联学习项目，不能晋升到项目原始资料库。' });
      const access = mutableProject(session.projectId, '接收屏幕采集资料');
      if (access.error) return access.error;
      ensuredProject = ensureProjectWorkspace(access.project);
    }
    const rawDir = targetMode === 'project_raw'
      ? ensuredProject.rawPath
      : (student.rawPath || getRawDir(student.name));
    fs.mkdirSync(rawDir, { recursive: true });
    const records = [];
    const projectAssetIds = [];
    for (const item of session.items || []) {
      if (!item.path || !fs.existsSync(item.path)) continue;
      const target = uniqueTargetFile(rawDir, item.filename || path.basename(item.path));
      fs.copyFileSync(item.path, target);
      const stat = fs.statSync(target);
      const record = {
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
      };
      records.push(record);
      if (targetMode === 'project_raw') {
        const asset = upsertAssetFromFile(target, {
          studentId: String(student.id),
          studentName: student.name,
          projectId: ensuredProject.id,
          projectName: ensuredProject.name,
          spaceType: 'project',
          sourcePath: item.path,
          sourceName: `屏幕采集 · ${session.sourceName}`,
          sourceType: 'windows_screenshot',
          captureSessionId: session.id,
          captureItemId: item.id,
          referenceId: `${ensuredProject.id}-${session.id}-${item.id}`,
          role: 'project_raw_capture',
          status: 'active',
          uploadedAt: record.uploadedAt,
        });
        if (asset) projectAssetIds.push(asset.assetId);
      }
      item.archiveStatus = 'promoted';
      item.promotionTarget = targetMode;
      item.promotedPath = target;
    }
    if (!records.length) return JSON.stringify({ ok: false, imported: 0, message: '采集会话中没有可晋升的有效截图。' });
    let projectResult = null;
    if (targetMode === 'student_raw') {
      addUploadRecords(records);
    } else {
      const now = new Date().toISOString();
      const digestState = writeProjectDigestState(ensuredProject, {
        status: 'pending',
        message: `有 ${projectAssetIds.length} 份屏幕采集资料待消化。`,
        triggerReason: 'capture_promotion',
      });
      projectResult = updateProjectRecord(ensuredProject.id, (item) => projectWithNewInputs({
        ...item,
        assetIds: mergeUnique([...(item.assetIds || []), ...projectAssetIds]),
        digestState,
        updatedAt: now,
      }, 'capture_promotion', now));
    }
    session.status = 'promoted';
    session.archiveStatus = targetMode;
    session.promotionTarget = targetMode;
    session.promotionTargetId = targetMode === 'project_raw' ? ensuredProject.id : String(student.id);
    session.promotionTargetName = targetMode === 'project_raw' ? ensuredProject.name : student.name;
    session.promotedAt = new Date().toISOString();
    session.promotedFiles = records.map((record) => record.path);
    persistCaptureSession(session);
    appendHostTimeline({ type: 'capture_session_promoted', title: 'Capture session promoted', detail: `${session.sourceName} -> ${session.promotionTargetName}`, studentId: String(student.id), studentName: student.name, count: records.length });
    notifyCaptureChanged();
    return JSON.stringify({
      ok: true,
      imported: records.length,
      targetMode,
      session,
      project: projectResult?.project || null,
      projects: projectResult?.projects || null,
      message: targetMode === 'project_raw'
        ? `已将 ${records.length} 张截图晋升到项目「${ensuredProject.name}」原始资料库，并加入项目待消化队列。`
        : `已将 ${records.length} 张截图晋升到 ${student.name} 原始资料库，等待学生资料消化。`,
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `晋升采集资料失败：${error.message}` });
  }
}

function deleteCaptureSession(sessionId) {
  try {
    const id = String(sessionId || '');
    if (!id) return JSON.stringify({ ok: false, message: '未指定要删除的采集会话。' });
    if (activeCaptureRuntime && String(activeCaptureRuntime.session.id) === id) {
      return JSON.stringify({ ok: false, message: '该采集会话仍在运行，请先结束采集再删除。' });
    }
    const store = readCaptureStore();
    const index = store.sessions.findIndex((item) => String(item.id) === id);
    if (index < 0) return JSON.stringify({ ok: false, message: '未找到采集会话，可能已被删除。' });
    const session = store.sessions[index];
    const inboxRoot = path.resolve(captureInboxRootPath());
    const inboxPath = path.resolve(session.inboxPath || path.join(inboxRoot, id));
    const relative = path.relative(inboxRoot, inboxPath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.basename(inboxPath) !== id) {
      return JSON.stringify({ ok: false, message: '采集会话目录不在受管采集箱内，已拒绝删除。' });
    }
    if (fs.existsSync(inboxPath)) fs.rmSync(inboxPath, { recursive: true, force: true });
    store.sessions.splice(index, 1);
    writeCaptureStore(store);
    appendHostTimeline({ type: 'capture_session_deleted', title: 'Capture session deleted', detail: session.name || session.sourceName || id, count: Number(session.screenshotCount || 0) });
    notifyCaptureChanged();
    const retained = session.status === 'promoted' || (session.promotedFiles || []).length > 0;
    return JSON.stringify({
      ok: true,
      deletedSessionId: id,
      retainedPromotedAssets: retained,
      message: retained
        ? '已删除采集会话和采集箱临时副本；已晋升到学生原始资料库的正式资产保持不变。'
        : `已删除采集会话及 ${Number(session.screenshotCount || 0)} 张候选截图。`,
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `删除采集会话失败：${error.message}` });
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
  const adoptedKnowledgeRoot = String(project.knowledgeMode || '') === 'adopted' && String(project.knowledgeRootPath || '').trim() ? path.resolve(String(project.knowledgeRootPath)) : '';
  const knowledgeRootPath = adoptedKnowledgeRoot || path.join(root, '项目知识空间');
  return {
    projectRootPath: root,
    managerPath: path.join(root, '.edu-manager'),
    workspacePath,
    stagingPath: linkedWorkspace ? path.join(root, '研究暂存') : path.join(workspacePath, '研究暂存'),
    knowledgeRootPath,
    rawPath: project.rawPath || path.join(knowledgeRootPath, `${storageName}项目原始资料库`),
    conceptPath: project.conceptPath || path.join(knowledgeRootPath, '概念库'),
    entityPath: project.entityPath || path.join(knowledgeRootPath, '实体库'),
    summaryPath: project.summaryPath || path.join(knowledgeRootPath, '摘要库'),
    qaPath: project.qaPath || path.join(knowledgeRootPath, '问答精华库'),
    synthesisPath: project.synthesisPath || path.join(knowledgeRootPath, '综合汇总库'),
    reportPath: project.reportPath || path.join(knowledgeRootPath, '项目报告'),
    contributionPath: project.contributionPath || path.join(knowledgeRootPath, '知识贡献'),
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
  const bindingDir = normalized.knowledgeMode === 'adopted' ? paths.managerPath : paths.knowledgeRootPath;
  fs.mkdirSync(bindingDir, { recursive: true });
  const students = readStudentsIndex().filter((student) => normalized.studentIds.includes(String(student.id)));
  fs.writeFileSync(path.join(bindingDir, '绑定学生.md'), projectBindingIndexTemplate(normalized, students), 'utf8');
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
    mtimeMs: Number(item?.mtimeMs || 0),
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

function projectDigestRequestPath(project) {
  const paths = projectPathsFor(project.name, project.projectRootPath, project);
  return path.join(paths.managerPath, 'project-digest-request.json');
}

function projectDigestReceiptPath(project) {
  const paths = projectPathsFor(project.name, project.projectRootPath, project);
  return path.join(paths.managerPath, 'project-digest-receipt.json');
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
  const reconciled = reconcileDigestControlState(parsed, pendingFiles.length);
  const { status, digestBatchId, submittedFiles } = reconciled;
  return {
    version: 2,
    projectId: String(project.id || ''),
    projectName: String(project.name || ''),
    status,
    message: reconciled.message || parsed.message || (pendingFiles.length > 0 ? `有 ${pendingFiles.length} 份项目资料待消化。` : '暂无待消化项目资料。'),
    rawPath: paths.rawPath,
    digestFile: projectDigestStatePath({ ...project, ...paths }),
    rawFileCount: rawFiles.length,
    pendingCount: pendingFiles.length,
    submittedCount: ['submitted', 'digesting'].includes(status) ? pendingFiles.length : 0,
    lastDigestAt: parsed.lastDigestAt || '',
    digestSubmittedAt: parsed.digestSubmittedAt || '',
    digestBatchId,
    pendingFiles: pendingFiles.map((file) => ({
      filename: file.filename,
      path: file.path,
      size: file.size,
      sha1: file.sha1,
      relativePath: file.relativePath,
      changeType: file.changeType,
    })),
    digestedFiles: Array.isArray(parsed.digestedFiles) ? parsed.digestedFiles : [],
    digestManifest,
    submittedFiles,
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
  writeJsonAtomic(projectDigestStatePath({ ...project, ...paths }), next);
  return readProjectDigestState({ ...project, ...paths, digestState: next });
}

function registerProjectDigestBatch(project, options = {}) {
  const ensured = ensureProjectWorkspace(project);
  const current = readProjectDigestState(ensured);
  if (!current.pendingCount) return { ok: false, message: '当前没有待消化资料，无需重复提交。', digestState: current };
  if (['submitted', 'digesting'].includes(current.status) && current.digestBatchId) {
    return { ok: false, message: `批次 ${current.digestBatchId} 已提交，请先同步结果。`, digestState: current };
  }
  const now = new Date().toISOString();
  const batchId = `${options.prefix || 'project-digest'}-${timestampForFilename()}-${crypto.randomBytes(3).toString('hex')}`;
  const submittedFiles = (current.pendingFiles || []).map((file) => ({
    materialId: `project-${crypto.createHash('sha1').update(`${ensured.id}|${file.relativePath}`).digest('hex').slice(0, 20)}`,
    relativePath: file.relativePath,
    path: file.path,
    sha1: file.sha1,
    size: file.size,
  }));
  const digestBatch = buildDigestBatch({
    scope: { type: 'project', id: String(ensured.id), name: ensured.name },
    files: submittedFiles,
    batchId,
    createdAt: now,
    submittedAt: now,
    status: 'submitted',
    output: { knowledgeRoot: ensured.knowledgeRootPath, receiptPath: projectDigestReceiptPath(ensured) },
  });
  const request = {
    ...digestBatch,
    version: 3,
    projectId: String(ensured.id),
    projectName: ensured.name,
    digestBatchId: batchId,
    submittedAt: now,
    submittedFiles,
    files: digestBatch.files,
    receiptPath: projectDigestReceiptPath(ensured),
  };
  fs.mkdirSync(ensured.managerPath, { recursive: true });
  const receiptPath = projectDigestReceiptPath(ensured);
  if (fs.existsSync(receiptPath)) {
    fs.copyFileSync(receiptPath, `${receiptPath}.previous-${timestampForFilename()}.bak`);
    fs.rmSync(receiptPath, { force: true });
  }
  fs.writeFileSync(projectDigestRequestPath(ensured), JSON.stringify(request, null, 2), 'utf8');
  const digestState = writeProjectDigestState(ensured, {
    status: 'submitted',
    digestSubmittedAt: now,
    digestBatchId: batchId,
    submittedFiles,
    idempotencyKey: digestBatch.idempotencyKey,
    completionPolicy: 'auto_after_validation',
    message: options.message || '项目资料消化指令已提交给 Agent，等待逐文件回执。',
  });
  return { ok: true, project: ensured, request, digestState };
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
    knowledgeMode: String(project.knowledgeMode || 'managed') === 'adopted' ? 'adopted' : 'managed',
    knowledgeSpaceId: String(project.knowledgeSpaceId || ''),
    knowledgeAdoption: project.knowledgeAdoption && typeof project.knowledgeAdoption === 'object' ? project.knowledgeAdoption : null,
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
      confidence: String(item?.confidence || ''),
      sourcePaths: Array.isArray(item?.sourcePaths) ? item.sourcePaths.map(String).filter(Boolean) : [],
      generatedBy: String(item?.generatedBy || ''),
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
    workspaceScanSnapshot: project.workspaceScanSnapshot && typeof project.workspaceScanSnapshot === 'object' ? project.workspaceScanSnapshot : {},
    workspaceRebindHistory: Array.isArray(project.workspaceRebindHistory) ? project.workspaceRebindHistory : [],
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
  const managedDirs = [
    projectsBaseDir(),
    paths.workspacePath,
    paths.stagingPath,
    ...workspaceFolderDirs,
    paths.managerPath,
    paths.outputPath,
  ];
  const knowledgeDirs = normalized.knowledgeMode === 'adopted' ? [] : [paths.knowledgeRootPath, paths.rawPath, paths.conceptPath, paths.entityPath, paths.summaryPath, paths.qaPath, paths.synthesisPath, paths.reportPath, paths.contributionPath];
  [...managedDirs, ...knowledgeDirs].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
  const students = readStudentsIndex().filter((student) => normalized.studentIds.includes(String(student.id)));
  writeTextIfMissing(paths.agentPath, projectAgentTemplate(normalized, students));
  writeProjectWorkspaceIndex(normalized);
  writeProjectBindingIndex(normalized);
  if (normalized.knowledgeMode !== 'adopted') {
    writeTextIfMissing(path.join(paths.knowledgeRootPath, 'index.md'), `# ${normalized.name} 项目知识空间\n\n- 项目原始资料库：${paths.rawPath}\n- 综合汇总库：${paths.synthesisPath}\n- 知识贡献：${paths.contributionPath}\n`);
    writeTextIfMissing(path.join(paths.knowledgeRootPath, 'log.md'), `# ${normalized.name} 项目处理日志\n\n`);
  }
  const ensured = { ...normalized, ...paths };
  writeProjectStagingIndex(ensured);
  return ensured;
}

function getProjects() {
  const projects = readProjects().map(normalizeProject).map((project) => {
    const records = readProjectKnowledgeReview(project).records;
    const knowledgeKinds = new Set(records.filter((item) => !['rejected', 'invalid'].includes(item.status)).map((item) => item.kind));
    const knowledgeCoverage = Math.round((knowledgeKinds.size / 5) * 100);
    const pendingKnowledgeCount = records.filter((item) => ['ai_generated', 'pending_review'].includes(item.status)).length;
    const pendingStagingCount = (project.stagingItems || []).filter((item) => !['promoted', 'analyzed', 'discarded'].includes(item.status)).length;
    const riskReasons = [
      !project.studentIds.length ? '未绑定学生' : '',
      !project.assetIds.length ? '无正式资产' : '',
      project.digestState?.pendingCount ? `${project.digestState.pendingCount} 份资料待消化` : '',
      project.digestState?.status === 'failed' ? '自动消化失败' : '',
      !fs.existsSync(project.workspacePath) ? '工作空间路径失效' : '',
      ['archived', 'published'].includes(project.status) && (pendingStagingCount || pendingKnowledgeCount || project.digestState?.pendingCount)
        ? '已归档或发布项目存在未收口数据'
        : '',
      records.some((item) => ['ai_generated', 'pending_review'].includes(item.status) && Date.now() - Date.parse(item.generatedAt || 0) > 7 * 86400000) ? '知识待审核超过 7 天' : '',
    ].filter(Boolean);
    return {
      ...project,
      dashboard: {
        knowledgeCount: records.length,
        pendingKnowledgeCount,
        pendingStagingCount,
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
    const knowledgeMode = options.knowledgeMode === 'adopted' ? 'adopted' : 'managed';
    const knowledgeScan = knowledgeMode === 'adopted' ? scanProjectKnowledgeBase(options.knowledgeRootPath, readProjects().map(normalizeProject)) : null;
    if (knowledgeScan && !knowledgeScan.ok) return JSON.stringify({ ok: false, message: `无法接管项目知识库：${knowledgeScan.errors.join(' ')}` });
    const managedProjectRoot = knowledgeScan ? path.join(projectsBaseDir(), `${sanitizeName(options.name)}项目控制目录`) : projectKnowledgeRoot(options.name);
    const prospectiveWorkspacePath = workspaceMode === 'linked' ? workspacePath : path.join(managedProjectRoot, '项目工作空间');
    if (knowledgeScan && (canonicalIsPathInside(prospectiveWorkspacePath, knowledgeScan.rootPath) || canonicalIsPathInside(knowledgeScan.rootPath, prospectiveWorkspacePath))) {
      return JSON.stringify({ ok: false, message: '项目工作空间与项目知识空间不能相同或相互包含。' });
    }
    const project = ensureProjectWorkspace(normalizeProject({
      name: options.name,
      projectRootPath: managedProjectRoot,
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
      knowledgeMode,
      knowledgeRootPath: knowledgeScan?.rootPath || '',
      knowledgeSpaceId: knowledgeScan?.knowledgeSpaceId || '',
      rawPath: knowledgeScan?.paths?.rawPath || '',
      conceptPath: knowledgeScan?.paths?.conceptPath || '',
      entityPath: knowledgeScan?.paths?.entityPath || '',
      summaryPath: knowledgeScan?.paths?.summaryPath || '',
      qaPath: knowledgeScan?.paths?.qaPath || '',
      synthesisPath: knowledgeScan?.paths?.synthesisPath || '',
      knowledgeAdoption: knowledgeScan ? { adoptedAt: new Date().toISOString(), originalAgentPath: knowledgeScan.agentPath, originalPathmapPath: knowledgeScan.pathmapPath, metadataPath: knowledgeScan.metadataPath, identitySource: knowledgeScan.identitySource, inventory: knowledgeScan.inventory, warnings: knowledgeScan.warnings } : null,
      knowledgeStrategy: options.knowledgeStrategy || '',
      growthStrategy: options.growthStrategy || '',
      agentTool: String(options.agentTool || 'qclaw'),
      deliverables: Array.isArray(options.deliverables) ? options.deliverables.map(String).filter(Boolean) : [],
    }));
    if (knowledgeScan) {
      const pathmap = adoptionPathmap(project, knowledgeScan);
      const pathmapPath = path.join(project.managerPath, 'adopted-knowledge-pathmap.json');
      const recordPath = path.join(project.managerPath, 'knowledge-adoption-record.json');
      fs.writeFileSync(pathmapPath, JSON.stringify(pathmap, null, 2), 'utf8');
      fs.writeFileSync(recordPath, JSON.stringify({ version: 1, projectId: project.id, knowledgeSpaceId: knowledgeScan.knowledgeSpaceId, adoptedAt: new Date().toISOString(), sourceRoot: knowledgeScan.rootPath, sourceInventory: knowledgeScan.inventory, sourceMetadataPath: knowledgeScan.metadataPath, sourceAgentPath: knowledgeScan.agentPath, sourcePathmapPath: knowledgeScan.pathmapPath, originalFilesModified: false, rollback: '删除项目记录即可解除绑定；原知识库文件保持不变。' }, null, 2), 'utf8');
      project.knowledgeAdoption = { ...project.knowledgeAdoption, pathmapPath, recordPath };
    }
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

function deleteLearningProject(projectId) {
  try {
    const projects = readProjects().map(normalizeProject);
    const project = projects.find((item) => String(item.id) === String(projectId));
    if (!project) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    const deletedAt = new Date().toISOString();
    const snapshotPath = path.join(project.managerPath, '项目记录已移除.json');
    fs.mkdirSync(project.managerPath, { recursive: true });
    fs.writeFileSync(snapshotPath, JSON.stringify({
      version: 2,
      deletionType: 'record_only',
      deletedAt,
      removedAt: deletedAt,
      project,
      preservedPaths: [project.projectRootPath, project.workspacePath, project.knowledgeRootPath].filter(Boolean),
      note: '安全删除：仅从教育管家项目索引移除；工作空间、知识空间、资产与审计文件均保留，可重新恢复。',
    }, null, 2), 'utf8');
    const nextProjects = projects.filter((item) => String(item.id) !== String(projectId));
    writeProjects(nextProjects);
    appendHostTimeline({ type: 'project_record_deleted', title: 'Project safely deleted', detail: project.name });
    return JSON.stringify({
      ok: true,
      projects: nextProjects,
      deletedProject: { snapshotPath, deletedAt, removedAt: deletedAt, project },
      preservedPath: project.projectRootPath,
      message: `已删除项目“${project.name}”。工作空间、知识空间和资产文件均已保留，可在“已删除项目”中恢复。`,
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `删除项目失败：${error.message}` });
  }
}

// Keep the legacy bridge working for older renderer bundles during an in-place upgrade.
function removeProjectRecord(projectId) {
  return deleteLearningProject(projectId);
}

function relocateProjectWorkspace(projectId) {
  try {
    const access = mutableProject(projectId, '重新定位工作空间');
    if (access.error) return access.error;
    const selected = dialog.showOpenDialogSync(mainWindow, { title: '重新定位项目工作空间', properties: ['openDirectory'] });
    if (!selected?.[0]) return JSON.stringify({ ok: false, cancelled: true, message: '已取消项目路径重新定位。' });
    const validation = validateWorkspaceRebind(access.project, selected[0], readProjects().map(normalizeProject));
    if (!validation.ok) return JSON.stringify({ ok: false, message: validation.errors.join(' ') });
    const openTasks = readTaskStore().tasks.filter((task) => String(task.projectId || task.sourceId || '') === String(projectId) && !['completed', 'failed', 'cancelled'].includes(String(task.status)));
    return JSON.stringify({
      ok: true,
      preview: true,
      oldPath: access.project.workspacePath,
      newPath: validation.targetPath,
      warnings: [...validation.warnings, ...(openTasks.length ? [`存在 ${openTasks.length} 个未完成项目任务，重新绑定前应先处理或确认暂停。`] : [])],
      openTaskCount: openTasks.length,
      message: '已完成路径预检。确认后只更新逻辑绑定，不移动、复制或删除任何文件。',
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `项目路径重新定位失败：${error.message}` });
  }
}

function confirmProjectWorkspaceRelocation(projectId, workspacePath) {
  try {
    const access = mutableProject(projectId, '重新定位工作空间');
    if (access.error) return access.error;
    const validation = validateWorkspaceRebind(access.project, workspacePath, readProjects().map(normalizeProject));
    if (!validation.ok) return JSON.stringify({ ok: false, message: validation.errors.join(' ') });
    const previousPath = access.project.workspacePath;
    const now = new Date().toISOString();
    const historyEntry = { id: `rebind-${Date.now()}`, at: now, oldPath: previousPath, newPath: validation.targetPath, previousScanSnapshot: access.project.workspaceScanSnapshot || {}, status: 'active' };
    const result = updateProjectRecord(projectId, (project) => ({
      ...project,
      workspaceMode: 'linked',
      workspacePath: validation.targetPath,
      previousWorkspacePath: previousPath,
      workspaceRelocatedAt: now,
      workspaceScanSnapshot: {},
      workspaceRebindHistory: [...(project.workspaceRebindHistory || []), historyEntry].slice(-20),
      updatedAt: now,
    }));
    const ensured = ensureProjectWorkspace(result.project);
    writeProjectBindingIndex(ensured);
    appendHostTimeline({ type: 'project_workspace_relocated', title: 'Project workspace relocated', detail: `${ensured.name}: ${previousPath} -> ${validation.targetPath}` });
    return JSON.stringify({ ok: true, project: ensured, projects: readProjects().map(normalizeProject), rebindId: historyEntry.id, message: '工作空间逻辑绑定已更新；原目录与知识空间均未修改。正在等待对新目录执行首次扫描。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `确认项目路径重新定位失败：${error.message}` });
  }
}

function rollbackProjectWorkspaceRelocation(projectId) {
  try {
    const access = mutableProject(projectId, '回滚工作空间绑定');
    if (access.error) return access.error;
    const history = [...(access.project.workspaceRebindHistory || [])];
    const current = [...history].reverse().find((item) => item.status === 'active');
    if (!current?.oldPath) return JSON.stringify({ ok: false, message: '没有可回滚的工作空间绑定记录。' });
    if (!fs.existsSync(current.oldPath)) return JSON.stringify({ ok: false, message: '旧工作空间路径已不存在，未修改当前绑定。' });
    current.status = 'rolled_back';
    current.rolledBackAt = new Date().toISOString();
    const result = updateProjectRecord(projectId, (project) => ({ ...project, workspaceMode: 'linked', workspacePath: current.oldPath, workspaceScanSnapshot: current.previousScanSnapshot || {}, workspaceRebindHistory: history, updatedAt: current.rolledBackAt }));
    const ensured = ensureProjectWorkspace(result.project);
    writeProjectBindingIndex(ensured);
    return JSON.stringify({ ok: true, project: ensured, projects: readProjects().map(normalizeProject), message: '已回滚到旧工作空间绑定；未移动或删除任何文件。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `回滚工作空间绑定失败：${error.message}` });
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
    if (parsed?.project) snapshots.push({
      snapshotPath,
      deletedAt: parsed.deletedAt || parsed.removedAt || '',
      removedAt: parsed.removedAt || parsed.deletedAt || '',
      deletionType: parsed.deletionType || 'record_only',
      project: normalizeProject(parsed.project),
    });
  }
  return snapshots;
}

function getRemovedProjects() {
  try {
    const activeIds = new Set(readProjects().map((item) => String(item.id)));
    const removed = findRemovedProjectSnapshots().filter((item) => !activeIds.has(String(item.project.id)));
    return JSON.stringify({ ok: true, removed, message: `发现 ${removed.length} 个可恢复的已删除项目。` });
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
  let transactionSnapshot = null;
  try {
    const access = mutableProject(projectId, '更新学生独立成长证据');
    if (access.error) return access.error;
    if (!access.project.studentIds.includes(String(studentId))) return JSON.stringify({ ok: false, message: '该学生未绑定到当前项目。' });
    const evidence = JSON.parse(evidenceJson || '{}');
    const sourcePaths = Array.isArray(evidence.sourcePaths) ? evidence.sourcePaths.map(String).filter(Boolean) : [];
    if (['verified', 'published'].includes(String(evidence.status)) && !sourcePaths.length) return JSON.stringify({ ok: false, message: '成长证据缺少具体来源，不能确认或发布。' });
    if (['verified', 'published'].includes(String(evidence.status)) && (!String(evidence.ability || '').trim() || !String(evidence.observation || '').trim())) return JSON.stringify({ ok: false, message: '请先补充能力维度和具体表现，再确认成长证据。' });
    const now = new Date().toISOString();
    const student = readStudentsIndex().find((item) => String(item.id) === String(studentId));
    if (!student) return JSON.stringify({ ok: false, message: '未找到绑定学生，成长证据未保存。' });
    transactionSnapshot = growthTransactionSnapshot(student);
    const result = updateProjectRecord(projectId, (project) => ({
      ...project,
      studentEvidence: [
        ...(project.studentEvidence || []).filter((item) => String(item.studentId) !== String(studentId)),
        {
          studentId: String(studentId),
          ability: String(evidence.ability || ''),
          observation: String(evidence.observation || ''),
          status: String(evidence.status || 'draft'),
          confidence: String(evidence.confidence || ''),
          sourcePaths,
          generatedBy: String(evidence.generatedBy || ''),
          updatedAt: now,
        },
      ],
      updatedAt: now,
    }));
    if (student) {
      const evidenceDir = path.join(result.project.contributionPath, '学生独立成长证据');
      fs.mkdirSync(evidenceDir, { recursive: true });
      fs.writeFileSync(path.join(evidenceDir, `${sanitizeName(student.name)}-${studentId}.md`), `# ${student.name} · ${result.project.name}\n\n- 能力维度：${evidence.ability || '待补充'}\n- 状态：${evidence.status || 'draft'}\n- 置信度：${evidence.confidence || '待评估'}\n- 生成方式：${evidence.generatedBy || '人工'}\n- 来源：${Array.isArray(evidence.sourcePaths) && evidence.sourcePaths.length ? evidence.sourcePaths.join('；') : '待补充'}\n- 更新时间：${now}\n\n## 独立观察\n\n${evidence.observation || '待补充'}\n`, 'utf8');
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
      if (evidence.status === 'verified' || evidence.status === 'published') {
        const review = readGrowthEvidenceReview(toHostStudent(student));
        const confirmed = review.candidates.find((item) => String(item.id) === `project-student-${result.project.id}-${studentId}`);
        if (confirmed) appendConfirmedGrowthEvidence(toHostStudent(student), confirmed);
      }
    }
    const growthResult = JSON.parse(rebuildGrowthIndex(studentId));
    if (!growthResult.ok) throw new Error(growthResult.message || '成长模型索引更新失败。');
    const status = String(evidence.status || 'draft');
    const statusLabel = status === 'verified' ? '已确认' : status === 'published' ? '已发布' : status === 'rejected' ? '已驳回' : '已保存为草稿';
    appendHostTimeline({ type: 'project_student_evidence_updated', title: 'Project student evidence updated', detail: `${result.project.name} / ${student?.name || studentId} / ${status}` });
    return JSON.stringify({ ok: true, project: result.project, projects: result.projects, evidence: result.project.studentEvidence.find((item) => String(item.studentId) === String(studentId)), growthIndex: growthResult.index, message: `该学生成长证据${statusLabel}，成长模型已同步更新；项目知识仍由所有参与学生共享。` });
  } catch (error) {
    if (transactionSnapshot) {
      try { restoreGrowthTransaction(transactionSnapshot); } catch { /* Preserve the original failure. */ }
    }
    return JSON.stringify({ ok: false, message: `保存学生成长证据失败：${error.message}` });
  }
}

function projectStudentEvidenceSuggestionPath(project) {
  const ensured = ensureProjectWorkspace(project);
  return path.join(ensured.contributionPath, '学生独立成长证据', 'AI个人证据建议.json');
}

function getProjectStudentEvidencePrompt(projectId) {
  try {
    const project = readProjects().map(normalizeProject).find((item) => String(item.id) === String(projectId));
    if (!project) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    const ensured = ensureProjectWorkspace(project);
    const students = readStudentsIndex().filter((student) => ensured.studentIds.includes(String(student.id)));
    if (!students.length) return JSON.stringify({ ok: false, message: '请先绑定参与学生。' });
    const knowledge = readProjectKnowledgeReview(ensured).records.map((record) => ({
      kind: record.kind,
      title: record.title,
      status: record.status,
      confidence: record.confidence,
      sourceAssets: record.sourceAssets,
      path: record.path,
    }));
    const sources = (ensured.stagingItems || []).filter((item) => ['selected', 'analyzed', 'promoted'].includes(String(item.status))).map((item) => ({
      filename: item.filename,
      status: item.status,
      sourcePath: item.sourcePath || item.path,
      aiReason: item.aiReason || '',
    }));
    const outputPath = projectStudentEvidenceSuggestionPath(ensured);
    const command = `请为学习项目「${ensured.name}」生成每名参与学生独立的成长证据草稿。\n\n规则：\n1. 项目知识可以共享，但不得把同一条个人表现复制给所有学生。\n2. 只根据署名、角色、过程记录、教师反馈、个人作品或明确来源形成判断。\n3. 无法确认个人贡献时，status 必须为 draft，confidence 必须为 low，并在 observation 中说明待补证据。\n4. 每条建议必须列出 sourcePaths。\n5. 只输出 JSON，并写入：${outputPath}\n\nJSON 格式：\n{\n  "format": "edu-manager-project-student-evidence",\n  "projectId": "${ensured.id}",\n  "students": [\n    {\n      "studentId": "学生ID",\n      "ability": "能力维度",\n      "observation": "具体表现与证据，不写空泛评价",\n      "confidence": "high | medium | low",\n      "sourcePaths": ["来源路径"],\n      "status": "draft"\n    }\n  ]\n}\n\n项目目标：${ensured.objective || '未填写'}\n成长策略：${ensured.growthStrategy || '未填写'}\n参与学生：${JSON.stringify(students.map((student) => ({ id: String(student.id), name: student.name })), null, 2)}\n项目资料：${JSON.stringify(sources, null, 2)}\n知识资产：${JSON.stringify(knowledge, null, 2)}`;
    return JSON.stringify({ ok: true, command, outputPath, message: '已生成个人成长证据建议任务。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `生成个人证据建议任务失败：${error.message}` });
  }
}

function importProjectStudentEvidenceSuggestions(projectId, pastedText = '') {
  try {
    const access = mutableProject(projectId, '同步个人成长证据建议');
    if (access.error) return access.error;
    const project = ensureProjectWorkspace(access.project);
    let sourcePath = projectStudentEvidenceSuggestionPath(project);
    let rawContent = String(pastedText || '').trim();
    if (!rawContent && !fs.existsSync(sourcePath)) {
      const selected = dialog.showOpenDialogSync(mainWindow, { title: '导入个人成长证据建议', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json', 'txt', 'md'] }] });
      if (!selected?.[0]) return JSON.stringify({ ok: false, message: `尚未发现 Agent 回执：${sourcePath}` });
      sourcePath = selected[0];
    }
    if (!rawContent) rawContent = fs.readFileSync(sourcePath, 'utf8');
    const normalized = normalizeProjectStudentEvidencePayload(rawContent, { projectId: project.id });
    if (!normalized.ok) return JSON.stringify({ ok: false, sourcePath, message: normalized.message });
    if (String(normalized.projectId) !== String(project.id)) return JSON.stringify({ ok: false, sourcePath, message: `个人证据建议项目ID不匹配：当前项目为 ${project.id}，文件中为 ${normalized.projectId}。` });
    if (String(pastedText || '').trim()) {
      const auditDir = path.join(project.managerPath, 'agent-results');
      fs.mkdirSync(auditDir, { recursive: true });
      sourcePath = path.join(auditDir, `student-evidence-${normalized.idempotencyKey}.txt`);
      if (!fs.existsSync(sourcePath)) fs.writeFileSync(sourcePath, rawContent, 'utf8');
    }
    const suggestions = normalized.suggestions;
    const allowedStudentIds = new Set(project.studentIds.map(String));
    const boundStudents = readStudentsIndex().filter((student) => allowedStudentIds.has(String(student.id)));
    let imported = 0;
    let importedEvidence = 0;
    const skipped = [];
    for (const suggestion of suggestions) {
      const matchedStudent = allowedStudentIds.has(String(suggestion?.studentId || ''))
        ? boundStudents.find((student) => String(student.id) === String(suggestion.studentId))
        : boundStudents.find((student) => String(student.name || '').trim() === String(suggestion?.studentName || '').trim());
      if (!matchedStudent) {
        skipped.push(suggestion.studentName || suggestion.studentId || '未知学生');
        continue;
      }
      const result = JSON.parse(updateProjectStudentEvidence(project.id, String(matchedStudent.id), JSON.stringify({
        ability: suggestion.ability,
        observation: suggestion.observation,
        confidence: suggestion.confidence,
        sourcePaths: suggestion.sourcePaths,
        generatedBy: 'AI建议',
        status: 'draft',
      })));
      if (result.ok) {
        imported += 1;
        importedEvidence += Number(suggestion.evidenceCount || 1);
      }
    }
    const skipText = skipped.length ? `；未匹配：${skipped.join('、')}` : '';
    const invalidText = normalized.invalidItems?.length ? `；另有 ${normalized.invalidItems.length} 项格式不完整，已隔离，不影响有效记录` : '';
    return JSON.stringify({ ok: imported > 0, imported, importedEvidence, skipped, invalidItems: normalized.invalidItems || [], partial: normalized.partial, idempotencyKey: normalized.idempotencyKey, sourcePath, sourceFormat: normalized.sourceFormat, projects: readProjects().map(normalizeProject), project: readProjects().map(normalizeProject).find((item) => String(item.id) === String(project.id)), message: imported ? `已从 ${sourcePath} 同步 ${imported} 名学生、${importedEvidence} 条AI证据草稿，请逐人确认${skipText}${invalidText}。` : `已读取 ${sourcePath}，但没有匹配到当前项目参与学生${skipText}${invalidText}。` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `同步个人证据建议失败：${error.message}` });
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

function pickProjectKnowledgeBaseDir() {
  try {
    const result = dialog.showOpenDialogSync(mainWindow, { title: '选择已有项目知识空间', properties: ['openDirectory'] });
    if (!result?.[0]) return JSON.stringify({ ok: false, cancelled: true, message: '未选择项目知识空间。' });
    return JSON.stringify(scanProjectKnowledgeBase(result[0], readProjects().map(normalizeProject)));
  } catch (error) {
    return JSON.stringify({ ok: false, message: `选择项目知识空间失败：${error.message}` });
  }
}

function inspectProjectKnowledgeBase(rootPath) {
  try {
    return JSON.stringify(scanProjectKnowledgeBase(rootPath, readProjects().map(normalizeProject)));
  } catch (error) {
    return JSON.stringify({ ok: false, message: `检查项目知识空间失败：${error.message}` });
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
    const nextStatus = String(status || '');
    if (!allowed.has(nextStatus)) return JSON.stringify({ ok: false, message: `无效的项目状态：${nextStatus || '空值'}。` });
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
    if (nextStatus === 'archived' || nextStatus === 'published') {
      const gate = projectCompletionGate(currentProject, nextStatus === 'published' ? 'publish' : 'archive');
      if (!gate.ok) return JSON.stringify({ ok: false, gateIssues: gate.issues, message: `项目状态闸门未通过：${gate.issues.join('；')}。` });
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
        ...(currentProject.status === 'sealed' && nextStatus === 'active' ? { sealedAt: '', sealedSnapshotPath: '' } : {}),
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

function projectWithNewInputs(project, reason, now = new Date().toISOString()) {
  if (!['archived', 'published'].includes(String(project.status))) return project;
  return {
    ...project,
    status: 'pending_review',
    publishedChangesAt: now,
    statusBeforeNewInputs: project.status,
    newInputReason: String(reason || 'new_project_input'),
  };
}

function emitProjectScanProgress(sender, payload) {
  if (sender && !sender.isDestroyed()) sender.send('bridge:projectWorkspaceScanProgress', payload);
}

async function scanProjectWorkspace(projectId, sender) {
  try {
    if (activeProjectWorkspaceScans.has(String(projectId))) return JSON.stringify({ ok: false, message: '该项目的工作空间正在扫描，请等待当前扫描完成。' });
    const access = mutableProject(projectId, '扫描或修改工作空间资料');
    if (access.error) return access.error;
    const project = ensureProjectWorkspace(access.project);
    const runtime = { cancelled: false };
    activeProjectWorkspaceScans.set(String(projectId), runtime);
    emitProjectScanProgress(sender, { projectId, phase: 'listing', visited: 0, percent: 0, message: '正在枚举工作空间文件...' });
    const collected = await collectWorkspaceFiles(project.workspacePath, {
      excludedRoots: [project.stagingPath, project.knowledgeRootPath, project.managerPath],
      limit: 5000,
      isCancelled: () => runtime.cancelled,
      onProgress: (progress) => emitProjectScanProgress(sender, { projectId, ...progress, message: `已发现 ${progress.visited} 份文件...` }),
    });
    if (collected.cancelled) return JSON.stringify({ ok: false, cancelled: true, message: `扫描已取消；已枚举 ${collected.files.length} 份文件，未修改项目索引。` });
    const files = collected.files.filter((file) => !['工作空间结构.md', 'desktop.ini', 'thumbs.db'].includes(file.filename.toLocaleLowerCase('zh-CN')));
    const existing = new Map((project.stagingItems || []).map((item) => [String(item.sourcePath || item.path).toLocaleLowerCase('zh-CN'), item]));
    let added = 0;
    let updatedCount = 0;
    let missing = 0;
    const scannedPaths = new Set();
    const stagingItems = [...(project.stagingItems || [])];
    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      if (runtime.cancelled) return JSON.stringify({ ok: false, cancelled: true, message: `扫描已取消；未修改项目索引。` });
      const file = files[fileIndex];
      const key = String(file.path).toLocaleLowerCase('zh-CN');
      scannedPaths.add(key);
      const current = existing.get(key);
      const unchanged = current && Number(current.size || 0) === Number(file.size || 0) && Number(current.mtimeMs || 0) === Number(file.mtimeMs || 0) && current.sha1;
      const sha1 = unchanged ? current.sha1 : await sha1FileAsync(file.path);
      if (current) {
        const index = stagingItems.findIndex((item) => item.id === current.id);
        stagingItems[index] = normalizeProjectStagingItem({ ...current, size: file.size, mtimeMs: file.mtimeMs, sha1, updatedAt: new Date().toISOString() });
        updatedCount += 1;
      } else {
        stagingItems.push(normalizeProjectStagingItem({
          filename: file.filename,
          path: file.path,
          sourcePath: file.path,
          size: file.size,
          mtimeMs: file.mtimeMs,
          sha1,
          status: 'collected',
          sourceStrategy: 'reference_only',
          reviewStatus: 'pending',
        }));
        added += 1;
      }
      if (fileIndex % 10 === 0 || fileIndex === files.length - 1) emitProjectScanProgress(sender, { projectId, phase: 'hashing', visited: fileIndex + 1, total: files.length, percent: files.length ? Math.round(((fileIndex + 1) / files.length) * 100) : 100, message: `正在校验 ${fileIndex + 1}/${files.length} 份文件...` });
    }
    for (let index = 0; index < stagingItems.length; index += 1) {
      const item = stagingItems[index];
      const sourceKey = String(item.sourcePath || '').toLocaleLowerCase('zh-CN');
      if (item.sourcePath && canonicalIsPathInside(project.workspacePath, item.sourcePath) && !scannedPaths.has(sourceKey) && !item.promotedAssetId) {
        stagingItems[index] = normalizeProjectStagingItem({ ...item, status: 'discarded', governanceAction: '来源已移除', governanceReason: '工作空间扫描未发现原文件，请核对是否移动或删除。', governanceReviewedAt: new Date().toISOString() });
        missing += 1;
      }
    }
    const now = new Date().toISOString();
    const scanSnapshot = Object.fromEntries(files.map((file) => [file.relativePath, { size: file.size, mtimeMs: file.mtimeMs }]));
    const scannedProject = { ...project, stagingItems, workspaceLastScannedAt: now, workspaceScanSnapshot: scanSnapshot, updatedAt: now };
    const nextProjects = readProjects().map(normalizeProject).map((item) => String(item.id) === String(projectId)
      ? (added > 0 ? projectWithNewInputs(scannedProject, 'workspace_scan', now) : scannedProject)
      : item);
    writeProjects(nextProjects);
    const updatedProject = nextProjects.find((item) => String(item.id) === String(projectId));
    if (added > 0 && updatedProject.automation?.enabled && updatedProject.automation?.onWorkspaceChange) {
      updatedProject.digestState = writeProjectDigestState(updatedProject, { status: 'pending', message: `工作空间新增 ${added} 份资料，等待增量消化。`, triggerReason: 'workspace_change' });
      const projectIndex = nextProjects.findIndex((item) => String(item.id) === String(projectId));
      nextProjects[projectIndex] = normalizeProject(updatedProject);
      writeProjects(nextProjects);
    }
    writeProjectStagingIndex(updatedProject);
    emitProjectScanProgress(sender, { projectId, phase: 'complete', visited: files.length, total: files.length, percent: 100, message: '工作空间扫描完成。' });
    return JSON.stringify({ ok: true, project: normalizeProject(updatedProject), projects: nextProjects.map(normalizeProject), scanned: files.length, added, updated: updatedCount, missing, skippedLinks: collected.skippedLinks, limitReached: collected.limitReached, message: `工作空间扫描完成：发现 ${files.length} 份文件，新增 ${added} 份候选资料，标记 ${missing} 份来源缺失。${collected.limitReached ? ' 已达到 5000 份安全上限，请缩小目录范围后继续。' : ''}${collected.skippedLinks ? ` 已跳过 ${collected.skippedLinks} 个链接目录以避免越界。` : ''}` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `扫描项目工作空间失败：${error.message}` });
  } finally {
    activeProjectWorkspaceScans.delete(String(projectId));
  }
}

function cancelProjectWorkspaceScan(projectId) {
  const runtime = activeProjectWorkspaceScans.get(String(projectId));
  if (!runtime) return JSON.stringify({ ok: false, message: '当前没有正在运行的工作空间扫描。' });
  runtime.cancelled = true;
  return JSON.stringify({ ok: true, message: '已请求取消；当前文件处理结束后停止，项目索引不会写入半成品。' });
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
    let matched = 0;
    const blocked = [];
    const nextProjects = projects.map((project) => {
      if (String(project.id) !== String(projectId)) return project;
      updated = {
        ...project,
        stagingItems: (project.stagingItems || []).map((item) => {
          if (!ids.has(item.id)) return item;
          matched += 1;
          const transition = nextStagingReviewState(item, nextDecision);
          if (!transition.ok) {
            blocked.push({ id: item.id, status: item.status, reason: transition.reason });
            return item;
          }
          return normalizeProjectStagingItem({
            ...item,
            reviewStatus: nextDecision,
            reviewNote: String(note || ''),
            reviewedAt: now,
            sourceStrategy: nextStrategy,
            status: transition.status,
          });
        }),
        updatedAt: now,
      };
      return updated;
    });
    const changed = matched - blocked.length;
    if (!matched) return JSON.stringify({ ok: false, message: '所选暂存资料已不存在，未更新任何记录。' });
    if (!changed) return JSON.stringify({ ok: false, blocked, message: '所选资料均不允许执行当前审核操作。' });
    writeProjects(nextProjects);
    writeProjectStagingIndex(updated);
    return JSON.stringify({ ok: true, updated: changed, blocked, project: normalizeProject(updated), projects: nextProjects.map(normalizeProject), message: `已审核 ${changed} 份资料；${blocked.length} 份因状态约束未修改。处理结果：${nextDecision}。` });
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
  const savedRecords = Array.isArray(saved.records) ? saved.records : [];
  const savedByPath = new Map(savedRecords.map((record) => [String(record.path).toLocaleLowerCase('zh-CN'), record]));
  const savedByRelative = new Map(savedRecords.filter((record) => record.relativePath).map((record) => [`${record.kind}|${String(record.relativePath).toLocaleLowerCase('zh-CN')}`, record]));
  const savedByContent = new Map(savedRecords.filter((record) => record.contentSha1).map((record) => [`${record.kind}|${record.contentSha1}`, record]));
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
      const relativePath = path.relative(dir, file.path).replace(/\\/g, '/');
      const contentSha1 = file.sha1 || sha1File(file.path);
      const current = savedByPath.get(String(file.path).toLocaleLowerCase('zh-CN'))
        || savedByRelative.get(`${kind}|${relativePath.toLocaleLowerCase('zh-CN')}`)
        || savedByContent.get(`${kind}|${contentSha1}`)
        || {};
      records.push({
        id: String(current.id || `knowledge-${crypto.createHash('sha1').update(`${project.id}|${kind}|${relativePath.toLocaleLowerCase('zh-CN')}`).digest('hex').slice(0, 16)}`),
        kind,
        title: String(current.title || path.basename(file.filename, path.extname(file.filename))),
        path: file.path,
        relativePath,
        contentSha1,
        sourceAssets: Array.isArray(current.sourceAssets) ? current.sourceAssets.map(String).filter(Boolean) : [],
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
    let matched = 0;
    const blocked = [];
    review.records = review.records.map((record) => {
      if (!ids.has(record.id)) return record;
      matched += 1;
      if (!nextKnowledgeReviewState(record.status, status).ok) {
        blocked.push({ id: record.id, from: record.status, to: status });
        return record;
      }
      return { ...record, status, reviewNote: String(note || ''), reviewedAt: now };
    });
    const updated = matched - blocked.length;
    if (!matched) return JSON.stringify({ ok: false, message: '所选知识资产已不存在或身份已变化，未更新任何记录。' });
    if (!updated) return JSON.stringify({ ok: false, blocked, message: '所选知识资产均不允许执行当前状态变更。' });
    review.updatedAt = now;
    fs.mkdirSync(access.project.managerPath, { recursive: true });
    fs.writeFileSync(projectKnowledgeReviewPath(access.project), JSON.stringify(review, null, 2), 'utf8');
    return JSON.stringify({ ok: true, ...review, updated, blocked, message: `已更新 ${updated} 条知识资产；${blocked.length} 条因状态约束未修改。` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `更新知识资产审核失败：${error.message}` });
  }
}

function getProjectUnifiedReview(projectId) {
  try {
    const project = readProjects().map(normalizeProject).find((item) => String(item.id) === String(projectId));
    if (!project) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    const knowledgeReview = readProjectKnowledgeReview(project);
    const reviewPackage = buildProjectReviewPackage(project, knowledgeReview.records);
    return JSON.stringify({ ok: true, project, reviewPackage, message: reviewPackage.message });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `生成统一审核包失败：${error.message}` });
  }
}

function applyProjectUnifiedReview(projectId) {
  try {
    const initial = JSON.parse(getProjectUnifiedReview(projectId));
    if (!initial.ok) return JSON.stringify(initial);
    const applied = { materials: 0, knowledge: 0 };
    const messages = [];
    if (initial.reviewPackage.ready.materialIds.length) {
      const result = JSON.parse(approveAndPromoteProjectStagingItems(projectId, JSON.stringify(initial.reviewPackage.ready.materialIds), 'reference_only', '统一审核包一键采用。'));
      if (!result.ok) return JSON.stringify({ ...result, reviewPackage: initial.reviewPackage });
      applied.materials = Number(result.promoted || initial.reviewPackage.ready.materialIds.length);
      messages.push(result.message);
    }
    if (initial.reviewPackage.ready.knowledgeIds.length) {
      const result = JSON.parse(updateProjectKnowledgeReview(projectId, JSON.stringify(initial.reviewPackage.ready.knowledgeIds), 'verified', '统一审核包确认：高置信且来源完整。'));
      if (!result.ok) return JSON.stringify({ ...result, reviewPackage: initial.reviewPackage, applied });
      applied.knowledge = Number(result.updated || initial.reviewPackage.ready.knowledgeIds.length);
      messages.push(result.message);
    }
    const refreshedProject = readProjects().map(normalizeProject).find((item) => String(item.id) === String(projectId));
    const refreshedKnowledge = readProjectKnowledgeReview(refreshedProject).records;
    const reviewPackage = buildProjectReviewPackage(refreshedProject, refreshedKnowledge);
    appendHostTimeline({ type: 'project_unified_review_applied', title: 'Project unified review applied', detail: `${refreshedProject.name}: materials ${applied.materials}, knowledge ${applied.knowledge}`, count: applied.materials + applied.knowledge });
    return JSON.stringify({ ok: true, applied, project: refreshedProject, projects: readProjects().map(normalizeProject), reviewPackage, message: `本批次已采用 ${applied.materials} 份资料、确认 ${applied.knowledge} 条低风险知识。成长证据仍等待人工确认。${messages.length ? ` ${messages.join(' ')}` : ''}` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `应用统一审核包失败：${error.message}` });
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

async function runProjectAutomationSweep() {
  const now = Date.now();
  const dueProjects = readProjects().map(normalizeProject).filter((project) => project.status !== 'sealed' && project.automation?.enabled && (!project.automation.nextRunAt || Date.parse(project.automation.nextRunAt) <= now));
  const results = [];
  for (const project of dueProjects) {
    let scanResult = { ok: false, added: 0, message: '' };
    try {
      scanResult = JSON.parse(await scanProjectWorkspace(project.id));
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
    const existingAssetIds = new Set((ensured.assetIds || []).map(String));
    for (const assetId of assetIds.map(String)) {
      const asset = assets.find((item) => String(item.assetId) === assetId);
      if (!asset || !asset.path || !fs.existsSync(asset.path)) {
        skipped.push(assetId);
        continue;
      }
      const linked = upsertAssetFromFile(asset.path, {
        spaceType: 'project',
        projectId: project.id,
        projectName: project.name,
        sourcePath: asset.path,
        sourceName: '资产中心',
        role: 'project_source_reference',
        referenceId: `${project.id}-${asset.assetId}`,
      });
      if (linked) {
        const baseName = sanitizeName(path.basename(asset.filename || asset.path, path.extname(asset.filename || asset.path)));
        const sourceRecordPath = path.join(ensured.rawPath, `来源记录-${baseName}-${linked.assetId}.md`);
        const createdSourceRecord = !fs.existsSync(sourceRecordPath);
        writeTextIfMissing(sourceRecordPath, `# ${asset.filename || path.basename(asset.path)}\n\n- 保存策略：复用正式资产（仅引用）\n- 文件资产：${linked.assetId}\n- 来源路径：${asset.path}\n- SHA-1：${asset.sha1 || linked.sha1 || ''}\n- 关联项目：${ensured.name}\n`);
        if (!existingAssetIds.has(String(linked.assetId)) || createdSourceRecord) imported.push(linked.assetId);
        existingAssetIds.add(String(linked.assetId));
      }
    }
    const importedAssetIds = mergeUnique(imported);
    const now = new Date().toISOString();
    const projects = readProjects().map(normalizeProject);
    const nextProjects = projects.map((item) => String(item.id) === String(project.id)
      ? (importedAssetIds.length
        ? projectWithNewInputs({ ...item, assetIds: mergeUnique([...(item.assetIds || []), ...importedAssetIds]), updatedAt: now }, 'asset_reference', now)
        : item)
      : item);
    writeProjects(nextProjects);
    if (importedAssetIds.length) {
      const nextProject = nextProjects.find((item) => String(item.id) === String(project.id));
      const digestState = writeProjectDigestState(nextProject, { status: 'pending', message: `有 ${importedAssetIds.length} 份复用资产来源记录待消化。`, triggerReason: 'asset_reference' });
      const withDigest = nextProjects.map((item) => String(item.id) === String(project.id) ? { ...item, digestState, updatedAt: now } : item);
      writeProjects(withDigest);
      nextProjects.splice(0, nextProjects.length, ...withDigest);
    }
    appendHostTimeline({ type: 'project_assets_imported', title: 'Project assets imported', detail: project.name, count: importedAssetIds.length });
    return JSON.stringify({
      ok: importedAssetIds.length > 0,
      imported: importedAssetIds.length,
      skipped: skipped.length,
      project: nextProjects.find((item) => String(item.id) === String(project.id)),
      message: importedAssetIds.length ? `已引用 ${importedAssetIds.length} 个正式资产，并在项目原始资料库建立来源记录；未复制原文件。` : '所选资产已存在于项目中，无需重复引用或消化。',
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
    let result = updateProjectRecord(ensured.id, (item) => projectWithNewInputs({
      ...item,
      assetIds: mergeUnique([...(item.assetIds || []), ...imported]),
      digestState,
      updatedAt: now,
    }, 'direct_raw_import', now));
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
    const request = safeReadJson(projectDigestRequestPath(ensured), {});
    if (!state.digestBatchId || !['submitted', 'digesting'].includes(String(state.status)) || !state.submittedFiles.length
      || String(request.digestBatchId || '') !== String(state.digestBatchId)) {
      return JSON.stringify({ ok: false, message: '请先登记当前待消化批次，再生成 Agent 指令。' });
    }
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
4. 只读取本批请求文件，不要修改它：
${projectDigestRequestPath(ensured)}
5. 完成后将逐文件回执写入以下独立回执文件，不要覆盖控制台状态文件：
${projectDigestReceiptPath(ensured)}
6. 必须逐字复制请求文件中的 projectId 和 digestBatchId，禁止自行生成批次号。
7. 必须使用 digestedFiles，并为本批每个实际完成的源文件填写 relativePath 与原 SHA-1；禁止改用 batchId、processedFiles 或只列出生成的摘要文件。
8. 如果无法写入指定回执路径，请在最终回复中直接输出完整 JSON 回执；不要改写为 Markdown 报告，也不要自行保存到 ~/.qclaw。用户会把 JSON 粘贴回教育管家。

回执文件 JSON 格式：
{
  "version": 3,
  "status": "completed",
  "projectId": "${ensured.id}",
  "digestBatchId": "${state.digestBatchId}",
  "lastDigestAt": "当前 ISO 时间",
  "message": "项目资料已消化完成",
  "digestedFiles": [{"relativePath":"相对项目原始资料库的路径","sha1":"对应本批清单中的 SHA-1","status":"completed"}]
}

本批次资料（只能回执以下文件，不得省略 digestBatchId）：
${(state.submittedFiles || []).map((file) => `- ${file.relativePath || file.filename} | SHA-1 ${file.sha1} | ${file.path}`).join('\n')}
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
    upsertTaskCandidates(buildTaskCenterCandidates(), { reconcileStudentDigests: true, reconcileWeeklyActions: true });
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
    const registered = registerProjectDigestBatch(ensured);
    if (!registered.ok) return JSON.stringify(registered);
    const state = registered.digestState;
    const now = new Date().toISOString();
    const result = updateProjectRecord(ensured.id, (item) => ({ ...item, digestState: state, updatedAt: now }));
    appendHostTimeline({ type: 'project_digest_submitted', title: 'Project digest submitted', detail: ensured.name, count: state.pendingCount || 0 });
    const commandResult = JSON.parse(getProjectDigestCommand(ensured.id));
    return JSON.stringify({ ok: true, project: result.project, projects: result.projects, digestState: state, command: commandResult.command || '', message: state.message });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `标记项目消化提交失败：${error.message}` });
  }
}

function applyProjectDigestReceiptText(projectId, rawText) {
  try {
    const access = mutableProject(projectId, '粘贴项目消化回执');
    if (access.error) return access.error;
    const ensured = ensureProjectWorkspace(access.project);
    const current = readProjectDigestState(ensured);
    const request = safeReadJson(projectDigestRequestPath(ensured), {});
    const paths = projectPathsFor(ensured.name, ensured.projectRootPath, ensured);
    const rawFiles = collectProjectRawFiles(paths.rawPath);
    const source = String(rawText || '').trim();
    if (!source) return JSON.stringify({ ok: false, message: '请先粘贴 Agent 返回的 JSON 回执。' });
    const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const parsed = parseDigestReceipt((fenced ? fenced[1] : source).replace(/^\uFEFF/, '').trim());
    if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
      return JSON.stringify({
        ok: false,
        message: '粘贴内容不是有效 JSON 回执。请让 Agent 直接返回包含 projectId、digestBatchId 和 digestedFiles 的 JSON，不要只返回 Markdown 报告。',
      });
    }
    const validation = validateDigestReceipt({ projectId: ensured.id, current, request, receipt: parsed.value, rawFiles });
    if (!validation.ok) return JSON.stringify({ ok: false, message: validation.message, rejectedReceipts: validation.rejected || [] });
    fs.mkdirSync(path.dirname(projectDigestReceiptPath(ensured)), { recursive: true });
    fs.writeFileSync(projectDigestReceiptPath(ensured), JSON.stringify(parsed.value, null, 2), 'utf8');
    return syncProjectDigestResult(ensured.id);
  } catch (error) {
    return JSON.stringify({ ok: false, message: `粘贴项目消化回执失败：${error.message}` });
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
    const request = safeReadJson(projectDigestRequestPath(ensured), {});
    const diskState = safeReadJson(projectDigestReceiptPath(ensured), {});
    const receiptValidation = validateDigestReceipt({ projectId: ensured.id, current, request, receipt: diskState, rawFiles });
    if (!receiptValidation.ok && receiptValidation.code !== 'receipt_not_ready') {
      return JSON.stringify({ ok: false, digestState: current, rejectedReceipts: receiptValidation.rejected || [], message: receiptValidation.message });
    }
    const hasCompletionSignal = receiptValidation.ok;
    let nextPatch = {};
    if (hasCompletionSignal) {
      const submitted = Array.isArray(current.submittedFiles) ? current.submittedFiles : [];
      const confirmed = receiptValidation.confirmed;
      const rejectedReceipts = receiptValidation.rejected;
      const completedAt = new Date().toISOString();
      const digestManifest = { ...(current.digestManifest || {}) };
      for (const file of confirmed) {
        digestManifest[file.relativePath] = { sha1: file.sha1, size: file.size, mtimeMs: file.mtimeMs, digestedAt: completedAt, batchId: current.digestBatchId || '' };
      }
      const remainingSubmitted = receiptValidation.remaining;
      const fullyCompleted = receiptValidation.fullyCompleted;
      nextPatch = {
        status: fullyCompleted ? 'completed' : 'partial',
        lastDigestAt: completedAt,
        message: fullyCompleted
          ? `已同步当前批次 ${confirmed.length} 份资料的精确消化结果。`
          : `已同步 ${confirmed.length} 份资料；另有 ${remainingSubmitted.length} 份未获得有效回执，继续待处理。`,
        digestedFiles: confirmed.map((file) => file.path),
        digestManifest,
        submittedFiles: [],
        digestBatchId: '',
        digestSubmittedAt: '',
        digestBatches: [...(current.digestBatches || []), {
          id: current.digestBatchId,
          submittedAt: current.digestSubmittedAt || '',
          completedAt,
          status: fullyCompleted ? 'completed' : 'partial',
          files: confirmed.map((file) => ({ relativePath: file.relativePath, sha1: file.sha1 })),
          rejectedReceipts,
          remainingFiles: remainingSubmitted.map((file) => ({ relativePath: file.relativePath, sha1: file.sha1 })),
        }].slice(-50),
      };
    } else if (current.status === 'submitted' || current.status === 'digesting') {
      nextPatch = {
        status: 'digesting',
        message: `${receiptValidation.message} 回执路径：${projectDigestReceiptPath(ensured)}`,
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
    const digestCompleted = state.status === 'completed';
    const result = updateProjectRecord(ensured.id, (item) => ({
      ...item,
      status: digestCompleted && item.status === 'active' ? 'pending_review' : item.status,
      stagingItems: (item.stagingItems || []).map((stagingItem) => digestCompleted && stagingItem.status === 'promoted'
        ? { ...stagingItem, status: 'analyzed', analyzedAt: state.lastDigestAt || new Date().toISOString(), updatedAt: new Date().toISOString() }
        : stagingItem),
      digestState: state,
      updatedAt: new Date().toISOString(),
    }));
    appendHostTimeline({ type: 'project_digest_synced', title: 'Project digest synced', detail: `${ensured.name} -> ${state.status}`, count: state.pendingCount || 0 });
    notify('onNativeDigestWorkflowChanged', JSON.stringify({ scopeType: 'project', scopeId: String(ensured.id), status: state.status, batchId: current.digestBatchId || '' }));
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
    const result = updateProjectRecord(project.id, (item) => projectWithNewInputs({
      ...item,
      stagingItems: [...(item.stagingItems || []), ...imported],
      updatedAt: now,
    }, 'staging_import', now));
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
      if (['promoted', 'analyzed'].includes(String(item.status)) || item.promotedAssetId) {
        skipped.push(item.id);
        return item;
      }
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
        writeTextIfMissing(sourceRecordPath, `# ${item.filename || path.basename(item.path)}\n\n- 保存策略：仅来源记录\n- 来源路径：${item.sourcePath || item.path}\n- 文件资产：${asset?.assetId || '待登记'}\n- SHA-1：${item.sha1 || ''}\n- 人工审核：${item.reviewNote || '已接受'}\n`);
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
    let result = updateProjectRecord(ensured.id, (item) => (promoted.length > 0
      ? projectWithNewInputs({
        ...item,
        stagingItems: nextItems,
        assetIds: mergeUnique([...(item.assetIds || []), ...promoted]),
        digestState: pendingDigestState,
        updatedAt: now,
      }, 'staging_promotion', now)
      : { ...item, stagingItems: nextItems, updatedAt: now }));
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

function approveAndPromoteProjectStagingItems(projectId, itemIdsJson, sourceStrategy, note) {
  try {
    const beforeProject = readProjects().map(normalizeProject).find((item) => String(item.id) === String(projectId));
    if (!beforeProject) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    const ensured = ensureProjectWorkspace(beforeProject);
    const projectsSnapshot = fs.existsSync(projectsPath()) ? fs.readFileSync(projectsPath()) : null;
    const assetsSnapshot = fs.existsSync(assetIndexPath()) ? fs.readFileSync(assetIndexPath()) : null;
    const digestSnapshot = fs.existsSync(projectDigestStatePath(ensured)) ? fs.readFileSync(projectDigestStatePath(ensured)) : null;
    const rawFilesBefore = new Set(collectProjectRawFiles(ensured.rawPath).map((file) => path.resolve(file.path).toLocaleLowerCase('zh-CN')));
    const reviewed = JSON.parse(reviewProjectStagingItems(projectId, itemIdsJson, 'accepted', sourceStrategy, note));
    if (!reviewed.ok) return JSON.stringify(reviewed);
    const promoted = JSON.parse(promoteProjectStagingItems(projectId, itemIdsJson));
    if (!promoted.ok) {
      if (projectsSnapshot) fs.writeFileSync(projectsPath(), projectsSnapshot);
      if (assetsSnapshot) fs.writeFileSync(assetIndexPath(), assetsSnapshot);
      else if (fs.existsSync(assetIndexPath())) fs.rmSync(assetIndexPath(), { force: true });
      if (digestSnapshot) fs.writeFileSync(projectDigestStatePath(ensured), digestSnapshot);
      else if (fs.existsSync(projectDigestStatePath(ensured))) fs.rmSync(projectDigestStatePath(ensured), { force: true });
      for (const file of collectProjectRawFiles(ensured.rawPath)) {
        if (!rawFilesBefore.has(path.resolve(file.path).toLocaleLowerCase('zh-CN'))) fs.rmSync(file.path, { force: true });
      }
      writeProjectStagingIndex(beforeProject);
      return JSON.stringify({ ...promoted, rolledBack: true, message: `${promoted.message || '资料晋升失败'} 已回滚本次审核、资产登记和新增来源记录。` });
    }
    return JSON.stringify({
      ...promoted,
      message: `已审核并将 ${promoted.promoted || 0} 份资料加入项目知识库；资产登记、原始资料库引用和待消化登记均已完成。`,
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `审核并加入项目知识库失败：${error.message}` });
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

function previewProjectStagingAiScreening(projectId, rawText) {
  try {
    const access = mutableProject(projectId, '预览 AI 初筛结果');
    if (access.error) return access.error;
    const project = readProjects().map(normalizeProject).find((item) => String(item.id) === String(projectId));
    if (!project) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    const preview = buildProjectScreeningPreview(ensureProjectWorkspace(project), rawText);
    return JSON.stringify({
      ...preview,
      message: preview.matchedCount > 0
        ? `已解析 ${preview.parsedCount} 项，匹配 ${preview.matchedCount} 项，未匹配 ${preview.unmatchedCount} 项。确认前不会修改项目数据。`
        : `已解析 ${preview.parsedCount} 项，但没有匹配当前项目的暂存资料。`,
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `预览 AI 初筛结果失败：${error.message}` });
  }
}

function applyProjectStagingAiScreening(projectId, rawText, options = {}) {
  try {
    const access = mutableProject(projectId, '应用 AI 初筛结果');
    if (access.error) return access.error;
    const project = readProjects().map(normalizeProject).find((item) => String(item.id) === String(projectId));
    if (!project) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    const ensured = ensureProjectWorkspace(project);
    const preview = buildProjectScreeningPreview(ensured, rawText);
    if (!preview.matchedCount) return JSON.stringify({ ...preview, ok: false, message: '评估结果没有匹配当前项目资料，未修改项目。' });
    const now = new Date().toISOString();
    const changes = new Map(preview.changes.map((change) => [String(change.stagingId), change]));
    const nextItems = (ensured.stagingItems || []).map((item) => {
      const change = changes.get(String(item.id));
      if (!change) return item;
      return {
        ...item,
        status: change.toStatus || item.status,
        sourceStrategy: change.toStrategy || item.sourceStrategy,
        aiAction: change.aiAction,
        aiReason: change.aiReason,
        aiScore: change.aiScore,
        aiReviewedAt: now,
        updatedAt: now,
      };
    });
    const result = updateProjectRecord(ensured.id, (item) => ({ ...item, stagingItems: nextItems, updatedAt: now }));
    const receiptDir = path.join(ensured.stagingPath, '.edu-manager', 'screening-receipts');
    fs.mkdirSync(receiptDir, { recursive: true });
    const receiptPath = path.join(receiptDir, `screening-${now.replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(receiptPath, JSON.stringify({
      kind: 'project_staging_screening_receipt',
      parserVersion: PROJECT_SCREENING_PARSER_VERSION,
      projectId: ensured.id,
      projectName: ensured.name,
      receivedAt: now,
      operator: String(options.operator || os.userInfo().username || 'local-user'),
      source: String(options.source || 'paste'),
      sourcePath: String(options.sourcePath || ''),
      rawText: String(rawText || ''),
      payload: preview.payload,
      preview: {
        parsedCount: preview.parsedCount,
        matchedCount: preview.matchedCount,
        unmatchedCount: preview.unmatchedCount,
        changes: preview.changes,
        unmatched: preview.unmatched,
      },
      appliedAt: now,
    }, null, 2), 'utf8');
    appendHostTimeline({ type: 'project_staging_ai_screening_applied', title: 'Project staging AI screening applied', detail: ensured.name, count: preview.matchedCount });
    return JSON.stringify({
      ...preview,
      ok: true,
      receiptPath,
      project: result.project,
      projects: result.projects,
      message: `已应用 ${preview.matchedCount}/${preview.parsedCount} 项 Agent 评估；原始回执和匹配依据已保存。`,
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `应用 AI 初筛结果失败：${error.message}` });
  }
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
    return applyProjectStagingAiScreening(projectId, raw, { source: 'file', sourcePath: files[0] });
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

function projectCompletionGate(project, stage = 'archive') {
  const ensured = ensureProjectWorkspace(normalizeProject(project));
  const digestState = readProjectDigestState(ensured);
  const unresolvedStaging = (ensured.stagingItems || []).filter((item) => !['promoted', 'analyzed', 'discarded'].includes(String(item.status)));
  const knowledgeReview = readProjectKnowledgeReview(ensured);
  const unresolvedKnowledge = knowledgeReview.records.filter((record) => ['ai_generated', 'pending_review'].includes(String(record.status)));
  const students = readStudentsIndex().filter((student) => ensured.studentIds.includes(String(student.id)));
  const { issues } = projectCompletionIssues({
    stage,
    projectStatus: ensured.status,
    students,
    studentEvidence: ensured.studentEvidence,
    digestState,
    stagingStatuses: (ensured.stagingItems || []).map((item) => item.status),
    knowledgeStatuses: knowledgeReview.records.map((record) => record.status),
  });
  return {
    ok: issues.length === 0,
    stage,
    project: ensured,
    digestState,
    unresolvedStaging,
    unresolvedKnowledge,
    students,
    issues,
  };
}

function getProjectCompletionWizard(projectId) {
  try {
    let project = readProjects().map(normalizeProject).find((item) => String(item.id) === String(projectId));
    if (!project) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    let ensured = ensureProjectWorkspace(project);
    const students = readStudentsIndex().filter((student) => ensured.studentIds.includes(String(student.id)));
    let knowledgeReview = readProjectKnowledgeReview(ensured);
    const draft = singleStudentEvidenceDraft({ project: ensured, students, knowledge: knowledgeReview.records, staging: ensured.stagingItems || [] });
    if (draft) {
      const updated = updateProjectRecord(ensured.id, (item) => ({ ...item, studentEvidence: [draft], updatedAt: new Date().toISOString() }));
      ensured = ensureProjectWorkspace(updated.project);
    }
    const contribution = JSON.parse(generateProjectPromotion(projectId));
    const plan = JSON.parse(projectPromotionPlan(projectId));
    const audit = JSON.parse(getProjectPromotionAudit(projectId));
    knowledgeReview = readProjectKnowledgeReview(ensured);
    const digestState = readProjectDigestState(ensured);
    const blockers = completionBlockers({ students, digestState, staging: ensured.stagingItems || [], knowledge: knowledgeReview.records, evidence: ensured.studentEvidence || [], conflicts: audit.conflicts || [] });
    return JSON.stringify({ ok: true, ready: !blockers.some((item) => item.blocking), project: ensured, projects: readProjects().map(normalizeProject), blockers, contribution, plan, audit, message: blockers.some((item) => item.blocking) ? `完成检查发现 ${blockers.filter((item) => item.blocking).length} 个待处理项。` : '完成检查已通过，可按系统建议提交归档任务。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `准备项目完成向导失败：${error.message}` });
  }
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
    const knowledgeReview = readProjectKnowledgeReview(ensured);
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
    ];
    for (const item of knowledgeKinds) {
      const verifiedCount = item.id === 'growth' ? 0 : knowledgeReview.records.filter((record) => record.kind === item.id && ['verified', 'published'].includes(String(record.status))).length;
      items.push({
        id: `knowledge-${item.id}`,
        kind: item.id === 'growth' ? 'growth' : 'knowledge',
        title: item.title,
        sourcePath: item.sourcePath,
        defaultAction: verifiedCount > 0 ? 'publish' : 'skip',
        action: verifiedCount > 0 ? 'publish' : 'skip',
        allowedActions: ['publish', 'skip'],
        targetHint: item.targetHint,
        content: `${item.title}：${verifiedCount} 条知识已确认；未确认内容不会发布。`,
      });
    }
    for (const evidence of ensured.studentEvidence || []) {
      const student = students.find((item) => String(item.id) === String(evidence.studentId));
      if (!student) continue;
      const publishable = ['verified', 'published'].includes(String(evidence.status));
      items.push({
        id: `student-growth-${student.id}`,
        kind: 'growth',
        studentId: String(student.id),
        title: `${student.name}：${evidence.ability || '待标注能力'}`,
        sourcePath: evidence.sourcePaths?.[0] || ensured.contributionPath,
        defaultAction: publishable ? 'publish' : 'skip',
        action: publishable ? 'publish' : 'skip',
        allowedActions: ['publish', 'skip'],
        targetHint: `${student.name} / 成长模型 / 成长证据`,
        content: `能力：${evidence.ability || '待补充'}\n观察：${evidence.observation || '待补充'}\n置信度：${evidence.confidence || '待审核'}\n状态：${evidence.status || 'draft'}`,
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
    const gate = projectCompletionGate(ensured, 'archive');
    if (!gate.ok) return JSON.stringify({ ok: false, gateIssues: gate.issues, message: `归档闸门未通过：${gate.issues.join('；')}。` });
    const knowledgeReview = readProjectKnowledgeReview(ensured);
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
          studentId: rawItem.studentId ? String(rawItem.studentId) : '',
        };
        if (item.studentId && item.studentId !== String(student.id)) continue;
        const sourceVersion = item.sourcePath && fs.existsSync(item.sourcePath) ? sha1File(item.sourcePath) : sha1Text(item.content);
        const actionKey = sha1Text([ensured.id, student.id, item.studentId, item.id, item.action, sourceVersion].join('|'));
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
    const gate = projectCompletionGate(ensured, 'publish');
    if (!gate.ok) return JSON.stringify({ ok: false, gateIssues: gate.issues, message: `发布闸门未通过：${gate.issues.join('；')}。` });
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
    let growthEvidencePublished = 0;
    for (const student of students) {
      const growth = ensureGrowthModelForStudent(student);
      const summaryPath = student.summaryPath || getSummaryDir(student.name);
      const projectSummaryFile = path.join(summaryPath, '项目贡献汇总.md');
      const projectDetailFile = path.join(summaryPath, '项目贡献明细.md');
      const studentEvidence = verifiedStudentEvidenceForPublication(ensured, student.id);
      const evidenceIsVerified = Boolean(studentEvidence);
      const projectLine = `| ${today} | ${ensured.name} | 项目共享知识贡献已发布 | 发布 | ${promotionPath} |`;
      appendTextSection(path.join(growth.dir, '项目贡献.md'), `${ensured.name} 发布记录 ${today}`, `${projectLine}\n\n来源项目知识空间：${ensured.knowledgeRootPath}`);
      if (evidenceIsVerified) {
        const sourcePaths = Array.isArray(studentEvidence.sourcePaths) && studentEvidence.sourcePaths.length
          ? studentEvidence.sourcePaths
          : [promotionPath];
        const sourceText = sourcePaths.join('；');
        const confidence = studentEvidence.confidence || '人工确认';
        const evidenceLine = `| ${today} | ${mdCell(studentEvidence.observation || studentEvidence.ability || ensured.name)} | ${mdCell(sourceText)} | ${mdCell(studentEvidence.ability || '待标注')} | ${mdCell(confidence)} |`;
        appendTextSection(path.join(growth.dir, '成长证据.md'), `${ensured.name} · ${studentEvidence.ability || '个人成长证据'} · ${today}`, evidenceLine);
        appendGrowthEvidenceCandidate(student, {
          id: `project-student-${ensured.id}-${student.id}`,
          projectId: ensured.id,
          projectName: ensured.name,
          title: `${ensured.name}·${studentEvidence.ability || '个人成长证据'}`,
          ability: studentEvidence.ability || '待标注',
          content: studentEvidence.observation || '待补充',
          sourcePath: sourceText,
          status: 'confirmed',
          confidence,
        });
        studentEvidence.status = 'published';
        studentEvidence.updatedAt = new Date().toISOString();
        growthEvidencePublished += 1;
      }
      writeTextIfMissing(projectSummaryFile, `# ${student.name} 项目贡献汇总\n\n记录已发布到学生主档案的学习项目知识贡献。\n\n| 日期 | 项目 | 贡献内容 | 动作 | 来源路径 |\n| --- | --- | --- | --- | --- |\n`);
      writeTextIfMissing(projectDetailFile, `# ${student.name} 项目贡献明细\n\n记录项目归档确认清单的逐项处理结果，便于回溯来源、目标和动作。\n\n| 日期 | 项目 | 类型 | 条目 | 动作 | 来源路径 | 目标 |\n| --- | --- | --- | --- | --- | --- | --- |\n`);
      fs.appendFileSync(projectSummaryFile, `${projectLine}\n`, 'utf8');
      fs.appendFileSync(projectDetailFile, `| ${today} | ${mdCell(ensured.name)} | promotion | 知识贡献申请已发布 | 发布 | ${mdCell(promotionPath)} | ${mdCell(growth.dir)} |\n`, 'utf8');
      published.push({ studentId: student.id, studentName: student.name, growthDir: growth.dir, projectSummaryFile, growthEvidencePublished: Boolean(evidenceIsVerified) });
    }
    const nextProjects = projects.map((item) => String(item.id) === String(ensured.id)
      ? { ...item, studentEvidence: ensured.studentEvidence, status: 'published', publishedAt: new Date().toISOString(), promotionPath, updatedAt: new Date().toISOString() }
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
      growthEvidencePublished,
      message: `已发布「${ensured.name}」共享知识贡献到 ${published.length} 个学生档案，并发布 ${growthEvidencePublished} 条已确认个人成长证据。`,
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
    if (operation === 'execute_archive_plan' || operation === 'publish_growth_evidence') {
      const gate = projectCompletionGate(project, operation === 'publish_growth_evidence' ? 'publish' : 'archive');
      if (!gate.ok) return JSON.stringify({ ok: false, gateIssues: gate.issues, message: `${operation === 'publish_growth_evidence' ? '发布' : '归档'}闸门未通过：${gate.issues.join('；')}。` });
    }
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
    title: '每周行动建议',
    fileName: '每日行动建议.md',
    type: 'weekly_action',
    target: '学生 / 家长 / 教师',
    summaryHeading: '每周重点',
    sections: ['每周重点', '每日固定动作', '阶段性里程碑', '给学生', '给家长', '给老师', '本周不建议做的事', '观察点', '依据来源'],
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
      content: `# ${student.name} 成长模型\n\n本目录是学生长期成长数据层，集中维护能力画像、项目贡献和成长证据。学情报告只引用这里的已确认结论进行表达，不反向替代成长模型。\n\n- 能力画像：能力画像.md\n- 项目贡献：项目贡献.md\n- 成长证据：成长证据.md\n- 成长证据草稿：成长证据草稿.md\n- 结构化索引：growth-index.json\n`,
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

function taskWeekRange(value = new Date()) {
  return weekRange(value);
}

function taskMonthRange(value = new Date()) {
  return monthRange(value);
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
  weekly_action: new Set(['read', 'create_draft']),
  learning_profile: new Set(['read', 'create_draft']),
  learning_changes: new Set(['read', 'create_draft']),
  learning_stage: new Set(['read', 'create_draft']),
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
    completionPolicy: String(task?.completionPolicy || current.completionPolicy || 'manual_review'),
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
  compactDigestTaskStore(store);
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

function upsertTaskCandidates(candidates, options = {}) {
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
    const newDigestCycle = ['student_digest', 'project_digest'].includes(String(candidate.kind || ''))
      && String(candidate.idempotencyKey || '') !== String(current.idempotencyKey || '')
      && !preserveExecution;
    const nextStatus = preserveExecution || preserveTerminal ? current.status : sourceStatus;
    const preserveRequestedOperation = taskRequiresApproval(current) && current.input?.operation && !TASK_TERMINAL_STATUSES.has(current.status);
    const merged = normalizeTaskEnvelope({
      ...candidate,
      status: nextStatus,
      input: preserveRequestedOperation ? current.input : candidate.input,
      expectedOutput: preserveRequestedOperation ? current.expectedOutput : candidate.expectedOutput,
      permissions: preserveRequestedOperation ? current.permissions : candidate.permissions,
      result: newDigestCycle ? null : current.result,
      approval: current.approval,
      attempt: newDigestCycle ? 0 : current.attempt,
      createdAt: current.createdAt,
      executionId: newDigestCycle ? '' : current.executionId,
      adapterId: newDigestCycle ? '' : current.adapterId,
      routeDecision: newDigestCycle ? null : current.routeDecision,
      routeAttempts: newDigestCycle ? [] : current.routeAttempts,
      error: newDigestCycle ? null : current.error,
    }, current);
    const comparableCurrent = { ...current, updatedAt: '' };
    const comparableMerged = { ...merged, updatedAt: '' };
    if (JSON.stringify(comparableCurrent) === JSON.stringify(comparableMerged)) continue;
    const index = store.tasks.findIndex((task) => task.id === current.id);
    store.tasks[index] = merged;
    byId.set(merged.id, merged);
    changed = true;
  }
  if (options.reconcileStudentDigests) {
    const activeStudentDigestIds = new Set(candidates.filter((task) => task.kind === 'student_digest').map((task) => String(task.id)));
    const before = store.tasks.length;
    store.tasks = store.tasks.filter((task) => !(
      task.kind === 'student_digest'
      && !activeStudentDigestIds.has(String(task.id))
      && ['queued', 'pending', 'approved'].includes(normalizeTaskStatus(task.status))
    ));
    if (store.tasks.length !== before) changed = true;
  }
  if (options.reconcileWeeklyActions) {
    const periodicKinds = new Set(['weekly_action', ...Object.keys(PERIODIC_REPORT_TASKS)]);
    const activeWeeklyIds = new Set(candidates.filter((task) => periodicKinds.has(task.kind)).map((task) => String(task.id)));
    const retired = store.tasks.filter((task) => task.kind === 'daily_action'
      || (periodicKinds.has(task.kind) && !activeWeeklyIds.has(String(task.id))));
    if (retired.length) {
      const retiredAt = taskNow();
      for (const task of retired) {
        store.history.unshift({
          id: `history-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
          taskId: task.id,
          executionId: task.executionId || '',
          kind: task.kind,
          title: task.title,
          sourceType: task.sourceType,
          sourceId: task.sourceId,
          sourceName: task.sourceName,
          executor: task.executor,
          status: 'archived',
          at: retiredAt,
          detail: task.kind === 'daily_action' ? '已迁移为每周行动建议；旧每日任务退出当前队列。' : '上一周期报告任务已退出当前队列。',
        });
      }
      const retiredIds = new Set(retired.map((task) => String(task.id)));
      store.tasks = store.tasks.filter((task) => !retiredIds.has(String(task.id)));
      changed = true;
    }
  }
  return changed ? writeTaskStore(store) : store;
}

function dailyActionDraftPath(student, taskId) {
  return path.join(studentAiManagerDir(student), 'task-center', 'daily-action-drafts', `${taskId}.md`);
}

const PERIODIC_REPORT_TASKS = {
  learning_profile: { reportId: 'profile', period: 'monthly', label: '整体画像', reason: '根据已确认能力画像、成长证据和项目贡献更新当前整体画像。' },
  learning_changes: { reportId: 'changes', period: 'weekly', label: '历史变化', reason: '汇总最近 7 天、30 天和本阶段的能力、习惯、问题与目标变化。' },
  learning_stage: { reportId: 'stage', period: 'monthly', label: '阶段总结', reason: '汇总本阶段核心进展、主要问题、关键证据和下一阶段目标。' },
};

function learningReportDraftPath(student, taskId) {
  return path.join(studentAiManagerDir(student), 'task-center', 'learning-report-drafts', `${taskId}.md`);
}

function latestGrowthModelMtime(student) {
  const dir = growthModelDirForStudent(student);
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir)
    .map((name) => path.join(dir, name))
    .filter((file) => fs.existsSync(file) && fs.statSync(file).isFile())
    .reduce((latest, file) => Math.max(latest, fs.statSync(file).mtimeMs), 0);
}

function buildPeriodicLearningReportTask(student, kind) {
  const normalized = toHostStudent(student);
  const definition = PERIODIC_REPORT_TASKS[kind];
  const report = LEARNING_REPORTS.find((item) => item.id === definition.reportId);
  const period = definition.period === 'weekly' ? taskWeekRange() : taskMonthRange();
  const officialPath = learningReportPathForStudent(normalized, report);
  const officialStat = fs.existsSync(officialPath) ? fs.statSync(officialPath) : null;
  const officialContent = officialStat ? readSmallTextFile(officialPath, 512 * 1024) : '';
  const reportStatus = frontmatterValue(officialContent, 'status').toLowerCase();
  const reportUpdated = frontmatterValue(officialContent, 'updated') || (officialStat ? taskLocalDate(officialStat.mtime) : '');
  const sourceChanged = latestGrowthModelMtime(normalized) > Number(officialStat?.mtimeMs || 0);
  const current = reportIsCurrent({
    exists: Boolean(officialStat),
    status: reportStatus,
    updated: reportUpdated,
    period,
    reportMtimeMs: Number(officialStat?.mtimeMs || 0),
    sourceMtimeMs: latestGrowthModelMtime(normalized),
  });
  const id = taskStableId(kind, 'student', normalized.id, period.key);
  return normalizeTaskEnvelope({
    id,
    title: `${normalized.name}${definition.label}`,
    kind,
    sourceType: 'student',
    sourceId: String(normalized.id),
    sourceName: normalized.name,
    status: current ? 'succeeded' : 'pending',
    trigger: sourceChanged ? 'event' : 'schedule',
    priority: kind === 'learning_changes' ? 'medium' : 'normal',
    riskLevel: 'low',
    executor: String(normalized.agentTool || 'qclaw'),
    requestedExecutor: String(normalized.agentTool || 'qclaw'),
    executionMode: 'adapter',
    scheduledAt: String(normalized.digestTime || '21:30'),
    scheduleKey: period.key,
    idempotencyKey: `${kind}:${normalized.id}:${period.key}`,
    input: {
      date: period.start,
      periodStart: period.start,
      periodEnd: period.end,
      studentId: String(normalized.id),
      studentName: normalized.name,
      knowledgeRoot: normalized.rootPath || getStudentRootDir(normalized.name),
      growthPath: growthModelDirForStudent(normalized),
      reportPath: officialPath,
    },
    expectedOutput: {
      type: 'markdown',
      draftPath: learningReportDraftPath(normalized, id),
      publishPath: officialPath,
      requiredSections: report.sections,
    },
    permissions: {
      read: [normalized.rootPath || getStudentRootDir(normalized.name), growthModelDirForStudent(normalized)],
      write: [learningReportDraftPath(normalized, id)],
      operations: ['read', 'create_draft'],
    },
    detail: current ? `本周期${definition.label}已发布。` : `${definition.reason}结果采用后更新正式学情报告。`,
    action: 'learning_report',
    approval: { required: false, status: 'not_required' },
    autoRetry: false,
    maxAttempts: 1,
  });
}

function dailyActionFeedbackPath(student) {
  return path.join(studentAiManagerDir(student), 'task-center', 'daily-action-feedback.json');
}

function readDailyActionFeedback(student) {
  const parsed = safeReadJson(dailyActionFeedbackPath(student), {});
  return Array.isArray(parsed.entries) ? parsed.entries : [];
}

function buildWeeklyActionTask(student) {
  const normalized = toHostStudent(student);
  const week = taskWeekRange();
  const report = LEARNING_REPORTS.find((item) => item.id === 'daily');
  const officialPath = learningReportPathForStudent(normalized, report);
  const stat = fs.existsSync(officialPath) ? fs.statSync(officialPath) : null;
  const officialContent = stat ? readSmallTextFile(officialPath, 512 * 1024) : '';
  const reportStatus = frontmatterValue(officialContent, 'status').toLowerCase();
  const reportUpdated = frontmatterValue(officialContent, 'updated');
  const reportUpdatedDate = reportUpdated || (stat ? taskLocalDate(stat.mtime) : '');
  const updatedThisWeek = Boolean(stat
    && reportUpdatedDate >= week.start
    && reportUpdatedDate <= week.end
    && reportStatus === 'published');
  const id = taskStableId('weekly_action', 'student', normalized.id, week.key);
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
    title: `${normalized.name}每周行动建议`,
    kind: 'weekly_action',
    sourceType: 'student',
    sourceId: String(normalized.id),
    sourceName: normalized.name,
    status: updatedThisWeek ? 'succeeded' : 'pending',
    trigger: 'schedule',
    priority: 'high',
    riskLevel: 'low',
    executor: String(normalized.agentTool || 'qclaw'),
    requestedExecutor: String(normalized.agentTool || 'qclaw'),
    executionMode: 'adapter',
    scheduledAt: String(normalized.digestTime || '21:30'),
    scheduleKey: week.key,
    idempotencyKey: `weekly_action:${normalized.id}:${week.key}`,
    autoRetry: false,
    maxAttempts: 1,
    input: {
      date: week.start,
      weekStart: week.start,
      weekEnd: week.end,
      studentId: String(normalized.id),
      studentName: normalized.name,
      knowledgeRoot: normalized.rootPath || getStudentRootDir(normalized.name),
      summaryPath: normalized.summaryPath || getSummaryDir(normalized.name),
      growthPath: growthModelDirForStudent(normalized),
      previousFeedback: selectPreviousDailyFeedback(readDailyActionFeedback(normalized), week.start, 3),
      projects: boundProjects,
      unfinishedTasks,
    },
    expectedOutput: { type: 'markdown', draftPath: dailyActionDraftPath(normalized, id), publishPath: officialPath, requiredSections: ['每周重点', '每日固定动作', '阶段性里程碑', '给学生', '给家长', '给老师', '本周不建议做的事', '观察点', '依据来源'] },
    permissions: { read: [normalized.rootPath || getStudentRootDir(normalized.name)], write: [dailyActionDraftPath(normalized, id)], operations: ['read', 'create_draft'] },
    detail: updatedThisWeek ? `本周行动建议已发布（${week.start} 至 ${week.end}）。` : `根据最新学情、项目状态和上周反馈生成本周建议（${week.start} 至 ${week.end}），完成后进入人工审核。`,
    action: 'weekly_action',
    approval: { required: false, status: 'not_required' },
  });
}

function taskCommandFor(task) {
  if (task.kind === 'project_digest') {
    const parsed = JSON.parse(getProjectDigestCommand(task.sourceId));
    return parsed.ok ? parsed.command : '';
  }
  const student = task.sourceType === 'student' ? readStudentsIndex().find((item) => String(item.id) === String(task.sourceId)) : null;
  if (task.kind === 'weekly_action' && student) {
    const normalized = toHostStudent(student);
    const expectedDate = String(task.input?.date || taskToday());
    const weekStart = String(task.input?.weekStart || expectedDate);
    const weekEnd = String(task.input?.weekEnd || expectedDate);
    const feedback = Array.isArray(task.input?.previousFeedback)
      ? task.input.previousFeedback
      : selectPreviousDailyFeedback(readDailyActionFeedback(normalized), expectedDate, 3);
    return `请为学生「${normalized.name}」生成 ${weekStart} 至 ${weekEnd} 的每周行动建议。\n\n读取范围：\n- 学生知识库：${normalized.rootPath || getStudentRootDir(normalized.name)}\n- 学情分析汇总：${normalized.summaryPath || getSummaryDir(normalized.name)}\n- 成长模型：${growthModelDirForStudent(normalized)}\n\n绑定项目状态：\n${task.input?.projects?.length ? JSON.stringify(task.input.projects, null, 2) : '暂无绑定项目。'}\n\n未完成任务：\n${task.input?.unfinishedTasks?.length ? JSON.stringify(task.input.unfinishedTasks, null, 2) : '暂无未完成任务。'}\n\n上周及更早反馈：\n${feedback.length ? JSON.stringify(feedback, null, 2) : '暂无反馈。'}\n\n必须包含：每周重点、每日固定动作、阶段性里程碑、给学生、给家长、给老师、本周不建议做的事、观察点、依据来源。每日固定动作应按可重复执行的最小动作编写；阶段性里程碑应给出本周检查节点和完成标准；每个章节必须有实质内容，并标注依据；不确定内容标注“待观察”。\n\n只把草稿写入：${task.expectedOutput?.draftPath}\n不要直接覆盖正式报告。文件必须以如下 YAML frontmatter 开头：\n---\ndate: ${expectedDate}\nweek_start: ${weekStart}\nweek_end: ${weekEnd}\ngenerated_at: 当前 ISO 时间\nstatus: pending_review\n---\n\n完成后确认文件存在。`;
  }
  if (PERIODIC_REPORT_TASKS[task.kind] && student) {
    const normalized = toHostStudent(student);
    const definition = PERIODIC_REPORT_TASKS[task.kind];
    const report = LEARNING_REPORTS.find((item) => item.id === definition.reportId);
    return `请为学生「${normalized.name}」生成“${definition.label}”报告草稿。\n\n读取范围：\n- 学生知识库：${normalized.rootPath || getStudentRootDir(normalized.name)}\n- 成长模型：${growthModelDirForStudent(normalized)}\n- 已确认能力画像、成长证据和项目贡献\n\n报告周期：${task.input?.periodStart || '-'} 至 ${task.input?.periodEnd || '-'}\n要求：\n1. 只引用已确认的成长模型数据，不把学情报告反向作为事实来源。\n2. 必须包含以下章节：${(report?.sections || []).join('、')}。\n3. 每项结论写明依据来源；不确定内容标记“待观察”。\n4. 没有实质变化时明确写“本周期无实质变化”，不要虚构更新。\n5. 只写草稿：${task.expectedOutput?.draftPath}\n6. 不要直接覆盖正式报告：${task.expectedOutput?.publishPath}\n\n文件顶部使用 YAML frontmatter，至少包含 updated: ${taskToday()} 和 status: pending_review。`;
  }
  if (task.kind === 'student_digest' && student) {
    const normalized = toHostStudent(student);
    const batch = readDigestBatch(studentDigestBatchPath(normalized));
    if (!batch || batch.batchId !== String(task.input?.digestBatchId || batch.batchId)) return '当前学生消化批次无效，请返回控制台重新开始处理。';
    return `/消化\n\n请按照 ${normalized.agentPath || path.join(normalized.rootPath || getStudentRootDir(normalized.name), 'AGENT.md')} 的规则，只处理本批清单中的资料。\n\n批次文件：${studentDigestBatchPath(normalized)}\n学生 ID：${normalized.id}\n消化批次：${batch.batchId}\n原始资料目录：${normalized.rawPath || getRawDir(normalized.name)}\n知识库根目录：${normalized.rootPath || getStudentRootDir(normalized.name)}\n回执文件：${studentDigestReceiptPath(normalized)}\n\n处理要求：\n1. 读取批次文件 files，只处理其中列出的 materialId、relativePath 和 sha1，不扩大到其他资料。\n2. 更新现有 LLM Wiki 的摘要、概念、实体、问答、综合汇总、index.md 和 log.md。\n3. 不移动、删除或覆盖原始资料。\n4. 新的能力判断、项目贡献和成长证据不得直接发布；不得自动改写正式学情报告或教育档案。\n5. 文件无法读取时不要声称完成，把它列入 failed。\n6. 完成后必须把以下结构写入回执文件；processed 中逐项原样返回 materialId、relativePath、sha1，并列出实际更新的知识产物。\n\n{\n  "schema": "edu-manager.digest-result.v1",\n  "studentId": "${normalized.id}",\n  "digestBatchId": "${batch.batchId}",\n  "status": "completed 或 partial",\n  "processed": [\n    {\n      "materialId": "批次中的 materialId",\n      "relativePath": "批次中的 relativePath",\n      "sha1": "批次中的 sha1",\n      "status": "completed",\n      "artifacts": ["实际更新的知识文件绝对路径"]\n    }\n  ],\n  "failed": []\n}\n\n只有真正读完且完成知识写入的资料才能进入 processed。写完回执后，再按任务包要求返回 TaskResult。`;
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
    if (task.kind === 'weekly_action' && adapter.id === 'openclaw') score += 15;
    if (task.kind === 'project_digest' && ['openclaw', 'codex'].includes(adapter.id)) score += 10;
    if (task.riskLevel === 'high' && adapter.id === 'manual') score += 20;
    if (adapter.id === 'manual' && task.riskLevel !== 'high') score -= 30;
    if (routingMode === 'rule') {
      if (task.kind === 'weekly_action' && adapter.id === 'openclaw') score += 40;
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
  const requestedCandidate = requested ? candidates.find((candidate) => candidate.adapterId === requested) : null;
  const selected = routingMode === 'fixed'
    ? (requestedCandidate?.available ? requestedCandidate : candidates.find((candidate) => candidate.adapterId === 'manual'))
    : (candidates.find((candidate) => candidate.available) || candidates.find((candidate) => candidate.adapterId === 'manual'));
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
  if (task.kind === 'weekly_action' || PERIODIC_REPORT_TASKS[task.kind]) {
    const draft = artifacts.find((item) => item.path === task.expectedOutput?.draftPath);
    valid = Boolean(draft?.exists && draft.size > 0 && (!startedAt || Date.parse(draft.modifiedAt) >= Date.parse(startedAt) - 1000));
    if (valid) {
      const content = fs.readFileSync(draft.path, 'utf8');
      if (task.kind === 'weekly_action') {
        const schema = validateDailyActionDocument(content, {
          expectedDate: String(task.input?.date || ''),
          requiredSections: task.expectedOutput?.requiredSections || [],
        });
        schemaErrors.push(...schema.errors);
      } else {
        schemaErrors.push(...validateSectionedDraft(content, task.expectedOutput?.requiredSections || []).errors);
      }
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

function commitValidatedTaskResult(store, task, result, validation, options = {}) {
  const successful = Boolean(options.successful && validation?.valid);
  if (!successful) {
    const failedResult = { ...result, status: 'failed' };
    return transitionTaskInStore(store, task.id, 'failed', {
      result: failedResult,
      error: options.error || { code: 'RESULT_INVALID', message: failedResult.summary || validation?.message || '结果校验未通过。' },
      lastHeartbeatAt: taskNow(),
    }, options.event || 'task_result_failed');
  }
  const reviewingResult = { ...result, status: 'reviewing' };
  const reviewing = transitionTaskInStore(store, task.id, 'reviewing', { result: reviewingResult, error: null, lastHeartbeatAt: taskNow() }, options.event || 'task_result_validated');
  if (!reviewing.ok || !shouldAutoAccept(task, validation)) return reviewing;
  const acceptedAt = taskNow();
  return transitionTaskInStore(store, task.id, 'succeeded', {
    result: { ...reviewingResult, status: 'succeeded', autoAcceptedAt: acceptedAt, summary: options.autoSummary || reviewingResult.summary || '资料处理完成。' },
    approval: { ...(task.approval || {}), required: false, status: 'not_required', reviewedAt: acceptedAt, reviewedBy: 'system_validation' },
    completedAt: acceptedAt,
  }, 'digest_result_auto_accepted');
}

function estimatedAdapterCost(adapterId, durationMs = 0) {
  const base = { internal: 0, manual: 0, qclaw: 0.1, openclaw: 0.2, codex: 0.4 }[String(adapterId || '')] ?? 0.2;
  return Number((base + Math.max(0, durationMs) / 3600000 * base).toFixed(4));
}

function materializeDigestReceiptFromTaskPayload(task, payload) {
  if (!isDigestTask(task) || !payload || typeof payload !== 'object') return { ok: false, skipped: true };
  const candidates = [payload.digestResult, payload.structuredOutput, payload.data, payload];
  const receipt = candidates.find((item) => item && typeof item === 'object' && !Array.isArray(item)
    && (item.digestBatchId || item.batchId)
    && (Array.isArray(item.processed) || Array.isArray(item.digestedFiles) || Array.isArray(item.items)));
  if (!receipt) return { ok: false, skipped: true };
  if (task.kind === 'student_digest') {
    const student = readStudentsIndex().map(toHostStudent).find((item) => String(item.id) === String(task.sourceId));
    const batch = student ? readDigestBatch(studentDigestBatchPath(student)) : null;
    if (!student || !batch || String(receipt.digestBatchId || receipt.batchId || '') !== String(batch.batchId)) return { ok: false, skipped: true, message: '粘贴结果不属于当前学生消化批次。' };
    writeJsonAtomic(studentDigestReceiptPath(student), { ...receipt, schema: receipt.schema || 'edu-manager.digest-result.v1', studentId: String(student.id), digestBatchId: batch.batchId });
    return { ok: true, path: studentDigestReceiptPath(student) };
  }
  const project = readProjects().map(normalizeProject).find((item) => String(item.id) === String(task.sourceId));
  const request = project ? safeReadJson(projectDigestRequestPath(project), {}) : {};
  if (!project || String(receipt.digestBatchId || receipt.batchId || '') !== String(request.digestBatchId || '')) return { ok: false, skipped: true, message: '粘贴结果不属于当前项目消化批次。' };
  const digestedFiles = Array.isArray(receipt.digestedFiles) ? receipt.digestedFiles : Array.isArray(receipt.processed) ? receipt.processed : receipt.items;
  writeJsonAtomic(projectDigestReceiptPath(project), { ...receipt, status: receipt.status === 'partial' ? 'completed' : receipt.status, projectId: String(project.id), digestBatchId: request.digestBatchId, digestedFiles });
  return { ok: true, path: projectDigestReceiptPath(project) };
}

function validateTaskCompletion(task, startedAt = '', resultPayload = null) {
  materializeDigestReceiptFromTaskPayload(task, resultPayload);
  if (task.kind === 'project_digest') {
    let domainSync;
    try { domainSync = JSON.parse(syncProjectDigestResult(task.sourceId)); }
    catch { domainSync = { ok: false, message: '项目消化结果同步失败。' }; }
    const status = String(domainSync?.digestState?.status || '');
    return { valid: Boolean(domainSync?.ok && ['completed', 'partial', 'idle'].includes(status)), artifacts: [], checkedAt: taskNow(), message: domainSync?.message || '项目消化结果同步完成。', domainSync };
  }
  if (task.kind === 'student_digest') {
    let domainSync;
    try { domainSync = JSON.parse(syncStudentDigestResult(task.sourceId, { forceSubmitted: true })); }
    catch { domainSync = { ok: false, message: '学生消化结果同步失败。' }; }
    const status = String(domainSync?.state?.status || '');
    return { valid: Boolean(domainSync?.ok && ['completed', 'partial', 'idle'].includes(status)), artifacts: [], checkedAt: taskNow(), message: domainSync?.message || domainSync?.state?.message || '学生消化结果同步完成。', domainSync };
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
    summary: Number(code) === 0 ? (validation.valid ? (shouldAutoAccept(task, validation) ? '资料处理完成并已通过自动校验。' : 'Agent 执行完成，等待审核。') : validation.message) : `Agent 退出码 ${code}。`,
    output: String(output || '').slice(-20000),
    errorOutput: String(errorOutput || '').slice(-10000),
    structuredOutput: validation.domainSync || null,
    artifacts: validation.artifacts,
    logReference: task.result?.logPath || '',
    failureReason: successful ? null : { category: Number(code) === 0 ? 'validation' : code === -1 ? 'launch' : 'process', code: `EXIT_${code}`, detail: String(errorOutput || validation.message || '').slice(-2000) },
  }, validation, { estimatedCost: estimatedAdapterCost(adapterId, task.startedAt ? Date.now() - Date.parse(task.startedAt) : 0) });
  const retryDelayMs = Math.max(0, Number(task.retryBackoffSeconds || 0)) * 1000;
  const mayAutoRetry = !successful && task.autoRetry !== false && Number(task.attempt || 0) < Number(task.maxAttempts || 1);
  const nextRetryAt = mayAutoRetry ? new Date(Date.now() + retryDelayMs).toISOString() : '';
  const committed = commitValidatedTaskResult(store, task, result, validation, {
    successful,
    error: successful ? null : { code: `EXIT_${code}`, message: result.summary },
    event: 'adapter_completed',
    autoSummary: '资料处理完成并已通过自动校验。',
  });
  const nextStatus = committed.task?.status || (successful ? 'reviewing' : 'failed');
  if (!successful) {
    const failedTask = store.tasks.find((item) => item.id === taskId);
    if (failedTask) failedTask.nextRetryAt = nextRetryAt;
  }
  writeTaskStore(store);
  notify('onNativeTaskCenterChanged', JSON.stringify({ taskId, status: nextStatus }));
  if (isDigestTask(task)) notify('onNativeDigestWorkflowChanged', JSON.stringify({ scopeType: task.sourceType, scopeId: task.sourceId, status: nextStatus, taskId }));
  if (mayAutoRetry) setTimeout(() => fallbackTaskAfterFailure(taskId, adapterId, result.summary), Math.min(retryDelayMs, 30000) + 100);
}

function fallbackTaskAfterFailure(taskId, failedAdapter, reason = '') {
  try {
    const store = readTaskStore();
    const task = store.tasks.find((item) => item.id === String(taskId));
    if (!task || !['failed', 'timed_out', 'blocked'].includes(task.status)) return { ok: false, skipped: true };
    if (task.autoRetry === false || Number(task.attempt || 0) >= Number(task.maxAttempts || 1)) {
      task.nextRetryAt = '';
      task.autoRetry = false;
      task.updatedAt = taskNow();
      writeTaskStore(store);
      appendTaskEvent(task.id, 'automatic_retry_stopped', { attempt: task.attempt, maxAttempts: task.maxAttempts, reason: reason || task.error?.message || '' }, task.executionId);
      return { ok: false, skipped: true, exhausted: true, message: `自动重试已停止（${task.attempt}/${task.maxAttempts}）。` };
    }
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
  if (app.isPackaged) return path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'invoke-agent.ps1');
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

function attachDigestBatchToTask(taskId, batch, manifestPath, receiptPath) {
  const store = readTaskStore();
  const index = store.tasks.findIndex((item) => String(item.id) === String(taskId));
  if (index < 0) return null;
  const current = store.tasks[index];
  store.tasks[index] = normalizeTaskEnvelope({
    ...current,
    idempotencyKey: batch.idempotencyKey || current.idempotencyKey,
    completionPolicy: 'auto_after_validation',
    input: { ...(current.input || {}), digestBatchId: batch.batchId, manifestPath },
    expectedOutput: { ...(current.expectedOutput || {}), path: receiptPath, type: 'digest_receipt_v1' },
  }, current);
  writeTaskStore(store);
  return store.tasks[index];
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
    let refreshed = readTaskStore().tasks.find((item) => item.id === task.id);
    if (refreshed.kind === 'student_digest') {
      const student = readStudentsIndex().map(toHostStudent).find((item) => String(item.id) === refreshed.sourceId);
      if (!student) return JSON.stringify({ ok: false, message: '未找到学生档案。' });
      const currentState = readStudentDigestState(student);
      let batch = readDigestBatch(studentDigestBatchPath(student));
      if (!batch || String(batch.batchId || '') !== String(currentState.digestBatchId || '') || !['submitted', 'digesting'].includes(normalizeDigestStateStatus(currentState.status))) {
        const registered = registerStudentDigestBatch(student.id, { includeSubmitted: true });
        if (!registered.ok) return JSON.stringify(registered);
        batch = registered.batch;
      }
      refreshed = attachDigestBatchToTask(refreshed.id, batch, studentDigestBatchPath(student), studentDigestReceiptPath(student)) || refreshed;
    }
    if (refreshed.kind === 'project_digest') {
      const project = readProjects().map(normalizeProject).find((item) => String(item.id) === refreshed.sourceId);
      if (project) {
        const ensured = ensureProjectWorkspace(project);
        const currentDigest = readProjectDigestState(ensured);
        if (currentDigest.pendingCount > 0 && !['submitted', 'digesting'].includes(currentDigest.status)) {
          const registered = registerProjectDigestBatch(ensured, { prefix: 'task-digest', message: '项目资料已进入自动处理，等待逐文件回执。' });
          if (!registered.ok) return JSON.stringify(registered);
          updateProjectRecord(project.id, (item) => ({ ...item, digestState: registered.digestState, updatedAt: taskNow() }));
          refreshed = attachDigestBatchToTask(refreshed.id, registered.request, projectDigestRequestPath(ensured), projectDigestReceiptPath(ensured)) || refreshed;
        } else {
          const request = safeReadJson(projectDigestRequestPath(ensured), null);
          if (request?.digestBatchId === currentDigest.digestBatchId) refreshed = attachDigestBatchToTask(refreshed.id, request, projectDigestRequestPath(ensured), projectDigestReceiptPath(ensured)) || refreshed;
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
      if (task.kind === 'weekly_action' || PERIODIC_REPORT_TASKS[task.kind]) {
        const approvalValidation = validateTaskCompletion(task, task.startedAt, task.result);
        if (!approvalValidation.valid) return JSON.stringify({ ok: false, message: `报告草稿校验失败，不能采用：${approvalValidation.message}` });
        const draftPath = task.expectedOutput?.draftPath;
        const publishPath = task.expectedOutput?.publishPath;
        if (!draftPath || !publishPath || !fs.existsSync(draftPath)) return JSON.stringify({ ok: false, message: '报告草稿不存在，不能采用。' });
        const today = String(task.input?.date || taskToday());
        const publishResult = publishReviewedReport({ draftPath, publishPath, updated: today, type: task.kind });
        if (!publishResult.ok) return JSON.stringify(publishResult);
      }
      const accepted = transitionTaskInStore(store, task.id, 'succeeded', { approval: { required: true, status: 'approved', note, reviewedAt: taskNow(), reviewedBy: 'local-user' }, result: { ...(task.result || {}), publishedAt: taskNow(), reviewNote: note } }, 'result_approved');
      writeTaskStore(store);
      return JSON.stringify({ ...accepted, message: task.action === 'learning_report' || task.kind === 'weekly_action' ? '报告已采用并发布。' : '任务结果已确认。' });
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
    const transition = transitionTaskInStore(store, task.id, 'pending', { error: null, result: null, executionId: '', adapterId: '', routeAttempts: [], nextRetryAt: '', completedAt: '', attempt: 0, autoRetry: false }, 'task_retried');
    writeTaskStore(store);
    return JSON.stringify({ ...transition, message: '任务已重置为待处理；本次只在用户点击后执行，不会后台连环重试。' });
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

function acceptImportedTaskResult(taskId, payload, source = {}) {
  const store = readTaskStore();
  const task = store.tasks.find((item) => item.id === String(taskId));
  const identity = validateExternalTaskResultIdentity(task, payload);
  if (!identity.ok) {
    appendTaskEvent(taskId, 'external_result_rejected', { source: source.kind || 'manual_import', file: source.path || '', code: identity.code, message: identity.message }, task?.executionId || '');
    return { ok: false, rejected: true, code: identity.code, message: identity.message };
  }
  const validation = validateTaskCompletion(task, task.startedAt, payload);
  const successful = payload.status !== 'failed' && validation.valid;
  const importedFrom = source.path || source.kind || 'manual_import';
  const result = normalizeTaskResult(task, { ...payload, importedFrom, status: successful ? 'reviewing' : 'failed' }, validation, { importedFrom });
  const transition = commitValidatedTaskResult(store, task, result, validation, {
    successful,
    error: successful ? null : { code: 'RESULT_INVALID', message: payload.message || validation.message },
    event: source.event || 'task_result_imported',
    autoSummary: '资料处理结果已导入并通过自动校验。',
  });
  writeTaskStore(store);
  const nextStatus = transition.task?.status || (successful ? 'reviewing' : 'failed');
  if (isDigestTask(task)) notify('onNativeDigestWorkflowChanged', JSON.stringify({ scopeType: task.sourceType, scopeId: task.sourceId, status: nextStatus, taskId: task.id }));
  return { ...transition, message: nextStatus === 'succeeded' ? '资料结果已导入并自动完成。' : nextStatus === 'reviewing' ? '结果已导入，等待审核。' : '结果已导入，但校验未通过。' };
}

function importTaskResult(taskId) {
  try {
    const selected = dialog.showOpenDialogSync(mainWindow, { title: '导入 Agent 任务结果', properties: ['openFile'], filters: [{ name: 'TaskResult JSON', extensions: ['json'] }] });
    if (!selected?.[0]) return JSON.stringify({ ok: false, message: '未选择结果文件。' });
    const payload = safeReadJson(selected[0], null);
    return JSON.stringify(acceptImportedTaskResult(taskId, payload, { kind: 'manual_file', path: selected[0], event: 'task_result_file_imported' }));
  } catch (error) {
    return JSON.stringify({ ok: false, message: `导入任务结果失败：${error.message}` });
  }
}

function importTaskResultText(taskId, content) {
  try {
    const text = String(content || '').trim();
    if (!text) return JSON.stringify({ ok: false, message: '请先粘贴 Agent 返回的执行结果。' });
    if (Buffer.byteLength(text, 'utf8') > 1024 * 1024) return JSON.stringify({ ok: false, message: '粘贴结果超过 1 MB，请改用文件导入。' });
    const store = readTaskStore();
    const task = store.tasks.find((item) => item.id === String(taskId));
    if (!task) return JSON.stringify({ ok: false, message: '未找到任务。' });
    if (!['running', 'waiting_result'].includes(task.status) || !task.executionId) return JSON.stringify({ ok: false, message: '当前任务没有可接收结果的有效执行批次。' });

    let parsed = null;
    try {
      parsed = parseJsonText(text);
    } catch {
      parsed = null;
    }
    const hasProtocolIdentity = parsed && typeof parsed === 'object' && ['protocolVersion', 'taskId', 'executionId'].some((key) => Object.prototype.hasOwnProperty.call(parsed, key));
    const payload = hasProtocolIdentity
      ? parsed
      : {
          protocolVersion: TASK_PROTOCOL_VERSION,
          taskId: task.id,
          executionId: task.executionId,
          status: 'completed',
          message: '用户粘贴 Agent 执行结果。',
          output: text,
          data: parsed && typeof parsed === 'object' ? parsed : undefined,
        };
    return JSON.stringify(acceptImportedTaskResult(task.id, payload, { kind: 'manual_paste', event: 'task_result_text_imported' }));
  } catch (error) {
    return JSON.stringify({ ok: false, message: `导入粘贴结果失败：${error.message}` });
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
      const successful = payload.status !== 'failed' && validation.valid;
      const result = normalizeTaskResult(task, { ...payload, resultFile: file, status: successful ? 'reviewing' : 'failed' }, validation, { importedFrom: file });
      result.resultFile = file;
      const transition = commitValidatedTaskResult(store, task, result, validation, {
        successful,
        error: successful ? null : { code: 'QCLAW_RESULT_INVALID', message: payload.message || validation.message },
        event: 'qclaw_result_synced',
        autoSummary: '资料处理完成并已通过自动校验。',
      });
      if (transition.ok) imported += 1;
      if (transition.ok && isDigestTask(task)) notify('onNativeDigestWorkflowChanged', JSON.stringify({ scopeType: task.sourceType, scopeId: task.sourceId, status: transition.task?.status || '', taskId: task.id }));
    }
    if (imported || claimed || rejected) writeTaskStore(store);
    return JSON.stringify({ ok: true, claimed, imported, rejected, inboxPath: qclawTaskInboxPath(), resultPath: qclawTaskResultPath(), message: imported || claimed || rejected ? `QClaw 同步完成：领取 ${claimed} 项，结果 ${imported} 项，拒绝过期或无效包 ${rejected} 项。` : '没有新的 QClaw 任务领取或结果。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `同步 QClaw 结果失败：${error.message}` });
  }
}

function submitDailyActionFeedback(taskId, status, note = '') {
  try {
    const store = readTaskStore();
    const task = store.tasks.find((item) => item.id === String(taskId));
    if (!task || task.kind !== 'weekly_action') return JSON.stringify({ ok: false, message: '未找到每周行动建议任务。' });
    if (task.status !== 'succeeded') return JSON.stringify({ ok: false, message: '每周行动建议尚未审核发布，不能提交完成反馈。' });
    const normalizedStatus = String(status || 'completed');
    if (!['completed', 'partial', 'skipped'].includes(normalizedStatus)) return JSON.stringify({ ok: false, message: '反馈状态只能是 completed、partial 或 skipped。' });
    const student = readStudentsIndex().find((item) => String(item.id) === task.sourceId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const normalized = toHostStudent(student);
    const feedbackDate = String(task.input?.date || taskToday());
    const entries = readDailyActionFeedback(normalized).filter((entry) => !(String(entry.taskId || '') === task.id && String(entry.date || '') === feedbackDate));
    const feedback = { taskId: task.id, date: feedbackDate, status: normalizedStatus, note: String(note || ''), submittedAt: taskNow() };
    entries.unshift(feedback);
    writeJsonFile(dailyActionFeedbackPath(normalized), { version: 1, updatedAt: taskNow(), entries: entries.slice(0, 90) });
    const transition = transitionTaskInStore(store, task.id, task.status, {
      result: {
        ...(task.result || {}),
        summary: task.result?.summary || '每周行动建议已发布。',
        feedback,
      },
      message: '完成反馈已保存，将作为下一次每周行动建议的输入。',
    }, 'weekly_action_feedback');
    if (transition.ok) writeTaskStore(store);
    return JSON.stringify({ ok: true, task: transition.task || task, feedback, message: '完成反馈已保存，将作为下一次每周行动建议的输入。' });
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

function openTaskResultPath(taskId) {
  try {
    const task = readTaskStore().tasks.find((item) => String(item.id) === String(taskId));
    if (!task) return JSON.stringify({ ok: false, message: '未找到任务。' });
    const result = task.result && typeof task.result === 'object' ? task.result : {};
    const artifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
    const fileChanges = Array.isArray(result.fileChanges) ? result.fileChanges : [];
    const candidates = [
      result.resultFile,
      result.importedFrom,
      result.logReference,
      result.packet?.packetPath,
      result.packet?.promptPath,
      ...artifacts.map((item) => item?.path),
      ...fileChanges.map((item) => item?.path),
      task.expectedOutput?.publishPath,
      task.expectedOutput?.draftPath,
      task.expectedOutput?.path,
    ].map((item) => canonicalTaskPath(item)).filter(Boolean);
    const allowedRoots = [
      taskCenterDirPath(),
      ...(task.permissions?.read || []),
      ...(task.permissions?.write || []),
      task.input?.knowledgeRoot,
      task.input?.rawPath,
      ...[task.expectedOutput?.publishPath, task.expectedOutput?.draftPath, task.expectedOutput?.path].filter(Boolean).map((item) => path.dirname(String(item))),
    ].map((item) => canonicalTaskPath(item)).filter(Boolean);
    const target = [...new Set(candidates)].find((item) => fs.existsSync(item) && taskPathAllowed(item, allowedRoots));
    if (!target) {
      return JSON.stringify({ ok: false, message: result.summary || result.message
        ? '当前任务已有反馈摘要，但没有可打开的结果文件；请在任务详情中查看反馈。'
        : '当前任务尚未生成可打开的反馈结果。' });
    }
    shell.openPath(target).catch(() => {});
    return JSON.stringify({ ok: true, path: target, message: `已打开任务结果：${target}` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `打开任务结果失败：${error.message}` });
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
    void runProjectAutomationSweep();
    syncQClawTaskResults();
    await syncOpenClawCronTasks();
    if (!taskAutomationEnabled()) return { ok: true, skipped: true, message: '调度过程中已切换为仅手动模式，未启动新任务。' };
    const store = upsertTaskCandidates(buildTaskCenterCandidates(), { reconcileStudentDigests: true, reconcileWeeklyActions: true });
    if (enforceTaskTimeouts(store)) writeTaskStore(store);
    const retryDue = readTaskStore().tasks.filter((task) => ['failed', 'timed_out', 'blocked'].includes(task.status)
      && task.autoRetry !== false
      && task.nextRetryAt
      && Date.parse(task.nextRetryAt) <= Date.now());
    for (const task of retryDue) fallbackTaskAfterFailure(task.id, task.adapterId, task.error?.message || '计划重试');
    const scheduledReportKinds = new Set(['weekly_action', ...Object.keys(PERIODIC_REPORT_TASKS), 'openclaw_cron']);
    const due = readTaskStore().tasks.filter((task) => scheduledReportKinds.has(task.kind)
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
    if (taskKind === 'digest') {
      const pendingCount = readStudentMaterials(normalized).filter((item) => normalizeUploadStatus(item.status) === 'pending_digest').length;
      if (pendingCount === 0) return JSON.stringify({ ok: false, skipped: true, reason: 'no_pending_materials', message: '当前没有待提交资料，未创建消化任务记录。' });
    }
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
    const materials = readStudentMaterials(student);
    const digestState = readStudentDigestState(student);
    const pendingCount = materials.filter((item) => normalizeUploadStatus(item.status) === 'pending_digest').length;
    const submittedCount = materials.filter((item) => ['submitted', 'digesting'].includes(normalizeUploadStatus(item.status))).length;
    const digestStatus = String(digestState.status || student.digestStatus || '').toLowerCase();
    const openDigestMaterials = materials.filter((item) => isOpenDigestStatus(item.status));
    const studentDigestKey = digestState.digestBatchId
      ? `student_digest:${student.id}:${digestState.digestBatchId}`
      : openDigestMaterials.length
        ? digestIdempotencyKey({ type: 'student', id: String(student.id) }, openDigestMaterials.map((item) => ({ materialId: item.id, relativePath: item.path || item.fileName, sha1: item.sha1 || '', size: item.size || 0 })))
        : `student_digest:${student.id}:idle`;
    if (pendingCount > 0 || submittedCount > 0 || ['digesting', 'submitted'].includes(digestStatus)) {
      tasks.push(normalizeTaskEnvelope({
        id: taskStableId('student_digest', 'student', student.id),
        title: `${student.name}每日资料消化`, kind: 'student_digest', sourceType: 'student', sourceId: String(student.id), sourceName: student.name,
        status: digestStatus === 'digesting' ? 'running' : digestStatus === 'submitted' || submittedCount > 0 ? 'waiting_result' : 'pending',
        trigger: 'event', executor: String(student.agentTool || 'qclaw'), requestedExecutor: String(student.agentTool || 'qclaw'), executionMode: 'adapter',
        scheduledAt: String(student.digestTime || '21:30'), count: pendingCount || submittedCount,
        idempotencyKey: studentDigestKey,
        completionPolicy: 'auto_after_validation',
        input: { studentId: String(student.id), knowledgeRoot: student.rootPath || getStudentRootDir(student.name), rawPath: student.rawPath || getRawDir(student.name), digestBatchId: digestState.digestBatchId || '', manifestPath: studentDigestBatchPath(student) },
        expectedOutput: { type: 'digest_receipt_v1', path: studentDigestReceiptPath(student), statePath: studentDigestStatePath(student) },
        permissions: { read: [student.rootPath || getStudentRootDir(student.name)], write: [student.summaryPath || getSummaryDir(student.name), studentManagerDir(student)], operations: ['read', 'write_knowledge'] },
        detail: pendingCount > 0 ? `有 ${pendingCount} 份资料等待消化。` : `有 ${submittedCount} 份资料等待 Agent 回执。`, action: 'student_digest',
      }));
    }
    tasks.push(buildWeeklyActionTask(student));
    tasks.push(buildPeriodicLearningReportTask(student, 'learning_profile'));
    tasks.push(buildPeriodicLearningReportTask(student, 'learning_changes'));
    tasks.push(buildPeriodicLearningReportTask(student, 'learning_stage'));
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
    const projectDigestKey = digestState.digestBatchId
      ? `project_digest:${project.id}:${digestState.digestBatchId}`
      : (digestState.pendingFiles || []).length
        ? digestIdempotencyKey({ type: 'project', id: String(project.id) }, (digestState.pendingFiles || []).map((file) => ({ materialId: `project-${crypto.createHash('sha1').update(`${project.id}|${file.relativePath}`).digest('hex').slice(0, 20)}`, ...file })))
        : `project_digest:${project.id}:idle`;
    tasks.push(normalizeTaskEnvelope({
      id: taskStableId('project_digest', 'project', project.id),
      title: `${project.name}项目资料消化`, kind: 'project_digest', sourceType: 'project', sourceId: String(project.id), sourceName: project.name,
      status: digestStatus === 'digesting' ? 'running' : digestStatus === 'submitted' ? 'waiting_result' : digestStatus === 'failed' ? 'blocked' : pendingDigest > 0 ? 'pending' : 'queued',
      trigger: project.automation?.enabled ? 'schedule' : 'manual', executor: String(project.agentTool || 'qclaw'), requestedExecutor: String(project.agentTool || 'qclaw'), executionMode: 'adapter',
      scheduledAt: project.automation?.enabled ? String(project.automation.nextRunAt || '等待调度') : '', count: pendingDigest,
      idempotencyKey: projectDigestKey,
      completionPolicy: 'auto_after_validation',
      input: { projectId: String(project.id), knowledgeRoot: project.knowledgeRootPath, rawPath: project.rawPath, digestBatchId: digestState.digestBatchId || '', manifestPath: projectDigestRequestPath(project) },
      expectedOutput: { type: 'project_digest_receipt', path: projectDigestReceiptPath(project) },
      permissions: { read: [project.rawPath, project.knowledgeRootPath, projectDigestRequestPath(project)].filter(Boolean), write: [project.knowledgeRootPath, projectDigestReceiptPath(project)].filter(Boolean), operations: ['read', 'write_project_knowledge'] },
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
    let store = upsertTaskCandidates(buildTaskCenterCandidates(), { reconcileStudentDigests: true, reconcileWeeklyActions: true });
    performanceMarks.candidateBuildMs = Date.now() - performanceStartedAt - performanceMarks.qclawSyncMs;
    if (enforceTaskTimeouts(store)) store = writeTaskStore(store);
    const tasks = store.tasks.slice().sort((a, b) => {
      const groupOrder = { actionable: 0, running: 1, scheduled: 2, completed: 3 };
      return Number(groupOrder[a.statusGroup] ?? 9) - Number(groupOrder[b.statusGroup] ?? 9) || String(b.updatedAt).localeCompare(String(a.updatedAt));
    });
    const studentsById = new Map(readStudentsIndex().map((student) => [String(student.id), toHostStudent(student)]));
    const feedbackByStudent = new Map();
    const renderedTasks = tasks.map((task) => {
      if (task.kind !== 'weekly_action' || task.sourceType !== 'student') return task;
      const student = studentsById.get(String(task.sourceId));
      if (!student) return task;
      if (!feedbackByStudent.has(String(task.sourceId))) feedbackByStudent.set(String(task.sourceId), readDailyActionFeedback(student));
      const feedback = feedbackByStudent.get(String(task.sourceId)).find((entry) => String(entry.taskId || '') === String(task.id)
        || (String(entry.date || '') && String(entry.date) === String(task.input?.date || '')));
      if (!feedback) return task;
      return {
        ...task,
        result: {
          ...(task.result || {}),
          summary: task.result?.summary || '每周行动建议已发布并收到行动反馈。',
          feedback,
        },
      };
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
    return JSON.stringify({ ok: true, protocolVersion: TASK_PROTOCOL_VERSION, generatedAt: taskNow(), tasks: renderedTasks, history, summary, capabilities, automationEnabled, executionMode: automationEnabled ? 'automatic' : 'manual', performance: performanceMarks, taskStorePath: taskStorePath(), qclawInboxPath: qclawTaskInboxPath(), qclawResultPath: qclawTaskResultPath(), message: `任务中心已汇总 ${renderedTasks.length} 项标准任务和 ${history.length} 条执行记录；当前为${automationEnabled ? '自动运行' : '仅手动'}模式。` });
  } catch (error) {
    return JSON.stringify({ ok: false, tasks: [], history: [], message: `读取任务中心失败：${error.message}` });
  }
}

function digestTaskId(scopeType, scopeId) {
  const kind = String(scopeType) === 'project' ? 'project_digest' : 'student_digest';
  return taskStableId(kind, String(scopeType), String(scopeId));
}

function digestBusinessSnapshot(scopeType, scopeId) {
  if (String(scopeType) === 'project') {
    const project = readProjectsForDigestLookup().find((item) => String(item.id) === String(scopeId));
    if (!project) return { ok: false, message: '未找到学习项目。' };
    const state = readProjectDigestState(project);
    return { ok: true, scopeType: 'project', scopeId: String(project.id), scopeName: project.name, state, pendingCount: Number(state.pendingCount || 0), processedCount: Number(Object.keys(state.digestManifest || {}).length), lastDigestAt: state.lastDigestAt || '', knowledgePath: project.knowledgeRootPath };
  }
  const student = readStudentsIndex().map(toHostStudent).find((item) => String(item.id) === String(scopeId));
  if (!student) return { ok: false, message: '未找到学生档案。' };
  syncStudentMaterialsFromUploadRecords(student);
  const state = readStudentDigestState(student);
  const materials = readStudentMaterials(student);
  return { ok: true, scopeType: 'student', scopeId: String(student.id), scopeName: student.name, state, pendingCount: materials.filter((item) => normalizeUploadStatus(item.status) === 'pending_digest').length, submittedCount: materials.filter((item) => ['submitted', 'digesting'].includes(normalizeUploadStatus(item.status))).length, processedCount: materials.filter((item) => normalizeUploadStatus(item.status) === 'processed').length, lastDigestAt: state.lastDigestAt || '', knowledgePath: student.rootPath || getStudentRootDir(student.name) };
}

function getDigestWorkflowStatusObject(scopeType, scopeId) {
  const business = digestBusinessSnapshot(scopeType, scopeId);
  if (!business.ok) return business;
  const task = readTaskStore().tasks.find((item) => String(item.id) === digestTaskId(scopeType, scopeId)) || null;
  const userStatus = digestUserStatus(task?.status, business.state?.status, business.pendingCount);
  return {
    ok: true,
    ...business,
    taskId: task?.id || digestTaskId(scopeType, scopeId),
    taskStatus: task?.status || '',
    executionId: task?.executionId || '',
    adapterId: task?.adapterId || task?.executor || '',
    executionMode: task?.executionMode || '',
    manualRequired: task?.status === 'waiting_result' && task?.adapterId === 'manual',
    command: task?.result?.packet?.promptPath ? '' : '',
    userStatus,
    label: userStatusLabel(userStatus),
    message: task?.error?.code === 'EXIT_4294770688'
      ? 'Agent 启动失败：旧版参数桥接器无法从安装包内访问。请使用修订版后点击“重试未完成项”。'
      : task?.error?.message || business.state?.message || task?.result?.summary || '',
    canStart: userStatus === 'pending' && business.pendingCount > 0,
    canRetry: ['partial', 'needs_help'].includes(userStatus) && (business.pendingCount > 0 || Number(business.submittedCount || 0) > 0),
    canPaste: task?.status === 'waiting_result' && task?.adapterId === 'manual',
  };
}

function prepareDigestWorkflow(scopeType, scopeId) {
  const business = digestBusinessSnapshot(scopeType, scopeId);
  if (!business.ok) return business;
  if (business.pendingCount <= 0 && !Number(business.submittedCount || 0)) return { ok: false, skipped: true, completed: true, taskId: digestTaskId(scopeType, scopeId), message: '当前没有待处理资料。' };
  upsertTaskCandidates(buildTaskCenterCandidates(), { reconcileStudentDigests: true });
  const store = readTaskStore();
  const taskId = digestTaskId(scopeType, scopeId);
  const task = store.tasks.find((item) => item.id === taskId);
  if (!task) return { ok: false, message: '未能建立资料处理任务。' };
  if (['running', 'waiting_result'].includes(task.status) && task.executionId) return { ok: true, alreadyRunning: true, taskId, task, message: '资料已经在处理中。' };
  if (['running', 'waiting_result'].includes(task.status) && !task.executionId) {
    task.status = 'pending';
    task.statusGroup = taskStatusGroup('pending');
    task.updatedAt = taskNow();
    task.error = null;
    writeTaskStore(store);
    appendTaskEvent(task.id, 'digest_orphan_state_recovered', { from: 'waiting_without_execution', to: 'pending' });
  }
  return { ok: true, taskId, task: readTaskStore().tasks.find((item) => item.id === taskId), message: '资料处理任务已准备。' };
}

function resetDigestWorkflow(scopeType, scopeId) {
  const prepared = prepareDigestWorkflow(scopeType, scopeId);
  if (!prepared.ok) return prepared;
  let task = readTaskStore().tasks.find((item) => item.id === prepared.taskId);
  if (['failed', 'blocked', 'timed_out', 'cancelled'].includes(task?.status)) {
    const retried = JSON.parse(retryTask(task.id));
    if (!retried.ok) return retried;
    task = retried.task;
  }
  return { ok: true, taskId: prepared.taskId, task, message: '未完成资料已准备重新处理。' };
}

function executeDigestTask(taskId, requestedExecutor = 'auto') {
  const result = JSON.parse(executeTaskByAdapter(taskId, requestedExecutor));
  const task = result.task || readTaskStore().tasks.find((item) => item.id === String(taskId));
  if (result.ok && task && isDigestTask(task)) notify('onNativeDigestWorkflowChanged', JSON.stringify({ scopeType: task.sourceType, scopeId: task.sourceId, status: task.status, taskId: task.id }));
  return { ...result, workflow: task ? getDigestWorkflowStatusObject(task.sourceType, task.sourceId) : null };
}

function configuredDigestExecutor(scopeType, scopeId, requestedExecutor = 'auto') {
  if (!['', 'auto', 'smart'].includes(String(requestedExecutor || 'auto'))) return String(requestedExecutor);
  if (String(scopeType) === 'project') {
    const project = readProjectsForDigestLookup().find((item) => String(item.id) === String(scopeId));
    return String(project?.agentTool || 'manual');
  }
  const student = readStudentsIndex().find((item) => String(item.id) === String(scopeId));
  return String(student?.agentTool || 'manual');
}

function getDigestWorkflowCommand(scopeType, scopeId) {
  try {
    const prepared = prepareDigestWorkflow(scopeType, scopeId);
    if (!prepared.ok) return JSON.stringify(prepared);
    let task = readTaskStore().tasks.find((item) => item.id === prepared.taskId);
    if (!task) return JSON.stringify({ ok: false, message: '未找到当前资料处理任务。' });
    if (task.kind === 'student_digest') {
      const registered = registerStudentDigestBatch(task.sourceId, { includeSubmitted: true });
      if (!registered.ok) return JSON.stringify(registered);
      task = attachDigestBatchToTask(task.id, registered.batch, studentDigestBatchPath(registered.student), studentDigestReceiptPath(registered.student)) || task;
    } else if (task.kind === 'project_digest') {
      const project = readProjectsForDigestLookup().find((item) => String(item.id) === String(task.sourceId));
      if (!project) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
      const ensured = ensureProjectWorkspace(project);
      const current = readProjectDigestState(ensured);
      let request = safeReadJson(projectDigestRequestPath(ensured), null);
      if (!request?.digestBatchId || request.digestBatchId !== current.digestBatchId) {
        const registered = registerProjectDigestBatch(ensured, { prefix: 'manual-copy', message: '项目资料已登记，等待 Agent 处理。' });
        if (!registered.ok) return JSON.stringify(registered);
        request = registered.request;
      }
      task = attachDigestBatchToTask(task.id, request, projectDigestRequestPath(ensured), projectDigestReceiptPath(ensured)) || task;
    }
    const command = taskCommandFor(task);
    if (!command || /批次无效/.test(command)) return JSON.stringify({ ok: false, message: command || '当前批次指令生成失败。' });
    return JSON.stringify({ ok: true, command, taskId: task.id, digestBatchId: task.input?.digestBatchId || '', executor: task.requestedExecutor || task.executor || '', message: '已生成当前冻结批次的完整 Agent 指令。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `生成当前批次指令失败：${error.message}` });
  }
}

function reconcileDigestWorkflows() {
  if (digestWorkflowRunning) return { ok: true, skipped: true };
  digestWorkflowRunning = true;
  try {
    syncQClawTaskResults();
    const store = readTaskStore();
    let changed = compactDigestTaskStore(store);
    changed = enforceTaskTimeouts(store) || changed;
    const results = [];
    for (const task of store.tasks.filter((item) => isDigestTask(item))) {
      if (task.completionPolicy !== 'auto_after_validation') {
        task.completionPolicy = 'auto_after_validation';
        task.updatedAt = taskNow();
        changed = true;
        appendTaskEvent(task.id, 'digest_completion_policy_migrated', { from: 'legacy_manual_review', to: 'auto_after_validation' }, task.executionId);
      }
      const taskMayNeedSettlement = ['running', 'waiting_result', 'reviewing'].includes(task.status);
      const business = taskMayNeedSettlement ? digestBusinessSnapshot(task.sourceType, task.sourceId) : null;
      const businessStatus = String(business?.state?.status || '');
      const businessAlreadySettled = business?.ok
        && ['completed', 'partial'].includes(businessStatus)
        && (businessStatus === 'partial' || Number(business.pendingCount || 0) === 0);
      if (task.status === 'reviewing' && shouldAutoAccept(task, task.result?.validation)) {
        const accepted = transitionTaskInStore(store, task.id, 'succeeded', { result: { ...(task.result || {}), status: 'succeeded', autoAcceptedAt: taskNow() }, approval: { required: false, status: 'not_required', reviewedAt: taskNow(), reviewedBy: 'system_validation' } }, 'digest_review_recovered');
        changed = changed || accepted.ok;
        if (accepted.ok) results.push({ taskId: task.id, status: 'succeeded' });
        continue;
      }
      if (task.status === 'reviewing' && businessAlreadySettled) {
        const acceptedAt = taskNow();
        const accepted = transitionTaskInStore(store, task.id, 'succeeded', {
          result: { ...(task.result || {}), status: 'succeeded', validation: { ...(task.result?.validation || {}), valid: true, message: business.state?.message || '资料业务状态已经完成。', checkedAt: acceptedAt }, autoAcceptedAt: acceptedAt, summary: business.state?.message || task.result?.summary || '资料处理已完成。' },
          approval: { required: false, status: 'not_required', reviewedAt: acceptedAt, reviewedBy: 'system_business_state' },
        }, 'digest_business_state_reconciled');
        changed = changed || accepted.ok;
        if (accepted.ok) results.push({ taskId: task.id, status: 'succeeded' });
        continue;
      }
      if (['running', 'waiting_result'].includes(task.status) && businessAlreadySettled) {
        const validation = { valid: true, artifacts: [], checkedAt: taskNow(), message: business.state?.message || '资料业务状态已经完成。', domainSync: business };
        const result = normalizeTaskResult(task, { status: 'reviewing', summary: validation.message, structuredOutput: business }, validation);
        const committed = commitValidatedTaskResult(store, task, result, validation, { successful: true, event: 'digest_business_state_recovered', autoSummary: validation.message });
        changed = changed || committed.ok;
        if (committed.ok) results.push({ taskId: task.id, status: committed.task?.status || 'succeeded' });
        continue;
      }
      if (!['running', 'waiting_result'].includes(task.status)) continue;
      const resultPath = task.expectedOutput?.path;
      if (resultPath && fs.existsSync(resultPath)) {
        const validation = validateTaskCompletion(task, task.startedAt, null);
        if (validation.valid) {
          const result = normalizeTaskResult(task, { status: 'reviewing', summary: '恢复时检测到完整资料结果。' }, validation);
          const committed = commitValidatedTaskResult(store, task, result, validation, { successful: true, event: 'digest_result_recovered', autoSummary: '资料处理完成并已通过自动校验。' });
          changed = changed || committed.ok;
          if (committed.ok) results.push({ taskId: task.id, status: committed.task?.status || 'reviewing' });
          continue;
        }
      }
      if (task.status === 'running' && ['codex', 'openclaw'].includes(task.adapterId) && !taskChildProcesses.has(task.id)) {
        const failed = transitionTaskInStore(store, task.id, 'failed', { error: { code: 'EXECUTION_INTERRUPTED', message: '应用关闭后原执行已中断，请重试未完成项。' }, nextRetryAt: '' }, 'digest_execution_interrupted');
        changed = changed || failed.ok;
        if (failed.ok) results.push({ taskId: task.id, status: 'failed' });
      }
    }
    if (changed) writeTaskStore(store);
    for (const item of results) {
      const task = store.tasks.find((candidate) => candidate.id === item.taskId);
      if (task) notify('onNativeDigestWorkflowChanged', JSON.stringify({ scopeType: task.sourceType, scopeId: task.sourceId, status: item.status, taskId: task.id }));
    }
    return { ok: true, results };
  } catch (error) {
    return { ok: false, message: error.message };
  } finally {
    digestWorkflowRunning = false;
  }
}

const digestOrchestrator = createDigestOrchestrator({
  prepare: prepareDigestWorkflow,
  execute: executeDigestTask,
  status: getDigestWorkflowStatusObject,
  reset: resetDigestWorkflow,
  reconcile: reconcileDigestWorkflows,
});

function startDigestWorkflow(scopeType, scopeId, requestedExecutor = 'auto') {
  try { return JSON.stringify(digestOrchestrator.start(scopeType, scopeId, configuredDigestExecutor(scopeType, scopeId, requestedExecutor))); }
  catch (error) { return JSON.stringify({ ok: false, message: `开始资料处理失败：${error.message}` }); }
}

function getDigestWorkflowStatus(scopeType, scopeId) {
  try { return JSON.stringify(digestOrchestrator.status(scopeType, scopeId)); }
  catch (error) { return JSON.stringify({ ok: false, message: `读取资料处理状态失败：${error.message}` }); }
}

function retryDigestWorkflow(scopeType, scopeId, requestedExecutor = 'auto') {
  try { return JSON.stringify(digestOrchestrator.retry(scopeType, scopeId, configuredDigestExecutor(scopeType, scopeId, requestedExecutor))); }
  catch (error) { return JSON.stringify({ ok: false, message: `重试资料处理失败：${error.message}` }); }
}

function importDigestWorkflowResultText(scopeType, scopeId, content) {
  try {
    const taskId = digestTaskId(scopeType, scopeId);
    const result = JSON.parse(importTaskResultText(taskId, content));
    return JSON.stringify({ ...result, workflow: getDigestWorkflowStatusObject(scopeType, scopeId) });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `导入资料处理结果失败：${error.message}` });
  }
}

function startDigestWorkflowMonitor() {
  stopDigestWorkflowMonitor();
  if (process.env.EDU_DISABLE_DIGEST_MONITOR === '1') return;
  setTimeout(() => reconcileDigestWorkflows(), 2500);
  digestWorkflowTimer = setInterval(() => reconcileDigestWorkflows(), 5000);
}

function stopDigestWorkflowMonitor() {
  if (digestWorkflowTimer) clearInterval(digestWorkflowTimer);
  digestWorkflowTimer = null;
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
  writeJsonAtomic(file, {
    version: 1,
    updatedAt: new Date().toISOString(),
    candidates: review.candidates || [],
  });
}

function growthTransactionSnapshot(student) {
  const normalized = toHostStudent(student);
  const files = [
    projectsPath(),
    growthEvidenceReviewPath(normalized),
    growthIndexPath(normalized),
    growthIndexMarkdownPath(normalized),
    path.join(growthModelDirForStudent(normalized), '成长证据.md'),
  ];
  return files.map((file) => ({ file, existed: fs.existsSync(file), content: fs.existsSync(file) ? fs.readFileSync(file) : null }));
}

function restoreGrowthTransaction(snapshot) {
  for (const item of Array.isArray(snapshot) ? snapshot : []) {
    if (item.existed) {
      fs.mkdirSync(path.dirname(item.file), { recursive: true });
      fs.writeFileSync(item.file, item.content);
    } else if (fs.existsSync(item.file)) {
      fs.unlinkSync(item.file);
    }
  }
  projectDigestLookupCache = { mtimeMs: -1, size: -1, projects: [] };
}

function createGrowthRecoverySnapshot(student, reason = 'repair') {
  const normalized = toHostStudent(student);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(app.getPath('userData'), 'growth-recovery', `${stamp}-${sanitizeName(normalized.name)}-${normalized.id}`);
  const reportDir = learningReportDirForStudent(normalized);
  const files = [
    projectsPath(),
    growthEvidenceReviewPath(normalized),
    growthIndexPath(normalized),
    growthIndexMarkdownPath(normalized),
    path.join(growthModelDirForStudent(normalized), '成长证据.md'),
    ...LEARNING_REPORTS.map((report) => path.join(reportDir, report.fileName)),
  ];
  const copied = [];
  fs.mkdirSync(target, { recursive: true });
  for (const source of files) {
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
    const name = `${copied.length + 1}-${path.basename(source)}`;
    fs.copyFileSync(source, path.join(target, name));
    copied.push({ source, backup: name });
  }
  writeJsonAtomic(path.join(target, 'manifest.json'), { version: 1, createdAt: new Date().toISOString(), reason, studentId: normalized.id, studentName: normalized.name, files: copied });
  return target;
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
    const protocolCompatibility = mapGrowthEvidenceReviewToEducationClaims({ student: normalized, review, sourcePath: growthEvidenceReviewPath(normalized) });
    const riskAssessment = buildGrowthEvidenceBatchPlan(review.candidates, { legacyReviewIds: protocolCompatibility.reviewQueue.map((item) => item.evidenceId) });
    return JSON.stringify({ ok: true, review, protocolCompatibility, riskAssessment, path: growthEvidenceReviewPath(normalized), message: `已读取 ${review.candidates.length} 条成长证据；默认仅显示 ${riskAssessment.summary.medium + riskAssessment.summary.high} 条需要关注的记录。` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `读取成长证据审核失败：${error.message}` });
  }
}

function migrateLegacyGrowthEvidence(student, review, projects) {
  const growth = ensureGrowthModelForStudent(student);
  const evidenceFile = path.join(growth.dir, '成长证据.md');
  if (!fs.existsSync(evidenceFile)) return { imported: 0, source: evidenceFile };
  const legacy = parseLegacyGrowthEvidenceMarkdown(readSmallTextFile(evidenceFile, 1024 * 1024), evidenceFile);
  const existingKeys = new Set((review.candidates || []).map((item) => `${item.title || ''}|${item.sourcePath || ''}|${item.ability || ''}`));
  let imported = 0;
  for (const candidate of legacy) {
    const key = `${candidate.title || ''}|${candidate.sourcePath || ''}|${candidate.ability || ''}`;
    if (existingKeys.has(key)) continue;
    const matchedProject = projects.find((project) => String(project.name || '') === String(candidate.projectName || ''));
    review.candidates.push({
      ...candidate,
      studentId: student.id,
      studentName: student.name,
      projectId: matchedProject?.id || '',
      projectName: matchedProject?.name || candidate.projectName || '',
      createdAt: candidate.createdAt || fs.statSync(evidenceFile).mtime.toISOString(),
      updatedAt: candidate.updatedAt || fs.statSync(evidenceFile).mtime.toISOString(),
    });
    existingKeys.add(key);
    imported += 1;
  }
  if (imported) writeGrowthEvidenceReview(student, review);
  return { imported, source: evidenceFile };
}

function migrateLegacyLearningReports(student, review) {
  const reportDir = learningReportDirForStudent(student);
  const known = new Set((review.candidates || []).map((item) => String(item.migratedFrom || '')));
  let imported = 0;
  for (const report of LEARNING_REPORTS) {
    const sourcePath = path.join(reportDir, report.fileName);
    if (!fs.existsSync(sourcePath) || known.has(sourcePath)) continue;
    const candidate = legacyReportCandidate({
      studentId: student.id,
      reportId: report.id,
      title: report.title,
      sourcePath,
      content: readSmallTextFile(sourcePath, 1024 * 1024),
    });
    if (!candidate) continue;
    const timestamp = fs.statSync(sourcePath).mtime.toISOString();
    review.candidates.push({ ...candidate, studentId: student.id, studentName: student.name, createdAt: timestamp, updatedAt: timestamp });
    known.add(sourcePath);
    imported += 1;
  }
  if (imported) writeGrowthEvidenceReview(student, review);
  return { imported, source: reportDir };
}

function rebuildGrowthIndex(studentId) {
  try {
    const student = readStudentsIndex().find((item) => String(item.id) === String(studentId));
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const normalized = toHostStudent(student);
    const growth = ensureGrowthModelForStudent(normalized);
    const projects = readProjects().map(normalizeProject).filter((project) => (project.studentIds || []).map(String).includes(String(normalized.id)));
    const review = readGrowthEvidenceReview(normalized);
    const migration = migrateLegacyGrowthEvidence(normalized, review, projects);
    const reportMigration = migrateLegacyLearningReports(normalized, review);
    const index = buildGrowthIndexV2({
      student: normalized,
      growthDir: growth.dir,
      review,
      projects,
      sourceFiles: {
        evidenceReview: growthEvidenceReviewPath(normalized),
        evidenceMd: path.join(growth.dir, '成长证据.md'),
        projectContributionMd: path.join(growth.dir, '项目贡献.md'),
      },
      migration: { legacyEvidenceImported: migration.imported, legacyEvidenceSource: migration.source, legacyReportCandidatesImported: reportMigration.imported, legacyReportSource: reportMigration.source },
    });
    index.sourceFingerprint = growthSourceFingerprint(review, projects);
    fs.mkdirSync(path.dirname(growthIndexPath(normalized)), { recursive: true });
    fs.writeFileSync(growthIndexPath(normalized), JSON.stringify(index, null, 2), 'utf8');
    const abilityRows = index.abilities.map((item) => `| ${mdCell(item.name)} | ${mdCell(item.maturity)} | ${mdCell(item.trend)} | ${item.evidenceCount} | ${item.confirmedCount} | ${mdCell(item.projectNames.join('、') || '-')} | ${mdCell(item.lastObservedAt || '-')} |`).join('\n') || '| 暂无 | - | - | 0 | 0 | - | - |';
    const projectRows = index.projects.map((item) => `| ${mdCell(item.projectName)} | ${mdCell(item.reviewStatus)} | ${item.evidenceCount} | ${item.confirmedEvidenceCount} | ${mdCell(item.abilityNames.join('、') || '-')} | ${mdCell(item.publishedAt || '-')} |`).join('\n') || '| 暂无 | - | 0 | 0 | - | - |';
    const markdown = `# ${normalized.name} 成长模型结构化索引\n\nSchema：edu-manager.growth-model.v2\n\n生成时间：${index.updatedAt}\n\n## 总览\n\n| 指标 | 数量 |\n| --- | ---: |\n| 成长证据 | ${index.summary.evidenceCount} |\n| 已确认 | ${index.summary.confirmedCount} |\n| 观察中 | ${index.summary.watchingCount} |\n| 待审核 | ${index.summary.pendingCount} |\n| 已驳回/回滚 | ${index.summary.rejectedCount} |\n| 能力维度 | ${index.summary.abilityCount} |\n| 关联项目 | ${index.summary.projectCount} |\n| 已发布项目贡献 | ${index.summary.publishedProjectCount} |\n\n## 能力画像\n\n| 能力 | 成熟度 | 趋势 | 证据 | 已确认 | 来源项目 | 最近观察 |\n| --- | --- | --- | ---: | ---: | --- | --- |\n${abilityRows}\n\n## 项目贡献\n\n| 项目 | 贡献状态 | 证据 | 已确认 | 能力 | 发布时间 |\n| --- | --- | ---: | ---: | --- | --- |\n${projectRows}\n\n> 该索引由教育管家控制台生成，用于统一能力画像、项目贡献和成长证据。它不会覆盖原始 Markdown；旧版成长证据会以兼容方式导入审核索引。\n`;
    fs.writeFileSync(growthIndexMarkdownPath(normalized), markdown, 'utf8');
    const protocolCompatibility = mapGrowthIndexV2ToDomainSnapshot({ student: normalized, index, sourcePath: growthIndexPath(normalized) });
    appendHostTimeline({ type: 'growth_index_rebuilt', title: 'Growth index rebuilt', detail: normalized.name, count: review.candidates.length });
    return JSON.stringify({ ok: true, index, protocolCompatibility, path: growthIndexPath(normalized), markdownPath: growthIndexMarkdownPath(normalized), content: markdown, message: `已重建「${normalized.name}」成长模型结构化索引。` });
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
    if (!fs.existsSync(file)) {
      createGrowthRecoverySnapshot(normalized, 'missing-index-rebuild');
      return rebuildGrowthIndex(studentId);
    }
    const index = safeReadJson(file, {});
    const projects = readProjects().map(normalizeProject).filter((project) => (project.studentIds || []).map(String).includes(String(normalized.id)));
    const review = readGrowthEvidenceReview(normalized);
    const fingerprint = growthSourceFingerprint(review, projects);
    if (growthIndexNeedsRebuild(index, fingerprint)) {
      createGrowthRecoverySnapshot(normalized, 'stale-index-rebuild');
      return rebuildGrowthIndex(studentId);
    }
    const content = fs.existsSync(growthIndexMarkdownPath(normalized)) ? readSmallTextFile(growthIndexMarkdownPath(normalized), 512 * 1024) : '';
    const protocolCompatibility = mapGrowthIndexV2ToDomainSnapshot({ student: normalized, index, sourcePath: file });
    return JSON.stringify({ ok: true, index, protocolCompatibility, path: file, markdownPath: growthIndexMarkdownPath(normalized), content, message: '已读取成长模型结构化索引。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `读取成长模型结构化索引失败：${error.message}` });
  }
}

function repairStaleGrowthIndexes() {
  const repaired = [];
  const failed = [];
  for (const student of readStudentsIndex()) {
    try {
      const normalized = toHostStudent(student);
      const file = growthIndexPath(normalized);
      const index = fs.existsSync(file) ? safeReadJson(file, {}) : {};
      const projects = readProjects().map(normalizeProject).filter((project) => (project.studentIds || []).map(String).includes(String(normalized.id)));
      const review = readGrowthEvidenceReview(normalized);
      const fingerprint = growthSourceFingerprint(review, projects);
      if (!fs.existsSync(file) || growthIndexNeedsRebuild(index, fingerprint)) {
        const backupPath = createGrowthRecoverySnapshot(normalized, 'startup-consistency-repair');
        const result = JSON.parse(rebuildGrowthIndex(normalized.id));
        if (!result.ok) throw new Error(result.message || '索引重建失败。');
        repaired.push({ studentId: normalized.id, studentName: normalized.name, backupPath });
      }
    } catch (error) {
      failed.push({ studentId: student.id, studentName: student.name, message: error.message });
    }
  }
  if (repaired.length || failed.length) appendHostTimeline({ type: 'growth_consistency_repaired', title: 'Growth consistency repaired', detail: `repaired ${repaired.length}, failed ${failed.length}`, count: repaired.length });
  return { repaired, failed };
}

function applyGrowthEvidenceReviewDecision(item, nextStatus, note, reviewedAt, batchId = '') {
  const previousStatus = String(item.status || 'pending');
  const reviewDecision = nextStatus === 'confirmed' ? 'approved' : nextStatus === 'rejected' ? 'rejected' : 'pending';
  item.status = nextStatus;
  item.note = String(note || item.note || '');
  item.updatedAt = reviewedAt;
  item.review = {
    status: reviewDecision,
    reviewerRole: 'administrator',
    reviewerId: 'local-user',
    reviewedAt,
    ...(batchId ? { batchId } : {}),
  };
  item.reviewerRole = item.review.reviewerRole;
  item.reviewerId = item.review.reviewerId;
  item.reviewedAt = reviewedAt;
  item.reviewHistory = [
    ...(Array.isArray(item.reviewHistory) ? item.reviewHistory : []),
    {
      from: previousStatus,
      to: nextStatus,
      note: String(note || ''),
      reviewerRole: item.review.reviewerRole,
      reviewerId: item.review.reviewerId,
      reviewedAt,
      ...(batchId ? { batchId } : {}),
    },
  ];
}

function appendConfirmedGrowthEvidence(student, item) {
  const growth = ensureGrowthModelForStudent(student);
  const evidenceFile = path.join(growth.dir, '成长证据.md');
  const marker = `<!-- evidence:${item.id} -->`;
  const current = fs.existsSync(evidenceFile) ? readSmallTextFile(evidenceFile, 1024 * 1024) : '';
  if (!current.includes(marker)) {
    fs.appendFileSync(evidenceFile, `${marker}\n| ${new Date().toISOString().slice(0, 10)} | ${mdCell(item.title)} | ${mdCell(item.sourcePath || item.projectName || '-')} | ${mdCell(item.ability || '待标注')} | ${mdCell(item.confidence || '人工确认')} |\n`, 'utf8');
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
    const reviewedAt = new Date().toISOString();
    applyGrowthEvidenceReviewDecision(item, nextStatus, note, reviewedAt);
    writeGrowthEvidenceReview(normalized, review);
    if (nextStatus === 'confirmed') {
      appendConfirmedGrowthEvidence(normalized, item);
    }
    rebuildGrowthIndex(studentId);
    appendHostTimeline({ type: 'growth_evidence_reviewed', title: 'Growth evidence reviewed', detail: `${normalized.name} ${nextStatus}`, count: 1 });
    const protocolCompatibility = mapGrowthEvidenceReviewToEducationClaims({ student: normalized, review, sourcePath: growthEvidenceReviewPath(normalized) });
    const riskAssessment = buildGrowthEvidenceBatchPlan(review.candidates, { legacyReviewIds: protocolCompatibility.reviewQueue.map((entry) => entry.evidenceId) });
    return JSON.stringify({ ok: true, review, protocolCompatibility, riskAssessment, message: `已将成长证据标记为：${nextStatus}，并记录本机人工审核。` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `更新成长证据状态失败：${error.message}` });
  }
}

function batchReviewGrowthEvidence(studentId) {
  try {
    const student = readStudentsIndex().find((item) => String(item.id) === String(studentId));
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const normalized = toHostStudent(student);
    ensureGrowthModelForStudent(normalized);
    const review = readGrowthEvidenceReview(normalized);
    const compatibilityBefore = mapGrowthEvidenceReviewToEducationClaims({ student: normalized, review, sourcePath: growthEvidenceReviewPath(normalized) });
    const plan = buildGrowthEvidenceBatchPlan(review.candidates, { legacyReviewIds: compatibilityBefore.reviewQueue.map((item) => item.evidenceId) });
    if (!plan.summary.batchProcessable) {
      return JSON.stringify({ ok: true, changed: 0, review, protocolCompatibility: compatibilityBefore, riskAssessment: plan, message: plan.summary.high ? `当前只有 ${plan.summary.high} 条高风险记录，需要逐条确认。` : '当前没有需要批量处理的普通候选。' });
    }
    const reviewedAt = new Date().toISOString();
    const batchId = `growth-review-${reviewedAt.replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
    const confirmIds = new Set(plan.confirmIds);
    const watchIds = new Set(plan.watchIds);
    let confirmed = 0;
    let watching = 0;
    for (const item of review.candidates) {
      if (confirmIds.has(String(item.id))) {
        applyGrowthEvidenceReviewDecision(item, 'confirmed', '批量确认：来源完整、已关联项目且未发现高风险因素。', reviewedAt, batchId);
        appendConfirmedGrowthEvidence(normalized, item);
        confirmed += 1;
      } else if (watchIds.has(String(item.id))) {
        applyGrowthEvidenceReviewDecision(item, 'watching', '批量分流：信息不完整或可信度待观察，未发布为正式结论。', reviewedAt, batchId);
        watching += 1;
      }
    }
    writeGrowthEvidenceReview(normalized, review);
    rebuildGrowthIndex(studentId);
    const protocolCompatibility = mapGrowthEvidenceReviewToEducationClaims({ student: normalized, review, sourcePath: growthEvidenceReviewPath(normalized) });
    const riskAssessment = buildGrowthEvidenceBatchPlan(review.candidates, { legacyReviewIds: protocolCompatibility.reviewQueue.map((item) => item.evidenceId) });
    appendHostTimeline({ type: 'growth_evidence_batch_reviewed', title: 'Growth evidence batch reviewed', detail: `${normalized.name} confirmed ${confirmed}, watching ${watching}`, count: confirmed + watching });
    return JSON.stringify({ ok: true, changed: confirmed + watching, confirmed, watching, batchId, review, protocolCompatibility, riskAssessment, message: `一次处理完成：采用 ${confirmed} 条低风险证据，${watching} 条转为继续观察；${riskAssessment.summary.high} 条高风险记录保留逐条确认。` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `批量审核成长证据失败：${error.message}` });
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
  return `---\ntype: ${report.type}\ntarget: ${report.target}\nupdated: ${today}\nstatus: draft\nsource_layer: growth_model\npresentation_only: true\ngrowth_model: ${growthDir}\n---\n\n# ${report.title}\n\n> 本报告是成长模型的呈现输出，不是能力、项目贡献或成长证据的事实来源。生成和更新时，只引用成长模型中的已确认结论。\n\n## 成长证据来源\n\n- 成长模型：${growthDir}\n- 能力画像：${path.join(growthDir, '能力画像.md')}\n- 成长证据：${path.join(growthDir, '成长证据.md')}\n- 项目贡献：${path.join(growthDir, '项目贡献.md')}\n\n## 项目贡献来源\n\n- 待补充已确认的项目知识贡献申请。\n\n${body}\n`;
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

function conversationGovernanceDir(student) {
  return path.join(agentConversationDir(student), 'governance');
}

function conversationInteractionsDir(student) {
  return path.join(conversationGovernanceDir(student), 'interactions');
}

function conversationAssetsDir(student) {
  return path.join(conversationGovernanceDir(student), 'assets');
}

function conversationCandidatesPath(student) {
  return path.join(conversationGovernanceDir(student), 'knowledge-candidates.json');
}

function conversationTransactionsDir(student) {
  return path.join(conversationGovernanceDir(student), 'transactions');
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
  return `## 成长模型与学情报告 Protocol\n\n成长模型是学生长期成长的权威数据层；学情报告是面向家长、学生和教师的呈现层。学情报告不得反向充当能力、项目贡献或成长证据的事实来源。\n\n成长模型位置：\n\n- ${rulePathJoin(growthDir, '能力画像.md')}\n- ${rulePathJoin(growthDir, '项目贡献.md')}\n- ${rulePathJoin(growthDir, '成长证据.md')}\n- ${rulePathJoin(growthDir, '成长证据草稿.md')}\n\n完成资料消化、综合分析或咨询沉淀后，先把新发现写入成长证据草稿或结构化审核候选，经人工确认后再更新能力画像和项目贡献。不要在资料消化过程中直接覆盖学情报告。\n\n学情报告只根据已确认成长模型生成：\n\n- ${rulePathJoin(reportDir, '整体画像.md')}\n- ${rulePathJoin(reportDir, '历史变化.md')}\n- ${rulePathJoin(reportDir, '每日行动建议.md')}（界面按“每周行动建议”呈现，保留原文件名兼容既有档案）\n- ${rulePathJoin(reportDir, '阶段总结.md')}\n\n写作要求：\n\n1. 面向家长、学生、教师可读，避免内部技术术语。\n2. 每份报告顶部保留更新时间、适用对象、状态。\n3. 结论必须对应成长模型中的已确认证据和项目贡献。\n4. “每周行动建议”每名学生每周只生成一项任务，必须通过统一任务中心生成、审核和发布，并分为：给学生、给家长、给老师。\n5. 不确定判断标注“待观察”，不要写成定论。\n6. 不要删除原有报告内容；判断发生变化时，在“历史变化”或“阶段总结”中说明变化原因。\n7. 整体画像引用能力画像；历史变化引用能力时间线；阶段总结引用项目贡献和已确认成长证据；每周行动建议只引用本周有效的已确认依据。\n`;
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
  writeJsonAtomic(file, value);
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
  if (entry?.type === 'import') current.imports = [entry, ...(Array.isArray(current.imports) ? current.imports : []).filter((item) => item.assetId !== entry.assetId && item.hash !== entry.hash)].slice(0, 200);
  if (entry?.type === 'extract') current.extracts = [entry, ...(Array.isArray(current.extracts) ? current.extracts : []).filter((item) => item.id !== entry.id)].slice(0, 200);
  current.version = 2;
  current.updatedAt = new Date().toISOString();
  writeJsonFile(indexFile, current);
  return current;
}

function readConversationCandidateRegistry(student) {
  return readJsonFile(conversationCandidatesPath(student), {
    schema: CANDIDATE_REGISTRY_SCHEMA,
    version: 1,
    updatedAt: '',
    candidates: [],
  });
}

function writeConversationCandidateRegistry(student, registry) {
  writeJsonFile(conversationCandidatesPath(student), {
    ...registry,
    schema: CANDIDATE_REGISTRY_SCHEMA,
    version: 1,
    updatedAt: new Date().toISOString(),
    candidates: Array.isArray(registry.candidates) ? registry.candidates : [],
  });
}

function listConversationTransactions(student) {
  fs.mkdirSync(conversationTransactionsDir(student), { recursive: true });
  return fs.readdirSync(conversationTransactionsDir(student), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => readJsonFile(path.join(conversationTransactionsDir(student), entry.name), null))
    .filter(Boolean)
    .sort((a, b) => String(b.promotedAt || b.reversedAt || '').localeCompare(String(a.promotedAt || a.reversedAt || '')))
    .slice(0, 100);
}

function recoverInterruptedConversationTransactions(student) {
  fs.mkdirSync(conversationTransactionsDir(student), { recursive: true });
  for (const entry of fs.readdirSync(conversationTransactionsDir(student), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const file = path.join(conversationTransactionsDir(student), entry.name);
    const transaction = readJsonFile(file, null);
    if (!transaction || !['preparing', 'applying'].includes(transaction.status)) continue;
    try {
      writeJsonFile(file, rollbackInterruptedPromotionTransaction(transaction));
    } catch (error) {
      writeJsonFile(file, { ...transaction, status: 'recovery_required', recoveryError: error.message, recoveryCheckedAt: new Date().toISOString() });
    }
  }
}

function conversationGovernanceState(student) {
  const registry = readConversationCandidateRegistry(student);
  const candidates = Array.isArray(registry.candidates) ? registry.candidates : [];
  return {
    schema: 'edu-manager.conversation-governance-center.v1',
    candidates,
    transactions: listConversationTransactions(student),
    summary: {
      total: candidates.length,
      pending: candidates.filter((item) => item.status === 'pending').length,
      blocked: candidates.filter((item) => item.status === 'pending' && item.risk?.blocked).length,
      promoted: candidates.filter((item) => item.status === 'promoted').length,
      rejected: candidates.filter((item) => item.status === 'rejected').length,
    },
  };
}

function candidateSourceContent(student, candidate) {
  const assetId = String(candidate?.source?.assetId || '');
  if (!assetId) return '';
  const asset = readJsonFile(path.join(conversationAssetsDir(student), `${assetId}.json`), null);
  if (!asset?.storedPath || !fs.existsSync(asset.storedPath)) return '';
  return readSmallTextFile(asset.storedPath, 5 * 1024 * 1024);
}

function reassessConversationCandidate(student, candidate) {
  const next = candidate;
  const interactionId = String(next?.source?.interactionId || '');
  const messageId = String(next?.source?.messageId || '');
  if (interactionId && messageId) {
    const interaction = readJsonFile(path.join(conversationInteractionsDir(student), `${interactionId}.json`), null);
    next.source.messageIdValid = Boolean(interaction?.messages?.some((item) => String(item.id) === messageId));
  }
  next.risk = assessCandidateRisk(next, candidateSourceContent(student, next));
  return next;
}

function getAgentConversationCenter(studentId) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    fs.mkdirSync(agentConversationImportsDir(student), { recursive: true });
    fs.mkdirSync(agentConversationExtractsDir(student), { recursive: true });
    fs.mkdirSync(conversationInteractionsDir(student), { recursive: true });
    fs.mkdirSync(conversationAssetsDir(student), { recursive: true });
    fs.mkdirSync(conversationTransactionsDir(student), { recursive: true });
    recoverInterruptedConversationTransactions(student);
    const index = readJsonFile(conversationIndexPath(student), { version: 1, imports: [], extracts: [] });
    const latestImport = Array.isArray(index.imports) ? index.imports[0] : null;
    const latestInteraction = latestImport?.interactionId
      ? readJsonFile(path.join(conversationInteractionsDir(student), `${latestImport.interactionId}.json`), null)
      : null;
    return JSON.stringify({
      ok: true,
      conversationDir: agentConversationDir(student),
      importsDir: agentConversationImportsDir(student),
      extractsDir: agentConversationExtractsDir(student),
      index,
      latestInteraction,
      governance: conversationGovernanceState(student),
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
    if (!String(content || '').trim()) return JSON.stringify({ ok: false, message: '对话历史不能为空。' });
    fs.mkdirSync(agentConversationImportsDir(student), { recursive: true });
    fs.mkdirSync(conversationInteractionsDir(student), { recursive: true });
    fs.mkdirSync(conversationAssetsDir(student), { recursive: true });
    const normalized = normalizeConversationImport({ studentId: student.id, tool: safeTool, content, sourcePath });
    const currentIndex = readJsonFile(conversationIndexPath(student), { version: 2, imports: [], extracts: [] });
    const duplicate = (currentIndex.imports || []).find((item) => item.assetId === normalized.asset.id || item.hash === normalized.asset.contentHash);
    if (duplicate) {
      return JSON.stringify({ ok: true, deduplicated: true, path: duplicate.path, interaction: normalized.interaction, asset: normalized.asset, governance: conversationGovernanceState(student), message: '相同对话已经导入，本次未生成重复记录。' });
    }
    const file = path.join(agentConversationImportsDir(student), `${normalized.asset.id}.md`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, normalized.content, 'utf8');
    normalized.asset.storedPath = file;
    normalized.interaction.assetId = normalized.asset.id;
    writeJsonFile(path.join(conversationInteractionsDir(student), `${normalized.interaction.id}.json`), normalized.interaction);
    writeJsonFile(path.join(conversationAssetsDir(student), `${normalized.asset.id}.json`), normalized.asset);
    refreshConversationIndex(student, {
      type: 'import',
      id: normalized.interaction.id,
      interactionId: normalized.interaction.id,
      assetId: normalized.asset.id,
      path: file,
      sourcePath,
      tool: safeTool,
      importedAt: normalized.asset.importedAt,
      hash: normalized.asset.contentHash,
      size: normalized.asset.size,
      messageCount: normalized.interaction.messageCount,
    });
    appendAgentSourceRecord(student, {
      assetType: 'conversation',
      tool: safeTool,
      sourceType: sourcePath ? 'fileImport' : 'manualPaste',
      sourcePath,
      targetPath: file,
      hash: normalized.asset.contentHash,
      confidence: 70,
      notes: `导入对话历史；Interaction ${normalized.interaction.id}；ConversationAsset ${normalized.asset.id}`,
    });
    return JSON.stringify({ ok: true, path: file, interaction: normalized.interaction, asset: normalized.asset, governance: conversationGovernanceState(student), message: `已保存不可变对话资产，共定位 ${normalized.interaction.messageCount} 条消息。` });
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
    let parsed = {};
    try {
      parsed = JSON.parse(extractJsonLikeText(extractJson || '{}'));
    } catch {
      return JSON.stringify({ ok: false, message: '提取结果不是有效 JSON。请确认只粘贴 JSON，或包含 JSON 的代码块。' });
    }
    const index = readJsonFile(conversationIndexPath(student), { version: 2, imports: [], extracts: [] });
    const latestImport = Array.isArray(index.imports) ? index.imports[0] : null;
    if (!latestImport?.assetId) return JSON.stringify({ ok: false, message: '请先保存对话导入记录，再提交 AI 提取候选。' });
    const asset = readJsonFile(path.join(conversationAssetsDir(student), `${latestImport.assetId}.json`), null);
    const interaction = readJsonFile(path.join(conversationInteractionsDir(student), `${latestImport.interactionId}.json`), null);
    if (!asset || !interaction || !asset.storedPath || !fs.existsSync(asset.storedPath)) {
      return JSON.stringify({ ok: false, message: '原始对话资产不完整，无法建立可追溯候选。' });
    }
    const sourceContent = readSmallTextFile(asset.storedPath, 5 * 1024 * 1024);
    const built = buildKnowledgeCandidates(parsed, {
      studentId: student.id,
      tool: safeTool,
      source: { ...asset, assetId: asset.id, interactionId: interaction.id, validMessageIds: (interaction.messages || []).map((item) => item.id) },
      sourceContent,
    });
    if (!built.candidates.length) return JSON.stringify({ ok: false, message: '提取结果中没有有效的逐条知识候选。' });
    const currentRegistry = readConversationCandidateRegistry(student);
    const merged = mergeCandidateRegistry(currentRegistry, built.candidates);
    writeConversationCandidateRegistry(student, merged.registry);
    fs.mkdirSync(agentConversationExtractsDir(student), { recursive: true });
    const extractId = stableGovernanceId('conversation-extract', student.id, asset.id, sha256Text(JSON.stringify(parsed)));
    const extractFile = path.join(agentConversationExtractsDir(student), `${extractId}.json`);
    if (!fs.existsSync(extractFile)) writeJsonFile(extractFile, { schema: 'edu-manager.conversation-extract.v2', id: extractId, studentId: String(student.id), interactionId: interaction.id, assetId: asset.id, tool: safeTool, parsed, candidateIds: built.candidates.map((item) => item.id), createdAt: new Date().toISOString() });
    refreshConversationIndex(student, {
      type: 'extract',
      id: extractId,
      path: extractFile,
      tool: safeTool,
      importedAt: new Date().toISOString(),
      hash: sha256Text(JSON.stringify(parsed)),
      interactionId: interaction.id,
      assetId: asset.id,
      memoryCount: built.candidates.filter((item) => item.target === 'memory').length,
      soulCount: built.candidates.filter((item) => item.target === 'soul').length,
      qaCount: built.candidates.filter((item) => item.target === 'qa').length,
      todoCount: built.candidates.filter((item) => item.target === 'todo').length,
      candidateCount: built.candidates.length,
    });
    appendAgentSourceRecord(student, {
      assetType: 'extract',
      tool: safeTool,
      sourceType: 'conversationExtract',
      sourcePath: asset.storedPath,
      targetPath: extractFile,
      hash: sha256Text(JSON.stringify(parsed)),
      confidence: 80,
      confirmed: false,
      notes: `对话提取仅生成候选：新增 ${merged.added.length} 条，重复 ${merged.duplicates.length} 条`,
    });
    return JSON.stringify({ ok: true, path: extractFile, added: merged.added.length, duplicates: merged.duplicates.length, candidates: merged.added, governance: conversationGovernanceState(student), message: `已生成 ${merged.added.length} 条逐条候选，跳过 ${merged.duplicates.length} 条重复内容；未写入正式长期知识。` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `保存对话提取失败：${error.message}` });
  }
}

function updateConversationKnowledgeCandidate(studentId, candidateId, action, payloadJson = '{}') {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const payload = parseJsonObject(payloadJson || '{}');
    const registry = readConversationCandidateRegistry(student);
    const candidates = Array.isArray(registry.candidates) ? registry.candidates : [];
    const index = candidates.findIndex((item) => String(item.id) === String(candidateId));
    if (index < 0) return JSON.stringify({ ok: false, message: '未找到知识候选。' });
    if (action === 'merge') {
      const targetIndex = candidates.findIndex((item) => String(item.id) === String(payload.targetId));
      if (targetIndex < 0 || targetIndex === index) return JSON.stringify({ ok: false, message: '请选择另一条有效候选作为合并目标。' });
      const sourceCandidate = candidates[index];
      const targetCandidate = candidates[targetIndex];
      if (sourceCandidate.target !== targetCandidate.target) return JSON.stringify({ ok: false, message: '只有相同知识类型的候选可以合并。' });
      const mergedContent = String(payload.content || `${targetCandidate.content}\n${sourceCandidate.content}`).trim();
      const editedTarget = reassessConversationCandidate(student, updateCandidate(targetCandidate, 'edit', { content: mergedContent, note: `合并候选 ${sourceCandidate.id}` }, new Date().toISOString(), candidateSourceContent(student, targetCandidate)));
      editedTarget.mergedFrom = Array.from(new Set([...(targetCandidate.mergedFrom || []), sourceCandidate.id]));
      candidates[targetIndex] = editedTarget;
      candidates[index] = reassessConversationCandidate(student, updateCandidate(sourceCandidate, 'merge', { targetId: targetCandidate.id, note: String(payload.note || '') }, new Date().toISOString(), candidateSourceContent(student, sourceCandidate)));
    } else {
      candidates[index] = reassessConversationCandidate(student, updateCandidate(candidates[index], action, payload, new Date().toISOString(), candidateSourceContent(student, candidates[index])));
    }
    writeConversationCandidateRegistry(student, { ...registry, candidates });
    return JSON.stringify({ ok: true, candidate: candidates[index], governance: conversationGovernanceState(student), message: '候选状态已更新并保留历史。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `更新知识候选失败：${error.message}` });
  }
}

function conversationPromotionTarget(student, candidate) {
  ensureAgentCenter(student);
  if (candidate.target === 'memory') return agentMemoryUnifiedPath(student);
  if (candidate.target === 'soul') return agentSoulUnifiedPath(student);
  if (candidate.target === 'qa') return path.join(student.summaryPath || getSummaryDir(student.name), '咨询精华库', '对话候选晋升.md');
  return path.join(student.outputPath || path.join(student.rootPath || getStudentRootDir(student.name), '输出结果'), '待办.md');
}

function promoteConversationKnowledgeCandidates(studentId, requestJson = '{}') {
  let appliedTransaction = null;
  let student = null;
  let originalRegistry = null;
  let transactionPath = '';
  try {
    student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const request = parseJsonObject(requestJson || '{}');
    const ids = Array.isArray(request.candidateIds) ? request.candidateIds.map(String) : [];
    if (!ids.length) return JSON.stringify({ ok: false, message: '请至少选择一条待晋升候选。' });
    if (ids.length > MAX_PROMOTION_BATCH) return JSON.stringify({ ok: false, message: `单次最多晋升 ${MAX_PROMOTION_BATCH} 条候选。` });
    const selectedIds = new Set(ids);
    originalRegistry = readConversationCandidateRegistry(student);
    const candidates = (originalRegistry.candidates || []).filter((item) => selectedIds.has(String(item.id)));
    if (candidates.length !== selectedIds.size) return JSON.stringify({ ok: false, message: '部分候选不存在，请刷新后重试。' });
    const blocked = candidates.map((candidate) => ({ candidate, check: canPromoteCandidate(candidate) })).filter((item) => !item.check.ok);
    if (blocked.length) return JSON.stringify({ ok: false, blocked: blocked.map((item) => ({ id: item.candidate.id, reason: item.check.reason })), message: `有 ${blocked.length} 条候选缺少证据、存在冲突或尚未确认风险，本次未写入任何正式知识。` });
    const promotedAt = new Date().toISOString();
    const transactionId = `knowledge-promotion-${promotedAt.replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(4).toString('hex')}`;
    transactionPath = path.join(conversationTransactionsDir(student), `${transactionId}.json`);
    fs.mkdirSync(conversationTransactionsDir(student), { recursive: true });
    writeJsonFile(transactionPath, { schema: 'edu-manager.knowledge-promotion-transaction.v1', id: transactionId, studentId: String(student.id), status: 'preparing', promotedAt, candidateIds: candidates.map((item) => item.id), operations: [] });
    appliedTransaction = applyPromotionTransaction({
      transactionId,
      studentId: student.id,
      candidates,
      resolveTarget: (candidate) => conversationPromotionTarget(student, candidate),
      promotedAt,
      onProgress: (transaction) => writeJsonFile(transactionPath, transaction),
    });
    const nextCandidates = (originalRegistry.candidates || []).map((candidate) => {
      if (!selectedIds.has(String(candidate.id))) return candidate;
      return {
        ...candidate,
        status: 'promoted',
        promotionTransactionId: transactionId,
        promotedAt,
        updatedAt: promotedAt,
        history: [...(candidate.history || []), { action: 'promote', from: candidate.status, to: 'promoted', at: promotedAt, actorRole: 'administrator', actorId: 'local-user', transactionId }],
      };
    });
    writeConversationCandidateRegistry(student, { ...originalRegistry, candidates: nextCandidates });
    writeJsonFile(transactionPath, appliedTransaction);
    appendHostTimeline({ type: 'conversation_knowledge_promoted', title: 'Conversation knowledge promoted', detail: `${student.name} ${transactionId}`, studentId: String(student.id), studentName: student.name, count: candidates.length });
    return JSON.stringify({ ok: true, transaction: appliedTransaction, governance: conversationGovernanceState(student), message: `已通过一个可撤销事务晋升 ${candidates.length} 条知识候选。` });
  } catch (error) {
    if (appliedTransaction) {
      try { rollbackPromotionTransaction(appliedTransaction); } catch { /* transaction file remains for recovery */ }
    }
    if (student && originalRegistry) {
      try { writeConversationCandidateRegistry(student, originalRegistry); } catch { /* recovery metadata remains */ }
    }
    if (transactionPath) {
      try {
        const current = readJsonFile(transactionPath, {});
        writeJsonFile(transactionPath, { ...current, status: 'failed_rolled_back', failedAt: new Date().toISOString(), error: error.message });
      } catch { /* preserve the last recoverable journal */ }
    }
    return JSON.stringify({ ok: false, message: `知识候选晋升失败，已尝试回滚：${error.message}` });
  }
}

function rollbackConversationPromotion(studentId, transactionId) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const transactionPath = path.join(conversationTransactionsDir(student), `${path.basename(String(transactionId || ''))}.json`);
    const transaction = readJsonFile(transactionPath, null);
    if (!transaction) return JSON.stringify({ ok: false, message: '未找到晋升事务。' });
    const registry = readConversationCandidateRegistry(student);
    const originalRegistry = JSON.parse(JSON.stringify(registry));
    const reversed = rollbackPromotionTransaction(transaction);
    const reversedAt = reversed.reversedAt;
    registry.candidates = (registry.candidates || []).map((candidate) => candidate.promotionTransactionId === transaction.id
      ? { ...candidate, status: 'revoked', revokedAt: reversedAt, updatedAt: reversedAt, history: [...(candidate.history || []), { action: 'revoke', from: 'promoted', to: 'revoked', at: reversedAt, actorRole: 'administrator', actorId: 'local-user', transactionId: transaction.id }] }
      : candidate);
    try {
      writeConversationCandidateRegistry(student, registry);
      writeJsonFile(transactionPath, reversed);
    } catch (error) {
      reapplyPromotionTransaction(transaction);
      writeConversationCandidateRegistry(student, originalRegistry);
      throw error;
    }
    appendHostTimeline({ type: 'conversation_knowledge_reversed', title: 'Conversation knowledge reversed', detail: `${student.name} ${transaction.id}`, studentId: String(student.id), studentName: student.name, count: transaction.candidateIds?.length || 0 });
    return JSON.stringify({ ok: true, transaction: reversed, governance: conversationGovernanceState(student), message: `已撤销事务，正式文件和候选索引同步恢复；原始对话保持不变。` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `撤销知识晋升失败：${error.message}` });
  }
}

function ingestKnowledgeCandidateEnvelope(studentId, envelopeJson = '{}') {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const envelope = parseJsonObject(envelopeJson || '{}');
    const allowedSourceTypes = new Set(['conversation', 'screenshot', 'web', 'agent_result', 'manual']);
    const sourceType = String(envelope.source?.type || envelope.sourceType || 'agent_result');
    if (!allowedSourceTypes.has(sourceType)) return JSON.stringify({ ok: false, message: '不支持的候选来源类型。' });
    const sourceContent = String(envelope.sourceContent || '');
    const sourceUri = String(envelope.source?.sourceUri || envelope.sourceUri || '').trim();
    const contentHash = String(envelope.source?.contentHash || envelope.contentHash || (sourceContent ? sha256Text(sourceContent) : '')).trim();
    if (!sourceUri || !contentHash) return JSON.stringify({ ok: false, message: '多源候选必须提供稳定来源 URI 和内容哈希。' });
    const sourceId = String(envelope.source?.sourceId || stableGovernanceId(`${sourceType}-asset`, student.id, sourceUri, contentHash));
    const source = { ...(envelope.source || {}), type: sourceType, sourceType, sourceId, assetId: sourceId, sourceUri, contentHash };
    const built = buildKnowledgeCandidates(envelope, { studentId: student.id, tool: envelope.tool || 'qclaw', source, sourceContent });
    if (!built.candidates.length) return JSON.stringify({ ok: false, message: '没有可登记的逐条候选。' });
    fs.mkdirSync(conversationAssetsDir(student), { recursive: true });
    const assetPath = path.join(conversationAssetsDir(student), `${sourceId}.json`);
    if (!fs.existsSync(assetPath)) writeJsonFile(assetPath, { schema: 'edu-manager.multi-source-asset.v1', id: sourceId, studentId: String(student.id), ...source, immutable: true, registeredAt: new Date().toISOString() });
    const merged = mergeCandidateRegistry(readConversationCandidateRegistry(student), built.candidates);
    writeConversationCandidateRegistry(student, merged.registry);
    return JSON.stringify({ ok: true, added: merged.added.length, duplicates: merged.duplicates.length, governance: conversationGovernanceState(student), message: `已将 ${sourceType} 来源登记为 ${merged.added.length} 条统一知识候选。` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `登记多源知识候选失败：${error.message}` });
  }
}

function readStudentsIndex() {
  try {
    const parsed = JSON.parse(fs.readFileSync(studentsPath(), 'utf8'));
    const input = Array.isArray(parsed) ? parsed : [];
    const ensured = ensureStudentLoginIds(input);
    if (ensured.changed) writeStudentsIndex(ensured.students);
    return ensured.students;
  } catch {
    return [];
  }
}

function getStudentsIndex() {
  return JSON.stringify({ ok: true, students: readStudentsIndex() });
}

function writeStudentsIndex(students) {
  writeJsonAtomic(studentsPath(), students);
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
    loginId: String(student.loginId || ''),
    loginIdVersion: Number(student.loginIdVersion || 1),
    loginIdIssuedAt: String(student.loginIdIssuedAt || ''),
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
    const existingById = new Map(readStudentsIndex().map((student) => [String(student.id), student]));
    const merged = parsed.map((student) => {
      const existing = existingById.get(String(student.id));
      return toHostStudent({
        ...student,
        loginId: student.loginId || existing?.loginId || '',
        loginIdVersion: student.loginIdVersion || existing?.loginIdVersion || 1,
        loginIdIssuedAt: student.loginIdIssuedAt || existing?.loginIdIssuedAt || '',
      });
    });
    const ensured = ensureStudentLoginIds(merged);
    const students = ensured.students;
    writeStudentsIndex(students);
    const validIds = new Set(students.map((student) => String(student.id)));
    const migrated = migrateTerminalDevices(readDevices(), Array.from(validIds));
    if (migrated.changed) writeDevices(migrated.devices);
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
  const uploadRecords = readUploadRecords();
  const recordsByStudent = new Map();
  for (const record of uploadRecords) {
    const studentId = String(record.studentId || '');
    if (!recordsByStudent.has(studentId)) recordsByStudent.set(studentId, []);
    recordsByStudent.get(studentId).push(record);
  }
  return readStudentsIndex().map((student) => {
    const rawPath = student.rawPath || getRawDir(student.name);
    const summaryPath = student.summaryPath || getSummaryDir(student.name);
    const records = recordsByStudent.get(String(student.id)) || [];
    const state = readStudentDigestState(student);
    return {
      id: String(student.id),
      name: student.name,
      loginId: student.loginId || '',
      loginQrPayload: student.loginId ? studentLoginQrPayload(student.loginId) : '',
      rawFileCount: hostDirectoryCountCache.count(rawPath, 'all'),
      archiveFileCount: hostDirectoryCountCache.count(summaryPath, 'markdown', (name) => name.toLowerCase().endsWith('.md')),
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

function importFiles(studentKey, targetJson = '') {
  const student = findStudentByKey(studentKey);
  if (!student) return JSON.stringify({ ok: false, imported: 0, message: '未找到学生。' });
  const cleanName = sanitizeName(student.name || studentKey);
  let requestedTarget = {};
  try { requestedTarget = JSON.parse(targetJson || '{}'); } catch { requestedTarget = {}; }
  const targetProject = requestedTarget.type === 'project'
    ? readProjects().map(normalizeProject).find((item) => String(item.id) === String(requestedTarget.id || ''))
    : null;
  if (requestedTarget.type === 'project' && (!targetProject || !(targetProject.studentIds || []).map(String).includes(String(student.id)))) {
    return JSON.stringify({ ok: false, imported: 0, message: '所选项目不存在或未绑定当前学生。' });
  }
  if (targetProject?.status === 'sealed') {
    return JSON.stringify({ ok: false, imported: 0, message: '所选项目已封存，不能继续导入资料。' });
  }
  dialog.showOpenDialog(mainWindow, {
    title: '选择要导入的学习资料',
    properties: ['openFile', 'multiSelections'],
  }).then((result) => {
    if (result.canceled || !result.filePaths.length) {
      notify('onNativeImportResult', { ok: false, imported: 0, message: '未选择资料。' });
      return;
    }
    const ensuredProject = targetProject ? ensureProjectWorkspace(targetProject) : null;
    const targetDir = ensuredProject?.rawPath || student.rawPath || getRawDir(cleanName);
    const targetName = ensuredProject ? `${ensuredProject.name}项目原始资料库` : `${cleanName}原始资料库`;
    fs.mkdirSync(targetDir, { recursive: true });
    let imported = 0;
    const saved = [];
    for (const source of result.filePaths) {
      try {
        const target = uniqueFile(targetDir, path.basename(source).replace(/[\\/:*?"<>|]/g, '_'));
        fs.copyFileSync(source, target);
        const stat = fs.statSync(target);
        const record = {
          id: `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
          studentId: String(student.id),
          studentName: student.name || cleanName,
          filename: path.basename(target),
          size: stat.size,
          path: target,
          rawPath: targetDir,
          sha1: sha1File(target),
          sourcePath: source,
          sourceName: '主机手动导入',
          sourceType: 'host_manual_import',
          deviceId: 'admin',
          deviceName: '主机控制台',
          uploadedAt: new Date().toISOString(),
        };
        if (ensuredProject) {
          const asset = upsertAssetFromFile(target, {
            studentId: String(student.id),
            studentName: student.name,
            projectId: ensuredProject.id,
            projectName: ensuredProject.name,
            spaceType: 'project',
            sourcePath: source,
            sourceName: record.sourceName,
            sourceType: record.sourceType,
            role: 'project_raw_direct',
            referenceId: `${ensuredProject.id}-manual-${record.sha1 || crypto.randomBytes(4).toString('hex')}`,
          });
          record.assetId = asset?.assetId || '';
          record.projectId = ensuredProject.id;
          record.projectName = ensuredProject.name;
        }
        saved.push(record);
        imported += 1;
      } catch {
        // Continue copying the rest.
      }
    }
    if (saved.length) {
      if (ensuredProject) {
        const now = new Date().toISOString();
        const digestState = writeProjectDigestState(ensuredProject, {
          status: 'pending',
          message: `有 ${saved.length} 份主机导入资料待消化。`,
          triggerReason: 'host_manual_import',
        });
        writeProjects(readProjects().map(normalizeProject).map((item) => String(item.id) === String(ensuredProject.id)
          ? projectWithNewInputs({ ...item, assetIds: mergeUnique([...(item.assetIds || []), ...saved.map((record) => record.assetId)]), digestState, updatedAt: now }, 'host_manual_import', now)
          : item));
      } else {
        addUploadRecords(saved);
      }
      notify('onNativeHostServiceChanged', getHostServiceStatus());
    }
    notify('onNativeImportResult', {
      ok: imported > 0,
      imported,
      message: imported > 0 ? `已导入 ${imported} 个文件到「${targetName}」。` : '没有文件被成功导入。',
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

function openGrowthModelDir(studentId) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const dir = growthModelDirForStudent(student);
    ensureGrowthModelForStudent(student);
    shell.openPath(dir).catch(() => {});
    return JSON.stringify({ ok: true, path: dir, message: '已打开成长模型目录。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `打开成长模型目录失败：${error.message}` });
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

function projectKnowledgeCategoryForFile(project, filePath) {
  const categories = [
    ['concept', project.conceptPath],
    ['entity', project.entityPath],
    ['summary', project.summaryPath],
    ['qa', project.qaPath],
    ['synthesis', project.synthesisPath],
  ];
  const resolvedFile = path.resolve(filePath);
  const match = categories.find(([, categoryPath]) => categoryPath && isPathInside(path.resolve(categoryPath), resolvedFile));
  return match?.[0] || 'other';
}

function listProjectKnowledgeFiles(projectId) {
  try {
    const project = readProjects().map(normalizeProject).find((item) => String(item.id) === String(projectId));
    if (!project) return JSON.stringify({ ok: false, files: [], message: '未找到学习项目。' });
    const root = path.resolve(project.knowledgeRootPath);
    if (!fs.existsSync(root)) return JSON.stringify({ ok: false, files: [], folder: root, message: `未找到项目知识空间：${root}` });
    const files = [];
    collectMarkdownFiles(root, root, files, 8);
    const categorizedFiles = files.map((file) => ({
      ...file,
      category: projectKnowledgeCategoryForFile(project, file.id),
    })).sort((left, right) => Number(right.modified || 0) - Number(left.modified || 0));
    return JSON.stringify({ ok: true, projectId: project.id, folder: root, files: categorizedFiles, message: `已读取 ${categorizedFiles.length} 份项目知识文档。` });
  } catch (error) {
    return JSON.stringify({ ok: false, files: [], message: `读取项目知识空间失败：${error.message}` });
  }
}

function readProjectKnowledgeFile(projectId, documentId) {
  try {
    const project = readProjects().map(normalizeProject).find((item) => String(item.id) === String(projectId));
    if (!project) return JSON.stringify({ ok: false, message: '未找到学习项目。' });
    const root = path.resolve(project.knowledgeRootPath);
    const target = path.resolve(String(documentId || ''));
    if (!target.toLowerCase().endsWith('.md') || !isPathInside(root, target)) {
      return JSON.stringify({ ok: false, message: '该文件不在当前项目知识空间的 Markdown 浏览范围内。' });
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return JSON.stringify({ ok: false, message: '未找到项目知识文档。' });
    return JSON.stringify({ ok: true, content: fs.readFileSync(target, 'utf8'), path: target });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `读取项目知识文档失败：${error.message}` });
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
    const rebuilt = JSON.parse(rebuildGrowthIndex(student.id));
    return JSON.stringify({
      ok: true,
      folder: result.dir,
      created: result.created,
      index: rebuilt.index,
      content: rebuilt.content,
      message: result.created.length ? `已补建成长模型文件：${result.created.join('、')}，并升级结构化索引。` : '成长模型文件已存在，结构化索引已刷新。',
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

function readRequestBuffer(request, maxBytes = MAX_UPLOAD_BYTES + 1024 * 1024) {
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
  const studentSession = studentSessionByBearerToken(token);
  if (studentSession) {
    touchDevice(studentSession.device.id, request);
    return {
      type: 'student_session',
      sessionId: studentSession.sessionId,
      sessionTokenHash: studentSession.tokenHash,
      deviceId: studentSession.device.id,
      deviceName: studentSession.device.name || '学生终端',
      terminalMode: studentSession.terminalMode,
      studentId: String(studentSession.student.id),
      allowedStudentIds: [String(studentSession.student.id)],
      allowedAllStudents: false,
    };
  }
  const device = deviceByBearerToken(token);
  if (!device) return null;
  touchDevice(device.id, request);
  return {
    type: 'device',
    deviceId: device.id,
    deviceName: device.name || '学生终端',
    terminalMode: normalizeTerminalMode(device.terminalMode, 'shared'),
    boundStudentId: String(device.boundStudentId || ''),
    allowedStudentIds: normalizeTerminalMode(device.terminalMode, 'shared') === 'personal' && device.boundStudentId ? [String(device.boundStudentId)] : [],
    allowedAllStudents: false,
  };
}

function requireAuth(request, response) {
  const auth = authContext(request);
  if (!auth) {
    sendJson(response, 401, { ok: false, message: 'Unauthorized' });
    return false;
  }
  const locked = licenseRequiredPayload('学生终端协作服务');
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
  if (auth.type === 'student_session') return String(auth.studentId) === String(studentId);
  if (auth.type === 'device' && auth.terminalMode === 'shared') return false;
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

function terminalStudentRecord(student) {
  const rawPath = student.rawPath || getRawDir(student.name);
  const summaryPath = student.summaryPath || getSummaryDir(student.name);
  const records = readUploadRecords().filter((record) => String(record.studentId) === String(student.id));
  const state = readStudentDigestState(student);
  return {
    ...student,
    loginQrPayload: studentLoginQrPayload(student.loginId),
    rawFileCount: countFiles(rawPath),
    archiveFileCount: countMarkdownFiles(summaryPath),
    pendingDigestCount: records.filter((record) => normalizeUploadStatus(record.status) === 'pending_digest').length,
    submittedDigestCount: records.filter((record) => ['submitted', 'digesting'].includes(normalizeUploadStatus(record.status))).length,
    processedDigestCount: records.filter((record) => normalizeUploadStatus(record.status) === 'processed').length,
    lastDigestAt: state.lastDigestAt || '',
    digestStatus: state.status || 'idle',
    digestMessage: state.message || '',
  };
}

function studentSessionStatePayload(session, student) {
  const requestLike = { authContext: { type: 'student_session', studentId: String(student.id), allowedStudentIds: [String(student.id)] } };
  const projects = readProjects().map(normalizeProject).filter((project) => projectAllowed(requestLike, project));
  return {
    session: publicStudentSession(session),
    student: terminalStudentRecord(student),
    students: [terminalStudentRecord(student)],
    projects,
  };
}

function loginIdFromRequestValue(value) {
  const input = String(value || '').trim();
  if (input.startsWith('{')) {
    try {
      const payload = JSON.parse(input);
      if (payload?.type === 'AI_EDU_STUDENT_LOGIN') return normalizeStudentLoginId(payload.loginId);
    } catch {}
  }
  return normalizeStudentLoginId(input);
}

async function handleStudentSessionLogin(request, response) {
  if (!requireAuth(request, response)) return;
  if (request.authContext?.type !== 'device') {
    sendJson(response, 403, { ok: false, message: '请使用已配对学生终端进入学生档案。' });
    return;
  }
  try {
    const body = await parseJsonBody(request);
    const loginId = loginIdFromRequestValue(body.loginId || body.qrPayload);
    if (!isValidStudentLoginId(loginId)) {
      sendJson(response, 400, { ok: false, message: '学生 ID 格式或校验位不正确，请重新输入或扫码。' });
      return;
    }
    const students = readStudentsIndex();
    const student = students.find((item) => normalizeStudentLoginId(item.loginId) === loginId);
    if (!student) {
      sendJson(response, 404, { ok: false, message: '没有找到该学生 ID，请向教师或家长核对。' });
      return;
    }
    const devices = readDevices();
    const index = devices.findIndex((item) => String(item.id) === String(request.authContext.deviceId));
    if (index < 0) {
      sendJson(response, 404, { ok: false, message: '没有找到当前终端设备。' });
      return;
    }
    const terminalMode = normalizeTerminalMode(devices[index].terminalMode, 'shared');
    if (terminalMode === 'personal' && devices[index].boundStudentId && String(devices[index].boundStudentId) !== String(student.id)) {
      sendJson(response, 409, { ok: false, message: '该个人终端已经绑定其他学生，请先在系统设置中解除绑定。' });
      return;
    }
    if (terminalMode === 'personal' && !devices[index].boundStudentId) {
      devices[index] = {
        ...devices[index],
        boundStudentId: String(student.id),
        allowedStudentIds: [String(student.id)],
        allowedAllStudents: false,
        autoAuthorizeNewStudents: false,
        modeUpdatedAt: new Date().toISOString(),
      };
      writeDevices(devices);
    }
    const device = devices[index];
    const created = createStudentSession(device, student);
    appendHostTimeline({ type: 'student_session_started', title: 'Student session started', deviceId: device.id, studentId: student.id, studentName: student.name, detail: terminalMode });
    sendJson(response, 200, { ok: true, token: created.token, terminalMode, ...studentSessionStatePayload(created.session, student), message: `已进入 ${student.name} 的学习空间。` });
  } catch (error) {
    sendJson(response, 400, { ok: false, message: `进入学生档案失败：${error.message}` });
  }
}

function handleStudentSessionAuto(request, response) {
  if (!requireAuth(request, response)) return;
  if (request.authContext?.type !== 'device') {
    sendJson(response, 403, { ok: false, message: '请使用已配对学生终端。' });
    return;
  }
  const device = readDevices().find((item) => String(item.id) === String(request.authContext.deviceId));
  if (!device || normalizeTerminalMode(device.terminalMode, 'shared') !== 'personal' || !device.boundStudentId) {
    sendJson(response, 409, { ok: false, requiresLogin: true, message: '个人终端尚未绑定学生，请扫码或输入学生 ID。' });
    return;
  }
  const student = findStudent(device.boundStudentId);
  if (!student) {
    sendJson(response, 404, { ok: false, requiresLogin: true, message: '原绑定学生已经不存在，请重新绑定。' });
    return;
  }
  const created = createStudentSession(device, student);
  sendJson(response, 200, { ok: true, token: created.token, terminalMode: 'personal', ...studentSessionStatePayload(created.session, student), message: `已自动进入 ${student.name} 的学习空间。` });
}

function handleStudentSessionMe(request, response) {
  if (!requireAuth(request, response)) return;
  if (request.authContext?.type !== 'student_session') {
    sendJson(response, 401, { ok: false, requiresLogin: true, message: '请先扫码或输入学生 ID。' });
    return;
  }
  const student = findStudent(request.authContext.studentId);
  const session = [...studentSessions.values()].find((item) => item.sessionId === request.authContext.sessionId);
  if (!student || !session) {
    sendJson(response, 401, { ok: false, requiresLogin: true, message: '学生会话已结束，请重新进入。' });
    return;
  }
  sendJson(response, 200, { ok: true, ...studentSessionStatePayload(session, student) });
}

function handleStudentSessionLogout(request, response) {
  if (!requireAuth(request, response)) return;
  if (request.authContext?.type === 'student_session') {
    studentSessions.delete(request.authContext.sessionTokenHash);
    appendHostTimeline({ type: 'student_session_ended', title: 'Student session ended', deviceId: request.authContext.deviceId, studentId: request.authContext.studentId });
  }
  sendJson(response, 200, { ok: true, message: '已退出当前学生。' });
}

async function handleDeviceMode(request, response) {
  if (!requireAuth(request, response)) return;
  if (request.authContext?.type !== 'device') {
    sendJson(response, 403, { ok: false, message: '只有学生终端可以切换终端模式。' });
    return;
  }
  const devices = readDevices();
  const index = devices.findIndex((item) => String(item.id) === String(request.authContext.deviceId));
  if (index < 0) {
    sendJson(response, 404, { ok: false, message: '没有找到当前终端设备。' });
    return;
  }
  if (request.method === 'GET') {
    sendJson(response, 200, { ok: true, device: publicDevice(devices[index]) });
    return;
  }
  try {
    const body = await parseJsonBody(request);
    const terminalMode = normalizeTerminalMode(body.terminalMode, 'shared');
    devices[index] = {
      ...devices[index],
      terminalMode,
      boundStudentId: terminalMode === 'personal' ? String(devices[index].boundStudentId || '') : '',
      allowedStudentIds: terminalMode === 'personal' && devices[index].boundStudentId ? [String(devices[index].boundStudentId)] : [],
      allowedAllStudents: terminalMode === 'shared',
      autoAuthorizeNewStudents: terminalMode === 'shared',
      modeUpdatedAt: new Date().toISOString(),
    };
    clearStudentSessionsForDevice(devices[index].id);
    writeDevices(devices);
    notify('onNativeHostServiceChanged', getHostServiceStatus());
    sendJson(response, 200, { ok: true, device: publicDevice(devices[index]), message: terminalMode === 'shared' ? '已切换为共享终端。' : (devices[index].boundStudentId ? '已切换为个人终端。' : '已切换为个人终端，请输入学生 ID 完成绑定。') });
  } catch (error) {
    sendJson(response, 400, { ok: false, message: `切换终端模式失败：${error.message}` });
  }
}

function handleStudents(request, response) {
  if (!requireAuth(request, response)) return;
  const students = readStudentsIndex().filter((student) => isStudentAllowed(request, student.id)).map(terminalStudentRecord);
  const auth = request.authContext;
  const requiresStudentLogin = auth.type === 'device' && auth.terminalMode === 'shared';
  const requiresBinding = auth.type === 'device' && auth.terminalMode === 'personal' && !auth.boundStudentId;
  sendJson(response, 200, {
    ok: true,
    students,
    authorization: {
      type: auth.type,
      deviceId: auth.deviceId || '',
      deviceName: auth.deviceName || '',
      terminalMode: auth.terminalMode || '',
      requiresApproval: false,
      requiresStudentLogin,
      requiresBinding,
      allowedStudentCount: auth.type === 'admin' ? readStudentsIndex().length : students.length,
    },
  });
}

function projectAllowed(request, project) {
  if (!request.authContext || request.authContext.type === 'admin') return true;
  if (request.authContext.type === 'device' && request.authContext.terminalMode === 'shared') return false;
  const allowed = new Set(request.authContext.allowedStudentIds || []);
  return (project.studentIds || []).some((id) => allowed.has(String(id)));
}

function handleAssets(request, response) {
  if (!requireAuth(request, response)) return;
  const summary = assetIndexSummary();
  const allowedStudentIds = request.authContext.type === 'admin'
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

async function handleProjectMaterialUpload(request, response, projectId, url) {
  if (!requireAuth(request, response)) return;
  const project = readProjects().map(normalizeProject).find((item) => String(item.id) === String(projectId));
  if (!project) {
    sendJson(response, 404, { ok: false, message: '未找到学习项目。' });
    return;
  }
  if (project.status === 'sealed') {
    sendJson(response, 409, { ok: false, message: '项目已封存，请先在主机端恢复为“进行中”后再上传资料。' });
    return;
  }
  if (!projectAllowed(request, project)) {
    sendJson(response, 403, { ok: false, message: '当前设备没有访问该学习项目的权限。' });
    return;
  }
  const requestedStudentId = String(url?.searchParams?.get('studentId') || '').trim();
  const studentId = request.authContext?.type === 'student_session' ? String(request.authContext.studentId) : requestedStudentId;
  if (request.authContext?.type === 'student_session' && requestedStudentId && requestedStudentId !== studentId) {
    sendJson(response, 403, { ok: false, message: '资料目标与当前学生会话不一致。' });
    return;
  }
  const student = studentId ? findStudent(studentId) : null;
  if (studentId && (!student || !isStudentAllowed(request, studentId))) {
    sendJson(response, 403, { ok: false, message: '当前设备没有访问该学生档案的权限。' });
    return;
  }
  if (studentId && !(project.studentIds || []).map(String).includes(studentId)) {
    sendJson(response, 400, { ok: false, message: '该学生未绑定到当前学习项目。' });
    return;
  }
  try {
    const ensured = ensureProjectWorkspace(project);
    const contentType = String(request.headers['content-type'] || '');
    const multipart = /multipart\/form-data/i.test(contentType);
    const expectedBytes = Number(request.headers['content-length'] || 0);
    const files = multipart
      ? parseMultipartFiles(await readRequestBuffer(request), contentType)
      : [{ filename: url?.searchParams?.get('filename') || 'upload.bin', content: null, streamed: true }];
    if (!files.length) throw new Error('没有收到文件。');
    const saved = [];
    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      const file = files[fileIndex];
      assertUploadFileAllowed(file.filename, file.content?.length || expectedBytes);
      const requestedUploadId = String(url?.searchParams?.get('uploadId') || request.headers['x-upload-id'] || '').trim().slice(0, 180);
      const uploadId = requestedUploadId && files.length === 1 ? requestedUploadId : (requestedUploadId ? `${requestedUploadId}-${fileIndex + 1}` : '');
      const existingAsset = uploadId
        ? readAssetIndex().find((asset) => (asset.references || []).some((reference) => String(reference.id) === uploadId && String(reference.spaceId) === String(ensured.id)))
        : null;
      if (existingAsset) {
        if (file.streamed) request.resume();
        saved.push({
          filename: existingAsset.filename,
          path: existingAsset.path,
          size: existingAsset.size,
          sha1: existingAsset.sha1,
          assetId: existingAsset.assetId,
          uploadId,
          duplicate: true,
        });
        continue;
      }
      const target = uniqueTargetFile(ensured.rawPath, file.filename);
      const streamed = file.streamed
        ? await streamRequestToFile(request, { targetPath: target, maxBytes: MAX_UPLOAD_BYTES, expectedBytes })
        : null;
      if (!streamed) fs.writeFileSync(target, file.content);
      const stat = streamed || fs.statSync(target);
      const asset = upsertAssetFromFile(target, {
        studentId,
        studentName: student?.name || '',
        projectId: ensured.id,
        projectName: ensured.name,
        spaceType: 'project',
        sourceName: request.authContext?.deviceName || '项目上传',
        sourceType: url?.searchParams?.get('sourceType') || 'remote_upload',
        captureSessionId: url?.searchParams?.get('captureSessionId') || '',
        captureItemId: url?.searchParams?.get('captureItemId') || '',
        role: 'project_raw',
        uploadedAt: new Date().toISOString(),
        referenceId: uploadId || `${ensured.id}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      });
      saved.push({
        filename: path.basename(target),
        path: target,
        size: stat.size,
        sha1: asset?.sha1 || streamed?.sha1 || sha1File(target),
        assetId: asset?.assetId || '',
        uploadId,
        duplicate: false,
      });
    }
    const importedCount = saved.filter((file) => !file.duplicate).length;
    const now = new Date().toISOString();
    const digestState = importedCount > 0
      ? writeProjectDigestState(ensured, {
        status: 'pending',
        message: `有 ${importedCount} 份终端上传资料待消化。`,
        triggerReason: 'terminal_upload',
      })
      : readProjectDigestState(ensured);
    const projects = readProjects().map(normalizeProject);
    writeProjects(projects.map((item) => String(item.id) === String(ensured.id)
      ? projectWithNewInputs({
        ...item,
        assetIds: mergeUnique([...(item.assetIds || []), ...saved.map((file) => file.assetId)]),
        digestState,
        updatedAt: now,
      }, 'terminal_upload', now)
      : item));
    resetUploadCounterIfNeeded();
    todayUploadCount += importedCount;
    appendHostTimeline({ type: 'project_materials_uploaded', title: 'Project materials uploaded', detail: ensured.name, studentId, studentName: student?.name || '', count: importedCount });
    notify('onNativeHostServiceChanged', getHostServiceStatus());
    sendJson(response, 200, {
      ok: true,
      targetType: 'project',
      targetId: ensured.id,
      targetName: ensured.name,
      projectId: ensured.id,
      studentId,
      files: saved,
      count: saved.length,
      imported: importedCount,
      duplicates: saved.length - importedCount,
      todayUploadCount,
    });
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
    const uploadId = String(url.searchParams.get('uploadId') || request.headers['x-upload-id'] || '').trim().slice(0, 180);
    const existingUpload = uploadId ? readUploadRecords().find((record) => String(record.uploadId || '') === uploadId && String(record.studentId) === String(studentId)) : null;
    if (existingUpload) {
      request.resume();
      sendJson(response, 200, {
        ok: true,
        duplicate: true,
        imported: 0,
        targetType: 'student',
        targetId: String(studentId),
        targetName: student.name,
        filename: existingUpload.filename,
        path: existingUpload.path,
        rawFileCount: countFiles(rawPath),
        todayUploadCount,
      });
      return;
    }
    const saved = [];
    if (/multipart\/form-data/i.test(contentType)) {
      const buffer = await readRequestBuffer(request);
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
      const expectedBytes = Number(request.headers['content-length'] || 0);
      assertUploadFileAllowed(filename, expectedBytes);
      const target = uniqueTargetFile(rawPath, filename);
      const streamed = await streamRequestToFile(request, { targetPath: target, maxBytes: MAX_UPLOAD_BYTES, expectedBytes });
      saved.push({ filename: path.basename(target), path: target, size: streamed.size, sha1: streamed.sha1 });
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
      sha1: item.sha1 || sha1File(item.path),
      deviceId: request.authContext?.deviceId || 'admin',
      deviceName: request.authContext?.deviceName || '主机控制台',
      sourceType: url.searchParams.get('sourceType') || 'remote_upload',
      captureSessionId: url.searchParams.get('captureSessionId') || '',
      captureItemId: url.searchParams.get('captureItemId') || '',
      uploadId,
      uploadedAt: new Date().toISOString(),
    })));
    const rawFileCount = countFiles(rawPath);
    notify('onNativeHostServiceChanged', getHostServiceStatus());
    sendJson(response, 200, {
      ok: true,
      targetType: 'student',
      targetId: String(studentId),
      targetName: student.name,
      imported: saved.length,
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
function enrollPairedTablet(input = {}, request = null) {
  const license = publicLicenseStatus();
  if (!license.active) return { ok: false, statusCode: 402, message: license.message || 'Windows 主机尚未激活。', license };
  const tabletId = String(input.tabletId || '').trim().slice(0, 120);
  const tabletCode = String(input.tabletMachineCode || '').trim().toUpperCase();
  if (!tabletId || tabletCode !== machineCode('tablet', tabletId)) {
    return { ok: false, statusCode: 400, message: '平板身份或固定机器码校验失败。' };
  }
  const students = readStudentsIndex();
  if (license.studentLimit && students.length > Number(license.studentLimit)) {
    return { ok: false, statusCode: 403, message: `当前学生数 ${students.length} 已超过授权上限（${license.studentLimit} 位）。`, license };
  }
  const devices = readDevices();
  const conflicting = machineCodeConflict(devices, 'tablet', tabletId, tabletCode);
  if (conflicting) return { ok: false, statusCode: 409, message: '固定机器码与另一设备身份冲突，已拒绝连接。' };
  const existing = devices.find((item) => String(item.id) === tabletId);
  if (existing?.revoked) {
    return { ok: false, statusCode: 403, message: '该设备已被撤销，不能自行恢复；请在主机端手动恢复后重试。' };
  }
  const activeDevices = devices.filter((item) => !item.revoked && String(item.id) !== tabletId);
  if (license.deviceLimit && activeDevices.length >= Number(license.deviceLimit)) {
    return { ok: false, statusCode: 403, message: `授权设备数已达上限（${license.deviceLimit} 台）。`, license };
  }
  const token = createDeviceToken();
  const now = new Date().toISOString();
  const device = {
    ...(existing || {}),
    id: tabletId,
    name: String(input.tabletName || existing?.name || 'Android 平板').trim().slice(0, 80) || 'Android 平板',
    machineCode: tabletCode,
    tokenHash: hashDeviceToken(token),
    tokenPreview: `${token.slice(0, 7)}...${token.slice(-6)}`,
    terminalMode: normalizeTerminalMode(existing?.terminalMode, 'shared'),
    boundStudentId: String(existing?.boundStudentId || ''),
    capabilities: Array.from(new Set([...(Array.isArray(existing?.capabilities) ? existing.capabilities : []), 'student-session-v1'])),
    allowedStudentIds: normalizeTerminalMode(existing?.terminalMode, 'shared') === 'personal' && existing?.boundStudentId ? [String(existing.boundStudentId)] : [],
    allowedAllStudents: normalizeTerminalMode(existing?.terminalMode, 'shared') === 'shared',
    autoAuthorizeNewStudents: normalizeTerminalMode(existing?.terminalMode, 'shared') === 'shared',
    revoked: false,
    createdAt: existing?.createdAt || now,
    enrolledAt: now,
    lastSeenAt: now,
    lastIp: request ? requestClientIp(request) : String(input.tabletAddress || existing?.lastIp || ''),
    lastUserAgent: request ? requestUserAgent(request) : String(existing?.lastUserAgent || ''),
    pairedProtocolVersion: PAIR_PROTOCOL_VERSION,
  };
  writeDevices([...devices.filter((item) => String(item.id) !== tabletId), device]);
  appendHostTimeline({ type: 'device_pair_v2_accepted', title: 'Device connection accepted', detail: device.name, deviceId: tabletId });
  return { ok: true, statusCode: 200, token, device, requiresApproval: false, message: '设备已连接。请选择个人终端或共享终端使用方式。' };
}

function savePairRequest(record) {
  const requests = refreshPairRequests();
  const index = requests.findIndex((item) => String(item.requestId) === String(record.requestId));
  const next = index >= 0
    ? requests.map((item, itemIndex) => itemIndex === index ? record : item)
    : [record, ...requests];
  writePairRequests(next);
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  return record;
}

function acceptHostPairRequest(requestId) {
  const requests = refreshPairRequests();
  const current = requests.find((item) => String(item.requestId) === String(requestId));
  if (!current || current.status !== 'pending_host_accept') return JSON.stringify({ ok: false, message: '未找到待主机接受的连接请求。' });
  const transition = nextPairRequestStatus(current, 'accept');
  if (!transition.ok) return JSON.stringify({ ok: false, message: transition.message });
  const enrolled = enrollPairedTablet({
    tabletId: current.tabletId,
    tabletMachineCode: current.tabletMachineCode,
    tabletName: current.tabletName,
    tabletAddress: current.tabletAddress,
  });
  if (!enrolled.ok) return JSON.stringify(enrolled);
  savePairRequest({
    ...transition.request,
    issuedToken: enrolled.token,
    issuedTokenExpiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    deviceId: enrolled.device.id,
  });
  return JSON.stringify({ ok: true, message: enrolled.message, request: publicPairRequest(transition.request), device: publicDevice(enrolled.device), status: JSON.parse(getHostServiceStatus()) });
}

function rejectPairRequest(requestId) {
  const requests = refreshPairRequests();
  const current = requests.find((item) => String(item.requestId) === String(requestId));
  const transition = nextPairRequestStatus(current, 'reject');
  if (!transition.ok) return JSON.stringify({ ok: false, message: transition.message });
  savePairRequest(transition.request);
  appendHostTimeline({ type: 'device_pair_v2_rejected', title: 'Device connection rejected', detail: current?.tabletName || '', deviceId: current?.tabletId || '' });
  return JSON.stringify({ ok: true, message: '已拒绝连接请求。', request: publicPairRequest(transition.request), status: JSON.parse(getHostServiceStatus()) });
}

function inviteLanTablet(tabletId) {
  if (!hostDiscoverySocket) return JSON.stringify({ ok: false, message: '主机局域网发现服务未运行。' });
  const tablet = [...discoveredLanTablets.values()].find((item) => String(item.deviceId) === String(tabletId));
  if (!tablet) return JSON.stringify({ ok: false, message: '未找到该平板，请重新查找。' });
  const identity = getHostIdentity();
  const info = getConnectionInfo();
  const created = createPairRequest({
    initiator: 'host',
    hostId: identity.hostId,
    tabletId: tablet.deviceId,
    hostMachineCode: identity.machineCode,
    tabletMachineCode: tablet.machineCode,
    hostName: identity.displayName,
    tabletName: tablet.displayName,
    hostAddress: info.serverUrl,
    tabletAddress: tablet.address,
  });
  savePairRequest(created.record);
  const payload = Buffer.from(JSON.stringify({
    type: 'AI_EDU_MANAGER_PAIR_INVITE',
    protocolVersion: PAIR_PROTOCOL_VERSION,
    requestId: created.record.requestId,
    requestToken: created.requestToken,
    targetTabletId: tablet.deviceId,
    hostId: identity.hostId,
    hostMachineCode: identity.machineCode,
    hostName: identity.displayName,
    appVersion: APP_VERSION,
    serverUrl: info.serverUrl,
    lanUrls: info.lanUrls,
    port: info.port,
    expiresAt: created.record.expiresAt,
  }), 'utf8');
  try {
    hostDiscoverySocket.send(payload, tablet.discoveryPort || HOST_DISCOVERY_PORT, tablet.address, (error) => {
      if (error) hostServiceLastError = `发送平板连接邀请失败：${error.message}`;
    });
    return JSON.stringify({ ok: true, message: '已发送连接邀请，请在平板端点击接受。', request: publicPairRequest(created.record), status: JSON.parse(getHostServiceStatus()) });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `发送平板连接邀请失败：${error.message}` });
  }
}

async function handlePairRequestV2(request, response) {
  try {
    const body = await parseJsonBody(request);
    const identity = getHostIdentity();
    const tabletId = String(body.tabletId || '').trim().slice(0, 120);
    const tabletCode = String(body.tabletMachineCode || '').trim().toUpperCase();
    if (String(body.hostId || identity.hostId) !== identity.hostId || String(body.hostMachineCode || identity.machineCode) !== identity.machineCode) {
      sendJson(response, 409, { ok: false, message: '目标主机身份不一致，请重新查找主机。' });
      return;
    }
    if (!tabletId || tabletCode !== machineCode('tablet', tabletId) || !body.requestToken || !body.requestId) {
      sendJson(response, 400, { ok: false, message: '连接请求身份信息不完整。' });
      return;
    }
    const existing = readDevices().find((item) => String(item.id) === tabletId);
    if (existing?.revoked) {
      sendJson(response, 403, { ok: false, message: '该设备已被撤销，不能自行恢复。' });
      return;
    }
    const pairRequests = refreshPairRequests();
    const duplicate = pairRequests.find((item) => String(item.requestId) === String(body.requestId));
    if (duplicate) {
      if (!verifyRequestToken(duplicate, body.requestToken)) {
        sendJson(response, 409, { ok: false, message: '请求编号冲突。' });
        return;
      }
      sendJson(response, 200, { ok: true, request: publicPairRequest(duplicate), message: '连接请求已存在。' });
      return;
    }
    const supersededAt = new Date().toISOString();
    const withoutSuperseded = pairRequests.map((item) => {
      if (item.status !== 'pending_host_accept' || String(item.tabletId) !== tabletId) return item;
      return { ...item, status: 'cancelled', updatedAt: supersededAt, cancelledAt: supersededAt, cancelReason: 'superseded' };
    });
    if (JSON.stringify(withoutSuperseded) !== JSON.stringify(pairRequests)) writePairRequests(withoutSuperseded);
    const created = createPairRequest({
      initiator: 'tablet',
      requestId: String(body.requestId),
      requestToken: String(body.requestToken),
      hostId: identity.hostId,
      tabletId,
      hostMachineCode: identity.machineCode,
      tabletMachineCode: tabletCode,
      hostName: identity.displayName,
      tabletName: String(body.tabletName || 'Android 平板'),
      hostAddress: getConnectionInfo().serverUrl,
      tabletAddress: requestClientIp(request),
    });
    savePairRequest(created.record);
    appendHostTimeline({ type: 'device_pair_v2_requested', title: 'Device connection requested', detail: created.record.tabletName, deviceId: tabletId });
    sendJson(response, 202, { ok: true, request: publicPairRequest(created.record), message: '已发送连接请求，请等待主机端接受。' });
  } catch (error) {
    sendJson(response, 400, { ok: false, message: `连接请求失败：${error.message}` });
  }
}

async function handlePairCancelV2(request, response) {
  try {
    const body = await parseJsonBody(request);
    const current = refreshPairRequests().find((item) => String(item.requestId) === String(body.requestId));
    if (!current || !verifyRequestToken(current, body.requestToken)) {
      sendJson(response, 403, { ok: false, message: '连接请求不存在或令牌无效。' });
      return;
    }
    const transition = nextPairRequestStatus(current, 'cancel');
    if (!transition.ok) {
      sendJson(response, 409, { ok: false, message: transition.message, request: publicPairRequest(transition.request) });
      return;
    }
    savePairRequest(transition.request);
    appendHostTimeline({ type: 'device_pair_v2_cancelled', title: 'Device connection request cancelled', detail: current.tabletName || current.requestId, deviceId: current.tabletId || '' });
    sendJson(response, 200, { ok: true, request: publicPairRequest(transition.request), message: '连接请求已取消。' });
  } catch (error) {
    sendJson(response, 400, { ok: false, message: `取消连接失败：${error.message}` });
  }
}

function handlePairStatusV2(request, response, url) {
  const requestId = String(url.searchParams.get('requestId') || '');
  const token = String(url.searchParams.get('requestToken') || '');
  const current = refreshPairRequests().find((item) => String(item.requestId) === requestId);
  if (!current || !verifyRequestToken(current, token)) {
    sendJson(response, 404, { ok: false, message: '连接请求不存在或令牌无效。' });
    return;
  }
  sendJson(response, 200, {
    ok: true,
    request: publicPairRequest(current),
    token: current.status === 'accepted' && Date.parse(current.issuedTokenExpiresAt || 0) > Date.now() ? current.issuedToken || '' : '',
    requiresApproval: current.status === 'accepted',
  });
}

async function handleTabletPairAcceptV2(request, response) {
  try {
    const body = await parseJsonBody(request);
    const requests = refreshPairRequests();
    const current = requests.find((item) => String(item.requestId) === String(body.requestId));
    if (!current || current.status !== 'pending_tablet_accept' || !verifyRequestToken(current, body.requestToken)) {
      sendJson(response, 403, { ok: false, message: '连接邀请无效、已过期或已处理。' });
      return;
    }
    if (String(body.tabletId || '') !== current.tabletId || String(body.tabletMachineCode || '').toUpperCase() !== current.tabletMachineCode.toUpperCase()) {
      sendJson(response, 409, { ok: false, message: '接受邀请的平板身份与目标设备不一致。' });
      return;
    }
    const enrolled = enrollPairedTablet({
      tabletId: current.tabletId,
      tabletMachineCode: current.tabletMachineCode,
      tabletName: body.tabletName || current.tabletName,
      tabletAddress: requestClientIp(request),
    }, request);
    if (!enrolled.ok) {
      sendJson(response, enrolled.statusCode || 400, enrolled);
      return;
    }
    const transition = nextPairRequestStatus(current, 'accept');
    savePairRequest({
      ...transition.request,
      issuedToken: enrolled.token,
      issuedTokenExpiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
      deviceId: enrolled.device.id,
    });
    sendJson(response, 200, { ok: true, token: enrolled.token, requiresApproval: true, message: enrolled.message, device: publicDevice(enrolled.device) });
  } catch (error) {
    sendJson(response, 400, { ok: false, message: `接受连接邀请失败：${error.message}` });
  }
}

async function handlePairRejectV2(request, response) {
  try {
    const body = await parseJsonBody(request);
    const current = refreshPairRequests().find((item) => String(item.requestId) === String(body.requestId));
    if (!current || !verifyRequestToken(current, body.requestToken)) {
      sendJson(response, 403, { ok: false, message: '连接请求不存在或令牌无效。' });
      return;
    }
    const transition = nextPairRequestStatus(current, 'reject');
    if (!transition.ok) {
      sendJson(response, 409, { ok: false, message: transition.message });
      return;
    }
    savePairRequest(transition.request);
    sendJson(response, 200, { ok: true, request: publicPairRequest(transition.request), message: '已拒绝连接邀请。' });
  } catch (error) {
    sendJson(response, 400, { ok: false, message: `拒绝连接失败：${error.message}` });
  }
}

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
    const existingDevice = readDevices().find((item) => String(item.id) === deviceId);
    if (existingDevice?.revoked) {
      sendJson(response, 403, { ok: false, message: '该设备已被撤销，不能通过旧配对码自行恢复；请在主机端手动恢复。' });
      return;
    }
    const activeDevices = readDevices().filter((item) => !item.revoked && String(item.id) !== deviceId);
    if (license.deviceLimit && activeDevices.length >= Number(license.deviceLimit)) {
      sendJson(response, 403, { ok: false, message: `授权设备数已达上限（${license.deviceLimit} 台）。请在 Windows 主机端撤销旧设备或升级授权。`, license });
      return;
    }
    if (license.studentLimit && existingStudents.length > Number(license.studentLimit)) {
      sendJson(response, 403, { ok: false, message: `当前学生数 ${existingStudents.length} 已超过授权上限（${license.studentLimit} 位）。请升级授权或减少学生后再绑定。`, license });
      return;
    }
    const token = createDeviceToken();
    const device = {
      id: deviceId,
      name: String(body.deviceName || body.name || '平板设备').slice(0, 80),
      tokenHash: hashDeviceToken(token),
      tokenPreview: `${token.slice(0, 7)}...${token.slice(-6)}`,
      terminalMode: 'shared',
      boundStudentId: '',
      capabilities: ['student-session-v1'],
      allowedStudentIds: [],
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
      requiresApproval: false,
      message: '设备已登记，默认为共享终端；学生可扫码或输入个人 ID。',
      device: publicDevice(device),
      students: [],
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
      terminalMode: 'shared',
      boundStudentId: '',
      capabilities: ['student-session-v1'],
      allowedStudentIds: [],
      allowedAllStudents: true,
      autoAuthorizeNewStudents: true,
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
      requiresApproval: false,
      message: '设备已登记，默认为共享终端；学生可扫码或输入个人 ID。',
      device: publicDevice(device),
    });
  } catch (error) {
    sendJson(response, 400, { ok: false, message: `设备登记失败：${error.message}` });
  }
}

function handleDeviceHeartbeat(request, response) {
  if (!requireAuth(request, response)) return;
  const auth = request.authContext;
  const device = ['device', 'student_session'].includes(auth?.type)
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
  if (request.method === 'POST' && pathname === '/api/pair/request') {
    handlePairRequestV2(request, response);
    return;
  }
  if (request.method === 'GET' && pathname === '/api/pair/status') {
    handlePairStatusV2(request, response, url);
    return;
  }
  if (request.method === 'POST' && pathname === '/api/pair/tablet-accept') {
    handleTabletPairAcceptV2(request, response);
    return;
  }
  if (request.method === 'POST' && pathname === '/api/pair/reject') {
    handlePairRejectV2(request, response);
    return;
  }
  if (request.method === 'POST' && pathname === '/api/pair/cancel') {
    handlePairCancelV2(request, response);
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
  if (pathname === '/api/device/mode' && ['GET', 'POST'].includes(request.method)) {
    handleDeviceMode(request, response);
    return;
  }
  if (request.method === 'POST' && pathname === '/api/student-session/login') {
    handleStudentSessionLogin(request, response);
    return;
  }
  if (request.method === 'POST' && pathname === '/api/student-session/auto') {
    handleStudentSessionAuto(request, response);
    return;
  }
  if (request.method === 'GET' && pathname === '/api/student-session/me') {
    handleStudentSessionMe(request, response);
    return;
  }
  if (request.method === 'POST' && pathname === '/api/student-session/logout') {
    handleStudentSessionLogout(request, response);
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
    handleProjectMaterialUpload(request, response, projectMaterialMatch[1], url);
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
  const settings = readSettings();
  if (normalizeHostUsageMode(settings.usageMode, 'host') !== 'host_terminal') writeSettings({ ...settings, usageMode: 'host_terminal' });
  ensureApiToken();
  const port = getHostServicePort();
  try {
    hostServer = http.createServer(handleHostRequest);
    hostServer.on('error', (error) => {
      hostServiceLastError = error.message;
      hostServer = null;
      stopHostDiscovery();
      notify('onNativeHostServiceChanged', getHostServiceStatus());
    });
    hostServer.listen(port, '0.0.0.0', () => {
      hostServiceStartedAt = new Date().toISOString();
      hostServiceLastError = '';
      startHostDiscovery();
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
  stopHostDiscovery();
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
  const hostIdentity = getHostIdentity();
  const pairRequests = refreshPairRequests();
  const discoveredTablets = [...discoveredLanTablets.values()]
    .filter((item) => Date.now() - Date.parse(item.lastSeenAt || 0) <= 5 * 60 * 1000)
    .sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
  return JSON.stringify({
    usageMode: getHostUsageMode(),
    running: Boolean(hostServer),
    discoveryRunning: Boolean(hostDiscoverySocket),
    discoveryPort: HOST_DISCOVERY_PORT,
    pairProtocolVersion: PAIR_PROTOCOL_VERSION,
    hostIdentity,
    pairRequests: pairRequests.map(publicPairRequest),
    pendingPairRequestCount: pairRequests.filter((item) => item.status === 'pending_host_accept').length,
    discoveredTablets,
    lastTabletDiscoveryAt,
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
      suggestion: hostServer ? '保持控制台打开即可。' : '在系统设置的“使用模式”中选择“主机-终端模式”，点击“启动服务”。',
    },
    {
      label: '局域网地址',
      ok: info.lanUrls.length > 0,
      detail: info.lanUrls.length > 0 ? info.lanUrls.join('；') : '没有检测到可用于平板访问的局域网地址。',
      suggestion: info.lanUrls.length > 0 ? '平板需连接同一 Wi-Fi，并使用二维码或扫码内容绑定。' : '检查电脑是否连接 Wi-Fi/网线，或稍后刷新服务状态。',
    },
    {
      label: '局域网设备发现',
      ok: Boolean(hostDiscoverySocket),
      detail: hostDiscoverySocket ? `UDP ${HOST_DISCOVERY_PORT} 正在监听，支持 V1/V2 双向发现。` : `UDP ${HOST_DISCOVERY_PORT} 未监听。`,
      suggestion: hostDiscoverySocket
        ? '若搜索不到设备，请确认两端同一 Wi-Fi、关闭访客网络/客户端隔离，并允许专用网络 UDP 广播。'
        : '启动或修复主机服务；防火墙应允许本应用使用 UDP 18778。',
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
      label: '学生终端设备',
      ok: activeDevices.length > 0,
      detail: activeDevices.length > 0 ? `${activeDevices.length} 台有效设备，${devices.length - activeDevices.length} 台已撤销。` : '暂无有效绑定设备。',
      suggestion: activeDevices.length > 0 ? '如资料串学生，请检查设备的学生访问范围。' : '平板可查找主机并请求连接，或开启“等待主机连接”由 Windows 邀请。',
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

function licensedInvoke(action, handler) {
  const locked = licenseRequiredJson(action);
  if (locked) return Promise.resolve(locked);
  return new Promise((resolve) => {
    setImmediate(() => {
      try {
        resolve(handler());
      } catch (error) {
        resolve(JSON.stringify({ ok: false, message: `${action}失败：${error.message}` }));
      }
    });
  });
}

ipcMain.handle('bridge:copyText', (_event, value) => {
  try {
    const text = String(value || '');
    if (!text) {
      return JSON.stringify({ ok: false, message: '没有可复制的内容。' });
    }
    clipboard.writeText(text);
    const normalizeClipboardText = (input) => String(input || '').replace(/\r\n/g, '\n');
    const verified = normalizeClipboardText(clipboard.readText()) === normalizeClipboardText(text);
    return JSON.stringify({ ok: verified, length: text.length, message: verified ? '内容已写入系统剪贴板。' : '剪贴板写入后校验失败，请重试。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `复制失败：${error.message}` });
  }
});
ipcMain.on('bridge:exportTextFile', (event, filename, content) => { licensedIpc(event, '导出初始化文档', () => exportTextFile(filename, content)); });
ipcMain.on('bridge:importFiles', (event, studentName, targetJson) => { licensedIpc(event, '导入资料', () => importFiles(studentName, targetJson)); });
ipcMain.on('bridge:pickMaterialSourceDir', (event) => { licensedIpc(event, '资料来源目录', () => pickMaterialSourceDir()); });
ipcMain.handle('bridge:scanMaterialSources', (_event, studentId, sourcesJson) => licensedInvoke('资料来源目录扫描', () => scanMaterialSources(studentId, sourcesJson)));
ipcMain.handle('bridge:importMaterialSourceFiles', (_event, studentId, pathsJson, targetJson) => licensedInvoke('导入资料', () => importMaterialSourceFiles(studentId, pathsJson, targetJson)));
ipcMain.on('bridge:getMaterialImportRecords', (event, studentId) => { event.returnValue = getMaterialImportRecords(studentId); });
ipcMain.on('bridge:removeMaterialImportRecords', (event, studentId, recordIdsJson) => { licensedIpc(event, '移除资料记录', () => removeMaterialImportRecords(studentId, recordIdsJson)); });
ipcMain.on('bridge:getAssetIndex', (event) => { event.returnValue = JSON.stringify(assetIndexSummary()); });
ipcMain.handle('bridge:rebuildAssetIndex', () => licensedInvoke('资产索引补建', () => rebuildAssetIndex()));
ipcMain.handle('bridge:analyzeAssetGovernance', () => licensedInvoke('资产治理建议', () => analyzeAssetGovernance()));
ipcMain.on('bridge:cleanupAssetReferences', (event, assetId) => { licensedIpc(event, '资产引用清理', () => cleanupAssetReferences(assetId)); });
ipcMain.on('bridge:createAssetVersionSnapshot', (event, assetId) => { licensedIpc(event, '资产版本快照', () => createAssetVersionSnapshot(assetId)); });
ipcMain.on('bridge:markAssetGovernanceDecision', (event, assetId, decision, note) => { licensedIpc(event, '资产治理人工决策', () => markAssetGovernanceDecision(assetId, decision, note)); });
ipcMain.on('bridge:generateKnowledgeArchitectureReport', (event) => { licensedIpc(event, '知识关系图生成', () => generateKnowledgeArchitectureReport()); });
ipcMain.on('bridge:getProjects', (event) => { event.returnValue = getProjects(); });
ipcMain.on('bridge:createProject', (event, optionsJson) => { licensedIpc(event, '学习项目创建', () => createProject(optionsJson)); });
ipcMain.on('bridge:updateProjectMetadata', (event, projectId, metadataJson) => { licensedIpc(event, '编辑学习项目', () => updateProjectMetadata(projectId, metadataJson)); });
ipcMain.on('bridge:removeProjectRecord', (event, projectId) => { licensedIpc(event, '删除学习项目记录', () => removeProjectRecord(projectId)); });
ipcMain.on('bridge:deleteLearningProject', (event, projectId) => { licensedIpc(event, '安全删除学习项目', () => deleteLearningProject(projectId)); });
ipcMain.on('bridge:relocateProjectWorkspace', (event, projectId) => { licensedIpc(event, '项目路径重新定位', () => relocateProjectWorkspace(projectId)); });
ipcMain.on('bridge:confirmProjectWorkspaceRelocation', (event, projectId, workspacePath) => { licensedIpc(event, '确认项目路径重新定位', () => confirmProjectWorkspaceRelocation(projectId, workspacePath)); });
ipcMain.on('bridge:rollbackProjectWorkspaceRelocation', (event, projectId) => { licensedIpc(event, '回滚项目路径重新定位', () => rollbackProjectWorkspaceRelocation(projectId)); });
ipcMain.on('bridge:getRemovedProjects', (event) => { licensedIpc(event, '已移除项目读取', () => getRemovedProjects()); });
ipcMain.on('bridge:restoreRemovedProject', (event, snapshotPath) => { licensedIpc(event, '项目记录恢复', () => restoreRemovedProject(snapshotPath)); });
ipcMain.on('bridge:exportProjectPackage', (event, projectId) => { licensedIpc(event, '项目导出', () => exportProjectPackage(projectId)); });
ipcMain.on('bridge:importProjectPackage', (event) => { licensedIpc(event, '项目导入', () => importProjectPackage()); });
ipcMain.on('bridge:duplicateProject', (event, projectId, name) => { licensedIpc(event, '复制学习项目', () => duplicateProject(projectId, name)); });
ipcMain.on('bridge:updateProjectStudentEvidence', (event, projectId, studentId, evidenceJson) => { licensedIpc(event, '学生独立成长证据', () => updateProjectStudentEvidence(projectId, studentId, evidenceJson)); });
ipcMain.on('bridge:getProjectStudentEvidencePrompt', (event, projectId) => { licensedIpc(event, '个人成长证据建议任务', () => getProjectStudentEvidencePrompt(projectId)); });
ipcMain.on('bridge:importProjectStudentEvidenceSuggestions', (event, projectId, pastedText) => { licensedIpc(event, '同步个人成长证据建议', () => importProjectStudentEvidenceSuggestions(projectId, pastedText)); });
ipcMain.handle('bridge:buildCrossProjectKnowledgeIndex', () => licensedInvoke('跨项目知识关联', () => buildCrossProjectKnowledgeIndex()));
ipcMain.on('bridge:pickProjectWorkspaceDir', (event) => { licensedIpc(event, '选择已有项目文件夹', () => pickProjectWorkspaceDir()); });
ipcMain.on('bridge:pickProjectKnowledgeBaseDir', (event) => { licensedIpc(event, '选择已有项目知识空间', () => pickProjectKnowledgeBaseDir()); });
ipcMain.on('bridge:inspectProjectKnowledgeBase', (event, rootPath) => { licensedIpc(event, '检查已有项目知识空间', () => inspectProjectKnowledgeBase(rootPath)); });
ipcMain.on('bridge:updateProjectStatus', (event, projectId, status) => { licensedIpc(event, '学习项目状态更新', () => updateProjectStatus(projectId, status)); });
ipcMain.on('bridge:updateProjectStudents', (event, projectId, studentIdsJson) => { licensedIpc(event, '学习项目绑定学生', () => updateProjectStudents(projectId, studentIdsJson)); });
ipcMain.on('bridge:applyProjectWorkspaceTemplate', (event, projectId, templateId, foldersJson, templateName, templateV2Json) => { licensedIpc(event, '项目模板 V2', () => applyProjectWorkspaceTemplate(projectId, templateId, foldersJson, templateName, templateV2Json)); });
ipcMain.on('bridge:openProjectSpace', (event, projectId, space) => { licensedIpc(event, '打开学习项目空间', () => openProjectSpace(projectId, space)); });
ipcMain.handle('bridge:scanProjectWorkspace', async (event, projectId) => {
  const locked = licenseRequiredJson('扫描项目工作空间');
  return locked || scanProjectWorkspace(projectId, event.sender);
});
ipcMain.handle('bridge:cancelProjectWorkspaceScan', async (_event, projectId) => cancelProjectWorkspaceScan(projectId));
ipcMain.on('bridge:reviewProjectStagingItems', (event, projectId, itemIdsJson, decision, sourceStrategy, note) => { licensedIpc(event, '项目资料人工审核', () => reviewProjectStagingItems(projectId, itemIdsJson, decision, sourceStrategy, note)); });
ipcMain.on('bridge:getProjectKnowledgeReview', (event, projectId) => { licensedIpc(event, '读取项目知识资产审核', () => getProjectKnowledgeReview(projectId)); });
ipcMain.on('bridge:updateProjectKnowledgeReview', (event, projectId, recordIdsJson, status, note) => { licensedIpc(event, '项目知识资产审核', () => updateProjectKnowledgeReview(projectId, recordIdsJson, status, note)); });
ipcMain.on('bridge:getProjectUnifiedReview', (event, projectId) => { licensedIpc(event, '读取项目统一审核包', () => getProjectUnifiedReview(projectId)); });
ipcMain.on('bridge:applyProjectUnifiedReview', (event, projectId) => { licensedIpc(event, '应用项目统一审核包', () => applyProjectUnifiedReview(projectId)); });
ipcMain.on('bridge:importProjectAssets', (event, projectId, assetIdsJson) => { licensedIpc(event, '项目资料导入', () => importProjectAssets(projectId, assetIdsJson)); });
ipcMain.on('bridge:importProjectRawFiles', (event, projectId) => { licensedIpc(event, '项目原始资料导入', () => importProjectRawFiles(projectId)); });
ipcMain.on('bridge:getProjectDigestCommand', (event, projectId) => { licensedIpc(event, '项目消化指令', () => getProjectDigestCommand(projectId)); });
ipcMain.on('bridge:markProjectDigestSubmitted', (event, projectId) => { licensedIpc(event, '项目消化提交标记', () => markProjectDigestSubmitted(projectId)); });
ipcMain.on('bridge:syncProjectDigestResult', (event, projectId) => { licensedIpc(event, '项目消化结果同步', () => syncProjectDigestResult(projectId)); });
ipcMain.on('bridge:applyProjectDigestReceiptText', (event, projectId, rawText) => { licensedIpc(event, '粘贴项目消化回执', () => applyProjectDigestReceiptText(projectId, rawText)); });
ipcMain.on('bridge:importProjectStagingFiles', (event, projectId) => { licensedIpc(event, '项目研究暂存导入', () => importProjectStagingFiles(projectId)); });
ipcMain.on('bridge:updateProjectStagingStatus', (event, projectId, itemIdsJson, status) => { licensedIpc(event, '项目研究暂存状态', () => updateProjectStagingStatus(projectId, itemIdsJson, status)); });
ipcMain.on('bridge:promoteProjectStagingItems', (event, projectId, itemIdsJson) => { licensedIpc(event, '项目研究暂存晋升', () => promoteProjectStagingItems(projectId, itemIdsJson)); });
ipcMain.on('bridge:approveAndPromoteProjectStagingItems', (event, projectId, itemIdsJson, sourceStrategy, note) => { licensedIpc(event, '审核并加入项目知识库', () => approveAndPromoteProjectStagingItems(projectId, itemIdsJson, sourceStrategy, note)); });
ipcMain.on('bridge:previewProjectStagingAiScreening', (event, projectId, rawText) => { licensedIpc(event, '预览项目研究暂存 AI 初筛', () => previewProjectStagingAiScreening(projectId, rawText)); });
ipcMain.on('bridge:applyProjectStagingAiScreening', (event, projectId, rawText) => { licensedIpc(event, '应用项目研究暂存 AI 初筛', () => applyProjectStagingAiScreening(projectId, rawText, { source: 'paste' })); });
ipcMain.on('bridge:importProjectStagingAiScreening', (event, projectId) => { licensedIpc(event, '项目研究暂存 AI 初筛导入', () => importProjectStagingAiScreening(projectId)); });
ipcMain.on('bridge:analyzeProjectStagingGovernance', (event, projectId) => { licensedIpc(event, '项目研究暂存治理建议', () => analyzeProjectStagingGovernance(projectId)); });
ipcMain.on('bridge:generateProjectPromotion', (event, projectId) => { licensedIpc(event, '知识贡献申请', () => generateProjectPromotion(projectId)); });
ipcMain.on('bridge:getProjectPromotionPlan', (event, projectId) => { licensedIpc(event, '归档确认清单', () => projectPromotionPlan(projectId)); });
ipcMain.on('bridge:getProjectPromotionAudit', (event, projectId) => { licensedIpc(event, '知识贡献审计', () => getProjectPromotionAudit(projectId)); });
ipcMain.on('bridge:getProjectCompletionWizard', (event, projectId) => { licensedIpc(event, '项目完成向导', () => getProjectCompletionWizard(projectId)); });
ipcMain.on('bridge:executeProjectPromotionPlan', (event, projectId, planJson) => { licensedIpc(event, '执行归档确认清单', () => executeProjectPromotionPlan(projectId, planJson)); });
ipcMain.on('bridge:publishProjectPromotion', (event, projectId) => { licensedIpc(event, '知识贡献发布', () => publishProjectPromotion(projectId)); });
ipcMain.on('bridge:rollbackProjectPromotionRun', (event, projectId, runId) => { licensedIpc(event, '知识贡献回滚', () => rollbackProjectPromotionRun(projectId, runId)); });
ipcMain.on('bridge:initStudentWorkspace', (event, studentName, agentMd, indexMd, logMd) => {
  licensedIpc(event, '新建学生档案', () => initStudentWorkspace(studentName, agentMd, indexMd, logMd));
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
ipcMain.on('bridge:updateConversationKnowledgeCandidate', (event, studentId, candidateId, action, payloadJson) => { licensedIpc(event, '逐条知识候选治理', () => updateConversationKnowledgeCandidate(studentId, candidateId, action, payloadJson)); });
ipcMain.on('bridge:promoteConversationKnowledgeCandidates', (event, studentId, requestJson) => { licensedIpc(event, '知识候选事务晋升', () => promoteConversationKnowledgeCandidates(studentId, requestJson)); });
ipcMain.on('bridge:rollbackConversationPromotion', (event, studentId, transactionId) => { licensedIpc(event, '撤销知识候选晋升', () => rollbackConversationPromotion(studentId, transactionId)); });
ipcMain.on('bridge:ingestKnowledgeCandidateEnvelope', (event, studentId, envelopeJson) => { licensedIpc(event, '多源知识候选登记', () => ingestKnowledgeCandidateEnvelope(studentId, envelopeJson)); });
ipcMain.on('bridge:openStudentRootDir', (event, studentId) => { licensedIpc(event, '打开学生知识库目录', () => openStudentRootDir(studentId)); });
ipcMain.on('bridge:openGrowthModelDir', (event, studentId) => { licensedIpc(event, '打开成长模型目录', () => openGrowthModelDir(studentId)); });
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
ipcMain.on('bridge:listProjectKnowledgeFiles', (event, projectId) => { event.returnValue = listProjectKnowledgeFiles(projectId); });
ipcMain.on('bridge:readProjectKnowledgeFile', (event, projectId, documentId) => { event.returnValue = readProjectKnowledgeFile(projectId, documentId); });
ipcMain.on('bridge:listLearningReports', (event, studentId) => { event.returnValue = listLearningReports(studentId); });
ipcMain.on('bridge:readLearningReport', (event, studentId, reportId) => { event.returnValue = readLearningReport(studentId, reportId); });
ipcMain.on('bridge:ensureLearningReports', (event, studentId) => { licensedIpc(event, '学情报告模板补建', () => ensureLearningReports(studentId)); });
ipcMain.on('bridge:ensureGrowthModel', (event, studentId) => { licensedIpc(event, '成长模型补建', () => ensureGrowthModel(studentId)); });
ipcMain.on('bridge:getGrowthEvidenceReview', (event, studentId) => { event.returnValue = getGrowthEvidenceReview(studentId); });
ipcMain.on('bridge:updateGrowthEvidenceStatus', (event, studentId, evidenceId, status, note) => { licensedIpc(event, '成长证据审核', () => updateGrowthEvidenceStatus(studentId, evidenceId, status, note)); });
ipcMain.on('bridge:batchReviewGrowthEvidence', (event, studentId) => { licensedIpc(event, '批量审核成长证据', () => batchReviewGrowthEvidence(studentId)); });
ipcMain.on('bridge:rebuildGrowthIndex', (event, studentId) => { licensedIpc(event, '成长模型结构化索引', () => rebuildGrowthIndex(studentId)); });
ipcMain.on('bridge:getGrowthIndex', (event, studentId) => { event.returnValue = getGrowthIndex(studentId); });
ipcMain.on('bridge:getStudents', (event) => { event.returnValue = getStudentsIndex(); });
ipcMain.on('bridge:syncStudents', (event, studentsJson) => { licensedIpc(event, '学生档案同步', () => syncStudentsIndex(studentsJson)); });
ipcMain.on('bridge:selectKnowledgeBaseRoot', (event) => { licensedIpc(event, '接管已有知识库', () => selectKnowledgeBaseRoot()); });
ipcMain.on('bridge:scanKnowledgeBase', (event, rootPath, studentName) => { event.returnValue = scanExistingKnowledgeBase(rootPath, studentName); });
ipcMain.on('bridge:ensureAdoptedKnowledgeBase', (event, optionsJson) => { licensedIpc(event, '接管已有知识库', () => ensureAdoptedKnowledgeBase(optionsJson)); });
ipcMain.on('bridge:getHostServiceStatus', (event) => { event.returnValue = getHostServiceStatus(); });
ipcMain.on('bridge:setHostUsageMode', (event, mode) => { licensedIpc(event, '使用模式设置', () => setHostUsageMode(mode)); });
ipcMain.on('bridge:getHostServiceDiagnostics', (event) => { event.returnValue = getHostServiceDiagnostics(); });
ipcMain.on('bridge:repairHostService', (event) => { licensedIpc(event, '主机服务修复', () => repairHostService()); });
ipcMain.on('bridge:startHostService', (event) => { licensedIpc(event, '主机服务', () => startHostService()); });
ipcMain.on('bridge:stopHostService', (event) => { event.returnValue = stopHostService(); });
ipcMain.on('bridge:setHostServicePort', (event, port) => { licensedIpc(event, '主机服务端口设置', () => setHostServicePort(port)); });
ipcMain.on('bridge:getHostConnectionInfo', (event) => { event.returnValue = getHostConnectionInfo(); });
ipcMain.on('bridge:getHostDevices', (event) => { event.returnValue = getHostDevices(); });
ipcMain.on('bridge:renameHostIdentity', (event, displayName) => { licensedIpc(event, '主机身份设置', () => renameHostIdentity(displayName)); });
ipcMain.on('bridge:findLanTablets', (event) => { licensedIpc(event, '局域网平板发现', () => findLanTablets()); });
ipcMain.on('bridge:inviteLanTablet', (event, tabletId) => { licensedIpc(event, '邀请平板连接', () => inviteLanTablet(tabletId)); });
ipcMain.on('bridge:acceptHostPairRequest', (event, requestId) => { licensedIpc(event, '接受平板连接', () => acceptHostPairRequest(requestId)); });
ipcMain.on('bridge:rejectPairRequest', (event, requestId) => { licensedIpc(event, '拒绝设备连接', () => rejectPairRequest(requestId)); });
ipcMain.on('bridge:getHostUploadRecords', (event) => { event.returnValue = getHostUploadRecords(); });
ipcMain.on('bridge:exportHostUploadRecords', (event) => { event.returnValue = exportHostUploadRecords(); });
ipcMain.on('bridge:openHostUploadRecord', (event, recordId) => { event.returnValue = openHostUploadRecord(recordId); });
ipcMain.on('bridge:clearHostUploadRecords', (event) => { licensedIpc(event, '上传记录维护', () => clearHostUploadRecords()); });
ipcMain.on('bridge:setHostUploadRecordStatus', (event, recordId, status) => { licensedIpc(event, '上传记录状态维护', () => setHostUploadRecordStatus(recordId, status)); });
ipcMain.on('bridge:markStudentDigestSubmitted', (event, studentId) => { licensedIpc(event, '资料消化任务', () => markStudentDigestSubmitted(studentId)); });
ipcMain.on('bridge:syncStudentDigestResult', (event, studentId) => { licensedIpc(event, '资料消化结果同步', () => syncStudentDigestResult(studentId, { forceSubmitted: true })); });
ipcMain.on('bridge:startDigestWorkflow', (event, scopeType, scopeId, executor) => { licensedIpc(event, '开始资料自动处理', () => startDigestWorkflow(scopeType, scopeId, executor)); });
ipcMain.on('bridge:getDigestWorkflowStatus', (event, scopeType, scopeId) => { event.returnValue = getDigestWorkflowStatus(scopeType, scopeId); });
ipcMain.on('bridge:getDigestWorkflowCommand', (event, scopeType, scopeId) => { licensedIpc(event, '复制当前资料处理指令', () => getDigestWorkflowCommand(scopeType, scopeId)); });
ipcMain.on('bridge:retryDigestWorkflow', (event, scopeType, scopeId, executor) => { licensedIpc(event, '重试未完成资料', () => retryDigestWorkflow(scopeType, scopeId, executor)); });
ipcMain.on('bridge:importDigestWorkflowResultText', (event, scopeType, scopeId, content) => { licensedIpc(event, '粘贴资料处理结果', () => importDigestWorkflowResultText(scopeType, scopeId, content)); });
ipcMain.on('bridge:getStudentDigestAudit', (event, studentId) => { event.returnValue = JSON.stringify(buildStudentDigestAudit(studentId, { write: false })); });
ipcMain.on('bridge:generateStudentDigestAudit', (event, studentId, selectedIdsJson) => { licensedIpc(event, '资料消化覆盖审计', () => generateStudentDigestAudit(studentId, selectedIdsJson)); });
ipcMain.on('bridge:syncStudentDigestAudit', (event, studentId) => { licensedIpc(event, '资料消化复核结果同步', () => syncStudentDigestAudit(studentId)); });
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
ipcMain.on('bridge:importTaskResultText', (event, taskId, content) => { licensedIpc(event, '粘贴任务结果', () => importTaskResultText(taskId, content)); });
ipcMain.on('bridge:syncQClawTaskResults', (event) => { licensedIpc(event, '同步 QClaw 任务结果', () => syncQClawTaskResults()); });
ipcMain.on('bridge:submitDailyActionFeedback', (event, taskId, status, note) => { licensedIpc(event, '每日行动反馈', () => submitDailyActionFeedback(taskId, status, note)); });
ipcMain.on('bridge:openTaskCenterPath', (event, kind) => { event.returnValue = openTaskCenterPath(kind); });
ipcMain.on('bridge:openTaskResultPath', (event, taskId) => { event.returnValue = openTaskResultPath(taskId); });
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
ipcMain.on('bridge:setHostDeviceTerminalMode', (event, deviceId, terminalMode, boundStudentId) => {
  licensedIpc(event, '终端使用模式设置', () => setHostDeviceTerminalMode(deviceId, terminalMode, boundStudentId));
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
ipcMain.handle('bridge:promoteCaptureSession', async (_event, sessionId, targetMode) => {
  const locked = licenseRequiredJson('屏幕采集资料晋升');
  return locked || promoteCaptureSession(sessionId, targetMode);
});
ipcMain.handle('bridge:deleteCaptureSession', async (_event, sessionId) => {
  const locked = licenseRequiredJson('删除屏幕采集会话');
  return locked || deleteCaptureSession(sessionId);
});

const qaIsolated = process.argv.includes('--qa-isolated');
const hasSingleInstanceLock = qaIsolated || app.requestSingleInstanceLock();

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
    setTimeout(() => {
      try { repairStaleGrowthIndexes(); } catch { /* Startup remains available if a legacy knowledge base is offline. */ }
    }, 1200);
    createCaptureTray();
    registerCaptureShortcuts();
    startDigestWorkflowMonitor();
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
  stopDigestWorkflowMonitor();
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
