# R01 — Establish a Reviewed action seam with a fake executor: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessor G01 verified+integrated. This is the approved prefactor: proposal/claim/receipt contract with a FAKE executor; NO Gmail/Calendar provider behavior (R02+/R05+ own those).

**Goal:** A fixture proposal is shown, denied, or atomically claimed: two simultaneous approvals yield exactly ONE fake-executor call; states follow contract §6 exactly (`awaiting_review → denied|expired|cancelled|executing`; `executing → succeeded|failed|outcome_unknown`); a repeated decision returns the settled record without re-execution; changed payloadHash/account/generation → 409 stale; receipts carry attemptId + request fingerprint + timestamps.

**Architecture:** New module `server/src/openmuse-reviewed-actions/`: `proposal.ts` (canonical payload serialization → payloadHash sha256; expiry 30 min from creation), `store.ts` (drizzle table `openmuse_reviewed_actions` + `openmuse_reviewed_attempts`; row seam injectable like F01/T01; CAS status transitions `WHERE status='awaiting_review'` etc.), `executor.ts` (fake executor interface `execute(proposal) → Promise<{outcome:"succeeded"|"failed"|"outcome_unknown", providerRef?, fingerprint}>` with a default fake used by tests and mounted in prod until R02 replaces it), `service.ts` (propose/decide/claim/reconcile orchestration), `routes.ts` (POST /api/mobile/openmuse-reviewed-actions proposal; GET list/:id; POST /:id/decision {approve|deny}; POST /:id/reconcile for outcome_unknown). Mount via the mobile-bff pattern (app.ts tail param + index.ts construction).

**Tech Stuff:** Hono, drizzle migration 00NN, zod, node:crypto, bun:test.

**Spec:**
- Contracts §6 Reviewed action contract (states, CAS, attempt fingerprint, fixed failure matrix rows: deny→zero calls; two simultaneous approve→one attempt; settled re-decision→stored record): /Users/wuyongjun/trea/openmuse/.worktrees/v4-base/docs/superpowers/plans/2026-10-12-openmuse-openbot-contracts-v4.md
- Catalog R01; Issue #49.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Create server/src/openmuse-reviewed-actions/{proposal,store,executor,service,routes}.ts, server/tests/openmuse-reviewed-actions.test.ts, drizzle migration 00NN (+meta, via DATABASE_URL=… db:generate — SQL verbatim in report; do NOT migrate); Modify server/src/app.ts (ONE tail param + conditional; ready.test.ts offset per convention), server/src/index.ts (import+arg+construction with the fake executor injected and a TODO-cited seam where R02 swaps in Gmail).
- Do NOT touch openmuse-connectors/* beyond imports, openmuse-mail/* (concurrent ticket owns it — if it has not landed yet, its files do not exist; just avoid the namespace), plugins/, computer/.
- Dispatch AFTER M01 completes (app.ts/index.ts serialization) — coordinator schedules.

### Task 1: RED — §6 state table tests

- [ ] **Step 1:** server/tests/openmuse-reviewed-actions.test.ts (fake rows + fake executor counting calls):
  1. propose → awaiting_review with expiresAt = +30min, payloadHash = sha256(canonical serialization) (assert exact hash for a fixed fixture payload), kind validated, ownerUserId from session, connectionGeneration/targetVersion/attachmentVersionIds persisted when present;
  2. deny → denied, ZERO executor calls;
  3. approve happy path → ONE executor call, attempt row {attemptId, fingerprint, decidedAt/attemptedAt/completedAt}, final succeeded + receipt (providerRef from fake);
  4. executor outcome failed → failed with error detail; outcome_unknown → outcome_unknown status and NO automatic retry (a second approve returns the settled outcome_unknown record, zero additional executor calls);
  5. TWO concurrent approves (Promise.all; rows fake with a CAS-honoring claim: only one flips awaiting_review→executing) → exactly one executor call, both callers receive the SAME settled record;
  6. repeated decision after settle (approve then deny; deny then approve) → the FIRST settled record, no executor call;
  7. expiry: clock past expiresAt → decision returns 409/expired (status flips expired), zero calls; creation-time expiry boundary exact;
  8. staleness: changed payloadHash (a second proposal with same target but different body), or decision carrying a stale hash/generation → 409, zero calls;
  9. cancel → cancelled from awaiting_review only;
  10. foreign user: list/:id/decision for another owner → 404;
  11. §9 hooks: disableOwner blocks propose+decide; enumerateOwner returns refs.
- [ ] **Step 2:** `bun test tests/openmuse-reviewed-actions.test.ts` → FAIL.

### Task 2: GREEN

- [ ] Implement per matrix; migration (tables: openmuse_reviewed_actions full §6 proposal columns + status; openmuse_reviewed_attempts {attemptId PK, actionId FK, fingerprint, providerRef?, startedAt, completedAt}); routes; wiring; ready.test.ts offset.
- [ ] `bun test tests/openmuse-reviewed-actions.test.ts tests/ready.test.ts tests/mobile-bff.test.ts` → PASS; typecheck + biome clean.

### Task 3: Checkpoint

- [ ] Report: migration SQL verbatim, changed files + shasum, test tails, the fake-executor seam citation for R02, F-MAIL-1 mapping note (unit CAS proof; live card is gate-level). No commit.

## Acceptance (Issue #49 / catalog R01)

Fixture proposal shown/denied/atomically claimed; two approvals one fake-executor call; status/receipt per §6. Verified by Task 1 state-table suite.

## Failure handling

- If the CAS cannot be expressed over the fake row seam faithfully, make the fake honor a `claimTransition(id, from, to)` primitive that the drizzle rows implement with a real UPDATE...WHERE — the TEST must not simulate what the store is supposed to prove.
