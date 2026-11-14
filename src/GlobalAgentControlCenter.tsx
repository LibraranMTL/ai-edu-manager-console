import React, { useEffect, useRef, useState } from 'react';
import './agent-control-center.css';
type ProviderMode = 'automatic_preferred' | 'manual_only' | 'disabled';
type LoginStatus = { state: string; message: string };
type Global = { enabled: boolean; version: number; order: string[]; disabledProviders: string[]; providerModes: Record<string, ProviderMode>; providerProfiles: Record<string, string[]>; desktopHandoff: boolean; capturedConversationRouting: { enabled: boolean; authorizedAt: string } };
type ApiSettings = { revision: number; protocol: string; protocolLabel: string; baseUrl: string; model: string; configured: boolean; hasApiKey: boolean;
  researchSupported: boolean; researchReady: boolean; lastResearchCheck?: { message?: string; checkedAt?: string; sourceCount?: number } | null };
type Provider = { id: string; label: string; connection: string; adapterKind: string; custom: boolean; automaticProfiles: string[]; handoff: boolean; installed: boolean; state: string; message: string;
  channelAutomatic?: boolean; login?: LoginStatus | null; qualifications?: { profile: string; supported: boolean; state: string }[]; settings?: ApiSettings;
  tool?: { name: string; kind: string; target: string; args?: string[] } };
type Snapshot = { global: Global; pendingCount: number; profiles: { id: string; label: string }[]; providers: Provider[];
  tasks: { id: string; title: string; status: string; error: string; route?: { reason: string; selectedAdapter: string; stage: string; attempts?: { providerId: string; code: string }[] } }[];
  history: { at: string; policy: { enabled: boolean; version: number } }[];
  authorizationRestore?: { phase: string; message: string } };
