# M04 — Read attachment metadata and bytes: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessor M03 verified+integrated.

**Goal:** `GET /api/mobile/openmuse-mail/threads/:threadId/messages/:messageId/attachments/:attachmentId` returns the attachment's metadata, and `.../content` streams its bytes for the authenticated owner; a copied foreign attachment id refuses; the provider's size limit is respected (oversize → 413 with the limit named); disconnected → 409.

**Architecture:** Extend `openmuse-mail`: client.ts gains attachment-metadata + attachment-bytes action calls (alias-bound dial, placeholder ids `gmail.attachment.get`/`gmail.attachment.bytes` recorded); mail.ts maps metadata {id,name,mimeType,size}; routes add the two endpoints (requireUser + requireConnection + owner-alias binding; foreign/missing → 404 identical outward; bytes response carries Content-Type + Content-Length + ETag sha256 when the provider supplies a digest, else no ETag — record).

**Spec:** Contracts §4 attachment DTO {id,name,mimeType,size} + authenticated owner fetch within the existing Google size limit; catalog M04; Issue #35.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-mail/{client,mail,routes}.ts, server/tests/openmuse-mail.test.ts. NO app.ts/index.ts, no migrations. Never touch openmuse-calendar/connectors (concurrent workers).

### Task 1: RED — tests

1. metadata endpoint: DTO mapping exact; foreign attachment (other alias's data in fake) → 404 identical to missing; provider not-found → 404;
2. bytes endpoint: exact bytes pass through with Content-Type/Content-Length; foreign → 404 (zero dial bytes calls for foreign ids — assert call counts);
3. oversize (fake provider reports size > limit; limit constant documented, default 25 MiB per Gmail attachment reality — record the chosen constant) → 413 naming the limit;
4. disconnected → 409 vendor never called; disabled owner 403;
5. provider error → 502 no partial body.

### Task 2: GREEN

- Implement per matrix; `bun test tests/openmuse-mail.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: action-id notes, size-limit constant + rationale, files + shasum, test tails, S17/T14 live notes deferred. No commit.

## Failure handling

- If the provider exposes no separate metadata call, derive metadata from the thread payload (M03's shape) and record the derivation.
