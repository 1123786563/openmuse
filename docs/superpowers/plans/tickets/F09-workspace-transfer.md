# F09 — Transfer a PDF version to Bot workspace: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessors F06+K01 verified+integrated.

**Goal:** `POST /api/mobile/openmuse-files/:id/transfer {versionId, transferKey}` copies the file version into the private Bot's computer workspace: the destination is a server-derived generated path from fileId/versionId (client supplies NO destination); a same-name existing file is NOT overwritten (distinct generated path); retry with the same transferKey returns the SAME workspace artifact; partial transfer is cleaned or marked failed, never reported complete.

**Architecture:** Extend `openmuse-documents`: `transfer.ts` — destination path derivation `openmuse-transfer/<fileId>/<versionId>-<n>` (n increments on collision — Task 0: cite the computer gateway's workspace-write seam (how the server writes into a bot workspace today — snapshot/frames/craft paths; find the gateway method) and record; if no server-side write seam exists, implement via the gateway's file-push capability and cite); idempotency: a `transfer_key` recorded on the derived artifact mapping (in-file jsonb or a small table — choose, record; prefer file-row jsonb metadata with one migration-free field if the schema allows, else migration 00NN).

**Spec:** Contracts §5 Workspace transfer; catalog F09; Issue #48.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Create server/src/openmuse-documents/transfer.ts; Modify server/src/openmuse-documents/routes.ts, server/tests/openmuse-documents.test.ts; migration 00NN ONLY if a transfer-record column/table is chosen (SQL verbatim). NO app.ts/index.ts. Never touch openmuse-activity/tasks/reviewed-actions (concurrent workers). Computer gateway: READ + cite its write seam; if invoking it needs an export, add ONE and note it.

### Task 1: RED — tests

1. transfer happy: destination server-derived from fileId/versionId (client destination field IGNORED — assert); gateway write called once with derived path + bytes;
2. collision: same-name existing → distinct generated path (n+1), original untouched;
3. retry same transferKey → SAME artifact path returned, gateway write NOT repeated (fake counts);
4. different key → new artifact allowed;
5. partial failure (fake gateway throws mid-write) → 503/failed marker, never complete; cleanup of the partial attempted (fake fs records deletion);
6. owner-scoped 404; tombstoned 404; §9 disabled 403.

### Task 2: GREEN

- Implement per matrix (Task 0 seam citation + storage decision recorded); `bun test tests/openmuse-documents.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: Task 0 gateway seam citation, storage decision, migration SQL if any, files + shasum, test tails, S27 live fixture deferred note. No commit.

## Failure handling

- If NO server→workspace write seam exists at all, STOP and ask (that would be a gateway capability gap needing its own decision).
