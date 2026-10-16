'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { codexMaterialInvocation, parseCodexMaterialEvents, runProcess } = require('./project-material-agent.cjs');
async function probeControlledCodex(executable, { run = runProcess } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-circuit-probe-'));
  const schemaPath = path.join(root,'schema.json'); let safe = true;
  try {
    await fs.writeFile(schemaPath, JSON.stringify({ type:'object', additionalProperties:false, properties:{ready:{type:'boolean',const:true}}, required:['ready'] }));
    const args = codexMaterialInvocation({cwd:root,schemaPath,isolationMode:'host-mediated-no-tools'});
    const stdout = await run(executable,args,{cwd:root,input:'No tools. This is a synthetic health check with no student data. Reply with JSON {"ready":true}.',timeoutMs:12000});
    const result = parseCodexMaterialEvents(stdout);
    return { passed:result?.ready === true, message:result?.ready === true ? '受控健康检查通过' : '未收到有效健康检查结果' };
  } catch(error) { if(error.code==='execution_unknown') safe=false; return {passed:false,code:error.code,message:error.message}; }
  finally { if(safe) { await fs.unlink(schemaPath).catch(()=>{}); await fs.rmdir(root).catch(()=>{}); } }
}
module.exports={probeControlledCodex};
