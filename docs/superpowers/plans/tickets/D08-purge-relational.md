# D08 — Purge OpenBot relational personal data: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessors D06+D07 verified+integrated.

**Goal:** §9 final relational cleanup: after external states are deleted (D06 bytes + D07 grants), remove all manifested relational records — Bot/computer profile, Channel/Thread, Task/Monitor, reviewed actions, personal context, notifications; a partial DB failure retains the manifest for retry; cross-user counts unchanged.

**Architecture:** Extend `openmuse-deletion`: `purgeRelationalData(userId)` — preconditions: no retryable byte/grant rows remain (manifest arbiter; else 409-with-state naming them); walks remaining manifest kinds deleting rows via each module's removal seam (cite each; add emit-only exports where private — noted); on any DB failure mid-walk → the manifest retains unfinished rows (transactional per-module batches — record the batching choice); completes → manifest rows deleted + the deletion marker phase=completed. Cross-user assertion: user B's identical-shaped data untouched.

**Spec:** Contracts §9; catalog D08; Issue #86.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-deletion/* + its test; EMIT-ONLY removal exports from the manifested modules (cite each, noted). NO app.ts/index.ts.

### Task 1: RED — tests

1. full-flow fixture (post D06+D07): purge removes Bot profile/channel/thread/task/monitor/reviewed/goal/idea/memory/notification rows (per-module fakes count); manifest empties; marker phase completed;
2. precondition: a retryable byte/grant row exists → 409 naming it; nothing deleted;
3. injected DB failure mid-walk → already-deleted modules stay deleted, remaining rows retained (manifest survives for retry); retry completes;
4. cross-user: B's rows untouched (counts before/after);
5. §9 unchanged.

### Task 2: GREEN

- Implement per matrix; per-file re-runs green (deletion + the touched suites + ready); typecheck + biome clean.

### Task 3: Checkpoint

- Report: seam citations + batching choice, files + shasum, test tails, F-PURGE-1/2 interplay note. No commit.

## Failure handling

- The manifest is the arbiter at every step — never delete what it cannot account for.
