'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const { checkResource, teachingContent, digest, MAX_BYTES } = require('./card-resource-package.cjs');
const { putObject, readObject, scopedFile, hash } = require('./practice-files.cjs');
const { runCardPackageWorker } = require('./card-package-worker.cjs');
const { hasCapability } = require('./license-entitlements.cjs');
const { builtinResources } = require('./card-builtin-resources.cjs');
const { normalizeAudience, audienceAllows, audienceCount } = require('./publication-policy.cjs');
function cardCapabilities(license){return { use:hasCapability(license,'course_learning'),institution:hasCapability(license,'tenant_course_manage'),platform:hasCapability(license,'platform_course_publish') };}
function summary(resource, objectRef, extra={}) { return {key:resource.key,publisherId:resource.publisherId,cardId:resource.cardId,version:resource.version,
  title:resource.content.title,subject:resource.content.subject,knowledgePoint:resource.content.knowledgePoint,purpose:resource.purpose,type:resource.type,scope:resource.scope,
  status:resource.status,language:resource.languagePolicy.instructionLanguage,grade:resource.grade,publisherName:resource.publisherName,contentHash:resource.contentHash,objectRef,...extra}; }
function visible(resource, student, index){
  if(resource.status!=='published')return false;
  if(resource.scope==='personal')return resource.ownerStudentId===student.id;
  const assignment=index.assignments[`${resource.publisherId}:${resource.cardId}`];
  const latest=latestVersions(index.resources).find(r=>r.publisherId===resource.publisherId&&r.cardId===resource.cardId);
  if(latest?.status==='withdrawn')return false;
  return assignment ? audienceAllows(assignment,student) : !resource.audienceRequired;
}
function latestVersions(resources){const map=new Map();for(const r of resources){const key=`${r.publisherId}:${r.cardId}`;if(!map.has(key)||map.get(key).version<r.version)map.set(key,r);}return [...map.values()];}
function createCardResources({ directory, license, student, students, instantiate, personalCard }) {
  let queue=Promise.resolve();const contents=new Map();
  const capabilities=()=>cardCapabilities(license());
  function access(scope){const caps=capabilities();if(!caps.use)throw Error('需要有效授权');if(scope==='institution'&&!caps.institution)throw Error('机构卡片发布需要专业版、机构版或平台版');if(scope==='platform'&&!caps.platform)throw Error('平台卡片发布需要平台版');return caps;}
  async function load(){
    await fs.mkdir(directory,{recursive:true});if((await fs.lstat(directory)).isSymbolicLink())throw Error('资源目录不能使用链接');
    const file=await scopedFile(directory,'index','catalog.json',true);let index;
    try{index=JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;index={schema:'edu-manager.card-resources.v1',publisherId:`host-${crypto.randomUUID()}`,resources:[],drafts:[],assignments:{},favorites:{}};}
    if(index.schema!=='edu-manager.card-resources.v1'||!Array.isArray(index.resources)||!Array.isArray(index.drafts)||!index.publisherId)throw Error('卡片资源索引无效，停止修改');
    return {index,file};
  }
  function change(operation){const next=queue.catch(()=>{}).then(async()=>{const {index,file}=await load();const result=await operation(index);const temporary=path.join(path.dirname(file),`${crypto.randomUUID()}.tmp`);try{await fs.copyFile(file,path.join(path.dirname(file),'catalog.before-0.20.2.json'),require('node:fs').constants.COPYFILE_EXCL);}catch(error){if(!['ENOENT','EEXIST'].includes(error.code))throw error;}try{await fs.writeFile(temporary,JSON.stringify(index),{flag:'wx',mode:0o600});await fs.rename(temporary,file);}finally{await fs.rm(temporary,{force:true});}return result;});queue=next;return next;}
  async function initialize(){return change(async index=>{for(const card of builtinResources()){if(index.resources.some(r=>r.key===card.key))continue;const objectRef=await putObject(directory,'resources',card);index.resources.push(summary(card,objectRef));}});}
  let initialized;const ready=()=>initialized||=(initialize().catch(error=>{initialized=null;throw error;}));
  async function resolve(key){await ready();if(contents.has(key))return structuredClone(contents.get(key));const {index}=await load();const record=index.resources.find(r=>r.key===key);if(!record)throw Error('固定版本的卡片资源缺失');const value=checkResource(await readObject(directory,'resources',record.objectRef));if(value.key!==key||value.contentHash!==record.contentHash)throw Error('卡片资源版本校验失败');contents.set(key,value);return structuredClone(value);}
  async function context(studentId){access();const person=await student(studentId);if(!person||String(person.id)!==String(studentId))throw Error('当前学生不存在');await ready();return {person,index:(await load()).index};}
  function publicDetail(resource){const {answer,explanation,rubric,assessment,...content}=resource.content;const canPractice=resource.type!=='document'||resource.purpose!=='practice'||Boolean(content.prompt?.trim()&&content.knowledgePointId&&(answer||rubric));return {...resource,content,canPractice,identityVerified:resource.scope==='builtin'};}
  async function saveAssets(assets){for(const asset of assets){const file=await scopedFile(directory,'assets',asset.sha256+asset.extension,true);const bytes=Buffer.from(asset.base64,'base64');try{await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;if(hash(await fs.readFile(file))!==asset.sha256)throw Error('共享文件完整性冲突');}}}
  async function asset(resource){if(!resource.asset)throw Error('卡片没有原版文件');const bytes=await fs.readFile(await scopedFile(directory,'assets',resource.asset.sha256+resource.asset.extension));if(hash(bytes)!==resource.asset.sha256||bytes.length!==resource.asset.bytes)throw Error('共享原件校验失败');return {...resource.asset,base64:bytes.toString('base64')};}
  async function importBytes(bytes, internal=false){access();await ready();const verified=await runCardPackageWorker({operation:'decode',bytes});
    return change(async index=>{
      for(const card of verified.resources){if(card.publisherId==='edu-builtin'||(!internal&&card.publisherId===index.publisherId))throw Error('外部包不能覆盖本机发布者或内置资源');const old=index.resources.find(r=>r.key===card.key);if(old&&old.contentHash!==card.contentHash)throw Error('同版本内容冲突，拒绝覆盖');}
      await saveAssets(verified.assets);let added=0;
      for(const card of verified.resources){if(index.resources.some(r=>r.key===card.key))continue;const objectRef=await putObject(directory,'resources',card);index.resources.push(summary(card,objectRef,{origin:'package'}));added++;}
      return {added,reused:verified.resources.length-added,identityVerified:false};
    });
  }
  async function draftFor(id){await ready();const {index}=await load();const record=index.drafts.find(d=>d.id===id);if(!record||record.deletedAt)throw Error('草稿不存在或已删除');return {...record,data:await readObject(directory,'drafts',record.objectRef)};}
  return {
    capabilities,resolve,importBytes,
    publicationContext:async studentId=>{await context(studentId);return {currentStudentId:studentId,students:(await students()).map(s=>({id:String(s.id),name:s.name,grade:s.grade||''}))};},
    prepareSharedDraft:async(studentId,input)=>{
      await context(studentId);const scope=input.scope;
      if(!['institution','platform'].includes(scope))throw Error('请选择机构或平台发布');access(scope);
      return change(async index=>{
        let source,sourceVersion;
        if(input.entryType==='draft'){
          const record=index.drafts.find(d=>d.id===input.id&&!d.deletedAt&&d.scope==='personal'&&d.ownerStudentId===studentId);
          if(!record)throw Error('个人草稿不存在或不属于当前学生');
          if(record.revision!==input.revision)throw Error('草稿已变化，请刷新后准备发布');
          source=await readObject(directory,'drafts',record.objectRef);sourceVersion=record.objectRef;
        }else if(input.entryType==='resource'){
          const record=index.resources.find(r=>r.key===input.id&&r.scope==='personal'&&r.ownerStudentId===studentId&&r.publisherId===index.publisherId);
          if(!record)throw Error('个人卡片不存在或不属于当前学生');
          const latest=latestVersions(index.resources).find(r=>r.cardId===record.cardId&&r.publisherId===record.publisherId);
          if(latest?.key!==record.key||record.contentHash!==input.contentHash)throw Error('卡片已更新，请刷新后准备发布');
          source=checkResource(await readObject(directory,'resources',record.objectRef));sourceVersion=record.objectRef;
        }else throw Error('卡片来源无效');
        const preparationKey=digest([studentId,input.entryType,input.id,sourceVersion,scope]);
        const prior=index.drafts.find(d=>!d.deletedAt&&d.preparationKey===preparationKey);
        if(prior)return {id:prior.id,title:prior.title,kind:'card',entryType:'draft',status:'draft',scope:prior.scope,version:prior.version,revision:prior.revision,reused:true};
        // Copy teaching fields only. Never move the personal record or its answers/events.
        const data={type:source.type,purpose:source.purpose,template:source.template,layout:source.layout?{fontSize:source.layout.fontSize,accent:source.layout.accent,paper:source.layout.paper,orientation:source.layout.orientation}:undefined,grade:String(source.grade||'').slice(0,60),content:teachingContent(source.content),languagePolicy:{instructionLanguage:source.languagePolicy?.instructionLanguage,supportLanguage:source.languagePolicy?.supportLanguage,targetLanguage:source.languagePolicy?.targetLanguage},licenseNote:String(source.licenseNote||'').slice(0,500),asset:source.asset?{sha256:source.asset.sha256,extension:source.asset.extension,bytes:source.asset.bytes}:null};
        if(data.asset)await asset(data);
        access(scope);
        const record={id:crypto.randomUUID(),scope,ownerStudentId:null,cardId:crypto.randomUUID(),version:1,revision:1,objectRef:await putObject(directory,'drafts',data),updatedAt:new Date().toISOString(),title:data.content.title,preparationKey};
        index.drafts.push(record);
        return {id:record.id,title:record.title,kind:'card',entryType:'draft',status:'draft',scope,version:1,revision:1};
      });
    },
    publish:async(studentId,id,input={})=>{
      await context(studentId);const all=await students();
      return change(async index=>{
        index.publicationReceipts ||= {};
        const requestId=String(input.requestId||id),requestHash=digest([studentId,id,input.audience||null,input.revision||null]);
        if(!/^[A-Za-z0-9_-]{8,100}$/.test(requestId))throw Error('发布事务编号无效');
        const receipt=index.publicationReceipts[requestId];
        if(receipt){if(receipt.requestHash!==requestHash)throw Error('发布编号已用于其他内容');if(input.sharedOnly&&receipt.scope==='personal')throw Error('个人卡片请先准备机构或平台发布草稿');access(receipt.scope);return {...receipt.result,duplicate:true};}
        const draft=index.drafts.find(d=>d.id===id&&!d.deletedAt);if(!draft)throw Error('草稿已变化，请刷新发布列表');
        access(draft.scope);if(draft.scope==='personal'&&draft.ownerStudentId!==studentId)throw Error('草稿归属不符');
        if(input.sharedOnly&&draft.scope==='personal')throw Error('个人卡片请先准备机构或平台发布草稿');
        if(input.revision!==undefined&&draft.revision!==input.revision)throw Error('草稿已变化，请重新预览再发布');
        const data=await readObject(directory,'drafts',draft.objectRef);
        const card=checkResource({...data,publisherId:index.publisherId,publisherName:draft.scope==='platform'?'平台卡片':draft.scope==='personal'?'我的卡片':'本机机构卡片',cardId:draft.cardId,version:draft.version,scope:draft.scope,status:'published',publishedAt:draft.updatedAt});
        if(!card.licenseNote.trim())throw Error('请说明内容版权或使用授权');
        if(card.asset)await asset(card);
        const audience=draft.scope==='personal'?null:normalizeAudience(input.audience,all,studentId);
        if(index.resources.some(r=>r.key===card.key))throw Error('同版本已发布，请刷新列表');
        const objectRef=await putObject(directory,'resources',card);
        index.resources.push(summary(card,objectRef,{ownerStudentId:draft.ownerStudentId,audienceRequired:!!audience}));
        if(audience)index.assignments[`${card.publisherId}:${card.cardId}`]=audience;
        index.drafts=index.drafts.filter(d=>d.id!==id);
        const result={published:true,key:card.key,version:card.version,count:audience?audienceCount(audience,all):1};
        index.publicationReceipts[requestId]={requestHash,result,scope:card.scope};return result;
      });
    },
    withdraw:async(studentId,key)=>{await context(studentId);return change(async index=>{
      const record=index.resources.find(r=>r.key===key);if(!record||record.publisherId!==index.publisherId||record.scope==='personal')throw Error('仅发布者可以停止共享卡片的新使用');access(record.scope);
      const latest=latestVersions(index.resources).find(r=>r.publisherId===record.publisherId&&r.cardId===record.cardId);
      if(latest.status==='withdrawn')return {withdrawn:true,key:latest.key,duplicate:true};
      if(latest.key!==key)throw Error('资源已更新，请刷新后操作');
      const card=checkResource({...await readObject(directory,'resources',record.objectRef),version:latest.version+1,status:'withdrawn',publishedAt:new Date().toISOString()});
      const objectRef=await putObject(directory,'resources',card);index.resources.push(summary(card,objectRef,{audienceRequired:true}));return {withdrawn:true,key:card.key};
    });},
    deleteDraft:async(studentId,id,revision)=>{await context(studentId);return change(index=>{const draft=index.drafts.find(d=>d.id===id);if(!draft)throw Error('草稿不存在');access(draft.scope);if(draft.scope==='personal'&&draft.ownerStudentId!==studentId)throw Error('草稿归属不符');if(draft.revision!==revision)throw Error('草稿已变化，请刷新后删除');draft.deletedAt ||= new Date().toISOString();return {deleted:true,id,revision:draft.revision};});},
    restoreDraft:async(studentId,id)=>{await context(studentId);return change(index=>{const draft=index.drafts.find(d=>d.id===id);if(!draft)throw Error('草稿不存在');access(draft.scope);if(draft.scope==='personal'&&draft.ownerStudentId!==studentId)throw Error('草稿归属不符');delete draft.deletedAt;draft.revision++;return {restored:true};});},
    historicalFile:async(studentId,cardId)=>{await context(studentId);const card=await personalCard(studentId,cardId);if(!card.resourceRef)throw Error('此练习没有共享原件');return asset(await resolve(card.resourceRef.key));},
    list:async(studentId,options={})=>{const {person,index}=await context(studentId),page=Math.max(1,Math.floor(Number(options.page)||1));const favorite=new Set(index.favorites[studentId]||[]);const list=latestVersions(index.resources).filter(r=>visible(r,person,index)&&(!options.subject||r.subject===options.subject)&&(!options.search||r.title.toLocaleLowerCase().includes(String(options.search).toLocaleLowerCase()))
      &&(options.filter!=='mine'||r.ownerStudentId===studentId||(favorite.has(r.key)||favorite.has(`${r.publisherId}:${r.cardId}`)))&&(options.filter!=='recommended'||['builtin','platform'].includes(r.scope)));
      const subjects=[...new Set(latestVersions(index.resources).filter(r=>visible(r,person,index)).map(r=>r.subject))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
      return {page,pageSize:20,total:list.length,subjects,items:list.slice((page-1)*20,page*20).map(({objectRef,ownerStudentId,...r})=>({...r,saved:favorite.has(r.key)||favorite.has(`${r.publisherId}:${r.cardId}`),owned:r.publisherId===index.publisherId})),capabilities:capabilities()};},
    detail:async(studentId,key)=>{const {person,index}=await context(studentId);const record=index.resources.find(r=>r.key===key);if(!record||!visible(record,person,index))throw Error('资源当前不可用');return publicDetail(await resolve(key));},
    file:async(studentId,key)=>{const {person,index}=await context(studentId);const record=index.resources.find(r=>r.key===key);if(!record||!visible(record,person,index))throw Error('资源不可用');return asset(await resolve(key));},
    save:async(studentId,key)=>{const {person}=await context(studentId);return change(index=>{const record=index.resources.find(r=>r.key===key);if(!record||!visible(record,person,index))throw Error('资源不可用');index.favorites[studentId]=[...new Set([...(index.favorites[studentId]||[]),key,`${record.publisherId}:${record.cardId}`])];return {saved:true};});},
    start:async(studentId,key)=>{const {person}=await context(studentId);return change(async index=>{const record=index.resources.find(r=>r.key===key);
      if(!record||!visible(record,person,index)||!latestVersions(index.resources).some(r=>r.key===key))throw Error('此版本已被更新或撤下，请选择当前版本');
      const resource=await resolve(key);
      if(resource.type==='document'&&resource.purpose==='practice'&&(!resource.content.prompt?.trim()||!resource.content.knowledgePointId||(!resource.content.answer&&!resource.content.rubric)))throw Error('此原版卡片尚未补齐题目对应关系、知识点及评阅依据，请预览或打印');
      return instantiate(studentId,resource);});},
    drafts:async studentId=>{await context(studentId);const {index}=await load();const caps=capabilities();return {currentStudentId:studentId,items:index.drafts.filter(d=>!d.deletedAt&&(d.ownerStudentId===studentId||d.scope==='institution'&&caps.institution||d.scope==='platform'&&caps.platform)),published:latestVersions(index.resources).filter(r=>r.publisherId===index.publisherId&&(r.ownerStudentId===studentId||r.scope==='institution'&&caps.institution||r.scope==='platform'&&caps.platform)).map(({objectRef,...r})=>({...r,audience:index.assignments[`${r.publisherId}:${r.cardId}`]||null})),capabilities:caps,students:(caps.institution?await students():[]).map(s=>({id:s.id,name:s.name,grade:s.grade}))};},
    draft:async(studentId,id)=>{await context(studentId);const draft=await draftFor(id);access(draft.scope);if(draft.scope==='personal'&&draft.ownerStudentId!==studentId)throw Error('个人草稿不属于当前学生');return draft;},
    draftFile:async(studentId,id)=>{await context(studentId);const draft=await draftFor(id);access(draft.scope);if(draft.scope==='personal'&&draft.ownerStudentId!==studentId)throw Error('个人草稿不属于当前学生');return asset(draft.data);},
    newDraft:async(studentId,input={})=>{
      await context(studentId);const scope=input.scope||'personal';if(!['personal','institution','platform'].includes(scope))throw Error('发布范围无效');access(scope);
      let data={type:'structured',purpose:'practice',template:'clear',layout:{fontSize:18,accent:'#216a72',paper:'A4'},grade:'',languagePolicy:{instructionLanguage:'zh-CN'},licenseNote:'原创或已取得使用授权',content:{title:'',subject:'数学',knowledgePoint:'',prompt:'',hint:'',answer:'',explanation:'',minutes:10}};
      if(input.key){const source=await resolve(input.key);const {person,index}=await context(studentId);if(!visible(index.resources.find(r=>r.key===input.key)||{},person,index))throw Error('无权复制此资源');data={...data,type:source.type,purpose:source.purpose,template:source.template,layout:source.layout,asset:source.asset,content:teachingContent(source.content),languagePolicy:source.languagePolicy,licenseNote:source.licenseNote};}
      if(input.cardId){const card=await personalCard(studentId,input.cardId);data.content=teachingContent(card.content);data.languagePolicy=card.languagePolicy;data.purpose=card.purpose||'practice';data.template=card.template||'clear';}
      return change(async index=>{const id=crypto.randomUUID(),objectRef=await putObject(directory,'drafts',data),record={id,scope,ownerStudentId:scope==='personal'?studentId:null,cardId:crypto.randomUUID(),version:1,revision:1,objectRef,updatedAt:new Date().toISOString(),title:data.content.title};index.drafts.push(record);return {...record,data};});
    },
    saveDraft:async(studentId,id,input)=>{await context(studentId);return change(async index=>{const record=index.drafts.find(d=>d.id===id);if(!record||record.deletedAt)throw Error('草稿不存在或已删除');access(record.scope);if(record.scope==='personal'&&record.ownerStudentId!==studentId)throw Error('草稿归属不符');if(input.revision!==record.revision)throw Error('草稿已更新，请重新打开后编辑');
      const previous=await readObject(directory,'drafts',record.objectRef);
      if(input.data.asset && input.data.asset.sha256!==previous.asset?.sha256 && !(record.assetRefs||[]).includes(input.data.asset.sha256))throw Error('原版文件未授权给此草稿');
      const data={type:input.data.type,purpose:input.data.purpose,template:input.data.template,layout:input.data.layout,content:teachingContent(input.data.content),languagePolicy:input.data.languagePolicy,grade:String(input.data.grade||'').slice(0,60),licenseNote:String(input.data.licenseNote||'').slice(0,500),asset:input.data.asset||null};
      record.objectRef=await putObject(directory,'drafts',data);record.revision++;record.title=data.content.title;record.updatedAt=new Date().toISOString();return {...record,data};});},
    attachDraftFile:async(studentId,id,bytes,extension)=>{const draft=await draftFor(id);await context(studentId);access(draft.scope);if(draft.scope==='personal'&&draft.ownerStudentId!==studentId)throw Error('草稿归属不符');const {validateAsset}=require('./card-resource-package.cjs');const checked=validateAsset({sha256:hash(bytes),extension,base64:bytes.toString('base64')});await saveAssets([checked]);await change(index=>{const current=index.drafts.find(d=>d.id===id);if(!current||current.deletedAt)throw Error('草稿已变化');current.assetRefs=[...new Set([...(current.assetRefs||[]),checked.sha256])];});return {sha256:checked.sha256,extension:checked.extension,bytes:checked.bytes};},
    exportBundle:async(studentId,keys)=>{await context(studentId);if(!Array.isArray(keys)||!keys.length||keys.length>200)throw Error('请选择 1–200 张已发布卡片');const {index}=await load();const cards=[];for(const key of [...new Set(keys)]){const card=await resolve(key);access(card.scope);if(card.publisherId!==index.publisherId||!['platform','institution'].includes(card.scope))throw Error('只能导出本机发布的共享卡片');cards.push(card);}const files=new Map();for(const card of cards)if(card.asset&&!files.has(card.asset.sha256))files.set(card.asset.sha256,await asset(card));return Buffer.from(await runCardPackageWorker({operation:'encode',resources:cards,assets:[...files.values()]}));},
    preparePublication:async(studentId,id)=>{
      await context(studentId);const draft=await draftFor(id);access(draft.scope);if(draft.scope==='personal'&&draft.ownerStudentId!==studentId)throw Error('草稿归属不符');const {index}=await load();
      const card=checkResource({...draft.data,publisherId:index.publisherId,publisherName:draft.scope==='platform'?'平台卡片':draft.scope==='personal'?'我的卡片':'本机机构卡片',cardId:draft.cardId,version:draft.version,scope:draft.scope,status:'published',publishedAt:draft.updatedAt});
      if(!card.licenseNote.trim())throw Error('请说明内容版权或使用授权');
      if(draft.scope==='personal')return {card,draftId:id,revision:draft.revision};
      const bytes=await runCardPackageWorker({operation:'encode',resources:[card],assets:card.asset?[await asset(card)]:[]});
      return {card,bytes:Buffer.from(bytes),draftId:id,revision:draft.revision};
    },
    commitPublication:async(studentId,prepared)=>{await context(studentId);return change(async index=>{const draft=index.drafts.find(d=>d.id===prepared.draftId);if(!draft||draft.deletedAt||draft.revision!==prepared.revision)throw Error('草稿已变化，未发布旧内容');access(draft.scope);if(draft.scope==='personal'&&draft.ownerStudentId!==studentId)throw Error('草稿归属不符');const card=checkResource(prepared.card);if(card.publisherId!==index.publisherId||card.cardId!==draft.cardId||card.version!==draft.version||card.scope!==draft.scope)throw Error('发布身份无效');
      if(index.resources.some(r=>r.key===card.key&&r.contentHash!==card.contentHash))throw Error('同版本资源冲突');const objectRef=await putObject(directory,'resources',card);if(!index.resources.some(r=>r.key===card.key))index.resources.push(summary(card,objectRef,{ownerStudentId:draft.ownerStudentId}));index.drafts=index.drafts.filter(d=>d.id!==draft.id);return {published:true,key:card.key};});},
    editVersion:async(studentId,key)=>{await context(studentId);const card=await resolve(key);access(card.scope);return change(async index=>{if(card.publisherId!==index.publisherId)throw Error('外部资源请创建个人副本');const record=index.resources.find(r=>r.key===key);if(card.scope==='personal'&&record.ownerStudentId!==studentId)throw Error('个人卡片归属不符');const pending=index.drafts.find(d=>!d.deletedAt&&d.cardId===card.cardId);if(pending)return {...pending,data:await readObject(directory,'drafts',pending.objectRef)};
      const version=Math.max(...index.resources.filter(r=>r.publisherId===card.publisherId&&r.cardId===card.cardId).map(r=>r.version))+1;
      const data={type:card.type,purpose:card.purpose,template:card.template,layout:card.layout,content:card.content,languagePolicy:card.languagePolicy,asset:card.asset,grade:card.grade,licenseNote:card.licenseNote};const draft={id:crypto.randomUUID(),cardId:card.cardId,scope:card.scope,ownerStudentId:record.ownerStudentId,version,revision:1,objectRef:await putObject(directory,'drafts',data),title:card.content.title,updatedAt:new Date().toISOString()};index.drafts.push(draft);return {...draft,data};});},
    assign:async(studentId,key,input)=>{await context(studentId);access('institution');const all=await students();return change(index=>{const record=index.resources.find(r=>r.key===key);if(!record||record.publisherId!==index.publisherId||!['institution','platform'].includes(record.scope))throw Error('只能分配本机发布资源');if(!['all','grade','students'].includes(input.type))throw Error('分配范围无效');const ids=[...new Set(input.studentIds||[])];if(ids.some(id=>!all.some(s=>String(s.id)===String(id)))||(input.type==='students'&&!ids.length)||(input.type==='grade'&&!String(input.grade||'').trim()))throw Error('分配学生或年级无效');index.assignments[`${record.publisherId}:${record.cardId}`]={type:input.type,grade:String(input.grade||'').slice(0,60),studentIds:ids};return {assigned:true,count:input.type==='all'?all.length:input.type==='grade'?all.filter(s=>String(s.grade)===input.grade).length:ids.length};});},
    prepareWithdrawal:async(studentId,key)=>{await context(studentId);const card=await resolve(key);access(card.scope);const {index}=await load();if(card.publisherId!==index.publisherId||card.scope==='personal')throw Error('仅发布者可以撤下共享卡片');const version=Math.max(...index.resources.filter(r=>r.publisherId===card.publisherId&&r.cardId===card.cardId).map(r=>r.version))+1;const withdrawn=checkResource({...card,version,status:'withdrawn',publishedAt:new Date().toISOString()});const bytes=await runCardPackageWorker({operation:'encode',resources:[withdrawn],assets:withdrawn.asset?[await asset(withdrawn)]:[]});return {bytes:Buffer.from(bytes),card:withdrawn};},
  };
}
module.exports={createCardResources,cardCapabilities,latestVersions,visible};
