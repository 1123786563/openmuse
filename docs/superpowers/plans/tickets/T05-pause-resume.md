# T05 — Pause and resume a Task: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessor T02 verified+integrated. Mirrors T04's shape.

**Goal:** §7 pause/resume matrix: queued/running/scheduled → paused at a safe boundary; paused → queued on resume (exactly once); terminal or wrong owner → 409/404; a paused task is never claimed by the runner; resume re-offers to the queue exactly once.

**Architecture:** Store `requestPause` (CAS: queued/scheduled → paused directly; running → `pauseRequested` flag, public status running until the turn's safe boundary, then paused) + `resume` (paused → queued + re-offer via injected queue, idempotent by a status guard). Runner honors pauseRequested like T04's cancellation. Routes `POST /:id/pause`, `POST /:id/resume` (owner-scoped). Migration 00NN adds `pause_requested`.

**Spec:** Contracts §7 control transitions; catalog T05; Issue #62.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-tasks/{store.ts,routes.ts,runner.ts}, server/tests/openmuse-{tasks,task-runner}.test.ts; migration 00NN (db:generate w/ DATABASE_URL; SQL verbatim; no migrate; no app.ts/index.ts edits).

### Task 1: RED — matrix tests

1. queued → pause → paused; running → pause → `{status:"running",pauseRequested:true}` then runner lands paused after the turn (not succeeded); scheduled → paused;
2. paused → resume → queued AND queue re-offered exactly once (second resume while queued → 409 currentStatus queued);
3. terminal → pause/resume → 409 with currentStatus; paused → pause again → 409;
4. paused task never claimed: fake queue claim returns nothing for paused rows (store's offer-side guard: sweep skips paused; document which side enforces);
5. foreign owner 404; disabled owner 403;
6. cancel-then-pause interplay: cancelled → pause 409; pauseRequested then cancel-request → cancel wins at the boundary (status cancelled) — document precedence.

### Task 2: GREEN

- Migration (pause_requested), store CAS, runner boundary checks (cancel precedence over pause), routes.
- `bun test tests/openmuse-tasks.test.ts tests/openmuse-task-runner.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: migration SQL, files + shasum, test tails, S33 deferred note. No commit.

## Failure handling

- If re-offer needs the routes' queue dep (like create), inject the same seam T02 used; no new wiring files.
