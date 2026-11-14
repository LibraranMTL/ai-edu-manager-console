'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('dependency skip and query failure do not consume receipt budget, with independent finite retry',()=>{
 const {reconcileAttemptPatch}=require('../electron/task-closure-decision.cjs');
 const task={recoveryBudget:{receiptQueries:2,limits:{receiptQueries:6}}};
 const skip=reconcileAttemptPatch(task,{disposition:'skipped_dependency',reason:'archive_busy'},0);
 assert.equal(skip.recoveryBudget.receiptQueries,2);assert.ok(Date.parse(skip.reconcileAttempt.nextCheckAt)>0);
 let next=task;for(let i=0;i<6;i++)next={...next,...reconcileAttemptPatch(next,{disposition:'query_failed',reason:'io_error'},i*100000)};
 assert.equal(next.recoveryBudget.receiptQueries,2);assert.equal(next.reconcileAttempt.exhausted,true);assert.equal(next.reconcileAttempt.nextCheckAt,'');
});
test('every actually checked task consumes one query, and exhausted tasks accept late evidence without dispatch',()=>{
 const {reconcileAttemptPatch}=require('../electron/task-closure-decision.cjs');
 const task={recoveryBudget:{receiptQueries:5,limits:{receiptQueries:6}}};
 const final=reconcileAttemptPatch(task,{disposition:'checked',reason:'no_receipt'},0);
 assert.equal(final.recoveryBudget.receiptQueries,6);assert.equal(final.reconcileAttempt.nextCheckAt,'');assert.equal(final.reconcileAttempt.exhausted,true);
 assert.equal(reconcileAttemptPatch({...task,...final},{disposition:'checked',reason:'late_receipt'},1000).recoveryBudget.receiptQueries,6);
 assert.equal(Object.hasOwn(final,'status'),false);assert.equal(Object.hasOwn(final,'executionId'),false);
});
test('production recorder persists per-task dispositions through the actual SQLite worker',async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const root=fs.mkdtempSync(path.join(os.tmpdir(),'edu-reconcile-budget-'));
 const host=await require('./helpers/smart-inbox-task-host.cjs').createTaskHost(root);
 t.after(async()=>{await host.close();fs.rmSync(root,{recursive:true,force:true});});
 const draft=host.service.read(host.file).value;draft.tasks.push(...['checked','skipped','failed'].map(id=>({id,status:'waiting_result',executionId:'run-'+id,recoveryBudget:{receiptQueries:1,limits:{receiptQueries:6}}})));
 host.service.write(host.file,draft);await host.service.flush();
 await host.context.recordDigestReceiptMonitorCheck([{taskId:'checked',disposition:'checked'},{taskId:'skipped',disposition:'skipped_dependency'},{taskId:'failed',disposition:'query_failed'}]);
 const tasks=host.disk().tasks;assert.equal(tasks.find(t=>t.id==='checked').recoveryBudget.receiptQueries,2);
 for(const id of ['skipped','failed']){const task=tasks.find(t=>t.id===id);assert.equal(task.recoveryBudget.receiptQueries,1);assert.equal(task.executionId,'run-'+id);assert.ok(task.reconcileAttempt.nextCheckAt);}
});
