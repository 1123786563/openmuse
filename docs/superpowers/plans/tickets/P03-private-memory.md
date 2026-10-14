# P03 — Write and retrieve private Memory: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessors I03+C01 verified+integrated; P01/P02's openmuse-personal module pattern in place.

**Goal:** §7 Memory contract: owner CRUD over `/api/mobile/openmuse-memories` with `{id,text,source,createdAt}`; retrieval is by explicit lookup returning exact {id,text,source} records (not a subjective "useful" result — a paged reverse-chron list + exact-id get); another Bot/user cannot retrieve; delete removes it from subsequent retrieval.

**Architecture:** Mirror P01/P02: `server/src/openmuse-personal/memories.ts` (drizzle `openmuse_memories`, migration 00NN; zod text 1..10_000, source ≤50), routes through the same personal mount (extend the wiring as P02 did), `memoryLookupFor(owner)` seam (C07 consumer, same honest deferral).

**Spec:** Contracts §7 Memory; catalog P03; Issue #76.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Create server/src/openmuse-personal/memories.ts, server/tests/openmuse-memories.test.ts, migration 00NN (SQL verbatim); Modify the personal wiring (app.ts/index.ts as P02 did; ready.test.ts offset if a param is appended). Never touch openmuse-reviewed-actions (concurrent worker).

### Task 1: RED — tests

1. create/list (reverse-chron, cursor discipline like siblings)/get owner-scoped; foreign 404; zod bounds (text 10_000 max, empty 400);
2. delete tombstones → list/get/lookup all stop returning the id;
3. lookup seam returns exact {id,text,source} (no scoring, no filtering — record that retrieval semantics = explicit);
4. §9 hooks (disableOwner/enumerateOwner);
5. two-actor isolation fixture.

### Task 2: GREEN

- Implement + migration + wiring; `bun test tests/openmuse-memories.test.ts tests/openmuse-ideas.test.ts tests/openmuse-goals.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: wiring decision, migration SQL, files + shasum, test tails, S36 deferred note. No commit.

## Failure handling

- Follow P02's wiring precedent exactly.
