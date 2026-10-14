# G03 — Grant Calendar access separately: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessor G01+G02 verified+integrated (openmuse-connectors with pending-state + outcome columns + nonce, migrations 0079/0080).

**Goal:** The same user can grant Calendar in addition to Gmail as a SEPARATE consent: calendar connection has its own alias/status/generation; a Gmail-only grant does NOT authorize Calendar provider calls (stable refusal); account identity is explicit per provider.

**Architecture:** Generalize G01's gmail-specific module to provider-parameterized (provider: "gmail" | "gcalendar") where the seams are already generic, add the calendar routes beside gmail's (connect/status/callback with provider in the path), separate connection rows per (userId, provider), and a combined `GET /api/mobile/openmuse-google` status returning both providers' states. Vendor service names: gmail + the calendar provider's OpenConnector service id (Task 0 confirms from /api/providers or the provider catalog — use `google-calendar` if that is the id, else the actual id, and RECORD it).

**Tech Stack:** same as G01/G02; bun:test fake dial; injected clock.

**Spec:**
- Contracts §4 (Gmail read can depend directly on Gmail consent; Calendar consent is a separate branch): /Users/wuyongjun/trea/openmuse/.worktrees/v4-base/docs/superpowers/plans/2026-10-12-openmuse-openbot-contracts-v4.md
- Catalog G03; Issue #28.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Modify server/src/openmuse-connectors/{client.ts,google-oauth.ts,store.ts,routes.ts}, server/tests/openmuse-google-oauth.test.ts; migration 00NN only if provider generalization needs schema change (expected: widen/parameterize existing columns — e.g. provider column already exists on connections; pending rows may need provider — check 0079; generate + report SQL).
- No app.ts/index.ts edits beyond what G01's mounts already provide (if the mount is gmail-path-specific, generalize the path segment — keep ONE public callback route shape; document).

### Task 0: Facts

- [ ] The OpenConnector service id for Google Calendar (fake dial in tests uses it; record where a real deployment lists it — /api/providers). The alias formula becomes provider-parameterized: `openmuse-<sha256(userId+provider)[:16]>`.

### Task 1: RED — separate-grant tests

- [ ] **Step 1:** extend the test file:
  1. user connects gmail (existing matrix stays green); then connects calendar → second pending + second callback → calendar connection row {provider:"gcalendar"|actual id, accountEmail, generation:1} with its OWN alias; gmail row untouched;
  2. calendar-only user calls a gmail-scoped refusal: `status` shows gmail disconnected; a (stub) provider-call guard `requireConnection(userId, "gmail")` throws a stable 409-shaped refusal while calendar is connected (this guard function is the seam M01/A01 will call — implement it in google-oauth.ts and test);
  3. combined status returns both providers with distinct statuses/scopes/generations;
  4. calendar callback faults (expired/replay/cross-session/nonce) — parameterize the G02 matrix over both providers (loop, not copy-paste);
  5. §9: enumerateOwner returns refs for both kinds.
- [ ] **Step 2:** `bun test tests/openmuse-google-oauth.test.ts` → new cases FAIL.

### Task 2: GREEN

- [ ] Parameterize the module (provider union, alias formula, routes per provider, ONE combined status route); migration if needed (SQL verbatim in report).
- [ ] `bun test tests/openmuse-google-oauth.test.ts tests/ready.test.ts tests/mobile-bff.test.ts` → PASS; typecheck + biome clean.

### Task 3: Checkpoint

- [ ] Report: Task 0 service id answer, migration SQL if any, changed files + shasum, test tails, S15 live-consent deferred statement. No commit.

## Acceptance (Issue #28 / catalog G03)

Same user can grant Calendar after Gmail; Calendar scope and account identity explicit; Gmail-only grant does not authorize Calendar calls (requireConnection refusal). Verified by Task 1 matrix parameterized over both providers.

## Failure handling

- If the deployed OpenConnector lacks a calendar provider id, implement against the documented id from the provider catalog source in the repo (rg the provider list) and record the live-deployment dependency for O02.
