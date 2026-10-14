# R05 — Create a reviewed Calendar event: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessors R01+R03(+A01/A03 semantics) verified+integrated.

**Goal:** Approving a Calendar create proposal executes through the connector: exact calendar/timezone/attendees shown in the proposal (§6 canonical payload for kind `gcalendar.create` — title, start, end, allDay?, timeZone, calendarId, attendees[]); approve creates ONCE with the provider event id in the receipt; deny/expiry create nothing; staleness matrix applies (payload/account/generation → 409 pre-dial); disconnected gcalendar → 409.

**Architecture:** Mirror R02: `calendar-create-executor.ts` in `openmuse-reviewed-actions` (dial via openmuse-calendar's client — import/reuse, placeholder action id `gcalendar.create` recorded); proposal kind validation for the calendar canonical shape (timezone-aware serialization — hash-stable); the R03 staleness guards apply unchanged (assert with calendar payloads); executor outcome mapping per R02's classification (definite rejection→failed; timeout-after-accept→outcome_unknown).

**Spec:** Contracts §6 + §4 calendar shapes; catalog R05; Issue #53.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Create server/src/openmuse-reviewed-actions/calendar-create-executor.ts; Modify service.ts/routes.ts (kind schema), server/tests/openmuse-reviewed-actions.test.ts. NO migrations/app.ts/index.ts. Import-only reuse of openmuse-calendar + openmuse-connectors (one export additions allowed, noted). Never touch openmuse-tasks/openmuse-documents (concurrent workers).

### Task 1: RED — tests

1. proposal kind gcalendar.create validates the canonical shape; hash stable across identical submissions;
2. approve happy → dial ONCE (alias gcalendar); receipt providerRef = provider event id; succeeded;
3. deny/expiry → zero dial calls;
4. staleness rows with calendar payloads: changed payload (e.g. start moved) / account / generation → 409 staleReason, zero dial;
5. disconnected gcalendar (gmail connected) → 409 at decision, vendor never called;
6. provider rejection → failed; timeout-after-accept → outcome_unknown no-retry (re-assert classification with calendar payloads);
7. §9 disabled owner 403.

### Task 2: GREEN

- Implement per matrix; `bun test tests/openmuse-reviewed-actions.test.ts tests/openmuse-calendar.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: action-id note, files + shasum, test tails, S20 live create/deny receipts deferred note. No commit.

## Failure handling

- If openmuse-calendar's client lacks a generic action-call export, add one export (noted) rather than duplicating the dial.
