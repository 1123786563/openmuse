# K02 — Show computer preview: Implementation Plan

> **For agentic workers:** REQUIRED SUB-KILL: single-bounded-ticket plan; one agent context, TDD for pure seams. Predecessor K01 verified+integrated (stream-auth extraction; snapshot route exists server-side).

**Goal:** The OpenMuse app shows the own private Bot's computer preview: current snapshot (authenticated fetch), live state indicator, and on stream closure a clear disconnected state — with no preview URL retained in storage after disconnect.

**Architecture:** Client-only: new `src/openbot/computer.tsx` (ComputerScreen) + pure `src/openbot/computer-state.ts` (connection state machine viewing/connecting/disconnected + snapshot staleness; URL hygiene). Snapshot via the existing server route (`POST /api/computers/:botId/snapshot` — Task 0 confirms exact path/response through server/src/computer/routes.ts:280; use openbotFetch so session auth rides along). The live WS stream itself (K04 owns control UI) is NOT opened here: this ticket's "live state" is snapshot freshness polling (configurable interval, stops on unmount/disconnect) — an honest reading of "snapshot and live state" bounded to K02; the WS preview lands with K04 and is recorded as such. No URL is written to any storage; disconnect clears in-memory references.

**Tech:** node:test pure seams; react-native components per src/openbot conventions.

**Spec:** Contracts §3 (preview UI; stream closure → disconnected without retained accessible preview URL); catalog K02; Issue #23.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/openmuse/.worktrees/v4-base. NO commits.
- Owned files: Create apps/mobile/src/openbot/{computer.tsx,computer-state.ts}, apps/mobile/test/openbot-computer-state.test.ts; Modify apps/mobile/src/openbot/api.ts (fetchComputerSnapshot), App.tsx (Computer entry in the shell).
- Do NOT touch: chat/channels/config/auth/client/gate/private-state/task files.

### Task 0

- [ ] Confirm the snapshot route contract (path, body, response shape incl. image payload encoding — base64? binary?) from server/src/computer/routes.ts ~line 280; record. If it requires a botId the workspace row lacks, use session.botId.

### Task 1: RED — computer-state tests

1. state machine: idle→viewing (first snapshot ok)→disconnected (fetch 401/403/404 or abort); disconnected never auto-reverts without an explicit retry event;
2. staleness: snapshot older than 2× poll interval → "stale" sub-state (label), newest wins on race (later-arriving older response discarded via seq guard);
3. URL hygiene: `snapshotSourceOf(state)` returns null after disconnect (in-memory only); nothing ever persisted (assert the state module holds no storage calls — static check by import list in test);
4. api: fetchComputerSnapshot POSTs the Task-0 shape via openbotFetch (fetch stub asserts auth path + method); 404 (foreign bot) → not_found; 503 (no computer configured) → unavailable, both land as disconnected-with-reason.

### Task 2: GREEN

- computer-state.ts per matrix; api.ts fetchComputerSnapshot; computer.tsx: preview image area (base64/binary per Task 0), state chip (查看中/已断开/数据过期 zh-CN), retry button (explicit reconnect event), poll loop with unmount cleanup; App.tsx shell entry (Computer button beside Tasks).
- `pnpm test && pnpm --dir apps/mobile typecheck && pnpm lint` green; `pnpm build:web` exports (record tail).

### Task 3: Checkpoint

- Report: Task 0 route contract citation, changed files + shasum, test tails, build:web tail, explicit note: live WS stream preview + closure semantics land with K04 (S38 device-level); S38/K02 live rows deferred. No commit.

## Failure handling

- If the snapshot response is too large for the web Image on some platform, downscale later; render what arrives now and record.
