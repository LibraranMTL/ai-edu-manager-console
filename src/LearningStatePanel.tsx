import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Plus, RefreshCw, Trash2 } from 'lucide-react';

type DimensionKey = 'goalClarity' | 'confidence' | 'difficulty' | 'recovery' | 'workload';
type LearningStateProjection = {
  asOf: string;
  generation: number;
  automationEnabled: boolean;
  coverage: { hasBaseline: boolean; weeklyFeedbackCount: number };
  checkIns: Array<{ checkInId: string; kind: 'baseline' | 'weekly'; occurredAt: string; dimensions: Record<DimensionKey, number | null>; note: string }>;
  goals: Array<{ goalId: string; revision: number; category: string; title: string; successCriteria: string; status: string }>;
  problems: Array<{ problemId: string; revision: number; category: string; title: string; description: string; status: string }>;
  findings: Array<{ findingId: string; sourceCategory: string; statement: string; status: 'published' | 'pending' | 'disputed'; confidence: string }>;
};

type ActionApi = (action: string, studentId: string, input: Record<string, unknown>) => Promise<string>;

const dimensions: Array<{ key: DimensionKey; label: string; low: string; high: string }> = [
  { key: 'goalClarity', label: '目标清晰度', low: '不清楚', high: '很清楚' },
  { key: 'confidence', label: '当前信心', low: '较低', high: '较高' },
  { key: 'difficulty', label: '主观难度', low: '容易', high: '很难' },
  { key: 'recovery', label: '受挫后恢复', low: '较难恢复', high: '很快恢复' },
  { key: 'workload', label: '主观负荷', low: '较轻', high: '很重' },
];

const sourceLabels: Record<string, string> = {
  student_self_report: '学生自述', external_observation: '外部观察',
  system_observation: '系统观察', system_inference: '系统推断',
};

