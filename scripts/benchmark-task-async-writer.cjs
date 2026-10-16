'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {performance,monitorEventLoopDelay}=require('node:perf_hooks');
const {createTaskIoClient}=require('../electron/task-io-client.cjs');
const {createTaskStoreService}=require('../electron/task-store-service.cjs');
const p95=a=>[...a].sort((a,b)=>a-b)[Math.ceil(a.length*.95)-1];
async function run(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'edu-task-writer-benchmark-'));
  const report={scope:'Synthetic storage/read-model timings, not UI acceptance or a four-hour soak',node:process.version,cpus:os.cpus().length,cpu:os.cpus()[0]?.model,memoryGiB:+(os.totalmem()/1024**3).toFixed(1),results:[]};
  try{
    for(const count of [1000,10000]){
      const file=path.join(root,`${count}.json`),client=createTaskIoClient(),service=createTaskStoreService({request:(...a)=>client.request(...a)});
      try{
        await fs.writeFile(file,JSON.stringify({tasks:Array.from({length:count},(_,i)=>({id:`t${i}`,title:`合成资料${i}`,status:i===0?'running':i%4?'succeeded':'pending',executionId:i===0?'run-0':'',sourceType:'student',sourceId:`s${i%20}`,updatedAt:new Date(1700000000000+i).toISOString(),input:{prompt:'合成资料正文。'.repeat(40)},result:{summary:'合成结果。'.repeat(100),validation:{valid:true}}})),history:[]}));
        await service.initialize(file);await client.request(file,'list');
        const reads=[],writes=[],mainStages=[],loop=monitorEventLoopDelay({resolution:10});loop.enable();
        for(let i=0;i<12;i++){
          const start=performance.now(),got=service.read(file),store=service.track(got.value,got.revision);store.tasks[i].title=`已更新${i}`;
          service.write(file,store,store);mainStages.push(performance.now()-start);
          const queryStart=performance.now(),read=client.request(file,'list',{page:i%10+1});
          await service.flush();writes.push(performance.now()-start);await read;reads.push(performance.now()-queryStart);
          await new Promise(r=>setTimeout(r,10));
        }
        const progress=[],ledgerBefore=await fs.stat(file);
        for(let i=0;i<50;i++){
          const start=performance.now();service.writeProgress(file,[{taskId:'t0',executionId:'run-0',lastHeartbeatAt:new Date(1800000000000+i).toISOString()}]);
          await service.flush();progress.push(performance.now()-start);
        }
        const ledgerAfter=await fs.stat(file);
        loop.disable();
        const round=x=>+x.toFixed(2);
        report.results.push({count,fileBytes:ledgerAfter.size,iterations:12,concurrentQueryP95Ms:round(p95(reads)),durableWriteP95Ms:round(p95(writes)),
          progressJournalIterations:50,progressJournalP95Ms:round(p95(progress)),progressDidNotRewriteLedger:ledgerBefore.size===ledgerAfter.size&&ledgerBefore.mtimeMs===ledgerAfter.mtimeMs,
          mainSnapshotStageMaxMs:round(Math.max(...mainStages)),mainLoopDelayMaxMs:round(loop.max/1e6)});
      }finally{client.close();}
    }
    console.log(JSON.stringify(report,null,2));
  }finally{await fs.rm(root,{recursive:true,force:true});}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
