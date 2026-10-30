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

Task 4a implementation: Codex research timeout now waits for the matching child close, stream drain and post-close output observation before classification. Only a confirmed read-only zero-effect timeout closes the old attempt as `safe_retry_no_output`; all incomplete/positive evidence retains the original execution for reconciliation. Retry budget is durable and the next-provider policy excludes the timed-out Provider when another configured Provider exists.

Task 4a real-host evidence: Codex CLI 0.130.0-alpha.5 PID 32564 produced a confirmed-close zero-event timeout classified `safe_retry`; isolated PID 28740 with deliberately unconfirmed termination produced `execution_unknown` and was then explicitly closed. Evidence is stored under `artifacts/p0-agent-0228/research-timeout-real-host*.json`. Web-research stability and full process-tree C4 acceptance remain Task 4b/Task 8 gates.

Task 4a verification: 52 focused tests passed across planning research, timeout recovery, research runtime, capability wakeup, durable claims and dispatch barriers; TypeScript typecheck and diff check passed.
Task 4a: complete (commits acb5ffd..6339de1, tests: node --test tests/planning-research.test.cjs tests/research-timeout-recovery.test.cjs tests/research-task-runtime.test.cjs tests/task-capability-wakeup.test.cjs tests/task-execution-claim.test.cjs tests/task-dispatch-barrier.test.cjs → ℹ duration_ms 1568.4709)

Task 4b diagnosis: the exact candidate Codex executable (`codex-cli 0.130.0-alpha.5`) failed 3/3 isolated synthetic web-research probes before tool discovery. Every run returned HTTP 400 `model_not_found` for the account default `gpt-5.5`, with zero web events and no structured output. A controlled explicit `gpt-5.6-luna` probe returned `requires a newer version of Codex`, confirming a host/CLI model-compatibility boundary rather than a research prompt or evidence parser defect.

Task 4b implementation: production does not pin an account-specific model and does not lower web-evidence truth thresholds. A pre-tool model-configuration rejection is now classified `AGENT_MODEL_UNAVAILABLE` / `not_sent`; the durable attempt closes as `safe_retry_no_output`, Codex is excluded for the retry, and the single wake queue routes to the next qualified research Provider after 15 seconds. Unknown-result protection remains unchanged.

Task 4b verification: 38 focused tests passed across host contracts, research execution/runtime, durable claims and barriers. Codex itself is explicitly unqualified (0/3) in this environment; the candidate acceptance result is therefore “automatic fallback verified”, not “Codex web research verified”. Evidence: `artifacts/p0-agent-0228/codex-research-host-diagnosis.json` and `codex-research-host-final/`.

Task 5 review: the frozen 0.22.8 delta already contains the unified batch-closure classifier, per-task reconciliation budgets, independent dependency/query backoff, source-scoped safe item recovery, three-check Smart Inbox cap, late-receipt settlement, and the explicit bulk archive/restart controls for exhausted unknown executions. Failed intake resumes through `requestResume(sourceId,itemIds)` before generic internal dispatch, so it cannot fall into a missing `input.operation` retry.

Task 5 verification: 71 focused tests passed across closure decisions, production SQLite budget persistence, task-center integration, Smart Inbox state transitions and task read-model grouping; TypeScript typecheck passed. Review found no missing production patch and no reason to reset existing receipts, execution IDs or budgets.

Task 6 review: the frozen delta already implements evidence-bound recovery planning, optimistic task/evidence revisions, Worker-paged previews, audit-appending conditional commits, current-page bulk controls and explicit consequences. It never treats a missing claim, stopped process or incomplete manual distribution as proof of no side effects.

Task 6 formal-data safety: the formal task DB was read only (36 rows; 7 reconcile_original, 1 settle_existing, 28 no_change). A new online-copy rehearsal applied 8 evidence-supported changes in 1→7 stages with task count, execution identity, budgets, result hashes and audit conservation intact; integrity=ok, foreign-key errors=0, Agent calls=0 and physical-file writes=0. The identity-bearing preview/copy remain local and untracked; only aggregate evidence is committed.

Task 6 scale evidence: 100k-task recovery scanned all 5000 pages in 2536ms; Worker page max=2ms and main event-loop max=11.96ms. The 1→20 recovery stages applied exactly 21 verified results with row conservation and integrity=ok. 30k/40k/100k material classification stayed in the Worker with ≤4ms main delay; 40k/100k projections returned ≤620 bytes; 100k task store page P95=29.58ms, patch P95=11.09ms, batch-100 P95=37.42ms, RSS delta=33.06MiB. Formal backlog mutation remains unauthorized until candidate acceptance.
Task 4b: complete (commits 814fcb3..a2d873b, tests: node --test tests/planning-research-host-contract.test.cjs tests/planning-research.test.cjs tests/research-task-runtime.test.cjs tests/task-execution-claim.test.cjs → ℹ duration_ms 1316.636)
Task 5: complete (commits c5852b7..c5852b7, tests: node --test tests/task-closure-decision.test.cjs tests/digest-reconciliation-budget.test.cjs tests/smart-inbox-task-center.test.cjs tests/smart-inbox.test.cjs tests/task-read-model.test.cjs → ℹ duration_ms 6404.4615)
Task 6: complete (commits 730ca2d..1147784, tests: node --test tests/task-backlog-recovery.test.cjs tests/digest-worker-control-plane.test.cjs → ℹ duration_ms 484.2821)
