# I01 — Sign in on Web and read an existing Bot: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-task ticket plan; execute in one agent context, in order, checking off each step. TDD: RED→GREEN for every behavior.

**Goal:** On Web, the canonical OpenMuse client authenticates with the OpenBot Better Auth session (HttpOnly cookie, `credentials: "include"`), reads `/api/mobile/workspace` through the existing mobile BFF seam, shows sign-in on 401, refuses foreign Bot IDs (404 surfaced), and never creates the old `/api/session` Bearer token.

**Architecture:** Port the proven `src/openbot/*` adaptation layer from OpenBot's copied client (B01 rows mapped to I01: api.ts facade, client.ts transport, config.ts, errors.ts, types.ts, email-signin.tsx, gate.tsx) into the canonical `apps/mobile` tree, English copy, web-activated: `Platform.OS === "web"` uses OpenBotGate; native keeps the legacy local flow untouched until I04/I05. Unit tests run in node:test against pure seams (transport mapping, endpoint calls, error classification, gate entry-phase reducer) with an injected fetch; no browser automation in this ticket.

**Tech Stack:** React Native (expo web), better-auth react client (`better-auth/react`, web cookie mode only for this ticket — do NOT add @better-auth/expo/expo-secure-store yet; that lands with I04/I05), zod (already in deps), node:test.

**Spec:**
- Contracts §2 (Identity… §2 client state inventory table): /Users/wuyongjun/trea/openmuse/.worktrees/v4-base/docs/superpowers/plans/2026-10-12-openmuse-openbot-contracts-v4.md
- Prior art (READ-ONLY reference): /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base/apps/openmuse-mobile/src/openbot/ (api.ts, auth.ts, client.ts, config.ts, errors.ts, types.ts, email-signin.tsx, gate.tsx) and its App.tsx openbotBackend switch
- B01 manifest rows target I01: /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base/docs/openmuse-v4/b01-copied-client-inventory.md
- Issue #5 (I01)

> **COPY-CONVENTION AMENDMENT (2026-10-12, coordinator):** canonical main is now 46792335 which ALREADY contains the zh-CN localization (strings.ts pattern). The "All user-facing copy in English" constraint below is REPLACED by: user-facing copy in new/ported modules follows the canonical convention — use the existing `apps/mobile/src/strings.ts` pattern for new user-visible strings (zh-CN), code comments in English. B01's "zh-CN unmapped rows" are superseded by this commit; do not port copy from the copied tree blindly — reconcile against canonical strings.ts.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/openmuse/.worktrees/v4-base (the OpenMuse execution worktree). Never write to /Users/wuyongjun/trea/openmuse or /Users/wuyongjun/trea/OpenBot main checkouts; never write anywhere in /Users/wuyongjun/trea/OpenBot/.worktrees (reference only).
- NO git commits. Uncommitted checkpoint protocol.
- Owned files (only these may be created/modified):
  - Create: apps/mobile/src/openbot/{config.ts,client.ts,errors.ts,types.ts,api.ts,auth.ts,email-signin.tsx,gate.tsx}
  - Create: apps/mobile/test/{openbot-client.test.ts,openbot-api.test.ts,openbot-gate.test.ts}
  - Modify: apps/mobile/App.tsx (web branch only), apps/mobile/package.json (add `better-auth` dep), pnpm-lock.yaml (via pnpm install)
- All user-facing copy in English (the canonical tree is English; zh-CN rows in the copy are explicitly unmapped by B01 and are NOT ported).
- Web auth uses browser cookies only: `createAuthClient` from `better-auth/react` with `baseURL` set, NO expo plugin import on this branch (the auth.ts you create must not import `@better-auth/expo/client` or `expo-secure-store`; keep an exported `sessionCookie(): Promise<string|null>` that returns null on web so I04/I05 can extend it).
- `process.env.EXPO_PUBLIC_OPENBOT_URL` default `http://localhost:8787` (OpenBot local API port), validated and normalized (trim trailing `/`).
- Do not touch: packages/domain, apps/server, apps/worker, any file not listed above.

---

### Task 1: RED — transport and endpoint tests

**Files:**
- Create: `apps/mobile/test/openbot-client.test.ts`, `apps/mobile/test/openbot-api.test.ts`

