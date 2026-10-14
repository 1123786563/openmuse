# D03 — Revoke Google and File access at deletion: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessors D01+G05+F02 verified+integrated.

**Goal:** §9 external access shutdown at deletion: provider calls and File bytes refuse immediately through the fence; OpenConnector disconnect is ATTEMPTED and retryable (best-effort with recorded state); a late OAuth callback cannot restore a connection for a deleted owner.

**Architecture:** Extend `openmuse-deletion`: `revokeExternalAccess(userId)` called after D02's shutdown within the delete route: (1) connectors: for each connection row (connected/refresh_required/disconnected) — vendor deleteConnection by alias (best-effort; failure → marker bookkeeping records `retryable` state, delete route still succeeds); local rows → status revoked; the G01 callback path gains a marker check: pending rows of a deleted owner → callback refuses (no connection restoration); (2) files: the fence already refuses routes — additionally the byte-store read path for a deleted owner is guarded at the store level (defense in depth: getOwnedFile consults the marker via an injected `ownerDisabled` seam — one addition to openmuse-files store, emit-only class); (3) evidence rows in the marker's resources.

**Spec:** Contracts §9 (deletion immediately disables provider + File access; connector disconnect attempted + retryable; late callback cannot restore); catalog D03; Issue #81. F-DELETE-1 is the live card.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-deletion/{routes.ts,shutdown.ts-or-new revoke.ts,fence.ts}, server/tests/openmuse-deletion.test.ts; EMIT-ONLY minimal touchpoints: openmuse-connectors (callback marker check + a revoke-connections seam), openmuse-files store (ownerDisabled injection point). NO app.ts/index.ts. Never touch computer/baseline (concurrent worker).

### Task 1: RED — tests

1. delete with connected gmail+gcalendar: vendor deleteConnection called per alias (fake counts); local rows → revoked; vendor failure on one → delete route still succeeds, marker records retryable state for that alias, other proceeds;
2. provider calls post-delete → 403 fence (re-assert) AND the mail/calendar seams refuse on revoked status (409-class);
3. late OAuth callback for a deleted owner's pending state → refused (no exchange, no connection row) — G01 path marker check;
4. file bytes: deleted owner's getOwnedFile → refuses at the store guard (fence + store defense in depth);
5. §9: revoke rows enumerated in the marker resources.

### Task 2: GREEN

- Implement per matrix; per-file test re-runs green (deletion/connectors/files + ready); typecheck + biome clean.

### Task 3: Checkpoint

- Report: touchpoint list, files + shasum, test tails, S39/F-DELETE-1 deferred notes. No commit.

## Failure handling

- Never block the delete route on vendor failures — record + retryable.
