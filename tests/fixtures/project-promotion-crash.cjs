const fs = require('node:fs');
const path = require('node:path');
const { createProjectArchiveTransactions } = require('../../electron/project-archive-transaction.cjs');
const { createPromotionContext } = require('./project-promotion-runtime.cjs');
const [root, phase] = process.argv.slice(2);
if (!path.isAbsolute(root || '') || !path.basename(root).startsWith('edu-material-promotion-')
  || !['afterPrepared', 'afterFilesWritten', 'afterFinalized'].includes(phase)) throw new Error('synthetic crash fixture required');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'crash-input.json')));
if (fixture.root !== root) throw new Error('fixture root mismatch');
const main = createPromotionContext(fixture, {
  createProjectArchiveTransactions: (options) => createProjectArchiveTransactions({ ...options, hooks: {
    [phase]: async ({ guard }) => {
      if (phase === 'afterFilesWritten') await guard.terminate();
      process.kill(process.pid, 'SIGKILL');
    },
  } }),
});
main.execute(fixture.input).then((result) => {
  process.stderr.write(JSON.stringify(result)); process.exitCode = 2;
}).catch((error) => { process.stderr.write(error.stack); process.exitCode = 3; });
