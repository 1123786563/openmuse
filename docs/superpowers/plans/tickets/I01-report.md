# I01 Execution Report — Sign in on Web and read an existing Bot (Issue #5)

Worktree: `/Users/wuyongjun/trea/openmuse/.worktrees/v4-base` (branch `v4/openbot-exec` @ 4679233, **uncommitted**, per protocol). Plan executed in order with TDD (RED shown before GREEN for every behavior); all 18 plan steps checked off in `I01-web-signin.md`.

## Coordinator-approved deviations (recorded per instruction)

1. **New owned file `apps/mobile/src/openbot/gate-state.ts`** — plan defect: `pnpm test` runs under tsx/node:test, which cannot parse `react-native` (Flow syntax, verified empirically) and `gate.tsx` statically imports it plus `better-auth/react`, so `openbot-gate.test.ts` could not import `gate.tsx`. Approved fix: the pure `entryPhaseReducer` lives in `gate-state.ts`; `gate.tsx` imports and re-exports it, so the plan's Produces contract text still holds. Reducer signature is `(_state: GateState, event: GateEvent) => GateState` where `GateState = {phase: "checking"|"signin"|"loading"; error: boolean}` — the error flag is the return-channel the plan's Step 1 describes ("returns `loading` with error flag"). Non-retryable `workspace-failed` maps to `signin` (gives the `retryable` input real semantics; pinned by test).
2. **zh-CN copy is module-internal** — `strings.ts` is not in the owned-files list, so each openbot module carries its own copy map following the strings.ts pattern (`COPY` const maps, zh-CN); `apps/mobile/src/strings.ts` untouched. App.tsx placeholder screen uses inline zh-CN literals (I03 replaces it).

## Changed files (all uncommitted)

Modified:
- `apps/mobile/App.tsx` — web branch: `App = Platform.OS === "web" ? OpenBotApp : OpenMuseApp`; native body renamed `OpenMuseApp`, otherwise byte-identical. `OpenBotApp` = `OpenBotGate` + minimal `OpenBotConnected` status screen (openbotUrl, agent/channel counts, SignOutButton; placeholder per plan, I03 owns the real UI).
- `apps/mobile/package.json` — added `"better-auth": "1.7.1"`.
- `pnpm-lock.yaml` — via `pnpm install --no-frozen-lockfile`; diff is better-auth transitives only (adds a parallel zod 3.25.76 for better-auth, micromark/glob reshuffles). Install succeeded first try; the two `pnpm peers check` warnings (`@slack/bolt`/@types/express, `lucide-react-native`/react) are pre-existing, not from better-auth.
- `docs/superpowers/plans/tickets/I01-web-signin.md` — checkboxes ticked; this report added (dir already untracked).

