'use strict';

const $ = id => document.getElementById(id);
let screenSetup = null;
let selectedSource = '';
let working = false;
let latestState = {};
let captureMode = 'quick';
let screenshot = null;
let hoverTimer = null;

function showMessage(text, success = false) {
  $('message').textContent = text || '';
  $('message').classList.toggle('success', success);
}

function clearScreenshot() {
  screenshot = null;
  $('shot-image').removeAttribute('src');
  $('shot-preview').hidden = true;
  $('sources').hidden = false;
  $('choose-again').hidden = true;
  $('save-screen').hidden = true;
  $('shot-inbox').hidden = true;
  $('screen-project').disabled = false;
  $('take-screen').textContent = '立即截取';
}

function renderMode() {
  const quick = captureMode === 'quick';
  $('mode-quick').setAttribute('aria-pressed', String(quick));
  $('mode-continuous').setAttribute('aria-pressed', String(!quick));
  $('duration-field').hidden = quick;
  $('continuous-controls').hidden = quick;
  $('quick-controls').hidden = !quick;
  $('screen-project').options[0].text = quick ? '学生资料收件箱' : '学生屏幕采集箱';
  $('screen-help').textContent = quick
    ? '截取一次，预览确认后保存到学生资料收件箱；关联项目作为投递提示。'
    : '原件保存在本次采集箱，关联项目不自动投递。';
}

for (const mode of ['quick', 'continuous']) {
  $(`mode-${mode}`).addEventListener('click', () => {
    if (working) return;
    captureMode = mode;
    clearScreenshot();
    renderMode();
    $('setup-message').textContent = '';
  });
}

$('choose-again').addEventListener('click', () => {
  if (!working) {
    clearScreenshot();
    $('setup-message').textContent = '';
  }
});

function renderSetup(setup) {
  screenSetup = setup;
  selectedSource = '';
  clearScreenshot();
  $('setup-student').textContent = `资料所属：${setup.student.name} · 切换学生将清除未保存预览`;
  $('sources').replaceChildren();
  for (const source of setup.sources) {
    const button = document.createElement('button');
    button.className = 'source';
    button.type = 'button';
    button.disabled = source.blocked;
    button.setAttribute('aria-pressed', 'false');
    button.title = source.blockReason || source.name;
    if (source.thumbnail?.startsWith('data:image/')) {
      const img = document.createElement('img');
      img.src = source.thumbnail;
      img.alt = '';
      button.append(img);
    }
    const label = document.createElement('span');
    label.textContent = `${source.type === 'screen' ? '屏幕' : '窗口'} · ${source.name}`;
    button.append(label);
    button.addEventListener('click', () => {
      if (working) return;
      selectedSource = source.id;
      clearScreenshot();
      $('sources').querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      $('start-screen').disabled = false;
      $('take-screen').disabled = false;
      $('setup-message').textContent = '';
    });
    $('sources').append(button);
  }
  $('screen-project').replaceChildren(new Option('学生屏幕采集箱', ''));
  setup.projects.forEach(project => $('screen-project').add(new Option(`${project.name} · 项目关联`, project.id)));
  $('start-screen').disabled = true;
  $('take-screen').disabled = true;
  renderMode();
  $('setup-message').textContent = setup.sources.some(source => !source.blocked) ? '' : '暂无可用来源，请打开需要采集的窗口后刷新。';
}

