const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const {protectString,unprotectString}=require('../electron/windows-protected-data.cjs');const {generateCode,codeHash}=require('../shared/activation-code.cjs');
(async()=>{
  const password=unprotectString(fs.readFileSync(path.join(process.env.LOCALAPPDATA,'AI-Education-Manager/activation-ops/admin.enc'),'utf8'));
  const base='https://www.greatbg.com/edu-activation';const login=await (await fetch(base+'/v1/admin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password})})).json();if(!login.ok)throw Error('QA login failed');
  const codes={};const ids=[];
  for(const productId of ['WINDOWS_HOST','ANDROID_STANDALONE']){
    const code=generateCode(productId);const id=crypto.randomUUID();const body={id,productId,edition:'TRIAL',students:1,durationDays:3,redeemBefore:new Date(Date.now()+86400000).toISOString(),hashes:[codeHash(code)],orderNo:'QA-UI-20261125',customer:'真实界面激活验收，不交付销售'};
    const result=await (await fetch(base+'/v1/admin/batches',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${login.token}`},body:JSON.stringify(body)})).json();if(!result.ok)throw Error(result.message);codes[productId]=code;ids.push(id);
  }
  const target=path.resolve(__dirname,'../artifacts/activation-ui-codes.enc');fs.writeFileSync(target,protectString(JSON.stringify(codes)),{mode:0o600});console.log(JSON.stringify({prepared:true,batchIds:ids}));
})().catch(()=>{console.error('UI QA code preparation failed');process.exitCode=1;});
