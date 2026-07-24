import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './terminal-styles.css';

type StudentProgress = { submittedTodayCount?: number; recentUploadCount7?: number; previousUploadCount7?: number; recentTrend?: number; activeDays30?: number; knowledgeAssetCount?: number; newSinceLastDigestCount?: number; lastUploadAt?: string };
type Student = { id: string; name: string; grade?: string; rawFileCount?: number; archiveFileCount?: number; pendingDigestCount?: number; processedDigestCount?: number; submittedTodayCount?: number; recentUploadCount7?: number; recentUploadTrend?: number; activeDays30?: number; knowledgeAssetCount?: number; newSinceLastDigestCount?: number; progress?: StudentProgress };
type Project = { id: string; name: string; studentIds?: string[]; status?: string };
type UploadTarget = { type: 'student' | 'project'; id: string; name: string; studentId: string };
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
};
type CaptureSource = { id: string; name: string; type: 'screen' | 'window' };
type CaptureSession = { id: string; status: string; sourceName: string; count: number; files: string[]; target?: UploadTarget };
type Progress = { status: string; current?: number; total?: number; filename?: string; success?: number; failed?: number; pending?: number; delivered?: number };
type LearningReport = { id: string; title: string; summary?: string; updatedAt?: string; status?: string };
type ArchiveFile = { path: string; name?: string };
type DiscoveredHost = { deviceId: string; machineCode: string; displayName: string; appVersion?: string; protocolVersion: number; hostUrl: string; address?: string; lastSeenAt?: string };
type PendingPairRequest = { requestId: string; status: string; hostId: string; hostMachineCode: string; hostName: string; hostUrl: string; createdAt?: string; expiresAt?: string };
type TailscaleStatus = { installed: boolean; canOpen: boolean; version?: string; downloadUrl: string };
type ConnectionMethod = 'lan' | 'tailscale';
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
  chooseAndUploadFiles: (target: UploadTarget) => Promise<{ cancelled?: boolean; success?: number; failed?: number; total?: number }>;
  chooseAutoFolder: () => Promise<{ ok: boolean; folder: string }>;
  configureAutoDelivery: (input: { enabled: boolean; folder: string; target: UploadTarget }) => Promise<{ ok: boolean }>;
  runAutoDelivery: () => Promise<{ ok: boolean }>;
  listLearningReports: () => Promise<{ reports?: LearningReport[] }>;
  readLearningReport: (reportId: string) => Promise<LearningReport & { content?: string }>;
  listArchiveFiles: () => Promise<{ files?: ArchiveFile[] }>;
  readArchiveFile: (relativePath: string) => Promise<{ path?: string; content?: string }>;
  listCaptureSources: () => Promise<CaptureSource[]>;
  startCapture: (input: Record<string, unknown>) => Promise<CaptureSession>;
  stopCapture: () => Promise<CaptureSession | null>;
  uploadCapture: (input: { files: string[]; target: UploadTarget; captureSessionId: string }) => Promise<{ success?: number; failed?: number; total?: number }>;
  onUploadProgress: (handler: (payload: Progress) => void) => void;
  onAutoDelivery: (handler: (payload: Progress) => void) => void;
  onCaptureChanged: (handler: (payload: CaptureSession) => void) => void;
  onPairingChanged: (handler: (payload: { state: PairingState; config: TerminalConfig }) => void) => () => void;
};

declare global {
  interface Window { terminalBridge?: TerminalBridge }
}

