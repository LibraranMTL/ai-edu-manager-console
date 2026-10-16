'use strict';
// Isolated Electron UI probe: synthetic cards, no host profile, no real print jobs.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'edu-print-qa-'));
app.setPath('userData',root);app.on('window-all-closed',()=>{});
const out=path.resolve(__dirname,'../.codex_tmp/print-qa');fs.mkdirSync(out,{recursive:true});
const base={id:'print-test',status:'superseded',template:'clear',languagePolicy:{instructionLanguage:'zh-CN'},content:{title:'学习卡片 · 打印验收',subject:'数学',knowledgePoint:'方程与分式',minutes:10,prompt:'求解 $2x+3=7$。\n\n$$\\frac{1}{2}+\\sqrt{x^2+1}$$\n\n| 中文 | English |\n| --- | --- |\n| 练习 | Practice |',answer:'SECRET_ANSWER'},layout:{paper:'A4',orientation:'portrait'}};
const runtime=process.env.EDU_PRINT_RUNTIME||process.argv.find(arg=>/app\.asar[\\/]electron$/.test(arg))||path.resolve(__dirname,'../electron');
if(runtime.includes('app.asar'))Object.defineProperty(process,'resourcesPath',{value:path.dirname(path.dirname(runtime))});
global.printProbe={root,out,calls:[],runtime};
class ProbeWindow extends BrowserWindow {
  constructor(options){super(options);const win=this;
    this.webContents.getPrintersAsync=async()=>[{name:'Synthetic test printer'}];
    this.webContents.print=(options,callback)=>{global.printProbe.calls.push({options,visible:win.isVisible(),focused:win.isFocused(),parent:!!win.getParentWindow()});global.printProbe.preview=win;global.printProbe.finish=callback;};
  }
}
app.whenReady().then(async()=>{
 const host=new BrowserWindow({width:1050,height:800,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,preload:path.resolve(__dirname,'../tests/fixtures/print-preload.cjs')}});
 ipcMain.handle('print-probe',async(_event,format,orientation,original)=>{
   try {const card={...base,layout:{...base.layout,orientation}};
     const options={card,format,BrowserWindow:ProbeWindow,parent:host,tempRoot:root,dialog:{showSaveDialog:async()=>({filePath:path.join(out,`${original||'structured'}-${orientation}.${format}`)})}};
     const result=original?await require(path.join(runtime,'practice-document.cjs')).renderOriginal({...options,file:JSON.parse(fs.readFileSync(path.join(out,`input-${original}.json`),'utf8'))}):await require(path.join(runtime,'practice-card-export.cjs')).renderPracticeCard(options);
     return result;
   }catch(error){return {error:error.message};}
 });
 await host.loadFile(path.resolve(__dirname,'../tests/fixtures/print-probe.html'));
});
