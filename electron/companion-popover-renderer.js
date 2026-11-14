'use strict';
const content = document.getElementById('content');
const status = document.getElementById('status');
const title = document.getElementById('title');
const hint = document.getElementById('hint');
let state = {};
let activeGroup = 'study';
let activeAction = 'flashcards';
let activeMentorStage = 'define';
let activeMentorAction = 'project_first_principles';

function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; }
function button(className, text, command, input = {}) { const node = el('button', className, text); node.type = 'button'; node.dataset.command = command; node.dataset.input = JSON.stringify(input); return node; }
function option(value, text) { const node = el('option','',text); node.value = value; return node; }
function capabilityBadges(target) {
  const wrap = el('div', 'badges');
  const labels = [['copy','复制'],['open','连接'],['query','资料查询'],['archive','归档']];
  labels.forEach(([key,label]) => wrap.append(el('span', `badge ${target.capabilities?.[key] ? 'on' : 'off'}`, label)));
  return wrap;
}
function renderTargets() {
  title.textContent = '目标智能体'; hint.textContent = '选择当前使用的智能体，查看授权与连接状态；复制后需自行粘贴。';
  const list = el('div','list');
  state.targets.forEach(target => {
    const item = button(`target ${target.id === state.selectedTargetId ? 'selected' : ''}`, '', 'select-target', { id: target.id });
    item.append(el('strong','',`${target.displayName}${target.verified ? ' · 已验证' : ''}`));
    item.append(el('span','',target.status || (target.kind === 'custom' ? '我的 Agent · 剪贴板模式' : '能力未验证')));
    item.append(capabilityBadges(target)); list.append(item);
  });
  const details = el('details'); details.append(el('summary','','添加自定义智能体'));
  const form = el('div','form');
  const nameLabel=el('label','','名称'); const name=el('input'); name.id='custom-name'; name.maxLength=32; name.placeholder='例如：我的网页助手'; nameLabel.append(name);
  const row=el('div','row'); const surfaceLabel=el('label','','类型'); const surface=el('select'); surface.id='custom-surface'; [['web','网页端'],['desktop','桌面端'],['unknown','其他']].forEach(([v,t])=>{const o=el('option','',t);o.value=v;surface.append(o)}); surfaceLabel.append(surface);
  const urlLabel=el('label','','网页地址（可选）'); const url=el('input'); url.id='custom-url'; url.placeholder='https://'; urlLabel.append(url); row.append(surfaceLabel,urlLabel);
  form.append(nameLabel,row,button('primary','添加（仅复制模式）','add-custom')); details.append(form); content.replaceChildren(list,details);
}
function renderScopes() {
  title.textContent='选择资料范围'; hint.textContent=state.targetCapabilities?.query ? '按当前授权查询所选学生或项目资料。' : '可选择学习范围；未连接时，提示词会引导连接或请您提供资料。';
  const list=el('div','list');
  [['conversation','当前对话','只使用当前 Agent 对话中明确提供的内容'],['student','学生资料','查询当前学生的已授权教育资料']].forEach(([id,name,desc])=>{
    const item=button(`scope ${state.scope===id?'selected':''}`,'','select-scope',{scope:id}); item.append(el('strong','',name),el('span','',desc));list.append(item);
  });
  if(state.projects.length){
    list.append(el('div','section-title','关联项目'));
    const select=el('select','project-choices'); select.id='scope-project'; select.append(new Option('请选择关联项目',''));
    state.projects.forEach(project=>select.add(new Option(project.name,project.id)));
    select.value=state.scope==='project'?state.projectId:'';
    select.addEventListener('change',async()=>{if(!select.value)return;try{const result=await window.CompanionPopover.invoke('select-scope',{scope:'project',projectId:select.value});status.textContent=result?.message||''}catch(error){status.textContent=error.message}});
    list.append(select);
  }
  content.replaceChildren(list);
}
function renderLearning(){
  title.textContent='学习模式'; hint.textContent='提示词复制后直接在当前 Agent 中使用；教育管家不代替 Agent 自动发送。';
  const mentorEntry=state.projectMentorEnabled===false?null:button('mentor-entry','项目导师 · 6 阶段 24 动作','open-project-mentor');
  const groups=el('div','groups'); state.modeGroups.forEach(group=>groups.append(button(`group ${activeGroup===group.id?'active':''}`,group.label,'group',{id:group.id})));
  const grid=el('div','action-grid'); const group=state.modeGroups.find(item=>item.id===activeGroup)||state.modeGroups[0]; group.actions.forEach(id=>{const action=state.actions[id];const item=button(`mode-action ${activeAction===id?'active':''}`,'','choose-action',{id});item.append(el('strong','',action.label),el('span','',action.summary));grid.append(item)});
  const form=el('div','form'); const selectedAction=state.actions[activeAction]||{};
  if(selectedAction.configMode==='visual'){
    const row=el('div','row');
    const quantityLabel=el('label','','数量');const quantity=el('select');quantity.id='quantity';
    [['1','1张'],['2','2张'],['auto','自动'],['custom','自定义']].forEach(([value,label])=>quantity.append(option(value,label)));quantity.value='auto';quantityLabel.append(quantity);
    const styleLabel=el('label','','风格');const style=el('select');style.id='style';
    [['simple','简洁'],['standard','标准'],['anime','动漫']].forEach(([value,label])=>style.append(option(value,label)));style.value='standard';styleLabel.append(style);row.append(quantityLabel,styleLabel);form.append(row);
    const customLabel=el('label','custom-quantity','自定义数量（1–50张）');const custom=el('input');custom.id='custom-quantity';custom.type='number';custom.min='1';custom.max='50';custom.step='1';custom.inputMode='numeric';custom.placeholder='输入张数';customLabel.append(custom);customLabel.hidden=true;
    quantity.addEventListener('change',()=>{customLabel.hidden=quantity.value!=='custom';if(!customLabel.hidden)custom.focus()});form.append(customLabel);
  }else if(selectedAction.configMode!=='goal'){
    const row=el('div','row');
    const diffLabel=el('label','','难度');const diff=el('select');diff.id='difficulty';['基础','适中','进阶'].forEach(value=>diff.append(option(value,value)));diff.value='适中';diffLabel.append(diff);
    const durationLabel=el('label','','时长');const duration=el('select');duration.id='duration';['5分钟','10分钟','15分钟','30分钟'].forEach(value=>duration.append(option(value,value)));duration.value='15分钟';durationLabel.append(duration);row.append(diffLabel,durationLabel);form.append(row);
  }
  const goalLabel=el('label','','本次目标（可选）');const goal=el('textarea');goal.id='goal';goal.maxLength=180;goal.placeholder=selectedAction.configMode==='visual'?'例如：突出核心概念，适合课堂打印':activeGroup==='plan'?'例如：规划未来四周的学习行动':activeGroup==='verify'?'例如：核验关键数据和来源时效':'例如：练习用三分钟讲清项目价值';goalLabel.append(goal);
  form.append(goalLabel,button('primary','复制并开始','copy-mode'));content.replaceChildren(...(mentorEntry?[mentorEntry]:[]),groups,grid,form);
}

