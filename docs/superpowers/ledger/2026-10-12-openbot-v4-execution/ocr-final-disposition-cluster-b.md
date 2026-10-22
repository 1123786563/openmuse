# OCR final-pass disposition — cluster B

Final confirming pass over `ocr-final-cluster-b.txt` (37 findings) against the
current tree at `.worktrees/v4-base` (branch `v4/openbot-exec`, uncommitted
prior repair waves in place). Each finding was re-verified against current
code before acting; all line numbers below are post-fix current lines.

Legend: **fixed** = code (or contract-recording doc) changed this pass;
**invalid** = the finding's claim does not hold against current code;
**dependency** = valid, but the minimal correct fix lives in files outside
this cluster's ownership (recorded below, no code change here).

## openmuse-activity

| Finding | Verdict | Action | Evidence |
| --- | --- | --- | --- |
| feed.ts:284-293 nested ternary for allowedActions | fixed | Sequential `if`/`else if` assignment, comment preserved | `server/src/openmuse-activity/feed.ts:287-296` |
| routes.ts:76-87 onError maps unknowns to 503, logs only `error.name` | fixed | Log the full `error` object; answer 500 with a comment explaining why 503 mis-files code defects | `server/src/openmuse-activity/routes.ts:108-120` |
| feed.ts:202-203 invalid decide action returns `missing` (misleading 404 for library callers) | fixed | New `bad_action` outcome kind; route maps it to 400; zod enum keeps it unreachable over HTTP | `feed.ts:118,204-207`; `routes.ts:43-47` |
| routes.ts:91 page limit 100 hardcoded, duplicates ACTIVITY_MAX_LIMIT | fixed | Import and use `ACTIVITY_MAX_LIMIT` as the clamp | `routes.ts:17,125-128` |
| routes.ts:139-155 decision/read routes duplicate the outcome→response block | fixed | One `activityItemResponse(context, outcome)` helper, both routes one line | `routes.ts:22-52,158,169-174` |

## openmuse-deletion

| Finding | Verdict | Action | Evidence |
| --- | --- | --- | --- |
| **[high]** fence.ts:16-19 residual exposure: unfenced computer/copilot/channels seams | fixed (recorded) + dependency | OPEN EXPOSURE block added beside the mount-boundary note naming the unfenced seams and the single `isDisabled` consumer; actual seam fencing is cross-module (dependency 1/4) | `server/src/openmuse-deletion/fence.ts:20-27` |
| restore.ts:237-239 purge/purge-relational answers leak raw retryable lastError | fixed | `sanitized()` (G06 `sanitizeLastError`) applied to both reports at the admin route; refusal branch distinct from blocked branch | `server/src/openmuse-deletion/restore.ts:183-196,236-246,269-279` |
| manifest.ts:297-303 buildManifest passes raw lastError to the deleting user | fixed | `sanitizeLastError(row.lastError)` in the resources mapping | `server/src/openmuse-deletion/manifest.ts:309-316` |
| **[high]** manifest.ts:168-171 channelResources misses soft-deleted channels (ChannelStore.list filters `isNull(deletedAt)`) | dependency | Verified: `channels.list` filters `deletedAt` in SQL (`server/src/channels/routes.ts:543`), so soft-deleted channels cannot be enumerated manifest-side with the `list` seam. Requires a channels-module `enumerateOwner` (dependency 2) | `server/src/openmuse-deletion/manifest.ts:176-190` (unchanged seam) |
| manifest.ts:292-296 phase hardcoded "fenced", detached from marker | fixed | Lifted markers short-circuit: `restored`/`completed` answer the marker's own phase with no rows named or written; fenced path still answers fenced. The store's new re-fence keeps the delete-route path consistent | `manifest.ts:206-217,317` |
| **[high]** purge-relational.ts:78-79 D08 walk/finalize blind to marker.phase | fixed | `marker` dep widened to `get \| complete`; walk opens with the §9 phase gate — restored/missing ⇒ 409 `refused` naming the phase, nothing walked; a completed tombstone still walks (the pinned idempotent re-answer) | `purge-relational.ts:85-90,141-156` |
| purge.ts:158-159 D06 entry has no phase/restoreUntil gate | fixed | Same gate via new `OpenMusePurgeRefusedError` (store.ts), thrown before any byte delete; D07 `purge-connectors.ts` gated identically; admin route maps the refusal to 409 | `purge.ts:66-70`; `purge-connectors.ts:76-80`; `restore.ts:236-246`; `store.ts:55-66` |
| **[high]** routes.ts:55-56 repeat delete over restored/completed marker does not re-engage the fence | fixed | `store.delete` now CAS-re-fences any non-fenced row (phase→fenced, restoreUntil→null, first disabledAt kept); the two DB-backed contract tests that were failing at baseline now pass | `store.ts:73-80,122-136`; tests `openmuse-deletion.test.ts` "re-engages the fence" / "re-fences too" |
| store.ts:140-151 tasks/files/connectors `ownerDisabled` read the marker without the phase filter | dependency | The flagged seam itself (`isDisabled`) is already phase-aware (`store.ts:157-168`). The three row-seam reads live in modules outside ownership (dependency 3). My cluster's seams (notifications/goals/ideas/memories) implement the phase-aware read | `server/src/openmuse-deletion/store.ts:157-168` |
| store.ts:329-344 insertResources single multi-row INSERT can exceed PG's 65535-parameter ceiling | fixed | Fixed 1,000-row batches; DB-backed test inserts 1,500 rows + idempotent repeat | `store.ts:362-385`; test "insertResources writes large manifests in batches…" |
| routes.ts:68-74 multi-step delete has no per-step error handling | fixed | `steps` map answered with per-step `ok`/`failed: <reason>`; manifest included only when built; test covers a failing shutdown beside a successful revoke | `routes.ts:93-121`; test "a failing step answers by name…" |
| store.ts:124-131 D09 `list()` unbounded | dependency | Valid observation, deferred: the D09 contract is "every marker there is", so a query-side limit alone would silently truncate the roster; bounding requires paginating the cleanup-view endpoint (route contract change, dependency 5) | `store.ts:141-149` (unchanged) |
| **[high]** routes.ts:37 shutdown/revoke/manifest seams never wired in production (app.ts mounts `{requireUser, store}` only) | fixed (recorded) + dependency | WIRING STATUS comment on the seam declarations stating production delete is fence-only today; wiring app.ts/index.ts is cross-module (dependency 1) | `server/src/openmuse-deletion/routes.ts:37-48`; verified `server/src/app.ts:1888-1893` |
| shutdown.ts:65-75 cancelled-Task emits serially awaited | fixed | `Promise.all` fan-out, per-emit try/catch and log preserved | `server/src/openmuse-deletion/shutdown.ts:63-93` |

