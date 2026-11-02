'use strict';
// Explicit synthetic probe, not included in the application bundle.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {performance,monitorEventLoopDelay}=require('node:perf_hooks');
const {MATERIAL_SCHEMA}=require('../electron/project-material-contract.cjs');
const {projectTaskSource}=require('../electron/task-source-projection.cjs');
const {createProjectStateIoClient}=require('../electron/project-state-io-client.cjs');
(async()=>{
 const report={synthetic:true,results:[]};
 for(const count of [40000,100000]){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'edu-source-projection-'));
  const managerPath=path.join(root,'manager');fs.mkdirSync(path.join(managerPath,'project-materials'),{recursive:true});
  const materials=Array.from({length:count},(_,i)=>({materialId:'material-'+i,projectId:'project-one',version:1,
   sha256:i.toString(16).padStart(64,'0'),size:100,location:{kind:'workspace',rootId:'workspace',relativePath:'资料/'+i+'.md'},
   adoption:{state:'accepted'},processing:{state:'pending'},availability:'available'}));
  fs.writeFileSync(path.join(managerPath,'project-materials','registry.json'),JSON.stringify({schema:MATERIAL_SCHEMA,projectId:'project-one',revision:1,materials,categories:[],receipts:[],commits:[]}));
  const source=projectTaskSource({id:'project-one',managerPath,materialStorageMode:'workspace-v1',stagingItems:materials,workspaceScanSnapshot:materials});
  assert.equal(source.stagingItems,undefined);assert.equal(source.workspaceScanSnapshot,undefined);
  const client=createProjectStateIoClient({dbPath:path.join(root,'project.sqlite3')});
  const delay=monitorEventLoopDelay({resolution:10});delay.enable();const start=performance.now(),before=process.memoryUsage().heapUsed;
  try{
   const result=await client.request('task_projection',{sourceType:'project',source});
   assert.equal(result.digestState.pendingCount,count);assert.equal(result.digestState.pendingFiles,undefined);
   const bytes=Buffer.byteLength(JSON.stringify(result));assert(bytes<10000);
   delay.disable();const row={count,durationMs:performance.now()-start,responseBytes:bytes,mainEventLoopMaxMs:delay.max/1e6,mainHeapDeltaMB:(process.memoryUsage().heapUsed-before)/1048576};
   assert(row.mainEventLoopMaxMs<100);report.results.push(row);console.log(JSON.stringify(row));
  }finally{await client.close();fs.rmSync(root,{recursive:true,force:true});}
 }
 report.passed=true;fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/task-source-projection-benchmark.json',JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
