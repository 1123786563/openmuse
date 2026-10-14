# T04 — Cancel a Task: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessor T02 verified+integrated.

**Goal:** The §7 cancel matrix: queued/scheduled → cancelled immediately; running → sets internal `cancellationRequested`, public status STAYS `running` until the current safe step ends, then `cancelled`; terminal (succeeded/cancelled/failed) → 409 with current status; the runner honors the flag between safe steps.

**Architecture:** Store gains `requestCancel(ownerUserId, id)` (CAS transitions per matrix + `cancellation_requested` column, migration 00NN) and the runner checks the flag after its turn completes (the one-step task's safe boundary) — cancel during running lands as cancelled with a status note rather than fabricating mid-turn interruption. Route `POST /:id/cancel` (owner-scoped; foreign 404).

**Tech:** drizzle migration, Hono, bun:test (fake rows + fake queue honoring claim/finish once).

**Spec:** Contracts §7 control transitions; catalog T04; Issue #61. T01/T02 module in place.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-tasks/{store.ts,routes.ts,runner.ts}, server/tests/openmuse-{tasks,task-runner}.test.ts; Create migration 00NN (db:generate with DATABASE_URL; SQL verbatim; no migrate). NO app.ts/index.ts edits (route mounts inside the existing sub-app).

### Task 1: RED — cancel matrix tests

1. queued → cancel → cancelled immediately (200, status cancelled, attempts unchanged);
2. scheduled → cancelled (same);
3. running → cancel → 200 `{status:"running", cancellationRequested:true}`; after the runner's sweep completes the turn → status cancelled (runner test: flag set mid-run via injected hook, turn still finishes, final status cancelled, NOT succeeded);
4. succeeded → cancel → 409 {currentStatus:"succeeded"}; cancelled → 409; failed → 409;
5. already-cancelRequested running → second cancel idempotent 200 (same body, no double flag);
6. foreign owner → 404; missing → 404;
7. §9: disabled owner → 403.

### Task 2: GREEN

- Migration adds `cancellation_requested boolean NOT NULL DEFAULT false`; store CAS per matrix; runner post-turn check (and pre-turn: a cancel that lands before claim → the sweep skips execution and finishes cancelled); route wiring.
- `bun test tests/openmuse-tasks.test.ts tests/openmuse-task-runner.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: migration SQL, changed files + shasum, test tails, S33 live deferred note. No commit.

## Failure handling

- If the queue's finish semantics fight a cancelled-before-claim item (e.g. it re-offers), use the store's cancelled status as the sweep's skip guard and record the interplay.
