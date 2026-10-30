# SDD ledger — plan: docs/superpowers/plans/2026-10-29-windows-0.22.8-agent-readiness-and-closure-revised.md

Setup: isolated worktree `D:/群星矩阵文件/智能体开发项目/AI教育管家/.worktrees/windows-0228-agent-closure`, branch `codex/windows-0228-agent-closure`, base `1bc23c68d09c495bd0f9d2800ccbe1d46b5c937e`.

Setup: current 0.22.8 tracked working-tree diff and untracked files under `electron/`, `tests/`, `scripts/`, `src/`, `docs/`, and `artifacts/p0-agent-0228/` were copied into the isolated worktree. The original 354-item working tree was not modified.

Ruling: treat the copied state as an isolated, non-merge baseline snapshot — the plan depends on existing uncommitted 0.22.8 implementation that is absent from Git HEAD — cost if wrong: a relevant dependency outside the selected paths may be missing and will surface as a baseline test or provenance failure before production edits.

Spec: `D:/AI教育管家资料收集箱/Windows_0.22.8_Agent_修复方案技术评估.md` is not present on disk; rulings that depended only on it are provisional. The reachable prior P0 plan is `docs/superpowers/plans/2026-10-27-windows-p0-task-automation-and-connectivity-repair.md`; the revised 0.22.8 plan is the binding implementation brief for this run.

Pre-flight: Task 2 produces per-provider readiness consumed by Tasks 4, 4a, 4b, and 8; current names align on `providerId/profileId/configRevision`, but Task 2 must stop early-waiting on a refreshing provider before those consumers are valid.

Pre-flight: Task 3 produces persistent execution attempts and send barriers consumed by Tasks 4a, 5, 6, 7, and 8; current v5 schema exists, so execution will verify and patch missing entry points rather than remigrate.

Pre-flight: Task 4 produces the single wake queue consumed by Task 4a safe retry and Task 5 reconciliation; `nextRetryAt` owns dispatch retries while `reconcileAttempt.nextCheckAt` owns receipt checks.

Pre-flight: Task 5a is intentionally executed before Task 2 although documented after Task 5; it has no dependency on Task 5's external execution reconciliation and stops new unassigned task pollution.

Pre-flight: Task 5 closure decisions feed Task 6 backlog plans and Task 7 display; `execution_unknown` remains protected and cannot be converted into a safe retry without Task 3/4a evidence.

Pre-flight: Tasks 1–7 and 4a/4b/5a produce evidence consumed by Task 8; Task 8 may package only one frozen runtime whose source hashes match that evidence.

Task 00: started from `1bc23c68d09c495bd0f9d2800ccbe1d46b5c937e` via `task-start`; the negative task number was normalized to `Task 00` because the mandatory helper only accepts unsigned task numbers.

Task 00: `pnpm test` -> 2731 tests, 2730 passed, 0 failed, 1 skipped after completing isolated-only JDK/release fixtures. Focused Windows delta -> 52/52 passed.

Task 00: `D:/学生资料/.edu-manager/task-center/task-state.sqlite3` inspected read-only, `user_version=5`, `task_execution_attempts` present.

Task 00: running r13 EXE SHA-256 `0EA194E6FF0FB31B5989103EC5A3DC9F8A22921E144D2FCAF1C5FE0D2C5CB483`; ZIP SHA-256 `BE7AD1BA9AC5B233E2C400CC5FABB370CD8AC80AF04D799988C776F892DEABC0`; source equivalence remains `not_run`.

Ruling: Task 1/3/4/5/7 are verified review-only baselines; Task 2 is partial; Task 4a/4b/5a are missing; Task 0/6/8 are partial. This freezes production scope before any code change.

Task 0: refreshed the read-only baseline and evidence index against the running r13 EXE hash and the frozen source snapshot. Four sampled timelines identify manual fallback, inbox review, unresolved digest, and one successful Codex control without reading student content.

