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

module.exports = { RESEARCH_KINDS, SUCCESS_RECEIPTS, recoverableResearchBlock, researchResultValidation, researchRetryPatch, researchTaskDue };
