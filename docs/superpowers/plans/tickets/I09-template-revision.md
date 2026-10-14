# I09 — Preview and apply a Bot template revision: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-task ticket plan; one agent context, TDD. Predecessor I02 verified+integrated (its uncommitted diff is present in the worktree — build on it, never revert it).

**Goal:** An administrator can preview a managed template revision (`v1→v2` fixture: adds `calendar.read` grant) showing per-field `{field, old, new, ownership}` with user-editable fields never proposed for overwrite, and apply it to existing private OpenMuse Bots under compare-and-swap so concurrent applies converge to one final version; non-admin apply gets 403; a user-edited title survives.

**Architecture:** Extend `server/src/agents/openmuse-template-store.ts` with revision data (`OPENMUSE_TEMPLATE_REVISIONS: v1, v2`), `previewRevision(actor, targetVersion)` (pure diff over managed fields vs a stored profile) and `applyRevision(targetVersion)` (row-locked/CAS update of managed columns only). New admin routes in `server/src/admin/` (follow existing admin route mounting + `requireAdmin`): `GET /api/admin/openmuse-template/preview?targetVersion=2`, `POST /api/admin/openmuse-template/apply {targetVersion}`.

**Tech Stack:** Hono + requireAdmin (server/src/auth/guards.ts), drizzle update with WHERE stored version, bun:test.

**Spec:**
- Contracts §2 Template ownership + fixture (v1 mail.read → v2 calendar.read, title "Research helper" preserved): /Users/wuyongjun/trea/openmuse/.worktrees/v4-base/docs/superpowers/plans/2026-10-12-openmuse-openbot-contracts-v4.md
- Catalog I09 + acceptance S07/S08. Issue #13 (I09).

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files:
  - Modify: server/src/agents/openmuse-template-store.ts, server/src/mobile-bff/openmuse-bot.ts (only if the stored-version read must replace the shipped-constant answer — keep minimal), server/src/admin/routes.ts (mount two routes), server/tests/openmuse-bot.test.ts (extend) or new server/tests/openmuse-template-revision.test.ts
  - Create: server/tests/openmuse-template-revision.test.ts
- Do NOT touch: app.ts (another ticket may be editing it concurrently — the admin routes mount via admin/routes.ts's existing assembly), routes.ts/mobile-bff, db schema (no migration needed: managed fields live in existing columns/configuration JSON; template_version stored as part of template metadata — see Task 0).
- English code/comments. No UI in this ticket (preview/apply are admin API; S07's admin screen belongs to the OpenBot web app outside this catalog's client scope — record this reading).

### Task 0: Facts to confirm (record; STOP+ask if a fact fails)

- [ ] Where the per-profile template version + grants are persisted by I02's `createFromTemplate` (read openmuse-template-store.ts). If version/grants live inside the profile `configuration`/`override` JSON, revision apply updates that JSON under CAS on a version marker you add INSIDE the JSON (no schema change); record the exact storage shape.
- [ ] How admin routes mount (read server/src/admin/routes.ts + app.ts's admin section from git HEAD, NOT the working tree's concurrent edits) — your routes must register through the existing admin assembly without editing app.ts. If admin mounting genuinely requires an app.ts line, STOP and ask.

### Task 1: RED — revision tests

- [ ] **Step 1:** server/tests/openmuse-template-revision.test.ts (in-memory fakes):
  1. preview v1→v2 lists exactly the managed diffs (grants gain `calendar.read`, templateVersion 1→2) each as `{field, old, new, ownership:"managed"}`; a user-edited `title:"Research helper"` appears with `ownership:"user"` and NO proposed `new`;
  2. apply v2 updates managed fields; title stays "Research helper";
  3. apply v2 when stored is already v2 → no-op success, one final version (idempotent);
  4. two concurrent applies (Promise.all, store simulating interleaving) → exactly one update wins, final stored version 2, grants written once;
  5. non-admin actor → 403; preview by owner-user (non-admin) → 403 too (admin operation);
  6. apply targetVersion < stored → 409 stale.
- [ ] **Step 2:** `cd server && bun test tests/openmuse-template-revision.test.ts` → FAIL.

### Task 2: GREEN

- [ ] **Step 1:** Implement revisions v1/v2 constants (v2 = v1 + `calendar.read` + version 2), preview (pure diff), apply (CAS: `UPDATE ... WHERE template marker version < target`; 0 rows → re-read; if equal → no-op; if greater → stale 409), owner/title/avatar/roleDescription/prefs never written.
- [ ] **Step 2:** Admin routes with `requireAdmin`; validation via zod (`targetVersion` integer 1..2 for now).
- [ ] **Step 3:** `bun test tests/openmuse-template-revision.test.ts tests/openmuse-bot.test.ts tests/mobile-bff.test.ts` → all PASS. Typecheck + biome clean on owned files.

### Task 3: Checkpoint

- [ ] Report: Task 0 answers, changed files + shasum, test tails, and the exact JSON storage shape for version/grants. No commit.

## Acceptance (Issue #13 / catalog I09)

Preview diff table per contract §2; v1→v2 grants change once while "Research helper" title remains; concurrent apply leaves one final version; non-admin 403. Verified by Task 1 tests.

## Failure handling

- If I02's storage shape cannot carry a version marker without a schema change, STOP and ask (adding a column needs a migration + coordinator approval of the blast radius).
