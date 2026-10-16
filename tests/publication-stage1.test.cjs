'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createCardResources}=require('../electron/card-resources.cjs');
const {createPracticeCards}=require('../electron/practice-cards.cjs');
const {createStudentPublications}=require('../electron/student-publications.cjs');
const {createCoursePublications}=require('../electron/course-publications.cjs');
const {createCourseCatalogStore}=require('../electron/course-catalog-store.cjs');
const {createPublicationCenter}=require('../electron/publication-center.cjs');
const people=[{id:'student-a',name:'测试甲',grade:'8'},{id:'student-b',name:'测试乙',grade:'9'}];
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'edu-publication-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));let cards,modelCalls=0;
 const practice=createPracticeCards({resolveStudentDir:async id=>{if(!people.some(p=>p.id===id))throw Error('scope');return path.join(root,id);},resolveResource:key=>cards.resolve(key),generate:async()=>{modelCalls++;throw Error('Unexpected model call');},enqueueReview:async()=>{}});
 const options={directory:path.join(root,'cards'),license:()=>({active:true,edition:'PLATFORM'}),student:id=>people.find(p=>p.id===id),students:()=>people,instantiate:(id,r)=>practice.instantiate(id,r),personalCard:(id,c)=>practice.teachingCard(id,c)};
 cards=createCardResources(options);return {root,cards,practice,execute:createStudentPublications({cards,practice}),options,calls:()=>modelCalls};}
async function draft(e,overrides={}){let d=await e.cards.newDraft('student-a',{scope:'institution'});return e.cards.saveDraft('student-a',d.id,{revision:d.revision,data:{...d.data,...overrides,content:{...d.data.content,title:'分数练习',subject:'数学',prompt:'计算 $1+1$，只写结果。',answer:'2',explanation:'两个一是二。',knowledgePoint:'加法',assessment:{kind:'exact',acceptedAnswers:['2']},...(overrides.content||{})}}});}
const course=(suffix='')=>({courseId:'tenant:sample',type:'tenant_custom',name:'示范课程'+suffix,provider:'测试机构',url:'https://example.com/'+suffix,allowedHosts:['example.com'],coverAsset:`custom-assets/${'a'.repeat(64)}.png`,summary:'课程简介',subjects:['数学'],gradeRange:[],languages:['zh-CN'],accountRequirement:'按提供方要求',effectiveAt:'2026-01-01T00:00:00.000Z',expiresAt:null,legalNotice:'测试内容',status:'active'});

