// Run with Electron, not Node. Secrets are never sent to stdout.
const {app,safeStorage}=require('electron');const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
app.whenReady().then(()=>{
  if(!safeStorage.isEncryptionAvailable())throw Error('Windows protected storage unavailable');
  const root=path.join(process.env.LOCALAPPDATA,'AI-Education-Manager/activation-ops');fs.mkdirSync(root,{recursive:true});
  const encrypted=path.join(root,'admin.enc');const staging=path.join(root,'bootstrap-password');
  const dpapi=require('../electron/windows-protected-data.cjs');
  const old=fs.existsSync(encrypted)?fs.readFileSync(encrypted):null;
  const password=old?(old.toString().startsWith('DPAPI1:')?dpapi.unprotectString(old.toString()):safeStorage.decryptString(old)):crypto.randomBytes(40).toString('base64url');
  fs.writeFileSync(encrypted,dpapi.protectString(password));
  fs.writeFileSync(staging,password,{mode:0o600});console.log('Operator credential protected; bootstrap file prepared');app.quit();
}).catch(()=>{console.error('Operator provisioning failed');app.exit(1);});
