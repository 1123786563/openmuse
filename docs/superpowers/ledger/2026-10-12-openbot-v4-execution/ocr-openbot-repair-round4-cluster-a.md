# OCR REPAIR round 4 — cluster A disposition (openmuse-deletion / openmuse-ops / db/schema/openmuse.ts / mobile-bff / .gitmodules)

Source findings: `ocr-openbot-final.txt` (confirming pass). Scope: every high+medium finding anchored in
`server/src/openmuse-deletion/*`, `server/src/openmuse-ops/*`, `server/src/db/schema/openmuse.ts`, `server/src/mobile-bff/*`, and the two `.gitmodules` hunks. 22 findings in scope. Every finding was verified against the current worktree code before acting; earlier repair waves had already landed many of them.

Worktree: `/Users/wuyongjun/trea/OpenBot/.worktrees/v4-base` (branch `v4/openbot-exec`), everything left uncommitted per instruction. TDD followed for every code change made here (RED shown, then GREEN).

Verdict legend: **fixed** = repaired in this round; **fixed-before** = already repaired by an earlier wave, verified with citation, no change; **invalid** = does not hold against the current code, with evidence.

## .gitmodules

| # | finding (file:lines at review) | verdict | action | evidence |
|---|---|---|---|---|
| G1 | `.gitmodules:1-3` [bug·medium] submodule content inside root toolchain scan: biome `files.includes ["**"]` with no `!apps/openmuse`; root `bun test`/`test:ci` would discover upstream `*.test.ts` | partial fixed-before + fixed | Biome half already excluded (`biome.json` `files.includes` carries `"!apps/openmuse"`). Test-discovery half fixed here: root `test` script now enumerates this repo's own top-level dirs (`app agent-bot agent-computer agent-langgraph agent-mastra agent-sandbox deliverables desktop scripts server shared supervisor tests worker`), so `apps/**` is structurally outside discovery; rationale recorded in `bunfig.toml` `[test]`. Verified: 61 upstream test files exist under `apps/openmuse` today (e.g. `apps/openmuse/tests/*.test.ts`, `apps/openmuse/apps/mobile/test/*.test.ts`) and are the only test files outside the enumerated dirs; `bun test shared` discovers 33 files / 188 tests through the same path-argument form CI already uses. | `package.json:19`; `bunfig.toml:1-12`; `biome.json` (`!apps/openmuse`, pre-existing) |
| G2 | `.gitmodules:3-3` [security·medium] CI never initializes or validates the submodule gitlink — dangling pins merge green; spec asks CI to init | fixed | New `submodule pin fetchable` job in `ci.yml`: `git submodule update --init apps/openmuse` (fails outright on an unfetchable gitlink — the dangling-pin refusal), then asserts `git -C apps/openmuse rev-parse HEAD` equals `git ls-tree HEAD apps/openmuse`. Job YAML parses (`bun -e 'require("yaml").parse(...)'` → ok) and the two values were verified equal locally (both `46792335…`). The spec's fuller form (pnpm install + web build) and the org-controlled mirror remain recorded as follow-ups, per the finding's own "轻量 job" recommendation. | `.github/workflows/ci.yml:20-41` |

## openmuse-deletion

