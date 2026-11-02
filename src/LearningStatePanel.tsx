import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Plus, RefreshCw, Trash2 } from 'lucide-react';

type DimensionKey = 'goalClarity' | 'confidence' | 'difficulty' | 'recovery' | 'workload';
type LearningStateProjection = {
  asOf: string;
  generation: number;
  automationEnabled: boolean | null;
  coverage: { hasBaseline: boolean; weeklyFeedbackCount: number };
  checkIns: Array<{ checkInId: string; kind: 'baseline' | 'weekly'; occurredAt: string; dimensions: Record<DimensionKey, number | null>; note: string }>;
  goals: Array<{ goalId: string; revision: number; category: string; title: string; successCriteria: string; status: string }>;
  problems: Array<{ problemId: string; revision: number; category: string; title: string; description: string; status: string }>;
  findings: Array<{ findingId: string; sourceCategory: string; statement: string; status: 'published' | 'pending' | 'disputed'; confidence: string }>;
  actions: Array<{ actionId: string; actionKey: string; subjectType: 'goal' | 'problem'; subjectId: string; subjectRevision: number; actionType: 'learning_task' | 'targeted_practice'; retestWindow: string; title: string; status: string; currentRound: number; binding: null | { entityType: 'task' | 'practice_card'; entityId: string; status: string } }>;
  methods: Array<{ experimentId: string; revision: number; methodKey: string; title: string; hypothesis: string; practice: string; conditions: { subject?: string; taskType?: string; targetKey?: string }; studentReport: { helpful?: boolean; note?: string }; status: string; analysis: { status: string; statement: string; sampleSize: number; definitive: boolean } }>;
  efficiency: {
    dueGoalAttainment: RatioMetric; evidenceBackedOutputs: RatioMetric; independentCompletion: RatioMetric;
    comparableKnownAssistance: RatioMetric; delayedRetention: RatioMetric;
    rework: { rounds: number; sampleSize: number; reasons: Array<{ reason: string; count: number }> };
    effort: { totalMinutes: number; sampleSize: number; unknownCount: number; note: string };
    background: { screenMinutes: number; fileCount: number; loginCount: number }; backgroundNote: string;
  };
};

type RatioMetric = { numerator: number; denominator: number; sampleSize: number; note: string };

type RoleReportProjection = {
  projectionRole: 'student' | 'teacher' | 'parent';
  deliveryMode: 'authenticated_view' | 'admin_authorized_export';
  asOf: string;
  fieldAllowlist: string[];
  summary: { activeGoalCount: number; activeProblemCount: number; pendingActionCount: number };
  dimensions: Record<'goals' | 'mindset' | 'problems' | 'methods' | 'efficiency', { status: string }>;
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

function nextRetestWindow() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 6);
  return `${start.toISOString().slice(0, 10)}/${end.toISOString().slice(0, 10)}`;
}

const actionStatusLabels: Record<string, string> = {
  pending: '等待派发', suppressed: '已保留，等待条件恢复', dispatching: '正在创建', unknown: '结果待对账',
  dispatched: '已创建', completed: '已完成', failed: '创建失败', cancelled: '已取消',
};

const methodStatusLabels: Record<string, string> = {
  student_reported: '学生认为有帮助', pending: '证据不足', incomparable: '任务不可比',
  observed_difference: '观察到变化，待延迟复测', observed_no_difference: '暂未观察到变化',
};

const roleFieldLabels: Record<string, string> = {
  summary: '摘要', dimensions: '五维画像', nextActions: '下一步行动', history: '历史变化',
  evidenceSummary: '证据摘要', governance: '治理信息',
};
const dimensionStatusLabels: Record<string, string> = {
  observed: '有观察证据', self_reported: '学生自述', insufficient_evidence: '证据不足', descriptive_only: '仅描述统计',
};

