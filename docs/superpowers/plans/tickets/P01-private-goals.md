# P01 — Create and use a private Goal: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessors I03+C01 verified+integrated.

**Goal:** §7 Goal contract: owner CRUD over `GET/POST /api/mobile/openmuse-goals` + `GET/PATCH/DELETE /:id` with `{id,title,description,category,status,milestones[]}` (milestone {id,title,status}); the private Bot's tool path retrieves EXACT id/title/milestone status (a `goal.read` tool seam registered for the runtime — Task 0 finds the tool registration seam); foreign user or a Bot without grant gets NO goal; delete hides it.

**Architecture:** New module `server/src/openmuse-personal/goals.ts` (store over drizzle `openmuse_goals` + `openmuse_goal_milestones` or single table with jsonb milestones — choose per repo norms; migration 00NN), routes via the mobile-bff pattern (app.ts ONE tail param + conditional; index.ts arg), and a tool seam: a read-only `goals` lookup function exported for the runtime's tool registry (Task 0 cites where personal tools register; if none exists yet, export `goalLookupFor(ownerUserId)` consumed later by C07's porting ticket and RECORD that the runtime wiring lands with C07 — honest scoping).

**Spec:** Contracts §7 Goal; catalog P01; Issue #74.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Create server/src/openmuse-personal/goals.ts, server/tests/openmuse-goals.test.ts, migration 00NN; Modify server/src/app.ts (ONE tail param + conditional; ready.test.ts offset), server/src/index.ts (import + arg). CONCURRENT: R02 worker edits index.ts's reviewed-actions construction line — your edits are appended args + imports; re-read before editing; never touch openmuse-reviewed-actions/*.
- Do NOT touch openmuse-mail/connectors/files/tasks/computer.

### Task 1: RED — tests

1. create → row {id,title,description,category,status active,milestones[]}; zod: title 1..200, category enum-free string ≤50, milestones ≤50 each {id,title,status todo};
2. list owner-only (two-actor); get/patch/delete owner-scoped (foreign 404); patch updates fields (milestones replaced atomically); delete tombstones + list/get hide;
3. `goalLookupFor(owner)` returns exact {id,title,milestoneStatuses[]} records; after delete the id no longer returns (re-assert);
4. §9 hooks: disableOwner blocks CRUD; enumerateOwner refs.

### Task 2: GREEN

- Implement + migration (SQL verbatim) + wiring; `bun test tests/openmuse-goals.test.ts tests/ready.test.ts tests/mobile-bff.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: Task 0 tool-registry finding (cited or C07-deferred), migration SQL, files + shasum, test tails, S36 live note deferred. No commit.

## Failure handling

- If the runtime tool registry needs the private Bot's grant plumbing (not present yet), ship the lookup seam + record C07 as the wiring owner — do not invent grant machinery.
