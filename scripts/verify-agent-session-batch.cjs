'use strict';
// Isolated renderer fixture: production row/list components, synthetic students and IPC receipts.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { resolvePnpmVirtualStore } = require('./pnpm-virtual-store.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output/agent-session-status-20261008');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'user-data'));
const pnpm = resolvePnpmVirtualStore(root);
const esbuild = require(path.join(pnpm, fs.readdirSync(pnpm).find(name => name.startsWith('esbuild@')), 'node_modules/esbuild'));
const ui = fs.readFileSync(path.join(root, 'src/main.tsx'), 'utf8');
const components = ui.slice(ui.indexOf('type AgentMemorySession ='), ui.indexOf('\nfunction App()'));
const fixture = `
import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { createRoot } from 'react-dom/client';
import { canSelectCapturedSession, matchesCapturedSessionTab } from './agent-session-batch';
const agentToolProfiles = { codex: {name: 'Codex'} };
const formatDateTime = value => value;
${components}
const sessions = Array.from({ length: 25 }, (_, i) => ({ sessionId: 's'+i, agentId: 'codex', title: '合成测试会话 '+i, status: 'completed', materialAvailable: true, materialLifecycleStatus: 'active', conversationReceipt: { assetId: 'a'+i }, materialDependencies: {canPermanentlyDelete: true}, messages: [] }));
sessions.push({...sessions[0], sessionId:'live', title:'正在采集', status:'active'});
sessions.push({...sessions[0], sessionId:'trash', title:'可删除测试会话', materialLifecycleStatus:'trashed'});
sessions.push({...sessions[0], sessionId:'blocked', title:'有投递依赖测试会话', materialLifecycleStatus:'trashed', materialDependencies:{canPermanentlyDelete:false,deliveryCount:1}});
sessions.push({...sessions[0], sessionId:'delivered', title:'历史已投递会话', materialDependencies:{canPermanentlyDelete:false,deliveryCount:1}, materialDeliveries:[{targetType:'student', targetId:'student-a', targetName:'测试学生', deliveredAt:'2026-10-07T01:00:00Z'}]});
window.calls = []; window.pending = null;
const root = createRoot(document.getElementById('root'));
function Fixture() {
 const [records,setRecords]=useState(()=>structuredClone(sessions));
 return <AgentMemorySessionList sessions={records} projects={[{id:'project-1',name:'合成测试项目'}]}
 onDeliver={async (items,target,progress) => { window.calls.push({action:'deliver',ids:items.map(i=>i.sessionId),target}); await new Promise(resolve=>window.pending=resolve);
   setRecords(current=>current.map(item=>item.sessionId!==items[0].sessionId?item:{...item,materialDependencies:{...item.materialDependencies,deliveryCount:1,canPermanentlyDelete:false},materialDeliveries:[{targetType:'project',targetId:'project-1',targetName:'合成测试项目',deliveredAt:'2026-10-08T01:00:00Z'}]}));
   progress('合成回执：首条成功，其他保留'); return [items[0].sessionId]; }}
 onManage={async (items,action,progress) => { window.calls.push({action,ids:items.map(i=>i.sessionId)}); progress('合成回执');
   const ids=items.filter(i=>action!=='delete'||i.materialDependencies.canPermanentlyDelete).map(i=>i.sessionId);
   setRecords(current=>current.flatMap(item=>!ids.includes(item.sessionId)?[item]:action==='delete'?[]:[{...item,materialLifecycleStatus:action==='trash'?'trashed':'active'}])); return ids; }} onClearEmpty={()=>{}} />;
}
window.renderStudent = id => root.render(<Fixture key={id}/>);
window.renderStudent('student-a');
`;
let win;
const checks = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const run = code => win.webContents.executeJavaScript(code, true);
async function click(text) {
  assert.ok(await run(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith(${JSON.stringify(text)})); if(!b||b.disabled)return false;b.click();return true;})()`), text);
  await sleep(60);
}
async function check(name, code) { assert.ok(await run(code), name); checks.push(name); }
async function main() {
  await app.whenReady();
  const bundle = esbuild.buildSync({ stdin: { contents: fixture, loader: 'tsx', resolveDir: path.join(root, 'src') }, bundle: true, write: false, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } }).outputFiles[0].text;
  win = new BrowserWindow({ width: 1300, height: 900, show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false, offscreen: true } });
  const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent('<html lang="zh-CN"><head><style>'+css+'</style></head><body><main class="app-shell" data-theme="purple" style="display:block;padding:24px;min-height:100vh"><h2>自动会话采集 · 批量操作测试</h2><div id="root"></div></main></body></html>')}`);
  // Reuse production theme variables without the application shell's sidebar overlays.
  await run(`(()=>{const host=document.querySelector('main');const style=getComputedStyle(host);for(const name of style){if(name.startsWith('--'))host.style.setProperty(name,style.getPropertyValue(name));}host.className='';})()`);
  await run(bundle); await sleep(150);
  await check('分页首屏显示20条', `document.querySelectorAll('.candidate-row').length===20`);
  await check('默认待投递不包含历史已投递项', `[...document.querySelectorAll('button')].some(b=>b.textContent==='待投递（26）'&&b.getAttribute('aria-pressed')==='true') && !document.body.textContent.includes('历史已投递会话')`);
  await click('已投递');
  await check('历史投递回执显示目标与时间', `document.querySelectorAll('.candidate-row').length===1 && document.body.textContent.includes('2026-10-07T01:00:00Z') && document.body.textContent.includes('学生原始资料库')`);
  await run(`document.querySelector('.candidate-main details summary').click()`); await sleep(80);
  await check('投递明细可展开查看', `document.querySelector('.candidate-main details').open && document.querySelector('.candidate-main details li').getBoundingClientRect().height>0`);
  fs.writeFileSync(path.join(output, 'delivered-history.png'), (await win.capturePage()).toPNG());
  await click('全部');
  await check('全部包含待投递和已投递但排除回收站', `[...document.querySelectorAll('button')].some(b=>b.textContent==='全部（27）'&&b.getAttribute('aria-pressed')==='true')`);
  await click('待投递');
  await run(`document.querySelector('[aria-label="选择会话：合成测试会话 0"]').click()`); await sleep(250);
  await check('逐条勾选即时更新', `document.querySelector('[aria-label="选择会话：合成测试会话 0"]').checked && document.body.textContent.includes('已选 1 条')`);
  await click('下一页');
  await check('采集中会话不可选择', `document.querySelector('[aria-label="选择会话：正在采集"]').disabled`);
  await click('选择本页');
  await check('跨页保留多选', `document.body.textContent.includes('已选 6 条')`);
  await run(`document.querySelector('[aria-label="全选当前列表可操作会话"]').click()`); await sleep(60);
  await check('全选覆盖所有分页且排除采集中记录', `document.body.textContent.includes('已选 25 条')`);
  await run(`(()=>{const e=document.querySelector('[aria-label="批量投递目标"]');e.value='project:project-1';e.dispatchEvent(new Event('change',{bubbles:true}));})()`); await sleep(60);
  await click('投递选中会话');
  await check('统一目标且重复操作被锁定', `window.calls.length===1 && window.calls[0].ids.length===25 && window.calls[0].target==='project:project-1' && [...document.querySelectorAll('button')].filter(b=>b.textContent==='投递选中会话').every(b=>b.matches(':disabled'))`);
  await run('window.pending()'); await sleep(60);
  await check('部分成功仅取消成功项', `document.body.textContent.includes('已选 24 条')`);
  await check('成功项自动退出待投递，失败项仍保留', `[...document.querySelectorAll('button')].some(b=>b.textContent==='待投递（25）') && [...document.querySelectorAll('button')].some(b=>b.textContent==='已投递（2）')`);
  await click('已投递');
  await check('新投递记录在已投递显示并可再次投递', `document.querySelectorAll('.candidate-row').length===2 && document.body.textContent.includes('合成测试项目') && document.body.textContent.includes('合成测试会话 0')`);
  await run(`(()=>{const e=document.querySelector('[aria-label="批量投递目标"]');e.value='student';e.dispatchEvent(new Event('change',{bubbles:true}));})()`); await sleep(60);
  await run(`document.querySelector('[aria-label="选择会话：合成测试会话 0"]').click()`); await sleep(60);
  await click('投递选中会话'); await run('window.pending()'); await sleep(60);
  await check('再次投递保持已投递分类且不制造新列表记录', `document.querySelectorAll('.candidate-row').length===2 && window.calls.at(-1).target==='student'`);
  await click('回收站');
  await check('切换列表清空选择', `document.body.textContent.includes('已选 0 条') && document.querySelectorAll('.candidate-row').length===2`);
  await run(`document.querySelector('[aria-label="全选当前列表可操作会话"]').click()`); await sleep(60);
  await click('彻底删除选中可删除项');
  await check('受保护会话保持勾选', `document.body.textContent.includes('已选 1 条') && document.querySelector('[aria-label="选择会话：有投递依赖测试会话"]').checked`);
  await click('恢复选中会话');
  await check('批量恢复动作', `window.calls.at(-1).action==='restore' && window.calls.at(-1).ids[0]==='blocked'`);
  await click('已投递');
  await check('有投递历史的恢复项回到已投递', `document.body.textContent.includes('有投递依赖测试会话')`);
  await run(`window.renderStudent('student-b')`); await sleep(60);
  await check('更换学生重置范围和勾选', `document.body.textContent.includes('已选 0 条') && document.querySelector('[aria-label="批量投递目标"]').value==='student'`);
  await click('选择本页'); await click('选中移入回收站');
  await check('批量回收调用一次', `window.calls.at(-1).action==='trash' && window.calls.at(-1).ids.length===20`);
  await check('首屏控件无横向溢出', `document.documentElement.scrollWidth<=window.innerWidth && document.querySelector('[aria-label="批量投递目标"]').getBoundingClientRect().bottom<window.innerHeight`);
  await run(`window.renderStudent('student-c')`); await sleep(60);
  await run(`document.querySelector('[aria-label="选择会话：合成测试会话 0"]').click()`); await sleep(60);
  fs.writeFileSync(path.join(output, 'batch-list.png'), (await win.capturePage()).toPNG());
  fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ ok: true, checks, fixture: 'Synthetic students and receipts; production React components' }, null, 2));
  console.log(JSON.stringify({ ok: true, checks: checks.length, output }));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { if (win) win.destroy(); app.quit(); });
