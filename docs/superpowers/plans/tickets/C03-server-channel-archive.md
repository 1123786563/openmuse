# C03-server — Channel rename/archive/reopen server seam: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single bounded sub-task of GitHub issue #16 (C03); one agent context, TDD. Discovered gap: OpenBot channels have NO rename/archive/reopen endpoints; softDelete mints a NEW threadId on reopen — both violate contract §3.

**Goal:** `PATCH /api/channels/:id {name?}` renames (display only); archive is an explicit channel state (`archivedAt`, distinct from softDelete): `POST /:id/archive` sets it, `POST /:id/unarchive` clears it preserving id AND threadId and history; `GET /api/channels?include=archived=true` (or a separate listing param — follow the route's existing query style) returns archived rows in the same cursor discipline; the active default listing EXCLUDES archived. Foreign channel id → 404 everywhere.

**Architecture:** Extend `server/src/channels/routes.ts` + the channel store (find the store seam the routes use; add rename/archive/unarchive methods with owner/membership scoping identical to existing mutations); migration 00NN adds `archived_at` to `channels` (nullable; NULL = active). softDelete semantics UNTOUCHED. The workspace/mobile-bff roster read gains the archived partition (or a param) so the client can list both — follow how mobile-bff workspace.ts builds channels today and expose `archivedAt` in its DTO.

**Spec:** Contracts §3 (archive hides from active list; Archived filter lists and reopens retaining threadId); catalog C03; Issue #16.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/channels/{routes.ts,store-or-equivalent}, server/src/mobile-bff/{workspace.ts,routes.ts} (archivedAt in DTO + optional archived listing), server/tests/<channels test file(s)>, migration 00NN (SQL verbatim; db:generate w/ DATABASE_URL; no migrate). NO app.ts/index.ts edits (channels routes already mounted).
- The worktree carries prior uncommitted checkpoints — never revert.

### Task 1: RED — tests

1. rename: name updates; threadId/membership untouched; foreign 404; invalid name 400 (same validation class as create);
2. archive: sets archivedAt; active GET listing excludes it; include-archived listing includes it (cursor discipline intact — order stable);
3. unarchive: clears archivedAt; SAME id + threadId + history (row assert); double-archive 409-or-idempotent (choose + record); unarchive of a non-archived → 409;
4. softDelete independence: archived channel then DELETE → gone from BOTH listings (deletedAt still wins); unarchive of a deleted channel → 404;
5. mobile-bff workspace DTO exposes archivedAt; two-actor isolation unaffected.

### Task 2: GREEN

- Implement per matrix + migration; `bun test <channels tests> tests/mobile-bff.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: migration SQL, the listing-param choice, files + shasum, test tails. No commit.

## Failure handling

- If the channel store's seam cannot express archivedAt cleanly, STOP and ask rather than bending softDelete.
