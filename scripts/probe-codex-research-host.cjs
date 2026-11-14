'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,execFileSync}=require('node:child_process');

const FAILURE_CLASSES=new Set(['process_start','tool_discovery','authentication','network','model_configuration','model_no_tool_call','output_protocol','timeout','none']);
function classifyProbeResult(result){
 if(!result?.processStarted)return {...result,failureClass:'process_start'};
 if(result.stderrClass==='authentication')return {...result,failureClass:'authentication'};
 if(result.stderrClass==='network')return {...result,failureClass:'network'};
 if(result.eventErrorClass==='model_configuration')return {...result,failureClass:'model_configuration'};
 if(result.timedOut)return {...result,failureClass:'timeout'};
 if(!result.toolDiscoveryObserved)return {...result,failureClass:'tool_discovery'};
 if(Number(result.webEventCount||0)===0)return {...result,failureClass:'model_no_tool_call'};
 if(!result.structuredOutputPresent||Number(result.exitCode)!==0)return {...result,failureClass:'output_protocol'};
 return {...result,failureClass:'none'};
}
function validateProbeResult(result){
 const required=['processStarted','toolDiscoveryObserved','firstEventAt','webEventCount','structuredOutputPresent','exitCode','failureClass','evidenceFiles'];
 if(required.some(key=>!Object.prototype.hasOwnProperty.call(result||{},key))||!FAILURE_CLASSES.has(result.failureClass)
   ||!Array.isArray(result.evidenceFiles))throw Object.assign(Error('PROBE_EVIDENCE_INCOMPLETE'),{code:'PROBE_EVIDENCE_INCOMPLETE'});
 return result;
}
function stderrClass(stderr){
 if(/401|unauthorized|not logged in|authentication/i.test(stderr))return 'authentication';
 if(/ECONN|ENET|EAI_AGAIN|network|socket|dns/i.test(stderr))return 'network';
 return stderr.trim()?'other':'';
}
function eventErrorText(raw){
 const values=[raw?.message,raw?.error?.message,raw?.error?.error?.message,raw?.item?.message,raw?.item?.error?.message];
 const value=values.find(item=>typeof item==='string'&&item.trim());
 return value?value.replace(/[\r\n]+/g,' ').slice(0,500):'';
}
function sampleProcessTree(rootPid){
 if(process.platform!=='win32'||!rootPid)return [];
 const script=`$all=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CreationDate;`+
 `$ids=[System.Collections.Generic.HashSet[uint32]]::new();[void]$ids.Add([uint32]${Number(rootPid)});`+
 `do{$n=$ids.Count;foreach($p in $all){if($ids.Contains([uint32]$p.ParentProcessId)){[void]$ids.Add([uint32]$p.ProcessId)}}}while($ids.Count -gt $n);`+
 `$all|Where-Object{$ids.Contains([uint32]$_.ProcessId)}|ConvertTo-Json -Compress`;
 try{const text=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',timeout:5000,windowsHide:true}).trim();
  if(!text)return [];const parsed=JSON.parse(text);return (Array.isArray(parsed)?parsed:[parsed]).map(p=>({pid:p.ProcessId,parentPid:p.ParentProcessId,name:p.Name,createdAt:p.CreationDate}));
 }catch{return [];}
}
const SCHEMA={type:'object',additionalProperties:false,required:['query','sources','findings','limitations'],properties:{
 query:{type:'string'},findings:{type:'array',items:{type:'string'}},limitations:{type:'array',items:{type:'string'}},
 sources:{type:'array',items:{type:'object',additionalProperties:false,required:['url','title'],properties:{url:{type:'string'},title:{type:'string'}}}},
}};
async function probeCodexResearchHost({executable,model='',timeoutMs=120000,isolatedInput='2026 official student science competition eligibility',outputDir,
 spawnProcess=spawn,treeSampler=sampleProcessTree}){
 const dir=path.resolve(outputDir||fs.mkdtempSync(path.join(os.tmpdir(),'codex-research-probe-')));fs.mkdirSync(dir,{recursive:true});
 const schemaPath=path.join(dir,'schema.json'),outputPath=path.join(dir,'structured-output.json'),eventsPath=path.join(dir,'events.json'),treePath=path.join(dir,'process-tree.json');
 fs.writeFileSync(schemaPath,JSON.stringify(SCHEMA));
 const events=[],treeSamples=[];let child,processStarted=false,firstEventAt='',webEventCount=0,toolDiscoveryObserved=false,structuredOutputPresent=false,exitCode=null,timedOut=false,stderr='',eventErrorClass='',eventErrorMessage='';
 const args=['--search','exec','--json','--sandbox','read-only','--skip-git-repo-check','--ephemeral','--ignore-user-config','--ignore-rules',
  ...(model?['--model',model]:[]),
  '-c','model_reasoning_effort="low"','--enable','tool_search',...['plugins','apps','browser_use','computer_use','shell_tool','memories','multi_agent'].flatMap(x=>['--disable',x]),
  '-C',dir,'--output-schema',schemaPath,'--output-last-message',outputPath,'-'];
 await new Promise(resolve=>{
  let pending='',settled=false,timer,treeTimer;
  const finish=()=>{if(settled)return;settled=true;clearTimeout(timer);clearInterval(treeTimer);resolve();};
  try{child=spawnProcess(executable,args,{cwd:dir,windowsHide:true,stdio:['pipe','pipe','pipe']});processStarted=Boolean(child?.pid);
   if(processStarted){treeSamples.push({at:new Date().toISOString(),processes:treeSampler(child.pid)});treeTimer=setInterval(()=>treeSamples.push({at:new Date().toISOString(),processes:treeSampler(child.pid)}),2000);treeTimer.unref?.();}
   child.stdout.on('data',chunk=>{pending+=chunk.toString();const lines=pending.split('\n');pending=lines.pop();for(const line of lines){try{const raw=JSON.parse(line),at=new Date().toISOString(),itemType=String(raw?.item?.type||''),message=eventErrorText(raw);if(!firstEventAt)firstEventAt=at;if(itemType==='web_search'){webEventCount++;toolDiscoveryObserved=true;}if(/tool_search/i.test(JSON.stringify({type:raw?.type,itemType,tool:raw?.tool})))toolDiscoveryObserved=true;if(raw?.type==='error'&&message)eventErrorMessage=message;if(/model.+not supported|model_not_found|unknown variant.+reason|requires a newer version of Codex/i.test(message))eventErrorClass='model_configuration';events.push({at,type:String(raw?.type||''),itemType,status:String(raw?.item?.status||''),actionType:String(raw?.item?.action?.type||''),...(eventErrorClass?{errorClass:eventErrorClass}:{})});}catch{}}});
   child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-8192);});
   child.stdin.on('error',()=>{});child.once('error',finish);child.once('close',code=>{exitCode=Number.isInteger(code)?code:null;finish();});
   timer=setTimeout(()=>{timedOut=true;try{child.kill();}catch{}setTimeout(finish,5000).unref?.();},Math.max(1000,timeoutMs));timer.unref?.();
   child.stdin.end(`Synthetic acceptance probe. Search the public web for exactly one current official competition eligibility page relevant to: ${String(isolatedInput).slice(0,300)}. Open the official page. Return JSON only. sources must contain only the URL actually opened. Do not read local files.`, 'utf8');
  }catch{finish();}
 });
 treeSamples.push({at:new Date().toISOString(),processes:child?.pid?treeSampler(child.pid):[]});
 try{const value=JSON.parse(fs.readFileSync(outputPath,'utf8'));structuredOutputPresent=Array.isArray(value.sources)&&Array.isArray(value.findings)&&Array.isArray(value.limitations);}catch{}
 fs.writeFileSync(eventsPath,JSON.stringify(events,null,2));fs.writeFileSync(treePath,JSON.stringify(treeSamples,null,2));
 const result=classifyProbeResult({processStarted,toolDiscoveryObserved,firstEventAt,webEventCount,structuredOutputPresent,exitCode,timedOut,
  stderrClass:stderrClass(stderr),eventErrorClass,eventErrorMessage,evidenceFiles:[eventsPath,treePath,outputPath].filter(file=>fs.existsSync(file))});
 fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify(result,null,2));result.evidenceFiles.push(path.join(dir,'summary.json'));
 return validateProbeResult(result);
}
async function cli(){
 const executable=process.argv[2]||'C:/Users/bxw00/AppData/Local/OpenAI/Codex/bin/codex.exe',root=path.resolve(process.argv[3]||'artifacts/p0-agent-0228/codex-research-host-runs'),runs=Math.max(1,Math.min(5,Number(process.argv[4]||3))),timeoutMs=Number(process.argv[5]||120000),model=process.argv[6]||'';
 const results=[];for(let i=0;i<runs;i++)results.push(await probeCodexResearchHost({executable,model,timeoutMs,outputDir:path.join(root,`run-${i+1}`)}));
 let runtimeVersion='';try{runtimeVersion=execFileSync(executable,['--version'],{encoding:'utf8',timeout:5000,windowsHide:true}).trim();}catch{}
 const diagnosis={schema:'codex-research-host-diagnosis.v1',checkedAt:new Date().toISOString(),executable,runtimeVersion,model:model||'(candidate default)',runs:results,successes:results.filter(x=>x.failureClass==='none').length,requiredSuccesses:Math.ceil(runs*2/3)};
 fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'diagnosis.json'),JSON.stringify(diagnosis,null,2));console.log(JSON.stringify(diagnosis,null,2));process.exitCode=diagnosis.successes>=diagnosis.requiredSuccesses?0:2;
}
if(require.main===module)void cli().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={classifyProbeResult,validateProbeResult,probeCodexResearchHost,stderrClass};
