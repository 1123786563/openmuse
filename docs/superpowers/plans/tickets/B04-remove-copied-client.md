# B04 — Remove copied client after all mapped adaptations land: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single bounded ticket; one agent context, evidence-driven. ALL blockers verified+integrated (B01,B03,I07,I08,C07,C08,C09,K04,G06,M04,A03,F04,F07,F08,F10,R08,T16,P03,V02).

**Goal:** Every B01 difference row names a resolved canonical commit/check; deleting `apps/openmuse-mobile` leaves Web/iOS/Android builds green and no import/CI/config reference to the copy remains.

**Architecture:** (1) Update the B01 manifest's `resolved commit` column — each non-identical row now maps to a landed canonical artifact (the openbot module/ticket that superseded it, or canonical parity commit); regenerate the manifest with resolution annotations (the script's annotate table extended — status column notes "resolved-by <ticket/module>"; identical rows trivially resolved); archive the final manifest. (2) Delete `apps/openmuse-mobile/` (git rm --cached + filesystem removal — NO COMMIT: stage the deletion? NO — uncommitted protocol: remove the directory from the worktree filesystem only and record `git status` evidence; the copy is TRACKED so removal shows as deletions in `git status` — that IS the checkpoint; do not stage). (3) Reference scan: `rg -l "openmuse-mobile" --glob '!apps/openmuse-mobile/**'` over the whole worktree (server, app, docker, CI configs, docs) — fix any live references found (cite each); historical docs mentioning the path are fine (record the distinction). (4) Three clean exports: from the scratch-checkout recipe (B02/B03 pattern) — web + ios + android at the pin (the submodule provides the client; the copy's absence must not break OpenBot's own build either: `bun install && bun run build` in the scratch). (5) Evidence file.

**Spec:** Contracts §1 + catalog B04; Issue #93. S41 is the live card.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base (+ /tmp/b04-clean-checkout). NO commits; NO staging (the filesystem removal + git status evidence is the checkpoint).
- Owned files: docs/openmuse-v4/b01-build-inventory.py (annotate table + regeneration), docs/openmuse-v4/b01-copied-client-inventory.md (resolved column), docs/openmuse-v4/b04-removal-evidence.md (new), apps/openmuse-mobile/ (deletion), plus any live-reference fixes the scan finds (cite each).
- The submodule apps/openmuse and all openmuse-* modules are untouchable.

### Task 1: Resolve the manifest

- [ ] Extend the annotate table: every non-identical row gets a resolution ("canonical-parity <commit/hash>" where the canonical tree now matches, or "superseded-by <ticket> — adaptation lives in <canonical module/file>"; cite file:line for supersessions). Regenerate; --verify 4 OK.

### Task 2: Remove + scan

- [ ] Remove apps/openmuse-mobile from the worktree filesystem; `git status --porcelain | grep openmuse-mobile | head` recorded (unstaged deletions);
- [ ] `rg -l "openmuse-mobile"` outside the copy — classify live (fix, cite) vs historical-doc (record); zero live references at the end.

### Task 3: Three clean exports

- [ ] Scratch checkout (B02 recipe, pin 46792335): `git submodule update --init --recursive` (the copy is absent — it was tracked in OpenBot HEAD; the scratch checks out HEAD where the copy EXISTS. IMPORTANT: perform the scratch at the worktree's CURRENT state — copy the worktree minus the removed dir (rsync exclude apps/openmuse-mobile + node_modules) instead of a git clone, so the removal is what's tested; record this method); pnpm web/ios/android exports + `bun install && bun run build` all green.

### Task 4: Evidence + Checkpoint

- [ ] b04-removal-evidence.md: resolved-manifest summary counts, deletion git status, scan classification, four build logs' tails, UTC. Report with shasum. No commit.

## Failure handling

- A live reference that cannot be fixed without touching an untouchable module → record as a blocker row in the evidence and leave the reference (do not force).
