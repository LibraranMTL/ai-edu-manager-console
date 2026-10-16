// Run with the same Electron major as the release. No production main process,
// license store, student directory, network Agent or visible window is opened.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const resourcesPath=path.resolve(process.argv[2]),out=path.resolve(__dirname,'../output/card-verification');
require('node:fs').mkdirSync(out,{recursive:true});require('node:fs').writeFileSync(path.join(out,'packaged-probe-start.json'),JSON.stringify({argv:process.argv,at:new Date().toISOString()}));
const root=require('node:fs').mkdtempSync(path.join(os.tmpdir(),'edu-card-package-probe-'));
app.setPath('userData',root);app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{});
const record=stage=>require('node:fs').appendFileSync(path.join(out,'packaged-probe-stages.log'),`${new Date().toISOString()} ${stage}\n`);
process.on('uncaughtException',error=>{record(error.stack);app.exit(1);});process.on('unhandledRejection',error=>{record(String(error.stack||error));app.exit(1);});
record('before-ready');
app.whenReady().then(async()=>{
 record('ready');
 Object.defineProperty(process,'resourcesPath',{value:resourcesPath});
 const runtime=path.join(resourcesPath,'app.asar/electron');const log=[];let cards,student;
 try{
  await fs.mkdir(out,{recursive:true});
  student=require(path.join(runtime,'practice-cards.cjs')).createPracticeCards({resolveStudentDir:async id=>{assert.equal(id,'synthetic');return root;},resolveResource:key=>cards.resolve(key),generate:()=>{throw Error('Probe must not call Agent');},applyLearning:async()=>({ok:true})});
  cards=require(path.join(runtime,'card-resources.cjs')).createCardResources({directory:path.join(root,'resources'),license:()=>({active:true,edition:'PLATFORM'}),student:id=>({id}),students:()=>[{id:'synthetic'}],instantiate:(id,r)=>student.instantiate(id,r)});
  record('catalog');const list=await cards.list('synthetic');assert.equal(list.total,12);log.push('packaged resource catalog: 12 builtins');record('catalog-ready');
  const draft=await cards.newDraft('synthetic',{key:list.items[0].key,scope:'platform'}),prepared=await cards.preparePublication('synthetic',draft.id);await cards.commitPublication('synthetic',prepared);assert(prepared.bytes.length);log.push('packaged worker: platform package encode/decode and publish');
  const card=await cards.start('synthetic',prepared.card.key);await student.submit('synthetic',card.id,{attemptId:'synthetic-answer',answer:'4'});await student.reviewAttempt('synthetic','synthetic-answer');assert.equal((await student.attemptDetail('synthetic','synthetic-answer')).reviews[0].judgement,'correct');log.push('packaged deterministic review and scoped sidecar storage');
  const richCard={id:'synthetic-formula',status:'ready',template:'warm',languagePolicy:{instructionLanguage:'zh-CN'},content:{title:'离线公式与排版验收',subject:'数学',knowledgePoint:'合成样例',minutes:10,prompt:'## 分数与根式\n$$\\frac{1}{2}+\\sqrt{x^2+1}$$\n## 方程组与矩阵\n$$\\begin{cases}x+y=3\\\\x-y=1\\end{cases}\\quad\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}$$\n\n| 中文 | English |\n| --- | --- |\n| 行内公式 $x_1^2$ | Offline math |\n\n1. 查看字体是否完整。\n2. 此处不会显示参考答案。',answer:'DO_NOT_EXPORT_SECRET'}};
  const renderer=require(path.join(runtime,'practice-card-export.cjs'));assert(!renderer.practiceCardHtml(richCard).includes('DO_NOT_EXPORT_SECRET'));
  for(const format of ['pdf','png'])await renderer.renderPracticeCard({card:richCard,format,BrowserWindow,dialog:{showSaveDialog:async()=>({filePath:path.join(out,`packaged-formulas.${format}`)})},tempRoot:root});log.push('packaged offline KaTeX fonts, matrix, fraction, radical, table, PDF and PNG export');
  const {PDFDocument,createCanvas}=require('@napi-rs/canvas'),pdf=new PDFDocument();const context=pdf.beginPage(500,700);context.fillStyle='black';context.font='24px Arial';context.fillText('Original PDF test',40,80);const canvas=createCanvas(120,120),ctx=canvas.getContext('2d');ctx.fillStyle='teal';ctx.fillRect(0,0,120,120);context.drawImage(canvas,40,150);pdf.endPage();const bytes=Buffer.from(pdf.close());
  await require(path.join(runtime,'practice-document.cjs')).renderOriginal({file:{extension:'.pdf',base64:bytes.toString('base64')},card:richCard,format:'png',BrowserWindow,dialog:{showSaveDialog:async()=>({filePath:path.join(out,'packaged-original.png')})},tempRoot:root});log.push('packaged native PDF/canvas worker renders original pages');
  const ocrCanvas=createCanvas(800,200),ocrCtx=ocrCanvas.getContext('2d');ocrCtx.fillStyle='white';ocrCtx.fillRect(0,0,800,200);ocrCtx.fillStyle='black';ocrCtx.font='48px Arial';ocrCtx.fillText('Hello 123',30,100);const ocrFile=path.join(root,'ocr.png');await fs.writeFile(ocrFile,ocrCanvas.toBuffer('image/png'));const ocr=await require(path.join(runtime,'project-material-extract.cjs')).runImageOcr({path:ocrFile},{language:'en'});assert(ocr.text.trim());log.push(`packaged Windows OCR: language ${ocr.language}, fallback ${ocr.languageFallback}`);
  const removable=await cards.newDraft('synthetic',{key:prepared.card.key,scope:'personal'});const deleted=await cards.deleteDraft('synthetic',removable.id,removable.revision);assert(deleted.deleted);await cards.restoreDraft('synthetic',removable.id);assert(await cards.resolve(prepared.card.key));log.push('packaged draft delete and restore leave published version usable');
  const landscapeCard={...richCard,layout:{fontSize:18,accent:'#123456',paper:'A4',orientation:'landscape'}};
  const landscapePdf=path.join(out,'packaged-landscape.pdf');await renderer.renderPracticeCard({card:landscapeCard,format:'pdf',BrowserWindow,dialog:{showSaveDialog:async()=>({filePath:landscapePdf})},tempRoot:root});
  const originalLandscape=path.join(out,'packaged-original-landscape.pdf');await require(path.join(runtime,'practice-document.cjs')).renderOriginal({file:{extension:'.pdf',base64:bytes.toString('base64')},card:landscapeCard,format:'pdf',BrowserWindow,dialog:{showSaveDialog:async()=>({filePath:originalLandscape})},tempRoot:root});
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');for(const file of [landscapePdf,originalLandscape]){const loading=getDocument({data:new Uint8Array(await fs.readFile(file)),isEvalSupported:false}),pdf=await loading.promise;try{const page=await pdf.getPage(1),view=page.getViewport({scale:1});assert(view.width>view.height);if(file===originalLandscape)assert.equal(pdf.numPages,1);}finally{await loading.destroy();}}log.push('packaged structured and original PDF export: landscape A4 dimensions; original fits one page');
  const report={at:new Date().toISOString(),ok:true,resourcesPath,temporaryRoot:root,checks:log};await fs.writeFile(path.join(out,'packaged-smoke.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }catch(error){const report={at:new Date().toISOString(),ok:false,checks:log,error:error.stack};await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'packaged-smoke.json'),JSON.stringify(report,null,2));console.error(error);process.exitCode=1;}
 finally{for(const window of BrowserWindow.getAllWindows())window.destroy();console.log(`Temporary synthetic profile retained for cleanup after Electron exits: ${root}`);app.exit(process.exitCode||0);}
});
