# T13 — Create a finance Task artifact: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessors F02+T03 verified+integrated. Porting source: OpenMuse's finance CSV logic (READ-ONLY prior art).

**Goal:** §7 finance fixture: the three-row CSV gives income 4200.00, spending 91.00, saved 4109.00, Food 91.00, count 3; a bad amount `6.501` at row 4 refuses the ENTIRE CSV with the row number (no partial tracker); the output is an owner-scoped File/artifact linked to the task.

**Architecture:** New pure module `server/src/openmuse-finance/csv.ts` ported from OpenMuse's prior art (Task 0: read /Users/wuyongjun/trea/openmuse/.worktrees/v4-base tests/finance*.test.ts + its source — cite the rules: header date,description,amount,category; 1–5,000 rows; ≤500 KB; ISO date; max two decimals; positive=expense negative=income; no conversion). Task kind `finance`: the runner parses+calculates, writes the summary as a new File (via openmuse-files store's upload seam — one export, noted) linked via artifactIds; validation failure → task failed with row-number detail, NO artifact.

**Spec:** Contracts §7 Finance fixture; catalog T13; Issue #70.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base (OpenMuse worktree READ-ONLY for prior art). NO commits.
- Owned files: Create server/src/openmuse-finance/csv.ts, server/tests/openmuse-finance.test.ts; Modify server/src/openmuse-tasks/{routes.ts (accept kind finance with csv FileId input),runner.ts (finance path)}, server/tests/openmuse-{tasks,task-runner}.test.ts; openmuse-files store ONE upload/export seam (noted). NO app.ts/index.ts/migrations. Never touch openmuse-documents/openmuse-reviewed-actions (concurrent workers).

### Task 0

- [ ] Cite OpenMuse's finance prior art (file:line of the parser rules + the fixture numbers) from the OpenMuse worktree.

### Task 1: RED — tests

1. parse+calculate: the three-row fixture → exactly {income:"4200.00", spending:"91.00", saved:"4109.00", byCategory:{Food:"91.00"}, count:3} (string fixed-point per prior art);
2. bad 6.501 at row 4 → refusal naming row 4, zero output; wrong header → refusal; empty; >5,000 rows; >500 KB; non-ISO date; three-decimal any row → refusal;
3. runner finance path: happy → task succeeded + artifact File created (owner-scoped, linked in artifactIds) + evidence rows; validation failure → task failed with row detail + NO artifact (upload seam counts zero);
4. §9/foreign unchanged.

### Task 2: GREEN

- Implement per matrix; `bun test tests/openmuse-finance.test.ts tests/openmuse-tasks.test.ts tests/openmuse-task-runner.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: Task 0 citations, upload-seam reuse note, files + shasum, test tails, S30 live fixture deferred note. No commit.

## Failure handling

- If the prior art's exact output shape differs from the fixture strings, follow the prior art's semantics and record any divergence.
