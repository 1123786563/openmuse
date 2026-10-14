# T10 — Schedule a Monitor: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessor T02 verified+integrated.

**Goal:** §7 Monitor: creation validates condition change|contains|price_below with interval 1–10,080 minutes; scheduling uses UTC database time with a stored `nextCheckAt` (a due check runs at-or-after that instant — clock-controlled tests); the runner executes a due check via an injectable `checkMonitor` seam; stop (cancel/pause per T04/T05) prevents later offers.

**Architecture:** Extend `openmuse-tasks`: kind `monitor` rows gain monitor metadata (migration 00NN: `monitor_condition` jsonb {type, source?, selector?, threshold?} + `next_check_at` timestamptz); creation zod per matrix (price_below requires a numeric threshold; contains/change require a source string); the runner sweep claims due monitors (claim with runAt semantics — Task 0: cite the queue's scheduled-offer support `runAt` from work/queue.ts offer; if the queue supports delayed items, offer with runAt=nextCheckAt; else poll-sweep due rows — choose + record); after a check runs, nextCheckAt advances by interval (UTC) and the task stays `scheduled` (running during the check); cancel/pause stop future claims (assert with the existing flags).

**Spec:** Contracts §7 Monitor; catalog T10; Issue #67. Observation dedup/backoff is T11's — a check here simply records its raw observation as evidence (one row per check).

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-tasks/{store.ts,routes.ts,runner.ts}, server/tests/openmuse-{tasks,task-runner}.test.ts; migration 00NN (SQL verbatim; db:generate w/ DATABASE_URL). NO app.ts/index.ts. Never touch openmuse-reviewed-actions/openmuse-documents (concurrent workers).

### Task 1: RED — tests

1. creation: valid change/contains/price fixtures accepted with computed initial nextCheckAt (UTC, injected clock); interval bounds (1 and 10080 pass; 0/10081 → 400); price_below without threshold → 400; contains without source → 400;
2. due semantics (injected clock): before nextCheckAt → no claim; at-or-after → claim + check runs once (injectable checkMonitor seam records the observation as evidence); after the check, nextCheckAt advanced by interval and status back to scheduled;
3. stop: cancel during scheduled → no further claims (assert); pause → same; resume (T05) re-arms from now+interval (record the choice);
4. §9/disabled-owner unchanged; foreign 404.

### Task 2: GREEN

- Implement per matrix (Task 0 scheduling decision recorded); `bun test tests/openmuse-tasks.test.ts tests/openmuse-task-runner.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: scheduling decision (queue runAt vs poll), migration SQL, files + shasum, test tails, S32 deferred note. No commit.

## Failure handling

- If the queue's runAt semantics differ from the assumption, follow Task 0's citation and record.
