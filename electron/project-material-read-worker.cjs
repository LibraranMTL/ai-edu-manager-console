'use strict';

const { parentPort } = require('node:worker_threads');
const { readProjectMaterialIndexSync, readProjectMaterialCategoriesSync } = require('./project-material-host.cjs');
const { projectMaterialWorkspaceView } = require('./project-material-views.cjs');
const { projectMaterialAutomationOverview,
  listProjectMaterialExceptions } = require('./project-material-automation.cjs');
const { categoryDefinitions } = require('./project-material-classification.cjs');
const { materialVisibleToViewer, publicMaterial,
  listProjectMaterialsForViewer } = require('./project-material-http.cjs');
const { projectMaterialRemoteView } = require('./project-material-remote-views.cjs');

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

function perform(op, input = {}) {
  if(op==='completed_learning_receipt_prepare')return require('./completed-learning-receipt-preparation.cjs').prepare(input);
  if(op==='digest_summary'){
    const fs=require('node:fs');
    const read=(file,required=false)=>{try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch(error){if(error.code==='ENOENT'&&!required)return {};throw error;}};
    let state=read(input.statePath),snapshot;
    if(input.scopeType==='student')snapshot=require('./student-digest-reconciliation.cjs').digestBusinessSnapshot({materials:read(input.materialsPath,true).materials||[],digestState:state,receipts:[]});
    else if(input.project?.materialStorageMode==='workspace-v1'){
      state=require('./project-material-host.cjs').projectMaterialDigestProjection(input.project,readProjectMaterialIndexSync(input.project));snapshot=state;
    }else snapshot=state;
    const compact={};for(const key of ['status','message','digestBatchId','lastDigestAt','updatedAt','pendingCount','submittedCount'])if(state[key]!=null)compact[key]=state[key];
    return {ok:true,state:compact,pendingCount:Number(snapshot.pendingCount||0),submittedCount:Number(snapshot.submittedCount||0),processedCount:Number(snapshot.processedCount||state.digestedFiles?.length||0),lastDigestAt:state.lastDigestAt||''};
  }
  const project = input.project;
  if (!project?.id) throw fail('project_required', '项目资料读取缺少项目。');
  if (op === 'categories') return readProjectMaterialCategoriesSync(project);
  const index = readProjectMaterialIndexSync(project);
  if (op === 'routing_context') {
    const categories = categoryDefinitions(project, index).filter(item => item.active !== false)
      .slice(0, 100);
    const materialTerms = (index.materials || []).filter(item => item.adoption?.state !== 'excluded')
      .sort((left, right) => String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || '')))
      .slice(0, 200).map(item => ({
        materialId: item.materialId,
        title: require('node:path').posix.basename(String(item.location?.relativePath || '')),
        categoryId: String(item.classification?.categoryId || ''),
        sha256: String(item.sha256 || ''),
      }));
    const knowledgeTerms = (index.knowledge || []).filter(item => item.status !== 'recovery_conflict')
      .slice(-100).map(item => require('node:path').posix.basename(String(item.relativePath || item.title || item.knowledgeId || '')));
    const historicalAssociations = (index.intakeAssociations || []).filter(item => item.active !== false)
      .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))
      .slice(0, 200).map(item => ({
        sha256: String(item.sha256 || ''),
        primaryStudentId: String(item.primaryStudentId || item.studentId || ''),
        linkedStudentIds: [...new Set((item.linkedStudentIds || []).map(String))].sort(),
      }));
    return { categories, materialTerms, knowledgeTerms, historicalAssociations, registryRevision: index.revision };
  }
  if (op === 'workspace_view') return projectMaterialWorkspaceView(project, index, input.query || {});
  if (op === 'overview') return projectMaterialAutomationOverview(project, index, input.activeJob || null);
  if (op === 'exceptions') return listProjectMaterialExceptions(project, index, input.request || {});
  if (op === 'remote_view') {
    const projectedIndex = { ...index, categories: categoryDefinitions(project, index) };
    return projectMaterialRemoteView(project, projectedIndex, input.authContext || {}, input.query || {});
  }
  if (op === 'material_list') {
    const projectedIndex = { ...index, categories: categoryDefinitions(project, index) };
    return listProjectMaterialsForViewer(projectedIndex, input.authContext || {}, input.query || {});
  }
  if (op === 'visible_ids') return index.materials
    .filter((record) => materialVisibleToViewer(record, input.authContext || {}))
    .map((record) => String(record.materialId));
  if (op === 'material_detail') {
    const record = index.materials.find((item) => item.materialId === input.materialId);
    if (!record || !materialVisibleToViewer(record, input.authContext || {})) {
      return { registryRevision: index.revision, material: null };
    }
    return { registryRevision: index.revision,
      material: publicMaterial(record, input.authContext || {}) };
  }
  throw fail('project_material_read_operation_invalid', `不支持的项目资料读取操作：${op}`);
}

parentPort.on('message', (message) => {
  const id = message?.id;
  if (message?.op === 'close') {
    parentPort.postMessage({ id, ok: true, value: { ok: true } });
    setImmediate(() => process.exit(0));
    return;
  }
  try {
    parentPort.postMessage({ id, ok: true, value: perform(message?.op, message?.input) });
  } catch (error) {
    parentPort.postMessage({ id, ok: false, error: {
      code: error.code || 'project_material_read_failed', message: error.message,
    } });
  }
});

