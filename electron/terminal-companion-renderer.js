'use strict';

const bridge = window.studentCompanion;
const student = document.getElementById('student');
const status = document.getElementById('status');

function render(state = {}) {
  student.textContent = state.studentName || '尚未进入';
  status.textContent = state.connected ? (state.terminalMode === 'personal' ? '个人终端' : '共享终端') : '主机未连接';
  status.classList.toggle('offline', !state.connected);
  for (const button of document.querySelectorAll('.requires-session')) button.disabled = !state.connected;
  document.getElementById('learning')?.setAttribute('aria-expanded', String(state.popoverMode === 'learning'));
  document.getElementById('project-tutor')?.setAttribute('aria-expanded', String(state.popoverMode === 'project-tutor'));
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button || button.disabled) return;
  void bridge?.action(button.dataset.action).catch(() => {});
});

bridge?.onState(render);
