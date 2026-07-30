const fs = require('fs');
const path = require('path');
const {
  applyCatalogCandidate,
  effectiveCourses,
  normalizeInstitutionPolicy,
  normalizeCourseItem,
  validateCatalogPackage,
} = require('./course-catalog.cjs');

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
  const publicKeyPath = existingPath(resourceRoots.map((item) => path.join(item, 'course-catalog', 'public-key.pem')));
  const packagedCatalogPath = existingPath(resourceRoots.map((item) => path.join(item, 'course-catalog', 'catalog.json')));
  const publicKey = publicKeyPath ? fs.readFileSync(publicKeyPath, 'utf8') : '';

  function audit(entry) {
    const current = readJson(auditPath, { schema: 'edu-manager.course-catalog-audit.v1', entries: [] });
    current.updatedAt = new Date().toISOString();
    current.entries = [{ at: current.updatedAt, ...entry }, ...(Array.isArray(current.entries) ? current.entries : [])].slice(0, 200);
    writeJsonAtomic(auditPath, current);
  }

  function checkedCatalog(candidate) {
    return validateCatalogPackage(candidate || {}, { hostVersion: appVersion, publicKey });
  }

  function loadLastGood() {
    const checked = checkedCatalog(readJson(lastGoodPath));
    return checked.ok ? checked.catalog : null;
  }

  function ensureCatalog() {
    let lastGood = loadLastGood();
    const packaged = readJson(packagedCatalogPath);
    if (packaged) {
      const result = applyCatalogCandidate(packaged, { lastGood }, { hostVersion: appVersion, publicKey });
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
      minHostVersion: platformCatalog?.minHostVersion || '0.0.0',
      keyId: platformCatalog?.keyId || '',
      checksum: platformCatalog?.checksum || '',
      signature: platformCatalog?.signature || '',
      courses: [...(platformCatalog?.courses || []), ...customCatalog.courses],
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
    return {
      ok: Boolean(catalog),
      catalog,
      platformCatalog,
      customCatalog,
      policy,
      paths: {
        cache: lastGoodPath,
        audit: auditPath,
      },
      message: platformCatalog
        ? `平台目录已通过签名和版本校验${customCatalog.courses.length ? `，另有 ${customCatalog.courses.length} 门机构自选课程` : ''}。`
        : customCatalog.courses.length
          ? `当前仅有 ${customCatalog.courses.length} 门机构自选课程；没有可用的平台签名目录。`
          : '没有可用的签名课程目录。',
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
      publicKey,
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

  function coursesForStudent(student = {}) {
    const catalog = combinedCatalog();
    if (!catalog) return [];
    return effectiveCourses(catalog, readPolicy(catalog), student);
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
    return assetPath(`custom-assets/${filename}`) || assetPath(`catalog-assets/${filename}`);
  }

  function mergeCustomCourses(incoming = []) {
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
    writeJsonAtomic(customCatalogPath, value);
    audit({ action: 'tenant_custom_excel_import', ok: true, imported: incoming.length, total: value.courses.length });
    return value;
  }

  return {
    assetPath,
    assetPathByFilename,
    combinedCatalog,
    customAssetsDir,
    ensureCatalog,
    findCourse,
    importFile,
    importPackage,
    mergeCustomCourses,
    readCustomCatalog,
    readPolicy,
    savePolicy,
    state,
    coursesForStudent,
  };
}

module.exports = {
  createCourseCatalogStore,
  readJson,
  writeJsonAtomic,
};
