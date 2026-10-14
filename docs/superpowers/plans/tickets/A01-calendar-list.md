# A01 — List and open Calendar events: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessor G03 verified+integrated (requireConnection + provider-parameterized connectors).

**Goal:** `GET /api/mobile/openmuse-calendar?timeMin&timeMax&cursor&limit` returns §4 Calendar DTOs — `{id,calendarId,etag,title,start,end,allDay,timeZone,location,description,attendees[]}` — ascending start then id, default 50 / max 100, half-open `[timeMin,timeMax)` range ≤366 days (invalid → 400), owner+alias-bound cursor (invalid/foreign → 400), Gmail-only grant refuses (409 via requireConnection(userId,"gcalendar")), provider truncation explicit, provider shapes never leak.

**Architecture:** New module `server/src/openmuse-calendar/` mirroring openmuse-mail: client.ts (alias-bound dial, placeholder action id `gcalendar.list` recorded per M01 discipline), calendar.ts (DTO mapping + ordering + range validation + cursor keyset (start,id)), routes.ts (requireUser + requireConnection + zod). Mount via mobile-bff pattern: app.ts ONE tail param + conditional; index.ts arg; ready.test.ts offset update.

**Spec:** Contracts §4 Calendar read DTO; catalog A01; Issue #36.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Create server/src/openmuse-calendar/{client,calendar,routes}.ts, server/tests/openmuse-calendar.test.ts; Modify server/src/app.ts (tail param + ready.test.ts offset), server/src/index.ts (import+arg). No migrations. Do NOT touch openmuse-mail/connectors (imports only; one export addition allowed, note it).

### Task 1: RED — tests

1. DTO mapping incl. etag/timeZone/attendees; extra provider fields dropped; all-day events keep date-only start/end semantics in the DTO (pass-through; A03 owns rendering);
2. ordering ascending start then id; equal-start tie; page boundary cursor exactness (no dup/missing); default 50 / 101 clamps / `abc` 400;
3. range: half-open (timeMin inclusive, timeMax exclusive — fixture events at both edges); span >366 days → 400; missing timeMin/timeMax → 400 (both required);
4. disconnected gcalendar (gmail connected) → 409 vendor-never-called; both disconnected → 409;
5. foreign cursor → 400; provider truncation → truncated:true;
6. §9: disabled owner 403.

### Task 2: GREEN

- Implement + wiring; `bun test tests/openmuse-calendar.test.ts tests/ready.test.ts tests/mobile-bff.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: action-id note, files + shasum, test tails, S18 live fixture deferred note. No commit.

## Failure handling

- Provider payload shape unknown → define the fake's contract from the DTO needs and record for O02 live check (M01 discipline).