Created — `apps/mobile/src/openbot/`:
- `config.ts` — `EXPO_PUBLIC_OPENBOT_URL` (default `http://localhost:8787`), trailing-slash trim, exported `openbotEndpoint`/`openbotUrl`; no `__DEV__`/`Platform` (node:test importability).
- `errors.ts` — `OpenBotError` with the 9 plan codes + `isAuthFailure()`.
- `client.ts` — `openbotFetch(path, schema, init?, isWrite?)`: `credentials: "include"`, 20s `AbortSignal.timeout` (+`AbortSignal.any` with caller signal), injectable `fetchImpl`, mapping 401→`authentication_required`, 403→`refused`, 404→`not_found`, 408/5xx+write→`outcome_unknown`, 5xx+read→`unavailable`, other 4xx→`invalid_input`, fetch-throw→`network`, schema/non-JSON 2xx→`invalid_response`. No Cookie injection (web-only ticket).
- `types.ts` — zod: me, workspace, conversations, `openBotSession {botId,channelId,threadId}` (server's extra `mode`/`onboarding` stripped by zod), messageAccepted (for I03). Field names verified against OpenBot `server/src/mobile-bff/{workspace.ts,routes.ts}` — exact match.
- `api.ts` — exactly `fetchMe`, `fetchWorkspace`, `openConversation` (trims botId, POST, isWrite), `fetchConversations`.
- `auth.ts` — `createAuthClient` from `better-auth/react`, `baseURL: openbotUrl`, **no** expo plugin/SecureStore import; exports `authClient`, `currentSession()`, `signOut()`, `sessionCookie()` → `Promise.resolve(null)`, `signInWithEmail`, `signUpWithEmail` (zh-CN reason mapping).
- `email-signin.tsx` — email/password only (social removed per plan); local validation + server error layering; `SignOutButton`.
- `gate.tsx` — `OpenBotGate` (session check → `fetchMe` → `fetchWorkspace` → `onReady`), transitions via `entryPhaseReducer`; 401 clears session → signin; non-auth failure stays loading + retry; re-exports reducer and gate-state types.
- `gate-state.ts` — pure reducer (see deviation 1).

Created — tests (node:test, injected/stubbed fetch):
- `apps/mobile/test/openbot-client.test.ts` (5 tests), `openbot-api.test.ts` (5), `openbot-gate.test.ts` (6). The api/client stubs hard-fail if any request targets `/api/session`.

## sha256

```
e7fef7c01126c30308a14c376dc12f825a76ddf3437744a6017126369d1c83e2  apps/mobile/src/openbot/api.ts
d56e6f4232ff5c754af2035769785f0cf66a9ff8d505e0cab7e89ffdca00ff7c  apps/mobile/src/openbot/auth.ts
e8d79f40f3f468e9085ea3eff48fd9547d70500faad647bcac1179350212d954  apps/mobile/src/openbot/client.ts
50c625c67e0d75dcb7fb579021f933b691ce2cb684cfbdaa97b227815a407872  apps/mobile/src/openbot/config.ts
2a0306ed7b5e7a40be9dbe0ed59bdb28d86f609249312d4b4eeefe4f2f46ca3d  apps/mobile/src/openbot/errors.ts
0a4f91d2bc0a9e48e0532365ee68200a180c190e5f84d3c7928bf4e5738a1ce0  apps/mobile/src/openbot/gate-state.ts
11e788013e8e3e8cba66fd7d88e09b098ba861fc1f02f4dce49718cd4b25a569  apps/mobile/src/openbot/types.ts
d58fd57a2cb336e3727206ca6b3d38f9217b60bdd432d471d279ff35eae9e80f  apps/mobile/src/openbot/email-signin.tsx
b733b470ba407c30d1fb1abb8e657c6385a98f469e8013d923982be4d4b2b5f1  apps/mobile/src/openbot/gate.tsx
4d368d4e2b7bf25973886125b5f568659705d0bb3546f34dc0db932d72ccc020  apps/mobile/App.tsx
8a32eec8c7d83bfd3474fa356dfb4fccf28a998821cf6132baff356bfb4bb35c  apps/mobile/test/openbot-api.test.ts
6eb6c3104ff12d42cfeaf285bc3466dca8844cb93e0e6b08042135a2e2cf709d  apps/mobile/test/openbot-client.test.ts
7ca1d1a9e8f04a3febdfa7ae33a05cf2bcb4cb431febf7b23de17234c7e0652e  apps/mobile/test/openbot-gate.test.ts
```

## Verification

- `pnpm test`: **503 pass / 0 fail** (497 pre-existing + 16 new). Tail:
  ```
  ℹ tests 503
  ℹ pass 503
  ℹ fail 0
  ℹ cancelled 0 / skipped 0 / todo 0
  ℹ duration_ms 38764
  ```
  RED evidence: Task 1 files failed with `Cannot find module '../src/openbot/config.ts'` (all 497 old tests green); Task 3 gate test failed with `Cannot find module '../src/openbot/gate-state.ts'` before implementation.
- `pnpm --dir apps/mobile typecheck`: clean (tsc --noEmit, no output).
- `pnpm lint`: exit 0 ("Found 1 info" = pre-existing biome.json schema-version notice, unrelated).
- Negative proof: `rg -n "api/session" apps/mobile/src/openbot apps/mobile/App.tsx` → **zero matches**. Full-tree match list: `apps/mobile/src/api.ts:33` only (legacy native module, untouched — acceptable until I04/I05 per plan).

## Left for later tickets

- Browser-level live check happens in I03's environment (per plan acceptance, not claimed here).
- Native OpenBot auth/transport (Cookie injection, expo plugin, SecureStore): I04/I05.
- Real workspace UI replacing the placeholder status screen: I03.
