# C08 — Use Channels on iOS: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single bounded client audit ticket (C08 class: shared code + platform verification); one agent context, TDD for any real gap. Predecessors I04 + C02/C03/C04/C05/C06 all verified+integrated.

**Goal:** Channels work on iOS: create/switch/archive/reopen, stop and resume one run, named event rendering — via the shared client state; any platform-specific defect stays in this ticket (i.e., is found and fixed here).

**Architecture:** Task 0 audit: the channel/chat feature set is shared code (C01-C06); like F10/I08, expect no iOS delta. Audit points: (1) the channel switcher's remount keying under RN's navigator-less shell; (2) stream-resume dedupe on iOS process-restore (no react-native-specific paths in the seams — verify by import scan); (3) stop button touch handling. Add iOS-parameterized regression pins where meaningful (pure seams already cover the logic — pins re-assert under iOS-named fixtures); implement any proven delta; `pnpm build:ios` proof.

**Spec:** Contracts §3 + catalog C08; Issue #20. S10-S13 iOS rows are live device evidence (gate).

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/openmuse/.worktrees/v4-base (OpenMuse exec worktree). NO commits.
- Owned files: Modify apps/mobile/src/openbot/{channels.tsx,chat.tsx,channel-state.ts,stream-resume.ts} ONLY if a delta exists (else zero code changes), apps/mobile/test/openbot-{channel-state,stream-resume}.test.ts (iOS pins). Do NOT touch config/auth/gate/private-state/computer/task/calendar/connections/files.

### Task 0 + RED/GREEN + Checkpoint

- [ ] Audit with citations (import scan proving no platform branches in the channel/chat seams; remount keying review); iOS pins (RED only for real gaps); implement proven deltas; `pnpm test && typecheck && lint` green; `pnpm build:ios` exports (record tail).
- [ ] Report: audit verdict (delta or none, cited), files + shasum, test tails, build:ios tail, S10-S13-I device rows deferred. No commit.

## Failure handling

- No delta IS the finding — report with citations.
