'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('mixed intake resumes only safe items while preserving unknown receipts',()=>{
 const {classifyBatchClosure}=require('../electron/task-closure-decision.cjs');
 const r=classifyBatchClosure([{id:'a',status:'pending'},{id:'b',status:'execution_unknown'},{id:'c',status:'delivered'}]);
 assert.equal(r.automaticPending,1);assert.equal(r.receiptPending,1);assert.equal(r.needsUserAction,0);assert.equal(r.phase,'automatic_pending');assert.deepEqual(r.safeItemIds,['a']);
});
test('all ignored and empty batches are no-work, review requires an actual decision',()=>{
 const {classifyBatchClosure}=require('../electron/task-closure-decision.cjs');
 assert.equal(classifyBatchClosure([{status:'ignored'}]).phase,'no_work');assert.equal(classifyBatchClosure([]).phase,'no_work');
 assert.equal(classifyBatchClosure([{status:'review'}]).needsUserAction,1);
 assert.equal(classifyBatchClosure([null]).receiptPending,1);
});
test('intake safe backlog and receipt work stay automatic; exhausted queries ask for evidence only',()=>{
 const {taskPresentation}=require('../electron/task-read-model.cjs');
 for(const settlementState of ['automatic_pending','receipt_pending'])assert.equal(taskPresentation({kind:'smart_material_intake',status:'reviewing',settlementState,result:{validation:{valid:false}}}).userGroup,'automatic');
 const unknown=taskPresentation({status:'waiting_result',businessOutcome:'awaiting_receipt',reconcileAttempt:{exhausted:true}});
 assert.equal(unknown.userGroup,'needs_help');assert.equal(unknown.awaitingSend,false);
});
