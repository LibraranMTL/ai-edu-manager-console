'use strict';
// Commands belong only to this local preview's main frame, never other windows.
async function printWithControls(window, card, { dialog, ipcMain, shell, assertScope = () => {} }) {
  if(window.isDestroyed())return {cancelled:true};
  let printers=[];
  window.show();window.focus();
  const send=state=>{if(!window.isDestroyed())window.webContents.send('practice-print:state',state);};
  return new Promise(resolve=>{
    let busy=false,done=false,timer,printerTimer,printPending=false;
    const finish=result=>{if(done)return;done=true;clearTimeout(timer);clearTimeout(printerTimer);ipcMain.removeListener('practice-print:command',command);window.removeListener('closed',closed);resolve(result);};
    const closed=()=>finish(printPending?{pending:true}:{cancelled:true});
    const command=async(event,input={})=>{
      if(done||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)return;
      if(input.action==='close'){if(!busy)finish({cancelled:true});return;}
      if(busy)return;
      busy=true;send({busy:true,message:'正在处理…'});
      try {
        assertScope();
        if(input.action==='pdf') {
          const chosen=await dialog.showSaveDialog(window,{title:'保存 PDF 并用本机阅读器打印',defaultPath:'学习卡片.pdf',filters:[{name:'PDF',extensions:['pdf']}]});
          assertScope();if(done)return;
          if(!chosen.canceled&&chosen.filePath){
            const bytes=await window.webContents.printToPDF({printBackground:true,preferCSSPageSize:true,pageSize:card.layout?.paper==='Letter'?'Letter':'A4',landscape:card.layout?.orientation==='landscape'});
            assertScope();if(done)return;
            await require('node:fs/promises').writeFile(chosen.filePath,bytes);
            const error=await shell.openPath(chosen.filePath);
            if(error)throw Error(`PDF 已保存到 ${chosen.filePath}，阅读器未打开：${error}`);
            finish({openedPDF:true,path:chosen.filePath});return;
          }
        } else if(input.action==='print') {
          if(!printers.some(p=>p.name===input.deviceName))throw Error('请选择本机打印机');
          if(!Number.isInteger(input.copies)||input.copies<1||input.copies>99)throw Error('份数须为 1—99');
          // The explicit local picker avoids the Windows native-dialog failure path.
          send({busy:true,message:'正在提交打印队列，请勿重复点击。'});
          printPending=true;
          timer=setTimeout(()=>{if(!done)send({busy:true,message:'打印机尚未返回结果，请查看 Windows 打印队列。为避免重复出纸，请先核对队列再关闭窗口。'});},45000);
          window.webContents.print({silent:true,deviceName:input.deviceName,copies:input.copies,printBackground:true,landscape:card.layout?.orientation==='landscape',pageSize:card.layout?.paper==='Letter'?'Letter':'A4'},(success,reason)=>{
            clearTimeout(timer);printPending=false;if(done)return;
            if(success)finish({printed:true});else{busy=false;send({busy:false,message:`打印未完成：${reason||'打印机未返回回执'}。可以重试，或保存 PDF 并用阅读器打印。`});}
          });return;
        }
        busy=false;send({busy:false,message:'可继续选择打印机或保存 PDF。'});
      } catch(error){clearTimeout(timer);printPending=false;busy=false;send({busy:false,message:error.message});}
    };
    ipcMain.on('practice-print:command',command);window.once('closed',closed);
    send({busy:false,message:'正在读取本机打印机，也可以先保存 PDF。'});
    // Never hide the preview behind a hung Windows printer driver.
    Promise.race([Promise.resolve().then(()=>window.webContents.getPrintersAsync()),new Promise((_,reject)=>{printerTimer=setTimeout(()=>reject(Error('读取打印机超时')),8000);})]).then(items=>{
      if(done)return;printers=items;clearTimeout(printerTimer);
      send({printers,busy,message:busy?'正在处理，请勿重复点击。':printers.length?'选择打印机后点击打印；较宽公式或表格建议使用横向纸张并核对 PDF。':'未读取到打印机。可保存 PDF 并用阅读器打印。'});
    },error=>{clearTimeout(printerTimer);if(!done&&!busy)send({printers:[],message:`未读取到打印机：${error.message}。可保存 PDF 并用阅读器打印。`});});
  });
}
module.exports={printWithControls};
