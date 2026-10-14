# T08 — Answer a Task waiting for input: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessors T03+T07 verified+integrated.

**Goal:** §7 human wait: a Task enters `waiting_input` with a wait record `{waitId,taskId,kind:"input",question,fields?,createdAt,answeredAt?}`; the owner answers with exact waitId + typed fields; the FIRST valid answer atomically consumes it (task resumes); a repeat answer returns the stored result without advancing twice; malformed answer → 400 leaving the wait open; foreign/invalid waitId → 404.

**Architecture:** Extend `openmuse-tasks`: store `openWait`/`answerWait` (wait state on the task row — jsonb `wait` column via migration 00NN, or a dedicated table if the row seam prefers; choose + record), runner gains a `wait-for-input` step outcome (runTurn may return {kind:"waiting_input", question, fields} — model the seam: if the current runTurn cannot express it, add an injectable `inputWaitOf(turnResult)` classifier and a test double; the real producer lands with C07/T15's document flow — record honestly), routes `POST /:id/wait/:waitId/answer {values}`.

**Spec:** Contracts §7 Human wait (exact waitId + schema; first valid answer consumes atomically; repeat returns stored result; malformed 400 leaves open); catalog T08; Issue #65.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-tasks/{store.ts,routes.ts,runner.ts}, server/tests/openmuse-tasks.test.ts (+runner test if touched); migration 00NN if a column/table is chosen (SQL verbatim). NO app.ts/index.ts.

### Task 1: RED — tests

1. wait opens: task → waiting_input with wait record; waitId unique per task;
2. first valid answer (schema match per fields definition — string/boolean minimal types) → consumed atomically (answeredAt set; CAS), task returns to queued (resume path re-offers via the injected queue seam exactly once);
3. repeat answer same waitId → stored result returned, NO second consume/re-offer;
4. malformed values (wrong type/missing field/unknown field) → 400, wait stays open (answeredAt null);
5. foreign owner → 404; answered wait from another actor → 404;
6. restart durability: store re-instantiation preserves open waits;
7. §9: disabled owner 403 on answer.

### Task 2: GREEN

- Implement per matrix (decision recorded); `bun test tests/openmuse-tasks.test.ts tests/openmuse-task-runner.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: storage decision, migration SQL if any, files + shasum, test tails, S29/S34 live notes deferred. No commit.

## Failure handling

- If wiring a real wait producer exceeds this ticket (runTurn cannot express it), ship the wait store/routes with the classifier seam + test doubles and RECORD the producer's owner (T15/C07) — never fake a producer.
