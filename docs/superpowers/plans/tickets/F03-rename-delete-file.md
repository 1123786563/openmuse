# F03 — Rename and delete a File: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessor F02 verified+integrated.

**Goal:** Rename changes display metadata only (name column; sha/version/byte path untouched); delete tombstones immediately (list hides the item, content URL fails); a NEW upload with a new idempotency key creates a NEW file/version (idempotent same-key retry still returns the original); old content URLs fail after delete.

**Architecture:** Extend `openmuse-files/routes.ts`: `PATCH /:id {name}` (owner-scoped; zod name 1..255, no path separators), `DELETE /:id` (sets deletedAt via CAS on null; content route already refuses tombstoned — F02 asserted; re-assert post-delete). Store: `rename(owner,id,name)`, `tombstone(owner,id)`.

**Spec:** Contracts §5 File (rename = display metadata only; delete tombstones + refuses old URLs; new key = new file); catalog F03; Issue #41.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-files/{store.ts,routes.ts}, server/tests/openmuse-files.test.ts. NO migrations (deleted_at exists), NO app.ts/index.ts.

### Task 1: RED — tests

1. rename: name updates; sha256/versionId/bytePath/id unchanged (row + byte store untouched — fake byte store sees zero writes); foreign rename → 404; invalid name (empty, >255, contains `/` or `\0`) → 400;
2. delete: list no longer shows it (immediately); GET :id → 404; GET :id/content → 404 (re-assert); byte store NOT deleted here (physical purge is D06's — document); second delete → 404 (already tombstoned); foreign delete → 404;
3. re-upload after delete with a NEW key → new file id (the tombstoned row stays tombstoned); same OLD key retry after delete → 404/410 per store semantics — decide per contract §5 ("a new key creates a new File even with identical bytes") and record the chosen behavior with rationale;
4. rename on tombstoned → 404;
5. §9: enumerateOwner excludes tombstoned.

### Task 2: GREEN

- Implement per matrix; `bun test tests/openmuse-files.test.ts tests/mobile-bff.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: the same-old-key-after-delete decision + rationale, files + shasum, test tails. No commit.

## Failure handling

- If partial-unique-index semantics make a same-key re-create after tombstone collide, that is precisely the decision in Task 1 case 3 — resolve explicitly, never silently.
