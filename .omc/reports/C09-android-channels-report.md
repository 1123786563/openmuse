# C09 — Use Channels on Android: Execution Report (Issue #21)

Plan: `docs/superpowers/plans/tickets/C09-android-channels.md` — executed exactly (C08's Android twin: import-scan audit + I05 transport citation). No commits (per plan).

## Task 0: Audit verdict — **NO Android delta** (the finding, with citations)

C08's audit method mirrored: import scan + remount/stop/resume review over the four channel/chat seams.

1. **Import scan — zero platform branches in the seams** (grep `Platform` over all four files: no matches; no `*.android.*`/`*.ios.*` platform-split files exist under `apps/mobile/src/openbot/`):
   - `apps/mobile/src/openbot/channel-state.ts:1` — exactly ONE type-only import (`import type { OpenBotSession, OpenBotWorkspace } from "./types"`); pure roster/identity logic, platform-free by construction.
   - `apps/mobile/src/openbot/stream-resume.ts` — ZERO imports (the file's only "import" text is a comment); pure resume/dedupe model.
   - `apps/mobile/src/openbot/channels.tsx:1-15` — react-native UI primitives + SafeAreaView + shared `./api`, `./channel-actions`, `./errors`, `../ui`; no `Platform` import, no OS branch.
   - `apps/mobile/src/openbot/chat.tsx:1-17` — `@copilotkit/react-native/headless` (the ONE RN entry shared by iOS and Android), react-native primitives, shared seams (`./chat-state`, `./stop-state`, `./stream-resume`, `./tool-cards`); no `Platform` import.
2. **Remount keying (navigator-less shell)** — `apps/mobile/App.tsx:205` `key={selected ? selected.id : session.channelId}` re-keys the chat on channel switch by channel id, platform-agnostic React reset-state-with-a-key; the provider presence key (`App.tsx:190`, `key={cookie ? "session" : "anonymous"}`) likewise has no OS branch.
3. **Stop handling** — `apps/mobile/src/openbot/chat.tsx:245-251`: `copilotkit.stopAgent({ agent })` gated by the pure `stopFlowReducer` (`stop-state.ts`, pinned in `openbot-stop-state.test.ts`); no touch-handling platform branch.
4. **Android chat transport — the I05 citation** — both transports branch on `platform === "native"` (never `"ios"`/`"android"`), so Android rides the identical sessionCookie→`Cookie` header path: `apps/mobile/src/openbot/client.ts:66-79` (REST; cookie resolved via `getCookie`, `credentials: "omit"`) and the `CopilotKitProvider` wiring at `App.tsx:188-194` (`headers: { Cookie: cookie }`). That Android path is ALREADY pinned by I05 at `apps/mobile/test/openbot-native-session.test.ts:42-60` (`android rides the same native transport…`). Android's only real transport delta — the emulator base URL `10.0.2.2` — lives in `config.ts` (I05, verified+integrated, outside C09's owned files; pinned in `openbot-android-config.test.ts`).

Per the plan's failure-handling clause: **no delta IS the finding** — zero source changes; only Android regression pins were added.

## Changed files (+ shasum)

| File | Status | shasum |
| --- | --- | --- |
| `apps/mobile/test/openbot-channel-state.test.ts` | modified (Android roster pins appended) | f2689a8465a1a1efd59d572abe8bcc2b500492da |
| `apps/mobile/test/openbot-stream-resume.test.ts` | modified (Android restore pins appended) | 6ebde4e57173914683f14a0ccf0c600a93b3a41d |
| `apps/mobile/test/openbot-native-session.test.ts` | UNCHANGED (I05 pin at lines 42-60 cited, not duplicated) | 6f9de430a1646d4d048b51596851983a902234a0 |

Source seams `channels.tsx` / `chat.tsx` / `channel-state.ts` / `stream-resume.ts`: untouched (no delta). No other files touched.

### Android pins added (GREEN immediately — no real gap, so no RED)

- `openbot-channel-state.test.ts` — `android: switch re-keys onto the channel…` (order passthrough, distinct threads, `selectedIdentity ≡ runtimeAgentFor(sessionFor(…))` bridge) and `android: create over the private Bot appends the row…` (`mergeCreated` + distinct threads).
- `openbot-stream-resume.test.ts` — `android: routine process death replays the thread once…` (fresh replay, restored cursor absorbs Doze-reconnect overlap) and `android: overnight handoff (rebuilt gateway ids) reloads history…` (reload-history + reloaded-thread overlap dedupe).

## Verification

- Three pin files: `tests 33 / pass 33 / fail 0`.
- Full suite `pnpm test`: `tests 666 / pass 666 / fail 0`.
- `pnpm --dir apps/mobile typecheck` (`tsc --noEmit`): clean.
- `pnpm lint`: `Checked 227 files … Found 1 info` (pre-existing biome `migrate` config-version info; no errors, none from these files).
- `pnpm build:android` tail:
  ```
  Android Bundled 3283ms apps/mobile/index.js (3505 modules)
  › android bundles (1):
  _expo/static/js/android/index-03727472acc312576ef7e56b319073d4.hbc (9.03 MB)
  Exported: dist/android
  ```

## Deferred

S10-S13-A (Android rows: create/switch/archive/reopen, stop/resume one run, named events on a live Android device) are gate-pass live-device evidence — deferred per plan. Deployment note (I05, still applies): physical Android devices need `EXPO_PUBLIC_OPENBOT_URL` set to the host's LAN address; the emulator default only covers `10.0.2.2`. No commit made.
