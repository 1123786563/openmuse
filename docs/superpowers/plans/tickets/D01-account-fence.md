# D01 — Fence a deleted account at authentication: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessor I02 verified+integrated.

**Goal:** §9 deletion marker: an ATOMIC disabled marker makes all new authenticated requests for that user fail immediately (403 with a stable code) across the seams our modules own (mobile-bff family + openmuse-* routes); repeated delete is idempotent; another user stays active; the marker is written BEFORE any revocation work (the fence is the first act).

**Architecture:** New module `server/src/openmuse-deletion/`: drizzle `openmuse_account_deletions` (userId PK, disabledAt, phase, restoreUntil nullable — §9 shape with resources jsonb default [] for D04); a `fence` middleware factory `openMuseAccountFence({isDisabled})` mounted in front of the openmuse route families (Task 0: choose mount points — the mobile-bff mount + each openmuse-* sub-app mount in app.ts, one shared guard; record); `POST /api/mobile/openmuse-account/delete` (requireUser; writes the marker atomically insert-once; idempotent repeat returns the existing marker; does NOT do revocation work — D02/D03 own that); the guard consults the marker (cache-free read or a tiny in-process TTL cache — choose, record).

**Spec:** Contracts §9 (marker written before revoking access; immediate authorization checks consult the marker); catalog D01; Issue #79.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Create server/src/openmuse-deletion/{fence.ts,routes.ts,store.ts}, server/tests/openmuse-deletion.test.ts, migration 00NN (SQL verbatim); Modify server/src/app.ts (mount the guard on the openmuse families + ONE tail param + ready.test.ts offset), server/src/index.ts (import+arg). Never touch openmuse-activity/tasks/documents (concurrent workers).

### Task 1: RED — tests

1. delete marker: insert-once atomic; repeat returns the existing row (idempotent; disabledAt unchanged);
2. fence: after the marker, EVERY openmuse-family request for that user → 403 stable code (workspace/files/tasks/mail/calendar/reviewed/personal/activity fixtures — one representative route each); another user unaffected; unauthenticated 401 still precedes;
3. fence ordering: the marker exists but D02/D03 work hasn't run → requests STILL refuse (fence is not cleanup-dependent);
4. §9 hooks trivially (the marker IS the hook root — enumerateOwner returns the marker ref).

### Task 2: GREEN

- Implement + migration + wiring; `bun test tests/openmuse-deletion.test.ts tests/ready.test.ts tests/mobile-bff.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: mount-points list + guard-consult choice, migration SQL, files + shasum, test tails, S39 live note deferred. No commit.

## Failure handling

- If mounting on every family is intrusive, mount at the /api/mobile prefix level (one guard) — record the boundary; the computer/copilot seams are D02/D03's follow-ups.
