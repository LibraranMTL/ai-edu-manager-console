const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { createPracticeCards } = require('../electron/practice-cards.cjs');
(async()=>{
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'edu-practice-ui-'));
  let resources;const people=[{id:'fixture-student',name:'虚构测试学生',grade:'8'}];
  const api=createPracticeCards({resolveStudentDir:async id=>{if(id!=='fixture-student')throw Error('scope');return root;},
    resolveResource:key=>resources.resolve(key),
    snapshot:async()=>({profile:{},inputFingerprint:'fixture',learningSignals:['隔离测试报告：复习平均数'],confirmedGrowthSignals:[],sourceIds:[]}),
    generate:async({schema,input})=>schema.required.includes('passed')?{passed:true,languagePassed:true,reason:'隔离测试复核'}:schema.required.includes('judgement')?
      {judgement:'correct',summary:'答案正确。',correctParts:['正确计算平均数'],issues:[],suggestions:['可以尝试三个数的平均数。'],limitations:[],answerQuotes:[input.studentAnswer],readable:true,consistent:true}:
      {title:'从数据中找到平均数',subject:'数学',knowledgePoint:'平均数',rationale:'隔离测试练习',minutes:10,sourceRefs:['E0'],prompt:'## 先观察，再计算\n求 $1$ 和 $3$ 的平均数。\n\n$$\\bar{x}=\\frac{x_1+x_2}{2}$$\n\n| 数据 | 数值 |\n| --- | --- |\n| 第一个数 | 1 |\n| 第二个数 | 3 |',hint:'先相加，再除以数量。',answer:'$\\bar{x}=2$',explanation:'1. 求和：$1+3=4$。\n2. 平均分成两份：$4\\div 2=2$。'},
    enqueueReview:async(id,attempt)=>{setTimeout(()=>void api.reviewAttempt(id,attempt).catch(()=>{}),300);},applyLearning:async()=>({ok:true}) });
  resources=require('../electron/card-resources.cjs').createCardResources({directory:path.join(root,'resources'),license:()=>({active:true,edition:'PLATFORM'}),student:id=>people.find(p=>p.id===id),students:()=>people,instantiate:(id,r)=>api.instantiate(id,r),personalCard:(id,c)=>api.teachingCard(id,c)});
  if(process.env.EDU_PRACTICE_UI_LEGACY==='1'){const generated=await api.generate('fixture-student');await api.start('fixture-student',generated.card.id);const file=path.join(root,'practice-cards/store.json'),value=JSON.parse(await fs.readFile(file,'utf8'));value.cards[0].status='superseded';value.attempts=[{attemptId:'legacy-fixture',cardId:generated.card.id,studentId:'fixture-student',answer:'2',submittedAt:'2026-10-01T00:00:00Z',evidenceStatus:'pending_review'}];await fs.writeFile(file,JSON.stringify(value));}
  const {createServer}=await import('vite');const server=await createServer({server:{host:'127.0.0.1',port:5184,strictPort:true},plugins:[{name:'practice-test-only',configureServer(vite){vite.middlewares.use('/__practice_test',async(req,res)=>{
    try{let text='';for await(const chunk of req){text+=chunk;if(text.length>15000000)throw Error('limit');}const {method,args}=JSON.parse(text);let data;
      if(method==='action'){const [id,action,input={}]=args;
        const methods={resourceList:'list',resourceDetail:'detail',resourceStart:'start',resourceSave:'save',resourceDrafts:'drafts',resourceDraft:'draft',resourceNewDraft:'newDraft',resourceSaveDraft:'saveDraft',resourceEditVersion:'editVersion',resourceAssign:'assign'};
        if(action==='resourcePublish'){const prepared=await resources.preparePublication(id,input.id);if(prepared.bytes)await fs.writeFile(path.join(root,'fixture.edu-cardpkg'),prepared.bytes);data=await resources.commitPublication(id,prepared);}
        else if(action==='resourceDeleteDraft')data=await resources.deleteDraft(id,input.id,input.revision);
        else if(action==='resourceRestoreDraft')data=await resources.restoreDraft(id,input.id);
        else if(action==='resourceAttach'){const {createCanvas}=require('@napi-rs/canvas'),canvas=createCanvas(640,360),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,640,360);ctx.fillStyle='black';ctx.font='32px Arial';ctx.fillText('Sample card 1 + 3 = ?',30,100);data=await resources.attachDraftFile(id,input.id,canvas.toBuffer('image/png'),'.png');}
        else if(action==='resourceDraftFile')data=await resources.draftFile(id,input.id);
        else if(methods[action])data=await resources[methods[action]](id,['resourceNewDraft','resourceList'].includes(action)?input:input.id||input.key||input,input);
        else {const names={workspace:'workspace',cardChoices:'cardChoices',attempts:'listAttempts',detail:'attemptDetail',retry:'requestReview',confirm:'confirmReview',assistance:'assistance'};
          if(!names[action])throw Error('test action unavailable');data=await api[names[action]](id,action==='detail'||action==='retry'||action==='confirm'?input.attemptId:action==='assistance'?input.cardId:input,action==='assistance'?input.kind:input);}
      }else{if(!['generate','start','submit','savePlan'].includes(method))throw Error('test method');data=await api[method](...args);}res.end(JSON.stringify({ok:true,data}));
    }catch(error){res.end(JSON.stringify({ok:false,message:error.message}));}
  });}}]});await server.listen();console.log('Isolated UI: http://127.0.0.1:5184/tests/fixtures/practice-ui.html');
  process.on('SIGINT',async()=>{await server.close();await fs.rm(root,{recursive:true,force:true});process.exit(0);});
})();