test('new card publication is atomic with default current-student scope, restart receipts and no package export',async t=>{
 const e=await fixture(t),d=await draft(e);const input={requestId:'publish-0001',revision:d.revision};
 await assert.rejects(e.cards.publish('student-a',d.id,{...input,audience:{type:'students',studentIds:['foreign']}}),/学生/);
 assert.equal((await e.cards.drafts('student-a')).published.length,0);
 const result=await e.cards.publish('student-a',d.id,input);
 assert((await e.cards.list('student-a')).items.some(c=>c.key===result.key));assert(!(await e.cards.list('student-b')).items.some(c=>c.key===result.key));
 const reopened=createCardResources(e.options);assert.equal((await reopened.publish('student-a',d.id,input)).duplicate,true);
 await assert.rejects(reopened.publish('student-a',d.id,{...input,audience:{type:'all'}}),/编号/);
 assert.equal((await fs.readdir(path.join(e.root,'cards'))).some(n=>n.endsWith('edu-cardpkg')),false);
 assert.equal(e.calls(),0);
});
test('two concurrent publishes create one resource and stale draft versions never publish',async t=>{
 const e=await fixture(t),d=await draft(e);await assert.rejects(e.cards.publish('student-a',d.id,{revision:d.revision-1}),/变化/);
 const results=await Promise.all([e.cards.publish('student-a',d.id,{revision:d.revision}),e.cards.publish('student-a',d.id,{revision:d.revision})]);assert.equal(results[0].key,results[1].key);assert.equal(results.filter(r=>r.duplicate).length,1);
});
test('student API separates feedback from answers, rejects management and foreign scopes, revisions stay pinned after withdrawal',async t=>{
 const e=await fixture(t),d=await draft(e),r=await e.cards.publish('student-a',d.id,{audience:{type:'all'}});
 const detail=await e.execute('student-b','detail',{key:r.key});assert(!('answer'in detail.content));assert(!('assessment'in detail.content));
 const printable=await e.execute('student-b','printable',{key:r.key});assert(printable.html.includes('katex'));assert(!printable.html.includes('两个一是二'));assert(!('answer' in printable.card.content));
 await assert.rejects(e.execute('student-b','confirm',{attemptId:'anything'}),/不支持/);
 await assert.rejects(e.execute('student-b','list',{studentId:'student-a'}),/其他学生/);
 const {card}=await e.execute('student-a','startResource',{key:r.key});
 const input={cardId:card.id,submission:{attemptId:'attempt-0001',answer:'2',difficulty:null,confidence:null}};
 const first=await e.execute('student-a','submit',input);assert(first.saved);assert((await e.execute('student-a','submit',input)).duplicate);
 await e.practice.reviewAttempt('student-a','attempt-0001');
 const feedback=await e.execute('student-a','feedback',{attemptId:'attempt-0001'});assert.equal(feedback.reviews[0].source,'rule');assert.equal(feedback.reference.answer,'2');assert(!feedback.snapshotRef);
 await assert.rejects(e.execute('student-b','feedback',{attemptId:'attempt-0001'}),/不属于/);
 await e.cards.withdraw('student-a',r.key);
 await assert.rejects(e.execute('student-b','startResource',{key:r.key}),/撤下/);
 await assert.rejects(e.execute('student-b','detail',{key:r.key}),/不可用/);
 assert.equal((await e.execute('student-a','workspace',{cardId:card.id})).current.resourceRef.key,r.key);
 assert.equal((await e.execute('student-a','feedback',{attemptId:'attempt-0001'})).reference.answer,'2');assert.equal(e.calls(),0);
 assert((await e.execute('student-a','printable',{cardId:card.id})).html.includes('katex'));
 await assert.rejects(e.execute('student-b','printable',{cardId:card.id}),/不属于/);
});
test('file-only images survive direct publication and scoped historical reads',async t=>{
 const e=await fixture(t),d=await draft(e,{type:'document',purpose:'knowledge',content:{prompt:''}});
 const png=require('@napi-rs/canvas').createCanvas(20,20).toBuffer('image/png'),asset=await e.cards.attachDraftFile('student-a',d.id,png,'.png');
 await e.cards.saveDraft('student-a',d.id,{revision:d.revision,data:{...d.data,asset}});
 const r=await e.cards.publish('student-a',d.id),{card}=await e.execute('student-a','startResource',{key:r.key});
 assert.equal((await e.execute('student-a','file',{key:r.key})).base64,png.toString('base64'));
 await e.cards.withdraw('student-a',r.key);assert.equal((await e.execute('student-a','historicalFile',{cardId:card.id})).base64,png.toString('base64'));
 await assert.rejects(e.execute('student-b','historicalFile',{cardId:card.id}),/不属于/);
 await assert.rejects(e.execute('student-a','submit',{cardId:card.id,submission:{attemptId:'not-a-practice',answer:'2'}}),/作答/);
});
test('course snapshots pin on start; new students see newer versions; withdrawal keeps existing pins',async t=>{
 const e=await fixture(t),folder=path.join(e.root,'published'),store=createCoursePublications(folder);
 store.registerDrafts([course()]);assert.equal(store.project([course()],people[0]).length,0);
 const r=store.publish(course(),{requestId:'course-v1',audience:{type:'all'}},people,'student-a');
 assert.equal(store.pin(course(),people[0]).publicationRef.key,r.key);
 store.publish(course('v2'),{requestId:'course-v2',audience:{type:'all'}},people,'student-a');
 assert.equal(store.project([course('v2')],people[0])[0].name,'示范课程');assert.equal(store.project([course('v2')],people[1])[0].name,'示范课程v2');
 const restarted=createCoursePublications(folder);restarted.withdraw(course().courseId);
 assert.equal(restarted.project([course('v2')],people[0])[0].name,'示范课程');assert.equal(restarted.project([course('v2')],people[1]).length,0);
 restarted.assign(course().courseId,{type:'students',studentIds:['student-b']},people,'student-a');assert.equal(restarted.project([course()],people[0]).length,0);
});
test('course store preserves legacy catalogs, gates new authoring, and explicit audiences replace old student lists',async t=>{
 const e=await fixture(t),s=createCourseCatalogStore({userDataDir:e.root,appVersion:'0.21.1',enablePublications:true,resourceRoots:[path.resolve(__dirname,'../public')]});
 assert(s.coursesForStudent(people[0]).length>0);
 await fs.mkdir(s.customAssetsDir,{recursive:true});await fs.copyFile(path.resolve(__dirname,'../public/catalog-assets/starfall-k5-math.png'),path.join(s.customAssetsDir,`${'a'.repeat(64)}.png`));
 s.mergeCustomCourses([course()]);assert(!s.coursesForStudent(people[0]).some(c=>c.courseId===course().courseId));
 s.savePolicy({courseRules:{[course().courseId]:{studentIds:['student-a']}}});
 const center=createPublicationCenter({courses:()=>s,cards:()=>e.cards,students:()=>people,license:()=>({active:true,edition:'ORG'})});
 await center.execute('student-a','publish',{kind:'course',id:course().courseId,requestId:'publish-course',audience:{type:'students',studentIds:['student-b']}});
 assert(s.coursesForStudent(people[1]).some(c=>c.courseId===course().courseId));assert(!s.coursesForStudent(people[0]).some(c=>c.courseId===course().courseId));
 const family=createPublicationCenter({courses:()=>s,cards:()=>e.cards,students:()=>people,license:()=>({active:true,edition:'FAMILY'})});await assert.rejects(family.execute('student-a','list'),/权限/);
});
test('unified publication counts personal and shared cards without granting personal publish access',async t=>{
 const e=await fixture(t),s=createCourseCatalogStore({userDataDir:e.root,appVersion:'0.21.1',enablePublications:true,resourceRoots:[path.resolve(__dirname,'../public')]});
 const shared=await draft(e),personal=await e.cards.newDraft('student-a',{scope:'personal'});
 const center=createPublicationCenter({courses:()=>s,cards:()=>e.cards,students:()=>people,license:()=>({active:true,edition:'ORG'})});
 const before=await center.execute('student-a','list',{kind:'card',status:'draft'});
 assert.equal(before.total,2);assert.equal(before.counts.card,2);assert(before.items.some(r=>r.id===shared.id&&r.revision===shared.revision));assert(before.items.some(r=>r.id===personal.id&&r.scope==='personal'));assert.deepEqual(before.cardSummary,{personal:1,shared:1});
 await assert.rejects(center.execute('student-a','publish',{kind:'card',id:personal.id,revision:personal.revision}),/先准备/);
 await center.execute('student-a','publish',{kind:'card',id:shared.id,revision:shared.revision,requestId:'center-card-publish',audience:{type:'students',studentIds:['student-b']}});
 const after=await center.execute('student-a','list',{kind:'card',status:'published'});
 assert.equal(after.total,1);assert.equal(after.items[0].title,'分数练习');assert.equal(after.items[0].audience.studentIds[0],'student-b');
 assert.equal((await e.cards.list('student-a')).items.some(item=>item.key===after.items[0].id),false);
 assert.equal((await e.cards.list('student-b')).items.some(item=>item.key===after.items[0].id),true);
});

