# M02 — Page Gmail without gaps: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessor M01 verified+integrated.

**Goal:** The §4 paging fixture: three messages with EQUAL timestamps over page size 2 return every id exactly once across pages (deterministic id tiebreak); malformed/foreign cursor → 400; provider truncation visible.

**Architecture:** Extend `openmuse-mail`: cursor keyset already (receivedAt,id) — this ticket proves and hardens the boundary behavior + adds the equal-timestamp fixture tests + provider-side page stitching if the provider pages by its own token (map provider nextToken into the opaque cursor so gaps cannot appear mid-stitch; Task 0 records the fake's provider-paging shape from M01's client).

**Spec:** Contracts §4 Mail read (page size 2 over equal-timestamp three-message fixture: no duplicate/missing ids); catalog M02; Issue #33.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-mail/{mail.ts,routes.ts} (+client.ts only if token-stitching needs it), server/tests/openmuse-mail.test.ts. NO app.ts/index.ts, no migrations.

### Task 1: RED — boundary tests

1. equal-timestamp fixture (3 msgs, page 2): page1 = newest 2 by id-desc, page2 = remaining 1 + no nextCursor; union = all 3, each once;
2. cursor exactly at a tie boundary (cursor's (receivedAt,id) sits between two equal-timestamp rows) → next page returns the correct remaining subset (id-desc semantics: strictly "after" = older or smaller id);
3. malformed base64 → 400; well-formed but wrong inner shape → 400; another user's cursor → 400 (alias binding);
4. provider-side paging: fake dial returns provider pageToken semantics (Task 0 shape) → stitched pages yield no gaps/dupes; provider truncation flag propagates as truncated:true on the final stitched page;
5. limit clamp re-asserted under paging (101→100).

### Task 2: GREEN

- Implement per matrix; `bun test tests/openmuse-mail.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: Task 0 provider-paging shape note, files + shasum, test tails, S17 live fixture deferred note. No commit.

## Failure handling

- If M01's client models no provider pageToken, add the stitching seam with the fake defining the contract and record it for the O02 live check.
