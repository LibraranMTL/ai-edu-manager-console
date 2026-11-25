'use strict';
// Read-only live ledger audit. Private reports belong outside the checkout.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const [baselineFile, outputDirectory] = process.argv.slice(2);
if (!baselineFile || !outputDirectory) throw Error('Provide baseline JSON and an external output directory');
const root = path.join(process.env.APPDATA, 'edu-manager-launcher', 'smart-inbox');
const output = path.resolve(outputDirectory), checkout = path.resolve(__dirname, '..');
if (output === checkout || output.startsWith(checkout + path.sep) || output === root || output.startsWith(root + path.sep)) throw Error('Report must be outside checkout and live inbox');
const read = kind => fs.readdirSync(path.join(root, kind)).filter(n => n.endsWith('.json')).map(n => JSON.parse(fs.readFileSync(path.join(root, kind, n), 'utf8')));
const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8')), items = new Map(read('items').map(i => [i.id, i]));
const rows = [];
for (const [cohort, originals] of Object.entries(baseline.cohorts)) for (const before of originals) {
  const after = items.get(before.id);
  let receiptVerified = false;
  if (after?.status === 'delivered' && after.receipt?.path && fs.existsSync(after.receipt.path)) receiptVerified = crypto.createHash('sha256').update(fs.readFileSync(after.receipt.path)).digest('hex') === after.fingerprint.sha256;
  rows.push({ cohort, id: before.id, name: before.name, previousStatus: before.status, currentStatus: after?.status || 'missing',
    previousStudent: before.studentId, currentStudent: after?.studentId, reasonCode: after?.reasonCode, message: after?.message,
    technicalWaiting: Boolean(after && !after.originalMissing && (['execution_unknown', 'delivery_reconcile', 'archive_pending'].includes(after.status)
      || after.status === 'review' && (['classification_invalid', 'extraction_incomplete'].includes(after.reasonCode) || after.blockReason?.category === 'agent'))),
    receiptVerified, cleanup: after?.cleanup || null, callsInCurrentBudget: after?.analysisWork?.calls || 0,
    localResultRepair: after?.localResultRepair || null, operationId: after?.operationId || '',
    recoveredOriginalOperation: after?.deliveryRecovery?.operationId === before.operationId,
    manuallyLocked: after?.manualLocked || false });
}
const aggregate = (list, key) => list.reduce((counts, row) => { const value = key(row); counts[value] = (counts[value] || 0) + 1; return counts; }, {});
const returned = fs.existsSync(path.join(root, 'raw-results')) ? read('raw-results').filter(r => r.at >= baseline.capturedAt && rows.some(row => row.id === r.itemId)) : [];
const budgets = fs.existsSync(path.join(root, 'analysis-budgets')) ? read('analysis-budgets').filter(b => b.at >= baseline.capturedAt) : [];
const repeatedContexts = aggregate(returned, r => JSON.stringify([r.itemId, r.contextHash, r.purpose]));
const manual = read('decisions').flatMap(d => d.result?.results || d.results || []).filter(r =>
  r.ok && r.feedback?.at >= baseline.capturedAt && rows.some(row => row.id === r.id)
  && ['accept', 'correct', 'confirm_student', 'reassign_student', 'ignore'].includes(r.feedback.action));
const report = { schema: 'edu-manager.smart-inbox-r7-recovery-review.v1', observedAt: new Date().toISOString(), baselineAt: baseline.capturedAt,
  cohorts: Object.fromEntries(Object.keys(baseline.cohorts).map(cohort => { const selected = rows.filter(row => row.cohort === cohort); return [cohort, {
    total: selected.length, statuses: aggregate(selected, row => row.currentStatus), technicalWaiting: selected.filter(r => r.technicalWaiting).length,
    verifiedDelivered: selected.filter(r => r.receiptVerified).length, recycled: selected.filter(r => r.cleanup?.stage === 'recycled' && r.currentStatus === 'ignored').length }]; })),
  metrics: { returnedClassificationResults: returned.length, reservedAnalysisBudgetCalls: budgets.reduce((sum, b) => sum + Number(b.calls || 0), 0),
    repeatedReturnedContextsIncludingRetries: Object.values(repeatedContexts).reduce((sum, n) => sum + Math.max(0, n - 1), 0),
    explicitConfirmationOrCorrectionActions: manual.length,
    settled: rows.filter(r => r.receiptVerified || r.currentStatus === 'ignored' && r.cleanup).length,
    technicalWaiting: rows.filter(r => r.technicalWaiting).length,
    processing: rows.filter(r => ['pending', 'retry', 'analyzing', 'delivering'].includes(r.currentStatus)).length,
    localResultRepairs: rows.filter(r => r.localResultRepair?.at >= baseline.capturedAt).length,
    businessReview: rows.filter(r => r.currentStatus === 'review' && !r.technicalWaiting).length,
    releasedBytes: rows.reduce((sum, r) => sum + (r.cleanup?.releasedBytes || 0), 0) },
  boundary: 'Point-in-time audit. Waiting/in-progress are not successes. Reserved budget calls and returned results are not billed-call totals; repeated contexts include permitted retries. Explicit action count is not user time or all UI operations. Originals are not purge targets.', rows };
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'r7-recovery-review.json'), JSON.stringify(report, null, 2));
const fields = ['cohort', 'id', 'name', 'previousStatus', 'currentStatus', 'previousStudent', 'currentStudent', 'reasonCode', 'message', 'technicalWaiting', 'receiptVerified', 'callsInCurrentBudget', 'operationId', 'recoveredOriginalOperation'];
const quote = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
fs.writeFileSync(path.join(output, 'r7-历史资料恢复明细.csv'), '\ufeff' + [fields, ...rows.map(r => fields.map(k => r[k]))].map(r => r.map(quote).join(',')).join('\r\n'));
console.log(JSON.stringify({ observedAt: report.observedAt, cohorts: report.cohorts, metrics: report.metrics, output }, null, 2));
