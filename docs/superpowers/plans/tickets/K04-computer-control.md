# K04 — Control the computer from OpenMuse: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD for pure seams. Predecessors K02+K03 verified+integrated.

**Goal:** The Computer screen gains human control: request → take → active control → release are visible states; input (click/type keystrokes) dispatches ONLY while controlling; logout/disconnect ends control; late input after release/revocation is refused visibly (403/409 surfaced, not silent).

**Architecture:** Client over the K03 server seams (routes: POST /api/computers/:botId/control/request|take|release|cancel + input paths — Task 0: cite the exact input route shapes from server/src/computer/routes.ts incl. the human input verb(s)). New pure `src/openbot/control-state.ts` (viewing→requesting→controlling→released + refused/expired; input guard: controlling-only; late-input-refusal classification of 403/409) + `src/openbot/control.tsx` (ControlPanel merged into the Computer screen: buttons per state, minimal input surface — a click-at (x,y) pad + text type-into-focused + Enter key — honest scoping: full keyboard/mouse streaming is the native pass; record). api.ts: control + input calls.

**Spec:** Contracts §3 (viewing→requesting→controlling→released; late input 403/409 not delivered); catalog K04; Issue #25.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/openmuse/.worktrees/v4-base. NO commits.
- Owned files: Create apps/mobile/src/openbot/{control-state.ts,control.tsx}, apps/mobile/test/openbot-control-state.test.ts; Modify apps/mobile/src/openbot/{api.ts,computer.tsx (embed the panel)}, App.tsx only if needed.
- Do NOT touch chat/channels/config/auth/client/gate/private-state/task/calendar/connections/files files.

### Task 0

- [ ] Cite the control + input route shapes (verbs, payloads, error codes) from the server worktree's computer/routes.ts + the K03 evidence file's mapping.

### Task 1: RED — control-state tests

1. state machine: viewing→requesting (request sent)→controlling (take ok)→released (release/disconnect); refused/expired terminal sub-states per K03's semantics;
2. input guard: dispatch allowed ONLY in controlling; queued input while requesting → refused locally (no request);
3. late-input classification: 403/409 after release → visible 已断开 refusal state, input NOT retried;
4. logout path: sign-out flow ends control (release best-effort) — pure reducer assertion.

### Task 2: GREEN

- control-state.ts per matrix; api.ts calls per Task 0 shapes; control.tsx panel (state chips zh-CN, click pad, type box, Enter key); computer.tsx embed.
- `pnpm test && pnpm --dir apps/mobile typecheck && pnpm lint` green; `pnpm build:web` exports (record tail).

### Task 3: Checkpoint

- Report: Task 0 citations, files + shasum, test tails, build:web tail, S38/F-CONTROL-1 live device notes deferred. No commit.

## Failure handling

- If input streaming requires WS-level framing not yet exposed, implement the HTTP input path only (K03's routes) and record the WS deferral for the native passes.
