const path = require('node:path');
const { createProjectArchiveTransactions } = require('../../electron/project-archive-transaction.cjs');
const [root, phase] = process.argv.slice(2);
if (!path.isAbsolute(root || '') || !path.basename(root).startsWith('edu-archive-transaction-')) throw new Error('synthetic fixture root required');
async function crash({ guard } = {}) {
  if (phase === 'afterFilesWritten') await guard.terminate();
  process.kill(process.pid, 'SIGKILL');
}
const service = createProjectArchiveTransactions({ directory: path.join(root, 'journal'), projectId: 'p1',
  roots: [path.join(root, 'student'), path.join(root, 'host')], authorize: async () => true, hooks: { [phase]: crash } });
const transaction = service.begin({ operation: 'synthetic' });
transaction.io.writeFileSync(path.join(root, 'student', 'evidence.md'), 'new evidence');
transaction.io.writeFileSync(path.join(root, 'host', 'projects.json'), '{"published":true}');
transaction.commit({ ok: true, message: 'synthetic done' }).catch((error) => { process.stderr.write(error.stack); process.exitCode = 1; });
