const {app}=require('electron');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const crypto=require('node:crypto');const assert=require('node:assert/strict');
const resources=path.resolve(process.argv[2]);const reportPath=path.resolve(process.argv[3]);const root=fs.mkdtempSync(path.join(os.tmpdir(),'activation-package-'));app.setPath('userData',root);
app.whenReady().then(async()=>{
  const base=path.join(resources,'app.asar');const checks=[];
  const clientModule=require(path.join(base,'electron/activation-client.cjs'));const contract=require(path.join(base,'shared/activation-code.cjs'));
  const policy=require(path.join(base,'electron/windows-license-policy.cjs'));const issuers=JSON.parse(fs.readFileSync(path.join(base,'dist/license/trusted-issuers.json')));
  assert.ok(issuers.issuers.some(row=>row.keyId==='activation-online-20261125'&&row.maxEdition==='ORG'));checks.push('packaged_online_issuer');
  assert.equal(clientModule.ACTIVATION_URL,'https://www.greatbg.com/edu-activation');checks.push('fixed_https_endpoint');
  const key=crypto.generateKeyPairSync('rsa',{modulusLength:3072});const pub=key.publicKey.export({type:'spki',format:'pem'}).toString();
  const payload={schema:'edu-manager.license.v3',licenseId:crypto.randomUUID(),productId:'WINDOWS_HOST',edition:'FAMILY',capabilities:['course_learning'],maxActiveStudents:3,maxDevices:1,devicePolicy:'required_binding',deviceId:'host-package-probe',issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),keyId:'probe-key'};
  const unsigned='AIE3.'+Buffer.from(JSON.stringify(payload)).toString('base64url');const token=unsigned+'.'+crypto.sign('RSA-SHA256',Buffer.from(unsigned),key.privateKey).toString('base64url');let calls=0;
  const options={rootDir:root,protect:s=>Buffer.from(s).toString('base64'),unprotect:s=>Buffer.from(s,'base64').toString(),deviceId:()=>payload.deviceId,fetch:async(url,request)=>{calls++;const body=JSON.parse(request.body);assert.equal(contract.verifyRequest(new URL(url).pathname.replace('/edu-activation',''),body),true);return {ok:true,text:async()=>JSON.stringify({ok:true,licenseToken:token,operationId:body.operationId,recovered:calls>1})};},acceptLicense:value=>policy.activateWindowsLicenseV3(value,{deviceId:payload.deviceId,trustedIssuers:{issuers:[{keyId:'probe-key',publicKey:pub,maxEdition:'ORG'}]}})};
  const client=clientModule.createActivationClient(options);assert.equal((await client.activate(contract.generateCode('WINDOWS_HOST'))).ok,true);checks.push('packaged_redemption_and_local_verification');
  const recovered=await clientModule.createActivationClient(options).recover();assert.equal(recovered.ok,true);assert.equal(recovered.license.licenseToken,token);checks.push('packaged_durable_recovery');
  assert.equal(policy.activateWindowsLicenseV3(token,{deviceId:'host-other-probe',trustedIssuers:{issuers:[{keyId:'probe-key',publicKey:pub,maxEdition:'ORG'}]}}).ok,false);checks.push('cross_device_rejected');
  for(const name of ['electron/activation-client.cjs','shared/activation-code.cjs','electron/preload.cjs'])assert.ok(fs.existsSync(path.join(base,name)));
  const main=fs.readFileSync(path.join(base,'electron/main.cjs'),'utf8');assert.match(main,/bridge:selfActivateLicense/);assert.match(main,/bridge:activateLicense/);checks.push('new_async_and_legacy_bridges_present');
  const report={ok:true,checks,resources};fs.writeFileSync(reportPath,JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.quit();
}).catch(e=>{fs.writeFileSync(reportPath,JSON.stringify({ok:false,message:e.message}));console.error(e.message);app.exit(1);});
