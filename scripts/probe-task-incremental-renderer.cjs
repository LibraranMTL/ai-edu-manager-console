'use strict';
// Isolated Electron transport/render probe. Does not start the host or any Agent.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {monitorEventLoopDelay}=require('node:perf_hooks');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'edu-task-render-probe-'));
app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{}); // Finish assertions/Worker cleanup before selecting the exit code.
const archive=path.resolve(process.argv[2]),output=path.resolve(process.argv[3]);
assert.equal(path.basename(archive),'app.asar');
const load=name=>require(path.join(archive,'electron',name));
const client=load('task-io-client.cjs').createTaskIoClient(),file=path.join(root,'tasks.json');
let window;
const timeout=setTimeout(()=>{console.error('probe timeout');app.exit(1);},120000);
app.whenReady().then(async()=>{
 await client.request(file,'store_open');
 for(let offset=0;offset<10000;offset+=100){
  const result=await client.request(file,'store_delta',{upserts:Array.from({length:100},(_,i)=>({id:'task-'+String(offset+i).padStart(6,'0'),
   title:'合成任务 '+(offset+i),status:'pending',trigger:'event',automaticExecution:true,sourceType:'student',sourceId:'synthetic'}))});assert(result.ok);
 }
 ipcMain.handle('probe:page',()=>client.request(file,'list',{status:'automatic'}));
 ipcMain.handle('probe:patch',(_event,i)=>client.request(file,'store_patch',{id:'task-000001',patch:{title:'合成更新 '+i}}));
 window=new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false,sandbox:false,backgroundThrottling:false,partition:'synthetic-probe'}});
 await window.loadURL('data:text/html,<title>Isolated task transport probe</title><main id="tasks"></main>');
 const delay=monitorEventLoopDelay({resolution:10});delay.enable();const before=process.memoryUsage().rss;
 const result=await window.webContents.executeJavaScript(`(async()=>{
  const ipc=require('electron').ipcRenderer,values=[],longTasks=[];
  const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())longTasks.push(e.duration);});observer.observe({type:'longtask',buffered:false});
  for(let i=0;i<40;i++){
   const start=performance.now();const updating=ipc.invoke('probe:patch',i);const page=await ipc.invoke('probe:page');
   if(!page.ok||page.tasks.length!==20)throw new Error('bad page');
   document.getElementById('tasks').replaceChildren(...page.tasks.map(task=>{const card=document.createElement('article');card.textContent=task.title+' '+task.automationState;return card;}));
   document.getElementById('tasks').getBoundingClientRect();await new Promise(resolve=>setTimeout(resolve,0));values.push(performance.now()-start);await updating;
  }
  observer.disconnect();values.sort((a,b)=>a-b);return {pageToLayoutP95:values[Math.ceil(values.length*.95)-1],maxLongTaskMs:Math.max(0,...longTasks),visibleRows:document.querySelectorAll('article').length};
 })()`);
 delay.disable();Object.assign(result,{mainEventLoopMaxMs:delay.max/1e6,rssDeltaMB:(process.memoryUsage().rss-before)/1048576,electron:process.versions.electron,
  synthetic:true,taskCount:10000,realApplicationUi:false,realStudentAccess:false,liveAgentCall:false});
 result.passed=result.pageToLayoutP95<=150&&result.maxLongTaskMs<=100&&result.mainEventLoopMaxMs<=100&&result.rssDeltaMB<=50;
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 assert(result.passed);await client.close();window.destroy();clearTimeout(timeout);app.exit(0);
}).catch(async error=>{console.error(error);clearTimeout(timeout);window?.destroy();await client.close();app.exit(1);});
