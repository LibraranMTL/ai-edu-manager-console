'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const toolbar = $('#toolbar');
const learningRow = $('#learning-row');
const agentMenu = $('#agent-menu');
const scopeMenu = $('#scope-menu');
const palette = $('#learning-palette');
const toast = $('#toast');
const agentTrigger = $('#agent-trigger');
const scopeTrigger = $('#scope-trigger');
const modeTrigger = $('#mode-trigger');
const learningToggle = $('#learning-toggle');

const modeGroups = {
  study: [
    ['导师引导', '逐步提问，只给必要提示', '导'],
    ['费曼复述', '让学生讲解并识别概念缺口', '述'],
    ['逐题测验', '一次一题，回答后再反馈', '测'],
    ['错题复盘', '判断错误类型并生成变式题', '错'],
  ],
  simulation: [
    ['项目答辩', '陈述、追问与四维反馈', '辩'],
    ['升学面试', '围绕规划路径进行追问', '面'],
    ['口语练习', '表达、结构和内容反馈', '说'],
    ['角色辩论', '正反观点与证据挑战', '论'],
  ],
  verify: [
    ['来源核验', '区分有依据与待核实结论', '源'],
    ['事实检查', '核对关键事实与时效', '实'],
    ['反例挑战', '寻找边界条件和反例', '反'],
    ['论证漏洞', '检查推理跳跃与证据缺口', '证'],
  ],
  record: [
    ['继续学习', '沿用当前对话的未完成问题', '续'],
    ['设置目标', '建立本次学习目标和节奏', '标'],
    ['学习小结', '总结所得、疑问和下一步', '结'],
    ['开启新会话', '为当前学生准备安全开场', '新'],
  ],
};

let activeScene = 'expanded';
let toastTimer = 0;

function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  return fallbackCopy(text);
}

function fallbackCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  document.execCommand('copy');
  area.remove();
  return Promise.resolve();
}

function showToast(title = '提示词已复制', detail = '请粘贴到当前Agent，检查后发送') {
  clearTimeout(toastTimer);
  $('strong', toast).textContent = title;
  $('small', toast).textContent = detail;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3200);
}

function closeFloating(except = '') {
  if (except !== 'agent') { agentMenu.hidden = true; agentTrigger.setAttribute('aria-expanded', 'false'); }
  if (except !== 'scope') { scopeMenu.hidden = true; scopeTrigger.setAttribute('aria-expanded', 'false'); }
  if (except !== 'palette') { palette.hidden = true; modeTrigger.setAttribute('aria-expanded', 'false'); }
}

function setExpanded(expanded) {
  toolbar.dataset.state = expanded ? 'expanded' : 'collapsed';
  learningToggle.setAttribute('aria-expanded', String(expanded));
  learningRow.setAttribute('aria-hidden', String(!expanded));
  if (!expanded) closeFloating();
}

function renderModes(group = 'simulation', selectedTitle = '') {
  const list = $('#mode-list');
  list.replaceChildren();
  for (const [title, description, short] of modeGroups[group]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `mode-option${title === selectedTitle ? ' selected' : ''}`;
    button.dataset.mode = title;
    button.innerHTML = `<span>${short}</span><span><strong>${title}</strong><small>${description}</small></span>`;
    button.addEventListener('click', () => selectMode(title, button));
    list.append(button);
  }
  $('#mode-list').setAttribute('aria-label', `${$(`[data-tab="${group}"]`).textContent}方式`);
  const fallback = selectedTitle || modeGroups[group][0][0];
  const target = $(`[data-mode="${fallback}"]`, list);
  if (target) selectMode(fallback, target);
}

