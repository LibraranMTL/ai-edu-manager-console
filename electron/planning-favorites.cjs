const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEMA = 'edu-manager.planning-favorites.v1';
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_FAVORITES = 500;
const fields = {
  topics: ['id', 'category', 'title', 'realWorldProblem', 'fitReason', 'studentEvidence', 'path', 'expectedOutcomes', 'durationWeeks', 'difficulty', 'collaboration', 'regionScope', 'resourceConditions', 'safetyEthics', 'feasibility', 'verifyItems', 'freshness'],
  competitions: ['id', 'name', 'category', 'scope', 'organizer', 'officialUrl', 'eligibility', 'deadline', 'season', 'fees', 'status', 'matchReasons', 'preparation', 'risks', 'missing', 'sourceUrls'],
};
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function kindCheck(kind) { if (!Object.hasOwn(fields, kind)) fail('FAVORITE_KIND_INVALID', '不支持的收藏类型。'); }
function pick(value, keys) { return Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]])); }

// Favorites have a separate atomic file: an in-flight research result cannot
// overwrite them with a stale planning store, and pruning versions cannot lose them.
function createPlanningFavorites({ requireStudent, resolveStudentDir, readStore, now }) {
  function fileFor(student, name = 'favorites.json') {
    const root = resolveStudentDir(student);
    if (typeof root !== 'string' || !path.isAbsolute(root) || path.resolve(root) === path.parse(root).root) fail('FAVORITE_PATH_INVALID', '学生收藏目录范围无效。');
    const file = path.join(path.resolve(root), 'planning-guidance', name);
    for (let entry = file; ; entry = path.dirname(entry)) {
      try { if (fs.lstatSync(entry).isSymbolicLink()) fail('FAVORITE_PATH_INVALID', '学生收藏目录不能使用链接。'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (entry === path.dirname(entry)) break;
    }
    return file;
  }
  function load(student) {
    const file = fileFor(student);
    let value;
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > MAX_BYTES) fail('FAVORITE_STORE_INVALID', '收藏文件异常或超出大小限制，未覆盖原文件。');
      value = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return { schema: SCHEMA, studentId: String(student.id), favorites: [] };
      fail(error.code || 'FAVORITE_STORE_INVALID', `读取收藏失败：${error.message}；原文件保留。`);
    }
    if (value.schema !== SCHEMA || value.studentId !== String(student.id) || !Array.isArray(value.favorites) || value.favorites.length > MAX_FAVORITES
      || value.favorites.some(item => !item || !Object.hasOwn(fields, item.kind) || typeof item.candidateId !== 'string' || item.candidate?.id !== item.candidateId || !Array.isArray(item.sources) || !item.versionId || !item.savedAt)) {
      fail('FAVORITE_STORE_INVALID', '收藏文件结构或学生范围不一致，未覆盖原文件。');
    }
    return value;
  }
  function getPlanningFavorites(studentId, kind) {
    const student = requireStudent(studentId); kindCheck(kind);
    return { ok: true, favorites: load(student).favorites.filter(item => item.kind === kind) };
  }
  function setPlanningFavorite(studentId, kind, versionId, candidateId, saved) {
    const student = requireStudent(studentId); kindCheck(kind);
    if (typeof candidateId !== 'string' || !candidateId.trim() || candidateId.length > 240 || typeof versionId !== 'string' || versionId.length > 240 || typeof saved !== 'boolean') fail('FAVORITE_INPUT_INVALID', '收藏参数无效。');
    const value = load(student);
    const existing = value.favorites.find(item => item.kind === kind && item.candidateId === candidateId);
    if (Boolean(existing) === saved) return { ok: true, favorites: value.favorites.filter(item => item.kind === kind), unchanged: true };
    if (saved) {
      fileFor(student, 'store.json');
      const store = readStore(student);
      const versions = kind === 'topics' ? store.topicSets : store.competitionSets;
      const version = (versions || []).find(item => item.id === versionId);
      const candidate = version?.candidates?.find(item => item.id === candidateId);
      if (!candidate || (version.studentId && String(version.studentId) !== String(student.id))) fail('FAVORITE_NOT_FOUND', '未找到当前学生的该条建议版本，请重新读取；未保存。');
      if (value.favorites.length >= MAX_FAVORITES) fail('FAVORITE_LIMIT', '收藏已达 500 条，请先取消部分收藏；不会自动删除旧收藏。');
      const sources = (version.sources || []).filter(source => kind === 'topics' || candidate.sourceUrls?.includes(source.url))
        .map(source => pick(source, ['url', 'title', 'fetchedAt', 'publishedAt', 'official', 'publisher', 'region']));
      const snapshot = { kind, candidateId, versionId: version.id, version: version.version, createdAt: version.createdAt, verifiedAt: version.verifiedAt || '', savedAt: now().toISOString(), candidate: pick(candidate, fields[kind]), sources };
      if (Buffer.byteLength(JSON.stringify(snapshot)) > 64 * 1024) fail('FAVORITE_LIMIT', '该条建议过大，不能收藏；原建议不受影响。');
      value.favorites.unshift(snapshot);
    } else value.favorites = value.favorites.filter(item => item !== existing);
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    if (bytes.length > MAX_BYTES) fail('FAVORITE_LIMIT', '收藏文件已达大小限制，请先取消部分收藏；原文件不变。');
    requireStudent(studentId);
    const file = fileFor(student);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    try { fs.writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 }); fs.renameSync(temp, file); }
    finally { try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    return { ok: true, favorites: value.favorites.filter(item => item.kind === kind), message: saved ? '已收藏，保留当时版本。' : '已取消收藏，原建议及项目不受影响。' };
  }
  return { getPlanningFavorites, setPlanningFavorite };
}
module.exports = { createPlanningFavorites };
