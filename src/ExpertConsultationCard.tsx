import React from 'react';
import { ArrowRight, BriefcaseBusiness } from 'lucide-react';
import './learning-workbench.css';

export type ExpertConsultationSource = 'windows_home' | 'windows_report';

export function ExpertConsultationCard({ sourcePage, onAuthorize, className = '' }: {
  sourcePage: ExpertConsultationSource;
  onAuthorize: () => void;
  className?: string;
}) {
  return <section className={`panel workbench-expert expert-consultation-card ${className}`.trim()} data-expert-source={sourcePage}>
    <BriefcaseBusiness size={24} aria-hidden="true" />
    <div>
      <span className="eyebrow">真人专家</span>
      <h2>请求真人专家解读咨询</h2>
      <p>先核对准备上传的学情范围。点击本身不会上传、创建咨询单或改变授权。</p>
      <button className="primary" type="button" onClick={onAuthorize} aria-label="授权上传学情资料，进入范围预览">
        授权上传学情资料<ArrowRight size={18} aria-hidden="true" />
      </button>
    </div>
  </section>;
}
