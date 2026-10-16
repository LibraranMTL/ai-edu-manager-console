import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
const StudentPublishedCards = React.lazy(() => import('./StudentPublishedCards').then(module => ({default:module.StudentPublishedCards})));
import {
  Archive,
  ArrowRight,
  Bot,
  BookOpen,
  FileText,
  FolderSync,
  LibraryBig,
  LogOut,
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
type Course = { courseId: string; name: string; provider: string; url: string; allowedHosts: string[]; coverUrl: string; summary: string; gradeRange: string[]; languages: string[]; accountRequirement: string; legalNotice: string };
type CourseCatalogResponse = { ok: boolean; catalogVersion?: string; studentId?: string; courses?: Course[]; disclaimer?: string };
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
type StudentWorkspace = 'courses' | 'auto-delivery' | 'capture' | 'documents' | 'practice' | 'planning' | 'inbox' | null;
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
  rejectPairInvite: () => Promise<{ ok: boolean; message?: string; state: PairingState }>;
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
  getUploadQueue: () => Promise<UploadQueueState>;
  retryUploadQueue: () => Promise<{ ok?: boolean; queue: UploadQueueState }>;
  acknowledgeUploadGeneration: () => Promise<{ ok: boolean; message?: string; queue: UploadQueueState }>;
  chooseAndUploadFiles: (target: UploadTarget) => Promise<{ cancelled?: boolean; success?: number; failed?: number; pending?: number; total?: number }>;
  chooseAutoFolder: () => Promise<{ ok: boolean; folder: string }>;
  configureAutoDelivery: (input: { enabled: boolean; folder: string; target: UploadTarget }) => Promise<{ ok: boolean }>;
  runAutoDelivery: () => Promise<{ ok: boolean }>;
  getLearningCapabilities: () => Promise<{ capabilities?: { practice?: boolean; planningRead?: boolean; planningFavorites?: boolean; remoteInbox?: boolean } }>;
  getPracticeDashboard: () => Promise<{ studentId: string; dashboard: PracticeDashboard; synchronization?: { pending?: number; rejected?: Array<{ attemptId: string; cardId: string; answer: string; error: string }>; warning?: string } }>;
  startPracticeCard: (cardId: string) => Promise<{ studentId: string; card: PracticeCard }>;
  submitPracticeCard: (cardId: string, input: { attemptId: string; answer: string; difficulty: string; confidence: number }) => Promise<{ studentId: string; card?: PracticeCard; duplicate?: boolean; pending?: boolean; message?: string }>;
  getPlanningView: (kind: PlanningKind) => Promise<PlanningView>;
  getPlanningFavorites: (kind: 'topics' | 'competitions') => Promise<{ studentId: string; favorites: PlanningFavorite[] }>;
  setPlanningFavorite: (kind: 'topics' | 'competitions', versionId: string, candidateId: string, saved: boolean) => Promise<{ studentId: string; favorites: PlanningFavorite[] }>;
  getLearningInbox: () => Promise<{ studentId: string; items: Array<{ itemId: string; originalName: string; receivedAt: string; status: string }> }>;
  submitLearningInbox: (input: { eventId: string; title: string; text: string }) => Promise<{ studentId: string; duplicate?: boolean }>;
  listLearningReports: () => Promise<{ reports?: LearningReport[] }>;
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
};

declare global {
  interface Window { terminalBridge?: TerminalBridge }
}

function targetKey(target?: UploadTarget | null) {
  return target?.id ? `${target.type}:${target.id}` : '';
}

