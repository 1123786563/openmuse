# B03 — Build iOS and Android exports from submodule: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-task ticket plan; execute in one agent context, in order, checking off each step.

**Goal:** The pinned OpenMuse submodule produces iOS and Android export bundles with the exact OpenMuse root commands, from a simulated clean checkout of the OpenBot execution worktree, with both artifacts tied to the same submodule SHA, and the Bun workspace never absorbing the pnpm workspace.

**Architecture:** Reuse the B02 staged submodule pin (apps/openmuse @ 1ac68f3). Run `pnpm build:ios` and `pnpm build:android` (expo export platform bundles — no device/signing needed) in the scratch clean-checkout; prove determinism by re-running one export and comparing file lists; prove workspace separation by asserting `bun pm ls` at OpenBot root does not traverse apps/openmuse and apps/openmuse keeps its own pnpm-lock.

**Tech Stack:** pnpm 11.19.0, expo export (ios/android), bun 1.4.x for the workspace-separation check.

**Spec:**
- contracts-v4 §1 (same file as B02): /Users/wuyongjun/trea/openmuse/.worktrees/v4-base/docs/superpowers/plans/2026-10-12-openmuse-openbot-contracts-v4.md
- Issue #4 (B03). Predecessor: B02 evidence at /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base/docs/openmuse-v4/b02-web-build-evidence.md (read the pin SHA from it).

## Global Constraints

- Same as B02: work only in the OpenBot execution worktree + /tmp/b03-clean-checkout; no commits; no writes to user main checkouts.
- Exports write to `apps/mobile/dist/ios` and `apps/mobile/dist/android` INSIDE the submodule checkout only.
- New files allowed: `docs/openmuse-v4/b03-native-exports-evidence.md` (plus dist outputs inside submodule clones, which are gitignored).
- Both artifacts must record the same submodule SHA (= B02 pin).

---

### Task 1: Scratch clean checkout (reuse B02 recipe)

- [ ] **Step 1:** Recreate the B02 clean-checkout scratch: clone OpenBot v4-base HEAD 748f91ad, apply staged .gitmodules + gitlink (mode 160000 @ pin SHA), `git submodule update --init --recursive`, `cd apps/openmuse && pnpm install --frozen-lockfile`. Expected: clean install, `git -C apps/openmuse rev-parse HEAD` prints the pin SHA.

### Task 2: iOS export

- [ ] **Step 1:** `cd /tmp/b03-clean-checkout/ob/apps/openmuse && pnpm build:ios 2>&1 | tail -10`
  Expected: completes; `apps/mobile/dist/ios/index.html` exists. If expo requires an interactive native SDK step, record the exact command/output and STOP (that is a genuine environment blocker to report).
- [ ] **Step 2:** Digest: `find apps/mobile/dist/ios -type f | sort | xargs shasum -a 256 > /tmp/b03-ios.sha256 && shasum -a 256 /tmp/b03-ios.sha256`

### Task 3: Android export

- [ ] **Step 1:** `pnpm build:android 2>&1 | tail -10`; expect `apps/mobile/dist/android/index.html`.
- [ ] **Step 2:** Digest as Task 2 Step 2 → /tmp/b03-android.sha256.

### Task 4: Same-SHA and workspace-separation proofs

- [ ] **Step 1:** Both exports ran against `git -C /tmp/b03-clean-checkout/ob/apps/openmuse rev-parse HEAD` — capture once before Task 2 and once after Task 3; values must be identical and equal to the B02 pin.
- [ ] **Step 2:** Workspace separation:
  - `cd /tmp/b03-clean-checkout/ob && bun pm ls 2>/dev/null | grep -c openmuse` → expect 0 package entries from apps/openmuse (matches workspaces ["app","server","worker"]).
  - `test -f apps/openmuse/pnpm-lock.yaml && ! test -f apps/openmuse/bun.lock` → both true (pnpm workspace intact, no bun.lock created at OpenMuse root).
  - `git -C apps/openmuse status --porcelain | wc -l` → 0 (exports only wrote gitignored dist/).

### Task 5: Determinism spot-check

- [ ] **Step 1:** `rm -rf apps/mobile/dist/ios && pnpm build:ios && find apps/mobile/dist/ios -type f | sort | xargs shasum -a 256 > /tmp/b03-ios-2.sha256`
  Compare `diff /tmp/b03-ios.sha256 /tmp/b03-ios-2.sha256`; byte-identical is expected for expo static exports; if it differs, record which files differ and note it as an observation (not necessarily a failure — asset timestamps can vary; investigate before declaring failure).

### Task 6: Evidence + checkpoint

- [ ] **Step 1:** Write `docs/openmuse-v4/b03-native-exports-evidence.md` in the OpenBot v4-base worktree: pin SHA, both export logs' tails, digests, determinism result, workspace proofs, UTC timestamp.
- [ ] **Step 2:** `shasum -a 256 docs/openmuse-v4/b03-native-exports-evidence.md`; include in report. No commit.

## Acceptance (Issue #4 / catalog B03)

Clean checkout runs the exact OpenMuse root iOS and Android export commands; the Bun workspace does not absorb the pnpm workspace; both artifacts record the same submodule SHA.

## Failure handling

- Missing native toolchain for `expo export`: STOP and report exact error (expo export for ios/android platforms produces JS bundles + assets and normally needs no Xcode; if it does, that's a blocker to report, not to work around silently).
- Nondeterministic artifacts: record differing files; escalate in report.
