import type { ReactNode } from 'react';

export type DigestUserStatus = 'pending' | 'waiting_result' | 'processing' | 'partial' | 'completed' | 'needs_help';

export type DigestWorkflowStatus = {
  ok?: boolean;
  scopeType: 'student' | 'project';
  scopeId: string;
  scopeName?: string;
  userStatus: DigestUserStatus;
  label?: string;
  message?: string;
  pendingCount?: number;
  submittedCount?: number;
  processedCount?: number;
  lastDigestAt?: string;
  taskId?: string;
  taskStatus?: string;
  executionId?: string;
  adapterId?: string;
  executionMode?: string;
  manualRequired?: boolean;
  canStart?: boolean;
  canRetry?: boolean;
  canPaste?: boolean;
  knowledgePath?: string;
  state?: {
    materialPreflight?: {
      checkedAt?: string;
      totalCount?: number;
      readyCount?: number;
      selectedCount?: number;
      repairedCount?: number;
      blockedCount?: number;
      retryableCount?: number;
      deferredCount?: number;
      issues?: Array<{ materialId?: string; fileName?: string; code?: string; label?: string; retryable?: boolean }>;
    };
  };
};

type Props = {
  status: DigestWorkflowStatus;
  busy?: boolean;
  manualText?: string;
  onManualTextChange?: (value: string) => void;
  onStart?: () => void;
  onRetry?: () => void;
  onCheck?: () => void;
  onPaste?: () => void;
  onOpenKnowledge?: () => void;
  onSupplementLearningEvents?: () => void;
  onRetryPathCheck?: () => void;
  onSelectMaterialPath?: (materialId: string) => void;
  onRemoveMaterial?: (materialId: string, fileName?: string) => void;
  advancedActions?: ReactNode;
};

const labels: Record<DigestUserStatus, string> = {
  pending: '待处理',
  processing: '处理中',
  waiting_result: '处理中',
  partial: '部分完成',
  completed: '已完成',
  needs_help: '需要补充',
};

export function DigestStatusCard({ status, busy, manualText = '', onManualTextChange, onStart, onRetry, onCheck, onPaste, onOpenKnowledge, onSupplementLearningEvents, onRetryPathCheck, onSelectMaterialPath, onRemoveMaterial, advancedActions }: Props) {
  const primary = status.userStatus === 'partial' || status.userStatus === 'needs_help'
    ? { label: '重试未完成项', action: onRetry, disabled: !status.canRetry }
    : status.userStatus === 'completed'
      ? { label: '查看新增知识', action: onOpenKnowledge, disabled: !onOpenKnowledge }
      : status.userStatus === 'processing'
        ? { label: '正在处理…', action: undefined, disabled: true }
        : status.userStatus === 'waiting_result'
          ? { label: '刷新处理结果', action: onCheck, disabled: !onCheck }
        : { label: '开始处理', action: onStart, disabled: !status.canStart };
  const preflight = status.state?.materialPreflight;
  return (
    <section className={`digest-status-card is-${status.userStatus}`}>
      <div className="digest-status-main">
        <span className="digest-status-badge">{status.label || labels[status.userStatus] || '待处理'}</span>
        <div>
          <strong>{status.scopeName || '资料消化'}</strong>
          <p>{status.message || (status.userStatus === 'pending' ? `有 ${status.pendingCount || 0} 项资料等待处理。` : '系统正在更新资料处理状态。')}</p>
          <small>待处理 {status.pendingCount || 0} 项 · 已完成 {status.processedCount || 0} 项{status.lastDigestAt ? ` · 最近完成 ${new Date(status.lastDigestAt).toLocaleString('zh-CN')}` : ''}</small>
        </div>
        <button className="primary compact" onClick={primary.action} disabled={busy || primary.disabled}>{busy ? '正在准备…' : primary.label}</button>
      </div>
      {status.userStatus === 'completed' && onSupplementLearningEvents && (
        <div className="digest-learning-event-supplement">
          <span>已有 Agent 在完成后补写学习事件回执？可只校验并补录事件，不重新消化原材料。</span>
          <button className="secondary compact" onClick={onSupplementLearningEvents} disabled={busy}>已完成批次学习事件补录</button>
        </div>
      )}
      {preflight && (Number(preflight.repairedCount || 0) > 0 || Number(preflight.blockedCount || 0) > 0 || Number(preflight.deferredCount || 0) > 0) && (
        <div className="digest-material-preflight">
          <strong>资料路径预检</strong>
          <p>
            共 {preflight.totalCount || 0} 份 · 本批 {preflight.selectedCount || 0} 份 · 自动修复 {preflight.repairedCount || 0} 份
            {Number(preflight.deferredCount || 0) > 0 ? ` · 后续批次 ${preflight.deferredCount} 份` : ''}
            {Number(preflight.blockedCount || 0) > 0 ? ` · 待确认 ${preflight.blockedCount} 份` : ''}
          </p>
          {(preflight.issues || []).slice(0, 12).map((issue) => (
            <div className="digest-material-issue" key={`${issue.materialId || issue.fileName}-${issue.code}`}>
              <span>{issue.fileName || issue.materialId || '未命名资料'}：{issue.label || '路径需要确认'}</span>
              {issue.materialId && !issue.retryable && onSelectMaterialPath && (
                <button className="secondary compact" onClick={() => onSelectMaterialPath(issue.materialId || '')}>手工选择文件</button>
              )}
              {issue.materialId && onRemoveMaterial && (
                <button className="secondary compact danger" onClick={() => onRemoveMaterial(issue.materialId || '', issue.fileName || issue.materialId)}>从待处理列表移除</button>
              )}
            </div>
          ))}
          {onRetryPathCheck && <button className="secondary compact" onClick={onRetryPathCheck} disabled={busy}>重新检查并自动修复</button>}
        </div>
      )}
      {status.manualRequired && (
        <div className="digest-manual-result">
          <strong>自动处理暂不可用</strong>
          <p>处理说明已自动复制。完成外部处理后，把返回内容粘贴到这里，系统会继续完成整理。</p>
          <textarea value={manualText} onChange={(event) => onManualTextChange?.(event.target.value)} rows={7} placeholder="粘贴处理结果" />
          <button className="primary compact" onClick={onPaste} disabled={!manualText.trim() || busy}>导入结果</button>
        </div>
      )}
      {advancedActions && <details className="digest-advanced"><summary>高级与诊断</summary><div className="actions compact-actions">{advancedActions}</div><small>仅在自动处理不可用或需要排查时使用。</small></details>}
    </section>
  );
}
