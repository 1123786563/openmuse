# G04 — Refresh an expired Google grant: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessors G01+G03 verified+integrated.

**Goal:** A connection whose provider refresh fails becomes `refresh_required` and is visible as such; ONE successful refresh restores provider calls; a credential identity change increments `generation` (old-generation reviewed actions become stale — assert via the requireConnection seam exposing generation); a failed refresh NEVER reaches provider calls (409 refresh_required persists until refresh).

**Architecture:** Extend `openmuse-connectors`: a refresh status seam — provider calls through the connectors client catch the vendor's auth-expired/refresh-failed response class (Task 0: define the vendor error shape in the fake per OpenConnector docs — an expired-credential error class; record) → mark the connection row `refresh_required`; an explicit `POST /api/mobile/openmuse-google/:provider/refresh` (requireUser) triggers the vendor token refresh action (placeholder id recorded), on success → status connected (generation unchanged UNLESS the refreshed identity differs — compare accountEmail), on failure → stays refresh_required with lastError sanitized; requireConnection gains generation exposure `{status, generation}` so callers (R03+) can bind.

**Spec:** Contracts §4 Connection (status refresh_required; generation increments on reconnect or account change; refresh-required refuses provider calls); catalog G04; Issue #29.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-connectors/{client.ts,google-oauth.ts,store.ts,routes.ts}, server/tests/openmuse-google-oauth.test.ts; migration ONLY if a status/generation column change is needed (G01's tables likely suffice — record). NO app.ts/index.ts. Never touch openmuse-mail/calendar (concurrent workers).

### Task 1: RED — tests

1. provider call hits vendor auth-expired error → connection row flips refresh_required; subsequent provider action attempts → 409 refresh_required WITHOUT dialing (assert fake dial counts);
2. POST refresh success → connected again; provider calls resume; generation UNCHANGED (same identity);
3. refresh success with identity change (fake returns different accountEmail) → generation increments (2); an action proposal bound to generation 1 → 409 stale via the seam;
4. refresh failure → stays refresh_required, sanitized lastError (no tokens), retryable;
5. refresh on a disconnected connection → 409 (must reconnect, not refresh);
6. foreign owner → 404; §9 disabled owner 403;
7. status route exposes {status, generation, lastError?} per provider.

### Task 2: GREEN

- Implement per matrix; `bun test tests/openmuse-google-oauth.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: vendor error-shape definition (fake contract, recorded for O02), migration SQL if any, files + shasum, test tails, S16 live deferred note. No commit.

## Failure handling

- If OpenConnector's real refresh action id/shape is unverifiable now, placeholder discipline as M01 — record.