function renderProjectMentor(){
  title.textContent='项目导师';
  const selectedTarget=(state.targets||[]).find(item=>item.id===state.selectedTargetId);
  hint.textContent=state.targetCapabilities?.query
    ? `目标 Agent：${selectedTarget?.displayName||'当前 Agent'}。复制动作不会查询；粘贴后仍须建立受控会话并确认授权。`
    : `目标 Agent：${selectedTarget?.displayName||'当前 Agent'}。剪贴板模式，不会读取项目资料。`;
  const wrap=el('div','mentor-wrap');
  if(state.projectMentorScopeInvalid){wrap.append(el('div','empty','项目范围已变化，请返回项目页面确认。'));content.replaceChildren(wrap);return}
  const projectBlock=el('section','mentor-project');
  if(state.projectMentorLocked&&state.projectMentorProject){
    projectBlock.append(el('span','section-title','已锁定当前项目'),el('strong','',state.projectMentorProject.name));
  }else{
    const projectLabel=el('label','mentor-project-label','当前项目');
    const select=el('select','project-choices');select.id='mentor-project';select.append(new Option('请选择当前学生项目',''));
    (state.projects||[]).forEach(project=>select.add(new Option(`${project.name}${project.status?` · ${project.status}`:''}`,project.id)));
    select.value=state.scope==='project'?state.projectId:'';
    select.addEventListener('change',async()=>{status.textContent='';try{const result=await window.CompanionPopover.invoke('select-scope',{scope:select.value?'project':'conversation',projectId:select.value});status.textContent=result?.message||''}catch(error){status.textContent=error.message}});
    projectLabel.append(select);projectBlock.append(projectLabel);
  }
  const project=state.projectMentorProject;
  if(project){const summary=el('div','mentor-project-summary');summary.append(el('span','',`类型：${project.type||'待提供'}`),el('span','',`状态：${project.status||'待提供'}`),el('span','',`目标：${project.objective||'待提供'}`),el('span','',`预期成果：${project.deliverables?.length?project.deliverables.join('；'):'待提供'}`));projectBlock.append(summary)}
  if(!(state.projects||[]).length&&!state.projectMentorLocked)projectBlock.append(el('div','empty','当前学生暂无可用项目。请先在项目与成果中创建或绑定项目。'));
  wrap.append(projectBlock);
  const stages=state.projectMentorStages||[];
  if(!stages.some(item=>item.id===activeMentorStage))activeMentorStage=stages[0]?.id||'define';
  const stage=stages.find(item=>item.id===activeMentorStage)||stages[0];
  if(stage&&!stage.actions.includes(activeMentorAction))activeMentorAction=stage.actions[0];
  const stageTabs=el('div','mentor-stages');stages.forEach(item=>{const stageButton=button(`mentor-stage mentor-stage-${item.id} ${item.id===activeMentorStage?'active':''}`,item.label,'mentor-stage',{id:item.id});stageButton.setAttribute('aria-pressed',String(item.id===activeMentorStage));stageTabs.append(stageButton)});
  wrap.append(stageTabs);
  const actions=el('div','action-grid mentor-actions');(stage?.actions||[]).forEach(id=>{const action=state.actions[id];if(!action)return;const item=button(`mode-action ${id===activeMentorAction?'active':''}`,'','mentor-action',{id});item.append(el('strong','',action.label),el('span','',action.summary));actions.append(item)});wrap.append(actions);
  const form=el('div','form');const goalLabel=el('label','','本次目标（可选）');const goal=el('textarea');goal.id='mentor-goal';goal.maxLength=180;goal.placeholder='例如：把当前方案收敛为本周可验证的一步';goalLabel.append(goal);
  const targetLabel=el('label','','目标 Agent');const targetSelect=el('select');targetSelect.id='mentor-target';(state.targets||[]).forEach(item=>targetSelect.add(new Option(`${item.displayName}${item.verified?' · 已验证':' · 剪贴板'}`,item.id)));targetSelect.value=state.selectedTargetId||'generic';targetSelect.addEventListener('change',async()=>{try{const result=await window.CompanionPopover.invoke('select-target',{id:targetSelect.value});status.textContent=result?.message||''}catch(error){status.textContent=error.message}});targetLabel.append(targetSelect);
  const copy=button('primary','复制项目导师提示词','copy-project-mentor');copy.disabled=!project||state.projectMentorScopeInvalid;
  form.append(targetLabel,goalLabel,copy);wrap.append(form);content.replaceChildren(wrap);
}
function learningConfig(){
  const goal=document.getElementById('goal')?.value||'';
  if(document.getElementById('quantity'))return {quantity:document.getElementById('quantity').value,customQuantity:document.getElementById('custom-quantity').value,style:document.getElementById('style').value,goal};
  if(document.getElementById('difficulty'))return {difficulty:document.getElementById('difficulty').value,duration:document.getElementById('duration').value,goal};
  return {goal};
}
function renderCollect(){
  title.textContent='采集';hint.textContent='内容归属当前学生；截屏和拍照可直接启动，录音与会话采集进入对应页面。';const list=el('div','list');
  [['screen','快速截屏 / 连续采集'],['audio','录音采集'],['photo','拍照采集'],['conversation','AI 会话采集']]
    .forEach(([action,label])=>list.append(button('more-action',label,'toolbar-action',{action})));content.replaceChildren(list);
}
function renderOrganize(){
  title.textContent='整理';hint.textContent='选择资料范围、复制消化提示词，或进入当前学生资料收件箱；归档必须有真实写回能力和回执。';const list=el('div','list');
  [['scope','资料选择'],['digest','消化资料'],['inbox','资料收件箱'],['archive','学习归档']]
    .forEach(([action,label])=>list.append(button('more-action',label,'toolbar-action',{action})));content.replaceChildren(list);
}
function renderSettings(){
  title.textContent='AI设置';hint.textContent='';const list=el('div','list');
  list.append(button('more-action','智能体人设','copy-persona'),button('more-action','目标智能体','open-targets'));
  content.replaceChildren(list);
}
function render(next){state=next||{};status.textContent=''; if(state.mode==='targets')renderTargets();else if(state.mode==='settings')renderSettings();else if(state.mode==='scope')renderScopes();else if(state.mode==='project-mentor')renderProjectMentor();else if(state.mode==='learning')renderLearning();else if(state.mode==='collect')renderCollect();else renderOrganize();}
let measuredHeight=0;
new ResizeObserver(()=>{const height=Math.ceil(document.querySelector('.panel').getBoundingClientRect().height);if(height!==measuredHeight){measuredHeight=height;window.CompanionPopover.invoke('resize',{height,mode:state.mode}).catch(()=>{})}}).observe(document.querySelector('.panel'));
window.CompanionPopover.onState(render);
document.addEventListener('keydown',event=>{if(event.key==='Escape')window.CompanionPopover.invoke('close')});
document.addEventListener('click',async event=>{
  const node=event.target.closest('button[data-command]');if(!node||node.disabled)return;const command=node.dataset.command;let input={};try{input=JSON.parse(node.dataset.input||'{}')}catch{}
  if(command==='group'){activeGroup=input.id;activeAction=(state.modeGroups.find(group=>group.id===activeGroup)||state.modeGroups[0]).actions[0];renderLearning();return}
  if(command==='choose-action'){activeAction=input.id;renderLearning();return}
  if(command==='mentor-stage'){activeMentorStage=input.id;const stage=(state.projectMentorStages||[]).find(item=>item.id===activeMentorStage);activeMentorAction=stage?.actions?.[0]||'';renderProjectMentor();return}
  if(command==='mentor-action'){activeMentorAction=input.id;renderProjectMentor();return}
  if(command==='copy-mode')input={actionId:activeAction,config:learningConfig()};
  if(command==='copy-project-mentor')input={actionId:activeMentorAction,config:{goal:document.getElementById('mentor-goal')?.value||'',projectRevision:state.projectMentorProject?.projectRevision||''}};
  if(command==='add-custom')input={displayName:document.getElementById('custom-name').value,surface:document.getElementById('custom-surface').value,homeUrl:document.getElementById('custom-url').value};
  try{const result=await window.CompanionPopover.invoke(command==='copy-project-mentor'?'copy-mode':command,input);if(!result?.ok){status.textContent=result?.message||'操作未完成';return}if(result.message)status.textContent=result.message}catch(error){status.textContent=error?.message||'操作未完成'}
});