function formatGrowthSummary(payload: GrowthSummary) {
  const summary = payload.summary || {};
  const abilities = payload.abilities || [];
  const projects = payload.projects || [];
  const evidence = payload.recentEvidence || [];
  const lines = [
    `更新时间：${payload.updatedAt ? payload.updatedAt.replace('T', ' ').slice(0, 16) : '等待主机更新'}`,
    '',
    `成长证据 ${summary.evidenceCount || 0} 条 · 已确认 ${summary.confirmedCount || 0} 条 · 观察中 ${summary.watchingCount || 0} 条`,
    `能力维度 ${summary.abilityCount || 0} 个 · 关联项目 ${summary.projectCount || 0} 个`,
    '',
    '能力画像',
    ...(abilities.length ? abilities.map((item) => `• ${item.name || '待标注'}：${item.maturityLabel || '证据不足'}，${item.trendLabel || '尚不足以判断'}；证据 ${item.evidenceCount || 0} 条${item.projectNames?.length ? `；项目 ${item.projectNames.join('、')}` : ''}`) : ['暂无已形成的能力画像。']),
    '',
    '项目贡献',
    ...(projects.length ? projects.map((item) => `• ${item.projectName || '未命名项目'}：${item.reviewStatusLabel || '积累中'}；已确认 ${item.confirmedEvidenceCount || 0}/${item.evidenceCount || 0} 条${item.abilityNames?.length ? `；能力 ${item.abilityNames.join('、')}` : ''}`) : ['暂无项目贡献记录。']),
    '',
    '近期成长证据',
    ...(evidence.length ? evidence.map((item) => `• ${item.title || '成长证据'}（${item.statusLabel || '观察中'}${item.ability ? ` · ${item.ability}` : ''}${item.projectName ? ` · ${item.projectName}` : ''}）`) : ['暂无已确认或观察中的成长证据。']),
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
  const [agentCapture, setAgentCapture] = useState<AgentCaptureState>({ enabled: false, active: false, registrations: {}, warnings: [], installedCount: 0, connectedCount: 0, pending: 0 });
  const [agentCaptureBusy, setAgentCaptureBusy] = useState(false);
  const [learningCapabilities, setLearningCapabilities] = useState<{ practice?: boolean; planningRead?: boolean; planningFavorites?: boolean; remoteInbox?: boolean }>({});
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
  const workspaceRef = useRef<HTMLElement | null>(null);

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
    setActiveWorkspace('planning'); setPlanningKind(kind); setPlanningView(null); setLearningBusy(true);
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
      setCourseCatalogVersion(payload.catalogVersion || '');
      setCourseDisclaimer(payload.disclaimer || '');
    } catch (error) {
      setCourses([]);
      setCourseDisclaimer('');
      setMessage(`精选课程暂不可用：${(error as Error).message}`);
    }
  };

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

  const revealWorkspace = (workspace: Exclude<StudentWorkspace, null>) => {
    setActiveWorkspace(workspace);
    window.requestAnimationFrame(() => {
      workspaceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const openDocumentWorkspace = (mode: Exclude<typeof documentMode, 'closed'>) => {
    revealWorkspace('documents');
    if (mode === 'growth') void showGrowthSummary();
    if (mode === 'reports') void showLearningReports();
    if (mode === 'archive') void showArchiveFiles();
    if (mode === 'project-knowledge') void showProjectKnowledge();
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
          <button className="terminal-secondary" onClick={loadCaptureSources} disabled={busy || captureSession?.status === 'capturing'}>选择采集屏幕</button>
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
          <button className={captureSession?.status === 'capturing' ? 'terminal-danger' : 'terminal-primary'} onClick={toggleCapture} disabled={busy || !selectedTarget}>
            {captureSession?.status === 'capturing' ? '结束采集' : '开始采集'}
          </button>
          <button className="terminal-secondary" onClick={uploadCapture} disabled={busy || captureSession?.status !== 'completed' || captureSession.courseId !== openedCourse?.courseId || !captureSession.files?.length}>提前重试送达</button>
        </section>
        <div className="terminal-course-browser-placeholder">课程网页在隔离视图中加载。非白名单跳转、下载、弹窗和权限申请会被阻止。</div>
        {message ? <div className="terminal-toast" role="status">{message}</div> : null}
      </main>
    );
  }

  return (
    <main className="terminal-shell terminal-home-shell">
      <header className="terminal-topbar student-home-topbar">
        <div className="student-brand-lockup">
          <span className="student-brand-mark" aria-hidden="true">AI</span>
          <span><strong>AI教育管家</strong><small>Windows 学生端</small></span>
        </div>
        <div className="student-home-controls">
          <div className="student-identity-chip"><span aria-hidden="true"><UserRound size={19} /></span><small>正在学习</small><strong>{selectedStudent.name}</strong></div>
          <div className="student-host-chip" title={config.hostUrl}><Wifi size={16} /><span>家庭主机 · 已连接</span></div>
          <button className="student-topbar-button" onClick={refresh} disabled={busy} aria-label="刷新学生端数据"><RefreshCw size={17} />刷新</button>
          <button className="student-topbar-button" onClick={() => setSettingsOpen((value) => !value)} aria-expanded={settingsOpen}><Settings size={17} />设置</button>
          <button className="student-topbar-button quiet" onClick={leaveStudent} disabled={busy || captureSession?.status === 'capturing'}><LogOut size={17} />退出</button>
        </div>
      </header>

      {settingsOpen ? (
        <section className="terminal-card target-card student-settings-panel">
          <div className="card-heading"><div><h2>使用模式</h2><p>模式切换后会结束当前学生会话。</p></div></div>
          <div className="mode-grid">
            <button className={config.terminalMode === 'personal' ? 'mode-card active' : 'mode-card'} onClick={() => changeMode('personal')} disabled={busy}><strong>个人终端</strong><span>固定绑定当前学生，可使用自动投递。</span></button>
            <button className={config.terminalMode === 'shared' ? 'mode-card active' : 'mode-card'} onClick={() => changeMode('shared')} disabled={busy}><strong>共享终端</strong><span>退出后由下一位学生输入个人 ID。</span></button>
          </div>
          <section className={`student-agent-capture-card${agentCapture.enabled ? ' enabled' : ''}`} aria-labelledby="agent-capture-title">
            <span className="student-agent-capture-icon" aria-hidden="true"><Bot size={24} /></span>
            <div>
              <h3 id="agent-capture-title">自动会话记忆</h3>
              <p>{config.terminalMode === 'personal'
                ? '一次授权后，采集本机受支持 Agent 的后续会话，并只归档到当前绑定学生。已打开的 Codex 会话在 Hook 已生效时，从下一条提问开始采集；不扫描授权前历史、系统提示、密钥或任务中心上下文。'
                : '共享终端不支持自动会话采集，避免不同学生之间混入会话。'}</p>
              <small>{config.terminalMode === 'personal'
                ? (agentCapture.enabled
                    ? `${agentCapture.connectedCount}/${agentCapture.installedCount} 个已安装 Agent 已接入${agentCapture.pending ? ` · ${agentCapture.pending} 条待补交` : ''}`
                    : (agentCapture.installedCount
                        ? `已检测到 ${agentCapture.installedCount} 个受支持 Agent · 授权后接入`
                        : '暂未检测到已安装的受支持 Agent'))
                : '请切换到个人终端并完成固定绑定后使用。'}</small>
              {agentCapture.warnings.length ? <small className="student-agent-capture-warning">{agentCapture.warnings[0]}</small> : null}
            </div>
            <button className={agentCapture.enabled ? 'terminal-danger' : 'terminal-primary'} type="button" onClick={toggleAgentCapture} disabled={busy || agentCaptureBusy || config.terminalMode !== 'personal'}>
              {agentCaptureBusy ? '正在设置…' : agentCapture.enabled ? '停止采集' : '授权采集'}
            </button>
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

      <section className="student-home-dashboard" aria-labelledby="student-home-title">
        <div className="student-dashboard-heading">
          <div><span className="student-dashboard-eyebrow">{selectedStudent.grade ? `${selectedStudent.grade} · ` : ''}我的学习工作台</span><h1 id="student-home-title">今天想先做什么？</h1><p>选择一个方块开始，资料只会进入当前学生本人或已关联项目。</p></div>
          <label className="student-target-picker">
            <span className="student-target-icon" aria-hidden="true"><Target size={20} /></span>
            <span className="student-target-copy"><small>当前资料目标</small><select value={selectedTarget ? targetKey(selectedTarget) : ''} onChange={(event) => setSelectedTargetKey(event.target.value)} aria-label="当前资料目标">{targets.map((target) => <option value={targetKey(target)} key={targetKey(target)}>{target.name}</option>)}</select></span>
          </label>
        </div>

        {reminderVisible ? <section className="student-reminder-strip" role="status">
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

        <section className="student-action-grid" aria-label="学生端常用功能">
          <StudentActionTile icon={Upload} title="上传学习资料" description="作业、试卷、笔记或项目文件" meta={uploadProgress?.status === 'uploading' ? `上传中 ${uploadProgress.current || 0}/${uploadProgress.total || 0}` : unknownUploadCount ? `${unknownUploadCount} 个结果待核对` : queuedUploadCount ? `${queuedUploadCount} 个已存本机待上传` : `今日已提交 ${submittedToday} 份`} tone="tone-upload" disabled={busy || !selectedTarget} onClick={uploadFiles} />
          <StudentActionTile icon={BookOpen} title="我的课程" description="继续已分配的精选课程" meta={`${courses.length} 门可用课程`} tone="tone-course" active={activeWorkspace === 'courses'} onClick={() => revealWorkspace('courses')} />
          <StudentActionTile icon={MonitorUp} title="屏幕资料采集" description="截取学习屏幕或应用窗口" meta={captureSession?.status === 'capturing' ? `采集中 · ${captureSession.count} 张` : captureSession?.status === 'paused' ? `已暂停 · ${captureSession.count} 张` : captureSession?.status === 'completed' ? `${captureSession.count} 张待上传` : '需要时主动开启'} tone="tone-capture" active={capturePanelOpen || captureSession?.status === 'capturing' || captureSession?.status === 'paused'} onClick={openCapturePanel} />
          <StudentActionTile icon={FolderSync} title="自动投递" description={config.terminalMode === 'personal' ? '监测指定文件夹中的新资料' : '共享终端不持续监测文件夹'} meta={config.terminalMode === 'personal' ? (autoEnabled ? '已开启' : '未开启') : '个人终端可用'} tone="tone-auto" active={activeWorkspace === 'auto-delivery'} onClick={() => revealWorkspace('auto-delivery')} />
          <StudentActionTile icon={TrendingUp} title="成长模型" description="查看能力与项目成长证据" meta="只读查看" tone="tone-growth" active={activeWorkspace === 'documents' && documentMode === 'growth'} disabled={busy} onClick={() => openDocumentWorkspace('growth')} />
          <StudentActionTile icon={FileText} title="学情报告" description="查看掌握情况和学习建议" meta="只读查看" tone="tone-report" active={activeWorkspace === 'documents' && documentMode === 'reports'} disabled={busy} onClick={() => openDocumentWorkspace('reports')} />
          {learningCapabilities.practice ? <StudentActionTile icon={Target} title="学习卡片" description="完成主机为我准备的练习" meta="作答后明确提交" tone="tone-report" active={activeWorkspace === 'practice'} disabled={busy} onClick={() => void openPractice()} /> : null}
          {learningCapabilities.planningRead ? <StudentActionTile icon={TrendingUp} title="规划与发现" description="查看我的规划、选题和比赛" meta="建议与来源只读" tone="tone-knowledge" active={activeWorkspace === 'planning'} disabled={busy} onClick={() => void openPlanning()} /> : null}
          {learningCapabilities.remoteInbox ? <StudentActionTile icon={FileText} title="分享收件箱" description="把文字资料送入主机待整理" meta="只限当前学生" tone="tone-knowledge" active={activeWorkspace === 'inbox'} disabled={busy} onClick={() => void openLearningInbox()} /> : null}
          <StudentActionTile icon={Archive} title="教育档案" description="查找本人已公开的档案内容" meta={`${selectedStudent.archiveFileCount || 0} 份档案`} tone="tone-archive" active={activeWorkspace === 'documents' && documentMode === 'archive'} disabled={busy} onClick={() => openDocumentWorkspace('archive')} />
          <StudentActionTile icon={LibraryBig} title="查看关联项目知识" description="阅读本人关联项目的知识资料" meta={`${knowledgeProjects.length} 个关联项目`} tone="tone-knowledge" active={activeWorkspace === 'documents' && documentMode === 'project-knowledge'} disabled={busy} onClick={() => openDocumentWorkspace('project-knowledge')} />
        </section>
      </section>

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
          <button className="terminal-primary" type="button" onClick={toggleCapture} disabled={busy || !selectedTarget || !captureSourceId}>{busy ? '正在启动…' : `开始采集（最长 ${captureDuration} 分钟）`}</button>
        </footer>
      </aside> : null}

      {activeWorkspace ? <section className="student-workspace-panel" ref={workspaceRef} aria-label="当前功能工作区">
        <header className="student-workspace-heading">
          <div><span>当前功能</span><h2>{activeWorkspace === 'courses' ? '我的课程' : activeWorkspace === 'auto-delivery' ? '自动投递' : activeWorkspace === 'capture' ? '屏幕资料采集' : activeWorkspace === 'practice' ? '学习卡片' : activeWorkspace === 'planning' ? '规划与发现' : activeWorkspace === 'inbox' ? '分享收件箱' : '成长与档案'}</h2></div>
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
            {(planningView.current.candidates || []).map(item => <section key={item.id}><h4>{item.title || item.name}</h4>{item.fitReason ? <p>{item.fitReason}</p> : null}{item.matchReasons?.length ? <p>{item.matchReasons.join('；')}</p> : null}{item.deadline ? <small>截止时间：{item.deadline}</small> : null}{item.officialUrl ? <p><a href={item.officialUrl} target="_blank" rel="noreferrer">官方来源</a></p> : null}{learningCapabilities.planningFavorites && planningKind !== 'guidance' ? <button className="terminal-secondary" disabled={learningBusy} onClick={() => void togglePlanningFavorite(item.id, !planningFavorites.some(favorite => favorite.candidateId === item.id))}>{planningFavorites.some(favorite => favorite.candidateId === item.id) ? '取消收藏' : '收藏建议'}</button> : null}</section>)}
          </article> : null}
          {planningFavorites.length > 0 && planningKind !== 'guidance' ? <article className="terminal-card"><h3>已收藏的历史建议</h3>{planningFavorites.map(item => <section key={item.candidateId}><h4>{item.candidate.title || item.candidate.name}</h4><small>保存于 {item.savedAt}</small><button className="terminal-secondary" disabled={learningBusy} onClick={() => void togglePlanningFavorite(item.candidateId, false)}>取消收藏</button></section>)}</article> : null}
        </div> : null}

        {activeWorkspace === 'inbox' ? <div className="student-tool-form">
          <p>分享内容先存入主机收件箱，之后由主机决定是否投递到教育档案；不会自动成为已确认的成长证据。</p>
          <label><span>标题</span><input value={inboxTitle} onChange={event => { setInboxTitle(event.target.value); setInboxEventId(''); }} maxLength={80} placeholder="如：课堂笔记" /></label>
          <label><span>分享文字</span><textarea value={inboxText} onChange={event => { setInboxText(event.target.value); setInboxEventId(''); }} maxLength={10000} rows={6} /></label>
          <button className="terminal-primary" disabled={learningBusy || !inboxText.trim()} onClick={() => void submitLearningInbox()}>发送到主机收件箱</button>
          <h3>最近接收</h3>{inboxItems.slice(0, 20).map(item => <p key={item.itemId}>{item.originalName} · {item.status} · {item.receivedAt}</p>)}
        </div> : null}

        {activeWorkspace === 'documents' ? <div className="student-documents-workspace">
          <p className="student-workspace-description">成长模型、学情报告、教育档案与项目知识只读取当前学生自己的内容，不显示其他学生或未关联项目。</p>
          <div className="document-actions">
            <button className={documentMode === 'growth' ? 'terminal-primary' : 'terminal-secondary'} onClick={showGrowthSummary} disabled={busy}>查看成长模型</button>
            <button className={documentMode === 'reports' ? 'terminal-primary' : 'terminal-secondary'} onClick={showLearningReports} disabled={busy}>学情报告</button>
            <button className={documentMode === 'archive' ? 'terminal-primary' : 'terminal-secondary'} onClick={showArchiveFiles} disabled={busy}>教育档案</button>
            <button className={documentMode === 'project-knowledge' ? 'terminal-primary' : 'terminal-secondary'} onClick={() => showProjectKnowledge()} disabled={busy}>项目资料与知识</button>
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
            <article className="document-reader"><h3>{documentTitle || '请选择一份内容查看'}</h3><MarkdownDocument content={documentContent || '正文将在这里显示。'} /></article>
          </div> : null}
        </div> : null}
      </section> : null}

      {message ? <div className="terminal-toast student-home-toast" role="status">{message}</div> : null}
      <footer className="student-home-footer">学生终端 v{config.version} · 资料由 Windows 主机集中处理</footer>
    </main>
  );
}

createRoot(document.getElementById('terminal-root')!).render(<TerminalApp />);
