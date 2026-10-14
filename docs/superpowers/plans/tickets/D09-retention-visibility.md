# D09 — Enforce backup retention and final cleanup visibility: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single bounded ticket; one agent context, TDD. Predecessor D08 verified+integrated.

**Goal:** §9 retention/ops: backups containing deleted personal bytes expire within the configured retention (policy-level enforcement point + evidence); unresolved manifest rows remain operator-visible (kind, safe id, lastError — no secrets/bytes); successful cleanup leaves only non-personal audit proof; an ops endpoint exposes the cleanup state.

**Architecture:** Extend `openmuse-deletion`: (1) retention: a `retentionPolicy` check — the marker's restoreUntil + a deployment retention window (env OPENMUSE_BACKUP_RETENTION_DAYS default 30): until retention elapses the manifest persists; the policy seam `retentionElapsed(marker, now)` is pure + tested; a `noteBackupRetention` bookkeeping row records when a deployment's backup window covers the deletion (the actual backup system is deployment infrastructure — this ticket provides the enforcement POINT and visibility, honestly recorded); (2) visibility: `GET /api/admin/openmuse-deletion/cleanup` (requireAdmin) — unresolved manifest rows (kind/id/lastError/at), retryable counts, retention-elapsed flags; (3) post-success: the marker retains only the non-personal audit summary (timestamps + phases).

**Spec:** Contracts §9 retention + catalog D09; Issue #87. S43 is the live card.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-deletion/* (retention.ts + routes/store), server/tests/openmuse-deletion.test.ts; baseline script env comment. NO app.ts/index.ts (admin mount per D05's established pattern).

### Task 1: RED — tests (injected clock)

1. retentionElapsed: before restoreUntil+retention → false (manifest persists); after → true (manifest eligible for final archive); env override;
2. cleanup endpoint: unresolved rows listed with kind/safe-id/lastError (no bytes/secrets — sanitized per G06 patterns); retryable counts; retention flags; non-admin 403;
3. success path: fully-cleaned deletion → the endpoint shows only the audit summary; marker phases recorded;
4. unresolved visibility persists across sweeps (no silent clearing).

### Task 2: GREEN

- Implement per matrix; per-file re-runs green (deletion + ready); typecheck + biome clean.

### Task 3: Checkpoint

- Report: retention-policy honest scoping note (enforcement point vs deployment infrastructure), files + shasum, test tails, S43 deferred note. No commit.

## Failure handling

- Never expose byte payloads or secrets in the visibility endpoint.
