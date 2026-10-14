# I07 — Clear iOS private state on logout: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD for pure seams. Predecessor I04 verified+integrated. Mirrors I06's web work for the native side.

**Goal:** Native logout revokes the Better Auth Expo session (SecureStore), clears the native private-state registry (session bookkeeping keys), provides the §2 native cache-clearing helpers (expo-file-system PDF cache dir; drafts) that current and later tickets call, and a following sign-in as user B on the same device cannot observe A's session/keys.

**Architecture:** Extend `src/openbot/private-state.ts` with a native registry: `nativePrivateKeys` (SecureStore prefix(es) the expo client uses — the storagePrefix from auth.ts) + `clearNativePrivateState({secureStore, fileSystem?})` clearing those keys and deleting files under the PDF cache directory (helper `pdfCachePaths(fs)` listing `<cacheDirectory>/openmuse-files/*` — consumed by F04/F07 when downloads land; today it clears whatever exists). Wire into gate.tsx sign-out + App.tsx onAuthExpired (native branch). Pure-seam tests with injected fake SecureStore-like + fake fs.

**Tech Stack:** node:test pure seams (no react-native imports in tested modules); expo-file-system ONLY referenced behind an injected fs interface.

**Spec:**
- Contracts §2 native rows (session credential adapter clear; native PDF download cache deletion): /Users/wuyongjun/trea/openmuse/.worktrees/v4-base/docs/superpowers/plans/2026-10-12-openmuse-openbot-contracts-v4.md
- Catalog I07; Issue #11. I06's web registry is the pattern.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/openmuse/.worktrees/v4-base. NO commits.
- Owned files: Modify apps/mobile/src/openbot/{private-state.ts,gate.tsx}, apps/mobile/App.tsx (native branch of the existing clearing wiring only); Create apps/mobile/test/openbot-native-private-state.test.ts.
- Do NOT touch: auth.ts/client.ts (their signOut already clears the plugin store — assert via the registry test, not by editing), config.ts, chat/channels/task files.
- zh-CN copy; English comments.

### Task 1: RED — native registry tests

- [ ] **Step 1:** apps/mobile/test/openbot-native-private-state.test.ts (fakes: storage with keys; fs with dirs/files):
  1. `nativePrivateKeys.prefixes` includes the auth.ts storagePrefix-derived prefix (read the real prefix computation from auth.ts and assert the registry matches — single source: export the prefix from private-state.ts and have auth.ts consume it IF that is a one-line change; otherwise assert equality and note);
  2. `clearNativePrivateState({secureStore, fileSystem})` removes every prefixed key and leaves unrelated keys;
  3. `pdfCachePaths(fileSystem)` enumerates `<cache>/openmuse-files/**` recursively; `clearNativePrivateState` deletes them (fake fs records deletions); unrelated dirs untouched;
  4. end-to-end sequence: sign-out path (clearWebPrivateState equivalent for native + auth signOut fake) → second user's keys absent; B cannot read any A-era key (fake storage inspection);
  5. fs delete failure → remaining paths reported back (caller may retry), other deletions still happen.
- [ ] **Step 2:** Run → FAIL.

### Task 2: GREEN

- [ ] **Step 1:** private-state.ts native registry + clearNativePrivateState + pdfCachePaths per matrix.
- [ ] **Step 2:** gate.tsx sign-out and App.tsx onAuthExpired native branch call clearNativePrivateState with the real adapters (SecureStore via auth plugin re-export or direct import behind Platform check; expo-file-system via a thin adapter module allowed as ONE new file if gate/App must not import expo directly — note it).
- [ ] **Step 3:** `pnpm test && pnpm --dir apps/mobile typecheck && pnpm lint` green; `pnpm build:ios` exports (record tail).

### Task 3: Checkpoint

- [ ] Report: changed files + shasum, test tails, build:ios tail, S05-I device-flow deferred statement. No commit.

## Acceptance (Issue #11 / catalog I07)

Logout revokes native session (signOut + registry clear), closes streams (existing gate teardown — re-assert), deletes cached PDF bytes path helper + drafts registry per §2 (helpers proven; live A/B device flow deferred and recorded). No old-URL access guarantee comes from server auth (F02) — client-side cache absence asserted.

## Failure handling

- If expo-file-system import breaks the node tests, keep it entirely behind the injected fs interface (no test imports it).
