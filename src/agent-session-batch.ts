export type CapturedSessionSource = {
  sessionId: string;
  status: string;
  materialAvailable?: boolean;
  materialLifecycleStatus?: string;
  materialDependencies?: { canPermanentlyDelete: boolean; deliveryCount?: number };
  conversationReceipt?: { assetId?: string; studentId?: string } | null;
};

export type CapturedSessionTab = 'pending' | 'delivered' | 'all' | 'trash';
export function matchesCapturedSessionTab(session: CapturedSessionSource, tab: CapturedSessionTab) {
  if (session.status === 'deleted' || session.materialLifecycleStatus === 'deleted') return false;
  if (session.materialLifecycleStatus === 'trashed') return tab === 'trash';
  if (tab === 'trash') return false;
  const delivered = Number(session.materialDependencies?.deliveryCount || 0) > 0;
  return tab === 'all' || (tab === 'delivered' ? delivered : !delivered);
}

export function canSelectCapturedSession(session: CapturedSessionSource) {
  return session.status !== 'active' && session.materialAvailable === true && Boolean(session.conversationReceipt?.assetId);
}

// Chunk below the host's 100-source limit; preserve item-level receipts on partial failure.
export async function runCapturedSessionBatch({ studentId, sessions, action, target, invoke, isCurrent, onProgress }: {
  studentId: string;
  sessions: CapturedSessionSource[];
  action: 'deliver' | 'trash' | 'restore' | 'delete';
  target: string;
  invoke: (request: string) => Promise<string | undefined>;
  isCurrent: () => boolean;
  onProgress?: (done: number, total: number) => void;
}) {
  const eligible = sessions.filter(session => canSelectCapturedSession(session)
    && (!session.conversationReceipt?.studentId || session.conversationReceipt.studentId === studentId)
    && ((action === 'delete' || action === 'restore') === (session.materialLifecycleStatus === 'trashed'))
    && (action !== 'delete' || session.materialDependencies?.canPermanentlyDelete === true));
  const succeeded: string[] = [];
  const errors: string[] = [];
  let stopped = false;
  for (let offset = 0; offset < eligible.length; offset += 20) {
    if (!isCurrent()) { stopped = true; break; }
    const chunk = eligible.slice(offset, offset + 20);
    const projectId = target.startsWith('project:') ? target.slice(8) : '';
    try {
      const raw = await invoke(JSON.stringify({
        sources: chunk.map(session => ({ sourceScopeType: 'student', sourceScopeId: studentId, assetId: session.conversationReceipt!.assetId })),
        ...(action === 'deliver' ? { targetType: projectId ? 'project' : 'student', targetId: projectId || studentId }
          : { action, confirmPermanentDelete: action === 'delete' }),
      }));
      if (!raw) throw new Error('当前环境不支持批量会话操作。');
      const result = JSON.parse(raw);
      const receipts = new Set<string>((Array.isArray(result.results) ? result.results : [])
        .filter((item: { ok?: boolean }) => action === 'deliver' ? item.ok !== false : item.ok === true)
        .map((item: { assetId: string }) => item.assetId));
      succeeded.push(...chunk.filter(session => receipts.has(session.conversationReceipt!.assetId!)).map(session => session.sessionId));
      if (chunk.some(session => !receipts.has(session.conversationReceipt!.assetId!))) {
        const details = (result.results || []).filter((item: { ok?: boolean }) => item.ok === false)
          .map((item: { message?: string }) => item.message).filter(Boolean);
        errors.push(...(details.length ? details : [result.message || '部分记录未完成，请刷新后重试。']));
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : '操作中断，请刷新记录后重试。');
      stopped = true;
      break;
    }
    onProgress?.(Math.min(offset + 20, eligible.length), eligible.length);
  }
  return { succeeded, skipped: sessions.length - eligible.length, remaining: eligible.length - succeeded.length, errors: [...new Set(errors)], stopped };
}