function ratioText(metric?: RatioMetric) {
  return metric ? `${metric.numerator}/${metric.denominator} · 样本 ${metric.sampleSize}` : '0/0 · 样本 0';
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
  const [method, setMethod] = useState({ title: '', hypothesis: '', practice: '', subject: '', taskType: '', targetKey: '', helpful: false, note: '' });
  const [roleProjection, setRoleProjection] = useState<RoleReportProjection | null>(null);

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

  const createMethodExperiment = async () => {
    if (!method.title.trim()) { setMessage('请填写学习方法名称。'); return; }
    setBusy(true); setMessage('');
    try {
      await invoke('upsertMethodExperiment', { expectedRevision: 0, experiment: {
        methodKey: submissionId('method'), title: method.title.trim(), hypothesis: method.hypothesis.trim(),
        practice: method.practice.trim(), conditions: { subject: method.subject.trim(), taskType: method.taskType.trim(), targetKey: method.targetKey.trim() },
        studentReport: { helpful: method.helpful, note: method.note.trim() }, status: 'active',
      } });
      setMethod({ title: '', hypothesis: '', practice: '', subject: '', taskType: '', targetKey: '', helpful: false, note: '' });
      await refresh(true); setMessage('方法实验已保存。学生自述与系统证据会分开呈现。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '方法实验保存失败。'); }
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

  const dispatchAction = async (subjectType: 'goal' | 'problem', item: LearningStateProjection['goals'][number] | LearningStateProjection['problems'][number], actionType: 'learning_task' | 'targeted_practice') => {
    setBusy(true); setMessage('');
    try {
      const result = await invoke('dispatchLearningAction', { action: {
        subjectType, subjectId: subjectType === 'goal' ? (item as LearningStateProjection['goals'][number]).goalId : (item as LearningStateProjection['problems'][number]).problemId,
        subjectRevision: item.revision, actionType, retestWindow: nextRetestWindow(),
        title: actionType === 'targeted_practice' ? `${item.title} · 专项复测` : `${item.title} · 下一步任务`,
        payload: { subject: '自动', focus: item.title },
      } }) as { status?: string; reason?: string; reused?: boolean };
      await refresh(true);
      setMessage(result.status === 'suppressed'
        ? `行动意图已保留：${actionStatusLabels[result.status] || result.status}（${result.reason || '门禁未满足'}）。`
        : result.reused ? '已复用同一复测窗口中的现有行动，没有重复创建。' : '下一步行动已进入现有任务或学习卡链路。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '行动派发失败。'); }
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

  const reviseMethod = async (item: LearningStateProjection['methods'][number]) => {
    const subject = window.prompt('更正适用学科（旧修订会保留）：', item.conditions.subject || '');
    if (subject === null) return;
    const taskType = window.prompt('更正适用任务类型：', item.conditions.taskType || '');
    if (taskType === null) return;
    const note = window.prompt('更正学生说明：', item.studentReport.note || '');
    if (note === null) return;
    setBusy(true);
    try {
      await invoke('upsertMethodExperiment', { expectedRevision: item.revision, experiment: {
        ...item, conditions: { ...item.conditions, subject: subject.trim(), taskType: taskType.trim() },
        studentReport: { ...item.studentReport, note: note.trim() },
      } });
      await refresh(true); setMessage('方法适用范围与学生说明已新增更正修订。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '方法更正失败。'); }
    finally { setBusy(false); }
  };

  const previewRoleReport = async (projectionRole: RoleReportProjection['projectionRole']) => {
    setBusy(true); setMessage('');
    try {
      const data = await invoke('role-report', {
        reportType: 'learning_profile', projectionRole, authorizedExport: projectionRole === 'parent',
      }) as RoleReportProjection;
      setRoleProjection(data);
      setMessage(projectionRole === 'parent'
        ? '已生成家长字段白名单的管理员授权预览；未建立可靠家长身份绑定前不会开放直接读取。'
        : `已读取${projectionRole === 'student' ? '学生' : '教师'}字段白名单预览。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '分角色报告读取失败。'); }
    finally { setBusy(false); }
  };

  return <div className="learning-state-panel">
    <div className="notice muted"><strong>{studentName} · 学情三期</strong><br />五维画像已接入整体画像、历史变化、阶段总结与每周行动建议。学生、教师和家长只读取各自字段白名单；效率仅显示分子、分母与样本量，不合成总分，不用于诊断、排名或纪律判断。行动派发门禁{projection?.automationEnabled ? '已开启' : '已暂停'}。</div>
    <div className="learning-state-toolbar">
      <span>{projection?.coverage.hasBaseline ? <><CheckCircle2 size={16} />已建立首次基线</> : <><AlertTriangle size={16} />尚未建立首次基线</>}</span>
      <span>周反馈 {projection?.coverage.weeklyFeedbackCount || 0} 次</span>
      <button className="secondary compact" type="button" onClick={() => void refresh()} disabled={busy}><RefreshCw size={15} />刷新</button>
    </div>

    <section className="growth-card learning-state-form">
      <div className="growth-card-heading"><strong>分角色报告预览</strong><small>家长身份未可靠绑定时，仅允许管理员生成授权导出预览。</small></div>
      <div className="inline-actions">
        <button className="secondary compact" type="button" disabled={busy} onClick={() => void previewRoleReport('student')}>学生视图</button>
        <button className="secondary compact" type="button" disabled={busy} onClick={() => void previewRoleReport('teacher')}>教师视图</button>
        <button className="secondary compact" type="button" disabled={busy} onClick={() => void previewRoleReport('parent')}>家长授权导出预览</button>
      </div>
      {roleProjection ? <div className="notice muted">
        <strong>{roleProjection.projectionRole === 'student' ? '学生' : roleProjection.projectionRole === 'teacher' ? '教师' : '家长'}投影</strong>
        <br />有效目标 {roleProjection.summary.activeGoalCount} 项 · 待观察问题 {roleProjection.summary.activeProblemCount} 项 · 下一步行动 {roleProjection.summary.pendingActionCount} 项
        <br />五维状态：目标 {dimensionStatusLabels[roleProjection.dimensions.goals.status] || roleProjection.dimensions.goals.status}；心态 {dimensionStatusLabels[roleProjection.dimensions.mindset.status] || roleProjection.dimensions.mindset.status}；问题 {dimensionStatusLabels[roleProjection.dimensions.problems.status] || roleProjection.dimensions.problems.status}；方法 {dimensionStatusLabels[roleProjection.dimensions.methods.status] || roleProjection.dimensions.methods.status}；效率 {dimensionStatusLabels[roleProjection.dimensions.efficiency.status] || roleProjection.dimensions.efficiency.status}
        <br />字段白名单：{roleProjection.fieldAllowlist.map((field) => roleFieldLabels[field] || field).join('、')} · {roleProjection.deliveryMode === 'admin_authorized_export' ? '管理员授权导出' : '认证查看'}
      </div> : <div className="empty-state">选择角色后查看当前字段白名单投影；预览不会触发报告生成、任务或学习卡。</div>}
    </section>

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
      <section><h3>当前目标</h3><div className="download-list growth-list">{projection?.goals.map((item) => <div className="download-item" key={item.goalId}><span><strong>{item.title}</strong><small>{item.category} · {item.status} · 修订 {item.revision}</small><small>{item.successCriteria || '尚未填写完成标准'}</small></span><div className="inline-actions"><button className="secondary compact" type="button" disabled={busy} onClick={() => void dispatchAction('goal', item, 'learning_task')}>加入任务中心</button><button className="secondary compact" type="button" onClick={() => void revise('goal', item)}>更正</button><button className="secondary compact" type="button" onClick={() => void withdraw('goal', item.goalId, item.revision)}><Trash2 size={14} />撤回</button></div></div>)}{!projection?.goals.length && <div className="empty-state">暂无有效目标。</div>}</div></section>
      <section><h3>待观察问题</h3><div className="download-list growth-list">{projection?.problems.map((item) => <div className="download-item" key={item.problemId}><span><strong>{item.title}</strong><small>{item.category} · {item.status} · 修订 {item.revision}</small><small>{item.description || '尚未填写观察说明'}</small></span><div className="inline-actions"><button className="secondary compact" type="button" disabled={busy} onClick={() => void dispatchAction('problem', item, 'targeted_practice')}>安排专项卡</button><button className="secondary compact" type="button" onClick={() => void revise('problem', item)}>更正</button><button className="secondary compact" type="button" onClick={() => void withdraw('problem', item.problemId, item.revision)}><Trash2 size={14} />撤回</button></div></div>)}{!projection?.problems.length && <div className="empty-state">暂无待观察问题。</div>}</div></section>
    </div>

    <section className="growth-card learning-state-form">
      <div className="growth-card-heading"><strong>学习方法实验</strong><small>例如“先独立尝试”或“先拆分步骤”；系统不会仅凭自我感觉认定有效。</small></div>
      <div className="learning-method-grid">
        <input value={method.title} onChange={(event) => setMethod((current) => ({ ...current, title: event.target.value }))} placeholder="方法名称" />
        <input value={method.hypothesis} onChange={(event) => setMethod((current) => ({ ...current, hypothesis: event.target.value }))} placeholder="希望改善什么" />
        <input value={method.practice} onChange={(event) => setMethod((current) => ({ ...current, practice: event.target.value }))} placeholder="具体做法" />
        <input value={method.subject} onChange={(event) => setMethod((current) => ({ ...current, subject: event.target.value }))} placeholder="适用学科" />
        <input value={method.taskType} onChange={(event) => setMethod((current) => ({ ...current, taskType: event.target.value }))} placeholder="任务类型" />
        <input value={method.targetKey} onChange={(event) => setMethod((current) => ({ ...current, targetKey: event.target.value }))} placeholder="目标/知识点" />
      </div>
      <label className="learning-method-report"><input type="checkbox" checked={method.helpful} onChange={(event) => setMethod((current) => ({ ...current, helpful: event.target.checked }))} />学生本人认为有帮助<input value={method.note} onChange={(event) => setMethod((current) => ({ ...current, note: event.target.value }))} placeholder="学生说明（可选）" /></label>
      <button type="button" className="secondary" onClick={() => void createMethodExperiment()} disabled={busy}><Plus size={15} />新增方法实验</button>
    </section>

    <section><h3>个人方法库</h3><div className="download-list growth-list">{projection?.methods.map((item) => <div className="download-item" key={item.experimentId}><span><strong>{item.title}</strong><small>{item.practice || item.hypothesis || '尚未填写具体做法'} · 修订 {item.revision}</small><small>{methodStatusLabels[item.analysis.status] || item.analysis.status}：{item.analysis.statement}</small><small>系统证据样本 {item.analysis.sampleSize}；{item.studentReport?.note ? `学生说明：${item.studentReport.note}` : '暂无学生补充说明'}</small></span><div className="inline-actions"><button type="button" className="secondary compact" disabled={busy} onClick={() => void reviseMethod(item)}>更正适用范围</button><button type="button" className="secondary compact" disabled={busy} onClick={() => void withdraw('method_experiment', item.experimentId, item.revision)}><Trash2 size={14} />撤回</button></div></div>)}{!projection?.methods.length && <div className="empty-state">暂无方法实验。记录方法后，系统会等待可比任务和延迟复测，不会用单次感受替代证据。</div>}</div></section>

    <section><h3>效率明细</h3><div className="learning-efficiency-grid">
      <div className="growth-card"><strong>到期目标达成</strong><b>{ratioText(projection?.efficiency.dueGoalAttainment)}</b><small>{projection?.efficiency.dueGoalAttainment.note || '按有完成标准的到期目标计算'}</small></div>
      <div className="growth-card"><strong>有证据产出</strong><b>{ratioText(projection?.efficiency.evidenceBackedOutputs)}</b><small>{projection?.efficiency.evidenceBackedOutputs.note || '仅计入可评价任务'}</small></div>
      <div className="growth-card"><strong>独立完成</strong><b>{ratioText(projection?.efficiency.independentCompletion)}</b><small>{projection?.efficiency.independentCompletion.note || '帮助情况未知时不算独立'}</small></div>
      <div className="growth-card"><strong>帮助情况已知</strong><b>{ratioText(projection?.efficiency.comparableKnownAssistance)}</b><small>{projection?.efficiency.comparableKnownAssistance.note || '仅用于判断任务是否具备可比条件'}</small></div>
      <div className="growth-card"><strong>延迟复测保持</strong><b>{ratioText(projection?.efficiency.delayedRetention)}</b><small>{projection?.efficiency.delayedRetention.note || '仅计入到期复测'}</small></div>
      <div className="growth-card"><strong>返工记录</strong><b>{projection?.efficiency.rework.rounds || 0} 轮 · 样本 {projection?.efficiency.rework.sampleSize || 0}</b><small>{projection?.efficiency.rework.reasons.map((item) => `${item.reason} ${item.count} 次`).join('；') || '尚无返工原因记录'}</small></div>
      <div className="growth-card"><strong>可核验投入</strong><b>{projection?.efficiency.effort.totalMinutes || 0} 分钟 · 样本 {projection?.efficiency.effort.sampleSize || 0}</b><small>{projection?.efficiency.effort.note || '未知时长保持未知'}</small></div>
    </div><div className="notice muted">背景数据：屏幕 {projection?.efficiency.background.screenMinutes || 0} 分钟、文件 {projection?.efficiency.background.fileCount || 0} 个、登录 {projection?.efficiency.background.loginCount || 0} 次。{projection?.efficiency.backgroundNote}</div></section>

    <section><h3>下一步行动</h3><div className="download-list growth-list">{projection?.actions.map((item) => <div className="download-item" key={item.actionId}><span><strong>{item.title}</strong><small>{item.actionType === 'targeted_practice' ? '专项学习卡' : '学习任务'} · {actionStatusLabels[item.binding?.status || item.status] || item.status}</small><small>复测窗口 {item.retestWindow}{item.binding?.entityId ? ` · 已绑定 ${item.binding.entityType === 'task' ? '任务' : '卡片'}` : ''}</small></span></div>)}{!projection?.actions.length && <div className="empty-state">尚无行动意图。14 天内出现两个独立作答根的同类有效问题时，系统会自动安排下一步；也可从目标或问题手动安排。</div>}</div></section>

    <section><h3>已发布事实与待观察项</h3><div className="download-list growth-list">{projection?.findings.map((item) => <div className="download-item" key={item.findingId}><span><strong>{sourceLabels[item.sourceCategory] || item.sourceCategory} · {item.status === 'published' ? '已发布' : item.status === 'disputed' ? '存在冲突' : '待观察'}</strong><small>{item.statement}</small><small>证据置信标签：{item.confidence}</small></span></div>)}{!projection?.findings.length && <div className="empty-state">尚无可发布结论。可以先完成首次基线；证据不足时系统只展示事实和待观察项。</div>}</div></section>
    {message && <div className="notice" role="status">{message}</div>}
  </div>;
}
