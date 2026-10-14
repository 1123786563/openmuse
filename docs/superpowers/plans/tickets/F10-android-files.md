# F10 — Use Files on Android: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single bounded client ticket mirroring F04; one agent context, TDD for pure seams. Predecessors F02+I05 verified+integrated (F04's iOS screen + file-cache seam in place).

**Goal:** The Files screen works on Android: authenticated bytes download to the owner-scoped cache with the Android cache directory resolution verified; logout clears cached content (I08's registry) and old URL access fails (server F02 + local cache absence).

**Architecture:** F04 delivered platform-agnostic seams (injected fs). Task 0 audit: verify the Android path resolution + RN blob writer adapter (I08 found no delta — expect the same; the audit is the deliverable if so, with Android-parameterized regression pins: nested dirs, deep paths, deletion tolerance, B-user invisibility) + `pnpm build:android` proof. Any real delta → implement it.

**Spec:** Contracts §5 + catalog F10; Issue #43.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/openmuse/.worktrees/v4-base (OpenMuse exec worktree). NO commits.
- Owned files: Modify apps/mobile/src/openbot/{files.tsx,file-cache.ts} ONLY if a delta exists (else zero code changes), apps/mobile/test/openbot-file-cache.test.ts (Android-parameterized pins); App.tsx only if wiring changes.
- Do NOT touch chat/channels/config/auth/gate/private-state/computer/task/calendar/connections.

### Task 0 + RED/GREEN

- [ ] Audit: cite F04's fs adapter directory resolution + I08's finding; Android pins (nested/deep cache dirs, write→clear→deleted via I07/I08 registry, B-user sequence) — RED only for real gaps (no vacuous tests); implement any proven delta; `pnpm test && typecheck && lint` green; `pnpm build:android` exports (record tail).

### Checkpoint

- Report: audit verdict (delta or none, cited), files + shasum, test tails, build:android tail, S23-A/S27-A deferred notes. No commit.

## Failure handling

- No delta IS the finding — report with citations; do not invent work.
