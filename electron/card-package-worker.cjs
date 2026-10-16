const { parentPort, workerData, Worker } = require('node:worker_threads');
const { encodeCardPackage, decodeCardPackage } = require('./card-resource-package.cjs');
if(parentPort && workerData?.kind==='card-package'){
  Promise.resolve().then(()=>workerData.operation==='encode'?encodeCardPackage(workerData.resources,workerData.assets):decodeCardPackage(Buffer.from(workerData.bytes)))
    .then(result=>parentPort.postMessage({ok:true,result}),error=>parentPort.postMessage({ok:false,message:error.message}));
}
function runCardPackageWorker(input){return new Promise((resolve,reject)=>{
  const worker=new Worker(__filename,{workerData:{...input,kind:'card-package'},resourceLimits:{maxOldGenerationSizeMb:384}});let done=false;
  const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);void worker.terminate();error?reject(error):resolve(result);};
  const timer=setTimeout(()=>finish(Error('卡片包处理超时，未改变资源目录')),60000);
  worker.once('message',message=>finish(message.ok?null:Error(message.message),message.result));worker.once('error',error=>finish(error));worker.once('exit',code=>{if(!done)finish(Error(`卡片包进程异常退出 ${code}`));});
});}
module.exports={runCardPackageWorker};
