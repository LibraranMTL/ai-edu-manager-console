'use strict';
// Current-user DPAPI envelope for operator handoff across distinct Electron apps.
// Application credentials and device proof keys keep their own safeStorage vaults.
const {spawnSync}=require('node:child_process');const path=require('node:path');
function transform(value,protect){
  if(process.platform!=='win32')throw Error('本机运维凭据仅支持 Windows 当前用户保护');
  const script=`Add-Type -AssemblyName System.Security; $data=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); $result=[Security.Cryptography.ProtectedData]::${protect?'Protect':'Unprotect'}($data,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result))`;
  const result=spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],{input:value,encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:1024*1024});
  if(result.status!==0)throw Error('本机运维凭据不可读取，请在原 Windows 用户下使用或重新配置');return result.stdout.trim();
}
function protectString(value){return 'DPAPI1:'+transform(Buffer.from(value,'utf8').toString('base64'),true);}
function unprotectString(value){if(!String(value).startsWith('DPAPI1:'))throw Error('运维凭据格式不受支持');return Buffer.from(transform(value.slice(7),false),'base64').toString('utf8');}
module.exports={protectString,unprotectString};
