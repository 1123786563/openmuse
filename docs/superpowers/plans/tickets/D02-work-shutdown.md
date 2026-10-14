# D02 — Stop Task, Monitor and pending write work: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessors D01+T08+T11+R04+R08 verified+integrated.

**Goal:** §9 work shutdown at deletion: the marker cancels queued/running/waiting Tasks and Monitors (future offers stop), cancels awaiting Reviewed actions; lease recovery (T07) cannot restart a deleted owner's work; an EXECUTING external attempt remains outcome_unknown for reconciliation (never auto-replayed).

**Architecture:** Extend `openmuse-deletion` with a `shutdownOwnerWork(userId)` seam (called after the D01 marker within the delete route): (1) tasks store bulk transition — queued/scheduled/paused/waiting_* → cancelled (running gets cancellationRequested like T04, public status remains running until the sweep lands cancelled — the sweep's post-turn finalize must consult the deletion marker and land cancelled, never re-offer); (2) monitor rows: cancel (T10's stop semantics); (3) reviewed actions: awaiting_review → cancelled (§6 allows cancelled); executing rows UNTOUCHED (outcome_unknown stays for R04 reconciliation); (4) T07 recovery sweep: a claimed item whose owner is deleted → finish-with-skip, no re-run (marker check in the recovery path). Best-effort emit of task.cancelled notifications (T12 seam, failure non-fatal).

**Spec:** Contracts §9 + catalog D02 (S39 fixture: delete during active Task, Monitor, pending Reviewed action); Issue #80.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-deletion/{routes.ts,fence.ts (or new shutdown.ts)}, server/tests/openmuse-deletion.test.ts; EMIT-ONLY touchpoints in openmuse-tasks store/runner (bulk-cancel + marker-check methods — minimal additions) and openmuse-reviewed-actions store (bulk awaiting→cancelled); their test files gain the shutdown fixtures. NO app.ts/index.ts. Never touch openmuse-personal/baseline (concurrent workers).

### Task 1: RED — tests

1. delete with a queued task + running monitor + awaiting reviewed action → tasks/monitors cancelled (bulk statuses asserted), reviewed → cancelled; executing reviewed row UNTOUCHED (stays executing/outcome_unknown for reconciliation);
2. running task at deletion: cancellationRequested set, public status running; the sweep finalizes cancelled and does NOT re-offer (queue counts);
3. T07 recovery interplay: lease-expired item of a deleted owner → finish-with-skip, zero re-runs (marker check);
4. future offers: monitor sweep claims nothing for a deleted owner (T10 claim guard consults the marker or the cancelled status — assert);
5. fence remains first: requests refuse before/without shutdown completion (D01 re-assert);
6. §9: shutdown records its transitions in the marker's resources phase field (bookkeeping only).

### Task 2: GREEN

- Implement per matrix; `bun test tests/openmuse-deletion.test.ts tests/openmuse-tasks.test.ts tests/openmuse-task-runner.test.ts tests/openmuse-reviewed-actions.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: touchpoint list, files + shasum, test tails, S39/F-DELETE-1 deferred notes. No commit.

## Failure handling

- If bulk transitions fight the CAS helpers, do them row-by-row under the same status guards — never a blind UPDATE ALL.
