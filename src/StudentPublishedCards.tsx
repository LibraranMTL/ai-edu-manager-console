import React,{useEffect,useRef,useState} from 'react';
import {PracticeRichText} from './PracticeRichText';
import {PracticeFilePreview} from './PracticeFilePreview';
import './publication.css';
type Action=(action:string,input?:any)=>Promise<any>;
const states:Record<string,string>={legacy:'历史提交，尚未评阅',submitted:'已保存，等待评阅',extracting:'正在识别',reviewing:'正在评阅',completed:'评阅完成',awaiting_confirmation:'等待教师或家长确认',needs_attention:'需要查看或修改',failed:'处理未完成',cancelled:'已取消处理'};
function download(payload:any,title:string){const bytes=Uint8Array.from(atob(payload.base64),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes]));const a=document.createElement('a');a.href=url;a.download=payload.name||`${title}${payload.extension}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function StudentPublishedCards({studentId,action}:{studentId:string;action:Action}){
  const [tab,setTab]=useState('resources'),[filter,setFilter]=useState('all'),[subject,setSubject]=useState(''),[search,setSearch]=useState(''),[page,setPage]=useState(1),[status,setStatus]=useState('all');
  const [list,setList]=useState<any>({items:[],total:0,subjects:[]}),[selected,setSelected]=useState<any>(null),[workspace,setWorkspace]=useState<any>(null),[history,setHistory]=useState<any[]>([]),[feedback,setFeedback]=useState<any>(null),[file,setFile]=useState<any>(null);
  const [answer,setAnswer]=useState(''),[upload,setUpload]=useState<File|null>(null),[parent,setParent]=useState(''),[hint,setHint]=useState(''),[difficulty,setDifficulty]=useState(''),[confidence,setConfidence]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const version=useRef(0),alive=useRef(true),pending=useRef<any>(null),chosenCard=useRef('');
  const draftWrites=useRef<Promise<any>>(Promise.resolve()),draftLoaded=useRef('');
  const [draftMessage,setDraftMessage]=useState('');
  const localScope=useRef<Promise<any>|null>(null);
  async function call(name:string,input:any={}){let scopeToken;
    if(name.startsWith('localDraft')){localScope.current ||= action('localDraftContext',{studentId}).then(r=>{if(r?.ok===false)throw Error(r.message);return (r.data??r).scopeToken;});scopeToken=await localScope.current;}
    const result=await action(name,{...input,studentId,...(scopeToken?{scopeToken}:{})});if(result?.ok===false)throw Error(result.message||'操作未完成');if(result?.studentId&&result.studentId!==studentId)throw Error('学生已切换');return result&&Object.prototype.hasOwnProperty.call(result,'data')?result.data:result;}
  async function refresh(){const seq=++version.current;
    if(tab==='resources'){const data=await call('list',{filter,subject,search,page});if(alive.current&&seq===version.current)setList(data);}
    else if(tab==='feedback'){const [data,detail]=await Promise.all([call('attempts',{page,status}),feedback?call('feedback',{attemptId:feedback.attemptId}):Promise.resolve(null)]);if(alive.current&&seq===version.current){setList(data);if(detail)setFeedback(detail);}}
    else {try{const [data,choices]=await Promise.all([call('workspace',{cardId:chosenCard.current||undefined}),call('history')]);if(alive.current&&seq===version.current){setWorkspace(data);setHistory(choices);}}
      catch(error){const drafts=await call('localDraftList');if(!drafts?.length)throw error;if(alive.current&&seq===version.current){const saved=drafts.find((d:any)=>d.card.id===chosenCard.current)||drafts[0];setWorkspace({current:saved.card});setHistory(drafts.map((d:any)=>({...d.card,title:d.card.content.title})));setMessage('主机暂不可达，已打开本机未提交草稿。连接恢复后可提交。');}}}
  }
  async function restoreDraft(current:any){const id=current?.id;if(!id||draftLoaded.current===id)return;draftLoaded.current=id;
    const saved=await call('localDraftLoad',{cardId:id});if(!alive.current||draftLoaded.current!==id)return;
    const s=saved?.submission;pending.current=s?{cardId:id,submission:s}:null;setAnswer(s?.answer||'');setParent(s?.parentAttemptId||'');setDifficulty(s?.difficulty||'');setConfidence(s?.confidence?String(s.confidence):'');
    setUpload(s?.attachment?new File([Uint8Array.from(atob(s.attachment.base64),c=>c.charCodeAt(0))],s.attachment.name):null);
    setDraftMessage(s?'已恢复本机草稿；尚未提交给主机。':'文字和文件将自动保存在本机，收到主机回执后清理。');
  }
  function saveDraft(patch:any){const current=workspace?.current;if(!current)return;
    const base=pending.current?.cardId===current.id?pending.current.submission:{answer,difficulty:difficulty||null,confidence:confidence?Number(confidence):null,...(parent?{parentAttemptId:parent}:{})};
    const submission={...base,...patch,attemptId:crypto.randomUUID()};pending.current={cardId:current.id,submission};setDraftMessage('正在保存本机草稿…');
    const job=draftWrites.current.catch(()=>{}).then(()=>call('localDraftSave',{cardId:current.id,card:current,submission}));draftWrites.current=job;
    void job.then(()=>{if(alive.current&&pending.current?.submission.attemptId===submission.attemptId)setDraftMessage('草稿已保存在本机；尚未提交给主机。');}).catch(e=>{if(alive.current)setDraftMessage(`本机保存失败：${e.message}。请保留原件。`);});
  }
  useEffect(()=>{void restoreDraft(workspace?.current).catch(e=>setDraftMessage(e.message));},[workspace?.current?.id]);
  async function run(work:()=>Promise<void>){if(busy)return;setBusy(true);setMessage('');try{await work();}catch(e){if(alive.current)setMessage((e as Error).message);}finally{if(alive.current)setBusy(false);}}
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;version.current++;};},[]);
  useEffect(()=>{setSelected(null);setFeedback(null);setFile(null);setList({items:[],total:0,subjects:[]});const timer=setTimeout(()=>void refresh().catch(e=>{if(alive.current)setMessage(e.message);}),search?250:0);return()=>{clearTimeout(timer);version.current++;};},[tab,filter,subject,search,page,status,studentId]);
  function switchTab(next:string){setTab(next);setPage(1);setMessage('');}
  async function submit(){const card=workspace?.current;if(!card)return;
    await draftWrites.current;
    if(!pending.current){let attachment;if(upload){if(upload.size>10*1024*1024)throw Error('文件超过 10 MiB');const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('文件读取失败'));reader.readAsDataURL(upload);});attachment={name:upload.name,base64};}
      pending.current={cardId:card.id,submission:{attemptId:crypto.randomUUID(),answer,attachment,difficulty:difficulty||null,confidence:confidence?Number(confidence):null,...(parent?{parentAttemptId:parent}:{})}};
    }
    const payload=pending.current;await call('localDraftSave',{cardId:card.id,card,submission:payload.submission});
    const receipt=await call('submit',payload);if(!receipt.saved||receipt.attemptId!==payload.submission.attemptId)throw Error('尚未收到匹配的主机回执，本机草稿保留，请重试核对。');
    await call('localDraftClear',{cardId:card.id,attemptId:payload.submission.attemptId});pending.current=null;setAnswer('');setUpload(null);setParent('');setDraftMessage('主机已确认收到，本机草稿已清理。');setWorkspace(await call('workspace',{cardId:card.id}));setMessage('作答已安全保存，正在等待评阅。可以继续浏览，稍后刷新反馈。');
  }
  function output(target:any){return <div className="actions">{[['print','在本机打印'],['pdf','导出 PDF']].map(([format,label])=><button key={format} disabled={busy} onClick={()=>void run(async()=>{const result=await call('export',{...target,format});setMessage(result.pending?'打印回执尚未确认，请检查 Windows 打印队列，避免重复打印。':result.cancelled?'已取消。':result.printed?'已提交本机打印队列，请检查出纸。':result.openedPDF?'PDF 已打开，可在阅读器中打印。':'PDF 已导出。');})}>{label}</button>)}</div>;}
  async function original(historical=false){const data=await call(historical?'historicalFile':'file',historical?{cardId:workspace.current.id}:{key:selected.key});setFile(data);return data;}
  const card=workspace?.current,review=feedback?.reviews?.at(-1);
  return <section className="student-publications"><header><div><h3>学习卡片</h3><p>查看机构发布的卡片，练习后跟踪反馈。</p></div><button disabled={busy} onClick={()=>void run(refresh)}>刷新</button></header>
    <nav aria-label="学习卡片导航">{[['resources','卡片资源'],['practice','我的练习'],['feedback','作答与反馈']].map(([v,n])=><button key={v} disabled={busy} aria-pressed={tab===v} onClick={()=>switchTab(v)}>{n}</button>)}</nav>
    {message?<p role="status">{message}</p>:null}
    {tab==='resources'?<><div className="publication-filters"><label>来源<select value={filter} onChange={e=>{setFilter(e.target.value);setPage(1);}}><option value="all">全部可用</option><option value="recommended">推荐</option><option value="mine">我的收藏</option></select></label><label>学科<select value={subject} onChange={e=>{setSubject(e.target.value);setPage(1);}}><option value="">全部学科</option>{list.subjects?.map((s:string)=><option key={s}>{s}</option>)}</select></label><label>搜索<input value={search} maxLength={100} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></label></div>
      <div className="publication-list">{list.items.map((item:any)=><article key={item.key}><div><small>{item.subject} · {item.publisherName} · v{item.version}</small><h4>{item.title}</h4></div><button disabled={busy} onClick={()=>void run(async()=>{setFile(null);setSelected(await call('detail',{key:item.key}));})}>查看卡片</button></article>)}</div>
      {!list.items.length?<p>当前没有符合条件的卡片。机构发布后，点击刷新即可查看。</p>:null}
      {selected?<section><article className="pc-paper"><h4>{selected.content.title}</h4><PracticeRichText value={selected.content.prompt}/>{selected.purpose==='blank'?<p>空白书写卡：打开原件后可另存或打印书写。</p>:null}</article>
        {output({key:selected.key})}
        {selected.type==='document'?<><button disabled={busy} onClick={()=>void run(async()=>{await original();})}>预览原版文件</button><button disabled={busy} onClick={()=>void run(async()=>download(await original(),selected.content.title))}>另存原版文件</button><p>原版文件按作者版式提供，可能自带答案。</p></>:null}{file?<PracticeFilePreview payload={file}/>:null}
        {selected.canPractice===false?<p>此原版练习尚未补齐评阅依据，可预览和另存；请联系发布者补充。</p>:null}<button disabled={busy||selected.canPractice===false} onClick={()=>void run(async()=>{const value=await call('startResource',{key:selected.key});chosenCard.current=value.card.id;setWorkspace({current:value.card});draftLoaded.current='';await restoreDraft(value.card);switchTab('practice');})}>{selected.purpose==='practice'?'开始练习':'打开卡片'}</button><button disabled={busy} onClick={()=>void run(async()=>{await call('save',{key:selected.key});setMessage('已保存到我的收藏。');})}>保存到我的收藏</button>
      </section>:null}</>:null}
    {tab==='practice'?<><label>当前／历史卡片<select value={card?.id||''} disabled={busy} onChange={e=>void run(async()=>{chosenCard.current=e.target.value;const value=await call('workspace',{cardId:e.target.value});setWorkspace(value);setFile(null);setHint('');draftLoaded.current='';await restoreDraft(value.current);})}><option value="">选择卡片</option>{history.map(c=><option key={c.id} value={c.id}>{c.title} · {c.status==='completed'?'已提交':c.status==='started'?'正在作答':'可查看'}</option>)}</select></label>
      {card?<><article className="pc-paper"><h4>{card.content.title}</h4><PracticeRichText value={card.content.prompt}/></article>
        {output({cardId:card.id})}
        {card.resourceType==='document'?<><button disabled={busy} onClick={()=>void run(async()=>{await original(true);})}>查看固定版本原件</button><button disabled={busy} onClick={()=>void run(async()=>download(await original(true),card.content.title))}>另存原件</button>{file?<PracticeFilePreview payload={file}/>:null}</>:null}
        {(!card.purpose||card.purpose==='practice')&&card.status==='ready'?<button disabled={busy} onClick={()=>void run(async()=>{await call('start',{cardId:card.id});setWorkspace(await call('workspace',{cardId:card.id}));})}>开始这张练习</button>:null}
        {(!card.purpose||card.purpose==='practice')&&(card.status==='started'||parent)?<><button disabled={busy} onClick={()=>void run(async()=>{const value=await call('assistance',{cardId:card.id,kind:'hint'});setHint(value.hint||'暂无提示');})}>需要一点提示</button>{hint?<PracticeRichText value={hint}/>:null}
          <label>我的作答<textarea disabled={busy} aria-label="我的作答" value={answer} maxLength={10000} onChange={e=>{setAnswer(e.target.value);saveDraft({answer:e.target.value});}}/></label>
          <label>上传作答（选填）<input disabled={busy} type="file" accept=".png,.jpg,.jpeg,.pdf,.txt,.md,.docx" onChange={e=>{const f=e.target.files?.[0];void run(async()=>{if(f&&f.size>10*1024*1024)throw Error('文件超过 10 MiB');let attachment;if(f){const base64=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(Error('文件读取失败'));r.readAsDataURL(f);});attachment={name:f.name,base64};}setUpload(f||null);saveDraft({attachment});await draftWrites.current;});}}/></label>{upload?<><p>本机草稿文件：{upload.name}</p><PracticeFilePreview file={upload}/></>:null}
          <p role="status">{draftMessage}</p>
          <details><summary>难度与信心（选填）</summary><label>难度<select disabled={busy} value={difficulty} onChange={e=>{setDifficulty(e.target.value);saveDraft({difficulty:e.target.value||null});}}><option value="">未填写</option><option value="easy">简单</option><option value="right">合适</option><option value="hard">较难</option></select></label><label>信心<select disabled={busy} value={confidence} onChange={e=>{setConfidence(e.target.value);saveDraft({confidence:e.target.value?Number(e.target.value):null});}}><option value="">未填写</option>{[1,2,3,4,5].map(v=><option key={v}>{v}</option>)}</select></label></details>
          <button disabled={busy||(!answer.trim()&&!upload)} onClick={()=>void run(submit)}>{busy?'正在保存…':parent?'提交修改稿':'提交作答'}</button><p>主机收到后才显示已保存；连接失败时保留当前输入，可再次提交核对。</p></>:null}
        {workspace.latestAttempt?.attemptId?<div className="publication-feedback"><strong>{states[workspace.latestAttempt.processingStatus]||'历史提交，尚未评阅'}</strong><PracticeRichText value={workspace.latestAttempt.feedbackSummary?.summary}/><button disabled={busy} onClick={()=>{switchTab('feedback');}}>查看作答与反馈</button></div>:null}
        {card.purpose&&card.purpose!=='practice'?<p>这张卡片用于{card.purpose==='knowledge'?'知识讲解':'空白书写'}，无需提交评分。</p>:null}
      </>:<p>从卡片资源选择一张开始，也可以查看已有练习。</p>}</>:null}
    {tab==='feedback'?<><label>处理状态<select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}>{[['all','全部记录'],['processing','处理中'],['pending','待确认'],['completed','已完成'],['attention','需要修改'],['failed','处理失败'],['legacy','历史未评阅']].map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></label>
      <div className="publication-list">{list.items.map((item:any)=><article key={item.attemptId}><div><h4>{item.title}</h4><small>{states[item.processingStatus]||'尚未评阅'} · {new Date(item.submittedAt).toLocaleString()}</small></div><button disabled={busy} onClick={()=>void run(async()=>{setFile(null);setFeedback(await call('feedback',{attemptId:item.attemptId}));})}>查看反馈</button></article>)}</div>
      {feedback?<section className="publication-feedback"><h4>{feedback.title}</h4><p>{states[feedback.processingStatus]}</p><p>{feedback.error}</p><p>{feedback.processingStatus==='awaiting_confirmation'?'反馈等待教师或家长在主机确认。':feedback.recovery?.message}</p><h4>我的作答</h4><PracticeRichText value={feedback.body?.answer}/>
        {feedback.attachment?<><button disabled={busy} onClick={()=>void run(async()=>setFile(await call('attachment',{attemptId:feedback.attemptId})))}>预览作答原件</button><button disabled={busy} onClick={()=>void run(async()=>download(await call('attachment',{attemptId:feedback.attemptId}),'作答'))}>另存作答原件</button>{file?<PracticeFilePreview payload={file}/>:null}</>:null}
        {review?<><h4>{review.source==='human'?'人工确认结果':review.source==='rule'?'规则评阅':'AI 初评'}</h4><PracticeRichText value={review.summary}/>{[['correctParts','做对的部分'],['issues','需要修改'],['suggestions','下一步'],['limitations','无法确认']].map(([key,label])=>review[key]?.length?<section key={key}><strong>{label}</strong><ul>{review[key].map((text:string,i:number)=><li key={i}><PracticeRichText value={text}/></li>)}</ul></section>:null)}</>:null}
        <details onToggle={e=>{if(e.currentTarget.open)void call('assistance',{cardId:feedback.cardId,kind:'answer'}).catch(()=>{});}}><summary>原题与参考答案（不是本次评阅）</summary><PracticeRichText value={feedback.reference?.prompt}/><PracticeRichText value={feedback.reference?.answer}/><PracticeRichText value={feedback.reference?.explanation}/></details>
        {feedback.recovery?.canReview&&['legacy','failed','cancelled','needs_attention'].includes(feedback.processingStatus)?<button disabled={busy} onClick={()=>void run(async()=>{await call('retry',{attemptId:feedback.attemptId});setFeedback(await call('feedback',{attemptId:feedback.attemptId}));setMessage('已请求主机评阅，可以继续其他操作。');})}>{feedback.processingStatus==='legacy'?'开始评阅':'重新识别与评阅'}</button>:null}
        {feedback.recovery?.canRevise?<button disabled={busy} onClick={()=>void run(async()=>{const value=await call('workspace',{cardId:feedback.cardId});chosenCard.current=feedback.cardId;draftLoaded.current=feedback.cardId;const submission={attemptId:crypto.randomUUID(),answer:feedback.body?.answer||'',parentAttemptId:feedback.attemptId,difficulty:null,confidence:null};await call('localDraftSave',{cardId:feedback.cardId,card:value.current,submission});pending.current={cardId:feedback.cardId,submission};switchTab('practice');setWorkspace(value);setParent(feedback.attemptId);setAnswer(submission.answer);setUpload(null);setDifficulty('');setConfidence('');setDraftMessage('修改稿已保存在本机。');})}>提交修改稿</button>:null}
      </section>:null}</>:null}
    {tab!=='practice'?<div className="publication-pagination"><button disabled={page<=1||busy} onClick={()=>setPage(p=>p-1)}>上一页</button><span>{page} / {Math.max(1,Math.ceil(list.total/20))}</span><button disabled={page*20>=list.total||busy} onClick={()=>setPage(p=>p+1)}>下一页</button></div>:null}
  </section>;
}
