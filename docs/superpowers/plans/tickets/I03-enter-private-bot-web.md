# I03 — Enter the provisioned Bot on Web: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-task ticket plan; one agent context, TDD. Predecessors: I01 (openbot client layer in place — see apps/mobile/src/openbot/*) and I02 (server endpoint live in OpenBot worktree) both verified+integrated.

**Goal:** On first Web entry the client provisions the private OpenMuse Bot (POST /api/mobile/openmuse-bot), reads the workspace, opens the returned private Bot's conversation via the existing seam (openConversation → {botId, channelId, threadId}), and renders the workspace with that session; repeat entry reuses the same Bot ID; no fixed default runtime identity remains on the web path.

**Architecture:** Extend `src/openbot/api.ts` with `provisionOpenMuseBot()`. Extend `gate-state.ts` with an `entrySequence` reducer covering provision→workspace→conversation states and failure kinds. `gate.tsx` runs the sequence after sign-in (provision BEFORE workspace read), passes the resulting `{workspace, session}` to onReady. `App.tsx` OpenBotApp holds the snapshot + session; renders a workspace status screen showing the private Bot + channel + thread IDs (real chat UI is C01's scope — placeholder content allowed there ONLY, not fake data). Selection state persisted in sessionStorage under a stable key for repeat-entry reuse (cleared on logout/sign-out).

**Tech Stack:** same as I01 (zod, node:test pure seams, react-native web).

**Spec:**
- Contracts §2 first-entry contract + §3 conversation identity: /Users/wuyongjun/trea/openmuse/.worktrees/v4-base/docs/superpowers/plans/2026-10-12-openmuse-openbot-contracts-v4.md
- Catalog I03; Issue #7. I01 modules at apps/mobile/src/openbot/.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/openmuse/.worktrees/v4-base. NO commits.
- Owned files: Modify apps/mobile/src/openbot/{api.ts,gate-state.ts,gate.tsx,types.ts}, apps/mobile/App.tsx (web branch only), apps/mobile/test/{openbot-api.test.ts,openbot-gate.test.ts}. Nothing else.
- zh-CN user copy via module-internal map (same convention as I01). English comments.
- The native legacy branch must remain untouched.

### Task 1: RED — provision + entry-sequence tests

- [ ] **Step 1:** openbot-api.test.ts additions (fetch stub):
  1. `provisionOpenMuseBot()` POSTs `{}` to `/api/mobile/openmuse-bot` (never a user id) and returns `{botId, templateVersion, computerProfileId}` from zod schema;
  2. repeat call returns same shape (server idempotency is I02's; client just parses);
  3. 401 → authentication_required; 404/403 → their codes; still never `/api/session`.
- [ ] **Step 2:** openbot-gate.test.ts additions (entrySequence reducer):
  1. happy path events `provision-ok{botId}` → `workspace-ok{agents incl. botId}` → `conversation-ok{botId,channelId,threadId}` ends in `ready` carrying all three;
  2. provision 401 → back to `signin`; provision 409/5xx → `error` retryable, retry restarts at provision;
  3. workspace missing the provisioned botId → `error` (data inconsistency, non-retryable message);
  4. conversation 404 → `error` with not_found surfaced;
  5. persisted-session reuse: reducer input `stored{botId,channelId,threadId}` + workspace containing botId → skips provision+conversation, goes straight to `ready` with stored ids.
- [ ] **Step 3:** Run `pnpm test` → new cases FAIL.

### Task 2: GREEN

- [ ] **Step 1:** api.ts: `provisionOpenMuseBot(signal?)` (POST, isWrite=true so 5xx → outcome_unknown, empty JSON body). types.ts: provision result schema.
- [ ] **Step 2:** gate-state.ts: extend reducer per Task 1 Step 2 contract (pure; no new React imports).
- [ ] **Step 3:** gate.tsx: after `fetchMe()`, run sequence: stored session → validate via workspace read only; else provision → workspace → openConversation(privateBotId) where privateBotId = provision.botId (NOT a name-based lookup); persist to sessionStorage key `openmuse-openbot-session-v1` on success; on 401 anywhere → clear session → signin.
- [ ] **Step 4:** App.tsx OpenBotApp: accept `{workspace, session}` from gate; render workspace status (private Bot name/title, channelId/threadId, sign-out). Remove any remaining fixed/default runtime identity from the web path (rg for `default` agent/main-thread references in the web branch — expect none; record the check).
- [ ] **Step 5:** `pnpm test && pnpm --dir apps/mobile typecheck && pnpm lint` → all green. `rg -n "api/session" apps/mobile/src/openbot apps/mobile/App.tsx` → zero on web path (record).

### Task 3: Checkpoint

- [ ] Report: changed files + shasum, test tails, the no-fixed-identity proof, sessionStorage key name. No commit.

## Acceptance (Issue #7 / catalog I03)

First Web entry calls provisioning then workspace read and opens returned private Bot; repeat entry reuses ID; no fixed default runtime identity remains. Browser-live evidence (S03/S04/S06 web rows) executes against the O01 baseline in a later verification pass — record as follow-up, not claimed here.

## Failure handling

- If openConversation's server contract at OpenBot HEAD differs from `{botId,channelId,threadId}` (check server/src/mobile-bff/routes.ts conversations route), align types.ts to the server (record divergence from copied-client assumptions).
