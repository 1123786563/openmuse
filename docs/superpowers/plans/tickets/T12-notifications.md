# T12 — Notify Task and Monitor owners: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessors T03+T11 verified+itegrated.

**Goal:** §7 notifications: the enumerated events — `task.succeeded`, `task.failed`, `task.waiting_input`, `task.waiting_review`, `monitor.matched` — each create exactly ONE user-scoped item keyed `userId/taskId/eventKind/attemptOrObservationId`; per-user `readAt` persists; foreign user cannot mark; events are EMITTED by the owning transition (runner/wait paths), never inferred by polling.

**Architecture:** New module `server/src/openmuse-notifications/` (drizzle `openmuse_notifications`: id, userId, taskId, eventKind, attemptKey, title, detail, createdAt, readAt; unique(userId, taskId, eventKind, attemptKey); §9 hooks). `emit(deps)` seam called from openmuse-tasks' runner/settle paths (succeeded/failed/waiting_input via T08's wait open; waiting_review reserved as a constant — its producer is T16, recorded) and from T11's matched check result; list/read routes under the same mobile-bff mount family (app.ts ONE tail param if needed — prefer extending the tasks mount's deps; choose minimal, record).

**Spec:** Contracts §7 Task notifications; catalog T12; Issue #69.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Create server/src/openmuse-notifications/{store.ts,routes.ts}, server/tests/openmuse-notifications.test.ts, migration 00NN (SQL verbatim); Modify server/src/openmuse-tasks/{runner.ts,store.ts (settle/wait touchpoints — emit calls only)}, server/tests/openmuse-task-runner.test.ts (emission asserts), app.ts/index.ts wiring per the chosen mount (ready.test.ts offset if appended). Never touch openmuse-reviewed-actions (concurrent worker).

### Task 1: RED — tests

1. emission on transitions: runner success → one task.succeeded item (attemptKey = attempts number); failure → task.failed; wait open (T08 path) → task.waiting_input; monitor matched (T11's matched=true) → monitor.matched with attemptKey = observation hash; waiting_review constant defined but NOT emitted (T16 producer recorded);
2. exactly-once: duplicate emission with the same key → no second row (unique index; idempotent emit);
3. list: owner-scoped newest-first with readAt; mark-read: own item → readAt set once (repeat idempotent); foreign item → 404/403 (choose per siblings — 404);
4. §9 hooks (disableOwner/enumerateOwner).

### Task 2: GREEN

- Implement + migration + emission wiring (transition-emit only — no polling); `bun test tests/openmuse-notifications.test.ts tests/openmuse-task-runner.test.ts tests/openmuse-tasks.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: mount choice, migration SQL, files + shasum, test tails, S37 live note deferred. No commit.

## Failure handling

- Emission failures must never fail the task transition: emit is best-effort with error logged (assert the transition completes when emit throws).