test('saved personal cards appear in publication counts and copy safely to a shared draft',async t=>{
 const e=await fixture(t),s=createCourseCatalogStore({userDataDir:e.root,appVersion:'0.21.1',enablePublications:true,resourceRoots:[path.resolve(__dirname,'../public')]});
 const center=createPublicationCenter({courses:()=>s,cards:()=>e.cards,students:()=>people,license:()=>({active:true,edition:'PLATFORM'})});
 const builtin=(await e.cards.list('student-a')).items[0],d=await e.cards.newDraft('student-a',{scope:'personal',key:builtin.key});
 const personal=await e.cards.publish('student-a',d.id,{revision:d.revision});
 let list=await center.execute('student-a','list',{kind:'card'});assert.equal(list.counts.card,1);assert.equal(list.cardSummary.personal,1);assert.equal(list.items[0].status,'personal');
 assert.equal((await center.execute('student-b','list',{kind:'card'})).counts.card,0);
 assert.equal((await center.execute('student-a','list',{kind:'card',search:'no such card'})).counts.card,1);
 const source=list.items[0],input={...source,scope:'institution'};
 await assert.rejects(center.execute('student-b','prepareSharedDraft',input),/不属于/);
 const copies=await Promise.all([center.execute('student-a','prepareSharedDraft',input),center.execute('student-a','prepareSharedDraft',input)]);
 assert.equal(copies[0].id,copies[1].id);assert.equal(copies.filter(r=>r.reused).length,1);
 const shared=await e.cards.draft('student-a',copies[0].id);assert.equal(shared.ownerStudentId,null);assert(!shared.data.studentId);assert(!shared.data.attempts);assert.equal(shared.data.content.answer,(await e.cards.resolve(personal.key)).content.answer);
 assert(!(await e.cards.list('student-b')).items.some(r=>r.cardId===shared.cardId));
 await center.execute('student-a','publish',{kind:'card',id:shared.id,revision:shared.revision,audience:{type:'students',studentIds:['student-b']}});
 assert((await e.cards.list('student-b')).items.some(r=>r.cardId===shared.cardId));assert((await e.cards.list('student-a')).items.some(r=>r.key===personal.key));
 const edit=await e.cards.editVersion('student-a',personal.key);await e.cards.publish('student-a',edit.id,{revision:edit.revision});
 await assert.rejects(center.execute('student-a','prepareSharedDraft',input),/已更新/);
});

