# C09 — Use Channels on Android: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single bounded client audit ticket (C08's Android twin); one agent context, TDD for any real gap. Predecessors I05 + C02-C06 all verified+integrated.

**Goal:** Channels work on Android (create/switch/archive/reopen, stop/resume, named events) via the shared client state; platform-specific defects stay here (found+fixed).

**Architecture:** C08's audit found NO iOS delta with import-scan citations — expect the same for Android. Audit points mirror C08: remount keying, resume dedupe, stop handling, plus the Android-specific chat transport (sessionCookie header path — cite I05). Android-named regression pins; implement any proven delta; `pnpm build:android` proof.

**Spec:** Contracts §3 + catalog C09; Issue #21. S10-S13 Android rows are live device evidence (gate).

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/openmuse/.worktrees/v4-base (OpenMuse exec worktree). NO commits.
- Owned files: Modify apps/mobile/src/openbot/{channels.tsx,chat.tsx,channel-state.ts,stream-resume.ts} ONLY if a delta exists, apps/mobile/test/openbot-{channel-state,stream-resume,native-session}.test.ts (Android pins). Do NOT touch config/auth internals/gate/private-state/computer/task/calendar/connections/files.

### Task 0 + RED/GREEN + Checkpoint

- [ ] Audit with citations (mirror C08's import-scan method + the I05 transport path); Android pins (RED only for real gaps); implement proven deltas; `pnpm test && typecheck && lint` green; `pnpm build:android` exports (record tail).
- [ ] Report: audit verdict (delta or none, cited), files + shasum, test tails, build:android tail, S10-S13-A device rows deferred. No commit.

## Failure handling

- No delta IS the finding — report with citations.
