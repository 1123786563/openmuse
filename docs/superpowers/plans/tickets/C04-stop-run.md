# C04 — Stop a streamed Bot run: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD for pure seams. Predecessor C01 verified+integrated.

**Goal:** A running reply can be stopped: the stop request reaches the runtime, the run lands a singular terminal state (stopped or completed — never both, never an eternal spinner), stop is idempotent, and a stop racing completion produces exactly one terminal transcript.

**Architecture:** Client: a Stop button on the chat screen's streaming state calling the runtime's stop seam (Task 0: find the headless SDK's stop API — `copilotkit` context or agent.stopRun/`agent.interrupt` — cite the SDK .d.ts; if the SDK has no explicit stop, use the server's existing run-stop route if one exists — rg /stop in server/src — and cite). Pure seam `stop-state.ts`: `terminalOf(events)` collapsing stop/completion races to ONE terminal outcome + `stopButtonState(streaming, pending)` for UI (disabled while pending, idempotent re-click safe). Chat UI wiring with a terminal chip (已停止/已完成 zh-CN).

**Spec:** Contracts §3 (Stop is idempotent and reaches stopped or completed, never an eternal spinner; stop racing completion leaves one terminal state and one transcript); catalog C04; Issue #17.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/openmuse/.worktrees/v4-base. NO commits.
- Owned files: Create apps/mobile/src/openbot/stop-state.ts, apps/mobile/test/openbot-stop-state.test.ts; Modify apps/mobile/src/openbot/chat.tsx (stop button + terminal chip; NO rewrite of C01/C02 wiring), App.tsx only if the chat props need threading (keep minimal).
- Do NOT touch channels/config/auth/client/gate/private-state/computer/task files.

### Task 0

- [ ] Cite the exact stop mechanism: SDK type file+line (node_modules @copilotkit react-native headless) OR the server stop route (server/src — rg "stop"). Record which is used.

### Task 1: RED — stop-state tests

1. `terminalOf`: [run_started, text_delta, stop_requested, run_stopped] → stopped; [run_started, stop_requested, run_completed] → completed (completion wins when it lands first after stop request — deterministic precedence: first terminal event wins, later ones collapse); [run_started] → null (still running);
2. `stopButtonState`: streaming+not-pending → enabled; pending → disabled with label; terminal → hidden;
3. idempotent stop: second stop call after terminal → no-op (no second request — assert via the UI reducer's request counter).

### Task 2: GREEN

- stop-state.ts per matrix; chat.tsx: stop button calling the Task-0 seam, pending state, terminal chip rendering, transcript untouched by stop (no local message fabrication).
- `pnpm test && pnpm --dir apps/mobile typecheck && pnpm lint` green; `pnpm build:web` exports (record tail).

### Task 3: Checkpoint

- Report: Task 0 citation, files + shasum, test tails, build:web tail, S13 live race fixture deferred note. No commit.

## Failure handling

- If the SDK exposes no stop and no server stop route exists, implement the UI state machine against a `stopRequested` local seam and STOP to ask before inventing a server route (that would be a new server surface needing approval).