test('personal draft preparation checks revision, permissions and deletion without losing original',async t=>{
 const e=await fixture(t),d=await e.cards.newDraft('student-a',{scope:'personal'}),input={id:d.id,entryType:'draft',revision:d.revision,scope:'institution'};
 await assert.rejects(e.cards.prepareSharedDraft('student-b',input),/不属于/);
 await assert.rejects(e.cards.prepareSharedDraft('student-a',{...input,revision:0}),/变化/);
 const org=createCardResources({...e.options,license:()=>({active:true,edition:'ORG'})});await assert.rejects(org.prepareSharedDraft('student-a',{...input,scope:'platform'}),/平台版/);
 const family=createCardResources({...e.options,license:()=>({active:true,edition:'FAMILY'})});await assert.rejects(family.prepareSharedDraft('student-a',input),/机构卡片/);
 const prepared=await e.cards.prepareSharedDraft('student-a',input);assert.equal((await e.cards.draft('student-a',d.id)).id,d.id);assert.notEqual(prepared.id,d.id);
 await e.cards.deleteDraft('student-a',d.id,d.revision);await assert.rejects(e.cards.prepareSharedDraft('student-a',input),/不存在/);
});

test('image-only personal card preparation reuses bytes and preserves layout',async t=>{
 const e=await fixture(t),canvas=require('@napi-rs/canvas').createCanvas(100,60),bytes=canvas.toBuffer('image/png');
 let d=await e.cards.newDraft('student-a',{scope:'personal'});const file=await e.cards.attachDraftFile('student-a',d.id,bytes,'.png');
 d=await e.cards.saveDraft('student-a',d.id,{revision:d.revision,data:{...d.data,type:'document',purpose:'knowledge',asset:file,content:{title:'图片卡片',subject:'数学',minutes:10},layout:{fontSize:18,accent:'#123456',paper:'A4',orientation:'landscape'}}});
 const original=await e.cards.publish('student-a',d.id),resource=await e.cards.resolve(original.key);
 const shared=await e.cards.prepareSharedDraft('student-a',{entryType:'resource',id:original.key,contentHash:resource.contentHash,scope:'platform'});
 assert.equal((await e.cards.draftFile('student-a',shared.id)).base64,bytes.toString('base64'));assert.equal((await e.cards.draft('student-a',shared.id)).data.layout.orientation,'landscape');
 assert.equal((await fs.readdir(path.join(e.root,'cards','assets'))).length,1);
});
test('corrupt course publication index fails closed instead of exposing every student',async t=>{const e=await fixture(t),directory=path.join(e.root,'broken');await fs.mkdir(directory);await fs.writeFile(path.join(directory,'course-publications.json'),'{broken');assert.throws(()=>createCoursePublications(directory).project([course()],people[0]));});

