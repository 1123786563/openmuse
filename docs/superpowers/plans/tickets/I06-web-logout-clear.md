# I06 — Clear Web private state on logout: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessor I03 verified+integrated (gate + session persistence present).

**Goal:** Web logout revokes the Better Auth session server-side, clears every web-private cache listed in contract §2 (session storage, workspace snapshot, CopilotKit runtime/session state, channel/thread caches, drafts, preview URLs, PDF viewer URLs), and a following sign-in as another user on the same browser sees none of the previous user's data.

**Architecture:** One `clearWebPrivateState()` module enumerating every storage key/path the web path owns (single registry), called from sign-out (gate + App-level), from 401 handling, and before each sign-in. Storage registry unit-tested; an integration-style test drives two sequential fake users through gate-state to assert nothing persists.

**Tech Stack:** sessionStorage/localStorage registry, better-auth signOut, node:test.

**Spec:**
- Contracts §2 Client state inventory table (Web rows): /Users/wuyongjun/trea/openmuse/.worktrees/v4-base/docs/superpowers/plans/2026-10-12-openmuse-openbot-contracts-v4.md
- Catalog I06; Issue #10.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/openmuse/.worktrees/v4-base. NO commits.
- Owned files: Create apps/mobile/src/openbot/private-state.ts, apps/mobile/test/openbot-private-state.test.ts; Modify apps/mobile/src/openbot/{gate.tsx,gate-state.ts}, apps/mobile/App.tsx (web branch), apps/mobile/test/openbot-gate.test.ts.
- The contract table's NATIVE-only rows (expo-file-system PDF cache, native secure store) are out of scope (I07/I08).
- zh-CN copy per module-internal convention; English comments.

### Task 1: RED — registry + clearing tests

- [ ] **Step 1:** openbot-private-state.test.ts:
  1. `webPrivateStorageKeys` registry contains at least: the I03 session key (`openmuse-openbot-session-v1`), a workspace snapshot key, a CopilotKit runtime/session key prefix (`copilotkit-*` documented pattern), drafts key, preview-url key, viewer-url key — exact names must match what I03/I01 actually wrote (read the code first; the registry is the single source);
  2. `clearWebPrivateState({sessionStorage,localStorage})` removes every registry key AND every key matching registered prefixes, leaving unrelated keys (e.g. `unrelated-theme`) untouched;
  3. after sign-out sequence runs, a NEW sign-in flow (second fake user) starts with zero registry keys present.
- [ ] **Step 2:** Run `pnpm test` → new file FAIL.

### Task 2: GREEN

- [ ] **Step 1:** Implement private-state.ts: `webPrivateStorageKeys: {exact: string[], prefixes: string[]}`, `clearWebPrivateState(stores?)` (defaults to real web storage guarded by Platform.OS === "web"), and `assertCleared(stores)` used by tests.
- [ ] **Step 2:** Wire: gate.tsx sign-out → `await authClient.signOut()` then `clearWebPrivateState()` then reset to signin phase; 401 path (isAuthFailure) → same clearing; App.tsx OpenBotApp sign-out handler → clear + unset snapshot/session state; gate-state reducer gains `signed-out` event → `signin` phase (test it).
- [ ] **Step 3:** Extend openbot-gate.test.ts: signed-out event resets to signin and a subsequent workspace-ok for a different user does not observe prior user's session key (simulate via storage stub).
- [ ] **Step 4:** `pnpm test && pnpm --dir apps/mobile typecheck && pnpm lint` → green. rg-proof: `rg -n "openmuse-openbot-session-v1" apps/mobile/src` shows the registry as the ONLY place constructing/removing the key besides its initial write.

### Task 3: Checkpoint

- [ ] Report: registry contents (exact keys/prefixes), where each is written vs cleared (file:line table), test tails, shasum. No commit.

## Acceptance (Issue #10 / catalog I06)

Logout revokes Web cookie (authClient.signOut) and clears CopilotKit, Channel/Thread, drafts, preview URLs and viewer state per contract §2 web rows; user B on the same browser sees none of user A's data. Live shared-browser evidence (S05-W) runs in the later browser verification pass — record as follow-up; unit+sequence tests are this ticket's proof.

## Failure handling

- If I03's actual key names differ from the plan's guesses, the registry must be built from the REAL names (read the code — registry correctness beats plan literals).
