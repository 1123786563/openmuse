# B01 — Inventory copied-client differences: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: this is a single-bounded-task ticket plan; execute it in one agent context following the steps below. Steps use checkbox (`- [ ]`) tracking. Spec and contracts travel with this plan: read the files named under Spec.

**Goal:** Produce a complete, reviewed reconciliation manifest of every difference between OpenBot's copied client `apps/openmuse-mobile` and the canonical OpenMuse client `apps/mobile`, as required by Issue #2 (B01) and contract §1 "Source reconciliation".

**Architecture:** Read-only comparison of two source trees. No production code changes. Output is one Markdown table plus one machine-readable JSON, both stored in the OpenBot execution worktree. Each difference row gets: copied path, canonical path, content difference hash, classification (identical / adapted-intentionally / canonical-only / copied-only / diverged), intent (what the copied change was for, citing MIGRATION.md or code), target Ticket (from the v4 catalog), and resolved-commit placeholder `null`.

**Tech Stack:** plain shell (`git hash-object`, `diff`, `find`), Python 3 for the manifest builder. No app builds.

**Spec:**
- /Users/wuyongjun/trea/openmuse/.worktrees/v4-base/docs/superpowers/plans/2026-10-12-openmuse-openbot-contracts-v4.md (§1 Build and source boundary, §2 client state inventory)
- /Users/wuyongjun/trea/openmuse/.worktrees/v4-base/docs/superpowers/plans/2026-10-12-openmuse-openbot-ticket-catalog-v4.md (B01, B02, B03, B04 entries)
- /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base/apps/openmuse-mobile/MIGRATION.md (copied tree's own migration notes)
- Issue #2 body: https://github.com/1123786563/openmuse/issues/2 (same acceptance as catalog)

## Global Constraints

- Work ONLY inside /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base (OpenBot execution worktree). The canonical tree is read-only at /Users/wuyongjun/trea/openmuse/.worktrees/v4-base. NEVER modify either `apps/mobile` or `apps/openmuse-mobile` source files.
- NEVER write to /Users/wuyongjun/trea/openmuse or /Users/wuyongjun/trea/OpenBot main checkouts (user changes live there).
- NO git commits, NO branch switches. Deliverable files are uncommitted in the OpenBot execution worktree.
- Canonical baseline is commit 1ac68f3 exactly (already checked out in the OpenMuse v4-base worktree). Copied baseline is 748f91ad.
- The only new files you create: `docs/openmuse-v4/b01-copied-client-inventory.md`, `docs/openmuse-v4/b01-copied-client-inventory.json`, and a helper script `docs/openmuse-v4/b01-build-inventory.py` (re-runnable).
- File difference hash definition (record verbatim in manifest header): `sha256( ("identical"|"differs") + "\n" + unified_diff_text )` where unified_diff_text is `diff -u canonical copied` output; for copied-only/canonical-only rows use the whole-file sha256 with the marker `copied-only`/`canonical-only`. Hashes must be reproducible by re-running the script.

---

### Task 1: Enumerate both trees

**Files:**
- Create: `docs/openmuse-v4/b01-build-inventory.py`
- Output: none yet

**Interfaces:**
- Consumes: directory trees `apps/openmuse-mobile` (71 files, excl. node_modules) and `apps/mobile` (54 files, excl. node_modules).
- Produces: file list per side, relative paths, mime-ish kind (source/test/config/asset/lockfile/doc).

- [ ] **Step 1: Write the enumerator inside `b01-build-inventory.py`**

Script skeleton (complete it, do not change the contract):

```python
#!/usr/bin/env python3
"""B01 reconciliation inventory builder. Read-only on both trees."""
import hashlib, json, os, subprocess, sys
from pathlib import Path

COPIED = Path("/Users/wuyongjun/trea/OpenBot/.worktrees/v4-base/apps/openmuse-mobile")
CANON = Path("/Users/wuyongjun/trea/openmuse/.worktrees/v4-base/apps/mobile")
OUT_MD = Path("/Users/wuyongjun/trea/OpenBot/.worktrees/v4-base/docs/openmuse-v4/b01-copied-client-inventory.md")
OUT_JSON = Path("/Users/wuyongjun/trea/OpenBot/.worktrees/v4-base/docs/openmuse-v4/b01-copied-client-inventory.json")

EXCLUDE_DIRS = {"node_modules", ".expo", "android", "ios"}  # build/native output dirs if present

def walk(root: Path):
    files = {}
    for p in sorted(root.rglob("*")):
        if p.is_dir():
            continue
        rel = p.relative_to(root).as_posix()
        if any(part in EXCLUDE_DIRS for part in Path(rel).parts[:-1]):
            continue
        files[rel] = p
    return files
```

- [ ] **Step 2: Run the enumerator and verify counts**

Run: `cd /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base && python3 docs/openmuse-v4/b01-build-inventory.py --list-only`
Expected: prints two file lists; copied count == 71 files (excluding node_modules), canonical count == 54. If counts differ, STOP and re-check EXCLUDE_DIRS against the actual trees (`find apps/openmuse-mobile -type f -not -path '*/node_modules/*' | wc -l`).

### Task 2: Diff, classify, and hash every path pair

**Files:**
- Modify: `docs/openmuse-v4/b01-build-inventory.py` (add diffing/classification)

**Interfaces:**
- Consumes: Task 1 lists.
- Produces: JSON rows with schema:
  `{"copied_path": str|null, "canonical_path": str|null, "status": "identical"|"diverged"|"copied_only"|"canonical_only", "difference_hash": str, "kind": str, "intent": str, "target_ticket": str|null, "resolved_commit": null}`

Classification rules (apply exactly):
1. Same relative path, identical bytes → `identical` (no intent row needed beyond "in sync").
2. Same relative path, different bytes → `diverged`.
3. Only in copied tree → `copied_only`.
4. Only in canonical tree → `canonical_only`.
5. `packages/domain/**` in copied tree: compare each file against canonical `apps/mobile/src/**` AND OpenMuse monorepo `apps/mobile/src` vendored equivalents; if a canonical counterpart exists anywhere under the OpenMuse repo (search `/Users/wuyongjun/trea/openmuse/.worktrees/v4-base/apps/mobile` then `/Users/wuyongjun/trea/openmuse/.worktrees/v4-base/packages`), map it and classify relative to THAT path.

- [ ] **Step 1: Implement diff+hash per the header rule; emit JSON**
- [ ] **Step 2: Run script; verify every path from BOTH trees appears in exactly one row**

Run: `python3 docs/openmuse-v4/b01-build-inventory.py`
Expected: JSON with `rows == 71 ∪ 54` distinct path pairs; `len(identical)+len(diverged) == |intersection|`; a `--verify` mode re-runs and asserts set equality (write this assertion into the script; it must pass).

### Task 3: Intent + target Ticket annotation

**Files:**
- Modify: `docs/openmuse-v4/b01-copied-client-inventory.json` (intent/target_ticket fields) — via an `--annotate` table inside the script (keep annotations IN the script so the manifest is regenerable, do not hand-edit JSON).

**Interfaces:**
- Consumes: MIGRATION.md, catalog ticket IDs (B02,B03,B04,I01–I09,C01–C09,K01–K04,G01–G06,M01–M04,A01–A03,F01–F10,R01–R08,T01–T16,P01–P03,V01–V02,D01–D09,O01–O05).
- Produces: every non-`identical` row with non-empty `intent` and a `target_ticket` (or the literal string `"B04-cleanup"` for rows whose only resolution is deletion during B04, or `null` ONLY if you document why in the MD file's "Unmapped rows" section).

Annotation guidance (verify by reading the actual files, do not trust this list blindly):
- `MIGRATION.md`, `bun.lock`, `README.md` differences → informational; intent "copied-tree bookkeeping"; target B04.
- `api.ts`, `api-response.ts`, `App.tsx` auth/transport adaptations (Bearer/OpenBot endpoints) → intent "OpenBot transport adaptation"; target I01 (or I04/I05 for native session specifics).
- `agent-workspace.ts`, `computer-status.ts` etc. if they reference OpenBot computer gateway → K01–K04 as fits.
- Canonical-only files (present in 1ac68f3, missing from copy) → intent "not yet ported"; target the feature ticket owning that screen (use the catalog; e.g. PdfReader* → F05–F08; mail-tool-card → M01; DateFields/DateTimeEditor → A03 or C-paths as fits; when genuinely ambiguous, choose the ticket whose acceptance names the behavior and note the ambiguity in intent text).

- [ ] **Step 1: Add `--annotate` data (dict path→(intent, ticket)) covering EVERY non-identical row**
- [ ] **Step 2: Re-run script; assert no non-identical row lacks annotation** (script must fail loudly otherwise)

### Task 4: Markdown manifest + self-checks

**Files:**
- Create: `docs/openmuse-v4/b01-copied-client-inventory.md`

- [ ] **Step 1: Script emits the MD table** with columns `copied path / canonical path / status / difference hash (first 12) / intent / target Ticket / resolved commit (null)`, grouped by status, plus header recording: both BASE SHAs (canonical 1ac68f3, copied 748f91ad), file counts, the hash rule text from Global Constraints, generation timestamp UTC, and the exact command to regenerate.
- [ ] **Step 2: Coverage self-check in script** — assert: (a) union coverage of both trees, (b) every row has difference_hash, (c) every non-identical row annotated, (d) counts printed match walk() counts. All four must print `OK`.
- [ ] **Step 3: Run and capture output**

Run: `python3 docs/openmuse-v4/b01-build-inventory.py && python3 docs/openmuse-v4/b01-build-inventory.py --verify`
Expected: both runs exit 0; four `OK` lines; MD and JSON exist; `git -C /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base status --porcelain` shows exactly 3 new untracked files under docs/openmuse-v4/.

### Task 5: Checkpoint report (no commit)

- [ ] **Step 1:** `shasum -a 256 docs/openmuse-v4/b01-*` and record the three hashes in your final report message. Do not commit.

## Acceptance (from Issue #2 / catalog B01)

- Read-only reconciliation table covers every copied client path, vendored domain, Metro config, tests, assets and lockfiles; each difference has intent, owner Ticket and resolution; no unresolved row silently discarded. Verified by: script `--verify` pass + reviewer reading the MD manifest against the trees.

## Failure handling

- If a canonical counterpart for a copied-only file cannot be determined, keep the row `copied_only` with intent "no canonical counterpart found: <one-line reason>" and target B04 — never delete the row.
- If the OpenMuse worktree is not at 1ac68f3 (`git -C <path> rev-parse --short HEAD`), stop and report; do not proceed against an unknown baseline.
