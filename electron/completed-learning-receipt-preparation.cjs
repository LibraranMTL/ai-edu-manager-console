'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {discoverDigestReceipts}=require('./digest-receipt-compat.cjs');
function signature(file){try{const s=fs.statSync(file);return `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;}catch{return '';}}
function prepare(input){
 const signatures={};
 const read=file=>{const before=signature(file),value=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));if(before!==signature(file))throw Object.assign(Error('回执准备期间来源变化'),{code:'SOURCE_CHANGED'});signatures[file]=before;return value;};
 let archive=[];try{archive=fs.readdirSync(input.archiveDir,{withFileTypes:true}).filter(e=>e.isFile()&&e.name.endsWith('.json')).map(e=>path.join(input.archiveDir,e.name)).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs).slice(0,32);}catch(error){if(error.code!=='ENOENT')throw error;}
 const seen=new Set();let entry,receiptSet;
 for(const file of [input.currentFile,...archive]){
  if(!fs.existsSync(file))continue;const batch=read(file);
  if(!batch.batchId||batch.status!=='completed'||seen.has(batch.batchId))continue;seen.add(batch.batchId);
  const receipts=discoverDigestReceipts({managerDir:input.managerDir,canonicalFile:input.receiptFile,archiveRoot:path.join(input.managerDir,'digest-receipts'),batchId:batch.batchId,batch});
  const checked=new Set(batch.learningEventReceiptFingerprints||[]);
  if(!receipts.candidates.some(candidate=>!checked.has(candidate.fingerprint)))continue;
  entry={batch,file,current:path.resolve(file)===path.resolve(input.currentFile)};receiptSet=receipts;break;
 }
 if(!entry)return {entries:[],materials:[],hashes:{},signatures:{}};
 const ids=new Set((entry.batch.files||[]).map(file=>String(file.materialId))),materials=read(input.materialsPath).materials.filter(row=>ids.has(String(row.id)));
 const hashes={};for(const candidate of receiptSet.candidates)signatures[candidate.file]=candidate.fileSignature;
 const root=fs.realpathSync(input.rawRoot);
 for(const item of entry.batch.files||[]){const file=path.resolve(input.rawRoot,String(item.relativePath||''));let real;try{real=fs.realpathSync(file);}catch{continue;}
  const rel=path.relative(root,real);if(!rel||rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel)||fs.lstatSync(file).isSymbolicLink())continue;
  const before=signature(file),hash=crypto.createHash('sha1'),fd=fs.openSync(file,'r'),buffer=Buffer.allocUnsafe(65536);try{for(;;){const bytes=fs.readSync(fd,buffer,0,buffer.length,null);if(!bytes)break;hash.update(buffer.subarray(0,bytes));}}finally{fs.closeSync(fd);}
  if(before===signature(file)){hashes[file]=hash.digest('hex');signatures[file]=before;}
 }
 const result={entries:[entry],materials,hashes,signatures,receiptsByBatch:{[entry.batch.batchId]:receiptSet}};
 if(Buffer.byteLength(JSON.stringify(result))>1500000)throw Object.assign(Error('单批迟到学习回执超过处理上限'),{code:'RECEIPT_BATCH_TOO_LARGE'});
 return result;
}
function verifyPrepared(input){return Object.entries(input.signatures||{}).every(([file,value])=>signature(file)===value);}
module.exports={prepare,verifyPrepared,signature};
