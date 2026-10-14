# I02 — Provision exactly one private OpenMuse Bot: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-task ticket plan; execute in one agent context, in order, TDD (RED→GREEN per behavior). Predecessor I01 must be verified+integrated before dispatch (its client seam is not edited here).

**Goal:** `POST /api/mobile/openmuse-bot` (no user ID in the request) provisions, idempotently and concurrently-safe, exactly one private OpenMuse Bot per user with its own computer profile, returning `{botId, templateVersion, computerProfileId}`; ownership derives from the authenticated session; a foreign Bot ID stays 404 through the existing seam.

**Architecture:** New module `server/src/mobile-bff/openmuse-bot.ts` — a `createOpenMuseBotProvisioner(deps)` seam (like `createMobileBffWorkspace`): tries insert under a serialized path, on unique-violation reads the existing row and returns it (both concurrent callers get the same Bot). Route added to `createMobileBffRoutes` behind the existing `requireUser`. New column `templateKey` + unique index `(owner_user_id, template_key)` on `agent_profiles` via drizzle schema + generated migration. Computer profile id comes from the existing computer provisioning seam the Bot already uses on creation (Step 0 confirms the exact call). Template v1 fixture: managed fields recorded per contract §2 (grants `mail.read`, visibility private, owner, computer policy/profile, system prompt revision).

**Tech Stack:** Hono routes (existing patterns in server/src/mobile-bff/routes.ts), drizzle schema (server/src/db/schema/coworker.ts), drizzle-kit generate, bun:test with in-memory store fakes (pattern: server/tests/mobile-bff.test.ts).

