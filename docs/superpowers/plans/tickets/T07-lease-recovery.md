# T07 — Recover a lost Task lease: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessor T02 verified+integrated (T04/T05's flags also in place).

**Goal:** §7 lease recovery: lease loss BEFORE any external effect requeues the task exactly once (one recovered attempt); after an unconfirmed possible external effect it records a reconciliation wait/failure and does NOT replay; a stale worker cannot finish a new owner's claim.

**Architecture:** The WorkQueue already owns leases (database clock, claim/renew/finish — server/src/work/queue.ts). The task runner's sweep gains: (1) on claim of a task whose row is already `running` from a PREVIOUS attempt (queue re-offered after lease expiry — Task 0 confirms how an expired item reappears: attempts/maxAttempts semantics), detect prior-effect evidence: if the previous attempt recorded ANY step/evidence marking external activity (a `hadExternalEffect` marker the runner sets when runTurn resolves ambiguously — model it as: runTurn rejected with ambiguity or the attempt row lacks a completion marker), land `failed` with a reconciliation-wait detail instead of re-running; if provably no effect (no step transitioned past 'started', no evidence entries), requeue → re-run as a NEW attempt (attempts+1); (2) finish-token guard: the runner captures the claim's lease identity (item key + attempt generation) and a stale sweep's finish for an old generation is refused by the store (CAS on attempts).

**Spec:** Contracts §7 (lease loss before/after external effect; stale worker cannot finish a new owner's claim); catalog T07; Issue #64. F-TASK-1/F-TASK-2 are the gate-level live cards.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-tasks/{runner.ts,store.ts}, server/tests/openmuse-task-runner.test.ts; Create server/tests/openmuse-task-lease-recovery.test.ts; migration ONLY if a column is genuinely needed (e.g. attempt-generation/lease marker) — prefer reusing `attempts` + steps/evidence; generate + report SQL if added.

### Task 0 (facts; record)

- [ ] Cite from work/queue.ts: what happens to an item whose lease expires (re-offered? attempts++? maxAttempts default?) and what `claim` returns for a re-appearing item; how `finish` is keyed (kind+key+owner). Record the exact interplay your runner must honor.

### Task 1: RED — recovery tests (fake queue with lease-expiry simulation)

1. lease expires before any effect (previous attempt: status running, zero steps advanced, zero evidence) → next sweep claims, re-runs as new attempt (attempts 2), lands succeeded — ONE recovered attempt total, no lost task;
2. lease expires after possible external effect (previous attempt: evidence row present / ambiguous turn marker) → next sweep does NOT re-run: status failed with reconciliation-wait detail naming the ambiguity; attempts unchanged;
3. stale finish: old-generation sweep tries to write the final status after a new owner claimed (store CAS on attempts) → write refused, new owner's outcome preserved;
4. requeue exactly once: a recovered-and-failed-again item does not loop forever (queue maxAttempts honored — fake asserts finish called);
5. F-TASK-2 shape: ambiguous runTurn (throws an AmbiguousTurnError-like marker rather than clean failure) → reconciliation-wait path (not plain failed).

### Task 2: GREEN

- Runner recovery logic per matrix + Task 0 facts; store CAS (update...where attempts = expected); migration only if required.
- `bun test tests/openmuse-task-lease-recovery.test.ts tests/openmuse-task-runner.test.ts tests/openmuse-tasks.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: Task 0 citations, migration SQL if any, files + shasum, test tails, F-TASK-1/2 deferred note. No commit.

## Failure handling

- If the queue's expiry semantics differ from the plan's assumption, implement what Task 0 proves and record the divergence — never fight the queue's contract.
