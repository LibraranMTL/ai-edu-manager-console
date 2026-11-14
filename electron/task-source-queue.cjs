'use strict';
function createTaskSourceQueue({ persist=async()=>{}, processSource, onError=()=>{}, now=Date.now,
  setTimer=setTimeout, clearTimer=clearTimeout, yieldTurn=()=>new Promise(setImmediate), debounceMs=2000 }={}) {
  const pending=new Map();let timer=null,running=false,closed=false,serial=0;
  function schedule(delay=debounceMs){if(closed||timer||running||!pending.size)return;timer=setTimer(()=>{timer=null;void drain();},delay);timer.unref?.();}
  function mark(sourceType,sourceId,reason,sourceRevision){
    if(closed||!sourceId)return;
    const key=sourceType+':'+sourceId,previous=pending.get(key);
    const entry={sourceType,sourceId:String(sourceId),reason:String(reason||''),sourceRevision:String(sourceRevision||now()+':'+(++serial)),readyAt:0};
    // Persist only the coalesced latest revision when draining.
    pending.set(key,{...entry,firstAt:previous?.firstAt??now()});schedule();return key;
  }
  async function drain(){
    if(running||closed)return;running=true;const start=now();let count=0;
    try{
      for(const [key,entry] of pending){
        if(closed||count>=20||now()-start>=500)break;
        if(entry.readyAt>now())continue;
        try{
          await persist(entry);
          await processSource(entry);
          if(pending.get(key)===entry)pending.delete(key);
        }catch(error){entry.readyAt=now()+30000;onError(error,entry);}
        count++;await yieldTurn();
      }
    }finally{running=false;if(pending.size){const ready=Math.min(...[...pending.values()].map(e=>e.readyAt||now()));schedule(Math.max(0,Math.min(30000,ready-now())));}}
  }
  return {mark,drain,has:(type,id)=>pending.has(type+':'+id),size:()=>pending.size,
    close(){closed=true;if(timer)clearTimer(timer);timer=null;},pending:()=>[...pending.values()]};
}
module.exports={createTaskSourceQueue};
