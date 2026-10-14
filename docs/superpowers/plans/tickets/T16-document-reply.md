# T16 — Send a document Task's reviewed reply: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessors T15+R04 verified+integrated.

**Goal:** After T15's fill, the document task prepares a reviewed reply: proposal binds reply threadId/replyToMessageId, accountEmail, connectionGeneration, and the EXACT filled attachment version (attachmentVersionIds); approval sends once with the receipt linked to the task (taskId on the attempt/receipt); denial retains the File without sending; uncertainty does not resend (no automatic retry); the task waits `waiting_review` until the decision and completes with the receipt.

**Architecture:** Composition over existing seams: T15's runner gains a post-fill phase — create a `gmail.send` proposal via openmuse-reviewed-actions' service (kind extended: reply-target fields per R03's binding + attachmentVersionIds carrying the derived version; account/generation read from the connectors' connection row via requireConnection seam exposure — imports only), park the task `waiting_review` (status exists; T12's waiting_review EVENT now has its producer — emit on park); a decision webhook is NOT invented: the runner's sweep polls the proposal's status (cheap single-row read) — on succeeded/failed the task completes with the receipt reference (evidence row); denied/expired → task failed with reason, File retained (no delete); outcome_unknown → task stays waiting_review with an uncertain marker (operator reconciliation is R04's; the task surfaces it, never retries).

**Spec:** Contracts §6/§7 (T16 catalog: proposal binds reply target/account generation/filled attachment; denial retains File; uncertainty no resend; receipt links Task); Issue #73.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-tasks/{runner.ts,store.ts (waiting_review touchpoint)}, server/tests/openmuse-task-runner.test.ts (+tasks test if creation input gains a replyTo), openmuse-reviewed-actions/service.ts ONLY for the proposal-creation export (one addition, noted). NO app.ts/index.ts/migrations. Never touch openmuse-activity/documents/computer (concurrent workers).

### Task 1: RED — tests

1. post-fill: proposal created with {threadId, replyToMessageId, accountEmail, generation, attachmentVersionIds=[derived]}; task waiting_review; T12 waiting_review notification emitted (producer lands here — assert);
2. approve → send once (executor fake), receipt ref on the task (evidence), task succeeded;
3. deny → task failed with reason, filled File row retained (no tombstone), zero sends;
4. expiry → same as deny with expired reason;
5. outcome_unknown → task stays waiting_review with uncertain marker, zero resends across sweeps (assert), operator reconcile via R04's route still works (integration fixture);
6. restart mid-waiting_review → proposal binding + wait persist; post-restart decision completes once.

### Task 2: GREEN

- Implement per matrix; `bun test tests/openmuse-task-runner.test.ts tests/openmuse-tasks.test.ts tests/openmuse-reviewed-actions.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: poll-vs-webhook choice (poll recorded), export addition note, files + shasum, test tails, S29 live reply flow deferred note. No commit.

## Failure handling

- If proposal creation needs fields the connection row lacks (accountEmail when never connected), the document flow fails visibly pre-proposal (409 from the seam) — surface, never fabricate.
