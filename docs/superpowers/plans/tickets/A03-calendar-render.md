# A03 — Render Calendar time zones and all-day dates: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD for the pure date logic. Predecessor A01 verified+integrated (server endpoint live).

**Goal:** The §4 fixtures render correctly: the LA DST timed event `2026-03-08T01:30:00-08:00`→`2026-03-08T03:30:00-07:00` displays **01:30–03:30** in `America/Los_Angeles` with a **one-hour duration**; the all-day event `2026-03-08`→`2026-03-09` displays **only March 8**; a changed device zone changes presentation, not stored instants; a minimal Calendar screen renders A01's list with these semantics.

**Architecture:** Pure module `src/openbot/calendar-view.ts`: `renderTimedRange(start,end,zone)` (format in the GIVEN zone via Intl API — node and RN both support Intl; if the project's RN target lacks full Intl, use a lightweight offset computation from the ISO string's own offset for display-in-stored-zone and record the limitation), `renderAllDay(start,end)` (exclusive end → single date label; multi-day span label), `durationHours(start,end)`, `zoneOf(dateIso, fallback)`; device-zone override parameter (presentation-only). Screen `src/openbot/calendar.tsx`: minimal list consuming A01's endpoint (timeMin/timeMax = a fixed window around today), rows showing title + rendered range + all-day chip; App shell entry 日历.

**Spec:** Contracts §4 Calendar read (DST + all-day fixtures); catalog A03; Issue #38.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/openmuse/.worktrees/v4-base. NO commits.
- Owned files: Create apps/mobile/src/openbot/{calendar-view.ts,calendar.tsx}, apps/mobile/test/openbot-calendar-view.test.ts; Modify apps/mobile/src/openbot/{api.ts (fetchCalendarEvents),types.ts (event schema)}, App.tsx (Calendar entry).
- Do NOT touch chat/channels/config/auth/client/gate/private-state/computer/task files.

### Task 1: RED — date logic tests

1. DST fixture: 01:30–03:30 rendered in America/Los_Angeles; duration exactly 1 hour (not 2 — the wall clocks span 2 but the instant gap is 1h);
2. same event rendered in America/New_York → 04:30–05:30 (presentation changes, instant fixed);
3. all-day 2026-03-08→2026-03-09 → "3月8日" only; 3-day span 03-08→03-11 → 3月8日–3月10日 (exclusive end);
4. all-day stays March 8 when the DEVICE zone is e.g. Asia/Tokyo (date-only never shifts);
5. timed event without explicit zone in the ISO → rendered in the fallback zone and marked;
6. zero-duration guard (start==end → single time label, duration 0).

### Task 2: GREEN

- calendar-view.ts per matrix (pure; no react-native import); api.ts fetchCalendarEvents (A01's endpoint shape, timeMin/timeMax params); calendar.tsx minimal screen; App shell entry.
- `pnpm test && pnpm --dir apps/mobile typecheck && pnpm lint` green; `pnpm build:web` exports (record tail).

### Task 3: Checkpoint

- Report: Intl availability note (or the recorded limitation + fallback used), files + shasum, test tails, build:web tail, S18 live two-zone device fixture deferred note. No commit.

## Failure handling

- If RN's Intl lacks zone formatting, display in the event's own zone (offset from its ISO string) and record the device-zone-rendering dependency for C08/C09's platform passes.
