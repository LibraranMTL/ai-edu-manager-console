'use strict';
const { parentPort, workerData, Worker, isMainThread } = require('node:worker_threads');
if (!isMainThread) {
  try {
    const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{createCoursePackage}=require('./course-package-v2.cjs');
    const {options,storeOptions,assets}=workerData;
    const requestHash=crypto.createHash('sha256').update(JSON.stringify({drafts:options.drafts,deletedCourseIds:options.deletedCourseIds})).digest('hex');
    const receipt=options.outputPath+'.request.json';fs.mkdirSync(path.dirname(receipt),{recursive:true});
    if(fs.existsSync(receipt)) {if(JSON.parse(fs.readFileSync(receipt,'utf8')).requestHash!==requestHash)throw Error('发布内容已变化，请重新打开发布窗口再发布');}
    else {if(fs.existsSync(options.outputPath))throw Error('发布缓存缺少事务记录，请使用新的发布编号');fs.writeFileSync(receipt,JSON.stringify({requestHash}),{flag:'wx',mode:0o600});}
    const built=fs.existsSync(options.outputPath)?null:createCoursePackage({...options,resolveAssetPath:name=>assets[name]||''});
    const store=require('./course-catalog-store.cjs').createCourseCatalogStore(storeOptions);
    const current=store.state().platformCatalog;
    const hash=require('./course-publications.cjs').courseContentHash;
    const packageHelpers=require('./course-package-v2.cjs');
    const alreadyInstalled=current&&(options.drafts||[]).every(d=>{const item=current.courses.find(c=>c.courseId===d.courseId),sourcePath=assets[d.course.coverAsset];if(!item||!sourcePath||!fs.existsSync(sourcePath))return false;
      const bytes=fs.readFileSync(sourcePath),coverAsset=`platform-assets/${packageHelpers.sha256Buffer(bytes)}${packageHelpers.imageExtension(bytes)}`;
      return hash(item)===hash({...d.course,coverAsset});})&&(options.deletedCourseIds||[]).every(id=>!current.courses.some(c=>c.courseId===id));
    if(!alreadyInstalled&&(current?.catalogVersion||'')!==(options.baseCatalog?.catalogVersion||''))throw Error('课程目录已变化，请重试以保留其他已发布课程');
    const result=alreadyInstalled?{ok:true,catalog:current}:store.importCoursePackage(options.outputPath);
    if(!result.ok)throw Error(result.message||'课程包校验失败');
    parentPort.postMessage({ok:true,catalogVersion:result.catalog.catalogVersion,sha256:built?.sha256||'',outputPath:options.outputPath});
  }catch(error){parentPort.postMessage({ok:false,message:error.message});}
} else {
  module.exports.runCoursePublishWorker = input => new Promise((resolve,reject)=>{
    const worker=new Worker(__filename,{workerData:input});
    let settled=false;
    const fail=error=>{if(!settled){settled=true;clearTimeout(timer);reject(error);}};
    const timer=setTimeout(()=>{void worker.terminate();fail(Error('课程发布处理超时，原草稿保留'));},120000);
    worker.once('message',result=>{if(settled)return;settled=true;clearTimeout(timer);result.ok?resolve(result):reject(Error(result.message));});
    worker.once('error',fail);
    worker.once('exit',code=>{if(!settled)fail(Error(`课程发布进程未返回完整回执：${code}`));});
  });
}
