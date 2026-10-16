const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const policy=require('../electron/student-automation-policy.cjs');
const source=fs.readFileSync(path.join(__dirname,'../electron/main.cjs'),'utf8');
function fn(name){const match=new RegExp(`(?:async )?function ${name}\\(`).exec(source);assert(match);const end=source.indexOf('\n}',match.index);return source.slice(match.index,end+2);}
test('student activity policy defaults compatible, explicit pause is opt-out and archived is blocked',()=>{
 assert.equal(policy.studentAutomaticTasksPaused({}),false);
 for(const activityStatus of ['paused','inactive'])assert.equal(policy.studentAutomaticTasksPaused({activityStatus}),true);
 assert.equal(policy.studentAutomaticTasksPaused({status:'inactive'}),true);
 assert.equal(policy.studentAutomaticTasksPaused({activityStatus:'paused',pauseAutomaticTasksWhenInactive:false}),false);
 assert.equal(policy.studentAutomaticTasksPaused({activityStatus:'inactive',pauseAutomaticTasksWhenInactive:false}),true);
 assert.equal(policy.studentAutomaticTasksPaused({archived:true,pauseAutomaticTasksWhenInactive:false}),true);
 assert.equal(policy.studentTaskCardsSuppressed({activityStatus:'inactive',pauseAutomaticTasksWhenInactive:false}),true);
 assert.equal(policy.studentTaskCardsSuppressed({activityStatus:'paused'}),false);
 assert.equal(policy.inactiveStudentTaskCardRetirable({sourceType:'student',kind:'weekly_action',trigger:'schedule',status:'pending'}),true);
 assert.equal(policy.inactiveStudentTaskCardRetirable({sourceType:'student',kind:'weekly_action',trigger:'schedule',status:'running'}),false);
 assert.equal(policy.inactiveStudentTaskCardRetirable({sourceType:'student',kind:'practice_attempt_review',trigger:'event',status:'succeeded'}),false);
 assert.equal(policy.automaticStudentTaskBlocked({sourceType:'student',kind:'practice_attempt_review'},{activityStatus:'paused'}),false);
 assert.equal(policy.automaticStudentTaskBlocked({sourceType:'project'},null),false);
});
test('actual scheduler only starts active students and propagates automatic origin',async()=>{
 const people=[{id:'a'},{id:'b',activityStatus:'paused'},{id:'c',activityStatus:'inactive'},{id:'d',activityStatus:'inactive',pauseAutomaticTasksWhenInactive:false}];
 const tasks=people.map(p=>({id:p.id,sourceId:p.id,sourceType:'student',kind:'weekly_action',status:'pending',attempt:0}));const calls=[];
 const ctx={...policy,projectArchiveRuntime:{status:()=>({ready:true})},repairTaskCenterRuntimeState(){},taskSchedulerRunning:false,taskAutomationEnabled:()=>true,captureTimelineScheduler:null,publicLicenseStatus:()=>({active:true}),runProjectAutomationSweep(){},syncAgentTaskResults(){},syncOpenClawCronTasks:async()=>{},refreshAdapterCapabilities:async()=>{},upsertTaskCandidates:()=>({tasks}),buildTaskCenterCandidates:()=>[],enforceTaskTimeouts:()=>false,readTaskStore:()=>({tasks}),readStudentsIndex:()=>people,PERIODIC_REPORT_TASKS:{},isAutoPublishReportTask:()=>false,scheduledTimeReached:()=>true,executeTaskByAdapter:(id,adapter,options)=>{calls.push({id,options});return '{"ok":true}';},runCompetitionResearchSchedule(){},appendHostTimeline(){},notify(){},taskNow:()=>''};
 ctx.restoreHeavyTaskRetries=()=>{};
 ctx.restoreBusinessTaskRetries=()=>{};
 vm.createContext(ctx);vm.runInContext(fn('runUnifiedTaskScheduler'),ctx);assert.equal((await ctx.runUnifiedTaskScheduler()).ok,true);assert.deepEqual(calls.map(x=>x.id),['a']);assert(calls.every(x=>x.options.automatic));
});
test('execution rechecks latest activity but manual routing and submitted homework remain usable',async()=>{
 let checks=0;const task={id:'t',sourceId:'a',sourceType:'student',kind:'weekly_action'};
 const ctx={...policy,agentControlStore:()=>({read:()=>({})}),taskPowerRecovery:{canDispatch:()=>true},projectArchiveRuntime:{assertAccess(){}},readTaskStore:()=>({tasks:[task]}),findStudentByKey:()=>({activityStatus:'paused'}),validateTaskPermissionDeclaration:()=>{checks++;return {ok:false,message:'manual reached permissions'};}};
 vm.createContext(ctx);vm.runInContext(fn('executeTaskByAdapterCore'),ctx);
 assert.equal(JSON.parse(await ctx.executeTaskByAdapterCore('t','auto',{automatic:true})).reason,'student_automation_paused');assert.equal(checks,0);
 assert.equal(JSON.parse(await ctx.executeTaskByAdapterCore('t','auto')).message,'manual reached permissions');assert.equal(checks,1);
 task.kind='practice_attempt_review';await ctx.executeTaskByAdapterCore('t','internal',{automatic:true});assert.equal(checks,2);
});
test('automatic digest checks activity again after async capability refresh and never freezes a paused batch',async()=>{
 let paused=false,starts=0;const ctx={...policy,findStudentByKey:()=>({activityStatus:paused?'paused':'active'}),configuredDigestExecutor:()=> 'codex',refreshCapabilitiesForExplicitExecution:async()=>{paused=true;},startDigestWorkflow:()=>{starts++;return '{}';}};
 ctx.taskAutomationEnabled=()=>true;
 vm.createContext(ctx);vm.runInContext(fn('startDigestWorkflowWithFreshCapabilities'),ctx);const result=JSON.parse(await ctx.startDigestWorkflowWithFreshCapabilities('student','a','auto',{automatic:true}));assert.equal(result.reason,'student_automation_paused');assert.equal(starts,0);
 await ctx.startDigestWorkflowWithFreshCapabilities('student','a','auto');assert.equal(starts,1);
});
