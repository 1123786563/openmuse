# K04 — Control the computer from OpenMuse: Execution evidence

Ticket: GitHub issue #25 (catalog K04). Plan: `docs/superpowers/plans/tickets/K04-computer-control.md`.
Worktree: `/Users/wuyongjun/trea/openmuse/.worktrees/v4-base`, branch `v4/openbot-exec`. No commits.

## Task 0 — route-shape citations (server worktree, read-only)

Server citations are from `/Users/wuyongjun/trea/OpenBot/.worktrees/v4-base` (branch `v4/openbot-exec`),
line numbers on 2026-10-13, cross-checked against `docs/openmuse-v4/k03-control-lease-evidence.md` there.

| Route (under `/api/computers`, server/src/computer/routes.ts) | Verb + body | Answer / errors |
|---|---|---|
| `/:botId/control` | GET, optional `?requestId=` (`routes.ts:354-365`) | `ControlState` DTO (`shared/computer-control.ts` `ComputerControlState`: holder bot/human + `HandoffRequest{id,status,reason,expiresAt,takenBy}`; K03 vocabulary `waiting/taken/completed/cancelled/expired/interrupted/refused`) |
| `/:botId/control/request` | POST, body `{}` (reason optional, server default; `routes.ts:367-378` → `gateway.requestHelp` `gateway.ts:759`) | `ControlState`; write |
| `/:botId/control/take` | POST, body `{requestId}` (`routes.ts:439-443`; `userId` is session-injected server-side at `gateway.ts:778-800`, never client-supplied) | `ControlState`; second user's take → 409 |
| `/:botId/control/release` | POST, body `{requestId}` (`routes.ts:445-449`) | `ControlState` |
| `/:botId/control/cancel` | POST, body `{requestId}` (`routes.ts:451-455`) | `ControlState` |
| **Human input:** `/:botId/human/:kind` | POST, `kind ∈ {click, type, key, scroll}` (`routes.ts:526-609`) — the only human input verb. Bodies: click `{x,y}` numeric, type `{text}` string, key `{key}` string, scroll `{deltaY?}`; `seq?` optional integer ≥1 (`routes.ts:585-595`; computer-side `admitHumanInput` `agent-computer/src/control.ts:402-419`: no lease → 409 `TAKE_CONTROL_FIRST`, bad seq → 400, replay/reorder → 409, not delivered) | `HumanInputResult {action, characters?, key?, deltaY?, url}` (never the typed text; `server/src/computer/schema.ts:356-377`) |
| Late input | — | 403 (`statusFor` policy refusal `routes.ts:1069`) / 409 (`HumanHasControlError`, `routes.ts:1056`) — matches §3 "403/409 and is not delivered" |

`handoffId` shape (`routes.ts:1041-1048`): `{requestId}` string, ≤200 chars.

**Honest HTTP-input scoping (plan §Failure handling, invoked):** the live WS screen stream's input
framing (WS-frame `seq`, stream identity) was explicitly deferred by K03 (its evidence §7) and remains
the native pass. This ticket implements the HTTP input path only — every gesture travels over
`POST /human/:kind`; the click pad / type box / Enter key are the deliberate minimal surface, not a
claim of full keyboard/mouse streaming.

## Files + shasum (sha256)

| File | sha256 | Change |
|---|---|---|
| `apps/mobile/src/openbot/control-state.ts` | `2a762ff4…c816749` | new: pure lease state machine — viewing→requesting→controlling→released + refused/expired terminal; input guard (controlling-only, local refusal otherwise) with monotonic seq assignment reset on take; `controlInputRefused` classifies 403/409 into a visible 已断开 refusal (400/5xx leave the phase untouched); `controlSignedOut` ends an active lease best-effort |
| `apps/mobile/src/openbot/control.tsx` | `8fd7d483…9718aa` | new: `OpenBotControlPanel` — per-phase zh-CN chip + buttons (请求接管/接管/取消/交还/再次请求), click-at-(x,y) pad (preview image + viewport mapping), type box, Enter key; input dispatches only while controlling; unmount fires best-effort release |
| `apps/mobile/test/openbot-control-state.test.ts` | `a6e7992a…fbe7cc` | new: 10 tests — §3 matrix (happy path, refused/expired terminal + restart, input guard, seq monotonicity/reset, late-input 403/409 visible + never retried, logout reducer), zh-CN labels, purity (zero imports), api route-shape pins (request/take/release/cancel bodies, 4 gesture kinds + seq, 403/409 status surfacing) |
| `apps/mobile/src/openbot/api.ts` | `3f8d54b2…d68086` | added: `computerControlSchema`/`computerHandoffSchema` (K03 status vocabulary incl. `refused`), `requestComputerControl` / `takeComputerControl` / `releaseComputerControl` / `cancelComputerControl`, `sendComputerInput` (`POST /human/:kind`, gesture + `seq`), `computerInputResultSchema` |
| `apps/mobile/src/openbot/computer.tsx` | `14adabda…78506fd` | embed `OpenBotControlPanel` under the preview; track screenshot `viewport {width,height}` per poll round for pad→page coordinate mapping |

`App.tsx`: untouched (the panel rides the already-wired `OpenBotComputerScreen`). No other files touched.

## TDD record

RED (before `control-state.ts` existed): `openbot-control-state.test.ts` failed as a whole file
(module not found); suite 643 pass / 1 fail (the new file). First GREEN run: 1 assertion failure
(`controlSignedOut` turned a leaseless viewing state into released) → fixed the reducer to end only
an active (requesting/controlling) lease, keeping the test as written.

## Verification

```
pnpm test
  ℹ tests 654   ℹ pass 654   ℹ fail 0   (baseline before this ticket: 644 tests / 643 pass + 1
   red new file; +10 new tests, all green)

pnpm typecheck (root tsc --noEmit && apps/mobile tsc --noEmit)
  exit 0

pnpm lint (biome check .)
  exit 0 (1 pre-existing info: biome.json schema 2.5.13 vs CLI 2.5.15 — not this ticket's file)

pnpm build:web
  Web Bundled 1177ms apps/mobile/index.js (2917 modules)
  › web bundles (4): … index-f8084ba5b8cd6d5fe452f70f0f2f69ff.js (5.52 MB) …
  Exported: dist/web
```

No commits made.

## S38 / F-CONTROL-1 — deferred (live-device notes)

- **S38** (acceptance `2026-10-12-openmuse-openbot-acceptance-v4.md` row 54): a two-user live run
  (U-A views/requests, U-B competes, A disconnects then sends input; expects late input 403/409
  undelivered + audit actor) across platforms W/I/A. Needs the deployed OpenBot stack and a second
  account — the mobile worktree cannot produce it; this ticket's proof is the unit matrix above plus
  K03's server-side zero-delivery pins.
- **F-CONTROL-1** (same doc, row 71: revoke a lease while a key event is in flight; later sequence
  refused, nothing delivered after revocation): same live-stack requirement; the mobile half (visible
  已断开 refusal, no retry) is covered by the unit matrix; the in-flight race itself is server-side
  (K03's `admitHumanInput` gate) and its live verification rides the same deferred pass.
