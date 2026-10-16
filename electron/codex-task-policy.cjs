const DRAFT_START = '<<<EDU_MANAGER_DRAFT>>>';
const DRAFT_END = '<<<END_EDU_MANAGER_DRAFT>>>';

function isHostValidatedDraftTask(task) {
  return task?.kind === 'weekly_action'
    || ['learning_profile', 'learning_changes', 'learning_stage'].includes(String(task?.kind || ''));
}

function hostValidatedDraftPrompt(command) {
  return `${String(command || '').trim()}\n\n受控生成方式：本次任务的事实输入和可引用证据白名单已完整包含在上文。不要调用任何工具，不要读取或写入本机文件，不要调用 MCP，也不要尝试打开上文路径。只根据上文数据生成完整 Markdown；宿主程序会在本地执行路径校验、结构校验、证据白名单校验并受控写入系统校验区。\n\n最终回复必须只包含以下两个标记以及二者之间的完整 Markdown，不要添加解释、代码围栏或其他前后缀：\n${DRAFT_START}\n---\n（从 YAML frontmatter 开始的完整报告）\n${DRAFT_END}`;
}

function extractHostValidatedDraft(output) {
  const text = String(output || '');
  let draft = '';
  let offset = 0;
  while (offset < text.length) {
    const start = text.indexOf(DRAFT_START, offset);
    if (start < 0) break;
    const contentStart = start + DRAFT_START.length;
    const end = text.indexOf(DRAFT_END, contentStart);
    if (end < 0) break;
    draft = text.slice(contentStart, end).trim();
    offset = end + DRAFT_END.length;
  }
  if (!draft.startsWith('---')) return '';
  return `${draft.replace(/\s+$/, '')}\n`;
}

function validateHostDraftShape(task, content) {
  const text = String(content || '');
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return { ok: false, message: '报告缺少 YAML frontmatter。' };
  if (!/\nstatus:\s*generated\s*(?:\r?\n|$)/.test(text)) return { ok: false, message: '报告状态不是 generated。' };
  const studentId = String(task?.input?.studentId || '').trim();
  if (studentId && !text.includes(`student_id: ${studentId}`)) return { ok: false, message: '报告学生身份与任务不匹配。' };
  const fingerprint = String(task?.input?.growthFingerprint || '').trim();
  if (fingerprint && !text.includes(`growth_fingerprint: ${fingerprint}`)) return { ok: false, message: '报告成长指纹与任务不匹配。' };
  const missing = (task?.expectedOutput?.requiredSections || []).filter((section) => !new RegExp(`^##\\s+${escapeRegex(section)}\\s*$`, 'm').test(text));
  if (missing.length) return { ok: false, message: `报告缺少规定章节：${missing.join('、')}。` };
  return { ok: true, message: '宿主写入前结构检查通过。' };
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  DRAFT_END,
  DRAFT_START,
  extractHostValidatedDraft,
  hostValidatedDraftPrompt,
  isHostValidatedDraftTask,
  validateHostDraftShape,
};
