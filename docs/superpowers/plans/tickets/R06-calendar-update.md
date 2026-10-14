# R06 — Update a reviewed Calendar event: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessor R05 verified+integrated.

**Goal:** `gcalendar.update` proposals bind the event id AND etag; approval updates ONCE (provider outcome recorded); a CHANGED etag at decision time → 409 staleReason "target" with ZERO provider writes; deny/missing target leaves the calendar unchanged; the R03/R04 matrices apply unchanged.

**Architecture:** Mirror R05: `calendar-update-executor.ts` (dial once; provider etag error class → mapped to a stale-target 409 pre-write via a pre-check fetch when the provider supports etag reads — Task 0: decide pre-check-fetch vs trust-provider-error, record; either way ZERO writes on staleness is asserted); kind schema adds targetId+targetVersion (etag) as §6 first-class fields (already in the proposal model — bind them).

**Spec:** Contracts §6 (proposal binds targetId and targetVersion; changed etag 409 zero writes); catalog R06; Issue #54.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Create server/src/openmuse-reviewed-actions/calendar-update-executor.ts; Modify service.ts/routes.ts (kind schema), server/tests/openmuse-reviewed-actions.test.ts. NO migrations/app.ts/index.ts. Never touch openmuse-documents/openmuse-finance (concurrent workers).

### Task 1: RED — tests

1. proposal binds {targetId, targetVersion}; canonical hash includes both;
2. approve happy → dial ONCE, provider outcome recorded, succeeded;
3. changed etag (fake provider reports current etag differs / update rejected as conflict — per Task 0's choice) → 409 staleReason target, ZERO writes (provider write-call counts);
4. deny → zero writes; missing target (provider 404) → failed with detail, calendar unchanged;
5. timeout-after-accept → outcome_unknown no-retry (re-assert); staleness rows (payload/account/generation) with update payloads → 409 pre-dial;
6. §9 disabled owner 403.

### Task 2: GREEN

- Implement per matrix (Task 0 decision recorded); `bun test tests/openmuse-reviewed-actions.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: Task 0 pre-check-vs-provider-error decision, files + shasum, test tails, S20/S21 live fixtures deferred note. No commit.

## Failure handling

- If the provider has no etag semantics in the fake's contract, define the fake per §6 (etag in, conflict-out) and record for O02.
