'use strict';
const {parentPort,workerData}=require('node:worker_threads');
const path=require('node:path'),fs=require('node:fs/promises'),{pathToFileURL}=require('node:url');
(async()=>{
  const root=workerData.runtimeRoot,pdfRoot=root?path.join(root,'pdfjs'):path.dirname(require.resolve('pdfjs-dist/package.json'));
  const canvas=require(root?path.join(root,'canvas'):require.resolve('@napi-rs/canvas'));
  globalThis.DOMMatrix=canvas.DOMMatrix;globalThis.Path2D=canvas.Path2D;
  const pdfjs=await import(pathToFileURL(path.join(pdfRoot,'legacy/build/pdf.mjs')).href);
  class LocalBinaryFactory{async fetch({kind,filename}){const folder={cMapUrl:'cmaps',standardFontDataUrl:'standard_fonts',wasmUrl:'wasm'}[kind];if(!folder||!/^[-A-Za-z0-9_.]+$/.test(filename)||['.','..'].includes(filename))throw Error('不允许的 PDF 外部资源');return new Uint8Array(await fs.readFile(path.join(pdfRoot,folder,filename)));}}
  class LocalCanvasFactory{create(width,height){if(!Number.isFinite(width+height)||width<=0||height<=0||width*height>16000000)throw Error('PDF 画布超过限制');const image=canvas.createCanvas(Math.ceil(width),Math.ceil(height));return {canvas:image,context:image.getContext('2d')};}reset(holder,width,height){this.destroy(holder);Object.assign(holder,this.create(width,height));}destroy(holder){if(holder.canvas){holder.canvas.width=1;holder.canvas.height=1;}holder.canvas=null;holder.context=null;}}
  const loading=pdfjs.getDocument({data:new Uint8Array(workerData.bytes),isEvalSupported:false,enableXfa:false,useWorkerFetch:false,useSystemFonts:false,stopAtErrors:true,maxImageSize:16000000,
    CanvasFactory:LocalCanvasFactory,BinaryDataFactory:LocalBinaryFactory,cMapUrl:'local/',cMapPacked:true,standardFontDataUrl:'local/',wasmUrl:'local/',verbosity:0});
  try{
    const doc=await loading.promise;if(doc.numPages>20)throw Error('原版超过 20 页，请另存 PDF 后使用阅读器打印');
    const images=[];let total=0;
    for(let number=1;number<=doc.numPages;number++){
      const page=await doc.getPage(number),natural=page.getViewport({scale:1});
      const view=page.getViewport({scale:Math.min(2,1400/Math.max(natural.width,natural.height))});
      if(!Number.isFinite(view.width+view.height)||view.width<=0||view.height<=0||view.width*view.height>2000000)throw Error('PDF 页面尺寸无效');
      const image=canvas.createCanvas(Math.ceil(view.width),Math.ceil(view.height));
      try{await page.render({canvasContext:image.getContext('2d'),viewport:view,background:'white'}).promise;const png=await image.encode('png');total+=png.length;if(total>24*1024*1024)throw Error('预览过大，请另存原版文件');images.push(`data:image/png;base64,${png.toString('base64')}`);}finally{image.width=1;image.height=1;page.cleanup();}
    }
    parentPort.postMessage({images});
  }finally{await loading.destroy();}
})().catch(error=>parentPort.postMessage({error:error.message}));
