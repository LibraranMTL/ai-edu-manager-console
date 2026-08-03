const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { normalizeCourseItem, relatedCourseHosts } = require('./course-catalog.cjs');
const { readJson, writeJsonAtomic } = require('./course-catalog-store.cjs');
const { inspectCustomCourseImage } = require('./course-custom-import.cjs');

const PLATFORM_DRAFT_SCHEMA = 'edu-manager.platform-course-drafts.v1';
const PLATFORM_RIGHTS_STATUS = new Set(['pending', 'confirmed', 'expired']);

function uniqueTextList(input, maxItems = 30, maxLength = 120) {
  return [...new Set((Array.isArray(input) ? input : String(input || '').split(/[，,\n]/))
    .map((item) => String(item || '').trim().slice(0, maxLength))
    .filter(Boolean))].slice(0, maxItems);
}

function slugFor(input, fallbackSeed) {
  const slug = String(input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (slug.length >= 3) return slug;
  return `course-${crypto.createHash('sha256').update(String(fallbackSeed || input || Date.now())).digest('hex').slice(0, 20)}`;
}

function createPlatformCourseDraftStore(options = {}) {
  const root = path.join(path.resolve(options.userDataDir), 'platform-course-authoring');
  const draftsPath = path.join(root, 'drafts.json');
  const assetsDir = path.join(root, 'assets');
  const auditPath = path.join(root, 'audit.json');
  const now = () => (typeof options.now === 'function' ? options.now() : new Date().toISOString());

  function readStore() {
    const parsed = readJson(draftsPath, {});
    return {
      schema: PLATFORM_DRAFT_SCHEMA,
      updatedAt: String(parsed?.updatedAt || ''),
      drafts: Array.isArray(parsed?.drafts) ? parsed.drafts : [],
      deletions: Array.isArray(parsed?.deletions) ? parsed.deletions : [],
    };
  }

  function audit(entry) {
    const current = readJson(auditPath, { schema: 'edu-manager.platform-course-authoring-audit.v1', entries: [] });
    current.updatedAt = now();
    current.entries = [{ at: current.updatedAt, ...entry }, ...(Array.isArray(current.entries) ? current.entries : [])].slice(0, 500);
    writeJsonAtomic(auditPath, current);
  }

  async function copyImage(imagePath) {
    const inspected = await inspectCustomCourseImage(imagePath);
    const buffer = fs.readFileSync(imagePath);
    const digest = crypto.createHash('sha256').update(buffer).digest('hex');
    const filename = `${digest}${inspected.extension}`;
    fs.mkdirSync(assetsDir, { recursive: true });
    const target = path.join(assetsDir, filename);
    if (!fs.existsSync(target)) {
      const temporary = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, buffer);
      fs.renameSync(temporary, target);
    }
    return `platform-draft-assets/${filename}`;
  }

  function assetPath(assetName) {
    const normalized = String(assetName || '').replace(/\\/g, '/');
    if (!/^platform-draft-assets\/[a-f0-9]{64}\.(png|jpg|jpeg|webp)$/i.test(normalized)) return '';
    const candidate = path.resolve(assetsDir, path.basename(normalized));
    const rootPath = path.resolve(assetsDir);
    return candidate.startsWith(`${rootPath}${path.sep}`) && fs.existsSync(candidate) ? candidate : '';
  }

  function validateDraftRecord(record) {
    const issues = [];
    let course = null;
    try {
      course = normalizeCourseItem(record.course);
      if (course.type !== 'platform_standard' || !course.courseId.startsWith('platform:')) {
        issues.push('平台课程必须使用 platform_standard 类型和 platform: ID。');
      }
      if (course.coverAsset.startsWith('platform-draft-assets/') && !assetPath(course.coverAsset)) {
        issues.push('平台课程草稿图片不存在。');
      }
    } catch (error) {
      issues.push(error.message);
    }
    return { ok: issues.length === 0, issues, course };
  }

  function list() {
    return readStore().drafts.map((draft) => ({ ...draft, validation: validateDraftRecord(draft) }));
  }

  async function save(input = {}, context = {}) {
    const store = readStore();
    const requestedId = String(input.courseId || '').trim();
    const existingDraft = requestedId ? store.drafts.find((item) => item.courseId === requestedId) : null;
    const publishedCourse = requestedId
      ? (Array.isArray(context.platformCourses) ? context.platformCourses : []).find((item) => item.courseId === requestedId)
      : null;
    if (requestedId && !existingDraft && !publishedCourse) throw new Error('只能编辑仍然存在的平台课程或草稿。');
    const source = existingDraft?.course || publishedCourse || {};
    const urlText = String(input.url || source.url || '').trim();
    let parsedUrl;
    try {
      parsedUrl = new URL(urlText);
    } catch {
      throw new Error('课程链接不是有效 URL。');
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('课程链接必须使用 HTTP 或 HTTPS。');
    const courseId = requestedId || `platform:${slugFor(input.slug || input.name, `${urlText}\n${input.name || ''}`)}`;
    if ((Array.isArray(context.platformCourses) ? context.platformCourses : []).some((item) => item.courseId === courseId && item.courseId !== requestedId)) {
      throw new Error(`平台课程 ID 已存在：${courseId}`);
    }
    let coverAsset = String(source.coverAsset || '');
    if (context.imagePath) coverAsset = await copyImage(context.imagePath);
    if (!coverAsset) throw new Error('新增平台课程必须上传课程图片。');
    const allowedHosts = uniqueTextList(input.allowedHosts?.length ? input.allowedHosts : relatedCourseHosts(parsedUrl.hostname.toLowerCase()), 20, 253);
    const course = normalizeCourseItem({
      ...source,
      courseId,
      type: 'platform_standard',
      name: input.name,
      provider: input.provider || source.provider || '平台精选课程',
      url: urlText,
      allowedHosts,
      coverAsset,
      summary: input.summary,
      subjects: uniqueTextList(input.subjects || source.subjects || []),
      gradeRange: uniqueTextList(input.gradeRange || source.gradeRange || []),
      languages: uniqueTextList(input.languages || source.languages || [], 20, 20),
      accountRequirement: input.accountRequirement || source.accountRequirement || '账号、会员、收费和年龄要求以课程网站当时说明为准。',
      effectiveAt: input.effectiveAt || source.effectiveAt || now(),
      expiresAt: input.expiresAt || null,
      legalNotice: input.legalNotice || source.legalNotice || '本课程由平台版用户选择并发布。课程内容、图片、链接、商标、账号及服务条款由发布方和课程提供方负责；AI教育管家提供课程访问、分发和用户主动资料采集能力。',
      status: input.status === 'withdrawn' ? 'withdrawn' : 'active',
    });
    const updatedAt = now();
    const record = {
      schema: 'edu-manager.platform-course-draft.v1',
      courseId,
      baseCatalogVersion: String(context.baseCatalogVersion || existingDraft?.baseCatalogVersion || ''),
      draftRevision: Number(existingDraft?.draftRevision || 0) + 1,
      course,
      rights: {
        status: 'confirmed',
        evidenceRef: 'platform-license-authorized',
        note: '',
        reviewedBy: String(context.updatedBy || 'platform-license'),
        reviewedAt: updatedAt,
      },
      createdAt: existingDraft?.createdAt || updatedAt,
      updatedAt,
      updatedBy: String(context.updatedBy || ''),
    };
    const validation = validateDraftRecord(record);
    record.validation = { ok: validation.ok, issues: validation.issues };
    const drafts = store.drafts.filter((item) => item.courseId !== courseId);
    drafts.push(record);
    const deletions = store.deletions.filter((item) => item.courseId !== courseId);
    writeJsonAtomic(draftsPath, { schema: PLATFORM_DRAFT_SCHEMA, updatedAt, drafts, deletions });
    audit({ action: existingDraft || publishedCourse ? 'platform_course_draft_updated' : 'platform_course_draft_created', courseId, draftRevision: record.draftRevision, ok: true });
    return record;
  }

  function remove(courseId, context = {}) {
    const store = readStore();
    const before = store.drafts.length;
    const drafts = store.drafts.filter((item) => item.courseId !== String(courseId || ''));
    if (drafts.length === before) return false;
    writeJsonAtomic(draftsPath, { schema: PLATFORM_DRAFT_SCHEMA, updatedAt: now(), drafts, deletions: store.deletions });
    audit({ action: 'platform_course_draft_removed', courseId: String(courseId || ''), updatedBy: String(context.updatedBy || ''), ok: true });
    return true;
  }

  function listDeletions() {
    return readStore().deletions.map((item) => ({ ...item }));
  }

  function markDeletion(course, context = {}) {
    if (!course || course.type !== 'platform_standard' || !String(course.courseId || '').startsWith('platform:')) {
      throw new Error('只能删除仍然存在的平台精选课程。');
    }
    const store = readStore();
    const updatedAt = now();
    const record = {
      courseId: course.courseId,
      name: String(course.name || ''),
      baseCatalogVersion: String(context.baseCatalogVersion || ''),
      requestedAt: updatedAt,
      requestedBy: String(context.updatedBy || ''),
    };
    const deletions = store.deletions.filter((item) => item.courseId !== course.courseId);
    deletions.push(record);
    const drafts = store.drafts.filter((item) => item.courseId !== course.courseId);
    writeJsonAtomic(draftsPath, { schema: PLATFORM_DRAFT_SCHEMA, updatedAt, drafts, deletions });
    audit({ action: 'platform_course_deletion_queued', courseId: course.courseId, updatedBy: record.requestedBy, ok: true });
    return record;
  }

  function cancelDeletion(courseId, context = {}) {
    const store = readStore();
    const normalizedId = String(courseId || '');
    const deletions = store.deletions.filter((item) => item.courseId !== normalizedId);
    if (deletions.length === store.deletions.length) return false;
    writeJsonAtomic(draftsPath, { schema: PLATFORM_DRAFT_SCHEMA, updatedAt: now(), drafts: store.drafts, deletions });
    audit({ action: 'platform_course_deletion_cancelled', courseId: normalizedId, updatedBy: String(context.updatedBy || ''), ok: true });
    return true;
  }

  return {
    assetPath,
    assetsDir,
    auditPath,
    cancelDeletion,
    draftsPath,
    listDeletions,
    list,
    markDeletion,
    readStore,
    remove,
    save,
    validateDraftRecord,
  };
}

module.exports = {
  PLATFORM_DRAFT_SCHEMA,
  PLATFORM_RIGHTS_STATUS,
  createPlatformCourseDraftStore,
  slugFor,
  uniqueTextList,
};
