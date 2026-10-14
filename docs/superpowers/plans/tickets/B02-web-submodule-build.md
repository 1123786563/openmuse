# B02 — Build canonical Web from submodule: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-task ticket plan; execute in one agent context, in order, checking off each step. Spec and contracts travel with this plan.

**Goal:** OpenBot execution worktree references the complete OpenMuse repository as a Git submodule at `apps/openmuse` pinned to committed revision 1ac68f3, and a simulated clean checkout builds the canonical Web export plus the OpenBot backend build using exactly the contract §1 commands.

**Architecture:** `git submodule add` stages `.gitmodules` + gitlink (NO commit — uncommitted-checkpoint protocol). Clean-checkout acceptance is verified in a scratch directory that reproduces the staged index state without any commit, then runs the pinned build commands. Evidence: build logs + artifact SHAs + submodule SHA recorded in the manifest file.

**Tech Stack:** git submodules, pnpm 11.19.0 (OpenMuse, frozen lockfile), bun (OpenBot build).

**Spec:**
- /Users/wuyongjun/trea/openmuse/.worktrees/v4-base/docs/superpowers/plans/2026-10-12-openmuse-openbot-contracts-v4.md §1 (Build and source boundary)
- /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base/docs/superpowers/specs/2026-10-12-openmuse-frontend-openbot-backend-design.md (Source layout)
- B01 manifest (input): /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base/docs/openmuse-v4/b01-copied-client-inventory.md — do not modify it; B02 must not resolve or delete any B01 row.
- Issue #3 (B02).

> **PIN AMENDMENT (2026-10-12, coordinator):** The repository owner committed and pushed main during execution. Pin is now **46792335dfc260efa05f2185aa353093b12d9937** (supersedes 1ac68f3, its direct parent; includes zh-CN localization + all v4 planning docs). Replace every 1ac68f3 reference below accordingly. Record the amendment in the evidence file header.

## Global Constraints

- Work only in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base and a scratch dir under /tmp/b02-clean-checkout.
- NO git commits, NO pushes. `git submodule add` stages the gitlink — that staged state IS the checkpoint; leave it staged.
- Never write to /Users/wuyongjun/trea/OpenBot or /Users/wuyongjun/trea/openmuse main checkouts.
- Submodule URL: https://github.com/1123786563/openmuse (public). Pin: 46792335dfc260efa05f2185aa353093b12d9937 (see PIN AMENDMENT above; verify equals origin/main HEAD before pinning: `git ls-remote https://github.com/1123786563/openmuse refs/heads/main`).
- The only new/changed files allowed in the worktree: `.gitmodules`, gitlink `apps/openmuse`, `docs/openmuse-v4/b02-web-build-evidence.md`.
- OpenBot Bun workspace must remain exactly ["app","server","worker"] (verify, do not change).

---

### Task 1: Stage the submodule pin

**Files:**
- Create: `.gitmodules`
- Create (gitlink): `apps/openmuse`
- Output: `docs/openmuse-v4/b02-web-build-evidence.md`

**Interfaces:**
- Produces (for B03, I01..): `apps/openmuse` checkout at 1ac68f3 inside the execution worktree; `.gitmodules` entry `apps/openmuse -> https://github.com/1123786563/openmuse`.

- [ ] **Step 1:** Verify pin and remote agree:
  Run: `git ls-remote https://github.com/1123786563/openmuse refs/heads/main`
  Expected: `46792335dfc260efa05f2185aa353093b12d9937` (full 40-char SHA; record it). If main has moved AGAIN during execution, STOP and ask the coordinator (do not re-pin silently).

- [ ] **Step 2:** `git submodule add https://github.com/1123786563/openmuse apps/openmuse` then `git -C apps/openmuse checkout 46792335dfc260efa05f2185aa353093b12d9937` then `git add apps/openmuse` (re-stage gitlink if checkout moved it). If `git submodule add` warns about existing entry, stop and report.

- [ ] **Step 3:** Verify staged state:
  Run: `git status --porcelain | grep -E "apps/openmuse|gitmodules"` → both staged; `git ls-files -s apps/openmuse` → mode `160000` with the 40-char SHA of 46792335; `cat .gitmodules` shows exactly one submodule with `branch` NOT pinned to anything except default (no branch line needed).