function selectMode(title, button) {
  $$('.mode-option', $('#mode-list')).forEach(item => item.classList.toggle('selected', item === button));
  $('#config-title').textContent = title;
  const goals = {
    '项目答辩': '练习无人机项目的三分钟陈述与追问',
    '升学面试': '围绕工业设计方向练习动机与经历表达',
    '口语练习': '完成两分钟英文项目介绍并接受追问',
    '角色辩论': '从证据与可行性两方面完成正反论证',
    '导师引导': '理解当前资料中的核心概念与相互关系',
    '费曼复述': '用自己的语言讲清楚本次学习主题',
    '逐题测验': '通过逐题反馈检查本次理解',
    '错题复盘': '识别错误原因并完成一道变式题',
    '来源核验': '核对结论是否都有当前资料依据',
    '事实检查': '核实关键事实、来源和更新时间',
    '反例挑战': '寻找当前结论不成立的边界条件',
    '论证漏洞': '找出论证中的跳跃和证据缺口',
    '继续学习': '继续处理当前对话尚未解决的问题',
    '设置目标': '在20分钟内完成一个明确学习目标',
    '学习小结': '形成已学、疑问和下一步清单',
    '开启新会话': '为当前学生建立不串档的新会话',
  };
  $('#config-goal').value = goals[title] || '';
}

function setPaletteTab(group, selectedTitle = '') {
  $$('.palette-tabs [role="tab"]').forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.tab === group)));
  renderModes(group, selectedTitle);
}

function setScene(scene, updateUrl = true) {
  activeScene = scene;
  document.body.classList.remove('scene-agent', 'scene-learning');
  toolbar.classList.remove('is-compact');
  closeFloating();
  toast.hidden = true;
  setExpanded(scene !== 'collapsed' && scene !== 'agent');

  if (scene === 'agent') {
    document.body.classList.add('scene-agent');
    agentMenu.hidden = false;
    agentTrigger.setAttribute('aria-expanded', 'true');
  }
  if (scene === 'learning') {
    document.body.classList.add('scene-learning');
    palette.hidden = false;
    modeTrigger.setAttribute('aria-expanded', 'true');
    setPaletteTab('simulation', '项目答辩');
  }
  if (scene === 'compact') toolbar.classList.add('is-compact');

  $$('[data-scene]').forEach(button => button.setAttribute('aria-current', String(button.dataset.scene === scene)));
  if (updateUrl) {
    const url = new URL(location.href);
    url.searchParams.set('scene', scene);
    history.replaceState({}, '', url);
  }
}

function selectAgent(button) {
  $$('.agent-option').forEach(option => {
    const selected = option === button;
    option.classList.toggle('selected', selected);
    option.setAttribute('aria-checked', String(selected));
  });
  $('#agent-name').textContent = button.dataset.name;
  const icon = button.dataset.icon === 'code' ? '#i-code' : button.dataset.icon === 'desktop' ? '#i-desktop' : '#i-globe';
  $('.agent-icon use').setAttribute('href', icon);
  toolbar.classList.toggle('capability-unavailable', button.dataset.agent === 'custom');
  if (button.dataset.agent === 'custom') {
    $('#scope-name').textContent = '当前对话';
    showToast('已切换到自定义Agent', '增强资料范围需完成真实连接验证');
  }
  closeFloating();
}

