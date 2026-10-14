# D06 — Purge external File bytes: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessors D04+D05 verified+integrated.

**Goal:** §9 cleanup: the manifest's file object keys drive deletion of original AND derived bytes BEFORE file metadata rows are removed; an injected storage failure leaves the row retryable_error; retry never touches another user's object; repeat cleanup idempotent; after byte deletion the metadata rows remove and the manifest marks deleted.

**Architecture:** Extend `openmuse-deletion`: `purgeFileBytes(userId)` — walks the manifest's file-kind rows (externalKey = byte-store key), calls the byte store's delete (F01 seam — cite; one export addition if private), on success deletes the file/version metadata rows via the files store (tombstone→hard delete or equivalent — cite F03's tombstone semantics: D06 removes rows outright post-restoreUntil; record the choice) and marks the manifest row deleted; on failure marks retryable_error with lastError; a `retryCleanup` path re-walks retryable rows only. Byte deletion ordering: keys enumerated before metadata (D04 guaranteed; re-assert).

**Spec:** Contracts §9 (external keys drive deletion before relational metadata; retryable; idempotent); catalog D06; Issue #84. F-PURGE-1 is the live card.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-deletion/* (purge.ts + routes/store extension), server/tests/openmuse-deletion.test.ts; EMIT-ONLY one export from openmuse-files (byte delete + hard-delete rows — cite; noted). NO app.ts/index.ts. Never touch connectors (D07's, next).

### Task 1: RED — tests

1. seeded owner with original + derived versions: purge deletes BOTH byte objects (fake byte store counts) BEFORE metadata rows (ordering fake); metadata rows then removed; manifest rows deleted;
2. injected byte-delete failure on one key: that row → retryable_error (lastError recorded), OTHERS still purge; metadata for the failed key retained; retryCleanup later completes it (idempotent repeat);
3. never another user's object: fake byte store asserts only the manifest's keys touched;
4. post-purge restore impossibility recorded: after purge, D05 restore returns bytes-unavailable class (report semantics — cite the interplay);
5. §9 unchanged.

### Task 2: GREEN

- Implement per matrix; per-file re-runs green (deletion + files + ready); typecheck + biome clean.

### Task 3: Checkpoint

- Report: metadata-removal choice, export notes, files + shasum, test tails, F-PURGE-1 deferred note. No commit.

## Failure handling

- Never delete metadata while any byte key is retryable — the manifest is the arbiter.
