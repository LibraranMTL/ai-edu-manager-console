const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createCardResources,cardCapabilities}=require('../electron/card-resources.cjs');
const {createPracticeCards}=require('../electron/practice-cards.cjs');
const {decodeCardPackage,encodeCardPackage,checkResource,digest}=require('../electron/card-resource-package.cjs');
const {builtinResources}=require('../electron/card-builtin-resources.cjs');
test('file-only cards survive draft reopen, publication and package import without invented text',async t=>{
 const e=await fixture(t),png=require('@napi-rs/canvas').createCanvas(80,60).toBuffer('image/png');
 for(const scope of ['personal','institution']){
  let draft=await e.resources.newDraft('a',{scope});const asset=await e.resources.attachDraftFile('a',draft.id,png,'.png');
  draft=await e.resources.saveDraft('a',draft.id,{revision:draft.revision,data:{...draft.data,type:'document',asset,layout:{...draft.data.layout,orientation:'landscape'},content:{...draft.data.content,title:'纯图片',subject:'IB 经济学',prompt:''}}});
  const reopened=await e.resources.draft('a',draft.id);assert.deepEqual(reopened.data.asset,asset);assert.equal(reopened.data.layout.orientation,'landscape');
  assert.equal((await e.resources.draftFile('a',draft.id)).base64,png.toString('base64'));
  const prepared=await e.resources.preparePublication('a',draft.id);await e.resources.commitPublication('a',prepared);
  const card=await e.resources.detail('a',prepared.card.key);assert.equal(card.content.prompt,'');assert.equal(card.layout.orientation,'landscape');
  assert.equal((await e.resources.file('a',card.key)).base64,png.toString('base64'));
  await assert.rejects(e.resources.start('a',card.key),/补齐/);
  if(prepared.bytes){const other=await fixture(t,'FAMILY');await other.resources.importBytes(prepared.bytes);assert.equal((await other.resources.file('a',card.key)).base64,png.toString('base64'));}
 }
});
test('custom subject facets cover all visible resources, not just current page or search, without leaking private tags',async t=>{
 const e=await fixture(t);await publish(e,'personal',{content:{subject:'个人私有分类'}});
 const shared=await publish(e,'institution',{content:{subject:'IB 经济学'}});await e.resources.assign('a',shared.card.key,{type:'students',studentIds:['a']});
 assert((await e.resources.list('a',{subject:'数学',search:'不存在'})).subjects.includes('IB 经济学'));
 assert.equal((await e.resources.list('a',{subject:'IB 经济学',filter:'all'})).total,1);
 assert(!(await e.resources.list('b')).subjects.includes('个人私有分类'));assert(!(await e.resources.list('b')).subjects.includes('IB 经济学'));
});
test('orientation is optional for old resource hashes and validated for new packages',()=>{
 const old=builtinResources()[0],checked=checkResource(old);assert.equal(checked.contentHash,old.contentHash);
 const base={...old,scope:'institution',publisherId:'test-publisher',layout:{fontSize:18,accent:'#123456',paper:'A4'}};
 const legacy=checkResource(base);assert(!Object.hasOwn(legacy.layout,'orientation'));assert.equal(checkResource(legacy).contentHash,legacy.contentHash);
 const landscape=checkResource({...base,layout:{...base.layout,orientation:'landscape'}});assert.equal(decodeCardPackage(encodeCardPackage([landscape])).resources[0].layout.orientation,'landscape');
 assert.throws(()=>checkResource({...base,layout:{...base.layout,orientation:'bad'}}),/排版/);
 assert.throws(()=>checkResource({...base,content:{...base.content,prompt:''}}),/正文/);
});
async function fixture(t,edition='PLATFORM'){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'card-resources-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 let currentEdition=edition,resources;const students=[{id:'a',name:'Alpha',grade:'8'},{id:'b',name:'Beta',grade:'9'}];
 const practice=createPracticeCards({resolveStudentDir:async id=>{if(!students.some(s=>s.id===id))throw Error('scope');return path.join(root,id);},resolveResource:key=>resources.resolve(key),generate:async()=>{throw Error('must not call Agent');}});
 resources=createCardResources({directory:path.join(root,'resources'),license:()=>({active:true,edition:currentEdition}),student:async id=>students.find(s=>s.id===id),students:async()=>students,
 instantiate:(id,r)=>practice.instantiate(id,r),personalCard:(id,c)=>practice.teachingCard(id,c)});
 return {root,resources,practice,setEdition:value=>currentEdition=value};
}
async function publish(env,scope='institution',overrides={}){
 let draft=await env.resources.newDraft('a',{scope});draft=await env.resources.saveDraft('a',draft.id,{revision:draft.revision,data:{...draft.data,...overrides,content:{title:'原创平均数卡',subject:'数学',knowledgePoint:'平均数',prompt:'求 1 和 3 的平均数，只填数值。',answer:'2',explanation:'先求和再除以 2。',minutes:10,assessment:{kind:'exact',acceptedAnswers:['2']},...(overrides.content||{})}}});
 const prepared=await env.resources.preparePublication('a',draft.id);await env.resources.commitPublication('a',prepared);return prepared;
}
test('draft deletion is scoped, recoverable and cannot resurrect through stale autosave or publish',async t=>{
 const e=await fixture(t);const p=await publish(e,'platform');const d=await e.resources.newDraft('a',{key:p.card.key,scope:'personal'});
 const prepared=await e.resources.preparePublication('a',d.id);
 await assert.rejects(e.resources.deleteDraft('b',d.id,d.revision),/归属/);
 await assert.rejects(e.resources.deleteDraft('a',d.id,d.revision+1),/变化/);
 await e.resources.deleteDraft('a',d.id,d.revision);
 assert.equal((await e.resources.drafts('a')).items.some(x=>x.id===d.id),false);
 await assert.rejects(e.resources.draft('a',d.id),/删除/);
 await assert.rejects(e.resources.saveDraft('a',d.id,{revision:d.revision,data:d.data}),/删除/);
 await assert.rejects(e.resources.commitPublication('a',prepared),/变化/);
 assert.equal((await e.resources.detail('a',p.card.key)).content.title,'原创平均数卡');
 await e.resources.restoreDraft('a',d.id);assert.equal((await e.resources.draft('a',d.id)).revision,d.revision+1);
 await assert.rejects(e.resources.saveDraft('a',d.id,{revision:d.revision,data:d.data}),/更新/);
 const institution=await e.resources.newDraft('a',{scope:'institution'});e.setEdition('FAMILY');await assert.rejects(e.resources.deleteDraft('a',institution.id,institution.revision),/需要/);
});
test('edition mapping reuses existing capabilities without changing license validation',()=>{
 assert.deepEqual(cardCapabilities({active:true,edition:'FAMILY'}),{use:true,institution:false,platform:false});
 assert.equal(cardCapabilities({active:true,edition:'PRO'}).institution,true);assert.equal(cardCapabilities({active:true,edition:'PRO'}).platform,false);
 assert.equal(cardCapabilities({active:true,edition:'PLATFORM'}).platform,true);assert.equal(cardCapabilities({active:false,edition:'PLATFORM'}).use,false);
});
test('12 builtins cover subjects and purposes, public previews never expose answers or rules',async t=>{
 const e=await fixture(t,'FAMILY');const list=await e.resources.list('a');assert.equal(list.total,12);
 assert.equal(list.items.filter(r=>r.subject==='数学').length,6);assert.equal(list.items.filter(r=>r.subject==='英语').length,6);
 const detail=await e.resources.detail('a',list.items[0].key);assert.equal(detail.content.answer,undefined);assert.equal(detail.content.assessment,undefined);
 await assert.rejects(e.resources.newDraft('a',{scope:'platform'}));await assert.rejects(e.resources.newDraft('a',{scope:'institution'}));
});
test('published package imports offline, deduplicates versions, rejects conflicting contents',async t=>{
 const e=await fixture(t),f=await fixture(t,'FAMILY'),p=await publish(e,'platform');
 assert.equal(decodeCardPackage(p.bytes).identityVerified,false);assert.equal((await f.resources.importBytes(p.bytes)).added,1);assert.equal((await f.resources.importBytes(p.bytes)).reused,1);
 const changed=checkResource({...p.card,content:{...p.card.content,title:'同版本篡改'}});await assert.rejects(f.resources.importBytes(encodeCardPackage([changed])),/冲突/);
 const doc=JSON.parse(p.bytes);doc.resources[0].content.prompt='篡改';await assert.rejects(f.resources.importBytes(Buffer.from(JSON.stringify(doc))),/校验/);
});
test('assignments only affect visibility; practice creation stores shared version references',async t=>{
 const e=await fixture(t),p=await publish(e);await e.resources.assign('a',p.card.key,{type:'students',studentIds:['a']});
 assert(!(await e.resources.list('b',{filter:'all'})).items.some(r=>r.key===p.card.key));await assert.rejects(e.resources.start('b',p.card.key));
 assert.equal((await e.practice.listAttempts('a')).total,0);
 const card=await e.resources.start('a',p.card.key);assert.equal(card.status,'started');
 const store=JSON.parse(await fs.readFile(path.join(e.root,'a','practice-cards/store.json'),'utf8'));assert.equal(store.cards[0].content,undefined);assert.equal(store.cards[0].resourceRef.key,p.card.key);
 await e.practice.submit('a',card.id,{attemptId:'resource-answer',answer:'2'});await e.practice.reviewAttempt('a','resource-answer');
 assert.equal((await e.practice.attemptDetail('a','resource-answer')).reviews[0].source,'rule');
});
test('updates and withdrawals cannot mutate started cards, historical answers or personal copies',async t=>{
 const e=await fixture(t),p=await publish(e),f=await fixture(t,'FAMILY');await f.resources.importBytes(p.bytes);
 const card=await f.resources.start('a',p.card.key);await f.practice.submit('a',card.id,{attemptId:'original-answer',answer:'2'});
 let copy=await f.resources.newDraft('a',{key:p.card.key});const personal=await f.resources.preparePublication('a',copy.id);await f.resources.commitPublication('a',personal);
 let update=await e.resources.editVersion('a',p.card.key);update=await e.resources.saveDraft('a',update.id,{revision:update.revision,data:{...update.data,content:{...update.data.content,prompt:'新版题目'}}});
 const p2=await e.resources.preparePublication('a',update.id);await e.resources.commitPublication('a',p2);await f.resources.importBytes(p2.bytes);
 assert.equal((await f.practice.attemptDetail('a','original-answer')).reference.prompt,p.card.content.prompt);
 assert.equal((await f.resources.resolve(personal.card.key)).content.prompt,p.card.content.prompt);
 const withdrawal=await e.resources.prepareWithdrawal('a',p2.card.key);await e.resources.importBytes(withdrawal.bytes,true);await f.resources.importBytes(withdrawal.bytes);
 await assert.rejects(f.resources.start('a',p2.card.key),/更新或撤下/);assert.equal((await f.practice.attemptDetail('a','original-answer')).body.answer,'2');
 const restore=await e.resources.editVersion('a',p.card.key);assert.equal(restore.version,4);
});
test('package publication strips private fields and package assets are reused by hash',async t=>{
 const e=await fixture(t),p=await publish(e,'institution',{content:{studentId:'PRIVATE',rationale:'PRIVATE',sourceRefs:['PRIVATE'],attachment:'PRIVATE'}});
 assert(!p.bytes.toString().includes('PRIVATE'));
 const png=Buffer.from([137,80,78,71,13,10,26,10]);let draft=await e.resources.newDraft('a',{scope:'institution'});
 const asset=await e.resources.attachDraftFile('a',draft.id,png,'.png');draft=await e.resources.saveDraft('a',draft.id,{revision:draft.revision,data:{...draft.data,type:'document',purpose:'knowledge',asset,content:{title:'原版图片',subject:'数学',prompt:'图片讲解',minutes:5}}});
 const ready=await e.resources.preparePublication('a',draft.id);await e.resources.commitPublication('a',ready);
 const f=await fixture(t,'FAMILY');await f.resources.importBytes(ready.bytes);await f.resources.importBytes(ready.bytes);
 assert.equal((await fs.readdir(path.join(f.root,'resources/assets'))).length,1);
 await assert.rejects(f.resources.newDraft('b',{key:(await publish(f,'personal')).card.key}),/无权/);
});
test('knowledge and blank cards have no score submission; draft revisions reject stale autosave',async t=>{
 const e=await fixture(t,'FAMILY'),list=await e.resources.list('a'),blank=list.items.find(c=>c.purpose==='blank');const card=await e.resources.start('a',blank.key);
 await assert.rejects(e.practice.submit('a',card.id,{attemptId:'cannot-grade',answer:'x'}));
 await assert.rejects(e.practice.start('a',card.id));assert.equal((await e.practice.dashboard('a')).history.length,0);assert.equal((await e.practice.workspace('a')).current.id,card.id);
 const d=await e.resources.newDraft('a');await e.resources.saveDraft('a',d.id,{revision:d.revision,data:d.data});await assert.rejects(e.resources.saveDraft('a',d.id,{revision:d.revision,data:d.data}),/更新/);
});
