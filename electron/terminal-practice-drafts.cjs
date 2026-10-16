'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
function createTerminalPracticeDrafts(root) {
  const queues=new Map();
  function scopeKey(scope) {
    if(!scope.hostId||!scope.dataGeneration||!scope.studentId)throw Error('请先完成主机配对与学生选择');
    return crypto.createHash('sha256').update(JSON.stringify([scope.hostId,scope.dataGeneration,scope.studentId])).digest('hex');
  }
  function location(scope,cardId){if(!/^[a-zA-Z0-9_-]{1,150}$/.test(cardId||''))throw Error('卡片编号无效');return path.join(root,scopeKey(scope),cardId+'.json');}
  async function read(file){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw Error('本地作答草稿无法读取，原文件已保留');}}
  function serial(file,work){const job=(queues.get(file)||Promise.resolve()).catch(()=>{}).then(work);queues.set(file,job);return job.finally(()=>{if(queues.get(file)===job)queues.delete(file);});}
  return {
    async load(scope,cardId){const file=location(scope,cardId);await queues.get(file);return read(file);},
    async list(scope){const dir=path.join(root,scopeKey(scope));let names;try{names=await fs.readdir(dir);}catch(e){if(e.code==='ENOENT')return [];throw e;}const items=[];for(const n of names.filter(n=>/^[a-zA-Z0-9_-]+\.json$/.test(n))){const value=await read(path.join(dir,n));if(value)items.push({card:value.card,updatedAt:value.updatedAt});}return items;},
    save(scope,cardId,input){const file=location(scope,cardId);return serial(file,async()=>{
      if(input?.card?.id!==cardId||!input?.submission?.attemptId)throw Error('草稿与练习不匹配');
      const value={schema:1,card:input.card,submission:input.submission,updatedAt:new Date().toISOString()};
      const text=JSON.stringify(value);if(Buffer.byteLength(text)>15*1024*1024)throw Error('作答草稿超过本地保存限制');
      const previous=await read(file);
      if(previous&&JSON.stringify(previous.card.resourceRef)!==JSON.stringify(value.card.resourceRef))throw Error('卡片版本已变化，请保留旧稿后重新打开');
      await fs.mkdir(path.dirname(file),{recursive:true});const tmp=file+'.'+crypto.randomUUID()+'.tmp';
      try{await fs.writeFile(tmp,text,{flag:'wx',mode:0o600});await fs.rename(tmp,file);}finally{await fs.rm(tmp,{force:true});}
      return {saved:true};
    });},
    clear(scope,cardId,attemptId){const file=location(scope,cardId);return serial(file,async()=>{const value=await read(file);if(value?.submission.attemptId===attemptId)await fs.unlink(file);return {cleared:true};});},
  };
}
module.exports={createTerminalPracticeDrafts};
