const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');const out=path.join(root,'artifacts/activation-service');fs.mkdirSync(out,{recursive:true});
const files=['activation-service/service.cjs','activation-service/http.cjs','activation-service/maintenance.cjs','shared/activation-code.cjs','electron/license-entitlements.cjs','scripts/monitor-activation-service.cjs'];
for(const name of files){fs.mkdirSync(path.dirname(path.join(out,name)),{recursive:true});fs.copyFileSync(path.join(root,name),path.join(out,name));}
execFileSync('tar',['-czf',path.join(out,'activation-service.tar.gz'),'-C',out,...files],{stdio:'inherit'});
const sha=crypto.createHash('sha256').update(fs.readFileSync(path.join(out,'activation-service.tar.gz'))).digest('hex');fs.writeFileSync(path.join(out,'activation-service.sha256'),`${sha}  activation-service.tar.gz\n`);console.log(JSON.stringify({file:path.join(out,'activation-service.tar.gz'),sha256:sha}));
