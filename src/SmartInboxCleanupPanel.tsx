import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { SmartInboxApi } from './SmartInboxPanel';
type Policy = { automaticRecycle: boolean; expirationCleanup: boolean; technicalRecovery: boolean; retentionDays: number };
type Entry = { id: string; revision: number; name: string; reason: string; stage: string; expiresAt: string; lastError?: string; releasedBytes?: number };
type Preview = { total: number; page: number; policy: Policy; releasedBytes: number; entries: Entry[] };
const reasons: Record<string, string> = { internal_task: '纯系统内部任务', capture_probe: '会话采集测试', empty_content: '确认无正文内容' };
export default function SmartInboxCleanupPanel({ api, studentId }: { api: SmartInboxApi; studentId: string }) {
  const [data, setData] = useState<Preview | null>(null), [page, setPage] = useState(1), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const generation = useRef(0), working = useRef(false);
  const call = useCallback(async <T,>(action: string, input: unknown = {}): Promise<T> => {
    if (!api.smartInboxAction) throw Error('请更新Windows主机');
    const result = JSON.parse(await api.smartInboxAction(action, input));
    if (!result.ok) throw Error(result.message || '操作未完成'); return result.data;
  }, [api]);
  const refresh = useCallback(async () => {
    const token = generation.current;
    const result = await call<Preview>('previewCleanup', { studentId, page });
    if (token === generation.current) setData(result);
  }, [call, studentId, page]);
  useEffect(() => { generation.current++; void refresh().catch(e => setError(e.message));
    const off = api.onSmartInboxChanged?.(() => { void refresh().catch(e => setError(e.message)); });
    return () => { generation.current++; off?.(); };
  }, [api, refresh]);
  async function run(action: string, input: unknown) {
    if (working.current) return; working.current = true; setBusy(true); setError('');
    try { await call(action, input); await refresh(); } catch (e) { setError((e as Error).message); }
    finally { working.current = false; setBusy(false); }
  }
  return <section aria-label="自动回收">
    <h3>自动回收</h3><p>确定无业务内容的系统任务和真实空资料自动退出待办。保留30天后，仅清理管家缓存及内部快照；用户原件、正式报告和证据关联继续保留。</p>
    {error ? <p role="alert">{error}</p> : null}
    {data ? <>
      <div className="form-grid">{([['automaticRecycle', '确定性自动回收'], ['expirationCleanup', '到期副本清理'], ['technicalRecovery', '技术异常自动恢复']] as const).map(([key, label]) =>
        <label key={key}><input type="checkbox" disabled={busy} checked={data.policy[key]} onChange={e => void run('updateCleanupPolicy', { [key]: e.target.checked })} />{label}</label>)}</div>
      <p>共 {data.total} 条回收记录，已释放 {(data.releasedBytes / 1024 / 1024).toFixed(2)} MiB。保留期限 {data.policy.retentionDays} 天。</p>
      {data.entries.map(entry => <article className="material-source-panel" key={entry.id}><strong>{entry.name}</strong>
        <p>{reasons[entry.reason] || entry.reason} · {entry.stage === 'purged' ? '副本已清理，原件保留' : entry.stage === 'restored' ? '已恢复并保留' : '可恢复回收'} · 到期 {new Date(entry.expiresAt).toLocaleString()}</p>
        {entry.lastError ? <p>保留副本等待复核：{entry.lastError}</p> : null}
        <button disabled={busy || entry.stage === 'restored'} onClick={() => void run('restoreCleanup', { id: entry.id, revision: entry.revision })}>恢复并保留</button>
      </article>)}
      <div className="actions"><button disabled={busy || page <= 1} onClick={() => setPage(p => p - 1)}>上一页</button><span>第 {page} 页</span>
        <button disabled={busy || page * 25 >= data.total} onClick={() => setPage(p => p + 1)}>下一页</button><button disabled={busy} onClick={() => void refresh().catch(e => setError(e.message))}>刷新回收状态</button></div>
    </> : <p>正在读取回收状态…</p>}
  </section>;
}
