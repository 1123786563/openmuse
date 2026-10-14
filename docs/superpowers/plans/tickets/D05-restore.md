# D05 — Restore the full recoverable set within 30 days: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessor D04 verified+integrated.

**Goal:** §9 restoration: within 30 days (day-29 fixture), an admin restore returns the recoverable set READ-ONLY — Bot profile, Channel/Thread history, Task/steps/evidence, Files/versions (bytes via the manifest's external keys — provided D06 hasn't purged), Goals/Ideas/Memory, notifications, unresolved Reviewed actions as read-only history; cancelled work stays stopped (never resumes); after restoreUntil, restore returns 410.

**Architecture:** Extend `openmuse-deletion`: `POST /api/admin/openmuse-deletion/:userId/restore` (requireAdmin; fake-clock injectable): (1) marker check — past restoreUntil → 410; (2) the restore is a FENCE LIFT + status resurrection: the deletion markers flip to `restored` (fence re-admits; connection rows stay revoked — external credentials are NOT restorable, recorded), cancelled tasks stay terminal (read-only history), awaiting→cancelled reviewed actions stay cancelled (unresolved ones surface as history); (3) the manifest rows remain (retention is D09's); (4) a restore report enumerates what is read-only vs live again. Task/monitor future offers do NOT resume (statuses unchanged). The §9 module hooks (`restoreOwner`) exist on files/notifications etc. — call them (they're tested); for modules without a hook, the fence lift IS their restoration (records reflect that).

**Spec:** Contracts §9 restoration; catalog D05; Issue #83. S40 day-29/day-31 is the live card.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-deletion/* (restore.ts or routes/store extension), server/tests/openmuse-deletion.test.ts; EMIT-ONLY calls to existing restoreOwner hooks (files/notifications — cite; no edits to those modules). NO app.ts/index.ts (admin route mounts like I09's pattern — Task 0: cite how openmuse admin routes mounted; if app.ts is unavoidable, ONE mount line + ready offset, record). Never touch tasks-internals/connectors internals.

### Task 1: RED — tests (injected clock)

1. day-29 restore: fence lifts (requests re-admit); files list/get return rows (bytes intact pre-D06); goals/ideas/memories return; notifications return; channels/tasks readable as history; cancelled statuses UNCHANGED (no resume — queue offers zero); revoked connections STAY revoked (recorded);
2. day-31 → 410;
3. non-admin → 403; restoring a non-deleted user → 404;
4. idempotent second restore → same report (marker already restored);
5. restore report enumerates live-again vs read-only vs not-restorable (external creds) classes.

### Task 2: GREEN

- Implement per matrix; per-file re-runs green (deletion + files + notifications + ready); typecheck + biome clean.

### Task 3: Checkpoint

- Report: hook citations, files + shasum, test tails, S40 deferred note. No commit.

## Failure handling

- If byte restoration needs D06's opposite, verify pre-D06 semantics hold (bytes untouched at this stage) and record the D06 interplay contract.
