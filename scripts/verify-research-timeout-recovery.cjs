'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn,execFileSync}=require('node:child_process');
const {createCodexResearchSearch}=require('../electron/planning-research.cjs');
const {classifyResearchTimeout}=require('../electron/research-task-policy.cjs');
const executable=process.argv[2];
if(!executable||!path.isAbsolute(executable))throw Error('需提供已安装 Codex 可执行文件的绝对路径');
const output=path.resolve(process.argv[3]||'artifacts/p0-agent-0228/research-timeout-real-host.json');
const mode=process.argv[4]||'confirmed-close';
let processId=0;
const search=createCodexResearchSearch({executable,spawnProcess:spawn,
 terminateProcess:child=>mode==='unconfirmed'?undefined:child.kill(),timeoutFloorMs:1000,
 timeoutFinalizationGraceMs:250,timeoutFinalizationMs:mode==='unconfirmed'?250:5000});
(async()=>{
 const error=await search({queryInput:{purpose:'competition_recommendation',grade:'synthetic',interests:['synthetic topic']},timeoutMs:1000,
  beforeExecute:async()=>{},onStarted:async e=>{processId=e.processId;},executionContext:{executionId:'synthetic-timeout-1',
   workKey:'synthetic:research-timeout',sourceVersion:'v1',providerId:'codex'}}).then(()=>null,e=>e);
 const evidence=error?.timeoutEvidence||null;
 const classification=evidence?classifyResearchTimeout(evidence,{remainingRouteAttempts:1,nextProviderAvailable:true}):null;
 if(mode==='unconfirmed'&&processId){try{process.kill(processId);}catch{}await new Promise(resolve=>setTimeout(resolve,250));}
 const report={schema:'research-timeout-real-host.v1',checkedAt:new Date().toISOString(),executable,mode,
  executableVersion:(()=>{try{return execFileSync(executable,['--version'],{encoding:'utf8',timeout:5000,windowsHide:true}).trim();}catch{return 'unavailable';}})(),processId,error:{code:error?.code||'',messageClass:error?.code?'research_timeout':'unexpected'},
  evidence,classification};
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));
 console.log(JSON.stringify({output,processId,code:error?.code,disposition:classification?.disposition,evidence},null,2));
 process.exitCode=error?.code==='RESEARCH_TIMEOUT'&&['safe_retry','execution_unknown'].includes(classification?.disposition)?0:1;
})().catch(error=>{console.error(error);process.exitCode=1;});
