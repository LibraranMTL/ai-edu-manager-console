import React, { useEffect, useRef, useState } from 'react';
import type { AgentControlApi } from './GlobalAgentControlCenter';
import './ExternalAgentConnector.css';

type Restrictions = { excludedStudentIds: string[]; excludedProjectIds: string[]; disabledPermissions: string[]; expiresAt: string; requireWriteConfirmation: boolean };
type Policy = { status: string; preset: string; accessMode?: 'session_bound' | 'all_authorized_students'; paused: boolean; revision: number; inheritForNewStudents: boolean; inheritForNewConnections: boolean; restrictions: Restrictions };
type Connection = { connectionId: string; label: string; hostType: string; status: string; restrictions: Restrictions };
type Session = { connectionId: string; sessionId: string; accessMode?: string; studentId: string; defaultProjectId: string; contextRevision: number };
type Operation = { id: string; name: string; status: string; studentId: string; projectId: string; inputDigest: string; processing?: { saved: boolean; digest: string; index: string; message?: string } };
type Snapshot = { policy: Policy; installedHosts?: Record<string, { status: string; connectionId: string; message?: string; verifiedAt?: string; configurationStatus?: string }>; permissions: { id: string; label: string }[]; presets: Record<string, string[]>; connections: Connection[]; sessions: Session[]; students: { id: string; name: string }[]; projects: { id: string; name: string; studentIds: string[]; status: string }[]; operations: Operation[] };
type Run = (action: string, input?: Record<string, unknown>) => Promise<void>;
const labels: Record<string, string> = { unconfigured: '尚未授权', active: '已启用', revoked: '已撤销', disabled: '已停用', completed: '已完成', pending_approval: '待确认', approved: '已批准，等待恢复执行', executing: '正在保存', recoverable: '可恢复', pending: '待消化', processing: '处理中', not_started: '尚未开始', unverified: '待检索验证', registered: '知识已登记，待检索验证', query_verified: '已验证检索命中', no_evidence: '本次未命中新知识', unavailable: '查询暂不可用', not_applicable: '不适用', processed: '已消化' };

function HostConnectionRow({ host, snapshot, busy, dirty, run }: { host: 'codex' | 'workbuddy'; snapshot: Snapshot; busy: boolean; dirty: boolean; run: Run }) {
  const name = host === 'codex' ? 'Codex' : 'WorkBuddy', installed = snapshot.installedHosts?.[host];
  const connection = snapshot.connections.find(c => c.connectionId === installed?.connectionId);
  const removed = !installed || ['uninstalled', 'uninstall_pending'].includes(installed.status);
  const enabled = !busy && !dirty && snapshot.policy.status === 'active' && !snapshot.policy.paused;
  const status = installed?.configurationStatus === 'configuration_conflict' ? '配置冲突，请先处理重复项' : installed?.configurationStatus === 'repair_required' ? '配置缺失或变化，请修复' : installed?.status === 'uninstalled' ? '已卸载并撤权' : installed?.status === 'uninstall_pending' ? '授权已撤销，配置移除待完成' : installed?.connectionId && !connection ? '凭据记录已删除，重新安装需确认' : connection?.status === 'revoked' ? '凭据已撤销，重新安装需确认' : connection?.status === 'disabled' ? '连接已停用' : installed?.status === 'bridge_verified' ? '本机通道已验证；Agent 新会话调用待验收' : installed?.status === 'verification_failed' ? '配置已安装，验证未通过' : installed ? '安装待完成或待验证' : '尚未安装统一连接';
  const confirm = (action: string, message: string) => { if (window.confirm(message)) void run(action, { hostType: host, confirmed: true }); };
  return <article className="agent-policy" aria-label={`${name} 连接管理`}><strong>{name}</strong><p>{status}</p>
    {installed?.message && <p>{installed.message}</p>}
    {installed?.verifiedAt && <small>上次本机验证：{new Date(installed.verifiedAt).toLocaleString()}</small>}
    <div className="actions">
      <button disabled={!enabled} onClick={() => confirm('installHost', `按已保存的授权安装或升级 ${name} 的 edu-manager-knowledge？自动备份受管配置，保留其他 MCP；停止旧活动学生采集。`)}>{removed ? '一键安装' : '安装 / 升级'}</button>
      <button disabled={!enabled || removed || connection?.status !== 'active'} onClick={() => void run('verifyInstalled', { hostType: host })}>验证连接</button>
      <button disabled={!enabled || removed} onClick={() => confirm('repairInstalled', `修复 ${name} 的连接路径和受管配置？保留原有授权限制；丢失的凭据会先撤销再重新生成。`)}>修复连接</button>
      <button disabled={busy || !installed || installed.status === 'uninstalled'} onClick={() => confirm('uninstallInstalled', `卸载 ${name} 的教育管家连接并立即撤销此 Agent 的全部 R21 凭据？保留学生资料、其他 Agent 和配置备份。`)}>卸载并撤权</button>
    </div></article>;
}

