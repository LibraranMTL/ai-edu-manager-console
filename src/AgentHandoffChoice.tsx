import React, { useEffect, useState } from 'react';
import type { AgentControlApi } from './AgentControlCenter';
export function AgentHandoffChoice({ api, taskId, openTool, refresh }: { api: AgentControlApi; taskId: string; openTool: (id: string) => void; refresh: () => void }) {
  const [tools, setTools] = useState<{ id: string; label: string; custom: boolean }[]>([]), [selected, setSelected] = useState('');
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { let live = true;
    void api.agentControlAction?.('snapshot', {}).then(raw => { const value = JSON.parse(raw); if (!value.ok) throw Error(value.message);
      if (live) { const providers = value.data.providers.filter((p: { id: string; handoff: boolean }) => p.handoff && !value.data.global.disabledProviders.includes(p.id)); setTools(providers); setSelected(providers[0]?.id || ''); }
    }).catch(e => { if (live) setMessage(e.message); }); return () => { live = false; };
  }, [taskId]);
  async function handoff() {
    setBusy(true);
    try { const response = JSON.parse(await api.agentControlAction!('handoffTarget', { taskId, providerId: selected }));
      if (!response.ok) throw Error(response.message); setMessage(response.data.message); refresh();
      if (response.data.openable !== false) { if (response.data.custom) await api.agentControlAction!('openTool', { providerId: selected }); else openTool(selected); }
    } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="notice"><strong>后台通道已停止，等待一次手工交接</strong><p>请选择一个目标；同一任务的指令将复制到剪贴板。检查后手工发送，结果在此任务导入。</p>
    <label>交接目标<select value={selected} disabled={busy} onChange={e => setSelected(e.target.value)}>{tools.map(tool => <option key={tool.id} value={tool.id}>{tool.label}</option>)}</select></label>
    <button disabled={busy || !selected} onClick={() => void handoff()}>复制任务并打开所选工具</button>{message && <p role="status">{message}</p>}
  </div>;
}
