const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  applyCatalogCandidate,
  effectiveCourses,
  normalizeInstitutionPolicy,
  normalizeCourseItem,
  validateCatalogPackage,
} = require('./course-catalog.cjs');
const { imageExtension, sha256Buffer, verifyCoursePackage } = require('./course-package-v2.cjs');
const { verifySigned: verifyPublicCourseManifest } = require('./public-course-sync.cjs');

function mergeCoursesByStableId(platformCourses = [], customCourses = []) {
  const merged = new Map();
  for (const course of Array.isArray(platformCourses) ? platformCourses : []) {
    merged.set(course.courseId, course);
  }
  for (const course of Array.isArray(customCourses) ? customCourses : []) {
    // A signed cloud course is authoritative when the same stable ID is still
    // present in the legacy local custom catalog. Keep the local entry only as
    // an offline fallback until its ID has appeared in the signed catalog.
    if (!merged.has(course.courseId)) merged.set(course.courseId, course);
  }
  return [...merged.values()];
}
const { loadCourseTrustPolicy } = require('./course-trust-policy.cjs');

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

function existingPath(candidates) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || '';
}

function createCourseCatalogStore(options = {}) {
  const userDataDir = path.resolve(options.userDataDir);
  const appVersion = String(options.appVersion || '0.0.0');
  const resourceRoots = (options.resourceRoots || []).map((item) => path.resolve(item));
  const root = path.join(userDataDir, 'course-catalog');
  const lastGoodPath = path.join(root, 'last-good.json');
  const policyPath = path.join(root, 'institution-policy.json');
  const auditPath = path.join(root, 'catalog-audit.json');
  const customCatalogPath = path.join(root, 'tenant-custom-courses.json');
  const customAssetsDir = path.join(root, 'custom-assets');
  const platformAssetsDir = path.join(root, 'platform-assets');
  const publicContentCacheDir = path.join(root, 'public-content');
  const cloudAssetsDir = path.join(publicContentCacheDir, 'assets');
  const platformPackagesDir = path.join(root, 'platform-packages');
  const platformPackageIndexPath = path.join(platformPackagesDir, 'index.json');
  const publications = options.enablePublications ? require('./course-publications.cjs').createCoursePublications(path.join(root, 'publications')) : null;
  const publicKeyPath = existingPath(resourceRoots.map((item) => path.join(item, 'course-catalog', 'public-key.pem')));
  const packagedCatalogPath = existingPath(resourceRoots.map((item) => path.join(item, 'course-catalog', 'catalog.json')));
  const publicKey = publicKeyPath ? fs.readFileSync(publicKeyPath, 'utf8') : '';
  const configuredTrustKeys = Array.isArray(options.trustedCourseKeys) ? options.trustedCourseKeys : [];
  const trustPolicy = loadCourseTrustPolicy({ resourceRoots, required: false });

  function keyFingerprint(pem) {
    const der = crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' });
    return crypto.createHash('sha256').update(der).digest('hex');
  }

  function normalizeCourseTrustKey(input = {}) {
    const keyId = String(input.keyId || '').trim();
    const pem = String(input.publicKey || '').trim();
    if (!/^[a-z0-9][a-z0-9_-]{2,79}$/i.test(keyId) || !pem.includes('PUBLIC KEY')) throw new Error('课程公钥 keyId 或格式无效。');
    const fingerprint = keyFingerprint(pem);
    if (input.fingerprint && String(input.fingerprint).toLowerCase() !== fingerprint) throw new Error(`课程公钥 ${keyId} 的指纹不一致。`);
    const status = ['active', 'transition', 'revoked'].includes(input.status) ? input.status : 'active';
    return { keyId, publicKey: `${pem}\n`, fingerprint, status, importedAt: String(input.importedAt || new Date().toISOString()) };
  }

  function trustedCourseKeys() {
    const keys = [];
    const packagedCatalog = readJson(packagedCatalogPath, {});
    if (publicKey && packagedCatalog?.keyId) {
      try { keys.push(normalizeCourseTrustKey({ keyId: packagedCatalog.keyId, publicKey, importedAt: 'packaged' })); } catch { /* Fail closed. */ }
    }
    for (const issuer of trustPolicy?.issuers || []) keys.push(normalizeCourseTrustKey({ ...issuer, importedAt: trustPolicy.policyRevision }));
    for (const configured of configuredTrustKeys) {
      try { keys.push(normalizeCourseTrustKey(configured)); } catch { /* Invalid explicit anchors fail closed. */ }
    }
    const byId = new Map();
    for (const item of keys) {
      const current = byId.get(item.keyId);
      if (current && current.fingerprint !== item.fingerprint) throw new Error(`课程公钥 ${item.keyId} 存在冲突，已拒绝加载。`);
      if (!current || item.status === 'revoked' || current.status === 'active') byId.set(item.keyId, item);
    }
    return [...byId.values()];
  }

  function publicKeys() {
    return new Map(trustedCourseKeys().filter((item) => ['active', 'transition'].includes(item.status)).map((item) => [item.keyId, item.publicKey]));
  }

  function publicKeyFor(keyId) {
    return publicKeys().get(String(keyId || '')) || '';
  }

  function audit(entry) {
    const current = readJson(auditPath, { schema: 'edu-manager.course-catalog-audit.v1', entries: [] });
    current.updatedAt = new Date().toISOString();
    current.entries = [{ at: current.updatedAt, ...entry }, ...(Array.isArray(current.entries) ? current.entries : [])].slice(0, 200);
    writeJsonAtomic(auditPath, current);
  }

  function checkedCatalog(candidate) {
    return validateCatalogPackage(candidate || {}, { hostVersion: appVersion, publicKey: publicKeyFor(candidate?.keyId), requireSignature: true });
  }

  function loadLastGood() {
    const checked = checkedCatalog(readJson(lastGoodPath));
    return checked.ok ? checked.catalog : null;
  }

  function loadCloudCatalog() {
    const active = readJson(path.join(publicContentCacheDir, 'active.json'));
    if (active?.schema !== 'edu-manager.public-course-cache.v1' || !active.manifest || !active.catalog) return null;
    try {
      verifyPublicCourseManifest(active.manifest, publicKeys());
      if (active.manifest.manifestRevision !== active.catalog.manifestRevision) return null;
      for (const asset of active.manifest.assets || []) {
        const extension = asset.mimeType === 'image/png' ? 'png' : asset.mimeType === 'image/webp' ? 'webp' : asset.mimeType === 'image/jpeg' ? 'jpg' : '';
        if (!extension) return null;
        const target = path.join(cloudAssetsDir, `${asset.sha256}.${extension}`);
        if (!fs.existsSync(target) || fs.statSync(target).size !== Number(asset.bytes) || sha256Buffer(fs.readFileSync(target)) !== asset.sha256) return null;
      }
      return active.catalog;
    } catch { return null; }
  }

  function ensureCatalog() {
    const cloudCatalog = loadCloudCatalog();
    if (cloudCatalog) return cloudCatalog;
    let lastGood = loadLastGood();
    const packaged = readJson(packagedCatalogPath);
    if (packaged) {
      const result = applyCatalogCandidate(packaged, { lastGood }, { hostVersion: appVersion, publicKey: publicKeyFor(packaged.keyId), requireSignature: true });
      if (result.ok && (!lastGood || result.catalog.catalogVersion !== lastGood.catalogVersion)) {
        writeJsonAtomic(lastGoodPath, result.catalog);
        lastGood = result.catalog;
        audit({ action: 'packaged_catalog_accepted', ok: true, catalogVersion: result.catalog.catalogVersion });
      } else if (!lastGood && !result.ok) {
        audit({ action: 'packaged_catalog_rejected', ok: false, message: result.message });
      }
    }
    return lastGood;
  }

  function readCustomCatalog() {
    const input = readJson(customCatalogPath, {});
    const courses = [];
    for (const raw of Array.isArray(input?.courses) ? input.courses : []) {
      try {
        const course = normalizeCourseItem(raw);
        if (course.type !== 'tenant_custom' || !course.courseId.startsWith('tenant:')) continue;
        if (!/^custom-assets\/[a-f0-9]{64}\.(png|jpg|jpeg|webp)$/i.test(course.coverAsset)) continue;
        courses.push(course);
      } catch {
        // Invalid locally managed entries are ignored without affecting the signed platform catalog.
      }
    }
    return {
      schema: 'edu-manager.tenant-course-catalog.v1',
      updatedAt: String(input?.updatedAt || ''),
      courses,
    };
  }

  function combinedCatalog() {
    const platformCatalog = ensureCatalog();
    const customCatalog = readCustomCatalog();
    if (!platformCatalog && !customCatalog.courses.length) return null;
    const customVersion = customCatalog.updatedAt
      ? customCatalog.updatedAt.replace(/\D/g, '').slice(0, 14)
      : '';
    return {
      schemaVersion: 1,
      catalogVersion: customCatalog.courses.length
        ? `${platformCatalog?.catalogVersion || 'tenant-custom'}+custom.${customVersion || '1'}`
        : platformCatalog.catalogVersion,
      issuedAt: platformCatalog?.issuedAt || customCatalog.updatedAt || new Date(0).toISOString(),
      manifestRevision: platformCatalog?.manifestRevision || '',
      cloudFreshUntil: platformCatalog?.cloudFreshUntil || '',
      synchronizedAt: platformCatalog?.synchronizedAt || '',
      tombstones: Array.isArray(platformCatalog?.tombstones) ? platformCatalog.tombstones : [],
      minHostVersion: platformCatalog?.minHostVersion || '0.0.0',
      keyId: platformCatalog?.keyId || '',
      checksum: platformCatalog?.checksum || '',
      signature: platformCatalog?.signature || '',
      courses: mergeCoursesByStableId(platformCatalog?.courses || [], customCatalog.courses),
    };
  }

  function readPolicy(catalog = combinedCatalog() || { courses: [] }) {
    return normalizeInstitutionPolicy(readJson(policyPath, {}), catalog);
  }

  function state() {
    const platformCatalog = ensureCatalog();
    const customCatalog = readCustomCatalog();
    const catalog = combinedCatalog();
    const policy = readPolicy(catalog || { courses: [] });
    const currentPlatformPackage = archivedPackageForVersion(platformCatalog?.catalogVersion);
    return {
      ok: Boolean(catalog),
      catalog,
      platformCatalog,
      currentPlatformPackage,
      customCatalog,
      policy,
      paths: {
        cache: lastGoodPath,
        audit: auditPath,
      },
      message: platformCatalog
        ? `平台目录已通过版本、文件哈希和完整性校验${customCatalog.courses.length ? `，另有 ${customCatalog.courses.length} 门机构自选课程` : ''}。`
        : customCatalog.courses.length
          ? `当前仅有 ${customCatalog.courses.length} 门机构精选课程；没有可用的平台课程包。`
          : '没有可用的平台课程目录。',
    };
  }

  function savePolicy(input = {}) {
    const catalog = combinedCatalog();
    if (!catalog) throw new Error('没有可应用机构策略的有效课程目录。');
    const policy = normalizeInstitutionPolicy(input, catalog);
    policy.updatedAt = new Date().toISOString();
    policy.policyVersion = policy.updatedAt;
    writeJsonAtomic(policyPath, policy);
    audit({ action: 'institution_policy_updated', ok: true, policyVersion: policy.policyVersion });
    return policy;
  }

  function importPackage(candidate, importOptions = {}) {
    const lastGood = loadLastGood();
    const result = applyCatalogCandidate(candidate, { lastGood }, {
      hostVersion: appVersion,
      publicKey: publicKeyFor(candidate?.keyId),
      requireSignature: true,
      allowRollback: importOptions.allowRollback === true,
    });
    if (result.ok) writeJsonAtomic(lastGoodPath, result.catalog);
    audit({
      action: importOptions.allowRollback ? 'catalog_rollback_import' : 'offline_catalog_import',
      ok: result.ok,
      rolledBack: result.rolledBack,
      catalogVersion: result.catalog?.catalogVersion || '',
      message: result.message || '',
    });
    return result;
  }

  function importFile(filePath, importOptions = {}) {
    const candidate = readJson(filePath);
    if (!candidate) return { ok: false, rolledBack: Boolean(loadLastGood()), code: 'COURSE_CATALOG_FILE_INVALID', message: '无法读取离线课程目录包。', catalog: loadLastGood() };
    return importPackage(candidate, importOptions);
  }

  function installPlatformAssets(assets = []) {
    fs.mkdirSync(platformAssetsDir, { recursive: true });
    for (const asset of assets) {
      const filename = String(asset?.filename || '');
      const buffer = Buffer.isBuffer(asset?.buffer) ? asset.buffer : Buffer.from(asset?.buffer || '');
      const match = filename.match(/^([a-f0-9]{64})\.(png|jpg|jpeg|webp)$/i);
      const expectedExtension = path.extname(filename).toLowerCase().replace('.jpeg', '.jpg');
      if (!match || !buffer.length || buffer.length > 5 * 1024 * 1024 || sha256Buffer(buffer) !== match[1].toLowerCase() || imageExtension(buffer) !== expectedExtension) {
        throw new Error(`平台课程图片校验失败：${filename || '未知文件'}`);
      }
      const target = path.resolve(platformAssetsDir, filename);
      if (!target.startsWith(`${path.resolve(platformAssetsDir)}${path.sep}`)) throw new Error('平台课程图片路径越界。');
      if (!fs.existsSync(target)) {
        const temporary = `${target}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, buffer);
        fs.renameSync(temporary, target);
      }
    }
  }

  function readPlatformPackageIndex() {
    const input = readJson(platformPackageIndexPath, {});
    return {
      schema: 'edu-manager.platform-course-package-index.v1',
      packages: Array.isArray(input?.packages) ? input.packages.filter((item) => item && typeof item === 'object') : [],
    };
  }

  function archivedPackageForVersion(catalogVersion) {
    const version = String(catalogVersion || '').trim();
    if (!version) return null;
    const record = readPlatformPackageIndex().packages.find((item) => item.catalogVersion === version);
    if (!record || !/^[a-z0-9._-]+\.edu-coursepkg$/i.test(String(record.filename || ''))) return null;
    const packagePath = path.resolve(platformPackagesDir, record.filename);
    if (!packagePath.startsWith(`${path.resolve(platformPackagesDir)}${path.sep}`) || !fs.existsSync(packagePath)) return null;
    return {
      catalogVersion: version,
      sha256: String(record.sha256 || ''),
      bytes: Number(record.bytes || 0),
      archivedAt: String(record.archivedAt || ''),
      filename: String(record.filename || ''),
      canReExport: true,
    };
  }

  function archiveCoursePackage(filePath, verified) {
    const catalogVersion = String(verified?.catalog?.catalogVersion || verified?.manifest?.catalogVersion || '').trim();
    if (!catalogVersion) throw new Error('课程包缺少可归档的目录版本。');
    const bytes = fs.readFileSync(filePath);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const safeVersion = catalogVersion.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'catalog';
    const filename = `${safeVersion}-${sha256.slice(0, 12)}.edu-coursepkg`;
    fs.mkdirSync(platformPackagesDir, { recursive: true });
    const target = path.join(platformPackagesDir, filename);
    if (!fs.existsSync(target)) {
      const temporary = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, bytes);
      fs.renameSync(temporary, target);
    }
    const index = readPlatformPackageIndex();
    const record = { catalogVersion, sha256, bytes: bytes.length, filename, archivedAt: new Date().toISOString() };
    index.packages = [record, ...index.packages.filter((item) => item.catalogVersion !== catalogVersion || item.sha256 !== sha256)].slice(0, 100);
    writeJsonAtomic(platformPackageIndexPath, index);
    return { ...record, canReExport: true };
  }

  function exportCurrentCoursePackage(outputPath) {
    const platformCatalog = ensureCatalog();
    const archived = archivedPackageForVersion(platformCatalog?.catalogVersion);
    if (!platformCatalog || !archived) throw new Error('当前已发布版本没有可重新导出的原始课程包；请先发布或导入一次平台课程包。');
    const source = path.join(platformPackagesDir, archived.filename);
    const verified = verifyCoursePackage(source, { hostVersion: appVersion, tempRoot: path.join(root, 'package-temp'), publicKeys: publicKeys() });
    if (!verified.ok || verified.catalog?.catalogVersion !== platformCatalog.catalogVersion) throw new Error(`归档课程包完整性校验失败：${verified.message || '目录版本不一致'}`);
    const target = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    fs.copyFileSync(source, temporary);
    const copiedSha256 = crypto.createHash('sha256').update(fs.readFileSync(temporary)).digest('hex');
    if (copiedSha256 !== archived.sha256) {
      fs.rmSync(temporary, { force: true });
      throw new Error('重新导出的课程包哈希校验失败。');
    }
    fs.rmSync(target, { force: true });
    fs.renameSync(temporary, target);
    audit({ action: 'platform_course_package_reexported', ok: true, catalogVersion: archived.catalogVersion, packageSha256: archived.sha256 });
    return { ...archived, outputPath: target };
  }

  function importCoursePackage(filePath, importOptions = {}) {
    const verified = verifyCoursePackage(filePath, {
      hostVersion: appVersion,
      tempRoot: path.join(root, 'package-temp'),
      publicKeys: publicKeys(),
    });
    if (!verified.ok) {
      audit({ action: 'signed_course_package_rejected', ok: false, message: verified.message || '' });
      return { ...verified, catalog: loadLastGood() };
    }
    try {
      const archivedPackage = archiveCoursePackage(filePath, verified);
      installPlatformAssets(verified.assets);
      const result = importPackage(verified.catalog, importOptions);
      audit({
        action: 'signed_course_package_import',
        ok: result.ok,
        catalogVersion: verified.catalog.catalogVersion,
        packageVersion: verified.manifest.catalogVersion,
        releaseIntent: verified.manifest.releaseIntent,
        message: result.message || '',
      });
      return { ...result, manifest: verified.manifest, archivedPackage: result.ok ? archivedPackage : null };
    } catch (error) {
      audit({ action: 'signed_course_package_rejected', ok: false, message: error.message });
      return { ok: false, code: 'COURSE_PACKAGE_INSTALL_FAILED', message: error.message, catalog: loadLastGood() };
    }
  }

  const importSignedCoursePackage = importCoursePackage;

  function coursesForStudent(student = {}) {
    const catalog = combinedCatalog();
    if (!catalog) return [];
    const policy = readPolicy(catalog);
    // Once explicitly published, its audience is authoritative. Keep legacy
    // enable/order controls, but do not intersect two independent student lists.
    if (publications) for (const record of publications.records()) {
      if(policy.courseRules[record.resourceId])policy.courseRules[record.resourceId]={...policy.courseRules[record.resourceId],studentIds:[],gradeRange:[]};
    }
    const courses = effectiveCourses(catalog, policy, student);
    return publications ? publications.project(courses, student) : courses;
  }

  function findCourse(courseId, student = null) {
    const courses = student ? coursesForStudent(student) : (combinedCatalog()?.courses || []).filter((item) => item.status === 'active');
    return courses.find((item) => item.courseId === String(courseId || '')) || null;
  }

  function assetPath(assetName) {
    const normalized = String(assetName || '').replace(/\\/g, '/');
    if (/^custom-assets\/[a-f0-9]{64}\.(png|jpg|jpeg|webp)$/i.test(normalized)) {
      const candidate = path.resolve(customAssetsDir, path.basename(normalized));
      return candidate.startsWith(`${path.resolve(customAssetsDir)}${path.sep}`) && fs.existsSync(candidate) ? candidate : '';
    }
    if (/^platform-assets\/[a-f0-9]{64}\.(png|jpg|jpeg|webp)$/i.test(normalized)) {
      const candidate = path.resolve(platformAssetsDir, path.basename(normalized));
      return candidate.startsWith(`${path.resolve(platformAssetsDir)}${path.sep}`) && fs.existsSync(candidate) ? candidate : '';
    }
    if (/^cloud-assets\/[a-f0-9]{64}\.(png|jpg|jpeg|webp)$/i.test(normalized)) {
      const candidate = path.resolve(cloudAssetsDir, path.basename(normalized));
      return candidate.startsWith(`${path.resolve(cloudAssetsDir)}${path.sep}`) && fs.existsSync(candidate) ? candidate : '';
    }
    if (/^catalog-assets\/[a-z0-9][a-z0-9._-]+\.(png|jpg|jpeg|webp)$/i.test(normalized)) {
      const candidate = existingPath(resourceRoots.map((item) => path.join(item, ...normalized.split('/'))));
      if (!candidate) return '';
      const resolved = path.resolve(candidate);
      const allowed = resourceRoots.some((item) => resolved.startsWith(`${item}${path.sep}`));
      return allowed ? resolved : '';
    }
    return '';
  }

  function assetPathByFilename(assetName) {
    const filename = path.basename(String(assetName || ''));
    return assetPath(`custom-assets/${filename}`) || assetPath(`platform-assets/${filename}`) || assetPath(`cloud-assets/${filename}`) || assetPath(`catalog-assets/${filename}`);
  }

  function mergeCustomCourses(incoming = [], mergeOptions = {}) {
    const current = readCustomCatalog();
    const byId = new Map(current.courses.map((course) => [course.courseId, course]));
    for (const raw of incoming) {
      const course = normalizeCourseItem(raw);
      if (course.type !== 'tenant_custom' || !course.courseId.startsWith('tenant:')) {
        throw new Error('自选课程必须使用 tenant_custom 类型和 tenant: ID。');
      }
      if (!assetPath(course.coverAsset)) throw new Error(`课程 ${course.name} 的图片文件不存在或格式不受支持。`);
      byId.set(course.courseId, course);
    }
    if (byId.size > 200) throw new Error('机构自选课程总数不能超过 200 门。');
    const value = {
      schema: 'edu-manager.tenant-course-catalog.v1',
      updatedAt: new Date().toISOString(),
      courses: [...byId.values()],
    };
    if (publications) publications.registerDrafts(incoming.filter(course => !current.courses.some(old => old.courseId === course.courseId)));
    writeJsonAtomic(customCatalogPath, value);
    audit({
      action: String(mergeOptions.action || 'tenant_custom_excel_import'),
      ok: true,
      imported: incoming.length,
      total: value.courses.length,
    });
    return value;
  }

  function removeCustomCourse(courseId, removeOptions = {}) {
    const normalizedId = String(courseId || '').trim();
    const current = readCustomCatalog();
    const target = current.courses.find((course) => course.courseId === normalizedId);
    if (!target) throw new Error('机构精选课程不存在或已经删除。');
    const value = {
      schema: 'edu-manager.tenant-course-catalog.v1',
      updatedAt: new Date().toISOString(),
      courses: current.courses.filter((course) => course.courseId !== normalizedId),
    };
    writeJsonAtomic(customCatalogPath, value);
    const policy = normalizeInstitutionPolicy(readJson(policyPath, {}), combinedCatalog() || { courses: [] });
    policy.updatedAt = value.updatedAt;
    policy.policyVersion = value.updatedAt;
    writeJsonAtomic(policyPath, policy);
    audit({
      action: String(removeOptions.action || 'tenant_custom_course_deleted'),
      ok: true,
      courseId: normalizedId,
      courseName: target.name,
      remaining: value.courses.length,
    });
    return { course: target, catalog: value, policy };
  }

  return {
    assetPath,
    assetPathByFilename,
    publications,
    publicContentCacheDir,
    publicKeys,
    startPublishedCourse: (courseId, student) => {
      const course = coursesForStudent(student).find(c => c.courseId === courseId);
      if (!course) throw Error('课程未分配给当前学生或已停止新使用');
      return publications ? publications.pin(course, student) : course;
    },
    combinedCatalog,
    customAssetsDir,
    ensureCatalog,
    findCourse,
    importFile,
    importCoursePackage,
    importPackage,
    importSignedCoursePackage,
    exportCurrentCoursePackage,
    installPlatformAssets,
    mergeCustomCourses,
    removeCustomCourse,
    platformAssetsDir,
    publicKey,
    publicKeyFor,
    trustedCourseKeys: () => trustedCourseKeys().map(({ publicKey: _publicKey, ...item }) => item),
    trustPolicyRevision: () => trustPolicy?.policyRevision || 'packaged-single-key-legacy',
    readCustomCatalog,
    readPolicy,
    savePolicy,
    state,
    coursesForStudent,
    assetPath,
  };
}

module.exports = {
  createCourseCatalogStore,
  mergeCoursesByStableId,
  readJson,
  writeJsonAtomic,
};
