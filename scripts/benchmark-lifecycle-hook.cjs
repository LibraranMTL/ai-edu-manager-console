const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { compileLifecycleHook } = require('./compile-lifecycle-hook.cjs');

if (process.platform !== 'win32') throw new Error('Windows-only lifecycle hook benchmark.');
const root = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-lifecycle-benchmark-'));
try {
  const executable = compileLifecycleHook(
    path.join(root, 'electron', 'agent-lifecycle-hook.cs'),
    path.join(tempRoot, 'agent-lifecycle-hook.exe'),
  );
  const descriptorPath = path.join(tempRoot, 'descriptor.json');
  const queueDir = path.join(tempRoot, 'queue');
  fs.writeFileSync(descriptorPath, JSON.stringify({
    authentication: { grantId: 'benchmark-grant' },
    defaults: { scopeId: 'benchmark-student' },
    lifecycleCapture: { enabled: true, captureEpoch: 'benchmark-epoch', allowedAgents: ['codex'], queueDir },
  }), 'utf8');
  const samples = [];
  for (let index = 0; index < 30; index += 1) {
    const event = index % 2 === 0
      ? { hook_event_name: 'UserPromptSubmit', session_id: 'benchmark-session', turn_id: `turn-${index}`, prompt: `测试提问 ${index} 🧪` }
      : { hook_event_name: 'Stop', session_id: 'benchmark-session', turn_id: `turn-${index - 1}`, last_assistant_message: `测试回答 ${index}` };
    const started = performance.now();
    const result = spawnSync(executable, [
      '-Descriptor', descriptorPath, '-SourceAgent', 'codex', '-ManagedMarker', 'EDU-MANAGER-LIFECYCLE',
    ], { input: JSON.stringify(event), encoding: 'utf8', windowsHide: true, timeout: 3000 });
    samples.push(performance.now() - started);
    if (result.status !== 0 || JSON.parse(result.stdout || 'null') == null) throw new Error(`Hook failed at sample ${index}`);
  }
  const queued = fs.readdirSync(queueDir).filter((name) => name.endsWith('.json'));
  if (queued.length !== samples.length) throw new Error(`Expected ${samples.length} queued events, found ${queued.length}`);
  const sorted = [...samples].sort((a, b) => a - b);
  const result = {
    samples: samples.length,
    queueEvents: queued.length,
    medianMs: Math.round(sorted[Math.floor(sorted.length / 2)]),
    p95Ms: Math.round(sorted[Math.ceil(sorted.length * 0.95) - 1]),
    maxMs: Math.round(sorted.at(-1)),
    targetP95Ms: 350,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.p95Ms > result.targetP95Ms) process.exitCode = 1;
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
