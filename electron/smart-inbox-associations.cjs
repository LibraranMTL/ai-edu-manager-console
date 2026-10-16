'use strict';
const path = require('node:path');
const { hashStableFile, unchanged } = require('./project-materials.cjs');
const { digest } = require('./smart-inbox-policy.cjs');
const { invariant } = require('./project-material-contract.cjs');
const key = (item, target) => digest([item.id, target.studentId, item.fingerprint.sha256]);
const at = () => new Date().toISOString();

// Check under the registry commit lock, not against an earlier UI snapshot.
function retentionReasons(index, material, association, item, external = []) {
  const reasons = [...external];
  if (!association?.ownsAdoption) reasons.push('preexisting_or_unknown_ownership');
  if (material.sha256 !== item.fingerprint.sha256 || material.version !== association?.version) reasons.push('material_version_changed');
  if ((index.intakeAssociations || []).some(a => a.active && a.materialId === material.materialId && a.key !== association?.key)) reasons.push('other_active_intake');
  if ((material.sources || []).some(s => s.intakeAssociation?.itemId !== item.id || s.studentId !== association?.studentId)) reasons.push('other_source');
  if (['running', 'completed'].includes(material.processing?.state)) reasons.push('processing_or_processed');
  if (Object.entries(material.links || {}).some(([name, values]) => name !== 'assets' && (Array.isArray(values) ? values.length : Boolean(values)))) reasons.push('linked_evidence');
  if ((material.versions || []).some(v => (v.pins || []).some(pin => !String(pin).startsWith('intake:')))) reasons.push('pinned_version');
  const mentions = value => Array.isArray(value) && value.some(ref => ref.materialId === material.materialId);
  if ((index.evidenceBindings || []).some(b => mentions(b.materials))) reasons.push('evidence_binding');
  if ((index.knowledge || []).some(k => mentions(k.sources)) || (index.commits || []).some(c => (c.artifacts || []).some(a => mentions(a.sources)))) reasons.push('knowledge_reference');
  if ((material.intakeLastAdoptionRevision ?? material.recordRevision) !== material.recordRevision) reasons.push('subsequent_manual_or_external_change');
  return [...new Set(reasons)];
}

