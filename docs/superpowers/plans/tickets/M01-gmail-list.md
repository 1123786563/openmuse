# M01 — List and search Gmail: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessor G01+G03 verified+integrated (openmuse-connectors: connection rows, requireConnection guard, per-provider alias).

**Goal:** `GET /api/mobile/openmuse-mail?q=&cursor=&limit=` returns the authenticated owner's Gmail messages as the contract §4 Mail DTO — newest `receivedAt` first then `id` descending, default 25 / max 100, opaque owner+connection-bound cursor (invalid → 400), provider truncation surfaced as `truncated:true` — with a stable 409 when the account is disconnected, and provider action shapes never leaking into the DTO.

**Architecture:** New module `server/src/openmuse-mail/`: `client.ts` (vendor dial calling the Gmail list/search action with the `x-oo-connector-alias` header = the owner's gmail alias; injectable dial like openmuse-connectors/client.ts), `mail.ts` (provider-payload → DTO mapping + ordering + cursor encode/decode), `routes.ts` (requireUser; requireConnection(userId,"gmail") guard → 409; zod query validation; cursor keyset on (receivedAt,id)). Mount through the mobile-bff pattern: app.ts ONE appended tail param + conditional; index.ts arg + construction.

**Tech Stack:** same as G01/G03; bun:test fake dial.

**Spec:**
- Contracts §4 Mail read DTO + list ordering/cursor rules: /Users/wuyongjun/trea/openmuse/.worktrees/v4-base/docs/superpowers/plans/2026-10-12-openmuse-openbot-contracts-v4.md
- Catalog M01; Issue #32.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Create server/src/openmuse-mail/{client.ts,mail.ts,routes.ts}, server/tests/openmuse-mail.test.ts; Modify server/src/app.ts (ONE tail param + conditional mount; update ready.test.ts offset per its convention), server/src/index.ts (import + arg + construction). No migrations (no new tables).
- Do NOT modify openmuse-connectors/* (import requireConnection/alias helpers only — if a helper is not exported, add the export with a one-line change and note it).

### Task 1: RED — tests

- [ ] **Step 1:** server/tests/openmuse-mail.test.ts (fake dial, Hono test app):
  1. mapping: provider payload (shape: read the real action schema via Task 0 — see below) → DTO `{id,threadId,from,to[],subject,bodyText,receivedAt,unread,labels[],attachments:[{id,name,mimeType,size}]}`; extra provider fields dropped;
  2. ordering: three messages, equal timestamps → id descending tiebreak; distinct → newest first; page size 2 over 3 → each id exactly once across pages; cursor opaque (base64) and bound to owner+alias (another user's cursor → 400);
  3. limit: default 25; 101 clamps to 100; `abc` → 400;
  4. `q` passthrough: non-empty q forwarded to the provider search action (fake records the call); empty/absent q → list action;
  5. provider truncation flag → response `{messages, truncated:true, nextCursor?}`;
  6. disconnected (requireConnection throws) → 409 with stable code, vendor NEVER called;
  7. foreign isolation: user B's request uses B's alias (fake dial asserts the header), never A's data;
  8. provider error → 502 with no partial DTO.

### Task 0 (inside Task 1 first): the real Gmail action shape

- [ ] Inspect the vendor action catalog surface the adapter already models (server/src/plugins/openconnector-adapter.ts listServiceActions + action invocation path — find the generic action-call seam and cite it; use the gmail list/search action ids recorded there; if the repo pins no gmail action ids, use `gmail.search` / `gmail.list` as documented placeholders and RECORD that the live ids are verified at O02 deployment).

### Task 2: GREEN

- [ ] Implement client.ts/mail.ts/routes.ts per matrix; app.ts/index.ts wiring (ready.test.ts offset update); no db changes.
- [ ] `bun test tests/openmuse-mail.test.ts tests/ready.test.ts tests/mobile-bff.test.ts` → PASS; typecheck + biome clean.

### Task 3: Checkpoint

- [ ] Report: action-id finding (file:line or placeholder note), changed files + shasum, test tails, S17 live two-account fixture deferred statement. No commit.

## Acceptance (Issue #32 / catalog M01)

Contract §4 fields and newest-time/ID order for the authenticated account; disconnected account refuses (409); other user's message id does not resolve (alias-bound dial + foreign cursor 400). Verified by Task 1 matrix.

## Failure handling

- If the vendor action invocation needs a payload shape the adapter doesn't model, implement the minimal call on your own dial (never edit plugins/) and flag the divergence for O02's live check.