### Task 2: In-place Web build (fast feedback)

- [ ] **Step 1:** `cd apps/openmuse && pnpm install --frozen-lockfile 2>&1 | tail -1`
  Expected: `Done in ...` with no lockfile changes (`git -C apps/openmuse status --porcelain` empty).
- [ ] **Step 2:** `pnpm build:web 2>&1 | tail -20`
  Expected: expo export completes; `apps/openmuse/apps/mobile/dist/web/index.html` exists.
- [ ] **Step 3:** Record artifact digest:
  Run: `find apps/openmuse/apps/mobile/dist/web -type f | sort | xargs shasum -a 256 > /tmp/b02-web-files.sha256 && shasum -a 256 /tmp/b02-web-files.sha256`
  Record both in evidence file.

### Task 3: Simulated clean-checkout acceptance (the B02 gate)

**Interfaces:**
- Consumes: staged `.gitmodules` + gitlink from Task 1.
- Produces: evidence that contract §1's clean-checkout command sequence passes.

- [ ] **Step 1:** Build scratch checkout:
```bash
rm -rf /tmp/b02-clean-checkout && mkdir -p /tmp/b02-clean-checkout && cd /tmp/b02-clean-checkout
git clone --no-checkout /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base ob
cd ob && git checkout 748f91ad
# reproduce staged index state without commit:
git apply --cached - <<'PATCH'
... generate with: git -C /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base diff --cached -- .gitmodules
PATCH
git update-index --add --cacheinfo 160000,46792335dfc260efa05f2185aa353093b12d9937,apps/openmuse
git checkout -- .gitmodules && git checkout-index -a -f   # materialize worktree from index
```
(If `git apply --cached` of the .gitmodules diff misbehaves, copy `.gitmodules` directly and `git add .gitmodules` — the index state must end identical: staged .gitmodules + gitlink 160000.)
- [ ] **Step 2:** Exact contract commands:
```bash
cd /tmp/b02-clean-checkout/ob
git submodule update --init --recursive
git -C apps/openmuse checkout 46792335dfc260efa05f2185aa353093b12d9937 2>/dev/null || true   # no-op when default clone already at main
cd apps/openmuse && pnpm install --frozen-lockfile && pnpm build:web
```
Expected: all succeed; `apps/mobile/dist/web/index.html` exists; record full log tail.
- [ ] **Step 3:** OpenBot build unaffected:
```bash
cd /tmp/b02-clean-checkout/ob && bun install --frozen-lockfile && bun run build 2>&1 | tail -5
```
Expected: succeeds (or completes with pre-existing warnings only); no error mentioning `apps/openmuse`.
- [ ] **Step 4:** User-edit isolation proof: in the scratch submodule run `test ! -e docs/superpowers/ledger && echo NOT-IN-PIN` (the coordinator's execution ledger exists only in the main worktree, never inside the pin). Expected: `NOT-IN-PIN`. Additionally record `git -C apps/openmuse status --porcelain | wc -l` → 0 (pin content is exactly committed content).

### Task 4: Evidence + checkpoint

- [ ] **Step 1:** Write `docs/openmuse-v4/b02-web-build-evidence.md` with: pin SHA, ls-remote proof, staged-index status output, in-place build tail, scratch clean-checkout command log, web artifact file-list hash, `bun run build` tail, NOT-IN-PIN proof, timestamp (UTC).
- [ ] **Step 2:** `shasum -a 256 docs/openmuse-v4/b02-web-build-evidence.md` and include in final report. No commit.

## Acceptance (Issue #3 / catalog B02)

OpenBot pins the full OpenMuse repository at apps/openmuse; a clean recursive checkout runs the exact pnpm Web export and OpenBot Bun build from contract §1; current user edits are not mistaken for pinned content. Verified by Task 3 evidence.

## Failure handling

- If `pnpm build:web` fails in the scratch checkout but succeeded in-place, diagnose environment difference (pnpm store, node version) and record; do not "fix" by editing OpenMuse source.
- If OpenBot `bun run build` regresses because of the submodule's presence, record exact error and stop — that is a real blocker for B02, escalate via worker report.
