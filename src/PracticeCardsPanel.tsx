import React, { useEffect, useRef, useState } from 'react';
import { PracticeRichText } from './PracticeRichText';
import { PracticeFilePreview } from './PracticeFilePreview';
import './practice-cards.css';
const PracticeResourcesPanel = React.lazy(() => import('./PracticeResourcesPanel').then(module => ({ default: module.PracticeResourcesPanel })));
type Plan = { subject: string; range: string; minutes: number; template: string; focus: string; autoEnabled: boolean; reviewPolicy?: string; allowImageReview?: boolean };
export type PracticeApi = {
  practiceAction?: (id: string, action: string, input?: unknown) => Promise<string>;
  onPracticeChanged?: (callback: (payload: string) => void) => () => void;
  getPracticeDashboard?: (id: string) => Promise<string>;
  savePracticePlan?: (id: string, plan: Plan) => Promise<string>;
  generatePracticeCard?: (id: string) => Promise<string>;
  startPracticeCard?: (id: string, cardId: string) => Promise<string>;
  submitPracticeAttempt?: (id: string, cardId: string, input: unknown) => Promise<string>;
  exportPracticeCard?: (id: string, cardId: string, format: string) => Promise<string>;
};
const defaults: Plan = { subject: '自动', range: 'auto', minutes: 10, template: 'clear', focus: '', autoEnabled: false, reviewPolicy: 'agent_auto' };
const states: Record<string, string> = { submitted: '已保存，等待评阅', extracting: '正在识别', reviewing: '正在评阅', awaiting_confirmation: '等待确认', completed: '评阅完成', needs_attention: '需要查看', failed: '处理未完成', cancelled: '已取消处理', legacy: '历史提交，尚未评阅' };
const judgements: Record<string, string> = { correct: '正确', mostly_correct: '基本正确', partial: '部分正确', needs_correction: '需要修正', undetermined: '暂时无法判断' };
export async function unwrap<T = any>(work?: Promise<string>): Promise<T> {
  if (!work) throw Error('此功能需要更新后的 Windows 主机');
  const result = JSON.parse(await work); if (!result.ok) throw Error(result.message || '操作未完成'); return result.data;
}
export async function filePayload(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer()); let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return { name: file.name, base64: btoa(binary) };
}
function Feedback({ result }: { result: any }) {
  if (!result) return null;
  return <div className="pc-feedback"><span className="pc-badge">{result.source === 'human' ? '人工评价' : result.source === 'rule' ? '规则评阅' : 'AI 初评'}</span>
    <h4>本次表现 · {judgements[result.judgement]}</h4><PracticeRichText value={result.summary} />{!!result.correctParts?.length&&<><h4>做对的部分</h4>{result.correctParts.map((part:string,i:number)=><PracticeRichText key={i} value={part}/>)}</>}{result.reviewedAt&&<p className="muted">评价时间：{new Date(result.reviewedAt).toLocaleString()}</p>}
    {!!result.issues?.length && <><h4>需要修改</h4>{result.issues.map((item: string, i: number) => <PracticeRichText key={i} value={item} />)}</>}
    {!!result.suggestions?.length && <><h4>下一步</h4>{result.suggestions.map((item: string, i: number) => <PracticeRichText key={i} value={item} />)}</>}
    {!!result.limitations?.length && <p className="pc-caution">{result.limitations.join('；')}</p>}
  </div>;
}
function AnswerForm({ onSubmit, disabled, parentAttemptId, previewDocx }: { onSubmit: (input: unknown) => Promise<void>; disabled: boolean; parentAttemptId?: string; previewDocx:(file:File)=>Promise<any> }) {
  const [answer, setAnswer] = useState(''), [file, setFile] = useState<File | null>(null), [difficulty, setDifficulty] = useState(''), [confidence, setConfidence] = useState('');
  const [error, setError] = useState(''); const id = useRef(crypto.randomUUID());
  const changed = () => { id.current = crypto.randomUUID(); };
  return <form className="pc-answer" onSubmit={async event => {
    event.preventDefault(); setError('');
    try { await onSubmit({ attemptId: id.current, ...(answer.trim() ? { answer } : {}), ...(file ? { attachment: await filePayload(file) } : {}),
      difficulty: difficulty || null, confidence: confidence ? Number(confidence) : null, parentAttemptId }); setAnswer(''); setFile(null); changed(); }
    catch (e) { setError((e as Error).message); }
  }}>
    <label>我的作答<textarea rows={5} maxLength={10000} value={answer} placeholder="直接输入答案，也可以上传手写作答或文档。" onChange={event => { setAnswer(event.target.value); changed(); }} /></label>
    <label>上传作答文件<input type="file" accept=".png,.jpg,.jpeg,.pdf,.docx,.txt,.md" onChange={event => {
      const selected = event.target.files?.[0]; if (selected && (!selected.size || selected.size > 10 * 1024 * 1024)) { setError('请选择非空且不超过 10 MiB 的文件'); return; }
      setFile(selected || null); setError(''); changed();
    }} /></label>
    {file && <><p>{file.name} · {Math.ceil(file.size / 1024)} KB <button type="button" className="secondary compact" onClick={() => { setFile(null); changed(); }}>移除</button></p><PracticeFilePreview file={file} previewDocx={previewDocx} /></>}
    <details><summary>难度与信心（选填）</summary><div className="pc-fields"><label>这次感觉<select value={difficulty} onChange={e => { setDifficulty(e.target.value); changed(); }}><option value="">暂不填写</option><option value="easy">比较简单</option><option value="right">难度合适</option><option value="hard">有些困难</option></select></label>
      <label>信心<select value={confidence} onChange={e => { setConfidence(e.target.value); changed(); }}><option value="">暂不填写</option>{[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}</select></label></div></details>
    <p className="muted">原件保存在当前学生档案。评阅沿用已授权的 Agent，可能将作答文字发送至该服务；不自动写入成长模型。</p>
    <button disabled={disabled || (!answer.trim() && !file)} type="submit">{disabled ? '正在安全保存…' : parentAttemptId ? '提交修改稿' : '提交作答'}</button>{error && <p role="alert">{error}</p>}
  </form>;
}
export function PracticeCardsPanel({ studentId, api, languageRevision = '', onOpenStudentProfile, initialPublication, onPublicationConsumed }: { studentId: string; api?: PracticeApi; languageRevision?: string; onOpenStudentProfile?: () => void;initialPublication?:any;onPublicationConsumed?:()=>void }) {
  const [tab, setTab] = useState('today'), [workspace, setWorkspace] = useState<any>(null), [plan, setPlan] = useState(defaults), [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState(''), [message, setMessage] = useState(''), [hint, setHint] = useState(''), [reference, setReference] = useState<any>(null);
  const [list, setList] = useState<any>({ items: [], total: 0, page: 1 }), [page, setPage] = useState(1), [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState<any>(null), [preview, setPreview] = useState<any>(null), [revision, setRevision] = useState(false);
  const [note, setNote] = useState(''), [humanJudgement, setHumanJudgement] = useState('');
  const [copyCard, setCopyCard] = useState('');
  useEffect(()=>{if(initialPublication)setTab('resources');},[initialPublication]);
  const [selectedCard,setSelectedCard]=useState(''),[choices,setChoices]=useState<any[]>([]),[original,setOriginal]=useState<any>(null);
  const active = useRef(true), requests = useRef(0), detailRequest = useRef(0), listRequest = useRef(0);
  const action = (name: string, input: unknown = {}) => unwrap(api?.practiceAction?.(studentId, name, input));
  async function refresh() { const version = ++requests.current; const result = await action('workspace',{cardId:selectedCard}); if (active.current && version === requests.current) setWorkspace(result); }
  const previewDocx=async(file:File)=>action('previewDocx',await filePayload(file));
  useEffect(()=>{void refresh().catch(e=>{if(active.current)setMessage(e.message);});},[selectedCard]);
  useEffect(()=>{let cancelled=false;if(tab==='today')void action('cardChoices').then(result=>{if(!cancelled&&active.current)setChoices(result);}).catch(e=>{if(!cancelled&&active.current)setMessage(e.message);});return()=>{cancelled=true;};},[tab,studentId,workspace?.current?.id]);
  async function refreshList() { const version = ++listRequest.current; const result = await action('attempts', { page, status: filter }); if (active.current && version === listRequest.current) setList(result); }
  async function run(key: string, task: () => Promise<void>) { setBusy(key); setMessage(''); try { await task(); } catch (error) { if (active.current) setMessage((error as Error).message); } finally { if (active.current) setBusy(''); } }
  useEffect(() => { active.current = true; void refresh().catch(e => setMessage(e.message)); return () => { active.current = false; requests.current++; detailRequest.current++; listRequest.current++; }; }, [studentId, languageRevision]);
  useEffect(() => { if (tab === 'feedback') void refreshList().catch(e => setMessage(e.message)); }, [tab, page, filter]);
  useEffect(() => api?.onPracticeChanged?.(payload => {
    if (JSON.parse(payload).studentId !== studentId || !active.current) return;
    void refresh().catch(() => {}); if (tab === 'feedback') { void refreshList().catch(() => {}); void refreshDetail().catch(()=>{}); }
  }), [studentId, tab, page, filter, api, selectedCard,detail?.attemptId,detail?.processingStatus]);
  useEffect(() => { if (!workspace?.counts?.processing) return; const timer = setInterval(() => { void refresh().catch(() => {}); if(tab==='feedback'){void refreshList().catch(()=>{});void refreshDetail().catch(()=>{});} }, 5000); return () => clearInterval(timer); }, [workspace?.counts?.processing,selectedCard,tab,page,filter,detail?.attemptId,detail?.processingStatus]);
  useEffect(() => { setHint(''); setReference(null);setOriginal(null); }, [workspace?.current?.id]);
  async function refreshDetail(){if(!detail||!['submitted','extracting','reviewing'].includes(detail.processingStatus))return;const version=detailRequest.current;const result=await action('detail',{attemptId:detail.attemptId});if(active.current&&version===detailRequest.current)setDetail(result);}
  async function openDetail(attemptId: string) {
    const version = ++detailRequest.current; setPreview(null); setRevision(false); setNote('');
    const result = await action('detail', { attemptId }); if (!active.current || version !== detailRequest.current) return;
    setDetail(result); setHumanJudgement(result.reviews.at(-1)?.judgement || 'undetermined');
  }
  const card = workspace?.current, latest = workspace?.latestAttempt;
  return <section className="panel pc-workspace">
    <header className="pc-header"><div><div className="pc-eyebrow">LEARNING CARDS</div><h2>学习卡片</h2><p className="muted">一次专注一个知识点，让每次练习都有下一步。</p></div><button className="secondary" onClick={() => { setPlan(workspace?.plan || defaults); setSettings(!settings); }}>练习设置</button></header>
    <nav className="agent-settings-tabs" aria-label="学习卡片导航">{[['today','今日卡片'],['feedback','作答与反馈'],['resources','卡片资源']].map(([id, name]) => <button key={id} className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => {setTab(id);setMessage('');}}>{name}{id === 'feedback' && workspace?.counts?.pending > 0 ? ` (${workspace.counts.pending})` : ''}</button>)}</nav>
    {settings && <section className="pc-settings"><h3>练习设置</h3><div className="pc-fields">
      <label>学科<select value={plan.subject} onChange={e => setPlan({ ...plan, subject: e.target.value })}>{['自动','数学','语文','英语','物理','化学','生物','历史','地理'].map(v => <option key={v}>{v}</option>)}</select></label>
      <label>复习范围<select value={plan.range} onChange={e => setPlan({ ...plan, range: e.target.value })}>{[['auto','自动'],['today','今日'],['week','本周'],['month','本月']].map(([v,n]) => <option value={v} key={v}>{n}</option>)}</select></label>
      <label>练习时长<input type="number" min={5} max={15} value={plan.minutes} onChange={e => setPlan({ ...plan, minutes: Number(e.target.value) })} /></label>
      <label>评阅模式<select value={plan.reviewPolicy || 'agent_auto'} onChange={e => setPlan({ ...plan, reviewPolicy: e.target.value })}><option value="agent_auto">Agent 自动评阅</option><option value="human_confirm">人工确认后生效</option></select></label>
      <label>模板<select value={plan.template} onChange={e => setPlan({ ...plan, template: e.target.value })}><option value="clear">清晰课堂</option><option value="warm">温暖陪伴</option><option value="mono">黑白练习</option></select></label>
      <label>近期练习目标（选填）<input maxLength={200} value={plan.focus} onChange={e => setPlan({ ...plan, focus: e.target.value })} /></label>
    </div><label><span><input type="checkbox" checked={plan.allowImageReview === true} onChange={e => setPlan({ ...plan, allowImageReview: e.target.checked })} /> 允许已授权 Agent 接收本学生的作答照片进行视觉核对</span></label><p className="muted">照片可能包含个人信息；未开启时仅进行本机 OCR。手写公式、模糊或图形作业不强行评判。语言继承学生资料。设置只影响之后的提交；答案正确不等于稳定掌握。</p><div className="actions"><button disabled={!!busy} onClick={() => void run('settings', async () => { await unwrap(api?.savePracticePlan?.(studentId, plan)); await refresh(); setSettings(false); })}>保存设置</button><button className="secondary" onClick={onOpenStudentProfile}>学生语言设置</button></div></section>}
    {message && <p className="notice" role="status">{message}</p>}
    {tab === 'today' && <>
      <label>查看已有／历史卡片<select aria-label="选择已有卡片" value={selectedCard} onChange={e=>setSelectedCard(e.target.value)}><option value="">当前卡片</option>{choices.map(item=><option key={item.id} value={item.id}>{item.title} · {item.status==='completed'?'已提交':item.status==='started'?'进行中':item.status==='superseded'?'已替换·只读':'可查看'}{item.createdAt?` · ${new Date(item.createdAt).toLocaleDateString()}`:''}</option>)}</select></label>
      <div className="pc-toolbar"><button disabled={!!busy} onClick={() => void run('generate', async () => { const result = await unwrap(api?.generatePracticeCard?.(studentId)); setSelectedCard(''); await refresh(); if (active.current) setMessage(result.message || '新卡已就绪。'); })}>{busy === 'generate' ? '正在根据学情生成…' : '根据学情生成卡片'}</button><button className="secondary" onClick={() => void run('refresh', refresh)}>刷新</button></div>
      {!workspace ? <p role="status">正在读取学习卡片…</p> : !card ? <div className="pc-empty"><h3>从一张卡开始</h3><p>已有学习报告或学习证据时，可直接生成个性化练习，无需先设置计划。</p><button className="secondary" onClick={() => setTab('resources')}>浏览卡片资源</button></div> : <article style={{fontSize:card.layout?.fontSize,borderTopColor:card.template==='mono'?'#111':card.layout?.accent}} className={`pc-paper pc-${card.template || 'clear'}`} lang={card.languagePolicy?.instructionLanguage || 'zh-CN'}>
        {card.status==='superseded'&&<p className="pc-caution">这是一张已替换的历史卡片，仍可查看、打印或保存副本，不改变当前练习。</p>}<div className="pc-eyebrow">{card.content.subject} · {card.content.knowledgePoint} · 约 {card.content.minutes} 分钟</div><h3>{card.content.title}</h3><p className="muted">{card.content.rationale}</p><PracticeRichText value={card.content.prompt} />
        {card.resourceType==='document'&&<button className="secondary" onClick={()=>void run('original',async()=>{const id=card.id;const file=await action('resourceHistoricalFile',{cardId:id});if(active.current)setOriginal({cardId:id,...file});})}>查看原版文件（如有）</button>}{original?.cardId===card.id&&<PracticeFilePreview payload={original}/>}
        <button className="secondary" onClick={()=>{setCopyCard(card.id);setTab('resources');}}>保存为可编辑卡片副本</button>
        <details className="pc-output"><summary>导出与打印</summary><p className="muted">默认仅含题目和空白作答区，不含参考答案、个人作答或学情依据。</p><div className="actions">{[['png','分享图片'],['pdf','导出 PDF'],['print','打印']].map(([format, label]) => <button className="secondary" key={format} disabled={!!busy} onClick={() => void run('export', async () => { setMessage(format==='print'?'正在准备打印预览，请选择本机打印机。':'正在准备导出文件…'); const result = await unwrap(api?.exportPracticeCard?.(studentId, card.id, format)); setMessage(result.pending ? '打印回执尚未确认，请检查 Windows 打印队列，避免重复打印。' : result.cancelled ? '已取消。' : result.printed ? '已交给系统打印队列，请检查打印机输出。' : result.openedPDF ? 'PDF 已打开，可在阅读器中打印。' : '文件已导出。'); })}>{label}</button>)}</div></details>
        {card.status === 'ready' && (!card.purpose || card.purpose === 'practice') && <button disabled={!!busy} onClick={() => void run('start', async () => { await unwrap(api?.startPracticeCard?.(studentId, card.id)); await refresh(); })}>开始练习</button>}
        {card.status === 'started' && <><div className="actions"><button className="secondary" onClick={() => void run('hint', async () => { const result = await action('assistance', { cardId: card.id, kind: 'hint' }); setHint(result.hint || '先写下已知条件，再明确问题。'); })}>需要一点提示</button></div>{hint && <div className="pc-hint"><PracticeRichText value={hint} /></div>}
          <AnswerForm previewDocx={previewDocx} key={card.id} disabled={busy === 'submit'} onSubmit={async input => { setBusy('submit'); try { await unwrap(api?.submitPracticeAttempt?.(studentId, card.id, input)); await refresh(); if (active.current) setMessage('作答已安全保存，正在后台分析。可以继续其他操作，结果不会自动更新成长模型。'); } finally { if (active.current) setBusy(''); } }} /></>}
        {latest?.attemptId && <section className="pc-current-feedback"><p className="pc-badge">本次练习已提交 · {states[latest.processingStatus] || '尚未评阅'}</p><Feedback result={latest.feedbackSummary} /><button className="secondary" onClick={() => void run('detail', async () => { await openDetail(latest.attemptId); setTab('feedback'); })}>原件、完整反馈与修改稿</button></section>}
        {card.status === 'completed' && <details onToggle={event => { if (event.currentTarget.open && !reference) void run('reference', async () => setReference(await action('assistance', { cardId: card.id, kind: 'answer' }))); }}><summary>参考答案与解析（不是本次评阅结果）</summary><PracticeRichText value={reference?.answer} /><PracticeRichText value={reference?.explanation} /></details>}
      </article>}
    </>}
    {tab === 'feedback' && <div className="pc-feedback-layout"><section><div className="pc-toolbar"><label>作答状态<select value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }}>{[['all','全部记录'],['processing','处理中'],['pending','待确认'],['completed','已完成'],['attention','需要查看'],['failed','处理失败／已取消'],['legacy','历史提交']].map(([v,n]) => <option key={v} value={v}>{n}</option>)}</select></label><button className="secondary" onClick={() => void run('list', refreshList)}>刷新</button></div>
      {!list.items.length && <p className="pc-empty">暂无符合条件的作答。</p>}
      {list.items.map((item: any) => <button className={`pc-attempt-row ${detail?.attemptId === item.attemptId ? 'selected' : ''}`} key={item.attemptId} onClick={() => void run('detail', () => openDetail(item.attemptId))}><strong>{item.title || '历史练习'}</strong><span>{item.subject} · {new Date(item.submittedAt).toLocaleString()}</span><span>{item.attachment?.name || '文字作答'}{item.parentAttemptId ? ' · 修改稿' : ''}</span><span className="pc-badge">{states[item.processingStatus]}</span></button>)}
      <div className="pc-pagination"><button disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button><span>{page} / {Math.max(1, Math.ceil(list.total / 20))} · 共 {list.total} 次提交</span><button disabled={page * 20 >= list.total} onClick={() => setPage(page + 1)}>下一页</button></div></section>
      <section className="pc-detail">{!detail ? <p className="muted">选择一次作答，查看原件与反馈。</p> : <><h3>{detail.title || '作答详情'}</h3><p>{states[detail.processingStatus]} · 难度：{({ easy:'比较简单', right:'合适', hard:'困难' } as any)[detail.difficulty] || '未知'} · 信心：{detail.confidence ?? '未知'}</p><p className="muted">{detail.assistance?.hintViewedAt ? '曾查看提示；' : ''}{detail.parentAttemptId ? '根据反馈修改；' : ''}独立程度未确认。{detail.learningStatus === 'applied' ? '已记入知识点跟踪，不代表稳定掌握。' : detail.learningStatus === 'unmapped' ? '知识点尚未可靠映射，反馈已保留。' : '尚未应用到知识点跟踪。'}成长模型未改变。</p>
        <section className="pc-next-step" aria-label="下一步处理"><h4>下一步</h4><p>{detail.recovery?.message||'可以查看原件或重新分析本次作答。'}</p><div className="actions">{['submitted','extracting','reviewing'].includes(detail.processingStatus)?<button className="secondary" disabled={!!busy} onClick={()=>void run('cancel',async()=>{await action('cancel',{attemptId:detail.attemptId});await openDetail(detail.attemptId);await refreshList();})}>取消本次处理</button>:<button disabled={!!busy||detail.recovery?.canReview===false} onClick={()=>void run('retry',async()=>{await action('retry',{attemptId:detail.attemptId});await openDetail(detail.attemptId);await refreshList();await refresh();})}>{detail.processingStatus==='legacy'?'开始评阅':'重新识别与评阅'}</button>}<button className="secondary" disabled={!!busy||detail.recovery?.canRevise===false||['submitted','extracting','reviewing'].includes(detail.processingStatus)} onClick={()=>setRevision(!revision)}>{revision?'收起修改稿':'改为文字作答／提交修改稿'}</button>{detail.recovery?.canReview===false&&<button className="secondary" onClick={()=>setTab('resources')}>去卡片资源补建原题</button>}</div></section>
        {revision && <AnswerForm previewDocx={previewDocx} key={detail.attemptId} parentAttemptId={detail.attemptId} disabled={busy === 'submit'} onSubmit={async input => { setBusy('submit'); try { await unwrap(api?.submitPracticeAttempt?.(studentId, detail.cardId, input)); setRevision(false); await refreshList(); await refresh(); setMessage('修改稿已单独保存，原稿保持不变。'); } finally { if (active.current) setBusy(''); } }} />}
        <button className="secondary" onClick={()=>void run('archive',async()=>{const result=await action('exportAttempt',{attemptId:detail.attemptId});setMessage(result.cancelled?'已取消导出。':'作答、原件和全部反馈已独立导出，请妥善保管个人资料。');})}>导出本次作答存档</button><details open><summary>我的作答原件</summary><PracticeRichText value={detail.body?.answer} />{detail.attachment && <div className="actions"><button className="secondary" onClick={() => void run('preview', async () => { const version=detailRequest.current; const result = await action('attachment', { attemptId: detail.attemptId }); if(active.current&&version===detailRequest.current)setPreview(result); })}>预览 {detail.attachment.name}</button><button className="secondary" onClick={() => void run('save', async () => { await action('saveAttachment', { attemptId: detail.attemptId }); })}>另存原件</button></div>}{preview && <PracticeFilePreview payload={preview} />}</details>
        <Feedback result={detail.reviews.at(-1)} />{detail.error && <p role="alert">{detail.error}</p>}
        {!!detail.extraction && <details><summary>识别正文与限制</summary><PracticeRichText value={detail.extraction.text} /><p>{detail.extraction.warnings?.join('；')}</p></details>}
        <details onToggle={event => { if (event.currentTarget.open) void action('assistance', { cardId: detail.cardId, kind: 'answer' }).catch(() => {}); }}><summary>参考答案与解析</summary><PracticeRichText value={detail.reference?.answer} /><PracticeRichText value={detail.reference?.explanation} /></details>
        {detail.reviews.length > 1 && <details><summary>评阅与人工修订历史（{detail.reviews.length}）</summary>{detail.reviews.map((result: any, i: number) => <div key={i}><p>{result.reviewedAt}</p><Feedback result={result} /></div>)}</details>}
        <details open><summary>本次练习原题（固定版本）</summary>{detail.reference?.prompt?<PracticeRichText value={detail.reference.prompt}/>:<p className="muted">原题未保留；不能根据作答反推题目。请另存原件后补建卡片。</p>}</details>
        {!!detail.reviews.length && <details open={detail.processingStatus === 'awaiting_confirmation'}><summary>确认或修订评价</summary><label>本次表现<select value={humanJudgement} onChange={e => setHumanJudgement(e.target.value)}>{Object.entries(judgements).map(([v,n]) => <option key={v} value={v}>{n}</option>)}</select></label><label>人工修订说明<textarea value={note} maxLength={3000} onChange={e => setNote(e.target.value)} placeholder="若识别不完整，请核对原件后填写依据。" /></label><button disabled={!!busy} onClick={() => void run('confirm', async () => { await action('confirm', { attemptId: detail.attemptId, judgement: humanJudgement, note }); await openDetail(detail.attemptId); await refreshList(); await refresh(); })}>确认并更新知识点跟踪</button></details>}
      </>}</section></div>}
    {tab === 'resources' && <React.Suspense fallback={<p>正在读取卡片资源…</p>}><PracticeResourcesPanel action={action} initialPublication={initialPublication} onPublicationConsumed={onPublicationConsumed} initialCardId={copyCard} onConsumed={()=>setCopyCard('')} onStarted={() => { setCopyCard(''); setSelectedCard(''); setTab('today'); void refresh(); }} /></React.Suspense>}
  </section>;
}