function createIntakeAssociations(h) {
  function scope(target, baseline) {
    invariant(h.canWrite?.() !== false, 'forbidden', '当前状态不允许修改项目关联');
    const student = h.student(target.studentId);
    invariant(student && !student.archived && student.status !== 'archived', 'forbidden', '关联所属学生已失效');
    if (target.type !== 'project') return null;
    const p = h.projects().find(p => String(p.id) === target.id);
    invariant(p && p.studentIds?.map(String).includes(target.studentId) && !['sealed', 'archived'].includes(p.status), 'forbidden', '原项目关联已变化或项目不可写');
    if (baseline) invariant(p.workspacePath === baseline.workspacePath && p.managerPath === baseline.managerPath, 'scope_changed', '项目目录配置已变化');
    return p;
  }
  async function verifyDestination(item, requireAssociation = false) {
    const p = scope(item.target);
    invariant(item.receipt?.ok && item.receipt.recordId && item.receipt.path, 'missing_receipt', '新目标尚无登记回执，不能撤销旧关联');
    invariant((await hashStableFile(item.receipt.path)).sha256 === item.fingerprint.sha256, 'receipt_changed', '新目标内容校验失败，旧关联保留');
    if (p && h.isWorkspace(p)) {
      const store = h.materialHost(p).store, index = await store.read(), m = index.materials.find(m => m.materialId === item.receipt.recordId);
      invariant(m?.adoption.state === 'accepted' && m.sha256 === item.fingerprint.sha256, 'receipt_changed', '新目标登记未通过范围及采用核验');
      const resolved = await store.resolve(m.materialId);
      invariant(path.resolve(resolved.path).toLowerCase() === path.resolve(item.receipt.path).toLowerCase(), 'receipt_changed', '新目标回执路径不属于该登记');
      if (requireAssociation) invariant((index.intakeAssociations || []).some(a => a.key === key(item, item.target) && a.active && a.materialId === m.materialId && a.version === m.version), 'association_missing', '新目标归集关联未完成');
    }
  }
  async function prepare(item) {
    const p = scope(item.target); if (!p || !h.isWorkspace(p)) return;
    const store = h.materialHost(p).store, index = await store.read();
    const association = (index.intakeAssociations || []).find(a => a.key === key(item, item.target) && !a.active && a.ownsAdoption);
    const material = index.materials.find(m => m.materialId === association?.materialId);
    if (!material || material.adoption.state !== 'excluded' || material.adoption.actorId !== 'smart-inbox-reroute') return;
    const current = await store.resolve(material.materialId);
    invariant(current.sha256 === item.fingerprint.sha256, 'source_changed', '原项目保留副本已变化，不能自动重新采用');
    await store.mutate(data => {
      scope(item.target, p);
      const m = data.materials.find(m => m.materialId === material.materialId);
      invariant(m?.recordRevision === material.recordRevision && m.sha256 === item.fingerprint.sha256, 'version_conflict', '资料在重新采用前发生变化');
      m.adoption = { state: 'accepted', actorId: 'smart-inbox-reroute', decidedAt: at(), reason: '用户纠正后重新投递至原项目' };
      m.recordRevision++; m.updatedAt = at(); m.intakeLastAdoptionRevision = m.recordRevision;
    });
  }
  async function bind(item) {
    const p = scope(item.target); if (!p || !h.isWorkspace(p)) return;
    await verifyDestination(item);
    // Repair the compatibility projection before freezing the revision baseline.
    // This is replayable when A -> B -> A restores an excluded record.
    await h.projectAssociationRestored?.(p, item.receipt.recordId);
    const store = h.materialHost(p).store;
    const current = await store.resolve(item.receipt.recordId);
    invariant(current.sha256 === item.fingerprint.sha256, 'receipt_changed', '新目标登记版本与回执不一致');
    await store.snapshot(item.receipt.recordId, current.version);
    await store.mutate(index => {
      scope(item.target, p);
      const m = index.materials.find(m => m.materialId === item.receipt.recordId);
      invariant(m?.sha256 === item.fingerprint.sha256 && m.version === current.version && m.adoption.state === 'accepted', 'receipt_changed', '目标资料尚未采用或版本已变化');
      index.intakeAssociations ||= [];
      const existing = index.intakeAssociations.find(a => a.key === key(item, item.target));
      if (existing?.active && existing.materialId === m.materialId && existing.version === m.version) return unchanged(existing);
      invariant(index.intakeAssociations.length < 10000 || existing, 'capacity', '项目归集关联记录已达到上限');
      const ownsAdoption = m.intakeOrigin?.itemId === item.id && m.intakeOrigin?.studentId === item.target.studentId;
      const value = { key: key(item, item.target), itemId: item.id, studentId: item.target.studentId, materialId: m.materialId,
        version: m.version, sha256: m.sha256, active: true, ownsAdoption, operationId: item.operationId, updatedAt: at() };
      if (existing) Object.assign(existing, value); else index.intakeAssociations.push(value);
      // Only tag an untouched intake-owned record. Later classification changes
      // are conservatively retained instead of undoing independent human work.
      m.intakeLastAdoptionRevision ??= m.recordRevision;
      return value;
    });
  }
  async function withdraw(item, previous) {
    await verifyDestination(item, true);
    if (previous.target.studentId === item.target.studentId && previous.target.type === item.target.type && previous.target.id === item.target.id) return { status: 'same_target', retained: true };
    const p = scope(previous.target);
    if (!p || !h.isWorkspace(p)) return { status: 'retained', retained: true, reasons: ['legacy_reference_index_unavailable'], oldRecordId: previous.receipt.recordId };
    const store = h.materialHost(p).store;
    const requestKey = digest([item.id, item.operationId, previous.target, previous.receipt.recordId, item.receipt.recordId]);
    const result = await store.mutate(index => {
      scope(previous.target, p); scope(item.target);
      index.intakeReroutes ||= [];
      const replay = index.intakeReroutes.find(r => r.requestKey === requestKey); if (replay) return unchanged(replay);
      invariant(index.intakeReroutes.length < 10000, 'capacity', '项目改投回执已达上限');
      const m = index.materials.find(m => m.materialId === previous.receipt.recordId);
      invariant(m, 'material_missing', '旧项目登记缺失，保留新投递等待核对');
      const association = (index.intakeAssociations || []).find(a => a.key === key(item, previous.target) && a.materialId === m.materialId);
      const external = h.externalReferences ? h.externalReferences(p, m, previous.receipt.path) : ['external_reference_audit_unavailable'];
      invariant(Array.isArray(external), 'reference_audit_failed', '外部引用核对失败');
      const reasons = retentionReasons(index, m, association, item, external);
      const row = { requestKey, itemId: item.id, oldRecordId: m.materialId, from: previous.target, to: item.target,
        newRecordId: item.receipt.recordId, sourceVersion: association?.version || null, sha256: item.fingerprint.sha256,
        status: reasons.length ? 'retained' : 'withdrawn', retained: Boolean(reasons.length), reasons, at: at() };
      if (association) { association.active = false; association.supersededBy = item.receipt.recordId; association.updatedAt = row.at; }
      if (!reasons.length) {
        m.adoption = { state: 'excluded', actorId: 'smart-inbox-reroute', decidedAt: row.at, reason: '用户改投已完成，撤销未引用的旧项目采用关联；原件保留' };
        m.recordRevision++; m.updatedAt = row.at; m.intakeLastAdoptionRevision = m.recordRevision;
      }
      m.intakeReroute = row; index.intakeReroutes.push(row); return row;
    });
    // A recoverable projection follows the authoritative registry commit.
    // Reconciliation replays this even if the previous process stopped here.
    await h.projectAssociationChanged?.(p, result.result, previous.receipt.path);
    return result.result;
  }
  return { prepare, bind, withdraw };
}
module.exports = { createIntakeAssociations, retentionReasons };
