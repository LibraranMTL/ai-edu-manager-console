const RESEARCH_KINDS = new Set(['competition_research_check', 'guidance_research_check', 'guidance_plan_refresh']);
const SUCCESS_RECEIPTS = new Set(['succeeded', 'unchanged', 'no_results']);

function recoverableResearchBlock(task) {
  return RESEARCH_KINDS.has(task?.kind) && task.status === 'blocked'
    && !task.executionId && !task.result && Number(task.attempt || 0) === 0
    && (task.error?.code === 'RESEARCH_CAPABILITY_UNAVAILABLE'
      || (!task.error && task.kind === 'guidance_research_check'));
}

function researchResultValidation(task, output) {
  const receipt = output?.receipt;
  const valid = output?.ok === true && SUCCESS_RECEIPTS.has(receipt?.status)
    && String(receipt.studentId) === String(task.sourceId)
    && receipt.taskId === task.id && receipt.executionId === task.executionId;
  return { valid, artifacts: [], message: output?.message || '研究未返回当前执行批次的有效回执。' };
}

function researchRetryPatch(task, error, now = Date.now()) {
  const code = String(error?.code || '');
  // Only explicit transport failures qualify; grounding and generic failures never do.
  const transient = ['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ENETUNREACH', 'RESEARCH_TIMEOUT'].includes(code);
  const retry = transient && Number(task.attempt || 0) < 2 && task.automaticExecution !== false;
  return { autoRetry: retry, nextRetryAt: retry ? new Date(now + 30 * 60 * 1000).toISOString() : '' };
}

function researchTaskDue(task, now = Date.now()) {
  if (!task || !RESEARCH_KINDS.has(task.kind) || task.recovery?.manualOnly) return false;
  if (['pending', 'queued', 'approved'].includes(task.status)) return Number(task.attempt || 0) === 0;
  if (recoverableResearchBlock(task)) return true;
  return task.status === 'failed' && task.autoRetry === true && Number(task.attempt || 0) < 2
    && Boolean(task.nextRetryAt) && Date.parse(task.nextRetryAt) <= now;
}

function classifyResearchTimeout(evidence, retryBudget = {}) {
  const now = Number.isFinite(Number(retryBudget.now)) ? Number(retryBudget.now) : Date.now();
  if (evidence?.terminationCause === 'user_cancel') return {
    disposition: 'terminal_failure', reasonCode: 'research_cancelled', nextRetryAt: '', nextProviderPolicy: 'none',
    evidenceRef: evidence.executionId || '',
  };
  const unknown = !evidence || evidence.terminationState !== 'closed'
    || !['timeout_kill', 'natural_exit'].includes(evidence.terminationCause)
    || evidence.stdoutDrained !== true || evidence.stderrDrained !== true
    || evidence.outputCheckedAfterClose !== true || !evidence.graceCompletedAt
    || Number(evidence.completedWebEvents || 0) > 0 || Number(evidence.completedToolEvents || 0) > 0
    || evidence.outputPresent === true || Number(evidence.outputSize || 0) > 0
    || evidence.localReceiptPresent === true || evidence.businessWriteStarted !== false
    || evidence.sideEffectClass !== 'read_only_research' || evidence.identityMatches !== true;
  if (unknown) return {
    disposition: 'execution_unknown', reasonCode: 'research_timeout_effects_unresolved',
    nextRetryAt: new Date(now + 30 * 1000).toISOString(), nextProviderPolicy: 'reconcile_same_execution',
    evidenceRef: evidence?.executionId || '',
  };
  if (Number(retryBudget.remainingRouteAttempts || 0) <= 0) return {
    disposition: 'terminal_failure', reasonCode: 'research_route_budget_exhausted', nextRetryAt: '', nextProviderPolicy: 'none',
    evidenceRef: evidence.executionId || '',
  };
  const nextProviderAvailable = retryBudget.nextProviderAvailable === true;
  return {
    disposition: 'safe_retry', reasonCode: 'research_timeout_closed_no_effect',
    nextRetryAt: new Date(now + (nextProviderAvailable ? 15 * 1000 : 5 * 60 * 1000)).toISOString(),
    nextProviderPolicy: nextProviderAvailable ? 'next_ready_provider' : 'same_provider_once',
    evidenceRef: evidence.executionId || '',
  };
}

module.exports = { RESEARCH_KINDS, SUCCESS_RECEIPTS, recoverableResearchBlock, researchResultValidation, researchRetryPatch, researchTaskDue, classifyResearchTimeout };
