# F01 — Upload and list one personal File: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessor I03 verified+integrated.

**Goal:** An authenticated owner can upload one personal file (≤20 MiB general, ≤10 MiB PDF) and list their files with stable `{id, name, mimeType, size, sha256, versionId, createdAt}`; a retried upload with the same owner-scoped idempotency key returns the existing File/version; metadata survives restart (durable rows); foreign listing shows nothing.

**Architecture:** New module `server/src/openmuse-files/`: drizzle tables `openmuse_files` (id, ownerUserId, name, mimeType, size, sha256, idempotencyKey unique per owner, createdAt, deletedAt) + `openmuse_file_versions` (versionId, fileId, bytePath server-derived, sha256, createdAt) — migration via db:generate. Store abstraction `FileByteStore` (put/get/delete by server-derived key) with a local-directory implementation (root under the deployment's data dir; Task 0 confirms prior art from channel attachments — reuse its location conventions). Routes `POST /api/mobile/openmuse-files` (multipart or raw body + headers) and `GET /api/mobile/openmuse-files` mounted through the mobile-bff assembly pattern.

**Tech Stack:** Hono, drizzle, node:crypto sha256, bun:test.

**Spec:**
- Contracts §5 File and PDF contracts: /Users/wuyongjun/trea/openmuse/.worktrees/v4-base/docs/superpowers/plans/2026-10-12-openmuse-openbot-contracts-v4.md
- Catalog F01; Issue #39. Every state-owning ticket also implements its narrow §9 lifecycle hook (disableOwner/enumerateOwner at minimum; restore/purge may be explicit no-ops with stated reason).

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Create server/src/openmuse-files/{store.ts,routes.ts,bytes.ts}, server/tests/openmuse-files.test.ts, generated drizzle migration (+meta); Modify server/src/mobile-bff/routes.ts (mount only), server/src/index.ts ONLY if assembly wiring is required (keep to import + arg, mirror I02's pattern; ask first if more).
- Do NOT touch: app.ts, computer/, admin/, agents/openmuse-template-store.ts, K01's stream files.
- Byte path NEVER from client. Limits: 20 MiB general / 10 MiB PDF (`application/pdf`), 413 beyond.

### Task 0: Facts (record; STOP+ask on failure)

- [ ] How channel attachments store bytes today (server/src/channels/attachments.ts + attachment-parts.ts): location, naming, size ceilings, and whether a reusable seam exists. If a generic byte store exists, reuse it; else implement local-dir store under the deployment data directory and record the choice.
- [ ] Mobile-bff assembly: mirror how I02's provisioner was wired (app.ts conditional at the /api/mobile mount — your mount goes through routes.ts deps like openMuseProvisioner did; index.ts arg only if unavoidable).

### Task 1: RED — store + route tests

- [ ] **Step 1:** server/tests/openmuse-files.test.ts (in-memory fakes for db + byte store where possible; real drizzle only if an existing test harness does DB — per Task 0 finding, else pure store-contract fakes):
  1. upload stores bytes via byte-store with server-derived key, records sha256/size/mime/name, returns stable id+versionId;
  2. same owner + same idempotency key → same file/version, byte store written ONCE;
  3. same key different owner → two files (owner-scoped);
  4. >20 MiB non-PDF → 413; >10 MiB PDF → 413; exactly-at-limit passes;
  5. list returns only owner's files ordered createdAt desc, id tiebreak, with all DTO fields;
  6. unauthenticated → 401 via requireUser (test-app without guard proves route family guarded);
  7. restart durability: new store instance over same fake db rows lists the file (proves rows not memory-only);
  8. §9 hook: `disableOwner(userId)` refuses further uploads/list for that owner (returns disabled error), `enumerateOwner(userId)` returns ResourceRefs {kind:"openmuse-file", id, externalKey: byte-store key}.
- [ ] **Step 2:** `bun test tests/openmuse-files.test.ts` → FAIL.

### Task 2: GREEN

- [ ] Implement store.ts (drizzle), bytes.ts (local dir store: key = `openmuse-files/<ownerId>/<fileId>/<versionId>` — server-derived; sha256 streaming), routes.ts (POST parse content-type: multipart file OR raw body with X-File-Name/X-File-Type headers — pick ONE, document; accept `Idempotency-Key` header; GET list page 25 default/100 max with owner-bound cursor `createdAt,id` opaque base64).
- [ ] Wire into mobile-bff routes + assembly per Task 0; generate migration; review SQL verbatim in report.
- [ ] `bun test tests/openmuse-files.test.ts tests/mobile-bff.test.ts tests/openmuse-bot.test.ts` → PASS. typecheck + biome clean.

### Task 3: Checkpoint

- [ ] Report: Task 0 answers, migration SQL, changed files + shasum, test tails, chosen upload encoding. No commit.

## Acceptance (Issue #39 / catalog F01)

Owner uploads within limits; list shows stable ID, size and SHA-256 after restart; same idempotency key does not duplicate. Verified by Task 1 tests (restart case included). PDF page-limit and inspection are F05's.

## Failure handling

- If the attachments byte seam cannot be reused safely, implement the local-dir store and flag the duplication for reviewer attention.
- If index.ts wiring needs more than import+arg, STOP and ask.