**Interfaces:**
- Produces (consumed by later tickets C01/I03/I04/I05): module `src/openbot/client.ts` exporting `openbotFetch<T>(path: string, schema: ZodType<T>, init?: { method?: string; body?: unknown; signal?: AbortSignal }, isWrite?: boolean): Promise<T>` with `credentials: "include"`, 20s AbortController timeout, mapping: 401→`OpenBotError("authentication_required")`, 403→`"refused"`, 404→`"not_found"`, 408/5xx on writes→`"outcome_unknown"`, non-JSON→`"invalid_response"`; module `src/openbot/api.ts` exporting `fetchMe(signal?)`, `fetchWorkspace(signal?)`, `openConversation(botId, signal?)` (POST `/api/mobile/conversations` body `{botId}`), typed via `src/openbot/types.ts` zod schemas for `{user:{id,role},agents:[{id,name,title,avatarSeed,visibility}],channels:[{id,name,agentIds,threadId,lastMessageAt}]}` and conversation `{botId,channelId,threadId}`.

- [x] **Step 1: Write `openbot-client.test.ts`** with node:test cases (inject fetch by parameter — design `openbotFetch` to accept an optional `fetchImpl` defaulting to globalThis.fetch; tests pass a stub recording called URL/headers and returning canned `Response` objects):
  1. sends `credentials: "include"` and JSON body with Content-Type on POST;
  2. 401 → OpenBotError code `authentication_required` and `isAuthFailure(err) === true`;
  3. 403 → `refused`; 404 → `not_found`;
  4. POST with 503 → `outcome_unknown`; GET with 503 → `unavailable` (not outcome_unknown);
  5. 200 with body violating schema → `invalid_response`.
- [x] **Step 2: Write `openbot-api.test.ts`**: stub fetch; assert `fetchWorkspace()` calls exactly `GET ${OPENBOT_URL}/api/mobile/workspace`; `openConversation(" b1 ")` POSTs `{botId:"b1"}` to `/api/mobile/conversations` and returns `{botId,channelId,threadId}`; 404 from server → throws `not_found` (foreign Bot ID refusal); **assert across all cases that no request ever targets `/api/session`** (the stub fails the test if it sees that path).
- [x] **Step 3: Run RED**

Run: `cd /Users/wuyongjun/trea/openmuse/.worktrees/v4-base && pnpm test 2>&1 | tail -15`
Expected: the two new test files FAIL (cannot resolve `../src/openbot/client.ts`), all pre-existing tests PASS.

### Task 2: GREEN — port and adapt the openbot layer

- [x] **Step 1:** Create `src/openbot/config.ts` (from copied config.ts, English comments): `openbotUrl` from `EXPO_PUBLIC_OPENBOT_URL` (default `http://localhost:8787`), trailing-slash trim, exported `openbotEndpoint` URL object.
- [x] **Step 2:** Create `src/openbot/errors.ts` from copied errors.ts (English messages): `OpenBotError` with codes at least `authentication_required | refused | not_found | outcome_unknown | unavailable | invalid_response | invalid_input | network | unknown`, and `isAuthFailure()`.
- [x] **Step 3:** Create `src/openbot/client.ts` per the Produces contract in Task 1 (port from copied client.ts; keep `fetchImpl` injectable; keep 20s timeout; no Cookie-header injection on this web-only ticket).
- [x] **Step 4:** Create `src/openbot/types.ts` (zod schemas: me, workspace, conversations list item, openBotSession `{botId,channelId,threadId}`, message accepted) — align field names with OpenBot `server/src/mobile-bff/workspace.ts` (`user.id`,`user.role`,`agents[].{id,name,title,avatarSeed,visibility}`,`channels[].{id,name,agentIds,threadId,lastMessageAt}`).
- [x] **Step 5:** Create `src/openbot/api.ts` exposing exactly `fetchMe`, `fetchWorkspace`, `fetchConversations`, `openConversation` (port semantics from copied api.ts; English copy).
- [x] **Step 6:** Run Task 1 tests → GREEN.

Run: `pnpm test 2>&1 | tail -8`
Expected: all tests PASS including the two new files.

### Task 3: RED→GREEN — gate entry logic (pure seam)

**Files:**
- Create: `apps/mobile/src/openbot/gate.tsx` (exports `OpenBotGate` AND a pure `entryPhaseReducer`)
- Create: `apps/mobile/test/openbot-gate.test.ts`

