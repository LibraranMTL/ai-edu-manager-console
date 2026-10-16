'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const { acquireExtractionSlot, runDocumentWorker } = require('./project-material-extract.cjs');
async function previewDocx({ bytes, tempRoot }) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 10*1024*1024 || bytes.subarray(0,2).toString() !== 'PK') throw Error('DOCX 文件格式或大小无效');
  const release = await acquireExtractionSlot();
  const root = await fs.mkdtemp(path.join(tempRoot, 'edu-card-preview-'));
  const file = path.join(root, 'answer.docx');
  try {
    await fs.writeFile(file, bytes, { flag:'wx', mode:0o600 });
    const result = await runDocumentWorker({path:file,size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}, 'docx');
    return {extension:'.docx',text:result.text,warnings:result.warnings};
  } finally { release();await fs.rm(file,{force:true});await fs.rmdir(root); }
}
async function renderOriginal({ file, card, format, BrowserWindow, dialog, parent, tempRoot }) {
  const bytes = Buffer.from(file.base64,'base64');
  if (file.extension === '.pdf' && format === 'pdf' && !card.layout?.orientation) {
    const chosen=await dialog.showSaveDialog(parent,{title:'保存原版 PDF（保留原文件全部内容）',defaultPath:'学习卡片.pdf',filters:[{name:'PDF',extensions:['pdf']}]});
    if(chosen.canceled||!chosen.filePath)return {cancelled:true};await fs.writeFile(chosen.filePath,bytes);return {saved:true};
  }
  return require('./practice-card-export.cjs').renderPracticeCard({card,format,BrowserWindow,dialog,parent,tempRoot,htmlOverride:()=>originalCardHtml({file,card})});
}
async function originalCardHtml({file,card}) {
  const bytes=Buffer.from(file.base64,'base64');
  let images;
  if (file.extension === '.pdf') {
    const {Worker} = require('node:worker_threads');
    const release=await acquireExtractionSlot();
    try { images=await new Promise((resolve,reject)=>{
      const worker=new Worker(path.join(__dirname,'practice-pdf-preview-worker.cjs'),{workerData:{bytes,runtimeRoot:__dirname.includes('app.asar')?path.join(process.resourcesPath,'material-pdf-runtime'):null},resourceLimits:{maxOldGenerationSizeMb:384}});
      const timer=setTimeout(()=>{worker.terminate();reject(Error('PDF 排版超时，请另存原版后打印'));},60000);
      worker.once('message',data=>{clearTimeout(timer);worker.terminate();data.error?reject(Error(data.error)):resolve(data.images);});
      worker.once('error',error=>{clearTimeout(timer);reject(error);});
      worker.once('exit',code=>{clearTimeout(timer);if(code)reject(Error('PDF 预览进程提前退出'));});
    }); } finally { release(); }
  } else images=[`data:${file.extension==='.png'?'image/png':'image/jpeg'};base64,${file.base64}`];
  const paper=card.layout?.paper==='Letter'?'Letter':'A4',landscape=card.layout?.orientation==='landscape';
  const [short,long]=paper==='Letter'?[215.9,279.4]:[210,297],width=(landscape?long:short)-16,height=(landscape?short:long)-16;
  const html=`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>@page{size:${paper} ${landscape?'landscape':'portrait'};margin:8mm}*{box-sizing:border-box}html{scrollbar-width:none}::-webkit-scrollbar{display:none}body{margin:0}.original-sheet{width:100%;aspect-ratio:${width}/${height};break-after:page}.original-sheet:last-child{break-after:auto}.original-sheet img{display:block;width:100%;height:100%;object-fit:contain}@media print{.original-sheet{height:${height}mm;width:${width}mm}}</style></head><body><main class="page">${images.map(image=>`<div class="original-sheet"><img src="${image}" alt="原版卡片"></div>`).join('')}</main></body></html>`;
  return html;
}
module.exports={previewDocx,renderOriginal,originalCardHtml};
