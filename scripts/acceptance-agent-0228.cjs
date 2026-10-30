'use strict';
// Offline evidence gate: never launches agents, mutates business state or publishes.
const fs=require('node:fs'),path=require('node:path'),{validateEvidence}=require('./lib/agent-0228-evidence.cjs');
const args=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');return [v.slice(2,i),v.slice(i+1)];}));
if(!args.evidence||!['pre-candidate','release'].includes(args.stage)){console.error('Required: --evidence=DIR --stage=pre-candidate|release');process.exit(1);}
const root=path.resolve(args.evidence);fs.mkdirSync(root,{recursive:true});
let result;
try{
 const report=JSON.parse(fs.readFileSync(path.join(root,'acceptance-index.json'),'utf8').replace(/^\uFEFF/,''));result=validateEvidence(report,root);
 const required=[...Array.from({length:15},(_,i)=>`A${i+1}`),...Array.from({length:7},(_,i)=>`B${i+1}`),...Array.from({length:5},(_,i)=>`C${i+1}`)];
 for(const id of required){const row=report.matrix?.find(x=>x.id===id);if(!row||row.status!=='pass'||row.candidateHash!==report.candidateHash||!report.artifacts?.some(a=>a.path===row.evidence))result.failures.push(`matrix:${id}`);}
 if(args.stage==='release')for(const kind of ['installer','portable','zip'])if(!report.packaging?.some(p=>p.kind===kind&&p.asarHash===report.candidateHash&&p.sha256&&p.bytes>0&&p.authenticodeStatus&&p.localVerified===true))result.failures.push(`packaging:${kind}`);
 if(args.stage==='release'&&report.installUpgradeVerified!==true)result.failures.push('install_upgrade_missing');
 result.passed=result.failures.length===0;
}catch(error){result={passed:false,failures:[error.code==='ENOENT'?'acceptance_index_missing':`invalid_evidence:${error.message}`]};}
Object.assign(result,{checkedAt:new Date().toISOString(),stage:args.stage,formalDataModified:false,published:false});
fs.writeFileSync(path.join(root,'acceptance-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;
