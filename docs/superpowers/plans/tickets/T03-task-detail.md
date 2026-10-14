# T03 — Show Task steps and evidence: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD for pure seams. Predecessor T02 verified+integrated (server create/list/detail + runner updating steps/evidence).

**Goal:** The client lists its owner's Tasks and opens one Task's detail: steps render by stable ID with status chips (pending/running/succeeded/failed/waiting), evidence renders typed (mail/file/web/user) with its payload summary, a failed step shows its error, artifacts list their IDs, and reload re-fetches without duplicating anything.

**Architecture:** Client-only over the existing endpoints: GET /api/mobile/openmuse-tasks (list, page) and GET /:id (detail). New `src/openbot/tasks.tsx` (TasksScreen + TaskDetail) + pure `src/openbot/task-view.ts` (normalization: steps/evidence sorting by stable IDs, status chip mapping, error extraction, zh-CN labels) unit-tested in node:test. App.tsx adds a Tasks entry point reachable from the OpenBot app shell (a simple header button — full navigation structure is later tickets' concern).

**Tech Stack:** react-native components already used by src/openbot/*, zod schemas in types.ts, node:test.

**Spec:**
- Contracts §7 (steps/evidence/run-events shapes): /Users/wuyongjun/trea/openmuse/.worktrees/v4-base/docs/superpowers/plans/2026-10-12-openmuse-openbot-contracts-v4.md
- Catalog T03; Issue #60. Server endpoints from T01/T02 (no server changes in this ticket).

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/openmuse/.worktrees/v4-base. NO commits.
- Owned files: Create apps/mobile/src/openbot/{task-view.ts,tasks.tsx}, apps/mobile/test/openbot-task-view.test.ts; Modify apps/mobile/src/openbot/{api.ts (add fetchTasks/fetchTaskDetail),types.ts (task schemas)}, apps/mobile/App.tsx (Tasks entry in the OpenBot app only).
- Do NOT touch: chat.tsx/chat-state.ts, config.ts, auth/client/gate/private-state.
- zh-CN copy via module-internal map; English comments.

### Task 1: RED — task-view tests

- [ ] **Step 1:** apps/mobile/test/openbot-task-view.test.ts:
  1. steps sort by stable id, map to status chips {pending,running,succeeded,failed,waiting} with zh-CN labels; failed step exposes errorText (≤200 chars);
  2. evidence typing: kinds mail/file/web/user map to typed rows with summary extraction (mail: subject/from if present; file: name; web: url/title; user: text ≤80); unknown kind → neutral "未知类型" row (not fabricated success);
  3. artifacts render id list;
  4. reload dedupe: normalizeTaskDetail called twice on equal payloads yields equal view models (no id-keyed duplication; keys are stable ids);
  5. empty task (no steps) renders an empty state label;
  6. api tests: fetchTasks GETs /api/mobile/openmuse-tasks with cursor passthrough; fetchTaskDetail GETs /:id; 404 → not_found surfaced.
- [ ] **Step 2:** Run new tests → FAIL.

### Task 2: GREEN

- [ ] **Step 1:** task-view.ts per matrix; types.ts: zod schemas for task list/detail (mirror server DTO from T01: id/kind/status/attempts/steps/evidence/artifactIds/createdAt/updatedAt; steps {id,status,result?,error?,evidenceIds?}; evidence {id,kind,payload}).
- [ ] **Step 2:** api.ts: fetchTasks/fetchTaskDetail; tasks.tsx: TasksScreen (list + open detail + pull-to-refresh semantics via a refresh button), TaskDetail (steps/evidence/artifacts rendering, error rows); App.tsx: Tasks button in the OpenBot app header toggling the screen (minimal state).
- [ ] **Step 3:** `pnpm test && pnpm --dir apps/mobile typecheck && pnpm lint` green; `pnpm build:web` exports (record tail).

### Task 3: Checkpoint

- [ ] Report: changed files + shasum, test tails, build:web tail, statement that live task-detail evidence (S28 web row) is deferred. No commit.

## Acceptance (Issue #60 / catalog T03)

Step/run/evidence kinds from §7 render by stable IDs; failed step has error; reload does not duplicate (view-model equality test + fetch-based reload). Verified by Task 1 tests + typecheck + build.

## Failure handling

- If the server DTO lacks a field the §7 view needs (e.g. step error text), render what exists and record the gap for T06/T08 rather than inventing data.
