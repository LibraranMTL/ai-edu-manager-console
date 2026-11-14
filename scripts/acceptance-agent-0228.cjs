'use strict';
// Offline evidence gate: never launches agents, mutates business state or publishes.
const fs=require('node:fs'),path=require('node:path'),{validateReleaseEvidence}=require('./lib/agent-0228-evidence.cjs');
const args=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');return [v.slice(2,i),v.slice(i+1)];}));
if(!args.evidence||!['pre-candidate','release'].includes(args.stage)){console.error('Required: --evidence=DIR --stage=pre-candidate|release');process.exit(1);}
const root=path.resolve(args.evidence);fs.mkdirSync(root,{recursive:true});
let result;
try{
 const report=JSON.parse(fs.readFileSync(path.join(root,'acceptance-index.json'),'utf8').replace(/^\uFEFF/,''));result=validateReleaseEvidence(report,root,{stage:args.stage});
}catch(error){result={passed:false,failures:[error.code==='ENOENT'?'acceptance_index_missing':`invalid_evidence:${error.message}`]};}
Object.assign(result,{checkedAt:new Date().toISOString(),stage:args.stage,formalDataModified:false,published:false});
fs.writeFileSync(path.join(root,'acceptance-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;