function render(state) {
  latestState = state;
  if (!state.setupOpen) {
    screenSetup = null;
    selectedSource = '';
    clearScreenshot();
  }
  $('screen-setup').hidden = !state.setupOpen;
  $('student').textContent = state.studentName || '选择学生';
  $('student').parentElement.title = state.studentName ? `${state.studentName} · ${state.studentId} · 切换学生` : '选择学生';
  document.querySelectorAll('.needs-student').forEach(button => { button.disabled = !state.studentId; });
  document.querySelectorAll('button[data-action][aria-pressed]').forEach(button => {
    const selected = button.dataset.action === state.activeAction;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  const popover = state.companion?.popoverMode || '';
  $('collect').setAttribute('aria-expanded', String(popover === 'collect'));
  $('organize').setAttribute('aria-expanded', String(popover === 'organize'));
  $('learning').setAttribute('aria-expanded', String(popover === 'learning'));
  $('project-mentor').setAttribute('aria-expanded', String(popover === 'project-mentor'));
  $('project-mentor').hidden = state.companion?.projectMentorEnabled === false;
  $('ai-settings').setAttribute('aria-expanded', String(popover === 'settings'));
  const capture = state.capture;
  $('idle-actions').hidden = Boolean(capture);
  $('capture-actions').hidden = !capture;
  $('capture').classList.toggle('open', Boolean(capture));
  $('spacer').hidden = Boolean(capture);
  if (capture) {
    const other = capture.studentId && capture.studentId !== state.studentId;
    $('capture-state').textContent = `${other ? `${capture.studentName || '其他学生'} · ` : ''}${capture.status === 'paused' ? '已暂停' : '采集中'} · ${capture.screenshotCount} 张`;
    $('capture-source').textContent = capture.sourceName;
    $('pause').textContent = capture.status === 'paused' ? '继续' : '暂停';
  }
}

window.QuickCapture.onState(render);

for (const id of ['collect', 'organize', 'learning', 'project-mentor']) {
  $(id).addEventListener('mouseenter', () => {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      const action = id === 'collect' ? 'collect-menu' : id === 'organize' ? 'organize-menu' : id === 'project-mentor' ? 'project-mentor' : 'learning';
      window.QuickCapture.invoke(action).catch(() => {});
    }, 90);
  });
}

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (latestState.setupOpen && !working) {
    event.preventDefault();
    window.QuickCapture.invoke('close-screen');
    return;
  }
  if (latestState.companion?.popoverMode) {
    event.preventDefault();
    window.QuickCapture.invoke('close-popover');
  }
});

document.addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button || button.disabled) return;
  if (working && !['hide', 'close-screen'].includes(button.dataset.action)) return;
  clearTimeout(hoverTimer);
  showMessage('');
  $('setup-message').classList.remove('receipt');
  const action = button.dataset.action;
  const input = ['start-screen', 'take-screen', 'save-screen'].includes(action) && screenSetup ? {
    token: screenSetup.token,
    sourceId: selectedSource,
    shotId: screenshot?.shotId,
    projectId: $('screen-project').value,
    durationMinutes: Number($('screen-duration').value),
    mode: $('screen-mode').value,
  } : undefined;
  const requestToken = screenSetup?.token;
  const isWork = ['screen', 'start-screen', 'take-screen', 'save-screen', 'photo'].includes(action);
  if (action === 'take-screen') {
    clearScreenshot();
    $('setup-message').textContent = '正在截取…';
  }
  if (isWork) {
    working = true;
    button.disabled = true;
  }
  try {
    const result = await window.QuickCapture.invoke(action, input);
    if (result?.setup && latestState.setupOpen && result.setup.student.id === latestState.studentId) renderSetup(result.setup);
    if (action === 'take-screen' && result?.ok && latestState.setupOpen && screenSetup?.token === requestToken) {
      screenshot = result;
      $('shot-image').src = result.preview;
      $('shot-preview').hidden = false;
      $('sources').hidden = true;
      $('choose-again').hidden = false;
      $('save-screen').hidden = false;
      $('save-screen').disabled = false;
      $('screen-project').disabled = true;
      $('take-screen').textContent = '重新截取';
      $('setup-message').textContent = '请确认截图内容，再保存原件。';
    }
    if (action === 'save-screen' && result?.ok && latestState.setupOpen && screenSetup?.token === requestToken) {
      $('save-screen').disabled = true;
      $('save-screen').hidden = true;
      $('shot-inbox').hidden = false;
      $('setup-message').textContent = result.message;
      $('setup-message').classList.add('receipt');
    }
    if (!result?.ok) {
      showMessage(result?.message || '操作未完成');
      if (latestState.setupOpen) $('setup-message').textContent = result?.message || '操作未完成';
    } else if (result.message) {
      showMessage(result.message, true);
      if (action === 'ai-settings') {
        button.classList.add('copied');
        setTimeout(() => button.classList.remove('copied'), 1400);
      }
    }
  } catch (error) {
    showMessage(error?.message || '操作未完成');
  } finally {
    if (isWork) {
      working = false;
      button.disabled = ['start-screen', 'take-screen'].includes(button.id)
        ? !selectedSource
        : button.classList.contains('needs-student') && !latestState.studentId;
    }
  }
});
