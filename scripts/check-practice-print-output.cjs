'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {Worker}=require('node:worker_threads'),canvas=require('@napi-rs/canvas');
const out=path.resolve(__dirname,'../.codex_tmp/print-qa');
(async()=>{
 await fs.mkdir(out,{recursive:true});
 if(process.argv.includes('--prepare')){
   const image=canvas.createCanvas(800,500),ctx=image.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,800,500);ctx.strokeStyle='#216a72';ctx.lineWidth=10;ctx.strokeRect(10,10,780,480);ctx.fillStyle='#183440';ctx.font='40px Arial';ctx.fillText('Original image - no distortion',30,100);ctx.beginPath();ctx.arc(400,290,100,0,2*Math.PI);ctx.stroke();
   await fs.writeFile(path.join(out,'input-image.json'),JSON.stringify({extension:'.png',base64:image.toBuffer('image/png').toString('base64')}));
   const pdf=new canvas.PDFDocument();for(let i=1;i<=2;i++){const page=pdf.beginPage(600,800);page.fillStyle='white';page.fillRect(0,0,600,800);page.fillStyle='#183440';page.font='40px Arial';page.fillText(`Original page ${i} / 2`,30,90);page.strokeStyle='#216a72';page.lineWidth=8;page.strokeRect(10,10,580,780);pdf.endPage();}
   await fs.writeFile(path.join(out,'input-pdf.json'),JSON.stringify({extension:'.pdf',base64:Buffer.from(pdf.close()).toString('base64')}));console.log('Synthetic originals ready');return;
 }
 globalThis.DOMMatrix=canvas.DOMMatrix;globalThis.Path2D=canvas.Path2D;
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const results=[];
 for(const name of ['structured-portrait','structured-landscape','image-landscape','pdf-landscape']){
   const bytes=await fs.readFile(path.join(out,`${name}.pdf`));const loading=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,verbosity:0});const doc=await loading.promise;
   try{const dimensions=[];let text='';for(let n=1;n<=doc.numPages;n++){const page=await doc.getPage(n),view=page.getViewport({scale:1});assert(name.includes('landscape')?view.width>view.height:view.width<view.height);dimensions.push([view.width,view.height]);text+=(await page.getTextContent()).items.map(i=>i.str).join(' ');}
     assert(!text.includes('SECRET_ANSWER'));if(name==='image-landscape'||name==='structured-landscape')assert.equal(doc.numPages,1);if(name==='pdf-landscape')assert.equal(doc.numPages,2);
     results.push({name,pages:doc.numPages,dimensions});
   }finally{await loading.destroy();}
   const images=await new Promise((resolve,reject)=>{const worker=new Worker(path.resolve(__dirname,'../electron/practice-pdf-preview-worker.cjs'),{workerData:{bytes}});worker.once('message',m=>{worker.terminate();m.error?reject(Error(m.error)):resolve(m.images);});worker.once('error',reject);});
   for(let i=0;i<images.length;i++)await fs.writeFile(path.join(out,`${name}-page${i+1}.png`),Buffer.from(images[i].split(',')[1],'base64'));
 }
 await fs.writeFile(path.join(out,'output-check.json'),JSON.stringify({ok:true,results},null,2));console.log(JSON.stringify(results));
})().catch(error=>{console.error(error);process.exitCode=1;});
