'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {renderPracticeCard,practiceCardHtml}=require('../electron/practice-card-export.cjs');
const {printWithControls}=require('../electron/practice-print-window.cjs');
const card={id:'print-fixture',status:'ready',content:{title:'打印测试',prompt:'求解 $2x+3=7$。',answer:'PRIVATE_ANSWER'},layout:{paper:'Letter',orientation:'landscape'}};
class Window extends EventEmitter {
 constructor(options){super();this.options=options;this.destroyed=false;this.states=[];this.calls=[];this.webContents={mainFrame:{},executeJavaScript:async()=>false,getPrintersAsync:async()=>[{name:'Local printer'}],send:(_,state)=>this.states.push(state),setWindowOpenHandler:()=>{},on:()=>{},print:(options,callback)=>{this.calls.push(options);callback(true);},printToPDF:async()=>Buffer.from('PDF')};Window.last=this;}
 async loadURL(){}async loadFile(file){this.html=await fs.readFile(file,'utf8');}setMenuBarVisibility(){}show(){this.visible=true;}focus(){this.focused=true;}isDestroyed(){return this.destroyed;}destroy(){this.destroyed=true;this.emit('closed');}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function command(ipc,win,input,foreign=false){ipc.emit('practice-print:command',{sender:foreign?{}:win.webContents,senderFrame:win.webContents.mainFrame},input);}
test('local printer picker needs explicit command, rejects foreign windows and cleans print resources',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'practice-print-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const ipc=new EventEmitter();
 const task=renderPracticeCard({card,format:'print',BrowserWindow:Window,dialog:{},tempRoot:root,printServices:{ipcMain:ipc}});
 while(!ipc.listenerCount('practice-print:command'))await tick();const win=Window.last;assert(win.visible&&win.focused);assert.equal(win.calls.length,0);
 command(ipc,win,{action:'print',deviceName:'Local printer',copies:1},true);assert.equal(win.calls.length,0);
 command(ipc,win,{action:'print',deviceName:'foreign',copies:1});await tick();assert.equal(win.calls.length,0);
 command(ipc,win,{action:'print',deviceName:'Local printer',copies:2});assert((await task).printed);
 assert.equal(win.calls[0].silent,true);assert.equal(win.calls[0].deviceName,'Local printer');assert.equal(win.calls[0].copies,2);assert.equal(win.calls[0].pageSize,'Letter');assert(win.calls[0].landscape);
 assert(!win.html.includes('PRIVATE_ANSWER'));assert(win.destroyed);assert.deepEqual(await fs.readdir(root),[]);assert.equal(ipc.listenerCount('practice-print:command'),0);
});
test('printer failure keeps preview for retry and closing is not success',async()=>{
 const ipc=new EventEmitter(),win=new Window({});win.webContents.print=(_,cb)=>cb(false,'driver failed');const task=printWithControls(win,card,{ipcMain:ipc});await tick();
 command(ipc,win,{action:'print',deviceName:'Local printer',copies:1});assert.match(win.states.at(-1).message,/driver failed/);assert(!win.destroyed);
 command(ipc,win,{action:'close'});assert.deepEqual(await task,{cancelled:true});
});
test('no printer still allows saving and opening PDF and file survives preview close',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'print-pdf-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file=path.join(root,'card.pdf');
 const ipc=new EventEmitter(),win=new Window({});win.webContents.getPrintersAsync=async()=>[];let opened;
 const task=printWithControls(win,card,{ipcMain:ipc,dialog:{showSaveDialog:async()=>({filePath:file})},shell:{openPath:async p=>{opened=p;return '';}}});await tick();command(ipc,win,{action:'pdf'});
 assert((await task).openedPDF);assert.equal(opened,file);assert.equal(await fs.readFile(file,'utf8'),'PDF');
});
test('scope change during save dialog cannot write student output',async()=>{
 const ipc=new EventEmitter(),win=new Window({});let changed=false;
 const task=printWithControls(win,card,{ipcMain:ipc,assertScope:()=>{if(changed)throw Error('scope changed');},dialog:{showSaveDialog:async()=>{changed=true;return {filePath:'should-not-write.pdf'};}}});await tick();command(ipc,win,{action:'pdf'});await tick();assert.match(win.states.at(-1).message,/scope changed/);command(ipc,win,{action:'close'});await task;
});
test('superseded cards remain printable and unapproved cards do not',()=>{assert.match(practiceCardHtml({...card,status:'superseded'}),/katex/);assert.throws(()=>practiceCardHtml({...card,status:'draft'}));});
test('preview is visible and can close while the printer driver hangs',async()=>{
 const ipc=new EventEmitter(),win=new Window({});win.webContents.getPrintersAsync=()=>new Promise(()=>{});
 const task=printWithControls(win,card,{ipcMain:ipc});assert(win.visible);win.destroy();assert.deepEqual(await task,{cancelled:true});assert.equal(ipc.listenerCount('practice-print:command'),0);
});
test('preview is visible before slow document conversion and can cancel preparation',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'print-slow-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));let entered=false;
 const task=renderPracticeCard({card,format:'print',BrowserWindow:Window,dialog:{},tempRoot:root,htmlOverride:()=>{entered=true;return new Promise(()=>{});}});
 while(!entered)await tick();assert(Window.last.visible);Window.last.destroy();assert.deepEqual(await task,{cancelled:true});
});
