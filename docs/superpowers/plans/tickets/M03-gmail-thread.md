# M03 — Read a Gmail thread: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessor M01 verified+integrated.

**Goal:** `GET /api/mobile/openmuse-mail/threads/:threadId` returns the thread's messages oldest-first by provider time then id, with normalized headers/body per §4; a direct foreign thread id refuses; a missing provider thread is a visible not-found; disconnected → 409.

**Architecture:** Extend `openmuse-mail`: client.ts gains the thread-read action call (alias-bound dial, same placeholder-action discipline as M01 — record the id); mail.ts gains thread normalization (oldest-first ordering; bodyText normalized; from/to/subject mapping; attachment metadata passthrough); routes.ts the endpoint (requireUser + requireConnection + owner-alias binding; foreign/missing → 404 with distinct internal reason logged, identical outward shape).

**Spec:** Contracts §4 (thread messages oldest time/ID order; direct foreign thread ID refuses; missing provider thread = visible not-found); catalog M03; Issue #34.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-mail/{client.ts,mail.ts,routes.ts}, server/tests/openmuse-mail.test.ts. NO app.ts/index.ts, no migrations.

### Task 1: RED — tests

1. three-message provider thread (mixed timestamps + equal-timestamp tie) → oldest-first by (time, id asc); DTO per §4 message shape incl. attachments metadata;
2. body normalization: HTML-only body → text fallback extracted (strip tags naive is fine — record the choice); CRLF normalized; empty body → empty string not null;
3. foreign thread id (another alias's data in the fake) → 404 identical outward shape as missing;
4. provider thread-not-found error → 404; provider error → 502 no partial;
5. disconnected → 409, vendor never called;
6. §9: disabled owner 403.

### Task 2: GREEN

- Implement per matrix; `bun test tests/openmuse-mail.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: thread action-id note (placeholder discipline), files + shasum, test tails, S17 deferred note. No commit.

## Failure handling

- If the provider thread payload lacks per-message ids, derive stable ids from (provider id, index) and record the derivation.