| # | finding | verdict | action | evidence |
|---|---|---|---|---|
| D1 | `fence.ts:16-19` [security·high] fence boundary residual exposure (channels/computer/copilot unfenced) | fixed-before | The suggested "OPEN EXPOSURE (tracked, not hidden)" boundary record is present verbatim, naming the unfenced seams and the follow-up condition. | `server/src/openmuse-deletion/fence.ts:21-26` |
| D2 | `restore.ts:237-239` [security·medium] purge/purge-relational reports return raw `retryable[].lastError` | fixed-before | `sanitized()` (G06 `sanitizeLastError`) wraps both purge routes' reports. | `restore.ts:183-193` (helper), `:261`, `:289` |
| D3 | `manifest.ts:297-303` [security·medium] `resources[].lastError` answered unsanitized | fixed-before | `sanitizeLastError` applied per resource row before the answer. | `manifest.ts:307-318` |
| D4 | `manifest.ts:168-171` [bug·high] `channelResources` walks `ChannelStore.list` (both partitions filter `deletedAt`) — soft-deleted channels never manifested nor purged | fixed | `ChannelStore` gained `enumerateOwner(ownerUserId)`: one membership-scoped query, `deletedAt` ignored — the enumeration half of `hardDelete`'s §9 scope. The manifest's `channels` dep is now `Pick<ChannelStore, "enumerateOwner">` and `channelResources` maps it directly (the cursor/page walk and `CHANNEL_PAGE` were deleted). TDD: new integration test "enumerates the owner's channels for deletion, soft-deleted included" (RED on missing method, GREEN after) + the D04 manifest fixture gained `chan-deleted` (`deleted: true`) and the pinned expectation array now includes it; the D08 world fake switched to `enumerateOwner`. | `server/src/channels/routes.ts:235-245` (type), `:765-780` (impl); `server/src/openmuse-deletion/manifest.ts:105-112` (dep), `:174-183` (channelResources); `server/tests/runtime-agents.integration.test.ts:268-295`; `server/tests/openmuse-deletion.test.ts` (fixture + expectations) |
| D5 | `manifest.ts:292-296` [bug·medium] answer's `phase` hardcoded `"fenced"`; restored/completed markers mis-report | fixed-before | Lifted markers short-circuit and re-answer the marker's own phase with no rows. | `manifest.ts:207-219`; pinned test `openmuse-deletion.test.ts` "a restored marker is answered, never re-enumerated" |
| D6 | `purge-relational.ts:78-79` [bug·high] walk/finalize blind to marker phase — restore then purge destroys a live account | fixed-before | Phase gate opens the walk: `restored`/missing → 409 `refused` naming the phase; `completed` walks as the documented idempotent no-op (the pinned contract the finding's stricter "refuse ≠ fenced" variant would break). | `purge-relational.ts:141-153`, outcome type `:68-78` |
| D7 | `purge.ts:158-159` [bug·medium] D06 byte purge lacks the same phase gate | fixed-before | `OpenMusePurgeRefusedError` thrown before any byte is touched; route maps it to 409. | `purge.ts:68-70`; `restore.ts:263-268`; `store.ts:50-64` |
| D8 | `routes.ts:55-56` [bug·high] repeat delete over a restored/completed marker never re-fences | fixed-before | `store.delete` re-fences lifted markers via CAS (`ne(phase,'fenced')` → `fenced`, `restoreUntil` null, first `disabledAt` kept); completed tombstones re-answer unchanged. | `store.ts:114-148`; pinned test "a repeat delete over a restored marker re-engages the fence, keeping the first disabledAt" |
| D9 | `store.ts:140-151` [bug·medium] `ownerDisabled` in tasks/files/connectors reads the marker without the phase filter — D05 restore lifts `/api/mobile` but those three seams refuse forever | fixed | All three now read the marker phase-aware (`eq(phase,'fenced')`), the same read the fence and the already-fixed goals/ideas/memories/notifications seams make; comments updated to the established wording. TDD: both drizzle-backed D03 tests extended with "restore lifts the direct readers" assertions (RED then GREEN). files' own disable table still lifts via `restoreOwner` — the marker half lifts with the phase. | `server/src/openmuse-tasks/store.ts:1247-1264`; `server/src/openmuse-files/store.ts:803-823`; `server/src/openmuse-connectors/store.ts:276-295`; `server/tests/openmuse-deletion.test.ts:583-613` |
| D10 | `store.ts:329-344` [bug·medium] `insertResources` single multi-row INSERT can exceed PG's 65535-parameter ceiling | fixed-before | Fixed 1_000-row batches; pinned test "insertResources writes large manifests in batches under PG's parameter ceiling" (1_500 rows, two batches). | `store.ts:362-384` |
| D11 | `routes.ts:68-74` [bug·medium] multi-step delete has no per-step error handling; partial progress hidden behind a bare 500 | fixed-before | `run(name, step)` helper records `steps:{shutdown,revoke,manifest}` each "ok"/"failed: …" and the answer carries them. | `routes.ts:70-108` |
| D12 | `routes.ts:37` [bug·high] D02/D03/D04 seams never supplied at the production mount (app.ts passes only `{requireUser, store}`); D05–D08 routes likewise unwired | fixed-before | The finding's explicit alternative — record the staged-rollout decision — is recorded at the factory ("WIRING STATUS (production)"); verified `app.ts:1897-1905` still mounts `{requireUser, store}` only, so the comment is accurate. Actually wiring the orchestration into app.ts is an assembly-level act outside a per-finding repair; listed under Dependencies. | `routes.ts:31-43`; `server/src/app.ts:1897-1905` |
| D13 | `shutdown.ts:65-75` [performance·medium] per-cancelled-task notifications awaited serially | fixed-before | Emits fan out via `Promise.all`, each still individually best-effort. | `shutdown.ts:68-92` |

## openmuse-ops

| # | finding | verdict | action | evidence |
|---|---|---|---|---|
| O1 | `signals.ts:155-164` [maintainability·medium] `collect`'s catch discards the underlying error | fixed-before | Truncated reason rides the `missing_seam` detail. | `signals.ts:158-173` |
| O2 | `signals.ts:306-309` [bug·high] `row.payload?.taskId` on an untyped jsonb column fails `tsc --noEmit` (TS18046) | invalid | `workItems.payload` is declared through the repo's custom jsonb (`db/schema/json.ts`), whose `data` type is `Record<string, unknown>` — property access is legal and narrows via `typeof`. `cd server && bun run typecheck` → **clean, zero errors** (no TS18046 anywhere). | `server/src/db/schema/work.ts:89` + `server/src/db/schema/json.ts`; typecheck output |
| O3 | `signals.ts:84-87` [maintainability·medium] `ownerUserId` selected but never consumed by the aggregation | fixed-before | The uncertain-action detail now leads with `owner ${row.ownerUserId}`. | `signals.ts:243-247` |

## db/schema/openmuse.ts

| # | finding | verdict | action | evidence |
|---|---|---|---|---|
| S1 | `openmuse.ts:244-246` [other·medium] `openmuse_oauth_pending` has no cleanup path; §9 contradiction via orphan rows | fixed-before | The finding's primary recommendation landed: `userId` gained `references(users.id, onDelete: cascade)` (same idiom as `openmuseFiles.ownerUserId`) plus the partial sweep index; migration 0097 additionally purges pre-existing orphans before adding the FKs. The alternative (TTL sweep of settled rows) was not needed once the FK exists and is deliberately not taken. | `openmuse.ts:254-256` (FK), `:277-285` (partial index); `server/drizzle/0097_openmuse_user_fks_and_gates.sql` |
| S2 | `openmuse.ts:1-11` [bug·high] native `jsonb` import from drizzle-orm/pg-core double-serialises under Bun SQL | fixed-before | Imports the custom `jsonb` from `./json`, with the why-comment. | `openmuse.ts:12-15` |

## mobile-bff

| # | finding | verdict | action | evidence |
|---|---|---|---|---|
| M1 | `routes.ts:87-92` [bug·high] `instanceof OpenMuseOwnerDisabledError` never matches the files sub-app's own same-named class — 403 degrades to 503 | fixed-before | Match is by stable `error.name` alongside the instanceof, with the three-classes comment. | `mobile-bff/routes.ts:88-102` |
| M2 | `routes.ts:99-104` [bug·medium] `OpenMuseFileQuotaError` unmapped at the mount — determinate 413 degrades to retry-me 503 | fixed-before | 413 branch restated at the mount with `code` and the delete-some-files sentence. | `mobile-bff/routes.ts:115-129` |

## Totals

22 findings: **4 fixed** (D4, D9, G1 test-scoping half, G2), **16 fixed-before**, **1 invalid** (O2), plus G1's biome half fixed-before. 0 skipped.

Files changed (all uncommitted; `shasum -a 256`):

```
8008cbfe1baeb5120cd1d3cee8d1b475d083678549b0c61dfc61f404da38a2ed  server/src/channels/routes.ts
eab9440dc0eb43bf611a1048beb6afbc9e4fc78e36dd4d30e66d725c022ad361  server/src/openmuse-deletion/manifest.ts
1599b9779cfe3a2a4d86ea91170e58f4a5d9b51ba236d36686f0e0b50db2081a  server/src/openmuse-tasks/store.ts
db734fee2dd8aa2c38a59dd3c4518c4bb8e0fa1d5c8771b888a7c37a1acce162  server/src/openmuse-files/store.ts
ffd155aa6f9fc3e8dcf4f807dd448e7eed71ec106e177f80438c4dc9681491cb  server/src/openmuse-connectors/store.ts
7fc1974d2bfc6e95ce60828dcc981b3f8b1a9e0d3840ec3ef58f5f0b6f8e9179  server/tests/openmuse-deletion.test.ts
d3eed99db85db043a61d033daa136d1fc72feafa3995c893a2c25d1456cfb2ba  server/tests/runtime-agents.integration.test.ts
e366d8e0444b6bd006ab1e8adfaddf7c2ade2c2e760e3cd944805539fb3dbaf0  package.json
5913e59bb3abb12e886e9c9366a953a45df6c398cfb7cfb532daed6b9abf5339  bunfig.toml
99cdf3c664500526d71328d15eac10486f5e3029a5976205ff32e5f9f6c82b93  .github/workflows/ci.yml
```

## Verification

- `TEST_DATABASE_URL=postgres://openbot:openbot@localhost:5432/openbot_test bun test server/tests/openmuse-deletion.test.ts server/tests/openmuse-ops-signals.test.ts server/tests/mobile-bff.test.ts` → **103 pass / 0 fail**.
- `… bun test server/tests/openmuse-files.test.ts server/tests/openmuse-tasks.test.ts server/tests/openmuse-google-oauth.test.ts server/tests/runtime-agents.integration.test.ts server/tests/channel-routes.test.ts` → **330 pass / 0 fail**.
- `… bun test server/tests/channel-summary.integration.test.ts server/tests/channel-events.integration.test.ts server/tests/channel-activity.integration.test.ts server/tests/group-conversations.integration.test.ts server/tests/team-bots.integration.test.ts server/tests/routines-store.integration.test.ts` → **128 pass / 0 fail**.
- `cd server && bun run typecheck` → clean (also the evidence for O2's invalid verdict).
- `bunx biome lint --error-on-warnings` + `bunx biome format` on every touched file → clean (3 pre-existing `organizeImports` assist findings exist in untouched prior-wave files `purge.ts`/`purge-connectors.ts`/`restore.ts`; CI's lint/format scripts do not invoke the assist, left alone as out-of-finding).
- ci.yml parses as YAML; the submodule job's two compared values verified equal on the current pin.

## Dependencies / follow-ups (for the coordinator)

1. **D12 (recorded decision)**: production delete is fence-only by recorded decision at `routes.ts:31-43`. Wiring D02/D03/D04 (and mounting the D05 admin restore + D06–D08 purge routes) at `app.ts`/`index.ts` is an assembly-level change one tier above a per-finding repair — if the OCR loop wants it wired rather than recorded, that is its own ticket.
2. **G2 remainder**: the design spec's fuller CI form (submodule `pnpm install --frozen-lockfile` + web/native build) and an org-controlled mirror of `1123786563/openmuse` remain open; the fetchable-pin guard is the landed half.
3. **G1 note**: `bun run test:ci`'s MINIMUM_TESTS floor (400) keeps ample headroom with the 61 upstream test files excluded (suite ≈ 4.8k).
4. Handed to this cluster by round-3 cluster A: none outstanding — #11's constant rename (`OpenMUSE_REFRESH_FAILED_MESSAGE` → `OPENMUSE_…`) would touch `openmuse-connectors/google-oauth.ts` (outside this round's dirs) and `signals.ts:9,195`; it is a LOW finding, left for its owning pass. #28's `cancelAwaiting` clock unification similarly spans reviewed-actions + shutdown; the deletion side has no pinned contract forcing it now.
