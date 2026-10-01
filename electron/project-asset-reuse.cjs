const path = require('node:path');
const { verifiedSource } = require('./upload-receipt-query.cjs');

function selectReusableAssetPath(asset, project) {
  const students = new Set((project.studentIds || []).map(String));
  if (asset.ownerStudentId && !students.has(String(asset.ownerStudentId))) {
    return { ok: false, code: 'owner_scope_mismatch' };
  }
  const references = (asset.references || []).filter((ref) =>
    (ref.spaceType === 'project' && String(ref.spaceId) === String(project.id))
    || (ref.spaceType === 'student' && students.has(String(ref.spaceId)))
    || (ref.studentId && students.has(String(ref.studentId))));
  const privateAsset = Boolean(asset.ownerStudentId || (asset.linkedStudents || []).length
    || (asset.linkedProjects || []).length || (asset.references || []).length);
  const paths = references.map((ref) => ref.path);
  if (!privateAsset) paths.push(asset.path);
  const candidates = [...new Set(paths.filter((file) => path.isAbsolute(file || '')).map((file) => path.resolve(file)))];
  const valid = candidates.filter((file) => verifiedSource(file, asset.size, asset.sha1));
  if (valid.length !== 1) return { ok: false, code: valid.length ? 'ambiguous_source' : 'source_unavailable' };
  return { ok: true, path: valid[0] };
}

module.exports = { selectReusableAssetPath };
