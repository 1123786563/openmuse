# T06 — Retry a failed Task: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessor T03 verified+integrated (T04/T05/T07 flags in place).

**Goal:** §7 retry: failed → queued as a NEW attempt (attempts+1) while ALL old steps/evidence are retained; succeeded/cancelled → 409; retry idempotency key creates only one attempt (concurrent retries → one new attempt); the re-offer goes to the queue exactly once per accepted retry.

**Architecture:** Store `retry(owner, id, idempotencyKey?)`: CAS failed→queued (attempts+1, clear cancellation/pause flags, preserve steps/evidence rows), retry-key guard (a `retry_key` column or reuse: Task 0 decide — prefer a nullable `last_retry_key` + CAS to prevent double-apply); routes `POST /:id/retry` (owner-scoped; Idempotency-Key header); the queue offer goes through the same injected seam the create path uses.

**Spec:** Contracts §7 (failed→queued only as a new attempt; terminal never resumes; retry idempotency); catalog T06; Issue #63.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-tasks/{store.ts,routes.ts}, server/tests/openmuse-tasks.test.ts; migration 00NN only if the retry-key guard needs a column (SQL verbatim; no app.ts/index.ts).

### Task 1: RED — tests

1. failed → retry → queued, attempts 2, old steps/evidence intact (assert row contents unchanged besides status/flags/attempts);
2. succeeded → 409 currentStatus; cancelled → 409; queued → 409 (already runnable);
3. retry with Idempotency-Key: two concurrent retries same key → ONE accepted (second returns the already-retried record, attempts unchanged by the second), different keys sequentially → two attempts (3 total) — document the allowed cadence;
4. re-offer exactly once per accepted retry (queue fake counts);
5. foreign owner 404; disabled owner 403;
6. runner compatibility: a retried (queued) task runs again and lands terminal with BOTH attempts' evidence visible (steps from attempt 1 preserved, new steps appended).

### Task 2: GREEN

- Implement per matrix (Task 0 decision recorded); migration if needed.
- `bun test tests/openmuse-tasks.test.ts tests/openmuse-task-runner.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: retry-key decision, migration SQL if any, files + shasum, test tails, S33 deferred note. No commit.

## Failure handling

- If preserving old steps across attempts conflicts with the runner's expectations (it may expect a clean step list), record the interplay and keep preservation — §7 demands old evidence retention; adjust the runner's read path instead.
