# I05 — Restore an Android Better Auth session: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessors B03+I03+I04 all verified+integrated (I04 built the SHARED native session layer; this ticket owns the Android deltas and Android verification only).

**Goal:** On Android the app returns to the same Bot after process restart using the shared native session layer, with the Android-specific transport base URL handled correctly (emulator loopback 10.0.2.2), and a 401 clears private state and shows sign-in.

**Architecture:** I04 delivered auth.ts (expo plugin + SecureStore), client.ts (platform/cookieProvider), App.tsx native gate. The known Android delta is the API base URL: Android emulators reach the host at 10.0.2.2, not localhost — port that rule from the copied client's config.ts into the canonical config.ts default resolution (only when EXPO_PUBLIC_OPENBOT_URL is unset), plus Android-flavored tests of the shared seams.

**Tech Stack:** same as I04; node:test pure seams; pnpm build:android.

**Spec:**
- Contracts §2 native rows: /Users/wuyongjun/trea/openmuse/.worktrees/v4-base/docs/superpowers/plans/2026-10-12-openmuse-openbot-contracts-v4.md
- Catalog I05; Issue #9. Prior art: /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base/apps/openmuse-mobile/src/openbot/config.ts (READ-ONLY).

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/openmuse/.worktrees/v4-base. NO commits.
- Owned files: Modify apps/mobile/src/openbot/config.ts, apps/mobile/test/openbot-native-session.test.ts; Create apps/mobile/test/openbot-android-config.test.ts.
- Do NOT touch: auth.ts, client.ts, gate.tsx, App.tsx (I04-reviewed; only reference them).
- zh-CN copy convention; English comments.

### Task 1: RED — Android config tests

- [ ] **Step 1:** apps/mobile/test/openbot-android-config.test.ts (pure; config resolution injected with platform + env, do NOT import react-native — if config.ts currently resolves Platform at module scope, refactor ONLY config.ts to an injectable `resolveOpenbotUrl(platform: "web"|"ios"|"android", envValue?: string)` while keeping the existing default export behavior):
  1. platform "android" + no env → `http://10.0.2.2:8787`;
  2. platform "ios" + no env → `http://localhost:8787`;
  3. platform "web" + no env → `http://localhost:8787`;
  4. any platform + explicit `EXPO_PUBLIC_OPENBOT_URL` → the explicit value verbatim (trimmed, trailing slash removed);
  5. invalid explicit URL → throws the existing config error.
- [ ] **Step 2:** Run `pnpm exec tsx --import ./tests/setup.ts --test apps/mobile/test/openbot-android-config.test.ts` → FAIL.

### Task 2: GREEN — config refactor

- [ ] **Step 1:** config.ts: export `resolveOpenbotUrl(platform, envValue?)` implementing the table; module-level `openbotUrl = resolveOpenbotUrl(Platform.OS, process.env.EXPO_PUBLIC_OPENBOT_URL)` keeps every existing consumer unchanged (verify with `rg -n "openbotUrl" apps/mobile/src/openbot | wc -l` — same call sites).
- [ ] **Step 2:** Tests pass. Extend openbot-native-session.test.ts with one Android case: platform "native" + cookieProvider returning a cookie → Cookie header present (platform-level parametrization; Android uses the same native transport).
- [ ] **Step 3:** `pnpm test && pnpm --dir apps/mobile typecheck && pnpm lint` green; `pnpm build:android` from repo root exports successfully (record tail).

### Task 3: Checkpoint

- [ ] Report: changed files + shasum, build:android tail, statement that live Android restart/401 device evidence (S02-A/S04-A) is deferred to the gate pass, and the deployment note (physical Android devices need EXPO_PUBLIC_OPENBOT_URL set to the host's LAN address — emulator default only covers 10.0.2.2). No commit.

## Acceptance (Issue #9 / catalog I05)

Android returns to the same Bot after process restart (shared layer + Android URL delta implemented and unit-verified; live device run deferred and recorded); getSession 401 clears private view and asks sign-in (shared onAuthExpired path, unchanged); no old OpenMuse access key used on native (unchanged from I04).

## Failure handling

- If config.ts's current shape resists the injectable refactor, implement resolveOpenbotUrl as a new exported function used by the existing default export; never change the exported names other code consumes.
