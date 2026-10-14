# G02 — Handle expired, repeated and abandoned Gmail callbacks: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessor G01 verified+integrated (openmuse-connectors module + migration 0079 in place).

**Goal:** The callback fault matrix from contract §4/G02: an expired state fails (no connection); a callback replayed after completion returns the SAME recorded result without a second exchange/alias/generation; an abandoned flow (state never used, TTL passed) is swept; a callback arriving in another session fails; a nonce/return-URI mismatch refuses.

**Architecture:** Extend `server/src/openmuse-connectors/`: (1) record the completed-callback outcome on the pending row (`consumedAt`, `outcome`, `connectionId`) so a replay re-reads and re-answers the recorded result; (2) an expiry sweep that deletes/mark-expires pending rows past TTL (piggyback on start + a sweep function callable from the work loop — mirror how G01 wired routes; no new app.ts mounts); (3) bind `returnUri` + a `nonce` into the pending row at start (nonce echoed via the authorizationUrl's `state`? no — the vendor owns state; instead OpenBot appends its own `nonce` query to the authorizationUrl it RETURNS to the client and requires it back on callback) — minimal compliant reading: pending row stores returnUri; callback with a mismatched/absent nonce (when one was issued) refuses.

**Tech Stack:** same as G01; bun:test fake dial; injected clock.

**Spec:**
- Contracts §4 OAuth state (one-use, 10-min TTL, replay of completed callback returns stored result; replay in another session fails): /Users/wuyongjun/trea/openmuse/.worktrees/v4-base/docs/superpowers/plans/2026-10-12-openmuse-openbot-contracts-v4.md
- Catalog G02; Issue #27. G01 code: server/src/openmuse-connectors/*.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-connectors/{google-oauth.ts,store.ts,routes.ts}, server/tests/openmuse-google-oauth.test.ts; migration ONLY if the pending-row outcome columns need one (expected: ADD outcome/connectionId/consumedAt columns → generate 00NN via DATABASE_URL=… db:generate; report SQL).
- No app.ts/index.ts edits (routes/mounts unchanged).
- Injected clock everywhere TTL is judged (G01 may already inject — reuse its seam).

### Task 1: RED — fault-matrix tests

- [ ] **Step 1:** extend server/tests/openmuse-google-oauth.test.ts:
  1. expired pending (clock +11 min) callback → 410, vendor exchange NOT called, no connection (G01 may cover; keep/align);
  2. REPLAY: successful callback → 302 + connection row; SAME state+code again → 302 with the SAME recorded outcome and NO second vendor /oauth/callback call (fake dial counts), connection generation unchanged (still 1), no duplicate row;
  3. replay in a different session (other user's cookie) → 403 (not the recorded result);
  4. abandoned: start → never call callback → sweep after TTL → pending row gone/expired; a late callback for it → 410;
  5. sweep is idempotent (second sweep no-ops);
  6. nonce: start with `nonce` in the authorizationUrl OpenBot returns (query param `openmuse_nonce`); callback WITHOUT the nonce (when issued) → 400; WITH it → proceeds; wrong value → 400;
  7. return-URI mismatch: pending stored returnUri X; callback succeeds → browser redirected to X exactly (already true in G01 — re-assert).
- [ ] **Step 2:** `bun test tests/openmuse-google-oauth.test.ts` → new cases FAIL.

### Task 2: GREEN

- [ ] **Step 1:** store: pending-row outcome columns (migration if needed); `recordOutcome(state, {connectionId})`; `sweepExpired(now)`.
- [ ] **Step 2:** google-oauth.ts: replay path re-reads outcome; nonce issuance/validation; sweep function.
- [ ] **Step 3:** routes.ts: callback handles nonce; expose sweep via the module's returned object (no new HTTP route); call sweep lazily on start (cheap) — document that the work-loop scheduling of the sweep is a follow-up wiring if needed (O02 env), or wire beside G01's existing index.ts construction IF a one-line call suffices without new tail params.
- [ ] **Step 4:** `bun test tests/openmuse-google-oauth.test.ts tests/ready.test.ts` → PASS; typecheck + biome clean.

### Task 3: Checkpoint

- [ ] Report: migration SQL (if any), changed files + shasum, test tails, F-OAUTH-1/F-OAUTH-2 mapping (which test covers which fault card — both are gate-level live but the matrix here is the unit proof). No commit.

## Acceptance (Issue #27 / catalog G02)

Expired state and signed-out callback fail; completed callback replay returns stored result without duplicate alias/generation; nonce/return URI mismatch refuses. Verified by Task 1 matrix.

## Failure handling

- If G01's pending table lacks a clean way to store outcomes, add columns via migration (report SQL verbatim) rather than a side table.
