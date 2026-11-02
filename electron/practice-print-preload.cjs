const { ipcRenderer } = require('electron');
window.addEventListener('DOMContentLoaded', () => {
  const bar = document.createElement('aside');
  bar.id = 'edu-print-controls';
  bar.innerHTML = `<label>打印机 <select id="edu-printer"></select></label> <label>份数 <input id="edu-copies" type="number" min="1" max="99" value="1" style="width:60px"></label> <button id="edu-print" disabled>打印</button> <button id="edu-print-default" disabled hidden>使用打印机默认设置重试</button> <button id="edu-system-print" disabled>打开系统打印对话框</button> <button id="edu-pdf" disabled>保存 PDF 并打开</button> <button id="edu-close">关闭</button><p id="edu-print-status" role="status">正在准备卡片和字体，请稍候…</p>`;
  const css = document.createElement('style');
  css.textContent = '#edu-print-controls{position:sticky;top:0;z-index:9999;background:#eef6f7;color:#173343;padding:16px;border-bottom:1px solid #aac2c7;font:16px/1.5 "Microsoft YaHei",sans-serif}#edu-print-controls button,#edu-print-controls select,#edu-print-controls input{font:inherit;padding:6px;margin:3px}#edu-print-status{margin:6px 0 0}@media print{#edu-print-controls{display:none!important}}';
  document.head.append(css); document.body.prepend(bar);
  const status = bar.querySelector('#edu-print-status'), printer = bar.querySelector('#edu-printer');
  let unsafeDefaultRetry=false;
  ipcRenderer.on('practice-print:state', (_event, state) => {
    if (state.printers) {
      const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='请选择打印机';
      printer.replaceChildren(placeholder,...state.printers.map(item => { const option=document.createElement('option'); option.value=item.name; option.textContent=item.displayName||item.name; return option; }));
      printer.value='';
    }
    status.textContent = state.message || '';
    bar.querySelector('#edu-print').disabled = !!state.busy || !printer.value;
    unsafeDefaultRetry=Boolean(state.failureReason&&!state.mayRetrySafely);
    bar.querySelector('#edu-print-default').hidden = !state.failureReason;
    bar.querySelector('#edu-print-default').disabled = !!state.busy || !printer.value;
    bar.querySelector('#edu-system-print').disabled = !!state.busy || !printer.value;
    bar.querySelector('#edu-pdf').disabled = !!state.busy;
    printer.disabled=!!state.busy;bar.querySelector('#edu-copies').disabled=!!state.busy;
  });
  printer.onchange=()=>{bar.querySelector('#edu-print').disabled=!printer.value;};
  bar.querySelector('#edu-print').onclick=()=>ipcRenderer.send('practice-print:command',{action:'print',deviceName:printer.value,copies:Number(bar.querySelector('#edu-copies').value)});
  bar.querySelector('#edu-print-default').onclick=()=>{
    if(unsafeDefaultRetry&&!window.confirm('上次打印结果未知。请先确认 Windows 打印队列中没有该学习卡，再使用默认设置重试，避免重复出纸。'))return;
    ipcRenderer.send('practice-print:command',{action:'printer-default',deviceName:printer.value,copies:Number(bar.querySelector('#edu-copies').value)});
  };
  bar.querySelector('#edu-system-print').onclick=()=>ipcRenderer.send('practice-print:command',{action:'system-dialog',deviceName:printer.value,copies:Number(bar.querySelector('#edu-copies').value)});
  bar.querySelector('#edu-pdf').onclick=()=>ipcRenderer.send('practice-print:command',{action:'pdf'});
  bar.querySelector('#edu-close').onclick=()=>window.close();
});
