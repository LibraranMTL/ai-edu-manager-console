'use strict';
const crypto = require('node:crypto');
const path = require('node:path');

// Compatibility entry points select the same immutable intake record and then
// use its versioned decision service. They never copy, archive or register files.
function createLegacyIntakeBridge({ ready, download, capture }) {
  async function sourceFor(engine, kind, folder, studentId) {
    const all = (await engine.sources()).sources;
    let source = all.find(s => !s.detached && (kind === 'download'
      ? s.folder && path.resolve(s.folder).toLowerCase() === path.resolve(folder).toLowerCase()
      : s.type === 'share' && s.studentId === studentId));
    if (!source && kind === 'download') source = await engine.updateSource({ folder, name: '下载文件', studentId: '', enabled: false,
      automatic: false, staging: true, originalMode: 'archive', allHistory: true });
    if (!source) throw Error('分享来源尚未登记或已解除关联');
    return source;
  }
  async function deliver(kind, ids, target, studentId) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 100) throw Error('请选择1至100份资料');
    const engine = await ready(), results = [];
    for (const id of [...new Set(ids)]) {
      try {
        let entry, source;
        if (kind === 'download') {
          entry = await download().selection(id);
          source = await sourceFor(engine, kind, entry.folder);
        } else {
          const rows = await capture().listStored(studentId), row = rows.find(i => i.itemId === id && i.status !== 'trashed');
          if (!row) throw Error('分享资料不存在或已移除');
          await capture().resolveStored(studentId, id);
          source = await sourceFor(engine, kind, '', studentId);
          entry = { locator: id, name: row.originalName };
        }
        const selected = await engine.intakeManual(source.id, [entry]);
        const response = await engine.decide({ requestId: crypto.randomUUID(), action: 'correct',
          items: selected.map(row => ({ ...row, target, confirmedStudentChange: true })) });
        const result = response.results[0];
        results.push({ ...result, fileId: id, itemId: id, name: entry.name });
      } catch (error) { results.push({ fileId: id, itemId: id, ok: false, message: error.message }); }
    }
    return { results };
  }
  return { deliverDownloads: (ids, target) => deliver('download', ids, target),
    deliverShares: (studentId, ids, target) => deliver('share', ids, { ...target, studentId }, studentId),
    async downloadList() {
      const engine = await ready(), data = await download().list();
      if (!data.folder) return data;
      const records = await engine.legacyRecords(data.folder);
      const byIdentity = new Map(records.map(i => [`${i.name}\0${i.identity}`, i]));
      for (const file of data.files) {
        const row = byIdentity.get(`${file.name}\0${file.identity}`);
        if (row) Object.assign(file, { status: row.status, message: row.message, targetName: row.target ? `${row.target.studentId} · ${row.target.id || '原始资料库'}` : '',
          selectable: !['delivered', 'delivering', 'delivery_reconcile', 'execution_unknown', 'archive_pending'].includes(row.status) });
      }
      for (const row of records.filter(i => i.status === 'delivered' && !data.files.some(f => f.name === i.name && f.identity === i.identity))) {
        data.files.push({ fileId: `unified:${row.id}`, name: row.name, byteSize: row.size, status: 'delivered', supported: false, selectable: false,
          targetName: `${row.target.studentId} · ${row.target.id || '原始资料库'}`, message: '受管目标保留原件；可在智能收件箱已投递中纠正' });
      }
      return data;
    } };
}
module.exports = { createLegacyIntakeBridge };
