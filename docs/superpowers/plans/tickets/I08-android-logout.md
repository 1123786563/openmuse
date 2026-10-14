# I08 — Clear Android private state on logout: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single bounded ticket mirroring I07; one agent context, TDD for pure seams. Predecessor I05 verified+integrated.

**Goal:** Android logout clears the same native private-state registry as I07 (SecureStore keys, PDF cache paths, drafts) with the Android-specific cache directory resolution; a following user B on the same device observes none of A's state. This ticket verifies the shared clearing path on the Android platform and adds any Android-specific delta.

**Architecture:** I07 delivered the registry + clearing helpers platform-agnostically (injected fs/storage). This ticket: (1) Task 0 audits the shared path for Android gaps (cache directory differs per platform — expo-file-system cacheDirectory is platform-resolved at runtime; confirm the helper takes the directory from the injected fs so no change is needed, or add the resolution); (2) Android-flavored tests (same matrix as I07's suite parameterized for Android paths, e.g. nested cache dirs); (3) wire any delta; (4) build:android proof.

**Spec:** Contracts §2 native rows; catalog I08; Issue #12.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/openmuse/.worktrees/v4-base. NO commits.
- Owned files: Modify apps/mobile/src/openbot/private-state.ts (ONLY if an Android delta exists — else zero changes), the native adapter file I07 added (fs adapter — Android resolution if needed), apps/mobile/test/openbot-native-private-state.test.ts (Android-parameterized cases); App.tsx ONLY if wiring changes.
- Do NOT touch auth/client/config/chat/channels/computer/task files.

### Task 1: audit + RED

- [ ] Task 0: cite I07's helper signatures + the fs adapter's directory resolution; identify whether Android needs anything (record YES/NO + evidence).
- [ ] Android-parameterized tests: nested cache dirs (depth 3), keys with the Android storagePrefix, deletion failure tolerance, B-user invisibility sequence — RED only where a real gap exists (do not write vacuous tests).

### Task 2: GREEN

- Implement only the proven delta (possibly none — then the tests are regression pins and the report says so).
- `pnpm test && pnpm --dir apps/mobile typecheck && pnpm lint` green; `pnpm build:android` exports (record tail).

### Task 3: Checkpoint

- Report: Task 0 verdict (delta or none, with citations), files + shasum, test tails, build:android tail, S05-A device flow deferred note. No commit.

## Failure handling

- If no delta exists, that IS the finding — report it; do not invent work.
