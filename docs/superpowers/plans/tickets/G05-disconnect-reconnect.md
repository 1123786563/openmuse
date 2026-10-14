# G05 — Disconnect and reconnect Google: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessors G01+G03 (+G04's generation semantics) verified+integrated.

**Goal:** Disconnect blocks provider calls BEFORE reaching OpenConnector (409 disconnected — dial never called); reconnect creates a NEW generation; an action bound to an old generation remains stale (409 via the seam); disconnect is idempotent; both providers independently disconnectable.

**Architecture:** Extend `openmuse-connectors`: `POST /api/mobile/openmuse-google/:provider/disconnect` (requireUser) — vendor connection deletion (deleteConnection by alias, best-effort with the adapter's established tolerance for 404-on-delete), local row → status disconnected + generation preserved (the NEXT connect increments); connect-when-disconnected goes through the normal G01 flow and lands generation = old+1 (assert the increment across a disconnect→reconnect cycle); requireConnection refuses disconnected with the stable 409.

**Spec:** Contracts §4 Connection (generation increments on reconnect; disconnected refuses before OpenConnector); catalog G05; Issue #30.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-connectors/{client.ts,google-oauth.ts,routes.ts,store.ts}, server/tests/openmuse-google-oauth.test.ts; migration ONLY if needed (record). NO app.ts/index.ts. Never touch openmuse-personal (concurrent worker).

### Task 1: RED — tests

1. disconnect: vendor deleteConnection called with the alias (tolerant to vendor 404); local row disconnected; subsequent provider action → 409 disconnected, dial NEVER called (counts);
2. idempotent second disconnect → same state, vendor delete at most once (record the chosen semantics);
3. reconnect after disconnect → generation = previous+1 (fixture: connect(1) → disconnect → connect = 2); generation-1-bound proposal → 409 stale;
4. per-provider independence: disconnecting gmail leaves gcalendar connected and callable;
5. foreign owner 404; §9 disabled owner 403; §9 enumerate includes disconnected rows (cleanup must still find their aliases).

### Task 2: GREEN

- Implement per matrix; `bun test tests/openmuse-google-oauth.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: disconnect idempotency choice, migration SQL if any, files + shasum, test tails, S16 live deferred note. No commit.

## Failure handling

- If generation increment must live in the connect flow (G01's code), extend it minimally there — same module, allowed.
