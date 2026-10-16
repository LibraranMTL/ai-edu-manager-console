const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {Worker}=require('node:worker_threads'),{PDFDocument}=require('@napi-rs/canvas');
const {previewDocx}=require('../electron/practice-document.cjs'),{extractPracticeAnswer}=require('../electron/practice-extract.cjs');
test('landscape original exports fit each page and leave original download separate',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'practice-orientation-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 let html='',options;class Window extends require('node:events').EventEmitter{constructor(o){super();options=o;this.webContents={on:()=>{},setWindowOpenHandler:()=>{},executeJavaScript:async()=>true,printToPDF:async o=>{assert.equal(o.landscape,true);assert.equal(o.pageSize,'Letter');return Buffer.from('test-pdf');}};}setMenuBarVisibility(){}async loadFile(file){html=await fs.readFile(file,'utf8');}isDestroyed(){return false;}destroy(){}}
 const card={id:'fixture',languagePolicy:{instructionLanguage:'zh-CN'},layout:{paper:'Letter',orientation:'landscape'}};
 await require('../electron/practice-document.cjs').renderOriginal({file:{extension:'.png',base64:require('@napi-rs/canvas').createCanvas(80,60).toBuffer('image/png').toString('base64')},card,format:'pdf',BrowserWindow:Window,dialog:{showSaveDialog:async()=>({filePath:path.join(root,'out.pdf')})},tempRoot:root});
 assert.match(html,/@page\{size:Letter landscape/);assert.match(html,/object-fit:contain/);assert(options.width>options.height);
 const structured={id:'fixture',status:'ready',content:{title:'test',subject:'数学',prompt:'$x^2$',minutes:10},layout:{fontSize:18,accent:'#123456',paper:'A4',orientation:'landscape'}};
 assert.match(require('../electron/practice-card-export.cjs').practiceCardHtml(structured),/@page\{size:A4 landscape/);
});
test('DOCX before-submit preview is local, bounded and cleans owned temporary files',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'practice-preview-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const JSZip=require('node:module').createRequire(require.resolve('exceljs'))('jszip');const zip=new JSZip();zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>2</w:t></w:r></w:p></w:body></w:document>');
 const result=await previewDocx({bytes:await zip.generateAsync({type:'nodebuffer'}),tempRoot:root});assert.equal(result.text.trim(),'2');assert.deepEqual(await fs.readdir(root),[]);
 await assert.rejects(previewDocx({bytes:Buffer.from('not docx'),tempRoot:root}));
});
test('text PDF grading excludes transport page labels and original rendering is isolated',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'practice-pdf-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const pdf=new PDFDocument(),ctx=pdf.beginPage(600,800);ctx.fillStyle='black';ctx.font='24px Arial';ctx.fillText('2',40,60);pdf.endPage();const bytes=Buffer.from(pdf.close()),file=path.join(root,'input.pdf');await fs.writeFile(file,bytes);
 const result=await extractPracticeAnswer({root,studentId:'fixture',attachment:{sha256:crypto.createHash('sha256').update(bytes).digest('hex'),extension:'.pdf',bytes:bytes.length},path:file,language:'en'});
 assert.equal(result.quality,'complete');assert.equal(result.text.trim(),'2');
 const rendered=await new Promise((resolve,reject)=>{const worker=new Worker(path.join(__dirname,'../electron/practice-pdf-preview-worker.cjs'),{workerData:{bytes}});worker.once('message',value=>{worker.terminate();value.error?reject(Error(value.error)):resolve(value);});worker.once('error',reject);});
 assert.equal(rendered.images.length,1);assert.match(rendered.images[0],/^data:image\/png;base64/);
});
