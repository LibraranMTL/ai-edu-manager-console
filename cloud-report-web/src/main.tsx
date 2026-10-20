import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
const serviceUrl = (route: string) => new URL(`.${route}`, new URL('.', window.location.href)).toString();

type Student = { id: string; displayName: string };
type Report = { revisionId: string; reportType: string; originDeviceId: string; originPlatform: string; publishedAt: string; receivedAt: number; filename: string };
type Document = { documentId: string; displayName: string; contentType: string; byteSize: number; createdAt: number; deletedAt: number | null };
type Grant = { deviceId: string; kind: string; scope: string; createdAt: number; revokedAt: number | null; expiresAt: number | null };
type V2Grant = { deviceId: string; scope: string; category: string; fields: string[]; objectScope: string[]; createdAt: number; revokedAt: number | null; expiresAt: number | null; policyVersion: number };
type CloudProfile = { profileRevisionId: string; profile: Record<string, string>; fields: string[]; updatedAt: number };
type RemoteOperation = { sessionId?: string; submissionId?: string; provider: string; taskType?: string; projectId: string; status: string; updatedAt: number; quarantinedReason?: string };
type AuditEvent = { id: number; occurredAt: number; actorId: string; action: string; studentId: string | null; targetId: string | null };
const names: Record<string, string> = { learning_profile: '整体画像', learning_change: '历史变化', weekly_action: '每周行动建议', stage_summary: '阶段总结' };
const profileFieldOptions = [
  ['displayName', '姓名'], ['grade', '年级'], ['school', '学校'], ['learningGoal', '学习目标'], ['currentRegion', '当前地区'],
  ['phone', '手机号'], ['email', '邮箱'], ['birthday', '生日'], ['address', '地址'], ['guardian', '监护人信息'],
] as const;
const materialCategoryOptions = [
  ['learning_report', '学情报告'], ['learning_material', '学习资料'], ['topic_suggestion', '选题建议'],
  ['competition_recommendation', '比赛推荐'], ['learning_card', '学习卡片'],
] as const;
const auditNames: Record<string, string> = {
  'student.create': '创建云端学生', 'source.enrollment.create': '生成来源端开通码',
  'source.enrollment.redeem': '来源端完成开通', 'grant.issue.report.write': '开通报告上传许可',
  'grant.issue.cloud_document.read': '开通 Windows 主机下载许可',
  'grant.revoke.report.write': '撤销报告上传许可',
  'grant.revoke.cloud_document.read': '撤销 Windows 主机下载许可',
  'report.upload.enable': '开启自动上传', 'report.upload.disable': '关闭自动上传',
  'report.upload': '上传学情报告', 'report.download': '下载学情报告',
  'document.upload': '上传其他文档', 'document.download': '下载其他文档',
  'document.rename': '重命名其他文档', 'document.trash': '文档移入回收站', 'document.restore': '恢复文档',
  'report.withdraw': '撤回云端报告修订', 'admin.credential.rotate': '更换管理员凭据',
  'device.credential.rotate': '更换来源设备凭据', 'device.revoke': '撤销设备',
};

