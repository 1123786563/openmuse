# R03 — Reject stale Gmail proposals: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessors R02+G05 verified+integrated.

**Goal:** The complete §6 staleness matrix for Gmail sends: changed payloadHash, changed account (accountEmail), changed connection generation, and changed reply target (threadId/replyToMessageId) each → 409 stale with ZERO provider sends; the decision body carries a stable `staleReason` so the UI can ask for a fresh proposal; re-proposal after staleness works cleanly.

**Architecture:** R01/R02 already guard hash/generation pre-dial. This ticket: (1) completes the matrix — accountEmail change and reply-target change become first-class 409 checks in the executor/service (Task 0: audit which guards exist — cite; add the missing ones with the same pre-dial discipline); (2) decision error shape standardization: 409 body `{error, staleReason: "payload"|"account"|"generation"|"target"}` (client contract for the fresh-proposal prompt); (3) tests prove zero dial calls for every stale row and a clean re-propose→approve cycle after each.

**Spec:** Contracts §6 (changed hash/account/generation/target version returns 409 and requires a new proposal); catalog R03; Issue #51.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-reviewed-actions/{service.ts,gmail-send-executor.ts,routes.ts}, server/tests/openmuse-reviewed-actions.test.ts. NO migrations, NO app.ts/index.ts. Never touch openmuse-personal (concurrent worker).

### Task 1: RED — matrix tests

1. changed payloadHash (decision carries the original hash, row has a new one) → 409 staleReason "payload", zero dial;
2. changed accountEmail → 409 "account", zero dial;
3. changed generation (post G05 reconnect) → 409 "generation", zero dial;
4. changed reply target (proposal created with threadId A, decision context/thread now B — model per Task 0's finding of how reply targets bind) → 409 "target", zero dial;
5. staleReason absent on non-stale 409s (expired keeps its own reason);
6. after each stale refusal, a FRESH proposal with current values approves and sends exactly once (happy-path cycle);
7. §9 disabled owner 403 unchanged.

### Task 2: GREEN

- Implement per matrix (Task 0 audit cited); `bun test tests/openmuse-reviewed-actions.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: Task 0 audit (which guards pre-existed, file:line), files + shasum, test tails, S21 live stale fixtures deferred note. No commit.

## Failure handling

- If reply-target binding has no current representation in the proposal model (no threadId field), add it to the canonical payload schema (hash-stable serialization extended — a new proposal kind version) and record.
