# T14 — Import a Gmail PDF attachment into Files: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessors M04+F02 verified+integrated.

**Goal:** `POST /api/mobile/openmuse-files/import/gmail-attachment` {threadId, messageId, attachmentId, importKey} imports the CURRENT user's PDF attachment as one File with provenance {source:"gmail-attachment", messageId, threadId} + sha256; retry with the SAME import key returns the SAME file/version (no duplicate); a foreign attachment (another alias's data) refuses; non-PDF attachment refuses.

**Architecture:** Extend `openmuse-files`: routes gain the import endpoint — reads attachment metadata+bytes through openmuse-mail's client (import the existing exports — metadata check: mimeType PDF + name; bytes via the attachment-bytes helper), writes via F01's upload seam with an owner-scoped idempotency key derived from `importKey` (key namespace distinct from uploads: `gmail:<threadId>:<messageId>:<attachmentId>:<importKey>` — deterministic so retries converge; record), provenance recorded in the file row's source metadata (F01's source field or jsonb — check F01's schema; if no provenance column, use the idempotency-key namespace as the durable provenance and record the choice).

**Spec:** Contracts §7/T14 catalog (one owned File version with message/thread provenance; same-key retry same version; foreign refuses); Issue #71.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-files/{store.ts,routes.ts}, server/tests/openmuse-files.test.ts. NO migrations/app.ts/index.ts (upload seam suffices). Import-only reuse of openmuse-mail client (one export addition allowed, noted). Never touch openmuse-reviewed-actions/openmuse-tasks (concurrent workers).

### Task 1: RED — tests

1. happy import: attachment {name report.pdf, mimeType application/pdf, bytes} → File row with sha256 of bytes + provenance (per the chosen representation); attachment fetch used the OWNER's alias (fake dial asserts);
2. same importKey retry → SAME file id/version, mail client called at most once more for metadata OR zero (choose + record — deterministic key converges without re-fetch);
3. different importKey, same attachment → a SECOND distinct file (allowed);
4. foreign attachment (fake provider data tagged to another alias) → 404 zero imports;
5. non-PDF mimeType → 400 naming it;
6. disconnected gmail → 409 vendor never called for bytes;
7. §9 disabled owner 403.

### Task 2: GREEN

- Implement per matrix; `bun test tests/openmuse-files.test.ts tests/openmuse-mail.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: provenance representation choice + retry-fetch decision, files + shasum, test tails, S24 live fixture deferred note. No commit.

## Failure handling

- If F01's schema lacks any provenance field, the idempotency-key namespace IS the provenance (recorded) — do not add a migration for it in this ticket.
