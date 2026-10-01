import { useEffect, useRef, useState } from 'react';
import { boundedWork } from './bounded-work';

export type FavoriteKind = 'topics' | 'competitions';
export type FavoriteApi = {
  getPlanningFavorites?: (studentId: string, kind: FavoriteKind) => Promise<string>;
  setPlanningFavorite?: (studentId: string, kind: FavoriteKind, versionId: string, candidateId: string, saved: boolean) => Promise<string>;
};
export type PlanningFavorite<T> = {
  candidateId: string; versionId: string; version: number; savedAt: string; createdAt: string; verifiedAt: string;
  candidate: T; sources: Array<{ url: string; title: string; fetchedAt: string; publishedAt: string; official: boolean }>;
};
export function usePlanningFavorites<T>(studentId: string, kind: FavoriteKind, api?: FavoriteApi) {
  const [state, setState] = useState<{ studentId: string; items: PlanningFavorite<T>[] }>({ studentId, items: [] });
  const [busy, setBusy] = useState(true), [ready, setReady] = useState(false), [message, setMessage] = useState('');
  const epoch = useRef(0), locked = useRef(false);
  useEffect(() => {
    epoch.current++; locked.current = false; setState({ studentId, items: [] }); setReady(false); setMessage('');
    void load(); return () => { epoch.current++; };
  }, [studentId, kind]);
  async function work(promise: Promise<string> | undefined, save: boolean) {
    if (locked.current) return;
    const requestEpoch = epoch.current; locked.current = true; setBusy(true); setMessage('');
    try {
      if (!promise) throw Error('当前终端未接入收藏能力。');
      const result = JSON.parse(await boundedWork(promise, 20000, '收藏回执等待超时，请刷新收藏核对；本次不自动重试。'));
      if (epoch.current !== requestEpoch) return;
      if (!result.ok || !Array.isArray(result.favorites)) throw Error(result.message || '收藏操作未完成。');
      setState({ studentId, items: result.favorites }); setReady(true); setMessage(save ? result.message || '收藏已更新。' : '');
    } catch (error) { if (epoch.current === requestEpoch) setMessage((error as Error).message); }
    finally { if (epoch.current === requestEpoch) { locked.current = false; setBusy(false); } }
  }
  function load() { if (!locked.current) return work(api?.getPlanningFavorites?.(studentId, kind), false); }
  function toggle(versionId: string, candidateId: string) {
    if (locked.current || !ready || state.studentId !== studentId) return;
    return work(api?.setPlanningFavorite?.(studentId, kind, versionId, candidateId, !state.items.some(item => item.candidateId === candidateId)), true);
  }
  return { items: state.studentId === studentId ? state.items : [], busy: busy || state.studentId !== studentId, ready: ready && state.studentId === studentId, message, load, toggle };
}
