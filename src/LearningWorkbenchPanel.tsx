import React, { useEffect, useState } from 'react';
import { ArrowRight, BriefcaseBusiness, CircleAlert, FolderKanban, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import './learning-workbench.css';

type Projection = {
  student: { id: string; name: string }; updatedAt: string;
  todayBestAction: { title: string; reason: string; actionKey: string };
  loop: Array<{ key: string; label: string; status: string }>;
  dimensions: Array<{ key: string; label: string; status: string; summary: string }>;
  weeklyActions: Array<{ actionKey?: string; id?: string; title: string; status: string }>;
  focusProject: null | { id: string; name: string; milestone: string; risk: string; reportStatus: string };
  expertConsultation?: { draft?: unknown; authorizationValid?: boolean; reviewed?: boolean };
  expertEntryEnabled?: boolean;
};
type Api = { getLearningWorkbenchProjection?: (studentId: string) => Promise<string> };

export function LearningWorkbenchPanel({ api, studentId, studentName, onPrimaryAction, onProject, onExpert, onMore, onUnavailable }: {
  api?: Api; studentId: string; studentName: string; onPrimaryAction: () => void; onProject: (projectId: string) => void;
  onExpert: () => void; onMore: () => void; onUnavailable?: () => void;
}) {
  const [projection, setProjection] = useState<Projection | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  async function refresh() {
    if (!studentId || !api?.getLearningWorkbenchProjection) { setProjection(null); setLoading(false); return; }
    setLoading(true); setMessage('');
    try {
      const result = JSON.parse(await api.getLearningWorkbenchProjection(studentId));
      if (!result.ok) { if (result.code === 'learning_workbench_disabled') onUnavailable?.(); throw new Error(result.message || '学情工作台加载失败。'); }
      setProjection(result.projection);
    } catch (error) { setMessage(error instanceof Error ? error.message : '学情工作台加载失败。'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, [studentId]);
  if (!studentId) return <section className="panel workbench-empty"><Sparkles size={30} /><h2>先建立或选择学生档案</h2><p>学情工作台严格按学生隔离，不会把其他学生的结论带入当前页面。</p></section>;
  if (loading) return <section className="panel workbench-empty"><RefreshCw className="spin" size={24} /><p>正在汇总 {studentName} 的只读学情工作台…</p></section>;
  if (!projection) return <section className="panel workbench-empty"><CircleAlert size={26} /><p>{message || '暂时无法读取学情工作台。'}</p><button className="secondary" onClick={() => void refresh()}>重试</button></section>;
  return <div className="learning-workbench" aria-label="学情工作台">
    <section className="panel workbench-hero">
      <div><span className="eyebrow">{projection.student.name} · 学情工作台</span><h2>今天最值得推进的一件事</h2><h3>{projection.todayBestAction.title}</h3><p>{projection.todayBestAction.reason}</p>
        <button className="primary" onClick={onPrimaryAction}>{projection.todayBestAction.title}<ArrowRight size={18} /></button></div>
      <aside><ShieldCheck size={22} /><strong>依据边界</strong><span>只汇总已有记录；未知维度保持待观察，不生成总分。</span><small>更新于 {new Date(projection.updatedAt).toLocaleString('zh-CN')}</small></aside>
    </section>
    <section className="panel workbench-loop"><div className="workbench-heading"><div><span className="eyebrow">学习闭环</span><h2>资料如何转化为下一步行动</h2></div><button className="ghost compact" onClick={() => void refresh()}><RefreshCw size={16} />刷新</button></div>
      <ol>{projection.loop.map((step, index) => <li className={step.status} key={step.key}><span>{index + 1}</span><strong>{step.label}</strong><small>{step.status === 'available' ? '已有记录' : step.status === 'waiting' ? '等待补充' : '待观察'}</small></li>)}</ol></section>
    <div className="workbench-main-grid">
      <section className="panel workbench-dimensions"><div className="workbench-heading"><div><span className="eyebrow">五维学情</span><h2>不合成总分的证据摘要</h2></div></div><div className="dimension-grid">{projection.dimensions.map(item => <article key={item.key} className={item.status === 'unknown' ? 'unknown' : ''}><span>{item.label}</span><strong>{item.summary}</strong><small>{item.status === 'unknown' ? '待观察' : '基于现有记录'}</small></article>)}</div></section>
      <section className="panel workbench-actions"><span className="eyebrow">本周行动</span><h2>最多三项，保持可执行</h2>{projection.weeklyActions.length ? <ol>{projection.weeklyActions.map((item, index) => <li key={item.actionKey || item.id || index}><span>{index + 1}</span><strong>{item.title}</strong></li>)}</ol> : <p>暂无行动建议，先完成一次学习反馈。</p>}</section>
    </div>
    <div className="workbench-bottom-grid">
      <section className="panel workbench-project"><FolderKanban size={24} /><div><span className="eyebrow">重点项目</span><h2>{projection.focusProject?.name || '暂无关联项目'}</h2>{projection.focusProject ? <><p>里程碑：{projection.focusProject.milestone}</p><p className="risk">主要风险：{projection.focusProject.risk}</p><button className="secondary" onClick={() => onProject(projection.focusProject!.id)}>查看项目与报告</button></> : <p>可从“项目与成果”建立项目。</p>}</div></section>
      {projection.expertEntryEnabled !== false && <section className="panel workbench-expert"><BriefcaseBusiness size={24} /><div><span className="eyebrow">真人专家</span><h2>请求真人专家解读咨询</h2><p>先核对准备上传的学情范围。点击本身不会上传、创建咨询单或改变授权。</p><button className="primary" onClick={onExpert}>授权上传学情资料<ArrowRight size={18} /></button></div></section>}
    </div>
    <button className="workbench-more" onClick={onMore}>更多快捷入口</button>
  </div>;
}
