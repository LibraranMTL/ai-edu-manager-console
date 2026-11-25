const {app,safeStorage}=require('electron');const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
app.whenReady().then(async()=>{
  const {createActivationAdmin}=require('../tools/license-admin-app/activation-admin.cjs');const {createActivationClient}=require('../electron/activation-client.cjs');
  const {activateWindowsLicenseV3}=require('../electron/windows-license-policy.cjs');const {verifyProductLicense}=require('../cloud-report-service/product-license.cjs');
  const root=path.resolve(__dirname,'../artifacts/activation-live');fs.mkdirSync(root,{recursive:true});
  const protect=value=>safeStorage.encryptString(value).toString('base64');const unprotect=value=>safeStorage.decryptString(Buffer.from(value,'base64'));
  const admin=createActivationAdmin({rootDir:path.join(root,'admin'),protect,unprotect});
  const password=require('../electron/windows-protected-data.cjs').unprotectString(fs.readFileSync(path.join(process.env.LOCALAPPDATA,'AI-Education-Manager/activation-ops/admin.enc'),'utf8'));
  await admin.login(password);
  const issuers=JSON.parse(fs.readFileSync(path.join(__dirname,'../public/license/trusted-issuers.json')));
  const results=[];
  for(const productId of ['WINDOWS_HOST','ANDROID_STANDALONE']) {
    const record=await admin.create({productId,edition:'TRIAL',students:1,durationDays:3,count:1,orderNo:'QA-activation-20261125',customer:'自动验收专用，不交付销售'});
    const id=record.rows[0].id;const csv=admin.exportBatch(id);const code=csv.match(/"(AEC1[^"\r\n]+)"/)[1];
    const deviceId=productId==='WINDOWS_HOST'?'host-qa-activation-20261125':'ANDROID-QA-20261125';
    let token;
    const client=createActivationClient({rootDir:path.join(root,productId),protect,unprotect,deviceId:()=>deviceId,productId,
      acceptLicense:value=>{token=value;const result=productId==='WINDOWS_HOST'?activateWindowsLicenseV3(value,{deviceId,trustedIssuers:issuers}):verifyProductLicense(value,{deviceId,trustedIssuers:issuers,allowedProducts:['ANDROID_STANDALONE']});if(result.ok)fs.writeFileSync(path.join(root,productId,'license.enc'),protect(value));return result;}});
    const activated=await client.activate(code);assert.equal(activated.ok,true);
    const first=token;const recovered=await client.recover();assert.equal(recovered.ok,true);assert.equal(token,first);
    const duplicate=await client.activate(code);assert.equal(duplicate.recovered,true);
    const wrong=createActivationClient({rootDir:path.join(root,productId+'-wrong'),protect,unprotect,productId,deviceId:()=>deviceId+'-other',acceptLicense:()=>{throw Error('must not accept');}});
    await assert.rejects(wrong.activate(code),e=>e.code==='DEVICE_BOUND');
    const cloud=verifyProductLicense(first,{deviceId,trustedIssuers:issuers,allowedProducts:[productId]});assert.equal(cloud.ok,true);
    results.push({productId,batchId:id,activated:true,recoveredExact:true,duplicateRecovered:true,crossDeviceRejected:true,cloudVerifierAccepted:true});
  }
  const health=await (await fetch('https://www.greatbg.com/edu-activation/health')).json();
  const report={at:new Date().toISOString(),health,results,physicalAndroidVerified:false};fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.quit();
}).catch(error=>{console.error(error.code || error.message);app.exit(1);});
