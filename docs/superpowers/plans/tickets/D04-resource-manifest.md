# D04 — Create a durable deletion resource manifest: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessors ALL verified+integrated (D02, D03, C03, K03, F09, T09, T11, T12, T13, T16, P01-03, V02).

**Goal:** §9 manifest: BEFORE any metadata removal, the delete flow records every owner resource — Bot/computer, Channel/Thread, Task/Monitor, reviewed actions, personal context (goals/ideas/memories), notifications, File object keys (external byte-store keys), and connector aliases — as `{kind,id,externalKey?,state,lastError?}` rows with states `pending → deleted | retryable_error`; external keys are enumerated BEFORE relational metadata deletion; cleanup is idempotent; the manifest persists until every resource is deleted and backup retention elapses (retention check is D09's — the manifest carries restoreUntil).

**Architecture:** Extend `openmuse-deletion`: `buildManifest(userId)` — enumerates via each module's §9 `enumerateOwner` seam (they all exist: files/tasks/reviewed/goals/ideas/memories/notifications/deletion marker + connectors' alias list + channels/agents via the profile/channel stores — Task 0: cite each seam; for channels/threads use the channel store's owner enumeration or the workspace read — cite what exists, note gaps honestly) writing rows to `openmuse_deletion_resources` (migration 00NN: manifestId→marker, kind, id, externalKey, state, lastError, updatedAt); the delete route becomes: fence → shutdown (D02) → revoke (D03) → buildManifest → (cleanup execution is D06/D07/D08's — the manifest is this ticket's deliverable; the route records and returns it). Resource-state transitions `markDeleted/markRetryable` with idempotent repeats.

**Spec:** Contracts §9 manifest; catalog D04; Issue #82. Inventory comparison vs two-user seeded data is S40's live row.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-deletion/* (new manifest.ts + routes/store extension), server/tests/openmuse-deletion.test.ts; migration 00NN (SQL verbatim; db:generate w/ DATABASE_URL). EMIT-ONLY one-export additions where an enumerate seam is private (noted). NO app.ts/index.ts. Never touch capacity/computer internals (concurrent worker).

### Task 0

- [ ] Enumerate the seams: file:line for each module's enumerateOwner/alias listing + how channels/agents enumerate for an owner (cite; record any module whose enumeration must be approximated at this stage and why).

### Task 1: RED — tests

1. seeded owner (file w/ byte-store key, task, monitor, reviewed action awaiting, goal/idea/memory, notification, gmail+gcalendar connections) → delete → manifest rows cover EVERY item with correct kinds; externalKey present for file bytes + connector aliases; enumerated BEFORE any row deletion (order asserted via a deletion-counting fake — zero module-row deletions at manifest time);
2. states: all pending initially; markDeleted/markRetryable transitions idempotent (repeat = no-op);
3. two-user: user B's resources absent from A's manifest;
4. §9 shape: manifestId ↔ marker linkage; restoreUntil carried from the marker;
5. idempotent re-delete: second delete rebuilds ONLY missing rows (existing states preserved).

### Task 2: GREEN

- Implement per matrix (Task 0 citations + gaps recorded); per-file re-runs green (deletion + the touched modules' suites + ready); typecheck + biome clean.

### Task 3: Checkpoint

- Report: Task 0 seam table (or gaps), migration SQL, files + shasum, test tails, S40/F-PURGE-1/2 deferred notes. No commit.

## Failure handling

- A module without an enumerable seam: record the gap in the manifest as {kind, id:"<module-gap>", state:"pending", lastError:"enumeration seam missing — <ticket>"} — never silently omit.
