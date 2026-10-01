import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './planning-research.css';
import { boundedWork } from './bounded-work';
import { Star } from 'lucide-react';
import { usePlanningFavorites, type FavoriteApi } from './planning-favorites';
export type ResearchApi = FavoriteApi & {
  getCompetitionRecommendations?: (id: string) => Promise<string>;
  refreshCompetitionRecommendations?: (id: string) => Promise<string>;
  cancelCompetitionResearch?: (id: string) => Promise<string>;
  saveCompetitionPreferences?: (id: string, json: string) => Promise<string>;
  preparePlanningShare?: (id: string, kind: string) => Promise<string>;
  publishPlanningShare?: (id: string, kind: string, hash: string) => Promise<string>;
};
const labels = { pathways: '升学路径', schools: '择校建议', majors: '专业探索', careers: '职业发展' };
const fields: Record<string, string> = { routeOptions: '路线比较', milestones: '阶段节点', schoolOptions: '院校梯度与匹配', eligibility: '准入要求与缺口', majorOptions: '专业与核心学科', trialCourses: '试学与探索', roleOptions: '岗位职责与能力差距', practiceTasks: '实践验证任务', studentBasis: '本地学生依据', facts: '已查证的互联网事实', inferences: '适配推断（不是确定结论）', missing: '待补充与待核实', conditions: '适用条件', limitations: '限制', alternatives: '备选方案', actions: '近期行动' };
const details = { pathways: ['routeOptions', 'milestones'], schools: ['schoolOptions', 'eligibility'], majors: ['majorOptions', 'trialCourses'], careers: ['roleOptions', 'practiceTasks'] };
type Source = { url: string; title: string; fetchedAt: string; publishedAt: string; official: boolean };
export type GuidanceSections = Record<keyof typeof labels, Record<string, string[]>>;
function Lines({ label, values }: { label: string; values?: string[] }) { return values?.length ? <section className="research-field"><h4>{label}</h4><ul>{values.map((text, i) => <li key={`${i}:${text}`}>{text}</li>)}</ul></section> : null; }
function Sources({ sources }: { sources: Source[] }) { return <section className="material-source-panel"><h3>本模块可核验来源</h3>{sources.map(source => <p key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}{source.official ? ' · 官方' : ''}</a><small>发布/更新：{source.publishedAt || '未提供'} · 抓取：{source.fetchedAt}</small></p>)}</section>; }
export function GuidanceContentPanel({ plan, tab, onTab }: { plan: { version: number; verifiedAt: string; sections?: GuidanceSections | null; findings: string[]; sources: Source[]; reviewAt: string }; tab: string; onTab: (tab: keyof typeof labels) => void }) {
  if (!plan.sections) return <section className="material-source-panel"><h3>旧版尚未分别生成四类规划</h3><p>保留历史版本；请点击“手动更新”生成路线、院校、专业、职业四套独立决策，不再复用同一组通用行动。</p>{tab === 'overview' && <><Lines label="旧版总览" values={plan.findings} /><Sources sources={plan.sources} /></>}</section>;
  if (tab === 'overview') return <><p>版本 {plan.version} · 来源核验：{new Date(plan.verifiedAt).toLocaleString()} · 复核：{new Date(plan.reviewAt).toLocaleDateString()}</p><div className="research-card-grid">{Object.entries(labels).map(([key, label]) => { const section = plan.sections![key as keyof typeof labels]; return <section className="material-source-panel" key={key}><h3>{label}</h3><Lines label={fields[details[key as keyof typeof details][0]]} values={section[details[key as keyof typeof details][0]]} /><Lines label="近期行动" values={section.actions} /><Lines label="仍待核实" values={section.missing} /><button className="secondary compact" onClick={() => onTab(key as keyof typeof labels)}>查看{label}</button></section>; })}</div></>;
  const key = tab as keyof typeof labels, section = plan.sections[key];
  if (!section) return <p>该模块尚无独立研究结果。</p>;
  return <><p>版本 {plan.version} · 本模块只显示自己的依据、决策与引用。</p><div className="research-card-grid">{[...details[key], ...Object.keys(fields).filter(field => !Object.values(details).flat().includes(field))].map(field => <Lines key={field} label={fields[field]} values={section[field]} />)}</div><Sources sources={plan.sources.filter(source => section.sourceUrls.includes(source.url))} /></>;
}
async function read(work?: Promise<string>) { if (!work) throw Error('当前终端未接入此 Windows 主机能力'); return JSON.parse(await work); }
export function PlanningShareButton({ studentId, kind, api, disabled }: { studentId: string; kind: 'topics' | 'guidance'; api?: ResearchApi; disabled?: boolean }) {
  const [preview, setPreview] = useState<{ content: string; name: string; sha256: string } | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const alive = useRef(true), epoch = useRef(0); useEffect(() => { alive.current = true; epoch.current++; setPreview(null); setBusy(false); setMessage(''); return () => { alive.current = false; epoch.current++; }; }, [studentId, kind]);
  async function run(publish: boolean) { const requestEpoch = epoch.current; setBusy(true); setMessage(''); try {
    const result = await boundedWork(read(publish ? api?.publishPlanningShare?.(studentId, kind, preview!.sha256) : api?.preparePlanningShare?.(studentId, kind)), publish ? 75000 : 20000, publish ? '等待上传回执超时，结果尚未确认。请刷新云端其他文档核对；本次不自动重试。' : '分享预览读取超时，请稍后重试；尚未发起上传。');
    if (!alive.current || epoch.current !== requestEpoch) return;
    if (!result.ok) throw Error(result.message);
    if (publish) { setPreview(null); setMessage(result.message); } else setPreview(result);
  } catch (error) { if (alive.current && epoch.current === requestEpoch) setMessage((error as Error).message); } finally { if (alive.current && epoch.current === requestEpoch) setBusy(false); } }
  return <div className="research-share"><button className="secondary compact" disabled={busy || disabled} onClick={() => void run(false)}>{busy ? '处理中…' : '分享至云端其他文档'}</button>{message && <p role="status">{message}</p>}{preview && createPortal(<div className="research-dialog-backdrop" onKeyDown={event => { if (event.key === 'Escape' && !busy) setPreview(null); }}><section className="research-dialog panel" role="dialog" aria-modal="true" aria-label="确认云端分享"><h2>确认分享 {preview.name}</h2><p>上传到当前学生已绑定的云端“其他文档”。接收方须拥有该学生下载许可；不会公开发布或上传原始资料。</p><pre>{preview.content}</pre><div className="panel-heading"><button className="secondary compact" autoFocus disabled={busy} onClick={() => setPreview(null)}>取消</button><button className="primary" disabled={busy} onClick={() => void run(true)}>确认上传此摘要</button></div></section></div>, document.querySelector('.app-shell') || document.body)}</div>;
}
type Competition = { id: string; name: string; category: string; scope: string; organizer: string; officialUrl: string; eligibility: string; deadline: string; season: string; fees: string; status: string; matchReasons: string[]; preparation: string[]; risks: string[]; missing: string[]; sourceUrls: string[] };
type SetVersion = { id: string; version: number; createdAt: string; verifiedAt: string; candidates: Competition[]; limitations: string[]; sources: Source[] };
type CompetitionState = { current: SetVersion | null; versions: SetVersion[]; preferences: { automaticMonthlyCheck: boolean }; latestCheck?: { status: string; checkedAt: string; message?: string }; needsRefresh?: boolean };
function CompetitionCard({ item, sources, saved, disabled, onFavorite, savedAt, version }: {
  item: Competition; sources: Source[]; saved: boolean; disabled: boolean; onFavorite: () => void; savedAt?: string; version?: number;
}) {
  const closed = item.deadline && Date.parse(`${item.deadline}T23:59:59Z`) < Date.now();
  return <article className="material-source-panel"><div className="panel-heading"><h3>{item.name}</h3><button className={`secondary compact ${saved ? 'active' : ''}`} aria-pressed={saved} disabled={disabled} onClick={onFavorite}><Star size={15} />{saved ? '取消收藏' : '收藏'}</button></div>
    {savedAt && <p className="favorite-version">收藏于 {new Date(savedAt).toLocaleString()} · 原版本 {version}</p>}
    <p>{item.organizer} · {item.scope === 'domestic' ? '国内' : '国际'} · {item.category === 'science_innovation' ? '科创' : '社会实践'}</p>
    <p>{closed ? '该届已截止，仅作下届准备参考' : '资格仍须逐项核实，推荐不等于可报名'} · 截止：{item.deadline || '尚未核实'} · 届别：{item.season || '待核实'}</p><p>资格：{item.eligibility}</p><p>费用：{item.fees || '待核实'}</p>
    <Lines label="学生适配推断" values={item.matchReasons} /><Lines label="准备行动" values={item.preparation} /><Lines label="安全、伦理与费用风险" values={item.risks} /><Lines label="待核实" values={item.missing} /><Sources sources={sources} />
  </article>;
}
export function CompetitionRecommendationsPanel({ studentId, api }: { studentId: string; api?: ResearchApi }) {
  const [data, setData] = useState<CompetitionState | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [scope, setScope] = useState('all'), [category, setCategory] = useState('all'), [view, setView] = useState<'recommendations' | 'favorites'>('recommendations');
  const favorites = usePlanningFavorites<Competition>(studentId, 'competitions', api);
  const epoch = useRef(0); useEffect(() => { epoch.current++; setData(null); setView('recommendations'); setScope('all'); setCategory('all'); void run('load'); return () => { epoch.current++; }; }, [studentId]);
  async function run(action: 'load' | 'refresh' | 'settings', enabled?: boolean) {
    const requestEpoch = epoch.current; setBusy(true); setMessage('');
    try {
      const result = await read(action === 'refresh' ? api?.refreshCompetitionRecommendations?.(studentId) : action === 'settings' ? api?.saveCompetitionPreferences?.(studentId, JSON.stringify({ automaticMonthlyCheck: enabled })) : api?.getCompetitionRecommendations?.(studentId));
      if (epoch.current === requestEpoch) { if (result.current !== undefined) setData(result); setMessage(result.message || (!result.ok ? '读取失败' : '')); }
    } catch (error) { if (epoch.current === requestEpoch) setMessage((error as Error).message); } finally { if (epoch.current === requestEpoch) setBusy(false); }
  }
  async function cancel() { const requestEpoch = epoch.current; try { const result = await read(api?.cancelCompetitionResearch?.(studentId)); if (epoch.current === requestEpoch) setMessage(result.message); } catch (error) { if (epoch.current === requestEpoch) setMessage((error as Error).message); } }
  const rows = view === 'favorites' ? favorites.items.map(saved => ({ item: saved.candidate, sources: saved.sources, versionId: saved.versionId, savedAt: saved.savedAt, version: saved.version })) : (data?.current?.candidates || []).map(item => ({ item, sources: data!.current!.sources.filter(source => item.sourceUrls.includes(source.url)), versionId: data!.current!.id, savedAt: undefined, version: data!.current!.version }));
  const filtered = rows.filter(({ item }) => (scope === 'all' || item.scope === scope) && (category === 'all' || item.category === category));
  function changeView(next: typeof view) { setView(next); setScope('all'); setCategory('all'); }
  return <section className="panel planning-panel"><div className="panel-heading"><div><h2>推荐比赛</h2><p>结合兴趣、学科特长、升学/职业方向、已确认成长证据与项目经历研究，不自动报名。</p></div><div><button className="primary compact" disabled={busy} onClick={() => void run('refresh')}>{busy ? '研究处理中…' : '手动搜索更新'}</button>{busy && <button className="secondary compact" onClick={() => void cancel()}>取消研究</button>}</div></div>
    <nav className="planning-favorites-nav" aria-label="比赛推荐与收藏"><button className={`secondary compact ${view === 'recommendations' ? 'active' : ''}`} aria-pressed={view === 'recommendations'} onClick={() => changeView('recommendations')}>比赛推荐</button><button className={`secondary compact ${view === 'favorites' ? 'active' : ''}`} aria-pressed={view === 'favorites'} onClick={() => changeView('favorites')}>我的收藏比赛（{favorites.items.length}）</button><button className="secondary compact" disabled={favorites.busy} onClick={() => void favorites.load()}>{favorites.busy ? '读取收藏中…' : '刷新收藏'}</button></nav>
    {view === 'recommendations' ? <><p>自动模式：每月日常任务时间后的首次可用调度检查；学生资料实质变化也触发研究。主机仅手动模式、无许可或 Agent 不可用时不发起后台研究。</p><label className="checkbox-line"><input type="checkbox" disabled={busy || !data} checked={data?.preferences.automaticMonthlyCheck ?? true} onChange={event => void run('settings', event.target.checked)} />启用定期比赛研究</label></> : <p className="notice muted">收藏按当前学生保存，保留当时的依据与官方来源。收藏不更新报名资格或截止时间；参赛前请核对官方最新规则，不自动报名。</p>}
    {message && <p className="notice warning-notice" role="status">{message}</p>}{favorites.message && <p className="notice" role="status">{favorites.message}</p>}
    {view === 'recommendations' && data?.latestCheck && <p>最近检查：{new Date(data.latestCheck.checkedAt).toLocaleString()} · {data.latestCheck.status} · {data.latestCheck.message}</p>}
    {view === 'recommendations' && data?.needsRefresh && <p className="notice">学生依据已变化；下方为历史推荐，需要重新研究。</p>}
    <div className="planning-filter-row"><label>地区<select value={scope} onChange={e => setScope(e.target.value)}><option value="all">国内外全部</option><option value="domestic">国内</option><option value="international">国际</option></select></label><label>比赛类型<select value={category} onChange={e => setCategory(e.target.value)}><option value="all">全部</option><option value="science_innovation">科创竞赛</option><option value="social_practice">社会实践竞赛</option></select></label></div>
    {view === 'recommendations' && data?.current && <><p>版本 {data.current.version} · 来源抓取 {new Date(data.current.verifiedAt).toLocaleString()}；历史抓取不等于当前仍可报名。</p><Lines label="研究限制" values={data.current.limitations} /></>}
    <div className="research-card-grid">{filtered.map(row => <CompetitionCard key={row.item.id} item={row.item} sources={row.sources} saved={favorites.items.some(item => item.candidateId === row.item.id)} disabled={favorites.busy || !favorites.ready} onFavorite={() => void favorites.toggle(row.versionId, row.item.id)} savedAt={row.savedAt} version={row.version} />)}</div>
    {!filtered.length && <div className="empty-state"><strong>{view === 'favorites' ? favorites.busy ? '正在读取收藏…' : !favorites.ready ? '收藏暂未读取成功，请点击刷新收藏重试。' : favorites.items.length ? '当前筛选下没有收藏比赛' : '还没有收藏比赛' : data?.current ? '当前筛选下没有比赛推荐' : '尚无经过官方来源核验的比赛推荐'}</strong><span>{view === 'favorites' ? '可在比赛推荐中点击“收藏”，或调整筛选查看已有收藏。' : '调整筛选或点击手动更新。执行器或来源不足时不会生成通用或虚构的比赛。'}</span></div>}
    {view === 'recommendations' && Boolean(data?.versions.length) && <details><summary>历史版本（只读）</summary>{data!.versions.map(version => <details key={version.id}><summary>版本 {version.version} · {new Date(version.createdAt).toLocaleString()}</summary>{version.candidates.map(item => <p key={item.id}>{item.name} · {item.eligibility} · 当时记录截止：{item.deadline || '未核实'} · <a href={item.officialUrl} target="_blank" rel="noreferrer">官方来源</a></p>)}</details>)}</details>}
  </section>;
}
