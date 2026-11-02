'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const task={id:'t',workKey:'w',sourceVersion:'s',status:'failed',executionId:'old'};
test('missing claim and stopped process never prove no external effects',()=>{
 const {planTaskRecovery}=require('../electron/task-backlog-recovery.cjs');
 for(const evidence of [{},{processAlive:false},{claimedAt:null},{packetCopied:true},{distributionComplete:false}])assert.notEqual(planTaskRecovery(task,evidence).action,'requeue_proven_not_sent');
 assert.equal(planTaskRecovery({...task,automationSuspended:true},{}).action,'keep_paused');
 assert.equal(planTaskRecovery({...task,status:'cancelled'},{}).action,'keep_paused');
});
test('only matching durable not-sent proof permits requeue, keeping the original execution identity',()=>{
 const {planTaskRecovery}=require('../electron/task-backlog-recovery.cjs');
 const attempt={phase:'not_sent',workKey:'w',sourceVersion:'s',executionId:'old'};
 assert.equal(planTaskRecovery(task,{attempt}).action,'requeue_proven_not_sent');
 assert.notEqual(planTaskRecovery(task,{attempt:{...attempt,sourceVersion:'new'}}).action,'requeue_proven_not_sent');
 assert.equal(planTaskRecovery({...task,sourceVersion:''},{attempt:{...attempt,sourceVersion:'work:w'}}).action,'requeue_proven_not_sent');
 assert.equal(planTaskRecovery({...task,status:'queued',recoveryState:'stopped'},{attempt}).action,'no_change');
});
test('verified existing results settle once, unknown intake items are not resumed',()=>{
 const {planTaskRecovery}=require('../electron/task-backlog-recovery.cjs');
 assert.equal(planTaskRecovery(task,{receipt:{verified:true,executionId:'old',workKey:'w',sourceVersion:'s'}}).action,'settle_existing');
 assert.equal(planTaskRecovery({...task,status:'succeeded',settlementState:'settled'},{}).action,'no_change');
 const plan=planTaskRecovery({...task,kind:'smart_material_intake'},{items:[{id:'a',status:'retry'},{id:'b',status:'execution_unknown'}]});
 assert.equal(plan.action,'resume_safe_items');assert.deepEqual(plan.itemIds,['a']);
});
test('worker preview is readonly and stale evidence/repeated settlement cannot overwrite a new receipt',t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const root=fs.mkdtempSync(path.join(os.tmpdir(),'edu-recovery-'));
 const store=require('../electron/task-state-store.cjs').createTaskStateStore({legacyPath:path.join(root,'tasks.json')});t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
 store.open();store.applyDelta({upserts:[{...task,result:{executionId:'old',workKey:'w',sourceVersion:'s',validation:{valid:true,checkedAt:'2026-10-29'}}}]});
 assert.equal(typeof store.previewTaskRecovery,'function');const preview=store.previewTaskRecovery({limit:1});assert.equal(preview.rows[0].action,'settle_existing');
 const old=preview.rows[0];store.patchTask(task.id,{status:'cancelled'});
 assert.equal(store.applyTaskRecovery(old).ok,false);assert.equal(store.detail(task.id).task.status,'cancelled');
});
