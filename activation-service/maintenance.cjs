'use strict';
const fs=require('node:fs'); const path=require('node:path'); const os=require('node:os'); const crypto=require('node:crypto');
const {DatabaseSync,backup}=require('node:sqlite'); const {execFileSync}=require('node:child_process'); const {pipeline}=require('node:stream/promises');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function snapshot(config,out) {
  fs.mkdirSync(out,{recursive:true,mode:0o700});const temp=fs.mkdtempSync(path.join(os.tmpdir(),'activation-backup-'));
  try {
    const db=new DatabaseSync(path.join(config.dataDir,'activations.sqlite'),{readOnly:true});
    try {await backup(db,path.join(temp,'activations.sqlite'));}finally{db.close();}
    fs.copyFileSync(config.privateKeyPath,path.join(temp,'signing.private.pem'));
    const metadata={schema:'edu-manager.activation-backup.v1',keyId:config.keyId,created:new Date().toISOString(),databaseHash:hash(path.join(temp,'activations.sqlite')),keyHash:hash(path.join(temp,'signing.private.pem'))};
    fs.writeFileSync(path.join(temp,'metadata.json'),JSON.stringify(metadata));
    const tar=path.join(temp,'bundle.tar.gz');execFileSync('tar',['-czf',tar,'-C',temp,'activations.sqlite','signing.private.pem','metadata.json']);
    const key=fs.readFileSync(config.backupKeyPath);if(key.length!==32)throw Error('备份加密密钥无效');
    const iv=crypto.randomBytes(12);const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);const name=`activation-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.enc`;const target=path.join(out,name);const staging=target+'.tmp';
    fs.writeFileSync(staging,Buffer.concat([Buffer.from('EDUA1'),iv]),{mode:0o600});
    await pipeline(fs.createReadStream(tar),cipher,fs.createWriteStream(staging,{flags:'a',mode:0o600}));fs.appendFileSync(staging,cipher.getAuthTag());fs.renameSync(staging,target);
    const result={...metadata,file:name,sha256:hash(target),bytes:fs.statSync(target).size};fs.writeFileSync(target+'.json',JSON.stringify(result,null,2),{mode:0o600});
    fs.writeFileSync(path.join(config.dataDir,'backup-status.json'),JSON.stringify(result),{mode:0o600});return result;
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
async function restore(source,keyFile,target) {
  if(fs.existsSync(target))throw Error('恢复目标必须为不存在的新目录');
  const bytes=fs.readFileSync(source);if(bytes.subarray(0,5).toString()!=='EDUA1')throw Error('备份格式不正确');
  const decipher=crypto.createDecipheriv('aes-256-gcm',fs.readFileSync(keyFile),bytes.subarray(5,17));decipher.setAuthTag(bytes.subarray(-16));
  const archive=Buffer.concat([decipher.update(bytes.subarray(17,-16)),decipher.final()]);
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'activation-restore-'));
  try {
    const file=path.join(temp,'archive.tar.gz');fs.writeFileSync(file,archive,{mode:0o600});
    const entries=execFileSync('tar',['-tzf',file],{encoding:'utf8'}).trim().split(/\r?\n/).sort();
    if(JSON.stringify(entries)!==JSON.stringify(['activations.sqlite','metadata.json','signing.private.pem']))throw Error('备份包含非法路径');
    execFileSync('tar',['-xzf',file,'-C',temp]);const metadata=JSON.parse(fs.readFileSync(path.join(temp,'metadata.json'),'utf8'));
    for(const name of entries)if(!fs.lstatSync(path.join(temp,name)).isFile()||fs.lstatSync(path.join(temp,name)).isSymbolicLink())throw Error('备份文件类型无效');
    if(hash(path.join(temp,'activations.sqlite'))!==metadata.databaseHash || hash(path.join(temp,'signing.private.pem'))!==metadata.keyHash)throw Error('备份内容哈希不匹配');
    const db=new DatabaseSync(path.join(temp,'activations.sqlite'));try{if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('数据库校验失败');db.exec('UPDATE control SET frozen=1; DELETE FROM sessions;');}finally{db.close();}
    fs.mkdirSync(target,{mode:0o700});for(const name of entries)fs.copyFileSync(path.join(temp,name),path.join(target,name));return {ok:true,keyId:metadata.keyId,frozen:true};
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
if(require.main===module)(async()=>{
  const [action,configFile,...args]=process.argv.slice(2);const config=JSON.parse(fs.readFileSync(configFile,'utf8'));
  if(action==='backup')console.log(JSON.stringify(await snapshot(config,args[0] || config.backupDir)));
  else if(action==='restore')console.log(JSON.stringify(await restore(args[0],config.backupKeyPath,args[1])));
  else if(action==='freeze') {const db=new DatabaseSync(path.join(config.dataDir,'activations.sqlite'));try{db.exec('UPDATE control SET frozen=1');console.log('New redemption frozen');}finally{db.close();}}
  else throw Error('使用 backup/restore/freeze；恢复后须人工核对兑换审计，不能自动解冻。');
})().catch(()=>{console.error('激活服务维护失败，请检查路径、权限和备份完整性');process.exitCode=1;});
module.exports={snapshot,restore};
