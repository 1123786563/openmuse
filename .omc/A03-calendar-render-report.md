# A03 — Calendar render: worker checkpoint report

Branch `v4/openbot-exec`, worktree `v4-base`. No commits (per plan). TDD: RED confirmed (module missing), then GREEN.

## Intl availability note

Intl `DateTimeFormat` with named IANA zones is available on every target this code runs on: node 22+ (test runner), RN 0.81 Hermes (full Intl since RN 0.65-era Hermes), and web. The app already depends on exactly this capability outside openbot (`apps/mobile/src/ui.tsx` `timeLabel(value, timeZone)`, `src/screens.tsx`, `src/details.tsx` all call `Intl.DateTimeFormat`/`toLocaleTimeString` with a `timeZone`). So the plan's fallback path ("lightweight offset computation from the ISO string's own offset") was NOT needed; the pure module uses `Intl.DateTimeFormat` with explicit `timeZone` only. No limitation to record for C08/C09 beyond S18 (below).

## Plan deviation (one, verified)

Plan Task 1 item 2 says the DST event renders **04:30–05:30** in `America/New_York`. That arithmetic is wrong: NY springs forward at 07:00Z (02:00 EST) on 2026-03-08, *before* the event's 09:30Z start, so the whole event sits in EDT (UTC−4) → **05:30–06:30**. Node's Intl confirms; the test asserts 05:30–06:30 with a comment. Contracts §4 pins only the LA rendering (01:30–03:30, 1 hour) and "presentation changes, instant fixed", which is preserved — no spec conflict.

## Files + shasum (sha256)

```
63aa2275cf78e7aabd1d92c5a0faed7a756d9841f06322527dcf5e84a903222b  apps/mobile/src/openbot/calendar-view.ts   (new, pure — no react-native import)
04552b1d84bf7ae603972acbadfbd13cd6e89e53f5bf4be5f29c318bb18c1d82  apps/mobile/src/openbot/calendar.tsx       (new, minimal screen)
579f248719ee62425a0254f4ce1374ddc02002d62f591ea7c5f8928025e41876  apps/mobile/test/openbot-calendar-view.test.ts (new, 9 tests)
9ac69af32f3d9cbc830ac87eb6b2900fd53b77966fb48358d4ebcc63c8e65fe7  apps/mobile/src/openbot/api.ts             (modified: fetchCalendarEvents)
ba499eb1a2fe243995c8a914e4768a3fed08cec27a9139115167323a4d9e56e0  apps/mobile/src/openbot/types.ts           (modified: §4 event schema + page)
7cadb3c2be08d81d1ed9af4f44d46b4f28ec4471c019c839c08663f8274555a3  apps/mobile/App.tsx                        (modified: 日历 entry only)
```

`App.tsx`/`package.json`/`pnpm-lock.yaml` carried pre-existing uncommitted modifications from earlier agents in this shared worktree; my App.tsx delta is only the CalendarDays import, screen import, `calendarOpen` state, and the overlay+IconButton block. No chat/channels/config/auth/client/gate/private-state/computer/task files touched.

## Semantics implemented (all §4/plan fixtures)

- LA DST `2026-03-08T01:30:00-08:00`→`2026-03-08T03:30:00-07:00` → **01:30–03:30** in `America/Los_Angeles`, duration **1 hour** (wall clocks span 2, instant gap is 1).
- Same instants in NY → 05:30–06:30 (see deviation); duration still 1.
- All-day `2026-03-08`→`2026-03-09` → **3月8日** only; `03-08`→`03-11` → **3月8日–3月10日** (exclusive end, end-minus-one-day).
- All-day anchored at UTC inside `renderAllDay` — no zone parameter exists, so a Tokyo device cannot shift the dates.
- Naive ISO (no offset): interpreted as a wall clock in the given/declared zone (never the device zone), `zoneOf` marks it `assumed:true` and the screen shows a 默认时区 marker; a fold picks the first occurrence, a DST gap normalizes forward (moment/Luxon-style) via round-trip-check + max rule.
- Zero duration → single time label, duration 0.
- Screen renders timed ranges in the **device** zone (presentation-only; `event.timeZone` interprets naive ISOs), all-day chip 全天, ±31-day fixed window (`ponytail:` marked; real paging is A02's).
- `fetchCalendarEvents` GETs `/api/mobile/openmuse-calendar?timeMin&timeMax[&cursor]` per A01's shape (A01's server module is not merged in this worktree yet; the client contract follows A01's plan/DTO).

## Test tail (new file)

```
✔ all-day dates never shift with the device zone (e.g. Asia/Tokyo)
✔ timed ISO without an explicit zone renders in the fallback zone and is marked
✔ a naive wall clock is read in the event's zone but displayed in the device zone
✔ zero-duration guard: one time label, duration 0
✔ fetchCalendarEvents GETs the A01 endpoint with encoded timeMin/timeMax
✔ a nextCursor rides along when paging (A02 seam)
ℹ tests 9  pass 9  fail 0
```

## Full verification

- `pnpm test` → **625 pass, 0 fail**
- `pnpm --dir apps/mobile typecheck` → clean
- `pnpm lint` → clean (biome auto-fixes applied to my 4 files: import order + format)
- `pnpm build:web` tail:

```
› web bundles (4):
_expo/static/js/web/index-1d1ad56e30eb764e9f7c2982fe97e029.js (5.49 MB)
› Files (2): index.html (1.21 kB), metadata.json (49 B)
Exported: dist/web
```

## S18 deferred note

The live two-zone device fixture (S18 — rendering the §4 event on real LA and Tokyo devices) is deferred to the C08/C09 platform passes per the plan; this ticket covers pure logic + screen semantics under node:test and the web export only.
