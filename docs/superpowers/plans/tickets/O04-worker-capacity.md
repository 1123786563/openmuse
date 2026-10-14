# O04 — Bound Task worker capacity: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single bounded ticket; one agent context, TDD for the limiter seam. Predecessors O02+T11 verified+integrated.

**Goal:** §10 worker bounds: concurrent Task workers capped at 4 (a fifth runnable task stays queued and visible); queue ceiling explicit (active tasks per user 100 — 101st creation 409 with the existing limit message); excess demand never starves another user's task indefinitely (claim fairness: round-robin or oldest-first across owners — cite what the WorkQueue already provides and enforce what's missing).

**Architecture:** Task 0: audit the WorkQueue's claim semantics (concurrency per owner process — how multiple workers claim: the queue's claim(limit) + lease; whether claim is owner-fair). Implement `workerCapacity` guard: the task runner's sweep claim limit derives from env `OPENMUSE_TASK_WORKERS` default 4 (each sweep claims at most the free slots: 4 − running); per-user active-task cap 100 enforced at create (Task 0: check whether the mobile-bff create path has it — the legacy service limit message exists in OpenMuse; port the check into openmuse-tasks routes); fairness: if the queue's claim is purely oldest-first, add an owner-round-robin tiebreak inside the claim query (ORDER BY with owner rotation — or assert the existing behavior is starvation-free within the lease window and record). Baseline script: document the envs.

**Spec:** Contracts §10 rows 4-6; catalog O04; Issue #91. S42 is the live card.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Create server/src/openmuse-tasks/capacity.ts (or extend the sweep), server/tests/openmuse-task-capacity.test.ts; Modify server/src/openmuse-tasks/{runner.ts,routes.ts} minimally + baseline script env comments. NO app.ts/index.ts. Never touch openmuse-deletion/computer (concurrent worker).

### Task 0

- [ ] Cite: the queue's claim/lease semantics for concurrency + ordering (work/queue.ts), and whether a per-user active cap exists on the openmuse-tasks create path.

### Task 1: RED — tests

1. concurrency: with 4 running (fake running set), a sweep claims ZERO additional; 3 running → claims 1; the env overrides the cap;
2. per-user cap: 100 active (queued+running+waiting) → 101st create 409 with the existing-style message; terminal tasks don't count;
3. fairness: two owners' runnable tasks interleave (with equal ages, one claim each — or the recorded assertion that oldest-first + lease renewal cannot starve within bounds);
4. visible queued state: the fifth runnable stays queued and listable (no silent drop).

### Task 2: GREEN

- Implement per matrix (Task 0 citations + fairness decision recorded); per-file tests green (capacity + tasks + runner + ready); typecheck + biome clean.

### Task 3: Checkpoint

- Report: Task 0 citations + fairness decision, files + shasum, test tails, S42 deferred note. No commit.

## Failure handling

- If the queue cannot express owner-fair claiming, enforce the per-user cap + concurrency bounds and record the fairness gap for O05's visibility (never fake it).
