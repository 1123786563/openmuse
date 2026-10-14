# K01 — Authorize a private computer stream: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-task ticket plan; one agent context, TDD. Predecessor I02 verified+integrated (openmuse-private provisioning present in worktree). O01 baseline stack script may exist (docs/openmuse-v4/o01-deployment-baseline.md) — reuse it for the live smoke if present.

**Goal:** The computer live-stream authorization provably binds the authenticated session to a Bot the actor may use — for private OpenMuse Bots that means the owner (or admin) only; a foreign stream URL returns 404, an expired/absent session 401, and a client disconnect closes the proxied stream. Existing authorization logic is extracted into a testable seam and covered by tests plus a live websocket smoke.

**Architecture:** The upgrade guard lives inline in server/src/index.ts (~line 4062-4096). Extract the decision — session actor → computerAccessCheck → gateway.locate — into `server/src/computer/stream-auth.ts` as `authorizeComputerStream(deps, request)` returning `{status, body}` decisions; index.ts calls it. No behavior change beyond testability unless a test exposes a gap (then fix minimally). Live smoke uses the O01 baseline script + a websocket client.

**Tech Stack:** Bun WebSocket client, Hono/Bun upgrade handling, bun:test.

**Spec:**
- Contracts §3 Computer control (viewing→… state machine is K03's; this ticket is stream AUTH only): /Users/wuyongjun/trea/openmuse/.worktrees/v4-base/docs/superpowers/plans/2026-10-12-openmuse-openbot-contracts-v4.md
- Catalog K01; Issue #22. Current code: server/src/index.ts stream upgrade block, server/src/agents/computer-access.ts, server/src/computer/stream-path.ts.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base (+ /tmp/openmuse-v4-baseline for the live smoke; docker ports 55432/18787 per O01; NEVER touch 5432/8787/55433). NO commits.
- Owned files: Create server/src/computer/stream-auth.ts, server/tests/stream-auth.test.ts, docs/openmuse-v4/k01-stream-auth-evidence.md; Modify server/src/index.ts (replace the inline guard with the extracted call — keep the diff minimal: the block from `const streamBotId =` through the 404 response becomes the extracted function's usage).
- Do NOT touch: app.ts, admin/, mobile-bff/, openmuse-template-store.ts, scripts/ (other tickets own them).
- The worktree carries uncommitted I02/I09/O01 checkpoints: never revert or reformat them.

### Task 1: RED — stream-auth decision tests

- [ ] **Step 1:** server/tests/stream-auth.test.ts (in-memory deps: resolveRequestActor fake, agentProfileStore with two profiles — private owner-A bot (template openmuse-private) and public bot; gateway.locate fake):
  1. non-websocket request on stream path → decision passes through (not stream) — the extractor returns null for non-upgrade;
  2. upgrade without session → 401 "Sign in first.";
  3. upgrade, signed-in user A, foreign private bot (owner B) → 404 "There is no such Bot.";
  4. upgrade, owner A on own private bot, gateway.locate ok → `{upstream}` decision (authorize);
  5. gateway.locate throws (unreachable/foreign host refused) → 502 with message;
  6. no computer configured → 503;
  7. admin on any bot → authorize.
- [ ] **Step 2:** `cd server && bun test tests/stream-auth.test.ts` → FAIL (module missing).

### Task 2: GREEN — extract + wire

- [ ] **Step 1:** Implement `server/src/computer/stream-auth.ts`: `export function createStreamAuthorizer(deps: { resolveRequestActor; agentProfileStore; computerGateway?; config: { computer: boolean } })` returning `authorize(request: Request): Promise<{ kind: "passthrough" } | { kind: "refuse"; status: number; message: string } | { kind: "proxy"; upstream: string; botId: string }>`. Move the existing logic verbatim (streamPathBotId, session guard, computerAccessCheck, gateway.locate + toStreamUrl). Export toStreamUrl too if it is currently private in index.ts (move it, keep index.ts import).
- [ ] **Step 2:** index.ts: replace the inline block with the authorizer call; behavior identical (refuse → same Response; proxy → same upgrade path). Keep `server.timeout` handling unchanged.
- [ ] **Step 3:** `bun test tests/stream-auth.test.ts` → PASS; `bun test tests/openmuse-bot.test.ts tests/mobile-bff.test.ts` still PASS; typecheck clean; biome clean on owned files.

### Task 3: Live smoke (if O01 baseline available)

- [ ] **Step 1:** `scripts/openmuse-v4-baseline.sh up` (or as-is in worktree); then from a bun one-liner websocket client: (a) connect to `ws://127.0.0.1:${PORT}/api/computers/<private-bot-id>/stream` with NO cookie → expect HTTP 401 handshake refusal; (b) with a valid session cookie for a foreign user → 404; (c) owner session → 101 upgrade (or 503 if no computer service is configured in baseline — record which; 503-with-valid-auth is acceptable evidence that auth ordering is correct: auth checks run BEFORE gateway locate only for 401/404; document the actual order from the extracted code).
- [ ] **Step 2:** Disconnect behavior: if a real computer is unavailable in baseline, verify close propagation at the unit level (authorizer returns proxy decision; the upgrade proxy close is Bun-runtime behavior) and RECORD that live close-propagation evidence is deferred to K02/K04's device-level flows (do not fake it).
- [ ] **Step 3:** `scripts/openmuse-v4-baseline.sh down` (leave machine clean).

### Task 4: Evidence + checkpoint

- [ ] Write docs/openmuse-v4/k01-stream-auth-evidence.md (test tails, smoke outputs, deferred items, UTC time); report changed files + shasum. No commit.

## Acceptance (Issue #22 / catalog K01)

Stream authorization binds session and private botId; foreign stream URL and expired session refuse; disconnect closes the stream (live close-propagation may be evidenced at K02/K04 if baseline lacks a real computer — record explicitly). Verified by Task 1 tests + Task 3 smoke.

## Failure handling

- If the inline block resists extraction (shared closures), extract the DECISION part only (401/404/503/authorize) and leave the upgrade mechanics in index.ts; record the boundary.
- Baseline script absent (O01 not done) → run unit tests only, mark Task 3 deferred with reason; do not block.