## openmuse-notifications

| Finding | Verdict | Action | Evidence |
| --- | --- | --- | --- |
| store.ts:318-324 drizzle ownerDisabled hardcoded false — §9 contract dead in production, emit path unfenced | fixed | Phase-aware marker read (same semantics as `isDisabled`: fenced fences, restore lifts); the runner's emit is best-effort try/catch so the throw is contained | `server/src/openmuse-notifications/store.ts:336-353` |
| store.ts:181-189 markRead two round-trips, UPDATE not owner-scoped | fixed | `markNotificationRead(userId, id, at)` single owner-scoped `UPDATE…RETURNING`; store calls it once | `store.ts:74-81,189-196,296-315` |
| store.ts:300-302 readAt uses DB now(), createdAt uses injectable clock | fixed | Caller-supplied `at` written via `coalesce(readAt, ${at})`; store passes its `now()`; fixed-clock test pins readAt === createdAt instant | `store.ts:296-315`; test "markRead stamps readAt with the same clock…" |

## openmuse-ops

| Finding | Verdict | Action | Evidence |
| --- | --- | --- | --- |
| signals.ts:155-164 catch discards the error entirely | fixed | Truncated reason (≤120 chars) rides the missing_seam detail; admin-gated surface | `server/src/openmuse-ops/signals.ts:163-175` |
| signals.ts:167-170 four seam reads serial | fixed | `Promise.all` over the four collects, slices concatenated in the contract's fixed order | `signals.ts:180-296` |
| signals.ts:302-303 taskQueue reader pulls settled rows and filters in memory | fixed | `isNull(workItems.finishedAt)` pushed into the WHERE (population bound, not a threshold) | `signals.ts:320-327` |
| signals.ts:63-67 provider selected but never consumed | fixed | Provider prefixes the connector detail: `gmail: <sanitized reason>` | `signals.ts:190-196` |
| **[high]** signals.ts:306-309 `row.payload?.taskId` on unknown ⇒ TS18046, typecheck cannot pass | invalid | `bun run --filter server typecheck` exits 0 with no signals.ts error (work.ts `payload` jsonb carries a typed default; the claimed failure does not exist). No other aspect flagged | `server/src/openmuse-ops/signals.ts:333-336`; typecheck exit 0 |
| signals.ts:84-87 ownerUserId declared but never consumed | fixed | Owner rides the uncertain-action detail: `owner <id>: reconciliation: <status>` | `signals.ts:244-249` |

## openmuse-personal

