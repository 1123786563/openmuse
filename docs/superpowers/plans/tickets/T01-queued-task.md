# T01 — Create and list a queued Task: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessor I03 verified+integrated. NO runner in this ticket (T02 owns execution).

**Goal:** An owner can create one agent-kind Task scoped to their private OpenMuse Bot with `queued` state and a stable ID (idempotent by key), list their tasks with contract §7 fields, and a foreign Task ID returns 404. No execution, no lease, no worker.

**Architecture:** New module `server/src/openmuse-tasks/`: drizzle table `openmuse_tasks` (id, ownerUserId, botId, kind, status, attempts default 1, idempotencyKey unique per owner+key, createdAt, updatedAt, steps jsonb default [], evidence jsonb default [], artifactIds jsonb default []) — migration via db:generate. Store + routes `POST /api/mobile/openmuse-tasks` and `GET /api/mobile/openmuse-tasks` (+ `GET /:id`) through the mobile-bff assembly (mirror I02/F01 pattern). Status enum per contract §7; creation always `queued`.

**Tech Stack:** Hono, drizzle, zod, bun:test.

**Spec:**
- Contracts §7 Task minimum + control transitions (creation/listing only here): /Users/wuyongjun/trea/openmuse/.worktrees/v4-base/docs/superpowers/plans/2026-10-12-openmuse-openbot-contracts-v4.md
- Catalog T01; Issue #57. §9 lifecycle hook: disableOwner/enumerateOwner like F01.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Create server/src/openmuse-tasks/{store.ts,routes.ts}, server/tests/openmuse-tasks.test.ts, generated migration (+meta); Modify server/src/mobile-bff/routes.ts (mount only; coordinate with F01's mount if both land — keep hunks separate), server/src/index.ts only per the I02 mirror pattern (import + arg; ask if more).
- Do NOT touch: app.ts, computer/, admin/, openmuse-files (parallel ticket), K01 files.
- kinds: agent|document|monitor|finance|plan (validated); this ticket's tests use `agent` only.

### Task 1: RED — tests

- [ ] server/tests/openmuse-tasks.test.ts:
  1. POST {kind:"agent", prompt/title…} with botId = owner's private bot → 201 {id, kind:"agent", status:"queued", attempts:1, steps:[], evidence:[], artifactIds:[], createdAt, updatedAt};
  2. same Idempotency-Key → same id, no second row;
  3. botId not owned by actor / not an openmuse-private bot → 404;
  4. invalid kind → 400; empty prompt → 400;
  5. GET list → owner's tasks only (two-actor check), newest first, page default 25/max 100 cursor;
  6. GET /:id foreign → 404; own → full record;
  7. restart durability via store re-instantiation over same rows;
  8. §9: disableOwner blocks create+list; enumerateOwner returns {kind:"openmuse-task", id}.
- Run → FAIL.

### Task 2: GREEN

- Implement store (drizzle; steps/evidence/artifactIds jsonb columns typed via $type<...> with contract §7 shapes), routes (zod: kind enum, title/prompt min 1, botId string), mount, migration (SQL verbatim in report).
- `bun test tests/openmuse-tasks.test.ts tests/mobile-bff.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report as usual (Task 0 not needed; record any deviations). No commit.

## Acceptance (Issue #57 / catalog T01)

UI creates one owner-scoped agent Task with queued state and stable ID; repeated idempotency key returns same Task; foreign ID 404; no runner introduced. (Client UI wiring is minimal here — the route contract is the deliverable; the client Task screen belongs to later tickets consuming T03.)

## Failure handling

- If mobile-bff/routes.ts conflicts textually with F01's parallel mount (both editing deps), rebase your hunks minimally and note it; if a genuine merge conflict arises, STOP and ask.
