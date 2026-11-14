'use strict';

const EXPECTED_EVIDENCE_TYPES = Object.freeze({
  A1:'real_agent_e2e', A2:'controlled_real_process', A3:'real_recovery', A4:'packaged_runtime',
  A5:'contract_integration', A6:'sql_real_process', A7:'contract_integration', A8:'persistent_fault_real_host',
  A9:'isolated_real_copy', A10:'late_receipt_real_host', A11:'isolated_real_copy', A12:'sql_ui',
  A13:'runtime_performance', A14:'real_agent_e2e', A15:'runtime_performance',
  B1:'contract_integration', B2:'contract_integration', B3:'contract_integration', B4:'real_late_output',
  B5:'contract_integration', B6:'controlled_real_process', B7:'contract_integration',
  C1:'contract_integration', C2:'controlled_real_process', C3:'controlled_real_process',
  C4:'production_scheduler_real_host', C5:'contract_real_copy',
});

function validMatrixEvidence(row = {}) {
  const expected = EXPECTED_EVIDENCE_TYPES[row.id];
  return Boolean(expected && row.evidenceType === expected);
}

module.exports = { EXPECTED_EVIDENCE_TYPES, validMatrixEvidence };
