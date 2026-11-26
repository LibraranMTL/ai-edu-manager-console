import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { SmartInboxApi } from './SmartInboxPanel';

type Target = { studentId: string; type: 'student' | 'project'; id: string; categoryId?: string };
type Group = { id: string; studentId: string; sourceName: string; reason: string; total: number;
  target: Target | null; actions: string[]; examples: { id: string; name: string; message: string }[] };
type Entry = { id: string; name: string; eligible: boolean; state: string; reason?: string; message?: string; currentStatus?: string };
type Job = { humanItems?: { id: string; name: string; reason: string; message: string }[]; businessResult?: string; target?: Target; targetStudentId?: string; action?: string; id: string; type: string; status: string; total: number; page?: number; entries?: Entry[];
  counts: Record<string, number>; previewCounts?: Record<string, number>; expiresAt: string };
type LearnedRule = { version: number; id: string; studentId: string; identifier?: string; directory?: string; state?: string;
  count: number; active: boolean; suspended?: boolean; observations?: unknown[] };
const reasonNames: Record<string, string> = { student_conflict: '确认资料主体', student_unknown: '确认学生',
  no_candidate: '项目待匹配', technical_wait: '技术等待／自动恢复', classification_review: '分类待确认', execution_unknown: '核对执行结果',
  receipt_review: '核对投递结果', original_missing: '原件失效', internal_task: '系统会话', learning_review: '学习规则纠正后的复核' };
const jobNames: Record<string, string> = { preview: '待确认', running: '自动处理中', paused: '已暂停', complete: '已完成' };

