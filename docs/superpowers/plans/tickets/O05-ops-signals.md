# O05 — Expose connector, task, review and cleanup failures: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single bounded ticket; one agent context, TDD. Predecessors O03+O04+R04+R08+D09 ALL verified+integrated.

**Goal:** §10 ops signals: an operator health/status surface exposing — connector refresh failure (G04's refresh_required rows), stuck queued Task (runnable >5 min or expired lease unrecovered >1 min), outcome_unknown Reviewed actions, and retryable cleanup rows (D09) — with owner-safe identifiers and NO secrets; owners see their delayed/uncertain states (delayed task, uncertain write) without operator detail.

**Architecture:** New `server/src/openmuse-ops/signals.ts` — pure aggregation over existing seams (cite each): connections with status refresh_required (connectors store), tasks queued-but-runnable past a threshold / lease-expired-unrecovered (tasks store + queue lease semantics — injected clock), reviewed actions in outcome_unknown (reviewed store), deletion manifest retryable rows (deletion store); `GET /api/admin/openmuse-ops/signals` (requireAdmin, sanitized per G06 patterns); owner-facing projections already exist per feature (delayed task visible in list — re-assert one; uncertain write in the activity feed's outcome_unknown marker — re-assert one) — this ticket aggregates OPERATOR visibility, not a second owner surface.

**Spec:** Contracts §10 signal rows; catalog O05; Issue #92. S43 is the live card.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Create server/src/openmuse-ops/{signals.ts,routes.ts}, server/tests/openmuse-ops-signals.test.ts; Modify server/src/app.ts ONE tail param + mount (ready.test.ts offset) + index.ts import/arg. NO module edits — import-only aggregation (one export additions allowed where a store query is private, noted).

### Task 1: RED — tests (injected clock, fakes per seam)

1. four injected faults → four signal rows with safe ids (no tokens/bytes — sanitizer patterns asserted); each cites its source row;
2. stuck-task thresholds: queued-runnable 4 min → no signal; 6 min → signal; lease-expired 30 s unrecovered → no; 90 s → signal;
3. healthy deployment → empty signals;
4. non-admin 403; §9-safe.

### Task 2: GREEN

- Implement per matrix (seam citations); per-file re-runs green (ops-signals + ready + one affected module suite); typecheck + biome clean.

### Task 3: Checkpoint

- Report: seam citations, files + shasum, test tails, S43 deferred note. No commit.

## Failure handling

- An unavailable seam → record the gap as a signal kind with source "missing-seam (<module>)" rather than omitting — visibility includes the gaps.
