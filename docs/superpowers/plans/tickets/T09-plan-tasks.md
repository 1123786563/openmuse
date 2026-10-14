# T09 — Run a Plan Task: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessors T03+T07 verified+integrated.

**Goal:** §7 Plan tasks: step graph `{id,title,dependsOn[],status,result?,evidenceIds[]}` where ONLY steps whose predecessors all succeeded run; a failed step stays failed and successors stay pending until an explicit new attempt (T06 retry); restart retains succeeded steps (never replayed); the three-step fixture (linear 1→2→3) passes, fails at 2, and recovers per the matrix.

**Architecture:** Extend `openmuse-tasks`: plan semantics in the runner — for kind `plan`, steps carry the graph; the sweep executes the next ready step (predecessors succeeded, itself pending) via the SAME runTurn seam (per-step turn with the step title as prompt context — record the mapping), marks succeeded/failed, and STOPS on failure (successors pending); restart (T07 recovery) skips already-succeeded steps (status check — no replay); retry (T06) resets pending/failed steps of a NEW attempt while retaining completed evidence. Creation path: POST accepts kind plan with a `steps` array (zod: 1..50, ids unique, dependsOn referencing existing ids, no cycles — topological validation 400 on cycle).

**Spec:** Contracts §7 Plan; catalog T09; Issue #66. Fixture S31: three-step plan, fail step 2, restart → step1 succeeded / step2 failed / step3 pending.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-tasks/{store.ts,routes.ts,runner.ts}, server/tests/openmuse-{tasks,task-runner}.test.ts; migration ONLY if needed (record). NO app.ts/index.ts. Never touch openmuse-reviewed-actions (concurrent worker).

### Task 1: RED — tests

1. creation: valid graph accepted; cycle → 400; unknown dependsOn id → 400; >50 steps → 400; duplicate ids → 400;
2. happy path: sweep 1 executes step1 then (next sweep) step2 then step3 — each via one runTurn call with step context (assert call args); statuses advance pending→running→succeeded in order; task succeeds after step3;
3. failure at step2: step1 succeeded retained; step2 failed with error; step3 STAYS pending; task status failed;
4. restart mid-plan (T07 recovery re-instantiation): succeeded steps NOT re-executed (runTurn call counts), next ready step runs;
5. retry after failure: new attempt resets failed+pending steps, retains succeeded steps' status/evidence (per T06's retention — assert), re-runs from step2;
6. diamond graph (1→{2a,2b}→3): 2a/2b both run before 3 (either order), 3 waits for both;
7. §9/disabled-owner unchanged.

### Task 2: GREEN

- Implement per matrix; `bun test tests/openmuse-tasks.test.ts tests/openmuse-task-runner.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: step→turn mapping decision, migration SQL if any, files + shasum, test tails, S31 deferred note. No commit.

## Failure handling

- If per-step turns need a distinct prompt shape, extend the runTurn seam's input type minimally and record.