| Finding | Verdict | Action | Evidence |
| --- | --- | --- | --- |
| **[high]** goals.ts:165-170 enumerateOwner reuses live-only listByOwner — tombstoned Goals never purged | fixed | New `listIdsByOwner` rows seam (no deletedAt filter) backing `enumerateOwner`; tombstone test updated to the §9 contract | `server/src/openmuse-personal/goals.ts:56-62,172-177,268-274` |
| goals.ts:293-295 ownerDisabled hardcoded false | fixed | Phase-aware marker read (fence semantics); read-path boundary recorded in the comment | `goals.ts:303-322` |
| **[high]** ideas.ts:204-209 enumerateOwner live-only | fixed | Same `listIdsByOwner` seam | `server/src/openmuse-personal/ideas.ts:61-67,210-215,305-312` |
| ideas.ts:180-183 accept is check-then-act; concurrent withdraw can resurrect the terminal state | fixed | `updateIdea` gains `whereStatusIn` statement-level precondition; accept passes `["pending","accepted"]`, zero rows ⇒ `missing`; interleaving test with a stale findIdea | `ideas.ts:63-77,186-196,314-330`; test "a withdraw that interleaves with accept's checks wins…" |
| ideas.ts:335-337 ownerDisabled hardcoded false | fixed | Phase-aware marker read + boundary note | `ideas.ts:348-367` |
| **[high]** memories.ts:164-169 enumerateOwner live-only | fixed | Same `listIdsByOwner` seam | `server/src/openmuse-personal/memories.ts:54-60,172-177,262-269` |
| memories.ts:307-309 ownerDisabled hardcoded false | fixed | Phase-aware marker read + boundary note | `memories.ts:318-337` |
| tools.ts:80-87 task_delegate bypasses O04's ACTIVE_TASKS_PER_USER quota | fixed | `activeTasks` added to the tasks Pick; refusal string before create (quota + TASK_LIMIT_MESSAGE); tool wrapper passes string results through unserialized so the refusal reaches the model like the parse refusal | `server/src/openmuse-personal/tools.ts:2,29,90-100,47-53`; test "refuses once the owner's active Task quota is full…" |
| memories.ts:110-113 decodeCursor accepts safe integers beyond Date's range → Invalid Date → 500 | fixed | `Number.isNaN(createdAt.getTime())` rejects; route-level 400 test with `9007199254740991|x` | `server/src/openmuse-personal/memories.ts:117-131`; test "a safe integer beyond Date's range answers 400…" |

## Totals

- 37 findings: **33 fixed** (31 code + 2 contract-recording doc comments whose
  remediation is otherwise cross-module), **1 invalid**, **3 dependency-only**.
- 9 high-severity: 7 fixed, 1 dependency (#9 channels enumeration), 1 invalid
  (#27 TS18046 claim).
- Not fixed before this pass and confirmed by failing committed tests: the
  store re-fence gap (#13) — two DB-backed tests were red at baseline and are
  green now.

## Verification

- `bun test` over all 8 cluster suites with
  `TEST_DATABASE_URL=postgres://openbot:openbot@localhost:5435/openbot_enterprise_test`
  (drizzle migrations applied to the dedicated test DB): **225 pass / 0 fail**
  (DB-backed describes included). `openmuse-tasks.test.ts` (covers shutdown.ts
  + deletion routes): **80 pass / 0 fail**.
- `bun run --filter server typecheck`: exit 0.
- `bunx biome lint` + `format` over every touched file: clean.

## Dependencies (cross-module, outside this cluster's ownership)

1. **app.ts wiring** — mount the D02/D03/D04 seams
   (`shutdownOwnerWork`/`revokeExternalAccess`/`buildManifest`) at
   `server/src/app.ts:1888` and mount the D05/D06-D08 admin routes; until
   then a production delete is fence-only (findings #18, and the purge
   surface of #6). The seams, gates and sanitization are in place and tested.
2. **channels `enumerateOwner`** — owner-scoped, membership-limited,
   deletedAt-ignoring enumeration on `ChannelStore`
   (`server/src/channels/routes.ts`) so D04's manifest can name soft-deleted
   channels (finding #9).
3. **phase-aware ownerDisabled in tasks/files/connectors** —
   `openmuse-tasks/store.ts:1227`, `openmuse-files/store.ts:665`,
   `openmuse-connectors/store.ts:273` read the marker row-existence-only, so
   D05 restore leaves those three seams refusing (finding #14). The read to
   converge on is `openmuse-deletion/store.ts` `isDisabled`'s (phase =
   `fenced`), which this cluster's four seams now implement.
4. **fence the remaining seams or revoke sessions on delete** —
   `server/src/computer/stream-auth.ts`, the `/api/channels` mount and the
   copilot surface do not consult the marker (finding #6's exposure).
5. **D09 cleanup-view pagination** — bounding the operator roster requires a
   paginated cleanup endpoint (response contract), not a query-side limit
   that would truncate "every marker there is" (finding #17).

Observed, pre-existing, outside this cluster's ownership: `openmuse-files.test.ts`
fails 1 test on its own ("a fill-append prunes superseded middle versions")
and drags one mobile-bff quota test down when co-run — both in the
openmuse-files module, untouched here. Also fixed in passing (in-ownership):
`tests/openmuse-activity.test.ts` used `beforeAll` without importing it,
which surfaced as an unhandled error once `TEST_DATABASE_URL` runs the
DB-backed describe.
