# C05 — Resume a stream without duplicate events: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD for pure seams. Predecessors C01+C04 verified+integrated.

**Goal:** §3 stream resume: after a disconnect at event e2, reconnecting replays e2/e3 but the UI renders e2 exactly ONCE then e3; if the cursor cannot be replayed, the client reloads the persisted thread history and shows an interruption indicator — never a spinner, never duplicates.

**Architecture:** Pure seam `src/openbot/stream-resume.ts`: `dedupeByEventId(received, rendered)` keyed on (threadId, runId, eventId) — a render-set model with `applyBatch` returning only newly-unseen events; `resumeStrategy(lastEventId, replayOffered)` deciding `resume-from-cursor | reload-history | already-current`. Chat wiring: on remount/reconnect the useAgent thread load replays events (per the runtime's behavior — Task 0 cites what the SDK emits on reconnect); the dedupe seam wraps transcript construction; an interruption chip renders when reload-history path taken. The persisted-thread reload uses the same history path C01 mounts with.

**Spec:** Contracts §3 (persist/render each event once by (threadId, runId, eventId); cursor unavailable → reload persisted Thread with interruption indicator); catalog C05; Issue #18. Fixture: e1 text, e2 tool-start, disconnect, replay e2/e3 → e2 once then e3.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/openmuse/.worktrees/v4-base. NO commits.
- Owned files: Create apps/mobile/src/openbot/stream-resume.ts, apps/mobile/test/openbot-stream-resume.test.ts; Modify apps/mobile/src/openbot/chat.tsx (dedupe wrap + interruption chip; NO rewrite of C01/C02/C04 wiring).
- Do NOT touch channels/config/auth/client/gate/private-state/computer/task files.

### Task 0

- [ ] Cite (SDK .d.ts or observed event shape) what the runtime emits on thread re-attach: event ids present? runId? Record the key fields the dedupe uses; if ids are absent, key on (runId, seq) fallback and record.

### Task 1: RED — seam tests

1. applyBatch: [e1,e2] then replay [e2,e3] → renders e3 only (e2 seen once total); keys include threadId+runId+eventId;
2. cross-run safety: same eventId in a different runId is NOT deduped;
3. resumeStrategy: cursor ≤ offered max → resume-from-cursor; offered history lacks cursor → reload-history; no lastEventId → fresh;
4. interruption indicator derived state: reload-history → chip visible; resume path → not;
5. out-of-order late batch after reload: late duplicates discarded.

### Task 2: GREEN

- stream-resume.ts per matrix; chat.tsx wiring (transcript built through the dedupe model; remount path uses the strategy; chip 已中断恢复 zh-CN).
- `pnpm test && pnpm --dir apps/mobile typecheck && pnpm lint` green; `pnpm build:web` exports (record tail).

### Task 3: Checkpoint

- Report: Task 0 citation, files + shasum, test tails, build:web tail, F-STREAM-1/S13 live deferred note. No commit.

## Failure handling

- If the SDK's reconnect yields no event identity at all, implement the (runId, seq) fallback and flag the live-verification dependency for C08/C09.
