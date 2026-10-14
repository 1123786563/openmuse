# C01 — Send one Channel message: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD where testable. Predecessor I03 verified+integrated (session {botId, channelId, threadId} persisted). I05 may land in parallel — do not touch its files (config.ts, android tests).

**Goal:** The OpenMuse client opens its private Bot's channel through the OpenBot CopilotKit runtime: one message streams one reply, the three identities (botId/channelId/threadId) stay distinct and retained, and a reload restores the persisted Thread history from the runtime.

**Architecture:** Wrap the OpenBot app in `CopilotKitProvider` (`@copilotkit/react-native/headless`): web `runtimeUrl={openbotUrl+"/api/copilotkit"} credentials="include"`; native resolves `sessionCookie()` once at mount and passes it as a `Cookie` header (provider props pattern from OpenBot's app/src/lib/copilot/provider.tsx — READ-ONLY prior art). New slim `src/openbot/chat.tsx`: `OpenBotChatScreen({session})` using `useAgent({ agentId: "channel:"+session.channelId, runtimeAgentId: session.botId, threadId: session.threadId })` — the exact identity convention of OpenBot's web ChannelChat (app/src/components/channels/channel-chat.tsx, READ-ONLY prior art) — with a text transcript, an input, send, streaming indicator, and mount-time history restore. App.tsx OpenBotApp renders this screen as the chat section (replacing the interim status screen; keep sign-out).

**Tech Stack:** @copilotkit/react-native@1.70.1 headless (already a dependency), node:test pure seams for the non-React logic (message normalization, identity mapping).

**Spec:**
- Contracts §3 Conversation identity: /Users/wuyongjun/trea/openmuse/.worktrees/v4-base/docs/superpowers/plans/2026-10-12-openmuse-openbot-contracts-v4.md
- Catalog C01; Issue #14. Server side needs NOTHING new (runtime + conversations seam exist).

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/openmuse/.worktrees/v4-base. NO commits.
- Owned files: Create apps/mobile/src/openbot/{chat.tsx,chat-state.ts}; Modify apps/mobile/App.tsx (OpenBotApp branch only); Create apps/mobile/test/openbot-chat-state.test.ts.
- Do NOT touch: config.ts (I05 concurrent), auth.ts/client.ts/gate.tsx/private-state.ts, legacy src/chat.tsx and screens (C06+ own the rich adaptation).
- zh-CN user copy via module-internal map; English comments.

### Task 1: RED — chat-state pure tests

- [ ] **Step 1:** apps/mobile/test/openbot-chat-state.test.ts for a pure `chat-state.ts`:
  1. `channelAgentId(session)` → `channel:<channelId>` (runtime convention), never the botId;
  2. `runtimeAgentFor(session)` → `{ agentId: "channel:"+channelId, runtimeAgentId: botId, threadId }` — the three identities distinct and non-empty (assert all three differ pairwise when given distinct fixture ids);
  3. `toTranscript(messages)` maps AG-UI message objects ({id, role: "assistant"|"user", content}) to view rows, keeping order, dropping empties, and marking streaming rows when `isStreaming` present;
  4. `nextUserMessage(draft)` trims and refuses empty send (returns null);
  5. `historyKey(session)` → stable storage key per channel (`openmuse-openbot-chat-<channelId>`) used ONLY for local optimistic echo, never as authority.
- [ ] **Step 2:** Run the new test file → FAIL.

### Task 2: GREEN — chat-state + screen

- [ ] **Step 1:** Implement chat-state.ts exactly per Task 1.
- [ ] **Step 2:** chat.tsx: `OpenBotChatScreen({ session, onSignOut })`:
  - `const { agent } = useAgent(runtimeAgentFor(session))` (import from `@copilotkit/react-native/headless`);
  - transcript from `agent.messages` via toTranscript; input + send calls the headless run API (READ channel-chat.tsx lines ~380-420 for the exact v2 send/subscribe calls and mirror them minimally);
  - mount-time history restore: mirror channel-chat.tsx's restore approach for `threadId` (its join/restore block) — minimally: rely on the useAgent thread load; if the headless API needs an explicit restore call, use exactly what the prior art uses;
  - error surface: a run error shows a retryable error row (no fabricated success), zh-CN copy;
  - sign-out button stays (reuse I06 flow).
- [ ] **Step 3:** App.tsx: OpenBotApp renders `<OpenBotChatScreen session={entry.session} …/>` in place of the status screen (keep the workspace snapshot in state for later tickets).
- [ ] **Step 4:** Provider wiring in App.tsx OpenBotApp: web — `credentials="include"`, no manual headers; native — resolve `sessionCookie()` into state at mount, pass `headers={{Cookie}}` when present (document that cookie rotation re-mounts via key change if needed — key on cookie presence, not value).
- [ ] **Step 5:** `pnpm test && pnpm --dir apps/mobile typecheck && pnpm lint` green; `pnpm build:web` from repo root exports (record tail).

### Task 3: Checkpoint

- [ ] Report: changed files + shasum, build:web tail, the exact headless API calls used (with file:line citations from the SDK types), and the statement that live two-way chat evidence (S11-W etc.) runs in the browser verification pass. No commit.

## Acceptance (Issue #14 / catalog C01)

Client opens one permitted Bot through the existing mobile conversation seam (identities retained — asserted in chat-state tests); one reply and persisted Thread history appear after reload (mount-restore implemented per prior art; live reload evidence deferred and recorded). Foreign channel refusal comes from the server seam (I02's isolation) — no client-side ownership logic added.

## Failure handling

- If the headless SDK's useAgent differs from react-core v2 (no threadId option), fall back to the imperative connectAgent path the legacy chat.tsx uses, passing agent name `channel:<channelId>`; record the exact API shape you found in the SDK .d.ts and cite it.
- If the runtime refuses the native Cookie header auth, keep web working and record the native gap for I04/C08 follow-up (do not fake success).
