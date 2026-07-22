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
  advancedActions?: ReactNode;
};

const labels: Record<DigestUserStatus, string> = {
  pending: '待处理',
  processing: '处理中',
  waiting_result: '等待 Agent 回执',
  partial: '部分完成',
  completed: '已完成',
  needs_help: '需要帮助',
};

export function DigestStatusCard({ status, busy, manualText = '', onManualTextChange, onStart, onRetry, onCheck, onPaste, onOpenKnowledge, advancedActions }: Props) {
  const primary = status.userStatus === 'partial' || status.userStatus === 'needs_help'
    ? { label: '重试未完成项', action: onRetry, disabled: !status.canRetry }
    : status.userStatus === 'completed'
      ? { label: '查看新增知识', action: onOpenKnowledge, disabled: !onOpenKnowledge }
      : status.userStatus === 'processing'
        ? { label: '正在处理…', action: undefined, disabled: true }
        : status.userStatus === 'waiting_result'
          ? { label: '检查 Agent 回执', action: onCheck, disabled: !onCheck }
        : { label: '开始处理', action: onStart, disabled: !status.canStart };
  return (
    <section className={`digest-status-card is-${status.userStatus}`}>
      <div className="digest-status-main">
        <span className="digest-status-badge">{labels[status.userStatus] || status.label || '待处理'}</span>
        <div>
          <strong>{status.scopeName || '资料消化'}</strong>
          <p>{status.message || (status.userStatus === 'pending' ? `有 ${status.pendingCount || 0} 项资料等待处理。` : '系统正在更新资料处理状态。')}</p>
          <small>待处理 {status.pendingCount || 0} 项 · 已完成 {status.processedCount || 0} 项{status.lastDigestAt ? ` · 最近完成 ${new Date(status.lastDigestAt).toLocaleString('zh-CN')}` : ''}</small>
        </div>
        <button className="primary compact" onClick={primary.action} disabled={busy || primary.disabled}>{busy ? '正在准备…' : primary.label}</button>
      </div>
      {status.manualRequired && (
        <div className="digest-manual-result">
          <strong>Agent 已采用人工模式</strong>
          <p>任务指令已自动复制。执行后，把 Agent 返回的 JSON 或包含 JSON 的回复粘贴到这里。</p>
          <textarea value={manualText} onChange={(event) => onManualTextChange?.(event.target.value)} rows={7} placeholder="粘贴 Agent 返回结果" />
          <button className="primary compact" onClick={onPaste} disabled={!manualText.trim() || busy}>导入结果</button>
        </div>
      )}
      {advancedActions && <details className="digest-advanced"><summary>高级与诊断</summary><div className="actions compact-actions">{advancedActions}</div><small>仅在自动处理不可用或需要排查时使用。</small></details>}
    </section>
  );
}
