const fs=require('node:fs');const path=require('node:path');
const live=fs.realpathSync('/opt/edu-cloud-documents/current/trusted-license-issuers.json');
if(!live.startsWith('/opt/edu-cloud-documents/releases/'))throw Error('Unexpected cloud trust path');
const backup='/opt/edu-activation-backups/deploy-20261125-r1/cloud-trusted-issuers.json';if(!fs.existsSync(backup))fs.copyFileSync(live,backup);
const state=JSON.parse(fs.readFileSync(live));const row=JSON.parse(fs.readFileSync(path.join(__dirname,'online-public.json')));
if(row.keyId!=='activation-online-20261125'||row.maxEdition!=='ORG')throw Error('Unexpected online issuer');
if(!state.issuers.some(item=>item.keyId===row.keyId))state.issuers.push(row);
const temp=live+'.activation-new';fs.writeFileSync(temp,JSON.stringify(state,null,2));fs.chmodSync(temp,fs.statSync(live).mode);fs.renameSync(temp,live);console.log('CLOUD_TRUST_UPDATED');