**Spec:**
- Contracts §2 (first-entry contract, template ownership): /Users/wuyongjun/trea/openmuse/.worktrees/v4-base/docs/superpowers/plans/2026-10-12-openmuse-openbot-contracts-v4.md
- Catalog I02 + I09 (template revisions are I09's scope — I02 only records templateVersion and the v1 managed fields; do NOT build revision application)
- Issue #6 (I02)
- Prior art: server/src/mobile-bff/{routes,workspace}.ts and their tests

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. Never write to /Users/wuyongjun/trea/OpenBot main checkout or /Users/wuyongjun/trea/openmuse*.
- NO git commits. Uncommitted checkpoint protocol.
- Owned files:
  - Create: server/src/mobile-bff/openmuse-bot.ts, server/tests/openmuse-bot.test.ts
  - Modify: server/src/mobile-bff/routes.ts (mount one route), server/src/app.ts (wire provisioner ONLY where agentProfileStore exists — follow the existing conditional-assembly pattern at the /api/mobile mount), server/src/db/schema/coworker.ts (templateKey column + unique index), generated migration SQL under server/ (drizzle output dir from server/drizzle.config.ts)
- Do not touch: agents/profile-store.ts core methods (extend, don't rewrite), channels, auth, computer gateway internals.
- The endpoint NEVER accepts a user id: request body must be empty or `{}`; any `userId`-like field → 400.
- `template_key` literal: `"openmuse-private"` (single source: exported const OPENMUSE_TEMPLATE_KEY).
- English code/comments per OpenBot convention.

---

### Task 0: Confirm the two integration facts (record answers in your report; STOP+ask if either fails)

- [ ] Computer profile: find how a new private Bot gets its computer/profile id today (search server/src for computer profile creation tied to agent creation, e.g. agent-computer, computer-access). Record the exact function + whether `AgentProfileStore.create` already triggers it. If creation is lazy (on first use), then I02 returns `computerProfileId: null` plus a `computerProvisioned: false` field is NOT allowed by contract — instead derive/ensure the profile id here; if truly impossible without new computer-gateway work, STOP and ask the coordinator.
- [ ] Migration flow: `cd server && bun run db:generate` runs against ../.env — inspect server/drizzle.config.ts for the migrations output dir; confirm `bun run db:migrate` exists for deployment (O01 applies it later; you only generate + review the SQL).
- [ ] Test DB: check whether any bun:test file boots a real postgres (rg -l "pglite|postgres://" server/tests). Record yes/no. If no, DB-level uniqueness is proven by the generated migration SQL review + store-contract tests here, and real-DB proof routes to O01 (say so in your report; do not invent a new harness).

### Task 1: RED — provisioner + route tests

**Files:**
- Create: server/tests/openmuse-bot.test.ts

**Interfaces:**
- Produces: `createOpenMuseBotProvisioner(deps: { agentProfileStore: AgentProfileStore & { findByTemplateKey(ownerUserId: string, templateKey: string): Promise<AgentProfile | null>; createFromTemplate(ownerUserId: string, template: OpenMuseTemplateV1): Promise<AgentProfile> }, computerProfileIdFor(profile: AgentProfile): Promise<string | null> })` returning `{ provision(actor: AuthenticatedActor): Promise<{ botId: string; templateVersion: number; computerProfileId: string | null }> }`. Unique-violation from createFromTemplate (error marker `UNIQUE_TEMPLATE` or drizzle code 23505) → re-read via findByTemplateKey and return the existing row.
- Route: `POST /api/mobile/openmuse-bot` → 200 `{botId, templateVersion, computerProfileId}`.

- [ ] **Step 1 (tests, RED):** in-memory fakes (follow mobile-bff.test.ts style):
  1. first call creates one profile `{visibility:"private", ownerUserId:actor.id, templateKey:"openmuse-private"}` and returns its id + templateVersion 1 + computerProfileId;
  2. second call returns the SAME id, no second create;
  3. concurrent provision (Promise.all ×2, fake create that resolves both inserts then throws UNIQUE on the loser) → both resolve same botId, exactly one create succeeded;
  4. POST with body `{userId:"someone"}` → 400; empty body → 200;
  5. unauthenticated (requireUser omitted in one test app) → route not reachable (401 via guard) — assert the guard contract;
  6. two different actors → two different bots (store keyed by owner).
- [ ] **Step 2:** Run: `cd server && bun test tests/openmuse-bot.test.ts` → FAIL (module missing).

### Task 2: GREEN — provisioner, route mount, schema

- [ ] **Step 1:** Implement `server/src/mobile-bff/openmuse-bot.ts` per Produces contract; export `OPENMUSE_TEMPLATE_KEY = "openmuse-private"` and `OPENMUSE_TEMPLATE_VERSION = 1`; v1 managed fields: grants `["mail.read"]`, visibility `"private"`, system prompt revision tag `"openmuse-v1"` (stored in profile configuration/override JSON per CreateAgentInput conventions — follow profile-store create's input shape).
- [ ] **Step 2:** Mount in routes.ts: `routes.post("/openmuse-bot", ...)` calling the provisioner; app.ts wires `provisioner: createOpenMuseBotProvisioner({...})` following the existing conditional-assembly pattern; the store extension methods (findByTemplateKey/createFromTemplate) live in a new `server/src/agents/openmuse-template-store.ts` implementing the drizzle queries (insert ... on templateKey unique; catch 23505 → select by key).
- [ ] **Step 3:** Schema: coworker.ts agentProfiles add `templateKey: text("template_key")` + `uniqueIndex("agent_profiles_owner_template_uq").on(ownerUserId, templateKey)` (nullable column — existing rows unaffected; nulls excluded from uniqueness). Run `bun run db:generate` in server/; READ the generated SQL; include it verbatim in your report; do NOT run db:migrate.
- [ ] **Step 4:** `bun test tests/openmuse-bot.test.ts && bun test tests/mobile-bff.test.ts` → all PASS. `bunx biome check src/mobile-bff/openmuse-bot.ts src/agents/openmuse-template-store.ts tests/openmuse-bot.test.ts` → clean.
- [ ] **Step 5:** Full guard: `cd /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base && bun run typecheck 2>&1 | tail -3` (or the repo's equivalent — check package.json scripts) → clean.

### Task 3: Foreign-ID check (already-existing behavior, asserted here)

- [ ] **Step 1:** Add test: `GET /api/mobile/workspace` with actor A while the only openmuse bot belongs to B → A's workspace does NOT list B's bot (uses the same in-memory stores; proves isolation through the seam I03 will consume). If this already exists in mobile-bff.test.ts, link it instead of duplicating.

### Task 4: Checkpoint

- [ ] **Step 1:** `git status --porcelain` full list + `git diff --stat` + shasum of created files → final report. Include: Task 0 answers, generated migration SQL, test output tails. No commit.

## Acceptance (Issue #6 / catalog I02)

POST without user ID returns one Bot and computer profile per user; concurrent calls satisfy unique(owner_user_id, template_key); two users get distinct profiles; foreign actor cannot request another owner. Verified by Task 1 tests (concurrency case included) + schema/migration review. Real-postgres uniqueness proof lands with O01 if Task 0 found no existing DB test harness (record explicitly).

## Failure handling

- If AgentProfileStore.create cannot express visibility=private+owner in one call at HEAD, extend via the new template-store module (raw drizzle insert into agents+agent_profiles mirroring profile-store's create SQL) rather than modifying profile-store's public shape; note the duplication in your report for reviewer attention.
- If the computer profile seam (Task 0) requires gateway work beyond this ticket, STOP and ask (do not silently return null forever).
