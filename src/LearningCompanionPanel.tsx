import React, { useEffect, useMemo, useState } from 'react';
import { Bot, CheckCircle2, Clipboard, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import './learning-companion.css';

type Action = { label: string; summary: string; configMode: 'visual' | 'goal' | 'session' };
type Group = { id: string; label: string; actions: string[] };
type PageState = { student: { id: string; name: string }; selectedTarget: null | { displayName: string; verified: boolean; capabilities: Record<string, boolean> };
  scope: 'conversation' | 'student' | 'project'; project: null | { id: string; name: string }; modeGroups: Group[]; actions: Record<string, Action>; boundary: string };
type Api = { getCompanionLearningPage?: (studentId: string) => Promise<string>;
  copyCompanionLearningPrompt?: (studentId: string, actionId: string, config: Record<string, unknown>) => Promise<string>;
  showQuickCapture?: () => Promise<string> };

export function LearningCompanionPanel({ api, studentId, studentName }: { api?: Api; studentId: string; studentName: string }) {
  const [page, setPage] = useState<PageState | null>(null);
  const [groupId, setGroupId] = useState('study');
  const [actionId, setActionId] = useState('flashcards');
  const [goal, setGoal] = useState('');
  const [difficulty, setDifficulty] = useState('适中');
  const [duration, setDuration] = useState('15分钟');
  const [quantity, setQuantity] = useState('auto');
  const [customQuantity, setCustomQuantity] = useState('');
  const [style, setStyle] = useState('standard');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!studentId || !api?.getCompanionLearningPage) { setPage(null); return; }
    setBusy(true); setMessage('');
    try {
      const result = JSON.parse(await api.getCompanionLearningPage(studentId));
      if (!result.ok) throw new Error(result.message || '学习模式暂不可用。');
      setPage(result);
      const firstGroup = result.modeGroups?.find((item: Group) => item.id === groupId) || result.modeGroups?.[0];
      if (firstGroup && !firstGroup.actions.includes(actionId)) setActionId(firstGroup.actions[0]);
    } catch (error) { setPage(null); setMessage(error instanceof Error ? error.message : '学习模式读取失败。'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, [studentId]);
  const group = page?.modeGroups.find(item => item.id === groupId) || page?.modeGroups[0];
  const action = page?.actions[actionId];
  const scopeLabel = page?.scope === 'student' ? `当前学生：${page.student.name}` : page?.scope === 'project' ? `当前项目：${page.project?.name || '待选择'}` : '当前 Agent 对话';
  const config = useMemo(() => action?.configMode === 'visual'
    ? { quantity, customQuantity, style, goal }
    : action?.configMode === 'goal' ? { goal } : { difficulty, duration, goal }, [action?.configMode, quantity, customQuantity, style, difficulty, duration, goal]);
  async function copyPrompt() {
    if (!page || !action || !api?.copyCompanionLearningPrompt) return;
    setBusy(true); setMessage('');
    try {
      const result = JSON.parse(await api.copyCompanionLearningPrompt(studentId, actionId, config));
      setMessage(result.message || (result.ok ? '提示词已复制。' : '提示词复制失败。'));
    } catch (error) { setMessage(error instanceof Error ? error.message : '提示词复制失败。'); }
    finally { setBusy(false); }
  }
  if (!studentId) return <section className="panel learning-companion-empty"><Sparkles size={28} /><h2>请先选择学生</h2><p>学习模式提示词严格绑定当前学生，不会沿用其他学生范围。</p></section>;
  if (!page) return <section className="panel learning-companion-empty"><Bot size={28} /><h2>{busy ? `正在读取 ${studentName} 的学习模式…` : '学习模式暂不可用'}</h2>{message && <p>{message}</p>}<button className="secondary" onClick={() => void load()} disabled={busy}><RefreshCw size={16} />重试</button></section>;
  return <section className="panel learning-companion-page" aria-label="学习模式">
    <header className="learning-companion-heading"><div><span className="eyebrow">AGENT LEARNING COMPANION</span><h2>{page.student.name} · 学习模式</h2><p>与工具条使用同一套动作、提示词和 Agent 设置；这里只复制提示词，不自动发送，也不自动写回档案。</p></div><button className="secondary compact" onClick={() => void load()} disabled={busy}><RefreshCw size={16} />刷新设置</button></header>
    <div className="learning-companion-context"><span><Bot size={16} /><strong>{page.selectedTarget?.displayName || '通用 Agent'}</strong>{page.selectedTarget?.verified ? ' · 已验证' : ' · 剪贴板模式'}</span><span><ShieldCheck size={16} />{scopeLabel}</span><small>{page.boundary}</small></div>
    <nav className="learning-companion-groups" aria-label="学习模式分类">{page.modeGroups.map(item => <button key={item.id} className={item.id === group?.id ? 'active' : ''} aria-pressed={item.id === group?.id} onClick={() => { setGroupId(item.id); setActionId(item.actions[0]); setMessage(''); }}>{item.label}</button>)}</nav>
    <div className="learning-companion-layout">
      <div className="learning-companion-actions">{(group?.actions || []).map(id => { const item = page.actions[id]; return item ? <button key={id} className={id === actionId ? 'active' : ''} aria-pressed={id === actionId} onClick={() => { setActionId(id); setMessage(''); }}><strong>{item.label}</strong><span>{item.summary}</span></button> : null; })}</div>
      <aside className="learning-companion-config">
        <div><span className="eyebrow">本次设置</span><h3>{action?.label}</h3><p>{action?.summary}</p></div>
        {action?.configMode === 'visual' && <><div className="learning-companion-fields"><label>数量<select value={quantity} onChange={event => setQuantity(event.target.value)}><option value="1">1 张</option><option value="2">2 张</option><option value="auto">自动</option><option value="custom">自定义</option></select></label><label>风格<select value={style} onChange={event => setStyle(event.target.value)}><option value="simple">简洁</option><option value="standard">标准</option><option value="anime">动漫</option></select></label></div>{quantity === 'custom' && <label>自定义数量（1–50 张）<input type="number" min="1" max="50" value={customQuantity} onChange={event => setCustomQuantity(event.target.value)} /></label>}</>}
        {action?.configMode === 'session' && <div className="learning-companion-fields"><label>难度<select value={difficulty} onChange={event => setDifficulty(event.target.value)}><option>基础</option><option>适中</option><option>进阶</option></select></label><label>时长<select value={duration} onChange={event => setDuration(event.target.value)}><option>5分钟</option><option>10分钟</option><option>15分钟</option><option>30分钟</option></select></label></div>}
        <label>本次目标（可选）<textarea maxLength={180} rows={4} value={goal} onChange={event => setGoal(event.target.value)} placeholder="例如：围绕本周正在学习的内容，先诊断理解再给下一步。" /></label>
        <button className="primary" onClick={() => void copyPrompt()} disabled={busy}><Clipboard size={17} />{busy ? '正在准备…' : '复制并开始'}</button>
        {message && <div className="learning-companion-message" role="status"><CheckCircle2 size={16} />{message}</div>}
        <button className="ghost compact" onClick={() => void api?.showQuickCapture?.()}>打开工具条调整目标 Agent 与资料范围</button>
      </aside>
    </div>
  </section>;
}
