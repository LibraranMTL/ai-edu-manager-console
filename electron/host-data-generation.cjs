const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = 'edu-manager.host-data-generation.v1';
const FILE_NAME = 'host-data-generation.json';

function dataGenerationPath(userDataDir) {
  return path.join(path.resolve(userDataDir), FILE_NAME);
}

function createGeneration(reason, migrationId = '') {
  return { schema: SCHEMA, id: crypto.randomUUID(), createdAt: new Date().toISOString(), reason, migrationId };
}

function validateGeneration(value) {
  if (!value || value.schema !== SCHEMA || !/^[a-f0-9-]{36}$/i.test(value.id || '')
    || !Number.isFinite(Date.parse(value.createdAt || ''))
    || !['initial', 'migration_restore'].includes(value.reason)
    || typeof value.migrationId !== 'string') throw new Error('主机资料代次记录损坏，不能安全继续使用旧回执。');
  return value;
}

function writeAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
    const descriptor = fs.openSync(temporary, 'r+');
    try {
      try { fs.fsyncSync(descriptor); }
      catch (error) {
        if (process.platform !== 'win32' || !['EPERM', 'EINVAL', 'ENOTSUP'].includes(error.code)) throw error;
      }
    } finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true }); }
}

function readHostDataGeneration(userDataDir) {
  const file = dataGenerationPath(userDataDir);
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    writeAtomic(file, createGeneration('initial'));
    stat = fs.lstatSync(file);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('主机资料代次记录不是普通文件。');
  return validateGeneration(JSON.parse(fs.readFileSync(file, 'utf8')));
}

function stageRestoredDataGeneration(stateStage, migrationId) {
  const file = dataGenerationPath(stateStage);
  writeAtomic(file, createGeneration('migration_restore', String(migrationId)));
  return file;
}

module.exports = { dataGenerationPath, readHostDataGeneration, stageRestoredDataGeneration, validateGeneration };
