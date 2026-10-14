# F02 — Download a private File: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessor F01 verified+integrated (openmuse-files module + migration 0077 + byte store in place).

**Goal:** The file's authenticated owner downloads the exact original bytes (SHA-256 verified against the stored digest); a foreign ID, a deleted file, and a stale/copied URL all fail; the byte path never accepts client input and path traversal is refused.

**Architecture:** Extend `server/src/openmuse-files/routes.ts` with `GET /:id/content` (and `GET /:id` metadata if absent): resolve the file row by id, check owner + not deleted, stream bytes from the byte store by the server-derived key, set Content-Type from the row, and expose ETag `sha256:<digest>` so the hash check is a first-class response header. No app.ts changes (the sub-app is already mounted at /api/mobile/openmuse-files).

**Tech Stack:** Hono, existing FileByteStore, bun:test (in-memory rows + fake byte store, F01's test fakes pattern).

**Spec:**
- Contracts §5 File + Content access: /Users/wuyongjun/trea/openmuse/.worktrees/v4-base/docs/superpowers/plans/2026-10-12-openmuse-openbot-contracts-v4.md
- Catalog F02; Issue #40. F01 code: server/src/openmuse-files/{store,bytes,routes}.ts + server/tests/openmuse-files.test.ts.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-files/{routes.ts,store.ts (only if a getter is missing)}, server/tests/openmuse-files.test.ts. NOTHING ELSE — in particular no app.ts/index.ts/mobile-bff edits (the mount already exists).
- The worktree carries all prior uncommitted checkpoints — never revert them.

### Task 1: RED — content route tests

- [ ] **Step 1:** Extend server/tests/openmuse-files.test.ts:
  1. owner GET /:id/content → 200, exact bytes equal the uploaded fixture, Content-Type = stored mimeType, ETag = `sha256:<hex>`;
  2. foreign owner → 404 (not 403 — existence is not disclosed);
  3. missing id → 404;
  4. deleted (tombstoned) file → 404 with empty body, and the list no longer shows it (F01 behavior, re-assert);
  5. byte-store get throws (simulated storage failure) → 503, no partial body;
  6. GET /:id (metadata) returns the F01 DTO for the owner, 404 foreign;
  7. a byte-path payload in any query/header is ignored (server key always wins — assert the fake byte store received only the server-derived key).
- [ ] **Step 2:** `bun test tests/openmuse-files.test.ts` → new cases FAIL.

### Task 2: GREEN

- [ ] **Step 1:** routes.ts: `GET /:id` (owner-scoped metadata) + `GET /:id/content` streaming via the byte store; ETag/Content-Type/Content-Length headers; streaming (never buffer whole file — read the byte store's contract from bytes.ts and stream what it offers; if it returns Buffer, send it directly with the correct length, and record that as the current seam's behavior).
- [ ] **Step 2:** store.ts: add `getOwnedFile(ownerUserId, id)` and `byteKeyFor(version)` if missing (mirror F01 naming).
- [ ] **Step 3:** `bun test tests/openmuse-files.test.ts tests/mobile-bff.test.ts tests/openmuse-tasks.test.ts` → all PASS. typecheck + biome clean on owned files.

### Task 3: Checkpoint

- [ ] Report: changed files + shasum, test tails, streaming-vs-buffer statement. No commit.

## Acceptance (Issue #40 / catalog F02)

Authenticated current owner downloads exact hash; copied URL after logout or foreign ID fails (auth guard + owner check; "after logout" specifically = 401 without session — assert with guardAdmits=false); path input cannot select server storage location. Verified by Task 1 tests.

## Failure handling

- If the byte store's seam cannot stream, document Buffer-return and flag for a later perf ticket; do not rewrite bytes.ts.
