'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createTerminalPracticeDrafts}=require('../electron/terminal-practice-drafts.cjs');
const {runPublicationBatch,batchHash}=require('../electron/publication-batch.cjs');
const {createCoursePublications,courseContentHash}=require('../electron/course-publications.cjs');
async function folder(t){const p=await fs.mkdtemp(path.join(os.tmpdir(),'publication-optimization-'));t.after(()=>fs.rm(p,{recursive:true,force:true}));return p;}
test('offline drafts survive restart and isolate host/student/generation; only matching receipt clears',async t=>{
 const root=await folder(t),store=createTerminalPracticeDrafts(root),scope={hostId:'a',dataGeneration:'1',studentId:'s'},card={id:'card-1',resourceRef:{key:'v1'},content:{title:'test'}};
 const draft={card,submission:{attemptId:'attempt-1',answer:'2',attachment:{name:'a.png',base64:'aGVsbG8='}}};await store.save(scope,card.id,draft);
 assert.deepEqual((await createTerminalPracticeDrafts(root).load(scope,card.id)).submission,draft.submission);
 for(const other of [{...scope,hostId:'b'},{...scope,studentId:'other'},{...scope,dataGeneration:'2'}])assert.equal(await store.load(other,card.id),null);
 await store.clear(scope,card.id,'wrong');assert(await store.load(scope,card.id));
 await assert.rejects(store.save(scope,card.id,{...draft,card:{...card,resourceRef:{key:'v2'}}}),/版本/);
 await store.clear(scope,card.id,'attempt-1');assert.equal(await store.load(scope,card.id),null);
});
test('batch retries failed rows across restart without republishing success',async t=>{
 const directory=await folder(t),items=[{id:'a',title:'A',kind:'draft'},{id:'b',title:'B',kind:'draft'}],calls=[];let fail=true;
 const options={directory,requestId:'batch-test',studentId:'s',audience:{type:'all'},items,expectedHash:batchHash(items),checkCurrent:()=>{},execute:async item=>{calls.push(item.id);if(item.id==='b'&&fail)throw Error('temporary');}};
 const first=await runPublicationBatch(options);assert(!first.complete);assert.equal(first.items[1].message,'temporary');fail=false;
 const second=await runPublicationBatch({...options,items:[]});assert(second.complete);assert.deepEqual(calls,['a','b','b']);
 await assert.rejects(runPublicationBatch({...options,audience:{type:'students',studentIds:['x']}}),/范围/);
 await assert.rejects(runPublicationBatch({...options,requestId:'different-id',expectedHash:'stale'}),/变化/);
});
test('course changed after preview cannot create a publication',async t=>{
 const root=await folder(t),store=createCoursePublications(root),course={courseId:'tenant:sample',type:'tenant_custom',name:'Old',provider:'P',url:'https://example.com/',allowedHosts:['example.com'],coverAsset:`custom-assets/${'a'.repeat(64)}.png`,summary:'S',subjects:['数学'],gradeRange:[],languages:['zh-CN'],status:'active'};
 course.legalNotice='测试内容';course.effectiveAt='2026-01-01T00:00:00.000Z';
 assert.throws(()=>store.publish({...course,name:'New'},{requestId:'publish-test',expectedContentHash:courseContentHash(course)},[{id:'s'}],'s'),/内容已变化/);assert.equal(store.records().length,0);
});
