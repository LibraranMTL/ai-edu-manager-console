import React, { memo } from 'react';
import { AlertTriangle, Download, RefreshCw, TrendingUp } from 'lucide-react';

type WeeklyKnowledgeGrowthCardProps = { model: any; actions: any };

export const WeeklyKnowledgeGrowthCard = memo(function WeeklyKnowledgeGrowthCard({ model: m, actions: a }: WeeklyKnowledgeGrowthCardProps) {
  const snapshot = m.weeklyKnowledgeGrowth;
  const hasStudent = m.assetStudentFilter && m.assetStudentFilter !== 'all';
  return <section className="weekly-knowledge-growth-card" aria-labelledby="weekly-knowledge-growth-title">
    <div className="weekly-knowledge-growth-heading">
      <div><span className="eyebrow">单学生资料统计</span><h3 id="weekly-knowledge-growth-title">本周资料上传</h3><p>统计本周成功写入资产索引的去重文件资料，可用于社群分享和上传奖励。</p></div>
      <TrendingUp size={24} />
    </div>
    {!hasStudent && <div className="empty-state">请选择一名学生查看周图；“全部学生”不会生成或保存图片。</div>}
    {hasStudent && m.weeklyKnowledgeGrowthLoading && !snapshot && <div className="empty-state">正在读取本周资料上传与累计文件资产统计…</div>}
    {hasStudent && snapshot?.ok && <div className="weekly-knowledge-growth-layout">
      <div className="weekly-knowledge-growth-preview">
        <img src={`data:image/png;base64,${snapshot.pngBase64}`} alt={`${snapshot.weekStart} 至 ${snapshot.weekEnd} 资料上传图：累计文件资产 ${snapshot.assetTotal} 项，本周新上传资料 ${snapshot.weeklyUploadedMaterials} 份。`} />
      </div>
      <div className="weekly-knowledge-growth-report-actions">
        <strong>{m.weeklyKnowledgeGrowthStudentName || '当前学生'} · {snapshot.weekStart} 至 {snapshot.weekEnd}</strong>
        {snapshot.undatedAssetCount > 0 && <div className="notice muted"><AlertTriangle size={16} />另有 {snapshot.undatedAssetCount} 份资料上传日期不明，未计入本周趋势。</div>}
        <small>图片已包含完整统计；截至 {snapshot.currentDate || snapshot.asOf.slice(0, 10)} · {snapshot.timezone}。</small>
        <div className="actions compact-actions">
          <button className="secondary compact" type="button" disabled={m.weeklyKnowledgeGrowthLoading || m.weeklyKnowledgeGrowthSaving} onClick={() => void a.refreshWeeklyKnowledgeGrowth()}><RefreshCw size={16} />重新读取</button>
          <button className="primary compact" type="button" disabled={m.weeklyKnowledgeGrowthLoading || m.weeklyKnowledgeGrowthSaving} onClick={() => void a.saveWeeklyKnowledgeGrowth()}><Download size={16} />{m.weeklyKnowledgeGrowthSaving ? '保存窗口已打开…' : '保存 1080×1920 PNG'}</button>
        </div>
      </div>
    </div>}
    {hasStudent && m.weeklyKnowledgeGrowthMessage && <div className="notice">{m.weeklyKnowledgeGrowthMessage}</div>}
  </section>;
});
