'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { monitorEventLoopDelay, performance } = require('node:perf_hooks');
const { createProjectMaterialReadClient } = require('../electron/project-material-read-client.cjs');
const { MATERIAL_SCHEMA } = require('../electron/project-material-contract.cjs');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function syntheticMaterial(projectId, index) {
  const hash = index.toString(16).padStart(64, '0').slice(-64);
  return {
    materialId: `material-${index}`,
    projectId,
    version: 1,
    sha256: hash,
    size: index % 8192,
    location: { kind: 'workspace', rootId: 'workspace', relativePath: `资料/item-${index}.md` },
    adoption: { state: 'candidate' },
    processing: { state: 'pending' },
  };
}

function syntheticCategories(count) {
  return Array.from({ length: count }, (_, index) => ({
    categoryId: `category-${index}`,
    name: `分类 ${index}`,
    relativePath: `分类-${index}`,
    active: true,
    templateSource: '',
    templateSlot: null,
    aliases: [],
  }));
}

async function writeSyntheticRegistry(root, { rows, categoryCount }) {
  const projectId = `benchmark-project-${rows}`;
  const managerPath = path.join(root, '.edu-manager');
  const registryDirectory = path.join(managerPath, 'project-materials');
  const registryPath = path.join(registryDirectory, 'registry.json');
  await fsp.mkdir(registryDirectory, { recursive: true });
  const registry = {
    schema: MATERIAL_SCHEMA,
    projectId,
    revision: 1,
    materials: Array.from({ length: rows }, (_, index) => syntheticMaterial(projectId, index)),
    categories: syntheticCategories(categoryCount),
    receipts: [],
    commits: [],
    updatedAt: new Date().toISOString(),
  };
  await fsp.writeFile(registryPath, JSON.stringify(registry), 'utf8');
  return {
    registryPath,
    project: {
      id: projectId,
      name: `合成项目 ${rows}`,
      managerPath,
      workspacePath: path.join(root, 'workspace'),
      rawPath: path.join(root, 'raw'),
      materialStorageMode: 'workspace-v1',
    },
  };
}

async function runCategoryWorkerBenchmark({ rows, categoryCount = 20 } = {}) {
  if (!Number.isSafeInteger(rows) || rows < 0) throw new TypeError('rows must be a non-negative integer');
  if (!Number.isSafeInteger(categoryCount) || categoryCount < 0 || categoryCount > 500) {
    throw new TypeError('categoryCount must be an integer from 0 to 500');
  }
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'edu-category-worker-benchmark-'));
  const client = createProjectMaterialReadClient({ timeoutMs: 120_000 });
  try {
    const { registryPath, project } = await writeSyntheticRegistry(root, { rows, categoryCount });
    const registryResolved = path.resolve(registryPath).toLowerCase();
    const originalReadFileSync = fs.readFileSync;
    let mainRegistryReads = 0;
    const histogram = monitorEventLoopDelay({ resolution: 1 });
    let maximumTimerDriftMs = 0;
    let expectedTick = performance.now() + 5;
    const interval = setInterval(() => {
      const current = performance.now();
      maximumTimerDriftMs = Math.max(maximumTimerDriftMs, current - expectedTick);
      expectedTick = current + 5;
    }, 5);
    interval.unref?.();
    await delay(10);
    histogram.enable();
    histogram.reset();
    fs.readFileSync = function instrumentedReadFileSync(file, ...args) {
      if (typeof file === 'string' && path.resolve(file).toLowerCase() === registryResolved) mainRegistryReads++;
      return originalReadFileSync.call(this, file, ...args);
    };
    const startedAt = performance.now();
    let categories;
    try {
      categories = await client.request('categories', { project });
    } finally {
      fs.readFileSync = originalReadFileSync;
    }
    const workerDurationMs = performance.now() - startedAt;
    await delay(10);
    clearInterval(interval);
    histogram.disable();
    const histogramMaxMs = Number(histogram.max) / 1e6;
    const message = JSON.stringify(categories);
    return {
      rows,
      categoryCount,
      registryBytes: (await fsp.stat(registryPath)).size,
      workerDurationMs: Number(workerDurationMs.toFixed(3)),
      mainThreadEventLoopDelayMaxMs: Number(Math.max(histogramMaxMs, maximumTimerDriftMs).toFixed(3)),
      returnedRecordCount: categories.length,
      messageBytes: Buffer.byteLength(message),
      mainThreadRegistryReadCount: mainRegistryReads,
      mainThreadParsedRegistry: mainRegistryReads !== 0,
    };
  } finally {
    await client.close().catch(() => {});
    await fsp.rm(root, { recursive: true, force: true });
  }
}

function readArgument(name, fallback = '') {
  const prefix = `--${name}=`;
  const item = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : fallback;
}

async function main() {
  const rowValues = readArgument('rows', '30000,100000').split(',').map((value) => Number(value.trim()));
  const categoryCount = Number(readArgument('category-count', '20'));
  const assertTargets = process.argv.includes('--assert-targets');
  const output = readArgument('output');
  const results = [];
  for (const rows of rowValues) results.push(await runCategoryWorkerBenchmark({ rows, categoryCount }));
  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    targets: { maxCategories: 500, maxMessageBytes: 2 * 1024 * 1024, maxMainThreadDelayMs: 100 },
    results,
  };
  if (assertTargets) {
    for (const result of results) {
      if (result.mainThreadParsedRegistry) throw new Error(`${result.rows}: main thread read the registry`);
      if (result.returnedRecordCount > 500) throw new Error(`${result.rows}: returned more than 500 categories`);
      if (result.messageBytes > report.targets.maxMessageBytes) throw new Error(`${result.rows}: message exceeded 2MiB`);
      if (result.mainThreadEventLoopDelayMaxMs > report.targets.maxMainThreadDelayMs) {
        throw new Error(`${result.rows}: main-thread delay exceeded 100ms`);
      }
    }
  }
  if (output) {
    const target = path.resolve(output);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { runCategoryWorkerBenchmark };
