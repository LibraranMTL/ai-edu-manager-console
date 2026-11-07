import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
const StudentPublishedCards = React.lazy(() => import('./StudentPublishedCards').then(module => ({default:module.StudentPublishedCards})));
import {
  Archive,
  ArrowRight,
  Bot,
  BookOpen,
  Camera,
  Copy,
  Download,
  FileText,
  FolderSync,
  LibraryBig,
  LogOut,
  Mic,
  MonitorUp,
  RefreshCw,
  Settings,
  Target,
  TrendingUp,
  Upload,
  UserRound,
  Wifi,
  X,
  type LucideIcon,
} from 'lucide-react';
import { renderTerminalMarkdown } from './terminal-markdown.js';
import { TerminalProjectMaterialsPanel } from './TerminalProjectMaterialsPanel';
import './terminal-styles.css';

type StudentProgress = { submittedTodayCount?: number; recentUploadCount7?: number; previousUploadCount7?: number; recentTrend?: number; activeDays30?: number; knowledgeAssetCount?: number; newSinceLastDigestCount?: number; lastUploadAt?: string };
type Student = { id: string; name: string; grade?: string; rawFileCount?: number; archiveFileCount?: number; pendingDigestCount?: number; processedDigestCount?: number; submittedTodayCount?: number; recentUploadCount7?: number; recentUploadTrend?: number; activeDays30?: number; knowledgeAssetCount?: number; newSinceLastDigestCount?: number; progress?: StudentProgress };
type Project = { id: string; name: string; studentIds?: string[]; status?: string;
  materialStorageMode?: string; materialMigrationState?: string; materialCapabilities?: { supported?: boolean; operations?: {
    list?: boolean; originalDownload?: boolean; classificationSuggest?: boolean; classificationWrite?: boolean;
    knowledgeRead?: boolean; evidenceRead?: boolean;
  } } };
type UploadTarget = { type: 'student' | 'project'; id: string; name: string; studentId: string };
type CaptureMode = 'smart' | 'change' | 'interval';
type CaptureOptions = { mode?: CaptureMode; policyName?: string; durationMinutes?: number };
type TerminalConfig = {
  connected: boolean;
  hostUrl: string;
  token: string;
  deviceId?: string;
  machineCode?: string;
  deviceName: string;
  version: string;
  terminalMode?: 'personal' | 'shared';
  studentSessionActive?: boolean;
  currentStudent?: Student | null;
  autoDelivery?: { enabled?: boolean; folder?: string; target?: UploadTarget | null };
  agentCapture?: Partial<AgentCaptureState>;
};
type CaptureSource = { id: string; name: string; type: 'screen' | 'window'; available?: boolean; blocked?: boolean; blockReason?: string };
type CaptureItem = { id: string; path: string; filename: string; capturedAt: string; sequence: number };
type CaptureSession = { id: string; status: string; sourceName: string; sourceType?: 'screen' | 'window'; count: number; files: string[]; items?: CaptureItem[]; target?: UploadTarget; startedAt?: string; plannedEndAt?: string; endedAt?: string; endReason?: string; deliveryStatus?: string; options?: CaptureOptions; candidateFrameCount?: number; deduplicatedCount?: number; highlightedCount?: number; courseId?: string; courseProvider?: string; courseUrl?: string; courseStartedAt?: string; courseCompletedAt?: string };
type Course = { courseId: string; name: string; provider: string; url: string; allowedHosts: string[]; coverUrl: string; summary: string; gradeRange: string[]; languages: string[]; accountRequirement: string; legalNotice: string; offlineOpenUntil: string };
type CourseCatalogResponse = { ok: boolean; schemaVersion?: 2; hostId?: string; projectionRevision?: string; manifestRevision?: string; policyRevision?: string; studentId?: string; courses?: Course[]; disclaimer?: string };
type Progress = { status: string; current?: number; total?: number; filename?: string; success?: number; failed?: number; pending?: number; delivered?: number };
type UploadQueueItem = { queueId: string; uploadId: string; state: 'queued' | 'uploading' | 'receipt_unknown' | 'received'; hostId: string; dataGeneration: string; studentId: string; target: UploadTarget; filename: string; size: number; sourceType: string; attempt: number; createdAt?: string; updatedAt?: string; receivedAt?: string; lastError?: string; pauseCode?: string; receipt?: { materialId?: string; materialVersion?: number; receivedAt?: string } | null };
type UploadQueueState = { version: number; updatedAt?: string; total: number; counts: Record<string, number>; items: UploadQueueItem[]; hostScope?: { hostId?: string; dataGeneration?: string }; observedHostScope?: { hostId?: string; dataGeneration?: string } };
type LearningReport = { id: string; title: string; summary?: string; updatedAt?: string; status?: string };
type ArchiveFile = { path: string; name?: string };
type GrowthSummary = {
  updatedAt?: string;
  summary?: { evidenceCount?: number; confirmedCount?: number; watchingCount?: number; abilityCount?: number; projectCount?: number; publishedProjectCount?: number; lastEvidenceAt?: string };
  abilities?: Array<{ name?: string; maturityLabel?: string; trendLabel?: string; evidenceCount?: number; confirmedCount?: number; projectNames?: string[]; lastObservedAt?: string }>;
  projects?: Array<{ projectName?: string; reviewStatusLabel?: string; evidenceCount?: number; confirmedEvidenceCount?: number; abilityNames?: string[]; updatedAt?: string }>;
  recentEvidence?: Array<{ title?: string; statusLabel?: string; ability?: string; projectName?: string; updatedAt?: string }>;
};
type DiscoveredHost = { deviceId: string; machineCode: string; displayName: string; appVersion?: string; protocolVersion: number; hostUrl: string; address?: string; lastSeenAt?: string };
type PendingPairRequest = { requestId: string; status: string; hostId: string; hostMachineCode: string; hostName: string; hostUrl: string; createdAt?: string; expiresAt?: string };
type TailscaleStatus = { installed: boolean; canOpen: boolean; version?: string; downloadUrl: string };
type ConnectionMethod = 'lan' | 'tailscale';
type StudentWorkspace = 'courses' | 'auto-delivery' | 'capture' | 'documents' | 'project-report' | 'practice' | 'planning' | 'inbox' | 'collaboration' | 'conversation' | 'trajectory' | null;
type StudentPrimaryModule = 'collection' | 'connection' | 'archive' | 'learning' | 'project';
type StudentPrimaryView = 'home' | StudentPrimaryModule;
type LearningStatusInput = { overallState: 'smooth' | 'normal' | 'difficult'; currentContent: string; completed: string; difficulties: string; nextPlan: string; helpNeeded: string; notes: string };
type LearningStatusEntry = LearningStatusInput & { id: string; submissionId: string; recordedByRole: 'student' | 'teacher'; recordingMode: string; createdAt: string };
type LearningTrajectoryState = { knowledgePoint: { id: string; label: string; subject: string }; state: string; confidence?: number | null; evidenceCount: number; lastPracticedAt?: string; reviewPriority?: string; recommendedReviewAt?: string; retentionNote?: string; updatedAt?: string };

function durableSubmissionId(storageKey: string, fingerprint: string, prefix: string) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey) || '{}') as { fingerprint?: string; submissionId?: string };
    if (saved.fingerprint === fingerprint && saved.submissionId) return saved.submissionId;
    const submissionId = `${prefix}-${crypto.randomUUID()}`;
    window.localStorage.setItem(storageKey, JSON.stringify({ fingerprint, submissionId }));
    return submissionId;
  } catch {
    return `${prefix}-${crypto.randomUUID()}`;
  }
}

function clearDurableSubmission(storageKey: string) {
  try { window.localStorage.removeItem(storageKey); } catch { /* app storage unavailable */ }
}

