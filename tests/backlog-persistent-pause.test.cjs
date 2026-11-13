'use strict';
// Exercise the actual convergence function against an isolated persisted setting.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
function extract(file){const s=fs.readFileSync(file,'utf8'),p=ts.createSourceFile('main.js',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let f;function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='runTaskBacklogConvergenceSlice')f=n;else ts.forEachChild(n,visit)}visit(p);assert.ok(f);return s.slice(f.getStart(p),f.end)}
test('persisted task pause blocks backlog after restart and between rows',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'edu-backlog-pause-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const setting=path.join(dir,'settings.json'),save=(auto,paused)=>fs.writeFileSync(setting,JSON.stringify({taskAutomationEnabled:auto,backlogConvergencePaused:paused}));save(false,true);
 let preview=0,applied=0,checkpointWrites=0,pauseAfterFirst=false;
 function boot(){const c={AUTOMATION_FEATURES:{backlogConvergence:true},backlogConvergenceRunning:false,taskReadMaintenanceStopped:false,
 readSettings:()=>JSON.parse(fs.readFileSync(setting,'utf8')),
 taskAutomationEnabled:()=>JSON.parse(fs.readFileSync(setting,'utf8')).taskAutomationEnabled!==false,
 taskStoreGuard:{ready:()=>true,status:()=>null,previewTaskRecovery:async()=>{preview++;return{rows:[{},{}]}},applyTaskRecovery:async()=>{applied++;if(pauseAfterFirst)save(true,true);return{applied:true}}},
 projectArchiveRuntime:{status:()=>({ready:true})},readBacklogConvergenceCheckpoint:()=>({}),planConvergenceSlice:()=>({safeRows:[{taskId:'one',action:'other'},{taskId:'two',action:'other'}],checkpoint:{jobId:'synthetic',scanned:2}}),
 finishConvergenceSlice:()=>({applied,conflicts:0}),writeBacklogConvergenceCheckpoint:()=>checkpointWrites++,automaticTaskWakeQueue:{schedule(){throw Error('unexpected dispatch')}},syncAgentTaskResults(){throw Error('unexpected sync')},scheduleDigestWorkflowMonitor(){throw Error('unexpected monitor')}};
 vm.runInNewContext(extract(process.env.EDU_TEST_PACKAGED_MAIN || path.join(root,'electron/main.cjs'))+';globalThis.run=runTaskBacklogConvergenceSlice',c);return c.run;}
 assert.equal((await boot()()).skipped,true);assert.equal(preview,0);assert.equal(applied,0);
 assert.equal((await boot()()).skipped,true);assert.equal(preview,0); // simulated restart, setting retained
 save(true,true);assert.equal((await boot()()).skipped,true);assert.equal(preview,0); // independent of ordinary automatic tasks
 save(true,false);pauseAfterFirst=true;assert.equal((await boot()()).reason,'automation_paused');assert.equal(applied,1);assert.equal(checkpointWrites,0);
 save(true,false);pauseAfterFirst=false;await boot()();assert.equal(applied,3);assert.equal(checkpointWrites,1);
});