function RestrictionEditor({ value, onChange, snapshot, busy }: { value: Restrictions; onChange: (v: Restrictions) => void; snapshot: Snapshot; busy: boolean }) {
  const toggle = (key: 'excludedStudentIds' | 'excludedProjectIds' | 'disabledPermissions', id: string, checked: boolean) => onChange({ ...value, [key]: checked ? [...new Set([...value[key], id])] : value[key].filter(x => x !== id) });
  return <fieldset disabled={busy}><legend>减权例外</legend>
    <label><input type="checkbox" checked={value.requireWriteConfirmation} onChange={e => onChange({ ...value, requireWriteConfirmation: e.target.checked })} />每次写入前确认（默认关闭）</label>
    <label>授权到期时间<input aria-label="授权到期时间" type="datetime-local" value={value.expiresAt ? new Date(Date.parse(value.expiresAt) - new Date(value.expiresAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''} onChange={e => onChange({ ...value, expiresAt: e.target.value ? new Date(e.target.value).toISOString() : '' })} /></label>
    <details><summary>排除学生和项目</summary>{snapshot.students.map(s => <label key={s.id}><input type="checkbox" checked={value.excludedStudentIds.includes(s.id)} onChange={e => toggle('excludedStudentIds', s.id, e.target.checked)} />排除学生：{s.name}</label>)}{snapshot.projects.map(p => <label key={p.id}><input type="checkbox" checked={value.excludedProjectIds.includes(p.id)} onChange={e => toggle('excludedProjectIds', p.id, e.target.checked)} />排除项目：{p.name}</label>)}</details>
    <details><summary>13 项能力（勾选表示禁用）</summary>{snapshot.permissions.map(p => <label key={p.id}><input type="checkbox" checked={value.disabledPermissions.includes(p.id)} onChange={e => toggle('disabledPermissions', p.id, e.target.checked)} />禁用 {p.label}{!snapshot.presets[snapshot.policy.preset].includes(p.id) ? '（当前档位未开放）' : ''}</label>)}</details>
  </fieldset>;
}
function ConnectionRow({ connection, snapshot, busy, run }: { connection: Connection; snapshot: Snapshot; busy: boolean; run: Run }) {
  const [limits, setLimits] = useState(connection.restrictions);
  return <article className="agent-policy" aria-label={`${connection.label} 凭据记录`}><strong>{connection.label}</strong> · {connection.hostType} · 凭据{labels[connection.status] || connection.status}（不代表已安装或验证）
    <div className="actions"><button disabled={busy || connection.status === 'revoked'} onClick={() => void run('connection', { connectionId: connection.connectionId, status: connection.status === 'active' ? 'disabled' : 'active' })}>{connection.status === 'active' ? '停用连接' : '启用连接'}</button>
      <button disabled={busy || connection.status === 'revoked'} onClick={() => { if (window.confirm('撤销此连接后旧凭据永久失效，需要重新建立连接。继续？')) void run('connection', { connectionId: connection.connectionId, status: 'revoked' }); }}>撤销连接</button>
      {connection.status === 'revoked' && <button disabled={busy} onClick={() => { if (window.confirm('删除这条已撤销连接及其会话绑定？旧凭据不会恢复，学生资料、写入回执和审计记录保留。此操作不会移除 Agent 中的 MCP 配置。')) void run('deleteConnection', { connectionId: connection.connectionId, confirmed: true }); }}>删除记录</button>}</div>
    <details><summary>此连接的高级限制</summary><RestrictionEditor value={limits} onChange={setLimits} snapshot={snapshot} busy={busy || connection.status === 'revoked'} /><button disabled={busy || connection.status === 'revoked'} onClick={() => void run('connection', { connectionId: connection.connectionId, status: connection.status, restrictions: limits })}>保存连接限制</button></details>
  </article>;
}
function SessionRow({ session, snapshot, busy, run }: { session: Session; snapshot: Snapshot; busy: boolean; run: Run }) {
  const [studentId, setStudent] = useState(session.studentId), [projectId, setProject] = useState(session.defaultProjectId);
  if (session.accessMode === 'all_authorized_students') return <article className="agent-policy"><strong>{snapshot.connections.find(c => c.connectionId === session.connectionId)?.label}</strong><p>会话 {session.sessionId} · 第 {session.contextRevision} 代 · 全部授权学生</p><p>查询按学生分组，每项写入明确目标学生；不自动归档混合对话。切换主界面学生不改变此范围。</p></article>;
  const connectionLimits = snapshot.connections.find(c => c.connectionId === session.connectionId)?.restrictions;
  const students = snapshot.students.filter(s => !snapshot.policy.restrictions.excludedStudentIds.includes(s.id) && !connectionLimits?.excludedStudentIds.includes(s.id));
  return <article className="agent-policy"><strong>{snapshot.connections.find(c => c.connectionId === session.connectionId)?.label}</strong><p>会话 {session.sessionId} · 第 {session.contextRevision} 代 · {session.studentId ? snapshot.students.find(s => s.id === session.studentId)?.name || '原学生已不可用' : '等待首次选择'}</p>
    <div className="form-grid"><label>归属学生<select aria-label={`归属学生 ${session.sessionId}`} value={studentId} disabled={busy} onChange={e => { setStudent(e.target.value); setProject(''); }}><option value="">请选择学生</option>{students.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
    <label>默认写入目标<select aria-label={`默认写入目标 ${session.sessionId}`} value={projectId} disabled={busy} onChange={e => setProject(e.target.value)}><option value="">该学生的资料库</option>{snapshot.projects.filter(p => p.studentIds.length === 1 && p.studentIds[0] === studentId && !['sealed', 'archived'].includes(p.status)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
    <button disabled={busy || !studentId} onClick={() => void run('bindSession', { connectionId: session.connectionId, sessionId: session.sessionId, contextRevision: session.contextRevision, studentId, projectId, confirmed: true })}>{session.studentId ? '确认切换归属（不改变在途任务）' : '确认本会话归属'}</button>
  </article>;
}
function WriteRow({ operation: o, snapshot, busy, run, api }: { operation: Operation; snapshot: Snapshot; busy: boolean; run: Run; api: AgentControlApi }) {
  const [preview, setPreview] = useState(''), [error, setError] = useState(''), [question, setQuestion] = useState('');
  async function inspect() {
    try { const r = JSON.parse(await api.agentControlAction!('external:readWrite', { intentId: o.id })); if (!r.ok) throw Error(r.message); setPreview(JSON.stringify(r.data.preview, null, 2)); } catch (e) { setError((e as Error).message); }
  }
  return <article className="agent-policy"><strong>{o.name}</strong> · {labels[o.status] || o.status}<p>{snapshot.students.find(s => s.id === o.studentId)?.name || o.studentId} / {snapshot.projects.find(p => p.id === o.projectId)?.name || '学生资料库'}</p>
    {o.processing && <p>保存：{o.processing.saved ? '已保存' : '未保存'} · 消化：{labels[o.processing.digest] || o.processing.digest} · 索引：{labels[o.processing.index] || o.processing.index}<br />{o.processing.message}</p>}
    {o.status === 'pending_approval' && <><button disabled={busy} onClick={() => void inspect()}>查看待确认内容</button>{preview && <><pre style={{ whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto' }}>{preview}</pre><button disabled={busy} onClick={() => void run('reviewWrite', { intentId: o.id, inputDigest: o.inputDigest, decision: 'approve' })}>确认批准此项</button></>}<button disabled={busy} onClick={() => void run('reviewWrite', { intentId: o.id, inputDigest: o.inputDigest, decision: 'reject' })}>拒绝并清除待写内容</button></>}
    {['recoverable', 'approved', 'executing'].includes(o.status) && <button disabled={busy} onClick={() => void run('execute', { intentId: o.id })}>恢复同一写入</button>}
    {o.status === 'completed' && ['material.upload', 'conversation.submit'].includes(o.name) && <><button disabled={busy} onClick={() => void run('retryProcessing', { intentId: o.id })}>恢复后续处理（不重复保存）</button><label>检索验证问题<input value={question} maxLength={2000} onChange={e => setQuestion(e.target.value)} placeholder="输入能够检验新增知识的问题" /></label><button disabled={busy || !question.trim()} onClick={() => void run('verifyIndex', { intentId: o.id, question })}>验证新知识是否可查询</button></>}
    {error && <p role="alert">{error}</p>}<small>{o.id}</small></article>;
}
export default function ExternalAgentConnector({ api }: { api: AgentControlApi }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [draft, setDraft] = useState<Policy | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [hostType, setHostType] = useState('workbuddy'), [label, setLabel] = useState(''), [configPath, setConfigPath] = useState('');
  const active = useRef(false), generation = useRef(0);
  async function call(action: string, input: Record<string, unknown> = {}) {
    if (!api.agentControlAction) throw Error('请使用更新后的 Windows 主机');
    const r = JSON.parse(await api.agentControlAction(`external:${action}`, input));
    if (!r.ok || r.data?.ok === false) throw Error(r.message || r.data?.message || '操作未完成'); return r.data;
  }
  useEffect(() => { const ticket = ++generation.current; void call('snapshot').then(s => { if (generation.current === ticket) { setSnapshot(s); setDraft(s.policy); } }).catch(e => { if (generation.current === ticket) setMessage(e.message); }); return () => { generation.current++; }; }, []);
  const run: Run = async (action, input = {}) => {
    if (active.current) return; active.current = true; setBusy(true); const ticket = generation.current;
    setMessage(['installHost', 'repairInstalled', 'upgradeInstalled', 'verifyInstalled'].includes(action) ? '正在处理连接并验证本机 MCP，请稍候…' : '正在处理…');
    try { const result = await call(action, input), fresh = await call('snapshot'); if (ticket !== generation.current) return;
      setSnapshot(fresh); setDraft(fresh.policy); setMessage(result.message || '状态已刷新'); if (result.configPath) setConfigPath(result.configPath);
    } catch (e) { if (ticket === generation.current) { setMessage((e as Error).message); try { const fresh = await call('snapshot'); if (ticket === generation.current) { setSnapshot(fresh); setDraft(fresh.policy); } } catch { /* Keep the original actionable error. */ } } } finally { active.current = false; setBusy(false); }
  };
  return <section className="external-agent-connector" aria-label="外部 Agent 连接器">
    <div className="panel-heading"><div><h3>外部 Agent 连接器 · R21</h3><p>让外部 Agent 查询教育管家、保存会话和成果。与“AI 接入与调度中心”中的管家调用 Agent 独立授权。</p></div><button disabled={busy} onClick={() => void run('snapshot')}>刷新外部连接</button></div>
    {message && <p role="status">{message}</p>}
    {!snapshot || !draft ? <p>正在读取外部连接授权…</p> : <>
      <p>状态：{draft.paused ? '已暂停' : labels[draft.status]} · 当前档位 {snapshot.presets[draft.preset].length} 项能力</p>
      <label>一次性授权范围<select aria-label="外部连接授权档位" value={draft.preset} disabled={busy} onChange={e => setDraft({ ...draft, preset: e.target.value })}><option value="read">只读查询 · 6 项</option><option value="read_memory">查询与会话记忆 · 9 项</option><option value="full">完整受控读写 · 13 项</option></select></label>
      <fieldset disabled={busy}><legend>学生访问范围</legend>
        <label><input type="radio" name="external-student-scope" checked={(draft.accessMode || 'session_bound') === 'session_bound'} onChange={() => setDraft({ ...draft, accessMode: 'session_bound' })} />每个会话绑定一名学生（默认）</label><p>首次使用时选择学生；会话不能随主界面静默切换。</p>
        <label><input type="radio" name="external-student-scope" checked={draft.accessMode === 'all_authorized_students'} onChange={() => setDraft({ ...draft, accessMode: 'all_authorized_students' })} />一个会话访问所有授权学生</label><p>可跨学生查询和比较；每项写入必须明确目标学生。暂不提供批量写入，也不自动归档多学生完整对话。</p>
        <label><input type="checkbox" checked={draft.inheritForNewStudents} onChange={e => setDraft({ ...draft, inheritForNewStudents: e.target.checked })} />未来新增学生自动继承授权</label>
      </fieldset>
      <p>完整读写默认自动保存，不逐篇审核；不允许删除原文或直接发布正式报告。改变学生范围后，现有会话须刷新上下文版本。</p>
      <div className="actions"><button disabled={busy} onClick={() => void run('savePolicy', { ...draft, confirmed: true })}>{draft.status === 'active' ? '保存授权选择' : '确认一次性授权'}</button>
        <button disabled={busy || draft.status !== 'active'} onClick={() => void run(draft.paused ? 'resume' : 'pause')}>{draft.paused ? '恢复外部连接' : '暂停外部连接'}</button>
        <button disabled={busy || draft.status !== 'active'} onClick={() => { if (window.confirm('撤销全部外部授权？已有资料保留，所有旧连接凭据将失效。')) void run('revoke'); }}>撤销全部外部授权</button></div>
      <details><summary>高级授权设置（仅减权）</summary><label><input type="checkbox" checked={draft.inheritForNewStudents} onChange={e => setDraft({ ...draft, inheritForNewStudents: e.target.checked })} />新增学生继承授权</label><label><input type="checkbox" checked={draft.inheritForNewConnections} onChange={e => setDraft({ ...draft, inheritForNewConnections: e.target.checked })} />新连接继承授权</label><RestrictionEditor value={draft.restrictions} onChange={restrictions => setDraft({ ...draft, restrictions })} snapshot={{ ...snapshot, policy: draft }} busy={busy} /><button disabled={busy} onClick={() => void run('savePolicy', { ...draft, confirmed: true })}>保存高级授权设置</button></details>
      <h4>一键安装与连接管理 · edu-manager-knowledge</h4><p>先安装 WorkBuddy／Codex 客户端并保存授权选择，再点击一键安装。旧版自动原位升级，两端独立凭据，不增加第二套连接器。修复不扩大权限，卸载不删除学生资料。</p>
      {JSON.stringify(draft) !== JSON.stringify(snapshot.policy) && <p role="status">授权选择尚未保存，请先点击“保存授权选择”。</p>}
      {(['codex', 'workbuddy'] as const).map(host => <HostConnectionRow key={host} host={host} snapshot={snapshot} busy={busy} dirty={JSON.stringify(draft) !== JSON.stringify(snapshot.policy)} run={run} />)}
      <p>安装后重启对应 Agent，在新对话输入：“请调用教育管家的 education_connector_health 验证连接，不读取学生资料。”本机验证不代表 Agent 已刷新工具，也不验证 Agent 的联网研究能力。</p>
      <details><summary>连接管理（{snapshot.connections.length}）</summary><div className="form-grid"><label>连接类型<select value={hostType} onChange={e => setHostType(e.target.value)}><option value="workbuddy">WorkBuddy</option><option value="codex">Codex</option><option value="generic">通用 MCP 客户端</option></select></label><label>连接名称<input value={label} maxLength={240} onChange={e => setLabel(e.target.value)} placeholder="例如：我的电脑 WorkBuddy" /></label></div><button disabled={busy || draft.status !== 'active' || draft.paused || !label.trim()} onClick={() => void run('createConnection', { hostType, label: label.trim() })}>建立独立连接</button>
        {configPath && <p style={{ overflowWrap: 'anywhere' }}>本机 MCP 配置：{configPath}。配置生成、宿主安装和真实调用是不同状态，请勿重复添加连接器。</p>}
        {snapshot.connections.map(c => <ConnectionRow key={`${c.connectionId}:${JSON.stringify(c)}`} connection={c} snapshot={snapshot} busy={busy} run={run} />)}</details>
      <details open={snapshot.sessions.some(s => !s.studentId && s.accessMode !== 'all_authorized_students')}><summary>会话归属（{snapshot.sessions.length}）</summary><p>单学生会话首次选择在此完成；切换教育管家页面不会改变外部会话。</p>{snapshot.sessions.map(s => <SessionRow key={`${s.connectionId}:${s.sessionId}:${s.contextRevision}`} session={s} snapshot={snapshot} busy={busy} run={run} />)}</details>
      <details><summary>写入记录与异常（{snapshot.operations.length}）</summary>{!snapshot.operations.length && <p>暂无外部连接写入。</p>}{snapshot.operations.map(o => <WriteRow key={`${o.id}:${o.status}`} operation={o} snapshot={snapshot} busy={busy} run={run} api={api} />)}</details>
    </>}
  </section>;
}
