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
  FolderOpen,
  Home,
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

type Section = 'home' | 'init' | 'new' | 'inbox' | 'archive' | 'qa' | 'memory' | 'soul' | 'rules' | 'tasks' | 'settings';
type ThemeName = 'blue' | 'pink' | 'green' | 'purple' | 'orange';
type AgentToolId = 'qclaw' | 'marvis' | 'hohu' | 'openclaw';
type AgentKnowledgeKind = 'memory' | 'soul';
type StorageMode = 'app_private' | 'downloads_export' | 'obsidian_vault';
type KnowledgeBaseMode = 'standard' | 'adopted';
type AgentBindingMode = 'subAgent' | 'mainChat';
type InitStepId = 'folder' | 'agent' | 'execute' | 'create' | 'soul' | 'memory' | 'schedule' | 'full';
type ArchiveCategoryId = 'summary' | 'report' | 'qa' | 'other' | 'all';
type RuntimePlatform = 'android' | 'windows' | 'web' | string;

type AgentToolProfile = {
  id: AgentToolId;
  name: string;
  supportsLocalFiles: boolean;
  supportsAgentCreation: boolean;
  supportsPersonaSetting: boolean;
  supportsMemorySetting: boolean;
  supportsScheduledTask: boolean;
  supportsSubAgent: boolean;
  supportsMemoryFile: boolean;
  supportsMemoryPaste: boolean;
  supportsSoulPaste: boolean;
  openLabel: string;
  copyTargetLabel: string;
  digestTargetLabel: string;
  personaTargetLabel: string;
  memoryTargetLabel: string;
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

type StudentDraft = Omit<Student, 'id' | 'createdAt' | 'status'>;

type AndroidBridge = {
  copyText?: (value: string) => void;
  exportTextFile?: (filename: string, content: string) => string;
  importFiles?: (studentName: string) => boolean;
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

type DownloadCandidate = {
  id: string;
  path: string;
  name: string;
  size: number;
  modified: number;
  type: string;
  importable: boolean;
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
  tailscale?: AgentToolInstall;
  anyInstalled: boolean;
  recommendedTool: AgentToolId;
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
  checks?: {
    agentMd?: boolean;
    rawDir?: boolean;
    summaryDir?: boolean;
    outputDir?: boolean;
    indexMd?: boolean;
    logMd?: boolean;
  };
};

const storageKey = 'edu-manager-launcher.students.v2';
const themeStorageKey = 'edu-manager-launcher.theme.v1';
const archiveKeywordStorageKey = 'edu-manager-launcher.archive-keywords.v1';
const currentVersionCode = 63;
const currentVersionName = '0.5.3';
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
    supportsLocalFiles: true,
    supportsAgentCreation: true,
    supportsPersonaSetting: true,
    supportsMemorySetting: true,
    supportsScheduledTask: true,
    supportsSubAgent: true,
    supportsMemoryFile: true,
    supportsMemoryPaste: true,
    supportsSoulPaste: true,
    openLabel: '打开 QClaw',
    copyTargetLabel: '复制到 QClaw 对话或 Agent 设置中',
    digestTargetLabel: '可粘贴到 QClaw 执行',
    personaTargetLabel: 'QClaw Agent 角色设定',
    memoryTargetLabel: 'QClaw Agent 长期记忆',
  },
  marvis: {
    id: 'marvis',
    name: 'Marvis',
    supportsLocalFiles: false,
    supportsAgentCreation: false,
    supportsPersonaSetting: true,
    supportsMemorySetting: true,
    supportsScheduledTask: false,
    supportsSubAgent: false,
    supportsMemoryFile: false,
    supportsMemoryPaste: true,
    supportsSoulPaste: true,
    openLabel: '打开 Marvis',
    copyTargetLabel: '复制到 Marvis 对话或人设设置中',
    digestTargetLabel: '可粘贴到 Marvis 对话中手动执行',
    personaTargetLabel: 'Marvis 人设/角色设置',
    memoryTargetLabel: 'Marvis 长期背景',
  },
  hohu: {
    id: 'hohu',
    name: 'Hohu',
    supportsLocalFiles: true,
    supportsAgentCreation: true,
    supportsPersonaSetting: true,
    supportsMemorySetting: true,
    supportsScheduledTask: false,
    supportsSubAgent: true,
    supportsMemoryFile: true,
    supportsMemoryPaste: true,
    supportsSoulPaste: true,
    openLabel: '打开 Hohu',
    copyTargetLabel: '复制到 Hohu 子 Agent 或人设设置中',
    digestTargetLabel: '可粘贴到 Hohu 执行，并直接读写本机知识库',
    personaTargetLabel: 'Hohu 子 Agent 人设',
    memoryTargetLabel: 'Hohu 子 Agent 记忆',
  },
  openclaw: {
    id: 'openclaw',
    name: 'OpenClaw',
    supportsLocalFiles: true,
    supportsAgentCreation: true,
    supportsPersonaSetting: true,
    supportsMemorySetting: true,
    supportsScheduledTask: true,
    supportsSubAgent: true,
    supportsMemoryFile: true,
    supportsMemoryPaste: true,
    supportsSoulPaste: true,
    openLabel: '打开 OpenClaw',
    copyTargetLabel: '复制到 OpenClaw 子 Agent 或角色设定中',
    digestTargetLabel: '可粘贴到 OpenClaw 执行',
    personaTargetLabel: 'OpenClaw 子 Agent 角色设定',
    memoryTargetLabel: 'OpenClaw 子 Agent 长期记忆',
  },
};

