'use strict';
const { hasCapability } = require('./license-entitlements.cjs');
const { courseContentHash } = require('./course-publications.cjs');
function createPublicationCenter({ courses, cards, students, license }) {
  return {
    async execute(id, action, input = {}) {
      if (!hasCapability(license(), 'tenant_course_manage')) throw Error('当前授权没有发布管理权限');
      const people = await students();
      if (!people.some(s => String(s.id) === String(id))) throw Error('请选择一名有效的当前学生');
      const courseStore = courses(), cardStore = cards();
      if (action === 'list') {
        const managed = await cardStore.drafts(id), catalog = courseStore.combinedCatalog();
        const records = courseStore.publications.records(), byId = new Map(records.map(r => [r.resourceId, r]));
        const courseItems = (catalog?.courses || []).map(c => { const record = byId.get(c.courseId); return {
          kind: 'course', id: c.courseId, title: c.name, subject: c.subjects?.join('、') || '', status: record?.status || 'legacy', version: record?.version || 0,
          audience: record?.audience || null, updatedAt: record?.publishedAt, expectedContentHash:courseContentHash(c), courseType:c.type,
        }; });
        const cardDraftItems = managed.items.map(r => ({
          kind: 'card', entryType: 'draft', id: r.id, title: r.title || '未命名卡片草稿', subject: r.scope === 'platform' ? '平台卡片草稿' : r.scope === 'personal' ? '我的卡片草稿' : '机构卡片草稿',
          status: 'draft', version: r.version, revision: r.revision, scope: r.scope, audience: null, updatedAt: r.updatedAt,
        }));
        const cardItems = managed.published.map(r => ({ ...r, kind: 'card', entryType: 'resource', id: r.key, title: r.title, status: r.scope === 'personal' ? 'personal' : r.status }));
        const cardSummary = { personal: [...cardDraftItems,...cardItems].filter(r=>r.scope==='personal').length, shared: [...cardDraftItems,...cardItems].filter(r=>r.scope!=='personal').length };
        const priority = { draft: 0, personal: 1, published: 2, withdrawn: 3, legacy: 4 };
        const allItems = [...courseItems, ...cardDraftItems, ...cardItems].sort((a, b) =>
          (priority[a.status] ?? 9) - (priority[b.status] ?? 9)
          || String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
          || String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN'));
        const counts = allItems.reduce((value, item) => { value[item.kind]++; return value; }, { course: 0, card: 0 });
        let items = allItems;
        if (input.kind && input.kind !== 'all') items = items.filter(r => r.kind === input.kind);
        if (input.status && input.status !== 'all') items = items.filter(r => r.status === input.status);
        if (input.search) items = items.filter(r => r.title.toLowerCase().includes(String(input.search).toLowerCase()));
        const page = Math.max(1, Math.floor(Number(input.page) || 1));
        return { items: items.slice((page - 1) * 20, page * 20), total: items.length, counts, cardSummary, capabilities:managed.capabilities, page, pageSize: 20, currentStudentId: String(id), students: people.map(s => ({ id: String(s.id), name: s.name, grade: s.grade || '' })) };
      }
      if (input.kind === 'course') {
        const source = courseStore.combinedCatalog()?.courses.find(c => c.courseId === input.id);
        if (!source) throw Error('课程不存在，请刷新目录');
        if (action === 'publish') return courseStore.publications.publish(source, input, people, id);
        if (action === 'assign') return courseStore.publications.assign(input.id, input.audience, people, id);
        if (action === 'withdraw') return courseStore.publications.withdraw(input.id);
      } else if (input.kind === 'card') {
        if (action === 'prepareSharedDraft') return cardStore.prepareSharedDraft(id, input);
        if (action === 'publish') return cardStore.publish(id, input.id, {...input,sharedOnly:true});
        if (action === 'assign') return cardStore.assign(id, input.id, input.audience);
        if (action === 'withdraw') return cardStore.withdraw(id, input.id);
      }
      throw Error('不支持的发布操作');
    },
  };
}
module.exports = { createPublicationCenter };
