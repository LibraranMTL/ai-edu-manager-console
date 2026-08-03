const crypto = require('crypto');

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function changeSummary(drafts = [], baseCatalog = {}, deletedCourseIds = []) {
  const published = new Map((baseCatalog.courses || []).map((course) => [course.courseId, course]));
  const changes = drafts.map((draft) => ({
    courseId: draft.courseId,
    name: draft.course?.name || '',
    revision: Number(draft.draftRevision || 0),
    action: !published.has(draft.courseId) ? 'added' : draft.course?.status === 'withdrawn' ? 'withdrawn' : 'updated',
    rightsStatus: draft.rights?.status || '',
    validationOk: draft.validation?.ok === true,
  }));
  for (const courseId of deletedCourseIds) {
    const course = published.get(courseId);
    changes.push({ courseId, name: course?.name || '', revision: 0, action: 'deleted', rightsStatus: '', validationOk: true });
  }
  const digest = crypto.createHash('sha256').update(JSON.stringify(stable({ baseCatalogVersion: baseCatalog.catalogVersion || '', changes }))).digest('hex');
  return {
    digest,
    confirmationCode: `PUBLISH-${digest.slice(0, 8).toUpperCase()}`,
    baseCatalogVersion: String(baseCatalog.catalogVersion || ''),
    counts: {
      added: changes.filter((item) => item.action === 'added').length,
      updated: changes.filter((item) => item.action === 'updated').length,
      withdrawn: changes.filter((item) => item.action === 'withdrawn').length,
      deleted: changes.filter((item) => item.action === 'deleted').length,
    },
    changes,
  };
}

function assertPublishApproval(preview, approval = {}) {
  if (!preview?.digest || String(approval.digest || '') !== preview.digest || String(approval.confirmationCode || '') !== preview.confirmationCode) {
    throw new Error('发布确认已过期或与当前草稿不一致，请重新查看变更摘要。');
  }
  return true;
}

module.exports = { assertPublishApproval, changeSummary };
