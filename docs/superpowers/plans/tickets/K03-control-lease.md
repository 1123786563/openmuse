# K03 — Claim and revoke a human-control lease: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessor K01 verified+integrated.

**Goal:** The human-control lease satisfies contract §3 exactly: viewing→requesting→controlling→released with refused/expired outcomes; the lease binds {userId, botId, streamId, leaseId, expiresAt}; input requires the active lease and a monotonic sequence; two concurrent claims have exactly one winner; logout/disconnect/Policy-refusal revokes; late input is 403/409 and NOT delivered; audit names actor, Bot, lease, decision.

**Architecture:** The machinery mostly exists: agent-computer/src/{control.ts,control-store.ts} (holder bot/human, requests waiting/taken/completed/cancelled/expired/interrupted with expiresAt) + server/src/computer/routes.ts (/control GET/POST request/take/release/cancel + input routes with staleness 409) + gateway audit events. Task 0 maps existing semantics to §3 with file:line evidence; Tasks 1-2 close the concrete gaps as RED tests first, implementing only what the matrix proves missing (candidates from coordinator scan: lease identity fields exposure {userId,streamId,leaseId,expiresAt}; logout-triggered revocation hook; late-input-after-revocation guarantee).

**Tech Stack:** bun:test on both sides (agent-computer/tests pattern for the state machine; server/tests fake-gateway pattern from K01's stream-auth work).

**Spec:**
- Contracts §3 Computer control: /Users/wuyongjun/trea/openmuse/.worktrees/v4-base/docs/superpowers/plans/2026-10-12-openmuse-openbot-contracts-v4.md
- Catalog K03; Issue #24. Prior art: agent-computer/src/control-store.ts (StoredControl), server/src/computer/routes.ts:353-520, gateway.ts:771-800.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: agent-computer/src/{control.ts,control-store.ts} (surgical), agent-computer/tests/<new test file>, server/src/computer/{routes.ts,stream-auth.ts only if input/lease guards live there}, server/tests/<new test files>. NO app.ts/index.ts edits. Do not touch: openmuse-* modules (concurrent tickets), plugins/, admin/.
- English comments per OpenBot convention.

### Task 0: Map existing to §3 (record; escalate if a gap needs architecture)

- [ ] For each §3 clause, cite file:line proving it exists OR mark GAP: (a) transition set incl. refused/expired; (b) lease binds userId+botId+streamId+leaseId+expiresAt; (c) monotonic input sequence + active-lease requirement; (d) concurrent claim single winner; (e) explicit release/expiry required for transfer; (f) logout/disconnect/policy-refusal revocation; (g) late input 403/409 undelivered; (h) audit actor/bot/lease/decision.

### Task 1: RED — §3 matrix tests

- [ ] **Step 1:** At the seam Task 0 identified (state machine in agent-computer tests + route-level in server tests), write the matrix:
  1. viewing→requesting→controlling→released happy path; each intermediate state observable;
  2. refused outcome (policy refusal injected) and expired outcome (clock past expiresAt) both land, lease released;
  3. two concurrent takes (Promise.all, interleaved fake) → exactly one controlling winner, loser refused/expired per existing semantics;
  4. input WITHOUT active lease → 409; input with stale sequence (older than last) → 409/403, NOT delivered (fake downstream counts deliveries);
  5. revoke (disconnect/logout/policy) then input → 403/409, zero delivery, audit row names actor+bot+lease;
  6. transfer requires release/expiry: second user's take while first holds → refused (not silent takeover).
- [ ] **Step 2:** Run → FAIL only on GAP clauses (passing tests for existing behavior are kept as regression pins — label them).

### Task 2: GREEN — close the gaps

- [ ] Implement ONLY the GAPs Task 0/1 exposed, surgical: e.g. lease DTO exposure {userId,botId,streamId,leaseId,expiresAt}; a `revokeControl(botId, {reason})` path wired where disconnect/logout/policy already transition state; late-input guarantee assertions. Keep drizzle/migrations untouched (control state is file-based in agent-computer).
- [ ] Both suites green: `cd agent-computer && bun test` + `cd server && bun test tests/<your new files> tests/stream-auth.test.ts`.

### Task 3: Checkpoint

- [ ] Report: the Task 0 table (clause → file:line | GAP→fix), changed files + shasum, test tails, F-CONTROL-1 mapping note (gate-level live card; unit matrix is this ticket's proof). No commit.

## Acceptance (Issue #24 / catalog K03)

§3 transitions hold; competing claim one winner; stale sequence or revoked lease delivers zero input; Policy audit names actor/lease. Verified by Task 1 matrix (existing clauses pinned, gaps RED→GREEN).

## Failure handling

- If a GAP requires cross-process redesign (e.g. lease identity lives in the computer service but streamId lives in the server), STOP and report the boundary question — do not force it.
