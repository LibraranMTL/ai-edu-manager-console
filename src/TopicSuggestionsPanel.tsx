import React, { useState } from 'react';
import { RefreshCw, Star } from 'lucide-react';
import { PlanningShareButton, type ResearchApi } from './PlanningResearchPanels';
import { usePlanningFavorites } from './planning-favorites';

type Topic = {
  id: string; category: 'science_innovation' | 'social_practice'; title: string; realWorldProblem: string; fitReason: string;
  studentEvidence: Array<{ kind: 'fact' | 'inference' | 'missing'; text: string; sourceId?: string }>;
  path: string[]; expectedOutcomes: string[]; durationWeeks: number; difficulty: string; collaboration: string; regionScope: string;
  resourceConditions: string[]; safetyEthics: string[]; feasibility: string; verifyItems: string[];
  freshness: { generatedAt: string; evidenceUpdatedAt: string; internetVerified: boolean };
};
type TopicSet = { id: string; version: number; createdAt: string; candidates: Topic[]; notice: string };
export function TopicSuggestionsPanel({ studentId, studentName, current, busy, message, api, onRefresh, onAdopt, onProfile }: {
  studentId: string; studentName: string; current: TopicSet | null; busy: boolean; message: string; api?: ResearchApi;
  onRefresh: () => void; onAdopt: (topic: Topic, versionId?: string) => Promise<void>; onProfile: () => void;
}) {
  const favorites = usePlanningFavorites<Topic>(studentId, 'topics', api);
  const [view, setView] = useState<'suggestions' | 'favorites'>('suggestions'), [category, setCategory] = useState('all'), [difficulty, setDifficulty] = useState('all');
  const [ignored, setIgnored] = useState<string[]>([]), [compare, setCompare] = useState<string[]>([]);
  const [adoptingId, setAdoptingId] = useState('');
  const candidates = view === 'favorites' ? favorites.items.map(item => item.candidate) : current?.candidates || [];
  const filtered = candidates.filter(item => (view === 'favorites' || !ignored.includes(item.id)) && (category === 'all' || item.category === category) && (difficulty === 'all' || item.difficulty === difficulty));
  function changeView(next: typeof view) { setView(next); setCategory('all'); setDifficulty('all'); setCompare([]); }
  async function adopt(topic: Topic, versionId?: string) {
    if (adoptingId) return;
    setAdoptingId(topic.id);
    try { await onAdopt(topic, versionId); }
    finally { setAdoptingId(''); }
  }
  return <section className="panel planning-panel topic-suggestions-panel">
    <div className="panel-heading"><div><h2>选题建议</h2><p>面向 {studentName} 的科创项目与社会实践候选。事实、推断和缺失信息分别标注。</p></div>
      <div><button className="primary compact" onClick={onRefresh} disabled={busy}><RefreshCw size={16} />{busy ? '更新中…' : '手动更新'}</button><PlanningShareButton studentId={studentId} kind="topics" api={api} disabled={busy || !current} /></div></div>
    <nav className="planning-favorites-nav" aria-label="选题建议与收藏"><button className={`secondary compact ${view === 'suggestions' ? 'active' : ''}`} aria-pressed={view === 'suggestions'} onClick={() => changeView('suggestions')}>推荐选题</button><button className={`secondary compact ${view === 'favorites' ? 'active' : ''}`} aria-pressed={view === 'favorites'} onClick={() => changeView('favorites')}>我的收藏（{favorites.items.length}）</button><button className="secondary compact" disabled={favorites.busy} onClick={() => void favorites.load()}>{favorites.busy ? '读取收藏中…' : '刷新收藏'}</button></nav>
    <div className="planning-filter-row"><label>类型<select value={category} onChange={event => setCategory(event.target.value)}><option value="all">全部</option><option value="science_innovation">科创项目</option><option value="social_practice">社会实践</option></select></label><label>难度<select value={difficulty} onChange={event => setDifficulty(event.target.value)}><option value="all">全部</option>{[...new Set(candidates.map(item => item.difficulty))].map(value => <option key={value} value={value}>{value}</option>)}</select></label><span>{view === 'favorites' ? '收藏版本' : `版本 ${current?.version || 0}`} · 比较 {compare.length}/3</span></div>
    {view === 'favorites' ? <p className="notice muted">收藏按当前学生保存，保留当时版本；不代表最新建议。学生资料变化后，请重新核实适配性再采用。</p> : current?.notice && <div className="notice muted">{current.notice}</div>}
    {message && <div className="notice" role="status">{message}</div>}{favorites.message && <div className="notice" role="status">{favorites.message}</div>}
    <div className="topic-card-grid">{filtered.map(suggestion => {
      const saved = favorites.items.find(item => item.candidateId === suggestion.id);
      return <article className="topic-suggestion-card" key={suggestion.id}>
        <div className="topic-card-kicker"><span>{suggestion.category === 'science_innovation' ? '科创项目' : '社会实践'}</span><em>{suggestion.difficulty} · {suggestion.durationWeeks} 周</em></div><h3>{suggestion.title}</h3>
        {view === 'favorites' && saved && <p className="favorite-version">收藏于 {new Date(saved.savedAt).toLocaleString()} · 原版本 {saved.version}</p>}
        <p>{suggestion.realWorldProblem}</p><div className="evidence-tag-list">{suggestion.studentEvidence.map((item, index) => <span className={`evidence-tag ${item.kind}`} key={`${item.kind}-${index}`}>{item.kind === 'fact' ? '档案事实' : item.kind === 'inference' ? '推断' : '缺失'}：{item.text}</span>)}</div>
        <details><summary>研究/实践路径与成果</summary><ol>{suggestion.path.map(item => <li key={item}>{item}</li>)}</ol><strong>预期成果</strong><p>{suggestion.expectedOutcomes.join('、')}</p></details>
        <details><summary>资源、安全伦理与待核实项</summary><p><strong>资源：</strong>{suggestion.resourceConditions.join('、')}</p><p><strong>安全伦理：</strong>{suggestion.safetyEthics.join('、')}</p><p><strong>待核实：</strong>{suggestion.verifyItems.join('、')}</p></details>
        <div className="topic-card-meta"><span>{suggestion.collaboration}</span><span>{suggestion.regionScope}</span><span>{suggestion.freshness.internetVerified ? '生成时已联网核验' : '生成时未联网核验'}</span></div>
        <div className="actions compact-actions"><button className={`secondary compact ${saved ? 'active' : ''}`} aria-pressed={Boolean(saved)} disabled={favorites.busy || !favorites.ready} onClick={() => void favorites.toggle(saved?.versionId || current?.id || '', suggestion.id)}><Star size={15} />{saved ? '取消收藏' : '收藏'}</button>
          {view === 'suggestions' && <button className="secondary compact" onClick={() => setIgnored(items => [...new Set([...items, suggestion.id])])}>忽略</button>}
          <button className={`secondary compact ${compare.includes(suggestion.id) ? 'active' : ''}`} aria-pressed={compare.includes(suggestion.id)} onClick={() => setCompare(items => items.includes(suggestion.id) ? items.filter(id => id !== suggestion.id) : items.length < 3 ? [...items, suggestion.id] : items)}>比较</button><button className="primary compact" onClick={() => void adopt(suggestion, view === 'favorites' ? saved?.versionId : current?.id)} disabled={Boolean(adoptingId)}>{adoptingId === suggestion.id ? '正在采用…' : '采用'}</button></div>
      </article>;
    })}
      {!filtered.length && <div className="empty-state">{view === 'favorites' ? favorites.busy ? '正在读取收藏…' : !favorites.ready ? '收藏暂未读取成功，请点击刷新收藏重试。' : favorites.items.length ? '当前筛选下没有收藏选题，请调整筛选。' : '还没有收藏选题；请在推荐选题中点击“收藏”。' : current && !current.candidates.length ? '当前学生缺少具体兴趣、目标或项目线索；请补充档案后返回，系统会自动更新。' : '当前筛选下没有候选；可调整筛选或手动更新。'}{view === 'suggestions' && current && !current.candidates.length && <button className="secondary compact" onClick={onProfile}>查看编辑当前学生档案</button>}</div>}
    </div>
    {compare.length > 1 && <section className="topic-compare-board"><h3>候选比较</h3>{candidates.filter(item => compare.includes(item.id)).map(item => <div key={item.id}><strong>{item.title}</strong><span>{item.difficulty} · {item.durationWeeks} 周 · {item.collaboration}</span><small>{item.feasibility}</small></div>)}</section>}
  </section>;
}
