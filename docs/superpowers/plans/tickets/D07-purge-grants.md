# D07 — Purge OpenConnector grants: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessors D04+D05+D06 verified+integrated.

**Goal:** §9 connector cleanup: the manifest's alias rows drive vendor connection revocation+deletion BEFORE account metadata is removed; an injected connector failure stays retryable with the alias remaining enumerated and blocked; repeated cleanup does not reconnect or affect another user; after successful purge the alias disappears from enumeration and the manifest marks deleted.

**Architecture:** Extend `openmuse-deletion`: `purgeConnectorGrants(userId)` — walks the manifest's connector-alias rows: vendor deleteConnection(alias) (the D03-established best-effort seam — but HERE failure blocks THIS row only), then the local connection row removed (hard delete — cite the connectors store's removal seam or add one export, noted), manifest row deleted; failure → retryable_error with the alias retained (F-PURGE-2 semantics: alias remains enumerated and blocked until successful purge). retryCleanup re-walks retryable rows only.

**Spec:** Contracts §9; catalog D07; Issue #85. F-PURGE-2 is the live card.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-deletion/* (purge-connector extension), server/tests/openmuse-deletion.test.ts; EMIT-ONLY one export from openmuse-connectors (connection row removal — cite, noted). NO app.ts/index.ts.

### Task 1: RED — tests

1. two aliases purge: vendor deleteConnection called per alias (fake counts) BEFORE local row removal (ordering); rows removed; manifest deleted;
2. injected vendor failure on one alias → retryable_error, alias retained (enumerable + blocked); the OTHER completes; retryCleanup completes it later idempotently;
3. never another user's alias (fake dial asserts);
4. no reconnect path: a subsequent start-authorize for the deleted owner is fence-refused anyway (re-assert D01) — record the interplay.

### Task 2: GREEN

- Implement per matrix; per-file re-runs green (deletion + google-oauth + ready); typecheck + biome clean.

### Task 3: Checkpoint

- Report: export note, files + shasum, test tails, F-PURGE-2 deferred note. No commit.

## Failure handling

- Follow D06's manifest-arbiter discipline exactly.