**Interfaces:**
- Produces: `entryPhaseReducer(phase: "checking"|"signin"|"loading", event: {type:"no-local-session"}|{type:"auth-failed"}|{type:"me-ok"}|{type:"workspace-ok"}|{type:"workspace-failed", retryable:boolean}): next phase` — pure function, unit-testable without React. `OpenBotGate` renders EmailSignInForm on `signin`, spinner on `checking`/`loading`, error + retry on failure; after sign-in success calls `fetchMe()` then `fetchWorkspace()` then `onReady(workspace)`; auth failure clears session and returns to `signin`.

- [x] **Step 1 (RED):** tests: no-local-session→`signin`; auth-failed→`signin`; me-ok→`loading`; workspace-ok stays `loading` (gate parent completes); workspace-failed retryable→ stays with error state (reducer returns `loading` with error flag) — write exact expected outputs for each event.
  Run: `pnpm test` → new file FAILS (module missing).
- [x] **Step 2 (GREEN):** implement `entryPhaseReducer` + `OpenBotGate` + `EmailSignInForm` (port from copied gate.tsx/email-signin.tsx; English copy; social-provider buttons REMOVED — email/password only for this ticket; keep `authClient` usage from `src/openbot/auth.ts`).
- [x] **Step 3:** Create `src/openbot/auth.ts` (web-only this ticket): `createAuthClient` from `better-auth/react`, `baseURL: openbotUrl`, NO expo plugin; export `authClient`, `currentSession()` (returns session or null), `signOut()`, `sessionCookie()` returning `Promise.resolve(null)`.
- [x] **Step 4:** add `better-auth` to apps/mobile/package.json dependencies pinned to the same version OpenBot's copied client used (1.7.1); run `pnpm install --no-frozen-lockfile` at repo root; verify lockfile diff touches only that addition.
- [x] **Step 5:** Run: `pnpm test && pnpm --dir apps/mobile typecheck`
  Expected: all PASS, typecheck clean.

### Task 4: App.tsx web branch

**Files:**
- Modify: `apps/mobile/App.tsx`

**Interfaces:**
- Consumes: `OpenBotGate`, `OpenBotWorkspace` from `src/openbot/*`.
- Produces: for I03 — web branch rendering `OpenBotGate` wrapping a minimal `OpenBotConnected` status screen (port pattern from copied App.tsx OpenBotApp: snapshot state, sign-out clears snapshot; status screen shows openbotUrl + agent/channel counts — placeholder content is acceptable HERE because I03 owns the real workspace UI; native branch returns the legacy `OpenMuseApp` unchanged).

- [x] **Step 1:** In App.tsx add `const web = Platform.OS === "web"` (import Platform from react-native); `export default function App() { return web ? <OpenBotApp/> : <OpenMuseApp/> }` where `OpenMuseApp` is the current body renamed. Keep every existing import/behavior for the native path byte-identical where possible.
- [x] **Step 2:** Run `pnpm --dir apps/mobile typecheck && pnpm test && pnpm lint` — all pass.
- [x] **Step 3:** Negative proof: `rg -n "api/session" apps/mobile/src/openbot apps/mobile/App.tsx` → zero matches on the web path (legacy native path still contains it under the non-openbot modules — acceptable until I04/I05; record exact match list in your report).

### Task 5: Checkpoint

- [x] **Step 1:** `git -C /Users/wuyongjun/trea/openmuse/.worktrees/v4-base status --porcelain` — record the full changed-file list; `git diff --stat`; compute `shasum -a 256` over each created src/openbot file and App.tsx; include everything in the final report. No commit.

## Acceptance (Issue #5 / catalog I01)

Web uses Better Auth session and existing mobile workspace read; 401 shows sign-in; a foreign Bot ID returns 404 (surfaced as `not_found`, not success); no old /api/session Bearer token is created on the web path. Verified by: Task 1–3 tests (RED shown, then GREEN), typecheck, lint, and the Task 4 negative proof. Browser-level live check happens in I03's environment (recorded as follow-up evidence, not claimed here).

## Failure handling

- If `better-auth@1.7.1` fails to install or peer-conflicts with expo SDK in the canonical tree, record the exact error and try the nearest 1.7.x that installs cleanly (record the version chosen); do NOT silently downgrade majors.
- If OpenBot's live `/api/mobile/workspace` field names differ from `server/src/mobile-bff/workspace.ts` at HEAD 748f91ad, align `types.ts` to the server source (it is the authority) and note the divergence from the copied client.
- Any test that cannot be made green without violating the owned-files list → stop and report (do not widen the blast radius).
