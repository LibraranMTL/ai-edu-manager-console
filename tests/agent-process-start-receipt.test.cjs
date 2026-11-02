'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {runProcess}=require('../electron/project-material-agent.cjs');
test('process-start acknowledgement completes before student prompt is written',async()=>{
 let release,sent=false;
 const child=new EventEmitter();child.pid=123;child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();
 child.stdin.end=()=>{sent=true;setImmediate(()=>child.emit('close',0));};child.kill=()=>setImmediate(()=>child.emit('close',1));
 const result=runProcess('synthetic.exe',[],{cwd:'.',input:'synthetic only',timeoutMs:1000,spawnProcess:()=>{setImmediate(()=>child.emit('spawn'));return child;},
 onStarted:async evidence=>{assert.equal(evidence.processId,123);await new Promise(r=>release=r);}});
 await new Promise(setImmediate);assert.equal(sent,false);assert.equal(typeof release,'function');release();await result;assert.equal(sent,true);
});
