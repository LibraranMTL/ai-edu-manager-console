'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const batchHash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function runPublicationBatch({directory,requestId,audience,studentId,items,expectedHash,checkCurrent,execute}) {
  if(!/^[A-Za-z0-9_-]{8,100}$/.test(requestId))throw Error('发布编号无效');
  await fs.mkdir(directory,{recursive:true});const file=path.join(directory,requestId+'.json');let state;
  try{state=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  async function save(){const tmp=file+'.'+crypto.randomUUID()+'.tmp';try{await fs.writeFile(tmp,JSON.stringify(state),{flag:'wx',mode:0o600});await fs.rename(tmp,file);}finally{await fs.rm(tmp,{force:true});}}
  if(state){if(state.studentId!==studentId||JSON.stringify(state.audience)!==JSON.stringify(audience))throw Error('请保持原发布学生范围，或重新开始发布');}
  else {if(expectedHash&&expectedHash!==batchHash(items))throw Error('平台课程草稿已变化，请刷新核对后发布');if(!items.length)throw Error('没有待发布修改');state={studentId,audience,items:items.map(item=>({item,status:'pending'}))};await save();}
  for(const row of state.items){if(row.status==='success')continue;
    try{await checkCurrent(row.item);await execute(row.item,batchHash([requestId,row.item.id,row.item.kind]));row.status='success';delete row.message;}
    catch(e){row.status='failed';row.message=e.message;}
    await save();
  }
  return {requestId,items:state.items.map(r=>({id:r.item.id,title:r.item.title,status:r.status,message:r.message})),complete:state.items.every(r=>r.status==='success')};
}
async function incompletePublicationBatches(directory,studentId){
  let names;try{names=await fs.readdir(directory);}catch(e){if(e.code==='ENOENT')return [];throw e;}
  const result=[];
  for(const name of names.filter(n=>/^[A-Za-z0-9_-]{8,100}\.json$/.test(n))){
    const value=JSON.parse(await fs.readFile(path.join(directory,name),'utf8'));
    if(value.studentId===studentId&&Array.isArray(value.items)&&value.items.some(r=>r.status!=='success'))result.push({requestId:name.slice(0,-5),audience:value.audience,complete:false,items:value.items.map(r=>({id:r.item.id,title:r.item.title,status:r.status,message:r.message}))});
  }
  return result.slice(-10);
}
module.exports={runPublicationBatch,batchHash,incompletePublicationBatches};
