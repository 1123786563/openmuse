# T15 — Fill a document Task after an input wait: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessors T08+F06+T14 verified+integrated.

**Goal:** §7 document flow (T16's reply is next): create a document Task bound to an imported PDF File; the task requests missing field values via a T08 input wait (schema from F05's inspection: required text/checkbox fields); the owner's answer fills ONE copy (F06 fill — source unchanged); restart preserves the wait and the artifact version.

**Architecture:** Extend `openmuse-tasks` kind `document`: creation input {fileId, versionId} validated via the files store (owner check, one export reuse); the runner inspects (F05 import), computes required fields, opens a T08 wait {question with field list, fields schema}, and parks `waiting_input`; the wait-answer path (T08's resume hook) fills via F06's validateFill+applyFill with the answered values, appends the derived version id to artifactIds + evidence, and completes succeeded (missing/invalid values → the wait stays open per T08's 400 semantics — never a partial fill).

**Spec:** Contracts §7 (document task requests missing values; answer fills one copy; restart preserves wait and artifact); catalog T15; Issue #72.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-tasks/{store.ts,routes.ts,runner.ts}, server/tests/openmuse-{tasks,task-runner}.test.ts; import-only reuse of openmuse-documents (inspect/fill — one export additions allowed, noted) and openmuse-files (getOwnedFile — existing). NO app.ts/index.ts/migrations. Never touch openmuse-activity/deletion (concurrent workers).

### Task 1: RED — tests

1. creation: {fileId, versionId} owner-validated (foreign 404, tombstoned 404); kind document rejects csvFileId-style prompt carrying (T13's finance rule re-asserted inverse);
2. runner: inspect → required fields (P-1-like fixture: person.name text + consent checkbox) → wait opens with schema; task waiting_input; NO fill before answer (fill seam counts zero);
3. answer valid → ONE fill call with exactly the answered values; derived version appended to artifactIds + evidence; task succeeded; source file row untouched (sha re-read);
4. answer invalid (unknown field/wrong type) → 400, wait stays open, zero fills;
5. restart: store re-instantiation mid-wait → wait persists (T08 durability re-asserted for document kind); post-restart answer completes the flow once;
6. §9/foreign unchanged.

### Task 2: GREEN

- Implement per matrix; `bun test tests/openmuse-tasks.test.ts tests/openmuse-task-runner.test.ts tests/openmuse-documents.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: export reuses noted, files + shasum, test tails, S29 live fixture deferred note. No commit.

## Failure handling

- If F06's fill seam isn't exported for reuse, add the export (noted) — never duplicate fill logic.
