import React, { useEffect, useState } from 'react';

type Bridge = {
  firstRun?: (action: string, input?: Record<string, unknown>) => Promise<string>;
  agentControlAction?: (action: string, input: unknown) => Promise<string>;
  getAgentToolInstallStatus?: () => Promise<string>;
};
type Props = { api: Bridge; licenseActive: boolean; studentCount: number; onDownloadWorkBuddy: () => void;
  onAgentSettings: () => void; onConnectorSettings: () => void; onStudent: () => void; onInbox: () => void; onTasks: () => void; onHostSettings: () => void };
type State = { status: string; state?: { step: string; provider?: 'workbuddy' | 'codex' }; message?: string };
const steps = ['welcome', 'agent', 'consent', 'connection', 'student', 'material', 'complete'];

export function FirstRunGuide({ api, licenseActive, studentCount, onDownloadWorkBuddy, onAgentSettings, onConnectorSettings, onStudent, onInbox, onTasks, onHostSettings }: Props) {
  const [state, setState] = useState<State>({ status: 'waiting' });
  const [step, setStep] = useState('welcome');
  const [installed, setInstalled] = useState<{ workbuddy?: boolean; codex?: boolean; probing?: boolean } | null>(null);
  const [provider, setProvider] = useState<'workbuddy' | 'codex'>('workbuddy');
  const [dispatch, setDispatch] = useState(true), [capture, setCapture] = useState(true), [external, setExternal] = useState(true);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function call(action: string, input: Record<string, unknown> = {}) {
    if (!api.firstRun) throw Error('当前主机版本不支持首次引导');
    const result = JSON.parse(await api.firstRun(action, input));
    if (!result.ok) throw Error(result.message || '引导状态读取失败');
    return result;
  }
  async function agent(action: string, input: Record<string, unknown> = {}) {
    if (!api.agentControlAction) throw Error('Agent 接口暂不可用');
    const result = JSON.parse(await api.agentControlAction(action, input));
    if (!result.ok || result.data?.ok === false) throw Error(result.message || result.data?.message || 'Agent 操作失败');
    return result.data;
  }
  async function refresh() {
    const raw = await call('snapshot');
    setState(raw);
    if (raw.state?.step) setStep(raw.state.step);
    if (raw.state?.provider) setProvider(raw.state.provider);
    try {
      const status = await api.getAgentToolInstallStatus?.();
      if (status) {
        const value = JSON.parse(status);
        setInstalled({ workbuddy: Boolean(value.workbuddy?.installed), codex: Boolean(value.codex?.installed), probing: Boolean(value.probing) });
        if (!raw.state?.provider && !value.workbuddy?.installed && value.codex?.installed) setProvider('codex');
      }
    } catch { setMessage('Agent 安装检测暂不可用，可稍后重新检测。'); }
    return raw;
  }
  useEffect(() => { let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    const load = async () => { try { const current = !cancelled ? await refresh() : null;
      if (!cancelled && current?.status === 'waiting') timer = setTimeout(load, 2500);
    } catch (error) { if (!cancelled) setMessage((error as Error).message); } };
    void load(); return () => { cancelled = true; clearTimeout(timer); };
  }, []);
  async function advance(next: string) {
    await call('progress', { step: next, provider }); setStep(next); setState(current => ({ ...current, status: next === 'complete' ? 'complete' : 'resume' }));
  }
  async function run(operation: () => Promise<unknown>) {
    setBusy(true); setMessage('正在处理，请稍候…');
    try { const result = await operation(); setMessage(typeof result === 'string' ? result : '已完成，可继续。'); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  if (!api.firstRun) return null;
  if (['existing', 'complete'].includes(state.status)) return <button className="secondary compact" onClick={() => void run(async () => { await call('progress', { step: 'welcome', provider, manual: true }); await refresh(); })}>重新打开首次引导</button>;
  if (state.status === 'waiting') return <section className="panel first-run-guide"><h2>正在检查首次使用状态…</h2></section>;
  if (state.status === 'error') return <section className="panel first-run-guide"><h2>首次引导暂不可用</h2><p>{state.message}</p><button onClick={() => void refresh()}>重新检查</button></section>;
  const connected = provider === 'workbuddy' ? installed?.workbuddy : installed?.codex;
  return <section className="panel first-run-guide" aria-label="首次使用引导">
    <div className="panel-heading"><div><h2>开始使用 AI教育管家</h2><p>第 {Math.max(1, steps.indexOf(step) + 1)} 步，共 6 步。中断后可从这里继续。</p></div><button className="secondary compact" disabled={busy} onClick={() => void advance('complete')}>稍后设置</button></div>
    {step === 'welcome' && <><p>先确认资料保存位置和使用方式。默认在本机管理资料；需要学生终端时，可随后开启主机服务。</p><p>保存位置可在系统设置中查看或修改，创建学生前请确认。</p><button className="secondary" onClick={onHostSettings}>查看保存位置与使用方式</button><button className="primary" disabled={busy || !licenseActive} onClick={() => void run(() => advance('agent'))}>继续检测 Agent</button>{!licenseActive && <p>请先激活 Windows 主机许可，然后继续。</p>}</>}
    {step === 'agent' && <><p>{installed?.probing ? '正在检测本机 Agent…' : `WorkBuddy：${installed?.workbuddy ? '已安装' : '未检测到'}；Codex：${installed?.codex ? '已安装' : '未检测到'}`}</p><label>使用的 Agent <select value={provider} onChange={e => setProvider(e.target.value as 'workbuddy' | 'codex')}><option value="workbuddy">WorkBuddy</option><option value="codex">Codex</option></select></label><div className="actions"><button onClick={onDownloadWorkBuddy}>下载 WorkBuddy</button><button className="secondary" onClick={onAgentSettings}>选择其他 Agent</button><button className="secondary" onClick={() => void run(refresh)}>重新检测</button><button className="primary" disabled={busy || !connected} onClick={() => void run(() => advance('consent'))}>已安装，继续</button><button className="secondary" disabled={busy} onClick={() => void run(() => advance('student'))}>暂不安装，先建档</button></div></>}
    {step === 'consent' && <><p>以下设置在你点击“启用并继续”后生效，可在 AI 接入与调度中心调整。</p><label><input type="checkbox" checked={dispatch} onChange={e => setDispatch(e.target.checked)} />启用管家调用 Agent 的任务与原有会话采集</label><label><input type="checkbox" checked={capture} disabled={!dispatch} onChange={e => setCapture(e.target.checked)} />自动采集会话完成后进入资料收件箱；高可信资料自动投递</label><label><input type="checkbox" checked={external} onChange={e => setExternal(e.target.checked)} />启用外部 Agent 连接器，每个会话绑定一名学生</label><div className="actions"><button className="primary" disabled={busy} onClick={() => void run(async () => {
      const snapshot = await agent('snapshot');
      if (snapshot.global.version === 0 && !snapshot.global.enabled) {
        await agent('saveGlobal', { settings: { ...snapshot.global, enabled: dispatch, capturedConversationRouting: { ...snapshot.global.capturedConversationRouting, enabled: dispatch && capture } } });
      } else if (snapshot.global.enabled !== dispatch || snapshot.global.capturedConversationRouting?.enabled !== (dispatch && capture)) {
        throw Error('全局授权已变化，请在 AI 接入与调度中心核对');
      }
      if (external) { const connection = await agent('external:snapshot');
        if (connection.policy.status === 'unconfigured') await agent('external:savePolicy', { ...connection.policy, preset: 'read_memory', accessMode: 'session_bound', confirmed: true });
        else if (connection.policy.status !== 'active' || connection.policy.accessMode !== 'session_bound') throw Error('外部连接授权已变化，请在连接管理中核对');
      }
      await advance('connection');
    })}>启用并继续</button><button className="secondary" disabled={busy} onClick={() => void run(() => advance('student'))}>暂不授权，先建档</button></div></>}
    {step === 'connection' && <><p>先在官方客户端完成登录授权，再安装教育管家连接。检查和合同测试均使用合成数据；联网测试可能消耗 Agent 额度。</p><div className="actions">
      <button disabled={busy || !connected} onClick={() => void run(async () => { await agent('authorize', { providerId: provider }); })}>启动官方授权</button>
      <button className="primary" disabled={busy || !connected || !external} onClick={() => void run(async () => (await agent('external:installHost', { hostType: provider, confirmed: true })).message || '连接配置已安装')}>安装并检查连接</button>
      <button className="secondary" disabled={busy || !connected} onClick={() => void run(async () => (await agent('verify', { providerId: provider })).message || '连接已验证')}>检查 Agent 连接</button>
      {provider === 'workbuddy' && <><button className="secondary" disabled={busy} onClick={() => void run(async () => (await agent('verifyContract', { providerId: provider })).message || '分类合同已验证')}>分类合同测试</button><button className="secondary" disabled={busy} onClick={() => void run(async () => (await agent('verifyResearch', { providerId: provider })).message || '联网合同已验证')}>联网合同测试</button></>}
      <button className="secondary" onClick={onConnectorSettings}>打开连接管理</button><button className="primary" disabled={busy} onClick={() => void run(() => advance('student'))}>继续建档</button></div></>}
    {step === 'student' && <><p>{studentCount ? `已有 ${studentCount} 位学生，可继续。` : '创建第一位学生档案，资料才能按学生归属保存。'}</p><button className="primary" onClick={onStudent}>创建或查看学生档案</button><button className="secondary" disabled={busy || !studentCount} onClick={() => void run(() => advance('material'))}>学生档案已就绪，继续</button></>}
    {step === 'material' && <><p>选择一份资料并确认归属学生。资料进入收件箱后，任务中心会显示处理状态、结果和必要时的手工执行入口。</p><button className="primary" disabled={!studentCount} onClick={onInbox}>导入第一份资料</button><button className="secondary" disabled={!studentCount} onClick={onTasks}>查看任务和结果</button><button className="secondary" disabled={busy} onClick={() => void run(() => advance('complete'))}>完成引导</button></>}
    {message && <p role="status">{message}</p>}
  </section>;
}
