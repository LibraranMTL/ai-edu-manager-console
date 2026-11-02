'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDispatchPolicyReader}=require('../electron/task-dispatch-policy.cjs');

test('project dispatch policy uses the current project scope instead of a transient task snapshot',()=>{
 const read=createDispatchPolicyReader({
  readGlobalPolicy:()=>({enabled:true,version:7}),
  readCurrentProjectScope:task=>task.sourceId==='p1'?'scope-current':'',
 });
 const before=read({id:'t1',kind:'project_digest',sourceType:'project',sourceId:'p1',sourceVersion:''});
 const after=read({id:'t1',kind:'project_digest',sourceType:'project',sourceId:'p1',sourceVersion:'batch-2',input:{projectExecutionScope:{scopeFingerprint:'scope-current'}}});
 assert.deepEqual(before,{global:{enabled:true,version:7},scope:'scope-current'});
 assert.deepEqual(after,before);
});

test('project policy reflects an actual current-scope change and non-project tasks have no project scope',()=>{
 let scope='scope-a';
 const read=createDispatchPolicyReader({readGlobalPolicy:()=>({enabled:true,version:1}),readCurrentProjectScope:()=>scope});
 assert.equal(read({kind:'project_digest',sourceType:'project',sourceId:'p1'}).scope,'scope-a');
 scope='scope-b';
 assert.equal(read({kind:'project_digest',sourceType:'project',sourceId:'p1'}).scope,'scope-b');
 assert.equal(read({kind:'student_digest',sourceType:'student',sourceId:'s1'}).scope,'');
});
