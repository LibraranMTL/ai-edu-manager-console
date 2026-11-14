'use strict';
const printerDefaultPageSize = new Set();
const windowsGdiPrinters = new Set();

function invalidPrinterSettings(reason) {
  return /invalid printer settings/i.test(String(reason || ''));
}

function submitPrintDirect(window, options) {
  return new Promise((resolve) => window.webContents.print(options,
    (success, reason) => resolve({ success: Boolean(success), reason: String(reason || '') })));
}
// Commands belong only to this local preview's main frame, never other windows.
async function printWithControls(window, card, { dialog, ipcMain, shell, assertScope = () => {}, submitPrint = null }) {
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
            finish({openedPDF:true,path:chosen.filePath,strategy:'pdf',attempt:1});return;
          }
        } else if(input.action==='print' || input.action==='printer-default' || input.action==='system-dialog') {
          if(!printers.some(p=>p.name===input.deviceName))throw Error('请选择本机打印机');
          if(!Number.isInteger(input.copies)||input.copies<1||input.copies>99)throw Error('份数须为 1—99');
          const selectedPrinter=String(input.deviceName);
          const systemDialog=input.action==='system-dialog';
          let useDefault=input.action==='printer-default'||printerDefaultPageSize.has(selectedPrinter);
          let useWindowsGdi=windowsGdiPrinters.has(selectedPrinter);
          let strategy=systemDialog?'system_dialog':useDefault?'printer_default':'explicit_page';
          let attempt=1;
          send({busy:true,strategy,attempt,message:systemDialog?'正在打开 Windows 打印对话框…':'正在提交打印队列，请勿重复点击。'});
          printPending=true;
          timer=setTimeout(()=>{if(!done)send({busy:true,strategy,attempt,failureReason:'printer_response_timeout',mayRetrySafely:false,message:'打印机尚未返回结果，请查看 Windows 打印队列。为避免重复出纸，请先核对队列再关闭窗口。'});},45000);
          const options={silent:!systemDialog,printBackground:true,landscape:card.layout?.orientation==='landscape'};
          if(!systemDialog){Object.assign(options,{deviceName:selectedPrinter,copies:input.copies});
            if(useDefault){options.usePrinterDefaultPageSize=true;if(useWindowsGdi)options.windowsGdi=true;}
            else options.pageSize=card.layout?.paper==='Letter'?'Letter':'A4';}
          const executePrint=submitPrint||((settings)=>submitPrintDirect(window,settings));
          let outcome=await executePrint(options);
          // Chromium can reject an otherwise healthy Windows driver when a
          // custom page description is supplied. Only this definite pre-spool
          // validation failure is safe to retry automatically.
          if(!systemDialog&&!useDefault&&!outcome.success&&invalidPrinterSettings(outcome.reason)){
            attempt=2;strategy='printer_default';useDefault=true;
            send({busy:true,strategy,attempt,message:'打印机不接受指定纸张参数，正在改用打印机默认纸张重试一次。'});
            outcome=await executePrint({silent:true,deviceName:selectedPrinter,copies:input.copies,
              printBackground:true,landscape:card.layout?.orientation==='landscape',usePrinterDefaultPageSize:true});
          }
          if(!systemDialog&&useDefault&&!useWindowsGdi&&!outcome.success&&invalidPrinterSettings(outcome.reason)){
            attempt++;useWindowsGdi=true;
            send({busy:true,strategy,attempt,message:'该驱动不接受 Chromium 静默打印，正在使用 Windows 打印机默认设置兼容提交。'});
            outcome=await executePrint({silent:true,deviceName:selectedPrinter,copies:input.copies,
              printBackground:true,landscape:card.layout?.orientation==='landscape',usePrinterDefaultPageSize:true,windowsGdi:true});
          }
          clearTimeout(timer);printPending=false;if(done)return;
          if(outcome.success){if(useDefault&&!systemDialog)printerDefaultPageSize.add(selectedPrinter);if(useWindowsGdi)windowsGdiPrinters.add(selectedPrinter);
            finish({printed:true,strategy,attempt});return;}
          busy=false;
          const safe=invalidPrinterSettings(outcome.reason)&&!outcome.unknown;
          send({busy:false,strategy,attempt,failureReason:outcome.reason||'no_printer_receipt',mayRetrySafely:safe,
            message:`打印未完成：${outcome.reason||'打印机未返回回执'}。${safe?'可改用打印机默认设置重试。':'请先检查 Windows 打印队列，避免重复出纸。'} 也可打开系统打印对话框或保存 PDF。`});
          return;
        }
        busy=false;send({busy:false,message:'可继续选择打印机或保存 PDF。'});
      } catch(error){clearTimeout(timer);printPending=false;busy=false;send({busy:false,
        failureReason:String(error.code||error.message||'print_failed'),mayRetrySafely:false,message:error.message});}
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
module.exports={invalidPrinterSettings,printWithControls,printerDefaultPageSize,windowsGdiPrinters};
