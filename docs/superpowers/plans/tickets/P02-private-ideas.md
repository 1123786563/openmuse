# P02 — Capture and use a private Idea: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessors I03+C01+T01 verified+integrated; P01's openmuse-personal module pattern in place.

**Goal:** §7 Idea contract: owner CRUD over `/api/mobile/openmuse-ideas` with `{id,title,reason,evidence[],prompt,kind,input,status,taskId?}`; an ACCEPTED idea points to exactly one Task (taskId set, status accepted); the lookup seam returns exact id/title/kind for the owner; foreign user gets nothing; delete/withdraw hides it.

**Architecture:** Mirror P01: `server/src/openmuse-personal/ideas.ts` (drizzle `openmuse_ideas`, migration 00NN; jsonb evidence; status pending→accepted|withdrawn; taskId nullable FK-ish reference to openmuse_tasks.id validated on accept via the tasks store's get), routes in the same mobile-bff mount pattern (extend the personal mount — Task 0: how P01 mounted; reuse, ONE tail param already exists for goals — add ideas to the SAME param's shape or a second param, choose minimal and record), `ideaLookupFor(owner)` seam (C07 consumer, same deferral discipline as P01).

**Spec:** Contracts §7 Idea; catalog P02; Issue #75.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Create server/src/openmuse-personal/ideas.ts, server/tests/openmuse-ideas.test.ts, migration 00NN (SQL verbatim); Modify the app.ts/index.ts wiring P01 added (extend its param shape or append ONE param; ready.test.ts offset if appended), server/src/openmuse-tasks/store.ts ONLY if a get-for-validation export is missing (one export, note it). Never touch openmuse-connectors (concurrent worker).

### Task 1: RED — tests

1. create → row with §7 fields (zod: title 1..200, kind/input enums-free strings ≤50, evidence array ≤20 of {kind,ref}); owner-scoped list/get; foreign 404;
2. accept: status accepted + taskId set ONLY when the task exists and is owned (foreign/missing task → 400); double-accept idempotent; accepting a withdrawn → 409;
3. withdraw: status withdrawn; taskId kept for history (record choice) or cleared (record); lookup excludes withdrawn;
4. lookup seam exact {id,title,kind}; deleted/withdrawn ids stop returning;
5. §9 hooks (disableOwner/enumerateOwner).

### Task 2: GREEN

- Implement + migration + wiring decision recorded; `bun test tests/openmuse-ideas.test.ts tests/openmuse-goals.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: wiring decision, migration SQL, files + shasum, test tails, S36 deferred note. No commit.

## Failure handling

- If P01's mount shape resists extension, append a new tail param and update ready.test.ts per its convention.