Ruling: r13 runtime evidence is historical until a build audit proves source equivalence; internal workload, injected failures, completion counts, and timer latency cannot substitute real-agent throughput or visible interaction.
Task 00: complete (commits 1bc23c6..7957e09, tests: node -e 'const fs=require('fs');const d=JSON.parse(fs.readFileSync('artifacts/p0-agent-0228/current-delta.json','utf8'));if(d.items.length!==12||d.items.some(x=>['partial','missing'].includes(x.status)&&(!x.ownerTask||!x.remainingPatch)))process.exit(1);console.log('delta-consistency-ok')' → delta-consistency-ok)
Task 0: complete (commits 23ba435..ea56dc4, tests: node -e 'const fs=require('fs'),c=require('crypto');const i=JSON.parse(fs.readFileSync('artifacts/p0-agent-0228/evidence-index.json'));for(const x of i.evidenceFiles){const b=fs.readFileSync(x.path);if(c.createHash('sha256').update(b).digest('hex').toUpperCase()!==x.sha256)process.exit(1)}console.log('evidence-index-ok')' → evidence-index-ok)

Task 1 review: 17/17 evidence-gate tests passed, including injected/internal substitution rejection, hash mismatch, contradictory raw summary, missing baseline, no measured improvement, and reordered/duplicate execution. No production or threshold change is needed.
Task 1: complete (commits 2f35972..2f35972, tests: node --test tests/p0-agent-0228-evidence.test.cjs tests/p0-evidence-gate.test.cjs → ℹ duration_ms 1868.606)

Task 5a: TDD reproduced unbound-source task pollution and source-disable persistence failure. New unassigned discoveries now stay in Smart Inbox as `review/unassigned`, bypass `beginBatch`, preserve the original, and create no task-center or Agent execution. Confirming a student creates exactly one normal task. Disabling or detaching a source now also persists `automatic=false`, clears pending/manual/resume/resource-wait state, and survives restart.

Task 5a verification: `node --test tests/smart-inbox-task-center.test.cjs tests/smart-inbox.test.cjs` → 64 passed, 0 failed; `pnpm typecheck` → passed.
Task 5a: complete (commits 3afbe34..0e8fc85, tests: node --test tests/smart-inbox-task-center.test.cjs tests/smart-inbox.test.cjs → ℹ duration_ms 6151.0701)

Task 2: TDD reproduced the provider-order defect: a refreshing Provider A hid a fresh available Provider B. `ensureReady` now scans all candidates for fresh positive evidence before waiting on a shared refresh, while an explicit lock still waits for the locked provider. Probe errors retain tri-state semantics and now expose bounded `lastError` evidence to the task wait projection.

Task 2 verification: readiness/control-plane/task-channel/capability-wakeup suites → 41 passed, 0 failed; `pnpm typecheck` → passed.
Task 2: complete (commits 517da8d..6d39170, tests: node --test tests/agent-capability-readiness.test.cjs tests/agent-control-plane.test.cjs tests/agent-task-channel.test.cjs tests/task-capability-wakeup.test.cjs → ℹ duration_ms 795.8621)

Task 3 review: existing v5 execution ledger, Worker claim/advance operations, single-writer cache synchronization, partial unique indexes, restart/lost-reply protection, and pre-spawn `send_intent` barrier all passed. Resource/capability waits remain before persistent claim. No production change or migration rerun was warranted.

Task 3 verification: execution-claim/dispatch-barrier/Worker-durability/session-summary/incremental-store suites → 32 passed, 0 failed.
Task 3: complete (commits fa25009..74d7595, tests: node --test tests/task-execution-claim.test.cjs tests/task-dispatch-barrier.test.cjs tests/task-worker-durability.test.cjs tests/task-session-summary.test.cjs tests/task-incremental-v2.test.cjs → ℹ duration_ms 1333.2923)

Task 4 review: the automatic wake queue already owns bounded timers, earlier-deadline replacement, 20-item drains, SQL-paged restart restoration, targeted capability wakeups, and shutdown cleanup. Capability waits remain automatic and do not consume execution attempts or manufacture manual handoffs. No production change was needed.

Task 4 verification: capability-wakeup/auto-dispatch/task-performance/read-model/retry-queue suites → 29 passed, 0 failed.
Task 4: complete (commits 0ef89b4..98b330e, tests: node --test tests/task-capability-wakeup.test.cjs tests/task-auto-dispatch.test.cjs tests/task-performance.test.cjs tests/task-read-model.test.cjs → ℹ duration_ms 1861.385)