function targetKey(target?: UploadTarget | null) {
  return target?.id ? `${target.type}:${target.id}` : '';
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
  const [autoProgress, setAutoProgress] = useState<Progress | null>(null);
  const [autoFolder, setAutoFolder] = useState('');
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [captureSources, setCaptureSources] = useState<CaptureSource[]>([]);
  const [captureSourceId, setCaptureSourceId] = useState('');
  const [captureSession, setCaptureSession] = useState<CaptureSession | null>(null);
  const [loginId, setLoginId] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [requiresLogin, setRequiresLogin] = useState(true);
  const [documentMode, setDocumentMode] = useState<'closed' | 'reports' | 'archive'>('closed');
  const [learningReports, setLearningReports] = useState<LearningReport[]>([]);
  const [archiveFiles, setArchiveFiles] = useState<ArchiveFile[]>([]);
  const [documentTitle, setDocumentTitle] = useState('');
  const [documentContent, setDocumentContent] = useState('');
  const [dismissedReminderDate, setDismissedReminderDate] = useState('');
  const [pairingState, setPairingState] = useState<PairingState | null>(null);
  const [hostMachineCodeQuery, setHostMachineCodeQuery] = useState('');
  const [pairingBusy, setPairingBusy] = useState(false);
  const [tailscaleStatus, setTailscaleStatus] = useState<TailscaleStatus | null>(null);
  const [tailscaleBusy, setTailscaleBusy] = useState(false);

  const selectedStudent = useMemo(
    () => students.find((student) => student.id === selectedStudentId) || null,
    [students, selectedStudentId],
  );
  const boundProjects = useMemo(
    () => projects.filter((project) => (project.studentIds || []).includes(selectedStudentId) && project.status !== 'sealed'),
    [projects, selectedStudentId],
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

  const refresh = async () => {
    if (!api) return;
    setBusy(true);
    try { applyRemoteState(await api.loadState()); }
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
    api.onUploadProgress(setUploadProgress);
    api.onAutoDelivery(setAutoProgress);
    api.onCaptureChanged(setCaptureSession);
    return api.onPairingChanged((payload) => {
      setPairingState(payload.state);
      setConfig(payload.config);
      if (payload.state.lastResult?.message) setMessage(payload.state.lastResult.message);
      if (payload.config.connected) void refresh();
    });
  }, [api]);

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

  const uploadFiles = async () => {
    if (!api || !selectedTarget) return;
    setBusy(true);
    setUploadProgress({ status: 'selecting' });
    try {
      const result = await api.chooseAndUploadFiles(selectedTarget);
      if (!result.cancelled) setMessage(`上传完成：成功 ${result.success || 0} 个，失败 ${result.failed || 0} 个，已送达${selectedTarget.name}。`);
      await refresh();
    } catch (error) {
      setMessage(`上传失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
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

  const showLearningReports = async () => {
    if (!api) return;
    setBusy(true);
    try {
      const payload = await api.listLearningReports();
      setLearningReports(payload.reports || []);
      setArchiveFiles([]);
      setDocumentTitle('');
      setDocumentContent('');
      setDocumentMode('reports');
    } catch (error) {
      setMessage(`读取学情报告失败：${(error as Error).message}`);
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
      setDocumentTitle('');
      setDocumentContent('');
      setDocumentMode('archive');
    } catch (error) {
      setMessage(`读取教育档案失败：${(error as Error).message}`);
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

  const toggleCapture = async () => {
    if (!api || !selectedTarget) return;
    setBusy(true);
    try {
      if (captureSession?.status === 'capturing') {
        const stopped = await api.stopCapture();
        setCaptureSession(stopped);
        setMessage(`采集已结束，共保留 ${stopped?.count || 0} 张截图。请选择资料目标后上传。`);
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
          intervalSeconds: 15,
        });
        setCaptureSession(session);
        setMessage(`正在采集“${session.sourceName}”，每 15 秒保存一张截图。`);
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
      const result = await api.uploadCapture({ files: captureSession.files, target: selectedTarget, captureSessionId: captureSession.id });
      setMessage(`采集资料上传完成：成功 ${result.success || 0} 张，失败 ${result.failed || 0} 张，已送达${selectedTarget.name}。`);
      await refresh();
    } catch (error) {
      setMessage(`采集资料上传失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
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

  return (
    <main className="terminal-shell">
      <header className="terminal-topbar">
        <div><div className="terminal-brand">AI教育管家</div><h1>Windows 学生终端</h1></div>
        <div className="terminal-host-state"><span className="online-dot" />已连接 {config.hostUrl}<button onClick={refresh} disabled={busy}>刷新</button><button onClick={() => setSettingsOpen((value) => !value)}>系统设置</button><button onClick={leaveStudent} disabled={busy || captureSession?.status === 'capturing'}>退出当前学生</button></div>
      </header>

      {settingsOpen ? (
        <section className="terminal-card target-card">
          <div className="card-heading"><div><h2>使用模式</h2><p>模式切换后会结束当前学生会话。</p></div></div>
          <div className="mode-grid">
            <button className={config.terminalMode === 'personal' ? 'mode-card active' : 'mode-card'} onClick={() => changeMode('personal')} disabled={busy}><strong>个人终端</strong><span>固定绑定当前学生，可使用自动投递。</span></button>
            <button className={config.terminalMode === 'shared' ? 'mode-card active' : 'mode-card'} onClick={() => changeMode('shared')} disabled={busy}><strong>共享终端</strong><span>退出后由下一位学生输入个人 ID。</span></button>
          </div>
          <TailscaleSupportCard status={tailscaleStatus} busy={tailscaleBusy} onRefresh={refreshTailscaleStatus} onOpen={openTailscale} onDownload={downloadTailscale} />
        </section>
      ) : null}

      <section className="terminal-hero">
        <div><span className="eyebrow">当前学生：{selectedStudent.name}</span><h2>把学习资料送到正确的位置</h2><p>学生归属已由当前会话固定，只需选择本人资料库或绑定项目。</p></div>
        <div className="hero-status"><strong>{selectedStudent?.name || '等待主机确认'}</strong><span>{boundProjects.length} 个绑定项目</span></div>
      </section>

      {reminderVisible ? <section className="terminal-reminder" role="status">
        <div><span>今日学习资料提醒</span><strong>记得提交本日学习资料</strong><p>选择今天新增的作业、笔记、截图或项目文件即可，系统会自动进入后续整理流程。</p></div>
        <div className="reminder-actions"><button className="terminal-primary" onClick={uploadFiles} disabled={busy || !selectedTarget}>现在上传</button><button className="terminal-secondary" onClick={dismissReminderToday}>稍后再说</button></div>
      </section> : null}

      <section className="student-progress-grid" aria-label="学习资料进展">
        <div><span>已提交资料</span><strong>{selectedStudent.rawFileCount || 0}</strong><small>主机原始资料库</small></div>
        <div><span>已完成知识化</span><strong>{knowledgeAssetCount}</strong><small>已消化资料数</small></div>
        <div><span>近 7 天新增</span><strong>{recentUploadCount7}</strong><small>{recentTrend > 0 ? `比前 7 天多 ${recentTrend}` : recentTrend < 0 ? `比前 7 天少 ${Math.abs(recentTrend)}` : '与前 7 天持平'}</small></div>
        <div><span>近 30 天频率</span><strong>{activeDays30} 天</strong><small>{newSinceLastDigestCount} 份等待或新增整理</small></div>
      </section>

      <section className="terminal-card target-card">
        <div className="card-heading"><div><h2>1. 选择资料目标</h2><p>当前学生固定为 {selectedStudent.name}；项目资料用于项目知识加工，其他资料进入个人原始资料库。</p></div></div>
        <label><span>资料目标</span><select value={selectedTarget ? targetKey(selectedTarget) : ''} onChange={(event) => setSelectedTargetKey(event.target.value)}>{targets.map((target) => <option value={targetKey(target)} key={targetKey(target)}>{target.name}</option>)}</select></label>
      </section>

      <div className="terminal-feature-grid">
        <section className="terminal-card feature-card">
          <div className="feature-icon">↑</div><h2>上传本地资料</h2><p>支持图片、PDF、Office、文本、Markdown、CSV 和 ZIP，可一次选择多个文件。</p>
          <button className="terminal-primary" onClick={uploadFiles} disabled={busy || !selectedTarget}>{uploadProgress?.status === 'uploading' ? `正在上传 ${uploadProgress.current}/${uploadProgress.total}` : '选择并上传文件'}</button>
          {uploadProgress?.filename ? <small>当前：{uploadProgress.filename}</small> : null}
        </section>

        {config.terminalMode === 'personal' ? <section className="terminal-card feature-card">
          <div className="feature-icon">↻</div><h2>自动投递文件夹</h2><p>监测指定文件夹，新文件联网后自动送到当前资料目标；不会删除本地文件。</p>
          <div className="folder-row"><input readOnly value={autoFolder} placeholder="尚未选择文件夹" /><button onClick={chooseAutoFolder}>选择</button></div>
          <label className="switch-row"><input type="checkbox" checked={autoEnabled} onChange={(event) => setAutoEnabled(event.target.checked)} /><span>启用自动投递到 {selectedTarget?.name || '所选目标'}</span></label>
          <button className="terminal-secondary" onClick={saveAutoDelivery} disabled={busy || !selectedTarget || !autoFolder}>保存自动投递设置</button>
          {autoProgress ? <small>{autoProgress.status === 'uploading' ? `正在投递 ${autoProgress.pending || 0} 个文件` : autoProgress.failed ? `${autoProgress.failed} 个文件待重试` : '自动投递已检查'}</small> : null}
        </section> : <section className="terminal-card feature-card"><div className="feature-icon">↻</div><h2>自动投递文件夹</h2><p>共享终端不会持续监测文件夹，避免下一名学生接手后沿用上一人的投递目标。</p><small>普通文件仍可使用左侧“上传本地资料”。个人终端可在系统设置中启用自动投递。</small></section>}

        <section className="terminal-card feature-card wide-card">
          <div className="feature-icon">▣</div><h2>屏幕资料采集</h2><p>连续截取学习屏幕或应用窗口。结束后仍可重新选择学生资料库或绑定项目资料库。</p>
          <div className="capture-row">
            <button className="terminal-secondary" onClick={loadCaptureSources} disabled={busy || captureSession?.status === 'capturing'}>刷新屏幕列表</button>
            <select value={captureSourceId} onFocus={() => { if (!captureSources.length) void loadCaptureSources(); }} onChange={(event) => setCaptureSourceId(event.target.value)} disabled={captureSession?.status === 'capturing'}>
              <option value="">{captureSources.length ? '选择屏幕或窗口' : '点击加载屏幕和窗口'}</option>
              {captureSources.map((source) => <option value={source.id} key={source.id}>{source.name}</option>)}
            </select>
            <button className={captureSession?.status === 'capturing' ? 'terminal-danger' : 'terminal-primary'} onClick={toggleCapture} disabled={busy || !selectedTarget}>{captureSession?.status === 'capturing' ? `结束采集（${captureSession.count}）` : '开始屏幕采集'}</button>
            <button className="terminal-secondary" onClick={uploadCapture} disabled={busy || captureSession?.status !== 'completed' || !captureSession.files?.length}>上传采集资料</button>
          </div>
        </section>

        <section className="terminal-card feature-card wide-card student-documents-card">
          <div className="feature-icon">▤</div><h2>学情报告与教育档案</h2><p>只读取当前学生已经在 Windows 主机形成的报告和公开档案。</p>
          <div className="document-actions">
            <button className={documentMode === 'reports' ? 'terminal-primary' : 'terminal-secondary'} onClick={showLearningReports} disabled={busy}>查看学情报告</button>
            <button className={documentMode === 'archive' ? 'terminal-primary' : 'terminal-secondary'} onClick={showArchiveFiles} disabled={busy}>查看教育档案</button>
          </div>
          {documentMode !== 'closed' ? <div className="document-browser">
            <div className="document-list">
              {documentMode === 'reports' ? learningReports.map((report) => <button key={report.id} onClick={() => readLearningReport(report)}><strong>{report.title}</strong><span>{report.updatedAt ? `更新：${report.updatedAt.slice(0, 10)}` : '等待主机更新'}</span></button>) : null}
              {documentMode === 'archive' ? archiveFiles.map((file) => <button key={file.path} onClick={() => readArchiveFile(file)}><strong>{file.name || file.path.split('/').pop()}</strong><span>{file.path}</span></button>) : null}
              {documentMode === 'reports' && learningReports.length === 0 ? <small>当前还没有可查看的学情报告。</small> : null}
              {documentMode === 'archive' && archiveFiles.length === 0 ? <small>当前还没有可查看的教育档案。</small> : null}
            </div>
            <article className="document-reader"><h3>{documentTitle || '请选择一份内容查看'}</h3><pre>{documentContent || '正文将在这里显示。'}</pre></article>
          </div> : null}
        </section>
      </div>

      {message ? <div className="terminal-toast" role="status">{message}</div> : null}
      <footer>学生终端 v{config.version} · 资料由 Windows 主机集中处理</footer>
    </main>
  );
}

createRoot(document.getElementById('terminal-root')!).render(<TerminalApp />);
