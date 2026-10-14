# O01 — Deploy the OpenBot API and database baseline: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-task ticket plan; execute in one agent context, in order, TDD where code changes are required.

**Goal:** A reproducible baseline stack script brings up PostgreSQL + OpenBot API with migrations applied and a readiness endpoint that fails when the database is absent; evidence proves the old OpenMuse server/TaskWorker never start.

**Architecture:** New `scripts/openmuse-v4-baseline.sh` (up/down/smoke/status) drives: a dedicated docker postgres container (unique name `openbot-v4-postgres`, host port from `OPENMUSE_V4_PGPORT` default 55432 — 5432 is occupied on this machine), `bun run db:migrate` from server/, and the API via `bun` on `OPENMUSE_V4_PORT` default 18787 (8787 occupied). A DB-aware readiness route is added at `/ready` (DB ping with timeout) leaving `/health` untouched. All state under /tmp/openmuse-v4-baseline/.

**Tech Stack:** docker (OrbStack daemon available), postgres:16-alpine, bun, Hono.

**Spec:**
- Contracts §10 + catalog O01: /Users/wuyongjun/trea/openmuse/.worktrees/v4-base/docs/superpowers/plans/2026-10-12-openmuse-openbot-contracts-v4.md
- Issue #88 (O01); predecessor B03 done (pin 46792335 staged in this worktree).

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base and /tmp/openmuse-v4-baseline. NO git commits.
- Ports: postgres host port `OPENMUSE_V4_PGPORT` (default 55432) and API `OPENMUSE_V4_PORT` (default 18787); script MUST verify chosen ports are free before use and fail with a clear message otherwise. Never touch processes on 5432/8787/55433 (other projects).
- Container name `openbot-v4-postgres`; never `docker rm` anything else.
- Owned files: Create `scripts/openmuse-v4-baseline.sh`, `server/tests/ready.test.ts`; Modify `server/src/app.ts` (add `/ready` route only — do not touch `/health`), `server/src/index.ts` ONLY if route registration requires it (prefer app.ts). Evidence: `docs/openmuse-v4/o01-deployment-baseline.md`.
- Migrations: run `bun run db:migrate` with `--env-file` per server/package.json; the I02 migration may or may not be present yet — apply whatever exists at HEAD of the worktree (record which).
- Do not modify docker-compose.yml (the heavyweight full stack is out of scope; this ticket is the API+DB baseline only).

---

### Task 1: RED — /ready route test

- [ ] **Step 1:** In `server/tests/ready.test.ts` (bun:test, Hono app pattern from mobile-bff.test.ts):
  1. `/ready` with a dep that resolves a DB ping → 200 `{status:"ok", database:"up"}`;
  2. `/ready` with a dep whose ping rejects → 503 `{status:"unavailable", database:"down"}`;
  3. `/health` remains 200 `{status:"ok"}` in both cases (unchanged semantics).
  Route contract: `app.get("/ready", ...)` calling an injected `readinessProbe()` (wire the real postgres ping in app assembly; tests inject fakes).
- [ ] **Step 2:** Run `cd server && bun test tests/ready.test.ts` → FAIL (route missing).

### Task 2: GREEN — route + probe

- [ ] **Step 1:** Implement `/ready` in app.ts with injectable probe defaulting to a real `SELECT 1` via the db client (timeout 1500ms → down). Follow existing app.ts route style. `/health` untouched.
- [ ] **Step 2:** `bun test tests/ready.test.ts` → PASS; `bun test tests/mobile-bff.test.ts` → still PASS; typecheck clean; biome clean on changed files.

### Task 3: baseline script

- [ ] **Step 1:** Write `scripts/openmuse-v4-baseline.sh` (bash, `set -euo pipefail`) with subcommands:
  - `up`: check ports free → run detached `docker run -d --name openbot-v4-postgres -e POSTGRES_DB=openbot -e POSTGRES_USER=openbot -e POSTGRES_PASSWORD=openbot -p 127.0.0.1:${OPENMUSE_V4_PGPORT:-55432}:5432 postgres:16-alpine` → wait `pg_isready` (via docker exec) → `cd server && DATABASE_URL=postgres://openbot:openbot@127.0.0.1:${PORT}/openbot bun run db:migrate` → start API: `DATABASE_URL=... PORT=${OPENMUSE_V4_PORT:-18787} nohup bun run dev > /tmp/openmuse-v4-baseline/api.log &` (record PID) → poll `/ready` until 200 (30s).
  - `status`: container state, API pid alive, `/health` + `/ready` outputs.
  - `smoke-db-off`: `docker stop openbot-v4-postgres` → poll `/ready` → MUST return 503 within 10s; `/health` may stay 200 (record actual).
  - `down`: kill API pid, `docker rm -f openbot-v4-postgres`.
- [ ] **Step 2:** `chmod +x` the script; shellcheck if available (record if absent).

### Task 4: Full cycle evidence

- [ ] **Step 1:** `scripts/openmuse-v4-baseline.sh up` → record full output (timestamps, migrate log listing applied migrations, /ready 200).
- [ ] **Step 2:** `status` output; `ps aux | grep -Ei "openmuse|taskworker" | grep -v grep` → prove no old OpenMuse server/TaskWorker process (record output; expected: none matching openmuse apps/server|apps/worker of the OpenMuse repo).
- [ ] **Step 3:** `smoke-db-off` → /ready 503 evidence; then `up` again (restart path: container start + migrate no-op + API still running or restart) → /ready 200.
- [ ] **Step 4:** `down` → clean teardown evidence.
- [ ] **Step 5:** Write `docs/openmuse-v4/o01-deployment-baseline.md`: exact commands + outputs (sanitized), ports used, migrations applied list, process inventory, restart cycle, UTC timestamps. shasum it for the report.

## Acceptance (Issue #88 / catalog O01)

Clean stack starts OpenBot API and PostgreSQL with migrations; readiness fails if database is absent; neither old OpenMuse server nor TaskWorker starts. Verified by Task 4 evidence + RED/GREEN tests for /ready.

## Failure handling

- If `bun run dev` needs env vars beyond DATABASE_URL/PORT (inspect server/src/config.ts first and record), add ONLY what is required to boot; record every var used and its source.
- If db:migrate fails on a migration, record the exact error and STOP (schema defect is a real blocker — likely belongs to the migration's owning ticket).
- Docker daemon unavailable → STOP and report (environment blocker).