const agentToolOptions = Object.values(agentToolProfiles);

function getAgentToolProfile(value?: AgentToolId) {
  const profile = agentToolProfiles[value ?? 'qclaw'] ?? agentToolProfiles.qclaw;
  if (activeStorageConfig.platform === 'windows' && (profile.id === 'marvis' || profile.id === 'hohu')) {
    return {
      ...profile,
      supportsLocalFiles: true,
      digestTargetLabel: `可粘贴到 ${profile.name} 执行，并直接读写本机知识库`,
    };
  }
  return profile;
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
  return {
    cleanName,
    root,
    raw,
    summary,
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
  const agent = student.agentPath || joinDisplayPath(root, 'AGENT.md');
  const output = student.outputPath || joinDisplayPath(root, '输出结果');
  return {
    ...standard,
    root,
    raw,
    summary,
    agent,
    output,
    index: joinDisplayPath(summary, 'index.md'),
    log: joinDisplayPath(summary, 'log.md'),
  };
}

function basenameFromPath(filePath: string) {
  return String(filePath || '').split(/[\\/]/).filter(Boolean).pop() || '候选文件';
}

function buildAiAgentScanPrompt(student: Student, targetKind: AgentKnowledgeKind) {
  const p = pathsForStudent(student);
  const targetLabel = targetKind === 'soul' ? '人设/Soul/角色设定' : 'Memory/长期记忆';
  return `请作为本机 Agent 文件扫描助手，帮我查找学生「${student.name}」的 ${targetLabel} 文件候选。

学生信息：
- 姓名：${student.name}
- 年级：${student.grade || '待补充'}
- 学校：${student.school || '待补充'}
- 当前目标：${student.goal || '待补充'}
- 当前绑定 Agent 工具：${getAgentToolProfile(student.agentTool).name}
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
- %APPDATA%\\QClaw
- %APPDATA%\\OpenClaw
- %APPDATA%\\Hohu
- %APPDATA%\\Marvis
- %LOCALAPPDATA%\\QClaw
- %LOCALAPPDATA%\\OpenClaw
- %LOCALAPPDATA%\\Hohu
- %LOCALAPPDATA%\\Marvis

候选文件名包括但不限于：
- 记忆：MEMORY.md、Memory.md、memory.md、long-term-memory.md、memory.txt
- 人设：Soul.md、persona.md、role.md、system.md、prompt.md、profile.md

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

tool 只能使用：qclaw、marvis、hohu、openclaw。
kind 只能使用：memory、soul。`;
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
  const inferredKind = /soul|persona|role|system|prompt|人设|角色/.test(rawKind) ? 'soul' : /memory|记忆/.test(rawKind) ? 'memory' : fallbackKind;
  if (inferredKind !== 'memory' && inferredKind !== 'soul') return null;
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
   └─ 咨询精华库/
\`\`\`

初始化时请创建：

- \`${p.index}\`
- \`${p.log}\`
- \`${p.summary}/摘要库/\`
- \`${p.summary}/概念库/\`
- \`${p.summary}/实体库/\`
- \`${p.summary}/综合库/\`
- \`${p.summary}/咨询精华库/\`
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

## 7. 命令约定

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

## 8. Frontmatter 规范

除 \`index.md\` 和 \`log.md\` 外，其余学情分析汇总页面默认带 YAML frontmatter。

最低字段：

- \`title\`
- \`type\`
- \`status\`
- \`created\`
- \`updated\`
- \`source_path\` 或 \`source_url\`
- \`tags\`

## 9. 写作规范

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

## 10. index.md 与 log.md

- \`index.md\` 是导航页，不是随意写的首页
- \`log.md\` 是 append-only 时间线
- 每次消化、重要咨询、lint、review、refactor 都应记录

## 11. 不要做的事

- 不要覆盖或改写原始资料库原始图片
- 不要把没有来源的推断写成确定事实
- 不要只写摘要而不补交叉链接
- 不要更新页面却忘记更新 \`index.md\` 或 \`log.md\`
- 不要把 \`输出结果/\` 当长期知识主页

## 12. 每日资料消化规则

- ${tool.supportsScheduledTask ? `每天 ${student.digestTime} 由 ${tool.name} 定时任务唤醒本 Agent 执行 \`/消化\`。` : `当前工具 ${tool.name} 暂按手动复制指令执行 \`/消化\`，建议每天 ${student.digestTime} 由用户在控制台复制资料消化指令。`}
- 只读取 \`${p.raw}\` 中新增或变更的资料。
- 没有新资料时，在 \`log.md\` 中记录“无新增资料”，不要重复生成摘要。
- 高影响结论必须能追溯到原始文件、图片或明确链接。

## 13. 极简执行口令

先读 \`${p.index}\` 和 \`${p.log}\`，再按需读取相关页面；把新资料编译进 \`摘要库 / 实体库 / 概念库 / 综合库 / 咨询精华库\`；最后更新 \`index.md\` 和 \`log.md\`。
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
  const separator = activeStorageConfig.pathSeparator || '/';
  return `/消化 ${p.cleanName}原始资料库中的新资料

请读取原始资料库中的新增资料，并将结果写入学情分析汇总。

学生知识库：${p.root}
原始资料库：${p.raw}
学情分析汇总：${p.summary}
控制台账本目录：${p.root}${separator}.edu-manager

执行要求：
1. 只处理尚未消化的新资料，不重复生成已处理资料的摘要。
2. 处理完成后更新 ${p.index} 和 ${p.log}。
3. 如果没有新增资料，请在 log.md 中记录“无新增资料”。
4. 消化完成后，请更新 ${p.root}${separator}.edu-manager${separator}digest-state.json，格式为：
{
  "status": "completed",
  "lastDigestAt": "YYYY-MM-DDTHH:mm:ss+08:00",
  "digestedFiles": ["本次处理的原始文件名"],
  "summaryFiles": ["本次新增或更新的Markdown文件"],
  "message": "本次消化完成，共处理 N 个新资料"
}

如果处理失败，请把 status 写为 "failed"，并在 message 中说明原因。`;
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
  const [inboxMessage, setInboxMessage] = useState('');
  const [downloadsMessage, setDownloadsMessage] = useState('');
  const [downloadFiles, setDownloadFiles] = useState<DownloadCandidate[]>([]);
  const [selectedDownloadPaths, setSelectedDownloadPaths] = useState<string[]>([]);
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
  const [agentScanMessage, setAgentScanMessage] = useState('');
  const [aiScanResultText, setAiScanResultText] = useState('');
  const [agentRules, setAgentRules] = useState<AgentRulesState | null>(null);
  const [ruleFileName, setRuleFileName] = useState('AGENT.md');
  const [ruleContent, setRuleContent] = useState('');
  const [ruleMessage, setRuleMessage] = useState('');
  const [memorySourceTool, setMemorySourceTool] = useState<AgentToolId>('qclaw');
  const [memorySourceText, setMemorySourceText] = useState('');
  const [unifiedMemoryText, setUnifiedMemoryText] = useState('');
  const [soulSourceTool, setSoulSourceTool] = useState<AgentToolId>('qclaw');
  const [soulSourceText, setSoulSourceText] = useState('');
  const [unifiedSoulText, setUnifiedSoulText] = useState('');
  const [soulDiff, setSoulDiff] = useState<{ onlyUnified?: string[]; onlySource?: string[]; message?: string } | null>(null);

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
  const selectedStudentPaths = selectedStudent ? pathsForStudent(selectedStudent) : pathsFor(draft.name);
  const activeAgentTool = activeSection === 'init' || activeSection === 'new' ? selectedTool : selectedStudentTool;
  const toolOpenState: Record<AgentToolId, boolean> = { qclaw: qclawOpened, marvis: marvisOpened, hohu: hohuOpened, openclaw: openclawOpened };
  const activeAgentOpened = toolOpenState[activeAgentTool.id];
  const isWindows = storageConfig.platform === 'windows';
  const shouldBlockForAgentInstall = isWindows && installStatus ? !installStatus.anyInstalled : false;
  const memoryScanCandidates = agentScanCandidates.filter((candidate) => candidate.kind === 'memory');
  const soulScanCandidates = agentScanCandidates.filter((candidate) => candidate.kind === 'soul');
  const ruleFiles = agentRules?.files ?? [];
  const selectedRuleFile = ruleFiles.find((file) => file.fileName === ruleFileName);
  const filteredMarkdownFiles = useMemo(
    () =>
      selectedArchiveCategory === 'all'
        ? markdownFiles.filter(isVisibleArchiveFile)
        : markdownFiles.filter((file) => isVisibleArchiveFile(file) && classifyMarkdownFile(file, archiveKeywords) === selectedArchiveCategory),
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
        setInstallMessage('未检测到 QClaw、Marvis、Hohu 或 OpenClaw，请先下载安装其中一个工具。');
        return;
      }
      setInstallMessage('');
      setDraft((current) => {
        if (status.qclaw.installed && current.agentTool !== 'qclaw') return { ...current, agentTool: 'qclaw' };
        if (!status.qclaw.installed && status.openclaw?.installed && current.agentTool !== 'openclaw') return { ...current, agentTool: 'openclaw' };
        if (!status.qclaw.installed && !status.openclaw?.installed && status.hohu.installed && current.agentTool !== 'hohu') return { ...current, agentTool: 'hohu' };
        if (!status.qclaw.installed && !status.openclaw?.installed && !status.hohu.installed && status.marvis.installed && current.agentTool !== 'marvis') return { ...current, agentTool: 'marvis' };
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
      if (result.ok) refreshAgentRules(selectedStudent.id, result.fileName || ruleFileName);
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
        const status = JSON.parse(raw) as { qclawOpened?: boolean; marvisOpened?: boolean; hohuOpened?: boolean; openclawOpened?: boolean; obsidianOpened?: boolean };
        setQclawOpened(Boolean(status.qclawOpened));
        setMarvisOpened(Boolean(status.marvisOpened));
        setHohuOpened(Boolean(status.hohuOpened));
        setOpenclawOpened(Boolean(status.openclawOpened));
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
    if (activeSection === 'memory' || activeSection === 'soul' || activeSection === 'qa') {
      refreshAgentCenter();
    }
  }, [activeSection, selectedId]);

  useEffect(() => {
    if (activeSection === 'rules') refreshAgentRules();
  }, [activeSection, selectedId]);

  useEffect(() => {
    setMarkdownFiles([]);
    setSelectedMarkdownId('');
    setMarkdownContent('');
    setMarkdownMessage('');
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

  const changeSelectedStudentTool = (toolId: AgentToolId) => {
    if (!selectedStudent) return;
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
    const tool = getAgentToolProfile(student.agentTool);
    await copyText(buildDigestCommand(student), `已复制资料消化命令，${tool.digestTargetLabel}。`);
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
    const value = selectedStudent && activeTemplateFiles['consult-prompt.md']
      ? renderTemplateText(activeTemplateFiles['consult-prompt.md'] || '', selectedStudent)
      : '/咨询，我想咨询';
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
      const kindLabel = candidate.kind === 'soul' ? 'Soul' : 'Memory';
      setAgentCenterMessage(result.message || (result.ok ? `已导入来源 ${kindLabel}。` : `导入来源 ${kindLabel} 失败。`));
      if (result.ok) {
        if (candidate.kind === 'memory') {
          setMemorySourceTool(candidate.tool);
          setMemorySourceText(candidate.preview || '');
        } else {
          setSoulSourceTool(candidate.tool);
          setSoulSourceText(candidate.preview || '');
        }
      }
      refreshAgentCenter();
    } catch {
      setAgentCenterMessage('导入 Agent 文件结果解析失败。');
    }
  };

  const copyAiAgentScanPrompt = async (kind: AgentKnowledgeKind) => {
    if (!selectedStudent) return;
    await copyText(buildAiAgentScanPrompt(selectedStudent, kind), `已复制 AI ${kind === 'soul' ? '人设' : '记忆'}扫描指令。`);
  };

  const parseAiAgentScanResult = (fallbackKind: AgentKnowledgeKind) => {
    if (!aiScanResultText.trim()) {
      setAgentScanMessage('请先粘贴 AI 扫描结果 JSON。');
      return;
    }
    try {
      const parsed = parseLooseJson(aiScanResultText);
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.candidates) ? parsed.candidates : [];
      const candidates = list
        .map((item: unknown) => normalizeAiScanCandidate((item || {}) as Record<string, unknown>, fallbackKind))
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
    const tool = getAgentToolProfile(student.agentTool);
    await copyText(buildToolPrompt(student), `已复制 ${tool.name} 完整初始化指令。`);
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
    if (app === 'obsidian') setObsidianOpened((value) => value || Boolean(ok));
    if (!bridge()?.openApp) {
      const urls: Record<AgentToolId | 'obsidian' | 'tailscale', string> = {
        qclaw: 'qclaw://',
        marvis: 'marvis://',
        hohu: 'https://hohu.ai/',
        openclaw: 'https://openclaw.ai/',
        obsidian: 'obsidian://open',
        tailscale: 'https://tailscale.com/download/windows',
      };
      window.open(urls[app], '_blank');
    }
  };

  const importFilesForStudent = (student: Student) => {
    setPendingImportStudentId(student.id);
    const ok = bridge()?.importFiles?.(student.id);
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
          : visibleFiles.find((file) => classifyMarkdownFile(file, archiveKeywords) === selectedArchiveCategory) ?? visibleFiles[0];
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
  ];

  const deleteStudent = (student: Student) => {
    const confirmed = window.confirm(`确认从控制台删除「${student.name}」的学生记录吗？\n\n这只删除控制台里的学生列表，不会删除外部 Agent，也不会删除已经导出的资料文件。`);
    if (!confirmed) return;
    const next = students.filter((item) => item.id !== student.id);
    persist(next);
    setSelectedId(next[0]?.id ?? '');
    if (next.length === 0) {
      setActiveSection('init');
    }
  };

  const openToolDownload = (tool: AgentToolId) => {
    const urls: Record<AgentToolId, string> = {
      qclaw: 'https://qclaw.qq.com/',
      marvis: 'https://marvis.qq.com/',
      hohu: 'https://hohu.ai/',
      openclaw: 'https://openclaw.ai/',
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

  const navItems = [
    { id: 'home' as const, label: '首页', icon: Home },
    { id: 'init' as const, label: '初始化教育管家', icon: Sparkles },
    { id: 'new' as const, label: '新建教育智能体', icon: Plus },
    { id: 'inbox' as const, label: '资料收集与处理', icon: FileDown },
    { id: 'archive' as const, label: '查看教育档案', icon: BookOpen },
    { id: 'qa' as const, label: '教育管家问答', icon: MessageCircle },
    { id: 'tasks' as const, label: '定时任务', icon: Clock3 },
    { id: 'settings' as const, label: '系统设置', icon: Settings },
  ];
  const knowledgeNavItems = [
    { id: 'memory' as const, label: 'Agent 记忆管理', icon: Clipboard },
    { id: 'soul' as const, label: 'Agent 设定管理', icon: Bot },
    { id: 'rules' as const, label: '智能体规则文件管理', icon: ListChecks },
  ];

  return (
    <main
      className={sidebarCollapsed ? 'app-shell sidebar-collapsed' : 'app-shell'}
      data-theme={theme}
      style={{ '--skin-image': `url(${themeSkinImages[theme]})` } as React.CSSProperties}
    >
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <img src="brand/robogala-round.png" alt="群星矩阵" />
          </div>
          <div className="brand-copy">
            <img className="brand-wordmark" src="brand/robogala-wordmark.png" alt="ROBOGALA 群星矩阵" />
            <span>AI教育管家控制台</span>
          </div>
          <button className="icon-button sidebar-hide-button" onClick={() => setSidebarCollapsed(true)} aria-label="隐藏左边栏" title="隐藏左边栏">
            <PanelLeftClose size={18} />
          </button>
        </div>

        <nav className="nav-list">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={activeSection === item.id ? 'nav-item active' : 'nav-item'}
                key={item.id}
                onClick={() => setActiveSection(item.id)}
              >
                <Icon size={19} />
                <span>{item.label}</span>
              </button>
            );
          })}
          <div className="nav-group-block">
            <button
              className={activeSection === 'memory' || activeSection === 'soul' || activeSection === 'rules' ? 'nav-item nav-group active' : 'nav-item nav-group'}
              onClick={() => setAgentKnowledgeMenuOpen((value) => !value)}
            >
              <Bot size={19} />
              <span>智能体知识管理</span>
              <span className="nav-chevron">{agentKnowledgeMenuOpen ? '收起' : '展开'}</span>
            </button>
            {agentKnowledgeMenuOpen && (
              <div className="sub-nav-list">
                {knowledgeNavItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      className={activeSection === item.id ? 'nav-item sub-nav-item active' : 'nav-item sub-nav-item'}
                      key={item.id}
                      onClick={() => setActiveSection(item.id)}
                    >
                      <Icon size={17} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </nav>

        <section className="student-rail">
          <div className="rail-title">
            <span>学生档案</span>
            <button aria-label="新增学生" onClick={() => setActiveSection('new')}>
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
                    {student.grade} · {getAgentToolProfile(student.agentTool).name} · {student.knowledgeBaseMode === 'adopted' ? '接管知识库' : '标准知识库'}
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
              用户协议 <ExternalLink size={12} />
            </button>
            <button className="inline-link" type="button" onClick={openPrivacyPolicy}>
              隐私政策 <ExternalLink size={12} />
            </button>
          </span>
        </div>
      </aside>

      {sidebarCollapsed && (
        <button className="sidebar-reveal" onClick={() => setSidebarCollapsed(false)} aria-label="显示左边栏" title="显示左边栏">
          <PanelLeftOpen size={18} />
          <span>显示左边栏</span>
        </button>
      )}

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>
              {activeSection === 'new'
                ? '新建教育智能体'
                : activeSection === 'archive'
                  ? '查看教育档案'
                  : activeSection === 'inbox'
                    ? '资料收集与处理'
                  : activeSection === 'qa'
                    ? '教育管家问答'
                  : activeSection === 'memory'
                    ? 'Agent 记忆管理'
                  : activeSection === 'soul'
                    ? 'Agent 设定管理'
                  : activeSection === 'rules'
                    ? '智能体规则文件管理'
                  : activeSection === 'tasks'
                    ? '定时任务'
                    : activeSection === 'settings'
                      ? '系统设置'
                      : activeSection === 'home'
                        ? '控制台首页'
                        : '教育管家初始化'}
            </h1>
            <p>半自动完成初始文档导出、Agent 工具初始化指令和 Obsidian 查看入口。</p>
          </div>
          <div className="status-row">
            <label className="theme-picker">
              更换皮肤
              <select value={theme} onChange={(event) => changeTheme(event.target.value as ThemeName)}>
                {themeOptions.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <span className={activeAgentOpened ? 'status ok' : 'status warn'}>
              {activeAgentOpened ? `${activeAgentTool.name} 已打开` : `${activeAgentTool.name} 未打开`}
            </span>
          </div>
        </header>

        {shouldBlockForAgentInstall && (
          <section className="panel install-gate">
            <div className="panel-heading">
              <div>
                <h2>请先安装 Agent 工具</h2>
                <p>Windows 版需要先安装 QClaw、Marvis、Hohu 或 OpenClaw，控制台才能创建并引导本机教育管家。</p>
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
                      下载 {tool.name}
                    </button>
                  </article>
                );
              })}
            </div>
            <div className="actions">
              <button className="secondary" onClick={refreshInstallStatus}>
                <RefreshCw size={18} />
                重新检测
              </button>
            </div>
            {installMessage && <div className="notice">{installMessage}</div>}
          </section>
        )}

        {!shouldBlockForAgentInstall && activeSection === 'home' && (
          <>
            <div className="home-grid">
              <InfoPanel icon={<Bot />} title="Agent 创建" value={`${students.length} 个学生档案`} />
              <InfoPanel icon={<Archive />} title="资料入口" value="原始资料库待同步" />
              <InfoPanel icon={<RefreshCw />} title="当前版本" value={`v${currentVersionName}`} />
              {isWindows && <InfoPanel icon={<KeyRound />} title="授权状态" value={licenseLabel(licenseStatus || hostServiceStatus?.license)} />}
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
                    <button className="secondary compact" onClick={() => setActiveSection('init')}>去初始化</button>
                  </div>
                  <div className={hostServiceStatus?.running ? 'check-row done' : 'check-row'}>
                    <CheckCircle2 size={17} />
                    <span>2. 需要平板协作时启动主机服务</span>
                    <button className="secondary compact" onClick={() => setHomeMode('host')}>查看主机服务</button>
                  </div>
                  <div className={(hostServiceStatus?.devices ?? []).some((device) => !device.revoked) ? 'check-row done' : 'check-row'}>
                    <CheckCircle2 size={17} />
                    <span>3. 平板扫码绑定并授权学生范围</span>
                    <button className="secondary compact" onClick={copyHostConnectionInfo}>复制连接信息</button>
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
                {renderHostPairingPanel()}
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
                  <button className="secondary" onClick={repairHostService}>
                    <RefreshCw size={18} />
                    修复/重启服务
                  </button>
                  <button className="primary" onClick={hostServiceStatus?.running ? stopHostService : startHostService}>
                    {hostServiceStatus?.running ? '停止服务' : '启动服务'}
                  </button>
                  <button className="secondary" onClick={copyHostConnectionInfo}>
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
                      <button className="secondary compact" onClick={clearHostUploadRecords}>
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
                  <p>选择默认 Agent 工具，检查打开状态，或下载安装 QClaw、Marvis、Hohu、OpenClaw。</p>
                </div>
                <Bot size={22} />
              </div>
              <div className="tool-selector">
                <span>默认 Agent 工具</span>
                <div className="tool-options">
                  {agentToolOptions.map((baseTool) => {
                    const tool = getAgentToolProfile(baseTool.id);
                    return (
                      <button
                        className={draft.agentTool === tool.id ? 'tool-option active' : 'tool-option'}
                        key={tool.id}
                        onClick={() => {
                          setDraft({ ...draft, agentTool: tool.id });
                          setAgentBindingMode(agentBindingModeForTool(tool.id));
                        }}
                      >
                        <strong>{tool.name}</strong>
                        <small>{tool.supportsScheduledTask ? '支持定时任务' : tool.supportsLocalFiles ? '本机目录可用' : '手动消化资料'}</small>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="agent-status-list">
                {agentToolOptions.map((baseTool) => {
                  const tool = getAgentToolProfile(baseTool.id);
                  const install = installStatus?.[tool.id];
                  const opened = toolOpenState[tool.id];
                  return (
                    <article className="agent-status-card" key={tool.id}>
                      <div>
                        <strong>{tool.name}</strong>
                        <span>{install?.installed ? `已安装${install.version ? ` ${install.version}` : ''}` : '未检测到安装'}</span>
                        {install?.exePath && <small>{install.exePath}</small>}
                      </div>
                      <span className={opened ? 'status ok' : 'status warn'}>{opened ? '已打开' : '未打开'}</span>
                      <div className="agent-status-actions">
                        <button className="primary compact" onClick={() => openExternal(tool.id)}>
                          <ExternalLink size={16} />
                          打开
                        </button>
                        <button className="secondary compact" onClick={() => openToolDownload(tool.id)}>
                          下载
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

        {!shouldBlockForAgentInstall && (activeSection === 'init' || activeSection === 'new') && (
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

              <div className="tool-selector">
                <span>Agent 工具</span>
                <div className="tool-options">
                  {agentToolOptions.map((baseTool) => {
                    const tool = getAgentToolProfile(baseTool.id);
                    return (
                      <button
                        className={draft.agentTool === tool.id ? 'tool-option active' : 'tool-option'}
                        key={tool.id}
                        onClick={() => {
                          setDraft({ ...draft, agentTool: tool.id });
                          setAgentBindingMode(agentBindingModeForTool(tool.id));
                          setSelectedInitStep('folder');
                        }}
                      >
                        <strong>{tool.name}</strong>
                        <small>{tool.supportsScheduledTask ? '支持定时任务' : tool.supportsLocalFiles ? '本机目录可用' : '手动消化资料'}</small>
                      </button>
                    );
                  })}
                </div>
              </div>

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
                <button className="secondary" onClick={() => openExternal(selectedTool.id)}>
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

        {!shouldBlockForAgentInstall && activeSection === 'inbox' && selectedStudent && (
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
              <button className="primary" onClick={() => openExternal(selectedStudentTool.id)}>
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
            />
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
              <button className="secondary" onClick={authorizeArchiveRoot}>
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
              <button className="secondary danger" onClick={() => deleteStudent(selectedStudent)}>
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
                  <button className="primary" onClick={saveSelectedStudentProfile}>
                    保存学生资料
                  </button>
                  {isWindows && selectedStudent.knowledgeBaseMode !== 'adopted' && (
                    <>
                      <button className="secondary" onClick={migrateSelectedStudentWorkspace}>
                        <FolderOpen size={18} />
                        迁移/重命名知识库目录
                      </button>
                      <button className="secondary" onClick={() => openStudentRawDir(selectedStudent)}>
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
                    <button className="secondary" onClick={() => openStudentRawDir(selectedStudent)}>
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

        {!shouldBlockForAgentInstall && activeSection === 'qa' && selectedStudent && (
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
              <button className="primary" onClick={() => openExternal(selectedStudentTool.id)}>
                <ExternalLink size={18} />
                {selectedStudentTool.openLabel}
              </button>
              <button className="secondary" onClick={() => copyDigestCommand(selectedStudent)}>
                <Clipboard size={18} />
                复制资料消化指令
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

        {!shouldBlockForAgentInstall && activeSection === 'memory' && selectedStudent && (
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
            <div className="source-list">
              {(agentCenter?.memoryIndex?.sources ?? []).map((source) => (
                <div className="source-row" key={source.tool}>
                  <strong>{getAgentToolProfile(source.tool).name}</strong>
                  <span>{source.exists ? '已保存' : '未导入'}</span>
                  <small>{source.currentPath}</small>
                </div>
              ))}
            </div>
            {agentScanMessage && activeSection === 'memory' && <div className="notice muted">{agentScanMessage}</div>}
            {agentCenterMessage && <div className="notice">{agentCenterMessage}</div>}
          </section>
        )}

        {!shouldBlockForAgentInstall && activeSection === 'soul' && selectedStudent && (
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
            {agentScanMessage && activeSection === 'soul' && <div className="notice muted">{agentScanMessage}</div>}
            {agentCenterMessage && <div className="notice">{agentCenterMessage}</div>}
          </section>
        )}

        {!shouldBlockForAgentInstall && activeSection === 'rules' && selectedStudent && (
          <section className="panel qa-panel">
            <div className="panel-heading">
              <div>
                <h2>智能体规则文件管理</h2>
                <p>管理当前学生知识库根目录下的 AGENT.md、Claude.md、Claud.md 等规则性 Markdown 文件。</p>
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
                  placeholder="例如 Claude.md / Claud.md / OpenClaw.md"
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
              <button className="secondary" onClick={() => {
                setRuleFileName('Claude.md');
                const existing = ruleFiles.find((file) => file.fileName.toLowerCase() === 'claude.md');
                setRuleContent(existing?.content || `# ${selectedStudent.name} Claude.md\n\n## 工作规则\n\n该 Agent 的工作协议使用：${selectedStudentPaths.agent}\n后续所有学习资料消化都围绕该学生知识库执行。\n`);
              }}>
                准备 Claude.md
              </button>
            </div>
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
            {ruleMessage && <div className="notice">{ruleMessage}</div>}
          </section>
        )}

        {!shouldBlockForAgentInstall && activeSection === 'qa' && !selectedStudent && (
          <section className="panel qa-panel">
            <div className="empty-state">请先初始化或新建教育管家，再进入问答模块。</div>
          </section>
        )}

        {!shouldBlockForAgentInstall && activeSection === 'tasks' && (
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
                <h2>系统设置</h2>
                <p>{isWindows ? '默认根目录：D:\\学生资料；可在设置中更换资料根目录，并检测本机 Agent 工具安装状态。' : '默认使用 App 内置资料库；Downloads 导出与 Obsidian Vault 授权作为备份和高级浏览方式。'}</p>
              </div>
              <Settings size={22} />
            </div>
            <div className="status-grid">
              {(isWindows
                ? [
                    ['存储模式', 'Windows 本机目录'],
                    ['授权状态', licenseLabel(licenseStatus || hostServiceStatus?.license)],
                    ['学生资料根目录', storageConfig.baseDir],
                    ['QClaw', installStatus?.qclaw.installed ? `已安装 ${installStatus.qclaw.version ?? ''}` : '未安装'],
                    ['Marvis', installStatus?.marvis.installed ? `已安装 ${installStatus.marvis.version ?? ''}` : '未安装'],
                    ['Hohu', installStatus?.hohu.installed ? `已安装 ${installStatus.hohu.version ?? ''}` : '未安装'],
                    ['OpenClaw', installStatus?.openclaw?.installed ? `已安装 ${installStatus.openclaw.version ?? ''}` : '未安装'],
                    ['Tailscale 软件', installStatus?.tailscale?.installed ? `已安装 ${installStatus.tailscale.version ?? ''}` : '未安装'],
                    ['QClaw 路径', installStatus?.qclaw.exePath || '未检测到'],
                    ['Marvis 路径', installStatus?.marvis.exePath || '未检测到'],
                    ['Hohu 路径', installStatus?.hohu.exePath || '未检测到'],
                    ['OpenClaw 路径', installStatus?.openclaw?.exePath || '未检测到'],
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
                ? 'QClaw、Marvis、Hohu 和 OpenClaw 将使用同一个本机学生知识库目录。默认根目录为 D:\\学生资料；更换资料根目录后，新建和导入都会写入新目录。'
                : String(compatibility?.message ?? '在 Android APK 中可查看完整兼容性检测结果。')}
            </div>
            {isWindows && (
              <div className="actions">
                <button className="secondary compact" onClick={refreshInstallStatus}>
                  重新检测软件
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
                    <span>{licenseLabel(licenseStatus || hostServiceStatus?.license)}</span>
                    <span>学生数：{(licenseStatus || hostServiceStatus?.license)?.studentLimit ?? '-'}</span>
                    <span>平板设备：{(licenseStatus || hostServiceStatus?.license)?.deviceLimit ?? '-'}</span>
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
              </div>
            )}
            <div className="notice legal-notice">
              <div>
                <strong>法律与服务条款</strong>
                <p>继续使用本软件前，请阅读并理解用户协议与隐私政策。商业部署时建议同步配置正式售后、隐私与订阅说明。</p>
              </div>
              <div className="legal-actions">
                <button className="secondary compact" onClick={openUserAgreement}>
                  用户协议
                  <ExternalLink size={16} />
                </button>
                <button className="secondary compact" onClick={openPrivacyPolicy}>
                  隐私政策
                  <ExternalLink size={16} />
                </button>
              </div>
            </div>
            {isWindows && (
              <div className="notice">
                <strong>主机服务连接信息</strong>
                <p>平板端后续可使用 serverUrl 和 API token 上传资料、读取学情分析汇总 Markdown。</p>
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
                  <button className="secondary" onClick={saveHostServicePort}>
                    保存端口
                  </button>
                  <button className="primary" onClick={hostServiceStatus?.running ? stopHostService : startHostService}>
                    {hostServiceStatus?.running ? '停止主机服务' : '启动主机服务'}
                  </button>
                  <button className="secondary" onClick={copyHostConnectionInfo}>
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
                重新检测
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

function StudentToolSelector({ value, onChange }: { value: AgentToolId; onChange: (value: AgentToolId) => void }) {
  return (
    <div className="student-tool-switch">
      <span>当前 Agent 工具</span>
      <div className="tool-options compact-tools">
        {agentToolOptions.map((baseTool) => {
          const tool = getAgentToolProfile(baseTool.id);
          return (
            <button
              className={value === tool.id ? 'tool-option active' : 'tool-option'}
              key={tool.id}
              onClick={() => onChange(tool.id)}
            >
              <strong>{tool.name}</strong>
              <small>{tool.supportsScheduledTask ? '支持定时任务' : tool.supportsLocalFiles ? '本机目录可用' : '手动消化资料'}</small>
            </button>
          );
        })}
      </div>
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

  const flushList = (key: string) => {
    if (listBuffer.length === 0) return;
    const ordered = listBuffer.every((item) => item.ordered);
    const children = listBuffer.map((item, index) => <li key={`${key}-${index}`}>{renderInlineMarkdown(item.text, `${key}-${index}`)}</li>);
    blocks.push(ordered ? <ol key={key}>{children}</ol> : <ul key={key}>{children}</ul>);
    listBuffer = [];
  };

  const flushTable = (key: string) => {
    if (tableBuffer.length === 0) return;
    const rows = tableBuffer.filter((row) => !row.every((cell) => /^:?-{3,}:?$/.test(cell.trim())));
    if (rows.length > 0) {
      blocks.push(
        <div className="md-table-wrap" key={key}>
          <table>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`${key}-row-${rowIndex}`}>
                  {row.map((cell, cellIndex) =>
                    rowIndex === 0 ? (
                      <th key={`${key}-${rowIndex}-${cellIndex}`}>{renderInlineMarkdown(cell.trim(), `${key}-${rowIndex}-${cellIndex}`)}</th>
                    ) : (
                      <td key={`${key}-${rowIndex}-${cellIndex}`}>{renderInlineMarkdown(cell.trim(), `${key}-${rowIndex}-${cellIndex}`)}</td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    }
    tableBuffer = [];
  };

  const flushFlow = (key: string) => {
    flushList(`${key}-list`);
    flushTable(`${key}-table`);
  };

  lines.forEach((line, index) => {
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
      return;
    }

    if (inCode) {
      codeBuffer.push(line);
      return;
    }

    if (!line.trim()) {
      flushFlow(`flow-${index}`);
      blocks.push(<div className="md-space" key={`space-${index}`} />);
      return;
    }

    const tableLine = line.trim();
    if (tableLine.startsWith('|') && tableLine.endsWith('|')) {
      flushList(`list-before-table-${index}`);
      tableBuffer.push(tableLine.slice(1, -1).split('|'));
      return;
    }

    flushTable(`table-before-${index}`);

    if (line.startsWith('# ')) {
      flushList(`list-before-h1-${index}`);
      blocks.push(<h1 key={index}>{renderInlineMarkdown(line.slice(2), `h1-${index}`)}</h1>);
      return;
    }
    if (line.startsWith('## ')) {
      flushList(`list-before-h2-${index}`);
      blocks.push(<h2 key={index}>{renderInlineMarkdown(line.slice(3), `h2-${index}`)}</h2>);
      return;
    }
    if (line.startsWith('### ')) {
      flushList(`list-before-h3-${index}`);
      blocks.push(<h3 key={index}>{renderInlineMarkdown(line.slice(4), `h3-${index}`)}</h3>);
      return;
    }
    if (line.startsWith('> ')) {
      flushList(`list-before-quote-${index}`);
      blocks.push(<blockquote key={index}>{renderInlineMarkdown(line.slice(2), `quote-${index}`)}</blockquote>);
      return;
    }
    const listMatch = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/);
    if (listMatch) {
      listBuffer.push({ ordered: /^\d/.test(listMatch[2]), text: listMatch[3] });
      return;
    }
    flushList(`list-before-p-${index}`);
    blocks.push(<p key={index}>{renderInlineMarkdown(line, `p-${index}`)}</p>);
  });

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

