'use strict';
const $ = (id) => document.getElementById(id);
function render(state) {
  $('student').textContent = state.studentName || '选择学生';
  document.querySelectorAll('.needs-student').forEach(button => { button.disabled = !state.studentId; });
  document.querySelectorAll('button[aria-pressed]').forEach(button => {
    const selected = button.dataset.action === state.activeAction;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  $('details').classList.toggle('open', Boolean(state.expanded));
  $('more').setAttribute('aria-expanded', String(Boolean(state.expanded)));
  const capture = state.capture;
  $('idle-actions').hidden = Boolean(capture);
  $('capture-actions').hidden = !capture;
  $('capture').classList.toggle('open', Boolean(capture));
  $('spacer').hidden = Boolean(capture);
  if (capture) {
    const otherStudent = capture.studentId && capture.studentId !== state.studentId;
    $('capture-state').textContent = `${otherStudent ? `${capture.studentName || '其他学生'} · ` : ''}${capture.status === 'paused' ? '已暂停' : '采集中'} · ${capture.screenshotCount} 张`;
    $('capture-source').textContent = capture.sourceName;
    $('pause').textContent = capture.status === 'paused' ? '继续' : '暂停';
  }
  $('inbox').textContent = state.countStatus === 'ready' && state.pendingCount ? `资料收件箱 · ${state.pendingCount}` : '资料收件箱';
}
window.QuickCapture.onState(render);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('details').classList.contains('open')) {
    event.preventDefault();
    window.QuickCapture.invoke('more').then(() => $('more').focus());
  }
});
document.addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button || button.disabled) return;
  $('message').textContent = '';
  try {
    const result = await window.QuickCapture.invoke(button.dataset.action);
    if (!result?.ok) $('message').textContent = result?.message || '操作未完成';
  } catch (error) { $('message').textContent = error?.message || '操作未完成'; }
});
