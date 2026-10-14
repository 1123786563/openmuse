# I04 — Restore an iOS Better Auth session: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessors B03+I03 verified+integrated. This ticket implements the SHARED native session layer and verifies it for iOS; I05 re-verifies on Android and owns any Android-specific delta. Dispatch after I06 completes (file overlap on App.tsx/gate).

**Goal:** On iOS the app returns to the same Bot after process restart using the Better Auth Expo session (SecureStore), every native request (REST + CopilotKit + downloads) carries the session cookie explicitly, a 401 clears private state and shows sign-in, and the old OpenMuse access key path is no longer used on native.

**Architecture:** Port the native half of the copied client's proven auth: `auth.ts` gains the `@better-auth/expo` client plugin with SecureStore storage (web keeps localStorage branch), `client.ts` injects `Cookie: <sessionCookie()>` on native via a cookie-provider hook, App.tsx's NATIVE branch switches from legacy OpenMuseApp to the OpenBot gate (web branch unchanged). The legacy local flow's code remains in-tree (removal is B04) but is unreachable.

**Tech Stack:** @better-auth/expo 1.7.1 (same version as better-auth), expo-secure-store, bun:none — pnpm workspace; node:test pure seams.

**Spec:**
- Contracts §2 native rows (session credential table): /Users/wuyongjun/trea/openmuse/.worktrees/v4-base/docs/superpowers/plans/2026-10-12-openmuse-openbot-contracts-v4.md
- Catalog I04; Issue #8. Prior art: /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base/apps/openmuse-mobile/src/openbot/{auth.ts,client.ts} + server EXPO_APP_SCHEME config (server/src/auth/index.ts:388).

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/openmuse/.worktrees/v4-base. NO commits.
- Owned files: Modify apps/mobile/src/openbot/{auth.ts,client.ts,gate.tsx}, apps/mobile/App.tsx (native branch switch only), apps/mobile/package.json (+@better-auth/expo, +expo-secure-store), pnpm-lock.yaml, apps/mobile/test/{openbot-client.test.ts,openbot-gate.test.ts}; Create apps/mobile/test/openbot-native-session.test.ts.
- Server-side scheme allowlist: the OpenBot deployment must list the app scheme `openmuse://` in trusted origins — that is CONFIG (O02/O01 deployment env), not code here; record the requirement in your report, do not edit OpenBot.
- zh-CN copy convention per module-internal map.

### Task 1: RED — native session tests

- [ ] openbot-native-session.test.ts (injected storage + cookieProvider + fetchImpl):
  1. `sessionCookie()` on native resolves the stored cookie (storage stub) and null on web;
  2. `openbotFetch` on native sends `Cookie` header from the cookieProvider and `credentials` NOT include (native has no cookie jar; explicit header); on web sends credentials include and no manual Cookie header (assert via fetchImpl capture, platform injected as parameter — do NOT import react-native here; make platform a parameter of the transport config);
  3. 401 on native → authentication_required AND `onAuthExpired` hook fires (gate uses it to clear SecureStore session + private state and flip to signin);
  4. restore flow: `currentSession()` reads storage → present → gate proceeds to fetchMe; absent → signin phase (pure reducer already exists; add native-session-present input if missing);
  5. sign-out on native: authClient.signOut + storage cleared + private-state registry cleared (reuse I06's clearWebPrivateState plus SecureStore keys registry — export a native key list from private-state.ts if present, else add one here).
- Run `pnpm test` → FAIL.

### Task 2: GREEN

- [ ] auth.ts: add expoClient plugin (scheme "openmuse", storage SecureStore on native — platform check via injected Platform from react-native is fine INSIDE this module since tests import only pure helpers; export `nativeSessionStorage` injectable for tests), keep web branch intact.
- [ ] client.ts: cookieProvider parameter (default wired to auth.sessionCookie); platform parameter in transport config (`"web" | "native"`); native → Cookie header, web → credentials include.
- [ ] gate.tsx: onAuthExpired wiring (clear session storage + private state + phase signin).
- [ ] App.tsx: native branch renders the OpenBot gate app (same component as web — the platform check collapses to always-gate once native is switched; keep the legacy OpenMuseApp function in file but unreferenced from App, marked for B04 removal).
- [ ] package.json: add @better-auth/expo@1.7.1 + expo-secure-store (version aligned with the copied client's package.json); pnpm install --no-frozen-lockfile; lockfile diff scoped.
- [ ] `pnpm test && pnpm --dir apps/mobile typecheck && pnpm lint` green. `pnpm build:ios` succeeds (proves native bundle compiles with the new deps) — run from repo root, record tail.

### Task 3: Checkpoint

- [ ] Report: changed files + shasum, lockfile delta summary, build:ios tail, the trusted-origin config requirement note for deployment, explicit statement that live iOS restart/401 device evidence (S01-I/S04-I) is deferred to the gate pass. No commit.

## Acceptance (Issue #8 / catalog I04)

iOS returns to the same Bot after process restart (code path implemented + unit-verified; live device run deferred and recorded); getSession 401 clears private view and asks sign-in; no old OpenMuse access key is used on native (rg-proof: legacy createSession/api-session unreachable from the native branch).

## Failure handling

- If @better-auth/expo@1.7.1 peer-conflicts with the workspace expo version, try nearest 1.7.x; record the resolution.
- If SecureStore import breaks web build (module resolution), use lazy require inside the native branch only — record the pattern.
