import React, { useEffect, useMemo, useState } from 'react';

type RequestFn = (route: string, options?: RequestInit) => Promise<Response>;
type Asset = { assetId: string; assetRevisionId: string; sha256: string; bytes: number; mimeType: string; createdAt: number };
type Course = { courseId: string; title: string; locale: string; provider: string; launchUrl: string; coverAssetRevisionId: string; offlineOpenTtlSeconds: number; updatedAt: number;
  summary?: string; allowedHosts?: string[]; gradeBands?: string[]; ageRange?: string; legalNotice?: string; accountRequirement?: string; [key: string]: unknown };
type Release = { releaseId: string; manifestRevision: string; manifestSha256: string; status: string; createdAt: number; effectiveAt: number; activatedAt?: number | null; previousRevision: string; containsRevokedCourse?: boolean };
type Candidate = { releaseId: string; status: string; manifestSha256: string; manifest: { manifestRevision: string; courses: Course[]; issuedAt: string; expiresAt: string } };
type ActiveManifest = { releaseId: string; manifestRevision: string; issuedAt: string; courses: Course[]; tombstones: Array<{ courseId: string; reasonCode: string; withdrawnAt: string }> };
type ReleaseDetail = Release & { manifest: ActiveManifest & { expiresAt: string } };
type PreviewCourse = { course: Course; sourceRevision: string; releaseCourses: Course[] };
type Operations = { generatedAt: number; receiptAttestation: string; summary: { total: number; reconciled: number; auto_refresh: number; auto_retry: number; needs_handling: number };
  delivery: Array<{ action: string; status: string; requestCount: number; byteCount: number }>;
  alerts: Array<{ severity: string; code: string; message: string }> };

const locales = ['zh-CN', 'zh-TW', 'en-US', 'en-GB', 'fr', 'es', 'es-419', 'ja', 'ko', 'vi', 'ms'];
const initialCourse = {
  courseId: '', locale: 'en-US', title: '', summary: '', provider: '', launchUrl: '', allowedHosts: '', coverAssetRevisionId: '',
  gradeBands: '', ageRange: '', legalNotice: '', accountRequirement: '', offlineOpenTtlSeconds: '21600',
};

function createReleaseId(now = new Date()) {
  const two = (value: number) => String(value).padStart(2, '0');
  const date = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}`;
  const time = `${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  return `release:course-${date}-${time}`;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.map(String).join(', ') : String(value || '');
}

function publishedCourseToDraft(course: Course) {
  return {
    courseId: course.courseId,
    locale: course.locale,
    title: course.title,
    summary: String(course.summary || ''),
    provider: course.provider,
    launchUrl: course.launchUrl,
    allowedHosts: stringList(course.allowedHosts),
    coverAssetRevisionId: course.coverAssetRevisionId,
    gradeBands: stringList(course.gradeBands),
    ageRange: String(course.ageRange || ''),
    legalNotice: String(course.legalNotice || ''),
    accountRequirement: String(course.accountRequirement || ''),
    offlineOpenTtlSeconds: String(course.offlineOpenTtlSeconds ?? 21600),
  };
}

function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('封面文件读取失败。'));
    reader.onload = () => resolve(String(reader.result || '').split(',', 2)[1] || '');
    reader.readAsDataURL(file);
  });
}

