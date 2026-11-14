'use strict';
// Packaged Electron/ASAR probe; only synthetic files, no application startup or Agent invocation.
const { app }=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
async function run(){
  const archive=path.resolve(process.argv[2]),source=path.resolve(process.argv[3]);
  assert.equal(path.basename(archive),'app.asar');
  const files=['main.cjs','task-draft.cjs','task-sql-store.cjs','task-source-queue.cjs','task-source-projection.cjs','task-store-service.cjs','task-store-writer.cjs','task-io-client.cjs','task-io-worker.cjs',
    'task-power-recovery.cjs','task-active-deadlines.cjs','task-executor-circuit.cjs','task-circuit-probe.cjs',
    'workbuddy-controlled.cjs','workbuddy-runtime.cjs','project-material-agent.cjs','practice-task-host.cjs'];
  const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
  for(const name of files)assert.equal(hash(await fs.readFile(path.join(archive,'electron',name))),hash(await fs.readFile(path.join(source,'electron',name))),name);
  const load=name=>require(path.join(archive,'electron',name));
  const client=load('task-io-client.cjs').createTaskIoClient(),service=load('task-store-service.cjs').createTaskStoreService({request:(...args)=>client.request(...args)});
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'edu-task-async-package-')),file=path.join(root,'tasks.json');
  try{
    await service.initialize(file);
    for(let i=0;i<20;i++){
      const snapshot=service.read(file),store=service.track(snapshot.value,snapshot.revision);
      store.tasks.push({id:`synthetic-${i}`,status:'pending',title:'合成测试'});
      service.write(file,store,store);service.appendEvent({taskId:`synthetic-${i}`,event:'test'});
    }
    await service.flush();
    assert.equal((await client.request(file,'records')).tasks.length,20);
    const {DatabaseSync}=require('node:sqlite');
    const db=new DatabaseSync(path.join(root,'task-state.sqlite3'),{readOnly:true});
    assert.equal(db.prepare('SELECT count(*) n FROM task_events').get().n,20);db.close();
    assert.equal((await client.request(file,'list')).ready,true);
    client.pause();client.resume();
    const events=[];const power=load('task-power-recovery.cjs').createTaskPowerRecovery({persist:async state=>events.push(state.phase),reconcile:async()=>events.push('checked')});
    await power.suspend();await power.resume();assert.deepEqual(events,['suspended','reconciling','checked','ready']);
    const circuit=load('task-executor-circuit.cjs');let state;
    for(let i=0;i<3;i++)state=circuit.recordCircuitOutcome(state,{executionId:String(i),failure:{code:'ECONNRESET'}});
    assert.equal(circuit.circuitDecision(state).allowed,false);
    assert.throws(()=>load('workbuddy-controlled.cjs').parseFixedResult('{"result":"READY"}','authentication required',0));
    const report={ok:true,electron:process.versions.electron,sourceFilesMatched:files.length,
      workerDurableWrites:20,auditEvents:20,queryAfterWrites:true,powerRecovery:true,circuit:true,
      realStudentAccess:false,liveAgentCall:false};
    if(process.argv[4]){const reportPath=path.resolve(process.argv[4]);await fs.mkdir(path.dirname(reportPath),{recursive:true});await fs.writeFile(reportPath,`${JSON.stringify(report,null,2)}\n`);}
    console.log(JSON.stringify(report));
  }finally{await client.close();await fs.rm(root,{recursive:true,force:true});}
}
run().then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1);});
