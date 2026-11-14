'use strict';

// The durable execution ledger owns work/source identity.  This reader is
// deliberately limited to authorization policy so a candidate refresh cannot
// look like a user revoking authorization between claim and send.
function createDispatchPolicyReader({readGlobalPolicy,readCurrentProjectScope}){
 return task=>({
  global:readGlobalPolicy(),
  scope:task?.sourceType==='project'&&task?.kind==='project_digest'
   ? String(readCurrentProjectScope(task)||''):'',
 });
}

module.exports={createDispatchPolicyReader};
