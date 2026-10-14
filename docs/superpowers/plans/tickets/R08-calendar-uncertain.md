# R08 — Reconcile uncertain Calendar mutations: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessors R06+R07+R04 verified+integrated.

**Goal:** Calendar create/update/delete mutations that time out after provider acceptance land `outcome_unknown` with the attempt fingerprint; zero automatic retry; the operator reconciliation matrix (confirmed_succeeded/confirmed_not_sent/unresolved) applies to calendar kinds; the reconciler records provider evidence (event id read-back when confirmed).

**Architecture:** R04's reconcile machinery is proposal-kind-agnostic at the service level (audit with Task 0 — cite). This ticket: (1) calendar executors classify timeout-after-accept → outcome_unknown identically to gmail (assert with calendar payloads — create/update/delete rows); (2) reconcile route accepts calendar kinds (no kind restriction — verify; extend tests); (3) evidence recording: confirmed_succeeded accepts an optional providerEventId evidence field recorded on the attempt row; (4) re-proposal gate re-asserted with calendar kinds.

**Spec:** Contracts §6; catalog R08; Issue #56. F-CAL-1 is the live card.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-reviewed-actions/{service.ts,routes.ts,calendar-create-executor.ts,calendar-update-executor.ts,calendar-delete-executor.ts}, server/tests/openmuse-reviewed-actions.test.ts. NO migrations/app.ts/index.ts. Never touch openmuse-notifications/openmuse-tasks (concurrent worker).

### Task 1: RED — tests

1. create/update/delete with timeout-after-accept (fake dial accepts then hangs) → outcome_unknown + fingerprint, zero retry, settled re-decision;
2. reconcile each kind: confirmed_succeeded (with providerEventId evidence recorded) / confirmed_not_sent (fresh proposal permitted, executes once) / unresolved (warning retained); non-admin 403; non-uncertain 409;
3. re-proposal gate with calendar kinds (only confirmed_not_sent passes);
4. zero automatic queue replay across all rows (queue fake counts).

### Task 2: GREEN

- Implement per matrix (Task 0 audit cited); `bun test tests/openmuse-reviewed-actions.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: Task 0 audit, files + shasum, test tails, F-CAL-1/S21 live notes deferred. No commit.

## Failure handling

- If R04's reconcile is gmail-hardcoded anywhere, generalize minimally and record.
