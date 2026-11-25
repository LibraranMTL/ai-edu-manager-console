'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { codeHash, signRequest } = require('../shared/activation-code.cjs');
const ACTIVATION_URL = 'https://www.greatbg.com/edu-activation';
function createActivationClient(options) {
  let flight;
  const statePath=path.join(options.rootDir,'activation-identity','credentials.enc');
  function save(state) {
    const ciphertext=options.protect(JSON.stringify(state));
    fs.mkdirSync(path.dirname(statePath),{recursive:true,mode:0o700});
    const temp=`${statePath}.${crypto.randomUUID()}.tmp`; fs.writeFileSync(temp,ciphertext,{mode:0o600}); fs.renameSync(temp,statePath);
  }
  function read(create = false) {
    if(fs.existsSync(statePath)) { try { return JSON.parse(options.unprotect(fs.readFileSync(statePath,'utf8'))); } catch { throw new Error('本机激活凭据不可读取，请联系售后核验；原授权保持保留。'); } }
    if(!create) return null;
    const key=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
    const state={privateKey:key.privateKey.export({type:'pkcs8',format:'pem'}).toString(),publicKey:key.publicKey.export({type:'spki',format:'der'}).toString('base64')}; save(state); return state;
  }
  async function exchange(code, recoverOnly=false) {
    const state=read(Boolean(code)); if(!state || (!code && !state.pending)) throw new Error('没有可恢复的自助激活记录，请输入激活码。');
    if(code) { const hash=codeHash(code); if(state.pending?.codeHash!==hash) {state.pending={code,codeHash:hash,operationId:crypto.randomUUID()}; save(state);} }
    const route=recoverOnly ? '/v1/activations/recover' : '/v1/activations/redeem';
    const body=signRequest(route,{operationId:state.pending.operationId,productId:options.productId || 'WINDOWS_HOST',deviceId:options.deviceId(),publicKey:state.publicKey,codeHash:state.pending.codeHash,...(!recoverOnly ? {code:state.pending.code} : {})},state.privateKey);
    const base=options.serverUrl || ACTIVATION_URL; const url=new URL(base);
    if(url.protocol!=='https:' && !(options.allowLoopback && url.protocol==='http:' && ['localhost','127.0.0.1'].includes(url.hostname))) throw new Error('激活服务必须使用可信 HTTPS');
    const response=await (options.fetch || fetch)(base+route,{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
    const text=await response.text(); if(text.length>32768) throw new Error('激活服务返回过大');
    let result; try{result=JSON.parse(text);}catch{throw new Error('激活服务响应无效，请稍后重试');}
    if(!response.ok || !result.ok) throw Object.assign(new Error(result.message || '激活服务暂不可用'),{code:result.code});
    if(!String(result.licenseToken || '').startsWith('AIE3.')) throw new Error('服务未返回有效许可证');
    const saved=await options.acceptLicense(result.licenseToken);
    if(!saved.ok) throw new Error(saved.message || '许可证本机核验或保存失败，原授权保持保留');
    state.pending.operationId=result.operationId; state.pending.completed=true; save(state);
    return {...saved,recovered:result.recovered};
  }
  function activate(code, recoverOnly=false) { if(flight) return flight; flight=exchange(code,recoverOnly).finally(()=>{flight=null;}); return flight; }
  return {activate,recover:()=>activate('',true), resume:()=> {const state=read(); return state?.pending && !state.pending.completed ? activate('') : Promise.resolve(null);}};
}
module.exports={ACTIVATION_URL,createActivationClient};
