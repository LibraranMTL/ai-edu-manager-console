'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizeCourseItem } = require('./course-catalog.cjs');
const { normalizeAudience, audienceAllows } = require('./publication-policy.cjs');
const fingerprint = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const courseContentHash = source => fingerprint(normalizeCourseItem(source));

// One atomic file owns course snapshots, audiences and per-student version pins.
// Signed catalogs remain independently verified by the existing catalog store.
function createCoursePublications(directory) {
  const file = path.join(directory, 'course-publications.json');
  function read() {
    if (!fs.existsSync(file)) return { schema: 'edu-manager.course-publications.v1', records: [], pins: {}, receipts: {} };
    if (fs.lstatSync(file).isSymbolicLink()) throw Error('发布索引不能使用链接');
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value.schema !== 'edu-manager.course-publications.v1' || !Array.isArray(value.records) || !value.pins || !value.receipts) throw Error('课程发布索引损坏，请从备份恢复');
    return value;
  }
  function change(work) {
    const value = read(), result = work(value);
    fs.mkdirSync(directory, { recursive: true });
    if (fs.lstatSync(directory).isSymbolicLink()) throw Error('发布目录不能使用链接');
    if (fs.existsSync(file) && !fs.existsSync(`${file}.before-stage1`)) fs.copyFileSync(file, `${file}.before-stage1`, fs.constants.COPYFILE_EXCL);
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try { fs.writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, file); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return result;
  }
  function current(value, id) { return value.records.filter(r => r.resourceId === id).at(-1); }
  function project(courses, student) {
    const value = read(), result = [];
    for (const source of courses) {
      const latest = current(value, source.courseId);
      if (!latest) { result.push(source); continue; }
      if (!audienceAllows(latest.audience, student)) continue;
      const pin = value.pins[JSON.stringify([String(student.id), source.courseId])];
      const record = pin ? value.records.find(r => r.key === pin) : latest;
      if (!record || (!pin && latest.status !== 'published')) continue;
      result.push({ ...record.content, publicationRef: { key: record.key, version: record.version }, publicationStatus: latest.status });
    }
    return result;
  }
  return {
    records: () => structuredClone(read().records),
    // Register new authored courses before the catalog changes: failures leave
    // them safely unpublished. Existing catalogs retain their legacy policy.
    registerDrafts: courses => change(value => {
      for (const source of courses) if (!current(value, source.courseId)) value.records.push({ resourceId: source.courseId, key: `course:${source.courseId}:0`, version: 0, status: 'draft', content: normalizeCourseItem(source), audience: { type: 'students', studentIds: [], grade: '' } });
    }),
    publish: (source, input, students, currentStudentId) => change(value => {
      const content = normalizeCourseItem(source);
      if (content.status !== 'active') throw Error('已撤回的课程不能发布，请先编辑有效课程');
      const audience = normalizeAudience(input.audience, students, currentStudentId);
      const hash = fingerprint(content), requestHash = fingerprint([content.courseId, hash, audience]);
      if(input.expectedContentHash && input.expectedContentHash!==hash)throw Error('课程内容已变化，请刷新并核对后重新发布');
      const requestId = String(input.requestId || '');
      if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) throw Error('发布事务编号无效');
      const receipt = value.receipts[requestId];
      if (receipt) { if (receipt.requestHash !== requestHash) throw Error('发布编号已用于其他内容'); return { ...receipt.result, duplicate: true }; }
      const previous = current(value, content.courseId);
      if (previous?.status === 'published' && previous.contentHash === hash && JSON.stringify(previous.audience) === JSON.stringify(audience)) return { published: true, key: previous.key, duplicate: true };
      const version = (previous?.version || 0) + 1, key = `course:${content.courseId}:${version}`;
      value.records.push({ resourceId: content.courseId, key, version, status: 'published', content, contentHash: hash, audience, publishedAt: new Date().toISOString() });
      const result = { published: true, key, version };
      value.receipts[requestId] = { requestHash, result };
      return result;
    }),
    assign: (id, input, students, currentStudentId) => change(value => {
      const record = current(value, id); if (!record || record.status === 'draft') throw Error('请先发布课程');
      record.audience = normalizeAudience(input, students, currentStudentId); return { assigned: true };
    }),
    withdraw: id => change(value => { const record = current(value, id); if (!record) throw Error('请先通过统一发布管理发布此课程'); record.status = 'withdrawn'; record.withdrawnAt ||= new Date().toISOString(); return { withdrawn: true }; }),
    project,
    pin: (source, student) => {
      const projected = project([source], student)[0]; if (!projected) throw Error('课程未分配给当前学生或已停止新使用');
      if (!projected.publicationRef) return projected;
      change(value => { value.pins[JSON.stringify([String(student.id), source.courseId])] ||= projected.publicationRef.key; });
      return projected;
    },
  };
}
module.exports = { createCoursePublications, courseContentHash };
