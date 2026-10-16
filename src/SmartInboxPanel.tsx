import React, { useCallback, useEffect, useRef, useState } from 'react';
import './smart-inbox.css';

type Schedule = { mode: 'manual' | 'interval' | 'daily' | 'weekly'; minutes: number; time: string; weekday: number };
type Target = { studentId: string; type: 'student' | 'project'; id: string; categoryId?: string };
type Source = { id?: string; name: string; type?: string; folder: string; studentId: string; target: Target | null; enabled: boolean; automatic: boolean; confidenceThreshold?: number; staging: boolean; originalMode: string; recursive: boolean; allHistory: boolean; schedule: Schedule | null; detached?: boolean; error?: string; waitingReason?: string; lastScanAt?: string; nextRunAt?: string };
type Row = { id: string; revision: number; name: string; sourceId: string; sourceName: string; studentId: string; status: string; message: string; proposedTarget?: Target; target?: Target; reason?: string; size: number; manualLocked?: boolean; originalMissing?: boolean; blockReason?: { code: string; category: string; recoverable: boolean; message: string }; execution?: { stage: string; providerId: string; switched: boolean } };
type AgentStatus = { providerId: string; label: string; effectiveProviderId?: string; state: 'ready' | 'login_required' | 'qualification_required' | 'cooldown' | 'unsupported' | 'unavailable'; automaticReady: boolean; message: string; fallbackStatus?: { state: string }; fallback?: { enabled: boolean; version: number; providerId?: string }; login?: { state: string; message: string } };
export type SmartInboxApi = { smartInboxAction?: (action: string, input?: unknown) => Promise<string>; onSmartInboxChanged?: (callback: () => void) => () => void };
const daily: Schedule = { mode: 'daily', minutes: 1440, time: '20:00', weekday: 1 };
const statuses: Record<string, string> = { pending: '等待分析', analyzing: '分析中', review: '需要确认', delivered: '已投递', ignored: '已忽略', retry: '等待重试', delivering: '投递中', archive_pending: '原件／分类待核对', delivery_reconcile: '投递待核对', execution_unknown: '执行待核对' };
function ScheduleFields({ value, onChange }: { value: Schedule; onChange: (s: Schedule) => void }) {
  return <div className="form-grid"><label>扫描周期<select value={value.mode} onChange={e => onChange({ ...value, mode: e.target.value as Schedule['mode'] })}>
    <option value="daily">每天一次</option><option value="weekly">每周一次</option><option value="interval">按分钟／小时间隔</option><option value="manual">仅手动</option></select></label>
    {value.mode === 'interval' ? <label>间隔（分钟，60=1小时）<input type="number" min={15} max={525600} value={value.minutes} onChange={e => onChange({ ...value, minutes: Number(e.target.value) })} /></label> : null}
    {['daily', 'weekly'].includes(value.mode) ? <label>计划时间<input type="time" value={value.time} onChange={e => onChange({ ...value, time: e.target.value })} /></label> : null}
    {value.mode === 'weekly' ? <label>星期<select value={value.weekday} onChange={e => onChange({ ...value, weekday: Number(e.target.value) })}>{['日', '一', '二', '三', '四', '五', '六'].map((day, i) => <option key={i} value={i}>星期{day}</option>)}</select></label> : null}
  </div>;
}
export function SmartInboxPanel({ studentId, students, projects, api, legacy, onOpenAgentControl }: {
  studentId: string; students: { id: string; name: string }[]; projects: { id: string; name: string; studentIds: string[]; status?: string }[]; api: SmartInboxApi; legacy: React.ReactNode; onOpenAgentControl?: () => void;
}) {
  const [tab, setTab] = useState('pending'), [sourceFilter, setSourceFilter] = useState(''), [page, setPage] = useState(1);
  const [sources, setSources] = useState<Source[]>([]), [rows, setRows] = useState<Row[]>([]), [total, setTotal] = useState(0);
  const [defaults, setDefaults] = useState<Schedule>(daily), [form, setForm] = useState<Source | null>(null);
  const [selected, setSelected] = useState<string[]>([]), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [targetStudent, setTargetStudent] = useState(studentId), [targetId, setTargetId] = useState(''), [categoryId, setCategoryId] = useState('');
  const [analysisStudent, setAnalysisStudent] = useState('');
  const [viewStudent, setViewStudent] = useState(studentId);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  async function recoverAgent(action: string, extra: Record<string, unknown> = {}) {
    await run(async () => {
      setMessage(action === 'continueAgent' ? '正在自动校验并恢复，请稍候…' : '正在处理…');
      const result = await call<{ message?: string }>(action, { studentId: viewStudentRef.current, requestId: crypto.randomUUID(), ...extra });
      setMessage(result.message || '操作完成');
    });
  }
  const viewStudentRef = useRef(studentId);
  function changeViewStudent(id: string) { viewStudentRef.current = id; setViewStudent(id); setTargetStudent(id); setTargetId(''); setSourceFilter(''); setPage(1); setSelected([]); setDetail(null); setAgentStatus(null); }
  const [categories, setCategories] = useState<{ categoryId: string; name: string }[]>([]), [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const mounted = useRef(true), generation = useRef(0), running = useRef(false), lastUndo = useRef<{ id: string; revision: number }[]>([]);
  const call = useCallback(async <T,>(action: string, input: unknown = {}): Promise<T> => {
    if (!api.smartInboxAction) throw Error('请更新Windows主机');
    const result = JSON.parse(await api.smartInboxAction(action, input)); if (!result.ok) throw Error(result.message || '操作未完成'); return result.data;
  }, [api]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    const [state, list, currentAgentStatus] = await Promise.all([
      call<{ sources: Source[]; defaults: { schedule: Schedule }; error: string }>('sources'),
      call<{ rows: Row[]; total: number }>('list', { status: tab === 'delivered' ? 'delivered' : tab === 'ignored' ? 'ignored' : 'pending', sourceId: viewStudentRef.current === viewStudent ? sourceFilter : '', studentId: viewStudentRef.current, page: viewStudentRef.current === viewStudent ? page : 1 }),
      viewStudentRef.current ? call<AgentStatus>('agentStatus', { studentId: viewStudentRef.current }) : Promise.resolve(null),
    ]);
    if (!mounted.current || request !== generation.current) return;
    setSources(state.sources); setDefaults(state.defaults.schedule); setRows(list.rows); setTotal(list.total); setSelected([]); setAgentStatus(currentAgentStatus);
    if (state.error) setMessage(state.error);
  }, [call, page, sourceFilter, viewStudent, tab]);
  useEffect(() => { if (tab !== 'legacy') void refresh().catch(e => { if (mounted.current) setMessage(e.message); }); }, [refresh, tab]);
  useEffect(() => api.onSmartInboxChanged?.(() => { void refresh().catch(e => { if (mounted.current) setMessage(e.message); }); }), [api, refresh]);
  useEffect(() => {
    let cancelled = false; setCategories([]); setCategoryId('');
    if (targetStudent && targetId) void call<{ projects: { id: string; categories: { categoryId: string; name: string }[] }[] }>('context', { studentId: targetStudent }).then(c => { if (!cancelled) setCategories(c.projects.find(p => p.id === targetId)?.categories || []); }).catch(() => {});
    return () => { cancelled = true; };
  }, [call, targetStudent, targetId]);
  async function run(work: () => Promise<void>) {
    if (running.current) return; running.current = true; setBusy(true); setMessage('');
    try { await work(); if (mounted.current) await refresh(); } catch (e) { if (mounted.current) setMessage((e as Error).message); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  function targetName(t?: Target) { if (!t) return '等待推荐'; return `${students.find(s => String(s.id) === t.studentId)?.name || '学生'} · ${t.type === 'student' ? '原始资料库' : projects.find(p => String(p.id) === t.id)?.name || '项目'}${t.categoryId ? ' · ' + t.categoryId : ''}`; }
  async function decide(action: string, chosen = rows.filter(r => selected.includes(r.id))) {
    const result = await call<{ results: { id: string; ok: boolean; message?: string }[] }>('decide', { requestId: crypto.randomUUID(), action,
      items: chosen.map(r => ({ id: r.id, revision: r.revision,
        ...(['confirm_student', 'reassign_student'].includes(action) ? { studentId: analysisStudent, confirmedStudentChange: action === 'reassign_student' } : {}),
        ...(action === 'correct' ? { confirmedStudentChange: true, target: { studentId: targetStudent, type: targetId ? 'project' : 'student', id: targetId, categoryId } } : {}) })) });
    if (action === 'ignore') lastUndo.current = chosen.filter(r => result.results.some(x => x.id === r.id && x.ok)).map(r => ({ id: r.id, revision: r.revision + 1 }));
    const count = result.results.filter(r => r.ok).length;
    if (['confirm_student', 'reassign_student'].includes(action) && count) { changeViewStudent(analysisStudent); setTab('pending'); }
    if (action === 'correct' && count) changeViewStudent(targetStudent);
    const name = students.find(s => s.id === analysisStudent)?.name || '所选学生';
    setMessage(`${count ? ['confirm_student', 'reassign_student'].includes(action) ? `已为${name}确认／更正学生并加入分析队列${count}项；列表已切换到该学生，完成后可在待处理／已投递查看。未更改整个来源绑定。` : action === 'ignore' ? `已移至“已忽略”${count}项，保留操作历史，未删除文件。` : `完成${count}项。` : '未完成任何操作。'}${result.results.filter(r => !r.ok).map(r => r.message).join('；')}`);
  }
  function newSource() { setForm({ name: '', folder: '', studentId: students.length === 1 ? String(students[0].id) : '', target: null, enabled: true, automatic: true, staging: false, originalMode: 'keep', recursive: false, allHistory: false, schedule: null }); }
  const validProjects = projects.filter(p => p.studentIds.map(String).includes(targetStudent) && !['sealed', 'archived'].includes(p.status || ''));
  const selectedRows = rows.filter(r => selected.includes(r.id));
  const analysisConflict = selectedRows.some(r => Boolean(r.studentId && r.studentId !== analysisStudent));
  const analysisUnavailable = selectedRows.some(r => r.originalMissing || !['pending', 'review', 'retry', 'delivered'].includes(r.status) || !sources.find(s => s.id === r.sourceId)?.enabled);
  const needsReassignment = analysisConflict || selectedRows.some(r => r.manualLocked || r.status === 'delivered');
  const manualCrossStudent = selectedRows.some(r => r.studentId && r.studentId !== targetStudent);
  const canAccept = selectedRows.length > 0 && selectedRows.every(r => !r.originalMissing && r.status === 'review' && r.proposedTarget);
  const authorizationRows = rows.some(r => r.blockReason?.category === 'agent');
  const authorizationBlocked = authorizationRows && agentStatus?.state !== 'ready';
  const authorizationRecovered = authorizationRows && agentStatus?.state === 'ready';
  return <section className="panel smart-inbox" aria-label="智能资料收件箱">
    <div className="panel-heading"><div><h2>资料收件箱</h2><p>一次配置来源，可信资料自动投递；需要判断的资料集中确认。</p></div><button disabled={busy} className="secondary" onClick={() => void run(refresh)}>刷新状态</button></div>
    <div className="actions" role="tablist" aria-label="资料处理视图">{[['pending', '待处理'], ['delivered', '已投递'], ['sources', '来源管理'], ['ignored', '已忽略'], ['legacy', '原下载／分享入口']].map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? 'primary' : 'secondary'} onClick={() => { setTab(value); setPage(1); setSelected([]); setDetail(null); }}>{label}</button>)}</div>
    {tab === 'legacy' ? legacy : tab === 'sources' ? <>
      <p>新来源默认每天20:00检查最近30天资料，保留原件。关闭应用、休眠或系统繁忙时会延后执行。</p>
      <button className="primary" disabled={busy} onClick={newSource}>添加来源文件夹</button>
      <details><summary>默认扫描周期</summary><ScheduleFields value={defaults} onChange={setDefaults} /><button disabled={busy} onClick={() => void run(async () => { await call('defaults', { schedule: defaults }); })}>保存默认周期</button></details>
      {sources.map(s => <section className="material-source-panel" key={s.id}><strong>{s.name}</strong><p style={{ overflowWrap: 'anywhere' }}>{s.folder || targetName({ studentId: s.studentId, type: 'student', id: '' })}</p>
        <p>{s.detached ? '已解除关联' : s.enabled ? '已开启' : '已暂停'} · 上次：{s.lastScanAt ? new Date(s.lastScanAt).toLocaleString() : '尚未扫描'} · 下次计划：{s.nextRunAt ? new Date(s.nextRunAt).toLocaleString() : '手动／暂停'}</p>
        {s.error ? <p role="status">{s.error}</p> : null}
        {s.waitingReason ? <p>{s.waitingReason}</p> : null}
        <div className="actions"><button disabled={busy} onClick={() => setForm({ ...s })}>设置</button><button disabled={busy || s.detached} onClick={() => void run(async () => { await call('scan', { id: s.id }); setMessage('已加入扫描队列，可继续使用其他功能。'); })}>立即扫描</button>
          <button disabled={busy || s.detached} onClick={() => void run(async () => { await call(s.enabled ? 'pause' : 'saveSource', s.enabled ? { id: s.id } : { ...s, enabled: true }); })}>{s.enabled ? '暂停' : '开启'}</button>
          <button disabled={busy || s.detached} onClick={() => void run(async () => { await call('detach', { id: s.id }); })}>解除关联</button></div>
      </section>)}
      {form ? <form className="material-source-panel" onSubmit={e => { e.preventDefault(); void run(async () => { await call('saveSource', form); setForm(null); }); }}>
        <h3>{form.id ? '来源设置' : '添加资料来源'}</h3>
        <div className="form-grid"><label>名称<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="例如：孩子的学习资料" /></label>
          <label>所属学生<select value={form.studentId} disabled={Boolean(form.type && !['folder', 'download'].includes(form.type))} onChange={e => setForm({ ...form, studentId: e.target.value, target: null })}><option value="">共享来源，投递前确认学生</option>{students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label>投递位置<select disabled={!form.studentId} value={form.target ? form.target.type === 'student' ? '__student' : form.target.id : ''} onChange={e => setForm({ ...form, target: !e.target.value ? null : { studentId: form.studentId, type: e.target.value === '__student' ? 'student' : 'project', id: e.target.value === '__student' ? '' : e.target.value } })}><option value="">智能选择项目，不确定时确认</option><option value="__student">固定投递到学生原始资料库</option>{projects.filter(p => p.studentIds.map(String).includes(form.studentId) && !['sealed', 'archived'].includes(p.status || '')).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
        {!form.type || ['folder', 'download'].includes(form.type) ? <><p style={{ overflowWrap: 'anywhere' }}>{form.folder || '请选择本机文件夹'}</p>{!form.id ? <div className="actions">{[['documents', '选择文档目录'], ['pictures', '选择图片目录'], ['', '选择其他目录']].map(([recommended, label]) => <button type="button" disabled={busy} key={label} onClick={() => void run(async () => { const picked = await call<{ folder: string; canceled: boolean }>('choose', { recommended }); if (!picked.canceled) setForm(f => f ? { ...f, folder: picked.folder } : f); })}>{label}</button>)}</div> : null}</> : null}
        <label><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} />开启此来源</label>
        <label><input type="checkbox" checked={form.automatic} onChange={e => setForm({ ...form, automatic: e.target.checked })} />可信资料自动投递，其余集中确认</label>
        <label>自动投递可信阈值<input type="number" min={0.95} max={1} step={0.01} value={form.confidenceThreshold ?? 0.95} onChange={e => setForm({ ...form, confidenceThreshold: Number(e.target.value) })} /></label>
        <p>默认0.95；还需正文证据充分、候选差距至少0.20且无归属冲突。图片、公式未完整识别只提示，不单独阻断。分数不代表实际准确率；已投递可纠正。</p>
        <p>开启来源或点击立即扫描，将按需要使用已配置Agent分析资料正文及当前学生上下文，可能消耗额度。</p>
        <details><summary>高级设置</summary><label><input type="checkbox" checked={!form.schedule} onChange={e => setForm({ ...form, schedule: e.target.checked ? null : { ...defaults } })} />继承默认周期</label>{form.schedule ? <ScheduleFields value={form.schedule} onChange={schedule => setForm({ ...form, schedule })} /> : null}
          <label><input type="checkbox" checked={form.allHistory} onChange={e => setForm({ ...form, allHistory: e.target.checked })} />包含全部历史资料（否则首次仅处理最近30天）</label>
          {form.folder ? <><label><input type="checkbox" checked={form.recursive} onChange={e => setForm({ ...form, recursive: e.target.checked })} />包含子目录，自动跳过受管目录和链接</label>
            <label><input type="checkbox" checked={form.staging} onChange={e => setForm({ ...form, staging: e.target.checked, originalMode: e.target.checked ? 'archive' : 'keep' })} />这是专用中转目录；投递校验成功后清理中转原件，只在受管目标保留一份</label></> : null}</details>
        <div className="actions"><button type="submit" disabled={busy || (!form.folder && (!form.type || form.type === 'folder'))} className="primary">保存来源</button><button type="button" disabled={busy} onClick={() => setForm(null)}>取消</button></div>
      </form> : null}
    </> : <>
      <div className="form-grid"><label>查看学生<select value={viewStudent} onChange={e => changeViewStudent(e.target.value)}>{!viewStudent ? <option value="">全部已授权学生</option> : null}{students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>资料来源<select value={sourceFilter} onChange={e => { setSourceFilter(e.target.value); setPage(1); }}><option value="">全部来源</option>{sources.filter(s => !viewStudent || !s.studentId || s.studentId === viewStudent).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label></div>
      <p>当前显示该学生及待确认归属的共享资料。确认学生后自动切换到该学生；自动投递成功项在“已投递”，分析本身不会修改文档正文。</p>
      {tab === 'pending' && viewStudent && agentStatus ? <section className="material-source-panel" aria-label="恢复当前学生Agent授权">
        <h3>{authorizationBlocked ? '等待 Agent，资料已保留' : authorizationRecovered ? 'Agent 可用，可继续待办' : '分类 Agent 设置'}</h3>
        <p>{agentStatus.message} 同一Agent的有效登录供已授权学生共用；切换学生无需重新登录。</p>
        {onOpenAgentControl ? <button onClick={onOpenAgentControl}>前往 AI 接入与调度中心</button> : <>
        {agentStatus.state === 'login_required' ? <><p>点击授权后自动打开官方登录页；不需要上传JSON或选择程序目录。</p><div className="actions"><button disabled={busy} onClick={() => void recoverAgent('authorizeAgent')}>{agentStatus.providerId === 'workbuddy' ? '自动准备并授权 WorkBuddy' : `重新授权 ${agentStatus.label}`}</button>
          <button disabled={busy} onClick={() => void recoverAgent('continueAgent')}>我已完成登录，继续</button></div></> : null}
        {agentStatus.login?.state === 'running' ? <p>{agentStatus.login.message}</p> : null}
        {['ready', 'qualification_required'].includes(agentStatus.state) ? <button disabled={busy} onClick={() => void recoverAgent('continueAgent', { providerId: agentStatus.effectiveProviderId || agentStatus.providerId })}>继续待办（复用已有登录）</button> : null}
        {['codex', 'workbuddy'].includes(agentStatus.providerId) ? <>
          <p>允许备用 Agent 后，本学生的资料可能提交给{agentStatus.providerId === 'workbuddy' ? ' Codex' : ' WorkBuddy'}。仅在主 Agent 尚未发送正文时切换；未知执行需先核对。</p>
          <button disabled={busy} onClick={() => void recoverAgent('saveFallback', { enabled: !agentStatus.fallback?.enabled,
            providerId: agentStatus.providerId === 'workbuddy' ? 'codex' : 'workbuddy', version: agentStatus.fallback?.version || 0, confirmed: true })}>
            {agentStatus.fallback?.enabled ? '关闭备用切换' : `允许 ${agentStatus.providerId === 'workbuddy' ? 'Codex' : 'WorkBuddy'} 作为备用并继续`}</button>
          {agentStatus.fallback?.enabled && agentStatus.fallbackStatus?.state === 'login_required' ? <div className="actions"><button disabled={busy} onClick={() => void recoverAgent('authorizeAgent', { providerId: agentStatus.fallback?.providerId })}>授权备用 Agent</button>
            <button disabled={busy} onClick={() => void recoverAgent('continueAgent', { providerId: agentStatus.fallback?.providerId })}>备用已登录，批量继续</button></div> : null}
        </> : null}
        </>}
      </section> : null}
      <div className="actions"><button disabled={!rows.length || busy} onClick={() => setSelected(rows.map(r => r.id))}>全选当前页</button><button disabled={busy} onClick={() => setSelected([])}>清空选择</button>
        {tab === 'pending' ? <><button className="primary" disabled={busy || !canAccept} onClick={() => void run(() => decide('accept'))}>确认建议并投递</button><button disabled={busy || !selected.length} onClick={() => void run(() => decide('ignore'))}>忽略</button><button disabled={busy || !selected.length} onClick={() => void run(() => decide('retry'))}>重新分析</button><button disabled={busy || !selected.length} onClick={() => void run(() => decide('reconcile'))}>核对上次结果</button></> : null}
        {tab === 'ignored' ? <button disabled={busy || !selected.length} onClick={() => void run(() => decide('restore'))}>恢复待处理</button> : null}
        {lastUndo.current.length ? <button disabled={busy} onClick={() => void run(async () => { await call('decide', { requestId: crypto.randomUUID(), action: 'restore', items: lastUndo.current }); lastUndo.current = []; })}>撤销刚才的忽略</button> : null}
      </div>
      {['pending', 'delivered'].includes(tab) ? <section className="material-source-panel" aria-label="仅确认学生，由AI分类"><h3>确认／更正学生，由AI分类</h3>
        <p>先勾选同一学生的资料，再选择学生。无需指定项目；AI仅分析该学生范围，可信项按来源设置自动投递，其余推荐项目供您确认。</p>
        <div className="actions"><label>确认所属学生<select value={analysisStudent} onChange={e => setAnalysisStudent(e.target.value)}><option value="">请选择学生</option>{students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <button className="primary" disabled={busy || !analysisStudent || !selected.length || analysisUnavailable} onClick={() => void run(() => decide(needsReassignment ? 'reassign_student' : 'confirm_student'))}>{needsReassignment ? '更正学生并重新智能分类' : '确认学生并智能分类'}（{selected.length}项）</button></div>
        <p>仅处理所选资料，不改变整个来源。沿用已授权Agent；正文可能提交给该学生配置的Agent。来源未开启自动投递时，只生成建议。</p>
        {analysisStudent && analysisConflict ? <p role="status">点击更正将把所选资料归属改为{students.find(s => s.id === analysisStudent)?.name}，清除旧学生建议并重新分析。已投递资料在新目标成功后处理旧关联，已引用历史保留。</p> : null}
        {analysisUnavailable ? <p role="status">请仅选择原件有效、来源已开启且无执行待核对的资料。</p> : null}
      </section> : null}
      {tab !== 'ignored' ? <details><summary>手动指定位置并投递／纠正</summary><p>您自行选择学生和目标位置后直接投递，不等待AI推荐项目。</p><div className="form-grid"><label>学生<select value={targetStudent} onChange={e => { setTargetStudent(e.target.value); setTargetId(''); }}><option value="">请选择学生</option>{students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>项目<select value={targetId} onChange={e => setTargetId(e.target.value)}><option value="">学生原始资料库</option>{validProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        {categories.length ? <label>分类<select value={categoryId} onChange={e => setCategoryId(e.target.value)}><option value="">保留现有分类／新资料不指定</option>{categories.map(c => <option key={c.categoryId} value={c.categoryId}>{c.name || c.categoryId}</option>)}</select></label> : null}</div>
        {manualCrossStudent ? <p>将所选资料更正为{students.find(s => s.id === targetStudent)?.name}。旧建议作废；已有引用保留更正记录。</p> : null}
        <button disabled={busy || !targetStudent || !selected.length || selectedRows.some(r => r.originalMissing || !['pending', 'review', 'retry', 'delivered'].includes(r.status))} onClick={() => void run(() => decide('correct'))}>{manualCrossStudent ? '更正学生并按此位置投递' : '按此位置投递／纠正'}</button></details> : null}
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%' }}><thead><tr><th>选择</th><th>资料／来源</th><th>状态</th><th>投递位置与理由</th><th>操作</th></tr></thead><tbody>{rows.map(r => <tr key={r.id}><td><input type="checkbox" aria-label={`选择${r.name}`} checked={selected.includes(r.id)} onChange={e => setSelected(old => e.target.checked ? [...old, r.id] : old.filter(id => id !== r.id))} /></td>
        <td style={{ overflowWrap: 'anywhere', maxWidth: 300 }}>{r.name}<small style={{ display: 'block' }}>{r.sourceName} · {(r.size / 1024).toFixed(1)} KiB</small><small style={{ display: 'block' }}>所属学生：{r.studentId ? students.find(s => String(s.id) === r.studentId)?.name || '已绑定学生' : '待确认（上方可批量确认）'}</small></td>
        <td>{r.originalMissing && r.status !== 'ignored' ? '原件已失效' : !r.studentId && ['pending', 'review'].includes(r.status) ? '待确认学生'
          : r.status === 'execution_unknown' ? '执行待核对' : r.blockReason?.category === 'agent' ? '等待 Agent'
          : r.blockReason?.category === 'security' ? '需要人工处理' : r.blockReason?.category === 'resource' ? '等待资源，稍后继续' : r.status === 'analyzing' && r.execution?.stage === 'qualifying' ? '正在准备 Agent' : statuses[r.status] || r.status}</td>
        <td>{r.originalMissing ? '未投递，可移除待办记录' : r.blockReason ? (r.blockReason.category === 'unknown' ? '上次执行需核对' : '自动分类未完成，资料已保留')
          : r.status === 'delivered' && r.target ? targetName(r.target) : r.proposedTarget ? targetName(r.proposedTarget) : !r.studentId ? '确认学生后推荐项目' : r.status === 'review' ? '需指定项目' : '分析完成后推荐项目'}
          <small style={{ display: 'block' }}>{r.blockReason?.message || r.reason || r.message}</small>
          {r.execution?.switched ? <small>已切换 {r.execution.providerId} 分析</small> : null}</td>
        <td><button disabled={busy || r.originalMissing} onClick={() => void run(async () => { await call('open', { id: r.id }); })}>原件</button><button disabled={busy} onClick={() => void run(async () => setDetail(await call('detail', { id: r.id }))) }>详情</button>{tab === 'pending' && ['pending', 'review', 'retry'].includes(r.status) ? <button disabled={busy} title="移至已忽略，保留操作历史，不删除任何原件" onClick={() => void run(() => decide('ignore', [r]))}>移除记录</button> : null}</td></tr>)}</tbody></table></div>
      {!rows.length ? <p>当前没有待办资料。可在来源管理中添加目录或立即扫描。</p> : null}
      <div className="actions"><button disabled={page <= 1 || busy} onClick={() => setPage(p => p - 1)}>上一页</button><span>第{page}页 · 共{total}项</span><button disabled={page * 25 >= total || busy} onClick={() => setPage(p => p + 1)}>下一页</button></div>
      {detail ? <details open><summary>资料诊断详情</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(detail, null, 2)}</pre><button onClick={() => setDetail(null)}>关闭详情</button></details> : null}
    </>}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