function App() {
  const [token, setToken] = useState('');
  const [draftToken, setDraftToken] = useState('');
  const [credentialForm, setCredentialForm] = useState(false);
  const [oldCredential, setOldCredential] = useState('');
  const [newCredential, setNewCredential] = useState('');
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const [newName, setNewName] = useState('');
  const [tab, setTab] = useState<'reports' | 'documents'>('reports');
  const [reports, setReports] = useState<Report[]>([]);
  const [nextCursor, setNextCursor] = useState('');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [documentCursor, setDocumentCursor] = useState('');
  const [pdfUrl, setPdfUrl] = useState('');
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [source, setSource] = useState('all');
  const [date, setDate] = useState('');
  const [selectedReportId, setSelectedReportId] = useState('');
  const [trash, setTrash] = useState(false);
  const [enrollmentCode, setEnrollmentCode] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [grants, setGrants] = useState<Grant[]>([]);
  const [v2Grants, setV2Grants] = useState<V2Grant[]>([]);
  const [cloudProfile, setCloudProfile] = useState<CloudProfile | null>(null);
  const [remoteOperations, setRemoteOperations] = useState<{ sessions: RemoteOperation[]; inbox: RemoteOperation[] }>({ sessions: [], inbox: [] });
  const [downloadProfileFields, setDownloadProfileFields] = useState<string[]>(profileFieldOptions.map(([id]) => id));
  // Preserve the existing report flow, but never opt users into newly added
  // document categories without an explicit selection.
  const [downloadCategories, setDownloadCategories] = useState<string[]>(['learning_report']);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditCursor, setAuditCursor] = useState('');
  const [preview, setPreview] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [operations, setOperations] = useState<{ storage: { freeBytes: number; warning: boolean }; backup: { enabled: boolean; lastSuccessAt?: number; lastError?: string } } | null>(null);
  const [storage, setStorage] = useState<{ usedBytes: number; maxBytes: number } | null>(null);
  const selected = students.find(item => item.id === selectedId);
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);
  useEffect(() => { sessionStorage.removeItem('cloud-admin-token'); }, []);

  async function api(route: string, options: RequestInit = {}, accessToken = token): Promise<Response> {
    const response = await fetch(serviceUrl(route), { ...options, headers: { authorization: `Bearer ${accessToken}`, ...options.headers }, cache: 'no-store', signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) setToken('');
      throw new Error(payload.error || `请求失败（HTTP ${response.status}）`);
    }
    return response;
  }
  async function act(task: () => Promise<void>) {
    setBusy(true); setMessage('');
    try { await task(); } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  async function loadStudents(accessToken = token) {
    const result = await (await api('/v1/students', {}, accessToken)).json();
    const items = result.students as Student[];
    setStudents(items);
    setSelectedId(current => items.some(item => item.id === current) ? current : items[0]?.id || '');
  }
  async function loadItems(studentId = selectedId, currentTab = tab, showTrash = trash, cursor = '') {
    if (!studentId) return;
    if (currentTab === 'reports') {
      const result = await (await api(`/v1/students/${studentId}/reports${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)).json();
      if (selectedIdRef.current !== studentId) return;
      setReports(current => cursor ? [...current, ...result.reports] : result.reports);
      setNextCursor(result.nextCursor || '');
    } else {
      const params = new URLSearchParams();
      if (showTrash) params.set('trash', '1');
      if (cursor) params.set('cursor', cursor);
      const result = await (await api(`/v1/students/${studentId}/documents?${params}`)).json();
      if (selectedIdRef.current !== studentId) return;
      setDocuments(current => cursor ? [...current, ...result.documents] : result.documents);
      setDocumentCursor(result.nextCursor || '');
    }
  }
  async function loadGrants(studentId = selectedId) {
    if (!studentId) return;
    const [result, capacity, v2Result, profileResult, remoteResult] = await Promise.all([
      api(`/v1/students/${studentId}/grants`).then(response => response.json()),
      api(`/v1/students/${studentId}/storage`).then(response => response.json()),
      api(`/v2/students/${studentId}/grants`).then(response => response.json()),
      api(`/v2/students/${studentId}/profile-status`).then(response => response.json()).then(result => result.profile),
      api(`/v2/admin/task-status?studentId=${encodeURIComponent(studentId)}`).then(response => response.json()),
    ]);
    if (selectedIdRef.current !== studentId) return;
    setGrants(result.grants);
    setV2Grants(v2Result.grants);
    setCloudProfile(profileResult);
    setRemoteOperations(remoteResult);
    setStorage(capacity);
  }
  async function loadAudit(studentId = selectedId, cursor = '') {
    if (!studentId) return;
    const params = new URLSearchParams({ studentId });
    if (cursor) params.set('cursor', cursor);
    const result = await (await api(`/v1/audit-events?${params}`)).json();
    if (selectedIdRef.current !== studentId) return;
    setAuditEvents(current => cursor ? [...current, ...result.events] : result.events);
    setAuditCursor(result.nextCursor || '');
  }
  useEffect(() => { if (token) void loadStudents().catch(error => setMessage((error as Error).message)); }, [token]);
  useEffect(() => { setPreview(''); setPdfUrl(''); if (token && selectedId) void loadItems().catch(error => setMessage((error as Error).message)); }, [token, selectedId, tab, trash]);
  useEffect(() => { setStorage(null); setGrants([]); if (token && selectedId) void loadGrants(selectedId).catch(error => setMessage((error as Error).message)); }, [token, selectedId]);
  const filteredReports = useMemo(() => reports.filter(item =>
    (type === 'all' || item.reportType === type)
    && (source === 'all' || item.originPlatform === source)
    && (!date || item.publishedAt.slice(0, 10) === date)
    && `${names[item.reportType] || item.filename} ${item.filename}`.includes(search.trim())), [reports, search, type, source, date]);
  const selectedReport = reports.find(item => item.revisionId === selectedReportId);
  const filteredDocuments = useMemo(() => documents.filter(item => item.displayName.includes(search.trim())), [documents, search]);

  async function download(route: string, filename: string, showPreview = false) {
    const response = await api(route);
    const blob = await response.blob();
    if (showPreview && blob.type === 'application/pdf') { setPdfUrl(URL.createObjectURL(blob)); return; }
    if (showPreview && blob.type.startsWith('text/')) setPreview(await blob.text());
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  async function renameDocument(item: Document) {
    const name = window.prompt('新的文档名称', item.displayName)?.trim();
    if (!name || name === item.displayName) return;
    await api(`/v1/documents/${item.documentId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: name }) });
    await loadItems();
    setMessage('文档已重命名。');
  }

  if (!token) return <main className="login-screen"><section className="login-box">
    <h1>云端文档</h1><p>本地试点管理入口。输入当前管理员凭据（首次使用启动配置值）；凭据不会保存在浏览器中。</p>
    <form onSubmit={event => { event.preventDefault(); void act(async () => {
      const response = await fetch(serviceUrl('/v1/admin/sessions'), { method: 'POST', cache: 'no-store',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: draftToken.trim() }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `登录失败（HTTP ${response.status}）`);
      setDraftToken(''); setToken(result.sessionToken);
    }); }}><label>管理员凭据<input type="password" value={draftToken} onChange={event => setDraftToken(event.target.value)} autoComplete="off" required /></label>
      <button disabled={busy}>进入管理页</button></form>{message && <p role="alert" className="error">{message}</p>}
  </section></main>;

  return <div className="app-shell">
    <header className="topbar"><h1>云端文档</h1><button onClick={() => {
      const current = token; setToken('');
      setPdfUrl('');
      void fetch(serviceUrl('/v1/admin/sessions/current'), { method: 'DELETE', headers: { authorization: `Bearer ${current}` }, cache: 'no-store' }).catch(() => setMessage('本页已退出；服务器会话将在到期后失效。'));
    }}>退出管理</button><button disabled={busy} onClick={() => setCredentialForm(current => !current)}>更换管理凭据</button></header>
    {credentialForm && <form className="permission-panel" onSubmit={event => { event.preventDefault(); void act(async () => {
      await api('/v1/admin/credential', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ oldCredential, newCredential }) });
      setOldCredential(''); setNewCredential(''); setCredentialForm(false);
      setToken(''); setPdfUrl(''); setMessage('管理员凭据已更换，请使用新凭据登录。');
    }); }}><label>当前凭据<input type="password" autoComplete="current-password" value={oldCredential} onChange={event => setOldCredential(event.target.value)} required /></label>
      <label>新凭据（24–256 字符）<input type="password" autoComplete="new-password" minLength={24} maxLength={256} value={newCredential} onChange={event => setNewCredential(event.target.value)} required /></label>
      <p>成功后所有管理会话失效，需要重新登录。</p><button disabled={busy}>确认更换</button></form>}
    <details className="permission-panel" onToggle={event => { if (event.currentTarget.open) void act(async () => setOperations(await (await api('/v1/operations')).json())); }}>
      <summary>服务器备份与存储状态</summary>{operations && <p>
        可用磁盘 {Math.floor(operations.storage.freeBytes / 1024 / 1024)} MiB{operations.storage.warning ? ' · 警告：剩余空间不足' : ''}；
        自动备份{operations.backup.enabled ? '已启用' : '未启用'}。
        {operations.backup.lastSuccessAt ? `最近成功：${new Date(operations.backup.lastSuccessAt).toLocaleString('zh-CN')}` : ''}
        {operations.backup.lastError || ''}</p>}
    </details>
    <div className="workspace">
      <aside className="student-sidebar"><div className="sidebar-title"><strong>学生</strong><span>{students.length}</span></div>
        {students.map(student => <button className={student.id === selectedId ? 'selected' : ''} key={student.id} onClick={() => { selectedIdRef.current = student.id; setSelectedId(student.id); setReports([]); setDocuments([]); setGrants([]); setV2Grants([]); setCloudProfile(null); setAuditEvents([]); setAuditCursor(''); setSelectedReportId(''); setEnrollmentCode(''); setPairingCode(''); }}>{student.displayName}</button>)}
        <form className="add-student" onSubmit={event => { event.preventDefault(); void act(async () => {
          const result = await (await api('/v1/students', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: newName }) })).json();
          setNewName(''); await loadStudents(); setSelectedId(result.id);
        }); }}><label>添加学生<input value={newName} onChange={event => setNewName(event.target.value)} placeholder="学生显示名" required /></label><button disabled={busy}>添加</button></form>
      </aside>
      <main className="content">
        {message && <div className="notice" role="status">{message}</div>}
        {selected ? <>
          <div className="student-heading"><div><h2>{selected.displayName}</h2><p>报告来源与修订独立保存，下载许可按学生管理。</p>
            {storage && <small>已用 {(storage.usedBytes / 1024 / 1024).toFixed(1)} / {(storage.maxBytes / 1024 / 1024).toFixed(0)} MiB（含历史与回收站）</small>}</div>
            <button className="outline" disabled={busy} onClick={() => void act(async () => {
              const result = await (await api('/v1/source-enrollments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cloudStudentId: selectedId }) })).json();
              setEnrollmentCode(result.enrollmentCode);
            })}>生成来源端开通码</button></div>
          {enrollmentCode && <div className="enrollment-code"><span>在 Android 单机版或 Windows 主机输入此码，为当前学生开通自动上传</span><strong>{enrollmentCode}</strong><button onClick={() => { void navigator.clipboard.writeText(enrollmentCode); setMessage('开通码已复制。'); }}>复制</button></div>}
          <details className="permission-panel"><summary>Windows主机下载许可</summary>
            <p>由接收 Windows 主机出示 8 位配对码。确认后，该主机一年内只能下载下方勾选的学生基础信息和材料；健康资料不会随此许可开放。</p>
            <fieldset className="scope-options"><legend>允许下载的学生基础信息</legend>{profileFieldOptions.map(([id, label]) => <label key={id}>
              <input type="checkbox" checked={downloadProfileFields.includes(id)} disabled={id === 'displayName'} onChange={event => setDownloadProfileFields(current => event.target.checked ? [...new Set([...current, id])] : current.filter(item => item !== id))} />{label}{id === 'displayName' ? '（建档必需）' : ''}
            </label>)}</fieldset>
            <fieldset className="scope-options"><legend>允许下载的材料</legend>{materialCategoryOptions.map(([id, label]) => <label key={id}>
              <input type="checkbox" checked={downloadCategories.includes(id)} onChange={event => setDownloadCategories(current => event.target.checked ? [...new Set([...current, id])] : current.filter(item => item !== id))} />{label}
            </label>)}</fieldset>
            <form onSubmit={event => { event.preventDefault(); void act(async () => {
              await api('/v1/pairings/approve', { method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ pairingCode: pairingCode.trim(), cloudStudentIds: [selectedId], contractVersion: 2,
                  profileFields: downloadProfileFields, materialCategories: downloadCategories }) });
              setPairingCode(''); await loadGrants(); setMessage('已为这台 Windows 主机开通当前学生的下载许可。');
            }); }}><input aria-label="Windows 主机配对码" inputMode="numeric" pattern="[0-9]{8}" maxLength={8}
              placeholder="输入 Windows 主机出示的 8 位配对码" value={pairingCode} onChange={event => setPairingCode(event.target.value)} required />
              <button disabled={busy || !/^\d{8}$/.test(pairingCode)}>确认许可</button></form>
            <div className="grant-list"><strong>已开通的接收设备</strong>
              {grants.filter(item => item.kind === 'viewer' && item.scope === 'cloud_document.read' && item.revokedAt === null && (item.expiresAt == null || item.expiresAt > Date.now()))
                .map(item => <div key={item.deviceId}><span title={item.deviceId}>Windows 主机 · {item.deviceId.slice(-8)} · {item.expiresAt ? `有效至 ${new Date(item.expiresAt).toLocaleDateString('zh-CN')}` : '旧服务未返回期限，需重启试点服务'}</span>
                  <button disabled={busy} onClick={() => { if (!window.confirm('撤销后这台 Windows 将无法继续读取此学生的云端文档；已下载的本机副本不会自动删除。确定撤销？')) return;
                    void act(async () => { await api('/v1/grants/revoke', { method: 'POST', headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ deviceId: item.deviceId, cloudStudentId: selectedId, scope: 'cloud_document.read' }) });
                      await loadGrants(); setMessage('下载许可已撤销。'); }); }}>撤销许可</button></div>)}
              {!grants.some(item => item.kind === 'viewer' && item.scope === 'cloud_document.read' && item.revokedAt === null && (item.expiresAt == null || item.expiresAt > Date.now())) && <p>尚无有效的接收设备许可。</p>}
            </div>
            <div className="grant-list"><strong>新版资料授权</strong>
              {v2Grants.filter(item => item.revokedAt === null && item.scope.endsWith('.read')).map(item => <div key={`${item.deviceId}:${item.scope}:${item.category}`}>
                <span title={item.deviceId}>Windows 主机 · {item.deviceId.slice(-8)} · {item.scope === 'student_profile.read' ? `基础信息 ${item.fields.length} 项` : materialCategoryOptions.find(([id]) => id === item.category)?.[1] || item.category}</span>
                <button disabled={busy} onClick={() => { if (!window.confirm('撤销这项新版资料许可？已合法下载的本机副本不会自动删除。')) return; void act(async () => {
                  await api('/v2/grants/revoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId: item.deviceId,
                    cloudStudentId: selectedId, scope: item.scope, category: item.category }) }); await loadGrants(); setMessage('新版资料许可已撤销。');
                }); }}>撤销</button></div>)}
              {!v2Grants.some(item => item.revokedAt === null && item.scope.endsWith('.read')) && <p>尚无新版资料授权。</p>}
            </div>
          </details>
          <details className="permission-panel"><summary>已同步的学生基础信息</summary>
            {cloudProfile ? <><p>当前版本：{cloudProfile.profileRevisionId.slice(-8)} · {new Date(cloudProfile.updatedAt).toLocaleString('zh-CN')}</p>
              <dl className="profile-grid">{profileFieldOptions.filter(([id]) => cloudProfile.fields.includes(id)).map(([id, label]) => <React.Fragment key={id}><dt>{label}</dt><dd>{cloudProfile.profile[id]}</dd></React.Fragment>)}</dl></>
              : <p>尚未收到新版学生基础信息。旧版报告上传不代表基础信息已经同步。</p>}
            <p>健康资料采用独立逐项许可，本页不会默认开放。</p>
          </details>
          <details className="permission-panel"><summary>云端成果收件箱与远程任务</summary>
            <p>这里显示云端的处理状态，不会把“结果未知”自动当作失败重跑。</p>
            <div className="grant-list"><strong>远程 Agent 任务</strong>{remoteOperations.sessions.map(item => <div key={item.sessionId}>
              <span>{item.provider === 'codex' ? 'Codex' : 'WorkBuddy'} · {item.taskType || '任务'} · {item.status} · {new Date(item.updatedAt).toLocaleString('zh-CN')}</span>
            </div>)}{remoteOperations.sessions.length === 0 && <p>当前学生没有远程 Agent 任务。</p>}</div>
            <div className="grant-list"><strong>成果收件箱</strong>{remoteOperations.inbox.map(item => <div key={item.submissionId}>
              <span>{item.provider === 'codex' ? 'Codex' : 'WorkBuddy'} · {item.status} · {new Date(item.updatedAt).toLocaleString('zh-CN')}{item.quarantinedReason ? ` · ${item.quarantinedReason}` : ''}</span>
            </div>)}{remoteOperations.inbox.length === 0 && <p>当前学生没有待接收成果。</p>}</div>
          </details>
          <details className="permission-panel"><summary>来源设备安全管理</summary><p>撤销设备会终止该设备所有学生的云端许可。恢复须使用管理员重新签发的开通码。</p>
            {grants.filter(item => item.kind === 'source' && item.revokedAt === null).map(item => <div key={item.deviceId}>
              <span>来源设备 · {item.deviceId.slice(-8)}</span><button disabled={busy} onClick={() => {
                if (!window.confirm('撤销此来源设备全部云端许可？本机报告不受影响。')) return;
                void act(async () => { await api('/v1/devices/revoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId: item.deviceId }) }); await loadGrants(); });
              }}>撤销设备</button></div>)}
          </details>
          <details className="permission-panel" onToggle={event => {
            if (event.currentTarget.open) void act(() => loadAudit());
          }}><summary>操作记录</summary>
            <p>仅记录操作时间、设备标识和对象标识；不记录管理员凭据、设备令牌或文档正文。</p>
            <button className="outline" disabled={busy} onClick={() => void act(() => loadAudit())}>刷新记录</button>
            <div className="grant-list">{auditEvents.map(item => <div key={item.id}>
              <span>{new Date(item.occurredAt).toLocaleString('zh-CN')} · {auditNames[item.action] || item.action}</span>
              <small title={item.actorId}>{item.actorId === 'admin_local' ? '管理员' : `设备 ${item.actorId.slice(-8)}`}{item.targetId ? ` · 对象 ${item.targetId.slice(-8)}` : ''}</small>
            </div>)}{auditEvents.length === 0 && <p>暂无操作记录。</p>}</div>
            {auditCursor && <button className="outline" disabled={busy} onClick={() => void act(() => loadAudit(selectedId, auditCursor))}>加载更早记录</button>}
          </details>
          <div className="tabs"><button className={tab === 'reports' ? 'active' : ''} onClick={() => { setTab('reports'); setSearch(''); }}>学情报告</button>
            <button className={tab === 'documents' ? 'active' : ''} onClick={() => { setTab('documents'); setSearch(''); }}>其他文档</button></div>
          <p role="status">当前学生：{selected?.displayName} · 已载入学情报告 {reports.length} 份、其他文档 {documents.filter(item => !item.deletedAt).length} 份。报告与分享摘要分别存放，开启授权不等于完成上传。</p>
          <button className="outline" disabled={busy} onClick={() => { setSearch(''); setType('all'); setSource('all'); setDate(''); setTrash(false); void act(() => loadItems()); }}>清空筛选并重新核对</button>
          <div className="toolbar"><input aria-label="搜索文件名称" placeholder="搜索文件名称" value={search} onChange={event => setSearch(event.target.value)} />
            {tab === 'reports' ? <select aria-label="报告类型" value={type} onChange={event => setType(event.target.value)}><option value="all">全部报告类型</option>
              {Object.entries(names).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select> : <label className="trash-toggle"><input type="checkbox" checked={trash} onChange={event => setTrash(event.target.checked)} />{trash ? '回收站' : '查看回收站'}</label>}
            {tab === 'reports' && <><select aria-label="报告来源" value={source} onChange={event => setSource(event.target.value)}><option value="all">全部来源</option><option value="android">Android</option><option value="windows">Windows</option></select>
              <input aria-label="生成日期" type="date" value={date} onChange={event => setDate(event.target.value)} /></>}
            <button className="outline" disabled={busy} onClick={() => void act(() => loadItems())}>刷新</button>
            {tab === 'documents' && !trash && <label className="upload-button">上传文档<input type="file" accept=".md,.pdf,.docx" onChange={event => { const file = event.target.files?.[0]; if (!file) return; void act(async () => {
              const contentType = file.name.endsWith('.md') ? 'text/markdown' : file.name.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
              await api(`/v1/students/${selectedId}/documents`, { method: 'POST', headers: { 'content-type': contentType, 'x-document-name': encodeURIComponent(file.name) }, body: file });
              await loadItems(); setMessage('文档已上传。'); event.target.value = '';
            }); }} /></label>}
          </div>
          <div className={tab === 'reports' ? 'report-workarea' : ''}><div className="table-scroll"><table><thead><tr><th>文档名称</th><th>{tab === 'reports' ? '报告类型' : '文件类型'}</th><th>{tab === 'reports' ? '来源' : '大小'}</th><th>{tab === 'reports' ? '生成时间' : '上传时间'}</th>{tab === 'reports' && <th>版本</th>}<th>操作</th></tr></thead><tbody>
            {tab === 'reports' ? filteredReports.map(item => <tr key={item.revisionId}><td><button className="row-select" onClick={() => setSelectedReportId(item.revisionId)}>{names[item.reportType] || item.filename}</button></td><td>{names[item.reportType] || item.reportType}</td>
              <td>{item.originPlatform === 'windows' ? 'Windows' : 'Android'}</td><td>{item.publishedAt}</td><td>{item.revisionId.slice(-8)}</td><td>
                <button className="text-button" disabled={busy} onClick={() => void act(() => download(`/v1/reports/${item.revisionId}/content`, item.filename, true))}>下载 / 查看</button></td></tr>)
              : filteredDocuments.map(item => <tr key={item.documentId}><td>{item.displayName}</td><td>{item.contentType.split('/').pop()}</td><td>{Math.ceil(item.byteSize / 1024)} KB</td>
                <td>{new Date(item.createdAt).toLocaleDateString('zh-CN')}</td><td>{trash ? <button className="text-button" disabled={busy} onClick={() => void act(async () => {
                  await api(`/v1/documents/${item.documentId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deleted: false }) }); await loadItems();
                })}>恢复</button> : <><button className="text-button" disabled={busy} onClick={() => void act(() => download(`/v1/documents/${item.documentId}/content`, item.displayName, item.contentType === 'text/markdown'))}>下载</button>
                  {item.contentType === 'application/pdf' && <button className="text-button" disabled={busy} onClick={() => void act(() => download(`/v1/documents/${item.documentId}/content`, item.displayName, true))}>预览 PDF</button>}
                  <button className="text-button" disabled={busy} onClick={() => void act(() => renameDocument(item))}>重命名</button>
                  <button className="text-button muted" disabled={busy} onClick={() => void act(async () => {
                    await api(`/v1/documents/${item.documentId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deleted: true }) }); await loadItems();
                  })}>移入回收站</button></>}</td></tr>)}
          </tbody></table>{(tab === 'reports' ? filteredReports.length : filteredDocuments.length) === 0 && <p className="empty">当前没有符合条件的文档。</p>}</div>
          <div className="mobile-items">
            {tab === 'reports' ? filteredReports.map(item => <article key={item.revisionId}>
              <button className="row-select" onClick={() => setSelectedReportId(item.revisionId)}>{names[item.reportType] || item.filename}</button>
              <p>{names[item.reportType] || item.reportType} · {item.originPlatform === 'windows' ? 'Windows' : 'Android'}</p>
              <small>{item.publishedAt} · {item.revisionId.slice(-8)}</small>
              <button className="text-button" disabled={busy} onClick={() => void act(() => download(`/v1/reports/${item.revisionId}/content`, item.filename, true))}>下载</button>
            </article>) : filteredDocuments.map(item => <article key={item.documentId}>
              <strong>{item.displayName}</strong><p>{item.contentType.split('/').pop()} · {Math.ceil(item.byteSize / 1024)} KB</p>
              <small>{new Date(item.createdAt).toLocaleDateString('zh-CN')}</small>
              {trash ? <button className="text-button" disabled={busy} onClick={() => void act(async () => {
                await api(`/v1/documents/${item.documentId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deleted: false }) }); await loadItems();
              })}>恢复</button> : <><button className="text-button" disabled={busy} onClick={() => void act(() => download(`/v1/documents/${item.documentId}/content`, item.displayName, item.contentType === 'text/markdown'))}>下载</button>
                {item.contentType === 'application/pdf' && <button className="text-button" disabled={busy} onClick={() => void act(() => download(`/v1/documents/${item.documentId}/content`, item.displayName, true))}>预览 PDF</button>}
                <button className="text-button" disabled={busy} onClick={() => void act(() => renameDocument(item))}>重命名</button>
                <button className="text-button muted" disabled={busy} onClick={() => void act(async () => {
                  await api(`/v1/documents/${item.documentId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deleted: true }) }); await loadItems();
                })}>移入回收站</button></>}
            </article>)}
            {(tab === 'reports' ? filteredReports.length : filteredDocuments.length) === 0 && <p className="empty">当前没有符合条件的文档。</p>}
          </div>
          {tab === 'reports' && <aside className="report-detail"><h3>文档详情</h3>{selectedReport ? <>
            <strong>{names[selectedReport.reportType] || selectedReport.filename}</strong>
            <dl><dt>报告类型</dt><dd>{names[selectedReport.reportType] || selectedReport.reportType}</dd>
              <dt>来源</dt><dd>{selectedReport.originPlatform === 'windows' ? 'Windows' : 'Android'}</dd>
              <dt>生成时间</dt><dd>{selectedReport.publishedAt}</dd>
              <dt>版本</dt><dd>{selectedReport.revisionId.slice(-8)}</dd></dl>
            <button className="outline" disabled={busy} onClick={() => void act(() => download(`/v1/reports/${selectedReport.revisionId}/content`, selectedReport.filename, true))}>下载报告</button>
            <button className="outline" disabled={busy} onClick={() => {
              if (!window.confirm('撤回此云端修订？本机原件和已下载副本不受影响；此修订以后不能再次上传。')) return;
              void act(async () => { await api(`/v1/reports/${selectedReport.revisionId}`, { method: 'DELETE' }); setSelectedReportId(''); setPreview(''); await loadItems(); });
            }}>撤回云端修订</button>
          </> : <p>选择一份报告查看来源和修订信息。</p>}</aside>}
          </div>
          {tab === 'reports' && nextCursor && <button className="outline load-more" disabled={busy} onClick={() => void act(() => loadItems(selectedId, 'reports', false, nextCursor))}>加载更多历史修订</button>}
          {preview && <details className="preview" open><summary>Markdown 预览</summary><pre>{preview}</pre></details>}
          {tab === 'documents' && documentCursor && <button disabled={busy} onClick={() => void act(() => loadItems(selectedId, 'documents', trash, documentCursor))}>加载更多文档</button>}
          {pdfUrl && <section className="preview"><button onClick={() => setPdfUrl('')}>关闭 PDF 预览</button>
            <p>由浏览器内置 PDF 阅读器显示；若设备不支持预览，请使用文档行的“下载”。</p>
            {/* Only an authenticated application/pdf Blob is allowed here. An iframe sandbox blocks Chromium's native PDF reader. */}
            <iframe className="pdf-preview" title="PDF 只读预览" referrerPolicy="no-referrer" src={pdfUrl} />
          </section>}
        </> : <p className="empty">请先添加或选择学生。</p>}
      </main>
    </div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
