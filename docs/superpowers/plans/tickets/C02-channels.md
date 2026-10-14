# C02 — Create and switch Channels: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD for pure seams. Predecessor C01 verified+integrated (chat screen on the runtime identity convention).

**Goal:** The user can create a second Channel and switch between Channels: two Channels carry different Thread IDs, switching restores each one's history from the runtime, and the channel list order follows OpenBot's existing pinned/recency/ID keyset convention (server-provided; the client does not re-sort).

**Architecture:** Client-only over existing server seams (Task 0 pins them): channel list already arrives in the workspace read (`channels[]` with `id,name,agentIds,threadId,lastMessageAt`); channel creation uses the existing `POST /api/channels` route (server/src/channels/routes.ts:1096 — Task 0 confirms the request/response shape incl. how a private Bot is attached to the new channel); switching re-keys the chat on the chosen channel: `agentId = "channel:"+channelId`, `threadId` from the channel row. New `src/openbot/channels.tsx` (list + create + switch UI) + pure `src/openbot/channel-state.ts` (ordering passthrough, selected-channel identity, distinct-thread assertion helper) + `api.ts` additions (`createChannel`, typed workspace channel rows already exist).

**Tech Stack:** react-native components per src/openbot/* conventions, node:test pure seams.

**Spec:**
- Contracts §3 Conversation identity (channel list ordered by OpenBot's pinned/recency/ID cursor; threadId stable per channel): /Users/wuyongjun/trea/openmuse/.worktrees/v4-base/docs/superpowers/plans/2026-10-12-openmuse-openbot-contracts-v4.md
- Catalog C02; Issue #15. Server: server/src/channels/routes.ts + mobile-bff workspace read (READ-ONLY).

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/openmuse/.worktrees/v4-base. NO commits.
- Owned files: Create apps/mobile/src/openbot/{channels.tsx,channel-state.ts}, apps/mobile/test/openbot-channel-state.test.ts; Modify apps/mobile/src/openbot/{api.ts (createChannel), chat.tsx (accept channel switch — parameterize the session it renders; NO rewrite of the runtime wiring), App.tsx (channel switcher entry in the OpenBot shell)}.
- Do NOT touch: config.ts, auth/client/gate/private-state, task-view/tasks.
- zh-CN copy module-internal; English comments.

### Task 0: Facts (record)

- [ ] POST /api/channels request/response shape (routes.ts:1096-1113): how the private bot's agentId is attached, what the created row returns (id/name/threadId), and any naming validation. If creating a channel does NOT auto-create a thread/threadId, record how threadId materializes (on first conversation?) and mirror whatever the web app does (app/src channel-create flow — cite).

### Task 1: RED — channel-state tests

- [ ] **Step 1:** apps/mobile/test/openbot-channel-state.test.ts:
  1. `orderPassthrough(channels)` returns the server order EXACTLY (no client re-sort; pinned/recency/ID is the server's answer — the fixture is unsorted by name to prove it);
  2. `selectedIdentity(channel)` → `{agentId:"channel:"+id, runtimeAgentId: agentIds[0], threadId}` and for two channels the threadIds DIFFER (distinct-thread assertion);
  3. `mergeCreated(existing, created)` appends/merges by id without duplicates;
  4. api tests: createChannel POSTs the Task-0 shape to /api/channels and returns the row; 4xx surfaces the error code.
- [ ] **Step 2:** Run new tests → FAIL.

### Task 2: GREEN

- [ ] **Step 1:** channel-state.ts per matrix; api.ts createChannel (shape from Task 0).
- [ ] **Step 2:** channels.tsx: channel list (server order, current highlighted), create form (name validation per Task 0), switch → notifies the shell; chat.tsx accepts a `session`-like prop keyed by selectedIdentity (remount by key so each channel's useAgent thread loads independently — cite the keying approach).
- [ ] **Step 3:** App.tsx: shell keeps the selected channel; switching re-keys the chat; Tasks entry stays.
- [ ] **Step 4:** `pnpm test && pnpm --dir apps/mobile typecheck && pnpm lint` green; `pnpm build:web` exports (record tail).

### Task 3: Checkpoint

- [ ] Report: Task 0 answers with citations, changed files + shasum, test tails, build:web tail, S10 live deferred statement. No commit.

## Acceptance (Issue #15 / catalog C02)

Two Channels have different Thread IDs (distinct-thread assertion + per-channel re-keyed chat); switching restores each history (runtime thread load per channel); server cursor order preserved (orderPassthrough + no re-sort proof). Live evidence deferred to browser pass.

## Failure handling

- If POST /api/channels requires fields the private-bot flow doesn't have (e.g. group membership), STOP and report the mismatch rather than inventing values.