export function PublicContentPanel({ request, busy, execute, setMessage }: {
  request: RequestFn; busy: boolean; execute: (task: () => Promise<void>) => Promise<void>; setMessage: (value: string) => void;
}) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [releases, setReleases] = useState<Release[]>([]);
  const [active, setActive] = useState<ActiveManifest | null>(null);
  const [operations, setOperations] = useState<Operations | null>(null);
  const [assetId, setAssetId] = useState('asset:course-cover');
  const [assetFile, setAssetFile] = useState<File | null>(null);
  const [course, setCourse] = useState(initialCourse);
  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);
  const [releaseId, setReleaseId] = useState(createReleaseId);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [confirmHash, setConfirmHash] = useState('');
  const [previewCourse, setPreviewCourse] = useState<PreviewCourse | null>(null);
  const [releasePreview, setReleasePreview] = useState<ReleaseDetail | null>(null);
  const [editorSource, setEditorSource] = useState('');
  const [withdrawCourseId, setWithdrawCourseId] = useState('');
  const [withdrawReleaseId, setWithdrawReleaseId] = useState('');
  const [withdrawReason, setWithdrawReason] = useState('content_risk');

  async function refresh() {
    const [assetResult, courseResult, releaseResult, operationsResult] = await Promise.all([
      request('/v2/admin/content/assets').then(response => response.json()),
      request('/v2/admin/courses').then(response => response.json()),
      request('/v2/admin/releases').then(response => response.json()),
      request('/v2/admin/public-content/operations?windowHours=24').then(response => response.json()),
    ]);
    setAssets(assetResult.assets || []); setCourses(courseResult.courses || []); setReleases(releaseResult.releases || []); setOperations(operationsResult);
    setSelectedCourses(current => current.filter(id => (courseResult.courses || []).some((item: Course) => item.courseId === id)));
    const manifest = (releaseResult.releases || []).some((item: Release) => item.status === 'active')
      ? await request('/v2/public-content/manifest').then(response => response.json()).catch(() => null)
      : null;
    setActive(manifest);
  }
  useEffect(() => { void execute(refresh); }, []);

  const selectedAsset = assets.find(item => item.assetRevisionId === course.coverAssetRevisionId);
  const canPublish = Boolean(candidate && confirmHash.trim().toLowerCase() === candidate.manifestSha256.toLowerCase());
  const activeCourseIds = useMemo(() => active?.courses?.map(item => item.courseId) || [], [active]);
  const activeIssuedAt = Date.parse(active?.issuedAt || '');
  const draftUpdatedAt = useMemo(() => new Map(courses.map(item => [item.courseId, Number(item.updatedAt || 0)])), [courses]);

  function clearCandidate() {
    setCandidate(null);
    setConfirmHash('');
  }

  function prepareRevision(releaseCourses: Course[] = active?.courses || []) {
    setSelectedCourses(releaseCourses.map(item => item.courseId));
    setReleaseId(createReleaseId());
    clearCandidate();
  }

  function editPublishedCourse(item: Course, sourceRevision: string, releaseCourses: Course[]) {
    setCourse(publishedCourseToDraft(item));
    setEditorSource(`基于已发布修订 ${sourceRevision} 编辑；保存后只更新草稿，不会直接改变线上课程。`);
    prepareRevision(releaseCourses);
    setPreviewCourse(null);
    setReleasePreview(null);
    requestAnimationFrame(() => document.getElementById('course-draft-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  async function previewPublishedRelease(item: Release) {
    const response = await request(`/v2/public-content/releases/${item.manifestRevision}`);
    if (!response.ok) throw new Error(`发布版本读取失败：HTTP ${response.status}`);
    const detail = await response.json();
    if (!detail.manifest || !Array.isArray(detail.manifest.courses)) throw new Error('发布版本缺少不可变课程快照。');
    setReleasePreview(detail);
  }

  async function uploadAsset() {
    if (!assetFile) throw new Error('请选择PNG、JPEG或WebP封面。');
    if (assetFile.size <= 0 || assetFile.size > 5 * 1024 * 1024) throw new Error('封面必须大于0且不超过5MB。');
    const mimeType = assetFile.type === 'image/jpg' ? 'image/jpeg' : assetFile.type;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) throw new Error('封面只支持PNG、JPEG或WebP。');
    const result = await (await request('/v2/admin/content/assets', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetId: assetId.trim(), mimeType, contentBase64: await fileBase64(assetFile) }) })).json();
    setCourse(current => ({ ...current, coverAssetRevisionId: result.assetRevisionId }));
    setAssetFile(null); setMessage(`封面已登记：${result.assetRevisionId}`); await refresh();
  }

  async function saveCourse() {
    const payload = {
      ...course, allowedHosts: course.allowedHosts.split(/[,\s]+/).filter(Boolean), gradeBands: course.gradeBands.split(/[,，\s]+/).filter(Boolean),
      offlineOpenTtlSeconds: Number(course.offlineOpenTtlSeconds), defaultEnabled: true,
      minClientVersions: { windowsHost: '0.23.4', windowsStudent: '0.18.7', androidStudent: '0.6.27', androidStandalone: '1.3.5' },
    };
    await request('/v2/admin/courses', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    setSelectedCourses(current => [...new Set([...current, course.courseId])]);
    setMessage(`课程修改已保存为草稿：${course.courseId}。当前已发布版本保持不变，请用新的发布ID校验后再发布。`); clearCandidate(); await refresh();
  }

  async function validateCandidate() {
    if (!selectedCourses.length) throw new Error('至少选择一门课程。');
    const result = await (await request('/v2/admin/releases/validate', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ releaseId: releaseId.trim(), courseIds: selectedCourses, audienceKey: 'global', audienceRevision: 'audience-global-v1', selectionReason: 'stable-public-course-release',
        minClientVersions: { windowsHost: '0.23.4', windowsStudent: '0.18.7', androidStudent: '0.6.27', androidStandalone: '1.3.5' } }) })).json();
    setCandidate(result); setConfirmHash(''); setMessage('候选清单已冻结。请逐项核对并完整输入候选SHA-256后发布。'); await refresh();
  }

  async function publishCandidate() {
    if (!candidate || !canPublish) throw new Error('完整候选SHA-256尚未确认。');
    if (!window.confirm(`确认发布 ${candidate.releaseId}？\n\n课程 ${candidate.manifest.courses.length} 门\n修订 ${candidate.manifest.manifestRevision}\n此操作会替换当前公共清单。`)) return;
    const result = await (await request('/v2/admin/releases/publish', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ releaseId: candidate.releaseId, expectedManifestSha256: candidate.manifestSha256 }) })).json();
    setMessage(`公共课程已生效：${result.manifestRevision}`); clearCandidate(); setEditorSource(''); await refresh();
  }

  async function rollback(item: Release) {
    const rollbackId = window.prompt('输入新的回滚发布ID（用于幂等与审计）', `release:rollback-${Date.now()}`)?.trim();
    if (!rollbackId || !window.confirm(`将以新发布单回滚到 ${item.manifestRevision}？历史发布记录不会删除。`)) return;
    const result = await (await request('/v2/admin/releases/rollback', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ releaseId: rollbackId, targetManifestRevision: item.manifestRevision, expectedTargetManifestSha256: item.manifestSha256 }) })).json();
    setMessage(`回滚清单已生效：${result.manifestRevision}`); await refresh();
  }

  async function withdraw() {
    if (!activeCourseIds.includes(withdrawCourseId)) throw new Error('请选择当前生效课程。');
    if (!withdrawReleaseId.trim()) throw new Error('撤回发布ID不能为空。');
    if (!window.confirm(`紧急撤回 ${withdrawCourseId}？\n\n系统将立即生成签名墓碑与替代清单。`)) return;
    const result = await (await request('/v2/admin/releases/emergency-withdraw', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ releaseId: withdrawReleaseId.trim(), courseId: withdrawCourseId, reasonCode: withdrawReason.trim(), severity: 'high', replacementCourseId: '' }) })).json();
    setMessage(`紧急撤回已生效：${result.revocationRevision}`); setWithdrawCourseId(''); setWithdrawReleaseId(''); await refresh();
  }

  return <main className="public-content-page">
    <div className="public-content-heading"><div><p className="eyebrow">公共内容域 · 单管理员MVP</p><h2>精品课程发布管理</h2>
      <p>公共课程与学生私有文档分表、分目录、分接口。发布必须经过校验、候选哈希确认和二次确认。</p></div>
      <button className="outline" disabled={busy} onClick={() => void execute(refresh)}>刷新全部状态</button></div>

    <section className="release-status"><div><span>当前生效修订</span><strong>{active?.manifestRevision || '尚无生效清单'}</strong></div>
      <div><span>当前课程</span><strong>{active?.courses?.length || 0} 门</strong></div><div><span>历史发布单</span><strong>{releases.length}</strong></div></section>

    <section className="content-card published-library"><div className="published-library-heading"><div><div className="step-label">当前已发布课程</div>
      <h3>预览与修订</h3><p>已发布清单保持不可变。编辑操作会载入一个新草稿，重新校验和确认SHA-256后才会替换线上版本。</p></div>
      <button className="outline" disabled={busy || !active?.courses?.length} onClick={() => prepareRevision()}>以当前版本创建修订</button></div>
      {active?.courses?.length ? <div className="published-course-grid">{active.courses.map(item => {
        const hasPendingDraft = Number(draftUpdatedAt.get(item.courseId) || 0) > activeIssuedAt;
        return <article key={item.courseId}><div className="published-course-state"><span>线上生效</span>{hasPendingDraft && <em>有待发布草稿</em>}</div>
          <h4>{item.title}</h4><p>{item.summary || '暂无课程简介'}</p><small>{item.courseId} · {item.locale} · {item.provider}</small>
          <div className="published-course-actions"><button className="outline" onClick={() => setPreviewCourse({ course: item, sourceRevision: active.manifestRevision, releaseCourses: active.courses })}>预览课程</button>
            <button onClick={() => editPublishedCourse(item, active.manifestRevision, active.courses)}>编辑并创建修订</button></div></article>;
      })}</div> : <p className="empty-compact">尚无已发布课程。</p>}
    </section>

    <section className="operations-card"><div><div className="step-label">同步与失败对账 · 最近24小时</div><h3>客户端回执与交付状态</h3>
      <p>回执只保存客户端随机标识的哈希，不含学生信息；当前为未认证遥测，不能替代真机验收。</p></div>
      <div className="operations-counts"><span>回执<strong>{operations?.summary.total || 0}</strong></span><span>已对账<strong>{operations?.summary.reconciled || 0}</strong></span>
        <span>自动刷新/重试<strong>{(operations?.summary.auto_refresh || 0) + (operations?.summary.auto_retry || 0)}</strong></span>
        <span className={(operations?.summary.needs_handling || 0) ? 'attention' : ''}>需要处理<strong>{operations?.summary.needs_handling || 0}</strong></span></div>
      {!!operations?.alerts?.length && <div className="operations-alerts">{operations.alerts.map(item => <p key={item.code} data-severity={item.severity}>{item.message}</p>)}</div>}
      <small>交付请求 {operations?.delivery.reduce((sum, item) => sum + Number(item.requestCount || 0), 0) || 0} 次
        {operations?.generatedAt ? ` · 更新于 ${new Date(operations.generatedAt).toLocaleString('zh-CN')}` : ''}</small>
    </section>

    <div className="content-grid">
      <section className="content-card"><div className="step-label">01 · 资源</div><h3>上传课程封面</h3><p>服务端会复核文件魔数、5MB上限和SHA-256。</p>
        <label>资源ID<input value={assetId} onChange={event => setAssetId(event.target.value)} /></label>
        <label>封面文件<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => setAssetFile(event.target.files?.[0] || null)} /></label>
        <button disabled={busy || !assetFile} onClick={() => void execute(uploadAsset)}>上传并登记资源</button>
        <div className="compact-list">{assets.slice(0, 6).map(item => <button key={item.assetRevisionId} className={course.coverAssetRevisionId === item.assetRevisionId ? 'selected' : ''}
          onClick={() => setCourse(current => ({ ...current, coverAssetRevisionId: item.assetRevisionId }))}><strong>{item.assetId}</strong><small>{item.mimeType} · {Math.ceil(item.bytes / 1024)}KB<br />{item.assetRevisionId.slice(-12)}</small></button>)}</div>
      </section>

      <section className="content-card course-editor" id="course-draft-editor"><div className="step-label">02 · 草稿</div><h3>课程信息与质量校验</h3>
        {editorSource && <p className="revision-notice">{editorSource}</p>}
        <div className="form-grid"><label>稳定课程ID<input value={course.courseId} placeholder="platform:course-id" readOnly={Boolean(editorSource)} title={editorSource ? '已发布课程修订必须保留稳定课程ID' : ''} onChange={event => setCourse({ ...course, courseId: event.target.value })} /></label>
          <label>语言<select value={course.locale} onChange={event => setCourse({ ...course, locale: event.target.value })}>{locales.map(value => <option key={value}>{value}</option>)}</select></label>
          <label>课程标题<input value={course.title} onChange={event => setCourse({ ...course, title: event.target.value })} /></label>
          <label>提供方<input value={course.provider} onChange={event => setCourse({ ...course, provider: event.target.value })} /></label>
          <label className="wide">HTTPS入口<input value={course.launchUrl} placeholder="https://example.com/course" onChange={event => setCourse({ ...course, launchUrl: event.target.value })} /></label>
          <label>允许域名<input value={course.allowedHosts} placeholder="example.com" onChange={event => setCourse({ ...course, allowedHosts: event.target.value })} /></label>
          <label>年级<input value={course.gradeBands} placeholder="K, 1, 2" onChange={event => setCourse({ ...course, gradeBands: event.target.value })} /></label>
          <label>离线租约（秒）<input type="number" min="0" max="21600" value={course.offlineOpenTtlSeconds} onChange={event => setCourse({ ...course, offlineOpenTtlSeconds: event.target.value })} /></label>
          <label>年龄范围<input value={course.ageRange} onChange={event => setCourse({ ...course, ageRange: event.target.value })} /></label>
          <label className="wide">课程简介<textarea value={course.summary} onChange={event => setCourse({ ...course, summary: event.target.value })} /></label>
          <label className="wide">法律说明<textarea value={course.legalNotice} onChange={event => setCourse({ ...course, legalNotice: event.target.value })} /></label>
          <label className="wide">账号要求<input value={course.accountRequirement} onChange={event => setCourse({ ...course, accountRequirement: event.target.value })} /></label></div>
        <p className="asset-reference">封面：{selectedAsset ? `${selectedAsset.assetId} · ${selectedAsset.assetRevisionId}` : '尚未选择已登记资源'}</p>
        <button disabled={busy || !course.coverAssetRevisionId} onClick={() => void execute(saveCourse)}>保存课程草稿</button>
      </section>
    </div>

    <section className="content-card release-builder"><div className="step-label">03 · 校验与发布</div><h3>构建签名候选</h3>
      <div className="selection-summary"><span>已选择 <strong>{selectedCourses.length}</strong> / {courses.length} 门</span>
        <button className="outline" disabled={!courses.length} onClick={() => { setSelectedCourses(courses.map(item => item.courseId)); clearCandidate(); }}>全选草稿课程</button></div>
      <div className="course-select">{courses.map(item => <label key={item.courseId}><input type="checkbox" checked={selectedCourses.includes(item.courseId)} onChange={event => { setSelectedCourses(current => event.target.checked ? [...new Set([...current, item.courseId])] : current.filter(id => id !== item.courseId)); clearCandidate(); }} />
        <span><strong>{item.title}</strong><small>{item.courseId} · {item.locale} · {item.provider}</small></span></label>)}</div>
      {!courses.length && <p className="empty-compact">请先保存课程草稿。</p>}
      <div className="release-row"><label>唯一发布ID<input value={releaseId} onChange={event => { setReleaseId(event.target.value); clearCandidate(); }} /></label>
        <button disabled={busy || !selectedCourses.length} onClick={() => void execute(validateCandidate)}>校验并冻结候选</button></div>
      {candidate && <div className="candidate-box"><div><span>候选修订</span><strong>{candidate.manifest.manifestRevision}</strong></div><div><span>课程与有效期</span><strong>{candidate.manifest.courses.length}门 · 至 {new Date(candidate.manifest.expiresAt).toLocaleString('zh-CN')}</strong></div>
        <label>候选SHA-256（完整输入以确认）<code>{candidate.manifestSha256}</code><input value={confirmHash} onChange={event => setConfirmHash(event.target.value)} placeholder="粘贴上方完整64位哈希" /></label>
        <button className="publish-button" disabled={busy || !canPublish} onClick={() => void execute(publishCandidate)}>二次确认并原子发布</button></div>}
    </section>

    <div className="content-grid lower-grid"><section className="content-card"><div className="step-label danger-text">紧急操作</div><h3>签名撤回</h3><p>仅用于当前生效课程。客户端将在下一次刷新时停止打开，并保留审计墓碑。</p>
      <label>当前课程<select value={withdrawCourseId} onChange={event => setWithdrawCourseId(event.target.value)}><option value="">请选择</option>{activeCourseIds.map(id => <option key={id}>{id}</option>)}</select></label>
      <label>撤回发布ID<input value={withdrawReleaseId} placeholder="release:withdraw-unique-id" onChange={event => setWithdrawReleaseId(event.target.value)} /></label>
      <label>原因代码<input value={withdrawReason} onChange={event => setWithdrawReason(event.target.value)} /></label>
      <button className="danger-button" disabled={busy || !withdrawCourseId} onClick={() => void execute(withdraw)}>紧急撤回课程</button>
    </section>
    <section className="content-card"><div className="step-label">发布历史</div><h3>预览、回滚与审计定位</h3><div className="release-list">{releases.map(item => <article key={item.releaseId}><div><strong>{item.releaseId}</strong><small>{item.status} · {item.manifestRevision}<br />SHA {item.manifestSha256.slice(0, 16)}…</small></div>
      <div className="release-actions"><button className="outline" disabled={busy} onClick={() => void execute(() => previewPublishedRelease(item))}>预览版本</button>
        <button className="outline" disabled={busy || item.status === 'active' || item.containsRevokedCourse} onClick={() => void execute(() => rollback(item))}>
          {item.containsRevokedCourse ? '包含已撤回课程，不可回滚' : '以新发布单回滚到此版本'}</button></div></article>)}</div></section></div>

    {previewCourse && <div className="course-preview-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) setPreviewCourse(null); }}>
      <section className="course-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="course-preview-title"><button className="dialog-close" aria-label="关闭课程预览" onClick={() => setPreviewCourse(null)}>×</button>
        <div className="step-label">已发布课程预览</div><h3 id="course-preview-title">{previewCourse.course.title}</h3><p className="preview-summary">{previewCourse.course.summary || '暂无课程简介'}</p>
        <dl><div><dt>稳定课程ID</dt><dd>{previewCourse.course.courseId}</dd></div><div><dt>来源修订</dt><dd>{previewCourse.sourceRevision}</dd></div>
          <div><dt>语言 / 提供方</dt><dd>{previewCourse.course.locale} / {previewCourse.course.provider}</dd></div><div><dt>年级 / 年龄</dt><dd>{stringList(previewCourse.course.gradeBands) || '未设置'} / {previewCourse.course.ageRange || '未设置'}</dd></div>
          <div><dt>允许域名</dt><dd>{stringList(previewCourse.course.allowedHosts) || '未设置'}</dd></div><div><dt>离线租约</dt><dd>{previewCourse.course.offlineOpenTtlSeconds} 秒</dd></div>
          <div className="wide"><dt>账号要求</dt><dd>{previewCourse.course.accountRequirement || '无'}</dd></div><div className="wide"><dt>法律说明</dt><dd>{previewCourse.course.legalNotice || '未设置'}</dd></div></dl>
        <div className="dialog-actions"><a className="outline" href={previewCourse.course.launchUrl} target="_blank" rel="noreferrer noopener nofollow">打开课程入口</a>
          <button onClick={() => editPublishedCourse(previewCourse.course, previewCourse.sourceRevision, previewCourse.releaseCourses)}>载入编辑并创建修订</button></div>
      </section></div>}

    {releasePreview && <div className="course-preview-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) setReleasePreview(null); }}>
      <section className="course-preview-dialog release-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="release-preview-title"><button className="dialog-close" aria-label="关闭版本预览" onClick={() => setReleasePreview(null)}>×</button>
        <div className="step-label">不可变发布快照</div><h3 id="release-preview-title">{releasePreview.releaseId}</h3><p className="preview-summary">{releasePreview.status} · {releasePreview.manifestRevision} · {releasePreview.manifest.courses.length} 门课程</p>
        <div className="release-preview-courses">{releasePreview.manifest.courses.map(item => <article key={item.courseId}><div><strong>{item.title}</strong><small>{item.courseId} · {item.locale} · {item.provider}</small></div>
          <div><button className="outline" onClick={() => { setReleasePreview(null); setPreviewCourse({ course: item, sourceRevision: releasePreview.manifestRevision, releaseCourses: releasePreview.manifest.courses }); }}>查看详情</button>
            <button onClick={() => editPublishedCourse(item, releasePreview.manifestRevision, releasePreview.manifest.courses)}>载入编辑</button></div></article>)}</div>
      </section></div>}
  </main>;
}
