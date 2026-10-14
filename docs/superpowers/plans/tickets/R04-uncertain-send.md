# R04 — Reconcile an uncertain Gmail send: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessor R02 verified+integrated (outcome_unknown exists at the seam).

**Goal:** §6 uncertain-outcome lifecycle: a provider timeout AFTER submission acceptance → outcome_unknown carrying attemptId + request fingerprint; ZERO automatic retry (no queue replay — assert no re-offer); an authorized operator records reconciliation `confirmed_succeeded | confirmed_not_sent | unresolved` with evidence + reviewer; only confirmed_not_sent permits a FRESH proposal (never reuse the claimed attempt); unresolved keeps the warning.

**Architecture:** Extend `openmuse-reviewed-actions`: (1) executor timeout semantics — dial timeout AFTER the request was sent maps to outcome_unknown with the attempt fingerprint (Task 0: audit how R02's executor classifies timeouts vs rejections; ensure the ambiguous case is distinct); (2) `POST /:id/reconcile {outcome, evidence, reviewer}` — operator-only (requireAdmin; 403 for user role), transitions outcome_unknown → succeeded(fresh receipt note)/failed(confirmed_not_sent)/stays-with-warning(unresolved), evidence recorded (≤2000 chars, sanitized); (3) re-proposal gate: a new proposal for the same logical send is allowed ONLY when the prior action reached confirmed_not_sent (service-level check; 409 otherwise with reason); (4) routes expose the reconciliation state for the Activity/UI (V01 consumer).

**Spec:** Contracts §6 (uncertain never auto-retried; human reconciliation records; only confirmed-not-sent creates fresh); catalog R04; Issue #52. F-MAIL-2 is the live card.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-reviewed-actions/{gmail-send-executor.ts,service.ts,routes.ts}, server/tests/openmuse-reviewed-actions.test.ts. NO migrations, NO app.ts/index.ts. Never touch openmuse-tasks (concurrent worker).

### Task 1: RED — tests

1. timeout-after-acceptance (fake dial: send accepted then response times out — model via a hanging promise the executor aborts) → outcome_unknown; attempt row carries fingerprint + timestamps; NO queue offer ever (fake queue counts zero); second decision returns settled outcome_unknown;
2. reconcile confirmed_succeeded → succeeded + receipt note + evidence + reviewer recorded;
3. reconcile confirmed_not_sent → failed + evidence; a FRESH proposal for the same target is accepted; its approval executes once (new attempt);
4. reconcile unresolved → stays outcome_unknown with warning + evidence appended;
5. reconcile by non-admin role → 403; reconcile on a non-uncertain action → 409;
6. re-proposal gate: fresh proposal while prior is outcome_unknown/unresolved/succeeded → 409 with reason (only confirmed_not_sent passes);
7. evidence sanitization (token-shaped strings stripped per G06's pattern).

### Task 2: GREEN

- Implement per matrix (Task 0 audit cited); `bun test tests/openmuse-reviewed-actions.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: Task 0 timeout-classification audit, files + shasum, test tails, F-MAIL-2/S21 live notes deferred. No commit.

## Failure handling

- If operator identity (reviewer) cannot come from the session actor, take it from the body and record the trust boundary explicitly.
