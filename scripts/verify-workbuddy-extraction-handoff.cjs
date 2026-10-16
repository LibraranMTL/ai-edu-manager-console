'use strict';
// Opt-in synthetic live acceptance. The profile is metadata from the official
// user-assisted login; credentials are used by the vendor CLI, never read here.
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), { spawn } = require('node:child_process');
const { createProjectMaterialStore, hashStableFile } = require('../electron/project-materials.cjs');
const { createProjectMaterialExtractor, reuseMaterialExtraction, runImageOcr } = require('../electron/project-material-extract.cjs');
const { createProjectDigestWorkspace } = require('../electron/project-material-digest.cjs');
const { createProjectKnowledgeCommitter } = require('../electron/project-knowledge-commit.cjs');
const { runFixedWorkBuddy, createWorkBuddyQualification, executeMaterialWorkBuddy } = require('../electron/workbuddy-controlled.cjs');
const { workBuddyResultEnvelope } = require('../electron/workbuddy-runtime.cjs');
async function main() {
  const profile = JSON.parse(await fs.readFile(path.resolve(process.argv[2]), 'utf8')), reportFile = path.resolve(process.argv[3]);
  if (profile.provider !== 'official-full-cli-with-workbuddy-product-config' || !path.isAbsolute(profile.root)
    || path.resolve(profile.configDir) !== path.join(path.resolve(profile.root), '.workbuddy')) throw Error('Invalid isolated profile');
  const bundledIndex = process.argv.indexOf('--bundled-cli');
  const installed = bundledIndex >= 0 ? require('../electron/workbuddy-runtime.cjs').discoverWorkBuddyRuntime(
    path.resolve(process.argv[bundledIndex + 1]), { homeDir: profile.root, env: {}, findExecutable: () => process.execPath }) : null;
  if (installed && !installed.available) throw Error('Installed WorkBuddy CLI unavailable');
  const runtime = { available: true, mode: 'node', cliPath: installed?.cliPath || profile.cliPath, configDir: profile.configDir,
    productConfigPath: profile.productConfigPath, nodePath: process.execPath };
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-wb-handoff-live-'));
  const report = { schema: 'edu-manager.workbuddy-handoff-acceptance.v1', fixture: 'synthetic-only',
    runtimeKind: installed ? 'desktop-bundled-cli-with-independent-official-login' : profile.provider,
    cliSha256: (await hashStableFile(runtime.cliPath)).sha256,
    startedAt: new Date().toISOString(), runs: [], ocrCalls: 0, passed: false };
  const persist = async () => { await fs.mkdir(path.dirname(reportFile), { recursive: true }); await fs.writeFile(reportFile, JSON.stringify(report, null, 2)); };
  const spawnProcess = (exe, args, options) => {
    const env = { ...options.env, HOME: profile.root, USERPROFILE: profile.root,
      LOCALAPPDATA: path.join(profile.root, 'AppData', 'Local'), APPDATA: path.join(profile.root, 'AppData', 'Roaming') };
    for (const name of Object.keys(env)) if (/(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN)$/.test(name)) delete env[name];
    const child = spawn(exe, args, { ...options, env }), row = { completed: false, startedAt: new Date().toISOString() }; report.runs.push(row); let output = '';
    child.stdout.on('data', chunk => { if (output.length < 24 * 1024 * 1024) output += chunk; });
    child.on('close', (code, signal) => { row.exitCode = code; row.exitSignal = signal; row.processClosed = true; row.finishedAt = new Date().toISOString();
      try { const events = JSON.parse(output), envelope = workBuddyResultEnvelope(events);
        row.eventTypes = (Array.isArray(events) ? events : [events]).map(e => e.type);
        row.completed = code === 0 && envelope.subtype === 'success'; row.usage = envelope.usage;
      } catch { row.invalidEnvelope = true; }
    }); return child;
  };
  const run = (runtime, prompt, options) => runFixedWorkBuddy(runtime, prompt, { ...options, spawnProcess });
  try {
    const { createCanvas } = require('@napi-rs/canvas'); const canvas = createCanvas(1200, 300), ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1200, 300); ctx.fillStyle = 'black'; ctx.font = '48px Arial';
    ctx.fillText('SYNTHETIC experiment', 30, 80); ctx.fillText('Temperature: 20, 25, 30 Celsius', 30, 170);
    const bytes = canvas.toBuffer('image/png'), stores = [];
    for (const name of ['inbox', 'project']) {
      const workspace = path.join(root, name); await fs.mkdir(workspace); await fs.writeFile(path.join(workspace, 'synthetic.png'), bytes);
      const store = createProjectMaterialStore({ projectId: `synthetic-${name}`, managerPath: path.join(root, `${name}-manager`),
        roots: { workspace: { kind: 'workspace', path: workspace } } });
      const material = (await store.registerFiles([{ location: { rootId: 'workspace', kind: 'workspace', relativePath: 'synthetic.png' } }])).result[0];
      await store.snapshot(material.materialId, material.version); stores.push({ store, input: await store.resolve(material.materialId, material.version) });
    }
    const imageRunner = (...args) => { report.ocrCalls++; return runImageOcr(...args); };
    const source = createProjectMaterialExtractor({ store: stores[0].store, imageRunner });
    const destination = createProjectMaterialExtractor({ store: stores[1].store, imageRunner });
    await source.extract(stores[0].input);
    report.handoff = await reuseMaterialExtraction({ source, destination, sourceInput: stores[0].input, destinationInput: stores[1].input,
      sourceStudentId: 'synthetic-a', studentId: 'synthetic-a', authorize: async () => true });
    const knowledgeRoot = path.join(root, 'knowledge'); await fs.mkdir(knowledgeRoot);
    const workspace = createProjectDigestWorkspace({ store: stores[1].store, knowledgeRoot, allowedDirectories: ['summaries'] });
    const batch = await workspace.prepare({ materialIds: [stores[1].input.materialId], ruleVersion: 'synthetic-v1', targets: ['summaries/experiment.md'] });
    report.qualification = await createWorkBuddyQualification({ run }).check(runtime); await persist();
    if (!report.qualification.ready) throw Error(report.qualification.message);
    const receipt = await executeMaterialWorkBuddy({ runtime, qualification: report.qualification, batch, run, timeoutMs: 180000,
      extractSource: input => destination.extractText(input),
      projectRules: 'Summarize the synthetic experiment in under 100 words. Explicitly include temperature values 20, 25, 30 and label the data synthetic. No external sources or invented student author.' });
    const committed = await createProjectKnowledgeCommitter({ store: stores[1].store, workspace, knowledgeRoot }).commit(batch.batchId, receipt);
    const output = await fs.readFile(path.join(knowledgeRoot, 'summaries/experiment.md'), 'utf8');
    report.originalUnchanged = (await fs.readFile(path.join(root, 'inbox', 'synthetic.png'))).equals(bytes);
    report.factsPresent = ['20', '25', '30'].every(v => output.includes(v)) && /synthetic|虚构|合成|模拟/i.test(output);
    report.fullyCommitted = committed.fullyCommitted; report.artifacts = receipt.artifacts.length;
    report.passed = report.handoff.reused && report.ocrCalls === 1 && report.originalUnchanged && report.factsPresent
      && report.fullyCommitted && report.runs.length === 2 && report.runs.every(r => r.completed);
  } catch (error) { report.error = { code: error.code, message: error.message, stopConfirmed: error.stopConfirmed }; }
  report.finishedAt = new Date().toISOString(); await persist();
  // Retain the small synthetic fixture for inspection, including unknown runs;
  // it contains no login profile and is never part of the candidate package.
  console.log(JSON.stringify({ passed: report.passed, reportFile, fixtureRoot: root, ocrCalls: report.ocrCalls, error: report.error }));
  if (!report.passed) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