export type AgentControlApi = { agentControlAction?: (action: string, input: unknown) => Promise<string> };
type Run = (action: string, extra?: Record<string, unknown>) => Promise<void>;
type ProviderOperation = { providerId: string; action: string; state: 'running' | 'pending' | 'success' | 'error'; message: string };
const states: Record<string, string> = { ready: '已连接', checking: '正在检查', channel_ready: '自动通道已连接', login_required: '需要重新授权', qualification_required: '等待自动复核', unavailable: '未连接', cooldown: '暂时冷却', manual: '手工交接' };
function LlmApiEditor({ provider, busy, run }: { provider: Provider; busy: boolean; run: Run }) {
  const settings = provider.settings!;
  const [protocol, setProtocol] = useState(settings.protocol), [baseUrl, setBaseUrl] = useState(settings.baseUrl), [model, setModel] = useState(settings.model);
  const [apiKey, setApiKey] = useState(''), [clearApiKey, setClearApiKey] = useState(false);
  return <article className="agent-policy llm-api-settings"><h3>LLM API 连接设置</h3><strong>{states[provider.state] || provider.state}</strong><p>{provider.message}</p>
    <div className="form-grid"><label>接口协议<select value={protocol} disabled={busy} onChange={e => setProtocol(e.target.value)}>
      <option value="openai-chat">OpenAI 兼容 Chat Completions</option><option value="openai-responses">OpenAI Responses（可验证联网研究）</option><option value="anthropic-messages">Anthropic Messages（可验证联网研究）</option>
    </select></label><label>API 地址<input value={baseUrl} disabled={busy} onChange={e => setBaseUrl(e.target.value)} placeholder="https://…/v1" /></label>
    <label>模型<input value={model} disabled={busy} onChange={e => setModel(e.target.value)} placeholder="模型 ID" /></label>
    <label>API 密钥<input type="password" autoComplete="off" value={apiKey} disabled={busy || clearApiKey} onChange={e => setApiKey(e.target.value)} placeholder={settings.hasApiKey ? '已有密钥；留空保留' : '云端服务必须填写'} /></label></div>
    {settings.hasApiKey && <label><input type="checkbox" checked={clearApiKey} disabled={busy} onChange={e => setClearApiKey(e.target.checked)} />清除已保存密钥</label>}
    <div className="actions"><button disabled={busy || !baseUrl.trim() || !model.trim()} onClick={() => void run('saveLlmApi', { settings: { revision: settings.revision, protocol, baseUrl, model, apiKey, clearApiKey } }).then(() => { setApiKey(''); setClearApiKey(false); })}>保存 API 配置</button>
      <button disabled={busy || !settings.configured} onClick={() => void run('verify', { providerId: 'llm-api' })}>结构化连接测试</button>
      <button disabled={busy || !settings.configured || !settings.researchSupported} onClick={() => void run('verifyResearch', { providerId: 'llm-api' })}>联网研究合同测试</button></div>
    <p className={settings.researchReady ? 'qualification-ready' : 'qualification-pending'}>{!settings.researchSupported
      ? '联网研究：当前协议不支持。普通结构化生成仍可使用。'
      : settings.researchReady ? `联网研究：已验证。${settings.lastResearchCheck?.message || ''}` : '联网研究：待独立测试。测试必须取得真实检索调用和可追溯网页引用。'}</p>
    <small>密钥在本机加密保存。旧 Chat Completions 配置继续用于分类、消化和学习卡片；只有通过上方独立合同测试的接口才会参与联网研究。</small>
  </article>;
}
function CustomToolEditor({ busy, run, provider }: { busy: boolean; run: Run; provider?: Provider }) {
  const initial = provider?.tool;
  const [name, setName] = useState(initial?.name || ''), [kind, setKind] = useState(initial?.kind || 'web'), [target, setTarget] = useState(initial?.target || ''), [args, setArgs] = useState(JSON.stringify(initial?.args || [], null, 2)), [error, setError] = useState('');
  async function save() {
    try { await run(provider ? 'editTool' : 'addTool', { ...(provider ? { providerId: provider.id } : {}), tool: { name, kind, target, args: JSON.parse(args) } }); if (!provider) { setName(''); setTarget(''); } setError(''); }
    catch (e) { setError((e as Error).message); }
  }
  return <details><summary>{provider ? '编辑接入方式与连接设置' : '添加自定义执行器'}</summary><div className="form-grid">
    <label>工具名称<input value={name} onChange={e => setName(e.target.value)} /></label>
    <label>接入方式<select value={kind} onChange={e => setKind(e.target.value)}><option value="web">HTTPS 网页 · 手工交接</option><option value="exe">本机 EXE · 手工交接</option><option value="cli">标准 JSON CLI · 验证后自动执行</option></select></label>
    <label>地址或本机 EXE 路径<input value={target} onChange={e => setTarget(e.target.value)} /></label>
    {kind === 'cli' && <label>独立参数数组<textarea value={args} onChange={e => setArgs(e.target.value)} placeholder={'["--json"]'} /></label>}</div>
    {kind === 'cli' && <p>仅添加您信任的程序。stdin 接收 edu-manager.standard-cli.v1 JSON；stdout 返回相同 protocol、requestId、ok:true 和 result。此通道不提供操作系统沙箱。</p>}
    {error && <p role="alert">{error}</p>}<button disabled={busy || !name.trim() || !target.trim()} onClick={() => void save()}>{provider ? '保存执行器设置' : '添加执行器'}</button></details>;
}
export type AgentControlView = 'center' | 'management';
export function AgentControlCenter({ api, onOpenTool, onDownloadTool, onTasks, onCapture, view = 'center' }: { api: AgentControlApi;
  onOpenTool?: (id: string) => void; onDownloadTool?: (id: string) => void; onTasks?: () => void; onCapture?: () => void;
  view?: AgentControlView;
  studentId?: string; students?: { id: string; name: string }[]; projects?: { id: string; name: string; studentIds: string[]; status?: string }[]; onStudentChange?: (id: string) => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [draft, setDraft] = useState<Global | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState('workbuddy');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [providerOperation, setProviderOperation] = useState<ProviderOperation | null>(null);
  const inFlight = useRef(false), generation = useRef(0);
  async function call(action: string, extra: Record<string, unknown> = {}) {
    if (!api.agentControlAction) throw Error('此页面需要更新后的 Windows 主机');
    const result = JSON.parse(await api.agentControlAction(action, extra));
    if (!result.ok) throw Error(result.message || '操作未完成'); return result.data;
  }
  useEffect(() => { const ticket = ++generation.current;
    void call('snapshot').then(data => { if (ticket === generation.current) { setSnapshot(data); setDraft(data.global); } }).catch(e => { if (ticket === generation.current) setMessage(e.message); });
    return () => { generation.current++; };
  }, []);
  const activeLogins = snapshot?.providers.filter(provider => provider.login?.state === 'running').map(provider => provider.id).sort().join(',') || '';
  useEffect(() => {
    if (!activeLogins) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await Promise.all(activeLogins.split(',').map(async providerId => {
        try {
          const { login } = await call('loginStatus', { providerId });
          if (cancelled) return;
          setSnapshot(previous => previous && ({ ...previous, providers: previous.providers.map(provider => provider.id === providerId ? { ...provider, login } : provider) }));
        } catch { /* Keep the current status; the next bounded poll can recover. */ }
      }));
      if (!cancelled) timer = setTimeout(() => void poll(), 1500);
    };
    timer = setTimeout(() => void poll(), 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [activeLogins]);
  async function run(action: string, extra: Record<string, unknown> = {}) {
    if (inFlight.current) return;
    const providerId = typeof extra.providerId === 'string' ? extra.providerId : '';
    const providerLabel = snapshot?.providers.find(provider => provider.id === providerId)?.label || providerId;
    const progress = action === 'authorize' ? `正在启动 ${providerLabel} 官方授权窗口…`
      : action === 'verifyResearch' ? `正在执行 ${providerLabel} 联网研究合同测试，通常需要 1–2 分钟，请勿重复点击…`
        : action === 'verifyContract' ? `正在验证 ${providerLabel} 分类任务合同；这不会改变连接状态…`
        : action === 'verify' ? `正在检查 ${providerLabel} 连接；不会调用分类模型或消耗任务合同额度…`
          : '正在处理…';
    inFlight.current = true; setBusy(true); setMessage(progress);
    if (providerId) setProviderOperation({ providerId, action, state: 'running', message: progress });
    const ticket = generation.current;
    try { const result = await call(action, { requestId: crypto.randomUUID(), ...extra }), fresh = await call('snapshot');
      if (ticket === generation.current) {
        const completed = result.message || '状态已刷新。';
        setSnapshot(fresh); setDraft(fresh.global); setMessage(action === 'authorize' ? '' : completed);
        if (providerId) setProviderOperation({ providerId, action, state: action === 'authorize' ? 'pending' : 'success', message: completed });
      }
    } catch (e) { const fresh = await call('snapshot').catch(() => null); if (ticket === generation.current) {
      if (fresh) setSnapshot(fresh);
      const failed = (e as Error).message;
      setMessage(failed);
      if (providerId) setProviderOperation({ providerId, action, state: 'error', message: failed });
    } throw e; }
    finally { inFlight.current = false; setBusy(false); }
  }
  const act: Run = (action, extra) => run(action, extra).catch(() => {});
  const label = (id: string) => snapshot?.providers.find(p => p.id === id)?.label || id;
  const order = draft && snapshot ? [...new Set([...draft.order, ...snapshot.providers.filter(p => p.automaticProfiles.length && p.id !== 'llm-api').map(p => p.id)])] : [];
  const selectedProvider = snapshot?.providers.find(provider => provider.id === selectedProviderId) || snapshot?.providers[0];
  function move(index: number, delta: number) { const next = [...order]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; setDraft({ ...draft!, order: next }); }
  const title = view === 'management' ? 'Agent 工具管理' : 'AI 接入与调度中心';
  const description = view === 'management'
    ? '统一管理内置 Agent 与自定义工具；安装、连接、启用状态和任务能力都来自同一执行器注册表。'
    : '一次授权，统一连接。覆盖所有有效学生；每次任务与会话仍保持独立归属。';
  const providerCard = (provider: Provider) => <article className="agent-policy" key={provider.id} aria-busy={providerOperation?.providerId === provider.id && providerOperation.state === 'running'}>
    <div className="panel-heading"><h4>{provider.label}</h4><label>执行方式<select aria-label={`${provider.label}执行方式`} disabled={busy} value={draft!.providerModes[provider.id]} onChange={e => void act('saveGlobal', { settings: { ...snapshot!.global, providerModes: { ...snapshot!.global.providerModes, [provider.id]: e.target.value as ProviderMode }, disabledProviders: e.target.value === 'disabled' ? [...new Set([...snapshot!.global.disabledProviders, provider.id])] : snapshot!.global.disabledProviders.filter(id => id !== provider.id) } })}>
      {provider.automaticProfiles.length > 0 && <option value="automatic_preferred">自动优先</option>}
      {provider.handoff && <option value="manual_only">仅手工交接</option>}
      <option value="disabled">停用</option>
    </select></label></div>
    <strong>{states[provider.state] || provider.state}</strong><p>{provider.message}</p>
    <small>{provider.automaticProfiles.length ? `可用自动合同：${provider.automaticProfiles.map(id => snapshot!.profiles.find(p => p.id === id)?.label || id).join('、')}` : '无已验证自动合同，仅支持手工交接'}</small>
    {provider.automaticProfiles.length > 0 && <details className="qualification-list"><summary>选择参与自动调度的任务合同</summary>{provider.automaticProfiles.map(profile => <label key={profile}><input type="checkbox" disabled={busy || draft!.providerModes[provider.id] !== 'automatic_preferred'} checked={(draft!.providerProfiles[provider.id] || []).includes(profile)} onChange={e => { const selected = draft!.providerProfiles[provider.id] || []; const next = e.target.checked ? [...new Set([...selected, profile])] : selected.filter(id => id !== profile); void act('saveGlobal', { settings: { ...snapshot!.global, providerProfiles: { ...snapshot!.global.providerProfiles, [provider.id]: next } } }); }} />{snapshot!.profiles.find(p => p.id === profile)?.label || profile}</label>)}</details>}
    {provider.qualifications?.length ? <details className="qualification-list"><summary>查看各任务合同状态</summary>{provider.qualifications.map(item => <p key={item.profile}><strong>{snapshot!.profiles.find(p => p.id === item.profile)?.label || item.profile}</strong>：{item.state}</p>)}</details> : null}
    <div className="actions">
      {['codex', 'workbuddy'].includes(provider.id) && <>
        {(provider.state === 'login_required' || provider.state === 'unavailable') && <button disabled={busy || !provider.installed || provider.login?.state === 'running'} onClick={() => void act('authorize', { providerId: provider.id })}>连接／授权</button>}
        <button className={provider.login ? 'primary' : ''} disabled={busy || !provider.installed || provider.state === 'checking'} onClick={() => void act('verify', { providerId: provider.id })}>{provider.login ? '我已完成登录，继续' : '检查连接'}</button>
        {!['login_required', 'unavailable'].includes(provider.state) && <details><summary>高级</summary><p>仅在更换账号或凭据已撤销时使用；普通检查不会改变授权版本。</p><button disabled={busy || provider.login?.state === 'running'} onClick={() => void act('authorize', { providerId: provider.id })}>更换账号／重新授权</button></details>}
      </>}
      {provider.id === 'workbuddy' && <button disabled={busy || !provider.installed} onClick={() => void act('verifyResearch', { providerId: provider.id })}>验证联网研究合同</button>}
      {provider.id === 'workbuddy' && <button disabled={busy || !provider.installed} onClick={() => void act('verifyContract', { providerId: provider.id })}>验证分类合同</button>}
      {provider.adapterKind === 'builtin-structured' && <button disabled={busy} onClick={() => void act('verifyBuiltin', { providerId: provider.id })}>检测并验证三类合同</button>}
      {provider.connection === 'cli' && <button disabled={busy} onClick={() => void act('verifyCli', { providerId: provider.id })}>验证 CLI 协议</button>}
      {provider.handoff && (!provider.custom || provider.connection !== 'cli') && <button disabled={busy} onClick={() => provider.custom ? void act('openTool', { providerId: provider.id }) : onOpenTool?.(provider.id)}>打开工具</button>}
      {!provider.custom && provider.id !== 'llm-api' && <button onClick={() => onDownloadTool?.(provider.id)}>官网／下载</button>}
      {provider.custom && <button disabled={busy} onClick={() => void act('removeTool', { providerId: provider.id })}>移除工具</button>}
    </div>
    {provider.login && <div className={`notice provider-operation ${['failed', 'expired', 'closed'].includes(provider.login.state) ? 'error' : 'pending'}`} role="status" aria-live="polite">
      <p>{provider.login.message}</p><small>{provider.login.state === 'finished'
        ? '官方登录流程已完成，点击上方“我已完成登录，继续”检查任务合同；已有有效后台登录时无需再次打开登录页。'
        : '在官方浏览器页面完成登录，再点击上方“我已完成登录，继续”。若登录页未打开，请等待状态更新；启动失败或超时后可重新点击“连接／授权”。'}</small>
    </div>}
    {providerOperation?.providerId === provider.id && !(providerOperation.action === 'authorize' && provider.login) && <p role={providerOperation.state === 'error' ? 'alert' : 'status'} aria-live="polite"
      className={`notice provider-operation ${providerOperation.state}`}>{providerOperation.message}</p>}
    {provider.custom && <CustomToolEditor busy={busy} run={run} provider={provider} />}
  </article>;
  return <section className="panel agent-control-center" aria-label={title}>
    <div className="panel-heading"><div><h2>{title}</h2><small>R25 · Windows 0.21.2 候选</small><p>{description}</p></div><button disabled={busy} onClick={() => void act('snapshot')}>刷新状态</button></div>
    {message && <p role="status" className="notice">{message}</p>}
    {!snapshot || !draft ? <p>正在读取已保存状态…</p> : <>
      {view === 'management' && <>
        <section aria-label="内置 Agent 工具"><h3>内置 Agent 工具</h3><p>“已安装”只表示能够打开；只有列出自动任务且连接验证成功的工具才会进入自动调度。</p><div className="agent-provider-grid">{snapshot.providers.filter(provider => !provider.custom && provider.id !== 'llm-api').map(providerCard)}</div></section>
        <section aria-label="自定义 Agent 工具管理"><h3>自定义 Agent 工具</h3><p>网页和普通 EXE 默认用于手工交接；标准 JSON CLI 通过合同验证后才可自动执行。</p><div className="agent-provider-grid">{snapshot.providers.filter(provider => provider.custom).map(providerCard)}</div>{!snapshot.providers.some(provider => provider.custom) && <p className="notice muted">尚未添加自定义 Agent 工具。</p>}<CustomToolEditor busy={busy} run={run} /></section>
      </>}
      {view === 'center' && <>
      <section aria-label="全局授权"><h3>1. 全局授权</h3>
        <label><input type="checkbox" disabled={busy} checked={draft.enabled} onChange={e => void act('saveGlobal', { settings: { ...snapshot.global, enabled: e.target.checked } })} />启用管家调用 Agent 的任务与原有会话采集</label>
        <label><input type="checkbox" disabled={busy || !draft.enabled} checked={draft.capturedConversationRouting.enabled} onChange={e => void act('saveGlobal', { settings: { ...snapshot.global, capturedConversationRouting: { ...snapshot.global.capturedConversationRouting, enabled: e.target.checked } } })} />自动采集会话完成后进入资料收件箱；高可信资料自动投递</label>
        <p>自动会话仅处理本次授权边界后的新会话；手工导入／分享对话只生成分类建议，不自动投递。{draft.capturedConversationRouting.authorizedAt ? ` 当前边界：${new Date(draft.capturedConversationRouting.authorizedAt).toLocaleString()}` : ''}</p>
        <p>这是内部任务调度设置，不会扩大外部连接器或旧凭据权限。官方登录、密钥和 Hook 信任仅在失效时重新连接。</p>
        {!draft.version && <p className="notice">尚未迁移，当前沿用旧策略。首次启用会备份旧策略并改用全局设置；不会重复派发正在执行或等待结果的任务。</p>}
        <button onClick={onCapture}>管理会话归属与自动采集</button>
      </section>
      <section aria-label="执行器与连接设置"><h3>2. 执行器与连接设置</h3>
        <p>从下拉列表选择需要管理的 Agent；切换只改变当前显示项，不会修改启用状态、连接配置或调度顺序。</p>
        <div className="agent-provider-picker">
          <label>选择 Agent／执行器
            <select aria-label="选择 Agent／执行器" value={selectedProvider?.id || ''} disabled={busy || !selectedProvider} onChange={event => setSelectedProviderId(event.target.value)}>
              <optgroup label="内置 Agent">
                {snapshot.providers.filter(provider => !provider.custom && provider.id !== 'llm-api').map(provider => <option value={provider.id} key={provider.id}>{provider.label} · {states[provider.state] || provider.state}</option>)}
              </optgroup>
              {snapshot.providers.some(provider => provider.id === 'llm-api') && <optgroup label="LLM API">
                {snapshot.providers.filter(provider => provider.id === 'llm-api').map(provider => <option value={provider.id} key={provider.id}>{provider.label} · {states[provider.state] || provider.state}</option>)}
              </optgroup>}
              {snapshot.providers.some(provider => provider.custom) && <optgroup label="自定义 Agent 工具">
                {snapshot.providers.filter(provider => provider.custom).map(provider => <option value={provider.id} key={provider.id}>{provider.label} · {states[provider.state] || provider.state}</option>)}
              </optgroup>}
            </select>
          </label>
          <div className="agent-provider-picker-summary" aria-live="polite">
            <strong>{snapshot.providers.length} 个执行器</strong>
            <span>{snapshot.providers.filter(provider => draft.providerModes[provider.id] !== 'disabled').length} 个已启用 · {snapshot.providers.filter(provider => provider.state === 'ready').length} 个连接已验证</span>
          </div>
        </div>
        {selectedProvider && <div className="agent-selected-provider" aria-label={`${selectedProvider.label}连接设置`}>
          {providerCard(selectedProvider)}
          {selectedProvider.id === 'llm-api' && selectedProvider.settings && <LlmApiEditor key={`${selectedProvider.id}:${selectedProvider.settings.revision}`} provider={selectedProvider} busy={busy} run={act} />}
        </div>}
        <CustomToolEditor busy={busy} run={run} />
      </section>
      <section aria-label="默认调度顺序"><h3>3. 默认调度顺序</h3><p>首选可用 Agent → 其他已启用且已通过当前任务合同的自动 Agent → LLM API → 一次手工交接。联网研究仅使用单独验证通过的通道；结果未知、取消或授权变化时停止回退。</p>
        <ol>{order.map((id, index) => <li key={id}><span>{label(id)}{draft.providerModes[id] === 'disabled' ? '（已停用）' : draft.providerModes[id] === 'manual_only' ? '（仅手工）' : ''}</span> <button aria-label={`上移 ${label(id)}`} disabled={busy || index === 0} onClick={() => move(index, -1)}>↑</button> <button aria-label={`下移 ${label(id)}`} disabled={busy || index === order.length - 1} onClick={() => move(index, 1)}>↓</button></li>)}</ol>
        <p>最后备用：LLM API{draft.providerModes['llm-api'] === 'disabled' ? '（已停用）' : ''} → 手工交接（同一任务选择目标）</p>
        <button disabled={busy} onClick={() => void act('saveGlobal', { settings: { ...draft, order } })}>保存全局调度顺序</button>
      </section>
      <section aria-label="最近执行及异常"><h3>4. 最近执行及异常</h3><button onClick={onTasks}>任务队列与执行异常（{snapshot.pendingCount}）</button>
        {snapshot.tasks.length === 0 && <p>暂无执行记录</p>}{snapshot.tasks.map(t => <article className="agent-policy" key={t.id}><strong>{t.title}</strong><p>{t.status} · {label(t.route?.selectedAdapter || '尚未派发')}</p><p>{t.error || t.route?.reason}</p>
          {t.route?.attempts?.map((a, i) => <small key={i}>{label(a.providerId)}：{a.code || '已接收'} </small>)}
          {t.route?.stage === 'desktop_handoff' && <button onClick={onTasks}>去同一任务选择交接目标</button>}
        </article>)}
        <details><summary>授权与调度变更记录（{snapshot.history.length}）</summary>{snapshot.history.map((h, i) => <p key={i}>{new Date(h.at).toLocaleString()} · {h.policy.enabled ? '启用' : '停用'} · 第 {h.policy.version} 版</p>)}</details>
      </section>
      </>}
    </>}
  </section>;
}
