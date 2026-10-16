const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('printProbe',{run:(format,orientation,original)=>ipcRenderer.invoke('print-probe',format,orientation,original)});