function setDemoState(state) {
  toolbar.classList.remove('demo-disabled', 'capability-unavailable');
  $('#student-name').textContent = '赵书源';
  const requiresStudent = [...$$('.capture-actions button'), ...$$('.learning-row button')];
  requiresStudent.forEach(button => { button.disabled = state === 'disabled'; });
  if (state === 'disabled') {
    toolbar.classList.add('demo-disabled');
    $('#student-name').textContent = '选择学生';
    showToast('请先选择学生', '学习提示词必须绑定一个学生范围');
  }
  if (state === 'unavailable') {
    const custom = $('[data-agent="custom"]');
    selectAgent(custom);
    toolbar.classList.add('capability-unavailable');
    showToast('资料查询能力不可用', '仍可基于当前对话复制通用提示词');
  }
  if (state === 'copied') showToast();
  if (state === 'normal') toast.hidden = true;
  $$('[data-demo-state]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.demoState === state)));
}

$$('[data-scene]').forEach(button => button.addEventListener('click', () => setScene(button.dataset.scene)));
$$('[data-demo-state]').forEach(button => button.addEventListener('click', () => setDemoState(button.dataset.demoState)));

learningToggle.addEventListener('click', () => setExpanded(toolbar.dataset.state === 'collapsed'));
agentTrigger.addEventListener('click', event => {
  event.stopPropagation();
  const opening = agentMenu.hidden;
  closeFloating(opening ? 'agent' : '');
  agentMenu.hidden = !opening;
  agentTrigger.setAttribute('aria-expanded', String(opening));
});
scopeTrigger.addEventListener('click', event => {
  event.stopPropagation();
  const opening = scopeMenu.hidden;
  closeFloating(opening ? 'scope' : '');
  scopeMenu.hidden = !opening;
  scopeTrigger.setAttribute('aria-expanded', String(opening));
  const enhanced = !toolbar.classList.contains('capability-unavailable') && $('#agent-name').textContent !== '通用Agent';
  $$('button', scopeMenu).forEach((button, index) => { button.disabled = index > 0 && !enhanced; });
});
modeTrigger.addEventListener('click', event => {
  event.stopPropagation();
  const opening = palette.hidden;
  closeFloating(opening ? 'palette' : '');
  palette.hidden = !opening;
  modeTrigger.setAttribute('aria-expanded', String(opening));
  if (opening) setPaletteTab('study');
});

$$('.agent-option').forEach(button => button.addEventListener('click', () => selectAgent(button)));
$$('#scope-menu button').forEach(button => button.addEventListener('click', () => {
  if (button.disabled) return;
  $$('#scope-menu button').forEach(item => item.setAttribute('aria-checked', String(item === button)));
  $('#scope-name').textContent = button.dataset.scope;
  closeFloating();
}));
$$('.palette-tabs [role="tab"]').forEach(button => button.addEventListener('click', () => setPaletteTab(button.dataset.tab)));
$('#close-palette').addEventListener('click', () => closeFloating());

$$('.learning-action[data-prompt]').forEach(button => button.addEventListener('click', () => {
  const scope = $('#scope-name').textContent;
  const agent = $('#agent-name').textContent;
  copyText(`当前学生：赵书源\n资料范围：${scope}\n目标Agent：${agent}\n\n${button.dataset.prompt}`)
    .then(() => showToast(`${button.textContent.trim()}提示词已复制`, `请粘贴到${agent}，检查后发送`));
}));

$('#ai-settings').addEventListener('click', () => {
  const agent = $('#agent-name').textContent;
  const generic = agent === '通用Agent' || agent === '我的网页Agent';
  const title = generic ? '通用协作指令已复制' : `${agent}连接指令已复制`;
  copyText(`AI教育管家Agent协作设置\n当前学生：赵书源\n目标环境：${agent}\n仅访问当前学生授权范围；保留来源；未经确认不得归档或修改档案。`)
    .then(() => showToast(title, '粘贴到目标Agent后，由用户检查并发送'));
});

$('#archive-button').addEventListener('click', () => showToast('归档需要确认', '正式版本将先选择成果与学生/项目目标'));
$$('.tool-button').forEach(button => button.addEventListener('click', () => showToast(`${button.dataset.action}入口`, 'Demo只展示交互，不调用真实采集功能')));
$('#more-button').addEventListener('click', () => showToast('更多功能', '本机导入、下载收件箱和自动会话采集'));
$('.manage-agent').addEventListener('click', () => showToast('自定义Agent管理', '可登记名称、桌面/网页类型和HTTPS地址'));

$('#mode-config').addEventListener('submit', event => {
  event.preventDefault();
  const title = $('#config-title').textContent;
  const agent = $('#agent-name').textContent;
  const prompt = `学习模式：${title}\n当前学生：赵书源\n资料范围：${$('#config-scope').value}\n难度：${$('#config-level').value}\n时长：${$('#config-time').value}\n本次目标：${$('#config-goal').value}\n\n请在当前对话中逐步执行，不自动形成正式掌握结论。`;
  copyText(prompt).then(() => showToast(`${title}提示词已复制`, `请粘贴到${agent}，检查后发送`));
});

document.addEventListener('click', event => {
  if (!event.target.closest('.floating-menu, .learning-palette, #agent-trigger, #scope-trigger, #mode-trigger')) closeFloating();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeFloating();
});

const params = new URLSearchParams(location.search);
if (params.get('capture') === '1') document.body.classList.add('capture-mode');
const initialScene = params.get('scene');
setScene(['collapsed', 'expanded', 'agent', 'learning', 'compact'].includes(initialScene) ? initialScene : 'expanded', false);
renderModes('simulation', '项目答辩');
