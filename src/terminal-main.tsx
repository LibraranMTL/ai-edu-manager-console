import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './terminal-styles.css';

type Student = { id: string; name: string; grade?: string; rawFileCount?: number; pendingDigestCount?: number; processedDigestCount?: number };
type Project = { id: string; name: string; studentIds?: string[]; status?: string };
type UploadTarget = { type: 'student' | 'project'; id: string; name: string; studentId: string };
type TerminalConfig = {
  connected: boolean;
  hostUrl: string;
  token: string;
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

type TerminalBridge = {
  getConfig: () => Promise<TerminalConfig>;
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
  listCaptureSources: () => Promise<CaptureSource[]>;
  startCapture: (input: Record<string, unknown>) => Promise<CaptureSession>;
  stopCapture: () => Promise<CaptureSession | null>;
  uploadCapture: (input: { files: string[]; target: UploadTarget; captureSessionId: string }) => Promise<{ success?: number; failed?: number; total?: number }>;
  onUploadProgress: (handler: (payload: Progress) => void) => void;
  onAutoDelivery: (handler: (payload: Progress) => void) => void;
  onCaptureChanged: (handler: (payload: CaptureSession) => void) => void;
};

declare global {
  interface Window { terminalBridge?: TerminalBridge }
}

function targetKey(target?: UploadTarget | null) {
  return target?.id ? `${target.type}:${target.id}` : '';
}

function TerminalApp() {
  const api = window.terminalBridge;
  const [config, setConfig] = useState<TerminalConfig | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [selectedTargetKey, setSelectedTargetKey] = useState('');
  const [connectionText, setConnectionText] = useState('');
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
    api.onUploadProgress(setUploadProgress);
    api.onAutoDelivery(setAutoProgress);
    api.onCaptureChanged(setCaptureSession);
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

  const pair = async () => {
    if (!api) return;
    setBusy(true);
    setMessage('正在连接主机…');
    try {
      const result = await api.pair({ connectionText, hostUrl, pairCode, deviceName });
      setConfig(result.config);
      setMessage(result.message || '设备已连接，请选择使用模式后扫码或输入学生 ID。');
      await refresh();
    } catch (error) {
      setMessage(`连接失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
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
          <label><span>主机连接信息</span><textarea value={connectionText} onChange={(event) => setConnectionText(event.target.value)} placeholder="推荐：粘贴主机端复制的连接信息" /></label>
          <div className="terminal-form-grid">
            <label><span>主机地址</span><input value={hostUrl} onChange={(event) => setHostUrl(event.target.value)} placeholder="http://192.168.1.8:18777" /></label>
            <label><span>六位配对码</span><input value={pairCode} onChange={(event) => setPairCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" /></label>
          </div>
          <label><span>本机名称</span><input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} /></label>
          <button className="terminal-primary" onClick={pair} disabled={busy}>{busy ? '正在连接…' : '连接主机'}</button>
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
        </section>
      ) : null}

      <section className="terminal-hero">
        <div><span className="eyebrow">当前学生：{selectedStudent.name}</span><h2>把学习资料送到正确的位置</h2><p>学生归属已由当前会话固定，只需选择本人资料库或绑定项目。</p></div>
        <div className="hero-status"><strong>{selectedStudent?.name || '等待主机确认'}</strong><span>{boundProjects.length} 个绑定项目</span></div>
      </section>

      <section className="terminal-card target-card">
        <div className="card-heading"><div><h2>1. 选择资料目标</h2><p>当前学生固定为 {selectedStudent.name}；项目资料用于项目知识加工，其他资料进入个人原始资料库。</p></div></div>
        <label><span>资料目标</span><select value={selectedTarget ? targetKey(selectedTarget) : ''} onChange={(event) => setSelectedTargetKey(event.target.value)}>{targets.map((target) => <option value={targetKey(target)} key={targetKey(target)}>{target.name}</option>)}</select></label>
      </section>

      <div className="terminal-feature-grid">
        {config.terminalMode === 'personal' ? <section className="terminal-card feature-card">
          <div className="feature-icon">↑</div><h2>上传本地资料</h2><p>支持图片、PDF、Office、文本、Markdown、CSV 和 ZIP，可一次选择多个文件。</p>
          <button className="terminal-primary" onClick={uploadFiles} disabled={busy || !selectedTarget}>{uploadProgress?.status === 'uploading' ? `正在上传 ${uploadProgress.current}/${uploadProgress.total}` : '选择并上传文件'}</button>
          {uploadProgress?.filename ? <small>当前：{uploadProgress.filename}</small> : null}
        </section> : <section className="terminal-card feature-card"><div className="feature-icon">↻</div><h2>自动投递文件夹</h2><p>共享终端不会持续监测文件夹，避免下一名学生接手后沿用上一人的投递目标。</p><small>如需自动投递，请在系统设置中切换为个人终端。</small></section>}

        <section className="terminal-card feature-card">
          <div className="feature-icon">↻</div><h2>自动投递文件夹</h2><p>监测指定文件夹，新文件联网后自动送到当前资料目标；不会删除本地文件。</p>
          <div className="folder-row"><input readOnly value={autoFolder} placeholder="尚未选择文件夹" /><button onClick={chooseAutoFolder}>选择</button></div>
          <label className="switch-row"><input type="checkbox" checked={autoEnabled} onChange={(event) => setAutoEnabled(event.target.checked)} /><span>启用自动投递到 {selectedTarget?.name || '所选目标'}</span></label>
          <button className="terminal-secondary" onClick={saveAutoDelivery} disabled={busy || !selectedTarget || !autoFolder}>保存自动投递设置</button>
          {autoProgress ? <small>{autoProgress.status === 'uploading' ? `正在投递 ${autoProgress.pending || 0} 个文件` : autoProgress.failed ? `${autoProgress.failed} 个文件待重试` : '自动投递已检查'}</small> : null}
        </section>

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
      </div>

      {message ? <div className="terminal-toast" role="status">{message}</div> : null}
      <footer>学生终端 v{config.version} · 资料由 Windows 主机集中处理</footer>
    </main>
  );
}

createRoot(document.getElementById('terminal-root')!).render(<TerminalApp />);
