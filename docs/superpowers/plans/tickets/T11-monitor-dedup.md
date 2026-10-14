# T11 — Deduplicate and back off Monitor observations: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessors T10+T07 verified+integrated.

**Goal:** §7 observation semantics: identity = `sha256(monitorId + normalizedSource + normalizedValue)` — the SAME observation emits ONE item even across restarts (no second evidence row/notification-slot); a NEW match emits one; failure backoff delays the next check by 15/30/60 minutes capped at 6 hours, resetting on success; the cursor is the last committed observation id/time.

**Architecture:** Extend `openmuse-tasks` monitor path: (1) normalization seam `normalizeObservation(condition, raw)` (source trimmed/lowercased URL-or-text normal form; value canonical string for change/contains; price as fixed 2-decimal string — rules recorded); (2) observation identity stored on the task row (migration 00NN: `last_observation_hash` + `last_observation_at` — or jsonb; choose, record); on a check, equal hash → NO new evidence row and NO match signal (the check still advances nextCheckAt normally); different hash → new evidence row + hash cursor updated; (3) failure backoff: consecutive-failure counter (jsonb on the condition or a column) → nextCheckAt += [15,30,60,...cap 360] min sequence, reset to interval on success. T12 owns the notification emission — here the evidence row + a `matched` boolean on the check result are the seam (record).

**Spec:** Contracts §7 Monitor; catalog T11; Issue #68. S35 fixture: repeat observation after restart → no second item; three failures → 15/30/60 delays, reset after success.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-tasks/{store.ts,routes.ts,runner.ts}, server/tests/openmuse-{tasks,task-runner}.test.ts; migration 00NN (SQL verbatim). NO app.ts/index.ts. Never touch openmuse-reviewed-actions/openmuse-files (concurrent workers).

### Task 1: RED — tests (injected clock)

1. normalization: URL source trailing-slash/case variants collapse; value canonicalization per kind (change → trimmed string; contains → bool of match; price_below → "12.34");
2. identity: same (monitorId, source, value) → same hash (fixture vectors); any component differs → different hash;
3. dedup: check returns same observation as last committed → ZERO new evidence rows, matched=false, nextCheckAt advances by interval (not backoff);
4. new observation → one evidence row, hash+time cursor updated, matched=true on the check result;
5. restart (store re-instantiation): repeated observation still deduped (cursor persisted);
6. backoff: three consecutive check failures (injected failing checkMonitor) → next delays 15/30/60 min (clock-asserted); a success resets to the configured interval; cap at 6h for long failure runs (fixture ≥8 failures);
7. §9/foreign unchanged.

### Task 2: GREEN

- Implement per matrix (storage decision recorded); migration; `bun test tests/openmuse-tasks.test.ts tests/openmuse-task-runner.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: storage decision + normalization rules, migration SQL, files + shasum, test tails, S32/S35 deferred notes. No commit.

## Failure handling

- If T10's checkMonitor seam shape differs, extend it minimally and record.