test('platform publish worker builds and installs in background, retries identical input and rejects changed content',async t=>{
 const e=await fixture(t),worker=require('../electron/course-publish-worker.cjs').runCoursePublishWorker;
 const content={...course(),courseId:'platform:worker',type:'platform_standard'},d={courseId:content.courseId,course:content,validation:{ok:true}};
 const input={options:{drafts:[d],deletedCourseIds:[],baseCatalog:{courses:[],catalogVersion:''},issuedAt:'2026-10-11T00:00:00.000Z',hostVersion:'0.21.1',minHostVersion:'0.21.1',outputPath:path.join(e.root,'worker','package.edu-coursepkg')},storeOptions:{userDataDir:e.root,appVersion:'0.21.1',resourceRoots:[path.resolve(__dirname,'../public')]},assets:{[content.coverAsset]:path.resolve(__dirname,'../public/catalog-assets/starfall-k5-math.png')}};
 input.options.baseCatalog=createCourseCatalogStore(input.storeOptions).state().platformCatalog||{courses:[],catalogVersion:''};
 for(const c of input.options.baseCatalog.courses)input.assets[c.coverAsset]=path.resolve(__dirname,'../public',c.coverAsset);
 assert.equal((await worker(input)).ok,true);assert.equal((await worker(input)).ok,true);
 const store=createCourseCatalogStore(input.storeOptions);assert(store.combinedCatalog().courses.some(c=>c.courseId===content.courseId));
 const second={...content,courseId:'platform:worker-second',name:'Second successful item'};
 const nextInput={...input,options:{...input.options,drafts:[{courseId:second.courseId,course:second,validation:{ok:true}}],baseCatalog:store.state().platformCatalog,outputPath:path.join(e.root,'worker','second.edu-coursepkg')},assets:{...input.assets}};
 for(const c of nextInput.options.baseCatalog.courses)nextInput.assets[c.coverAsset]=store.assetPath(c.coverAsset);
 await worker(nextInput);
 // Replaying an earlier successful package must not erase a later success.
 await worker(input);
 assert(createCourseCatalogStore(input.storeOptions).combinedCatalog().courses.some(c=>c.courseId===second.courseId));
 await assert.rejects(worker({...input,options:{...input.options,drafts:[{...d,course:{...content,name:'Changed'}}]}}),/变化/);
});

test('withdrawal serialized before a new start blocks the new instance',async t=>{
 const e=await fixture(t),d=await draft(e),r=await e.cards.publish('student-a',d.id,{audience:{type:'all'}});
 await e.cards.withdraw('student-a',r.key);await assert.rejects(e.cards.start('student-b',r.key),/撤下/);
 assert.equal((await e.practice.cardChoices('student-b')).length,0);
});
