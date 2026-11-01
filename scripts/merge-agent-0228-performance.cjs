'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function mergePerformanceReports(reports = []) {
  const first = reports[0] || {};
  const metadata = reports.find(report => Number(report.durationSeconds) > 0) || first;
  const results = reports.flatMap(report => Array.isArray(report.results) ? report.results : [report]);
  return {
    ...metadata,
    schema: 'edu.p0.host-performance-merged.v1',
    generatedAt: new Date().toISOString(),
    repeats: results.length,
    results,
    passed: results.length > 0 && results.every(result => result.passed === true),
  };
}

function main() {
  const destination = path.resolve(process.argv[2] || '');
  const inputs = process.argv.slice(3).map(value => path.resolve(value));
  if (!destination || inputs.length < 1) throw new Error('usage: node merge-agent-0228-performance.cjs <output> <input...>');
  const reports = inputs.map(file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')));
  const merged = mergePerformanceReports(reports);
  merged.sources = inputs.map(file => ({
    path: file,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
  }));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ output: destination, repeats: merged.repeats, passed: merged.passed })}\n`);
}

if (require.main === module) main();
module.exports = { mergePerformanceReports };
