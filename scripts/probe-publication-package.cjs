'use strict';
// Executes candidate ASAR modules under Electron, using synthetic isolated data.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const resourcesPath=path.resolve(process.argv[2]),runtime=path.join(resourcesPath,'app.asar/electron');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'edu-publication-package-')),checks=[];
app.setPath('userData',root);app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 let error;
 try {
  Object.defineProperty(process,'resourcesPath',{value:resourcesPath});
  const people=[{id:'probe-a',grade:'8'},{id:'probe-b',grade:'9'}];let cards;
  const practice=require(path.join(runtime,'practice-cards.cjs')).createPracticeCards({resolveStudentDir:async id=>{if(!people.some(s=>s.id===id))throw Error('scope');return path.join(root,id);},resolveResource:key=>cards.resolve(key),generate:()=>{throw Error('Probe must not invoke Agent');},enqueueReview:async()=>{}});
  cards=require(path.join(runtime,'card-resources.cjs')).createCardResources({directory:path.join(root,'cards'),license:()=>({active:true,edition:'PLATFORM'}),students:()=>people,student:id=>people.find(s=>s.id===id),instantiate:(id,r)=>practice.instantiate(id,r),personalCard:(id,c)=>practice.teachingCard(id,c)});
  const builtins=await cards.list('probe-a'),draft=await cards.newDraft('probe-a',{scope:'platform',key:builtins.items[0].key});
  const result=await cards.publish('probe-a',draft.id,{requestId:'packaged-publish',revision:draft.revision});
  assert((await cards.list('probe-a')).items.some(c=>c.key===result.key));assert(!(await cards.list('probe-b')).items.some(c=>c.key===result.key));checks.push('ASAR direct card publication defaults to current student, without an export dialog');
  const student=require(path.join(runtime,'student-publications.cjs')).createStudentPublications({cards,practice});
  const {card}=await student('probe-a','startResource',{key:result.key});assert(!card.content.answer);
  await student('probe-a','submit',{cardId:card.id,submission:{attemptId:'packaged-answer',answer:'4'}});await practice.reviewAttempt('probe-a','packaged-answer');
  assert.equal((await student('probe-a','feedback',{attemptId:'packaged-answer'})).reviews[0].judgement,'correct');
  await cards.withdraw('probe-a',result.key);assert.equal((await student('probe-a','workspace',{cardId:card.id})).current.resourceRef.key,result.key);checks.push('ASAR student submission, rule feedback and history survive withdrawal');
  const course={courseId:'platform:probe',type:'platform_standard',name:'Probe',provider:'Synthetic',url:'https://example.com/',allowedHosts:['example.com'],coverAsset:'catalog-assets/starfall-k5-math.png',summary:'Synthetic only',subjects:['math'],gradeRange:[],languages:['en'],accountRequirement:'None',legalNotice:'Synthetic acceptance',status:'active',effectiveAt:'2026-01-01T00:00:00.000Z',expiresAt:null};
  const run=require(path.join(runtime,'course-publish-worker.cjs')).runCoursePublishWorker;
  const storeOptions={userDataDir:root,appVersion:'0.21.1',resourceRoots:[path.join(resourcesPath,'app.asar/dist')]};
  const baseCatalog=require(path.join(runtime,'course-catalog-store.cjs')).createCourseCatalogStore(storeOptions).state().platformCatalog||{courses:[],catalogVersion:''};
  const assets=Object.fromEntries([...baseCatalog.courses,course].map(c=>[c.coverAsset,path.join(resourcesPath,'app.asar/dist',c.coverAsset)]));
  await run({options:{drafts:[{courseId:course.courseId,course,validation:{ok:true}}],deletedCourseIds:[],baseCatalog,hostVersion:'0.21.1',minHostVersion:'0.21.1',outputPath:path.join(root,'platform.edu-coursepkg')},assets,storeOptions});
  checks.push('ASAR worker builds, verifies and installs platform course package');
 } catch(e){error=e.stack;}
 const report={at:new Date().toISOString(),ok:!error,resourcesPath,temporaryRoot:root,checks,error};
 const reportPath=process.argv[3]?path.resolve(process.argv[3]):path.resolve(__dirname,'../.codex_tmp/publication-package-probe.json');
 fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(error?1:0);
});