export function SmartInboxAutomationPanel({ api, studentId, students, projects }: {
  api: SmartInboxApi; studentId: string; students: { id: string; name: string }[];
  projects: { id: string; name: string; studentIds: string[]; status?: string }[];
}) {
  const [groups, setGroups] = useState<Group[]>([]), [jobs, setJobs] = useState<Job[]>([]);
  const [rules, setRules] = useState<LearnedRule[]>([]), [preview, setPreview] = useState<Job | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set()), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [targetStudent, setTargetStudent] = useState(studentId), [targetProject, setTargetProject] = useState('');
  const generation = useRef(0), running = useRef(false);
  const call = useCallback(async <T,>(action: string, input: unknown = {}): Promise<T> => {
    const result = JSON.parse(await api.smartInboxAction!(action, input));
    if (!result.ok) throw Error(result.message || '操作未完成'); return result.data;
  }, [api]);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    const [data, learned] = await Promise.all([
      call<{ groups: Group[]; jobs: Job[] }>('groups', { studentId }),
      call<LearnedRule[]>('learnedRules', { studentId }),
    ]);
    if (request !== generation.current) return;
    setGroups(data.groups); setJobs(data.jobs); setRules(learned);
  }, [call, studentId]);
  useEffect(() => {
    setPreview(null); setExcluded(new Set()); setTargetStudent(studentId); setTargetProject('');
    void refresh().catch(e => setError(e.message));
    const unsubscribe = api.onSmartInboxChanged?.(() => { void refresh().catch(e => setError(e.message)); });
    return () => { generation.current++; unsubscribe?.(); };
  }, [api, refresh, studentId]);
  async function run(work: () => Promise<void>) {
    if (running.current) return; running.current = true; setBusy(true); setError('');
    try { await work(); await refresh(); } catch (e) { setError((e as Error).message); }
    finally { running.current = false; setBusy(false); }
  }
  async function showPreview(input: Record<string, unknown>) {
    const result = await call<Job>('previewBatch', { ...input, studentId, onlyThis });
    setExcluded(new Set()); setPreview({ ...result, page: 1 });
  }
  const [onlyThis, setOnlyThis] = useState(false);
  const target: Target = { studentId: targetStudent, type: targetProject ? 'project' : 'student', id: targetProject };
  const targetName = (value: Target | null) => !value ? '待判断' : value.type === 'student' ? '学生原始资料库'
    : projects.find(project => project.id === value.id)?.name || '项目';
  return <div aria-label="自动处理与问题组">
    {error ? <p role="alert">{error}</p> : null}
    <div className="actions"><button className="primary" disabled={busy} onClick={() => void run(() => showPreview({ type: 'backlog' }))}>试算历史积压</button>
      <button disabled={busy} onClick={() => void run(refresh)}>刷新处理进度</button></div>
    <p>历史积压试算后确认一次，系统分批继续。等待服务、资源和回执的资料在后台恢复。</p>
    <div className="form-grid"><label>确认所属学生<select value={targetStudent} onChange={event => { setTargetStudent(event.target.value); setTargetProject(''); }}>
      <option value="">请选择学生</option>{students.map(student => <option key={student.id} value={student.id}>{student.name}</option>)}</select></label>
      <label>纠正投递位置<select value={targetProject} onChange={event => setTargetProject(event.target.value)}><option value="">学生原始资料库</option>
        {projects.filter(project => project.studentIds.map(String).includes(targetStudent) && !['sealed', 'archived'].includes(project.status || '')).map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label></div>
    <label><input type="checkbox" checked={onlyThis} onChange={event => setOnlyThis(event.target.checked)} />仅本次特殊处理，确认／纠正结果不用于学习规则</label>
    {groups.map(group => <section className="material-source-panel" key={group.id}>
      <h3>{reasonNames[group.reason] || '需要判断'} · {group.total} 项</h3>
      <p>{students.find(student => student.id === group.studentId)?.name || '学生待确认'} · {group.sourceName} · {targetName(group.target)}</p>
      <ul>{group.examples.map(example => <li key={example.id}>{example.name} — {example.message}</li>)}</ul>
      <div className="actions">
        {group.actions.includes('accept') ? <button disabled={busy} onClick={() => void run(() => showPreview({ type: 'group', groupId: group.id, action: 'accept' }))}>确认本组建议</button> : null}
        {group.actions.includes('confirm_student') ? <button disabled={busy || !targetStudent} onClick={() => void run(() => showPreview({ type: 'group', groupId: group.id, action: 'confirm_student', targetStudentId: targetStudent }))}>本组归属所选学生</button> : null}
        {group.actions.includes('correct') ? <button disabled={busy || !targetStudent} onClick={() => void run(() => showPreview({ type: 'group', groupId: group.id, action: 'correct', target }))}>本组按所选位置纠正</button> : null}
        {group.actions.includes('retry') ? <button disabled={busy} onClick={() => void run(() => showPreview({ type: 'group', groupId: group.id, action: 'retry' }))}>本组重新判断</button> : null}
        {group.actions.includes('ignore') ? <button disabled={busy} onClick={() => void run(() => showPreview({ type: 'group', groupId: group.id, action: 'ignore' }))}>本组移入已忽略</button> : null}
        {group.actions.includes('reconcile') ? <button disabled={busy} onClick={() => void run(() => showPreview({ type: 'group', groupId: group.id, action: 'reconcile' }))}>本组核对结果</button> : null}
      </div>
    </section>)}
    {!groups.length ? <p>当前没有需要集中判断的问题。</p> : null}
    {preview ? <section className="material-source-panel" aria-label="整组处理预览"><h3>处理预览 · 共 {preview.total} 项</h3>
      {preview.target || preview.targetStudentId ? <p>本次确认目标：{students.find(student => student.id === (preview.target?.studentId || preview.targetStudentId))?.name || '学生'} · {preview.target ? targetName(preview.target) : '由 AI 继续分类'}</p> : null}
      <p>预计投递 {preview.previewCounts?.deliver || 0}，忽略 {preview.previewCounts?.ignore || 0}，正式分析 {preview.previewCounts?.classify || 0}，自动核验 {preview.previewCounts?.reconcile || 0}，等待结果 {preview.previewCounts?.wait || 0}，需人工确认 {preview.previewCounts?.confirm || 0}，跳过 {preview.previewCounts?.ineligible || 0}。已排除 {excluded.size} 项。</p>
      <p>正式处理逐条核对原件、学生、来源和目标。缺少可复用结果的资料将在正式分析后决定去向。</p>
      <ul>{preview.entries?.map(entry => <li key={entry.id}><label><input type="checkbox" disabled={!entry.eligible || preview.status !== 'preview'} checked={excluded.has(entry.id)}
        onChange={event => setExcluded(current => { const next = new Set(current); if (event.target.checked) next.add(entry.id); else next.delete(entry.id); return next; })} />排除 {entry.name}</label>
        <small> · {entry.message || entry.reason} {entry.currentStatus || ''}</small></li>)}</ul>
      <div className="actions"><button disabled={busy || (preview.page || 1) <= 1} onClick={() => void run(async () => setPreview(await call<Job>('batchDetail', { id: preview.id, page: (preview.page || 1) - 1 })))}>上一页</button>
        <span>第 {preview.page || 1} 页</span><button disabled={busy || (preview.page || 1) * 25 >= preview.total} onClick={() => void run(async () => setPreview(await call<Job>('batchDetail', { id: preview.id, page: (preview.page || 1) + 1 })))}>下一页</button>
        {preview.status === 'preview' ? <button className="primary" disabled={busy || !preview.total} onClick={() => void run(async () => {
          await call('controlBatch', { id: preview.id, action: 'start', confirmed: true, excludeIds: [...excluded] }); setPreview(null);
        })}>确认并自动处理全部符合项</button> : null}<button onClick={() => setPreview(null)}>关闭预览</button></div>
    </section> : null}
    {jobs.filter(job => job.status !== 'preview').map(job => <section className="material-source-panel" key={job.id}>
      <strong>{job.type === 'backlog' ? '历史积压' : '问题组'} · {job.status === 'complete' ? job.businessResult === 'settled' ? '全部完成' : job.businessResult === 'processing' ? '已恢复处理中' : '本轮结束，仍有待处理' : jobNames[job.status] || job.status} · {job.total} 项</strong>
      <p>等待 {job.counts.pending}，处理中 {job.counts.processing}，已投递 {job.counts.delivered}，已回收 {job.counts.ignored}，技术等待 {job.counts.technicalWaiting || 0}，来源不可用 {job.counts.sourceUnavailable || 0}，需人工确认 {job.counts.review}，跳过 {job.counts.skipped}，失败 {job.counts.failed}。</p>
      <div aria-label="本批次需人工确认">{job.counts.review ? <><strong>需人工确认 {job.counts.review} 项</strong><ul>{job.humanItems?.map(item => <li key={item.id}>{item.name} · {reasonNames[item.reason] || "需要决定"} · {item.message}</li>)}</ul>{job.counts.review > 25 ? <p>其余事项可在问题组中查看。</p> : null}</> : <p>本批次当前无需人工确认。</p>}</div>
      <div className="actions"><button disabled={busy} onClick={() => void run(async () => { setExcluded(new Set()); setPreview(await call<Job>('batchDetail', { id: job.id })); })}>逐项结果</button>
        {['running', 'paused'].includes(job.status) ? <button disabled={busy} onClick={() => void run(async () => { await call('controlBatch', { id: job.id, action: job.status === 'paused' ? 'resume' : 'pause' }); })}>{job.status === 'paused' ? '继续' : '暂停'}</button> : null}</div>
    </section>)}
    {rules.length ? <details><summary>自动学习规则（{rules.length}）</summary>{rules.map(rule => <p key={rule.id}>{rule.identifier || rule.directory || '历史规则'} · {rule.active ? '已生效' : rule.suspended ? '已暂停' : rule.state === 'observing' ? '后台验证中' : '积累样本中'} · 独立确认 {rule.count}，观察样本 {rule.observations?.length || 0} {rule.active || rule.state === 'observing' ? <button disabled={busy} onClick={() => void run(async () => { await call('pauseLearnedRule', { id: rule.id, expectedVersion: rule.version }); })}>暂停此规则</button> : null}</p>)}</details> : null}
  </div>;
}
