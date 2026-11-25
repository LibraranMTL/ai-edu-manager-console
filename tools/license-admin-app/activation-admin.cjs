'use strict';
const fs=require('node:fs'); const path=require('node:path'); const crypto=require('node:crypto');
const contract=require(fs.existsSync(path.join(__dirname,'../../shared/activation-code.cjs')) ? '../../shared/activation-code.cjs' : path.join(process.resourcesPath,'activation-code.cjs'));
const SERVER='https://www.greatbg.com/edu-activation';
function createActivationAdmin(options) {
  let token='';
  const file=path.join(options.rootDir,'activation-batches.enc');
  function read(){return fs.existsSync(file) ? JSON.parse(options.unprotect(fs.readFileSync(file,'utf8'))) : [];}
  function save(rows){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(temp,options.protect(JSON.stringify(rows)),{mode:0o600});fs.renameSync(temp,file);}
  async function request(route,body){const response=await (options.fetch || fetch)((options.serverUrl || SERVER)+route,{method:body?'POST':'GET',redirect:'error',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});const result=await response.json();if(!response.ok || !result.ok)throw Error(result.message || '管理服务请求失败');return result;}
  const listLocal=()=>read().map(({codes,hashes,...row})=>row);
  async function register(id){const row=read().find(r=>r.id===id);if(!row)throw Error('本机没有此批次');const {codes,registered,...input}=row;await request('/v1/admin/batches',input);const latest=read();latest.find(r=>r.id===id).registered=true;save(latest);return {ok:true,rows:listLocal()};}
  async function create(input){const count=Number(input.count);if(!Number.isInteger(count)||count<1||count>1000)throw Error('每批数量须为1至1000');const codes=Array.from({length:count},()=>contract.generateCode(input.productId));const row={id:crypto.randomUUID(),productId:input.productId,edition:input.edition,students:Number(input.students),terminalDevices:Number(input.terminalDevices ?? (input.productId==='WINDOWS_HOST'?3:1)),durationDays:Number(input.durationDays),redeemBefore:input.redeemBefore || new Date(Date.now()+365*86400000).toISOString(),orderNo:input.orderNo || '',customer:input.customer || '',hashes:codes.map(contract.codeHash),codes,registered:false};const rows=read();rows.unshift(row);save(rows);return register(row.id);}
  function exportBatch(id){const row=read().find(r=>r.id===id);if(!row?.registered)throw Error('批次尚未确认登记成功，不能交付');const safe=value=>`"${String(value).replace(/"/g,'""').replace(/^[=+@-]/,"'$&")}"`;return '\uFEFF'+['批次,产品,套餐,学生席位,学生终端数,有效天数,兑换截止,订单,客户,激活码',...row.codes.map(code=>[row.id,row.productId,row.edition,row.students,row.terminalDevices || 1,row.durationDays,row.redeemBefore,row.orderNo,row.customer,code].map(safe).join(','))].join('\r\n');}
  function reveal(id){const row=read().find(r=>r.id===id);if(!row?.registered)throw Error('批次尚未登记成功');return {ok:true,codes:row.codes};}
  return {login:async password=>{const result=await request('/v1/admin/login',{password});token=result.token;return {ok:true};},create,register,listLocal,exportBatch,reveal,
    status:()=>request('/v1/admin/status'),list:()=>request('/v1/admin/batches'), activations:()=>request('/v1/admin/activations'),action:(id,action)=>request(`/v1/admin/batches/${encodeURIComponent(id)}/actions`,{action})};
}
module.exports={createActivationAdmin};
