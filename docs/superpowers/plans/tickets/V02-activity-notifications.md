# V02 — Show Task notifications in Activity: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessors V01+T12 verified+integrated.

**Goal:** task/monitor notifications join the ordered Activity feed as `task_notification` items with their own allowedActions (`mark_read` ONLY); marking read changes ONLY that item (review/policy rows untouched — asserted); foreign user cannot read/mark; the merged feed keeps §8 ordering + cursor.

**Architecture:** Extend `openmuse-activity`: feed source union gains openmuse-notifications' owner list (import; one export addition allowed); DTO mapping {type:"task_notification", sourceId: notification id, status: read/unread, allowedActions:["mark_read"]}; routes gain `POST /:id/read` dispatching to the notifications store's mark (never a second implementation); mixed-feed ordering/cursor re-asserted across all three types.

**Spec:** Contracts §8 (task notification allows mark_read only; marking read never changes review/policy state); catalog V02; Issue #78.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-activity/{feed.ts,routes.ts}, server/tests/openmuse-activity.test.ts (+openmuse-notifications.test.ts only if an export test is needed). NO app.ts/index.ts/migrations. Import-only reuse of openmuse-notifications. Never touch openmuse-tasks/documents/computer (concurrent workers).

### Task 1: RED — tests

1. merged feed: policy + reviewed + task notification fixture → one ordered desc feed, cursor continuity across the union, default/clamps/400s re-asserted;
2. task_notification rows: allowedActions exactly ["mark_read"]; unread → read via POST /:id/read; repeat idempotent;
3. isolation: marking read leaves the reviewed action's status AND the policy row unchanged (assert both stores); a reviewed-decision attempt on a task_notification id → 409 wrong-type (V01 matrix extended);
4. foreign user: feed excludes; read on foreign id → 404;
5. §9 unchanged.

### Task 2: GREEN

- Implement per matrix; `bun test tests/openmuse-activity.test.ts tests/openmuse-notifications.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: files + shasum, test tails, S22/S37 deferred notes. No commit.

## Failure handling

- Follow V01's dispatch pattern exactly.
