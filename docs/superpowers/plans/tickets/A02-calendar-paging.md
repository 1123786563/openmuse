# A02 — Page Calendar without gaps: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessor A01 verified+integrated. Mirrors M02's boundary discipline.

**Goal:** Page size 2 over an equal-start three-event fixture returns every id exactly once; tie-boundary cursor exactness (ascending start then id); malformed/shape-invalid/foreign cursor → 400; provider truncation explicit.

**Architecture:** Extend `openmuse-calendar/calendar.ts` boundary behavior + tests (the cursor keyset (start,id) exists from A01 — this ticket proves and hardens the boundaries; provider pageToken stitching if the provider pages — same fake-defined contract discipline as M02).

**Spec:** Contracts §4 Calendar read (page 2 over equal-start three-event fixture); catalog A02; Issue #37.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-calendar/{calendar.ts,routes.ts (+client.ts only if stitching needs it)}, server/tests/openmuse-calendar.test.ts. NO app.ts/index.ts, no migrations. Never touch openmuse-mail/connectors (concurrent workers).

### Task 1: RED — tests

1. equal-start fixture (3 events, page 2): first page = the two smallest ids? NO — ascending start then id ASC: first page = first two by (start,id) ascending; union across pages = all 3 each exactly once; no cursor on the last page;
2. cursor exactly at a tie boundary → correct remaining subset ("after" = later start OR equal start with larger id);
3. malformed base64 → 400; wrong inner shape → 400; foreign (alias-bound) cursor → 400;
4. provider pageToken stitching (fake-defined shape): no gaps/dupes; truncation flag on the final stitched page;
5. limit clamp under paging re-asserted.

### Task 2: GREEN

- Implement per matrix; `bun test tests/openmuse-calendar.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: stitching note, files + shasum, test tails, S18 deferred note. No commit.

## Failure handling

- Follow M02's precedent for the provider-paging fake contract; record for O02.
