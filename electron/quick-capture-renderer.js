'use strict';
const $ = (id) => document.getElementById(id);
let screenSetup = null;
let selectedSource = '';
let working = false;
let latestState = {};
function renderSetup(setup) {
  screenSetup = setup; selectedSource = '';
  $('setup-student').textContent = `资料所属：${setup.student.name} · 开始后固定归属`;
  $('sources').replaceChildren();
  for (const source of setup.sources) {
    const button = document.createElement('button'); button.className = 'source'; button.type = 'button';
    button.disabled = source.blocked; button.setAttribute('aria-pressed', 'false'); button.title = source.blockReason || source.name;
    if (source.thumbnail?.startsWith('data:image/')) { const img = document.createElement('img'); img.src = source.thumbnail; img.alt = ''; button.append(img); }
    const label = document.createElement('span'); label.textContent = `${source.type === 'screen' ? '屏幕' : '窗口'} · ${source.name}`; button.append(label);
    button.addEventListener('click', () => {
      if (working) return;
      selectedSource = source.id;
      $('sources').querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      $('start-screen').disabled = false;
      $('setup-message').textContent = '';
    });
    $('sources').append(button);
  }
  $('screen-project').replaceChildren(new Option('学生屏幕采集箱', ''));
  setup.projects.forEach(project => $('screen-project').add(new Option(`${project.name} · 项目关联`, project.id)));
  $('start-screen').disabled = true;
  $('setup-message').textContent = setup.sources.some(source => !source.blocked) ? '' : '暂无可用来源，请打开需要采集的窗口后刷新。';
}
function render(state) {
  latestState = state;
  if (!state.setupOpen) { screenSetup = null; selectedSource = ''; }
  $('screen-setup').hidden = !state.setupOpen;
  const photoButton = document.querySelector('[data-action="photo"]');
  photoButton.classList.toggle('photo-active', Boolean(state.photoOpen));
  photoButton.title = state.photoOpen ? `${state.photoStudentName}的拍照窗已打开` : '打开悬浮拍照窗';
  $('student').textContent = state.studentName || '选择学生';
  document.querySelectorAll('.needs-student').forEach(button => { button.disabled = !state.studentId; });
  document.querySelectorAll('button[data-action][aria-pressed]').forEach(button => {
    const selected = button.dataset.action === state.activeAction;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  $('details').classList.toggle('open', Boolean(state.expanded) && !state.setupOpen);
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
  if (event.key === 'Escape' && latestState.setupOpen && !working) {
    event.preventDefault(); window.QuickCapture.invoke('close-screen'); return;
  }
  if (event.key === 'Escape' && $('details').classList.contains('open')) {
    event.preventDefault();
    window.QuickCapture.invoke('more').then(() => $('more').focus());
  }
});
document.addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button || button.disabled) return;
  if (working && !['hide', 'close-screen'].includes(button.dataset.action)) return;
  $('message').textContent = '';
  const action = button.dataset.action;
  const input = action === 'start-screen' && screenSetup ? { token: screenSetup.token, sourceId: selectedSource,
    projectId: $('screen-project').value, durationMinutes: Number($('screen-duration').value), mode: $('screen-mode').value } : undefined;
  const isWork = ['screen', 'start-screen', 'photo'].includes(action);
  if (isWork) { working = true; button.disabled = true; }
  try {
    const result = await window.QuickCapture.invoke(action, input);
    if (result?.setup && latestState.setupOpen && result.setup.student.id === latestState.studentId) renderSetup(result.setup);
    if (!result?.ok) {
      $('message').textContent = result?.message || '操作未完成';
      if (latestState.setupOpen) $('setup-message').textContent = result?.message || '操作未完成';
    }
  } catch (error) { $('message').textContent = error?.message || '操作未完成'; }
  finally { if (isWork) { working = false; button.disabled = button.id === 'start-screen' ? !selectedSource : button.classList.contains('needs-student') && !latestState.studentId; } }
});
