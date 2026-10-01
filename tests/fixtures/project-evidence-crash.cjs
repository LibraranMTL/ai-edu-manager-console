const fs = require('node:fs');
const path = require('node:path');
const { createEvidenceContext } = require('./project-evidence-runtime.cjs');
const { createProjectArchiveTransactions } = require('../../electron/project-archive-transaction.cjs');
const { createProjectArchiveStartup } = require('../../electron/project-archive-startup.cjs');
const { createProjectArchiveRuntime } = require('../../electron/project-archive-runtime.cjs');
const [root, phase] = process.argv.slice(2);
if (!path.isAbsolute(root || '') || !path.basename(root).startsWith('edu-evidence-durable-')
  || !['afterPrepared', 'afterFilesWritten', 'afterFinalized'].includes(phase)) throw new Error('synthetic crash fixture required');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'crash-input.json')));
if (fixture.root !== root) throw new Error('fixture root mismatch');
const startup = createProjectArchiveStartup({ catalogPath: path.join(root, 'recovery.json'), projectsPath: path.join(root, 'projects.json'),
  diagnosticPath: path.join(root, 'diagnostic.json'), recover: async () => { throw new Error('unexpected recovery in writer'); } });
const main = createEvidenceContext(fixture, { projectArchiveRuntime: createProjectArchiveRuntime(), projectArchiveStartupManager: () => startup,
  createProjectArchiveTransactions: (options) => createProjectArchiveTransactions({ ...options, hooks: {
    [phase]: async ({ guard }) => {
      if (phase === 'afterFilesWritten') await guard.terminate();
      process.kill(process.pid, 'SIGKILL');
    },
  } }),
}, { reuseProject: true });
main.call(fixture.evidence, fixture.bindingId).then((result) => {
  process.stderr.write(JSON.stringify(result)); process.exitCode = 2;
}).catch((error) => { process.stderr.write(error.stack); process.exitCode = 3; });
