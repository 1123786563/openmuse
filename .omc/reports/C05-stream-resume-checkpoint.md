# C05 — stream resume checkpoint report (ticket for issue #18)

## Task 0 — event-identity citation (what the runtime emits on re-attach)

- **Durable event id IS present.** `@copilotkit/core` `dist/index.mjs` `readEventId()`: every
  gateway event carries a durable id at `metadata.cpki_event_id` (string; ids prefixed
  `cpki_ingested*` are excluded as non-durable). This is the exact value the SDK persists as the
  per-thread `lastSeenEventIds` cursor (`index.d.mts:2521`).
- **Reconnect replays past the cursor.** `@copilotkit/core` `index.d.mts:752-769` (RunHandler) and
  `index.d.mts:2634-2696` (`connect`/`clearReconnectCursor`): on a **same-thread** churn
  re-connect the cursor is preserved and the gateway **streams/replays events past
  `lastSeenEventId`** (their historical bug note: that replay amplification produced "duplicate
  `cpki_event_id` rows" — i.e. re-delivered events keep their ids, which is what makes id-dedupe
  sound). On a **thread switch** `clearReconnectCursor` forces a full historical replay.
- **Message + run identity.** `@ag-ui/core` `dist/index.d.mts:48` `BaseMessageSchema`: persisted
  messages carry a stable `id: string` (plus `role`, optional `subagentRunId`).
  `RunStartedEventSchema` (`index.d.mts:7144`): run events carry `threadId: string` +
  `runId: string`. `BaseEventSchema` has no global `id`/`runId` on the base type — identity is
  per-shape (`messageId` on message events, `runId` on run events, `cpki_event_id` in metadata).
- **Conclusion:** ids are present, so the seam keys on (threadId, runId, eventId) as contracted;
  the (runId, seq) fallback was NOT needed. Chat wiring scopes transcript rows to the thread
  (`THREAD_RUN_SCOPE`) because message ids are stable across replay while the run status may have
  reset when a replay lands.

## Files + shasum (no commits; only owned files touched)

```
64c730f7b1f67f5f62671a118c83e97fdda3852d612708269a164d4122874610  apps/mobile/src/openbot/stream-resume.ts   (new, pure seam)
45d6fa483e50257059d064a10feab6edbfdd26def72df1b178460fc1c552a3f5  apps/mobile/test/openbot-stream-resume.test.ts (new, 10 tests)
a417cd0c256b9337cef3cebaa2f2d391e8e440c7b4cc138407dccd4ed1a5cd8f  apps/mobile/src/openbot/chat.tsx (dedupe wrap + interruption chip, additive)
```

Pre-existing dirty files (`App.tsx`, `package.json`, `pnpm-lock.yaml`, other openbot files) belong
to C01–C04 in this shared worktree and were not modified. channels/config/auth/client/gate/
private-state/computer/task files untouched.

## Implementation summary

- `stream-resume.ts`: `dedupeByEventId(received, rendered)` pure fn + `createRenderSet()` model
  (`applyBatch` returns only newly-unseen events, `reset(history)` re-bases on a reloaded thread,
  `lastEventId()` = resume cursor) keyed on (threadId, runId, eventId);
  `resumeStrategy(lastEventId, replayOffered)` → `resume-from-cursor | reload-history |
  already-current | fresh` (anchoring decided by cursor containment in the offered window —
  opaque gateway ids are not sortable, and a window skipping past the cursor hides missed events);
  `interruptionVisible(decision)` → chip only on reload-history.
- `chat.tsx` (additive; C01 mount/C02 wiring/C04 stop flow kept intact): render-set ref accounts
  every rendered row; the mount effect captures the pre-connect cursor on a same-instance
  re-run, and after `connectAgent` resolves decides the resume path — reload-history re-bases the
  set on the reloaded Thread and shows the 已中断恢复 chip; chip clears on next send.

## Verification

`pnpm test` (RED first: file-load failure with module absent, then GREEN):

```
ℹ tests 585
ℹ suites 0
ℹ pass 585
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 29188.641709
```

`pnpm --dir apps/mobile typecheck`: `tsc --noEmit` clean.
`pnpm lint` (biome): clean; the single remaining "info" is the pre-existing biome.json
schema-version (2.5.13 vs CLI 2.5.15) notice, unrelated.

`pnpm build:web` tail:

```
› web bundles (4):
_expo/static/js/web/index-650483320ab6c06d9357d861d656db19.js (5.48 MB)
...
› Files (2):
index.html (1.21 kB)
metadata.json (49 B)
Exported: dist/web
```

## F-STREAM-1 / S13 — live verification deferred

F-STREAM-1 (live end-to-end disconnect→reconnect against the real gateway) and S13 are NOT
exercised here: they need a live runtime socket drop mid-run, which belongs to the live
verification tickets (C08/C09). Everything testable at the pure seam is covered by the 10
node:test cases; the reconnect decision path in `chat.tsx` follows the Task 0 SDK citations but
was not driven against a live gateway.