function currentIsoWeekKey(date = new Date()) {
  const value = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((value.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${value.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

type PracticeCard = { id: string; studentId: string; status: string; content: { title: string; subject: string; knowledgePoint: string; prompt: string; hint?: string; answer?: string; explanation?: string; rationale?: string }; createdAt?: string };
type PracticeDashboard = { current?: PracticeCard | null; history?: PracticeCard[] };
type PlanningKind = 'guidance' | 'topics' | 'competitions';
type PlanningCandidate = { id: string; title?: string; name?: string; fitReason?: string; deadline?: string; officialUrl?: string; matchReasons?: string[] };
type PlanningView = { studentId: string; current?: { id: string; version?: number; verifiedAt?: string; createdAt?: string; findings?: string[]; nearTermActions?: string[]; candidates?: PlanningCandidate[] } | null; needsRefresh?: boolean; configurationWarning?: string };
type PlanningFavorite = { candidateId: string; candidate: PlanningCandidate; savedAt: string; versionId: string };
type AgentCaptureRegistration = { installed?: boolean; connected?: boolean; warning?: string };
type AgentCaptureState = {
  enabled: boolean;
  active: boolean;
  registrations: Record<string, AgentCaptureRegistration>;
  warnings: string[];
  installedCount: number;
  connectedCount: number;
  pending: number;
  lastSyncAt?: string;
  message?: string;
};
type PairingState = {
  discoveryRunning: boolean;
  discoveryPort: number;
  discoveryError?: string;
  lastHostDiscoveryAt?: string;
  terminalIdentity?: { deviceId: string; machineCode: string; displayName: string };
  discoveredHosts: DiscoveredHost[];
  pendingRequest?: PendingPairRequest | null;
  pendingInvite?: PendingPairRequest | null;
  lastResult?: { status: string; message?: string; updatedAt?: string } | null;
};

const CAPTURE_MODE_COPY: Record<CaptureMode, { label: string; description: string }> = {
  smart: { label: '智能混合（推荐）', description: '内容变化优先，并在较长时间无变化时补存，适合网课、PPT、教材和网页。' },
  change: { label: '内容变化', description: '只在明显翻页、滚动或窗口内容变化时保留截图。' },
  interval: { label: '固定间隔', description: '按固定间隔保留截图，仍会跳过完全相同的画面。' },
};

type TerminalBridge = {
  getConfig: () => Promise<TerminalConfig>;
  getTailscaleStatus: () => Promise<TailscaleStatus>;
  openTailscale: () => Promise<{ ok: boolean; message?: string; status: TailscaleStatus }>;
  downloadTailscale: () => Promise<{ ok: boolean; message?: string; url: string }>;
  getPairingState: (query?: string) => Promise<PairingState>;
  findLanHosts: (query?: string) => Promise<{ ok: boolean; message?: string; state: PairingState }>;
  requestHostPair: (hostDeviceId: string) => Promise<{ ok: boolean; message?: string; state: PairingState }>;
  cancelPairRequest: () => Promise<{ ok: boolean; message?: string; state: PairingState }>;
  acceptPairInvite: () => Promise<{ ok: boolean; message?: string; state: PairingState; config?: TerminalConfig }>;
  rejectPairInvite: () => Promise<{ ok: boolean; message?: string; state: PairingState; config?: TerminalConfig }>;
  copyMachineCode: () => Promise<{ ok: boolean; value: string }>;
  pair: (input: Record<string, string>) => Promise<{ message?: string; config: TerminalConfig }>;
  disconnect: () => Promise<{ config: TerminalConfig }>;
  loadState: () => Promise<{ students: Student[]; projects: Project[]; requiresLogin?: boolean; message?: string; device?: { terminalMode?: 'personal' | 'shared'; boundStudentId?: string }; config: TerminalConfig }>;
  setMode: (terminalMode: 'personal' | 'shared') => Promise<{ message?: string; config: TerminalConfig }>;
  loginStudent: (loginId: string) => Promise<{ message?: string; student?: Student; students?: Student[]; projects?: Project[]; config: TerminalConfig }>;
  logoutStudent: () => Promise<{ config: TerminalConfig }>;
  getAgentCapture: () => Promise<AgentCaptureState>;
  setAgentCapture: (enabled: boolean) => Promise<AgentCaptureState>;
  runAgentCapture: () => Promise<AgentCaptureState>;
  getAgentBridge: () => Promise<{ enabled: boolean; port: number; startedAt?: string; queryCount?: number; lastQueryAt?: string; lastError?: string; descriptorFile?: string; studentId?: string }>;
  setAgentBridge: (enabled: boolean) => Promise<{ enabled: boolean; port: number; startedAt?: string; queryCount?: number; lastQueryAt?: string; lastError?: string; descriptorFile?: string; studentId?: string }>;
  copyAgentBridgeConfig: () => Promise<{ ok: boolean; message?: string; config?: string }>;
  getUploadQueue: () => Promise<UploadQueueState>;
  retryUploadQueue: () => Promise<{ ok?: boolean; queue: UploadQueueState }>;
  acknowledgeUploadGeneration: () => Promise<{ ok: boolean; message?: string; queue: UploadQueueState }>;
  chooseAndUploadFiles: (target: UploadTarget) => Promise<{ cancelled?: boolean; success?: number; failed?: number; pending?: number; total?: number }>;
  chooseAutoFolder: () => Promise<{ ok: boolean; folder: string }>;
  configureAutoDelivery: (input: { enabled: boolean; folder: string; target: UploadTarget }) => Promise<{ ok: boolean }>;
  runAutoDelivery: () => Promise<{ ok: boolean }>;
  getLearningCapabilities: () => Promise<{ capabilities?: { practice?: boolean; planningRead?: boolean; planningFavorites?: boolean; remoteInbox?: boolean; learningStatus?: boolean; learningTrajectory?: boolean; projectComprehensiveReport?: boolean; weeklyKnowledgeGrowthImage?: boolean; conversationImport?: boolean } }>;
  getPracticeDashboard: () => Promise<{ studentId: string; dashboard: PracticeDashboard; synchronization?: { pending?: number; rejected?: Array<{ attemptId: string; cardId: string; answer: string; error: string }>; warning?: string } }>;
  startPracticeCard: (cardId: string) => Promise<{ studentId: string; card: PracticeCard }>;
  submitPracticeCard: (cardId: string, input: { attemptId: string; answer: string; difficulty: string; confidence: number }) => Promise<{ studentId: string; card?: PracticeCard; duplicate?: boolean; pending?: boolean; message?: string }>;
  getPlanningView: (kind: PlanningKind) => Promise<PlanningView>;
  getPlanningFavorites: (kind: 'topics' | 'competitions') => Promise<{ studentId: string; favorites: PlanningFavorite[] }>;
  setPlanningFavorite: (kind: 'topics' | 'competitions', versionId: string, candidateId: string, saved: boolean) => Promise<{ studentId: string; favorites: PlanningFavorite[] }>;
  getLearningInbox: () => Promise<{ studentId: string; items: Array<{ itemId: string; originalName: string; receivedAt: string; status: string }> }>;
  submitLearningInbox: (input: { eventId: string; title: string; text: string }) => Promise<{ studentId: string; duplicate?: boolean }>;
  listLearningReports: () => Promise<{ reports?: LearningReport[] }>;
  getLearningStatus: () => Promise<{ entries?: LearningStatusEntry[] }>;
  submitLearningStatus: (input: LearningStatusInput & { submissionId: string }) => Promise<{ entry: LearningStatusEntry }>;
  getProjectComprehensiveReport: (projectId: string) => Promise<{ title: string; status: string; content: string; updatedAt?: string }>;
  listKnowledgeGrowthWeeks: () => Promise<{ weeks?: string[]; currentWeek?: string }>;
  getKnowledgeGrowthImage: (week: string) => Promise<{ week: string; mimeType: string; imageBase64: string; status?: string }>;
  getLearningTrajectory: () => Promise<{ status: string; message?: string; taxonomyVersion?: string; states?: LearningTrajectoryState[] }>;
  uploadCapturedMedia: (input: { kind: 'photo' | 'audio'; mimeType: string; base64: string; sourceEventId: string }, target: UploadTarget) => Promise<{ success?: number; failed?: number; pending?: number; total?: number; localRecoveryPath?: string }>;
  quickScreenshot: (sourceId: string, target: UploadTarget) => Promise<{ success?: number; failed?: number; pending?: number; total?: number }>;
  exportKnowledgeGrowthImage: (input: { week: string; mimeType: string; imageBase64: string }, action: 'save' | 'copy' | 'share') => Promise<{ ok: boolean; cancelled?: boolean; message?: string; path?: string }>;
  exportStudentMaterialStatsImage: (input: { week: string; mimeType: string; imageBase64: string }, action: 'save' | 'share') => Promise<{ ok: boolean; cancelled?: boolean; message?: string; path?: string }>;
  showCompanion: () => Promise<{ ok: boolean }>;
  showCompanionPanel: (mode: 'learning' | 'project-tutor') => Promise<{ ok: boolean; message?: string }>;
  chooseConversationFile: () => Promise<{ cancelled?: boolean; name?: string; text?: string }>;
  previewConversationLink: (url: string) => Promise<{ content: string; finalUrl?: string; title?: string }>;
  submitConversation: (input: { text: string; title?: string; target: UploadTarget; submissionId: string }) => Promise<{ message?: string; receipt?: { status?: string } }>;
  takeConversationImport: () => Promise<{ draftId: string; source: string; link?: string; text?: string; name?: string; receivedAt?: string } | null>;
  checkUpdate: () => Promise<{ available: boolean; currentVersion: string; versionName: string; url: string; sha256?: string; size?: number; notes?: string }>;
  downloadUpdate: (update: Record<string, unknown>) => Promise<{ ok: boolean; path: string; sha256: string }>;
  getGrowthSummary: () => Promise<GrowthSummary>;
  readLearningReport: (reportId: string) => Promise<LearningReport & { content?: string }>;
  listArchiveFiles: () => Promise<{ files?: ArchiveFile[] }>;
  readArchiveFile: (relativePath: string) => Promise<{ path?: string; content?: string }>;
  listProjectKnowledgeFiles: (projectId: string) => Promise<{ projectId?: string; projectName?: string; files?: ArchiveFile[] }>;
  readProjectKnowledgeFile: (projectId: string, relativePath: string) => Promise<{ projectId?: string; projectName?: string; path?: string; content?: string }>;
  getProjectMaterialView: (projectId: string, query: Record<string, unknown>) => Promise<any>;
  getProjectClassificationSuggestions: (projectId: string, query: Record<string, unknown>) => Promise<any>;
  submitProjectClassificationSuggestions: (projectId: string, input: Record<string, unknown>) => Promise<any>;
  applyProjectClassifications: (projectId: string, input: Record<string, unknown>) => Promise<any>;
  getProjectMaterialOrganization: (projectId: string) => Promise<any>;
  runProjectMaterialOrganization: (projectId: string, input: Record<string, unknown>) => Promise<any>;
  retryProjectMaterialOrganization: (projectId: string, operationId: string, input: Record<string, unknown>) => Promise<any>;
  readProjectKnowledgeDocument: (projectId: string, documentId: string) => Promise<any>;
  downloadProjectMaterialVersion: (projectId: string, materialId: string, version: number, title: string) => Promise<{ ok: boolean; message?: string }>;
  listCourses: () => Promise<CourseCatalogResponse>;
  openCourse: (courseId: string) => Promise<{ ok: boolean; open?: boolean; course?: Course; message?: string }>;
  closeCourse: () => Promise<{ ok: boolean; open?: boolean }>;
  setCourseViewTop: (top: number) => Promise<{ ok: boolean; top: number }>;
  listCaptureSources: () => Promise<CaptureSource[]>;
  startCapture: (input: Record<string, unknown>) => Promise<CaptureSession>;
  stopCapture: () => Promise<CaptureSession | null>;
  uploadCapture: (input: { files: string[]; captureItems?: CaptureItem[]; target: UploadTarget; captureSessionId: string; sourceName?: string; sourceType?: string; startedAt?: string; endedAt?: string; courseId?: string; courseUrl?: string; courseStartedAt?: string; courseCompletedAt?: string }) => Promise<{ success?: number; failed?: number; pending?: number; total?: number }>;
  onUploadProgress: (handler: (payload: Progress) => void) => void;
  onUploadQueueChanged: (handler: (payload: UploadQueueState) => void) => () => void;
  onAutoDelivery: (handler: (payload: Progress) => void) => void;
  onCaptureChanged: (handler: (payload: CaptureSession) => void) => void;
  onCourseBrowserChanged: (handler: (payload: { open: boolean; courseId?: string; name?: string; blocked?: boolean; message?: string }) => void) => void;
  onAgentCaptureChanged: (handler: (payload: AgentCaptureState) => void) => () => void;
  onPairingChanged: (handler: (payload: { state: PairingState; config: TerminalConfig }) => void) => () => void;
  onCompanionNavigate: (handler: (payload: { action: string }) => void) => () => void;
  onConversationImport: (handler: (payload: { draftId: string }) => void) => () => void;
};

declare global {
  interface Window { terminalBridge?: TerminalBridge }
}

function targetKey(target?: UploadTarget | null) {
  return target?.id ? `${target.type}:${target.id}` : '';
}

function growthLabel(value: unknown, fallback = '待标注') {
  const normalized = String(value || '').replace(/[\r\n\t]+/g, ' ').trim();
  if (!normalized) return fallback;
  const segments = normalized.replace(/\\/g, '/').split('/').filter(Boolean);
  const compact = segments.length > 1 && /^[a-z]:$/i.test(segments[0] || '') ? segments.at(-1) || normalized : normalized;
  return compact.replace(/[|]/g, '／').trim().slice(0, 110) || fallback;
}

function formatGrowthSummary(payload: GrowthSummary) {
  const summary = payload.summary || {};
  const abilities = payload.abilities || [];
  const projects = payload.projects || [];
  const evidence = payload.recentEvidence || [];
  const number = (value: unknown) => Number(value || 0);
  const tableCell = (value: unknown, fallback = '—') => growthLabel(value, fallback).replace(/\|/g, '／');
  const lines = [
    '# 我的成长模型',
    '',
    `> 更新于 ${payload.updatedAt ? payload.updatedAt.replace('T', ' ').slice(0, 16) : '等待主机更新'}。此页呈现资料和项目的成长证据状态，**不等同于学习掌握度或能力结论**。`,
    '',
    '| 成长证据 | 已确认 | 观察中 | 能力维度 | 关联项目 |',
    '| ---: | ---: | ---: | ---: | ---: |',
    `| ${number(summary.evidenceCount)} 条 | ${number(summary.confirmedCount)} 条 | ${number(summary.watchingCount)} 条 | ${number(summary.abilityCount)} 个 | ${number(summary.projectCount)} 个 |`,
    '',
    '## 能力画像',
    ...(abilities.length ? [
      '| 能力维度 | 当前状态 | 变化趋势 | 证据 | 关联项目 |',
      '| --- | --- | --- | ---: | --- |',
      ...abilities.map((item) => `| ${tableCell(item.name)} | ${tableCell(item.maturityLabel, '证据不足')} | ${tableCell(item.trendLabel, '尚不足以判断')} | ${number(item.evidenceCount)} 条 | ${(item.projectNames || []).map((name) => tableCell(name)).join('、') || '—'} |`),
    ] : ['暂无已形成的能力画像。']),
    '',
    '## 项目贡献',
    ...(projects.length ? [
      '| 项目 | 当前状态 | 已确认 / 证据 | 关联能力 |',
      '| --- | --- | ---: | --- |',
      ...projects.map((item) => `| ${tableCell(item.projectName, '未命名项目')} | ${tableCell(item.reviewStatusLabel, '积累中')} | ${number(item.confirmedEvidenceCount)} / ${number(item.evidenceCount)} 条 | ${(item.abilityNames || []).map((name) => tableCell(name)).join('、') || '—'} |`),
    ] : ['暂无项目贡献记录。']),
    '',
    '## 近期成长证据',
    ...(evidence.length ? evidence.map((item) => `- **${growthLabel(item.title, '成长证据')}** · ${growthLabel(item.statusLabel, '观察中')}${item.ability ? ` · ${growthLabel(item.ability)}` : ''}${item.projectName ? ` · ${growthLabel(item.projectName)}` : ''}`) : ['暂无已确认或观察中的成长证据。']),
  ];
  return lines.join('\n');
}

function StudentActionTile({
  icon: Icon,
  title,
  description,
  meta,
  tone,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  meta?: string;
  tone: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`student-action-tile ${tone}${active ? ' active' : ''}`}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
    >
      <span className="student-action-icon" aria-hidden="true"><Icon size={29} strokeWidth={2} /></span>
      {meta ? <span className="student-action-meta">{meta}</span> : null}
      <span className="student-action-copy"><strong>{title}</strong><small>{description}</small></span>
      <span className="student-action-arrow" aria-hidden="true"><ArrowRight size={17} /></span>
    </button>
  );
}

function MarkdownDocument({ content }: { content: string }) {
  const html = useMemo(() => renderTerminalMarkdown(content), [content]);
  return <div className="terminal-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}

function TailscaleSupportCard({
  status,
  busy,
  onRefresh,
  onOpen,
  onDownload,
}: {
  status: TailscaleStatus | null;
  busy: boolean;
  onRefresh: () => void;
  onOpen: () => void;
  onDownload: () => void;
}) {
  const statusLabel = !status
    ? '正在检测…'
    : status.installed
      ? `已安装${status.version ? ` · v${status.version}` : ''}`
      : '未检测到安装';
  return (
    <section className="terminal-tailscale-card" aria-label="Tailscale 远程连接支持">
      <div>
        <span className={status?.installed ? 'tailscale-state installed' : 'tailscale-state'}>{statusLabel}</span>
        <h3>Tailscale 远程连接</h3>
        <p>不在同一局域网时，可让学生终端和主机加入同一个 Tailscale 网络，再使用主机提供的 Tailscale 地址。</p>
      </div>
      <div className="terminal-tailscale-actions">
        <button className="terminal-secondary" onClick={onRefresh} disabled={busy}>重新检测</button>
        <button className="terminal-secondary" onClick={onOpen} disabled={busy || !status?.canOpen}>打开 Tailscale</button>
        <button className="terminal-primary" onClick={onDownload} disabled={busy}>下载 Tailscale</button>
      </div>
    </section>
  );
}

function ManualPairingForm({
  connectionMethod,
  connectionText,
  hostUrl,
  pairCode,
  busy,
  onConnectionTextChange,
  onHostUrlChange,
  onPairCodeChange,
  onSubmit,
}: {
  connectionMethod: ConnectionMethod;
  connectionText: string;
  hostUrl: string;
  pairCode: string;
  busy: boolean;
  onConnectionTextChange: (value: string) => void;
  onHostUrlChange: (value: string) => void;
  onPairCodeChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const tailscale = connectionMethod === 'tailscale';
  return (
    <div className="terminal-manual-pairing-form">
      <label>
        <span>主机连接信息{tailscale ? '（推荐）' : ''}</span>
        <textarea value={connectionText} onChange={(event) => onConnectionTextChange(event.target.value)} placeholder="粘贴 Windows 主机复制的学生终端连接信息" />
      </label>
      <div className="terminal-form-grid">
        <label>
          <span>{tailscale ? 'Tailscale 主机地址' : '局域网主机地址'}</span>
          <input value={hostUrl} onChange={(event) => onHostUrlChange(event.target.value)} placeholder={tailscale ? '例如 http://100.88.1.2:18777' : '例如 http://192.168.1.8:18777'} />
        </label>
        <label>
          <span>六位配对码</span>
          <input value={pairCode} onChange={(event) => onPairCodeChange(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" />
        </label>
      </div>
      <button className="terminal-primary" onClick={onSubmit} disabled={busy}>
        {busy ? '正在连接…' : tailscale ? '通过 Tailscale 连接' : '通过局域网地址连接'}
      </button>
    </div>
  );
}

function TerminalApp() {
  const api = window.terminalBridge;
  const [config, setConfig] = useState<TerminalConfig | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [selectedTargetKey, setSelectedTargetKey] = useState('');
  const [connectionText, setConnectionText] = useState('');
  const [connectionMethod, setConnectionMethod] = useState<ConnectionMethod>('lan');
  const [hostUrl, setHostUrl] = useState('');
  const [pairCode, setPairCode] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Progress | null>(null);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueState>({ version: 2, total: 0, counts: {}, items: [] });
  const [uploadQueueBusy, setUploadQueueBusy] = useState(false);
  const [autoProgress, setAutoProgress] = useState<Progress | null>(null);
  const [autoFolder, setAutoFolder] = useState('');
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [captureSources, setCaptureSources] = useState<CaptureSource[]>([]);
  const [captureSourceId, setCaptureSourceId] = useState('');
  const [captureSession, setCaptureSession] = useState<CaptureSession | null>(null);
  const [capturePanelOpen, setCapturePanelOpen] = useState(false);
  const [captureMode, setCaptureMode] = useState<CaptureMode>('smart');
  const [captureDuration, setCaptureDuration] = useState(30);
  const [loginId, setLoginId] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [requiresLogin, setRequiresLogin] = useState(true);
  const [documentMode, setDocumentMode] = useState<'closed' | 'growth' | 'reports' | 'archive' | 'project-knowledge'>('closed');
  const [learningReports, setLearningReports] = useState<LearningReport[]>([]);
  const [archiveFiles, setArchiveFiles] = useState<ArchiveFile[]>([]);
  const [projectKnowledgeFiles, setProjectKnowledgeFiles] = useState<ArchiveFile[]>([]);
  const [selectedKnowledgeProjectId, setSelectedKnowledgeProjectId] = useState('');
  const [documentTitle, setDocumentTitle] = useState('');
  const [documentContent, setDocumentContent] = useState('');
  const [readerDialogOpen, setReaderDialogOpen] = useState(false);
  const [dismissedReminderDate, setDismissedReminderDate] = useState('');
  const [pairingState, setPairingState] = useState<PairingState | null>(null);
  const [hostMachineCodeQuery, setHostMachineCodeQuery] = useState('');
  const [pairingBusy, setPairingBusy] = useState(false);
  const [tailscaleStatus, setTailscaleStatus] = useState<TailscaleStatus | null>(null);
  const [tailscaleBusy, setTailscaleBusy] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseCatalogVersion, setCourseCatalogVersion] = useState('');
  const [courseDisclaimer, setCourseDisclaimer] = useState('');
  const [courseBrowser, setCourseBrowser] = useState<{ open: boolean; courseId?: string; name?: string }>({ open: false });
  const [activeWorkspace, setActiveWorkspace] = useState<StudentWorkspace>(null);
  const [activePrimaryModule, setActivePrimaryModule] = useState<StudentPrimaryView>('home');
  const [agentCapture, setAgentCapture] = useState<AgentCaptureState>({ enabled: false, active: false, registrations: {}, warnings: [], installedCount: 0, connectedCount: 0, pending: 0 });
  const [agentCaptureBusy, setAgentCaptureBusy] = useState(false);
  const [agentBridge, setAgentBridge] = useState<{ enabled: boolean; port: number; startedAt?: string; queryCount?: number; lastQueryAt?: string; lastError?: string; descriptorFile?: string; studentId?: string }>({ enabled: false, port: 0 });
  const [agentBridgeBusy, setAgentBridgeBusy] = useState(false);
  const [learningCapabilities, setLearningCapabilities] = useState<{ practice?: boolean; publications?: boolean; planningRead?: boolean; planningFavorites?: boolean; remoteInbox?: boolean; learningStatus?: boolean; learningTrajectory?: boolean; projectComprehensiveReport?: boolean; weeklyKnowledgeGrowthImage?: boolean; conversationImport?: boolean }>({});
  const [practiceDashboard, setPracticeDashboard] = useState<PracticeDashboard | null>(null);
  const [rejectedPracticeAttempts, setRejectedPracticeAttempts] = useState<Array<{ attemptId: string; cardId: string; answer: string; error: string }>>([]);
  const [practiceAnswer, setPracticeAnswer] = useState('');
  const [practiceDifficulty, setPracticeDifficulty] = useState('right');
  const [practiceConfidence, setPracticeConfidence] = useState(3);
  const [practiceAttemptId, setPracticeAttemptId] = useState('');
  const [planningKind, setPlanningKind] = useState<PlanningKind>('guidance');
  const [planningView, setPlanningView] = useState<PlanningView | null>(null);
  const [planningFavorites, setPlanningFavorites] = useState<PlanningFavorite[]>([]);
  const [inboxItems, setInboxItems] = useState<Array<{ itemId: string; originalName: string; receivedAt: string; status: string }>>([]);
  const [inboxTitle, setInboxTitle] = useState('');
  const [inboxText, setInboxText] = useState('');
  const [inboxEventId, setInboxEventId] = useState('');
  const [learningBusy, setLearningBusy] = useState(false);
  const [learningStatusForm, setLearningStatusForm] = useState<LearningStatusInput>({ overallState: 'normal', currentContent: '', completed: '', difficulties: '', nextPlan: '', helpNeeded: '', notes: '' });
  const [learningStatusEntries, setLearningStatusEntries] = useState<LearningStatusEntry[]>([]);
  const [collaborationProjectId, setCollaborationProjectId] = useState('');
  const [projectReport, setProjectReport] = useState<{ title: string; status: string; content: string; updatedAt?: string } | null>(null);
  const [growthWeeks, setGrowthWeeks] = useState<string[]>([]);
  const [growthImage, setGrowthImage] = useState<{ week: string; mimeType: string; imageBase64: string; status?: string } | null>(null);
  const [growthImageLoadError, setGrowthImageLoadError] = useState('');
  const [learningTrajectory, setLearningTrajectory] = useState<{ status: string; message?: string; taxonomyVersion?: string; states: LearningTrajectoryState[] } | null>(null);
  const [mediaCaptureMode, setMediaCaptureMode] = useState<'photo' | 'audio' | null>(null);
  const [mediaCaptureBlob, setMediaCaptureBlob] = useState<Blob | null>(null);
  const [mediaCaptureUrl, setMediaCaptureUrl] = useState('');
  const [mediaCaptureReady, setMediaCaptureReady] = useState(false);
  const [mediaCaptureError, setMediaCaptureError] = useState('');
  const [mediaRecording, setMediaRecording] = useState<'idle' | 'recording' | 'paused'>('idle');
  const [conversationText, setConversationText] = useState('');
  const [conversationLink, setConversationLink] = useState('');
  const workspaceRef = useRef<HTMLElement | null>(null);
  const mediaVideoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const mediaCaptureRequestRef = useRef(0);
  const conversationImportActiveRef = useRef(false);
  const courseBrowserAnchorRef = useRef<HTMLDivElement | null>(null);

  const selectedStudent = useMemo(
    () => students.find((student) => student.id === selectedStudentId) || null,
    [students, selectedStudentId],
  );
  useEffect(() => {
    let current = true;
    setLearningCapabilities({}); setPracticeDashboard(null); setRejectedPracticeAttempts([]); setPlanningView(null); setPlanningFavorites([]); setInboxItems([]); setInboxText(''); setInboxEventId(''); setPracticeAnswer(''); setPracticeAttemptId('');
    if (api && selectedStudentId) void api.getLearningCapabilities().then(result => {
      if (current) setLearningCapabilities(result.capabilities || {});
    }).catch(() => { if (current) setLearningCapabilities({}); });
    return () => { current = false; };
  }, [api, selectedStudentId]);

  useEffect(() => {
    let current = true;
    setGrowthWeeks([]);
    setGrowthImage(null);
    setGrowthImageLoadError('');
    if (!api || !selectedStudentId || !learningCapabilities.weeklyKnowledgeGrowthImage) return () => { current = false; };
    void (async () => {
      try {
        const payload = await api.listKnowledgeGrowthWeeks();
        if (!current) return;
        const weeks = payload.weeks || [];
        setGrowthWeeks(weeks);
        const week = payload.currentWeek || weeks[0];
        if (!week) {
          setGrowthImageLoadError('家庭主机没有返回可用的本周资料统计。');
          return;
        }
        const image = await api.getKnowledgeGrowthImage(week);
        if (!current) return;
        setGrowthImage(image);
      } catch (error) {
        if (!current) return;
        setGrowthImageLoadError(`本周资料统计暂不可用：${(error as Error).message}`);
      }
    })();
    return () => { current = false; };
  }, [api, selectedStudentId, learningCapabilities.weeklyKnowledgeGrowthImage]);

  useEffect(() => {
    if (!api?.getAgentBridge || !selectedStudentId) { setAgentBridge({ enabled: false, port: 0 }); return; }
    void api.getAgentBridge().then(setAgentBridge).catch(() => setAgentBridge({ enabled: false, port: 0 }));
  }, [api, selectedStudentId, config?.terminalMode]);

  useEffect(() => {
    if (!api?.checkUpdate) return;
    void api.checkUpdate().then(async update => {
      if (!update.available) return;
      const accepted = window.confirm(`发现学生端新版本 ${update.versionName}\n\n${update.notes || ''}\n\n是否现在下载更新？`);
      if (!accepted) return;
      setMessage('正在下载并校验更新…');
      const result = await api.downloadUpdate(update as unknown as Record<string, unknown>);
      setMessage(`更新文件已校验并打开：${result.path}`);
    }).catch(() => { /* 启动更新检查失败不阻止使用 */ });
  }, [api]);

  const openCollaboration = async () => {
    if (!api) return;
    setActiveWorkspace('collaboration'); setLearningBusy(true); setProjectReport(null);
    try {
      const [statusResult, growthResult] = await Promise.allSettled([api.getLearningStatus(), api.listKnowledgeGrowthWeeks()]);
      if (statusResult.status === 'fulfilled') setLearningStatusEntries(statusResult.value.entries || []);
      else setMessage(`学习状态暂不可用：${statusResult.reason instanceof Error ? statusResult.reason.message : String(statusResult.reason)}`);
      if (growthResult.status === 'fulfilled') {
        setGrowthWeeks(growthResult.value.weeks || []);
        setGrowthImageLoadError('');
      } else {
        setGrowthImageLoadError(`本周资料统计暂不可用：${growthResult.reason instanceof Error ? growthResult.reason.message : String(growthResult.reason)}`);
      }
      const linked = projects.filter(project => project.studentIds?.includes(selectedStudentId));
      setCollaborationProjectId(current => linked.some(project => project.id === current) ? current : linked[0]?.id || '');
    } finally { setLearningBusy(false); }
  };

  const saveLearningStatus = async () => {
    if (!api) return; setLearningBusy(true);
    try {
      const fingerprint = JSON.stringify({ selectedStudentId, ...learningStatusForm });
      const submissionId = durableSubmissionId('terminal-learning-status-submission', fingerprint, 'learning-status');
      await api.submitLearningStatus({ ...learningStatusForm, submissionId });
      clearDurableSubmission('terminal-learning-status-submission');
      const result = await api.getLearningStatus(); setLearningStatusEntries(result.entries || []);
      setMessage('学习状态已提交。');
    } catch (error) { setMessage(`学习状态提交失败：${(error as Error).message}`); }
    finally { setLearningBusy(false); }
  };

  const openProjectReport = async () => {
    if (!api || !collaborationProjectId) return; setLearningBusy(true);
    try {
      const report = await api.getProjectComprehensiveReport(collaborationProjectId);
      setProjectReport(report);
      setDocumentTitle(report.title || '项目综合报告');
      setDocumentContent(report.content || '主机尚未生成该项目综合报告。');
      setReaderDialogOpen(true);
    }
    catch (error) { setMessage(`项目综合报告读取失败：${(error as Error).message}`); }
    finally { setLearningBusy(false); }
  };

  const copyOpenDocument = async () => {
    if (!documentContent) return;
    try { await navigator.clipboard.writeText(documentContent); setMessage('正文已复制。'); }
    catch { setMessage('复制失败，请在正文中选择需要的内容。'); }
  };

  const openGrowthImage = async (week: string) => {
    if (!api) return; setLearningBusy(true);
    try { setGrowthImage(await api.getKnowledgeGrowthImage(week)); setGrowthImageLoadError(''); }
    catch (error) { setGrowthImageLoadError(`本周资料统计暂不可用：${(error as Error).message}`); }
    finally { setLearningBusy(false); }
  };

  const importConversationFile = async () => {
    if (!api) return;
    try { const result = await api.chooseConversationFile(); if (!result.cancelled) setConversationText(result.text || ''); }
    catch (error) { setMessage(`导入对话文件失败：${(error as Error).message}`); }
  };

  const previewConversationUrl = async () => {
    if (!api || !conversationLink.trim()) return; setLearningBusy(true);
    try { const result = await api.previewConversationLink(conversationLink.trim()); setConversationText(result.content); setMessage('链接正文已读取，请确认后提交。'); }
    catch (error) { setMessage(`链接解析失败：${(error as Error).message}`); }
    finally { setLearningBusy(false); }
  };

  const acceptNextConversationImport = async () => {
    if (!api?.takeConversationImport || !selectedStudentId) return;
    if (conversationImportActiveRef.current || conversationText.trim() || conversationLink.trim()) return;
    const draft = await api.takeConversationImport();
    if (!draft) return;
    conversationImportActiveRef.current = true;
    setActivePrimaryModule('collection');
    setActiveWorkspace('conversation');
    if (draft.link) setConversationLink(draft.link);
    if (draft.text) setConversationText(draft.text);
    setMessage(`已恢复${draft.name ? `“${draft.name}”` : '外部分享'}草稿，请预览并确认后提交。`);
  };

  useEffect(() => {
    if (!api?.takeConversationImport || !selectedStudentId) return;
    void acceptNextConversationImport();
    if (!api.onConversationImport) return;
    return api.onConversationImport(() => { void acceptNextConversationImport(); });
  }, [api, selectedStudentId, conversationText, conversationLink]);

  useEffect(() => {
    if (!conversationText.trim() && !conversationLink.trim()) conversationImportActiveRef.current = false;
  }, [conversationText, conversationLink]);

  const submitConversation = async () => {
    if (!api || !selectedTarget || !conversationText.trim()) return; setLearningBusy(true);
    try {
      const fingerprint = JSON.stringify({ text: conversationText.trim(), target: selectedTarget });
      const submissionId = durableSubmissionId('terminal-conversation-submission', fingerprint, 'windows-conversation');
      const result = await api.submitConversation({ text: conversationText.trim(), title: '导入对话', target: selectedTarget, submissionId });
      clearDurableSubmission('terminal-conversation-submission');
      conversationImportActiveRef.current = false;
      setConversationText(''); setConversationLink(''); setMessage(result.message || '对话已提交主机。');
    } catch (error) { setMessage(`对话提交结果未确认：${(error as Error).message}`); }
    finally { setLearningBusy(false); }
  };

  const releaseMediaCapture = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
    mediaRecorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaStreamRef.current = null;
    if (mediaCaptureUrl) URL.revokeObjectURL(mediaCaptureUrl);
    setMediaCaptureUrl('');
    setMediaCaptureBlob(null);
    setMediaRecording('idle');
    setMediaCaptureReady(false);
  };

  const closeMediaCapture = () => {
    mediaCaptureRequestRef.current += 1;
    releaseMediaCapture();
    setMediaCaptureError('');
    setMediaCaptureMode(null);
  };

  const openMediaCapture = async (mode: 'photo' | 'audio') => {
    const requestId = mediaCaptureRequestRef.current + 1;
    mediaCaptureRequestRef.current = requestId;
    releaseMediaCapture();
    setActivePrimaryModule('collection');
    setMediaCaptureMode(mode);
    setMediaCaptureError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前运行环境不支持摄像头或麦克风授权。');
      const stream = await navigator.mediaDevices.getUserMedia(mode === 'photo' ? { video: true, audio: false } : { video: false, audio: true });
      if (mediaCaptureRequestRef.current !== requestId) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      mediaStreamRef.current = stream;
      setMediaCaptureReady(true);
      window.requestAnimationFrame(() => {
        if (mediaCaptureRequestRef.current === requestId && mediaVideoRef.current) mediaVideoRef.current.srcObject = stream;
      });
    } catch (error) {
      if (mediaCaptureRequestRef.current !== requestId) return;
      const detail = `${mode === 'photo' ? '摄像头' : '麦克风'}不可用：${(error as Error).message}`;
      // Keep the dialog open: the student can read the reason, retry after
      // granting Windows permission, or cancel deliberately instead of seeing
      // a flash-close with no recovery path.
      setMediaCaptureReady(false);
      setMediaCaptureError(detail);
      setMessage(detail);
    }
  };

  const takePhoto = async () => {
    const video = mediaVideoRef.current;
    if (!video?.videoWidth || !video.videoHeight) { setMessage('摄像头画面尚未准备好。'); return; }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .9));
    if (!blob) { setMessage('拍照失败，请重试。'); return; }
    if (mediaCaptureUrl) URL.revokeObjectURL(mediaCaptureUrl);
    const url = URL.createObjectURL(blob);
    setMediaCaptureBlob(blob); setMediaCaptureUrl(url);
  };

  const startAudioRecording = () => {
    const stream = mediaStreamRef.current;
    if (!stream) { setMessage('麦克风尚未准备好。'); return; }
    const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find(type => MediaRecorder.isTypeSupported(type)) || '';
    const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
    mediaChunksRef.current = [];
    recorder.ondataavailable = event => { if (event.data.size) mediaChunksRef.current.push(event.data); };
    const requestId = mediaCaptureRequestRef.current;
    recorder.onstop = () => {
      if (mediaCaptureRequestRef.current !== requestId) return;
      const blob = new Blob(mediaChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      if (mediaCaptureUrl) URL.revokeObjectURL(mediaCaptureUrl);
      const url = URL.createObjectURL(blob);
      setMediaCaptureBlob(blob); setMediaCaptureUrl(url); setMediaRecording('idle');
    };
    recorder.start(1000); mediaRecorderRef.current = recorder; setMediaRecording('recording');
  };

  const toggleAudioPause = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    if (recorder.state === 'recording') { recorder.pause(); setMediaRecording('paused'); }
    else if (recorder.state === 'paused') { recorder.resume(); setMediaRecording('recording'); }
  };

  const stopAudioRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  };

  const submitCapturedMedia = async () => {
    if (!api || !selectedTarget || !mediaCaptureMode || !mediaCaptureBlob) return;
    setBusy(true);
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => { reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => reject(reader.error); reader.readAsDataURL(mediaCaptureBlob); });
      const result = await api.uploadCapturedMedia({ kind: mediaCaptureMode, mimeType: mediaCaptureBlob.type, base64: dataUrl, sourceEventId: `${mediaCaptureMode}-${crypto.randomUUID()}` }, selectedTarget);
      setMessage(result.pending ? '资料已安全保存，恢复连接后会继续发送。' : result.success ? '主机已接收采集资料。' : `采集资料发送失败${result.localRecoveryPath ? '，原件仍保留在本机' : ''}。`);
      closeMediaCapture();
      await refresh();
    } catch (error) { setMessage(`采集资料提交失败：${(error as Error).message}`); }
    finally { setBusy(false); }
  };

  const openLearningTrajectory = async () => {
    if (!api) return;
    setActivePrimaryModule('archive'); setActiveWorkspace('trajectory'); setLearningBusy(true);
    try {
      const result = await api.getLearningTrajectory();
      setLearningTrajectory({ ...result, states: result.states || [] });
    } catch (error) { setLearningTrajectory(null); setMessage(`知识点跟踪读取失败：${(error as Error).message}`); }
    finally { setLearningBusy(false); }
  };

  const exportGrowthImage = async (action: 'save' | 'copy' | 'share') => {
    if (!api || !growthImage) return;
    try {
      const result = await api.exportKnowledgeGrowthImage(growthImage, action);
      if (!result.cancelled) setMessage(result.message || '知识增长图已处理。');
    } catch (error) { setMessage(`知识增长图导出失败：${(error as Error).message}`); }
  };

  const exportMaterialStatsImage = async () => {
    if (!api) return;
    if (!growthImage) {
      setMessage(growthImageLoadError || '本周资料统计正在从家庭主机读取，请稍后重试。');
      return;
    }
    try {
      const result = await api.exportKnowledgeGrowthImage(growthImage, 'share');
      if (!result.cancelled) setMessage(result.message || '本周资料上传统计图已导出并定位，可选择应用分享。');
    } catch (error) { setMessage(`资料统计图导出失败：${(error as Error).message}`); }
  };

  const openCompanionPanel = async (mode: 'learning' | 'project-tutor') => {
    if (!api) return;
    try {
      const result = await api.showCompanionPanel(mode);
      if (!result.ok) setMessage(result.message || '导师工具暂不可用。');
    } catch (error) { setMessage(`打开${mode === 'learning' ? '学习导师' : '项目导师'}失败：${(error as Error).message}`); }
  };

  useEffect(() => {
    if (!api?.onCompanionNavigate) return;
    return api.onCompanionNavigate(({ action }) => {
      if (action === 'collection') selectPrimaryModule('collection');
      else if (action === 'upload') { setActivePrimaryModule('collection'); void uploadFiles(); }
      else if (action === 'photo') void openMediaCapture('photo');
      else if (action === 'audio') void openMediaCapture('audio');
      else if (action === 'screenshot') { setActivePrimaryModule('collection'); openCapturePanel(); }
      else if (action === 'queue' || action === 'agents') selectPrimaryModule('connection');
      else if (action === 'learning') selectPrimaryModule('learning');
    });
  }, [api, selectedTargetKey, mediaCaptureUrl]);

  useEffect(() => () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

  useEffect(() => {
    if (!courseBrowser.open || !api?.setCourseViewTop) return;
    const anchor = courseBrowserAnchorRef.current;
    if (!anchor) return;
    let frame = 0;
    const syncCourseViewport = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = Math.ceil(anchor.getBoundingClientRect().bottom + 8);
        void api.setCourseViewTop(top);
      });
    };
    syncCourseViewport();
    const observer = new ResizeObserver(syncCourseViewport);
    observer.observe(document.documentElement);
    observer.observe(anchor);
    window.addEventListener('resize', syncCourseViewport);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', syncCourseViewport);
    };
  }, [api, courseBrowser.open, courseBrowser.courseId, captureSession?.status, captureSources.length]);

  const openPractice = async () => {
    if (!api || !selectedStudentId) return;
    setActiveWorkspace('practice'); setLearningBusy(true);
    if (learningCapabilities.publications && (api as any).publicationAction) { setLearningBusy(false); return; }
    try {
      const result = await api.getPracticeDashboard();
      if (result.studentId === selectedStudentId) setPracticeDashboard(result.dashboard);
      setRejectedPracticeAttempts(result.synchronization?.rejected || []);
      if (result.synchronization?.rejected?.length) setMessage(`有 ${result.synchronization.rejected.length} 份暂存作答被主机拒绝，请在本机检查后重新作答；原内容仍保留。`);
      else if (result.synchronization?.pending) setMessage(`还有 ${result.synchronization.pending} 份作答等待主机确认。`);
      else if (result.synchronization?.warning) setMessage(`作答同步未核实：${result.synchronization.warning}`);
    }
    catch (error) { setMessage(`学习卡片暂不可用：${(error as Error).message}`); }
    finally { setLearningBusy(false); }
  };
  const startPractice = async (cardId: string) => {
    if (!api) return; setLearningBusy(true);
    try { await api.startPracticeCard(cardId); await openPractice(); }
    catch (error) { setMessage(`开始练习失败：${(error as Error).message}`); }
    finally { setLearningBusy(false); }
  };
  const submitPractice = async (cardId: string) => {
    if (!api || !practiceAnswer.trim()) return;
    setLearningBusy(true);
    const attemptId = practiceAttemptId || crypto.randomUUID(); setPracticeAttemptId(attemptId);
    try {
      const result = await api.submitPracticeCard(cardId, { attemptId, answer: practiceAnswer.trim(), difficulty: practiceDifficulty, confidence: practiceConfidence });
      if (result.studentId === selectedStudentId) {
        if (result.pending) { setMessage(result.message || '作答已保存在本机，连接恢复后核对。'); return; }
        setPracticeAttemptId(''); setPracticeAnswer(''); await openPractice();
        setMessage(result.duplicate ? '这次练习已提交，主机已核对回执。' : '练习已提交，结果等待审核。');
      }
    } catch (error) { setMessage(`提交结果未确认，请保留本页并重试：${(error as Error).message}`); }
    finally { setLearningBusy(false); }
  };
  const openPlanning = async (kind: PlanningKind = 'guidance') => {
    if (!api || !selectedStudentId) return;
    setActivePrimaryModule('archive'); setActiveWorkspace('planning'); setPlanningKind(kind); setPlanningView(null); setLearningBusy(true);
    try {
      const result = await api.getPlanningView(kind);
      if (result.studentId === selectedStudentId) setPlanningView(result);
      if (kind !== 'guidance' && learningCapabilities.planningFavorites) {
        const saved = await api.getPlanningFavorites(kind);
        if (saved.studentId === selectedStudentId) setPlanningFavorites(saved.favorites || []);
      } else setPlanningFavorites([]);
    }
    catch (error) { setMessage(`读取规划失败：${(error as Error).message}`); }
    finally { setLearningBusy(false); }
  };
  const togglePlanningFavorite = async (candidateId: string, saved: boolean) => {
    if (!api || !planningView?.current?.id || planningKind === 'guidance') return;
    setLearningBusy(true);
    try {
      const result = await api.setPlanningFavorite(planningKind, planningView.current.id, candidateId, saved);
      if (result.studentId === selectedStudentId) setPlanningFavorites(result.favorites || []);
    } catch (error) { setMessage(`收藏未更新：${(error as Error).message}`); }
    finally { setLearningBusy(false); }
  };
  const openLearningInbox = async () => {
    if (!api || !selectedStudentId) return;
    setActiveWorkspace('inbox'); setLearningBusy(true);
    try { const result = await api.getLearningInbox(); if (result.studentId === selectedStudentId) setInboxItems(result.items || []); }
    catch (error) { setMessage(`收件箱暂不可用：${(error as Error).message}`); }
    finally { setLearningBusy(false); }
  };
  const submitLearningInbox = async () => {
    if (!api || !inboxText.trim()) return;
    const eventId = inboxEventId || crypto.randomUUID(); setInboxEventId(eventId); setLearningBusy(true);
    try {
      const result = await api.submitLearningInbox({ eventId, title: inboxTitle.trim() || '学生分享', text: inboxText.trim() });
      if (result.studentId === selectedStudentId) { setInboxText(''); setInboxTitle(''); setInboxEventId(''); await openLearningInbox(); setMessage(result.duplicate ? '已核对先前的分享回执。' : '已送到当前学生的主机收件箱。'); }
    } catch (error) { setMessage(`分享结果未确认，请保留内容并重试：${(error as Error).message}`); }
    finally { setLearningBusy(false); }
  };
  const boundProjects = useMemo(
    () => projects.filter((project) => (project.studentIds || []).includes(selectedStudentId) && project.status !== 'sealed'),
    [projects, selectedStudentId],
  );
  const knowledgeProjects = useMemo(
    () => projects.filter((project) => (project.studentIds || []).includes(selectedStudentId)),
    [projects, selectedStudentId],
  );
  const selectedKnowledgeProject = useMemo(
    () => knowledgeProjects.find((project) => project.id === selectedKnowledgeProjectId) || knowledgeProjects[0] || null,
    [knowledgeProjects, selectedKnowledgeProjectId],
  );
  const targets = useMemo<UploadTarget[]>(() => {
    if (!selectedStudent) return [];
    return [
      { type: 'student', id: selectedStudent.id, name: `${selectedStudent.name}原始资料库`, studentId: selectedStudent.id },
      ...boundProjects.map((project) => ({ type: 'project' as const, id: project.id, name: `${project.name}项目原始资料库`, studentId: selectedStudent.id })),
    ];
  }, [selectedStudent, boundProjects]);
  const selectedTarget = useMemo(
    () => targets.find((target) => targetKey(target) === selectedTargetKey) || targets[0] || null,
    [targets, selectedTargetKey],
  );
  const todayKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }, []);
  const progress = selectedStudent?.progress || {};
  const submittedToday = progress.submittedTodayCount ?? selectedStudent?.submittedTodayCount ?? 0;
  const recentUploadCount7 = progress.recentUploadCount7 ?? selectedStudent?.recentUploadCount7 ?? 0;
  const recentTrend = progress.recentTrend ?? selectedStudent?.recentUploadTrend ?? 0;
  const activeDays30 = progress.activeDays30 ?? selectedStudent?.activeDays30 ?? 0;
  const knowledgeAssetCount = progress.knowledgeAssetCount ?? selectedStudent?.knowledgeAssetCount ?? selectedStudent?.processedDigestCount ?? 0;
  const newSinceLastDigestCount = progress.newSinceLastDigestCount ?? selectedStudent?.newSinceLastDigestCount ?? 0;
  const queuedUploadCount = (uploadQueue.counts.queued || 0) + (uploadQueue.counts.uploading || 0);
  const unknownUploadCount = uploadQueue.counts.receipt_unknown || 0;
  const dashboardWeek = growthWeeks[0] || currentIsoWeekKey();
  const materialStats = useMemo(() => [
    { label: '资料积累', value: recentUploadCount7, note: '近 7 日新增资料' },
    { label: '学习投入', value: activeDays30, note: '近 30 日有记录天数' },
    { label: '知识证据', value: knowledgeAssetCount, note: '已登记知识资产' },
    { label: '资料整理', value: selectedStudent?.processedDigestCount || 0, note: '已完成处理资料' },
    { label: '项目参与', value: knowledgeProjects.length, note: '当前关联项目' },
  ], [recentUploadCount7, activeDays30, knowledgeAssetCount, selectedStudent?.processedDigestCount, knowledgeProjects.length]);
  const todayPriority = useMemo(() => {
    if (newSinceLastDigestCount > 0) return { title: `核对并补充 ${newSinceLastDigestCount} 份待整理资料`, detail: '资料已进入当前学生空间，补充归属或来源后可继续整理。', action: 'collection' as const };
    if (practiceDashboard?.current) return { title: `完成“${practiceDashboard.current.content.title || '今日学习卡片'}”`, detail: '提交后由主机依据过程与证据进行反馈。', action: 'learning' as const };
    if (courses.length > 0) return { title: `继续学习“${courses[0].name}”`, detail: '打开课程不会自动认定完成；需要时可主动采集学习资料。', action: 'learning' as const };
    return { title: '补充一次今日学习状态', detail: '记录当前内容、困难和下一步，帮助主机形成后续建议。', action: 'learning' as const };
  }, [newSinceLastDigestCount, practiceDashboard?.current, courses]);
  const uploadGenerationChanged = Boolean(uploadQueue.hostScope?.hostId
    && uploadQueue.hostScope.hostId === uploadQueue.observedHostScope?.hostId
    && uploadQueue.hostScope.dataGeneration !== uploadQueue.observedHostScope?.dataGeneration);
  const reminderVisible = Boolean(selectedStudent && submittedToday === 0 && dismissedReminderDate !== todayKey);
  const visibleDiscoveredHosts = useMemo(
    () => (pairingState?.discoveredHosts || []).filter((host) => {
      const query = hostMachineCodeQuery.trim().toUpperCase();
      return !query || host.machineCode.toUpperCase().includes(query) || host.displayName.toUpperCase().includes(query);
    }),
    [pairingState?.discoveredHosts, hostMachineCodeQuery],
  );

  const applyRemoteState = (state: Awaited<ReturnType<TerminalBridge['loadState']>>) => {
    setConfig(state.config);
    setStudents(state.students || []);
    setProjects(state.projects || []);
    const firstStudentId = state.students[0]?.id || '';
    setSelectedStudentId(firstStudentId);
    setRequiresLogin(Boolean(state.requiresLogin || !firstStudentId));
    setMessage(state.message || (firstStudentId ? `已进入 ${state.students[0]?.name} 的学习空间。` : '请扫码或输入个人 ID。'));
  };

  const loadCourses = async () => {
    if (!api) return;
    try {
      const payload = await api.listCourses();
      setCourses(payload.courses || []);
      setCourseCatalogVersion(payload.manifestRevision || '');
      setCourseDisclaimer(payload.disclaimer || '');
    } catch (error) {
      setCourses([]);
      setCourseDisclaimer('');
      setMessage(`精选课程暂不可用：${(error as Error).message}`);
    }
  };

  useEffect(() => {
    if (!api || !selectedStudentId) return undefined;
    const timer = window.setInterval(() => { void loadCourses(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [api, selectedStudentId]);

  const refresh = async () => {
    if (!api) return;
    setBusy(true);
    try {
      const state = await api.loadState();
      applyRemoteState(state);
      if (!state.requiresLogin && state.students?.[0]?.id) void loadCourses();
    }
    catch (error) { setMessage(`读取主机失败：${(error as Error).message}`); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (!api) return;
    void api.getConfig().then((next) => {
      setConfig(next);
      setHostUrl(next.hostUrl || '');
      setDeviceName(next.deviceName || '');
      setAutoFolder(next.autoDelivery?.folder || '');
      setAutoEnabled(Boolean(next.autoDelivery?.enabled));
      if (next.connected) void refresh();
    });
    void api.getPairingState().then(setPairingState);
    void api.getTailscaleStatus().then(setTailscaleStatus).catch(() => {});
    void api.getAgentCapture().then(setAgentCapture).catch(() => {});
    void api.getUploadQueue().then(setUploadQueue).catch(() => {});
    api.onUploadProgress(setUploadProgress);
    api.onAutoDelivery(setAutoProgress);
    api.onCaptureChanged(setCaptureSession);
    api.onCourseBrowserChanged((payload) => {
      setCourseBrowser({ open: payload.open, courseId: payload.courseId, name: payload.name });
      if (payload.blocked) setMessage(payload.message || '已阻止课程页面跳转到非白名单域名。');
    });
    const removeAgentCaptureListener = api.onAgentCaptureChanged(setAgentCapture);
    const removeUploadQueueListener = api.onUploadQueueChanged(setUploadQueue);
    const removePairingListener = api.onPairingChanged((payload) => {
      setPairingState(payload.state);
      setConfig(payload.config);
      if (payload.state.lastResult?.message) setMessage(payload.state.lastResult.message);
      if (payload.config.connected) void refresh();
    });
    return () => {
      removeAgentCaptureListener();
      removeUploadQueueListener();
      removePairingListener();
    };
  }, [api]);

  useEffect(() => {
    setCourses([]);
    setCourseBrowser({ open: false });
    setActiveWorkspace(null);
    setSelectedKnowledgeProjectId('');
    setProjectKnowledgeFiles([]);
    setDocumentTitle('');
    setDocumentContent('');
    setDocumentMode('closed');
  }, [selectedStudentId]);

  useEffect(() => {
    if (!targets.length) {
      setSelectedTargetKey('');
      return;
    }
    const configured = config?.autoDelivery?.target;
    const preferred = targetKey(configured?.studentId === selectedStudentId ? configured : null);
    setSelectedTargetKey((current) => targets.some((target) => targetKey(target) === current) ? current : (targets.some((target) => targetKey(target) === preferred) ? preferred : targetKey(targets[0])));
  }, [targets, selectedStudentId, config?.autoDelivery?.target]);

  useEffect(() => {
    setDocumentMode('closed');
    setLearningReports([]);
    setArchiveFiles([]);
    setDocumentTitle('');
    setDocumentContent('');
  }, [selectedStudentId]);

  useEffect(() => {
    if (!selectedStudentId) {
      setDismissedReminderDate('');
      return;
    }
    try { setDismissedReminderDate(localStorage.getItem(`edu-student-reminder-${selectedStudentId}`) || ''); }
    catch { setDismissedReminderDate(''); }
  }, [selectedStudentId]);

  const dismissReminderToday = () => {
    if (!selectedStudentId) return;
    setDismissedReminderDate(todayKey);
    try { localStorage.setItem(`edu-student-reminder-${selectedStudentId}`, todayKey); } catch {}
  };

  const refreshTailscaleStatus = async () => {
    if (!api) return;
    setTailscaleBusy(true);
    try {
      const status = await api.getTailscaleStatus();
      setTailscaleStatus(status);
      setMessage(status.installed ? '已检测到本机 Tailscale。' : '本机尚未安装 Tailscale，可使用下载按钮获取。');
    } catch (error) {
      setMessage(`Tailscale 检测失败：${(error as Error).message}`);
    } finally {
      setTailscaleBusy(false);
    }
  };

  const openTailscale = async () => {
    if (!api) return;
    setTailscaleBusy(true);
    try {
      const result = await api.openTailscale();
      setTailscaleStatus(result.status);
      setMessage(result.message || (result.ok ? '已打开 Tailscale。' : '未能打开 Tailscale。'));
    } catch (error) {
      setMessage(`打开 Tailscale 失败：${(error as Error).message}`);
    } finally {
      setTailscaleBusy(false);
    }
  };

  const downloadTailscale = async () => {
    if (!api) return;
    setTailscaleBusy(true);
    try {
      const result = await api.downloadTailscale();
      setMessage(result.message || '已打开 Tailscale Windows 官方下载页。');
    } catch (error) {
      setMessage(`打开 Tailscale 下载页失败：${(error as Error).message}`);
    } finally {
      setTailscaleBusy(false);
    }
  };

  const selectConnectionMethod = (method: ConnectionMethod) => {
    if (method === connectionMethod) return;
    setConnectionMethod(method);
    setHostUrl('');
    setMessage(method === 'tailscale'
      ? '已切换为 Tailscale 远程连接，请使用主机提供的 Tailscale 地址。'
      : '已切换为局域网连接，可直接扫描附近主机。');
  };

  const pair = async () => {
    if (!api) return;
    setBusy(true);
    setMessage(connectionMethod === 'tailscale' ? '正在通过 Tailscale 连接主机…' : '正在通过局域网连接主机…');
    try {
      const result = await api.pair({ connectionText, hostUrl, pairCode, deviceName, connectionMethod });
      setConfig(result.config);
      setMessage(result.message || '设备已连接，请选择使用模式后扫码或输入学生 ID。');
      await refresh();
    } catch (error) {
      setMessage(`连接失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const copyMachineCode = async () => {
    if (!api || !config?.machineCode) return;
    try {
      const result = await api.copyMachineCode();
      setMessage(result.ok ? `已复制本机固定终端码 ${result.value}` : '复制失败，请手工记录本机固定终端码。');
    } catch (error) {
      setMessage(`复制失败：${(error as Error).message}`);
    }
  };

  const scanLanHosts = async () => {
    if (!api) return;
    setPairingBusy(true);
    try {
      const result = await api.findLanHosts(hostMachineCodeQuery);
      setPairingState(result.state);
      setMessage(result.message || '正在查找局域网主机。');
    } catch (error) {
      setMessage(`查找失败：${(error as Error).message}`);
    } finally {
      setPairingBusy(false);
    }
  };

  const requestNearbyHost = async (hostDeviceId: string) => {
    if (!api) return;
    setPairingBusy(true);
    try {
      const result = await api.requestHostPair(hostDeviceId);
      setPairingState(result.state);
      setMessage(result.message || '连接申请已发送，请等待主机接受。');
    } catch (error) {
      setMessage(`申请连接失败：${(error as Error).message}`);
    } finally {
      setPairingBusy(false);
    }
  };

  const cancelNearbyPair = async () => {
    if (!api) return;
    setPairingBusy(true);
    try {
      const result = await api.cancelPairRequest();
      setPairingState(result.state);
      setMessage(result.message || '连接申请已取消。');
    } finally {
      setPairingBusy(false);
    }
  };

  const decidePairInvite = async (decision: 'accept' | 'reject') => {
    if (!api) return;
    setPairingBusy(true);
    try {
      const result = decision === 'accept' ? await api.acceptPairInvite() : await api.rejectPairInvite();
      setPairingState(result.state);
      if (result.config) setConfig(result.config);
      setMessage(result.message || (decision === 'accept' ? '已接受主机连接邀请。' : '已拒绝主机连接邀请。'));
      if (result.config?.connected) await refresh();
    } catch (error) {
      setMessage(`${decision === 'accept' ? '接受' : '拒绝'}邀请失败：${(error as Error).message}`);
    } finally {
      setPairingBusy(false);
    }
  };

  const changeMode = async (terminalMode: 'personal' | 'shared') => {
    if (!api || terminalMode === config?.terminalMode) return;
    setBusy(true);
    try {
      const result = await api.setMode(terminalMode);
      setConfig(result.config);
      setStudents([]);
      setProjects([]);
      setSelectedStudentId('');
      setCaptureSession(null);
      setRequiresLogin(true);
      setAutoEnabled(false);
      setMessage(result.message || (terminalMode === 'shared' ? '已切换为共享终端。' : '已切换为个人终端，请输入学生 ID 完成绑定。'));
      await refresh();
    } catch (error) {
      setMessage(`切换模式失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const enterStudent = async () => {
    if (!api || !loginId.trim()) return;
    setBusy(true);
    try {
      const result = await api.loginStudent(loginId.trim());
      setLoginId('');
      setMessage(result.message || '已进入学生学习空间。');
      await refresh();
    } catch (error) {
      setMessage(`进入失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const leaveStudent = async () => {
    if (!api) return;
    setBusy(true);
    try {
      const result = await api.logoutStudent();
      setConfig(result.config);
      setStudents([]);
      setProjects([]);
      setSelectedStudentId('');
      setSelectedTargetKey('');
      setCaptureSession(null);
      setRequiresLogin(true);
      setMessage(config?.terminalMode === 'personal' ? '已退出当前页面，个人终端刷新后会重新进入绑定学生。' : '已退出当前学生，请下一位学生扫码或输入 ID。');
    } finally {
      setBusy(false);
    }
  };

  const toggleAgentCapture = async () => {
    if (!api || config?.terminalMode !== 'personal') return;
    setAgentCaptureBusy(true);
    try {
      const result = await api.setAgentCapture(!agentCapture.enabled);
      setAgentCapture(result);
      setMessage(result.message || (result.enabled ? '自动会话记忆已授权。' : '自动会话记忆已暂停。'));
    } catch (error) {
      setMessage(`自动会话记忆设置失败：${(error as Error).message}`);
    } finally {
      setAgentCaptureBusy(false);
    }
  };

  const toggleAgentBridge = async () => {
    if (!api || config?.terminalMode !== 'personal') return;
    setAgentBridgeBusy(true);
    try {
      const result = await api.setAgentBridge(!agentBridge.enabled);
      setAgentBridge(result);
      setMessage(result.enabled ? '当前学生的外部 Agent 只读查询已启用。' : '外部 Agent 查询授权已关闭。');
    } catch (error) { setMessage(`外部 Agent 查询设置失败：${(error as Error).message}`); }
    finally { setAgentBridgeBusy(false); }
  };

  const copyAgentBridgeConfig = async () => {
    if (!api) return;
    try { const result = await api.copyAgentBridgeConfig(); setMessage(result.message || 'MCP 配置已复制。'); }
    catch (error) { setMessage(`复制 Agent 连接配置失败：${(error as Error).message}`); }
  };

  const uploadFiles = async () => {
    if (!api || !selectedTarget) return;
    setBusy(true);
    setUploadProgress({ status: 'selecting' });
    try {
      const result = await api.chooseAndUploadFiles(selectedTarget);
      const uploadMessage = result.pending
        ? `已将 ${result.pending} 个文件稳定保存在本机，主机接收结果待核对；已接收 ${result.success || 0} 个，失败 ${result.failed || 0} 个。`
        : `主机已接收 ${result.success || 0} 个文件，失败 ${result.failed || 0} 个，目标为${selectedTarget.name}。`;
      if (result.success) await refresh();
      if (!result.cancelled) setMessage(uploadMessage);
    } catch (error) {
      setMessage(`上传失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const retryPendingUploads = async () => {
    if (!api) return;
    setUploadQueueBusy(true);
    try {
      const result = await api.retryUploadQueue();
      setUploadQueue(result.queue);
      const unknown = result.queue.counts.receipt_unknown || 0;
      const queued = (result.queue.counts.queued || 0) + (result.queue.counts.uploading || 0);
      setMessage(unknown || queued
        ? `上传记录已核对：${queued} 个等待发送，${unknown} 个接收结果待核对。稳定副本仍保留在本机。`
        : '当前学生的待上传记录已完成核对。');
    } catch (error) {
      setMessage(`核对上传记录失败：${(error as Error).message}`);
    } finally {
      setUploadQueueBusy(false);
    }
  };

  const acknowledgeUploadGeneration = async () => {
    if (!api) return;
    setUploadQueueBusy(true);
    try {
      const result = await api.acknowledgeUploadGeneration();
      setUploadQueue(result.queue);
      setMessage(result.message || '已确认当前主机资料代次。');
    } catch (error) {
      setMessage(`确认主机资料代次失败：${(error as Error).message}`);
    } finally {
      setUploadQueueBusy(false);
    }
  };

  const chooseAutoFolder = async () => {
    if (!api) return;
    const result = await api.chooseAutoFolder();
    if (result.ok) setAutoFolder(result.folder);
  };

  const saveAutoDelivery = async () => {
    if (!api || !selectedTarget || !autoFolder) return;
    setBusy(true);
    try {
      await api.configureAutoDelivery({ enabled: autoEnabled, folder: autoFolder, target: selectedTarget });
      setConfig((current) => current ? { ...current, autoDelivery: { enabled: autoEnabled, folder: autoFolder, target: selectedTarget } } : current);
      setMessage(autoEnabled ? `自动投递已启用，新资料将送达${selectedTarget.name}。` : '自动投递已暂停，本地文件不会删除。');
    } catch (error) {
      setMessage(`自动投递设置失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const loadCaptureSources = async () => {
    if (!api) return;
    const sources = await api.listCaptureSources();
    setCaptureSources(sources);
    setCaptureSourceId((current) => current || sources[0]?.id || '');
  };

  const openCapturePanel = () => {
    if (captureSession?.status === 'capturing' || captureSession?.status === 'paused') {
      setMessage('屏幕采集正在进行中；请使用屏幕右下角的浮动控制条暂停、重点截取或结束。');
      return;
    }
    setActiveWorkspace(null);
    setCapturePanelOpen(true);
    if (!captureSources.length) void loadCaptureSources();
  };

  const showLearningReports = async () => {
    if (!api) return;
    setBusy(true);
    try {
      const payload = await api.listLearningReports();
      setLearningReports(payload.reports || []);
      setArchiveFiles([]);
      setProjectKnowledgeFiles([]);
      setDocumentTitle('');
      setDocumentContent('');
      setDocumentMode('reports');
    } catch (error) {
      setMessage(`读取学情报告失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const showGrowthSummary = async () => {
    if (!api) return;
    setBusy(true);
    try {
      const payload = await api.getGrowthSummary();
      setLearningReports([]);
      setArchiveFiles([]);
      setProjectKnowledgeFiles([]);
      setDocumentTitle('我的成长模型');
      setDocumentContent(formatGrowthSummary(payload));
      setDocumentMode('growth');
      setReaderDialogOpen(false);
    } catch (error) {
      setMessage(`读取成长模型失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const showArchiveFiles = async () => {
    if (!api) return;
    setBusy(true);
    try {
      const payload = await api.listArchiveFiles();
      setArchiveFiles(payload.files || []);
      setLearningReports([]);
      setProjectKnowledgeFiles([]);
      setDocumentTitle('');
      setDocumentContent('');
      setDocumentMode('archive');
    } catch (error) {
      setMessage(`读取教育档案失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const showProjectKnowledge = async (requestedProjectId = '') => {
    if (!api) return;
    const projectId = requestedProjectId || selectedKnowledgeProjectId || knowledgeProjects[0]?.id || '';
    setDocumentMode('project-knowledge');
    setLearningReports([]);
    setArchiveFiles([]);
    setProjectKnowledgeFiles([]);
    setDocumentTitle('');
    setDocumentContent('');
    if (!projectId) return;
    setBusy(true);
    try {
      const payload = await api.listProjectKnowledgeFiles(projectId);
      setSelectedKnowledgeProjectId(projectId);
      setProjectKnowledgeFiles(payload.files || []);
    } catch (error) {
      setMessage(`读取项目知识库失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const readLearningReport = async (report: LearningReport) => {
    if (!api) return;
    setBusy(true);
    try {
      const payload = await api.readLearningReport(report.id);
      setDocumentTitle(payload.title || report.title);
      setDocumentContent(payload.content || '当前报告暂无正文。');
      setReaderDialogOpen(false);
    } catch (error) {
      setMessage(`读取学情报告失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const readArchiveFile = async (file: ArchiveFile) => {
    if (!api) return;
    setBusy(true);
    try {
      const payload = await api.readArchiveFile(file.path);
      setDocumentTitle(file.name || file.path.split('/').pop() || '教育档案');
      setDocumentContent(payload.content || '当前档案暂无正文。');
      setReaderDialogOpen(false);
    } catch (error) {
      setMessage(`读取教育档案失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const readProjectKnowledgeFile = async (file: ArchiveFile) => {
    if (!api || !selectedKnowledgeProjectId) return;
    setBusy(true);
    try {
      const payload = await api.readProjectKnowledgeFile(selectedKnowledgeProjectId, file.path);
      const project = knowledgeProjects.find((item) => item.id === selectedKnowledgeProjectId);
      setDocumentTitle(`${project?.name || payload.projectName || '关联项目'} · ${file.name || file.path.split('/').pop() || '项目知识'}`);
      setDocumentContent(payload.content || '当前项目知识暂无正文。');
      setReaderDialogOpen(false);
    } catch (error) {
      setMessage(`读取项目知识失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const openCourse = async (course: Course) => {
    if (!api) return;
    setBusy(true);
    try {
      const result = await api.openCourse(course.courseId);
      if (!result.ok) throw new Error(result.message || '课程暂不可用。');
      setCourseBrowser({ open: true, courseId: course.courseId, name: course.name });
      setMessage(`已在隔离浏览器中打开 ${course.name}。课程内容由 ${course.provider} 提供。`);
    } catch (error) {
      setMessage(`打开课程失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const closeCourse = async () => {
    if (!api) return;
    await api.closeCourse();
    setCourseBrowser({ open: false });
  };

  const toggleCapture = async () => {
    if (!api || !selectedTarget) return;
    setBusy(true);
    try {
      if (captureSession?.status === 'capturing') {
        const stopped = await api.stopCapture();
        setCaptureSession(stopped);
        setMessage(`采集已结束，共保留 ${stopped?.count || 0} 张截图。系统正在后台送达并整理，无需再次确认。`);
      } else {
        if (!captureSourceId) {
          await loadCaptureSources();
          setMessage('请选择要采集的屏幕或窗口。');
          return;
        }
        const source = captureSources.find((item) => item.id === captureSourceId);
        const session = await api.startCapture({
          sourceId: captureSourceId,
          sourceType: source?.type || 'screen',
          sourceName: source?.name || '屏幕',
          studentId: selectedStudentId,
          projectId: selectedTarget.type === 'project' ? selectedTarget.id : '',
          target: selectedTarget,
          mode: captureMode,
          durationMinutes: captureDuration,
        });
        setCaptureSession(session);
        setCapturePanelOpen(false);
        setMessage(`正在采集“${session.sourceName}” · ${session.options?.policyName || CAPTURE_MODE_COPY[captureMode].label} · 最长 ${session.options?.durationMinutes || captureDuration} 分钟。右下角浮动控制条可暂停、重点截取或结束。`);
      }
    } catch (error) {
      setMessage(`屏幕采集失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const uploadCapture = async () => {
    if (!api || !selectedTarget || !captureSession?.files?.length) return;
    setBusy(true);
    try {
      const result = await api.uploadCapture({
        files: captureSession.files,
        captureItems: captureSession.items,
        target: selectedTarget,
        captureSessionId: captureSession.id,
        sourceName: captureSession.sourceName,
        sourceType: captureSession.sourceType,
        startedAt: captureSession.startedAt,
        endedAt: captureSession.endedAt,
        courseId: captureSession.courseId,
        courseUrl: captureSession.courseUrl,
        courseStartedAt: captureSession.courseStartedAt,
        courseCompletedAt: captureSession.courseCompletedAt,
      });
      const uploadMessage = result.pending
        ? `已有 ${result.pending} 张采集资料保存在本机待上传区，主机接收结果待核对；已接收 ${result.success || 0} 张。`
        : `主机已接收 ${result.success || 0} 张采集资料，失败 ${result.failed || 0} 张，目标为${selectedTarget.name}。`;
      if (result.success) await refresh();
      setMessage(uploadMessage);
    } catch (error) {
      setMessage(`采集资料上传失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const takeQuickScreenshot = async () => {
    if (!api || !selectedTarget || !captureSourceId) return;
    setBusy(true);
    try {
      const result = await api.quickScreenshot(captureSourceId, selectedTarget);
      setMessage(result.pending ? '截屏已安全保存，恢复连接后会继续发送。' : result.success ? '主机已接收快速截屏。' : '快速截屏发送失败，请重试。');
      if (result.success) await refresh();
    } catch (error) { setMessage(`快速截屏失败：${(error as Error).message}`); }
    finally { setBusy(false); }
  };

  const revealWorkspace = (workspace: Exclude<StudentWorkspace, null>) => {
    setActiveWorkspace(workspace);
    window.requestAnimationFrame(() => {
      workspaceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const selectPrimaryModule = (module: StudentPrimaryView) => {
    setActivePrimaryModule(module);
    setActiveWorkspace(null);
    setCapturePanelOpen(false);
    setSettingsOpen(module === 'connection');
    if (module === 'connection') window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  };

  const openDocumentWorkspace = (mode: Exclude<typeof documentMode, 'closed'>) => {
    setActivePrimaryModule('archive');
    revealWorkspace('documents');
    if (mode === 'growth') void showGrowthSummary();
    if (mode === 'reports') void showLearningReports();
    if (mode === 'archive') void showArchiveFiles();
    if (mode === 'project-knowledge') void showProjectKnowledge();
  };

  const openProjectReportWorkspace = () => {
    const linkedProjects = projects.filter(project => project.studentIds?.includes(selectedStudentId));
    setCollaborationProjectId(current => linkedProjects.some(project => project.id === current) ? current : linkedProjects[0]?.id || '');
    setActivePrimaryModule('project');
    revealWorkspace('project-report');
  };

  const openProjectKnowledgeWorkspace = (projectId?: string) => {
    setActivePrimaryModule('project');
    revealWorkspace('documents');
    void showProjectKnowledge(projectId);
  };

  if (!config?.connected) {
    return (
      <main className="terminal-shell connection-shell">
        <section className="terminal-hero compact-hero">
          <div className="terminal-brand">AI教育管家</div>
          <h1>Windows 学生终端</h1>
          <p>连接家长或教师的 Windows 主机，上传学习资料并集中形成知识与学情档案。</p>
        </section>
        <section className="terminal-card connection-card">
          <h2>连接主机</h2>
          {!api ? <div className="terminal-warning">当前是界面预览。配对和上传功能仅在 Windows 学生终端程序内可用。</div> : null}
          <div className="connection-method-grid" aria-label="选择连接方式">
            <button className={connectionMethod === 'lan' ? 'connection-method-card active' : 'connection-method-card'} onClick={() => selectConnectionMethod('lan')} aria-pressed={connectionMethod === 'lan'}>
              <strong>局域网连接</strong>
              <span>主机和学生终端位于同一个 Wi-Fi 或有线网络时使用，可自动扫描。</span>
            </button>
            <button className={connectionMethod === 'tailscale' ? 'connection-method-card active' : 'connection-method-card'} onClick={() => selectConnectionMethod('tailscale')} aria-pressed={connectionMethod === 'tailscale'}>
              <strong>Tailscale 远程连接</strong>
              <span>两台设备不在同一地点时使用，需要双方安装并登录 Tailscale。</span>
            </button>
          </div>
          {connectionMethod === 'lan' ? <>
            <div className="terminal-machine-code">
              <div><span>本机固定终端码</span><strong>{config?.machineCode || '程序启动后生成'}</strong><small>用于主机在局域网中识别本终端，不是密码。</small></div>
              <button className="terminal-secondary" onClick={copyMachineCode} disabled={!api || !config?.machineCode}>复制终端码</button>
            </div>
            <section className="terminal-nearby-pairing">
              <div><h3>查找附近主机</h3><p>输入固定主机码可缩小结果；不输入则显示同一局域网中的全部主机。</p></div>
              <div className="terminal-pair-search">
                <input value={hostMachineCodeQuery} onChange={(event) => setHostMachineCodeQuery(event.target.value.toUpperCase())} placeholder="例如 H-7K3M-P9Q2" />
                <button className="terminal-primary" onClick={scanLanHosts} disabled={!api || pairingBusy}>{pairingBusy ? '正在查找…' : '扫描局域网主机'}</button>
              </div>
              {pairingState?.pendingInvite ? <article className="terminal-pair-item invite">
                <div><strong>{pairingState.pendingInvite.hostName} 邀请连接</strong><span>{pairingState.pendingInvite.hostMachineCode} · 请确认是需要连接的教师或家长主机</span></div>
                <div className="terminal-pair-actions">
                  <button className="terminal-primary" onClick={() => decidePairInvite('accept')} disabled={pairingBusy}>接受</button>
                  <button className="terminal-danger" onClick={() => decidePairInvite('reject')} disabled={pairingBusy}>拒绝</button>
                </div>
              </article> : null}
              {pairingState?.pendingRequest ? <article className="terminal-pair-item pending">
                <div><strong>等待主机接受：{pairingState.pendingRequest.hostName}</strong><span>{pairingState.pendingRequest.hostMachineCode} · 两分钟内有效</span></div>
                <button className="terminal-secondary" onClick={cancelNearbyPair} disabled={pairingBusy}>取消申请</button>
              </article> : null}
              <div className="terminal-pair-list">
                {visibleDiscoveredHosts.map((host) => <article className="terminal-pair-item" key={host.deviceId || host.hostUrl}>
                  <div><strong>{host.displayName}</strong><span>{host.machineCode || '旧版主机'} · {host.address || host.hostUrl}{host.appVersion ? ` · v${host.appVersion}` : ''}</span></div>
                  <button className="terminal-secondary" onClick={() => requestNearbyHost(host.deviceId)} disabled={pairingBusy || host.protocolVersion < 2 || !host.machineCode}>申请连接</button>
                </article>)}
                {visibleDiscoveredHosts.length === 0 ? <small>点击扫描后，附近主机会显示在这里。若网络隔离设备，可展开下方的局域网手工连接。</small> : null}
              </div>
              {pairingState?.discoveryError ? <div className="terminal-warning">{pairingState.discoveryError}</div> : null}
            </section>
            <details className="terminal-legacy-pairing">
              <summary>局域网手工连接：粘贴信息、主机地址和六位配对码</summary>
              <ManualPairingForm connectionMethod="lan" connectionText={connectionText} hostUrl={hostUrl} pairCode={pairCode} busy={busy} onConnectionTextChange={setConnectionText} onHostUrlChange={setHostUrl} onPairCodeChange={setPairCode} onSubmit={pair} />
            </details>
          </> : <>
            <TailscaleSupportCard status={tailscaleStatus} busy={tailscaleBusy} onRefresh={refreshTailscaleStatus} onOpen={openTailscale} onDownload={downloadTailscale} />
            <section className="terminal-remote-pairing">
              <div><h3>连接远程主机</h3><p>请先确认主机和学生终端都已登录同一个 Tailscale 网络，再粘贴主机连接信息。系统只会选用其中的 Tailscale 地址。</p></div>
              <ManualPairingForm connectionMethod="tailscale" connectionText={connectionText} hostUrl={hostUrl} pairCode={pairCode} busy={busy} onConnectionTextChange={setConnectionText} onHostUrlChange={setHostUrl} onPairCodeChange={setPairCode} onSubmit={pair} />
            </section>
          </>}
          <div className="terminal-form-grid terminal-name-row">
            <label><span>本机名称</span><input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} /></label>
          </div>
          {message ? <div className="terminal-message">{message}</div> : null}
        </section>
      </main>
    );
  }

  if (requiresLogin || !selectedStudent) {
    return (
      <main className="terminal-shell">
        <header className="terminal-topbar">
          <div><div className="terminal-brand">AI教育管家</div><h1>Windows 学生终端</h1></div>
          <div className="terminal-host-state"><span className="online-dot" />已连接 {config.hostUrl}<button onClick={() => setSettingsOpen((value) => !value)}>系统设置</button></div>
        </header>
        {settingsOpen ? (
          <section className="terminal-card target-card">
            <div className="card-heading"><div><h2>使用模式</h2><p>个人终端固定一名学生；共享终端由每位学生扫码或输入 ID。</p></div></div>
            <div className="mode-grid">
              <button className={config.terminalMode === 'personal' ? 'mode-card active' : 'mode-card'} onClick={() => changeMode('personal')} disabled={busy}><strong>个人终端</strong><span>首次输入 ID 后固定绑定，支持自动投递文件夹。</span></button>
              <button className={config.terminalMode === 'shared' ? 'mode-card active' : 'mode-card'} onClick={() => changeMode('shared')} disabled={busy}><strong>共享终端</strong><span>每次输入 ID，退出后交给下一名学生使用。</span></button>
            </div>
            <TailscaleSupportCard status={tailscaleStatus} busy={tailscaleBusy} onRefresh={refreshTailscaleStatus} onOpen={openTailscale} onDownload={downloadTailscale} />
          </section>
        ) : null}
        <section className="terminal-card connection-card student-login-card">
          <span className="eyebrow">{config.terminalMode === 'personal' ? '个人终端' : '共享终端'}</span>
          <h2>{config.terminalMode === 'personal' ? '绑定并进入我的学习空间' : '进入我的学习空间'}</h2>
          <p>输入创建学生档案时生成的个人 ID。使用扫码枪时，扫描二维码后会自动输入。</p>
          <label><span>学生个人 ID</span><input autoFocus value={loginId} onChange={(event) => setLoginId(event.target.value.toUpperCase())} onKeyDown={(event) => { if (event.key === 'Enter') void enterStudent(); }} placeholder="例如 S-7K3M-2" /></label>
          <button className="terminal-primary" onClick={enterStudent} disabled={busy || !loginId.trim()}>{busy ? '正在进入…' : '进入'}</button>
          <div className="terminal-message">{message || '这里不显示学生名单，避免选错资料归属。'}</div>
        </section>
        <footer>学生终端 v{config.version} · 资料由 Windows 主机集中处理</footer>
      </main>
    );
  }

  if (courseBrowser.open) {
    const openedCourse = courses.find((course) => course.courseId === courseBrowser.courseId);
    const captureState = captureSession?.status === 'capturing'
      ? `采集中 · ${captureSession.count} 张`
      : captureSession?.status === 'completed' && captureSession.courseId === openedCourse?.courseId
        ? `已完成 · ${captureSession.count} 张待确认`
        : '待开始 · 不会自动录屏';
    return (
      <main className="terminal-shell terminal-course-shell">
        <header className="terminal-topbar">
          <div><div className="terminal-brand">精选课程</div><h1>{openedCourse?.name || courseBrowser.name}</h1></div>
          <div className="terminal-host-state"><span className="online-dot" />{openedCourse?.provider || '第三方提供方'}<button onClick={closeCourse}>返回课程列表</button></div>
        </header>
        <section className="terminal-course-toolbar" aria-label="课程浏览与主动采集控制">
          <strong>{captureState}</strong>
          <select value={selectedTarget ? targetKey(selectedTarget) : ''} onChange={(event) => setSelectedTargetKey(event.target.value)} disabled={captureSession?.status === 'capturing'}>
            {targets.map((target) => <option value={targetKey(target)} key={targetKey(target)}>{target.name}</option>)}
          </select>
          <button className="terminal-secondary" onClick={loadCaptureSources} disabled={busy || captureSession?.status === 'capturing'} title="选择采集屏幕" aria-label="选择采集屏幕">选择屏幕</button>
          <select value={captureSourceId} onChange={(event) => setCaptureSourceId(event.target.value)} disabled={captureSession?.status === 'capturing'}>
            <option value="">选择屏幕或窗口</option>
            {captureSources.map((source) => <option value={source.id} key={source.id} disabled={source.blocked || source.available === false}>{source.name}</option>)}
          </select>
          <select value={captureMode} onChange={(event) => setCaptureMode(event.target.value as CaptureMode)} disabled={captureSession?.status === 'capturing'} aria-label="采集策略">
            {Object.entries(CAPTURE_MODE_COPY).map(([mode, copy]) => <option value={mode} key={mode}>{copy.label}</option>)}
          </select>
          <select value={captureDuration} onChange={(event) => setCaptureDuration(Number(event.target.value))} disabled={captureSession?.status === 'capturing'} aria-label="采集时长">
            {[15, 30, 45, 60, 90, 120].map((minutes) => <option value={minutes} key={minutes}>最长 {minutes} 分钟</option>)}
          </select>
          <button className={captureSession?.status === 'capturing' ? 'terminal-danger' : 'terminal-primary'} onClick={toggleCapture} disabled={busy || !selectedTarget} title={captureSession?.status === 'capturing' ? '结束采集' : '开始采集'}>
            {captureSession?.status === 'capturing' ? '结束采集' : '开始采集'}
          </button>
          <button className="terminal-secondary" onClick={uploadCapture} disabled={busy || captureSession?.status !== 'completed' || captureSession.courseId !== openedCourse?.courseId || !captureSession.files?.length} title="提前重试送达" aria-label="提前重试送达">重试送达</button>
        </section>
        <div ref={courseBrowserAnchorRef} className="terminal-course-browser-placeholder">课程网页在下方隔离视图中加载。上方采集控制始终保持可见；非白名单跳转、下载、弹窗和权限申请会被阻止。</div>
        {message ? <div className="terminal-toast" role="status">{message}</div> : null}
      </main>
    );
  }

  return (
    <main className="terminal-shell terminal-home-shell">
      <header className="terminal-topbar student-home-topbar">
        <button className="student-brand-lockup" type="button" onClick={() => selectPrimaryModule('home')} aria-label="返回学生端首页">
          <span className="student-brand-mark" aria-hidden="true">AI</span>
          <span><strong>AI教育管家</strong><small>Windows 学生端</small></span>
        </button>
        <div className="student-home-controls">
          <div className="student-identity-chip"><span aria-hidden="true"><UserRound size={19} /></span><small>正在学习</small><strong>{selectedStudent.name}</strong></div>
          <div className="student-host-chip" title={config.hostUrl}><Wifi size={16} /><span>家庭主机 · 已连接</span></div>
          <button className="student-topbar-button" onClick={refresh} disabled={busy} aria-label="刷新学生端数据"><RefreshCw size={17} />刷新</button>
          <button className="student-topbar-button" onClick={() => void api?.showCompanion()} aria-label="显示学习工具条"><MonitorUp size={17} />工具条</button>
          <button className="student-topbar-button" onClick={() => selectPrimaryModule('connection')} aria-current={activePrimaryModule === 'connection' ? 'page' : undefined}><Settings size={17} />主机连接</button>
          <button className="student-topbar-button quiet" onClick={leaveStudent} disabled={busy || captureSession?.status === 'capturing'}><LogOut size={17} />退出</button>
        </div>
      </header>

      <div className="student-app-frame">
        <nav className="student-primary-nav" aria-label="学生端五个模块">
          <button className={activePrimaryModule === 'collection' ? 'active' : ''} onClick={() => selectPrimaryModule('collection')}><Upload size={21} /><span>资料搜集</span><small>上传、采集与导入</small></button>
          <button className={activePrimaryModule === 'connection' ? 'active' : ''} onClick={() => selectPrimaryModule('connection')}><Wifi size={21} /><span>主机连接</span><small>连接与学生空间</small></button>
          <button className={activePrimaryModule === 'archive' ? 'active' : ''} onClick={() => selectPrimaryModule('archive')}><Archive size={21} /><span>教育档案</span><small>报告、知识点与规划</small></button>
          <button className={activePrimaryModule === 'learning' ? 'active' : ''} onClick={() => selectPrimaryModule('learning')}><BookOpen size={21} /><span>学习行动</span><small>课程、练习与状态</small></button>
          <button className={activePrimaryModule === 'project' ? 'active' : ''} onClick={() => selectPrimaryModule('project')}><LibraryBig size={21} /><span>项目管理</span><small>资料、报告与项目导师</small></button>
        </nav>
        <div className="student-app-stage">

      {activePrimaryModule === 'connection' ? (
        <section className="terminal-card target-card student-settings-panel">
          <div className="card-heading"><div><h2>主机连接与学生空间</h2><p>当前已连接到 {config.hostUrl}。在这里管理终端模式、学生空间和远程连接支持；模式切换后会结束当前学生会话。</p></div></div>
          <div className="mode-grid">
            <button className={config.terminalMode === 'personal' ? 'mode-card active' : 'mode-card'} onClick={() => changeMode('personal')} disabled={busy}><strong>个人终端</strong><span>固定绑定当前学生，可使用自动投递。</span></button>
            <button className={config.terminalMode === 'shared' ? 'mode-card active' : 'mode-card'} onClick={() => changeMode('shared')} disabled={busy}><strong>共享终端</strong><span>退出后由下一位学生输入个人 ID。</span></button>
          </div>
          <section className={`student-agent-capture-card${agentBridge.enabled ? ' enabled' : ''}`} aria-labelledby="agent-bridge-title">
            <span className="student-agent-capture-icon" aria-hidden="true"><Bot size={24} /></span>
            <div>
              <h3 id="agent-bridge-title">外部 Agent 查询</h3>
              <p>{config.terminalMode === 'personal' ? '让本机 Codex、WorkBuddy 或其他 MCP Agent 只读查询当前绑定学生的教育档案和关联项目资料。不会提供其他学生名单、主机路径或管理权限。' : '共享终端不开放长期 Agent 查询，避免切换学生后跨空间读取。'}</p>
              <small>{agentBridge.enabled ? `本地桥接已启用 · 查询 ${agentBridge.queryCount || 0} 次${agentBridge.lastQueryAt ? ` · 最近 ${agentBridge.lastQueryAt.slice(0, 16).replace('T', ' ')}` : ''}` : '授权仅在本学生端运行期间有效'}</small>
              {agentBridge.lastError ? <small className="student-agent-capture-warning">{agentBridge.lastError}</small> : null}
            </div>
            <div className="document-actions">
              {agentBridge.enabled ? <button className="terminal-secondary" type="button" onClick={() => void copyAgentBridgeConfig()}>复制 MCP 配置</button> : null}
              <button className={agentBridge.enabled ? 'terminal-danger' : 'terminal-primary'} type="button" onClick={() => void toggleAgentBridge()} disabled={agentBridgeBusy || config.terminalMode !== 'personal'}>{agentBridgeBusy ? '正在设置…' : agentBridge.enabled ? '撤销查询' : '启用只读查询'}</button>
            </div>
          </section>
          <section className={`student-agent-capture-card${unknownUploadCount ? ' enabled' : ''}`} aria-labelledby="upload-queue-title">
            <span className="student-agent-capture-icon" aria-hidden="true"><Upload size={24} /></span>
            <div>
              <h3 id="upload-queue-title">资料上传记录</h3>
              <p>文件会先复制到本机稳定待上传区，并固定主机、学生、项目和资料代次。关闭重开后先查主机回执，再决定是否重传。</p>
              <small>{queuedUploadCount || unknownUploadCount
                ? `${queuedUploadCount} 个等待发送 · ${unknownUploadCount} 个接收结果待核对`
                : `已记录 ${uploadQueue.counts.received || 0} 个主机接收回执`}</small>
              {uploadGenerationChanged ? <small className="student-agent-capture-warning">主机资料代次已变化，旧记录已停止自动重放；请先核对，再确认新代次用于后续上传。</small> : null}
              {uploadQueue.items.find((item) => item.state === 'receipt_unknown')?.lastError
                ? <small className="student-agent-capture-warning">{uploadQueue.items.find((item) => item.state === 'receipt_unknown')?.lastError}</small>
                : null}
            </div>
            <div>
              <button className="terminal-secondary" type="button" onClick={retryPendingUploads} disabled={busy || uploadQueueBusy || (!queuedUploadCount && !unknownUploadCount)}>{uploadQueueBusy ? '正在核对…' : '核对并继续'}</button>
              {uploadGenerationChanged ? <button className="terminal-primary" type="button" onClick={acknowledgeUploadGeneration} disabled={busy || uploadQueueBusy}>确认当前代次</button> : null}
            </div>
          </section>
          <TailscaleSupportCard status={tailscaleStatus} busy={tailscaleBusy} onRefresh={refreshTailscaleStatus} onOpen={openTailscale} onDownload={downloadTailscale} />
        </section>
      ) : null}

      {activePrimaryModule !== 'connection' ? <section className="student-home-dashboard" aria-labelledby="student-home-title">
        <div className="student-dashboard-heading">
          <div><span className="student-dashboard-eyebrow">{selectedStudent.grade ? `${selectedStudent.grade} · ` : ''}我的学习工作台</span><h1 id="student-home-title">{activePrimaryModule === 'home' ? '我的学情工作台' : activePrimaryModule === 'collection' ? '资料搜集' : activePrimaryModule === 'archive' ? '教育档案' : activePrimaryModule === 'project' ? '项目管理' : '学习行动'}</h1><p>{activePrimaryModule === 'home' ? '从一件最值得推进的事开始，再查看本周行动、项目和资料变化。' : activePrimaryModule === 'collection' ? '主动提交的资料只会进入当前学生本人或已关联项目。' : activePrimaryModule === 'archive' ? '查看报告、知识点证据与规划建议。' : activePrimaryModule === 'project' ? '查看本人关联项目的资料、综合报告，并使用项目导师推进下一步。' : '从课程、学习卡片、导师到学习状态，推进今天的学习。'}</p></div>
          {activePrimaryModule === 'collection' ? <label className="student-target-picker">
            <span className="student-target-icon" aria-hidden="true"><Target size={20} /></span>
            <span className="student-target-copy"><small>当前资料目标</small><select value={selectedTarget ? targetKey(selectedTarget) : ''} onChange={(event) => setSelectedTargetKey(event.target.value)} aria-label="当前资料目标">{targets.map((target) => <option value={targetKey(target)} key={targetKey(target)}>{target.name}</option>)}</select></span>
          </label> : null}
        </div>

        {activePrimaryModule === 'collection' && reminderVisible ? <section className="student-reminder-strip" role="status">
          <div><strong>记得提交本日学习资料</strong><span>作业、笔记、试卷或截图都可以。</span></div>
          <button className="terminal-primary" onClick={uploadFiles} disabled={busy || !selectedTarget}>现在上传</button>
          <button className="student-reminder-dismiss" onClick={dismissReminderToday}>稍后再说</button>
        </section> : null}

        <section className="student-progress-strip" aria-label="学习资料进展">
          <div><span>全部资料</span><strong>{selectedStudent.rawFileCount || 0}</strong></div>
          <div><span>已完成知识化</span><strong>{knowledgeAssetCount}</strong><small>已消化资料数</small></div>
          <div><span>近 7 天</span><strong>{recentUploadCount7}</strong><small>{recentTrend === 0 ? '趋势平稳' : recentTrend > 0 ? `增加 ${recentTrend}` : `减少 ${Math.abs(recentTrend)}`}</small></div>
          <div><span>近 30 天学习</span><strong>{activeDays30} 天</strong><small>{newSinceLastDigestCount} 份待整理</small></div>
        </section>

        {activePrimaryModule === 'home' ? <section className="student-workbench" aria-label="学情工作台">
          <article className="student-today-focus">
            <div><span>今天最值得推进的一件事</span><h2>{todayPriority.title}</h2><p>{todayPriority.detail}</p></div>
            <button className="terminal-primary" onClick={() => selectPrimaryModule(todayPriority.action)}>现在推进<ArrowRight size={17} /></button>
          </article>
          <div className="student-workbench-grid">
            <article className="student-workbench-card student-weekly-actions"><div className="student-workbench-card-heading"><span>本周行动</span><small>只显示当前学生范围内的资料与任务</small></div><ol>
              <li><strong>整理资料</strong><span>{newSinceLastDigestCount ? `${newSinceLastDigestCount} 份待整理，先核对来源和归属` : '本周暂无待整理资料'}</span><button onClick={() => selectPrimaryModule('collection')}>去查看</button></li>
              <li><strong>保持学习节奏</strong><span>近 30 天已有 {activeDays30} 天学习记录，本周新增 {recentUploadCount7} 份资料</span><button onClick={() => selectPrimaryModule('learning')}>去学习</button></li>
              <li><strong>回顾学习证据</strong><span>当前已登记 {knowledgeAssetCount} 项知识资产，结论仍以主机证据审核为准</span><button onClick={() => selectPrimaryModule('archive')}>看档案</button></li>
            </ol></article>
            <article className="student-workbench-card student-project-focus"><div className="student-workbench-card-heading"><span>重点项目</span><small>{knowledgeProjects.length ? `${knowledgeProjects.length} 个本人关联项目` : '尚未关联项目'}</small></div>{knowledgeProjects.length ? <div className="student-project-list">{knowledgeProjects.slice(0, 3).map((project) => <button key={project.id} onClick={() => openProjectKnowledgeWorkspace(project.id)}><strong>{project.name}</strong><span>{project.status === 'sealed' ? '已封存，只读查看' : '查看项目资料与下一步'}</span><ArrowRight size={16} /></button>)}</div> : <p>当主机将你关联到项目后，这里会显示项目资料、综合报告和项目导师入口。</p>}<button className="terminal-secondary student-project-manage-button" onClick={() => selectPrimaryModule('project')}>进入项目管理</button></article>
          </div>
          <div className="student-workbench-grid student-workbench-bottom-grid">
            <article className="student-workbench-card student-five-dimensions"><div className="student-workbench-card-heading"><span>五维学情</span><small>统计与活动记录，不等同于掌握结论</small></div><div>{materialStats.map((item) => <div className="student-dimension-row" key={item.label}><span>{item.label}</span><strong>{item.value}</strong><small>{item.note}</small></div>)}</div></article>
            <article className="student-workbench-card student-material-chart"><div className="student-workbench-card-heading"><span>我的资料统计图</span><small>{growthImage?.week || dashboardWeek} · 单学生本周资料上传</small></div>{growthImage ? <button className="student-material-chart-button student-weekly-growth-chart-button" onClick={() => void exportMaterialStatsImage()} title="导出并定位本周资料上传统计图，可选择应用分享"><img src={`data:${growthImage.mimeType};base64,${growthImage.imageBase64}`} alt={`${growthImage.week} 单学生本周资料上传统计图`} /><span>点击导出并分享本周资料上传统计图</span></button> : <div className="student-weekly-growth-pending"><strong>{growthImageLoadError ? '本周资料统计暂不可用' : '正在读取本周资料上传统计…'}</strong><small>{growthImageLoadError ? '请确认 Windows 主机已更新到包含资料图表运行时的候选版本后重试。' : '统计仅包含当前学生成功写入资产索引的去重资料。'}</small>{growthImageLoadError ? <button className="terminal-secondary" type="button" onClick={() => void openGrowthImage(dashboardWeek)} disabled={learningBusy}>重新读取</button> : null}</div>}</article>
          </div>
          <section className="student-action-grid student-home-module-grid" aria-label="学生端主要模块">
            <StudentActionTile icon={Upload} title="资料搜集" description="文件、图片、拍照、录音与对话" meta={queuedUploadCount ? `${queuedUploadCount} 份待发送` : '立即收集'} tone="tone-upload" onClick={() => selectPrimaryModule('collection')} />
            <StudentActionTile icon={Archive} title="教育档案" description="报告、知识点与规划" meta={`${selectedStudent.archiveFileCount || 0} 份档案`} tone="tone-archive" onClick={() => selectPrimaryModule('archive')} />
            <StudentActionTile icon={BookOpen} title="学习行动" description="课程、学习卡片与学习导师" meta={`${courses.length} 门课程`} tone="tone-growth" onClick={() => selectPrimaryModule('learning')} />
            <StudentActionTile icon={LibraryBig} title="项目管理" description="项目资料、报告与项目导师" meta={`${knowledgeProjects.length} 个关联项目`} tone="tone-knowledge" onClick={() => selectPrimaryModule('project')} />
          </section>
        </section> : null}

        {activePrimaryModule === 'collection' ? <section className="student-action-grid" aria-label="资料搜集功能">
          <StudentActionTile icon={Upload} title="上传资料" description="选择作业、试卷、笔记或项目文件" meta={uploadProgress?.status === 'uploading' ? `上传中 ${uploadProgress.current || 0}/${uploadProgress.total || 0}` : unknownUploadCount ? `${unknownUploadCount} 个结果待核对` : queuedUploadCount ? `${queuedUploadCount} 个已存本机待上传` : `今日已提交 ${submittedToday} 份`} tone="tone-upload" disabled={busy || !selectedTarget} onClick={uploadFiles} />
          <StudentActionTile icon={Camera} title="拍照" description="调用摄像头拍摄并确认上传" meta="预览后发送" tone="tone-capture" disabled={busy || !selectedTarget} onClick={() => void openMediaCapture('photo')} />
          <StudentActionTile icon={Mic} title="录音" description="录制学习讲解或谈话资料" meta="原件保留" tone="tone-report" disabled={busy || !selectedTarget} onClick={() => void openMediaCapture('audio')} />
          <StudentActionTile icon={MonitorUp} title="屏幕采集" description="主动截取学习屏幕或应用窗口" meta={captureSession?.status === 'capturing' ? `采集中 · ${captureSession.count} 张` : captureSession?.status === 'paused' ? `已暂停 · ${captureSession.count} 张` : captureSession?.status === 'completed' ? `${captureSession.count} 张待上传` : '需要时主动开启'} tone="tone-capture" active={capturePanelOpen || captureSession?.status === 'capturing' || captureSession?.status === 'paused'} onClick={openCapturePanel} />
          <StudentActionTile icon={FolderSync} title="自动投递" description={config.terminalMode === 'personal' ? '监测指定文件夹中的新资料' : '共享终端不持续监测文件夹'} meta={config.terminalMode === 'personal' ? (autoEnabled ? '已开启' : '未开启') : '个人终端可用'} tone="tone-auto" active={activeWorkspace === 'auto-delivery'} onClick={() => revealWorkspace('auto-delivery')} />
          {learningCapabilities.conversationImport ? <StudentActionTile icon={Bot} title="对话采集" description="AI 对话分享导入与会话自动采集" meta={agentCapture.enabled ? '自动采集已开启' : '预览确认后写入'} tone="tone-upload" active={activeWorkspace === 'conversation'} disabled={busy} onClick={() => revealWorkspace('conversation')} /> : null}
          {learningCapabilities.remoteInbox ? <StudentActionTile icon={FileText} title="分享收件箱" description="把主动分享的文字送入主机待整理" meta="只限当前学生" tone="tone-knowledge" active={activeWorkspace === 'inbox'} disabled={busy} onClick={() => void openLearningInbox()} /> : null}
        </section> : null}

        {activePrimaryModule === 'archive' ? <section className="student-action-grid" aria-label="教育档案功能">
          <StudentActionTile icon={TrendingUp} title="成长模型" description="查看能力与项目成长证据" meta="只读查看" tone="tone-growth" active={activeWorkspace === 'documents' && documentMode === 'growth'} disabled={busy} onClick={() => openDocumentWorkspace('growth')} />
          <StudentActionTile icon={FileText} title="学情报告" description="查看掌握情况和学习建议" meta="只读查看" tone="tone-report" active={activeWorkspace === 'documents' && documentMode === 'reports'} disabled={busy} onClick={() => openDocumentWorkspace('reports')} />
          <StudentActionTile icon={Archive} title="学情档案" description="查找本人已公开的档案内容" meta={`${selectedStudent.archiveFileCount || 0} 份档案`} tone="tone-archive" active={activeWorkspace === 'documents' && documentMode === 'archive'} disabled={busy} onClick={() => openDocumentWorkspace('archive')} />
          {learningCapabilities.learningTrajectory ? <StudentActionTile icon={TrendingUp} title="知识点跟踪" description="按学科查看证据和复习优先级" meta="主机只读数据" tone="tone-growth" active={activeWorkspace === 'trajectory'} disabled={busy} onClick={() => void openLearningTrajectory()} /> : null}
          {learningCapabilities.planningRead ? <StudentActionTile icon={TrendingUp} title="规划指导" description="查看规划、选题和比赛" meta="建议与来源只读" tone="tone-knowledge" active={activeWorkspace === 'planning'} disabled={busy} onClick={() => void openPlanning()} /> : null}
        </section> : null}

        {activePrimaryModule === 'project' ? <section className="student-action-grid" aria-label="项目管理功能">
          <StudentActionTile icon={LibraryBig} title="项目资料" description="阅读本人关联项目的资料与知识" meta={`${knowledgeProjects.length} 个关联项目`} tone="tone-knowledge" active={activeWorkspace === 'documents' && documentMode === 'project-knowledge'} disabled={busy} onClick={openProjectKnowledgeWorkspace} />
          {learningCapabilities.projectComprehensiveReport ? <StudentActionTile icon={FileText} title="项目综合报告" description="查看阶段、证据、成果与下一步建议" meta="主机生成 · 只读" tone="tone-report" active={activeWorkspace === 'project-report'} disabled={busy} onClick={openProjectReportWorkspace} /> : null}
          <StudentActionTile icon={Bot} title="项目导师" description="使用工具条中的项目引导与资料梳理模式" meta={knowledgeProjects.length ? '仅限本人关联项目' : '需要先关联项目'} tone="tone-growth" disabled={!knowledgeProjects.length} onClick={() => void openCompanionPanel('project-tutor')} />
        </section> : null}

        {activePrimaryModule === 'learning' ? <section className="student-action-grid" aria-label="学习行动功能">
          <StudentActionTile icon={BookOpen} title="精选课程" description="继续已分配的课程" meta={`${courses.length} 门可用课程`} tone="tone-course" active={activeWorkspace === 'courses'} onClick={() => revealWorkspace('courses')} />
          {learningCapabilities.practice ? <StudentActionTile icon={Target} title="学习卡片" description="完成主机为我准备的练习" meta="作答后明确提交" tone="tone-report" active={activeWorkspace === 'practice'} disabled={busy} onClick={() => void openPractice()} /> : null}
          {learningCapabilities.learningStatus ? <StudentActionTile icon={TrendingUp} title="学习状态与每周成长" description="填写状态并查看、分享每周知识增长图" meta="一个入口" tone="tone-growth" active={activeWorkspace === 'collaboration'} disabled={busy} onClick={() => void openCollaboration()} /> : null}
          <StudentActionTile icon={Bot} title="学习导师" description="使用工具条中的学习模式，生成受控学习提示词" meta="不直接代写或认定掌握" tone="tone-knowledge" onClick={() => void openCompanionPanel('learning')} />
        </section> : null}
      </section> : null}

      {mediaCaptureMode ? <aside className="student-media-capture" role="dialog" aria-modal="true" aria-labelledby="student-media-capture-title">
        <header><div><span>资料搜集</span><h2 id="student-media-capture-title">{mediaCaptureMode === 'photo' ? '拍照上传' : '录音采集'}</h2></div><button className="student-workspace-close" onClick={closeMediaCapture} aria-label="关闭采集"><X size={19} /></button></header>
        <p>当前学生：{selectedStudent.name} · 资料目标：{selectedTarget?.name || '尚未选择'}。确认后直接进入可靠上传队列。</p>
        {mediaCaptureError ? <div className="student-media-capture-error" role="alert"><strong>授权或设备尚未就绪</strong><p>{mediaCaptureError}</p><button className="terminal-secondary" type="button" onClick={() => void openMediaCapture(mediaCaptureMode)}>重新尝试</button></div> : null}
        {mediaCaptureMode === 'photo' ? <>
          {!mediaCaptureBlob ? <video ref={mediaVideoRef} autoPlay playsInline muted /> : <img src={mediaCaptureUrl} alt="拍照预览" />}
          <div className="document-actions"><button className="terminal-secondary" onClick={() => { setMediaCaptureBlob(null); if (mediaCaptureUrl) URL.revokeObjectURL(mediaCaptureUrl); setMediaCaptureUrl(''); }}>重拍</button><button className="terminal-primary" onClick={() => void takePhoto()} disabled={!mediaCaptureReady || Boolean(mediaCaptureBlob)}>拍照</button></div>
        </> : <>
          {mediaCaptureUrl ? <audio controls src={mediaCaptureUrl} /> : <div className="student-audio-status">{mediaRecording === 'recording' ? '正在录音' : mediaRecording === 'paused' ? '录音已暂停' : mediaCaptureReady ? '麦克风已准备' : '正在等待麦克风授权'}</div>}
          <div className="document-actions"><button className="terminal-primary" onClick={startAudioRecording} disabled={!mediaCaptureReady || mediaRecording !== 'idle' || Boolean(mediaCaptureBlob)}>开始录音</button><button className="terminal-secondary" onClick={toggleAudioPause} disabled={mediaRecording === 'idle'}>{mediaRecording === 'paused' ? '继续' : '暂停'}</button><button className="terminal-secondary" onClick={stopAudioRecording} disabled={mediaRecording === 'idle'}>结束并预览</button></div>
        </>}
        <footer><button className="terminal-secondary" onClick={closeMediaCapture}>取消</button><button className="terminal-primary" onClick={() => void submitCapturedMedia()} disabled={busy || !mediaCaptureBlob || !selectedTarget}>{busy ? '正在提交…' : '确认并上传'}</button></footer>
      </aside> : null}

      {capturePanelOpen ? <aside className="student-capture-flyout" role="dialog" aria-modal="false" aria-labelledby="student-capture-flyout-title">
        <header>
          <div><span className="student-capture-flyout-eyebrow">主动采集</span><h2 id="student-capture-flyout-title">屏幕资料采集</h2></div>
          <button className="student-workspace-close" type="button" onClick={() => setCapturePanelOpen(false)} aria-label="关闭屏幕采集浮动面板"><X size={19} /></button>
        </header>
        <p>只采集你主动选择的学习屏幕或应用窗口。开始后，右下角会显示始终置顶的控制条；不会录屏、读取私聊或采集敏感窗口。</p>
        <div className="student-capture-flyout-fields">
          <label>
            <span>采集屏幕或窗口</span>
            <select value={captureSourceId} onFocus={() => { if (!captureSources.length) void loadCaptureSources(); }} onChange={(event) => setCaptureSourceId(event.target.value)} disabled={busy} aria-label="采集屏幕或窗口">
              <option value="">{captureSources.length ? '请选择屏幕或窗口' : '正在读取可采集屏幕…'}</option>
              {captureSources.map((source) => <option value={source.id} key={source.id} disabled={source.blocked || source.available === false}>{source.name}{source.blocked ? '（已排除）' : ''}</option>)}
            </select>
          </label>
          <label>
            <span>采集策略</span>
            <select value={captureMode} onChange={(event) => setCaptureMode(event.target.value as CaptureMode)} disabled={busy} aria-label="采集策略">
              {Object.entries(CAPTURE_MODE_COPY).map(([mode, copy]) => <option value={mode} key={mode}>{copy.label}</option>)}
            </select>
          </label>
          <label>
            <span>最长采集时长</span>
            <select value={captureDuration} onChange={(event) => setCaptureDuration(Number(event.target.value))} disabled={busy} aria-label="最长采集时长">
              {[15, 30, 45, 60, 90, 120].map((minutes) => <option value={minutes} key={minutes}>{minutes} 分钟</option>)}
            </select>
          </label>
        </div>
        <small className="student-capture-policy-hint">{CAPTURE_MODE_COPY[captureMode].description}</small>
        <footer>
          <button className="terminal-secondary" type="button" onClick={loadCaptureSources} disabled={busy}>刷新屏幕</button>
          <button className="terminal-secondary" type="button" onClick={() => void takeQuickScreenshot()} disabled={busy || !selectedTarget || !captureSourceId}>立即截屏并上传</button>
          <button className="terminal-primary" type="button" onClick={toggleCapture} disabled={busy || !selectedTarget || !captureSourceId}>{busy ? '正在启动…' : `开始采集（最长 ${captureDuration} 分钟）`}</button>
        </footer>
      </aside> : null}

      {activeWorkspace ? <section className="student-workspace-panel" ref={workspaceRef} aria-label="当前功能工作区">
        <header className="student-workspace-heading">
          <div><span>当前功能</span><h2>{activeWorkspace === 'courses' ? '我的课程' : activeWorkspace === 'auto-delivery' ? '自动投递' : activeWorkspace === 'capture' ? '屏幕资料采集' : activeWorkspace === 'practice' ? '学习卡片' : activeWorkspace === 'trajectory' ? '知识点跟踪' : activeWorkspace === 'planning' ? '规划与发现' : activeWorkspace === 'inbox' ? '分享收件箱' : activeWorkspace === 'conversation' ? '对话采集' : activeWorkspace === 'collaboration' ? '学习状态与成长' : activeWorkspace === 'project-report' ? '项目综合报告' : '成长与档案'}</h2></div>
          <button className="student-workspace-close" type="button" onClick={() => setActiveWorkspace(null)} aria-label="关闭当前功能工作区"><X size={20} /></button>
        </header>

        {activeWorkspace === 'courses' ? <>
          <p className="student-workspace-description">{courseDisclaimer || '课程由第三方提供；教育管家负责安全访问入口与用户主动资料采集。'} {courseCatalogVersion ? `当前目录：${courseCatalogVersion}` : ''}</p>
          <div className="terminal-course-grid student-course-grid">
            {courses.map((course) => (
              <article className="terminal-course-card" key={course.courseId}>
                <img src={`${config.hostUrl}${course.coverUrl}`} alt="" />
                <div><span>{course.provider}</span><h3>{course.name}</h3><p>{course.summary}</p><small>{course.accountRequirement}</small></div>
                <button className="terminal-primary" onClick={() => openCourse(course)} disabled={busy}>打开课程</button>
                <details><summary>提供方与法律声明</summary><p>{course.legalNotice}</p></details>
              </article>
            ))}
            {courses.length === 0 ? <div className="terminal-empty-state">当前学生没有已分配且有效的精选课程。</div> : null}
          </div>
        </> : null}

        {activeWorkspace === 'auto-delivery' ? (config.terminalMode === 'personal' ? <div className="student-tool-form">
          <p>监测指定文件夹，新文件联网后自动送到当前资料目标；不会删除本地文件。</p>
          <div className="folder-row"><input readOnly value={autoFolder} placeholder="尚未选择文件夹" /><button onClick={chooseAutoFolder}>选择文件夹</button></div>
          <label className="switch-row"><input type="checkbox" checked={autoEnabled} onChange={(event) => setAutoEnabled(event.target.checked)} /><span>启用自动投递到 {selectedTarget?.name || '所选目标'}</span></label>
          <button className="terminal-primary" onClick={saveAutoDelivery} disabled={busy || !selectedTarget || !autoFolder}>保存自动投递设置</button>
          {autoProgress ? <small>{autoProgress.status === 'uploading' ? `正在投递 ${autoProgress.pending || 0} 个文件` : autoProgress.failed ? `${autoProgress.failed} 个文件待重试` : '自动投递已检查'}</small> : null}
        </div> : <div className="terminal-empty-state">共享终端不会持续监测文件夹，避免下一名学生接手后沿用上一人的投递目标。普通文件仍可使用“上传学习资料”。</div>) : null}

        {activeWorkspace === 'capture' ? <div className="student-tool-form">
          <p>屏幕资料采集使用浮动控制面板：先选择屏幕、策略和时长；开始后通过右下角置顶控制条暂停、重点截取或结束。资料只会送达到当前学生本人或已关联项目。</p>
          <div className="capture-row">
            <button className="terminal-primary" onClick={openCapturePanel} disabled={busy || !selectedTarget}>{captureSession?.status === 'capturing' || captureSession?.status === 'paused' ? '查看采集状态' : '打开浮动采集面板'}</button>
            <button className="terminal-secondary" onClick={uploadCapture} disabled={busy || captureSession?.status !== 'completed' || !captureSession.files?.length}>提前重试送达</button>
          </div>
        </div> : null}

        {activeWorkspace === 'practice' && (learningCapabilities as any).publications && (api as any)?.publicationAction ? <React.Suspense fallback={<p>正在读取卡片资源…</p>}><StudentPublishedCards key={selectedStudentId} studentId={selectedStudentId} action={(name,input)=>(api as any).publicationAction(name,input)}/></React.Suspense> : null}
        {activeWorkspace === 'practice' && !(learningCapabilities as any).publications ? <div className="student-tool-form">
          {rejectedPracticeAttempts.map(item => <details key={item.attemptId}><summary>一份暂存作答未获主机接收（原文保留）</summary><p>{item.error}</p><textarea readOnly value={item.answer} rows={4} aria-label="未接收的原始作答" /></details>)}
          {learningBusy ? <p>正在读取学习卡片…</p> : null}
          {!learningBusy && !practiceDashboard?.current ? <p>当前没有已投递的学习卡片。主机准备好练习后会显示在这里。</p> : null}
          {practiceDashboard?.current ? <article className="terminal-card">
            <h3>{practiceDashboard.current.content.title}</h3>
            <p>{practiceDashboard.current.content.subject} · {practiceDashboard.current.content.knowledgePoint} · {practiceDashboard.current.status === 'completed' ? '已提交' : practiceDashboard.current.status === 'started' ? '正在作答' : '待开始'}</p>
            <MarkdownDocument content={practiceDashboard.current.content.prompt} />
            {practiceDashboard.current.status === 'ready' ? <button className="terminal-primary" disabled={learningBusy} onClick={() => void startPractice(practiceDashboard.current!.id)}>开始练习</button> : null}
            {practiceDashboard.current.status === 'started' ? <>
              <details><summary>查看提示</summary><p>{practiceDashboard.current.content.hint || '暂无提示'}</p></details>
              <label><span>我的作答</span><textarea value={practiceAnswer} onChange={event => { setPracticeAnswer(event.target.value); setPracticeAttemptId(''); }} maxLength={10000} rows={5} /></label>
              <label><span>难度反馈</span><select value={practiceDifficulty} onChange={event => { setPracticeDifficulty(event.target.value); setPracticeAttemptId(''); }}><option value="easy">太简单</option><option value="right">正合适</option><option value="hard">有点难</option></select></label>
              <label><span>信心 1—5</span><input type="number" min={1} max={5} value={practiceConfidence} onChange={event => { setPracticeConfidence(Number(event.target.value)); setPracticeAttemptId(''); }} /></label>
              <button className="terminal-primary" disabled={learningBusy || !practiceAnswer.trim()} onClick={() => void submitPractice(practiceDashboard.current!.id)}>提交练习</button>
            </> : null}
            {practiceDashboard.current.status === 'completed' ? <><p>参考答案：{practiceDashboard.current.content.answer || '等待主机返回'}</p><p>{practiceDashboard.current.content.explanation || ''}</p><small>作答已提交；是否形成成长结论仍需审核。</small></> : null}
          </article> : null}
        </div> : null}

        {activeWorkspace === 'planning' ? <div className="student-tool-form">
          <div className="document-actions">
            <button className={planningKind === 'guidance' ? 'terminal-primary' : 'terminal-secondary'} disabled={learningBusy} onClick={() => void openPlanning('guidance')}>规划</button>
            <button className={planningKind === 'topics' ? 'terminal-primary' : 'terminal-secondary'} disabled={learningBusy} onClick={() => void openPlanning('topics')}>选题</button>
            <button className={planningKind === 'competitions' ? 'terminal-primary' : 'terminal-secondary'} disabled={learningBusy} onClick={() => void openPlanning('competitions')}>比赛</button>
          </div>
          {learningBusy ? <p>正在读取…</p> : null}
          {planningView?.configurationWarning ? <p>{planningView.configurationWarning}</p> : null}
          {planningView?.needsRefresh ? <p>学生资料已有变化，以下建议可能需要重新核验。</p> : null}
          {!learningBusy && planningView && !planningView.current ? <p>主机尚未形成此类建议。</p> : null}
          {planningView?.current ? <article className="terminal-card">
            <h3>{planningKind === 'guidance' ? '当前规划' : planningKind === 'topics' ? '选题建议' : '推荐比赛'} · 第 {planningView.current.version || 1} 版</h3>
            <small>核验时间：{planningView.current.verifiedAt || planningView.current.createdAt || '未记录'}</small>
            {planningKind === 'guidance' ? <><h4>规划依据与发现</h4><ul>{(planningView.current.findings || []).map((item, index) => <li key={index}>{item}</li>)}</ul><h4>近期行动</h4><ul>{(planningView.current.nearTermActions || []).map((item, index) => <li key={index}>{item}</li>)}</ul></> : null}
            {(planningView.current.candidates || []).map(item => <section key={item.id}><h4>{item.title || item.name}</h4>{item.fitReason ? <MarkdownDocument content={item.fitReason} /> : null}{item.matchReasons?.length ? <div className="student-planning-reasons">{item.matchReasons.map((reason, index) => <MarkdownDocument key={index} content={`- ${reason}`} />)}</div> : null}{item.deadline ? <small>截止时间：{item.deadline}</small> : null}{item.officialUrl ? <p><a href={item.officialUrl} target="_blank" rel="noreferrer">官方来源</a></p> : null}{learningCapabilities.planningFavorites && planningKind !== 'guidance' ? <button className="terminal-secondary" disabled={learningBusy} onClick={() => void togglePlanningFavorite(item.id, !planningFavorites.some(favorite => favorite.candidateId === item.id))}>{planningFavorites.some(favorite => favorite.candidateId === item.id) ? '取消收藏' : '收藏建议'}</button> : null}</section>)}
          </article> : null}
          {planningFavorites.length > 0 && planningKind !== 'guidance' ? <article className="terminal-card"><h3>已收藏的历史建议</h3>{planningFavorites.map(item => <section key={item.candidateId}><h4>{item.candidate.title || item.candidate.name}</h4><small>保存于 {item.savedAt}</small><button className="terminal-secondary" disabled={learningBusy} onClick={() => void togglePlanningFavorite(item.candidateId, false)}>取消收藏</button></section>)}</article> : null}
        </div> : null}

        {activeWorkspace === 'trajectory' ? <div className="student-tool-form student-trajectory">
          <p>以下状态来自主机中已核验的练习与学习证据，只用于安排复习，不代表已经掌握或遗忘。</p>
          {learningBusy ? <p>正在读取知识点跟踪…</p> : null}
          {!learningBusy && learningTrajectory?.message ? <div className="terminal-empty-state">{learningTrajectory.message}</div> : null}
          <div className="student-trajectory-grid">
            {(learningTrajectory?.states || []).map(item => <article key={item.knowledgePoint.id}>
              <span>{item.knowledgePoint.subject || '未分类'}</span><h3>{item.knowledgePoint.label || item.knowledgePoint.id}</h3>
              <strong>{item.retentionNote || item.state || '证据不足'}</strong>
              <p>证据 {item.evidenceCount || 0} 条{item.lastPracticedAt ? ` · 最近练习 ${item.lastPracticedAt.slice(0, 10)}` : ''}</p>
              <small>复习优先级：{item.reviewPriority || '待判断'}{item.recommendedReviewAt ? ` · 建议 ${item.recommendedReviewAt.slice(0, 10)}` : ''}</small>
            </article>)}
          </div>
        </div> : null}

        {activeWorkspace === 'inbox' ? <div className="student-tool-form">
          <p>分享内容先存入主机收件箱，之后由主机决定是否投递到教育档案；不会自动成为已确认的成长证据。</p>
          <label><span>标题</span><input value={inboxTitle} onChange={event => { setInboxTitle(event.target.value); setInboxEventId(''); }} maxLength={80} placeholder="如：课堂笔记" /></label>
          <label><span>分享文字</span><textarea value={inboxText} onChange={event => { setInboxText(event.target.value); setInboxEventId(''); }} maxLength={10000} rows={6} /></label>
          <button className="terminal-primary" disabled={learningBusy || !inboxText.trim()} onClick={() => void submitLearningInbox()}>发送到主机收件箱</button>
          <h3>最近接收</h3>{inboxItems.slice(0, 20).map(item => <p key={item.itemId}>{item.originalName} · {item.status} · {item.receivedAt}</p>)}
        </div> : null}

        {activeWorkspace === 'conversation' ? <div className="student-tool-form student-conversation-capture">
          <section className="student-conversation-import" aria-labelledby="conversation-import-title">
          <h3 id="conversation-import-title">AI 对话分享导入</h3>
          <p>支持从其他 AI 应用分享、粘贴文字、导入文本文件或解析公开 HTTPS 链接。内容先在本机预览，确认当前学生和资料目标后才提交主机。</p>
          <div className="document-actions"><button className="terminal-secondary" onClick={() => void importConversationFile()} disabled={learningBusy}>导入 .md/.txt/.json</button></div>
          <label><span>公开HTTPS对话链接</span><div className="folder-row"><input value={conversationLink} onChange={event => setConversationLink(event.target.value)} placeholder="https://…" /><button onClick={() => void previewConversationUrl()} disabled={learningBusy || !conversationLink.startsWith('https://')}>解析链接</button></div></label>
          <label><span>对话正文</span><textarea value={conversationText} onChange={event => setConversationText(event.target.value)} rows={10} maxLength={60000} placeholder="粘贴或导入对话正文" /></label>
          <p>当前学生：{selectedStudent.name} · 写入位置：{selectedTarget?.name || '请先选择资料目标'}</p>
          <button className="terminal-primary" onClick={() => void submitConversation()} disabled={learningBusy || !selectedTarget || !conversationText.trim()}>确认并提交主机</button>
          </section>
          <section className={`student-agent-capture-card${agentCapture.enabled ? ' enabled' : ''}`} aria-labelledby="agent-capture-title">
            <span className="student-agent-capture-icon" aria-hidden="true"><Bot size={24} /></span>
            <div>
              <h3 id="agent-capture-title">会话自动采集</h3>
              <p>{config.terminalMode === 'personal'
                ? '一次授权后，只采集本机受支持 Agent 的后续用户对话并归入当前绑定学生；不扫描授权前历史、系统提示、密钥或其他学生内容。'
                : '共享终端不支持自动会话采集，避免不同学生之间混入会话。'}</p>
              <small>{config.terminalMode === 'personal'
                ? (agentCapture.enabled
                    ? `${agentCapture.connectedCount}/${agentCapture.installedCount} 个已安装 Agent 已接入${agentCapture.pending ? ` · ${agentCapture.pending} 条待补交` : ''}`
                    : (agentCapture.installedCount ? `已检测到 ${agentCapture.installedCount} 个受支持 Agent · 授权后接入` : '暂未检测到已安装的受支持 Agent'))
                : '请切换到个人终端并完成固定绑定后使用。'}</small>
              {agentCapture.warnings.length ? <small className="student-agent-capture-warning">{agentCapture.warnings[0]}</small> : null}
            </div>
            <button className={agentCapture.enabled ? 'terminal-danger' : 'terminal-primary'} type="button" onClick={toggleAgentCapture} disabled={busy || agentCaptureBusy || config.terminalMode !== 'personal'}>
              {agentCaptureBusy ? '正在设置…' : agentCapture.enabled ? '停止采集' : '授权采集'}
            </button>
          </section>
        </div> : null}

        {activeWorkspace === 'project-report' ? <div className="student-tool-form student-project-report-launcher">
          <p>报告由家庭主机根据已经登记的项目资料和学习证据生成，学生端只读展示，不在本机拼接结论。</p>
          <label><span>选择关联项目</span><select value={collaborationProjectId} onChange={event => setCollaborationProjectId(event.target.value)}>{projects.filter(project => project.studentIds?.includes(selectedStudentId)).map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <button className="terminal-primary" onClick={() => void openProjectReport()} disabled={!collaborationProjectId || learningBusy}>{learningBusy ? '正在读取…' : '打开项目综合报告'}</button>
          {!projects.some(project => project.studentIds?.includes(selectedStudentId)) ? <div className="terminal-empty-state">当前学生还没有关联项目。</div> : null}
        </div> : null}

        {activeWorkspace === 'collaboration' ? <div className="student-tool-form">
          <p>学生本人填写学习状态。教师端代填时使用完全相同的字段，并由主机标记真实记录人。</p>
          <label><span>今日总体状态</span><select value={learningStatusForm.overallState} onChange={event => setLearningStatusForm(value => ({ ...value, overallState: event.target.value as LearningStatusInput['overallState'] }))}><option value="smooth">顺利</option><option value="normal">一般</option><option value="difficult">遇到困难</option></select></label>
          {([['currentContent', '当前在学内容'], ['completed', '已完成事项'], ['difficulties', '遇到的困难'], ['nextPlan', '下一步计划'], ['helpNeeded', '需要的帮助'], ['notes', '补充说明']] as const).map(([key, label]) => <label key={key}><span>{label}</span><textarea rows={2} value={learningStatusForm[key]} onChange={event => setLearningStatusForm(value => ({ ...value, [key]: event.target.value }))} /></label>)}
          <button className="terminal-primary" onClick={() => void saveLearningStatus()} disabled={learningBusy}>提交学习状态</button>
          <article className="terminal-card"><h3>最近学习状态</h3>{learningStatusEntries.slice(0, 5).map(entry => <p key={entry.id}><strong>{entry.recordedByRole === 'teacher' ? '教师谈话代填' : '学生自填'}</strong> · {entry.createdAt?.slice(0, 16).replace('T', ' ')}<br />{entry.currentContent || entry.notes || '已记录状态'}</p>)}{!learningStatusEntries.length ? <p>暂无记录。</p> : null}</article>
          {learningCapabilities.projectComprehensiveReport ? <article className="terminal-card"><h3>项目综合报告</h3><div className="folder-row"><select value={collaborationProjectId} onChange={event => setCollaborationProjectId(event.target.value)}>{projects.filter(project => project.studentIds?.includes(selectedStudentId)).map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select><button onClick={() => void openProjectReport()} disabled={!collaborationProjectId || learningBusy}>查看报告</button></div>{projectReport ? <small>{projectReport.status} · {projectReport.updatedAt || '未记录更新时间'} · 已在只读弹窗打开</small> : null}</article> : null}
          {learningCapabilities.weeklyKnowledgeGrowthImage ? <article className="terminal-card student-weekly-growth-card"><h3>每周资料增长图</h3><p>仅统计当前学生成功写入资产索引的去重资料；文件数量不代表掌握度或学习效果。</p><div className="document-actions">{growthWeeks.map(week => <button className={`terminal-secondary${growthImage?.week === week ? ' active' : ''}`} key={week} onClick={() => void openGrowthImage(week)}>{week}</button>)}</div>{growthImageLoadError ? <div className="student-weekly-growth-error" role="status">{growthImageLoadError}<small>学习状态仍可正常记录。请升级 Windows 主机候选包后再读取资料图。</small></div> : null}{growthImage ? <><img className="student-weekly-growth-image" src={`data:${growthImage.mimeType};base64,${growthImage.imageBase64}`} alt={`${growthImage.week} 单学生每周资料增长图`} /><div className="document-actions"><button className="terminal-secondary" onClick={() => void exportGrowthImage('copy')}><Copy size={16} />复制图片</button><button className="terminal-secondary" onClick={() => void exportGrowthImage('save')}><Download size={16} />导出图片</button><button className="terminal-primary" onClick={() => void exportGrowthImage('share')}>准备分享</button></div></> : null}</article> : null}
        </div> : null}

        {activeWorkspace === 'documents' ? <div className="student-documents-workspace">
          <p className="student-workspace-description">{activePrimaryModule === 'project' ? '项目资料与知识只读取当前学生本人已关联项目的内容，不显示其他学生或未关联项目。' : '成长模型、学情报告与教育档案只读取当前学生自己的内容，不显示其他学生内容。'}</p>
          <div className="document-actions">
            {activePrimaryModule === 'project' ? <button className={documentMode === 'project-knowledge' ? 'terminal-primary' : 'terminal-secondary'} onClick={() => showProjectKnowledge()} disabled={busy}>项目资料与知识</button> : <>
              <button className={documentMode === 'growth' ? 'terminal-primary' : 'terminal-secondary'} onClick={showGrowthSummary} disabled={busy}>查看成长模型</button>
              <button className={documentMode === 'reports' ? 'terminal-primary' : 'terminal-secondary'} onClick={showLearningReports} disabled={busy}>学情报告</button>
              <button className={documentMode === 'archive' ? 'terminal-primary' : 'terminal-secondary'} onClick={showArchiveFiles} disabled={busy}>教育档案</button>
            </>}
          </div>
          {documentMode === 'project-knowledge' && knowledgeProjects.length > 0 ? <label className="project-knowledge-selector">
            <span>关联项目</span>
            <select value={selectedKnowledgeProjectId} onChange={(event) => void showProjectKnowledge(event.target.value)} disabled={busy}>
              {knowledgeProjects.map((project) => <option value={project.id} key={project.id}>{project.name}{project.status === 'sealed' ? '（已封存）' : ''}{project.materialMigrationState === 'running' ? '（主机迁移中）' : project.materialMigrationState === 'partial' ? '（资料部分统一）' : project.materialMigrationState === 'attention' ? '（迁移待核对）' : ''}</option>)}
            </select>
          </label> : null}
          {documentMode === 'project-knowledge' && selectedKnowledgeProject?.materialCapabilities?.supported && api ?
            <TerminalProjectMaterialsPanel project={selectedKnowledgeProject} api={api} /> : null}
          {documentMode !== 'closed' && (documentMode !== 'project-knowledge' || !selectedKnowledgeProject?.materialCapabilities?.supported) ? <div className="document-browser">
            <div className="document-list">
              {documentMode === 'growth' ? <small>成长模型由 Windows 主机整理。学生端仅只读显示，不提供审核或修改操作。</small> : null}
              {documentMode === 'reports' ? learningReports.map((report) => <button key={report.id} onClick={() => readLearningReport(report)}><strong>{report.title}</strong><span>{report.updatedAt ? `更新：${report.updatedAt.slice(0, 10)}` : '等待主机更新'}</span></button>) : null}
              {documentMode === 'archive' ? archiveFiles.map((file) => <button key={file.path} onClick={() => readArchiveFile(file)}><strong>{file.name || file.path.split('/').pop()}</strong><span>{file.path}</span></button>) : null}
              {documentMode === 'project-knowledge' ? projectKnowledgeFiles.map((file) => <button key={file.path} onClick={() => readProjectKnowledgeFile(file)}><strong>{file.name || file.path.split('/').pop()}</strong><span>{file.path}</span></button>) : null}
              {documentMode === 'project-knowledge' && selectedKnowledgeProject?.materialMigrationState === 'running' ? <small>Windows 主机正在迁移历史资料；本终端只读等待，不会在本机执行磁盘迁移。</small> : null}
              {documentMode === 'project-knowledge' && selectedKnowledgeProject?.materialMigrationState === 'attention' ? <small>历史迁移现场需要在 Windows 主机核对；旧原件与备份均会保留。</small> : null}
              {documentMode === 'reports' && learningReports.length === 0 ? <small>当前还没有可查看的学情报告。</small> : null}
              {documentMode === 'archive' && archiveFiles.length === 0 ? <small>当前还没有可查看的教育档案。</small> : null}
              {documentMode === 'project-knowledge' && knowledgeProjects.length === 0 ? <small>当前学生还没有关联学习项目。</small> : null}
              {documentMode === 'project-knowledge' && knowledgeProjects.length > 0 && projectKnowledgeFiles.length === 0 ? <small>当前项目还没有可查看的知识文件。</small> : null}
            </div>
            <article className={`document-reader student-document-reader-inline${documentMode === 'growth' ? ' student-growth-reader' : ''}`}><h3>{documentTitle || '请选择一份内容查看'}</h3>{documentContent ? <><p className="student-document-reader-caption">来自家庭主机 · 只读渲染</p><div className="student-reader-scroll"><MarkdownDocument content={documentContent} /></div><div className="document-actions"><button className="terminal-secondary" type="button" onClick={() => void copyOpenDocument()}><Copy size={16} />复制正文</button><button className="terminal-secondary" type="button" onClick={() => window.print()}><Download size={16} />打印 / 保存 PDF</button></div></> : <p>选择左侧条目后，正文会在此右侧阅读区按 Markdown 格式渲染。</p>}</article>
          </div> : null}
        </div> : null}
      </section> : null}

      {readerDialogOpen && documentContent ? <div className="student-reader-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) setReaderDialogOpen(false); }}>
        <section className="student-reader-dialog" role="dialog" aria-modal="true" aria-labelledby="student-reader-title">
          <header><div><span>来自家庭主机 · 只读</span><h2 id="student-reader-title">{documentTitle || '教育档案'}</h2></div><button className="student-workspace-close" type="button" onClick={() => setReaderDialogOpen(false)} aria-label="关闭文档"><X size={20} /></button></header>
          <div className="student-reader-scroll"><MarkdownDocument content={documentContent} /></div>
          <footer><button className="terminal-secondary" type="button" onClick={() => void copyOpenDocument()}><Copy size={16} />复制正文</button><button className="terminal-secondary" type="button" onClick={() => window.print()}><Download size={16} />打印 / 保存 PDF</button><button className="terminal-primary" type="button" onClick={() => setReaderDialogOpen(false)}>关闭</button></footer>
        </section>
      </div> : null}
        </div>
      </div>

      {message ? <div className="terminal-toast student-home-toast" role="status">{message}</div> : null}
      <footer className="student-home-footer">学生终端 v{config.version} · 资料由 Windows 主机集中处理</footer>
    </main>
  );
}

createRoot(document.getElementById('terminal-root')!).render(<TerminalApp />);
