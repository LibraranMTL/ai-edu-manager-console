'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { verifyWorkBuddyResearch } = require('../electron/workbuddy-research.cjs');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}

function buildRuntimeFromDescriptor(descriptor, { nodePath = process.execPath } = {}) {
  const root = path.resolve(String(descriptor?.root || ''));
  const cliPath = path.resolve(String(descriptor?.cliPath || ''));
  if (!root || !cliPath || !fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()
    || !fs.statSync(cliPath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error('workbuddy_authorization_descriptor_invalid');
  }
  const packageRoot = path.dirname(path.dirname(cliPath));
  const productConfigPath = path.join(packageRoot, 'product.json');
  const mode = /\.[cm]?js$/i.test(cliPath) ? 'node' : 'direct';
  if (mode === 'node' && !fs.statSync(nodePath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error('workbuddy_node_runtime_missing');
  }
  return {
    available: true,
    exePath: '',
    installDir: packageRoot,
    cliPath,
    productConfigPath: fs.existsSync(productConfigPath) ? productConfigPath : '',
    configDir: path.join(root, '.workbuddy'),
    authRoot: root,
    authVersion: Number(descriptor.version || 0),
    endpointPath: path.join(root, '.workbuddy', 'wbipc', 'endpoint.json'),
    desktopSessionAvailable: false,
    nodePath: mode === 'node' ? path.resolve(nodePath) : '',
    mode,
    useElectronNode: false,
  };
}

async function prepareQualification(descriptor, { nodePath = process.execPath, verify = verifyWorkBuddyResearch } = {}) {
  const runtime = buildRuntimeFromDescriptor(descriptor, { nodePath });
  const qualification = await verify({ runtime });
  if (qualification?.ready !== true || qualification.profile !== 'research.v1') {
    throw new Error('workbuddy_research_qualification_failed');
  }
  return {
    ...qualification,
    authScope: JSON.stringify([runtime.configDir || '', runtime.authVersion || 0]),
  };
}

function persistQualification(tasksFile, qualification) {
  const resolved = path.resolve(tasksFile);
  const store = readJson(resolved);
  store.runtime ||= {};
  store.runtime.agentQualifications ||= {};
  store.runtime.agentQualifications.workbuddy ||= {};
  store.runtime.agentQualifications.workbuddy['research.v1'] = qualification;
  store.updatedAt = new Date().toISOString();
  writeJsonAtomic(resolved, store);
}

async function main() {
  const args = new Map(process.argv.slice(2).map(entry => {
    const separator = entry.indexOf('=');
    return separator < 0 ? [entry.replace(/^--/, ''), 'true']
      : [entry.slice(0, separator).replace(/^--/, ''), entry.slice(separator + 1)];
  }));
  const descriptorFile = path.resolve(String(args.get('descriptor') || ''));
  const tasksFile = path.resolve(String(args.get('tasks') || ''));
  const evidenceFile = path.resolve(String(args.get('evidence') || ''));
  if (!descriptorFile || !tasksFile || !evidenceFile) throw new Error('descriptor, tasks and evidence are required');
  const descriptor = readJson(descriptorFile);
  const qualification = await prepareQualification(descriptor);
  persistQualification(tasksFile, qualification);
  const evidence = {
    schema: 'edu.p0-workbuddy-research-qualification.v1',
    passed: true,
    profile: qualification.profile,
    ready: qualification.ready,
    measuredAt: qualification.measuredAt,
    expiresAt: qualification.expiresAt,
    sourceCount: Number(qualification.sourceCount || 0),
    runtimeHash: String(qualification.runtimeHash || ''),
    descriptorVersion: Number(descriptor.version || 0),
    studentDataRead: false,
    isolatedTaskStoreUpdated: true,
  };
  writeJsonAtomic(evidenceFile, evidence);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = { buildRuntimeFromDescriptor, prepareQualification, persistQualification };