function submissionId(prefix: string) {
  return `${prefix}-${Date.now()}-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
}

export function LearningStatePanel({ studentId, studentName, actionApi }: { studentId: string; studentName: string; actionApi?: ActionApi }) {
  const [projection, setProjection] = useState<LearningStateProjection | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [kind, setKind] = useState<'baseline' | 'weekly'>('weekly');
  const [values, setValues] = useState<Record<DimensionKey, string>>({ goalClarity: '', confidence: '', difficulty: '', recovery: '', workload: '' });
  const [note, setNote] = useState('');
  const [goal, setGoal] = useState({ title: '', successCriteria: '', category: 'subject' });
  const [problem, setProblem] = useState({ title: '', description: '', category: 'knowledge' });

  const invoke = async (action: string, input: Record<string, unknown> = {}) => {
    if (!actionApi) throw new Error('当前主机版本不支持学习状态管理。');
    const raw = await actionApi(action, studentId, input);
    const result = JSON.parse(raw) as { ok?: boolean; data?: unknown; message?: string };
    if (!result.ok) throw new Error(result.message || '操作失败。');
    return result.data;
  };

  const refresh = async (keepMessage = false) => {
    setBusy(true); if (!keepMessage) setMessage('');
    try { setProjection(await invoke('get') as LearningStateProjection); }
    catch (error) { setMessage(error instanceof Error ? error.message : '学习状态读取失败。'); }
    finally { setBusy(false); }
  };

  useEffect(() => { setProjection(null); void refresh(); }, [studentId]);

  const submitCheckIn = async () => {
    setBusy(true); setMessage('');
    try {
      await invoke('submitCheckIn', {
        clientSubmissionId: submissionId('checkin'),
        payload: { kind, occurredAt: new Date().toISOString(), dimensions: Object.fromEntries(dimensions.map(({ key }) => [key, values[key] ? Number(values[key]) : null])), note },
      });
      setValues({ goalClarity: '', confidence: '', difficulty: '', recovery: '', workload: '' }); setNote('');
      await refresh(true);
      setMessage('反馈已保存；合格事实已按证据类别自动发布，证据不足的推断仍为待观察。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '反馈保存失败。'); }
    finally { setBusy(false); }
  };

  const createGoal = async () => {
    if (!goal.title.trim()) { setMessage('请填写目标标题。'); return; }
    setBusy(true);
    try {
      await invoke('upsertGoal', { expectedRevision: 0, goal: { ...goal, status: 'active' } });
      setGoal({ title: '', successCriteria: '', category: 'subject' }); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : '目标保存失败。'); }
    finally { setBusy(false); }
  };

  const createProblem = async () => {
    if (!problem.title.trim()) { setMessage('请填写问题标题。'); return; }
    setBusy(true);
    try {
      await invoke('upsertProblem', { expectedRevision: 0, problem: { ...problem, status: 'watching' } });
      setProblem({ title: '', description: '', category: 'knowledge' }); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : '问题保存失败。'); }
    finally { setBusy(false); }
  };

  const withdraw = async (targetType: string, objectId: string, revision: number) => {
    const reason = window.prompt('请输入撤回原因（历史记录会保留）：', '录入内容需要更正');
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      await invoke('correctOrWithdraw', { targetType, objectId, revision, action: 'withdraw', reason, commitKey: submissionId(`withdraw-${targetType}`) });
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : '撤回失败。'); }
    finally { setBusy(false); }
  };

  const revise = async (targetType: 'goal' | 'problem', item: LearningStateProjection['goals'][number] | LearningStateProjection['problems'][number]) => {
    const title = window.prompt('请输入更正后的标题（旧修订会保留）：', item.title);
    if (!title?.trim() || title.trim() === item.title) return;
    setBusy(true);
    try {
      if (targetType === 'goal') await invoke('upsertGoal', { expectedRevision: item.revision, goal: { ...item, title: title.trim() } });
      else await invoke('upsertProblem', { expectedRevision: item.revision, problem: { ...item, title: title.trim() } });
      await refresh(true); setMessage('已新增更正修订；旧版本仍保留在历史中。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '更正失败。'); }
    finally { setBusy(false); }
  };

  return <div className="learning-state-panel">
    <div className="notice muted"><strong>{studentName} · 学习状态一期 1A</strong><br />五维反馈分别呈现，不合成总分，不用于诊断、排名或纪律判断。自动行动尚未启用，记录、查看、更正与撤回不受影响。</div>
    <div className="learning-state-toolbar">
      <span>{projection?.coverage.hasBaseline ? <><CheckCircle2 size={16} />已建立首次基线</> : <><AlertTriangle size={16} />尚未建立首次基线</>}</span>
      <span>周反馈 {projection?.coverage.weeklyFeedbackCount || 0} 次</span>
      <button className="secondary compact" type="button" onClick={() => void refresh()} disabled={busy}><RefreshCw size={15} />刷新</button>
    </div>

    <section className="growth-card learning-state-form">
      <div className="growth-card-heading"><strong>五项反馈</strong><select value={kind} onChange={(event) => setKind(event.target.value as 'baseline' | 'weekly')}><option value="baseline">首次基线</option><option value="weekly">本周反馈</option></select></div>
      <div className="learning-state-dimensions">{dimensions.map((item) => <label key={item.key}><span>{item.label}</span><select value={values[item.key]} onChange={(event) => setValues((current) => ({ ...current, [item.key]: event.target.value }))}><option value="">跳过</option>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}{value === 1 ? ` · ${item.low}` : value === 5 ? ` · ${item.high}` : ''}</option>)}</select></label>)}</div>
      <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="可选：学生本人的补充说明" rows={2} />
      <button type="button" onClick={() => void submitCheckIn()} disabled={busy}>保存反馈</button>
    </section>

    <div className="learning-state-columns">
      <section className="growth-card learning-state-form"><strong>目标</strong><select value={goal.category} onChange={(event) => setGoal((current) => ({ ...current, category: event.target.value }))}><option value="subject">学科</option><option value="skill">技能</option><option value="exam">考试</option><option value="project">项目</option><option value="habit">习惯</option></select><input value={goal.title} onChange={(event) => setGoal((current) => ({ ...current, title: event.target.value }))} placeholder="目标标题" /><input value={goal.successCriteria} onChange={(event) => setGoal((current) => ({ ...current, successCriteria: event.target.value }))} placeholder="完成标准（可选）" /><button type="button" className="secondary" onClick={() => void createGoal()} disabled={busy}><Plus size={15} />新增目标</button></section>
      <section className="growth-card learning-state-form"><strong>待观察问题</strong><select value={problem.category} onChange={(event) => setProblem((current) => ({ ...current, category: event.target.value }))}><option value="knowledge">知识</option><option value="skill">技能</option><option value="decomposition">拆解</option><option value="transfer">迁移</option><option value="process">过程</option><option value="resource">资源</option></select><input value={problem.title} onChange={(event) => setProblem((current) => ({ ...current, title: event.target.value }))} placeholder="问题标题" /><input value={problem.description} onChange={(event) => setProblem((current) => ({ ...current, description: event.target.value }))} placeholder="观察说明（可选）" /><button type="button" className="secondary" onClick={() => void createProblem()} disabled={busy}><Plus size={15} />新增问题</button></section>
    </div>

    <div className="learning-state-columns">
      <section><h3>当前目标</h3><div className="download-list growth-list">{projection?.goals.map((item) => <div className="download-item" key={item.goalId}><span><strong>{item.title}</strong><small>{item.category} · {item.status} · 修订 {item.revision}</small><small>{item.successCriteria || '尚未填写完成标准'}</small></span><div className="inline-actions"><button className="secondary compact" type="button" onClick={() => void revise('goal', item)}>更正</button><button className="secondary compact" type="button" onClick={() => void withdraw('goal', item.goalId, item.revision)}><Trash2 size={14} />撤回</button></div></div>)}{!projection?.goals.length && <div className="empty-state">暂无有效目标。</div>}</div></section>
      <section><h3>待观察问题</h3><div className="download-list growth-list">{projection?.problems.map((item) => <div className="download-item" key={item.problemId}><span><strong>{item.title}</strong><small>{item.category} · {item.status} · 修订 {item.revision}</small><small>{item.description || '尚未填写观察说明'}</small></span><div className="inline-actions"><button className="secondary compact" type="button" onClick={() => void revise('problem', item)}>更正</button><button className="secondary compact" type="button" onClick={() => void withdraw('problem', item.problemId, item.revision)}><Trash2 size={14} />撤回</button></div></div>)}{!projection?.problems.length && <div className="empty-state">暂无待观察问题。</div>}</div></section>
    </div>

    <section><h3>已发布事实与待观察项</h3><div className="download-list growth-list">{projection?.findings.map((item) => <div className="download-item" key={item.findingId}><span><strong>{sourceLabels[item.sourceCategory] || item.sourceCategory} · {item.status === 'published' ? '已发布' : item.status === 'disputed' ? '存在冲突' : '待观察'}</strong><small>{item.statement}</small><small>证据置信标签：{item.confidence}</small></span></div>)}{!projection?.findings.length && <div className="empty-state">尚无可发布结论。可以先完成首次基线；证据不足时系统只展示事实和待观察项。</div>}</div></section>
    {message && <div className="notice" role="status">{message}</div>}
  </div>;
}
