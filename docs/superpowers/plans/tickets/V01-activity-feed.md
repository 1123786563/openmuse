# V01 — Show Policy and Reviewed action items in Activity: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessors K03+R03+R04+R06+R08 verified+integrated.

**Goal:** §8 Activity feed for policy approvals + reviewed actions: `GET /api/mobile/openmuse-activity?cursor&limit` returns items `{id,type:"policy_approval"|"reviewed_action",sourceId,createdAt,status,title,detail,allowedActions[],readAt?}` sorted desc (createdAt,id), default 25/max 100, owner-bound cursor (invalid/foreign 400); a decision routed through the feed re-reads its source before acting (stale → current status returned); the WRONG decision type returns 409 leaving both records unchanged; `POST /:id/decision {type, action}` dispatches to the owning module.

**Architecture:** New module `server/src/openmuse-activity/`: aggregator over OpenBot's approvals store (policy items — Task 0: cite the approvals seam used by mobile-bff activity.ts) and openmuse-reviewed-actions (list awaiting/outcome rows via its store export — one addition allowed); mapping to §8 DTO with per-type allowedActions (policy: its own approve/deny only; reviewed: approve/deny only while awaiting_review; outcome_unknown: view/reconcile marker for operators — non-owning users never see reconcile); decision dispatch calls the OWNING module's existing decision path (never a second implementation); feed-level read marking is V02's (task notifications) — this ticket adds the §9-consistent row shape with readAt nullable (no mark route yet — record). Mount per siblings (app.ts tail param; ready.test.ts offset).

**Spec:** Contracts §8; catalog V01; Issue #77. S22 fixture is the live card.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Create server/src/openmuse-activity/{feed.ts,routes.ts}, server/tests/openmuse-activity.test.ts; Modify server/src/app.ts (ONE tail param + mount + ready.test.ts offset), server/src/index.ts (import+arg); ONE export additions from openmuse-reviewed-actions store (list-for-owner shape, noted) and the approvals seam per Task 0. Never touch openmuse-tasks/documents/deletion (concurrent workers).

### Task 0

- [ ] Cite the policy approvals seam (how mobile-bff's activity.ts reads approvals today — store, DTO, decision verbs) and openmuse-reviewed-actions' owner-list capability.

### Task 1: RED — tests

1. mixed feed: one policy approval + one awaiting reviewed action → ordered desc, §8 DTO, allowedActions per type (policy approve/deny; reviewed approve/deny; outcome_unknown → view only for owner, reconcile marker only for admin actor);
2. wrong decision type (policy action on a reviewed item and vice versa) → 409, BOTH source records unchanged (assert stores);
3. stale re-read: reviewed item expires while the feed is open → decision returns 409/expired current status (source re-read before dispatch);
4. cursor discipline: default 25/101-clamp/abc-400/foreign-400; desc order with id tiebreak;
5. decision dispatch happy: approve on reviewed item routes to the reviewed module (its executor called once — fake); policy approve routes to the approvals seam (fake counts);
6. §9 hooks.

### Task 2: GREEN

- Implement + wiring; `bun test tests/openmuse-activity.test.ts tests/openmuse-reviewed-actions.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: Task 0 citations, files + shasum, test tails, S22 deferred note. No commit.

## Failure handling

- If the approvals seam cannot be consumed read-only, STOP and ask (never modify approvals internals here).
