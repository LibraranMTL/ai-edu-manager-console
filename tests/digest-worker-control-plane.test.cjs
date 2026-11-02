'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createDigestOrchestrator}=require('../electron/digest-orchestrator.cjs');
test('legacy digest repair is SQL paged and cannot pick unrelated or unverified successes',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'edu-closure-page-')),store=require('../electron/task-state-store.cjs').createTaskStateStore({legacyPath:path.join(root,'tasks.json')});
 t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});store.open();
 store.applyDelta({upserts:[...Array.from({length:25},(_,i)=>({id:`a${String(i).padStart(2,'0')}`,kind:'student_digest',status:'failed',error:{code:'nothing_pending'}})),{id:'z1',kind:'student_digest',status:'succeeded'},{id:'z2',kind:'other',status:'failed',error:{code:'nothing_pending'}}]});
 const first=store.listDigestClosureRepairs({limit:20});assert.equal(first.tasks.length,20);
 const next=store.listDigestClosureRepairs({limit:20,cursor:first.cursor});assert.equal(next.tasks.length,5);
});
test('asynchronous preparation settles no-work without dispatch and awaits ready sources',async()=>{
 let calls=0;const ready=createDigestOrchestrator({prepare:async()=>({ok:true,taskId:'a'}),execute:async()=>{calls++;return {ok:true,dispatched:true};}});
 assert.equal((await ready.start('student','s')).dispatched,true);assert.equal(calls,1);
 const empty=createDigestOrchestrator({prepare:async()=>({ok:true,completed:true,businessOutcome:'no_work'}),execute:()=>calls++});await empty.start('student','s');assert.equal(calls,1);
});
test('main digest status uses the asynchronous compact business summary, never registry serialization',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../electron/main.cjs'),'utf8'),name='digestBusinessSnapshot',start=source.search(new RegExp(`(?:async )?function ${name}\\(`));
 const context={getProjectMetadata:()=>({id:'p',name:'Synthetic',knowledgeRootPath:'fixture'}),digestReconcileBusinessSnapshot:async()=>({ok:true,pendingCount:3,submittedCount:0,state:{}})};
 vm.createContext(context);vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),context);
 assert.equal((await context.digestBusinessSnapshot('project','p')).pendingCount,3);
});
test('100k synthetic digest records stay inside Worker and missing registry is not no-work',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'edu-digest-read-')),materialsPath=path.join(dir,'materials.json'),statePath=path.join(dir,'state.json');
 fs.writeFileSync(materialsPath,JSON.stringify({materials:Array.from({length:100000},(_,i)=>({id:String(i),status:'pending_digest',sha256:'a'.repeat(64)}))}));fs.writeFileSync(statePath,JSON.stringify({status:'idle'}));
 const client=require('../electron/project-material-read-client.cjs').createProjectMaterialReadClient();t.after(async()=>{await client.close();fs.rmSync(dir,{recursive:true,force:true});});
 let ticks=0;const timer=setInterval(()=>ticks++,5);const result=await client.request('digest_summary',{scopeType:'student',statePath,materialsPath});clearInterval(timer);
 assert.equal(result.pendingCount,100000);assert.ok(Buffer.byteLength(JSON.stringify(result))<2048);assert.ok(ticks>2,'main event loop must stay available');
 await assert.rejects(client.request('digest_summary',{scopeType:'student',statePath,materialsPath:path.join(dir,'missing.json')}));
});

