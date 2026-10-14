# R07 — Delete a reviewed Calendar event: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessor R05 verified+integrated. Mirror of R06 with delete semantics.

**Goal:** `gcalendar.delete` proposals bind targetId+targetVersion (etag); approve deletes ONCE (provider outcome recorded); deny or missing target leaves the calendar UNCHANGED (missing target → failed with detail, zero writes); changed etag → 409 staleReason target zero writes; R03/R04 matrices apply.

**Architecture:** `calendar-delete-executor.ts` mirroring R06 (Task 0: reuse R06's etag strategy — cite the recorded decision); kind schema adds gcalendar.delete (canonical payload: targetId, targetVersion, calendarId).

**Spec:** Contracts §6; catalog R07; Issue #55.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Create server/src/openmuse-reviewed-actions/calendar-delete-executor.ts; Modify service.ts/routes.ts (kind schema), server/tests/openmuse-reviewed-actions.test.ts. NO migrations/app.ts/index.ts. Never touch openmuse-tasks/openmuse-files (concurrent workers).

### Task 1: RED — tests

1. proposal binds {targetId, targetVersion}; hash includes both;
2. approve happy → delete dial ONCE, provider outcome recorded, succeeded;
3. deny → zero delete calls (calendar unchanged);
4. missing target (provider 404) → failed with detail, zero successful writes;
5. changed etag → 409 staleReason target, zero delete calls;
6. timeout-after-accept → outcome_unknown no-retry; payload/account/generation staleness → 409 pre-dial;
7. §9 disabled owner 403.

### Task 2: GREEN

- Implement per matrix; `bun test tests/openmuse-reviewed-actions.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: etag-strategy reuse citation, files + shasum, test tails, S20 live delete/deny fixture deferred note. No commit.

## Failure handling

- Follow R06's recorded strategy exactly.
