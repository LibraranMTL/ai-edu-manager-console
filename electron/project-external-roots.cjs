const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { invariant, identifier, relativeMaterialPath } = require('./project-material-contract.cjs');
const { safePath, withCommitLock, writeJsonAtomic } = require('./project-materials.cjs');

const SCHEMA = 'edu-manager.project-external-roots.v1';

function grantPath(project) {
  invariant(path.isAbsolute(project.managerPath || ''), 'invalid_root', '项目管理目录无效。');
  return path.join(project.managerPath, 'project-materials', 'external-roots.json');
}

function readProjectExternalRoots(project) {
  const file = grantPath(project);
  try {
    invariant(!fs.lstatSync(project.managerPath).isSymbolicLink(), 'linked_path', '项目管理目录不能是链接。');
    let current = fs.realpathSync(project.managerPath);
    for (const segment of ['project-materials', 'external-roots.json']) {
      current = path.join(current, segment);
      invariant(!fs.lstatSync(current).isSymbolicLink(), 'linked_path', '外部来源授权文件不能是链接。');
    }
    const data = JSON.parse(fs.readFileSync(current, 'utf8'));
    invariant(data?.schema === SCHEMA && data.projectId === project.id && Array.isArray(data.roots)
      && data.roots.length <= 10000, 'external_grants_corrupt', '项目外部来源授权无效。');
    const ids = new Set();
    for (const item of data.roots) {
      identifier(item.rootId, '外部根ID');
      identifier(item.assetId, '资产ID');
      invariant(path.isAbsolute(item.path || '') && !ids.has(item.rootId),
        'external_grants_corrupt', '外部来源授权路径或编号冲突。');
      ids.add(item.rootId);
    }
    return data.roots;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    if (error.code === 'external_grants_corrupt' || error.code === 'linked_path') throw error;
    throw Object.assign(new Error('项目外部来源授权无法读取，不能回退为无授权。'),
      { code: 'external_grants_corrupt', cause: error });
  }
}

async function grantProjectAssetRoot(project, asset) {
  identifier(project.id, '项目ID');
  identifier(asset?.assetId, '资产ID');
  invariant(path.isAbsolute(asset.path || ''), 'invalid_asset_path', '资产原件路径无效。');
  invariant(!(await fsp.lstat(asset.path)).isSymbolicLink(), 'linked_path', '外部资产原件不能是链接。');
  const canonical = await fsp.realpath(asset.path);
  invariant((await fsp.stat(canonical)).isFile(), 'not_file', '资产原件不是普通文件。');
  const rootId = `asset-${crypto.createHash('sha256').update(JSON.stringify([
    project.id, asset.assetId, canonical,
  ])).digest('hex').slice(0, 24)}`;
  const rootPath = path.dirname(canonical);
  const relativePath = relativeMaterialPath(path.basename(canonical));
  const file = grantPath(project);
  await fsp.mkdir(project.managerPath, { recursive: true });
  invariant(!(await fsp.lstat(project.managerPath)).isSymbolicLink(), 'linked_path', '项目管理目录不能是链接。');
  await safePath(project.managerPath, 'project-materials/external-roots.json', { allowMissing: true });
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await withCommitLock(file, async () => {
    const roots = readProjectExternalRoots(project);
    const previous = roots.find((item) => item.rootId === rootId);
    if (previous) {
      invariant(previous.path === rootPath && previous.assetId === asset.assetId,
        'external_grants_corrupt', '外部来源授权编号与路径不一致。');
      return;
    }
    invariant(roots.length < 10000, 'external_grants_capacity', '项目外部来源授权已达上限。');
    roots.push({ rootId, assetId: asset.assetId, path: rootPath,
      ownerStudentId: String(asset.ownerStudentId || ''), grantedAt: new Date().toISOString() });
    await writeJsonAtomic(file, { schema: SCHEMA, projectId: project.id, roots });
  });
  return { kind: 'external', rootId, relativePath };
}

module.exports = { readProjectExternalRoots, grantProjectAssetRoot };
