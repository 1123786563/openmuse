# F08 — View original and filled PDF on Android: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single bounded client ticket (F07's Android twin); one agent context, TDD for pure seams. Predecessors F06+F10 verified+integrated.

**Goal:** The F07 viewer works on Android: both versions open from the owner-scoped cache; expired session/deleted file refuse without stale cached bytes; Android cache resolution verified.

**Architecture:** F07 delivered platform-agnostic seams (pdf-view-state + injected fs). Task 0 audit mirrors F10/I08/C09: expect no Android delta (PdfReader.native handles Android; the cache adapter resolves the platform directory). Android-named pins; implement any proven delta; `pnpm build:android` proof.

**Spec:** Contracts §5 + catalog F08; Issue #47. S27-A is the live row.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/openmuse/.worktrees/v4-base (OpenMuse exec worktree). NO commits.
- Owned files: Modify apps/mobile/src/openbot/{pdf-view.tsx,pdf-view-state.ts} ONLY if a delta exists, apps/mobile/test/openbot-pdf-view-state.test.ts (Android pins).

### Task 0 + RED/GREEN + Checkpoint

- [ ] Audit with citations (PdfReader.native Android path; cache adapter resolution; F10's finding); Android pins (RED only for real gaps); `pnpm test && typecheck && lint` green; `pnpm build:android` exports (record tail).
- [ ] Report: audit verdict (delta or none, cited), files + shasum, test tails, build:android tail, S27-A row deferred. No commit.

## Failure handling

- No delta IS the finding — report with citations.
