# T02 — Execute one Task with the existing headless runner: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessors T01+C01 verified+integrated.

**Goal:** A queued agent Task is offered to and claimed from the EXISTING WorkQueue exactly once, runs a one-step private-Bot turn through the existing headless turn seam, and reaches `succeeded`/`failed` within a configurable deadline (default 300s); the client may be closed the whole time; no second lease system is added.

**Architecture:** Mirror `createWakeUpRunner` (server/src/agents/wake-up.ts:410-470 — READ prior art) as `createOpenMuseTaskRunner` in `server/src/openmuse-tasks/runner.ts`: queue.claim({kind:"openmuse-task", leaseMs}) → load task row → status `running` → `runTurn({ownerUserId, agentId, threadId, prompt})` (injectable seam, wired in index.ts to the SAME headless turn implementation wake-up uses — find its wiring and cite) → deadline-guarded (AbortSignal.timeout(TASK_DEADLINE_MS)) → `succeeded` with a result step/evidence entry, or `failed` with error detail → queue.finish. Steps/evidence shapes from contract §7 (step: pending→succeeded/failed; evidence kind "user" for the prompt, result captured as run event).

**Tech Stack:** WorkQueue (server/src/work/queue.ts — offer/claim/finish, database-clock lease), drizzle update on openmuse_tasks, bun:test with fake queue+rows+turn.

**Spec:**
- Contracts §7 Task minimum + Small first path: /Users/wuyongjun/trea/openmuse/.worktrees/v4-base/docs/superpowers/plans/2026-10-12-openmuse-openbot-contracts-v4.md
- Catalog T02; Issue #58. T01 module at server/src/openmuse-tasks/.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Create server/src/openmuse-tasks/runner.ts, server/tests/openmuse-task-runner.test.ts; Modify server/src/openmuse-tasks/{store.ts,routes.ts} (T01's POST offers to the queue after insert; add offer to the create path), server/src/app.ts (ONE appended tail param `openMuseTaskRunnerSweep?` ONLY if wiring requires; prefer index.ts-side loop like wake-up's — check how wake-up's sweep is scheduled (rg "sweep" in server/src/index.ts) and mirror WITHOUT app.ts changes if possible), server/src/index.ts (construction + scheduling), drizzle migration ONLY if a column is missing (steps/evidence already exist — no new columns expected; if needed, generate + report).
- Deadline env: `OPENMUSE_TASK_DEADLINE_MS` default 300_000 (read via process.env in module; document).
- Do NOT touch: wake-up.ts (prior art), plugins/, computer/, admin/, openmuse-files/, openmuse-connectors/.

### Task 1: RED — runner tests

- [ ] **Step 1:** server/tests/openmuse-task-runner.test.ts (fake queue with claim-once semantics, fake rows, fake runTurn):
  1. sweep claims the offered item once, task goes queued→running→succeeded, steps gain one succeeded step, evidence gains prompt (kind "user") + result entries, queue.finish called, updatedAt advanced;
  2. runTurn rejects → failed with error detail (≤500 chars) recorded, failed step;
  3. runTurn hangs past deadline (fake timer/injected short deadline) → failed with timeout cause; turn promise ignored (no unhandled rejection — await Promise.race pattern);
  4. claim returns nothing → sweep no-ops;
  5. task row missing/deleted between offer and claim → item finished with a skip, no crash;
  6. second sweep after success does NOT re-run (queue already finished; fake enforces);
  7. POST /openmuse-tasks now offers {kind:"openmuse-task", key:task.id} to the queue exactly once per created row (idempotent retry does NOT re-offer);
  8. lease semantics: fake queue's claim respects leaseMs (assert the runner passes leaseMs ≥ deadline).
- [ ] **Step 2:** `bun test tests/openmuse-task-runner.test.ts` → FAIL.

### Task 2: GREEN

- [ ] **Step 1:** runner.ts per matrix; statuses through the store's update (add `updateStatus/appendStep/appendEvidence` to store.ts if absent — keep T01 shapes).
- [ ] **Step 2:** routes.ts create path offers to queue (inject queue dep into the routes factory like the store — test app passes a fake; production wiring in index.ts).
- [ ] **Step 3:** index.ts: construct runner with the SAME runTurn implementation wake-up uses (cite its wiring line); schedule sweep like wake-up (listener/poll — mirror exactly); if app.ts tail param unavoidable, add ONE appended param + ready.test.ts offset update.
- [ ] **Step 4:** `bun test tests/openmuse-task-runner.test.ts tests/openmuse-tasks.test.ts tests/ready.test.ts` → PASS; typecheck + biome clean.

### Task 3: Checkpoint

- [ ] Report: runTurn wiring citation (file:line), scheduling mechanism, changed files + shasum, test tails, deadline default, statement that live closed-client execution evidence (S28) is gate-level. No commit.

## Acceptance (Issue #58 / catalog T02)

WorkQueue offers/claims Task once; one-step private Bot turn reaches succeeded/failed within the configured deadline; client may close; no second lease table. Verified by Task 1 (claim-once, deadline, finish, no-replay) with the real WorkQueue semantics honored via the fake's contract (leaseMs/maxAttempts passed through).

## Failure handling

- If wake-up's runTurn seam is not reusable for a prompt-driven turn, implement a minimal turn seam (prompt → agent reply text) and wire it to whatever server-side agent invocation exists (cite); record the choice.
- If scheduling needs a new loop (server/src/work/loop.ts pattern), reuse that pattern rather than inventing one.
