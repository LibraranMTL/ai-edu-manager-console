import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import QRCode from 'qrcode';
import {
  Archive,
  BookOpen,
  Bot,
  CheckCircle2,
  Clipboard,
  Clock3,
  ExternalLink,
  FileDown,
  FileText,
  FolderOpen,
  Home,
  Inbox,
  KeyRound,
  ListChecks,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  UserRound,
} from 'lucide-react';
import './styles.css';

type Section = 'home' | 'init' | 'new' | 'inbox' | 'assets' | 'projects' | 'growth' | 'reports' | 'archive' | 'qa' | 'memory' | 'soul' | 'rules' | 'conversation' | 'tasks' | 'settings';
type ThemeName = 'blue' | 'pink' | 'green' | 'purple' | 'orange';
type LanguageCode = 'zh-CN' | 'zh-TW' | 'en' | 'fr' | 'es' | 'ja' | 'ko' | 'vi' | 'ms';
type AgentToolId =
  | 'qclaw'
  | 'marvis'
  | 'hohu'
  | 'openclaw'
  | 'ima.copilot'
  | 'workbuddy'
  | 'codex'
  | 'claude-code'
  | 'chatgpt'
  | 'claude'
  | 'doubao'
  | 'coze'
  | 'fastgpt';
type AgentKnowledgeKind = 'memory' | 'soul' | 'rule' | 'conversation';
type StorageMode = 'app_private' | 'downloads_export' | 'obsidian_vault';
type KnowledgeBaseMode = 'standard' | 'adopted';
type AgentBindingMode = 'subAgent' | 'mainChat';
type InitStepId = 'folder' | 'agent' | 'execute' | 'create' | 'soul' | 'memory' | 'schedule' | 'full';
type ArchiveCategoryId = 'summary' | 'report' | 'qa' | 'other' | 'all';
type LearningReportId = 'profile' | 'changes' | 'daily' | 'stage';
type RuntimePlatform = 'android' | 'windows' | 'web' | string;

type AgentToolProfile = {
  id: AgentToolId;
  name: string;
  category: 'local-app' | 'local-cli' | 'web-app' | 'platform';
  supportsLocalFiles: boolean;
  supportsAgentCreation: boolean;
  supportsPersonaSetting: boolean;
  supportsMemorySetting: boolean;
  supportsScheduledTask: boolean;
  supportsSubAgent: boolean;
  supportsProjectRules: boolean;
  supportsMemoryFile: boolean;
  supportsPersonaFile: boolean;
  supportsConversationExport: boolean;
  supportsMemoryPaste: boolean;
  supportsSoulPaste: boolean;
  openMode: 'exe' | 'protocol' | 'cli' | 'url';
  ruleFiles: string[];
  memoryLocations: string[];
  personaLocations: string[];
  conversationLocations: string[];
  installUrls: {
    windows?: string;
    android?: string;
    web?: string;
  };
  openLabel: string;
  copyTargetLabel: string;
  digestTargetLabel: string;
  personaTargetLabel: string;
  memoryTargetLabel: string;
};

type AgentToolAdapter = {
  id: AgentToolId;
  profile: AgentToolProfile;
  statusKey: keyof AgentToolInstallStatus | 'claudeCode';
  openedKey?: 'qclawOpened' | 'marvisOpened' | 'hohuOpened' | 'openclawOpened' | 'imaCopilotOpened' | 'workbuddyOpened' | 'codexOpened' | 'claudeCodeOpened';
  canOpenLocally: boolean;
  getInstall: (status: AgentToolInstallStatus | null) => AgentToolInstall | undefined;
  isOpened: (openState: Partial<Record<AgentToolId, boolean>>) => boolean;
  open: (openHandler: (toolId: AgentToolId) => void) => void;
  buildInitPrompt: (student: StudentDraft) => string;
  buildDigestCommand: (student: StudentDraft) => string;
  buildConsultCommand: (student: Student) => string;
  buildScanPrompt: (student: Student, kind: AgentKnowledgeKind | 'all') => string;
  primaryRuleFile: () => string;
};

type Student = {
  id: string;
  name: string;
  grade: string;
  school: string;
  goal: string;
  digestTime: string;
  agentTool: AgentToolId;
  storageMode: StorageMode;
  knowledgeBaseMode?: KnowledgeBaseMode;
  rootPath?: string;
  rawPath?: string;
  summaryPath?: string;
  agentPath?: string;
  outputPath?: string;
  rootPathLabel?: string;
  pendingDigestCount?: number;
  submittedDigestCount?: number;
  processedDigestCount?: number;
  lastDigestAt?: string;
  digestStatus?: string;
  digestMessage?: string;
  agentName?: string;
  agentBindingMode?: AgentBindingMode;
  agentNote?: string;
  adoptedAt?: string;
  remoteChannel?: 'none' | 'wecom' | 'qq' | 'both';
  remoteContact?: string;
  remoteNote?: string;
  remoteBindingStatus?: 'unbound' | 'pending' | 'bound';
  remoteBoundAt?: string;
  createdAt: string;
  status: 'ready';
  schemaVersion?: number;
  bundleExportedAt?: string;
  lastImportAt?: string;
  lastDigestCommandAt?: string;
  materialSources?: MaterialSource[];
  memoryConfig?: {
    unifiedMemoryPath: string;
    lastMergedAt?: string;
    sources: Array<{ tool: AgentToolId; mode: 'file' | 'paste'; currentPath: string; lastSyncedAt?: string; hash?: string }>;
  };
  soulConfig?: {
    unifiedSoulPath: string;
    lastDistributedAt?: string;
    sources: Array<{ tool: AgentToolId; currentPath: string; lastCheckedAt?: string; hash?: string }>;
  };
  templateProfile?: {
    activeTemplate: 'system' | 'custom';
    customTemplatePath?: string;
  };
};

type MaterialSource = {
  id: string;
  name: string;
  path: string;
  enabled: boolean;
  lastScannedAt?: string;
};

type AssetRecord = {
  assetId: string;
  filename: string;
  type: string;
  sha1?: string;
  size?: number;
  path: string;
  ownerStudentId?: string;
  ownerStudentName?: string;
  linkedStudents?: string[];
  linkedProjects?: string[];
  references?: Array<{
    id: string;
    spaceType: string;
    spaceId: string;
    spaceName: string;
    role: string;
    path: string;
    source?: string;
    linkedAt?: string;
  }>;
  sourcePath?: string;
  sourceName?: string;
  uploadedAt?: string;
  updatedAt?: string;
  status?: string;
  duplicateCount?: number;
  referenceCount?: number;
};

type AssetIndexState = {
  ok?: boolean;
  assets: AssetRecord[];
  total?: number;
  duplicateGroups?: number;
  message?: string;
};

type LearningProject = {
  id: string;
  name: string;
  type: string;
  status: string;
  studentIds: string[];
  studentNames?: string[];
  projectRootPath: string;
  workspacePath: string;
  stagingPath?: string;
  knowledgeRootPath: string;
  rawPath: string;
  summaryPath: string;
  agentPath: string;
  outputPath?: string;
  promotionPath?: string;
  assetIds?: string[];
  stagingItems?: ProjectStagingItem[];
  createdAt?: string;
  updatedAt?: string;
  archivedAt?: string;
  publishedAt?: string;
};

type ProjectStagingStatus = 'collected' | 'screened' | 'selected' | 'analyzed' | 'promoted' | 'discarded';

type ProjectStagingItem = {
  id: string;
  filename: string;
  path: string;
  size?: number;
  type?: string;
  sha1?: string;
  status: ProjectStagingStatus | string;
  sourceStrategy?: string;
  sourcePath?: string;
  addedAt?: string;
  updatedAt?: string;
  promotedAt?: string;
  promotedAssetId?: string;
  aiAction?: string;
  aiReason?: string;
  aiScore?: number | string;
  aiReviewedAt?: string;
  duplicateCount?: number;
  stagingAgeDays?: number | string;
  governanceAction?: string;
  governanceReason?: string;
  governanceReviewedAt?: string;
};

type PromotionAction = 'reference' | 'publish' | 'absorb' | 'skip';

type PromotionPlanItem = {
  id: string;
  kind: 'file' | 'knowledge' | 'growth' | string;
  title: string;
  sourcePath?: string;
  assetId?: string;
  content?: string;
  action: PromotionAction;
  defaultAction?: PromotionAction;
  allowedActions: PromotionAction[];
  targetHint?: string;
};

type PromotionPlan = {
  ok?: boolean;
  project?: LearningProject;
  students?: Array<{ id: string; name: string; summaryPath?: string; rawPath?: string }>;
  items: PromotionPlanItem[];
  message?: string;
};

type StudentDraft = Omit<Student, 'id' | 'createdAt' | 'status'>;

type AndroidBridge = {
  copyText?: (value: string) => void;
  exportTextFile?: (filename: string, content: string) => string;
  importFiles?: (studentName: string) => boolean | string;
  pickMaterialSourceDir?: () => string;
  scanMaterialSources?: (studentId: string, sourcesJson: string) => string;
  importMaterialSourceFiles?: (studentId: string, pathsJson: string) => string;
  getMaterialImportRecords?: (studentId: string) => string;
  getAssetIndex?: () => string;
  rebuildAssetIndex?: () => string;
  getProjects?: () => string;
  createProject?: (optionsJson: string) => string;
  updateProjectStatus?: (projectId: string, status: string) => string;
  updateProjectStudents?: (projectId: string, studentIdsJson: string) => string;
  importProjectAssets?: (projectId: string, assetIdsJson: string) => string;
  importProjectStagingFiles?: (projectId: string) => string;
  updateProjectStagingStatus?: (projectId: string, itemIdsJson: string, status: string) => string;
  promoteProjectStagingItems?: (projectId: string, itemIdsJson: string) => string;
  importProjectStagingAiScreening?: (projectId: string) => string;
  analyzeProjectStagingGovernance?: (projectId: string) => string;
  generateProjectPromotion?: (projectId: string) => string;
  getProjectPromotionPlan?: (projectId: string) => string;
  executeProjectPromotionPlan?: (projectId: string, planJson: string) => string;
  publishProjectPromotion?: (projectId: string) => string;
  importImages?: (studentName: string) => boolean;
  takePhoto?: (studentName: string) => boolean;
  initStudentWorkspace?: (studentName: string, agentMd: string, indexMd: string, logMd: string) => string;
  getStorageConfig?: () => string;
  getTemplateCenter?: (systemTemplatesJson: string) => string;
  saveCustomTemplates?: (templatesJson: string) => string;
  restoreSystemTemplates?: (systemTemplatesJson: string) => string;
  getAgentCenter?: (studentId: string) => string;
  saveAgentMemorySource?: (studentId: string, tool: AgentToolId, content: string, mode: 'file' | 'paste') => string;
  mergeAgentMemory?: (studentId: string) => string;
  saveUnifiedMemory?: (studentId: string, content: string) => string;
  saveAgentSoulSource?: (studentId: string, tool: AgentToolId, content: string) => string;
  saveUnifiedSoul?: (studentId: string, content: string) => string;
  compareAgentSoulSource?: (studentId: string, tool: AgentToolId) => string;
  scanAgentKnowledgeFiles?: (studentId: string) => string;
  importAgentKnowledgeFile?: (studentId: string, filePath: string, tool: AgentToolId, kind: AgentKnowledgeKind) => string;
  getAgentRules?: (studentId: string) => string;
  saveAgentRuleFile?: (studentId: string, fileName: string, content: string) => string;
  generateAgentRuleFile?: (studentId: string, fileName: string) => string;
  compareAgentRuleFiles?: (studentId: string, baseName: string, targetName: string) => string;
  getAgentSourceRegistry?: (studentId: string) => string;
  rollbackAgentSourceRecord?: (studentId: string, recordId: string) => string;
  getAgentConversationCenter?: (studentId: string) => string;
  saveAgentConversationImport?: (studentId: string, content: string, tool: AgentToolId, sourcePath?: string) => string;
  selectAgentConversationFiles?: (studentId: string, tool: AgentToolId) => string;
  saveConversationExtract?: (studentId: string, extractJson: string, tool: AgentToolId) => string;
  openStudentRootDir?: (studentId: string) => string;
  getLicenseStatus?: () => string;
  activateLicense?: (code: string) => string;
  deactivateLicense?: () => string;
  getAgentToolInstallStatus?: () => string;
  openExternalUrl?: (url: string) => boolean;
  getSharedInboxStatus?: () => string;
  consumeSharedImports?: (studentName: string) => string;
  getCompatibilityStatus?: () => string;
  pickArchiveRoot?: () => boolean;
  getArchiveRootStatus?: () => string;
  listMarkdownFiles?: (studentName: string) => string;
  readMarkdownFile?: (documentId: string) => string;
  listLearningReports?: (studentId: string) => string;
  readLearningReport?: (studentId: string, reportId: LearningReportId) => string;
  ensureLearningReports?: (studentId: string) => string;
  ensureGrowthModel?: (studentId: string) => string;
  checkUpdate?: (manifestUrl: string, currentVersionCode: number) => boolean;
  downloadAndInstallUpdate?: (apkUrl: string) => boolean;
  scanDownloads?: () => string;
  importDownloadFiles?: (studentName: string, pathsJson: string) => string;
  openApp?: (app: AgentToolId | 'obsidian' | 'tailscale') => boolean;
  getAppStatus?: () => string;
  syncStudents?: (studentsJson: string) => string;
  selectKnowledgeBaseRoot?: () => string;
  scanKnowledgeBase?: (rootPath: string, studentName: string) => string;
  ensureAdoptedKnowledgeBase?: (optionsJson: string) => string;
  getHostServiceStatus?: () => string;
  getHostServiceDiagnostics?: () => string;
  repairHostService?: () => string;
  startHostService?: () => string;
  stopHostService?: () => string;
  setHostServicePort?: (port: number) => string;
  getHostConnectionInfo?: () => string;
  getHostDevices?: () => string;
  getHostUploadRecords?: () => string;
  exportHostUploadRecords?: () => string;
  openHostUploadRecord?: (recordId: string) => string;
  clearHostUploadRecords?: () => string;
  setHostUploadRecordStatus?: (recordId: string, status: string) => string;
  markStudentDigestSubmitted?: (studentId: string) => string;
  syncStudentDigestResult?: (studentId: string) => string;
  getHostTimeline?: () => string;
  backupHostData?: () => string;
  restoreHostData?: () => string;
  resetHostApiToken?: () => string;
  exportHostLogs?: () => string;
  openStudentRawDir?: (studentId: string) => string;
  migrateStudentWorkspace?: (studentId: string, newName: string) => string;
  renameHostDevice?: (deviceId: string, name: string) => string;
  revokeHostDevice?: (deviceId: string) => string;
  setHostDeviceStudentAccess?: (deviceId: string, studentIdsJson: string) => string;
  setHostDeviceAccessMode?: (deviceId: string, optionsJson: string) => string;
};

type UpdateInfo = {
  hasUpdate: boolean;
  versionName?: string;
  versionCode?: number;
  apkUrl?: string;
  windowsUrl?: string;
  minimumVersionCode?: number;
  forceUpdate?: boolean;
  notes?: string;
  message?: string;
};

type MarkdownFile = {
  id: string;
  name: string;
  path: string;
  modified?: number;
};

type LearningReport = {
  id: LearningReportId;
  title: string;
  fileName: string;
  path: string;
  absolutePath?: string;
  exists?: boolean;
  updatedAt?: string;
  status?: string;
  stale?: boolean;
  staleDays?: number | null;
  evidenceOk?: boolean;
  health?: 'ok' | 'warning' | string;
  warnings?: string[];
  summary?: string;
};

type LearningReportHealth = {
  ok?: boolean;
  missingCount?: number;
  draftCount?: number;
  staleCount?: number;
  evidenceMissingCount?: number;
  warnings?: string[];
  message?: string;
};

type DownloadCandidate = {
  id: string;
  path: string;
  name: string;
  size: number;
  modified: number;
  type: string;
  importable: boolean;
};

type MaterialSourceCandidate = DownloadCandidate & {
  sourceId: string;
  sourceName: string;
  sha1?: string;
  status?: 'new' | 'imported' | 'failed' | string;
  reason?: string;
};

type MaterialImportRecord = {
  id: string;
  studentId: string;
  sourcePath: string;
  sourceName: string;
  targetPath: string;
  fileName: string;
  fileSize: number;
  fileHash?: string;
  importedAt: string;
  status: string;
  reason?: string;
};

type NativeImportResult = {
  ok?: boolean;
  imported?: number;
  message?: string;
};

type StorageConfig = {
  platform: RuntimePlatform;
  baseDir: string;
  usesAbsolutePaths: boolean;
  pathSeparator: string;
  hostServicePort?: number;
};

type HostServiceStatus = {
  running: boolean;
  port: number;
  serverUrl?: string;
  lanUrls?: string[];
  tailscaleUrl?: string;
  tailscaleUrls?: string[];
  connectionMode?: 'lan_only' | 'lan_tailscale' | 'manual' | string;
  apiToken?: string;
  pairCode?: string;
  pairExpiresAt?: string;
  pairPayloadText?: string;
  devices?: HostDevice[];
  studentCount?: number;
  students?: HostStudentStat[];
  todayUploadCount?: number;
  recentUploads?: HostUploadRecord[];
  license?: LicenseStatus;
  startedAt?: string;
  lastError?: string;
};

type LicenseStatus = {
  status: 'inactive' | 'active' | 'expired' | string;
  active?: boolean;
  plan?: string;
  planLabel?: string;
  expiresAt?: string;
  studentLimit?: number;
  deviceLimit?: number;
  activatedAt?: string;
  codeHash?: string;
  message?: string;
};

type HostStudentStat = {
  id: string;
  name: string;
  rawFileCount?: number;
  archiveFileCount?: number;
  pendingDigestCount?: number;
  submittedDigestCount?: number;
  processedDigestCount?: number;
  lastDigestAt?: string;
  digestStatus?: string;
  digestMessage?: string;
};

type HostUploadRecord = {
  id: string;
  studentId?: string;
  studentName?: string;
  filename: string;
  size?: number;
  path?: string;
  deviceId?: string;
  deviceName?: string;
  uploadedAt?: string;
  status?: string;
  statusUpdatedAt?: string;
};

type HostTimelineEvent = {
  id: string;
  at?: string;
  type?: string;
  title?: string;
  detail?: string;
  studentId?: string;
  studentName?: string;
  count?: number;
};

type HostServiceDiagnosticCheck = {
  label: string;
  ok: boolean;
  detail: string;
  suggestion?: string;
};

type HostServiceDiagnostics = {
  ok?: boolean;
  checkedAt?: string;
  serverUrl?: string;
  port?: number;
  todayUploadCount?: number;
  checks?: HostServiceDiagnosticCheck[];
};

type HostDevice = {
  id: string;
  name: string;
  tokenPreview?: string;
  allowedStudentIds?: string[];
  allowedAllStudents?: boolean;
  autoAuthorizeNewStudents?: boolean;
  revoked?: boolean;
  createdAt?: string;
  lastSeenAt?: string;
  lastSeenAgoMs?: number;
  online?: boolean;
  lastIp?: string;
  lastUserAgent?: string;
  uploadCount?: number;
  lastUploadAt?: string;
};

type AgentToolInstall = {
  installed: boolean;
  version?: string;
  exePath?: string;
  installLocation?: string;
};

type AgentToolInstallStatus = {
  qclaw: AgentToolInstall;
  marvis: AgentToolInstall;
  hohu: AgentToolInstall;
  openclaw: AgentToolInstall;
  imaCopilot?: AgentToolInstall;
  workbuddy?: AgentToolInstall;
  codex?: AgentToolInstall;
  claudeCode?: AgentToolInstall;
  chatgpt?: AgentToolInstall;
  claude?: AgentToolInstall;
  doubao?: AgentToolInstall;
  coze?: AgentToolInstall;
  fastgpt?: AgentToolInstall;
  tailscale?: AgentToolInstall;
  anyInstalled: boolean;
  recommendedTool: AgentToolId;
};

type CandidateImportReview = {
  candidates: AgentKnowledgeCandidate[];
  duplicateCount: number;
  lowScoreCount: number;
  warnings: string[];
};

type ConversationExtractPreview = {
  memoryCandidates: unknown[];
  soulSuggestions: unknown[];
  qaHighlights: unknown[];
  todos: unknown[];
  raw: Record<string, unknown>;
  error?: string;
};

type KnowledgeBaseScanResult = {
  ok?: boolean;
  message?: string;
  rootPath?: string;
  agentPath?: string;
  rawPath?: string;
  summaryPath?: string;
  outputPath?: string;
  indexPath?: string;
  logPath?: string;
  reportDir?: string;
  reportFiles?: Partial<Record<LearningReportId, boolean>>;
  checks?: {
    agentMd?: boolean;
    rawDir?: boolean;
    summaryDir?: boolean;
    outputDir?: boolean;
    indexMd?: boolean;
    logMd?: boolean;
    learningReportDir?: boolean;
    learningReports?: boolean;
  };
};

const storageKey = 'edu-manager-launcher.students.v2';
const themeStorageKey = 'edu-manager-launcher.theme.v1';
const languageStorageKey = 'edu-manager-launcher.language.v1';
const archiveKeywordStorageKey = 'edu-manager-launcher.archive-keywords.v1';
const currentVersionCode = 86;
const currentVersionName = '0.7.6';
const updateManifestUrl = [
  'https://www.greatbg.com/download/edu-manager-version.json',
  'http://www.greatbg.com/download/edu-manager-version.json',
  'http://123.56.83.50/download/edu-manager-version.json',
].join('|');
const userAgreementUrl = 'https://www.greatbg.com/download/agreement.html';
const privacyPolicyUrl = 'https://www.greatbg.com/download/privacy.html';
const initSchemaVersion = 1;
const defaultStorageConfig: StorageConfig = {
  platform: 'android',
  baseDir: 'Downloads/AI教育管家/学生资料',
  usesAbsolutePaths: false,
  pathSeparator: '/',
};
let activeStorageConfig = defaultStorageConfig;

const agentToolProfiles: Record<AgentToolId, AgentToolProfile> = {
  qclaw: {
    id: 'qclaw',
    name: 'QClaw',
    category: 'local-app',
    supportsLocalFiles: true,
    supportsAgentCreation: true,
    supportsPersonaSetting: true,
    supportsMemorySetting: true,
    supportsScheduledTask: true,
    supportsSubAgent: true,
    supportsProjectRules: true,
    supportsMemoryFile: true,
    supportsPersonaFile: true,
    supportsConversationExport: true,
    supportsMemoryPaste: true,
    supportsSoulPaste: true,
    openMode: 'exe',
    ruleFiles: ['AGENT.md', 'QClaw.md'],
    memoryLocations: ['%USERPROFILE%\\.qclaw', '%APPDATA%\\QClaw', '%LOCALAPPDATA%\\QClaw'],
    personaLocations: ['%USERPROFILE%\\.qclaw', '%APPDATA%\\QClaw', '%LOCALAPPDATA%\\QClaw'],
    conversationLocations: ['%USERPROFILE%\\.qclaw'],
    installUrls: { windows: 'https://qclaw.qq.com/' },
    openLabel: '打开 QClaw',
    copyTargetLabel: '复制到 QClaw 对话或 Agent 设置中',
    digestTargetLabel: '可粘贴到 QClaw 执行',
    personaTargetLabel: 'QClaw Agent 角色设定',
    memoryTargetLabel: 'QClaw Agent 长期记忆',
  },
  marvis: {
    id: 'marvis',
    name: 'Marvis',
    category: 'local-app',
    supportsLocalFiles: false,
    supportsAgentCreation: false,
    supportsPersonaSetting: true,
    supportsMemorySetting: true,
    supportsScheduledTask: false,
    supportsSubAgent: false,
    supportsProjectRules: true,
    supportsMemoryFile: false,
    supportsPersonaFile: false,
    supportsConversationExport: true,
    supportsMemoryPaste: true,
    supportsSoulPaste: true,
    openMode: 'exe',
    ruleFiles: ['AGENT.md', 'Marvis.md'],
    memoryLocations: ['%USERPROFILE%\\.marvis', '%APPDATA%\\Marvis', '%LOCALAPPDATA%\\Marvis'],
    personaLocations: ['%USERPROFILE%\\.marvis', '%APPDATA%\\Marvis', '%LOCALAPPDATA%\\Marvis'],
    conversationLocations: ['%USERPROFILE%\\.marvis'],
    installUrls: { windows: 'https://marvis.qq.com/' },
    openLabel: '打开 Marvis',
    copyTargetLabel: '复制到 Marvis 对话或人设设置中',
    digestTargetLabel: '可粘贴到 Marvis 对话中手动执行',
    personaTargetLabel: 'Marvis 人设/角色设置',
    memoryTargetLabel: 'Marvis 长期背景',
  },
  hohu: {
    id: 'hohu',
    name: 'Hohu',
    category: 'local-app',
    supportsLocalFiles: true,
    supportsAgentCreation: true,
    supportsPersonaSetting: true,
    supportsMemorySetting: true,
    supportsScheduledTask: false,
    supportsSubAgent: true,
    supportsProjectRules: true,
    supportsMemoryFile: true,
    supportsPersonaFile: true,
    supportsConversationExport: true,
    supportsMemoryPaste: true,
    supportsSoulPaste: true,
    openMode: 'exe',
    ruleFiles: ['AGENT.md', 'Hohu.md'],
    memoryLocations: ['%USERPROFILE%\\.hohu', '%APPDATA%\\Hohu', '%LOCALAPPDATA%\\Hohu'],
    personaLocations: ['%USERPROFILE%\\.hohu', '%APPDATA%\\Hohu', '%LOCALAPPDATA%\\Hohu'],
    conversationLocations: ['%USERPROFILE%\\.hohu'],
    installUrls: { windows: 'https://hohu.ai/' },
    openLabel: '打开 Hohu',
    copyTargetLabel: '复制到 Hohu 子 Agent 或人设设置中',
    digestTargetLabel: '可粘贴到 Hohu 执行，并直接读写本机知识库',
    personaTargetLabel: 'Hohu 子 Agent 人设',
    memoryTargetLabel: 'Hohu 子 Agent 记忆',
  },
  openclaw: {
    id: 'openclaw',
    name: 'OpenClaw',
    category: 'local-app',
    supportsLocalFiles: true,
    supportsAgentCreation: true,
    supportsPersonaSetting: true,
    supportsMemorySetting: true,
    supportsScheduledTask: true,
    supportsSubAgent: true,
    supportsProjectRules: true,
    supportsMemoryFile: true,
    supportsPersonaFile: true,
    supportsConversationExport: true,
    supportsMemoryPaste: true,
    supportsSoulPaste: true,
    openMode: 'exe',
    ruleFiles: ['AGENT.md', 'OpenClaw.md'],
    memoryLocations: ['%USERPROFILE%\\.openclaw', '%APPDATA%\\OpenClaw', '%LOCALAPPDATA%\\OpenClaw'],
    personaLocations: ['%USERPROFILE%\\.openclaw', '%APPDATA%\\OpenClaw', '%LOCALAPPDATA%\\OpenClaw'],
    conversationLocations: ['%USERPROFILE%\\.openclaw'],
    installUrls: { windows: 'https://openclaw.ai/' },
    openLabel: '打开 OpenClaw',
    copyTargetLabel: '复制到 OpenClaw 子 Agent 或角色设定中',
    digestTargetLabel: '可粘贴到 OpenClaw 执行',
    personaTargetLabel: 'OpenClaw 子 Agent 角色设定',
    memoryTargetLabel: 'OpenClaw 子 Agent 长期记忆',
  },
  'ima.copilot': {
    id: 'ima.copilot',
    name: 'ima.copilot',
    category: 'local-app',
    supportsLocalFiles: true,
    supportsAgentCreation: false,
    supportsPersonaSetting: true,
    supportsMemorySetting: true,
    supportsScheduledTask: false,
    supportsSubAgent: false,
    supportsProjectRules: true,
    supportsMemoryFile: true,
    supportsPersonaFile: true,
    supportsConversationExport: true,
    supportsMemoryPaste: true,
    supportsSoulPaste: true,
    openMode: 'exe',
    ruleFiles: ['AGENT.md', 'IMA.md', 'ima.copilot.md'],
    memoryLocations: ['%USERPROFILE%\\.ima', '%USERPROFILE%\\.ima.copilot', '%APPDATA%\\IMA', '%LOCALAPPDATA%\\IMA', '%APPDATA%\\ima.copilot', '%LOCALAPPDATA%\\ima.copilot'],
    personaLocations: ['%USERPROFILE%\\.ima', '%USERPROFILE%\\.ima.copilot', '%APPDATA%\\IMA', '%LOCALAPPDATA%\\IMA', '%APPDATA%\\ima.copilot', '%LOCALAPPDATA%\\ima.copilot'],
    conversationLocations: ['%USERPROFILE%\\.ima', '%USERPROFILE%\\.ima.copilot'],
    installUrls: { windows: 'https://ima.qq.com/download/', web: 'https://ima.qq.com/' },
    openLabel: '打开 ima.copilot',
    copyTargetLabel: '复制到 ima.copilot 对话、人设或知识库说明中',
    digestTargetLabel: '可粘贴到 ima.copilot 对话中，并围绕本机学生知识库执行',
    personaTargetLabel: 'ima.copilot 人设 / 技能说明',
    memoryTargetLabel: 'ima.copilot 长期背景 / 知识库说明',
  },
  workbuddy: {
    id: 'workbuddy',
    name: 'WorkBuddy',
    category: 'local-app',
    supportsLocalFiles: true,
    supportsAgentCreation: false,
    supportsPersonaSetting: true,
    supportsMemorySetting: true,
    supportsScheduledTask: false,
    supportsSubAgent: false,
    supportsProjectRules: true,
    supportsMemoryFile: true,
    supportsPersonaFile: true,
    supportsConversationExport: true,
    supportsMemoryPaste: true,
    supportsSoulPaste: true,
    openMode: 'exe',
    ruleFiles: ['AGENT.md', 'WorkBuddy.md'],
    memoryLocations: ['%USERPROFILE%\\.workbuddy', '%APPDATA%\\WorkBuddy', '%LOCALAPPDATA%\\WorkBuddy'],
    personaLocations: ['%USERPROFILE%\\.workbuddy', '%APPDATA%\\WorkBuddy', '%LOCALAPPDATA%\\WorkBuddy'],
    conversationLocations: ['%USERPROFILE%\\.workbuddy'],
    installUrls: { windows: 'https://www.workbuddy.ai/', web: 'https://www.workbuddy.ai/' },
    openLabel: '打开 WorkBuddy',
    copyTargetLabel: '复制到 WorkBuddy 对话、Agent 设置或工作区说明中',
    digestTargetLabel: '可粘贴到 WorkBuddy 执行，并直接读写本机知识库',
    personaTargetLabel: 'WorkBuddy Agent 人设 / 工作区说明',
    memoryTargetLabel: 'WorkBuddy 长期记忆 / 背景资料',
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    category: 'local-cli',
    supportsLocalFiles: true,
    supportsAgentCreation: false,
    supportsPersonaSetting: false,
    supportsMemorySetting: false,
    supportsScheduledTask: false,
    supportsSubAgent: false,
    supportsProjectRules: true,
    supportsMemoryFile: false,
    supportsPersonaFile: false,
    supportsConversationExport: true,
    supportsMemoryPaste: true,
    supportsSoulPaste: true,
    openMode: 'cli',
    ruleFiles: ['AGENTS.md', 'AGENT.md'],
    memoryLocations: ['%USERPROFILE%\\.codex'],
    personaLocations: ['%USERPROFILE%\\.codex'],
    conversationLocations: ['%USERPROFILE%\\.codex'],
    installUrls: { windows: 'https://chatgpt.com/codex' },
    openLabel: '打开 Codex',
    copyTargetLabel: '复制到 Codex 会话或 AGENTS.md 中',
    digestTargetLabel: '可粘贴到 Codex，在学生知识库目录中执行',
    personaTargetLabel: 'Codex 项目说明 / AGENTS.md',
    memoryTargetLabel: 'Codex 会话总结 / 项目记忆',
  },
  'claude-code': {
    id: 'claude-code',
    name: 'Claude Code',
    category: 'local-cli',
    supportsLocalFiles: true,
    supportsAgentCreation: false,
    supportsPersonaSetting: false,
    supportsMemorySetting: false,
    supportsScheduledTask: false,
    supportsSubAgent: false,
    supportsProjectRules: true,
    supportsMemoryFile: false,
    supportsPersonaFile: false,
    supportsConversationExport: true,
    supportsMemoryPaste: true,
    supportsSoulPaste: true,
    openMode: 'cli',
    ruleFiles: ['CLAUDE.md', 'AGENT.md'],
    memoryLocations: ['%USERPROFILE%\\.claude'],
    personaLocations: ['%USERPROFILE%\\.claude'],
    conversationLocations: ['%USERPROFILE%\\.claude'],
    installUrls: { windows: 'https://www.anthropic.com/claude-code' },
    openLabel: '打开 Claude Code',
    copyTargetLabel: '复制到 Claude Code 会话或 CLAUDE.md 中',
    digestTargetLabel: '可粘贴到 Claude Code，在学生知识库目录中执行',
    personaTargetLabel: 'Claude Code 项目规则 / CLAUDE.md',
    memoryTargetLabel: 'Claude Code 会话总结',
  },
  chatgpt: {
    id: 'chatgpt',
    name: 'ChatGPT',
    category: 'web-app',
    supportsLocalFiles: false,
    supportsAgentCreation: false,
    supportsPersonaSetting: true,
    supportsMemorySetting: true,
    supportsScheduledTask: false,
    supportsSubAgent: false,
    supportsProjectRules: false,
    supportsMemoryFile: false,
    supportsPersonaFile: false,
    supportsConversationExport: true,
    supportsMemoryPaste: true,
    supportsSoulPaste: true,
    openMode: 'url',
    ruleFiles: ['AGENT.md'],
    memoryLocations: [],
    personaLocations: [],
    conversationLocations: [],
    installUrls: { web: 'https://chatgpt.com/' },
    openLabel: '打开 ChatGPT',
    copyTargetLabel: '复制到 ChatGPT 对话或 GPT Instructions 中',
    digestTargetLabel: '可粘贴到 ChatGPT 对话中手动执行',
    personaTargetLabel: 'ChatGPT GPT Instructions / 自定义指令',
    memoryTargetLabel: 'ChatGPT 会话总结 / 记忆说明',
  },
  claude: {
    id: 'claude',
    name: 'Claude',
    category: 'web-app',
    supportsLocalFiles: false,
    supportsAgentCreation: false,
    supportsPersonaSetting: true,
    supportsMemorySetting: true,
    supportsScheduledTask: false,
    supportsSubAgent: false,
    supportsProjectRules: false,
    supportsMemoryFile: false,
    supportsPersonaFile: false,
    supportsConversationExport: true,
    supportsMemoryPaste: true,
    supportsSoulPaste: true,
    openMode: 'url',
    ruleFiles: ['AGENT.md'],
    memoryLocations: [],
    personaLocations: [],
    conversationLocations: [],
    installUrls: { web: 'https://claude.ai/' },
    openLabel: '打开 Claude',
    copyTargetLabel: '复制到 Claude 对话或 Project Instructions 中',
    digestTargetLabel: '可粘贴到 Claude 对话中手动执行',
    personaTargetLabel: 'Claude Project Instructions / 角色设定',
    memoryTargetLabel: 'Claude 会话总结 / 项目知识',
  },
  doubao: {
    id: 'doubao',
    name: '豆包',
    category: 'web-app',
    supportsLocalFiles: false,
    supportsAgentCreation: false,
    supportsPersonaSetting: true,
    supportsMemorySetting: true,
    supportsScheduledTask: false,
    supportsSubAgent: false,
    supportsProjectRules: false,
    supportsMemoryFile: false,
    supportsPersonaFile: false,
    supportsConversationExport: true,
    supportsMemoryPaste: true,
    supportsSoulPaste: true,
    openMode: 'url',
    ruleFiles: ['AGENT.md'],
    memoryLocations: [],
    personaLocations: [],
    conversationLocations: [],
    installUrls: { web: 'https://www.doubao.com/' },
    openLabel: '打开豆包',
    copyTargetLabel: '复制到豆包对话或智能体设置中',
    digestTargetLabel: '可粘贴到豆包对话中手动执行',
    personaTargetLabel: '豆包智能体人设 / 提示词',
    memoryTargetLabel: '豆包智能体记忆 / 背景资料',
  },
  coze: {
    id: 'coze',
    name: 'Coze',
    category: 'platform',
    supportsLocalFiles: false,
    supportsAgentCreation: true,
    supportsPersonaSetting: true,
    supportsMemorySetting: true,
    supportsScheduledTask: false,
    supportsSubAgent: true,
    supportsProjectRules: false,
    supportsMemoryFile: false,
    supportsPersonaFile: false,
    supportsConversationExport: true,
    supportsMemoryPaste: true,
    supportsSoulPaste: true,
    openMode: 'url',
    ruleFiles: ['AGENT.md'],
    memoryLocations: [],
    personaLocations: [],
    conversationLocations: [],
    installUrls: { web: 'https://www.coze.cn/' },
    openLabel: '打开 Coze',
    copyTargetLabel: '复制到 Coze Bot 提示词或知识库设置中',
    digestTargetLabel: '可粘贴到 Coze Bot 对话或工作流中手动执行',
    personaTargetLabel: 'Coze Bot 人设 / Prompt',
    memoryTargetLabel: 'Coze Bot 记忆 / 知识库说明',
  },
  fastgpt: {
    id: 'fastgpt',
    name: 'FastGPT',
    category: 'platform',
    supportsLocalFiles: false,
    supportsAgentCreation: true,
    supportsPersonaSetting: true,
    supportsMemorySetting: true,
    supportsScheduledTask: false,
    supportsSubAgent: true,
    supportsProjectRules: false,
    supportsMemoryFile: false,
    supportsPersonaFile: false,
    supportsConversationExport: true,
    supportsMemoryPaste: true,
    supportsSoulPaste: true,
    openMode: 'url',
    ruleFiles: ['AGENT.md'],
    memoryLocations: [],
    personaLocations: [],
    conversationLocations: [],
    installUrls: { web: 'https://fastgpt.in/' },
    openLabel: '打开 FastGPT',
    copyTargetLabel: '复制到 FastGPT 应用提示词或知识库设置中',
    digestTargetLabel: '可粘贴到 FastGPT 对话或工作流中手动执行',
    personaTargetLabel: 'FastGPT 应用系统提示词',
    memoryTargetLabel: 'FastGPT 应用长期背景 / 知识库说明',
  },
};

const agentToolOptions = Object.values(agentToolProfiles);

function getAgentToolProfile(value?: AgentToolId) {
  const profile = agentToolProfiles[value ?? 'qclaw'] ?? agentToolProfiles.qclaw;
  if (activeStorageConfig.platform === 'windows' && ['marvis', 'hohu', 'ima.copilot', 'workbuddy'].includes(profile.id)) {
    return {
      ...profile,
      supportsLocalFiles: true,
      digestTargetLabel: `可粘贴到 ${profile.name} 执行，并直接读写本机知识库`,
    };
  }
  return profile;
}

function installStatusKeyForTool(toolId: AgentToolId): keyof AgentToolInstallStatus | 'claudeCode' {
  if (toolId === 'ima.copilot') return 'imaCopilot';
  return toolId === 'claude-code' ? 'claudeCode' : toolId;
}

function openedKeyForTool(toolId: AgentToolId): AgentToolAdapter['openedKey'] {
  if (toolId === 'ima.copilot') return 'imaCopilotOpened';
  if (toolId === 'claude-code') return 'claudeCodeOpened';
  if (['qclaw', 'marvis', 'hohu', 'openclaw', 'workbuddy', 'codex'].includes(toolId)) return `${toolId}Opened` as AgentToolAdapter['openedKey'];
  return undefined;
}

function buildAgentToolAdapter(toolId: AgentToolId): AgentToolAdapter {
  const profile = getAgentToolProfile(toolId);
  return {
    id: profile.id,
    profile,
    statusKey: installStatusKeyForTool(profile.id),
    openedKey: openedKeyForTool(profile.id),
    canOpenLocally: profile.openMode !== 'url' || Boolean(profile.installUrls.web),
    getInstall(status) {
      if (!status) return undefined;
      const key = installStatusKeyForTool(profile.id);
      return status[key as keyof AgentToolInstallStatus] as AgentToolInstall | undefined;
    },
    isOpened(openState) {
      if (profile.openMode === 'url') return true;
      return Boolean(openState[profile.id]);
    },
    open(openHandler) {
      openHandler(profile.id);
    },
    buildInitPrompt(student) {
      return buildToolPrompt({ ...student, agentTool: profile.id });
    },
    buildDigestCommand(student) {
      return buildDigestCommand({ ...student, agentTool: profile.id });
    },
    buildConsultCommand(student) {
      return buildConsultCommand({ ...student, agentTool: profile.id });
    },
    buildScanPrompt(student, kind) {
      return buildAiAgentScanPrompt({ ...student, agentTool: profile.id }, kind, profile.id);
    },
    primaryRuleFile() {
      return profile.ruleFiles[0] || 'AGENT.md';
    },
  };
}

function getAgentToolAdapter(toolId?: AgentToolId) {
  return buildAgentToolAdapter(toolId ?? 'qclaw');
}

type ArchiveKeywordConfig = Record<'summary' | 'report' | 'qa', string>;
type TemplateKey = 'AGENT.md' | 'Soul.md' | 'Memory.md' | 'init-step-1.md' | 'init-step-2.md' | 'digest-prompt.md' | 'consult-prompt.md';
type TemplateFiles = Record<TemplateKey, string>;
type TemplateCenterState = {
  ok: boolean;
  activeTemplate: 'system' | 'custom';
  templateRoot?: string;
  systemPath?: string;
  customPath?: string;
  system?: Partial<TemplateFiles>;
  custom?: Partial<TemplateFiles>;
  message?: string;
};
type AgentCenterState = {
  ok: boolean;
  memoryDir?: string;
  soulDir?: string;
  unifiedMemoryPath?: string;
  unifiedSoulPath?: string;
  unifiedMemory?: string;
  unifiedSoul?: string;
  memoryIndex?: { sources?: Array<{ tool: AgentToolId; currentPath: string; lastSyncedAt?: string; hash?: string; exists?: boolean }> };
  soulIndex?: { sources?: Array<{ tool: AgentToolId; currentPath: string; lastSyncedAt?: string; lastCheckedAt?: string; hash?: string; exists?: boolean }> };
  message?: string;
};
type AgentSourceRecord = {
  id: string;
  assetType: 'rule' | 'memory' | 'persona' | 'conversation' | 'extract';
  tool: AgentToolId;
  sourceType: string;
  sourcePath?: string;
  targetPath?: string;
  importedAt?: string;
  confidence?: number;
  confirmed?: boolean;
  notes?: string;
};
type AgentSourceRegistryState = {
  ok: boolean;
  path?: string;
  records?: AgentSourceRecord[];
  message?: string;
};
type AgentConversationState = {
  ok: boolean;
  conversationDir?: string;
  importsDir?: string;
  extractsDir?: string;
  index?: {
    imports?: Array<{ path?: string; tool?: AgentToolId; importedAt?: string; size?: number }>;
    extracts?: Array<{ path?: string; tool?: AgentToolId; importedAt?: string; memoryCount?: number; soulCount?: number; qaCount?: number; todoCount?: number }>;
  };
  message?: string;
};
type AgentKnowledgeCandidate = {
  path: string;
  name: string;
  tool: AgentToolId;
  kind: AgentKnowledgeKind;
  score: number;
  reasons?: string[];
  mtime?: string;
  size?: number;
  preview?: string;
};
type AgentRuleFile = {
  fileName: string;
  path: string;
  exists: boolean;
  size?: number;
  mtime?: string;
  content: string;
  hash?: string;
};
type AgentRulesState = {
  ok: boolean;
  rootPath?: string;
  rulesDir?: string;
  files?: AgentRuleFile[];
  message?: string;
};

const templateKeys: TemplateKey[] = ['AGENT.md', 'Soul.md', 'Memory.md', 'init-step-1.md', 'init-step-2.md', 'digest-prompt.md', 'consult-prompt.md'];
let activeTemplateFiles: Partial<TemplateFiles> = {};

const defaultArchiveKeywords: ArchiveKeywordConfig = {
  summary: '摘要库,摘要,summary,digest',
  report: '综合库,综合,学情,汇总,分析,report,overview,总览,周报,月报,阶段',
  qa: '咨询精华库,问答,qa,q&a,对话,咨询,精华',
};

function loadArchiveKeywords(): ArchiveKeywordConfig {
  try {
    return { ...defaultArchiveKeywords, ...JSON.parse(localStorage.getItem(archiveKeywordStorageKey) || '{}') };
  } catch {
    return defaultArchiveKeywords;
  }
}

function saveArchiveKeywords(value: ArchiveKeywordConfig) {
  localStorage.setItem(archiveKeywordStorageKey, JSON.stringify(value));
}

function keywordMatches(haystack: string, keywords: string) {
  return keywords
    .split(/[,，\n]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .some((item) => haystack.includes(item));
}

function classifyMarkdownFile(file: MarkdownFile, keywordConfig: ArchiveKeywordConfig = defaultArchiveKeywords): ArchiveCategoryId {
  if (file.name.toLowerCase() === 'index.md') return 'other';
  const haystack = `${file.path}/${file.name}`.toLowerCase();
  if (keywordMatches(haystack, keywordConfig.summary)) return 'summary';
  if (keywordMatches(haystack, keywordConfig.qa)) return 'qa';
  if (keywordMatches(haystack, keywordConfig.report)) return 'report';
  return 'other';
}

function isVisibleArchiveFile(file: MarkdownFile) {
  const name = file.name.toLowerCase();
  return !['agent.md', 'soul.md', 'memory.md', 'log.md'].includes(name);
}

function isLearningReportFile(file: MarkdownFile) {
  const normalized = `${file.path}/${file.name}`.replace(/\\/g, '/').toLowerCase();
  return normalized.includes('学情报告/') || normalized.includes('/learning-report/') || normalized.includes('/learning-reports/');
}

function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return '未知大小';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

const themeOptions: Array<{ id: ThemeName; label: string }> = [
  { id: 'blue', label: '蓝色系' },
  { id: 'pink', label: '粉色系' },
  { id: 'green', label: '绿色系' },
  { id: 'purple', label: '紫色系' },
  { id: 'orange', label: '橙色系' },
];

const languageOptions: Array<{ id: LanguageCode; label: string; nativeLabel: string }> = [
  { id: 'zh-CN', label: '简体中文', nativeLabel: '简体中文' },
  { id: 'zh-TW', label: '繁体中文', nativeLabel: '繁體中文' },
  { id: 'en', label: '英文', nativeLabel: 'English' },
  { id: 'fr', label: '法文', nativeLabel: 'Français' },
  { id: 'es', label: '西班牙文', nativeLabel: 'Español' },
  { id: 'ja', label: '日文', nativeLabel: '日本語' },
  { id: 'ko', label: '韩文', nativeLabel: '한국어' },
  { id: 'vi', label: '越南文', nativeLabel: 'Tiếng Việt' },
  { id: 'ms', label: '马来西亚文', nativeLabel: 'Bahasa Melayu' },
];

const zhCnText = {
  'app.name': 'AI教育管家控制台',
  'app.subtitle': '半自动完成初始文档导出、Agent 工具初始化指令和 Obsidian 查看入口。',
  'nav.home': '首页',
  'nav.init': '初始化教育管家',
  'nav.new': '新建教育智能体',
  'nav.inbox': '资料收集与处理',
  'nav.assets': '文件资产中心',
  'nav.projects': '学习项目',
  'nav.growth': '成长模型',
  'nav.reports': '学情报告',
  'nav.archive': '查看教育档案',
  'nav.qa': '教育管家问答',
  'nav.tasks': '定时任务',
  'nav.settings': '系统设置',
  'nav.knowledge': '智能体知识管理',
  'nav.memory': 'Agent 记忆管理',
  'nav.soul': 'Agent 设定管理',
  'nav.rules': '智能体规则文件管理',
  'nav.conversation': '对话历史导入与提取',
  'nav.expand': '展开',
  'nav.collapse': '收起',
  'sidebar.hide': '隐藏左边栏',
  'sidebar.show': '显示左边栏',
  'students.title': '学生档案',
  'students.add': '新增学生',
  'student.standard': '标准知识库',
  'student.adopted': '接管知识库',
  'settings.title': '系统设置',
  'settings.description.windows': '默认根目录：D:\\学生资料；可在设置中更换资料根目录，并检测本机 Agent 工具安装状态。',
  'settings.description.android': '默认使用 App 内置资料库；Downloads 导出与 Obsidian Vault 授权作为备份和高级浏览方式。',
  'settings.language.title': '界面语言',
  'settings.language.description': '选择默认界面语言。切换后主导航、系统设置和通用操作会立即显示为所选语言。',
  'settings.language.select': '默认语言',
  'settings.theme': '更换皮肤',
  'settings.storageMode': '存储模式',
  'settings.licenseStatus': '授权状态',
  'settings.studentRoot': '学生资料根目录',
  'settings.agentAdapters': 'Agent 工具适配器',
  'settings.agentAdapters.desc': '展示工具能力、规则文件模板和打开方式，后续新增工具只需补配置。',
  'settings.redetect': '重新检测',
  'settings.redetectSoftware': '重新检测软件',
  'settings.legal': '法律与服务条款',
  'settings.legal.desc': '继续使用本软件前，请阅读并理解用户协议与隐私政策。商业部署时建议同步配置正式售后、隐私与订阅说明。',
  'legal.agreement': '用户协议',
  'legal.privacy': '隐私政策',
  'license.activateFirst': '请先激活许可证',
  'license.available': '未激活可用',
  'license.goSettings': '去系统设置激活',
  'license.readOnly': '首页 / 系统设置 / 只读档案',
  'install.first': '请先安装 Agent 工具',
  'install.description': 'Windows 版需要先安装至少一个支持的 Agent 工具，控制台才能创建并引导本机教育管家。',
  'install.download': '下载',
  'install.redetect': '重新检测',
  'status.webEntry': '网页入口',
  'status.opened': '已打开',
  'status.notOpened': '未打开',
  'version.current': '当前版本',
} as const;

type TranslationKey = keyof typeof zhCnText;

const uiTranslations: Record<LanguageCode, Partial<Record<TranslationKey, string>>> = {
  'zh-CN': zhCnText,
  'zh-TW': {
    'app.name': 'AI教育管家控制台',
    'app.subtitle': '半自動完成初始文件匯出、Agent 工具初始化指令和 Obsidian 查看入口。',
    'nav.home': '首頁',
    'nav.init': '初始化教育管家',
    'nav.new': '新建教育智能體',
    'nav.inbox': '資料收集與處理',
    'nav.reports': '學情報告',
    'nav.archive': '查看教育檔案',
    'nav.qa': '教育管家問答',
    'nav.tasks': '定時任務',
    'nav.settings': '系統設定',
    'nav.knowledge': '智能體知識管理',
    'nav.memory': 'Agent 記憶管理',
    'nav.soul': 'Agent 設定管理',
    'nav.rules': '智能體規則文件管理',
    'nav.conversation': '對話歷史匯入與提取',
    'nav.expand': '展開',
    'nav.collapse': '收起',
    'sidebar.hide': '隱藏左邊欄',
    'sidebar.show': '顯示左邊欄',
    'students.title': '學生檔案',
    'students.add': '新增學生',
    'student.standard': '標準知識庫',
    'student.adopted': '接管知識庫',
    'settings.title': '系統設定',
    'settings.description.windows': '預設根目錄：D:\\學生資料；可在設定中更換資料根目錄，並檢測本機 Agent 工具安裝狀態。',
    'settings.description.android': '預設使用 App 內建資料庫；Downloads 匯出與 Obsidian Vault 授權作為備份和進階瀏覽方式。',
    'settings.language.title': '介面語言',
    'settings.language.description': '選擇預設介面語言。切換後主導覽、系統設定和通用操作會立即顯示為所選語言。',
    'settings.language.select': '預設語言',
    'settings.theme': '更換皮膚',
    'settings.storageMode': '儲存模式',
    'settings.licenseStatus': '授權狀態',
    'settings.studentRoot': '學生資料根目錄',
    'settings.agentAdapters': 'Agent 工具適配器',
    'settings.agentAdapters.desc': '展示工具能力、規則文件模板和開啟方式，後續新增工具只需補配置。',
    'settings.redetect': '重新檢測',
    'settings.redetectSoftware': '重新檢測軟體',
    'settings.legal': '法律與服務條款',
    'settings.legal.desc': '繼續使用本軟體前，請閱讀並理解使用者協議與隱私政策。',
    'legal.agreement': '使用者協議',
    'legal.privacy': '隱私政策',
    'license.activateFirst': '請先啟用授權',
    'license.available': '未啟用可用',
    'license.goSettings': '前往系統設定啟用',
    'license.readOnly': '首頁 / 系統設定 / 唯讀檔案',
    'install.first': '請先安裝 Agent 工具',
    'install.description': 'Windows 版需要先安裝至少一個支援的 Agent 工具，控制台才能建立並引導本機教育管家。',
    'install.download': '下載',
    'install.redetect': '重新檢測',
    'status.webEntry': '網頁入口',
    'status.opened': '已開啟',
    'status.notOpened': '未開啟',
  },
  en: {
    'app.name': 'AI Education Manager Console',
    'app.subtitle': 'Semi-automated setup for starter documents, Agent initialization prompts, and Obsidian viewing.',
    'nav.home': 'Home',
    'nav.init': 'Initialize Manager',
    'nav.new': 'New Education Agent',
    'nav.inbox': 'Collect & Process',
    'nav.reports': 'Learning Reports',
    'nav.archive': 'Education Archive',
    'nav.qa': 'Agent Q&A',
    'nav.tasks': 'Scheduled Tasks',
    'nav.settings': 'Settings',
    'nav.knowledge': 'Agent Knowledge',
    'nav.memory': 'Agent Memory',
    'nav.soul': 'Agent Persona',
    'nav.rules': 'Agent Rule Files',
    'nav.conversation': 'Conversation Import',
    'nav.expand': 'Expand',
    'nav.collapse': 'Collapse',
    'sidebar.hide': 'Hide sidebar',
    'sidebar.show': 'Show sidebar',
    'students.title': 'Student Archives',
    'students.add': 'Add student',
    'student.standard': 'Standard KB',
    'student.adopted': 'Adopted KB',
    'settings.title': 'Settings',
    'settings.description.windows': 'Default root: D:\\Student Data. You can change the data root and check local Agent installations.',
    'settings.description.android': 'Uses the built-in app storage by default; Downloads export and Obsidian vault access are advanced backup options.',
    'settings.language.title': 'Interface Language',
    'settings.language.description': 'Choose the default UI language. Navigation, settings, and common actions update immediately.',
    'settings.language.select': 'Default language',
    'settings.theme': 'Theme',
    'settings.storageMode': 'Storage mode',
    'settings.licenseStatus': 'License status',
    'settings.studentRoot': 'Student data root',
    'settings.agentAdapters': 'Agent Tool Adapters',
    'settings.agentAdapters.desc': 'Shows capabilities, rule templates, and opening methods for each Agent tool.',
    'settings.redetect': 'Check again',
    'settings.redetectSoftware': 'Recheck software',
    'settings.legal': 'Legal Terms',
    'settings.legal.desc': 'Please read the user agreement and privacy policy before continuing.',
    'legal.agreement': 'User Agreement',
    'legal.privacy': 'Privacy Policy',
    'license.activateFirst': 'Activate License First',
    'license.available': 'Available before activation',
    'license.goSettings': 'Go to settings',
    'license.readOnly': 'Home / Settings / read-only archive',
    'install.first': 'Install an Agent Tool First',
    'install.description': 'The Windows console needs at least one supported Agent tool installed before creating and guiding a local education manager.',
    'install.download': 'Download',
    'install.redetect': 'Check again',
    'status.webEntry': 'Web entry',
    'status.opened': 'opened',
    'status.notOpened': 'not opened',
    'version.current': 'Current version',
  },
  fr: {
    'app.name': 'Console AI Education Manager',
    'nav.home': 'Accueil',
    'nav.init': 'Initialiser',
    'nav.new': 'Nouvel agent',
    'nav.inbox': 'Collecte et traitement',
    'nav.reports': 'Rapports',
    'nav.archive': 'Dossiers',
    'nav.qa': 'Questions agent',
    'nav.tasks': 'Tâches',
    'nav.settings': 'Paramètres',
    'nav.knowledge': 'Connaissances agent',
    'nav.memory': 'Mémoire agent',
    'nav.soul': 'Profil agent',
    'nav.rules': 'Fichiers de règles',
    'nav.conversation': 'Import de conversations',
    'nav.expand': 'Développer',
    'nav.collapse': 'Réduire',
    'sidebar.hide': 'Masquer la barre',
    'sidebar.show': 'Afficher la barre',
    'students.title': 'Dossiers élèves',
    'students.add': 'Ajouter',
    'student.standard': 'Base standard',
    'student.adopted': 'Base adoptée',
    'settings.title': 'Paramètres',
    'settings.description.windows': 'Racine par défaut : D:\\学生资料. Vous pouvez changer la racine et vérifier les outils Agent locaux.',
    'settings.description.android': 'Utilise le stockage intégré par défaut ; Downloads et Obsidian sont des options avancées.',
    'settings.language.title': 'Langue de l’interface',
    'settings.language.description': 'Choisissez la langue par défaut de l’interface.',
    'settings.language.select': 'Langue par défaut',
    'settings.theme': 'Thème',
    'settings.storageMode': 'Mode de stockage',
    'settings.licenseStatus': 'Licence',
    'settings.studentRoot': 'Racine élèves',
    'settings.agentAdapters': 'Adaptateurs Agent',
    'settings.agentAdapters.desc': 'Affiche les capacités, modèles de règles et méthodes d’ouverture.',
    'settings.redetect': 'Revérifier',
    'settings.redetectSoftware': 'Revérifier les logiciels',
    'settings.legal': 'Conditions légales',
    'settings.legal.desc': 'Veuillez lire le contrat utilisateur et la politique de confidentialité avant de continuer.',
    'legal.agreement': 'Contrat utilisateur',
    'legal.privacy': 'Politique de confidentialité',
    'license.activateFirst': 'Activez la licence',
    'license.available': 'Disponible avant activation',
    'license.goSettings': 'Aller aux paramètres',
    'license.readOnly': 'Accueil / Paramètres / lecture seule',
    'install.first': 'Installez un outil Agent',
    'install.description': 'La version Windows nécessite au moins un outil Agent pris en charge.',
    'install.download': 'Télécharger',
    'install.redetect': 'Revérifier',
    'status.webEntry': 'Entrée web',
    'status.opened': 'ouvert',
    'status.notOpened': 'non ouvert',
  },
  es: {
    'app.name': 'Consola AI Education Manager',
    'nav.home': 'Inicio',
    'nav.init': 'Inicializar',
    'nav.new': 'Nuevo agente',
    'nav.inbox': 'Recopilar y procesar',
    'nav.reports': 'Informes',
    'nav.archive': 'Archivo',
    'nav.qa': 'Preguntas del agente',
    'nav.tasks': 'Tareas',
    'nav.settings': 'Configuración',
    'nav.knowledge': 'Conocimiento del agente',
    'nav.memory': 'Memoria del agente',
    'nav.soul': 'Perfil del agente',
    'nav.rules': 'Archivos de reglas',
    'nav.conversation': 'Importar conversaciones',
    'nav.expand': 'Expandir',
    'nav.collapse': 'Contraer',
    'sidebar.hide': 'Ocultar barra',
    'sidebar.show': 'Mostrar barra',
    'students.title': 'Archivos de estudiantes',
    'students.add': 'Añadir',
    'student.standard': 'Base estándar',
    'student.adopted': 'Base adoptada',
    'settings.title': 'Configuración',
    'settings.description.windows': 'Raíz predeterminada: D:\\学生资料. Puede cambiarla y verificar herramientas Agent locales.',
    'settings.description.android': 'Usa almacenamiento interno por defecto; Downloads y Obsidian son opciones avanzadas.',
    'settings.language.title': 'Idioma de la interfaz',
    'settings.language.description': 'Elija el idioma predeterminado de la interfaz.',
    'settings.language.select': 'Idioma predeterminado',
    'settings.theme': 'Tema',
    'settings.storageMode': 'Modo de almacenamiento',
    'settings.licenseStatus': 'Licencia',
    'settings.studentRoot': 'Raíz de estudiantes',
    'settings.agentAdapters': 'Adaptadores Agent',
    'settings.agentAdapters.desc': 'Muestra capacidades, plantillas de reglas y métodos de apertura.',
    'settings.redetect': 'Comprobar de nuevo',
    'settings.redetectSoftware': 'Revisar software',
    'settings.legal': 'Términos legales',
    'settings.legal.desc': 'Lea el acuerdo de usuario y la política de privacidad antes de continuar.',
    'legal.agreement': 'Acuerdo de usuario',
    'legal.privacy': 'Política de privacidad',
    'license.activateFirst': 'Active la licencia',
    'license.available': 'Disponible antes de activar',
    'license.goSettings': 'Ir a configuración',
    'license.readOnly': 'Inicio / Configuración / solo lectura',
    'install.first': 'Instale una herramienta Agent',
    'install.description': 'La versión Windows necesita al menos una herramienta Agent compatible.',
    'install.download': 'Descargar',
    'install.redetect': 'Comprobar',
    'status.webEntry': 'Entrada web',
    'status.opened': 'abierto',
    'status.notOpened': 'no abierto',
  },
  ja: {
    'app.name': 'AI教育マネージャーコンソール',
    'nav.home': 'ホーム',
    'nav.init': '初期化',
    'nav.new': '新規エージェント',
    'nav.inbox': '資料収集と処理',
    'nav.reports': '学習レポート',
    'nav.archive': '教育アーカイブ',
    'nav.qa': 'エージェントQ&A',
    'nav.tasks': '定期タスク',
    'nav.settings': '設定',
    'nav.knowledge': 'エージェント知識管理',
    'nav.memory': 'エージェント記憶',
    'nav.soul': 'エージェント設定',
    'nav.rules': 'ルールファイル',
    'nav.conversation': '会話履歴インポート',
    'nav.expand': '展開',
    'nav.collapse': '折りたたむ',
    'sidebar.hide': 'サイドバーを隠す',
    'sidebar.show': 'サイドバーを表示',
    'students.title': '学生アーカイブ',
    'students.add': '学生を追加',
    'student.standard': '標準ナレッジベース',
    'student.adopted': '既存ベース',
    'settings.title': '設定',
    'settings.description.windows': '既定ルート：D:\\学生资料。データルート変更とローカルAgent検出ができます。',
    'settings.description.android': '既定ではアプリ内ストレージを使用します。Downloads と Obsidian は高度なオプションです。',
    'settings.language.title': '表示言語',
    'settings.language.description': '既定のUI言語を選択します。',
    'settings.language.select': '既定の言語',
    'settings.theme': 'テーマ',
    'settings.storageMode': '保存モード',
    'settings.licenseStatus': 'ライセンス状態',
    'settings.studentRoot': '学生データルート',
    'settings.agentAdapters': 'Agentツールアダプター',
    'settings.agentAdapters.desc': '各ツールの機能、ルールテンプレート、起動方法を表示します。',
    'settings.redetect': '再検出',
    'settings.redetectSoftware': 'ソフトを再検出',
    'settings.legal': '法的条項',
    'settings.legal.desc': '続行前に利用規約とプライバシーポリシーを確認してください。',
    'legal.agreement': '利用規約',
    'legal.privacy': 'プライバシーポリシー',
    'license.activateFirst': 'ライセンスを有効化',
    'license.available': '有効化前に利用可能',
    'license.goSettings': '設定へ',
    'license.readOnly': 'ホーム / 設定 / 読み取り専用',
    'install.first': 'Agentツールをインストール',
    'install.description': 'Windows版は対応するAgentツールが少なくとも1つ必要です。',
    'install.download': 'ダウンロード',
    'install.redetect': '再検出',
    'status.webEntry': 'Web入口',
    'status.opened': '起動済み',
    'status.notOpened': '未起動',
  },
  ko: {
    'app.name': 'AI 교육 매니저 콘솔',
    'nav.home': '홈',
    'nav.init': '초기화',
    'nav.new': '새 교육 에이전트',
    'nav.inbox': '자료 수집 및 처리',
    'nav.reports': '학습 보고서',
    'nav.archive': '교육 기록',
    'nav.qa': '에이전트 Q&A',
    'nav.tasks': '예약 작업',
    'nav.settings': '설정',
    'nav.knowledge': '에이전트 지식 관리',
    'nav.memory': '에이전트 메모리',
    'nav.soul': '에이전트 설정',
    'nav.rules': '규칙 파일',
    'nav.conversation': '대화 가져오기',
    'nav.expand': '펼치기',
    'nav.collapse': '접기',
    'sidebar.hide': '사이드바 숨기기',
    'sidebar.show': '사이드바 표시',
    'students.title': '학생 기록',
    'students.add': '학생 추가',
    'student.standard': '표준 지식베이스',
    'student.adopted': '기존 지식베이스',
    'settings.title': '설정',
    'settings.description.windows': '기본 루트: D:\\学生资料. 데이터 루트를 변경하고 로컬 Agent 설치를 확인할 수 있습니다.',
    'settings.description.android': '기본적으로 앱 내 저장소를 사용하며 Downloads와 Obsidian은 고급 옵션입니다.',
    'settings.language.title': '인터페이스 언어',
    'settings.language.description': '기본 UI 언어를 선택합니다.',
    'settings.language.select': '기본 언어',
    'settings.theme': '스킨',
    'settings.storageMode': '저장 모드',
    'settings.licenseStatus': '라이선스 상태',
    'settings.studentRoot': '학생 자료 루트',
    'settings.agentAdapters': 'Agent 도구 어댑터',
    'settings.agentAdapters.desc': '각 도구의 기능, 규칙 템플릿, 실행 방식을 표시합니다.',
    'settings.redetect': '다시 확인',
    'settings.redetectSoftware': '소프트웨어 재확인',
    'settings.legal': '법적 약관',
    'settings.legal.desc': '계속하기 전에 사용자 계약과 개인정보 처리방침을 확인하세요.',
    'legal.agreement': '사용자 계약',
    'legal.privacy': '개인정보 처리방침',
    'license.activateFirst': '라이선스 활성화',
    'license.available': '활성화 전 사용 가능',
    'license.goSettings': '설정으로 이동',
    'license.readOnly': '홈 / 설정 / 읽기 전용',
    'install.first': 'Agent 도구 설치',
    'install.description': 'Windows 버전은 지원되는 Agent 도구가 하나 이상 필요합니다.',
    'install.download': '다운로드',
    'install.redetect': '다시 확인',
    'status.webEntry': '웹 입구',
    'status.opened': '열림',
    'status.notOpened': '열리지 않음',
  },
  vi: {
    'app.name': 'Bảng điều khiển AI Education Manager',
    'nav.home': 'Trang chủ',
    'nav.init': 'Khởi tạo',
    'nav.new': 'Tạo Agent',
    'nav.inbox': 'Thu thập và xử lý',
    'nav.reports': 'Báo cáo học tập',
    'nav.archive': 'Hồ sơ học tập',
    'nav.qa': 'Hỏi đáp Agent',
    'nav.tasks': 'Tác vụ định kỳ',
    'nav.settings': 'Cài đặt',
    'nav.knowledge': 'Quản lý tri thức Agent',
    'nav.memory': 'Bộ nhớ Agent',
    'nav.soul': 'Thiết lập Agent',
    'nav.rules': 'Tệp quy tắc',
    'nav.conversation': 'Nhập hội thoại',
    'nav.expand': 'Mở rộng',
    'nav.collapse': 'Thu gọn',
    'sidebar.hide': 'Ẩn thanh bên',
    'sidebar.show': 'Hiện thanh bên',
    'students.title': 'Hồ sơ học sinh',
    'students.add': 'Thêm học sinh',
    'student.standard': 'Kho chuẩn',
    'student.adopted': 'Kho đã tiếp quản',
    'settings.title': 'Cài đặt',
    'settings.description.windows': 'Thư mục gốc mặc định: D:\\学生资料. Có thể đổi thư mục và kiểm tra Agent cục bộ.',
    'settings.description.android': 'Mặc định dùng bộ nhớ trong ứng dụng; Downloads và Obsidian là tùy chọn nâng cao.',
    'settings.language.title': 'Ngôn ngữ giao diện',
    'settings.language.description': 'Chọn ngôn ngữ giao diện mặc định.',
    'settings.language.select': 'Ngôn ngữ mặc định',
    'settings.theme': 'Giao diện',
    'settings.storageMode': 'Chế độ lưu trữ',
    'settings.licenseStatus': 'Trạng thái bản quyền',
    'settings.studentRoot': 'Thư mục học sinh',
    'settings.agentAdapters': 'Bộ thích ứng Agent',
    'settings.agentAdapters.desc': 'Hiển thị khả năng, mẫu quy tắc và cách mở từng công cụ.',
    'settings.redetect': 'Kiểm tra lại',
    'settings.redetectSoftware': 'Kiểm tra phần mềm',
    'settings.legal': 'Điều khoản pháp lý',
    'settings.legal.desc': 'Vui lòng đọc thỏa thuận người dùng và chính sách quyền riêng tư trước khi tiếp tục.',
    'legal.agreement': 'Thỏa thuận người dùng',
    'legal.privacy': 'Chính sách quyền riêng tư',
    'license.activateFirst': 'Kích hoạt giấy phép',
    'license.available': 'Có thể dùng trước kích hoạt',
    'license.goSettings': 'Tới cài đặt',
    'license.readOnly': 'Trang chủ / Cài đặt / chỉ đọc',
    'install.first': 'Cài đặt công cụ Agent',
    'install.description': 'Bản Windows cần ít nhất một công cụ Agent được hỗ trợ.',
    'install.download': 'Tải xuống',
    'install.redetect': 'Kiểm tra lại',
    'status.webEntry': 'Cổng web',
    'status.opened': 'đã mở',
    'status.notOpened': 'chưa mở',
  },
  ms: {
    'app.name': 'Konsol AI Education Manager',
    'nav.home': 'Laman utama',
    'nav.init': 'Permulaan',
    'nav.new': 'Agent baharu',
    'nav.inbox': 'Kumpul & proses',
    'nav.reports': 'Laporan pembelajaran',
    'nav.archive': 'Arkib pendidikan',
    'nav.qa': 'Soal jawab Agent',
    'nav.tasks': 'Tugasan berjadual',
    'nav.settings': 'Tetapan',
    'nav.knowledge': 'Pengurusan pengetahuan Agent',
    'nav.memory': 'Memori Agent',
    'nav.soul': 'Tetapan Agent',
    'nav.rules': 'Fail peraturan',
    'nav.conversation': 'Import perbualan',
    'nav.expand': 'Kembangkan',
    'nav.collapse': 'Tutup',
    'sidebar.hide': 'Sembunyikan bar sisi',
    'sidebar.show': 'Tunjuk bar sisi',
    'students.title': 'Arkib pelajar',
    'students.add': 'Tambah pelajar',
    'student.standard': 'Pangkalan standard',
    'student.adopted': 'Pangkalan diambil alih',
    'settings.title': 'Tetapan',
    'settings.description.windows': 'Akar lalai: D:\\学生资料. Anda boleh menukar akar data dan menyemak Agent setempat.',
    'settings.description.android': 'Storan aplikasi digunakan secara lalai; Downloads dan Obsidian ialah pilihan lanjutan.',
    'settings.language.title': 'Bahasa antara muka',
    'settings.language.description': 'Pilih bahasa UI lalai.',
    'settings.language.select': 'Bahasa lalai',
    'settings.theme': 'Tema',
    'settings.storageMode': 'Mod storan',
    'settings.licenseStatus': 'Status lesen',
    'settings.studentRoot': 'Akar data pelajar',
    'settings.agentAdapters': 'Penyesuai alat Agent',
    'settings.agentAdapters.desc': 'Memaparkan keupayaan, templat peraturan dan kaedah buka.',
    'settings.redetect': 'Semak semula',
    'settings.redetectSoftware': 'Semak perisian',
    'settings.legal': 'Terma undang-undang',
    'settings.legal.desc': 'Sila baca perjanjian pengguna dan dasar privasi sebelum meneruskan.',
    'legal.agreement': 'Perjanjian pengguna',
    'legal.privacy': 'Dasar privasi',
    'license.activateFirst': 'Aktifkan lesen',
    'license.available': 'Tersedia sebelum aktif',
    'license.goSettings': 'Pergi ke tetapan',
    'license.readOnly': 'Utama / Tetapan / baca sahaja',
    'install.first': 'Pasang alat Agent',
    'install.description': 'Versi Windows memerlukan sekurang-kurangnya satu alat Agent yang disokong.',
    'install.download': 'Muat turun',
    'install.redetect': 'Semak semula',
    'status.webEntry': 'Pintu web',
    'status.opened': 'dibuka',
    'status.notOpened': 'belum dibuka',
  },
};

const themeSkinImages: Record<ThemeName, string> = {
  blue: './skins/skin-blue.jpg',
  pink: './skins/skin-pink.jpg',
  green: './skins/skin-green.jpg',
  purple: './skins/skin-purple.jpg',
  orange: './skins/skin-orange.jpg',
};

const archiveCategories: Array<{ id: ArchiveCategoryId; label: string }> = [
  { id: 'summary', label: '资料摘要' },
  { id: 'report', label: '综合汇总' },
  { id: 'qa', label: '问答精华' },
  { id: 'other', label: '其他' },
  { id: 'all', label: '全部文件' },
];

const learningReportDefinitions: Array<{ id: LearningReportId; title: string; fileName: string; description: string }> = [
  { id: 'profile', title: '整体画像', fileName: '整体画像.md', description: '了解学生当前优势、短板、学习方式和沟通注意点。' },
  { id: 'daily', title: '每日行动建议', fileName: '每日行动建议.md', description: '给学生、家长、老师的今日行动提醒。' },
  { id: 'changes', title: '历史变化', fileName: '历史变化.md', description: '查看最近 7 天、30 天和阶段性的能力与习惯变化。' },
  { id: 'stage', title: '阶段总结', fileName: '阶段总结.md', description: '本阶段进展、问题、证据和下一步建议。' },
];

const defaultDraft: StudentDraft = {
  name: '张三',
  grade: '初二',
  school: '示例学校',
  goal: '建立长期学情档案，持续整理学习资料，并辅助家长做升学与能力发展判断',
  digestTime: '21:30',
  agentTool: 'qclaw',
  storageMode: 'app_private',
  knowledgeBaseMode: 'standard',
  agentBindingMode: 'subAgent',
  rootPathLabel: 'Downloads/AI教育管家/学生资料/张三知识库',
  remoteChannel: 'none',
  remoteContact: '',
  remoteNote: '',
  remoteBindingStatus: 'unbound',
  remoteBoundAt: '',
};

const seedStudents: Student[] = [
  {
    id: 'demo-zhangsan',
    name: '张三',
    grade: '初二',
    school: '示例学校',
    goal: '金融方向潜力发展与日常学习资料整理',
    digestTime: '21:30',
    agentTool: 'qclaw',
    storageMode: 'app_private',
    knowledgeBaseMode: 'standard',
    agentBindingMode: 'subAgent',
    rootPathLabel: 'Downloads/AI教育管家/学生资料/张三知识库',
    remoteChannel: 'none',
    remoteContact: '',
    remoteNote: '',
    remoteBindingStatus: 'unbound',
    remoteBoundAt: '',
    createdAt: '2026-07-03',
    status: 'ready',
    schemaVersion: initSchemaVersion,
  },
];

function bridge() {
  return (window as unknown as { AndroidBridge?: AndroidBridge }).AndroidBridge;
}

function loadStudents() {
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed = raw ? (JSON.parse(raw) as Student[]) : seedStudents;
    return parsed.map((student) => ({
      ...student,
      schemaVersion: student.schemaVersion ?? initSchemaVersion,
      agentTool: agentToolProfiles[student.agentTool] ? student.agentTool : 'qclaw',
      storageMode: student.storageMode ?? 'app_private',
      knowledgeBaseMode: student.knowledgeBaseMode ?? 'standard',
      rootPath: student.rootPath ?? undefined,
      rawPath: student.rawPath ?? undefined,
      summaryPath: student.summaryPath ?? undefined,
      agentPath: student.agentPath ?? undefined,
      outputPath: student.outputPath ?? undefined,
      rootPathLabel: student.rootPathLabel ?? student.rootPath ?? `Downloads/AI教育管家/学生资料/${sanitizeName(student.name)}知识库`,
      pendingDigestCount: student.pendingDigestCount ?? 0,
      submittedDigestCount: student.submittedDigestCount ?? 0,
      processedDigestCount: student.processedDigestCount ?? 0,
      lastDigestAt: student.lastDigestAt ?? '',
      digestStatus: student.digestStatus ?? 'idle',
      digestMessage: student.digestMessage ?? '',
      materialSources: Array.isArray(student.materialSources) ? student.materialSources : [],
      agentBindingMode: student.agentBindingMode ?? agentBindingModeForTool(agentToolProfiles[student.agentTool] ? student.agentTool : 'qclaw'),
      agentName: student.agentName ?? '',
      agentNote: student.agentNote ?? '',
      memoryConfig: student.memoryConfig ?? {
        unifiedMemoryPath: joinDisplayPath(student.rootPath ?? pathsFor(student.name).root, 'Agent记忆', 'UnifiedMemory.md'),
        lastMergedAt: '',
        sources: [],
      },
      soulConfig: student.soulConfig ?? {
        unifiedSoulPath: joinDisplayPath(student.rootPath ?? pathsFor(student.name).root, 'Agent设定', 'UnifiedSoul.md'),
        lastDistributedAt: '',
        sources: [],
      },
      templateProfile: student.templateProfile ?? {
        activeTemplate: 'system',
        customTemplatePath: '',
      },
      adoptedAt: student.adoptedAt ?? '',
      remoteChannel: student.remoteChannel ?? 'none',
      remoteContact: student.remoteContact ?? '',
      remoteNote: student.remoteNote ?? '',
      remoteBindingStatus: student.remoteBindingStatus ?? 'unbound',
      remoteBoundAt: student.remoteBoundAt ?? '',
    }));
  } catch {
    return seedStudents;
  }
}

function saveStudents(students: Student[]) {
  localStorage.setItem(storageKey, JSON.stringify(students));
}

function loadTheme() {
  const value = localStorage.getItem(themeStorageKey);
  return themeOptions.some((item) => item.id === value) ? (value as ThemeName) : 'blue';
}

function saveTheme(theme: ThemeName) {
  localStorage.setItem(themeStorageKey, theme);
}

function loadLanguage() {
  const value = localStorage.getItem(languageStorageKey) as LanguageCode | null;
  return languageOptions.some((item) => item.id === value) ? (value as LanguageCode) : 'zh-CN';
}

function saveLanguage(language: LanguageCode) {
  localStorage.setItem(languageStorageKey, language);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function sanitizeName(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]/g, '').slice(0, 24) || '学生';
}

function joinDisplayPath(...parts: string[]) {
  const separator = activeStorageConfig.pathSeparator || '/';
  const normalized = parts.filter(Boolean).map((part, index) => {
    const text = String(part);
    if (index === 0) return text.replace(/[\\/]+$/g, '');
    return text.replace(/^[\\/]+|[\\/]+$/g, '');
  });
  return normalized.join(separator);
}

function pathsFor(studentName: string) {
  const cleanName = sanitizeName(studentName);
  const root = joinDisplayPath(activeStorageConfig.baseDir, `${cleanName}知识库`);
  const raw = joinDisplayPath(root, `${cleanName}原始资料库`);
  const summary = joinDisplayPath(root, `${cleanName}学情分析汇总`);
  const reportDir = joinDisplayPath(summary, '学情报告');
  return {
    cleanName,
    root,
    raw,
    summary,
    reportDir,
    profileReport: joinDisplayPath(reportDir, '整体画像.md'),
    changesReport: joinDisplayPath(reportDir, '历史变化.md'),
    dailyReport: joinDisplayPath(reportDir, '每日行动建议.md'),
    stageReport: joinDisplayPath(reportDir, '阶段总结.md'),
    agent: joinDisplayPath(root, 'AGENT.md'),
    soul: joinDisplayPath(root, 'Soul.md'),
    memory: joinDisplayPath(root, 'Memory.md'),
    index: joinDisplayPath(summary, 'index.md'),
    log: joinDisplayPath(summary, 'log.md'),
    output: joinDisplayPath(root, '输出结果'),
  };
}

function pathsForStudent(student: Pick<Student, 'name'> & Partial<Pick<Student, 'rootPath' | 'rawPath' | 'summaryPath' | 'agentPath' | 'outputPath'>>) {
  const standard = pathsFor(student.name);
  const root = student.rootPath || standard.root;
  const raw = student.rawPath || standard.raw;
  const summary = student.summaryPath || standard.summary;
  const reportDir = joinDisplayPath(summary, '学情报告');
  const agent = student.agentPath || joinDisplayPath(root, 'AGENT.md');
  const output = student.outputPath || joinDisplayPath(root, '输出结果');
  return {
    ...standard,
    root,
    raw,
    summary,
    reportDir,
    profileReport: joinDisplayPath(reportDir, '整体画像.md'),
    changesReport: joinDisplayPath(reportDir, '历史变化.md'),
    dailyReport: joinDisplayPath(reportDir, '每日行动建议.md'),
    stageReport: joinDisplayPath(reportDir, '阶段总结.md'),
    agent,
    output,
    index: joinDisplayPath(summary, 'index.md'),
    log: joinDisplayPath(summary, 'log.md'),
  };
}

function basenameFromPath(filePath: string) {
  return String(filePath || '').split(/[\\/]/).filter(Boolean).pop() || '候选文件';
}

function buildAiAgentScanPrompt(student: Student, targetKind: AgentKnowledgeKind | 'all', targetTool: AgentToolId | 'all' = student.agentTool) {
  const p = pathsForStudent(student);
  const targetLabel =
    targetKind === 'soul'
      ? '人设/Soul/角色设定'
      : targetKind === 'rule'
        ? '规则文件/项目指令'
      : targetKind === 'conversation'
        ? '对话历史/聊天导出'
        : targetKind === 'all'
          ? '记忆、人设、规则文件、对话历史'
          : 'Memory/长期记忆';
  const toolNames = targetTool === 'all' ? agentToolOptions.map((tool) => tool.name).join('、') : getAgentToolProfile(targetTool).name;
  return `请作为本机 Agent 文件扫描助手，帮我查找学生「${student.name}」的 ${targetLabel} 文件候选。

学生信息：
- 姓名：${student.name}
- 年级：${student.grade || '待补充'}
- 学校：${student.school || '待补充'}
- 当前目标：${student.goal || '待补充'}
- 当前绑定 Agent 工具：${getAgentToolProfile(student.agentTool).name}
- 本次优先扫描工具：${toolNames}
- Agent 名称或备注：${student.agentName || student.agentNote || `${student.name} AI教育管家`}
- 知识库根目录：${p.root}
- AGENT.md：${p.agent}
- 原始资料库：${p.raw}
- 学情分析汇总：${p.summary}

请优先扫描这些常见 Agent 工具目录：
- %USERPROFILE%\\.qclaw
- %USERPROFILE%\\.openclaw
- %USERPROFILE%\\.hohu
- %USERPROFILE%\\.marvis
- %USERPROFILE%\\.ima
- %USERPROFILE%\\.ima.copilot
- %USERPROFILE%\\.workbuddy
- %USERPROFILE%\\.codex
- %USERPROFILE%\\.claude
- %APPDATA%\\QClaw
- %APPDATA%\\OpenClaw
- %APPDATA%\\Hohu
- %APPDATA%\\Marvis
- %APPDATA%\\IMA
- %APPDATA%\\ima.copilot
- %APPDATA%\\WorkBuddy
- %APPDATA%\\npm
- %LOCALAPPDATA%\\QClaw
- %LOCALAPPDATA%\\OpenClaw
- %LOCALAPPDATA%\\Hohu
- %LOCALAPPDATA%\\Marvis
- %LOCALAPPDATA%\\IMA
- %LOCALAPPDATA%\\ima.copilot
- %LOCALAPPDATA%\\WorkBuddy

如果是 ChatGPT、Claude、豆包、Coze、FastGPT 这类网页或平台工具，请优先查找用户导出的 Markdown/TXT/JSON 对话记录、项目说明、Bot 提示词或知识库说明，不要尝试读取浏览器缓存、Cookie 或账号数据。

候选文件名包括但不限于：
- 记忆：MEMORY.md、Memory.md、memory.md、long-term-memory.md、memory.txt
- 人设：Soul.md、persona.md、role.md、system.md、prompt.md、profile.md
- 规则文件：AGENT.md、AGENTS.md、CLAUDE.md、QClaw.md、OpenClaw.md、Marvis.md、Hohu.md、IMA.md、ima.copilot.md、WorkBuddy.md、RULES.md
- 对话历史：conversation.md、chat.md、history.json、transcript.txt、session.md、对话.md、聊天记录.md

判断标准：
1. 文件内容或路径包含学生姓名、Agent 名称、知识库根目录、AGENT.md 路径时，优先级最高。
2. 文件内容提到“原始资料库”“学情分析汇总”“学习资料消化”“教育管家”等关键词时，提高置信度。
3. 如果不确定，也可以列为低分候选，但必须说明理由。

安全规则：
- 不要读取或输出 .ssh、密钥、token、浏览器 Profile、Cookie、密码、聊天记录、无关项目源码。
- 不要输出文件全文，只输出不超过 120 字的 preview。
- 只返回 JSON，不要输出解释文字，不要使用 Markdown 代码块。

请严格返回以下 JSON 格式：
{
  "studentName": "${student.name}",
  "targetKind": "${targetKind}",
  "candidates": [
    {
      "path": "C:\\\\Users\\\\...\\\\MEMORY.md",
      "kind": "${targetKind}",
      "tool": "qclaw",
      "score": 90,
      "reasons": ["内容包含学生姓名", "内容包含 AGENT.md 路径"],
      "preview": "不超过 120 字的摘要预览"
    }
  ]
}

tool 只能使用：qclaw、marvis、hohu、openclaw、ima.copilot、workbuddy、codex、claude-code、chatgpt、claude、doubao、coze、fastgpt。
kind 只能使用：memory、soul、rule、conversation。`;
}

function extractJsonLikeText(value: string) {
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

function escapeInvalidBackslashesInJsonStrings(value: string) {
  let output = '';
  let inString = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '"' && value[index - 1] !== '\\') {
      inString = !inString;
      output += char;
      continue;
    }
    if (inString && char === '\\') {
      const next = value[index + 1] || '';
      if (!/["\\/bfnrtu]/.test(next)) {
        output += '\\\\';
        continue;
      }
    }
    output += char;
  }
  return output;
}

function parseLooseJson(value: string) {
  const extracted = extractJsonLikeText(value);
  try {
    return JSON.parse(extracted);
  } catch {
    return JSON.parse(escapeInvalidBackslashesInJsonStrings(extracted));
  }
}

function normalizeAiScanCandidate(item: Record<string, unknown>, fallbackKind?: AgentKnowledgeKind): AgentKnowledgeCandidate | null {
  const filePath = String(item.path || item.filePath || item.absolutePath || item.fullPath || '').trim();
  if (!filePath) return null;
  const rawTool = String(item.tool || item.agentTool || item.sourceTool || '').toLowerCase();
  const tool = agentToolProfiles[rawTool as AgentToolId] ? (rawTool as AgentToolId) : 'qclaw';
  const rawKind = String(item.kind || item.type || item.category || item.fileType || fallbackKind || '').toLowerCase();
  const inferredKind =
    /conversation|chat|history|transcript|对话|聊天|会话/.test(rawKind) ? 'conversation'
      : /rule|agent|agents|claude|规则|指令/.test(rawKind) ? 'rule'
      : /soul|persona|role|system|prompt|人设|角色/.test(rawKind) ? 'soul'
      : /memory|记忆/.test(rawKind) ? 'memory'
      : fallbackKind;
  if (!inferredKind || !['memory', 'soul', 'rule', 'conversation'].includes(inferredKind)) return null;
  const reasons = Array.isArray(item.reasons)
    ? item.reasons.map((reason) => String(reason)).filter(Boolean)
    : String(item.reason || item.matchReason || 'AI 工具建议候选').split(/[;；\n]/).map((reason) => reason.trim()).filter(Boolean);
  const score = Number(item.score || item.confidence || item.priority || 60);
  return {
    path: filePath,
    name: String(item.name || item.fileName || basenameFromPath(filePath)),
    tool,
    kind: inferredKind,
    score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 60,
    reasons: reasons.length ? reasons : ['AI 工具建议候选'],
    mtime: typeof item.mtime === 'string' ? item.mtime : typeof item.modifiedAt === 'string' ? item.modifiedAt : '',
    size: Number(item.size || 0),
    preview: String(item.preview || item.summary || '').slice(0, 900),
  };
}

function agentBindingModeForTool(toolId: AgentToolId): AgentBindingMode {
  return getAgentToolProfile(toolId).supportsSubAgent ? 'subAgent' : 'mainChat';
}

function rawBuildAgentMd(student: StudentDraft) {
  const p = pathsForStudent(student);
  const tool = getAgentToolProfile(student.agentTool);
  return `# ${p.cleanName} 学情分析汇总 Agent Schema

本文由内置模板「AGENT-教育通用.md」生成，用于让 ${tool.name} 在 \`${p.root}\` 中维护学生「${p.cleanName}」的学习知识库。目标不是一次性把原始资料聊完，而是把资料持续编译为可复用、可链接、可追溯的学情分析汇总。

## 1. 默认范式

- \`compile-first\`：先把资料编译进「学情分析汇总」，再用「学情分析汇总」回答问题。
- \`writeback\`：长期有价值的结论、分类、定义、对比、路线图，需要回写到「学情分析汇总」。
- \`学情分析汇总-first\`：优先读 \`index.md\` 和相关页面，而不是每次直接翻原始资料库。
- \`原始资料库 -> 学情分析汇总 -> 输出结果\`：原始资料库是证据层，学情分析汇总是知识层，输出结果是临时交付层。
- 高影响结论必须能追溯到原始图片、原始文档或明确链接。

## 2. 初始化目录结构

执行本 AGENT.md 时，请先创建如下目录与文档：

\`\`\`text
${p.root}/
├─ AGENT.md
├─ 输出结果/
├─ ${p.cleanName}原始资料库/
└─ ${p.cleanName}学情分析汇总/
   ├─ index.md
   ├─ log.md
   ├─ 摘要库/
   ├─ 概念库/
   ├─ 实体库/
   ├─ 综合库/
   ├─ 咨询精华库/
   └─ 学情报告/
      ├─ 整体画像.md
      ├─ 历史变化.md
      ├─ 每日行动建议.md
      └─ 阶段总结.md
\`\`\`

初始化时请创建：

- \`${p.index}\`
- \`${p.log}\`
- \`${p.summary}/摘要库/\`
- \`${p.summary}/概念库/\`
- \`${p.summary}/实体库/\`
- \`${p.summary}/综合库/\`
- \`${p.summary}/咨询精华库/\`
- \`${p.reportDir}/\`
- \`${p.profileReport}\`
- \`${p.changesReport}\`
- \`${p.dailyReport}\`
- \`${p.stageReport}\`
- \`${p.root}/输出结果/\`

\`${p.index}\` 初始化为导航页；\`${p.log}\` 初始化为 append-only 时间线。

## 3. Session Start Protocol

除非只是闲聊，开始工作前默认执行：

1. 读取 \`${p.index}\`
2. 读取 \`${p.log}\`
3. 按任务需要读取相关页面
4. 如果学情分析汇总不足以支撑结论，再回到 \`${p.raw}\` 搜索相关资料核对
5. 如有新结论值得沉淀，更新相关页面、\`index.md\` 和 \`log.md\`

## 4. 目录语义

### 摘要库

- 一份原始资料对应一份摘要页
- 对图片资料，可按单图或同主题小批次建立摘要
- 必须记录原始路径、主题、关键信息、局限和可信度

### 实体库

- 沉淀稳定实体，如人物、机构、课程、学校、图书、竞赛、考试、产品、平台、项目

### 概念库

- 沉淀反复出现的概念、方法、流程、术语、能力边界

### 综合库

- 沉淀跨来源综合判断、主题综述、对比分析、学习路线整理
- 至少基于两个来源或两个摘要页

### 咨询精华库

- 沉淀高复用问答
- 一次性问题根据质量有选择地保留或用户要求保留，不要机械保留

## 5. 消化 Protocol

当 \`${p.raw}\` 有新资料或开始整理时，默认流程：

1. 识别资料类型与主题
2. 阅读图片或文档内容
3. 在 \`摘要库/\` 新建或更新摘要页
4. 按需更新 \`实体库/\`、\`概念库/\`
5. 如改变整体判断，更新 \`综合库/\`
6. 更新 \`index.md\`
7. 在 \`log.md\` 追加「消化」记录
8. 更新 \`${p.root}/.edu-manager/digest-state.json\`，作为控制台和平板端同步消化结果的回执
9. 如产生对家长、学生或教师有直接价值的结论，更新 \`学情报告/\` 下的四份报告文件

### 控制台回执格式

每次消化完成后，请写入或覆盖：

\`\`\`json
{
  "status": "completed",
  "lastDigestAt": "YYYY-MM-DDTHH:mm:ss+08:00",
  "digestedFiles": ["本次处理的原始文件名"],
  "summaryFiles": ["本次新增或更新的 Markdown 文件"],
  "message": "本次消化完成，共处理 N 个新资料"
}
\`\`\`

如果没有新增资料，仍然更新 \`lastDigestAt\`，\`digestedFiles\` 写空数组，并在 \`message\` 中说明“无新增资料”。
如果处理失败，请把 \`status\` 写为 \`failed\`，并在 \`message\` 中说明原因。

## 6. 咨询 Protocol

1. 先从 \`index.md\` 定位页面
2. 读取最小必要页面集合
3. 优先基于现有学情分析汇总回答
4. 学情分析汇总不足时回查原始资料库图片资料
5. 高频复用答案回写到 \`咨询精华库/\` 或 \`综合库/\`
6. 更新 \`log.md\`

## 7. 学情报告 Protocol

学情报告是面向家长、学生和教师的成果表达层，不替代摘要库、实体库、概念库、综合库和咨询精华库。

完成资料消化、综合分析或咨询沉淀后，如果发现对用户有直接价值的结论，请检查并更新：

- \`${p.profileReport}\`
- \`${p.changesReport}\`
- \`${p.dailyReport}\`
- \`${p.stageReport}\`

写作要求：

1. 面向家长、学生、教师可读，避免内部技术术语。
2. 每份报告顶部保留更新时间、适用对象、状态。
3. 结论必须对应学情分析汇总中的依据来源。
4. “每日行动建议”必须分为：给学生、给家长、给老师。
5. 不确定判断标注“待观察”，不要写成定论。
6. 不要删除原有报告内容；判断发生变化时，在“历史变化”或“阶段总结”中说明变化原因。
7. 当天无新增资料时，也可以根据已有档案更新“每日行动建议”，但要注明依据。

## 8. 命令约定

### /消化

默认动作：

1. 读取指定原始资料或用户刚提供的资料
2. 更新 \`摘要库/\`
3. 按需更新 \`实体库/\`、\`概念库/\`、\`综合库/\`
4. 更新 \`index.md\`
5. 在 \`log.md\` 追加「消化」记录
6. 更新 \`${p.root}/.edu-manager/digest-state.json\`

### /咨询

默认动作：

1. 从 \`index.md\` 定位相关页面
2. 读取最小必要上下文
3. 形成答案
4. 如有必要，回查原始资料库图片资料或其他来源
5. 若答案值得沉淀，更新 \`咨询精华库/\` 或 \`综合库/\`
6. 在 \`log.md\` 追加「咨询」记录

### /lint

- 检查 \`index.md\` 是否覆盖有效页面
- 检查孤儿页、重复页、冲突页、stale 页、空洞页、缺来源页
- 能修则修，不能修则标记 \`needs-review\`
- 在 \`log.md\` 追加「健康检查」记录

## 9. Frontmatter 规范

除 \`index.md\` 和 \`log.md\` 外，其余学情分析汇总页面默认带 YAML frontmatter。

最低字段：

- \`title\`
- \`type\`
- \`status\`
- \`created\`
- \`updated\`
- \`source_path\` 或 \`source_url\`
- \`tags\`

## 10. 写作规范

- 先给结论，再展开
- 明确区分事实、转述、推断
- 对时间敏感信息写清日期
- 图片 OCR 或视觉解读不确定时，要明确标注不确定性
- 尽量补充 Obsidian 学情分析汇总 link

推荐正文结构：

\`\`\`markdown
## TL;DR

## 核心内容

## 关键信息 / 论点

## 与其他页面的关系

## 风险与不确定性

## 来源
\`\`\`

## 11. index.md 与 log.md

- \`index.md\` 是导航页，不是随意写的首页
- \`log.md\` 是 append-only 时间线
- 每次消化、重要咨询、lint、review、refactor 都应记录

## 12. 不要做的事

- 不要覆盖或改写原始资料库原始图片
- 不要把没有来源的推断写成确定事实
- 不要只写摘要而不补交叉链接
- 不要更新页面却忘记更新 \`index.md\` 或 \`log.md\`
- 不要把 \`输出结果/\` 当长期知识主页

## 13. 每日资料消化规则

- ${tool.supportsScheduledTask ? `每天 ${student.digestTime} 由 ${tool.name} 定时任务唤醒本 Agent 执行 \`/消化\`。` : `当前工具 ${tool.name} 暂按手动复制指令执行 \`/消化\`，建议每天 ${student.digestTime} 由用户在控制台复制资料消化指令。`}
- 只读取 \`${p.raw}\` 中新增或变更的资料。
- 没有新资料时，在 \`log.md\` 中记录“无新增资料”，不要重复生成摘要。
- 高影响结论必须能追溯到原始文件、图片或明确链接。

## 14. 极简执行口令

先读 \`${p.index}\` 和 \`${p.log}\`，再按需读取相关页面；把新资料编译进 \`摘要库 / 实体库 / 概念库 / 综合库 / 咨询精华库\`；最后更新 \`index.md\`、\`log.md\` 和必要的 \`学情报告/\` 文件。
`;
}

function rawBuildSoulMd(student: StudentDraft) {
  const p = pathsForStudent(student);
  return `# ${p.cleanName} AI教育管家 Soul

你是「${p.cleanName} AI教育管家」，面向家长、学生和教育顾问协作。

## 角色定位

- 长期维护学生学情档案
- 整理学习资料、测评报告、咨询记录和关键观察
- 基于证据给出阶段性判断和可执行建议
- 帮助家长把零散资料沉淀成可复用的 Obsidian 学情知识库

## 沟通风格

- 先给结论，再展开依据
- 对不确定内容明确标注不确定性
- 对家长友好、克制、可执行
- 不夸大效果，不替代专业医学、心理或法律建议

## 学生基础信息

- 学生姓名：${p.cleanName}
- 年级：${student.grade}
- 学校：${student.school}
- 当前目标：${student.goal}

## 工作规则

该 Agent 的工作协议使用：${p.agent}
后续所有学习资料消化都围绕该学生知识库执行。
`;
}

function rawBuildMemoryMd(student: StudentDraft) {
  const p = pathsForStudent(student);
  return `# ${p.cleanName} AI教育管家 Memory

## 学生画像

- 姓名：${p.cleanName}
- 年级：${student.grade}
- 学校：${student.school}
- 当前核心目标：${student.goal}

## 长期观察

暂无。后续根据资料消化、咨询记录和家长反馈持续补充。

## 重要边界

- 没有来源的判断只能作为假设，不能写成确定事实。
- 涉及升学政策、考试安排、竞赛规则等时间敏感信息，需要写清日期并建议复核。
- 重要结论应能追溯到原始资料库或明确链接。
`;
}

function buildLearningReportTemplate(student: StudentDraft, reportId: LearningReportId) {
  const today = new Date().toISOString().slice(0, 10);
  const definitions: Record<LearningReportId, { title: string; type: string; target: string; sections: string[]; paragraph?: string }> = {
    profile: {
      title: '整体画像',
      type: 'learning_profile',
      target: '家长 / 教师 / 学生',
      paragraph: '一句话画像',
      sections: ['一句话画像', '学习优势', '当前短板', '兴趣与动力', '学习习惯与执行力', '适合的学习方式', '家长沟通注意点', '依据来源'],
    },
    changes: {
      title: '历史变化',
      type: 'learning_change',
      target: '家长 / 教师',
      sections: ['最近 7 天变化', '最近 30 天变化', '能力变化', '习惯变化', '问题变化', '目标变化', '依据来源'],
    },
    daily: {
      title: '每日行动建议',
      type: 'daily_action',
      target: '学生 / 家长 / 教师',
      paragraph: '今日重点',
      sections: ['今日重点', '给学生', '给家长', '给老师', '今日不建议做的事', '观察点', '依据来源'],
    },
    stage: {
      title: '阶段总结',
      type: 'stage_summary',
      target: '家长 / 教师',
      sections: ['本阶段核心进展', '主要问题', '关键证据', '下一阶段目标', '建议行动', '依据来源'],
    },
  };
  const definition = definitions[reportId];
  const body = definition.sections.map((section) =>
    section === definition.paragraph
      ? `## ${section}\n\n待生成。`
      : `## ${section}\n\n- 待补充。`
  ).join('\n\n');
  return `---\ntype: ${definition.type}\ntarget: ${definition.target}\nupdated: ${today}\nstatus: draft\n---\n\n# ${definition.title}\n\n${body}\n`;
}

function templateVariables(student: StudentDraft) {
  const p = pathsForStudent(student);
  const tool = getAgentToolProfile(student.agentTool);
  return {
    studentName: p.cleanName,
    grade: student.grade || '',
    school: student.school || '',
    goal: student.goal || '',
    agentTool: tool.name,
    agentName: student.agentName || `${p.cleanName} AI教育管家`,
    rootPath: p.root,
    agentPath: p.agent,
    rawPath: p.raw,
    summaryPath: p.summary,
    reportDir: p.reportDir,
    profileReport: p.profileReport,
    changesReport: p.changesReport,
    dailyReport: p.dailyReport,
    stageReport: p.stageReport,
    outputPath: p.output,
    digestTime: student.digestTime || '21:30',
  };
}

function renderTemplateText(template: string, student: StudentDraft) {
  const vars = templateVariables(student);
  return String(template || '').replace(/\{\{(\w+)\}\}/g, (match, key: keyof typeof vars) => {
    const value = vars[key];
    return value === undefined ? match : String(value);
  });
}

function templateFromGenerated(content: string, student: StudentDraft) {
  const vars = templateVariables(student);
  let next = content;
  const replacements: Array<[string, string]> = [
    [vars.studentName, '{{studentName}}'],
    [vars.grade, '{{grade}}'],
    [vars.school, '{{school}}'],
    [vars.goal, '{{goal}}'],
    [vars.agentName, '{{agentName}}'],
    [vars.rootPath, '{{rootPath}}'],
    [vars.agentPath, '{{agentPath}}'],
    [vars.rawPath, '{{rawPath}}'],
    [vars.summaryPath, '{{summaryPath}}'],
    [vars.outputPath, '{{outputPath}}'],
    [vars.digestTime, '{{digestTime}}'],
  ];
  replacements
    .filter(([value]) => value)
    .sort((a, b) => b[0].length - a[0].length)
    .forEach(([value, token]) => {
      next = next.split(value).join(token);
    });
  next = next.split(getAgentToolProfile(student.agentTool).name).join('{{agentTool}}');
  return next;
}

function buildAgentMd(student: StudentDraft) {
  const template = activeTemplateFiles['AGENT.md'];
  return template ? renderTemplateText(template, student) : rawBuildAgentMd(student);
}

function buildSoulMd(student: StudentDraft) {
  const template = activeTemplateFiles['Soul.md'];
  return template ? renderTemplateText(template, student) : rawBuildSoulMd(student);
}

function buildMemoryMd(student: StudentDraft) {
  const template = activeTemplateFiles['Memory.md'];
  return template ? renderTemplateText(template, student) : rawBuildMemoryMd(student);
}

function buildIndexMd(student: StudentDraft) {
  const p = pathsForStudent(student);
  return `# ${p.cleanName} 学情分析汇总

> 由群星矩阵 AI教育管家维护。初始化日期：${today()}

## 页面导航

### 摘要库
原始资料的消化摘要。

### 概念库
反复出现的概念、方法、流程、术语、能力边界。

### 实体库
人物、机构、课程、学校、图书、竞赛、考试、产品、平台、项目。

### 综合库
跨来源综合判断、主题综述、对比分析、学习路线。

### 咨询精华库
高复用问答精华。

## 近期动态
暂无记录。等待首次资料消化。
`;
}

function buildLogMd(student: StudentDraft) {
  const p = pathsForStudent(student);
  return `# ${p.cleanName} 学情分析汇总日志

> Append-only 时间线，每次重要操作后自动追加记录。

## 日志

- **${today()}** — 系统初始化：创建 ${p.cleanName} 学情分析汇总。
`;
}

function buildQclawPrompt(student: StudentDraft) {
  const p = pathsForStudent(student);
  const tool = getAgentToolProfile(student.agentTool);
  const agentMd = buildAgentMd(student);
  const soulMd = buildSoulMd(student);
  const memoryMd = buildMemoryMd(student);
  return `请按顺序为学生「${p.cleanName}」初始化 AI教育管家。注意：先完成本机知识库初始化，再创建 ${tool.name} 子 Agent。

## 第一部分：创建学生知识库目录与 AGENT.md

请先完成以下本机文件工作：

1. 新建学生知识库根目录：

\`\`\`text
${p.root}
\`\`\`

2. 在该目录下创建或覆盖写入：

\`\`\`text
${p.agent}
\`\`\`

3. \`${p.agent}\` 的内容如下，请完整写入，不要省略：

\`\`\`markdown
${agentMd}
\`\`\`

4. 执行 \`${p.agent}\`，根据其中的初始化目录结构自动创建其余目录与文档，包括：

- \`${p.root}/输出结果\`
- \`${p.raw}\`
- \`${p.summary}\`
- \`${p.index}\`
- \`${p.log}\`
- \`${p.summary}/摘要库\`
- \`${p.summary}/概念库\`
- \`${p.summary}/实体库\`
- \`${p.summary}/综合库\`
- \`${p.summary}/咨询精华库\`

如果某些目录或文档已经存在，请保留已有内容，只补齐缺失项。

## 第二部分：在 ${tool.name} 中新建教育管家 Agent

请在 ${tool.name} 中创建名为「${p.cleanName} AI教育管家」的 Agent，并按以下方式设置。

### 角色设定 / 角色简介

将下面内容粘贴到该 Agent 的角色简介、Soul 或系统提示词位置（${tool.personaTargetLabel}）：

\`\`\`markdown
${soulMd}
\`\`\`

### 长期记忆 / Memory

将下面内容粘贴到该 Agent 的长期记忆、Memory 或记忆配置位置（${tool.memoryTargetLabel}）：

\`\`\`markdown
${memoryMd}
\`\`\`

### 工作协议

将 \`${p.agent}\` 作为该 Agent 的工作协议。每次工作时遵守其中的目录结构、消化 Protocol、咨询 Protocol、写作规范和日志规则。

### 资料消化与写回规则

- 后续所有资料消化都读取：\`${p.raw}\`
- 所有沉淀结果写入：\`${p.summary}\`
- 每次执行后更新：\`${p.index}\` 和 \`${p.log}\`
- 如果原始资料库没有新资料，请在 \`${p.log}\` 中记录“无新增资料”，不要重复生成摘要

### 定时任务

请创建每日 ${student.digestTime} 自动执行一次资料消化任务，任务指令为：

\`\`\`text
/消化${p.cleanName}原始资料库中的新资料，并将结果写入${p.cleanName}学情分析汇总。原始资料库路径：${p.raw}
\`\`\`

初始化完成后，请回复：${p.cleanName} AI教育管家已初始化完成。`;
}

function buildMarvisPrompt(student: StudentDraft) {
  const p = pathsForStudent(student);
  const tool = getAgentToolProfile(student.agentTool);
  const agentMd = buildAgentMd(student);
  const soulMd = buildSoulMd(student);
  const memoryMd = buildMemoryMd(student);
  const sandboxNote = activeStorageConfig.platform === 'windows'
    ? `Windows 版控制台已经在本机创建同一个知识库目录，${tool.name} 可直接按以上绝对路径读取和写入。`
    : `注意：${tool.name} 对话中显示的内部路径通常不等同于安卓文件管理器可见的 Downloads 目录。`;
  return `请按顺序为学生「${p.cleanName}」初始化 ${tool.name} 版 AI教育管家。注意：${tool.name} 版本以复制指令和人设/记忆设置为主，不要求创建子 Agent。

## 第一部分：准备学生知识库目录与 AGENT.md

请先确认本机已经准备以下学生知识库根目录：

\`\`\`text
${p.root}
\`\`\`

如果 ${tool.name} 无法直接访问本机文件系统，请由用户或控制台先完成目录创建与初始化包导出；${tool.name} 后续根据这些路径和协议工作。${sandboxNote}

请在该目录下创建或覆盖写入：

\`\`\`text
${p.agent}
\`\`\`

AGENT.md 内容如下，请完整写入或作为工作协议引用：

\`\`\`markdown
${agentMd}
\`\`\`

请根据 AGENT.md 初始化或确认以下目录与文档：

- \`${p.root}/输出结果\`
- \`${p.raw}\`
- \`${p.summary}\`
- \`${p.index}\`
- \`${p.log}\`
- \`${p.summary}/摘要库\`
- \`${p.summary}/概念库\`
- \`${p.summary}/实体库\`
- \`${p.summary}/综合库\`
- \`${p.summary}/咨询精华库\`

## 第二部分：设置 ${tool.name} 人设与长期背景

请把下面内容复制到 ${tool.name} 的人设、角色设定或系统提示词中：

\`\`\`markdown
${soulMd}
\`\`\`

请把下面内容复制到 ${tool.name} 的记忆、长期背景或上下文设置中：

\`\`\`markdown
${memoryMd}
\`\`\`

## 第三部分：资料消化规则

- 后续所有资料消化都读取：\`${p.raw}\`
- 所有沉淀结果写入：\`${p.summary}\`
- 每次执行后更新：\`${p.index}\` 和 \`${p.log}\`
- 如果原始资料库没有新资料，请在 \`${p.log}\` 中记录“无新增资料”，不要重复生成摘要

${tool.name} 当前按手动资料消化方式执行。需要消化资料时，请复制以下命令到 ${tool.name} 对话中：

\`\`\`text
${buildDigestCommand(student)}
\`\`\`

初始化完成后，请回复：${p.cleanName} ${tool.name} 版 AI教育管家已初始化完成。`;
}

function buildToolPrompt(student: StudentDraft) {
  const tool = getAgentToolProfile(student.agentTool);
  return tool.supportsAgentCreation ? buildQclawPrompt(student) : buildMarvisPrompt(student);
}

function buildInitSteps(student: StudentDraft): Array<{ id: InitStepId; title: string; description: string; prompt: string }> {
  const p = pathsForStudent(student);
  const tool = getAgentToolProfile(student.agentTool);
  const agentMd = buildAgentMd(student);
  const soulMd = buildSoulMd(student);
  const memoryMd = buildMemoryMd(student);
  const digestCommand = buildDigestCommand(student);
  const rawSteps: Array<{ id: InitStepId; title: string; description: string; prompt: string }> = [
    {
      id: 'folder',
      title: '创建知识库目录',
      description: tool.supportsLocalFiles ? '先在本机创建学生知识库根目录。' : '先准备学生知识库目录；如工具不能访问本机，请手动完成。',
      prompt: `请准备学生知识库根目录：\n\n${p.root}\n\n如果该目录已经存在，请保留已有内容，不要删除。${tool.supportsLocalFiles ? '' : `\n\n注意：${tool.name} 可能无法直接操作本机文件系统；如果无法创建目录，请由用户在本机文件管理器中手动创建。`}`,
    },
    {
      id: 'agent',
      title: '写入 AGENT.md',
      description: '把内置通用教育模板写入该学生知识库。',
      prompt: `请在以下路径创建或覆盖写入 AGENT.md：\n\n${p.agent}\n\nAGENT.md 内容如下，请完整写入，不要省略：\n\n\`\`\`markdown\n${agentMd}\n\`\`\`${tool.supportsLocalFiles ? '' : `\n\n如果 ${tool.name} 无法直接写入本机文件，请将以上内容交给用户保存为 AGENT.md。`}`,
    },
    {
      id: 'execute',
      title: '执行 AGENT.md',
      description: tool.supportsLocalFiles ? `让 ${tool.name} 根据 AGENT.md 自动补齐目录和基础文档。` : `复制到 ${tool.name} 对话中，让它按 AGENT.md 协议初始化。`,
      prompt: `请执行或遵守 ${p.agent}，并根据其中的初始化目录结构补齐学生知识库。\n\n需要创建或确认存在：\n- ${p.root}/输出结果\n- ${p.raw}\n- ${p.summary}\n- ${p.index}\n- ${p.log}\n- ${p.summary}/摘要库\n- ${p.summary}/概念库\n- ${p.summary}/实体库\n- ${p.summary}/综合库\n- ${p.summary}/咨询精华库\n\n如果某些目录或文档已经存在，请保留已有内容，只补齐缺失项。${tool.supportsLocalFiles ? '' : `\n\n如果 ${tool.name} 无法直接创建文件，请输出需要创建的目录和文件清单，供用户在本机执行。`}`,
    },
  ];

  if (tool.supportsAgentCreation) {
    rawSteps.push({
      id: 'create',
      title: `创建 ${tool.name} Agent`,
      description: `在 ${tool.name} 中新建学生专属教育管家。`,
      prompt: `请在 ${tool.name} 中创建一个新 Agent，名称为：\n\n${p.cleanName} AI教育管家\n\n该 Agent 的工作协议使用：${p.agent}\n后续所有学习资料消化都围绕该学生知识库执行。`,
    });
  }

  if (tool.supportsPersonaSetting) {
    rawSteps.push({
      id: 'soul',
      title: '设置角色 Soul',
      description: `${tool.copyTargetLabel}。`,
      prompt: `请将以下内容粘贴到「${p.cleanName} AI教育管家」在 ${tool.name} 中的人设、角色简介、Soul 或系统提示词位置：\n\n\`\`\`markdown\n${soulMd}\n\`\`\``,
    });
  }

  if (tool.supportsMemorySetting) {
    rawSteps.push({
      id: 'memory',
      title: '设置记忆 Memory',
      description: `复制到 ${tool.name} 的长期记忆或背景设置。`,
      prompt: `请将以下内容粘贴到「${p.cleanName} AI教育管家」在 ${tool.name} 中的长期记忆、Memory 或长期背景设置位置：\n\n\`\`\`markdown\n${memoryMd}\n\`\`\``,
    });
  }

  rawSteps.push({
    id: 'schedule',
    title: tool.supportsScheduledTask ? '创建定时任务' : '生成每日消化指令',
    description: tool.supportsScheduledTask ? '创建每日自动资料消化任务。' : `${tool.name} 暂按手动复制资料消化指令执行。`,
    prompt: tool.supportsScheduledTask
      ? `请为「${p.cleanName} AI教育管家」创建每日 ${student.digestTime} 自动执行一次的资料消化任务。\n\n任务指令：\n\n${digestCommand}\n\n执行规则：\n- 后续所有资料消化都读取：${p.raw}\n- 所有沉淀结果写入：${p.summary}\n- 每次执行后更新：${p.index} 和 ${p.log}\n- 如果原始资料库没有新资料，请在 log.md 中记录“无新增资料”，不要重复生成摘要`
      : `${tool.name} 当前不假设支持本地定时任务。请在每天 ${student.digestTime} 或需要整理资料时，将以下指令复制到 ${tool.name} 对话中执行：\n\n${digestCommand}\n\n执行规则：\n- 后续所有资料消化都读取：${p.raw}\n- 所有沉淀结果写入：${p.summary}\n- 每次执行后更新：${p.index} 和 ${p.log}\n- 如果原始资料库没有新资料，请在 log.md 中记录“无新增资料”，不要重复生成摘要`,
  });

  rawSteps.push({
    id: 'full',
    title: '完整初始化指令',
    description: `给熟练用户或装机人员使用，目标工具：${tool.name}。`,
    prompt: buildToolPrompt(student),
  });

  if (activeTemplateFiles['init-step-1.md'] && rawSteps[0]) {
    rawSteps[0] = { ...rawSteps[0], prompt: renderTemplateText(activeTemplateFiles['init-step-1.md'] || '', student) };
  }
  if (activeTemplateFiles['init-step-2.md'] && rawSteps[1]) {
    rawSteps[1] = { ...rawSteps[1], prompt: renderTemplateText(activeTemplateFiles['init-step-2.md'] || '', student) };
  }

  return rawSteps.map((step, index) => ({
    ...step,
    title: step.id === 'full' ? step.title : `${index + 1}. ${step.title}`,
  }));
}
function buildDigestCommand(student: string | StudentDraft) {
  if (typeof student !== 'string' && activeTemplateFiles['digest-prompt.md']) {
    return renderTemplateText(activeTemplateFiles['digest-prompt.md'] || '', student);
  }
  const p = typeof student === 'string' ? pathsFor(student) : pathsForStudent(student);
  const tool = typeof student === 'string' ? agentToolProfiles.qclaw : getAgentToolProfile(student.agentTool);
  const projectRule =
    tool.id === 'codex'
      ? `\n请先在学生知识库根目录执行，并优先读取 ${joinDisplayPath(p.root, 'AGENTS.md')} 和 ${p.agent}。\n`
      : tool.id === 'claude-code'
        ? `\n请先在学生知识库根目录执行，并优先读取 ${joinDisplayPath(p.root, 'CLAUDE.md')} 和 ${p.agent}。\n`
        : '';
  const separator = activeStorageConfig.pathSeparator || '/';
  return `/消化 ${p.cleanName}原始资料库中的新资料
${projectRule}

请读取原始资料库中的新增资料，并将结果写入学情分析汇总。

学生知识库：${p.root}
原始资料库：${p.raw}
学情分析汇总：${p.summary}
学情报告目录：${p.reportDir}
控制台账本目录：${p.root}${separator}.edu-manager

执行要求：
1. 只处理尚未消化的新资料，不重复生成已处理资料的摘要。
2. 处理完成后更新 ${p.index} 和 ${p.log}。
3. 如果没有新增资料，请在 log.md 中记录“无新增资料”。
4. 消化完成后，请检查并更新「学情报告」目录中的四份报告：整体画像.md、历史变化.md、每日行动建议.md、阶段总结.md。
5. 如果没有足够依据，请保留“待补充”或标注“待观察”，不要编造结论。
6. 消化完成后，请更新 ${p.root}${separator}.edu-manager${separator}digest-state.json，格式为：
{
  "status": "completed",
  "lastDigestAt": "YYYY-MM-DDTHH:mm:ss+08:00",
  "digestedFiles": ["本次处理的原始文件名"],
  "summaryFiles": ["本次新增或更新的Markdown文件"],
  "message": "本次消化完成，共处理 N 个新资料"
}

如果处理失败，请把 status 写为 "failed"，并在 message 中说明原因。`;
}

function buildConsultCommand(student: Student) {
  const tool = getAgentToolProfile(student.agentTool);
  const p = pathsForStudent(student);
  if (tool.id === 'codex') {
    return `/咨询，我想咨询

请在学生知识库目录「${p.root}」中工作，优先读取 AGENTS.md、AGENT.md 和学情分析汇总目录，再回答我的问题。`;
  }
  if (tool.id === 'claude-code') {
    return `/咨询，我想咨询

请在学生知识库目录「${p.root}」中工作，优先读取 CLAUDE.md、AGENT.md 和学情分析汇总目录，再回答我的问题。`;
  }
  return activeTemplateFiles['consult-prompt.md']
    ? renderTemplateText(activeTemplateFiles['consult-prompt.md'] || '', student)
    : '/咨询，我想咨询';
}

function buildSystemTemplates(): TemplateFiles {
  const sample: StudentDraft = {
    ...defaultDraft,
    name: '{{studentName}}',
    grade: '{{grade}}',
    school: '{{school}}',
    goal: '{{goal}}',
    agentTool: 'qclaw',
    agentName: '{{agentName}}',
    rootPath: '{{rootPath}}',
    rawPath: '{{rawPath}}',
    summaryPath: '{{summaryPath}}',
    agentPath: '{{agentPath}}',
    outputPath: '{{outputPath}}',
    digestTime: '{{digestTime}}',
  };
  const previousTemplates = activeTemplateFiles;
  activeTemplateFiles = {};
  const digestPrompt = buildDigestCommand(sample);
  activeTemplateFiles = previousTemplates;
  const folderStep = `请准备学生知识库根目录：\n\n{{rootPath}}\n\n如果该目录已经存在，请保留已有内容，不要删除。`;
  const agentStep = `请在以下路径创建或覆盖写入 AGENT.md：\n\n{{agentPath}}\n\nAGENT.md 内容如下，请完整写入，不要省略：\n\n\`\`\`markdown\n${rawBuildAgentMd(sample)}\n\`\`\``;
  return {
    'AGENT.md': rawBuildAgentMd(sample),
    'Soul.md': rawBuildSoulMd(sample),
    'Memory.md': rawBuildMemoryMd(sample),
    'init-step-1.md': folderStep,
    'init-step-2.md': agentStep,
    'digest-prompt.md': digestPrompt,
    'consult-prompt.md': '/咨询，我想咨询',
  };
}

function buildBundle(student: StudentDraft) {
  const p = pathsForStudent(student);
  return {
    schemaVersion: initSchemaVersion,
    appVersion: currentVersionName,
    generatedAt: today(),
    student: {
      name: p.cleanName,
      grade: student.grade,
      school: student.school,
      goal: student.goal,
      digestTime: student.digestTime,
      agentTool: getAgentToolProfile(student.agentTool).id,
      agentToolName: getAgentToolProfile(student.agentTool).name,
      remoteChannel: student.remoteChannel ?? 'none',
      remoteContact: student.remoteContact ?? '',
      remoteNote: student.remoteNote ?? '',
      remoteBindingStatus: student.remoteBindingStatus ?? 'unbound',
      remoteBoundAt: student.remoteBoundAt ?? '',
    },
    paths: p,
    files: {
      'AGENT.md': buildAgentMd(student),
      'agent-soul.md': buildSoulMd(student),
      'agent-memory.md': buildMemoryMd(student),
      [`${p.cleanName}学情分析汇总/index.md`]: buildIndexMd(student),
      [`${p.cleanName}学情分析汇总/log.md`]: buildLogMd(student),
      [`${p.cleanName}学情分析汇总/学情报告/整体画像.md`]: buildLearningReportTemplate(student, 'profile'),
      [`${p.cleanName}学情分析汇总/学情报告/历史变化.md`]: buildLearningReportTemplate(student, 'changes'),
      [`${p.cleanName}学情分析汇总/学情报告/每日行动建议.md`]: buildLearningReportTemplate(student, 'daily'),
      [`${p.cleanName}学情分析汇总/学情报告/阶段总结.md`]: buildLearningReportTemplate(student, 'stage'),
      'init-prompt.txt': buildToolPrompt(student),
      [`${getAgentToolProfile(student.agentTool).id}-init-prompt.txt`]: buildToolPrompt(student),
    },
  };
}

function fallbackDownload(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function App() {
  const [students, setStudents] = useState<Student[]>(loadStudents);
  const [theme, setTheme] = useState<ThemeName>(loadTheme);
  const [language, setLanguage] = useState<LanguageCode>(loadLanguage);
  const [draft, setDraft] = useState<StudentDraft>(defaultDraft);
  const [selectedId, setSelectedId] = useState(students[0]?.id ?? '');
  const [activeSection, setActiveSection] = useState<Section>('init');
  const [selectedInitStep, setSelectedInitStep] = useState<InitStepId>('folder');
  const [copied, setCopied] = useState(false);
  const [exported, setExported] = useState(false);
  const [copiedOnce, setCopiedOnce] = useState(false);
  const [exportedOnce, setExportedOnce] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const [pendingImportStudentId, setPendingImportStudentId] = useState('');
  const [digestMessage, setDigestMessage] = useState('');
  const [qclawOpened, setQclawOpened] = useState(false);
  const [marvisOpened, setMarvisOpened] = useState(false);
  const [hohuOpened, setHohuOpened] = useState(false);
  const [openclawOpened, setOpenclawOpened] = useState(false);
  const [imaCopilotOpened, setImaCopilotOpened] = useState(false);
  const [workbuddyOpened, setWorkbuddyOpened] = useState(false);
  const [codexOpened, setCodexOpened] = useState(false);
  const [claudeCodeOpened, setClaudeCodeOpened] = useState(false);
  const [obsidianOpened, setObsidianOpened] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [archiveRootMessage, setArchiveRootMessage] = useState('尚未授权档案目录');
  const [markdownFiles, setMarkdownFiles] = useState<MarkdownFile[]>([]);
  const [selectedMarkdownId, setSelectedMarkdownId] = useState('');
  const [markdownContent, setMarkdownContent] = useState('');
  const [markdownViewMode, setMarkdownViewMode] = useState<'rendered' | 'source'>('rendered');
  const [markdownMessage, setMarkdownMessage] = useState('');
  const [selectedArchiveCategory, setSelectedArchiveCategory] = useState<ArchiveCategoryId>('report');
  const [learningReports, setLearningReports] = useState<LearningReport[]>([]);
  const [selectedLearningReportId, setSelectedLearningReportId] = useState<LearningReportId>('profile');
  const [learningReportContent, setLearningReportContent] = useState('');
  const [learningReportViewMode, setLearningReportViewMode] = useState<'rendered' | 'source'>('rendered');
  const [learningReportMessage, setLearningReportMessage] = useState('');
  const [learningReportFolder, setLearningReportFolder] = useState('');
  const [learningReportHealth, setLearningReportHealth] = useState<LearningReportHealth | null>(null);
  const [inboxMessage, setInboxMessage] = useState('');
  const [downloadsMessage, setDownloadsMessage] = useState('');
  const [downloadFiles, setDownloadFiles] = useState<DownloadCandidate[]>([]);
  const [selectedDownloadPaths, setSelectedDownloadPaths] = useState<string[]>([]);
  const [materialSourceMessage, setMaterialSourceMessage] = useState('');
  const [materialSourceFiles, setMaterialSourceFiles] = useState<MaterialSourceCandidate[]>([]);
  const [selectedMaterialSourcePaths, setSelectedMaterialSourcePaths] = useState<string[]>([]);
  const [materialImportRecords, setMaterialImportRecords] = useState<MaterialImportRecord[]>([]);
  const [assetIndex, setAssetIndex] = useState<AssetIndexState>({ assets: [] });
  const [assetMessage, setAssetMessage] = useState('');
  const [assetSearch, setAssetSearch] = useState('');
  const [assetStudentFilter, setAssetStudentFilter] = useState('all');
  const [assetSourceFilter, setAssetSourceFilter] = useState('all');
  const [assetTypeFilter, setAssetTypeFilter] = useState('all');
  const [assetDuplicateOnly, setAssetDuplicateOnly] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [projects, setProjects] = useState<LearningProject[]>([]);
  const [projectMessage, setProjectMessage] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [projectDraft, setProjectDraft] = useState({ name: '', type: '学习项目', studentIds: [] as string[] });
  const [selectedProjectAssetIds, setSelectedProjectAssetIds] = useState<string[]>([]);
  const [selectedProjectStagingIds, setSelectedProjectStagingIds] = useState<string[]>([]);
  const [projectStagingSearch, setProjectStagingSearch] = useState('');
  const [projectStagingStatusFilter, setProjectStagingStatusFilter] = useState<'all' | ProjectStagingStatus>('all');
  const [promotionPreview, setPromotionPreview] = useState('');
  const [promotionPlan, setPromotionPlan] = useState<PromotionPlan | null>(null);
  const [promotionExecutionSummary, setPromotionExecutionSummary] = useState('');
  const [growthMessage, setGrowthMessage] = useState('');
  const [sharedInboxCount, setSharedInboxCount] = useState(0);
  const [compatibility, setCompatibility] = useState<Record<string, unknown> | null>(null);
  const [storageConfig, setStorageConfig] = useState<StorageConfig>(activeStorageConfig);
  const [installStatus, setInstallStatus] = useState<AgentToolInstallStatus | null>(null);
  const [installMessage, setInstallMessage] = useState('');
  const [advancedPromptOpen, setAdvancedPromptOpen] = useState(false);
  const [customStepPrompts, setCustomStepPrompts] = useState<Partial<Record<InitStepId, string>>>({});
  const [createMode, setCreateMode] = useState<KnowledgeBaseMode>('standard');
  const [adoptRootPath, setAdoptRootPath] = useState('');
  const [adoptScanResult, setAdoptScanResult] = useState<KnowledgeBaseScanResult | null>(null);
  const [adoptPaths, setAdoptPaths] = useState({ agentPath: '', rawPath: '', summaryPath: '', outputPath: '' });
  const [adoptMessage, setAdoptMessage] = useState('');
  const [agentBindingMode, setAgentBindingMode] = useState<AgentBindingMode>('subAgent');
  const [agentNameDraft, setAgentNameDraft] = useState('');
  const [agentNoteDraft, setAgentNoteDraft] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [archiveListVisible, setArchiveListVisible] = useState(true);
  const [hostServiceStatus, setHostServiceStatus] = useState<HostServiceStatus | null>(null);
  const [hostPortDraft, setHostPortDraft] = useState('18777');
  const [hostServiceMessage, setHostServiceMessage] = useState('');
  const [hostPairQr, setHostPairQr] = useState('');
  const [homeMode, setHomeMode] = useState<'local' | 'host'>('local');
  const [hostDiagnostics, setHostDiagnostics] = useState<HostServiceDiagnostics | null>(null);
  const [hostUploadRecords, setHostUploadRecords] = useState<HostUploadRecord[]>([]);
  const [hostUploadSearch, setHostUploadSearch] = useState('');
  const [hostUploadStudentFilter, setHostUploadStudentFilter] = useState('all');
  const [hostUploadDeviceFilter, setHostUploadDeviceFilter] = useState('all');
  const [hostUploadDateFilter, setHostUploadDateFilter] = useState('all');
  const [hostUploadStatusFilter, setHostUploadStatusFilter] = useState('all');
  const [hostTimeline, setHostTimeline] = useState<HostTimelineEvent[]>([]);
  const [studentEditDraft, setStudentEditDraft] = useState<StudentDraft | null>(null);
  const [archiveKeywords, setArchiveKeywords] = useState<ArchiveKeywordConfig>(loadArchiveKeywords);
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null);
  const [licenseCodeDraft, setLicenseCodeDraft] = useState('');
  const [licenseMessage, setLicenseMessage] = useState('');
  const [templateCenter, setTemplateCenter] = useState<TemplateCenterState | null>(null);
  const [templateMessage, setTemplateMessage] = useState('');
  const [agentCenter, setAgentCenter] = useState<AgentCenterState | null>(null);
  const [agentCenterMessage, setAgentCenterMessage] = useState('');
  const [agentKnowledgeMenuOpen, setAgentKnowledgeMenuOpen] = useState(false);
  const [agentScanCandidates, setAgentScanCandidates] = useState<AgentKnowledgeCandidate[]>([]);
  const [selectedCandidateKeys, setSelectedCandidateKeys] = useState<string[]>([]);
  const [aiScanTool, setAiScanTool] = useState<AgentToolId | 'all'>('all');
  const [aiScanKind, setAiScanKind] = useState<AgentKnowledgeKind | 'all'>('all');
  const [agentScanMessage, setAgentScanMessage] = useState('');
  const [aiScanResultText, setAiScanResultText] = useState('');
  const [agentRules, setAgentRules] = useState<AgentRulesState | null>(null);
  const [ruleFileName, setRuleFileName] = useState('AGENT.md');
  const [ruleContent, setRuleContent] = useState('');
  const [ruleMessage, setRuleMessage] = useState('');
  const [ruleDiff, setRuleDiff] = useState<{ onlyBase?: string[]; onlyTarget?: string[]; message?: string } | null>(null);
  const [sourceRegistry, setSourceRegistry] = useState<AgentSourceRegistryState | null>(null);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'memory' | 'persona' | 'rule' | 'conversation' | 'extract'>('all');
  const [sourceToolFilter, setSourceToolFilter] = useState<AgentToolId | 'all'>('all');
  const [conversationCenter, setConversationCenter] = useState<AgentConversationState | null>(null);
  const [conversationTool, setConversationTool] = useState<AgentToolId>('qclaw');
  const [conversationText, setConversationText] = useState('');
  const [conversationExtractText, setConversationExtractText] = useState('');
  const [conversationExtractPreview, setConversationExtractPreview] = useState<ConversationExtractPreview | null>(null);
  const [conversationExtractTargets, setConversationExtractTargets] = useState({ memory: true, soul: true, qa: true, todos: true });
  const [conversationMessage, setConversationMessage] = useState('');
  const [memorySourceTool, setMemorySourceTool] = useState<AgentToolId>('qclaw');
  const [memorySourceText, setMemorySourceText] = useState('');
  const [unifiedMemoryText, setUnifiedMemoryText] = useState('');
  const [soulSourceTool, setSoulSourceTool] = useState<AgentToolId>('qclaw');
  const [soulSourceText, setSoulSourceText] = useState('');
  const [unifiedSoulText, setUnifiedSoulText] = useState('');
  const [soulDiff, setSoulDiff] = useState<{ onlyUnified?: string[]; onlySource?: string[]; message?: string } | null>(null);
  const [candidateImportReview, setCandidateImportReview] = useState<CandidateImportReview | null>(null);
  const [expandedSourceRecordId, setExpandedSourceRecordId] = useState('');

  const t = (key: TranslationKey) => uiTranslations[language]?.[key] ?? zhCnText[key] ?? key;

  const selectedStudent = students.find((item) => item.id === selectedId) ?? students[0];
  const systemTemplateFiles = useMemo(() => buildSystemTemplates(), []);
  const currentTemplateFiles = useMemo(() => {
    if (templateCenter?.activeTemplate === 'custom') {
      const custom = templateCenter.custom ?? {};
      const hasCustom = templateKeys.some((key) => Boolean(custom[key]?.trim()));
      if (hasCustom) return custom;
    }
    return {};
  }, [templateCenter]);
  activeTemplateFiles = currentTemplateFiles;
  const selectedTool = getAgentToolProfile(draft.agentTool);
  const selectedToolAdapter = getAgentToolAdapter(draft.agentTool);
  const effectiveDraft: StudentDraft = useMemo(() => {
    const standardPaths = pathsFor(draft.name);
    const rootPath = createMode === 'adopted' ? adoptRootPath || standardPaths.root : standardPaths.root;
    return {
      ...draft,
      knowledgeBaseMode: createMode,
      rootPath,
      rawPath: createMode === 'adopted' ? adoptPaths.rawPath || undefined : standardPaths.raw,
      summaryPath: createMode === 'adopted' ? adoptPaths.summaryPath || undefined : standardPaths.summary,
      agentPath: createMode === 'adopted' ? adoptPaths.agentPath || (rootPath ? joinDisplayPath(rootPath, 'AGENT.md') : undefined) : standardPaths.agent,
      outputPath: createMode === 'adopted' ? adoptPaths.outputPath || (rootPath ? joinDisplayPath(rootPath, '输出结果') : undefined) : standardPaths.output,
      agentBindingMode,
      agentName: agentNameDraft,
      agentNote: agentNoteDraft,
    };
  }, [adoptPaths, adoptRootPath, agentBindingMode, agentNameDraft, agentNoteDraft, createMode, draft, storageConfig]);
  const prompt = useMemo(() => buildToolPrompt(effectiveDraft), [effectiveDraft, storageConfig]);
  const initSteps = useMemo(() => buildInitSteps(effectiveDraft), [effectiveDraft, storageConfig]);
  const generatedSelectedInitPrompt = initSteps.find((step) => step.id === selectedInitStep)?.prompt ?? prompt;
  const selectedInitPrompt = customStepPrompts[selectedInitStep] ?? generatedSelectedInitPrompt;
  const bundle = useMemo(() => buildBundle(effectiveDraft), [effectiveDraft, storageConfig]);
  const draftPaths = bundle.paths;

  const selectedStudentTool = selectedStudent ? getAgentToolProfile(selectedStudent.agentTool) : agentToolProfiles.qclaw;
  const selectedStudentAdapter = selectedStudent ? getAgentToolAdapter(selectedStudent.agentTool) : getAgentToolAdapter('qclaw');
  const selectedStudentPaths = selectedStudent ? pathsForStudent(selectedStudent) : pathsFor(draft.name);
  const activeAgentAdapter = activeSection === 'init' || activeSection === 'new' ? selectedToolAdapter : selectedStudentAdapter;
  const activeAgentTool = activeAgentAdapter.profile;
  const toolOpenState: Record<AgentToolId, boolean> = {
    qclaw: qclawOpened,
    marvis: marvisOpened,
    hohu: hohuOpened,
    openclaw: openclawOpened,
    'ima.copilot': imaCopilotOpened,
    workbuddy: workbuddyOpened,
    codex: codexOpened,
    'claude-code': claudeCodeOpened,
    chatgpt: false,
    claude: false,
    doubao: false,
    coze: false,
    fastgpt: false,
  };
  const activeAgentOpened = activeAgentAdapter.isOpened(toolOpenState);
  const isWindows = storageConfig.platform === 'windows';
  const effectiveLicenseStatus = licenseStatus || hostServiceStatus?.license || null;
  const windowsLicenseActive = !isWindows || Boolean(effectiveLicenseStatus?.active);
  const restrictedSections = new Set<Section>(['init', 'new', 'inbox', 'assets', 'projects', 'growth', 'qa', 'memory', 'soul', 'rules', 'conversation', 'tasks']);
  const isLicenseRestrictedSection = isWindows && !windowsLicenseActive && restrictedSections.has(activeSection);
  const licenseRestrictionText = effectiveLicenseStatus?.message || 'Windows 主机尚未激活。未激活状态仅支持首页、系统设置和已有档案/报告的只读浏览。';
  const shouldBlockForAgentInstall = isWindows && installStatus ? !installStatus.anyInstalled : false;
  const memoryScanCandidates = agentScanCandidates.filter((candidate) => candidate.kind === 'memory');
  const soulScanCandidates = agentScanCandidates.filter((candidate) => candidate.kind === 'soul');
  const ruleScanCandidates = agentScanCandidates.filter((candidate) => candidate.kind === 'rule');
  const conversationScanCandidates = agentScanCandidates.filter((candidate) => candidate.kind === 'conversation');
  const ruleFiles = agentRules?.files ?? [];
  const selectedRuleFile = ruleFiles.find((file) => file.fileName === ruleFileName);
  const filteredSourceRecords = (sourceRegistry?.records ?? []).filter((record) =>
    (sourceFilter === 'all' || record.assetType === sourceFilter)
    && (sourceToolFilter === 'all' || record.tool === sourceToolFilter)
  );
  const filteredMarkdownFiles = useMemo(
    () =>
      selectedArchiveCategory === 'all'
        ? markdownFiles.filter(isVisibleArchiveFile)
        : markdownFiles.filter((file) => isVisibleArchiveFile(file) && !isLearningReportFile(file) && classifyMarkdownFile(file, archiveKeywords) === selectedArchiveCategory),
    [archiveKeywords, markdownFiles, selectedArchiveCategory],
  );
  const filteredHostUploadRecords = useMemo(() => {
    const keyword = hostUploadSearch.trim().toLowerCase();
    const records = hostUploadRecords.length > 0 ? hostUploadRecords : hostServiceStatus?.recentUploads ?? [];
    const now = Date.now();
    return records.filter((record) => {
      if (hostUploadStudentFilter !== 'all' && String(record.studentId || '') !== hostUploadStudentFilter) return false;
      if (hostUploadDeviceFilter !== 'all' && String(record.deviceId || record.deviceName || '') !== hostUploadDeviceFilter) return false;
      if (hostUploadStatusFilter !== 'all' && String(record.status || 'pending_digest') !== hostUploadStatusFilter) return false;
      if (hostUploadDateFilter !== 'all') {
        const time = record.uploadedAt ? new Date(record.uploadedAt).getTime() : 0;
        const days = hostUploadDateFilter === 'today' ? 1 : hostUploadDateFilter === '7d' ? 7 : 30;
        if (!time || now - time > days * 24 * 60 * 60 * 1000) return false;
      }
      if (!keyword) return true;
      return [record.filename, record.studentName, record.deviceName, record.path]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword));
    });
  }, [hostServiceStatus?.recentUploads, hostUploadDateFilter, hostUploadDeviceFilter, hostUploadRecords, hostUploadSearch, hostUploadStatusFilter, hostUploadStudentFilter]);

  const filteredAssets = useMemo(() => {
    const keyword = assetSearch.trim().toLowerCase();
    return (assetIndex.assets ?? []).filter((asset) => {
      if (assetDuplicateOnly && Number(asset.duplicateCount ?? 1) <= 1) return false;
      if (assetStudentFilter !== 'all') {
        const linked = asset.linkedStudents ?? [];
        if (asset.ownerStudentId !== assetStudentFilter && !linked.includes(assetStudentFilter)) return false;
      }
      if (assetSourceFilter !== 'all' && String(asset.sourceName || '未标注来源') !== assetSourceFilter) return false;
      if (assetTypeFilter !== 'all' && String(asset.type || 'file') !== assetTypeFilter) return false;
      if (!keyword) return true;
      return [asset.filename, asset.path, asset.ownerStudentName, asset.sourceName, asset.sha1]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword));
    });
  }, [assetDuplicateOnly, assetIndex.assets, assetSearch, assetSourceFilter, assetStudentFilter, assetTypeFilter]);

  const assetSources = useMemo(() => (
    Array.from(new Set((assetIndex.assets ?? []).map((asset) => String(asset.sourceName || '未标注来源')).filter(Boolean))).sort()
  ), [assetIndex.assets]);

  const assetTypes = useMemo(() => (
    Array.from(new Set((assetIndex.assets ?? []).map((asset) => String(asset.type || 'file')).filter(Boolean))).sort()
  ), [assetIndex.assets]);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null;
  const selectedAsset = assetIndex.assets.find((asset) => asset.assetId === selectedAssetId) ?? filteredAssets[0] ?? null;
  const duplicateAssetGroups = useMemo(() => {
    const groups = new Map<string, AssetRecord[]>();
    for (const asset of assetIndex.assets ?? []) {
      if (!asset.sha1) continue;
      const current = groups.get(asset.sha1) ?? [];
      current.push(asset);
      groups.set(asset.sha1, current);
    }
    return Array.from(groups.entries())
      .map(([sha1, assets]) => ({ sha1, assets }))
      .filter((group) => group.assets.length > 1)
      .sort((a, b) => b.assets.length - a.assets.length);
  }, [assetIndex.assets]);
  const projectCandidateAssets = useMemo(() => {
    const selectedAssetIds = new Set(selectedProject?.assetIds ?? []);
    return filteredAssets.filter((asset) => !selectedAssetIds.has(asset.assetId)).slice(0, 120);
  }, [filteredAssets, selectedProject?.assetIds]);
  const projectStagingItems = selectedProject?.stagingItems ?? [];
  const filteredProjectStagingItems = useMemo(() => {
    const keyword = projectStagingSearch.trim().toLowerCase();
    return projectStagingItems.filter((item) => {
      if (projectStagingStatusFilter !== 'all' && item.status !== projectStagingStatusFilter) return false;
      if (!keyword) return true;
      return [item.filename, item.path, item.sourcePath, item.sha1, item.aiAction, item.aiReason, item.governanceAction, item.governanceReason]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword));
    });
  }, [projectStagingItems, projectStagingSearch, projectStagingStatusFilter]);
  const selectedProjectStagingItems = projectStagingItems.filter((item) => selectedProjectStagingIds.includes(item.id));
  const projectStagingGovernanceStats = useMemo(() => {
    const duplicateCount = projectStagingItems.filter((item) => Number(item.duplicateCount ?? 1) > 1).length;
    const governanceCandidateIds = projectStagingItems
      .filter((item) => item.governanceAction && !String(item.governanceAction).includes('无需处理'))
      .map((item) => item.id);
    const promotionCandidateIds = projectStagingItems
      .filter((item) => (
        ['selected', 'analyzed', 'promoted'].includes(String(item.status))
        || /选入|晋升|分析|采用/.test(`${item.aiAction || ''}${item.governanceAction || ''}`)
      ))
      .map((item) => item.id);
    return { duplicateCount, actionCount: governanceCandidateIds.length, governanceCandidateIds, promotionCandidateIds };
  }, [projectStagingItems]);

  const projectStatusLabel = (status?: string) => {
    if (status === 'draft') return '草稿';
    if (status === 'active') return '进行中';
    if (status === 'pending_archive') return '待归档';
    if (status === 'archived') return '已归档';
    if (status === 'published') return '已发布';
    if (status === 'sealed') return '已封存';
    return status || '进行中';
  };

  const projectStagingStatusLabel = (status?: string) => {
    if (status === 'collected') return '已收集';
    if (status === 'screened') return '已初筛';
    if (status === 'selected') return '选入分析';
    if (status === 'analyzed') return '已分析';
    if (status === 'promoted') return '已晋升';
    if (status === 'discarded') return '已归档/丢弃';
    return status || '已收集';
  };

  const promotionActionLabel = (action?: PromotionAction | string) => {
    if (action === 'reference') return '引用';
    if (action === 'publish') return '发布';
    if (action === 'absorb') return '吸收';
    if (action === 'skip') return '跳过';
    return action || '未选择';
  };

  const promotionExecutionPreview = useMemo(() => {
    if (!promotionPlan) return '';
    const targets = promotionPlan.students?.map((student) => student.name).join('、') || '未绑定学生';
    const counts = promotionPlan.items.reduce<Record<string, number>>((acc, item) => {
      acc[item.action] = (acc[item.action] || 0) + 1;
      return acc;
    }, {});
    const copyCount = promotionPlan.items.filter((item) => item.kind === 'file' && item.action === 'absorb').length;
    const publishCount = promotionPlan.items.filter((item) => item.action === 'publish').length;
    const referenceCount = promotionPlan.items.filter((item) => item.action === 'reference').length;
    const skipCount = promotionPlan.items.filter((item) => item.action === 'skip').length;
    return [
      `目标学生：${targets}`,
      `将发布：${publishCount} 项；引用：${referenceCount} 项；吸收复制：${copyCount} 个文件；跳过：${skipCount} 项。`,
      '将写入：学生综合汇总目录的项目归档记录/项目贡献汇总/项目贡献明细、学生成长模型的项目贡献/成长证据/成长证据草稿，以及项目知识空间的归档执行日志。',
      counts.absorb ? '吸收动作会复制物理文件到学生原始资料库，并登记新的资产引用。' : '',
    ].filter(Boolean).join('\n');
  }, [promotionPlan]);

  const toggleProjectAsset = (assetId: string) => {
    setSelectedProjectAssetIds((current) => (current.includes(assetId) ? current.filter((item) => item !== assetId) : [...current, assetId]));
  };

  const toggleProjectStagingItem = (itemId: string) => {
    setSelectedProjectStagingIds((current) => (current.includes(itemId) ? current.filter((item) => item !== itemId) : [...current, itemId]));
  };

  const selectVisibleProjectStagingItems = () => {
    setSelectedProjectStagingIds(filteredProjectStagingItems.map((item) => item.id));
  };

  const selectProjectGovernanceCandidates = () => {
    setSelectedProjectStagingIds(projectStagingGovernanceStats.governanceCandidateIds);
  };

  const selectProjectPromotionCandidates = () => {
    setSelectedProjectStagingIds(projectStagingGovernanceStats.promotionCandidateIds);
  };

  const toggleProjectDraftStudent = (studentId: string) => {
    setProjectDraft((current) => {
      const next = current.studentIds.includes(studentId)
        ? current.studentIds.filter((id) => id !== studentId)
        : [...current.studentIds, studentId];
      return { ...current, studentIds: next };
    });
  };

  const hostStudentStat = (student: Student) =>
    hostServiceStatus?.students?.find((item) => String(item.id) === String(student.id));

  const hostPendingDigestTotal = (hostServiceStatus?.students ?? []).reduce(
    (total, student) => total + (student.pendingDigestCount ?? 0) + (student.submittedDigestCount ?? 0),
    0,
  );

  const pendingDigestValue = (student: Student) => {
    const stat = hostStudentStat(student);
    const hostPending = (stat?.pendingDigestCount ?? 0) + (stat?.submittedDigestCount ?? 0);
    if (stat && typeof hostPending === 'number') return hostPending;
    return (student.pendingDigestCount ?? 0) + (student.submittedDigestCount ?? 0);
  };

  const digestStatusText = (student: Student) => {
    const stat = hostStudentStat(student);
    const lastDigestAt = stat?.lastDigestAt || student.lastDigestAt || '';
    const message = stat?.digestMessage || student.digestMessage || '';
    if (pendingDigestValue(student) > 0) return message || `有资料等待 ${getAgentToolProfile(student.agentTool).name} 消化。`;
    if (lastDigestAt) return `最近消化：${new Date(lastDigestAt).toLocaleString('zh-CN')}`;
    return '暂无待消化资料。';
  };

  const connectionModeLabel = (mode?: string) => {
    if (mode === 'lan_only') return '仅局域网';
    if (mode === 'manual') return '手动输入远程主机地址';
    return '局域网 + Tailscale';
  };

  const installForTool = (toolId: AgentToolId): AgentToolInstall | undefined => {
    const tool = getAgentToolProfile(toolId);
    if (tool.openMode === 'url') {
      return { installed: true, version: tool.category === 'platform' ? '平台入口' : '网页入口', exePath: tool.installUrls.web || '' };
    }
    if (toolId === 'ima.copilot') return installStatus?.imaCopilot;
    if (toolId === 'workbuddy') return installStatus?.workbuddy;
    if (toolId === 'claude-code') return installStatus?.claudeCode;
    return installStatus?.[toolId as 'qclaw' | 'marvis' | 'hohu' | 'openclaw' | 'codex'];
  };

  const uploadStatusLabel = (status?: string) => {
    if (status === 'submitted') return '已提交消化';
    if (status === 'digesting') return '消化中';
    if (status === 'processed') return '已处理完成';
    if (status === 'failed') return '消化失败';
    if (status === 'ignored') return '已忽略';
    return '待消化';
  };

  const licenseLabel = (license?: LicenseStatus | null) => {
    if (!license || license.status === 'inactive') return '未激活';
    if (license.status === 'expired') return '已过期';
    return `${license.planLabel || license.plan || '已激活'}${license.expiresAt ? ` · 到期 ${new Date(license.expiresAt).toLocaleDateString('zh-CN')}` : ' · 永久'}`;
  };

  const refreshLicenseStatus = () => {
    const raw = bridge()?.getLicenseStatus?.();
    if (!raw) return;
    try {
      const result = JSON.parse(raw) as { ok?: boolean; license?: LicenseStatus; message?: string };
      if (result.license) setLicenseStatus(result.license);
      if (result.message) setLicenseMessage(result.message);
    } catch {
      setLicenseMessage('读取许可证状态失败。');
    }
  };

  const activateLicense = () => {
    if (!licenseCodeDraft.trim()) {
      setLicenseMessage('请先输入激活码。');
      return;
    }
    const raw = bridge()?.activateLicense?.(licenseCodeDraft);
    if (!raw) {
      setLicenseMessage('当前环境不支持许可证激活。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; message?: string; license?: LicenseStatus; status?: HostServiceStatus };
      if (result.license) setLicenseStatus(result.license);
      if (result.status) setHostServiceStatus(result.status);
      setLicenseMessage(result.message || (result.ok ? '激活成功。' : '激活失败。'));
      if (result.ok) setLicenseCodeDraft('');
    } catch {
      setLicenseMessage('许可证激活失败。');
    }
  };

  const deactivateLicense = () => {
    const confirmed = window.confirm('确认移除本机许可证吗？平板终端会显示主机未激活。');
    if (!confirmed) return;
    const raw = bridge()?.deactivateLicense?.();
    if (!raw) return;
    try {
      const result = JSON.parse(raw) as { ok?: boolean; message?: string; license?: LicenseStatus; status?: HostServiceStatus };
      if (result.license) setLicenseStatus(result.license);
      if (result.status) setHostServiceStatus(result.status);
      setLicenseMessage(result.message || '已移除本机许可证。');
    } catch {
      setLicenseMessage('移除许可证失败。');
    }
  };

  const syncStudentsToHost = (next: Student[]) => {
    if (!bridge()?.syncStudents) return;
    try {
      const raw = bridge()?.syncStudents?.(JSON.stringify(next));
      if (!raw) return;
      const result = JSON.parse(raw) as { ok?: boolean; message?: string };
      if (!result.ok && result.message) setHostServiceMessage(result.message);
    } catch (error) {
      setHostServiceMessage(`同步学生索引失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const refreshHostServiceStatus = () => {
    const raw = bridge()?.getHostServiceStatus?.();
    if (!raw) return;
    try {
      const status = JSON.parse(raw) as HostServiceStatus;
      setHostServiceStatus(status);
      if (status.license) setLicenseStatus(status.license);
      setHostPortDraft(String(status.port || 18777));
      refreshHostUploadRecords();
      refreshHostTimeline();
    } catch {
      setHostServiceMessage('读取主机服务状态失败。');
    }
  };

  const refreshHostUploadRecords = () => {
    const raw = bridge()?.getHostUploadRecords?.();
    if (!raw) return;
    try {
      const result = JSON.parse(raw) as { ok?: boolean; records?: HostUploadRecord[] };
      if (result.ok && Array.isArray(result.records)) setHostUploadRecords(result.records);
    } catch {
      setHostServiceMessage('读取上传记录失败。');
    }
  };

  const refreshHostTimeline = () => {
    const raw = bridge()?.getHostTimeline?.();
    if (!raw) return;
    try {
      const result = JSON.parse(raw) as { ok?: boolean; events?: HostTimelineEvent[] };
      if (result.ok && Array.isArray(result.events)) setHostTimeline(result.events);
    } catch {
      // Timeline is auxiliary; do not interrupt the main host status refresh.
    }
  };

  const applyHostServiceResult = (raw?: string) => {
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const status = parsed.status ?? parsed;
      if (parsed.ok === false && parsed.message) {
        setHostServiceMessage(parsed.message);
      } else {
        setHostServiceMessage(status.running ? '主机服务已启动。' : '主机服务已停止。');
      }
      setHostServiceStatus(status as HostServiceStatus);
      setHostPortDraft(String(status.port || 18777));
      refreshHostUploadRecords();
    } catch {
      setHostServiceMessage('主机服务操作失败。');
    }
  };

  const applyStorageConfig = (config: StorageConfig) => {
    activeStorageConfig = { ...defaultStorageConfig, ...config };
    setStorageConfig(activeStorageConfig);
    setDraft((current) => ({ ...current, rootPathLabel: pathsFor(current.name).root }));
    setStudents((current) => {
      const next = current.map((student) => ({
        ...student,
        rootPathLabel: student.knowledgeBaseMode === 'adopted' ? student.rootPathLabel ?? student.rootPath : pathsFor(student.name).root,
      }));
      saveStudents(next);
      syncStudentsToHost(next);
      return next;
    });
    if (config.hostServicePort) setHostPortDraft(String(config.hostServicePort));
  };

  const recordImportedFiles = (studentId: string, importedCount: number) => {
    const count = Math.max(1, Number(importedCount) || 1);
    const stamp = new Date().toLocaleString('zh-CN');
    setStudents((current) => {
      const next = current.map((student) =>
        student.id === studentId
          ? {
              ...student,
              lastImportAt: stamp,
              pendingDigestCount: (student.pendingDigestCount ?? 0) + count,
            }
          : student,
      );
      saveStudents(next);
      syncStudentsToHost(next);
      return next;
    });
  };

  const refreshInstallStatus = () => {
    const raw = bridge()?.getAgentToolInstallStatus?.();
    if (!raw) {
      setInstallStatus(null);
      return;
    }
    try {
      const status = JSON.parse(raw) as AgentToolInstallStatus;
      setInstallStatus(status);
      if (!status.anyInstalled) {
        setInstallMessage('未检测到 QClaw、OpenClaw、WorkBuddy、Hohu、ima.copilot、Marvis、Codex 或 Claude Code，请先下载安装其中一个工具。');
        return;
      }
      setInstallMessage('');
      setDraft((current) => {
        if (status.qclaw.installed && current.agentTool !== 'qclaw') return { ...current, agentTool: 'qclaw' };
        if (!status.qclaw.installed && status.openclaw?.installed && current.agentTool !== 'openclaw') return { ...current, agentTool: 'openclaw' };
        if (!status.qclaw.installed && !status.openclaw?.installed && status.workbuddy?.installed && current.agentTool !== 'workbuddy') return { ...current, agentTool: 'workbuddy' };
        if (!status.qclaw.installed && !status.openclaw?.installed && !status.workbuddy?.installed && status.hohu.installed && current.agentTool !== 'hohu') return { ...current, agentTool: 'hohu' };
        if (!status.qclaw.installed && !status.openclaw?.installed && !status.workbuddy?.installed && !status.hohu.installed && status.imaCopilot?.installed && current.agentTool !== 'ima.copilot') return { ...current, agentTool: 'ima.copilot' };
        if (!status.qclaw.installed && !status.openclaw?.installed && !status.workbuddy?.installed && !status.hohu.installed && !status.imaCopilot?.installed && status.marvis.installed && current.agentTool !== 'marvis') return { ...current, agentTool: 'marvis' };
        if (!status.qclaw.installed && !status.openclaw?.installed && !status.workbuddy?.installed && !status.hohu.installed && !status.imaCopilot?.installed && !status.marvis.installed && status.codex?.installed && current.agentTool !== 'codex') return { ...current, agentTool: 'codex' };
        if (!status.qclaw.installed && !status.openclaw?.installed && !status.workbuddy?.installed && !status.hohu.installed && !status.imaCopilot?.installed && !status.marvis.installed && !status.codex?.installed && status.claudeCode?.installed && current.agentTool !== 'claude-code') return { ...current, agentTool: 'claude-code' };
        return current;
      });
    } catch {
      setInstallMessage('工具安装检测结果解析失败。');
    }
  };

  const refreshTemplateCenter = () => {
    const raw = bridge()?.getTemplateCenter?.(JSON.stringify(systemTemplateFiles));
    if (!raw) return;
    try {
      const result = JSON.parse(raw) as TemplateCenterState;
      setTemplateCenter(result);
      if (!result.ok) setTemplateMessage(result.message || '模板库读取失败。');
    } catch {
      setTemplateMessage('模板库读取结果解析失败。');
    }
  };

  const refreshAgentCenter = (studentId = selectedStudent?.id) => {
    if (!studentId) return;
    const raw = bridge()?.getAgentCenter?.(studentId);
    if (!raw) return;
    try {
      const result = JSON.parse(raw) as AgentCenterState;
      setAgentCenter(result);
      if (result.ok) {
        setUnifiedMemoryText(result.unifiedMemory || '');
        setUnifiedSoulText(result.unifiedSoul || '');
      } else {
        setAgentCenterMessage(result.message || '读取 Agent 中枢失败。');
      }
    } catch {
      setAgentCenterMessage('Agent 中枢读取结果解析失败。');
    }
  };

  const refreshAgentRules = (studentId = selectedStudent?.id, preferredFileName = ruleFileName) => {
    if (!studentId) return;
    const raw = bridge()?.getAgentRules?.(studentId);
    if (!raw) {
      setRuleMessage('当前环境不支持规则文件管理。');
      return;
    }
    try {
      const result = JSON.parse(raw) as AgentRulesState;
      setAgentRules(result);
      if (!result.ok) {
        setRuleMessage(result.message || '读取规则文件失败。');
        return;
      }
      const files = result.files ?? [];
      const selected = files.find((file) => file.fileName === preferredFileName)
        || files.find((file) => file.fileName.toLowerCase() === 'agent.md')
        || files[0];
      if (selected) {
        setRuleFileName(selected.fileName);
        setRuleContent(selected.content || '');
      }
      if (result.message) setRuleMessage(result.message);
    } catch {
      setRuleMessage('规则文件读取结果解析失败。');
    }
  };

  const refreshSourceRegistry = (studentId = selectedStudent?.id) => {
    if (!studentId) return;
    const raw = bridge()?.getAgentSourceRegistry?.(studentId);
    if (!raw) return;
    try {
      setSourceRegistry(JSON.parse(raw) as AgentSourceRegistryState);
    } catch {
      setAgentCenterMessage('来源记录读取结果解析失败。');
    }
  };

  const rollbackSourceRecord = (recordId: string) => {
    if (!selectedStudent) return;
    const confirmed = window.confirm('确认撤销这条来源记录吗？\n\n只会从 source-registry.json 中移除登记，不会删除目标文件。');
    if (!confirmed) return;
    const raw = bridge()?.rollbackAgentSourceRecord?.(selectedStudent.id, recordId);
    if (!raw) {
      setAgentCenterMessage('当前环境不支持撤销来源记录。');
      return;
    }
    try {
      const result = JSON.parse(raw) as AgentSourceRegistryState;
      setSourceRegistry({ ok: Boolean(result.ok), path: result.path, records: result.records ?? [], message: result.message });
      setAgentCenterMessage(result.message || (result.ok ? '已撤销来源记录。' : '撤销来源记录失败。'));
    } catch {
      setAgentCenterMessage('撤销来源记录结果解析失败。');
    }
  };

  const refreshConversationCenter = (studentId = selectedStudent?.id) => {
    if (!studentId) return;
    const raw = bridge()?.getAgentConversationCenter?.(studentId);
    if (!raw) {
      setConversationMessage('当前环境不支持对话历史管理。');
      return;
    }
    try {
      const result = JSON.parse(raw) as AgentConversationState;
      setConversationCenter(result);
      if (!result.ok) setConversationMessage(result.message || '读取对话历史失败。');
    } catch {
      setConversationMessage('对话历史读取结果解析失败。');
    }
  };

  const generateAgentRule = (fileName: string) => {
    if (!selectedStudent) return;
    const raw = bridge()?.generateAgentRuleFile?.(selectedStudent.id, fileName);
    if (!raw) {
      setRuleMessage('当前环境不支持生成规则模板。');
      return;
    }
    try {
      const result = JSON.parse(raw) as AgentRulesState & { fileName?: string };
      if (result.files) setAgentRules(result);
      setRuleMessage(result.message || (result.ok ? `已生成 ${fileName}。` : `生成 ${fileName} 失败。`));
      if (result.ok) {
        refreshAgentRules(selectedStudent.id, fileName);
        refreshSourceRegistry(selectedStudent.id);
      }
    } catch {
      setRuleMessage('生成规则模板结果解析失败。');
    }
  };

  const compareAgentRule = () => {
    if (!selectedStudent || !ruleFileName) return;
    const raw = bridge()?.compareAgentRuleFiles?.(selectedStudent.id, 'AGENT.md', ruleFileName);
    if (!raw) {
      setRuleMessage('当前环境不支持规则文件对比。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; onlyBase?: string[]; onlyTarget?: string[]; message?: string };
      setRuleDiff({ onlyBase: result.onlyBase ?? [], onlyTarget: result.onlyTarget ?? [], message: result.message });
      setRuleMessage(result.message || (result.ok ? '已完成规则文件对比。' : '规则文件对比失败。'));
    } catch {
      setRuleMessage('规则文件对比结果解析失败。');
    }
  };

  const buildConversationExtractPrompt = (student: Student) => {
    const p = pathsForStudent(student);
    return `请从下面的对话历史中提取可沉淀到学生「${student.name}」教育管家的资产。

学生信息：
- 姓名：${student.name}
- 年级：${student.grade || '待补充'}
- 学校：${student.school || '待补充'}
- 当前目标：${student.goal || '待补充'}
- 知识库根目录：${p.root}
- AGENT.md：${p.agent}
- 学情分析汇总目录：${p.summary}

请只返回 JSON，不要使用 Markdown 代码块。格式：
{
  "memoryCandidates": ["适合写入 UnifiedMemory.md 的长期事实或观察"],
  "soulSuggestions": ["适合写入 UnifiedSoul.md 的人设、工作边界或偏好建议"],
  "qaHighlights": ["适合写入学情分析汇总/咨询精华库的高价值问答结论"],
  "todos": ["后续跟进事项"]
}

对话历史如下：
${conversationText || '（请先粘贴对话历史）'}`;
  };

  const saveConversationImport = () => {
    if (!selectedStudent) return;
    if (!conversationText.trim()) {
      setConversationMessage('请先粘贴或输入对话历史。');
      return;
    }
    const raw = bridge()?.saveAgentConversationImport?.(selectedStudent.id, conversationText, conversationTool);
    if (!raw) {
      setConversationMessage('当前环境不支持保存对话历史。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; message?: string };
      setConversationMessage(result.message || (result.ok ? '已保存对话历史。' : '保存对话历史失败。'));
      if (result.ok) {
        refreshConversationCenter(selectedStudent.id);
        refreshSourceRegistry(selectedStudent.id);
      }
    } catch {
      setConversationMessage('保存对话历史结果解析失败。');
    }
  };

  const importConversationFiles = () => {
    if (!selectedStudent) return;
    const raw = bridge()?.selectAgentConversationFiles?.(selectedStudent.id, conversationTool);
    if (!raw) {
      setConversationMessage('当前环境不支持选择对话历史文件。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; cancelled?: boolean; message?: string; combinedContent?: string };
      setConversationMessage(result.message || (result.ok ? '已导入对话历史文件。' : '导入对话历史文件失败。'));
      if (result.ok) {
        if (result.combinedContent) {
          setConversationText((current) => current.trim()
            ? `${current.trim()}\n\n---\n${result.combinedContent}`
            : result.combinedContent || '');
        }
        refreshConversationCenter(selectedStudent.id);
        refreshSourceRegistry(selectedStudent.id);
      }
    } catch {
      setConversationMessage('对话历史文件导入结果解析失败。');
    }
  };

  const copyConversationExtractPrompt = async () => {
    if (!selectedStudent) return;
    await copyText(buildConversationExtractPrompt(selectedStudent), '已复制对话历史提取指令。');
  };

  const buildConversationExtractPreview = (text = conversationExtractText): ConversationExtractPreview => {
    try {
      const parsed = parseLooseJson(text) as Record<string, unknown>;
      const memoryCandidates = Array.isArray(parsed.memoryCandidates)
        ? parsed.memoryCandidates
        : Array.isArray(parsed.memories)
          ? parsed.memories
          : [];
      const soulSuggestions = Array.isArray(parsed.soulSuggestions)
        ? parsed.soulSuggestions
        : Array.isArray(parsed.personaSuggestions)
          ? parsed.personaSuggestions
          : [];
      const qaHighlights = Array.isArray(parsed.qaHighlights)
        ? parsed.qaHighlights
        : Array.isArray(parsed.qa)
          ? parsed.qa
          : [];
      const todos = Array.isArray(parsed.todos)
        ? parsed.todos
        : Array.isArray(parsed.followUps)
          ? parsed.followUps
          : [];
      return { memoryCandidates, soulSuggestions, qaHighlights, todos, raw: parsed };
    } catch (error) {
      return {
        memoryCandidates: [],
        soulSuggestions: [],
        qaHighlights: [],
        todos: [],
        raw: {},
        error: error instanceof Error ? error.message : 'JSON 格式不正确',
      };
    }
  };

  const previewConversationExtractResult = () => {
    if (!conversationExtractText.trim()) {
      setConversationMessage('请先粘贴 AI 提取结果 JSON。');
      setConversationExtractPreview(null);
      return null;
    }
    const preview = buildConversationExtractPreview();
    setConversationExtractPreview(preview);
    if (preview.error) {
      setConversationMessage(`对话提取结果解析失败：${preview.error}`);
      return null;
    }
    const total = preview.memoryCandidates.length + preview.soulSuggestions.length + preview.qaHighlights.length + preview.todos.length;
    setConversationMessage(total ? `已解析提取结果：共 ${total} 条候选，请确认写入范围。` : '已解析 JSON，但没有发现可写入的教育资产。');
    return preview;
  };

  const saveConversationExtractResult = () => {
    if (!selectedStudent) return;
    const preview = conversationExtractPreview && !conversationExtractPreview.error
      ? conversationExtractPreview
      : previewConversationExtractResult();
    if (!preview || preview.error) return;
    const payload = {
      ...preview.raw,
      memoryCandidates: conversationExtractTargets.memory ? preview.memoryCandidates : [],
      soulSuggestions: conversationExtractTargets.soul ? preview.soulSuggestions : [],
      qaHighlights: conversationExtractTargets.qa ? preview.qaHighlights : [],
      todos: conversationExtractTargets.todos ? preview.todos : [],
    };
    const selectedCount = payload.memoryCandidates.length + payload.soulSuggestions.length + payload.qaHighlights.length + payload.todos.length;
    if (!selectedCount) {
      setConversationMessage('请至少选择一种要写入的教育资产。');
      return;
    }
    const raw = bridge()?.saveConversationExtract?.(selectedStudent.id, JSON.stringify(payload, null, 2), conversationTool);
    if (!raw) {
      setConversationMessage('当前环境不支持保存对话提取结果。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; message?: string };
      setConversationMessage(result.message || (result.ok ? '已写入对话提取资产。' : '保存提取结果失败。'));
      if (result.ok) {
        setConversationExtractPreview(null);
        refreshAgentCenter(selectedStudent.id);
        refreshConversationCenter(selectedStudent.id);
        refreshSourceRegistry(selectedStudent.id);
      }
    } catch {
      setConversationMessage('对话提取结果解析失败。');
    }
  };

  const saveAgentRule = () => {
    if (!selectedStudent) return;
    const raw = bridge()?.saveAgentRuleFile?.(selectedStudent.id, ruleFileName, ruleContent);
    if (!raw) {
      setRuleMessage('当前环境不支持保存规则文件。');
      return;
    }
    try {
      const result = JSON.parse(raw) as AgentRulesState & { fileName?: string };
      if (result.files) setAgentRules(result);
      setRuleMessage(result.message || (result.ok ? '已保存规则文件。' : '保存规则文件失败。'));
      if (result.ok) {
        refreshAgentRules(selectedStudent.id, result.fileName || ruleFileName);
        refreshSourceRegistry(selectedStudent.id);
      }
    } catch {
      setRuleMessage('保存规则文件结果解析失败。');
    }
  };

  useEffect(() => {
    const storageRaw = bridge()?.getStorageConfig?.();
    if (storageRaw) {
      try {
        applyStorageConfig(JSON.parse(storageRaw) as StorageConfig);
      } catch {
        // Keep Android/web defaults.
      }
    }
    refreshInstallStatus();
    refreshTemplateCenter();
    syncStudentsToHost(students);
    refreshHostServiceStatus();
    refreshLicenseStatus();
    refreshAssets();
    refreshProjects();
  }, []);

  useEffect(() => {
    (window as unknown as { onNativeImportResult?: (payload: string | NativeImportResult) => void }).onNativeImportResult = (payload: string | NativeImportResult) => {
      const result: NativeImportResult =
        typeof payload === 'string'
          ? (() => {
              try {
                return JSON.parse(payload) as NativeImportResult;
              } catch {
                return { message: payload };
              }
            })()
          : payload;
      const message = result.message || '';
      setImportMessage(message);
      if (pendingImportStudentId && (result.ok || message.startsWith('已导入'))) {
        const matchedCount = message.match(/已导入\s*(\d+)/);
        const importedCount = Number(result.imported ?? (matchedCount ? Number(matchedCount[1]) : 1));
        recordImportedFiles(pendingImportStudentId, importedCount);
      }
      window.setTimeout(() => setImportMessage(''), 3600);
    };
    (window as unknown as { onNativeUpdateResult?: (payload: string) => void }).onNativeUpdateResult = (payload: string) => {
      setCheckingUpdate(false);
      try {
        setUpdateInfo(JSON.parse(payload) as UpdateInfo);
      } catch {
        setUpdateInfo({ hasUpdate: false, message: payload || '更新检查失败' });
      }
    };
    (window as unknown as { onNativeArchiveRootSelected?: (payload: string) => void }).onNativeArchiveRootSelected = (payload: string) => {
      try {
        const result = JSON.parse(payload) as { ok?: boolean; uri?: string; message?: string };
        if (result.ok && result.uri) {
          applyStorageConfig({ ...activeStorageConfig, baseDir: result.uri, usesAbsolutePaths: true });
        }
        setArchiveRootMessage(result.ok ? '已设置学生资料根目录' : result.message || '目录授权失败');
      } catch {
        setArchiveRootMessage(payload || '目录授权失败');
      }
    };
    (window as unknown as { onNativeHostServiceChanged?: (payload: string) => void }).onNativeHostServiceChanged = (payload: string) => {
      try {
        const status = JSON.parse(payload) as HostServiceStatus;
        setHostServiceStatus(status);
        if (status.license) setLicenseStatus(status.license);
        refreshHostUploadRecords();
      } catch {
        refreshHostServiceStatus();
      }
    };

    const rootStatus = bridge()?.getArchiveRootStatus?.();
    if (rootStatus) {
      try {
        const result = JSON.parse(rootStatus) as { ok?: boolean; uri?: string; message?: string };
        setArchiveRootMessage(result.ok ? '已授权档案目录' : result.message || '尚未授权档案目录');
      } catch {
        setArchiveRootMessage('尚未授权档案目录');
      }
    }

    const compatibilityStatus = bridge()?.getCompatibilityStatus?.();
    if (compatibilityStatus) {
      try {
        setCompatibility(JSON.parse(compatibilityStatus) as Record<string, unknown>);
      } catch {
        setCompatibility({ ok: false, message: '兼容性检测解析失败' });
      }
    }

    const timer = window.setInterval(() => {
      const raw = bridge()?.getAppStatus?.();
      if (!raw) return;
      try {
        const status = JSON.parse(raw) as { qclawOpened?: boolean; marvisOpened?: boolean; hohuOpened?: boolean; openclawOpened?: boolean; imaCopilotOpened?: boolean; workbuddyOpened?: boolean; codexOpened?: boolean; claudeCodeOpened?: boolean; obsidianOpened?: boolean };
        setQclawOpened(Boolean(status.qclawOpened));
        setMarvisOpened(Boolean(status.marvisOpened));
        setHohuOpened(Boolean(status.hohuOpened));
        setOpenclawOpened(Boolean(status.openclawOpened));
        setImaCopilotOpened(Boolean(status.imaCopilotOpened));
        setWorkbuddyOpened(Boolean(status.workbuddyOpened));
        setCodexOpened(Boolean(status.codexOpened));
        setClaudeCodeOpened(Boolean(status.claudeCodeOpened));
        setObsidianOpened(Boolean(status.obsidianOpened));
      } catch {
        // Ignore bridge JSON parse errors.
      }
      const inboxRaw = bridge()?.getSharedInboxStatus?.();
      if (inboxRaw) {
        try {
          const inbox = JSON.parse(inboxRaw) as { count?: number };
          setSharedInboxCount(Number(inbox.count ?? 0));
        } catch {
          // Ignore inbox JSON parse errors.
        }
      }
    }, 1000);
    const hostTimer = window.setInterval(refreshHostServiceStatus, 5000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(hostTimer);
      delete (window as unknown as { onNativeImportResult?: (payload: string | NativeImportResult) => void }).onNativeImportResult;
      delete (window as unknown as { onNativeUpdateResult?: (payload: string) => void }).onNativeUpdateResult;
      delete (window as unknown as { onNativeArchiveRootSelected?: (payload: string) => void }).onNativeArchiveRootSelected;
      delete (window as unknown as { onNativeHostServiceChanged?: (payload: string) => void }).onNativeHostServiceChanged;
    };
  }, [pendingImportStudentId]);

  useEffect(() => {
    const payload = hostServiceStatus?.pairPayloadText;
    if (!payload) {
      setHostPairQr('');
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(payload, { margin: 2, width: 320, errorCorrectionLevel: 'H' })
      .then((url) => {
        if (!cancelled) setHostPairQr(url);
      })
      .catch(() => {
        if (!cancelled) setHostPairQr('');
      });
    return () => {
      cancelled = true;
    };
  }, [hostServiceStatus?.pairPayloadText]);

  useEffect(() => {
    if (activeSection === 'memory' || activeSection === 'soul' || activeSection === 'qa' || activeSection === 'conversation') {
      refreshAgentCenter();
      refreshSourceRegistry();
    }
  }, [activeSection, selectedId]);

  useEffect(() => {
    if (activeSection === 'rules') {
      refreshAgentRules();
      refreshSourceRegistry();
    }
    if (activeSection === 'conversation') refreshConversationCenter();
    if (activeSection === 'reports' && selectedStudent) refreshLearningReports(selectedStudent);
  }, [activeSection, selectedId]);

  useEffect(() => {
    setMarkdownFiles([]);
    setSelectedMarkdownId('');
    setMarkdownContent('');
    setMarkdownMessage('');
    setLearningReports([]);
    setLearningReportContent('');
    setLearningReportMessage('');
    setLearningReportFolder('');
    setLearningReportHealth(null);
    const student = students.find((item) => item.id === selectedId) ?? students[0];
    setStudentEditDraft(student ? {
      name: student.name,
      grade: student.grade,
      school: student.school,
      goal: student.goal,
      digestTime: student.digestTime,
      agentTool: student.agentTool,
      storageMode: student.storageMode,
      rootPathLabel: student.rootPathLabel,
      knowledgeBaseMode: student.knowledgeBaseMode ?? 'standard',
      rootPath: student.rootPath,
      rawPath: student.rawPath,
      summaryPath: student.summaryPath,
      agentPath: student.agentPath,
      outputPath: student.outputPath,
      agentBindingMode: student.agentBindingMode,
      agentNote: student.agentNote,
      adoptedAt: student.adoptedAt,
      pendingDigestCount: student.pendingDigestCount,
      submittedDigestCount: student.submittedDigestCount,
      processedDigestCount: student.processedDigestCount,
      lastDigestAt: student.lastDigestAt,
      digestStatus: student.digestStatus,
      digestMessage: student.digestMessage,
      agentName: student.agentName,
      remoteChannel: student.remoteChannel ?? 'none',
      remoteContact: student.remoteContact ?? '',
      remoteNote: student.remoteNote ?? '',
      remoteBindingStatus: student.remoteBindingStatus ?? 'unbound',
      remoteBoundAt: student.remoteBoundAt ?? '',
    } : null);
  }, [selectedId]);

  useEffect(() => {
    setCustomStepPrompts({});
  }, [draft, storageConfig]);

  useEffect(() => {
    if (isWindows && activeSection === 'inbox' && selectedStudent) {
      refreshMaterialImportRecords(selectedStudent);
    }
  }, [activeSection, selectedId]);

  const persist = (next: Student[]) => {
    setStudents(next);
    saveStudents(next);
    syncStudentsToHost(next);
  };

  const applyAdoptScanResult = (result: KnowledgeBaseScanResult) => {
    const cleanName = sanitizeName(draft.name);
    const rootPath = result.rootPath || adoptRootPath;
    setAdoptScanResult(result);
    if (result.rootPath) setAdoptRootPath(result.rootPath);
    setAdoptPaths((current) => ({
      agentPath: result.agentPath || (rootPath ? joinDisplayPath(rootPath, 'AGENT.md') : current.agentPath),
      rawPath: result.rawPath || (rootPath ? joinDisplayPath(rootPath, `${cleanName}原始资料库`) : current.rawPath),
      summaryPath: result.summaryPath || (rootPath ? joinDisplayPath(rootPath, `${cleanName}学情分析汇总`) : current.summaryPath),
      outputPath: result.outputPath || (rootPath ? joinDisplayPath(rootPath, '输出结果') : current.outputPath),
    }));
    setAdoptMessage(result.message || (result.ok ? '已扫描已有知识库目录。' : '扫描已有知识库失败。'));
  };

  const selectAdoptRoot = () => {
    const raw = bridge()?.selectKnowledgeBaseRoot?.();
    if (!raw) {
      setAdoptMessage('当前环境不支持选择已有知识库目录。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; path?: string; message?: string };
      if (!result.ok || !result.path) {
        setAdoptMessage(result.message || '未选择已有知识库目录。');
        return;
      }
      setAdoptRootPath(result.path);
      setAdoptPaths((current) => ({
        ...current,
        agentPath: current.agentPath || joinDisplayPath(result.path || '', 'AGENT.md'),
        outputPath: current.outputPath || joinDisplayPath(result.path || '', '输出结果'),
      }));
      setAdoptMessage('已选择已有知识库目录，请点击“扫描目录”。');
    } catch {
      setAdoptMessage('选择目录结果解析失败。');
    }
  };

  const scanAdoptKnowledgeBase = () => {
    if (!adoptRootPath.trim()) {
      setAdoptMessage('请先选择或填写已有知识库根目录。');
      return;
    }
    const raw = bridge()?.scanKnowledgeBase?.(adoptRootPath.trim(), draft.name);
    if (!raw) {
      setAdoptMessage('当前环境不支持扫描已有知识库目录。');
      return;
    }
    try {
      applyAdoptScanResult(JSON.parse(raw) as KnowledgeBaseScanResult);
    } catch {
      setAdoptMessage('扫描结果解析失败。');
    }
  };

  const ensureAdoptedWorkspace = (overwriteAgent = false) => {
    if (overwriteAgent && !window.confirm('确认备份并覆盖已有 AGENT.md 吗？\n\n如果 AGENT.md 不存在，则会直接写入标准模板。')) {
      return null;
    }
    const cleanName = sanitizeName(draft.name);
    const rootPath = adoptRootPath.trim();
    if (!rootPath) {
      setAdoptMessage('请先选择已有知识库根目录。');
      return null;
    }
    const payload = {
      rootPath,
      studentName: cleanName,
      agentPath: adoptPaths.agentPath || joinDisplayPath(rootPath, 'AGENT.md'),
      rawPath: adoptPaths.rawPath || joinDisplayPath(rootPath, `${cleanName}原始资料库`),
      summaryPath: adoptPaths.summaryPath || joinDisplayPath(rootPath, `${cleanName}学情分析汇总`),
      outputPath: adoptPaths.outputPath || joinDisplayPath(rootPath, '输出结果'),
      agentMd: buildAgentMd({
        ...effectiveDraft,
        name: cleanName,
        rootPath,
        rawPath: adoptPaths.rawPath || joinDisplayPath(rootPath, `${cleanName}原始资料库`),
        summaryPath: adoptPaths.summaryPath || joinDisplayPath(rootPath, `${cleanName}学情分析汇总`),
        agentPath: adoptPaths.agentPath || joinDisplayPath(rootPath, 'AGENT.md'),
        outputPath: adoptPaths.outputPath || joinDisplayPath(rootPath, '输出结果'),
      }),
      indexMd: buildIndexMd({ ...effectiveDraft, name: cleanName }),
      logMd: buildLogMd({ ...effectiveDraft, name: cleanName }),
      overwriteAgent,
    };
    const raw = bridge()?.ensureAdoptedKnowledgeBase?.(JSON.stringify(payload));
    if (!raw) {
      setAdoptMessage('当前环境不支持补齐已有知识库。');
      return null;
    }
    try {
      const result = JSON.parse(raw) as KnowledgeBaseScanResult;
      applyAdoptScanResult(result);
      return result;
    } catch {
      setAdoptMessage('补齐结果解析失败。');
      return null;
    }
  };

  const addStudent = () => {
    if (createMode === 'adopted') {
      const cleanName = sanitizeName(draft.name);
      const result = ensureAdoptedWorkspace(false);
      const rootPath = result?.rootPath || adoptRootPath.trim();
      const rawPath = result?.rawPath || adoptPaths.rawPath || joinDisplayPath(rootPath, `${cleanName}原始资料库`);
      const summaryPath = result?.summaryPath || adoptPaths.summaryPath || joinDisplayPath(rootPath, `${cleanName}学情分析汇总`);
      const agentPath = result?.agentPath || adoptPaths.agentPath || joinDisplayPath(rootPath, 'AGENT.md');
      const outputPath = result?.outputPath || adoptPaths.outputPath || joinDisplayPath(rootPath, '输出结果');
      if (!rootPath || !rawPath || !summaryPath) {
        setAdoptMessage('接管前需要确认知识库根目录、原始资料库和学情分析汇总目录。');
        return;
      }
      const student: Student = {
        ...draft,
        name: cleanName,
        id: `${Date.now()}-${cleanName}`,
        createdAt: today(),
        status: 'ready',
        schemaVersion: initSchemaVersion,
        agentTool: getAgentToolProfile(draft.agentTool).id,
        storageMode: 'app_private',
        knowledgeBaseMode: 'adopted',
        rootPath,
        rawPath,
        summaryPath,
        agentPath,
        outputPath,
        rootPathLabel: rootPath,
        agentBindingMode,
        agentName: agentNameDraft || `${cleanName} AI教育管家`,
        agentNote: agentNoteDraft,
        adoptedAt: new Date().toLocaleString('zh-CN'),
        pendingDigestCount: 0,
        submittedDigestCount: 0,
        processedDigestCount: 0,
        lastDigestAt: '',
        digestStatus: 'idle',
        digestMessage: '已接管已有知识库，等待上传资料。',
        memoryConfig: {
          unifiedMemoryPath: joinDisplayPath(rootPath, 'Agent记忆', 'UnifiedMemory.md'),
          lastMergedAt: '',
          sources: [],
        },
        soulConfig: {
          unifiedSoulPath: joinDisplayPath(rootPath, 'Agent设定', 'UnifiedSoul.md'),
          lastDistributedAt: '',
          sources: [],
        },
        templateProfile: {
          activeTemplate: templateCenter?.activeTemplate ?? 'system',
          customTemplatePath: templateCenter?.customPath ?? '',
        },
      };
      const next = [student, ...students];
      persist(next);
      setSelectedId(student.id);
      setActiveSection('qa');
      setDigestMessage(`已接管「${cleanName}」已有知识库。请确认 ${getAgentToolProfile(student.agentTool).name} 中的工作规则已更新。`);
      window.setTimeout(() => setDigestMessage(''), 5200);
      return;
    }
    const p = pathsFor(draft.name);
    const student: Student = {
      ...draft,
      name: p.cleanName,
      id: `${Date.now()}-${p.cleanName}`,
      createdAt: today(),
      status: 'ready',
      schemaVersion: initSchemaVersion,
      agentTool: getAgentToolProfile(draft.agentTool).id,
      storageMode: 'app_private',
      knowledgeBaseMode: 'standard',
      rootPath: p.root,
      rawPath: p.raw,
      summaryPath: p.summary,
      agentPath: p.agent,
      outputPath: p.output,
      agentBindingMode: agentBindingModeForTool(getAgentToolProfile(draft.agentTool).id),
      agentName: `${p.cleanName} AI教育管家`,
      rootPathLabel: p.root,
      pendingDigestCount: 0,
      submittedDigestCount: 0,
      processedDigestCount: 0,
      lastDigestAt: '',
      digestStatus: 'idle',
      digestMessage: '知识库已初始化，等待上传资料。',
      bundleExportedAt: exportedOnce ? new Date().toLocaleString('zh-CN') : undefined,
      memoryConfig: {
        unifiedMemoryPath: joinDisplayPath(p.root, 'Agent记忆', 'UnifiedMemory.md'),
        lastMergedAt: '',
        sources: [],
      },
      soulConfig: {
        unifiedSoulPath: joinDisplayPath(p.root, 'Agent设定', 'UnifiedSoul.md'),
        lastDistributedAt: '',
        sources: [],
      },
      templateProfile: {
        activeTemplate: templateCenter?.activeTemplate ?? 'system',
        customTemplatePath: templateCenter?.customPath ?? '',
      },
    };
    const initResult = bridge()?.initStudentWorkspace?.(p.cleanName, buildAgentMd(draft), buildIndexMd(draft), buildLogMd(draft));
    if (initResult) {
      try {
        const parsed = JSON.parse(initResult) as { rootPathLabel?: string; rootPath?: string; rawPath?: string; summaryPath?: string; agentPath?: string; outputPath?: string };
        if (parsed.rootPathLabel) {
          student.rootPathLabel = parsed.rootPathLabel;
          student.rootPath = parsed.rootPath || parsed.rootPathLabel;
          student.agentPath = parsed.agentPath || joinDisplayPath(parsed.rootPathLabel, 'AGENT.md');
          student.outputPath = parsed.outputPath || joinDisplayPath(parsed.rootPathLabel, '输出结果');
        }
        if (parsed.rawPath) student.rawPath = parsed.rawPath;
        if (parsed.summaryPath) student.summaryPath = parsed.summaryPath;
        const rootForAgentCenter = student.rootPath || p.root;
        student.memoryConfig = {
          ...(student.memoryConfig ?? { sources: [] }),
          unifiedMemoryPath: joinDisplayPath(rootForAgentCenter, 'Agent记忆', 'UnifiedMemory.md'),
        };
        student.soulConfig = {
          ...(student.soulConfig ?? { sources: [] }),
          unifiedSoulPath: joinDisplayPath(rootForAgentCenter, 'Agent设定', 'UnifiedSoul.md'),
        };
      } catch {
        // Keep the generated display path.
      }
    }
    const next = [student, ...students];
    persist(next);
    setSelectedId(student.id);
    setActiveSection('archive');
  };

  const copyPrompt = async () => {
    if (bridge()?.copyText) {
      bridge()?.copyText?.(selectedInitPrompt);
    } else {
      await navigator.clipboard.writeText(selectedInitPrompt);
    }
    setCopied(true);
    setCopiedOnce(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const copyFullPrompt = async () => {
    if (bridge()?.copyText) {
      bridge()?.copyText?.(prompt);
    } else {
      await navigator.clipboard.writeText(prompt);
    }
    setCopied(true);
    setCopiedOnce(true);
    setSelectedInitStep('full');
    window.setTimeout(() => setCopied(false), 1800);
  };

  const changeTheme = (value: ThemeName) => {
    setTheme(value);
    saveTheme(value);
  };

  const changeLanguage = (value: LanguageCode) => {
    setLanguage(value);
    saveLanguage(value);
  };

  const changeSelectedStudentTool = (toolId: AgentToolId) => {
    if (!selectedStudent) return;
    if (isWindows && !windowsLicenseActive) {
      setDigestMessage('未激活状态仅支持只读浏览，激活后可切换学生 Agent 工具。');
      window.setTimeout(() => setDigestMessage(''), 2600);
      return;
    }
    const tool = getAgentToolProfile(toolId);
    const next = students.map((student) =>
      student.id === selectedStudent.id
        ? {
            ...student,
            agentTool: tool.id,
            agentBindingMode: agentBindingModeForTool(tool.id),
          }
        : student,
    );
    persist(next);
    setDigestMessage(`已将「${selectedStudent.name}」的 Agent 工具切换为 ${tool.name}。`);
    window.setTimeout(() => setDigestMessage(''), 2600);
  };

  const saveSelectedStudentProfile = () => {
    if (!selectedStudent || !studentEditDraft) return;
    if (isWindows && !windowsLicenseActive) {
      setDigestMessage('未激活状态仅支持只读浏览，激活后可保存学生资料。');
      window.setTimeout(() => setDigestMessage(''), 2600);
      return;
    }
    const cleanName = sanitizeName(studentEditDraft.name);
    const next = students.map((student) =>
      student.id === selectedStudent.id
        ? {
            ...student,
            ...studentEditDraft,
            name: cleanName,
            agentTool: getAgentToolProfile(studentEditDraft.agentTool).id,
            digestTime: studentEditDraft.digestTime || '21:30',
            rootPathLabel: student.rootPathLabel,
          }
        : student,
    );
    persist(next);
    setDigestMessage(`已保存「${cleanName}」的学生资料。`);
    window.setTimeout(() => setDigestMessage(''), 2600);
  };

  const updateArchiveKeyword = (key: keyof ArchiveKeywordConfig, value: string) => {
    const next = { ...archiveKeywords, [key]: value };
    setArchiveKeywords(next);
    saveArchiveKeywords(next);
  };

  const resetArchiveKeywords = () => {
    setArchiveKeywords(defaultArchiveKeywords);
    saveArchiveKeywords(defaultArchiveKeywords);
    setMarkdownMessage('已恢复默认档案分类关键词。');
  };

  const updateSelectedStudentRemote = (patch: Pick<Student, 'remoteChannel'> | Partial<Pick<Student, 'remoteContact' | 'remoteNote' | 'remoteBindingStatus' | 'remoteBoundAt'>>) => {
    if (!selectedStudent) return;
    const nextPatch = { ...patch };
    if (patch.remoteBindingStatus === 'bound' && !selectedStudent.remoteBoundAt && !patch.remoteBoundAt) {
      nextPatch.remoteBoundAt = new Date().toLocaleString('zh-CN');
    }
    if (patch.remoteBindingStatus && patch.remoteBindingStatus !== 'bound') {
      nextPatch.remoteBoundAt = '';
    }
    const next = students.map((student) =>
      student.id === selectedStudent.id
        ? {
            ...student,
            ...nextPatch,
          }
        : student,
    );
    persist(next);
    setDigestMessage(`已保存「${selectedStudent.name}」的联系配置。`);
    window.setTimeout(() => setDigestMessage(''), 1800);
  };

  const copyText = async (text: string, toastText?: string) => {
    if (bridge()?.copyText) {
      bridge()?.copyText?.(text);
    } else {
      await navigator.clipboard.writeText(text);
    }
    if (toastText) {
      setDigestMessage(toastText);
      window.setTimeout(() => setDigestMessage(''), 3000);
    }
  };

  const exportBundle = () => {
    const p = pathsFor(draft.name);
    const filename = `${p.cleanName}-AI教育管家初始化包.json`;
    const content = JSON.stringify(bundle, null, 2);
    const result = bridge()?.exportTextFile?.(filename, content);
    if (!result) fallbackDownload(filename, content);
    setExported(true);
    setExportedOnce(true);
    window.setTimeout(() => setExported(false), 2200);
  };

  const copyDigestCommand = async (student: Student) => {
    const stamp = new Date().toLocaleString('zh-CN');
    const adapter = getAgentToolAdapter(student.agentTool);
    await copyText(adapter.buildDigestCommand(student), `已复制资料消化命令，${adapter.profile.digestTargetLabel}。`);
    const next = students.map((item) => (item.id === student.id ? { ...item, lastDigestCommandAt: stamp } : item));
    persist(next);
  };

  const markDigestSubmitted = (student: Student) => {
    const stamp = new Date().toLocaleString('zh-CN');
    const raw = bridge()?.markStudentDigestSubmitted?.(student.id);
    if (raw) {
      try {
        const result = JSON.parse(raw) as { ok?: boolean; updated?: number; status?: HostServiceStatus; records?: HostUploadRecord[]; message?: string };
        if (result.status) setHostServiceStatus(result.status);
        if (Array.isArray(result.records)) setHostUploadRecords(result.records);
        refreshHostTimeline();
        if (!result.ok) {
          setDigestMessage(result.message || '主机上传记录标记失败。');
          window.setTimeout(() => setDigestMessage(''), 3200);
          return;
        }
      } catch {
        setDigestMessage('主机上传记录标记结果解析失败。');
        window.setTimeout(() => setDigestMessage(''), 3200);
      }
    }
    const next = students.map((item) =>
      item.id === student.id
        ? {
            ...item,
            pendingDigestCount: 0,
            lastDigestCommandAt: stamp,
          }
        : item,
    );
    persist(next);
    setDigestMessage(`已标记「${student.name}」资料已提交消化。若 ${getAgentToolProfile(student.agentTool).name} 处理完成，稍后刷新档案即可查看结果。`);
    window.setTimeout(() => setDigestMessage(''), 3200);
  };

  const syncDigestResult = (student: Student) => {
    const raw = bridge()?.syncStudentDigestResult?.(student.id);
    if (!raw) {
      setDigestMessage('当前环境不支持消化结果同步。');
      window.setTimeout(() => setDigestMessage(''), 3200);
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; updated?: number; state?: { message?: string }; status?: HostServiceStatus; records?: HostUploadRecord[]; message?: string };
      if (result.status) setHostServiceStatus(result.status);
      if (Array.isArray(result.records)) setHostUploadRecords(result.records);
      refreshHostTimeline();
      setDigestMessage(result.ok ? result.state?.message || `已同步消化结果，更新 ${result.updated ?? 0} 条资料状态。` : result.message || '同步消化结果失败。');
    } catch {
      setDigestMessage('同步消化结果解析失败。');
    }
    window.setTimeout(() => setDigestMessage(''), 3600);
  };

  const copyConsultCommand = async () => {
    const value = selectedStudent ? getAgentToolAdapter(selectedStudent.agentTool).buildConsultCommand(selectedStudent) : '/咨询，我想咨询';
    await copyText(value, '已复制咨询提示。');
  };

  const saveCurrentTemplates = () => {
    const stepPrompt = (id: InitStepId) => customStepPrompts[id] ?? initSteps.find((step) => step.id === id)?.prompt ?? '';
    const templateDraft = templateKeys.reduce((acc, key) => {
      if (key === 'AGENT.md') acc[key] = templateFromGenerated(buildAgentMd(effectiveDraft), effectiveDraft);
      else if (key === 'Soul.md') acc[key] = templateFromGenerated(buildSoulMd(effectiveDraft), effectiveDraft);
      else if (key === 'Memory.md') acc[key] = templateFromGenerated(buildMemoryMd(effectiveDraft), effectiveDraft);
      else if (key === 'digest-prompt.md') acc[key] = templateFromGenerated(buildDigestCommand(effectiveDraft), effectiveDraft);
      else if (key === 'consult-prompt.md') acc[key] = activeTemplateFiles[key] || '/咨询，我想咨询';
      else acc[key] = templateFromGenerated(stepPrompt(key === 'init-step-1.md' ? 'folder' : 'agent'), effectiveDraft);
      return acc;
    }, {} as TemplateFiles);
    const raw = bridge()?.saveCustomTemplates?.(JSON.stringify(templateDraft));
    if (!raw) {
      setTemplateMessage('当前环境不支持保存模板。');
      return;
    }
    try {
      const result = JSON.parse(raw) as TemplateCenterState;
      setTemplateMessage(result.message || (result.ok ? '已保存模板。' : '保存模板失败。'));
      refreshTemplateCenter();
    } catch {
      setTemplateMessage('保存模板结果解析失败。');
    }
  };

  const restoreDefaultTemplates = () => {
    const raw = bridge()?.restoreSystemTemplates?.(JSON.stringify(systemTemplateFiles));
    if (!raw) {
      setTemplateMessage('当前环境不支持恢复默认模板。');
      return;
    }
    try {
      const result = JSON.parse(raw) as TemplateCenterState;
      setCustomStepPrompts({});
      setTemplateMessage(result.message || (result.ok ? '已恢复默认模板。' : '恢复默认模板失败。'));
      refreshTemplateCenter();
    } catch {
      setTemplateMessage('恢复默认模板结果解析失败。');
    }
  };

  const saveMemorySource = () => {
    if (!selectedStudent) return;
    const raw = bridge()?.saveAgentMemorySource?.(selectedStudent.id, memorySourceTool, memorySourceText, 'paste');
    if (!raw) {
      setAgentCenterMessage('当前环境不支持保存来源 Memory。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; message?: string };
      setAgentCenterMessage(result.message || (result.ok ? '已保存来源 Memory。' : '保存来源 Memory 失败。'));
      refreshAgentCenter();
    } catch {
      setAgentCenterMessage('保存来源 Memory 结果解析失败。');
    }
  };

  const mergeMemory = () => {
    if (!selectedStudent) return;
    setAgentCenterMessage('正在合并来源 Memory...');
    const raw = bridge()?.mergeAgentMemory?.(selectedStudent.id);
    if (!raw) {
      setAgentCenterMessage('当前环境不支持合并记忆。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; unifiedMemory?: string; message?: string };
      if (typeof result.unifiedMemory === 'string') setUnifiedMemoryText(result.unifiedMemory);
      setAgentCenterMessage(result.message || (result.ok ? '已合并统一记忆。' : '合并统一记忆失败。'));
      refreshAgentCenter();
    } catch {
      setAgentCenterMessage('合并记忆结果解析失败。');
    }
  };

  const saveUnifiedMemoryText = () => {
    if (!selectedStudent) return;
    const raw = bridge()?.saveUnifiedMemory?.(selectedStudent.id, unifiedMemoryText);
    if (!raw) {
      setAgentCenterMessage('当前环境不支持保存统一记忆。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; message?: string };
      setAgentCenterMessage(result.message || (result.ok ? '已保存统一记忆。' : '保存统一记忆失败。'));
      refreshAgentCenter();
    } catch {
      setAgentCenterMessage('保存统一记忆结果解析失败。');
    }
  };

  const saveSoulSource = () => {
    if (!selectedStudent) return;
    const raw = bridge()?.saveAgentSoulSource?.(selectedStudent.id, soulSourceTool, soulSourceText);
    if (!raw) {
      setAgentCenterMessage('当前环境不支持保存来源 Soul。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; message?: string };
      setAgentCenterMessage(result.message || (result.ok ? '已保存来源 Soul。' : '保存来源 Soul 失败。'));
      refreshAgentCenter();
    } catch {
      setAgentCenterMessage('保存来源 Soul 结果解析失败。');
    }
  };

  const saveUnifiedSoulText = () => {
    if (!selectedStudent) return;
    const raw = bridge()?.saveUnifiedSoul?.(selectedStudent.id, unifiedSoulText);
    if (!raw) {
      setAgentCenterMessage('当前环境不支持保存统一 Soul。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; message?: string };
      setAgentCenterMessage(result.message || (result.ok ? '已保存统一 Soul。' : '保存统一 Soul 失败。'));
      refreshAgentCenter();
    } catch {
      setAgentCenterMessage('保存统一 Soul 结果解析失败。');
    }
  };

  const compareSoulSource = () => {
    if (!selectedStudent) return;
    const raw = bridge()?.compareAgentSoulSource?.(selectedStudent.id, soulSourceTool);
    if (!raw) {
      setAgentCenterMessage('当前环境不支持 Soul 差异对比。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; onlyUnified?: string[]; onlySource?: string[]; message?: string };
      setSoulDiff(result);
      setAgentCenterMessage(result.message || (result.ok ? '已完成差异对比。' : '差异对比失败。'));
    } catch {
      setAgentCenterMessage('Soul 差异结果解析失败。');
    }
  };

  const scanAgentKnowledgeFiles = (kind?: AgentKnowledgeKind) => {
    if (!selectedStudent) return;
    const raw = bridge()?.scanAgentKnowledgeFiles?.(selectedStudent.id);
    if (!raw) {
      setAgentScanMessage('当前环境不支持扫描 Agent 文件。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; candidates?: AgentKnowledgeCandidate[]; message?: string };
      setAgentScanCandidates(Array.isArray(result.candidates) ? result.candidates : []);
      const kindLabel = kind === 'soul' ? '人设' : kind === 'memory' ? '记忆' : '记忆/人设';
      setAgentScanMessage(result.message || (result.ok ? `已完成 Agent ${kindLabel}文件扫描。` : '扫描 Agent 文件失败。'));
    } catch {
      setAgentScanMessage('扫描 Agent 文件结果解析失败。');
    }
  };

  const importAgentCandidate = (candidate: AgentKnowledgeCandidate) => {
    if (!selectedStudent) return;
    const raw = bridge()?.importAgentKnowledgeFile?.(selectedStudent.id, candidate.path, candidate.tool, candidate.kind);
    if (!raw) {
      setAgentCenterMessage('当前环境不支持导入 Agent 文件。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; message?: string };
      const kindLabel =
        candidate.kind === 'soul' ? 'Soul'
          : candidate.kind === 'rule' ? '规则文件'
          : candidate.kind === 'conversation' ? '对话历史'
          : 'Memory';
      setAgentCenterMessage(result.message || (result.ok ? `已导入来源 ${kindLabel}。` : `导入来源 ${kindLabel} 失败。`));
      if (result.ok) {
        if (candidate.kind === 'memory') {
          setMemorySourceTool(candidate.tool);
          setMemorySourceText(candidate.preview || '');
        } else if (candidate.kind === 'soul') {
          setSoulSourceTool(candidate.tool);
          setSoulSourceText(candidate.preview || '');
        } else if (candidate.kind === 'rule') {
          refreshAgentRules(selectedStudent.id);
        } else if (candidate.kind === 'conversation') {
          refreshConversationCenter(selectedStudent.id);
        }
      }
      refreshAgentCenter();
      refreshSourceRegistry();
    } catch {
      setAgentCenterMessage('导入 Agent 文件结果解析失败。');
    }
  };

  const candidateKey = (candidate: AgentKnowledgeCandidate) => `${candidate.kind}::${candidate.tool}::${candidate.path}`;

  const toggleCandidateSelection = (candidate: AgentKnowledgeCandidate) => {
    const key = candidateKey(candidate);
    setSelectedCandidateKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  };

  const buildCandidateImportReview = (candidates: AgentKnowledgeCandidate[]): CandidateImportReview => {
    const existingRecords = sourceRegistry?.records ?? [];
    const duplicateCount = candidates.filter((candidate) =>
      existingRecords.some((record) => record.sourcePath === candidate.path || record.targetPath === candidate.path)
    ).length;
    const lowScoreCount = candidates.filter((candidate) => Number(candidate.score || 0) < 50).length;
    const sameTargetNames = candidates
      .map((candidate) => candidate.name)
      .filter((name, index, array) => array.indexOf(name) !== index);
    const warnings = [
      duplicateCount ? `${duplicateCount} 个候选疑似已经导入过` : '',
      lowScoreCount ? `${lowScoreCount} 个候选置信度低于 50` : '',
      sameTargetNames.length ? `存在同名候选：${Array.from(new Set(sameTargetNames)).slice(0, 5).join('、')}` : '',
    ].filter(Boolean);
    return { candidates, duplicateCount, lowScoreCount, warnings };
  };

  const reviewSelectedCandidates = () => {
    const selected = agentScanCandidates.filter((candidate) => selectedCandidateKeys.includes(candidateKey(candidate)));
    if (!selected.length) {
      setAgentScanMessage('请先勾选需要导入的候选。');
      setCandidateImportReview(null);
      return null;
    }
    const review = buildCandidateImportReview(selected);
    setCandidateImportReview(review);
    setAgentScanMessage(review.warnings.length
      ? `请确认后导入：${review.warnings.join('；')}。`
      : `已选择 ${selected.length} 个候选，可以确认导入。`);
    return review;
  };

  const importSelectedCandidates = async (confirmed = false) => {
    const selected = agentScanCandidates.filter((candidate) => selectedCandidateKeys.includes(candidateKey(candidate)));
    if (!selected.length) {
      setAgentScanMessage('请先勾选需要导入的候选。');
      setCandidateImportReview(null);
      return;
    }
    if (!confirmed) {
      const review = reviewSelectedCandidates();
      if (review) setAgentScanMessage('已生成导入预览，请检查冲突提示后点击“确认导入”。');
      return;
    }
    for (const candidate of selected) importAgentCandidate(candidate);
    setSelectedCandidateKeys([]);
    setCandidateImportReview(null);
    setAgentScanMessage(`已提交导入 ${selected.length} 个候选。`);
  };

  const copyAiAgentScanPrompt = async (kind: AgentKnowledgeKind | 'all') => {
    if (!selectedStudent) return;
    const promptText = aiScanTool === 'all'
      ? buildAiAgentScanPrompt(selectedStudent, kind, 'all')
      : getAgentToolAdapter(aiScanTool).buildScanPrompt(selectedStudent, kind);
    await copyText(promptText, `已复制 AI ${kind === 'soul' ? '人设' : kind === 'rule' ? '规则文件' : kind === 'conversation' ? '对话历史' : '综合'}扫描指令。`);
  };

  const parseAiAgentScanResult = (fallbackKind: AgentKnowledgeKind | 'all') => {
    if (!aiScanResultText.trim()) {
      setAgentScanMessage('请先粘贴 AI 扫描结果 JSON。');
      return;
    }
    try {
      const parsed = parseLooseJson(aiScanResultText);
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.candidates)
          ? parsed.candidates
          : Array.isArray(parsed?.results)
            ? parsed.results
            : Array.isArray(parsed?.files)
              ? parsed.files
              : [];
      const candidates = list
        .map((item: unknown) => normalizeAiScanCandidate((item || {}) as Record<string, unknown>, fallbackKind === 'all' ? undefined : fallbackKind))
        .filter(Boolean) as AgentKnowledgeCandidate[];
      if (!candidates.length) {
        setAgentScanMessage('未从 AI 扫描结果中解析到有效候选。请确认 JSON 中包含 candidates 数组和 path/kind/tool 字段。');
        return;
      }
      const next = [...candidates, ...agentScanCandidates]
        .filter((candidate, index, array) => array.findIndex((item) => item.path === candidate.path && item.kind === candidate.kind) === index)
        .sort((a, b) => b.score - a.score);
      setAgentScanCandidates(next);
      setAgentScanMessage(`已导入 AI 扫描结果：${candidates.length} 个候选。请在候选列表中逐项确认后导入。`);
    } catch (error) {
      setAgentScanMessage(`AI 扫描结果解析失败：${error instanceof Error ? error.message : 'JSON 格式不正确'}`);
    }
  };

  const copyStudentProfileUpdatePrompt = async (student: Student) => {
    const lines = [
      `/更新学生资料 ${student.name}`,
      '',
      `姓名：${student.name}`,
      `年级：${student.grade || '待补充'}`,
      `学校：${student.school || '待补充'}`,
      `当前目标：${student.goal || '待补充'}`,
      '',
      '请根据以上最新资料，更新该学生的教育管家背景、学情理解和后续资料消化关注点。不要删除已有学情档案，只在后续分析中采用最新学生信息。',
    ];
    await copyText(lines.join('\n'), '已复制学生资料变更提示。');
  };

  const copyStudentFullInitPrompt = async (student: Student) => {
    const adapter = getAgentToolAdapter(student.agentTool);
    await copyText(adapter.buildInitPrompt(student), `已复制 ${adapter.profile.name} 完整初始化指令。`);
  };

  const copyStudentSoul = async (student: Student) => {
    await copyText(buildSoulMd(student), '已复制角色设置内容。');
  };

  const copyStudentMemory = async (student: Student) => {
    await copyText(buildMemoryMd(student), '已复制长期记忆内容。');
  };

  const copyStudentWorkRule = async (student: Student) => {
    const p = pathsForStudent(student);
    await copyText(
      `该 Agent 的工作协议使用：${p.agent}\n后续所有学习资料消化都围绕该学生知识库执行。`,
      '已复制 Agent 工作规则。',
    );
  };

  const openExternal = (app: AgentToolId | 'obsidian' | 'tailscale') => {
    const ok = bridge()?.openApp?.(app);
    if (app === 'qclaw') setQclawOpened((value) => value || Boolean(ok));
    if (app === 'marvis') setMarvisOpened((value) => value || Boolean(ok));
    if (app === 'hohu') setHohuOpened((value) => value || Boolean(ok));
    if (app === 'openclaw') setOpenclawOpened((value) => value || Boolean(ok));
    if (app === 'ima.copilot') setImaCopilotOpened((value) => value || Boolean(ok));
    if (app === 'workbuddy') setWorkbuddyOpened((value) => value || Boolean(ok));
    if (app === 'codex') setCodexOpened((value) => value || Boolean(ok));
    if (app === 'claude-code') setClaudeCodeOpened((value) => value || Boolean(ok));
    if (app === 'obsidian') setObsidianOpened((value) => value || Boolean(ok));
    const urls: Record<AgentToolId | 'obsidian' | 'tailscale', string> = {
      qclaw: 'qclaw://',
      marvis: 'marvis://',
      hohu: 'https://hohu.ai/',
      openclaw: 'https://openclaw.ai/',
      'ima.copilot': 'https://ima.qq.com/',
      workbuddy: 'https://www.workbuddy.ai/',
      codex: 'https://chatgpt.com/codex',
      'claude-code': 'https://www.anthropic.com/claude-code',
      chatgpt: 'https://chatgpt.com/',
      claude: 'https://claude.ai/',
      doubao: 'https://www.doubao.com/',
      coze: 'https://www.coze.cn/',
      fastgpt: 'https://fastgpt.in/',
      obsidian: 'obsidian://open',
      tailscale: 'https://tailscale.com/download/windows',
    };
    if (!ok && urls[app]) {
      bridge()?.openExternalUrl?.(urls[app]) || window.open(urls[app], '_blank');
    }
  };

  const openStudentRoot = (student = selectedStudent) => {
    if (!student) return;
    if (isWindows && !windowsLicenseActive) {
      setDigestMessage('未激活状态仅支持控制台内只读浏览，激活后可打开本机知识库目录。');
      window.setTimeout(() => setDigestMessage(''), 2600);
      return;
    }
    const raw = bridge()?.openStudentRootDir?.(student.id);
    if (!raw) {
      window.open(student.rootPath || selectedStudentPaths.root, '_blank');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; message?: string };
      setDigestMessage(result.message || (result.ok ? '已打开学生知识库目录。' : '打开学生知识库目录失败。'));
    } catch {
      setDigestMessage('打开学生知识库目录结果解析失败。');
    }
  };

  const importFilesForStudent = (student: Student) => {
    setPendingImportStudentId(student.id);
    const ok = bridge()?.importFiles?.(student.id);
    if (typeof ok === 'string') {
      try {
        const result = JSON.parse(ok) as { ok?: boolean; message?: string };
        setImportMessage(result.message || (result.ok ? '已导入资料。' : '导入资料失败。'));
      } catch {
        setImportMessage('导入资料结果解析失败。');
      }
      window.setTimeout(() => setImportMessage(''), 4200);
      return;
    }
    if (!ok) {
      setImportMessage('当前环境不支持原生文件导入，请在 Android APK 中使用。');
      window.setTimeout(() => setImportMessage(''), 3600);
    }
  };

  const importImagesForStudent = (student: Student) => {
    setPendingImportStudentId(student.id);
    const ok = bridge()?.importImages?.(student.name);
    if (!ok) {
      setInboxMessage('当前环境无法打开图片/截图选择器，请尝试系统分享导入。');
      window.setTimeout(() => setInboxMessage(''), 3600);
    }
  };

  const takePhotoForStudent = (student: Student) => {
    setPendingImportStudentId(student.id);
    const ok = bridge()?.takePhoto?.(student.name);
    if (!ok) {
      setInboxMessage('当前环境无法打开相机，请先拍照保存后使用“导入图片”或“扫描 Downloads 最近文件”。');
      window.setTimeout(() => setInboxMessage(''), 4200);
    }
  };

  const scanDownloadsRecent = () => {
    const raw = bridge()?.scanDownloads?.();
    if (!raw) {
      setDownloadsMessage('当前环境不支持扫描 Downloads，请在 Android APK 中使用。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; files?: DownloadCandidate[]; message?: string };
      if (!result.ok) {
        setDownloadFiles([]);
        setSelectedDownloadPaths([]);
        setDownloadsMessage(result.message || '扫描 Downloads 失败。');
        return;
      }
      const files = result.files ?? [];
      setDownloadFiles(files);
      setSelectedDownloadPaths([]);
      setDownloadsMessage(files.length ? `已扫描到 ${files.length} 个最近资料文件。` : 'Downloads 中暂未发现可导入资料文件。');
    } catch {
      setDownloadsMessage('Downloads 扫描结果解析失败。');
    }
  };

  const toggleDownloadFile = (path: string) => {
    setSelectedDownloadPaths((current) => (current.includes(path) ? current.filter((item) => item !== path) : [...current, path]));
  };

  const importSelectedDownloads = (student: Student) => {
    if (selectedDownloadPaths.length === 0) {
      setDownloadsMessage('请先勾选要导入的 Downloads 文件。');
      return;
    }
    const raw = bridge()?.importDownloadFiles?.(student.name, JSON.stringify(selectedDownloadPaths));
    if (!raw) {
      setDownloadsMessage('当前环境不支持从 Downloads 导入，请在 Android APK 中使用。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; imported?: number; message?: string };
      setDownloadsMessage(result.message || (result.ok ? '已导入 Downloads 文件。' : '导入 Downloads 文件失败。'));
      if (result.ok && Number(result.imported ?? 0) > 0) {
        const imported = Number(result.imported ?? 0);
        const stamp = new Date().toLocaleString('zh-CN');
        const next = students.map((item) =>
          item.id === student.id
            ? {
                ...item,
                lastImportAt: stamp,
                pendingDigestCount: (item.pendingDigestCount ?? 0) + imported,
              }
            : item,
        );
        persist(next);
        setSelectedDownloadPaths([]);
        scanDownloadsRecent();
      }
    } catch {
      setDownloadsMessage('Downloads 导入结果解析失败。');
    }
  };

  const updateStudentMaterialSources = (studentId: string, updater: (sources: MaterialSource[]) => MaterialSource[]) => {
    const next = students.map((student) =>
      student.id === studentId
        ? { ...student, materialSources: updater(student.materialSources ?? []) }
        : student,
    );
    persist(next);
  };

  const addMaterialSourceDir = (student: Student) => {
    const raw = bridge()?.pickMaterialSourceDir?.();
    if (!raw) {
      setMaterialSourceMessage('当前环境不支持选择资料来源目录。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; source?: MaterialSource; message?: string };
      if (!result.ok || !result.source) {
        setMaterialSourceMessage(result.message || '未添加资料来源目录。');
        return;
      }
      updateStudentMaterialSources(student.id, (sources) => {
        const exists = sources.some((source) => source.path === result.source?.path);
        return exists ? sources : [...sources, result.source as MaterialSource];
      });
      setMaterialSourceMessage(`已添加资料来源目录：${result.source.name}`);
    } catch {
      setMaterialSourceMessage('资料来源目录结果解析失败。');
    }
  };

  const toggleMaterialSource = (student: Student, sourceId: string) => {
    updateStudentMaterialSources(student.id, (sources) =>
      sources.map((source) => (source.id === sourceId ? { ...source, enabled: !source.enabled } : source)),
    );
  };

  const removeMaterialSource = (student: Student, sourceId: string) => {
    updateStudentMaterialSources(student.id, (sources) => sources.filter((source) => source.id !== sourceId));
    setMaterialSourceFiles((files) => files.filter((file) => file.sourceId !== sourceId));
    setSelectedMaterialSourcePaths((paths) => paths.filter((filePath) => !materialSourceFiles.some((file) => file.sourceId === sourceId && file.path === filePath)));
  };

  const refreshMaterialImportRecords = (student: Student) => {
    const raw = bridge()?.getMaterialImportRecords?.(student.id);
    if (!raw) return;
    try {
      const result = JSON.parse(raw) as { ok?: boolean; records?: MaterialImportRecord[] };
      if (result.ok && Array.isArray(result.records)) setMaterialImportRecords(result.records);
    } catch {
      // 导入记录只是辅助信息，解析失败不打断主流程。
    }
  };

  const scanMaterialSourcesForStudent = (student: Student) => {
    const sources = student.materialSources ?? [];
    const raw = bridge()?.scanMaterialSources?.(student.id, JSON.stringify(sources));
    if (!raw) {
      setMaterialSourceMessage('当前环境不支持扫描资料来源目录。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; files?: MaterialSourceCandidate[]; scannedAt?: string; message?: string };
      if (!result.ok) {
        setMaterialSourceFiles([]);
        setSelectedMaterialSourcePaths([]);
        setMaterialSourceMessage(result.message || '扫描资料来源目录失败。');
        return;
      }
      const files = result.files ?? [];
      setMaterialSourceFiles(files);
      setSelectedMaterialSourcePaths([]);
      setMaterialSourceMessage(result.message || (files.length ? `已扫描到 ${files.length} 个资料文件。` : '暂无可导入资料。'));
      if (result.scannedAt) {
        updateStudentMaterialSources(student.id, (current) =>
          current.map((source) => ({ ...source, lastScannedAt: source.enabled ? result.scannedAt : source.lastScannedAt })),
        );
      }
      refreshMaterialImportRecords(student);
    } catch {
      setMaterialSourceMessage('资料来源扫描结果解析失败。');
    }
  };

  const toggleMaterialSourceFile = (path: string) => {
    setSelectedMaterialSourcePaths((current) => (current.includes(path) ? current.filter((item) => item !== path) : [...current, path]));
  };

  const importSelectedMaterialSourceFiles = (student: Student) => {
    if (selectedMaterialSourcePaths.length === 0) {
      setMaterialSourceMessage('请先勾选要导入的来源文件。');
      return;
    }
    const raw = bridge()?.importMaterialSourceFiles?.(student.id, JSON.stringify(selectedMaterialSourcePaths));
    if (!raw) {
      setMaterialSourceMessage('当前环境不支持导入资料来源文件。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; imported?: number; skipped?: number; failed?: number; message?: string };
      setMaterialSourceMessage(result.message || (result.ok ? '已导入资料来源文件。' : '导入资料来源文件失败。'));
      if (result.ok && Number(result.imported ?? 0) > 0) {
        recordImportedFiles(student.id, Number(result.imported ?? 0));
        setSelectedMaterialSourcePaths([]);
        refreshMaterialImportRecords(student);
        scanMaterialSourcesForStudent(student);
      }
    } catch {
      setMaterialSourceMessage('资料来源导入结果解析失败。');
    }
  };

  const refreshAssets = () => {
    const raw = bridge()?.getAssetIndex?.();
    if (!raw) {
      setAssetMessage('当前环境不支持文件资产中心。');
      return;
    }
    try {
      const result = JSON.parse(raw) as AssetIndexState;
      setAssetIndex({ ...result, assets: result.assets ?? [] });
      setAssetMessage(result.message || `已读取 ${result.assets?.length ?? 0} 个资产。`);
    } catch {
      setAssetMessage('资产索引解析失败。');
    }
  };

  const rebuildAssets = () => {
    const raw = bridge()?.rebuildAssetIndex?.();
    if (!raw) {
      setAssetMessage('当前环境不支持补建资产索引。');
      return;
    }
    try {
      const result = JSON.parse(raw) as AssetIndexState;
      setAssetIndex({ ...result, assets: result.assets ?? [] });
      setAssetMessage(result.message || '资产索引已补建。');
    } catch {
      setAssetMessage('补建资产索引结果解析失败。');
    }
  };

  const refreshProjects = () => {
    const raw = bridge()?.getProjects?.();
    if (!raw) {
      setProjectMessage('当前环境不支持学习项目管理。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; projects?: LearningProject[]; message?: string };
      if (!result.ok) {
        setProjectMessage(result.message || '读取学习项目失败。');
        return;
      }
      const list = result.projects ?? [];
      setProjects(list);
      if (!selectedProjectId && list[0]) setSelectedProjectId(list[0].id);
      setProjectMessage(result.message || `已读取 ${list.length} 个学习项目。`);
    } catch {
      setProjectMessage('学习项目数据解析失败。');
    }
  };

  const createLearningProject = () => {
    if (!projectDraft.name.trim()) {
      setProjectMessage('请先填写项目名称。');
      return;
    }
    const raw = bridge()?.createProject?.(JSON.stringify(projectDraft));
    if (!raw) {
      setProjectMessage('当前环境不支持创建学习项目。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; project?: LearningProject; projects?: LearningProject[]; message?: string };
      setProjectMessage(result.message || (result.ok ? '学习项目已创建。' : '创建学习项目失败。'));
      if (result.ok) {
        const next = result.projects ?? (result.project ? [result.project, ...projects] : projects);
        setProjects(next);
        if (result.project) setSelectedProjectId(result.project.id);
        setProjectDraft({ name: '', type: '学习项目', studentIds: [] });
      }
    } catch {
      setProjectMessage('创建学习项目结果解析失败。');
    }
  };

  const importSelectedAssetsToProject = () => {
    if (!selectedProjectId) {
      setProjectMessage('请先选择学习项目。');
      return;
    }
    if (!selectedProjectAssetIds.length) {
      setProjectMessage('请先勾选要导入项目知识空间的资产。');
      return;
    }
    const raw = bridge()?.importProjectAssets?.(selectedProjectId, JSON.stringify(selectedProjectAssetIds));
    if (!raw) {
      setProjectMessage('当前环境不支持项目资料导入。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; imported?: number; skipped?: number; project?: LearningProject; message?: string };
      setProjectMessage(result.message || (result.ok ? '已导入项目资料。' : '项目资料导入失败。'));
      if (result.project) setProjects((current) => current.map((item) => (item.id === result.project?.id ? result.project : item)));
      if (result.ok) {
        setSelectedProjectAssetIds([]);
        refreshAssets();
      }
    } catch {
      setProjectMessage('项目资料导入结果解析失败。');
    }
  };

  const importFilesToProjectStaging = () => {
    if (!selectedProjectId) {
      setProjectMessage('请先选择学习项目。');
      return;
    }
    const raw = bridge()?.importProjectStagingFiles?.(selectedProjectId);
    if (!raw) {
      setProjectMessage('当前环境不支持项目研究暂存导入。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; imported?: number; project?: LearningProject; projects?: LearningProject[]; message?: string };
      if (Array.isArray(result.projects)) setProjects(result.projects);
      if (result.project) setSelectedProjectId(result.project.id);
      setProjectMessage(result.message || (result.ok ? '已导入研究暂存层。' : '导入研究暂存失败。'));
      if (result.ok) setSelectedProjectStagingIds([]);
    } catch {
      setProjectMessage('研究暂存导入结果解析失败。');
    }
  };

  const updateSelectedProjectStagingStatus = (status: ProjectStagingStatus) => {
    if (!selectedProjectId) {
      setProjectMessage('请先选择学习项目。');
      return;
    }
    if (!selectedProjectStagingIds.length) {
      setProjectMessage('请先选择暂存资料。');
      return;
    }
    const raw = bridge()?.updateProjectStagingStatus?.(selectedProjectId, JSON.stringify(selectedProjectStagingIds), status);
    if (!raw) {
      setProjectMessage('当前环境不支持研究暂存状态更新。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; project?: LearningProject; projects?: LearningProject[]; message?: string };
      if (Array.isArray(result.projects)) setProjects(result.projects);
      if (result.project) setSelectedProjectId(result.project.id);
      setProjectMessage(result.message || (result.ok ? '暂存资料状态已更新。' : '暂存资料状态更新失败。'));
    } catch {
      setProjectMessage('暂存资料状态更新结果解析失败。');
    }
  };

  const promoteSelectedProjectStagingItems = () => {
    if (!selectedProjectId) {
      setProjectMessage('请先选择学习项目。');
      return;
    }
    if (!selectedProjectStagingIds.length) {
      setProjectMessage('请先选择要晋升的暂存资料。');
      return;
    }
    const raw = bridge()?.promoteProjectStagingItems?.(selectedProjectId, JSON.stringify(selectedProjectStagingIds));
    if (!raw) {
      setProjectMessage('当前环境不支持研究暂存晋升。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; promoted?: number; skipped?: number; project?: LearningProject; projects?: LearningProject[]; message?: string };
      if (Array.isArray(result.projects)) setProjects(result.projects);
      if (result.project) setSelectedProjectId(result.project.id);
      setProjectMessage(result.message || (result.ok ? '暂存资料已晋升。' : '暂存资料晋升失败。'));
      if (result.ok) {
        setSelectedProjectStagingIds([]);
        refreshAssets();
      }
    } catch {
      setProjectMessage('暂存资料晋升结果解析失败。');
    }
  };

  const copyProjectStagingAiScreeningPrompt = () => {
    if (!selectedProject) {
      setProjectMessage('请先选择学习项目。');
      return;
    }
    if (!projectStagingItems.length) {
      setProjectMessage('当前项目没有研究暂存资料。');
      return;
    }
    const items = projectStagingItems.map((item) => ({
      id: item.id,
      filename: item.filename,
      path: item.path,
      sourcePath: item.sourcePath,
      sha1: item.sha1,
      type: item.type,
      size: item.size,
      currentStatus: item.status,
    }));
    const prompt = `请对学习项目「${selectedProject.name}」的研究暂存资料进行初筛。

目标：
1. 判断哪些资料值得进入正式项目分析范围。
2. 标记低价值、重复、无关、临时资料。
3. 给出简洁理由，方便教育管家控制台导入。

请只返回 JSON，不要输出解释文字。格式如下：

{
  "projectName": "${selectedProject.name}",
  "recommendations": [
    {
      "id": "暂存资料 id",
      "filename": "文件名",
      "action": "select | screen | discard | analyzed",
      "status": "selected | screened | discarded | analyzed",
      "score": 0,
      "reason": "为什么这样处理"
    }
  ]
}

状态含义：
- selected：建议选入项目资料分析范围，后续可晋升为正式资产。
- screened：保留候选，但暂不进入分析。
- discarded：低价值、重复或无关，建议归档/丢弃。
- analyzed：已经被分析使用或可视为已完成 AI 分析。

暂存资料清单：

${JSON.stringify(items, null, 2)}
`;
    bridge()?.copyText?.(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
    setProjectMessage('已复制 AI 初筛指令。请粘贴给 QClaw / OpenClaw / Hohu 等工具执行，保存返回 JSON 后再导入。');
  };

  const importProjectStagingAiScreening = () => {
    if (!selectedProjectId) {
      setProjectMessage('请先选择学习项目。');
      return;
    }
    const raw = bridge()?.importProjectStagingAiScreening?.(selectedProjectId);
    if (!raw) {
      setProjectMessage('当前环境不支持导入 AI 初筛结果。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; matched?: number; total?: number; project?: LearningProject; projects?: LearningProject[]; message?: string };
      if (Array.isArray(result.projects)) setProjects(result.projects);
      if (result.project) setSelectedProjectId(result.project.id);
      if (result.ok) setSelectedProjectStagingIds([]);
      setProjectMessage(result.message || (result.ok ? 'AI 初筛结果已导入。' : 'AI 初筛结果导入失败。'));
    } catch {
      setProjectMessage('AI 初筛结果解析失败。');
    }
  };

  const analyzeProjectStagingGovernance = () => {
    if (!selectedProjectId) {
      setProjectMessage('请先选择学习项目。');
      return;
    }
    const raw = bridge()?.analyzeProjectStagingGovernance?.(selectedProjectId);
    if (!raw) {
      setProjectMessage('当前环境不支持生成研究暂存治理建议。');
      return;
    }
    try {
      const result = JSON.parse(raw) as {
        ok?: boolean;
        duplicateCount?: number;
        cleanupCandidateCount?: number;
        reportPath?: string;
        project?: LearningProject;
        projects?: LearningProject[];
        message?: string;
      };
      if (Array.isArray(result.projects)) setProjects(result.projects);
      if (result.project) setSelectedProjectId(result.project.id);
      setProjectMessage(result.message || (result.ok ? '已生成研究暂存治理建议。' : '生成研究暂存治理建议失败。'));
    } catch {
      setProjectMessage('研究暂存治理建议结果解析失败。');
    }
  };

  const generateSelectedProjectPromotion = () => {
    if (!selectedProjectId) {
      setProjectMessage('请先选择学习项目。');
      return;
    }
    const raw = bridge()?.generateProjectPromotion?.(selectedProjectId);
    if (!raw) {
      setProjectMessage('当前环境不支持生成知识贡献申请。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; path?: string; content?: string; message?: string };
      setProjectMessage(result.message || (result.ok ? '已生成知识贡献申请。' : '生成知识贡献申请失败。'));
      setPromotionPreview(result.content || '');
    } catch {
      setProjectMessage('知识贡献申请结果解析失败。');
    }
  };

  const loadSelectedProjectPromotionPlan = () => {
    if (!selectedProjectId) {
      setProjectMessage('请先选择学习项目。');
      return;
    }
    const raw = bridge()?.getProjectPromotionPlan?.(selectedProjectId);
    if (!raw) {
      setProjectMessage('当前环境不支持生成归档确认清单。');
      return;
    }
    try {
      const result = JSON.parse(raw) as PromotionPlan;
      if (!result.ok) {
        setProjectMessage(result.message || '生成归档确认清单失败。');
        return;
      }
      setPromotionPlan({ ...result, items: result.items ?? [] });
      setProjectMessage(result.message || '已生成归档确认清单。');
    } catch {
      setProjectMessage('归档确认清单结果解析失败。');
    }
  };

  const updatePromotionPlanItemAction = (itemId: string, action: PromotionAction) => {
    setPromotionPlan((current) => {
      if (!current) return current;
      return {
        ...current,
        items: current.items.map((item) => (item.id === itemId ? { ...item, action } : item)),
      };
    });
  };

  const setPromotionPlanBatchAction = (kind: 'all' | 'files' | 'knowledge', action: PromotionAction) => {
    setPromotionPlan((current) => {
      if (!current) return current;
      return {
        ...current,
        items: current.items.map((item) => {
          const included = kind === 'all'
            || (kind === 'files' && item.kind === 'file')
            || (kind === 'knowledge' && item.kind !== 'file');
          if (!included || !item.allowedActions.includes(action)) return item;
          return { ...item, action };
        }),
      };
    });
  };

  const updateSelectedProjectStatus = (status: string) => {
    if (!selectedProjectId) {
      setProjectMessage('请先选择学习项目。');
      return;
    }
    const raw = bridge()?.updateProjectStatus?.(selectedProjectId, status);
    if (!raw) {
      setProjectMessage('当前环境不支持更新项目状态。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; project?: LearningProject; projects?: LearningProject[]; message?: string };
      if (Array.isArray(result.projects)) setProjects(result.projects);
      if (result.project) setSelectedProjectId(result.project.id);
      setProjectMessage(result.message || (result.ok ? '项目状态已更新。' : '项目状态更新失败。'));
    } catch {
      setProjectMessage('项目状态更新结果解析失败。');
    }
  };

  const updateSelectedProjectStudents = (studentIds: string[]) => {
    if (!selectedProjectId) {
      setProjectMessage('请先选择学习项目。');
      return;
    }
    const raw = bridge()?.updateProjectStudents?.(selectedProjectId, JSON.stringify(studentIds));
    if (!raw) {
      setProjectMessage('当前环境不支持更新项目绑定学生。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; project?: LearningProject; projects?: LearningProject[]; message?: string };
      if (Array.isArray(result.projects)) setProjects(result.projects);
      if (result.project) setSelectedProjectId(result.project.id);
      setPromotionPlan(null);
      setPromotionPreview('');
      setPromotionExecutionSummary('');
      setProjectMessage(result.message || (result.ok ? '项目绑定学生已更新。' : '项目绑定学生更新失败。'));
    } catch {
      setProjectMessage('项目绑定学生更新结果解析失败。');
    }
  };

  const executeSelectedProjectPromotionPlan = () => {
    if (!selectedProjectId || !promotionPlan) {
      setProjectMessage('请先生成归档确认清单。');
      return;
    }
    if (promotionExecutionPreview && !window.confirm(`确认执行归档清单吗？\n\n${promotionExecutionPreview}`)) return;
    const raw = bridge()?.executeProjectPromotionPlan?.(selectedProjectId, JSON.stringify({ items: promotionPlan.items }));
    if (!raw) {
      setProjectMessage('当前环境不支持执行归档确认清单。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; project?: LearningProject; message?: string; executionLog?: string; results?: Array<{ action?: string; ok?: boolean; target?: string }> };
      setProjectMessage(result.message || (result.ok ? '已执行归档确认清单。' : '执行归档确认清单失败。'));
      if (result.project) setProjects((current) => current.map((item) => (item.id === result.project?.id ? result.project : item)));
      if (result.ok) {
        if (Array.isArray(result.results)) {
          const success = result.results.filter((item) => item.ok !== false).length;
          const failed = result.results.length - success;
          const byAction = result.results.reduce<Record<string, number>>((acc, item) => {
            const action = item.action || 'unknown';
            acc[action] = (acc[action] || 0) + 1;
            return acc;
          }, {});
          setPromotionExecutionSummary(`执行完成：成功 ${success} 项，失败 ${failed} 项；引用 ${byAction.reference || 0}，发布 ${byAction.publish || 0}，吸收 ${byAction.absorb || 0}，跳过 ${byAction.skip || 0}。`);
        }
        refreshAssets();
        if (selectedStudent) refreshLearningReports(selectedStudent);
      }
    } catch {
      setProjectMessage('执行归档确认清单结果解析失败。');
    }
  };

  const publishSelectedProjectPromotion = () => {
    if (!selectedProjectId) {
      setProjectMessage('请先选择学习项目。');
      return;
    }
    const raw = bridge()?.publishProjectPromotion?.(selectedProjectId);
    if (!raw) {
      setProjectMessage('当前环境不支持发布知识贡献。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; project?: LearningProject; content?: string; message?: string };
      setProjectMessage(result.message || (result.ok ? '已发布知识贡献。' : '发布知识贡献失败。'));
      if (result.content) setPromotionPreview(result.content);
      if (result.project) setProjects((current) => current.map((item) => (item.id === result.project?.id ? result.project : item)));
      if (result.ok && selectedStudent) {
        refreshLearningReports(selectedStudent);
      }
    } catch {
      setProjectMessage('发布知识贡献结果解析失败。');
    }
  };

  const ensureSelectedGrowthModel = () => {
    if (!selectedStudent) {
      setGrowthMessage('请先选择学生。');
      return;
    }
    const raw = bridge()?.ensureGrowthModel?.(selectedStudent.id);
    if (!raw) {
      setGrowthMessage('当前环境不支持成长模型补建。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; folder?: string; created?: string[]; message?: string };
      setGrowthMessage(result.message || (result.ok ? '成长模型已确认。' : '成长模型补建失败。'));
    } catch {
      setGrowthMessage('成长模型补建结果解析失败。');
    }
  };

  const consumeSharedForStudent = (student: Student) => {
    const raw = bridge()?.consumeSharedImports?.(student.name);
    if (!raw) {
      setInboxMessage('当前环境没有可消费的分享资料。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; imported?: number; message?: string };
      setInboxMessage(result.message || (result.ok ? '已导入分享资料。' : '分享资料导入失败。'));
      if (result.ok && Number(result.imported ?? 0) > 0) {
        const stamp = new Date().toLocaleString('zh-CN');
        const next = students.map((item) =>
          item.id === student.id
            ? {
                ...item,
                lastImportAt: stamp,
                pendingDigestCount: (item.pendingDigestCount ?? 0) + Number(result.imported ?? 0),
              }
            : item,
        );
        persist(next);
        setSharedInboxCount(0);
      }
    } catch {
      setInboxMessage('分享资料导入结果解析失败。');
    }
    window.setTimeout(() => setInboxMessage(''), 3600);
  };

  const authorizeArchiveRoot = () => {
    if (isWindows && !windowsLicenseActive) {
      setArchiveRootMessage('未激活状态仅支持只读浏览，激活后可更换学生资料根目录。');
      return;
    }
    const ok = bridge()?.pickArchiveRoot?.();
    if (!ok) {
      setArchiveRootMessage('当前环境不支持选择学生资料根目录。');
    }
  };

  const refreshMarkdownFiles = (student: Student) => {
    const raw = bridge()?.listMarkdownFiles?.(student.id);
    if (!raw) {
      setMarkdownMessage('当前环境不支持读取本机 Markdown 档案，请在 Android APK 中使用。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; files?: MarkdownFile[]; message?: string };
      if (!result.ok) {
        setMarkdownFiles([]);
        setSelectedMarkdownId('');
        setMarkdownContent('');
        setMarkdownMessage(result.message || '未找到学情分析汇总文件夹。');
        return;
      }
      const files = [...(result.files ?? [])].sort((a, b) => {
        const aIndex = a.name === 'index.md' ? -1 : 0;
        const bIndex = b.name === 'index.md' ? -1 : 0;
        if (aIndex !== bIndex) return aIndex - bIndex;
        return a.path.localeCompare(b.path, 'zh-CN');
      });
      const visibleFiles = files.filter(isVisibleArchiveFile);
      const firstVisibleFile =
        selectedArchiveCategory === 'all'
          ? visibleFiles[0]
          : visibleFiles.find((file) => !isLearningReportFile(file) && classifyMarkdownFile(file, archiveKeywords) === selectedArchiveCategory)
            ?? visibleFiles.find((file) => !isLearningReportFile(file))
            ?? visibleFiles[0];
      setMarkdownFiles(files);
      setMarkdownMessage(visibleFiles.length ? `已加载 ${visibleFiles.length} 个可浏览 Markdown 档案。` : '该学情分析汇总文件夹暂无可浏览 Markdown 文件。');
      if (firstVisibleFile) {
        openMarkdownFile(firstVisibleFile);
      }
    } catch {
      setMarkdownMessage('档案列表解析失败。');
    }
  };

  const openMarkdownFile = (file: MarkdownFile) => {
    const raw = bridge()?.readMarkdownFile?.(file.id);
    if (!raw) {
      setMarkdownMessage('当前环境不支持读取 Markdown 文件。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; content?: string; message?: string };
      if (!result.ok) {
        setMarkdownMessage(result.message || '读取 Markdown 失败。');
        return;
      }
      setSelectedMarkdownId(file.id);
      setMarkdownContent(result.content ?? '');
      setMarkdownMessage('');
    } catch {
      setMarkdownMessage('Markdown 内容解析失败。');
    }
  };

  const initChecklist = [
    { label: '学生信息已填写', done: Boolean(draft.name.trim() && draft.grade.trim() && draft.school.trim()) },
    { label: `初始化包版本 v${initSchemaVersion}`, done: true },
    { label: '初始文档已导出', done: exportedOnce },
    { label: `${selectedTool.name} 初始化指令已复制`, done: copiedOnce },
    { label: '学生档案已保存', done: students.some((student) => student.name === sanitizeName(draft.name)) },
    { label: selectedTool.supportsScheduledTask ? `${selectedTool.name} 已打开` : `${selectedTool.name} 指令已生成`, done: selectedTool.supportsScheduledTask ? toolOpenState[selectedTool.id] : copiedOnce },
  ];

  const adoptChecklist = [
    { label: 'AGENT.md', status: adoptScanResult?.checks?.agentMd ? '已找到' : '未找到' },
    { label: '原始资料库', status: adoptScanResult?.checks?.rawDir ? '已找到' : adoptPaths.rawPath ? '已指定' : '需选择 / 可创建' },
    { label: '学情分析汇总', status: adoptScanResult?.checks?.summaryDir ? '已找到' : adoptPaths.summaryPath ? '已指定' : '需选择 / 可创建' },
    { label: '输出结果', status: adoptScanResult?.checks?.outputDir ? '已找到' : adoptPaths.outputPath ? '已指定' : '可创建' },
    { label: 'index.md', status: adoptScanResult?.checks?.indexMd ? '已找到' : '未找到' },
    { label: 'log.md', status: adoptScanResult?.checks?.logMd ? '已找到' : '未找到' },
    { label: '学情报告目录', status: adoptScanResult?.checks?.learningReportDir ? '已找到' : '可补建' },
    { label: '四份学情报告', status: adoptScanResult?.checks?.learningReports ? '已找到' : '可补建' },
  ];

  const deleteStudent = (student: Student) => {
    if (isWindows && !windowsLicenseActive) {
      setDigestMessage('未激活状态仅支持只读浏览，激活后可删除控制台学生记录。');
      window.setTimeout(() => setDigestMessage(''), 2600);
      return;
    }
    const confirmed = window.confirm(`确认从控制台删除「${student.name}」的学生记录吗？\n\n这只删除控制台里的学生列表，不会删除外部 Agent，也不会删除已经导出的资料文件。`);
    if (!confirmed) return;
    const next = students.filter((item) => item.id !== student.id);
    persist(next);
    setSelectedId(next[0]?.id ?? '');
    if (next.length === 0) {
      setActiveSection('init');
    }
  };

  const refreshLearningReports = (student: Student | undefined = selectedStudent) => {
    if (!student) return;
    const raw = bridge()?.listLearningReports?.(student.id);
    if (!raw) {
      setLearningReportMessage('当前环境不支持读取学情报告。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; reports?: LearningReport[]; folder?: string; message?: string; health?: LearningReportHealth };
      if (!result.ok) {
        setLearningReports([]);
        setLearningReportContent('');
        setLearningReportHealth(null);
        setLearningReportMessage(result.message || '读取学情报告失败。');
        return;
      }
      const reports = result.reports ?? [];
      setLearningReports(reports);
      setLearningReportFolder(result.folder || '');
      setLearningReportHealth(result.health ?? null);
      setLearningReportMessage(result.message || `已加载 ${reports.length} 份学情报告。`);
      const nextId = reports.some((report) => report.id === selectedLearningReportId)
        ? selectedLearningReportId
        : (reports[0]?.id ?? 'profile');
      if (reports.length > 0) openLearningReport(nextId as LearningReportId, student);
    } catch {
      setLearningReportMessage('学情报告列表解析失败。');
    }
  };

  const openLearningReport = (reportId: LearningReportId, student: Student | undefined = selectedStudent) => {
    if (!student) return;
    const raw = bridge()?.readLearningReport?.(student.id, reportId);
    if (!raw) {
      setLearningReportMessage('当前环境不支持读取学情报告正文。');
      return;
    }
    try {
      const result = JSON.parse(raw) as LearningReport & { ok?: boolean; content?: string; message?: string };
      if (!result.ok) {
        setLearningReportMessage(result.message || '读取学情报告正文失败。');
        return;
      }
      setSelectedLearningReportId(reportId);
      setLearningReportContent(result.content || '');
      setLearningReports((current) => {
        const next = current.some((item) => item.id === result.id)
          ? current.map((item) => (item.id === result.id ? { ...item, ...result } : item))
          : [...current, result];
        return next;
      });
      setLearningReportMessage('');
    } catch {
      setLearningReportMessage('学情报告正文解析失败。');
    }
  };

  const ensureLearningReportTemplates = (student: Student | undefined = selectedStudent) => {
    if (!student) return;
    const raw = bridge()?.ensureLearningReports?.(student.id);
    if (!raw) {
      setLearningReportMessage('当前环境不支持补建学情报告目录。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; reports?: LearningReport[]; folder?: string; message?: string; health?: LearningReportHealth };
      setLearningReportMessage(result.message || (result.ok ? '已确认学情报告目录。' : '补建学情报告失败。'));
      if (result.ok) {
        setLearningReports(result.reports ?? []);
        setLearningReportFolder(result.folder || '');
        setLearningReportHealth(result.health ?? null);
        refreshLearningReports(student);
      }
    } catch {
      setLearningReportMessage('补建学情报告结果解析失败。');
    }
  };

  const openToolDownload = (tool: AgentToolId) => {
    const urls: Record<AgentToolId, string> = {
      qclaw: 'https://qclaw.qq.com/',
      marvis: 'https://marvis.qq.com/',
      hohu: 'https://hohu.ai/',
      openclaw: 'https://openclaw.ai/',
      'ima.copilot': 'https://ima.qq.com/download/',
      workbuddy: 'https://www.workbuddy.ai/',
      codex: 'https://chatgpt.com/codex',
      'claude-code': 'https://www.anthropic.com/claude-code',
      chatgpt: 'https://chatgpt.com/',
      claude: 'https://claude.ai/',
      doubao: 'https://www.doubao.com/',
      coze: 'https://www.coze.cn/',
      fastgpt: 'https://fastgpt.in/',
    };
    const url = urls[tool];
    const ok = bridge()?.openExternalUrl?.(url);
    if (!ok) window.open(url, '_blank');
  };

  const openUserAgreement = () => {
    const ok = bridge()?.openExternalUrl?.(userAgreementUrl);
    if (!ok) window.open(userAgreementUrl, '_blank', 'noopener,noreferrer');
  };

  const openPrivacyPolicy = () => {
    const ok = bridge()?.openExternalUrl?.(privacyPolicyUrl);
    if (!ok) window.open(privacyPolicyUrl, '_blank', 'noopener,noreferrer');
  };

  const startHostService = () => {
    applyHostServiceResult(bridge()?.startHostService?.());
  };

  const stopHostService = () => {
    applyHostServiceResult(bridge()?.stopHostService?.());
  };

  const saveHostServicePort = () => {
    const port = Number(hostPortDraft);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      setHostServiceMessage('端口必须是 1024-65535 之间的数字。');
      return;
    }
    applyHostServiceResult(bridge()?.setHostServicePort?.(port));
  };

  const copyHostConnectionInfo = () => {
    const raw = bridge()?.getHostConnectionInfo?.();
    if (!raw) {
      setHostServiceMessage('当前环境不支持复制主机连接信息。');
      return;
    }
    try {
      const info = JSON.parse(raw) as { serverUrl?: string; apiToken?: string; port?: number; lanUrls?: string[]; tailscaleUrls?: string[]; connectionMode?: string; pairCode?: string; pairExpiresAt?: string; pairPayloadText?: string };
      const text = [
        `serverUrl=${info.serverUrl ?? ''}`,
        `apiToken=${info.apiToken ?? ''}`,
        `port=${info.port ?? ''}`,
        `connectionMode=${info.connectionMode ?? 'lan_tailscale'}`,
        `pairCode=${info.pairCode ?? ''}`,
        `pairExpiresAt=${info.pairExpiresAt ?? ''}`,
        `lanUrls=${(info.lanUrls ?? []).join(',')}`,
        `tailscaleUrls=${(info.tailscaleUrls ?? []).join(',')}`,
        `pairPayload=${info.pairPayloadText ?? ''}`,
      ].join('\n');
      copyText(text);
      setHostServiceMessage('已复制平板连接信息。');
      refreshHostServiceStatus();
    } catch {
      setHostServiceMessage('连接信息解析失败。');
    }
  };

  const copyHostPairPayload = () => {
    const payload = hostServiceStatus?.pairPayloadText;
    if (!payload) {
      setHostServiceMessage('请先启动或刷新主机服务，生成平板配对信息。');
      return;
    }
    copyText(payload);
    setHostServiceMessage('已复制平板扫码配对内容。');
  };

  const runHostDiagnostics = () => {
    const raw = bridge()?.getHostServiceDiagnostics?.();
    if (!raw) {
      setHostServiceMessage('当前环境不支持主机服务诊断。');
      return;
    }
    try {
      const result = JSON.parse(raw) as HostServiceDiagnostics;
      setHostDiagnostics(result);
      setHostServiceMessage(result.ok ? '诊断完成：主机服务状态正常。' : '诊断完成：请查看下方异常项目。');
    } catch {
      setHostServiceMessage('主机服务诊断结果解析失败。');
    }
  };

  const repairHostService = () => {
    const raw = bridge()?.repairHostService?.();
    if (!raw) {
      setHostServiceMessage('当前环境不支持主机服务一键修复。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; message?: string; status?: HostServiceStatus };
      if (result.status) setHostServiceStatus(result.status);
      setHostServiceMessage(result.message || (result.ok ? '主机服务已修复。' : '主机服务修复失败，请运行诊断。'));
      window.setTimeout(refreshHostServiceStatus, 900);
    } catch {
      setHostServiceMessage('主机服务修复结果解析失败。');
    }
  };

  const exportHostUploadRecords = () => {
    const raw = bridge()?.exportHostUploadRecords?.();
    if (!raw) {
      setHostServiceMessage('当前环境不支持导出上传记录。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; path?: string; count?: number; message?: string };
      setHostServiceMessage(result.ok ? `已导出 ${result.count ?? 0} 条上传记录：${result.path}` : result.message || '导出上传记录失败。');
    } catch {
      setHostServiceMessage('导出上传记录结果解析失败。');
    }
  };

  const openHostUploadRecord = (record: HostUploadRecord) => {
    const raw = bridge()?.openHostUploadRecord?.(record.id);
    if (!raw) {
      setHostServiceMessage('当前环境不支持打开文件位置。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; message?: string };
      if (!result.ok) setHostServiceMessage(result.message || '打开文件位置失败。');
    } catch {
      setHostServiceMessage('打开文件位置结果解析失败。');
    }
  };

  const clearHostUploadRecords = () => {
    if (!window.confirm('确认清空上传历史记录吗？\n\n只会清理记录，不会删除已经上传的资料文件。')) return;
    const raw = bridge()?.clearHostUploadRecords?.();
    applyHostServiceResult(raw);
    setHostUploadRecords([]);
    setHostServiceMessage('已清空上传历史记录，文件本身不会被删除。');
  };

  const setUploadRecordStatus = (record: HostUploadRecord, status: string) => {
    const raw = bridge()?.setHostUploadRecordStatus?.(record.id, status);
    if (!raw) {
      setHostServiceMessage('当前环境不支持修改上传记录状态。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; message?: string; status?: HostServiceStatus };
      if (!result.ok) {
        setHostServiceMessage(result.message || '修改上传记录状态失败。');
        return;
      }
      if (result.status) setHostServiceStatus(result.status);
      refreshHostUploadRecords();
      refreshHostTimeline();
      setHostServiceMessage(`已标记为：${uploadStatusLabel(status)}。`);
    } catch {
      setHostServiceMessage('修改上传记录状态结果解析失败。');
    }
  };

  const backupHostData = () => {
    const raw = bridge()?.backupHostData?.();
    if (!raw) {
      setHostServiceMessage('当前环境不支持备份主机数据。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; path?: string; message?: string };
      setHostServiceMessage(result.ok ? `已生成备份：${result.path}` : result.message || '备份失败。');
      refreshHostTimeline();
    } catch {
      setHostServiceMessage('备份结果解析失败。');
    }
  };

  const restoreHostData = () => {
    if (!window.confirm('确认从备份文件恢复主机数据吗？\n\n恢复会覆盖当前学生索引、设备授权和上传记录。')) return;
    const raw = bridge()?.restoreHostData?.();
    if (!raw) {
      setHostServiceMessage('当前环境不支持恢复主机数据。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; path?: string; message?: string; status?: HostServiceStatus };
      if (result.status) setHostServiceStatus(result.status);
      setHostServiceMessage(result.ok ? `已从备份恢复：${result.path}` : result.message || '恢复失败。');
      refreshHostUploadRecords();
      refreshHostTimeline();
    } catch {
      setHostServiceMessage('恢复结果解析失败。');
    }
  };

  const resetHostApiToken = () => {
    if (!window.confirm('确认重置主机 API Token 吗？\n\n旧的手工连接信息会失效，已扫码绑定的设备 token 不会被删除。')) return;
    const raw = bridge()?.resetHostApiToken?.();
    if (!raw) {
      setHostServiceMessage('当前环境不支持重置 API Token。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; message?: string; status?: HostServiceStatus };
      if (result.status) setHostServiceStatus(result.status);
      setHostServiceMessage(result.ok ? 'API Token 已重置，请重新复制连接信息。' : result.message || '重置 API Token 失败。');
      refreshHostTimeline();
    } catch {
      setHostServiceMessage('重置 API Token 结果解析失败。');
    }
  };

  const exportHostLogs = () => {
    const raw = bridge()?.exportHostLogs?.();
    if (!raw) {
      setHostServiceMessage('当前环境不支持导出诊断日志。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; path?: string; message?: string };
      setHostServiceMessage(result.ok ? `已导出诊断日志：${result.path}` : result.message || '导出诊断日志失败。');
    } catch {
      setHostServiceMessage('导出诊断日志结果解析失败。');
    }
  };

  const openStudentRawDir = (student: Student) => {
    if (isWindows && !windowsLicenseActive) {
      setHostServiceMessage('未激活状态仅支持控制台内只读浏览，激活后可打开本机原始资料库。');
      return;
    }
    const raw = bridge()?.openStudentRawDir?.(student.id);
    if (!raw) {
      setHostServiceMessage('当前环境不支持打开学生原始资料库。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; message?: string; path?: string };
      setHostServiceMessage(result.ok ? `已打开原始资料库：${result.path}` : result.message || '打开原始资料库失败。');
    } catch {
      setHostServiceMessage('打开原始资料库结果解析失败。');
    }
  };

  const migrateSelectedStudentWorkspace = () => {
    if (!selectedStudent || !studentEditDraft) return;
    if (isWindows && !windowsLicenseActive) {
      setDigestMessage('未激活状态仅支持只读浏览，激活后可迁移或重命名知识库目录。');
      window.setTimeout(() => setDigestMessage(''), 2600);
      return;
    }
    const cleanName = sanitizeName(studentEditDraft.name);
    const confirmed = window.confirm(`确认将「${selectedStudent.name}」的本机知识库目录迁移/重命名为「${cleanName}知识库」吗？\n\n这会移动本机目录；建议先确认 QClaw/Marvis/Hohu/OpenClaw 没有正在处理该学生资料。`);
    if (!confirmed) return;
    const raw = bridge()?.migrateStudentWorkspace?.(selectedStudent.id, cleanName);
    if (!raw) {
      setDigestMessage('当前环境不支持迁移本机知识库目录。');
      return;
    }
    try {
      const result = JSON.parse(raw) as { ok?: boolean; message?: string; name?: string; rootPathLabel?: string };
      if (!result.ok) {
        setDigestMessage(result.message || '迁移知识库目录失败。');
        return;
      }
      const next = students.map((student) =>
        student.id === selectedStudent.id
          ? {
              ...student,
              ...studentEditDraft,
              name: result.name || cleanName,
              rootPathLabel: result.rootPathLabel || pathsFor(result.name || cleanName).root,
            }
          : student,
      );
      persist(next);
      setStudentEditDraft((current) => (current ? { ...current, name: result.name || cleanName, rootPathLabel: result.rootPathLabel || current.rootPathLabel } : current));
      setDigestMessage(`已迁移知识库目录：${result.rootPathLabel}`);
      window.setTimeout(() => setDigestMessage(''), 3600);
    } catch {
      setDigestMessage('迁移知识库目录结果解析失败。');
    }
  };

  const renameDevice = (device: HostDevice) => {
    const name = window.prompt('请输入新的设备名称', device.name);
    if (name == null) return;
    const raw = bridge()?.renameHostDevice?.(device.id, name);
    applyHostServiceResult(raw);
  };

  const revokeDevice = (device: HostDevice) => {
    const confirmed = window.confirm(`确认撤销「${device.name}」的主机访问权限吗？`);
    if (!confirmed) return;
    const raw = bridge()?.revokeHostDevice?.(device.id);
    applyHostServiceResult(raw);
  };

  const setDeviceAccess = (device: HostDevice, studentId: string, checked: boolean) => {
    const current = new Set((device.allowedStudentIds ?? []).map(String));
    if (checked) current.add(studentId);
    else current.delete(studentId);
    const raw = bridge()?.setHostDeviceStudentAccess?.(device.id, JSON.stringify(Array.from(current)));
    applyHostServiceResult(raw);
  };

  const setDeviceAccessMode = (device: HostDevice, patch: Partial<Pick<HostDevice, 'allowedAllStudents' | 'autoAuthorizeNewStudents'>>) => {
    const raw = bridge()?.setHostDeviceAccessMode?.(device.id, JSON.stringify({
      allowedAllStudents: patch.allowedAllStudents ?? device.allowedAllStudents ?? false,
      autoAuthorizeNewStudents: patch.autoAuthorizeNewStudents ?? device.autoAuthorizeNewStudents ?? false,
    }));
    applyHostServiceResult(raw);
  };

  const copyHostDiagnostics = async () => {
    const payload = {
      version: currentVersionName,
      checkedAt: new Date().toLocaleString('zh-CN'),
      status: hostServiceStatus,
      diagnostics: hostDiagnostics,
      uploadFilters: {
        student: hostUploadStudentFilter,
        device: hostUploadDeviceFilter,
        date: hostUploadDateFilter,
        keyword: hostUploadSearch,
      },
    };
    await copyText(JSON.stringify(payload, null, 2), '已复制主机服务诊断信息。');
  };

  const deviceAccessSummary = (device: HostDevice) => {
    if (device.revoked) return '访问权限已撤销';
    if (device.allowedAllStudents) return '可访问全部学生';
    const count = (device.allowedStudentIds ?? []).length;
    const auto = device.autoAuthorizeNewStudents ? '，新学生自动授权' : '';
    return count > 0 ? `已授权 ${count} 位学生${auto}` : `未授权学生${auto}`;
  };

  const deviceLastSeenSummary = (device: HostDevice) => {
    if (device.revoked) return '已撤销';
    const seen = device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : '尚未访问';
    const ip = device.lastIp ? ` · ${device.lastIp}` : '';
    return `最近访问：${seen}${ip}`;
  };

  const checkUpdate = () => {
    setCheckingUpdate(true);
    setUpdateInfo(null);
    const ok = bridge()?.checkUpdate?.(updateManifestUrl, currentVersionCode);
    if (!ok) {
      setCheckingUpdate(false);
      setUpdateInfo({ hasUpdate: false, message: '当前环境不支持原生更新检查，请在 Android APK 中使用。' });
    }
  };

  const installUpdate = () => {
    if (!updateInfo?.apkUrl) return;
    const ok = bridge()?.downloadAndInstallUpdate?.(updateInfo.apkUrl);
    if (!ok) {
      setUpdateInfo({ ...updateInfo, message: '无法启动下载，请检查网络或安装权限。' });
    }
  };

  const renderHostPairingPanel = () => (
    <div className="host-pairing-panel">
      <div className="pair-card">
        <div>
          <span>平板配对码</span>
          <strong>{hostServiceStatus?.pairCode ?? '未生成'}</strong>
          <small>
            {hostServiceStatus?.pairExpiresAt
              ? `有效至 ${new Date(hostServiceStatus.pairExpiresAt).toLocaleTimeString()}`
              : '启动或刷新主机服务后生成，10 分钟内有效。'}
          </small>
        </div>
        <div className="pair-qr">
          {hostPairQr ? <img src={hostPairQr} alt="平板配对二维码" /> : <span>二维码待生成</span>}
        </div>
        <div className="pair-actions">
          <button className="secondary" onClick={copyHostPairPayload}>
            <Clipboard size={18} />
            复制扫码内容
          </button>
          <button className="secondary" onClick={refreshHostServiceStatus}>
            <RefreshCw size={18} />
            刷新配对码
          </button>
        </div>
        <textarea readOnly value={hostServiceStatus?.pairPayloadText ?? ''} rows={4} />
      </div>
      <div className="device-card">
        <div className="device-heading">
          <strong>已绑定设备</strong>
          <span>{hostServiceStatus?.devices?.filter((device) => !device.revoked).length ?? 0} 台有效设备</span>
        </div>
        <div className="device-list">
          {(hostServiceStatus?.devices ?? []).length === 0 && <p className="muted-text">暂无绑定设备。平板扫码并输入配对码后，会出现在这里。</p>}
          {(hostServiceStatus?.devices ?? []).map((device) => (
            <article className={device.revoked ? 'device-item revoked' : 'device-item'} key={device.id}>
              <div className="device-row">
                <div>
                  <div className="device-title-line">
                    <strong>{device.name}</strong>
                    <span className={device.revoked ? 'status neutral' : device.online ? 'status ok' : 'status warn'}>
                      {device.revoked ? '已撤销' : device.online ? '在线' : '离线'}
                    </span>
                  </div>
                  <small>{device.tokenPreview || device.id}</small>
                </div>
                <div className="device-actions">
                  <button className="secondary compact" disabled={device.revoked} onClick={() => renameDevice(device)}>
                    重命名
                  </button>
                  <button className="danger subtle" disabled={device.revoked} onClick={() => revokeDevice(device)}>
                    撤销设备
                  </button>
                </div>
              </div>
              <small>{deviceAccessSummary(device)}</small>
              <div className="access-list">
                <label className="checkbox-line">
                  <input
                    type="checkbox"
                    disabled={device.revoked}
                    checked={Boolean(device.allowedAllStudents)}
                    onChange={(event) => setDeviceAccessMode(device, { allowedAllStudents: event.target.checked })}
                  />
                  <span>允许访问全部学生</span>
                </label>
                <label className="checkbox-line">
                  <input
                    type="checkbox"
                    disabled={device.revoked}
                    checked={Boolean(device.autoAuthorizeNewStudents)}
                    onChange={(event) => setDeviceAccessMode(device, { autoAuthorizeNewStudents: event.target.checked })}
                  />
                  <span>默认授权新学生</span>
                </label>
                {students.map((student) => (
                  <label className="checkbox-line" key={student.id}>
                    <input
                      type="checkbox"
                      disabled={device.revoked || device.allowedAllStudents}
                      checked={Boolean(device.allowedAllStudents) || (device.allowedStudentIds ?? []).includes(student.id)}
                      onChange={(event) => setDeviceAccess(device, student.id, event.target.checked)}
                    />
                    <span>{student.name}</span>
                  </label>
                ))}
              </div>
              <small>{deviceLastSeenSummary(device)}</small>
              {device.lastUserAgent && <small>客户端：{device.lastUserAgent}</small>}
              <small>
                上传统计：{device.uploadCount ?? 0} 个文件{device.lastUploadAt ? ` · 最近上传 ${new Date(device.lastUploadAt).toLocaleString()}` : ''}
              </small>
            </article>
          ))}
        </div>
      </div>
    </div>
  );

  const sourceRegistryPanel = (
    <div className="source-list">
      <div className="mini-heading">
        <strong>来源记录</strong>
        <span>{sourceRegistry?.path || '导入、保存、提取动作会写入 source-registry.json。'}</span>
      </div>
      <div className="actions compact-actions">
        <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as typeof sourceFilter)}>
          <option value="all">全部来源</option>
          <option value="memory">记忆</option>
          <option value="persona">人设</option>
          <option value="rule">规则</option>
          <option value="conversation">对话</option>
          <option value="extract">提取</option>
        </select>
        <select value={sourceToolFilter} onChange={(event) => setSourceToolFilter(event.target.value as AgentToolId | 'all')}>
          <option value="all">全部工具</option>
          {agentToolOptions.map((tool) => <option value={tool.id} key={tool.id}>{tool.name}</option>)}
        </select>
        <button className="secondary compact" onClick={() => refreshSourceRegistry()}>刷新来源记录</button>
        <button className="secondary compact" onClick={() => copyText(JSON.stringify(sourceRegistry ?? { records: [] }, null, 2), '已复制来源记录 JSON。')}>复制来源记录</button>
      </div>
      {filteredSourceRecords.length === 0 ? (
        <div className="notice muted">暂无匹配来源记录。</div>
      ) : (
        filteredSourceRecords.slice(0, 12).map((record) => (
          <div className="source-row" key={record.id}>
            <strong>{record.assetType} · {getAgentToolProfile(record.tool).name}</strong>
            <span>{record.sourceType}{record.confidence ? ` · 可信度 ${record.confidence}` : ''}</span>
            <small>{record.importedAt ? new Date(record.importedAt).toLocaleString('zh-CN') : ''} {record.targetPath || record.sourcePath || record.notes || ''}</small>
            <div className="actions compact-actions">
              <button className="secondary compact" onClick={() => setExpandedSourceRecordId(expandedSourceRecordId === record.id ? '' : record.id)}>
                {expandedSourceRecordId === record.id ? '收起详情' : '查看详情'}
              </button>
              <button className="secondary compact" onClick={() => copyText(JSON.stringify(record, null, 2), '已复制该来源详情。')}>复制详情</button>
              <button className="danger subtle" onClick={() => rollbackSourceRecord(record.id)}>撤销记录</button>
            </div>
            {expandedSourceRecordId === record.id && (
              <pre className="candidate-preview">{JSON.stringify(record, null, 2)}</pre>
            )}
          </div>
        ))
      )}
    </div>
  );

  const candidateImportReviewPanel = candidateImportReview ? (
    <div className="notice import-review">
      <strong>导入前确认</strong>
      <span>已选择 {candidateImportReview.candidates.length} 个候选。</span>
      {candidateImportReview.warnings.length > 0 ? (
        <ul>
          {candidateImportReview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      ) : (
        <p>未发现明显重复或低置信度候选。</p>
      )}
      <div className="actions compact-actions">
        <button className="primary compact" onClick={() => importSelectedCandidates(true)}>确认导入</button>
        <button className="secondary compact" onClick={() => setCandidateImportReview(null)}>取消</button>
      </div>
    </div>
  ) : null;

  const navItems = [
    { id: 'home' as const, label: t('nav.home'), icon: Home },
    { id: 'init' as const, label: t('nav.init'), icon: Sparkles },
    { id: 'new' as const, label: t('nav.new'), icon: Plus },
    { id: 'inbox' as const, label: t('nav.inbox'), icon: FileDown },
    ...(isWindows ? [
      { id: 'projects' as const, label: t('nav.projects'), icon: FolderOpen },
      { id: 'growth' as const, label: t('nav.growth'), icon: Sparkles },
    ] : []),
    { id: 'reports' as const, label: t('nav.reports'), icon: FileText },
    { id: 'archive' as const, label: t('nav.archive'), icon: BookOpen },
    { id: 'qa' as const, label: t('nav.qa'), icon: MessageCircle },
    { id: 'tasks' as const, label: t('nav.tasks'), icon: Clock3 },
    { id: 'settings' as const, label: t('nav.settings'), icon: Settings },
  ];
  const knowledgeNavItems = [
    { id: 'memory' as const, label: t('nav.memory'), icon: Clipboard },
    { id: 'soul' as const, label: t('nav.soul'), icon: Bot },
    { id: 'rules' as const, label: t('nav.rules'), icon: ListChecks },
    { id: 'conversation' as const, label: t('nav.conversation'), icon: MessageCircle },
  ];
  const sectionTitle = (section: Section) => {
    const map: Record<Section, TranslationKey> = {
      home: 'nav.home',
      init: 'nav.init',
      new: 'nav.new',
      inbox: 'nav.inbox',
      assets: 'nav.assets',
      projects: 'nav.projects',
      growth: 'nav.growth',
      reports: 'nav.reports',
      archive: 'nav.archive',
      qa: 'nav.qa',
      memory: 'nav.memory',
      soul: 'nav.soul',
      rules: 'nav.rules',
      conversation: 'nav.conversation',
      tasks: 'nav.tasks',
      settings: 'nav.settings',
    };
    return t(map[section]);
  };

  return (
    <main
      className={sidebarCollapsed ? 'app-shell sidebar-collapsed' : 'app-shell'}
      data-theme={theme}
      data-language={language}
      style={{ '--skin-image': `url(${themeSkinImages[theme]})` } as React.CSSProperties}
    >
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <img src="brand/robogala-round.png" alt="群星矩阵" />
          </div>
          <div className="brand-copy">
            <img className="brand-wordmark" src="brand/robogala-wordmark.png" alt="ROBOGALA 群星矩阵" />
            <span>{t('app.name')}</span>
          </div>
          <button className="icon-button sidebar-hide-button" onClick={() => setSidebarCollapsed(true)} aria-label={t('sidebar.hide')} title={t('sidebar.hide')}>
            <PanelLeftClose size={18} />
          </button>
        </div>

        <nav className="nav-list">
          {navItems.map((item) => {
            const Icon = item.icon;
            const locked = isWindows && !windowsLicenseActive && restrictedSections.has(item.id);
            return (
              <button
                className={`${activeSection === item.id ? 'nav-item active' : 'nav-item'}${locked ? ' locked' : ''}`}
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                title={locked ? '该功能需要激活后使用' : item.label}
              >
                <Icon size={19} />
                <span>{item.label}</span>
                {locked && <KeyRound size={15} />}
              </button>
            );
          })}
          <div className="nav-group-block">
            <button
              className={`${activeSection === 'memory' || activeSection === 'soul' || activeSection === 'rules' || activeSection === 'conversation' ? 'nav-item nav-group active' : 'nav-item nav-group'}${isWindows && !windowsLicenseActive ? ' locked' : ''}`}
              onClick={() => setAgentKnowledgeMenuOpen((value) => !value)}
              title={isWindows && !windowsLicenseActive ? '智能体知识管理需要激活后使用' : t('nav.knowledge')}
            >
              <Bot size={19} />
              <span>{t('nav.knowledge')}</span>
              <span className="nav-chevron">{agentKnowledgeMenuOpen ? t('nav.collapse') : t('nav.expand')}</span>
              {isWindows && !windowsLicenseActive && <KeyRound size={15} />}
            </button>
            {agentKnowledgeMenuOpen && (
              <div className="sub-nav-list">
                {knowledgeNavItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      className={`${activeSection === item.id ? 'nav-item sub-nav-item active' : 'nav-item sub-nav-item'}${isWindows && !windowsLicenseActive ? ' locked' : ''}`}
                      key={item.id}
                      onClick={() => setActiveSection(item.id)}
                      title={isWindows && !windowsLicenseActive ? '该功能需要激活后使用' : item.label}
                    >
                      <Icon size={17} />
                      <span>{item.label}</span>
                      {isWindows && !windowsLicenseActive && <KeyRound size={14} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {isWindows && (
            <button
              className={`${activeSection === 'assets' ? 'nav-item active' : 'nav-item'}${!windowsLicenseActive ? ' locked' : ''}`}
              onClick={() => setActiveSection('assets')}
              title={!windowsLicenseActive ? '文件资产中心需要激活后使用' : t('nav.assets')}
            >
              <Archive size={19} />
              <span>{t('nav.assets')}</span>
              {!windowsLicenseActive && <KeyRound size={15} />}
            </button>
          )}
        </nav>

        <section className="student-rail">
          <div className="rail-title">
            <span>{t('students.title')}</span>
            <button aria-label={t('students.add')} onClick={() => setActiveSection('new')} title={!windowsLicenseActive ? '激活后可新增学生' : t('students.add')}>
              <Plus size={16} />
            </button>
          </div>
          <div className="student-list">
            {students.map((student) => (
              <button
                key={student.id}
                className={student.id === selectedId ? 'student-item selected' : 'student-item'}
                onClick={() => {
                  setSelectedId(student.id);
                  setActiveSection('archive');
                }}
              >
                <span className="avatar">{student.name.slice(0, 1)}</span>
                <span>
                  <strong>{student.name}</strong>
                  <small>
                    {student.grade} · {getAgentToolProfile(student.agentTool).name} · {student.knowledgeBaseMode === 'adopted' ? t('student.adopted') : t('student.standard')}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </section>
        <div className="brand-copyright">
          <span>嘉玛蓝（北京）科技有限公司版权所有</span>
          <span className="legal-link-group">
            <button className="inline-link" type="button" onClick={openUserAgreement}>
              {t('legal.agreement')} <ExternalLink size={12} />
            </button>
            <button className="inline-link" type="button" onClick={openPrivacyPolicy}>
              {t('legal.privacy')} <ExternalLink size={12} />
            </button>
          </span>
        </div>
      </aside>

      {sidebarCollapsed && (
        <button className="sidebar-reveal" onClick={() => setSidebarCollapsed(false)} aria-label={t('sidebar.show')} title={t('sidebar.show')}>
          <PanelLeftOpen size={18} />
          <span>{t('sidebar.show')}</span>
        </button>
      )}

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>{sectionTitle(activeSection)}</h1>
            <p>{t('app.subtitle')}</p>
          </div>
          <div className="status-row">
            <label className="theme-picker">
              {t('settings.theme')}
              <select value={theme} onChange={(event) => changeTheme(event.target.value as ThemeName)}>
                {themeOptions.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <span className={activeAgentOpened ? 'status ok' : 'status warn'}>
              {activeAgentTool.openMode === 'url'
                ? `${activeAgentTool.name} ${t('status.webEntry')}`
                : activeAgentOpened ? `${activeAgentTool.name} ${t('status.opened')}` : `${activeAgentTool.name} ${t('status.notOpened')}`}
            </span>
          </div>
        </header>

        {shouldBlockForAgentInstall && (
          <section className="panel install-gate">
            <div className="panel-heading">
              <div>
                <h2>{t('install.first')}</h2>
                <p>{t('install.description')}</p>
              </div>
              <Bot size={24} />
            </div>
            <div className="install-options">
              {agentToolOptions.map((baseTool) => {
                const tool = getAgentToolProfile(baseTool.id);
                return (
                  <article className="install-option" key={tool.id}>
                    <strong>{tool.name}</strong>
                    <span>{tool.supportsScheduledTask ? '推荐默认工具，支持本机目录、Agent 创建和定时资料消化。' : '可使用同一个 Windows 本机知识库目录，资料消化按手动指令执行。'}</span>
                    <button className={tool.id === 'qclaw' ? 'primary' : 'secondary'} onClick={() => openToolDownload(tool.id)}>
                      <ExternalLink size={18} />
                      {t('install.download')} {tool.name}
                    </button>
                  </article>
                );
              })}
            </div>
            <div className="actions">
              <button className="secondary" onClick={refreshInstallStatus}>
                <RefreshCw size={18} />
                {t('install.redetect')}
              </button>
            </div>
            {installMessage && <div className="notice">{installMessage}</div>}
          </section>
        )}

        {!shouldBlockForAgentInstall && isLicenseRestrictedSection && (
          <section className="panel license-gate">
            <div className="panel-heading">
              <div>
                <h2>{t('license.activateFirst')}</h2>
                <p>{licenseRestrictionText}</p>
              </div>
              <KeyRound size={24} />
            </div>
            <div className="status-grid">
              <InfoPanel icon={<KeyRound />} title="当前授权" value={licenseLabel(effectiveLicenseStatus)} />
              <InfoPanel icon={<BookOpen />} title={t('license.available')} value={t('license.readOnly')} />
              <InfoPanel icon={<FileDown />} title="正式功能" value="激活后开放" />
            </div>
            <div className="notice muted">
              未激活或许可证过期时，禁止新建学生、初始化知识库、接管目录、导入资料、启动主机服务、绑定平板、写入智能体知识和提交资料消化任务。
            </div>
            <div className="actions">
              <button className="primary" onClick={() => setActiveSection('settings')}>
                <KeyRound size={18} />
                {t('license.goSettings')}
              </button>
              <button className="secondary" onClick={() => setActiveSection('archive')}>
                <BookOpen size={18} />
                查看已有档案
              </button>
              <button className="secondary" onClick={() => setActiveSection('home')}>
                <Home size={18} />
                返回首页
              </button>
            </div>
          </section>
        )}

        {!shouldBlockForAgentInstall && activeSection === 'home' && (
          <>
            <div className="home-grid">
              <InfoPanel icon={<Bot />} title="Agent 创建" value={`${students.length} 个学生档案`} />
              <InfoPanel icon={<Archive />} title="资料入口" value="原始资料库待同步" />
              <InfoPanel icon={<RefreshCw />} title="当前版本" value={`v${currentVersionName}`} />
              {isWindows && <InfoPanel icon={<KeyRound />} title="授权状态" value={licenseLabel(effectiveLicenseStatus)} />}
            </div>
            {isWindows && (
              <section className="panel tool-home-panel">
                <div className="panel-heading">
                  <div>
                    <h2>使用模式</h2>
                    <p>Windows 统一版同时支持本机独立使用和主机-平板协作；主机服务默认不启动。</p>
                  </div>
                  <Bot size={22} />
                </div>
                <div className="mode-grid">
                  <article className={homeMode === 'local' ? 'mode-card active' : 'mode-card'} onClick={() => setHomeMode('local')}>
                    <strong>本机独立模式</strong>
                    <span>默认模式。控制台、QClaw、Marvis、Hohu、OpenClaw 共用本机学生知识库目录。</span>
                    <small>无需启动主机服务。</small>
                  </article>
                  <article className={homeMode === 'host' ? 'mode-card active' : 'mode-card'} onClick={() => setHomeMode('host')}>
                    <strong>主机-平板模式</strong>
                    <span>需要平板上传资料或浏览主机档案时，手动启动主机服务并复制连接信息。</span>
                    <small>{hostServiceStatus?.running ? '主机服务运行中。' : '主机服务未启动。'}</small>
                  </article>
                </div>
              </section>
            )}
            {isWindows && (
              <section className="panel tool-home-panel">
                <div className="panel-heading">
                  <div>
                    <h2>首次使用清单</h2>
                    <p>按顺序完成后，平板即可上传资料到主机，QClaw 可消化原始资料并沉淀档案。</p>
                  </div>
                  <ListChecks size={22} />
                </div>
                <div className="checklist">
                  <div className={students.length > 0 ? 'check-row done' : 'check-row'}>
                    <CheckCircle2 size={17} />
                    <span>1. 创建至少一个学生知识库</span>
                    <button className="secondary compact" onClick={() => setActiveSection('init')} disabled={!windowsLicenseActive}>去初始化</button>
                  </div>
                  <div className={hostServiceStatus?.running ? 'check-row done' : 'check-row'}>
                    <CheckCircle2 size={17} />
                    <span>2. 需要平板协作时启动主机服务</span>
                    <button className="secondary compact" onClick={() => setHomeMode('host')}>查看主机服务</button>
                  </div>
                  <div className={(hostServiceStatus?.devices ?? []).some((device) => !device.revoked) ? 'check-row done' : 'check-row'}>
                    <CheckCircle2 size={17} />
                    <span>3. 平板扫码绑定并授权学生范围</span>
                    <button className="secondary compact" onClick={copyHostConnectionInfo} disabled={!windowsLicenseActive}>复制连接信息</button>
                  </div>
                  <div className={(hostUploadRecords.length || hostServiceStatus?.recentUploads?.length || 0) > 0 ? 'check-row done' : 'check-row'}>
                    <CheckCircle2 size={17} />
                    <span>4. 平板上传资料后，在上传记录中确认状态</span>
                    <button className="secondary compact" onClick={refreshHostUploadRecords}>刷新记录</button>
                  </div>
                </div>
              </section>
            )}
            {isWindows && homeMode === 'host' && (
              <section className="panel tool-home-panel">
                <div className="panel-heading">
                  <div>
                    <h2>主机服务</h2>
                    <p>用于平板上传学习资料，并读取学生学情分析汇总中的 Markdown 档案。</p>
                  </div>
                  <RefreshCw size={22} />
                </div>
                <div className="status-grid">
                  <div className="status-card">
                    <span>服务状态</span>
                    <strong>{hostServiceStatus?.running ? '运行中' : '未启动'}</strong>
                  </div>
                  <div className="status-card">
                    <span>局域网地址</span>
                    <strong>{hostServiceStatus?.serverUrl ?? `http://127.0.0.1:${hostServiceStatus?.port ?? 18777}`}</strong>
                  </div>
                  <div className="status-card">
                    <span>Tailscale 地址</span>
                    <strong>{hostServiceStatus?.tailscaleUrl || hostServiceStatus?.tailscaleUrls?.[0] || '未检测到'}</strong>
                  </div>
                  <div className="status-card">
                    <span>当前连接模式</span>
                    <strong>{connectionModeLabel(hostServiceStatus?.connectionMode)}</strong>
                  </div>
                  <div className="status-card">
                    <span>服务端口</span>
                    <strong>{hostServiceStatus?.port ?? 18777}</strong>
                  </div>
                  <div className="status-card">
                    <span>今日上传</span>
                    <strong>{hostServiceStatus?.todayUploadCount ?? 0} 个文件</strong>
                  </div>
                  <div className="status-card">
                    <span>待消化资料</span>
                    <strong>{hostPendingDigestTotal} 个</strong>
                  </div>
                  <div className="status-card">
                    <span>学生数</span>
                    <strong>{hostServiceStatus?.studentCount ?? students.length} 位</strong>
                  </div>
                </div>
                {!windowsLicenseActive && (
                  <div className="notice warning-notice">
                    <strong>主机服务需要激活后使用</strong>
                    <p>{licenseRestrictionText}</p>
                  </div>
                )}
                {windowsLicenseActive && renderHostPairingPanel()}
                <div className="actions">
                  <button className="secondary" onClick={refreshHostServiceStatus}>
                    <RefreshCw size={18} />
                    刷新服务
                  </button>
                  <button className="secondary" onClick={runHostDiagnostics}>
                    <ListChecks size={18} />
                    运行诊断
                  </button>
                  <button className="secondary" onClick={copyHostDiagnostics}>
                    <Clipboard size={18} />
                    复制诊断信息
                  </button>
                  <button className="secondary" onClick={repairHostService} disabled={!windowsLicenseActive}>
                    <RefreshCw size={18} />
                    修复/重启服务
                  </button>
                  <button className="primary" onClick={hostServiceStatus?.running ? stopHostService : startHostService} disabled={!windowsLicenseActive && !hostServiceStatus?.running}>
                    {hostServiceStatus?.running ? '停止服务' : '启动服务'}
                  </button>
                  <button className="secondary" onClick={copyHostConnectionInfo} disabled={!windowsLicenseActive}>
                    <Clipboard size={18} />
                    复制平板连接信息
                  </button>
                </div>
                {hostDiagnostics?.checks && (
                  <div className="diagnostic-list">
                    {hostDiagnostics.checks.map((check) => (
                      <div className={check.ok ? 'diagnostic-item ok' : 'diagnostic-item warn'} key={check.label}>
                        <strong>{check.label}</strong>
                        <span>{check.detail}</span>
                        {check.suggestion && <small>{check.suggestion}</small>}
                      </div>
                    ))}
                  </div>
                )}
                <div className="upload-record-list">
                  <div className="mini-heading">
                    <div>
                      <strong>上传记录</strong>
                      <span>平板上传成功后会出现在这里，便于确认资料进入了对应学生原始资料库。</span>
                    </div>
                    <div className="mini-actions">
                      <button className="secondary compact" onClick={refreshHostUploadRecords}>
                        <RefreshCw size={16} />
                        刷新
                      </button>
                      <button className="secondary compact" onClick={exportHostUploadRecords}>
                        <FileDown size={16} />
                        导出 CSV
                      </button>
                      <button className="secondary compact" onClick={clearHostUploadRecords} disabled={!windowsLicenseActive}>
                        清理记录
                      </button>
                    </div>
                  </div>
                  <div className="upload-record-controls">
                    <input
                      value={hostUploadSearch}
                      onChange={(event) => setHostUploadSearch(event.target.value)}
                      placeholder="搜索文件名、学生、设备或路径"
                    />
                    <select value={hostUploadStudentFilter} onChange={(event) => setHostUploadStudentFilter(event.target.value)}>
                      <option value="all">全部学生</option>
                      {students.map((student) => (
                        <option value={student.id} key={student.id}>{student.name}</option>
                      ))}
                    </select>
                    <select value={hostUploadDeviceFilter} onChange={(event) => setHostUploadDeviceFilter(event.target.value)}>
                      <option value="all">全部设备</option>
                      {(hostServiceStatus?.devices ?? []).map((device) => (
                        <option value={device.id} key={device.id}>{device.name}</option>
                      ))}
                    </select>
                    <select value={hostUploadDateFilter} onChange={(event) => setHostUploadDateFilter(event.target.value)}>
                      <option value="all">全部时间</option>
                      <option value="today">今天</option>
                      <option value="7d">近 7 天</option>
                      <option value="30d">近 30 天</option>
                    </select>
                    <select value={hostUploadStatusFilter} onChange={(event) => setHostUploadStatusFilter(event.target.value)}>
                      <option value="all">全部状态</option>
                      <option value="pending_digest">待消化</option>
                      <option value="submitted">已提交消化</option>
                      <option value="digesting">消化中</option>
                      <option value="processed">已处理完成</option>
                      <option value="failed">消化失败</option>
                      <option value="ignored">已忽略</option>
                    </select>
                    <span>共 {hostUploadRecords.length || hostServiceStatus?.recentUploads?.length || 0} 条</span>
                  </div>
                  {filteredHostUploadRecords.length === 0 && <p className="muted-text">暂无上传记录。</p>}
                  {filteredHostUploadRecords.length > 0 && (
                    <div className="upload-record-scroll">
                      {filteredHostUploadRecords.slice(0, 80).map((record) => (
                        <article className="upload-record-item" key={record.id}>
                          <div>
                            <strong>{record.filename}</strong>
                            <span>{record.studentName || '未知学生'} · {record.deviceName || '未知设备'}</span>
                            <small>{uploadStatusLabel(record.status)}</small>
                            {record.path && <small>{record.path}</small>}
                          </div>
                          <div className="upload-record-meta">
                            <small>{record.uploadedAt ? new Date(record.uploadedAt).toLocaleString() : ''}</small>
                            <button className="secondary compact" onClick={() => setUploadRecordStatus(record, 'submitted')}>
                              提交消化
                            </button>
                            <button className="secondary compact" onClick={() => setUploadRecordStatus(record, 'processed')}>
                              处理完成
                            </button>
                            <button className="secondary compact" onClick={() => setUploadRecordStatus(record, 'failed')}>
                              标记失败
                            </button>
                            <button className="secondary compact" onClick={() => openHostUploadRecord(record)}>
                              打开位置
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                  {filteredHostUploadRecords.length > 80 && <p className="muted-text">仅显示前 80 条，请用搜索缩小范围或导出 CSV 查看全部。</p>}
                </div>
                {hostServiceStatus?.lastError && <div className="notice danger">服务错误：{hostServiceStatus.lastError}</div>}
                {hostServiceMessage && <div className="notice muted">{hostServiceMessage}</div>}
              </section>
            )}
            <section className="panel tool-home-panel">
              <div className="panel-heading">
                <div>
                  <h2>Agent 工具控制</h2>
                    <p>选择默认 Agent 工具，检查本地工具状态，或打开网页/平台型工具入口。</p>
                </div>
                <Bot size={22} />
              </div>
              <AgentToolCompactSelector
                value={draft.agentTool}
                onChange={(toolId) => {
                  setDraft({ ...draft, agentTool: toolId });
                  setAgentBindingMode(agentBindingModeForTool(toolId));
                }}
                label="默认 Agent 工具"
              />
              <div className="agent-status-compact-list">
                {agentToolOptions.map((baseTool) => {
                  const tool = getAgentToolProfile(baseTool.id);
                  const install = installForTool(tool.id);
                  const opened = toolOpenState[tool.id];
                  return (
                    <article className="agent-status-line" key={tool.id}>
                      <div className="agent-status-main">
                        <strong>{tool.name}</strong>
                        <span>{install?.installed ? `已安装${install.version ? ` ${install.version}` : ''}` : '未检测到安装'}</span>
                        {install?.exePath && <small>{install.exePath}</small>}
                      </div>
                      <span className={tool.openMode === 'url' ? 'status ok' : opened ? 'status ok' : 'status warn'}>
                        {tool.openMode === 'url' ? (tool.category === 'platform' ? '平台入口' : '网页入口') : opened ? '已打开' : '未打开'}
                      </span>
                      <div className="agent-status-actions">
                        <button className="primary compact" onClick={() => getAgentToolAdapter(tool.id).open(openExternal)}>
                          <ExternalLink size={16} />
                          打开
                        </button>
                        <button className="secondary compact" onClick={() => openToolDownload(tool.id)}>
                          {tool.openMode === 'url' ? '入口' : '下载'}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
              <div className="actions">
                <button className="secondary" onClick={refreshInstallStatus}>
                  <RefreshCw size={18} />
                  重新检测安装状态
                </button>
              </div>
            </section>
            <section className="panel update-panel">
              <div className="panel-heading">
                <div>
                  <h2>版本检查与更新</h2>
                <p>{isWindows ? '下载新版 Windows 包，并打开下载页面。' : '从 greatbg.com/download 下载新版 APK，并调起安卓系统安装界面。'}</p>
                </div>
                <button className="secondary" onClick={checkUpdate} disabled={checkingUpdate}>
                  <RefreshCw size={18} />
                  {checkingUpdate ? '检查中' : '检查更新'}
                </button>
              </div>
              {updateInfo && (
                <div className={updateInfo.hasUpdate ? 'notice' : 'notice muted'}>
                  {updateInfo.hasUpdate
                    ? `发现新版本 v${updateInfo.versionName || updateInfo.versionCode}`
                    : updateInfo.message || '当前已是最新版本'}
                  {updateInfo.notes && <p>{updateInfo.notes}</p>}
                  {updateInfo.hasUpdate && (
                    <button className="primary inline-action" onClick={installUpdate}>
                      下载并安装更新
                    </button>
                  )}
                </div>
              )}
            </section>
          </>
        )}

        {!shouldBlockForAgentInstall && !isLicenseRestrictedSection && (activeSection === 'init' || activeSection === 'new') && (
          <div className="setup-grid">
            <section className="panel form-panel">
              <div className="stepper">
                {['学生信息', 'Agent工具', '初始文档', '档案查看'].map((step, index) => (
                  <div className="step" key={step}>
                    <span>{index + 1}</span>
                    <strong>{step}</strong>
                  </div>
                ))}
              </div>

              <div className="info-strip">
                <span>当前模板：{templateCenter?.activeTemplate === 'custom' ? '自定义模板' : '系统默认'}</span>
                <span>{templateCenter?.templateRoot || '模板库将在 Windows 端自动创建'}</span>
                <button className="secondary compact" onClick={saveCurrentTemplates}>
                  保存为当前模板
                </button>
                <button className="secondary compact" onClick={restoreDefaultTemplates}>
                  恢复默认模板
                </button>
              </div>
              {templateMessage && <p className="inline-message">{templateMessage}</p>}

              <AgentToolCompactSelector
                value={draft.agentTool}
                onChange={(toolId) => {
                  setDraft({ ...draft, agentTool: toolId });
                  setAgentBindingMode(agentBindingModeForTool(toolId));
                  setSelectedInitStep('folder');
                }}
              />

              <div className="tool-selector">
                <span>创建方式</span>
                <div className="tool-options">
                  <button
                    className={createMode === 'standard' ? 'tool-option active' : 'tool-option'}
                    onClick={() => {
                      setCreateMode('standard');
                      setSelectedInitStep('folder');
                    }}
                  >
                    <strong>创建标准新知识库</strong>
                    <small>按默认根目录创建新学生知识库</small>
                  </button>
                  <button
                    className={createMode === 'adopted' ? 'tool-option active' : 'tool-option'}
                    onClick={() => {
                      setCreateMode('adopted');
                      setSelectedInitStep('folder');
                    }}
                  >
                    <strong>接管已有知识库</strong>
                    <small>登记旧目录，不移动、不复制、不删除</small>
                  </button>
                </div>
              </div>

              {createMode === 'standard' && (
                <div className="checklist">
                  <div className="checklist-title">
                    <ListChecks size={18} />
                    <strong>初始化进度清单</strong>
                  </div>
                  {initChecklist.map((item) => (
                    <div className={item.done ? 'check-row done' : 'check-row'} key={item.label}>
                      <CheckCircle2 size={17} />
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="field-grid">
                <label>
                  学生姓名
                  <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                </label>
                <label>
                  年级
                  <input value={draft.grade} onChange={(event) => setDraft({ ...draft, grade: event.target.value })} />
                </label>
                <label>
                  学校
                  <input value={draft.school} onChange={(event) => setDraft({ ...draft, school: event.target.value })} />
                </label>
                <label>
                  每日消化时间
                  <input type="time" value={draft.digestTime} onChange={(event) => setDraft({ ...draft, digestTime: event.target.value })} />
                </label>
                <label className="wide">
                  当前目标
                  <textarea value={draft.goal} onChange={(event) => setDraft({ ...draft, goal: event.target.value })} />
                </label>
              </div>

              <div className="path-preview">
                <FolderOpen size={18} />
                <span>{draftPaths.root}</span>
              </div>

              {createMode === 'adopted' && (
                <section className="adopt-panel">
                  <div className="mini-heading">
                    <strong>接管已有知识库 + 绑定已有 Agent 工具</strong>
                    <span>只登记真实路径，不迁移、不覆盖旧目录。</span>
                  </div>
                  <div className="field-grid">
                    <label className="wide">
                      已有知识库根目录
                      <div className="inline-field">
                        <input value={adoptRootPath} onChange={(event) => setAdoptRootPath(event.target.value)} placeholder="例如 D:\\学生资料\\李四知识库" />
                        <button className="secondary compact" onClick={selectAdoptRoot}>
                          选择目录
                        </button>
                      </div>
                    </label>
                    <label>
                      Agent 类型
                      <select
                        value={agentBindingMode}
                        onChange={(event) => setAgentBindingMode(event.target.value as AgentBindingMode)}
                      >
                        <option value="subAgent" disabled={!selectedTool.supportsSubAgent}>子 Agent</option>
                        <option value="mainChat">主对话 / 普通对话</option>
                      </select>
                    </label>
                    <label>
                      Agent 名称或会话备注
                      <input value={agentNameDraft} onChange={(event) => setAgentNameDraft(event.target.value)} placeholder={`${sanitizeName(draft.name)} AI教育管家`} />
                    </label>
                    <label className="wide">
                      绑定备注
                      <input value={agentNoteDraft} onChange={(event) => setAgentNoteDraft(event.target.value)} placeholder="例如：旧 QClaw Agent 已存在，仅更新 Soul 工作规则" />
                    </label>
                  </div>
                  <div className="actions compact-actions">
                    <button className="secondary" onClick={scanAdoptKnowledgeBase}>
                      <RefreshCw size={18} />
                      扫描目录
                    </button>
                    <button className="secondary" onClick={() => ensureAdoptedWorkspace(false)}>
                      <FolderOpen size={18} />
                      补齐缺失项
                    </button>
                    <button className="secondary danger" onClick={() => ensureAdoptedWorkspace(true)}>
                      写入标准 AGENT.md
                    </button>
                  </div>
                  <div className="checklist adopt-checklist">
                    <div className="checklist-title">
                      <ListChecks size={18} />
                      <strong>已有知识库扫描结果</strong>
                    </div>
                    {adoptChecklist.map((item) => (
                      <div className={item.status.includes('已') ? 'check-row done' : 'check-row'} key={item.label}>
                        <CheckCircle2 size={17} />
                        <span>{item.label}：{item.status}</span>
                      </div>
                    ))}
                  </div>
                  <div className="field-grid">
                    <label className="wide">
                      AGENT.md
                      <input value={adoptPaths.agentPath} onChange={(event) => setAdoptPaths({ ...adoptPaths, agentPath: event.target.value })} />
                    </label>
                    <label className="wide">
                      原始资料库
                      <input value={adoptPaths.rawPath} onChange={(event) => setAdoptPaths({ ...adoptPaths, rawPath: event.target.value })} />
                    </label>
                    <label className="wide">
                      学情分析汇总
                      <input value={adoptPaths.summaryPath} onChange={(event) => setAdoptPaths({ ...adoptPaths, summaryPath: event.target.value })} />
                    </label>
                    <label className="wide">
                      输出结果
                      <input value={adoptPaths.outputPath} onChange={(event) => setAdoptPaths({ ...adoptPaths, outputPath: event.target.value })} />
                    </label>
                  </div>
                  {adoptMessage && <div className="notice muted">{adoptMessage}</div>}
                </section>
              )}

              <div className="actions">
                <button className="primary" onClick={copyPrompt}>
                  <Clipboard size={18} />
                  {copied ? '已复制指令' : '复制当前步骤指令'}
                </button>
                <button className="secondary" onClick={copyFullPrompt}>
                  <Clipboard size={18} />
                  复制完整初始化指令
                </button>
                <button className="secondary" onClick={exportBundle}>
                  <FileDown size={18} />
                  {exported ? '已导出初始文档' : '导出初始文档'}
                </button>
                <button className="secondary" onClick={addStudent}>
                  <CheckCircle2 size={18} />
                  {createMode === 'adopted' ? '确认接管' : '保存学生档案'}
                </button>
                <button className="secondary" onClick={() => selectedToolAdapter.open(openExternal)}>
                  <ExternalLink size={18} />
                  {selectedTool.openLabel}
                </button>
              </div>
            </section>

            <section className="panel prompt-panel">
              <div className="panel-heading">
                <div>
                  <h2>{selectedTool.name} 分步骤初始化</h2>
                  <p>{selectedTool.copyTargetLabel}；熟练用户可直接复制完整初始化指令。</p>
                </div>
                <div className="heading-actions">
                  <button
                    className={advancedPromptOpen ? 'secondary compact active advanced-toggle' : 'secondary compact advanced-toggle'}
                    onClick={() => setAdvancedPromptOpen((value) => !value)}
                    aria-pressed={advancedPromptOpen}
                    title={advancedPromptOpen ? '收起高级指令' : '显示高级指令'}
                  >
                    高级
                  </button>
                  <button className="icon-button" onClick={copyPrompt} aria-label="复制当前步骤指令">
                    <Clipboard size={18} />
                  </button>
                </div>
              </div>
              <div className="step-command-layout">
                <div className="step-command-list">
                  {initSteps.map((step) => (
                    <button
                      className={step.id === selectedInitStep ? 'step-command active' : 'step-command'}
                      key={step.id}
                      onClick={() => setSelectedInitStep(step.id)}
                    >
                      <strong>{step.title}</strong>
                      <span>{step.description}</span>
                    </button>
                  ))}
                </div>
                <div className={advancedPromptOpen ? 'advanced-command-editor open' : 'advanced-command-editor'}>
                  {advancedPromptOpen ? (
                    <>
                      <div className="mini-heading">
                        <strong>{initSteps.find((step) => step.id === selectedInitStep)?.title ?? '当前步骤'}指令</strong>
                        <span>可直接编辑，复制当前步骤时会使用这里的内容。</span>
                      </div>
                      <textarea
                        className="command-textarea"
                        value={selectedInitPrompt}
                        onChange={(event) => setCustomStepPrompts((current) => ({ ...current, [selectedInitStep]: event.target.value }))}
                      />
                    </>
                  ) : (
                    <div className="command-hidden-card" aria-hidden="true" />
                  )}
                </div>
              </div>
            </section>
          </div>
        )}

        {!shouldBlockForAgentInstall && !isLicenseRestrictedSection && activeSection === 'inbox' && selectedStudent && (
          <section className="panel inbox-panel">
            <div className="panel-heading">
              <div>
                <h2>资料收集与处理</h2>
                <p>{isWindows ? '集中处理本机文件导入和资料消化指令，资料直接进入当前学生原始资料库。' : '集中处理拍照、图片、下载文件、Downloads 扫描、分享资料和待消化动作。'}</p>
              </div>
              <FileDown size={22} />
            </div>
            <div className="archive-grid">
              <InfoPanel icon={<UserRound />} title="当前学生" value={`${selectedStudent.name} · ${selectedStudentTool.name}`} />
              <InfoPanel icon={<Archive />} title="待消化资料" value={`${pendingDigestValue(selectedStudent)} 个`} />
              <InfoPanel icon={<FolderOpen />} title="分享收件箱" value={`${sharedInboxCount} 个待归档`} />
            </div>
            <StudentToolSelector
              value={selectedStudent.agentTool}
              onChange={changeSelectedStudentTool}
            />
            <div className="actions">
              <button className="primary" onClick={() => selectedStudentAdapter.open(openExternal)}>
                <ExternalLink size={18} />
                {selectedStudentTool.openLabel}
              </button>
              {!isWindows && (
                <>
                  <button
                    className="secondary"
                    onClick={() => takePhotoForStudent(selectedStudent)}
                  >
                    <FileDown size={18} />
                    拍照导入
                  </button>
                  <button className="primary" onClick={() => importImagesForStudent(selectedStudent)}>
                    <FileDown size={18} />
                    导入图片
                  </button>
                </>
              )}
              <button className="secondary" onClick={() => importFilesForStudent(selectedStudent)}>
                <FileDown size={18} />
                {isWindows ? '导入本机资料' : '导入下载文件'}
              </button>
              {!isWindows && (
                <>
                  <button className="secondary" onClick={scanDownloadsRecent}>
                    <RefreshCw size={18} />
                    扫描 Downloads 最近文件
                  </button>
                  <button className="secondary" onClick={() => consumeSharedForStudent(selectedStudent)} disabled={sharedInboxCount === 0}>
                    <Archive size={18} />
                    接收分享资料
                  </button>
                </>
              )}
              <button className="secondary" onClick={() => copyDigestCommand(selectedStudent)}>
                <Clipboard size={18} />
                消化资料
              </button>
              <button className="secondary" onClick={() => markDigestSubmitted(selectedStudent)}>
                <CheckCircle2 size={18} />
                标记已提交消化
              </button>
              {isWindows && (
                <button className="secondary" onClick={() => syncDigestResult(selectedStudent)}>
                  <RefreshCw size={18} />
                  同步消化结果
                </button>
              )}
              {isWindows && (
                <button className="secondary" onClick={() => openStudentRawDir(selectedStudent)}>
                  <FolderOpen size={18} />
                  打开学生原始资料库
                </button>
              )}
            </div>
            {isWindows && (
              <section className="material-source-panel">
                <div className="mini-heading">
                  <strong>资料来源目录</strong>
                  <span>来源目录只用于发现资料；导入后统一复制到当前学生原始资料库，Agent 仍只消化原始资料库。</span>
                </div>
                <div className="actions">
                  <button className="secondary" onClick={() => addMaterialSourceDir(selectedStudent)}>
                    <Plus size={18} />
                    添加来源目录
                  </button>
                  <button className="primary" onClick={() => scanMaterialSourcesForStudent(selectedStudent)} disabled={(selectedStudent.materialSources ?? []).filter((source) => source.enabled).length === 0}>
                    <RefreshCw size={18} />
                    扫描全部来源
                  </button>
                  <button className="secondary" onClick={() => refreshMaterialImportRecords(selectedStudent)}>
                    <Archive size={18} />
                    刷新导入记录
                  </button>
                </div>
                {(selectedStudent.materialSources ?? []).length > 0 ? (
                  <div className="material-source-list">
                    {(selectedStudent.materialSources ?? []).map((source) => (
                      <div className="material-source-item" key={source.id}>
                        <label>
                          <input type="checkbox" checked={source.enabled} onChange={() => toggleMaterialSource(selectedStudent, source.id)} />
                          <span>
                            <strong>{source.name}</strong>
                            <small>{source.path}</small>
                            {source.lastScannedAt && <em>最近扫描：{new Date(source.lastScannedAt).toLocaleString('zh-CN')}</em>}
                          </span>
                        </label>
                        <button className="secondary compact" onClick={() => removeMaterialSource(selectedStudent, source.id)}>删除</button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">尚未添加资料来源目录。可添加 Downloads、截图、微信/QQ 文件或扫描仪输出目录。</div>
                )}
                {materialSourceFiles.length > 0 && (
                  <div className="material-source-results">
                    <div className="mini-heading">
                      <strong>待导入文件</strong>
                      <span>已导入或重复文件会自动标记并默认跳过。</span>
                    </div>
                    <div className="download-list material-source-file-list">
                      {materialSourceFiles.map((file) => (
                        <label className={file.importable ? 'download-item' : 'download-item disabled'} key={file.id}>
                          <input
                            type="checkbox"
                            checked={selectedMaterialSourcePaths.includes(file.path)}
                            disabled={!file.importable}
                            onChange={() => toggleMaterialSourceFile(file.path)}
                          />
                          <span>
                            <strong>{file.name}</strong>
                            <small>
                              {file.sourceName} · {file.type} · {formatFileSize(file.size)} · {file.modified ? new Date(file.modified).toLocaleString('zh-CN') : '未知时间'}
                            </small>
                            {file.reason && <em>{file.reason}</em>}
                          </span>
                        </label>
                      ))}
                    </div>
                    <div className="actions">
                      <button className="primary" onClick={() => importSelectedMaterialSourceFiles(selectedStudent)} disabled={selectedMaterialSourcePaths.length === 0}>
                        <FileDown size={18} />
                        导入选中文件
                      </button>
                      <button
                        className="secondary"
                        onClick={() => setSelectedMaterialSourcePaths(materialSourceFiles.filter((file) => file.importable).map((file) => file.path))}
                      >
                        全选新文件
                      </button>
                      <span className="inline-hint">已选 {selectedMaterialSourcePaths.length} 个</span>
                    </div>
                  </div>
                )}
                {materialImportRecords.length > 0 && (
                  <div className="material-import-records">
                    <div className="mini-heading">
                      <strong>最近导入记录</strong>
                      <span>记录来源目录、目标文件和导入时间，便于追踪资料来源。</span>
                    </div>
                    <div className="record-list compact-record-list">
                      {materialImportRecords.slice(0, 8).map((record) => (
                        <div className="record-item" key={record.id}>
                          <strong>{record.fileName}</strong>
                          <small>{record.sourceName || '未知来源'} → {record.targetPath || '原始资料库'}</small>
                          <em>{record.importedAt ? new Date(record.importedAt).toLocaleString('zh-CN') : '未知时间'} · {formatFileSize(record.fileSize)}</em>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}
            {downloadFiles.length > 0 && (
              <section className="download-scan">
                <div className="mini-heading">
                  <strong>Downloads 最近文件</strong>
                  <span>默认显示最近 50 个可导入资料文件，勾选后复制到当前学生原始资料库。</span>
                </div>
                <div className="download-list">
                  {downloadFiles.map((file) => (
                    <label className={file.importable ? 'download-item' : 'download-item disabled'} key={file.id}>
                      <input
                        type="checkbox"
                        checked={selectedDownloadPaths.includes(file.path)}
                        disabled={!file.importable}
                        onChange={() => toggleDownloadFile(file.path)}
                      />
                      <span>
                        <strong>{file.name}</strong>
                        <small>
                          {file.type} · {formatFileSize(file.size)} · {file.modified ? new Date(file.modified).toLocaleString('zh-CN') : '未知时间'}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
                <div className="actions">
                  <button className="primary" onClick={() => importSelectedDownloads(selectedStudent)}>
                    <FileDown size={18} />
                    导入选中文件
                  </button>
                  <button className="secondary" onClick={() => setSelectedDownloadPaths(downloadFiles.filter((file) => file.importable).map((file) => file.path))}>
                    全选可导入
                  </button>
                </div>
              </section>
            )}
            <div className="notice muted">
              {isWindows ? '本机知识库目录' : '公开资料目录'}：{selectedStudentPaths.root}；导入资料会复制到
              {` ${selectedStudentPaths.raw}`}。{selectedStudentTool.supportsLocalFiles ? '' : `${selectedStudentTool.name} 通常不会自动读取安卓本机目录，需把资料或消化指令复制/分享给 ${selectedStudentTool.name} 后执行。`}
            </div>
            <div className="notice muted">
              消化状态：{digestStatusText(selectedStudent)}
            </div>
            {inboxMessage && <div className="notice">{inboxMessage}</div>}
            {downloadsMessage && <div className="notice">{downloadsMessage}</div>}
            {importMessage && <div className="notice">{importMessage}</div>}
            {digestMessage && <div className="notice">{digestMessage}</div>}
          </section>
        )}

        {!shouldBlockForAgentInstall && !isLicenseRestrictedSection && isWindows && activeSection === 'assets' && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>文件资产中心</h2>
                <p>底层资产索引只记录文件指纹、路径和引用关系，不改变学生原始资料库的现有文件夹体验。</p>
              </div>
              <Archive size={22} />
            </div>
            <div className="archive-grid">
              <InfoPanel icon={<Archive />} title="资产总数" value={`${assetIndex.total ?? assetIndex.assets.length} 个`} />
              <InfoPanel icon={<ListChecks />} title="重复文件组" value={`${assetIndex.duplicateGroups ?? 0} 组`} />
              <InfoPanel icon={<UserRound />} title="学生过滤" value={assetStudentFilter === 'all' ? '全部学生' : students.find((student) => student.id === assetStudentFilter)?.name ?? '当前筛选'} />
            </div>
            <div className="actions">
              <button className="secondary" onClick={refreshAssets}>
                <RefreshCw size={18} />
                刷新资产
              </button>
              <button className="primary" onClick={rebuildAssets}>
                <Archive size={18} />
                扫描并补建资产索引
              </button>
            </div>
            <div className="form-grid compact-grid">
              <label>
                搜索文件
                <input value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} placeholder="文件名、路径、SHA-1、来源" />
              </label>
              <label>
                学生
                <select value={assetStudentFilter} onChange={(event) => setAssetStudentFilter(event.target.value)}>
                  <option value="all">全部学生</option>
                  {students.map((student) => (
                    <option value={student.id} key={student.id}>{student.name}</option>
                  ))}
                </select>
              </label>
              <label>
                来源
                <select value={assetSourceFilter} onChange={(event) => setAssetSourceFilter(event.target.value)}>
                  <option value="all">全部来源</option>
                  {assetSources.map((source) => (
                    <option value={source} key={source}>{source}</option>
                  ))}
                </select>
              </label>
              <label>
                类型
                <select value={assetTypeFilter} onChange={(event) => setAssetTypeFilter(event.target.value)}>
                  <option value="all">全部类型</option>
                  {assetTypes.map((type) => (
                    <option value={type} key={type}>{type}</option>
                  ))}
                </select>
              </label>
              <label className="checkbox-line">
                <input type="checkbox" checked={assetDuplicateOnly} onChange={(event) => setAssetDuplicateOnly(event.target.checked)} />
                只看重复 SHA-1 文件
              </label>
            </div>
            <div className="download-list asset-list">
              {filteredAssets.slice(0, 160).map((asset) => (
                <button className={selectedAsset?.assetId === asset.assetId ? 'download-item active' : 'download-item'} key={asset.assetId} onClick={() => setSelectedAssetId(asset.assetId)}>
                  <span>
                    <strong>{asset.filename}</strong>
                    <small>
                      {asset.ownerStudentName || '未绑定学生'} · {asset.type || 'file'} · {formatFileSize(asset.size ?? 0)} · 引用 {asset.referenceCount ?? asset.references?.length ?? 0} 次
                    </small>
                    <small>{asset.path}</small>
                    {asset.sha1 && <em>SHA-1：{asset.sha1}{Number(asset.duplicateCount ?? 1) > 1 ? ` · 重复 ${asset.duplicateCount} 份` : ''}</em>}
                  </span>
                </button>
              ))}
              {filteredAssets.length === 0 && <div className="empty-state">暂无资产记录。导入资料、平板上传或点击“扫描并补建资产索引”后会在这里显示。</div>}
            </div>
            {filteredAssets.length > 160 && <div className="notice muted">当前仅显示前 160 条资产，可通过搜索、学生过滤或重复文件过滤缩小范围。</div>}
            {selectedAsset && (
              <section className="material-source-panel">
                <div className="mini-heading">
                  <strong>资产引用详情</strong>
                  <span>{selectedAsset.filename}</span>
                </div>
                <div className="archive-grid">
                  <InfoPanel icon={<FileText />} title="资产编号" value={selectedAsset.assetId} />
                  <InfoPanel icon={<Archive />} title="引用次数" value={`${selectedAsset.references?.length ?? selectedAsset.referenceCount ?? 0} 次`} />
                  <InfoPanel icon={<ListChecks />} title="重复数量" value={`${selectedAsset.duplicateCount ?? 1} 份`} />
                </div>
                <div className="download-list">
                  {(selectedAsset.references ?? []).map((reference) => (
                    <div className="download-item" key={reference.id}>
                      <span>
                        <strong>{reference.spaceName || reference.spaceId}</strong>
                        <small>{reference.spaceType} · {reference.role} · {reference.source || '未知来源'}</small>
                        <small>{reference.path}</small>
                      </span>
                    </div>
                  ))}
                  {(selectedAsset.references ?? []).length === 0 && <div className="empty-state">该资产暂无引用记录。</div>}
                </div>
              </section>
            )}
            {duplicateAssetGroups.length > 0 && (
              <section className="material-source-panel">
                <div className="mini-heading">
                  <strong>重复文件分组</strong>
                  <span>仅做治理提示，不会自动删除物理文件。</span>
                </div>
                <div className="download-list">
                  {duplicateAssetGroups.slice(0, 20).map((group) => (
                    <div className="download-item" key={group.sha1}>
                      <span>
                        <strong>{group.assets.length} 份重复文件</strong>
                        <small>SHA-1：{group.sha1}</small>
                        <small>建议：保留引用最多或所在目录最稳定的一份，其他文件先标记为重复观察，不自动删除。</small>
                        <small>候选保留：{group.assets[0]?.path || '待确认'}</small>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {assetMessage && <div className="notice">{assetMessage}</div>}
          </section>
        )}

        {!shouldBlockForAgentInstall && !isLicenseRestrictedSection && isWindows && activeSection === 'projects' && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>学习项目知识空间</h2>
                <p>项目独立使用 LLM Wiki 目录消化资料，完成后通过“知识贡献申请”进入学生主档案。</p>
              </div>
              <FolderOpen size={22} />
            </div>
            <div className="archive-grid">
              <InfoPanel icon={<FolderOpen />} title="项目数量" value={`${projects.length} 个`} />
              <InfoPanel icon={<Archive />} title="当前项目资产" value={`${selectedProject?.assetIds?.length ?? 0} 个`} />
              <InfoPanel icon={<UserRound />} title="绑定学生" value={selectedProject?.studentNames?.join('、') || '未选择项目'} />
            </div>
            <section className="material-source-panel">
              <div className="mini-heading">
                <strong>新建学习项目</strong>
                <span>会同时创建用户项目空间和项目知识空间；项目资料默认不污染学生主档案。</span>
              </div>
              <div className="form-grid compact-grid">
                <label>
                  项目名称
                  <input value={projectDraft.name} onChange={(event) => setProjectDraft((current) => ({ ...current, name: event.target.value }))} placeholder="例如：AI创意大赛" />
                </label>
                <label>
                  项目类型
                  <input value={projectDraft.type} onChange={(event) => setProjectDraft((current) => ({ ...current, type: event.target.value }))} placeholder="学习项目 / 竞赛 / 升学 / 学科专题" />
                </label>
                <div className="wide-field">
                  <span>绑定学生（可多选）</span>
                  <div className="student-checkbox-list compact">
                    {students.map((student) => (
                      <label className="student-checkbox" key={student.id}>
                        <input type="checkbox" checked={projectDraft.studentIds.includes(student.id)} onChange={() => toggleProjectDraftStudent(student.id)} />
                        <span>{student.name}</span>
                      </label>
                    ))}
                    {students.length === 0 && <div className="empty-state compact">请先创建学生档案。</div>}
                  </div>
                  <small className="inline-hint">已选 {projectDraft.studentIds.length} 个学生；项目完成后可分别发布贡献到每个学生主档案。</small>
                </div>
              </div>
              <div className="actions">
                <button className="primary" onClick={createLearningProject}>
                  <Plus size={18} />
                  创建项目知识空间
                </button>
                <button className="secondary" onClick={refreshProjects}>
                  <RefreshCw size={18} />
                  刷新项目
                </button>
              </div>
            </section>

            <div className="learning-report-layout">
              <aside className="learning-report-list">
                {projects.map((project) => (
                  <button
                    className={selectedProject?.id === project.id ? 'learning-report-card active' : 'learning-report-card'}
                    key={project.id}
                    onClick={() => {
                      setSelectedProjectId(project.id);
                      setSelectedProjectAssetIds([]);
                      setSelectedProjectStagingIds([]);
                      setPromotionPreview('');
                      setPromotionPlan(null);
                      setPromotionExecutionSummary('');
                    }}
                  >
                    <strong>{project.name}</strong>
                    <span>{project.type} · {projectStatusLabel(project.status)}</span>
                    <small>{project.studentNames?.join('、') || '未绑定学生'}</small>
                    <em>{project.knowledgeRootPath}</em>
                  </button>
                ))}
                {projects.length === 0 && <div className="empty-state">尚未创建学习项目。</div>}
              </aside>
              <section className="markdown-reader">
                {selectedProject ? (
                  <>
                    <div className="reader-toolbar">
                      <span>{selectedProject.name}</span>
                      <div className="reader-actions">
                        <button className="secondary compact" onClick={() => generateSelectedProjectPromotion()}>
                          生成贡献申请
                        </button>
                        <button className="secondary compact" onClick={loadSelectedProjectPromotionPlan}>
                          归档确认清单
                        </button>
                        <button className="primary compact" onClick={executeSelectedProjectPromotionPlan} disabled={!promotionPlan?.items?.length}>
                          执行归档
                        </button>
                        <button className="primary compact" onClick={publishSelectedProjectPromotion}>
                          发布到成长模型
                        </button>
                      </div>
                    </div>
                    <div className="archive-grid">
                      <InfoPanel icon={<FolderOpen />} title="项目根目录" value={selectedProject.projectRootPath} />
                      <InfoPanel icon={<Archive />} title="项目原始资料库" value={selectedProject.rawPath} />
                      <InfoPanel icon={<FileText />} title="知识贡献目录" value={selectedProject.promotionPath || '未生成'} />
                      <InfoPanel icon={<ListChecks />} title="项目状态" value={projectStatusLabel(selectedProject.status)} />
                      <InfoPanel icon={<Clock3 />} title="最近更新" value={selectedProject.updatedAt ? new Date(selectedProject.updatedAt).toLocaleString('zh-CN') : '暂无记录'} />
                      <InfoPanel icon={<UserRound />} title="绑定学生" value={selectedProject.studentNames?.join('、') || '未绑定'} />
                    </div>
                    <div className="form-grid compact-grid">
                      <label>
                        项目状态
                        <select value={selectedProject.status || 'active'} onChange={(event) => updateSelectedProjectStatus(event.target.value)}>
                          <option value="draft">草稿</option>
                          <option value="active">进行中</option>
                          <option value="pending_archive">待归档</option>
                          <option value="archived">已归档</option>
                          <option value="published">已发布</option>
                          <option value="sealed">已封存</option>
                        </select>
                      </label>
                      <label>
                        归档时间
                        <input readOnly value={selectedProject.archivedAt ? new Date(selectedProject.archivedAt).toLocaleString('zh-CN') : '尚未归档'} />
                      </label>
                      <label>
                        发布时间
                        <input readOnly value={selectedProject.publishedAt ? new Date(selectedProject.publishedAt).toLocaleString('zh-CN') : '尚未发布'} />
                      </label>
                    </div>
                    <section className="material-source-panel">
                      <div className="mini-heading">
                        <strong>项目绑定学生</strong>
                        <span>学习项目支持绑定多个学生。调整后会同步项目绑定索引，不会覆盖已经手工修改过的 AGENT.md。</span>
                      </div>
                      <div className="student-checkbox-list">
                        {students.map((student) => {
                          const nextIds = selectedProject.studentIds?.includes(student.id)
                            ? selectedProject.studentIds.filter((id) => id !== student.id)
                            : [...(selectedProject.studentIds ?? []), student.id];
                          return (
                            <label className="student-checkbox" key={student.id}>
                              <input type="checkbox" checked={selectedProject.studentIds?.includes(student.id) ?? false} onChange={() => updateSelectedProjectStudents(nextIds)} />
                              <span>{student.name}</span>
                            </label>
                          );
                        })}
                        {students.length === 0 && <div className="empty-state compact">暂无学生可绑定。</div>}
                      </div>
                      <small className="inline-hint">当前绑定：{selectedProject.studentNames?.join('、') || '未绑定学生'}</small>
                    </section>
                    <section className="material-source-panel">
                      <div className="mini-heading">
                        <strong>研究暂存层</strong>
                        <span>先收集和筛选项目研究资料；晋升后才会进入正式文件资产中心和项目原始资料库。</span>
                      </div>
                      <div className="archive-grid">
                        <InfoPanel icon={<Inbox />} title="暂存资料" value={`${projectStagingItems.length} 份`} />
                        <InfoPanel icon={<ListChecks />} title="已选" value={`${selectedProjectStagingItems.length} 份`} />
                        <InfoPanel icon={<FolderOpen />} title="暂存目录" value={selectedProject.stagingPath || `${selectedProject.workspacePath}\\研究暂存`} />
                        <InfoPanel icon={<Archive />} title="治理候选" value={`${projectStagingGovernanceStats.actionCount} 项`} />
                      </div>
                      <div className="form-grid compact-grid staging-filter-grid">
                        <label>
                          搜索暂存资料
                          <input value={projectStagingSearch} onChange={(event) => setProjectStagingSearch(event.target.value)} placeholder="文件名、路径、AI建议或理由" />
                        </label>
                        <label>
                          状态筛选
                          <select value={projectStagingStatusFilter} onChange={(event) => setProjectStagingStatusFilter(event.target.value as 'all' | ProjectStagingStatus)}>
                            <option value="all">全部状态</option>
                            <option value="collected">已收集</option>
                            <option value="screened">已初筛</option>
                            <option value="selected">选入分析</option>
                            <option value="analyzed">已分析</option>
                            <option value="promoted">已晋升</option>
                            <option value="discarded">已归档/丢弃</option>
                          </select>
                        </label>
                      </div>
                      <div className="actions compact-actions">
                        <button className="primary compact" onClick={importFilesToProjectStaging}>
                          <FileDown size={16} />
                          导入到研究暂存
                        </button>
                        <button className="secondary compact" onClick={copyProjectStagingAiScreeningPrompt} disabled={projectStagingItems.length === 0}>
                          复制 AI 初筛指令
                        </button>
                        <button className="secondary compact" onClick={importProjectStagingAiScreening} disabled={projectStagingItems.length === 0}>
                          导入 AI 初筛结果
                        </button>
                        <button className="secondary compact" onClick={analyzeProjectStagingGovernance} disabled={projectStagingItems.length === 0}>
                          生成治理建议
                        </button>
                        <button className="secondary compact" onClick={selectVisibleProjectStagingItems} disabled={filteredProjectStagingItems.length === 0}>
                          选择当前筛选
                        </button>
                        <button className="secondary compact" onClick={selectProjectGovernanceCandidates} disabled={projectStagingGovernanceStats.governanceCandidateIds.length === 0}>
                          选择治理候选
                        </button>
                        <button className="secondary compact" onClick={selectProjectPromotionCandidates} disabled={projectStagingGovernanceStats.promotionCandidateIds.length === 0}>
                          选择待晋升
                        </button>
                        <button className="secondary compact" onClick={() => setSelectedProjectStagingIds([])} disabled={selectedProjectStagingIds.length === 0}>
                          清空选择
                        </button>
                        <button className="secondary compact" onClick={() => updateSelectedProjectStagingStatus('screened')} disabled={selectedProjectStagingIds.length === 0}>
                          标记初筛
                        </button>
                        <button className="secondary compact" onClick={() => updateSelectedProjectStagingStatus('selected')} disabled={selectedProjectStagingIds.length === 0}>
                          选入分析
                        </button>
                        <button className="secondary compact" onClick={() => updateSelectedProjectStagingStatus('analyzed')} disabled={selectedProjectStagingIds.length === 0}>
                          标记已分析
                        </button>
                        <button className="primary compact" onClick={promoteSelectedProjectStagingItems} disabled={selectedProjectStagingIds.length === 0}>
                          晋升为正式资产
                        </button>
                        <button className="secondary compact danger-soft" onClick={() => updateSelectedProjectStagingStatus('discarded')} disabled={selectedProjectStagingIds.length === 0}>
                          丢弃/归档
                        </button>
                      </div>
                      <small className="inline-hint">当前显示 {filteredProjectStagingItems.length} / {projectStagingItems.length} 份；重复候选 {projectStagingGovernanceStats.duplicateCount} 份；AI 导入和治理建议都不会自动删除或晋升资料。</small>
                      <div className="download-list project-staging-list">
                        {filteredProjectStagingItems.map((item) => (
                          <label className={item.status === 'discarded' ? 'download-item staging-item discarded' : 'download-item staging-item'} key={item.id}>
                            <input type="checkbox" checked={selectedProjectStagingIds.includes(item.id)} onChange={() => toggleProjectStagingItem(item.id)} />
                            <span>
                              <strong>{item.filename}</strong>
                              <small>
                                <em className={`staging-status-pill ${String(item.status || 'collected')}`}>{projectStagingStatusLabel(item.status)}</em>
                                {item.type || 'file'} · {formatFileSize(item.size ?? 0)}
                              </small>
                              <small>{item.sourcePath || item.path}</small>
                              {item.promotedAssetId && <small>资产编号：{item.promotedAssetId}</small>}
                              {item.aiAction && (
                                <small className="staging-ai-note">
                                  AI建议：{item.aiAction}{item.aiScore !== undefined && item.aiScore !== '' ? ` · 评分 ${item.aiScore}` : ''}
                                </small>
                              )}
                              {item.aiReason && <small className="staging-ai-note">AI理由：{item.aiReason}</small>}
                              {item.governanceAction && (
                                <small className="staging-ai-note">
                                  治理建议：{item.governanceAction}{Number(item.duplicateCount ?? 1) > 1 ? ` · 重复 ${item.duplicateCount} 份` : ''}{item.stagingAgeDays !== undefined && item.stagingAgeDays !== '' ? ` · 暂存 ${item.stagingAgeDays} 天` : ''}
                                </small>
                              )}
                              {item.governanceReason && <small className="staging-ai-note">治理理由：{item.governanceReason}</small>}
                            </span>
                          </label>
                        ))}
                        {filteredProjectStagingItems.length === 0 && (
                          <div className="empty-state">
                            {projectStagingItems.length === 0
                              ? '还没有研究暂存资料。可先导入论文、网页快照、截图或候选资料，筛选后再晋升为正式资产。'
                              : '当前筛选条件下没有暂存资料。'}
                          </div>
                        )}
                      </div>
                    </section>
                    <div className="mini-heading">
                      <strong>从资产中心加入项目</strong>
                      <span>只建立资产引用并复制到项目原始资料库，不直接合并进学生主档案。</span>
                    </div>
                    <div className="download-list project-asset-picker">
                      {projectCandidateAssets.map((asset) => (
                        <label className="download-item" key={asset.assetId}>
                          <input type="checkbox" checked={selectedProjectAssetIds.includes(asset.assetId)} onChange={() => toggleProjectAsset(asset.assetId)} />
                          <span>
                            <strong>{asset.filename}</strong>
                            <small>{asset.ownerStudentName || '未绑定学生'} · {formatFileSize(asset.size ?? 0)}</small>
                            <small>{asset.path}</small>
                          </span>
                        </label>
                      ))}
                      {projectCandidateAssets.length === 0 && <div className="empty-state">暂无可加入项目的资产。可先到“文件资产中心”补建索引，或导入学生资料。</div>}
                    </div>
                    <div className="actions">
                      <button className="primary" onClick={importSelectedAssetsToProject} disabled={selectedProjectAssetIds.length === 0}>
                        <FileDown size={18} />
                        加入项目知识空间
                      </button>
                      <span className="inline-hint">已选 {selectedProjectAssetIds.length} 个</span>
                    </div>
                    {promotionPlan && (
                      <section className="material-source-panel">
                        <div className="mini-heading">
                          <strong>归档确认清单</strong>
                          <span>逐项选择动作：引用只记录来源；发布写入学生汇总或成长模型；吸收会复制文件到学生原始资料库。</span>
                        </div>
                        <div className="archive-grid">
                          <InfoPanel icon={<ListChecks />} title="清单条目" value={`${promotionPlan.items.length} 项`} />
                          <InfoPanel icon={<UserRound />} title="目标学生" value={promotionPlan.students?.map((student) => student.name).join('、') || '未绑定'} />
                          <InfoPanel icon={<Archive />} title="将执行" value={`${promotionPlan.items.filter((item) => item.action !== 'skip').length} 项`} />
                        </div>
                        <div className="actions compact-actions">
                          <button className="secondary compact" onClick={() => setPromotionPlanBatchAction('files', 'reference')}>文件全部引用</button>
                          <button className="secondary compact" onClick={() => setPromotionPlanBatchAction('files', 'absorb')}>文件全部吸收</button>
                          <button className="secondary compact" onClick={() => setPromotionPlanBatchAction('knowledge', 'publish')}>知识全部发布</button>
                          <button className="secondary compact" onClick={() => setPromotionPlanBatchAction('all', 'skip')}>全部跳过</button>
                        </div>
                        {promotionExecutionPreview && (
                          <div className="notice muted">
                            <strong>执行前预览</strong>
                            <pre className="inline-pre">{promotionExecutionPreview}</pre>
                          </div>
                        )}
                        <div className="download-list">
                          {promotionPlan.items.map((item) => (
                            <div className="download-item" key={item.id}>
                              <span>
                                <strong>{item.title}</strong>
                                <small>{item.kind} · {item.targetHint || '目标待确认'}</small>
                                <small>{item.sourcePath || item.assetId || item.content}</small>
                              </span>
                              <select value={item.action} onChange={(event) => updatePromotionPlanItemAction(item.id, event.target.value as PromotionAction)}>
                                {item.allowedActions.map((action) => (
                                  <option value={action} key={action}>
                                    {promotionActionLabel(action)}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ))}
                        </div>
                        {promotionExecutionSummary && <div className="notice">{promotionExecutionSummary}</div>}
                      </section>
                    )}
                    {promotionPreview && (
                      <div className="markdown-reader learning-report-reader">
                        <div className="reader-toolbar">
                          <span>知识贡献申请预览</span>
                          <button className="secondary compact" onClick={() => copyText(promotionPreview, '已复制项目知识贡献申请。')}>
                            <Clipboard size={16} />
                            复制
                          </button>
                        </div>
                        <MarkdownView content={promotionPreview} />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="empty-state">选择或创建一个学习项目后，可绑定资产、生成项目知识贡献申请。</div>
                )}
              </section>
            </div>
            {projectMessage && <div className="notice">{projectMessage}</div>}
          </section>
        )}

        {!shouldBlockForAgentInstall && !isLicenseRestrictedSection && isWindows && activeSection === 'growth' && selectedStudent && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>{selectedStudent.name} · 成长模型</h2>
                <p>Growth Layer 用于沉淀能力、兴趣、趋势和项目证据；学情报告逐步从这里生成。</p>
              </div>
              <Sparkles size={22} />
            </div>
            <div className="archive-grid">
              <InfoPanel icon={<UserRound />} title="当前学生" value={`${selectedStudent.name} · ${selectedStudent.grade}`} />
              <InfoPanel icon={<FolderOpen />} title="知识库目录" value={selectedStudentPaths.root} />
              <InfoPanel icon={<FileText />} title="学情报告目录" value={selectedStudentPaths.reportDir} />
            </div>
            <div className="actions">
              <button className="primary" onClick={ensureSelectedGrowthModel}>
                <Sparkles size={18} />
                补建成长模型
              </button>
              <button className="secondary" onClick={() => refreshLearningReports(selectedStudent)}>
                <RefreshCw size={18} />
                刷新学情报告
              </button>
              <button className="secondary" onClick={() => setActiveSection('reports')}>
                <FileText size={18} />
                查看学情报告
              </button>
              <button className="secondary" onClick={() => setActiveSection('archive')}>
                <BookOpen size={18} />
                查看教育档案
              </button>
            </div>
            <div className="notice muted">
              成长模型 v1 会在学生知识库下创建“成长模型”目录，并维护 index、能力画像、成长证据和项目贡献四类 Markdown 索引。它不会替换现有综合汇总库，而是作为学情报告的上层来源。
            </div>
            <div className="learning-report-layout">
              <aside className="learning-report-list">
                {learningReportDefinitions.map((definition) => (
                  <button className="learning-report-card" key={definition.id} onClick={() => openLearningReport(definition.id, selectedStudent)}>
                    <strong>{definition.title}</strong>
                    <span>{definition.description}</span>
                    <small>报告中会逐步增加成长证据来源和项目贡献来源。</small>
                  </button>
                ))}
              </aside>
              <section className="markdown-reader">
                <div className="reader-toolbar">
                  <span>Growth Layer 工作方式</span>
                </div>
                <MarkdownView content={`# ${selectedStudent.name} 成长模型\n\n## 定位\n\n成长模型不是普通摘要文件夹，而是学生能力、兴趣、趋势、证据来源和项目贡献的长期索引。\n\n## 建议维护对象\n\n- 能力画像：记录学生在学科、研究、表达、协作、创造等方面的长期变化。\n- 成长证据：记录每条能力判断对应的原始资料、项目、报告或问答来源。\n- 项目贡献：记录学习项目完成后发布到学生主档案的知识贡献。\n- 学情报告：作为面向家长、学生和教师的呈现层输出。\n\n## 下一步\n\n点击“补建成长模型”后，可让 Agent 围绕成长模型目录持续维护这些索引。`} />
              </section>
            </div>
            {growthMessage && <div className="notice">{growthMessage}</div>}
          </section>
        )}

        {!shouldBlockForAgentInstall && activeSection === 'reports' && selectedStudent && (
          <section className="panel reports-panel">
            <div className="panel-heading">
              <div>
                <h2>{selectedStudent.name} · 学情报告</h2>
                <p>给家长、学生和教师看的表达层报告；原始证据和完整文件树仍在“查看教育档案”。</p>
              </div>
              <FileText size={22} />
            </div>
            <div className="archive-grid">
              <InfoPanel icon={<UserRound />} title="当前学生" value={`${selectedStudent.name} · ${selectedStudent.grade}`} />
              <InfoPanel icon={<BookOpen />} title="报告目录" value={learningReportFolder || selectedStudentPaths.reportDir} />
              <InfoPanel icon={<Archive />} title="报告数量" value={`${learningReports.length || learningReportDefinitions.length} 份`} />
              <InfoPanel icon={<ListChecks />} title="报告提醒" value={learningReportHealth?.message || '刷新后显示报告健康度'} />
            </div>
            <div className="actions">
              <button className="secondary" onClick={() => refreshLearningReports(selectedStudent)}>
                <RefreshCw size={18} />
                刷新报告
              </button>
              <button className="secondary" onClick={() => ensureLearningReportTemplates(selectedStudent)} disabled={!windowsLicenseActive}>
                <FileText size={18} />
                补建报告目录
              </button>
              <button className="secondary" onClick={() => openStudentRoot(selectedStudent)} disabled={!windowsLicenseActive}>
                <FolderOpen size={18} />
                打开知识库目录
              </button>
              <button className="primary" onClick={() => setActiveSection('archive')}>
                <BookOpen size={18} />
                查看全部档案
              </button>
            </div>
            {!windowsLicenseActive && (
              <div className="notice warning-notice">
                未激活状态仅支持浏览已存在的学情报告；补建报告目录和打开本机知识库目录需激活后使用。
              </div>
            )}
            <div className="learning-report-layout">
              <aside className="learning-report-list">
                {learningReportDefinitions.map((definition) => {
                  const report = learningReports.find((item) => item.id === definition.id);
                  return (
                    <button
                      className={selectedLearningReportId === definition.id ? 'learning-report-card active' : 'learning-report-card'}
                      key={definition.id}
                      onClick={() => openLearningReport(definition.id, selectedStudent)}
                    >
                      <strong>{definition.title}</strong>
                      <span>{definition.description}</span>
                      <small>{report?.updatedAt ? `更新：${new Date(report.updatedAt).toLocaleString('zh-CN')}` : report?.exists === false ? '模板待创建' : '待读取'}</small>
                      <em>{report?.status || 'draft'} · {report?.summary || '待生成'}</em>
                      {report?.warnings && report.warnings.length > 0 ? (
                        <small className="warning-text">{report.warnings.join('；')}</small>
                      ) : (
                        <small className="success-text">{report?.exists ? '报告状态正常' : '等待创建报告模板'}</small>
                      )}
                    </button>
                  );
                })}
              </aside>
              <section className="markdown-reader learning-report-reader">
                <div className="reader-toolbar">
                  <span>{learningReports.find((item) => item.id === selectedLearningReportId)?.title ?? '学情报告'}</span>
                  <div className="reader-actions">
                    <button className="secondary compact" onClick={() => setLearningReportViewMode(learningReportViewMode === 'rendered' ? 'source' : 'rendered')}>
                      {learningReportViewMode === 'rendered' ? '查看原文' : '阅读模式'}
                    </button>
                    <button className="secondary compact" onClick={() => copyText(learningReportContent, '已复制当前学情报告 Markdown。')} disabled={!learningReportContent}>
                      <Clipboard size={16} />
                      复制正文
                    </button>
                  </div>
                </div>
                {learningReportContent ? (
                  learningReportViewMode === 'rendered' ? <MarkdownView content={learningReportContent} /> : <pre className="markdown-raw">{learningReportContent}</pre>
                ) : (
                  <div className="empty-state">点击左侧报告卡片，可查看整体画像、历史变化、每日行动建议和阶段总结。</div>
                )}
              </section>
            </div>
            {learningReportHealth?.warnings && learningReportHealth.warnings.length > 0 && (
              <div className="notice warning-notice">
                <strong>报告待完善</strong>
                <p>{learningReportHealth.warnings.join('；')}</p>
              </div>
            )}
            {learningReportMessage && <div className="notice muted">{learningReportMessage}</div>}
          </section>
        )}

        {!shouldBlockForAgentInstall && activeSection === 'archive' && selectedStudent && (
          <section className="panel archive-panel">
            <div className="archive-header">
              <span className="large-avatar">{selectedStudent.name.slice(0, 1)}</span>
              <div>
                <h2>{selectedStudent.name} · {getAgentToolProfile(selectedStudent.agentTool).name}</h2>
                <p>
                  {selectedStudent.grade} · {selectedStudent.school}
                </p>
              </div>
            </div>
            <div className="archive-grid">
              <InfoPanel icon={<UserRound />} title="学生目标" value={selectedStudent.goal} />
              <InfoPanel
                icon={<Clock3 />}
                title="每日资料消化"
                value={`${selectedStudent.digestTime} · ${
                  getAgentToolProfile(selectedStudent.agentTool).supportsScheduledTask
                    ? `${getAgentToolProfile(selectedStudent.agentTool).name} 定时执行`
                    : '手动复制执行'
                }`}
              />
              <InfoPanel icon={<BookOpen />} title="内置档案" value={selectedStudentPaths.summary} />
            </div>
            <StudentToolSelector
              value={selectedStudent.agentTool}
              onChange={changeSelectedStudentTool}
              disabled={!windowsLicenseActive}
            />
            {!windowsLicenseActive && (
              <div className="notice warning-notice">
                当前为未激活只读浏览模式。可查看已有档案，但不能更换资料根目录、删除学生、编辑学生资料或迁移知识库。
              </div>
            )}
            <div className="status-grid">
              <div className="status-card">
                <span>初始化包版本</span>
                <strong>v{selectedStudent.schemaVersion ?? initSchemaVersion}</strong>
              </div>
              <div className="status-card">
                <span>学生资料目录</span>
                <strong>{selectedStudentPaths.root}</strong>
              </div>
              <div className="status-card">
                <span>原始资料库</span>
                <strong>{selectedStudentPaths.raw}</strong>
              </div>
              <div className="status-card">
                <span>学情分析汇总</span>
                <strong>{selectedStudentPaths.summary}</strong>
              </div>
              <div className="status-card">
                <span>知识库模式</span>
                <strong>{selectedStudent.knowledgeBaseMode === 'adopted' ? '接管已有目录' : '标准知识库'}</strong>
              </div>
              <div className="status-card">
                <span>AGENT.md</span>
                <strong>{selectedStudentPaths.agent}</strong>
              </div>
              <div className="status-card">
                <span>最近导入资料</span>
                <strong>{selectedStudent.lastImportAt ?? '暂无记录'}</strong>
              </div>
              <div className="status-card">
                <span>消化闭环状态</span>
                <strong>{digestStatusText(selectedStudent)}</strong>
              </div>
            </div>
            <div className="actions">
              <button className="secondary" onClick={authorizeArchiveRoot} disabled={!windowsLicenseActive}>
                <FolderOpen size={18} />
                {isWindows ? '更换资料根目录' : '授权 Obsidian Vault'}
              </button>
              <button className="secondary" onClick={() => refreshMarkdownFiles(selectedStudent)}>
                <RefreshCw size={18} />
                刷新档案
              </button>
              <button className="secondary" onClick={() => setArchiveListVisible((value) => !value)}>
                {archiveListVisible ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
                {archiveListVisible ? '隐藏文档列表' : '显示文档列表'}
              </button>
              <button className="primary" onClick={() => openExternal('obsidian')}>
                <ExternalLink size={18} />
                打开 Obsidian
              </button>
              <button className="secondary danger" onClick={() => deleteStudent(selectedStudent)} disabled={!windowsLicenseActive}>
                删除学生记录
              </button>
            </div>
            {studentEditDraft && (
              <section className="student-profile-editor">
                <div className="mini-heading">
                  <strong>学生资料编辑</strong>
                  <span>用于调整姓名、年级、学校和目标；保存资料不会自动移动本机知识库目录。</span>
                </div>
                <div className="field-grid">
                  <label>
                    学生姓名
                    <input value={studentEditDraft.name} onChange={(event) => setStudentEditDraft({ ...studentEditDraft, name: event.target.value })} />
                  </label>
                  <label>
                    年级
                    <input value={studentEditDraft.grade} onChange={(event) => setStudentEditDraft({ ...studentEditDraft, grade: event.target.value })} />
                  </label>
                  <label>
                    学校
                    <input value={studentEditDraft.school} onChange={(event) => setStudentEditDraft({ ...studentEditDraft, school: event.target.value })} />
                  </label>
                  <label>
                    每日消化时间
                    <input type="time" value={studentEditDraft.digestTime} onChange={(event) => setStudentEditDraft({ ...studentEditDraft, digestTime: event.target.value })} />
                  </label>
                  <label className="wide">
                    当前目标
                    <textarea value={studentEditDraft.goal} onChange={(event) => setStudentEditDraft({ ...studentEditDraft, goal: event.target.value })} />
                  </label>
                </div>
                <div className="actions">
                  <button className="primary" onClick={saveSelectedStudentProfile} disabled={!windowsLicenseActive}>
                    保存学生资料
                  </button>
                  {isWindows && selectedStudent.knowledgeBaseMode !== 'adopted' && (
                    <>
                      <button className="secondary" onClick={migrateSelectedStudentWorkspace} disabled={!windowsLicenseActive}>
                        <FolderOpen size={18} />
                        迁移/重命名知识库目录
                      </button>
                      <button className="secondary" onClick={() => openStudentRawDir(selectedStudent)} disabled={!windowsLicenseActive}>
                        <FolderOpen size={18} />
                        打开原始资料库
                      </button>
                      <button className="secondary" onClick={() => copyStudentProfileUpdatePrompt(selectedStudent)}>
                        <Clipboard size={18} />
                        复制资料变更提示
                      </button>
                    </>
                  )}
                  {isWindows && selectedStudent.knowledgeBaseMode === 'adopted' && (
                    <button className="secondary" onClick={() => openStudentRawDir(selectedStudent)} disabled={!windowsLicenseActive}>
                      <FolderOpen size={18} />
                      打开学生原始资料库
                    </button>
                  )}
                </div>
              </section>
            )}
            {isWindows && (
              <section className="archive-keyword-editor">
                <div className="mini-heading">
                  <strong>档案分类关键词</strong>
                  <span>用逗号分隔；只影响浏览分类，不移动、不重命名 Markdown 文件。</span>
                </div>
                <div className="field-grid">
                  <label>
                    资料摘要
                    <input value={archiveKeywords.summary} onChange={(event) => updateArchiveKeyword('summary', event.target.value)} />
                  </label>
                  <label>
                    综合汇总
                    <input value={archiveKeywords.report} onChange={(event) => updateArchiveKeyword('report', event.target.value)} />
                  </label>
                  <label>
                    问答精华
                    <input value={archiveKeywords.qa} onChange={(event) => updateArchiveKeyword('qa', event.target.value)} />
                  </label>
                </div>
                <div className="actions">
                  <button className="secondary" onClick={resetArchiveKeywords}>恢复默认关键词</button>
                </div>
              </section>
            )}
            <div className="category-tabs">
              {archiveCategories.map((category) => (
                <button
                  className={selectedArchiveCategory === category.id ? 'category-tab active' : 'category-tab'}
                  key={category.id}
                  onClick={() => setSelectedArchiveCategory(category.id)}
                >
                  {category.label}
                </button>
              ))}
            </div>
            <div className={archiveListVisible ? 'archive-browser' : 'archive-browser list-hidden'}>
              {archiveListVisible && (
                <aside className="markdown-list">
                  <div className="mini-heading">
                    <strong>{archiveCategories.find((item) => item.id === selectedArchiveCategory)?.label ?? '学情分析汇总'}</strong>
                    <span>{archiveRootMessage}</span>
                  </div>
                  {markdownFiles.length === 0 ? (
                    <div className="empty-state">{isWindows ? '保存学生档案后点击“刷新档案”，这里会读取同一个本机学情分析汇总目录。' : '保存学生档案后点击“刷新档案”，这里会优先显示 App 内置学情 Markdown；Obsidian 授权是高级可选模式。'}</div>
                  ) : filteredMarkdownFiles.length === 0 ? (
                    <div className="empty-state">该分类下暂无 Markdown 文件，可切换到“全部文件”查看真实文件树。</div>
                  ) : (
                    filteredMarkdownFiles.map((file) => (
                      <button
                        className={file.id === selectedMarkdownId ? 'markdown-item active' : 'markdown-item'}
                        key={file.id}
                        onClick={() => openMarkdownFile(file)}
                      >
                        <strong>{file.name}</strong>
                        <span>{file.path}</span>
                        {file.modified && <small>更新：{new Date(file.modified).toLocaleString()}</small>}
                      </button>
                    ))
                  )}
                </aside>
              )}
              <section className="markdown-reader">
                <div className="reader-toolbar">
                  <span>{selectedMarkdownId ? filteredMarkdownFiles.find((file) => file.id === selectedMarkdownId)?.name ?? 'Markdown 档案' : 'Markdown 档案'}</span>
                  <div className="reader-actions">
                    <button className="secondary compact" onClick={() => setMarkdownViewMode(markdownViewMode === 'rendered' ? 'source' : 'rendered')}>
                      {markdownViewMode === 'rendered' ? '查看原文' : '阅读模式'}
                    </button>
                    {!archiveListVisible && (
                      <button className="secondary compact" onClick={() => setArchiveListVisible(true)}>
                        <PanelLeftOpen size={16} />
                        文档列表
                      </button>
                    )}
                  </div>
                </div>
                {markdownContent ? (
                  markdownViewMode === 'rendered' ? <MarkdownView content={markdownContent} /> : <pre className="markdown-raw">{markdownContent}</pre>
                ) : (
                  <div className="empty-state">选择一个 Markdown 文件后，可直接在控制台内查看消化后的学情档案。</div>
                )}
              </section>
            </div>
            {markdownMessage && <div className="notice muted">{markdownMessage}</div>}
          </section>
        )}

        {!shouldBlockForAgentInstall && !isLicenseRestrictedSection && activeSection === 'qa' && selectedStudent && (
          <section className="panel qa-panel">
            <div className="panel-heading">
              <div>
                <h2>教育管家问答</h2>
                <p>打开当前学生绑定的 Agent 工具，并复制问答、消化和初始化所需内容。</p>
              </div>
              <MessageCircle size={22} />
            </div>
            <div className="archive-grid">
              <InfoPanel icon={<UserRound />} title="当前学生" value={`${selectedStudent.name} · ${selectedStudentTool.name}`} />
              <InfoPanel icon={<Bot />} title="Agent 工具" value={selectedStudentTool.name} />
              <InfoPanel icon={<Archive />} title="待消化资料" value={`${pendingDigestValue(selectedStudent)} 个`} />
            </div>
            <StudentToolSelector
              value={selectedStudent.agentTool}
              onChange={changeSelectedStudentTool}
            />
            <div className="actions">
              <button className="primary" onClick={() => selectedStudentAdapter.open(openExternal)}>
                <ExternalLink size={18} />
                {selectedStudentTool.openLabel}
              </button>
              <button className="secondary" onClick={() => copyDigestCommand(selectedStudent)}>
                <Clipboard size={18} />
                复制资料消化指令
              </button>
              <button className="secondary" onClick={() => openStudentRoot(selectedStudent)}>
                <FolderOpen size={18} />
                打开学生知识库目录
              </button>
              <button className="secondary" onClick={() => markDigestSubmitted(selectedStudent)}>
                <CheckCircle2 size={18} />
                标记已提交消化
              </button>
              {isWindows && (
                <button className="secondary" onClick={() => syncDigestResult(selectedStudent)}>
                  <RefreshCw size={18} />
                  同步消化结果
                </button>
              )}
              <button className="secondary" onClick={copyConsultCommand}>
                <Clipboard size={18} />
                复制咨询提示
              </button>
              <button className="secondary" onClick={() => copyText(unifiedMemoryText || agentCenter?.unifiedMemory || buildMemoryMd(selectedStudent), '已复制统一记忆。')}>
                <Clipboard size={18} />
                复制统一记忆
              </button>
              <button className="secondary" onClick={() => copyText(unifiedSoulText || agentCenter?.unifiedSoul || buildSoulMd(selectedStudent), '已复制统一 Soul。')}>
                <Clipboard size={18} />
                复制统一 Soul
              </button>
              {selectedStudentTool.supportsProjectRules && (
                <>
                  <button className="secondary" onClick={() => generateAgentRule(selectedStudentAdapter.primaryRuleFile())}>
                    <ListChecks size={18} />
                    生成{selectedStudentAdapter.primaryRuleFile() || '工具规则'}
                  </button>
                  <button className="secondary" onClick={() => {
                    refreshAgentRules(selectedStudent.id, selectedStudentAdapter.primaryRuleFile());
                    setAgentKnowledgeMenuOpen(true);
                    setActiveSection('rules');
                  }}>
                    <ListChecks size={18} />
                    编辑工具规则
                  </button>
                </>
              )}
              <button className="secondary" onClick={() => {
                refreshAgentCenter(selectedStudent.id);
                setAgentKnowledgeMenuOpen(true);
                setActiveSection('memory');
              }}>
                <RefreshCw size={18} />
                同步 Agent 记忆
              </button>
              {selectedStudent.knowledgeBaseMode === 'adopted' && (
                <>
                  <button className="secondary" onClick={() => copyStudentSoul(selectedStudent)}>
                    <Clipboard size={18} />
                    复制更新后的 Soul 内容
                  </button>
                  <button className="secondary" onClick={() => copyStudentWorkRule(selectedStudent)}>
                    <Clipboard size={18} />
                    复制工作规则
                  </button>
                </>
              )}
            </div>
            <section className="remote-config">
              <div className="mini-heading">
                <strong>远控联系绑定</strong>
                <span>这里只记录给平板端显示的联系入口；实际 QClaw 远控绑定仍在企业微信或 QQ 中完成。</span>
              </div>
              <div className="form-grid compact-grid">
                <label>
                  联系渠道
                  <select
                    value={selectedStudent.remoteChannel ?? 'none'}
                    onChange={(event) => updateSelectedStudentRemote({ remoteChannel: event.target.value as Student['remoteChannel'] })}
                  >
                    <option value="none">暂未绑定</option>
                    <option value="wecom">企业微信</option>
                    <option value="qq">QQ</option>
                    <option value="both">企业微信 + QQ</option>
                  </select>
                </label>
                <label>
                  联系备注
                  <input
                    value={selectedStudent.remoteContact ?? ''}
                    placeholder="例如：包老师企业微信 / QQ 群 / 客服号"
                    onChange={(event) => updateSelectedStudentRemote({ remoteContact: event.target.value })}
                  />
                </label>
                <label>
                  绑定状态
                  <select
                    value={selectedStudent.remoteBindingStatus ?? 'unbound'}
                    onChange={(event) => updateSelectedStudentRemote({ remoteBindingStatus: event.target.value as Student['remoteBindingStatus'] })}
                  >
                    <option value="unbound">未绑定</option>
                    <option value="pending">待确认</option>
                    <option value="bound">已绑定</option>
                  </select>
                </label>
              </div>
              <label className="wide-field">
                给平板端显示的说明
                <textarea
                  value={selectedStudent.remoteNote ?? ''}
                  placeholder="可留空。平板端会按当前渠道自动显示：请在企业微信/QQ中联系AI教育管家，复制咨询提示。"
                  onChange={(event) => updateSelectedStudentRemote({ remoteNote: event.target.value })}
                />
              </label>
              <div className="notice muted">
                绑定建议：先在 QClaw 中完成企微或 QQ 远控绑定；确认可收到“/咨询，我想咨询”后，把状态改为“已绑定”。
                {selectedStudent.remoteBoundAt ? ` 已绑定时间：${selectedStudent.remoteBoundAt}` : ''}
              </div>
              <div className="remote-wizard">
                <strong>绑定向导</strong>
                <ol>
                  <li>在 QClaw 中打开该学生的「AI教育管家」Agent。</li>
                  <li>按实际远控方式选择企业微信、QQ 或两者，并填写联系人、群或客服备注。</li>
                  <li>在企业微信或 QQ 中发送测试消息：/咨询，我想咨询。</li>
                  <li>确认 QClaw 能收到并回复后，将绑定状态改为“已绑定”。</li>
                </ol>
                <div className="actions compact-actions">
                  <button className="secondary" onClick={copyConsultCommand}>
                    <Clipboard size={16} />
                    复制远控测试提示
                  </button>
                  <button className="secondary" onClick={() => updateSelectedStudentRemote({ remoteBindingStatus: 'pending' })}>
                    标记待确认
                  </button>
                  <button className="primary" onClick={() => updateSelectedStudentRemote({ remoteBindingStatus: 'bound' })}>
                    标记已绑定
                  </button>
                </div>
              </div>
            </section>
            <div className="notice muted">
              {selectedStudentTool.supportsScheduledTask
                ? `${selectedStudentTool.name} 可按初始化指令创建每日资料消化任务。`
                : `${selectedStudentTool.name} 暂按手动复制资料消化指令执行，后续可由控制台做提醒。`}
            </div>
            {digestMessage && <div className="notice">{digestMessage}</div>}
          </section>
        )}

        {!shouldBlockForAgentInstall && !isLicenseRestrictedSection && activeSection === 'memory' && selectedStudent && (
          <section className="panel qa-panel">
            <div className="panel-heading">
              <div>
                <h2>Agent 记忆管理</h2>
                <p>备份不同 Agent 工具里的 Memory，并合并为当前学生的 UnifiedMemory.md。</p>
              </div>
              <Clipboard size={22} />
            </div>
            <div className="archive-grid">
              <InfoPanel icon={<UserRound />} title="当前学生" value={selectedStudent.name} />
              <InfoPanel icon={<FolderOpen />} title="统一记忆文件" value={agentCenter?.unifiedMemoryPath || selectedStudent.memoryConfig?.unifiedMemoryPath || '未生成'} />
              <InfoPanel icon={<Archive />} title="来源数量" value={`${agentCenter?.memoryIndex?.sources?.filter((item) => item.exists).length ?? 0} 个`} />
            </div>
            <div className="form-grid compact-grid">
              <label>
                来源 Agent 工具
                <select value={memorySourceTool} onChange={(event) => setMemorySourceTool(event.target.value as AgentToolId)}>
                  {agentToolOptions.map((tool) => (
                    <option value={tool.id} key={tool.id}>{tool.name}</option>
                  ))}
                </select>
              </label>
              <label>
                来源能力
                <input readOnly value={getAgentToolProfile(memorySourceTool).supportsMemoryFile ? '支持文件或粘贴导入' : '建议粘贴导入'} />
              </label>
            </div>
            <label className="wide-field">
              粘贴来源 Memory
              <textarea value={memorySourceText} onChange={(event) => setMemorySourceText(event.target.value)} placeholder="从 QClaw / Hohu / Marvis / OpenClaw 复制该学生 Memory 后粘贴到这里。" />
            </label>
            <div className="actions compact-actions">
              <button className="primary" onClick={saveMemorySource}>保存来源 Memory</button>
              <button className="secondary" onClick={() => scanAgentKnowledgeFiles('memory')}>扫描 Agent 记忆文件</button>
              <button className="secondary" onClick={() => copyAiAgentScanPrompt('memory')}>复制 AI 扫描指令</button>
              <button className="secondary" onClick={mergeMemory}>合并为 UnifiedMemory.md</button>
              <button className="secondary" onClick={saveUnifiedMemoryText}>保存统一记忆</button>
              <button className="secondary" onClick={() => copyText(unifiedMemoryText, '已复制统一记忆。')}>复制统一记忆</button>
              <button className="secondary" onClick={() => refreshAgentCenter()}>刷新</button>
            </div>
            <div className="ai-scan-box">
              <div className="mini-heading">
                <strong>AI 辅助扫描</strong>
                <span>把“AI 扫描指令”复制到 QClaw / Marvis / OpenClaw / Hohu 执行，再把 JSON 结果粘贴回来。</span>
              </div>
              <textarea
                value={aiScanResultText}
                onChange={(event) => setAiScanResultText(event.target.value)}
                placeholder='粘贴 AI 返回的 JSON，例如：{"candidates":[{"path":"C:\\Users\\...\\.qclaw\\workspace-agent-xxx\\MEMORY.md","kind":"memory","tool":"qclaw","score":90,"reasons":["内容包含学生姓名"]}]}'
              />
              <div className="actions compact-actions">
                <button className="secondary" onClick={() => parseAiAgentScanResult('memory')}>导入 AI 扫描结果</button>
                <button className="secondary" onClick={importSelectedCandidates}>批量导入勾选候选</button>
                <button className="secondary" onClick={() => setAiScanResultText('')}>清空结果</button>
              </div>
            </div>
            {memoryScanCandidates.length > 0 && (
              <div className="candidate-list">
                <div className="mini-heading">
                  <strong>Memory 候选</strong>
                  <span>来自本机自动扫描或 AI 扫描结果；请确认后再导入。</span>
                </div>
                {memoryScanCandidates.map((candidate) => (
                  <div className="candidate-row" key={candidate.path}>
                    <label className="checkbox-line">
                      <input type="checkbox" checked={selectedCandidateKeys.includes(candidateKey(candidate))} onChange={() => toggleCandidateSelection(candidate)} />
                      <span>勾选导入</span>
                    </label>
                    <div className="candidate-main">
                      <strong>{candidate.name}</strong>
                      <span>{getAgentToolProfile(candidate.tool).name} · 分数 {candidate.score} · {formatFileSize(candidate.size || 0)}{candidate.mtime ? ` · ${new Date(candidate.mtime).toLocaleString()}` : ''}</span>
                      <small>{candidate.path}</small>
                    </div>
                    <div className="candidate-reasons">
                      {(candidate.reasons || ['文件名匹配记忆文件']).slice(0, 4).map((reason) => <span key={reason}>{reason}</span>)}
                    </div>
                    {candidate.preview && <pre className="candidate-preview">{candidate.preview}</pre>}
                    <button className="secondary compact" onClick={() => importAgentCandidate(candidate)}>导入为来源 Memory</button>
                  </div>
                ))}
              </div>
            )}
            <label className="wide-field">
              UnifiedMemory.md
              <textarea className="large-textarea" value={unifiedMemoryText} onChange={(event) => setUnifiedMemoryText(event.target.value)} />
            </label>
            {candidateImportReviewPanel}
            <div className="source-list">
              {(agentCenter?.memoryIndex?.sources ?? []).map((source) => (
                <div className="source-row" key={source.tool}>
                  <strong>{getAgentToolProfile(source.tool).name}</strong>
                  <span>{source.exists ? '已保存' : '未导入'}</span>
                  <small>{source.currentPath}</small>
                </div>
              ))}
            </div>
            {sourceRegistryPanel}
            {agentScanMessage && activeSection === 'memory' && <div className="notice muted">{agentScanMessage}</div>}
            {agentCenterMessage && <div className="notice">{agentCenterMessage}</div>}
          </section>
        )}

        {!shouldBlockForAgentInstall && !isLicenseRestrictedSection && activeSection === 'soul' && selectedStudent && (
          <section className="panel qa-panel">
            <div className="panel-heading">
              <div>
                <h2>Agent 设定管理</h2>
                <p>维护统一 Soul，备份不同工具的人设版本，并对比差异后手动调整。</p>
              </div>
              <Bot size={22} />
            </div>
            <div className="archive-grid">
              <InfoPanel icon={<UserRound />} title="当前学生" value={selectedStudent.name} />
              <InfoPanel icon={<FolderOpen />} title="统一 Soul 文件" value={agentCenter?.unifiedSoulPath || selectedStudent.soulConfig?.unifiedSoulPath || '未生成'} />
              <InfoPanel icon={<Bot />} title="默认工具" value={selectedStudentTool.name} />
            </div>
            <div className="form-grid compact-grid">
              <label>
                来源 Agent 工具
                <select value={soulSourceTool} onChange={(event) => setSoulSourceTool(event.target.value as AgentToolId)}>
                  {agentToolOptions.map((tool) => (
                    <option value={tool.id} key={tool.id}>{tool.name}</option>
                  ))}
                </select>
              </label>
              <label>
                分发目标
                <input readOnly value={getAgentToolProfile(soulSourceTool).personaTargetLabel} />
              </label>
            </div>
            <label className="wide-field">
              粘贴来源 Soul / 人设
              <textarea value={soulSourceText} onChange={(event) => setSoulSourceText(event.target.value)} placeholder="从对应 Agent 工具复制该学生人设、Soul 或角色设定后粘贴到这里。" />
            </label>
            <div className="actions compact-actions">
              <button className="primary" onClick={saveSoulSource}>保存来源 Soul 备份</button>
              <button className="secondary" onClick={() => scanAgentKnowledgeFiles('soul')}>扫描 Agent 人设文件</button>
              <button className="secondary" onClick={() => copyAiAgentScanPrompt('soul')}>复制 AI 扫描指令</button>
              <button className="secondary" onClick={compareSoulSource}>对比来源与统一 Soul</button>
              <button className="secondary" onClick={saveUnifiedSoulText}>保存统一 Soul</button>
              <button className="secondary" onClick={() => copyText(unifiedSoulText, '已复制统一 Soul。')}>复制统一 Soul</button>
              <button className="secondary" onClick={() => copyStudentWorkRule(selectedStudent)}>复制工作规则</button>
              <button className="secondary" onClick={() => refreshAgentCenter()}>刷新</button>
            </div>
            <div className="ai-scan-box">
              <div className="mini-heading">
                <strong>AI 辅助扫描</strong>
                <span>适合查找工具内部工作区的人设、Soul、系统提示词和角色配置文件。</span>
              </div>
              <textarea
                value={aiScanResultText}
                onChange={(event) => setAiScanResultText(event.target.value)}
                placeholder='粘贴 AI 返回的 JSON，例如：{"candidates":[{"path":"C:\\Users\\...\\.qclaw\\workspace-agent-xxx\\Soul.md","kind":"soul","tool":"qclaw","score":90,"reasons":["内容包含 AGENT.md 路径"]}]}'
              />
              <div className="actions compact-actions">
                <button className="secondary" onClick={() => parseAiAgentScanResult('soul')}>导入 AI 扫描结果</button>
                <button className="secondary" onClick={importSelectedCandidates}>批量导入勾选候选</button>
                <button className="secondary" onClick={() => setAiScanResultText('')}>清空结果</button>
              </div>
            </div>
            {soulScanCandidates.length > 0 && (
              <div className="candidate-list">
                <div className="mini-heading">
                  <strong>Soul / 人设候选</strong>
                  <span>来自本机自动扫描或 AI 扫描结果；请确认后再导入。</span>
                </div>
                {soulScanCandidates.map((candidate) => (
                  <div className="candidate-row" key={candidate.path}>
                    <label className="checkbox-line">
                      <input type="checkbox" checked={selectedCandidateKeys.includes(candidateKey(candidate))} onChange={() => toggleCandidateSelection(candidate)} />
                      <span>勾选导入</span>
                    </label>
                    <div className="candidate-main">
                      <strong>{candidate.name}</strong>
                      <span>{getAgentToolProfile(candidate.tool).name} · 分数 {candidate.score} · {formatFileSize(candidate.size || 0)}{candidate.mtime ? ` · ${new Date(candidate.mtime).toLocaleString()}` : ''}</span>
                      <small>{candidate.path}</small>
                    </div>
                    <div className="candidate-reasons">
                      {(candidate.reasons || ['文件名匹配人设文件']).slice(0, 4).map((reason) => <span key={reason}>{reason}</span>)}
                    </div>
                    {candidate.preview && <pre className="candidate-preview">{candidate.preview}</pre>}
                    <button className="secondary compact" onClick={() => importAgentCandidate(candidate)}>导入为来源 Soul</button>
                  </div>
                ))}
              </div>
            )}
            <label className="wide-field">
              UnifiedSoul.md
              <textarea className="large-textarea" value={unifiedSoulText} onChange={(event) => setUnifiedSoulText(event.target.value)} />
            </label>
            {candidateImportReviewPanel}
            {soulDiff && (
              <div className="diff-grid">
                <div>
                  <strong>统一 Soul 独有</strong>
                  <pre>{(soulDiff.onlyUnified ?? []).join('\n') || '无明显差异'}</pre>
                </div>
                <div>
                  <strong>来源 Soul 独有</strong>
                  <pre>{(soulDiff.onlySource ?? []).join('\n') || '无明显差异'}</pre>
                </div>
              </div>
            )}
            <div className="source-list">
              {(agentCenter?.soulIndex?.sources ?? []).map((source) => (
                <div className="source-row" key={source.tool}>
                  <strong>{getAgentToolProfile(source.tool).name}</strong>
                  <span>{source.exists ? '已备份' : '未导入'}</span>
                  <small>{source.currentPath}</small>
                </div>
              ))}
            </div>
            {sourceRegistryPanel}
            {agentScanMessage && activeSection === 'soul' && <div className="notice muted">{agentScanMessage}</div>}
            {agentCenterMessage && <div className="notice">{agentCenterMessage}</div>}
          </section>
        )}

        {!shouldBlockForAgentInstall && !isLicenseRestrictedSection && activeSection === 'rules' && selectedStudent && (
          <section className="panel qa-panel">
            <div className="panel-heading">
              <div>
                <h2>智能体规则文件管理</h2>
                <p>管理当前学生知识库根目录下的 AGENT.md、AGENTS.md、CLAUDE.md、IMA.md、WorkBuddy.md 等规则性 Markdown 文件。</p>
              </div>
              <ListChecks size={22} />
            </div>
            <div className="archive-grid">
              <InfoPanel icon={<UserRound />} title="当前学生" value={selectedStudent.name} />
              <InfoPanel icon={<FolderOpen />} title="知识库根目录" value={agentRules?.rootPath || selectedStudentPaths.root} />
              <InfoPanel icon={<Archive />} title="规则文件" value={`${ruleFiles.filter((file) => file.exists).length} 个已存在`} />
            </div>
            <div className="form-grid compact-grid">
              <label>
                规则文件
                <select
                  value={ruleFileName}
                  onChange={(event) => {
                    const nextName = event.target.value;
                    const nextFile = ruleFiles.find((file) => file.fileName === nextName);
                    setRuleFileName(nextName);
                    setRuleContent(nextFile?.content || '');
                  }}
                >
                  {ruleFiles.map((file) => (
                    <option value={file.fileName} key={file.fileName}>
                      {file.fileName}{file.exists ? '' : '（未创建）'}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                新建或改名为
                <input
                  value={ruleFileName}
                  onChange={(event) => setRuleFileName(event.target.value)}
                  placeholder="例如 AGENTS.md / CLAUDE.md / OpenClaw.md / WorkBuddy.md"
                />
              </label>
            </div>
            <div className="notice muted">
              {selectedRuleFile?.exists
                ? `当前文件：${selectedRuleFile.path}${selectedRuleFile.mtime ? ` · 更新 ${new Date(selectedRuleFile.mtime).toLocaleString('zh-CN')}` : ''}`
                : `保存后将在知识库根目录创建：${ruleFileName || '规则文件.md'}`}
            </div>
            <label className="wide-field">
              规则文件内容
              <textarea className="large-textarea" value={ruleContent} onChange={(event) => setRuleContent(event.target.value)} />
            </label>
            <div className="actions compact-actions">
              <button className="primary" onClick={saveAgentRule}>保存规则文件</button>
              <button className="secondary" onClick={() => refreshAgentRules()}>刷新规则文件</button>
              <button className="secondary" onClick={() => copyText(ruleContent, '已复制规则文件内容。')}>复制规则内容</button>
              <button className="secondary" onClick={() => openStudentRoot(selectedStudent)}>打开知识库目录</button>
              <button className="secondary" onClick={() => generateAgentRule('AGENTS.md')}>生成 AGENTS.md</button>
              <button className="secondary" onClick={() => generateAgentRule('CLAUDE.md')}>生成 CLAUDE.md</button>
              <button className="secondary" onClick={() => generateAgentRule(selectedStudentAdapter.primaryRuleFile())}>生成当前工具规则</button>
              <button className="secondary" onClick={compareAgentRule}>对比 AGENT.md</button>
              <button className="secondary" onClick={() => copyAiAgentScanPrompt('rule')}>复制规则 AI 扫描指令</button>
            </div>
            <div className="ai-scan-box">
              <div className="mini-heading">
                <strong>规则文件 AI 扫描</strong>
                <span>支持 candidates / results / files 三种返回字段。</span>
              </div>
              <div className="form-grid compact-grid">
                <label>
                  扫描工具
                  <select value={aiScanTool} onChange={(event) => setAiScanTool(event.target.value as AgentToolId | 'all')}>
                    <option value="all">全部工具</option>
                    {agentToolOptions.map((tool) => <option value={tool.id} key={tool.id}>{tool.name}</option>)}
                  </select>
                </label>
                <label>
                  扫描类型
                  <select value={aiScanKind} onChange={(event) => setAiScanKind(event.target.value as AgentKnowledgeKind | 'all')}>
                    <option value="all">全部</option>
                    <option value="memory">记忆</option>
                    <option value="soul">人设</option>
                    <option value="rule">规则文件</option>
                    <option value="conversation">对话历史</option>
                  </select>
                </label>
              </div>
              <textarea value={aiScanResultText} onChange={(event) => setAiScanResultText(event.target.value)} placeholder='粘贴 AI 返回的 JSON，例如 {"results":[{"path":"D:\\学生资料\\张三知识库\\AGENTS.md","kind":"rule","tool":"codex","score":90}]}' />
              <div className="actions compact-actions">
                <button className="secondary" onClick={() => parseAiAgentScanResult(aiScanKind)}>导入 AI 扫描结果</button>
                <button className="secondary" onClick={importSelectedCandidates}>批量导入勾选候选</button>
                <button className="secondary" onClick={() => setAiScanResultText('')}>清空结果</button>
              </div>
            </div>
            {ruleScanCandidates.length > 0 && (
              <div className="candidate-list">
                <div className="mini-heading">
                  <strong>规则文件候选</strong>
                  <span>勾选后可批量导入，导入时会保存到学生知识库根目录并写来源记录。</span>
                </div>
                {ruleScanCandidates.map((candidate) => (
                  <div className="candidate-row" key={candidate.path}>
                    <label className="checkbox-line">
                      <input type="checkbox" checked={selectedCandidateKeys.includes(candidateKey(candidate))} onChange={() => toggleCandidateSelection(candidate)} />
                      <span>{candidate.name}</span>
                    </label>
                    <div className="candidate-main">
                      <span>{getAgentToolProfile(candidate.tool).name} · 分数 {candidate.score}</span>
                      <small>{candidate.path}</small>
                    </div>
                    <button className="secondary compact" onClick={() => importAgentCandidate(candidate)}>导入规则文件</button>
                  </div>
                ))}
              </div>
            )}
            {ruleDiff && (
              <div className="diff-grid">
                <div>
                  <strong>AGENT.md 独有</strong>
                  <pre>{(ruleDiff.onlyBase ?? []).join('\n') || '无明显差异'}</pre>
                </div>
                <div>
                  <strong>{ruleFileName} 独有</strong>
                  <pre>{(ruleDiff.onlyTarget ?? []).join('\n') || '无明显差异'}</pre>
                </div>
              </div>
            )}
            {candidateImportReviewPanel}
            <div className="source-list">
              {ruleFiles.map((file) => (
                <button
                  className={file.fileName === ruleFileName ? 'source-row source-button active' : 'source-row source-button'}
                  key={file.fileName}
                  onClick={() => {
                    setRuleFileName(file.fileName);
                    setRuleContent(file.content || '');
                  }}
                >
                  <strong>{file.fileName}</strong>
                  <span>{file.exists ? '已存在' : '未创建'}</span>
                  <small>{file.path}</small>
                </button>
              ))}
            </div>
            {sourceRegistryPanel}
            {ruleMessage && <div className="notice">{ruleMessage}</div>}
          </section>
        )}

        {!shouldBlockForAgentInstall && !isLicenseRestrictedSection && activeSection === 'conversation' && selectedStudent && (
          <section className="panel qa-panel">
            <div className="panel-heading">
              <div>
                <h2>对话历史导入与提取</h2>
                <p>把 QClaw、Marvis、Codex、Claude Code 等工具里的高价值对话提取为长期记忆、人设建议、咨询精华和后续待办。</p>
              </div>
              <MessageCircle size={22} />
            </div>
            <div className="archive-grid">
              <InfoPanel icon={<UserRound />} title="当前学生" value={selectedStudent.name} />
              <InfoPanel icon={<FolderOpen />} title="导入目录" value={conversationCenter?.importsDir || '未读取'} />
              <InfoPanel icon={<Archive />} title="历史记录" value={`${conversationCenter?.index?.imports?.length ?? 0} 次导入 / ${conversationCenter?.index?.extracts?.length ?? 0} 次提取`} />
            </div>
            <div className="form-grid compact-grid">
              <label>
                来源 Agent 工具
                <select value={conversationTool} onChange={(event) => setConversationTool(event.target.value as AgentToolId)}>
                  {agentToolOptions.map((tool) => <option value={tool.id} key={tool.id}>{tool.name}</option>)}
                </select>
              </label>
              <label>
                提取目标
                <input readOnly value="UnifiedMemory / UnifiedSoul / 咨询精华库 / 输出结果待办" />
              </label>
            </div>
            <label className="wide-field">
              粘贴对话历史
              <textarea className="large-textarea" value={conversationText} onChange={(event) => setConversationText(event.target.value)} placeholder="粘贴从 Agent 工具导出的会话总结、聊天记录、问答片段或 Markdown/JSON 文本。" />
            </label>
            <div className="actions compact-actions">
              <button className="primary" onClick={saveConversationImport}>保存对话导入记录</button>
              <button className="secondary" onClick={importConversationFiles}>导入 .md/.txt/.json</button>
              <button className="secondary" onClick={copyConversationExtractPrompt}>复制 AI 提取指令</button>
              <button className="secondary" onClick={() => copyAiAgentScanPrompt('conversation')}>复制对话文件扫描指令</button>
              <button className="secondary" onClick={() => refreshConversationCenter()}>刷新对话中心</button>
            </div>
            <label className="wide-field">
              粘贴 AI 提取结果 JSON
              <textarea
                value={conversationExtractText}
                onChange={(event) => {
                  setConversationExtractText(event.target.value);
                  setConversationExtractPreview(null);
                }}
                placeholder='{"memoryCandidates":["..."],"soulSuggestions":["..."],"qaHighlights":["..."],"todos":["..."]}'
              />
            </label>
            <div className="actions compact-actions">
              <button className="secondary" onClick={previewConversationExtractResult}>解析预览</button>
              <button className="primary" onClick={saveConversationExtractResult}>确认写入勾选资产</button>
              <button className="secondary" onClick={() => setConversationExtractText('')}>清空提取结果</button>
            </div>
            {conversationExtractPreview && !conversationExtractPreview.error && (
              <div className="extract-preview">
                <div className="mini-heading">
                  <strong>写入前预览</strong>
                  <span>取消勾选后，对应内容不会写入文件。</span>
                </div>
                {[
                  ['memory', '长期记忆', conversationExtractPreview.memoryCandidates],
                  ['soul', '人设建议', conversationExtractPreview.soulSuggestions],
                  ['qa', '咨询精华', conversationExtractPreview.qaHighlights],
                  ['todos', '后续待办', conversationExtractPreview.todos],
                ].map(([key, label, items]) => (
                  <div className="extract-preview-group" key={String(key)}>
                    <label className="checkbox-line">
                      <input
                        type="checkbox"
                        checked={conversationExtractTargets[key as keyof typeof conversationExtractTargets]}
                        onChange={(event) => setConversationExtractTargets((current) => ({ ...current, [key as string]: event.target.checked }))}
                      />
                      <span>{String(label)} · {(items as unknown[]).length} 条</span>
                    </label>
                    {(items as unknown[]).slice(0, 6).map((item, index) => (
                      <small key={`${String(key)}-${index}`}>{typeof item === 'string' ? item : JSON.stringify(item)}</small>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {conversationScanCandidates.length > 0 && (
              <div className="candidate-list">
                <div className="mini-heading">
                  <strong>对话历史候选</strong>
                  <span>可从 AI 扫描结果或本机扫描结果中导入。</span>
                </div>
                {conversationScanCandidates.map((candidate) => (
                  <div className="candidate-row" key={candidate.path}>
                    <label className="checkbox-line">
                      <input type="checkbox" checked={selectedCandidateKeys.includes(candidateKey(candidate))} onChange={() => toggleCandidateSelection(candidate)} />
                      <span>{candidate.name}</span>
                    </label>
                    <small>{candidate.path}</small>
                    <button className="secondary compact" onClick={() => importAgentCandidate(candidate)}>导入对话历史</button>
                  </div>
                ))}
                <button className="secondary" onClick={importSelectedCandidates}>批量导入勾选候选</button>
              </div>
            )}
            {candidateImportReviewPanel}
            <div className="source-list">
              <div className="mini-heading">
                <strong>最近导入与提取</strong>
                <span>{conversationCenter?.conversationDir || ''}</span>
              </div>
              {(conversationCenter?.index?.imports ?? []).slice(0, 6).map((item) => (
                <div className="source-row" key={item.path}>
                  <strong>导入 · {getAgentToolProfile(item.tool || 'qclaw').name}</strong>
                  <span>{item.size ? formatFileSize(item.size) : ''}</span>
                  <small>{item.importedAt ? new Date(item.importedAt).toLocaleString('zh-CN') : ''} {item.path}</small>
                </div>
              ))}
              {(conversationCenter?.index?.extracts ?? []).slice(0, 6).map((item) => (
                <div className="source-row" key={item.path}>
                  <strong>提取 · {getAgentToolProfile(item.tool || 'qclaw').name}</strong>
                  <span>记忆 {item.memoryCount ?? 0} / 人设 {item.soulCount ?? 0} / 问答 {item.qaCount ?? 0}</span>
                  <small>{item.importedAt ? new Date(item.importedAt).toLocaleString('zh-CN') : ''} {item.path}</small>
                </div>
              ))}
            </div>
            {sourceRegistryPanel}
            {conversationMessage && <div className="notice">{conversationMessage}</div>}
          </section>
        )}

        {!shouldBlockForAgentInstall && !isLicenseRestrictedSection && activeSection === 'qa' && !selectedStudent && (
          <section className="panel qa-panel">
            <div className="empty-state">请先初始化或新建教育管家，再进入问答模块。</div>
          </section>
        )}

        {!shouldBlockForAgentInstall && !isLicenseRestrictedSection && activeSection === 'tasks' && (
          <section className="panel tasks-panel">
            <div className="panel-heading">
              <div>
                <h2>资料消化任务</h2>
                <p>QClaw 和 OpenClaw 可按初始化指令创建定时任务；Marvis 和 Hohu 暂按手动复制消化指令执行。</p>
              </div>
              <Settings size={22} />
            </div>
            <div className="task-list">
              {students.map((student) => (
                <div className="task-row" key={student.id}>
                  <span>{student.name}</span>
                  <strong>{student.digestTime}</strong>
                  <small>{getAgentToolProfile(student.agentTool).name} · 待消化 {pendingDigestValue(student)} 个{student.lastDigestCommandAt ? ` · 最近提交 ${student.lastDigestCommandAt}` : ''}</small>
                  <button className="secondary compact" onClick={() => copyDigestCommand(student)}>
                    消化资料
                  </button>
                  <button className="secondary compact" onClick={() => markDigestSubmitted(student)}>
                    标记已提交
                  </button>
                  {isWindows && (
                    <button className="secondary compact" onClick={() => syncDigestResult(student)}>
                      同步结果
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {!shouldBlockForAgentInstall && activeSection === 'settings' && (
          <section className="panel tasks-panel">
            <div className="panel-heading">
              <div>
                <h2>{t('settings.title')}</h2>
                <p>{isWindows ? t('settings.description.windows') : t('settings.description.android')}</p>
              </div>
              <Settings size={22} />
            </div>
            <div className="notice settings-language-panel">
              <div>
                <strong>{t('settings.language.title')}</strong>
                <p>{t('settings.language.description')}</p>
              </div>
              <label className="inline-field language-field">
                <span>{t('settings.language.select')}</span>
                <select value={language} onChange={(event) => changeLanguage(event.target.value as LanguageCode)}>
                  {languageOptions.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.nativeLabel} · {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="status-grid">
              {(isWindows
                ? [
                    [t('settings.storageMode'), 'Windows 本机目录'],
                    [t('settings.licenseStatus'), licenseLabel(effectiveLicenseStatus)],
                    [t('settings.studentRoot'), storageConfig.baseDir],
                    ['QClaw', installStatus?.qclaw.installed ? `已安装 ${installStatus.qclaw.version ?? ''}` : '未安装'],
                    ['Marvis', installStatus?.marvis.installed ? `已安装 ${installStatus.marvis.version ?? ''}` : '未安装'],
                    ['Hohu', installStatus?.hohu.installed ? `已安装 ${installStatus.hohu.version ?? ''}` : '未安装'],
                    ['OpenClaw', installStatus?.openclaw?.installed ? `已安装 ${installStatus.openclaw.version ?? ''}` : '未安装'],
                    ['ima.copilot', installStatus?.imaCopilot?.installed ? `已安装 ${installStatus.imaCopilot.version ?? ''}` : '未安装'],
                    ['WorkBuddy', installStatus?.workbuddy?.installed ? `已安装 ${installStatus.workbuddy.version ?? ''}` : '未安装'],
                    ['Codex', installStatus?.codex?.installed ? `已安装 ${installStatus.codex.version ?? ''}` : '未安装'],
                    ['Claude Code', installStatus?.claudeCode?.installed ? `已安装 ${installStatus.claudeCode.version ?? ''}` : '未安装'],
                    ['Tailscale 软件', installStatus?.tailscale?.installed ? `已安装 ${installStatus.tailscale.version ?? ''}` : '未安装'],
                    ['QClaw 路径', installStatus?.qclaw.exePath || '未检测到'],
                    ['Marvis 路径', installStatus?.marvis.exePath || '未检测到'],
                    ['Hohu 路径', installStatus?.hohu.exePath || '未检测到'],
                    ['OpenClaw 路径', installStatus?.openclaw?.exePath || '未检测到'],
                    ['ima.copilot 路径', installStatus?.imaCopilot?.exePath || '未检测到'],
                    ['WorkBuddy 路径', installStatus?.workbuddy?.exePath || '未检测到'],
                    ['Codex 路径', installStatus?.codex?.exePath || '未检测到'],
                    ['Claude Code 路径', installStatus?.claudeCode?.exePath || '未检测到'],
                    ['Tailscale 路径', installStatus?.tailscale?.exePath || '未检测到'],
                    ['主机服务', hostServiceStatus?.running ? '运行中' : '未启动'],
                    ['服务端口', hostServiceStatus?.port ?? 18777],
                    ['局域网地址', hostServiceStatus?.serverUrl ?? `http://127.0.0.1:${hostServiceStatus?.port ?? 18777}`],
                    ['Tailscale 地址', hostServiceStatus?.tailscaleUrl || hostServiceStatus?.tailscaleUrls?.[0] || '未检测到'],
                    ['当前连接模式', connectionModeLabel(hostServiceStatus?.connectionMode)],
                    ['API Token', hostServiceStatus?.apiToken ? `${hostServiceStatus.apiToken.slice(0, 8)}...${hostServiceStatus.apiToken.slice(-6)}` : '未生成'],
                  ]
                : [
                    ['存储模式', 'App 内置资料库'],
                    ['App 私有资料库', compatibility?.appPrivateStorage ? '可用' : '未检测'],
                    ['拍照导入', compatibility?.cameraImport ? '可用' : '不可用'],
                    ['图片/截图导入', compatibility?.imageImport ? '可用' : '不可用'],
                    ['分享导入', compatibility?.shareImport ? '可用' : '不可用'],
                    ['文件选择器', compatibility?.filePicker ? '可用' : '不可用'],
                    ['Downloads 扫描', compatibility?.downloadsScan ? '可用' : '不可用'],
                    ['目录授权', compatibility?.folderPicker ? '可用' : '高级功能不可用'],
                  ]).map(([label, value]) => (
                <div className="status-card" key={label}>
                  <span>{label}</span>
                  <strong>{String(value)}</strong>
                </div>
              ))}
            </div>
            <div className="notice muted">
              {isWindows
                ? 'QClaw、Marvis、Hohu、OpenClaw、Codex 和 Claude Code 将使用同一个本机学生知识库目录。默认根目录为 D:\\学生资料；更换资料根目录后，新建和导入都会写入新目录。'
                : String(compatibility?.message ?? '在 Android APK 中可查看完整兼容性检测结果。')}
            </div>
            {isWindows && (
              <div className="source-list">
                <div className="mini-heading">
                  <strong>{t('settings.agentAdapters')}</strong>
                  <span>{t('settings.agentAdapters.desc')}</span>
                </div>
                {agentToolOptions.map((tool) => (
                  <div className="source-row" key={tool.id}>
                    <strong>{tool.name} · {tool.category}</strong>
                    <span>{tool.openMode} · {tool.supportsScheduledTask ? '支持定时任务' : '手动/外部执行'} · {tool.supportsConversationExport ? '支持对话导出' : '不支持对话导出'}</span>
                    <small>规则文件：{tool.ruleFiles.join('、')}；记忆：{tool.supportsMemoryFile ? '文件' : '粘贴'}；人设：{tool.supportsPersonaFile ? '文件' : '粘贴'}</small>
                  </div>
                ))}
              </div>
            )}
            {isWindows && (
              <div className="actions">
                <button className="secondary compact" onClick={refreshInstallStatus}>
                  {t('settings.redetectSoftware')}
                </button>
                <button className="secondary compact" onClick={() => openExternal('tailscale')}>
                  {installStatus?.tailscale?.installed ? '打开 Tailscale' : '下载 Tailscale'}
                </button>
                <button className="secondary compact" onClick={() => bridge()?.openExternalUrl?.('https://tailscale.com/download/windows')}>
                  Tailscale Windows 下载页
                </button>
              </div>
            )}
            {isWindows && (
              <div className="notice license-panel">
                <div>
                  <strong>许可证授权</strong>
                  <p>用户付款后获得激活码，在 Windows 主机端激活；平板终端跟随主机授权状态，不单独收费。</p>
                  <div className="license-summary">
                    <span>{licenseLabel(effectiveLicenseStatus)}</span>
                    <span>学生数：{effectiveLicenseStatus?.studentLimit ?? '-'}</span>
                    <span>平板设备：{effectiveLicenseStatus?.deviceLimit ?? '-'}</span>
                  </div>
                </div>
                <div className="inline-field license-field">
                  <input
                    value={licenseCodeDraft}
                    onChange={(event) => setLicenseCodeDraft(event.target.value)}
                    placeholder="输入激活码：AIE-FAMILY-20270706-3-6-随机码-签名"
                  />
                  <button className="primary" onClick={activateLicense}>
                    激活
                  </button>
                </div>
                <div className="actions">
                  <button className="secondary compact" onClick={refreshLicenseStatus}>
                    刷新授权
                  </button>
                  <button className="secondary compact" onClick={deactivateLicense}>
                    移除本机许可证
                  </button>
                </div>
                {licenseMessage && <p>{licenseMessage}</p>}
                <p className="muted-text">授权码由内部“AI教育管家授权管理工具”生成，客户版主机端只负责激活和校验。</p>
              </div>
            )}
            <div className="notice legal-notice">
              <div>
                <strong>{t('settings.legal')}</strong>
                <p>{t('settings.legal.desc')}</p>
              </div>
              <div className="legal-actions">
                <button className="secondary compact" onClick={openUserAgreement}>
                  {t('legal.agreement')}
                  <ExternalLink size={16} />
                </button>
                <button className="secondary compact" onClick={openPrivacyPolicy}>
                  {t('legal.privacy')}
                  <ExternalLink size={16} />
                </button>
              </div>
            </div>
            {isWindows && (
              <div className="notice">
                <strong>主机服务连接信息</strong>
                <p>平板端后续可使用 serverUrl 和 API token 上传资料、读取学情分析汇总 Markdown。</p>
                {!windowsLicenseActive && (
                  <div className="notice warning-notice">
                    <strong>未激活状态不可启动主机服务</strong>
                    <p>{licenseRestrictionText}</p>
                  </div>
                )}
                <div className="form-grid">
                  <label>
                    服务端口
                    <input value={hostPortDraft} onChange={(event) => setHostPortDraft(event.target.value)} inputMode="numeric" />
                  </label>
                  <label>
                    局域网地址
                    <input readOnly value={hostServiceStatus?.serverUrl ?? `http://127.0.0.1:${hostServiceStatus?.port ?? 18777}`} />
                  </label>
                  <label>
                    Tailscale 地址
                    <input readOnly value={hostServiceStatus?.tailscaleUrl || hostServiceStatus?.tailscaleUrls?.[0] || '未检测到'} />
                  </label>
                  <label>
                    API Token
                    <input readOnly value={hostServiceStatus?.apiToken ?? ''} />
                  </label>
                </div>
                {renderHostPairingPanel()}
                <div className="actions">
                  <button className="secondary" onClick={saveHostServicePort} disabled={!windowsLicenseActive}>
                    保存端口
                  </button>
                  <button className="primary" onClick={hostServiceStatus?.running ? stopHostService : startHostService} disabled={!windowsLicenseActive && !hostServiceStatus?.running}>
                    {hostServiceStatus?.running ? '停止主机服务' : '启动主机服务'}
                  </button>
                  <button className="secondary" onClick={copyHostConnectionInfo} disabled={!windowsLicenseActive}>
                    <Clipboard size={18} />
                    复制平板连接信息
                  </button>
                  <button className="secondary" onClick={refreshHostServiceStatus}>
                    <RefreshCw size={18} />
                    刷新服务状态
                  </button>
                </div>
                {hostServiceMessage && <p>{hostServiceMessage}</p>}
              </div>
            )}
            {isWindows && (
              <div className="notice">
                <strong>数据维护与安全</strong>
                <p>备份会导出学生索引、设备授权、上传记录和主机事件；重置 API Token 后请重新复制连接信息。</p>
                <div className="actions">
                  <button className="secondary" onClick={backupHostData}>
                    <FileDown size={18} />
                    备份主机数据
                  </button>
                  <button className="secondary" onClick={restoreHostData}>
                    恢复备份
                  </button>
                  <button className="secondary" onClick={resetHostApiToken}>
                    重置 API Token
                  </button>
                  <button className="secondary" onClick={exportHostLogs}>
                    导出诊断日志
                  </button>
                </div>
              </div>
            )}
            {isWindows && (
              <div className="notice muted">
                <strong>最近主机事件</strong>
                {hostTimeline.length === 0 && <p>暂无事件。上传资料、备份恢复、重置 token 或提交消化后会记录在这里。</p>}
                {hostTimeline.slice(0, 6).map((event) => (
                  <p key={event.id}>
                    {event.at ? new Date(event.at).toLocaleString() : ''} · {event.title || event.type || '事件'}{event.studentName ? ` · ${event.studentName}` : ''}{event.detail ? ` · ${event.detail}` : ''}
                  </p>
                ))}
              </div>
            )}
            <div className="actions">
              <button
                className="secondary"
                onClick={() => {
                  if (isWindows) {
                    refreshInstallStatus();
                    return;
                  }
                  const raw = bridge()?.getCompatibilityStatus?.();
                  if (!raw) {
                    setCompatibility({ ok: false, message: '当前环境不支持原生兼容性检测。' });
                    return;
                  }
                  try {
                    setCompatibility(JSON.parse(raw) as Record<string, unknown>);
                  } catch {
                    setCompatibility({ ok: false, message: '兼容性检测解析失败。' });
                  }
                }}
              >
                <RefreshCw size={18} />
                {t('settings.redetect')}
              </button>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

function InfoPanel({ icon, title, value }: { icon: React.ReactNode; title: string; value: string }) {
  return (
    <article className="info-panel">
      <div className="info-icon">{icon}</div>
      <span>{title}</span>
      <strong>{value}</strong>
    </article>
  );
}

function AgentToolCompactSelector({
  value,
  onChange,
  label = 'Agent 工具',
  disabled = false,
}: {
  value: AgentToolId;
  onChange: (value: AgentToolId) => void;
  label?: string;
  disabled?: boolean;
}) {
  const tool = getAgentToolProfile(value);
  return (
    <div className="agent-tool-compact">
      <label>
        <span>{label}</span>
        <select value={value} onChange={(event) => onChange(event.target.value as AgentToolId)} disabled={disabled}>
          {agentToolOptions.map((item) => (
            <option value={item.id} key={item.id}>{item.name}</option>
          ))}
        </select>
      </label>
      <div className="tool-chip-row">
        <span>{tool.category}</span>
        <span>{tool.openMode}</span>
        <span>{tool.supportsLocalFiles ? '本机目录' : '粘贴/网页'}</span>
        <span>{tool.supportsProjectRules ? `规则：${tool.ruleFiles[0]}` : '无项目规则'}</span>
        <span>{tool.supportsScheduledTask ? '支持定时' : '手动执行'}</span>
      </div>
    </div>
  );
}

function StudentToolSelector({
  value,
  onChange,
  disabled = false,
}: {
  value: AgentToolId;
  onChange: (value: AgentToolId) => void;
  disabled?: boolean;
}) {
  return (
    <div className="student-tool-switch">
      <AgentToolCompactSelector value={value} onChange={onChange} label="当前 Agent 工具" disabled={disabled} />
    </div>
  );
}

function renderInlineMarkdown(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;
    if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*')) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      const label = token.replace(/\]\(.+$/, '').slice(1);
      const url = match[2];
      nodes.push(
        <a href={url} key={key} rel="noreferrer" target="_blank">
          {label}
        </a>,
      );
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function MarkdownView({ content }: { content: string }) {
  const lines = content.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let codeBuffer: string[] = [];
  let inCode = false;
  let listBuffer: Array<{ ordered: boolean; text: string }> = [];
  let tableBuffer: string[][] = [];
  let tableHasHeader = false;

  const normalizeTableLine = (value: string) => value.replace(/\uFEFF/g, '').replace(/｜/g, '|');

  const splitTableRow = (value: string) => {
    let text = normalizeTableLine(value).trim();
    if (!text.includes('|')) return null;
    if (text.startsWith('|')) text = text.slice(1);
    if (text.endsWith('|')) text = text.slice(0, -1);
    const cells = text.split('|').map((cell) => cell.trim());
    return cells.length >= 2 ? cells : null;
  };

  const isTableSeparatorRow = (row: string[]) =>
    row.length >= 2 && row.every((cell) => /^:?-{1,}:?$/.test(cell.replace(/\s+/g, '')));

  const hasTableShape = (value: string) => {
    const text = normalizeTableLine(value).trim();
    const pipeCount = (text.match(/\|/g) || []).length;
    return pipeCount >= 2 || (pipeCount >= 1 && (text.startsWith('|') || text.endsWith('|')));
  };

  const flushList = (key: string) => {
    if (listBuffer.length === 0) return;
    const ordered = listBuffer.every((item) => item.ordered);
    const children = listBuffer.map((item, index) => <li key={`${key}-${index}`}>{renderInlineMarkdown(item.text, `${key}-${index}`)}</li>);
    blocks.push(ordered ? <ol key={key}>{children}</ol> : <ul key={key}>{children}</ul>);
    listBuffer = [];
  };

  const flushTable = (key: string) => {
    if (tableBuffer.length === 0) return;
    const rows = tableBuffer.filter((row) => !isTableSeparatorRow(row));
    if (rows.length > 0) {
      const maxCells = Math.max(...rows.map((row) => row.length));
      const normalizedRows = rows.map((row) => [...row, ...Array(Math.max(0, maxCells - row.length)).fill('')]);
      const headerRows = tableHasHeader ? normalizedRows.slice(0, 1) : [];
      const bodyRows = tableHasHeader ? normalizedRows.slice(1) : normalizedRows;
      const columnTemplate = Array(maxCells).fill('minmax(120px, 1fr)').join(' ');
      blocks.push(
        <div className="md-table-wrap" key={key}>
          <div
            className="md-table-grid"
            role="table"
            style={{ '--md-table-columns': columnTemplate } as React.CSSProperties}
          >
            {headerRows.length > 0 ? (
              <div className="md-table-head-group" role="rowgroup">
                {headerRows.map((row, rowIndex) => (
                  <div className="md-table-row md-table-head-row" key={`${key}-head-${rowIndex}`} role="row">
                    {row.map((cell, cellIndex) => (
                      <div className="md-table-cell md-table-head" key={`${key}-head-${rowIndex}-${cellIndex}`} role="columnheader">
                        {renderInlineMarkdown(cell, `${key}-head-${rowIndex}-${cellIndex}`)}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : null}
            <div className="md-table-body-group" role="rowgroup">
              {bodyRows.map((row, rowIndex) => (
                <div className="md-table-row" key={`${key}-body-${rowIndex}`} role="row">
                  {row.map((cell, cellIndex) => (
                    <div className="md-table-cell" key={`${key}-body-${rowIndex}-${cellIndex}`} role="cell">
                      {renderInlineMarkdown(cell, `${key}-body-${rowIndex}-${cellIndex}`)}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>,
      );
    }
    tableBuffer = [];
    tableHasHeader = false;
  };

  const flushFlow = (key: string) => {
    flushList(`${key}-list`);
    flushTable(`${key}-table`);
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim().startsWith('```')) {
      flushFlow(`flow-${index}`);
      if (inCode) {
        blocks.push(
          <pre className="md-code" key={`code-${index}`}>
            {codeBuffer.join('\n')}
          </pre>,
        );
        codeBuffer = [];
        inCode = false;
      } else {
        inCode = true;
      }
      index += 1;
      continue;
    }

    if (inCode) {
      codeBuffer.push(line);
      index += 1;
      continue;
    }

    if (!line.trim()) {
      flushFlow(`flow-${index}`);
      blocks.push(<div className="md-space" key={`space-${index}`} />);
      index += 1;
      continue;
    }

    const tableCells = splitTableRow(line);
    const nextLine = lines[index + 1] || '';
    const nextTableCells = splitTableRow(nextLine);
    const hasExplicitSeparator = Boolean(nextTableCells && isTableSeparatorRow(nextTableCells));
    const hasAdjacentPipeRows = Boolean(
      tableCells &&
        nextTableCells &&
        !isTableSeparatorRow(nextTableCells) &&
        hasTableShape(line) &&
        hasTableShape(nextLine) &&
        Math.min(tableCells.length, nextTableCells.length) >= 2,
    );
    if (tableCells && (hasExplicitSeparator || hasAdjacentPipeRows)) {
      flushList(`list-before-table-${index}`);
      tableBuffer = [];
      tableHasHeader = hasExplicitSeparator;
      tableBuffer.push(tableCells);
      index += hasExplicitSeparator ? 2 : 1;
      while (index < lines.length) {
        const rowCells = splitTableRow(lines[index] || '');
        if (!rowCells || !hasTableShape(lines[index] || '')) break;
        if (isTableSeparatorRow(rowCells)) {
          index += 1;
          continue;
        }
        tableBuffer.push(rowCells);
        index += 1;
      }
      flushTable(`table-${index}`);
      continue;
    }

    flushTable(`table-before-${index}`);

    if (line.startsWith('# ')) {
      flushList(`list-before-h1-${index}`);
      blocks.push(<h1 key={index}>{renderInlineMarkdown(line.slice(2), `h1-${index}`)}</h1>);
      index += 1;
      continue;
    }
    if (line.startsWith('## ')) {
      flushList(`list-before-h2-${index}`);
      blocks.push(<h2 key={index}>{renderInlineMarkdown(line.slice(3), `h2-${index}`)}</h2>);
      index += 1;
      continue;
    }
    if (line.startsWith('### ')) {
      flushList(`list-before-h3-${index}`);
      blocks.push(<h3 key={index}>{renderInlineMarkdown(line.slice(4), `h3-${index}`)}</h3>);
      index += 1;
      continue;
    }
    if (line.startsWith('> ')) {
      flushList(`list-before-quote-${index}`);
      blocks.push(<blockquote key={index}>{renderInlineMarkdown(line.slice(2), `quote-${index}`)}</blockquote>);
      index += 1;
      continue;
    }
    const listMatch = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/);
    if (listMatch) {
      listBuffer.push({ ordered: /^\d/.test(listMatch[2]), text: listMatch[3] });
      index += 1;
      continue;
    }
    flushList(`list-before-p-${index}`);
    blocks.push(<p key={index}>{renderInlineMarkdown(line, `p-${index}`)}</p>);
    index += 1;
  }

  flushFlow('tail-flow');
  if (codeBuffer.length > 0) {
    blocks.push(
      <pre className="md-code" key="code-tail">
        {codeBuffer.join('\n')}
      </pre>,
    );
  }

  return <article className="markdown-content">{blocks}</article>;
}

createRoot(document.getElementById('root')!).render(<App />);

