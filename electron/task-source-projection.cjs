'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {digestIdempotencyKey}=require('./digest-batch.cjs');
const {normalizeMaterialStatus}=require('./material-status.cjs');
const {readProjectMaterialIndexSync,projectMaterialDigestProjection}=require('./project-material-host.cjs');
function readJson(file,fallback={}){try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}}
function signature(files){return files.map(file=>{try{const s=fs.statSync(file);return [file,s.size,s.mtimeMs,s.ctimeMs,s.ino].join(':');}catch(e){if(e.code==='ENOENT')return file+':missing';throw e;}}).join('|');}
function compactState(state){const result={};for(const key of ['status','pendingCount','submittedCount','digestBatchId','registryRevision','updatedAt','lastDigestAt','knowledgeGovernance'])if(state[key]!=null)result[key]=state[key];return result;}
function projectTaskSource(project){
  const result={};
  const keys=['id','name','storageName','status','revision','updatedAt','agentTool','studentIds','automation','materialAutomation','materialStorageMode','workspaceMode','knowledgeMode','archivedAt','publishedAt'];
  for(const key of keys)if(project[key]!==undefined)result[key]=project[key];
  for(const [key,value] of Object.entries(project))if(key.endsWith('Path')&&typeof value==='string')result[key]=value;
  result.dashboard={contributionReady:project.dashboard?.contributionReady,contributionStatus:project.dashboard?.contributionStatus};
  return result;
}
function projectTaskProjection(project){
  const file=path.join(project.managerPath,project.materialStorageMode==='workspace-v1'?'project-materials/registry.json':'project-digest-state.json');
  const before=signature([file]);
  const state=project.materialStorageMode==='workspace-v1'?projectMaterialDigestProjection(project,readProjectMaterialIndexSync(project)):readJson(file,project.digestState||{});
  const files=state.pendingFiles||[];
  // Batch ids are execution identities.  The business identity must remain
  // stable across restart/rebuild while the same source versions are pending.
  const digestKey=files.length?digestIdempotencyKey({type:'project',id:String(project.id)},files.map(file=>({materialId:'project-'+crypto.createHash('sha1').update(project.id+'|'+file.relativePath).digest('hex').slice(0,20),...file}))):'project_digest:'+project.id+':idle';
  if(before!==signature([file]))throw Object.assign(new Error('来源在读取期间变化'),{code:'TASK_SOURCE_CHANGED'});
  const result={...projectTaskSource(project),digestState:{...compactState(state),taskDigestKey:digestKey},projectionVersion:1,sourceSignature:before};
  for(const key of ['stagingItems','workspaceScanSnapshot','collaborationWorkspaceBaseline'])delete result[key];
  return result;
}
function studentTaskProjection(student){
  const manager=path.join(student.rootPath,'.edu-manager'),files=[path.join(manager,'materials.json'),path.join(manager,'digest-state.json'),path.join(student.rootPath,'.ai-manager','schedule-ledger.json')],before=signature(files);
  const materials=readJson(files[0],{materials:[]}).materials||[],state=readJson(files[1]);
  const open=materials.filter(item=>['pending_digest','submitted','digesting'].includes(normalizeMaterialStatus(item.status)));
  const pendingCount=open.filter(item=>normalizeMaterialStatus(item.status)==='pending_digest').length;
  const digestKey=open.length?digestIdempotencyKey({type:'student',id:String(student.id)},open.map(item=>({materialId:item.id,relativePath:item.path||item.fileName,sha1:item.sha1||'',size:item.size||0}))):'student_digest:'+student.id+':idle';
  if(before!==signature(files))throw Object.assign(new Error('来源在读取期间变化'),{code:'TASK_SOURCE_CHANGED'});
  return {digestState:compactState(state),pendingCount,submittedCount:open.length-pendingCount,digestKey,sourceSignature:before,projectionVersion:1};
}
module.exports={projectTaskSource,projectTaskProjection,studentTaskProjection,signature};
