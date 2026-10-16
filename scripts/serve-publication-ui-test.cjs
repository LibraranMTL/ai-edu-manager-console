'use strict';
// Isolated UI acceptance harness. Never loads host userData, licenses or Agents.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'edu-publication-ui-'));
 const people=[{id:'test-a',name:'虚构学生甲',grade:'8'},{id:'test-b',name:'虚构学生乙',grade:'9'}];
 let cards,practice;
 const student=id=>people.find(s=>s.id===id);
 practice=require('../electron/practice-cards.cjs').createPracticeCards({resolveStudentDir:async id=>{if(!student(id))throw Error('scope');return path.join(root,id);},resolveResource:key=>cards.resolve(key),generate:async()=>{throw Error('测试不调用模型');},enqueueReview:async(id,attempt)=>{setTimeout(()=>void practice.reviewAttempt(id,attempt).catch(()=>{}),200);},applyLearning:async()=>({ok:true})});
 cards=require('../electron/card-resources.cjs').createCardResources({directory:path.join(root,'cards'),license:()=>({active:true,edition:'PLATFORM'}),student,students:()=>people,instantiate:(id,r)=>practice.instantiate(id,r),personalCard:(id,c)=>practice.teachingCard(id,c)});
 const courses=require('../electron/course-catalog-store.cjs').createCourseCatalogStore({userDataDir:root,appVersion:'0.21.1',resourceRoots:[path.resolve(__dirname,'../public')],enablePublications:true});
 const center=require('../electron/publication-center.cjs').createPublicationCenter({courses:()=>courses,cards:()=>cards,students:()=>people,license:()=>({active:true,edition:'PLATFORM'})});
 const execute=require('../electron/student-publications.cjs').createStudentPublications({cards,practice});
 const local=require('../electron/terminal-practice-drafts.cjs').createTerminalPracticeDrafts(path.join(root,'local-drafts'));
 const {createServer}=await import('vite');const server=await createServer({server:{host:'127.0.0.1',port:5185,strictPort:true},plugins:[{name:'publication-fixture',configureServer(vite){vite.middlewares.use('/__publication_test',async(req,res)=>{
  try {let text='';for await(const chunk of req){text+=chunk;if(text.length>15000000)throw Error('limit');}const {mode,id,name,input={}}=JSON.parse(text);if(!student(id))throw Error('scope');let data;
   if(mode==='student'){
    const scope={hostId:'fixture',dataGeneration:'1',studentId:id};
    if(name==='localDraftContext')data={scopeToken:'fixture-'+id};
    else if(name==='localDraftLoad')data=await local.load(scope,input.cardId);
    else if(name==='localDraftList')data=await local.list(scope);
    else if(name==='localDraftSave')data=await local.save(scope,input.cardId,input);
    else if(name==='localDraftClear')data=await local.clear(scope,input.cardId,input.attemptId);
    else data=await execute(id,name,input);
   }
   else if(mode==='manager')data=await center.execute(id,name,input);
   else {
    const methods={resourceList:'list',resourceDetail:'detail',resourceFile:'file',resourceStart:'start',resourceSave:'save',resourceDrafts:'drafts',resourceDraft:'draft',resourceNewDraft:'newDraft',resourceSaveDraft:'saveDraft',resourceEditVersion:'editVersion',resourceAssign:'assign',resourcePublicationContext:'publicationContext',resourcePublish:'publish',resourceWithdraw:'withdraw',resourceDraftFile:'draftFile'};
    if(name==='resourceDeleteDraft')data=await cards.deleteDraft(id,input.id,input.revision);
    else if(name==='resourceRestoreDraft')data=await cards.restoreDraft(id,input.id);
    else if(name==='resourceAttach'){const canvas=require('@napi-rs/canvas').createCanvas(600,300),ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,600,300);ctx.fillStyle='#153842';ctx.font='36px Arial';ctx.fillText('Image-only knowledge card',30,80);data=await cards.attachDraftFile(id,input.id,canvas.toBuffer('image/png'),'.png');}
    else if(methods[name])data=await cards[methods[name]](id,['resourceList','resourceNewDraft'].includes(name)?input:input.id||input.key||input,input);
    else throw Error('验收夹具未提供此文件对话框');
   }res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,data}));
  }catch(e){res.end(JSON.stringify({ok:false,message:e.message}));}
 });}}]});await server.listen();console.log('Publication QA: http://127.0.0.1:5185/tests/fixtures/publication-ui.html');
 process.on('SIGINT',async()=>{await server.close();await fs.rm(root,{recursive:true,force:true});process.exit(0);});
})().catch(e=>{console.error(e);process.exitCode=1;});
