'use strict';
// Electron-only hidden IPC integration test, not the real education host.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'edu-task-ipc-probe-'));
app.setPath('userData',path.join(root,'profile'));app.disableHardwareAcceleration();
const archive=path.resolve(process.argv[2]);assert.equal(path.basename(archive),'app.asar');
const {createTaskIoClient}=require(path.join(archive,'electron/task-io-client.cjs'));
const {createTaskStoreService}=require(path.join(archive,'electron/task-store-service.cjs'));
const {createProjectArchiveRuntime}=require(path.join(archive,'electron/project-archive-runtime.cjs'));
const client=createTaskIoClient(),store=createTaskStoreService({request:(...args)=>client.request(...args)}),file=path.join(root,'tasks.json');
const context=vm.createContext({taskStoreGuard:store,projectArchiveRuntime:createProjectArchiveRuntime(),licenseRequiredJson:()=>null,setImmediate});
const source=fs.readFileSync(path.join(archive,'electron/main.cjs'),'utf8');
for(const name of ['licensedIpc','licensedInvoke']){
  const start=source.indexOf(`function ${name}(`);assert(start>=0);vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),context);
}
const save=id=>{const got=store.read(file),snapshot=store.track(got.value,got.revision);snapshot.tasks.push({id,status:'pending'});store.write(file,snapshot,snapshot);return JSON.stringify({ok:true,id});};
let window;
const timeout=setTimeout(()=>{console.error('IPC probe timed out');client.close();app.exit(1);},15000);
app.whenReady().then(async()=>{
  await store.initialize(file);
  ipcMain.on('probe:sync',event=>context.licensedIpc(event,'test',()=>save('sync')));
  ipcMain.handle('probe:async',()=>context.licensedInvoke('test',async()=>save('async')));
  ipcMain.on('probe:fault',event=>context.licensedIpc(event,'test',()=>{client.close();return save('must-not-persist');}));
  window=new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false,sandbox:false,partition:'probe-only'}});
  await window.loadURL('data:text/html,<title>Synthetic IPC probe</title>');
  const result=await window.webContents.executeJavaScript(`(async()=>{const ipc=require('electron').ipcRenderer;return [JSON.parse(ipc.sendSync('probe:sync')),JSON.parse(await ipc.invoke('probe:async')),JSON.parse(ipc.sendSync('probe:fault'))];})()`);
  assert.equal(result[0].ok,true);assert.equal(result[1].ok,true);assert.equal(result[2].ok,false);
  assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')).tasks.map(t=>t.id),['sync','async']);
  console.log(JSON.stringify({ok:true,electron:process.versions.electron,synchronousBridgeWaitsForDisk:true,asyncBridgeWaitsForDisk:true,workerFaultReturnsFailure:true,realStudentAccess:false,liveAgentCall:false}));
  clearTimeout(timeout);window.destroy();client.close();app.exit(0);
}).catch(error=>{console.error(error);clearTimeout(timeout);window?.destroy();client.close();app.exit(1);});
