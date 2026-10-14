# O03 — Bound private computer capacity: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single bounded ticket; one agent context, TDD for the limiter seam. Predecessors O02+K03 verified+integrated.

**Goal:** §10 capacity bounds for the 1–20 profile: max 20 concurrent active private computers (the 21st start queues/refuses visibly with a capacity response); 15-minute idle stop; 2 GiB per-Bot workspace disk cap (write above refuses with a visible quota error); no cross-user effects.

**Architecture:** A `computerCapacity` limiter at the computer start path (Task 0: cite where private computers start — the gateway's start/computer-provider path): (1) active-count check against the provider's list (running computers) vs env `OPENMUSE_MAX_ACTIVE_COMPUTERS` default 20 → excess start returns a typed capacity refusal (503 with a stable code) surfaced by routes; (2) idle stop: a sweep stopping computers idle >15 min without run or human control (env `OPENMUSE_COMPUTER_IDLE_MINUTES`; consult the control state's holder/last-activity — cite the seam; workspace state persists per the provider's stop semantics); (3) disk cap: per-Bot workspace quota check before writes (env `OPENMUSE_COMPUTER_DISK_GIB` default 2) — provider du/usage seam per Task 0; refusal is a typed quota error. Baseline script: document the three envs (no new service).

**Spec:** Contracts §10 table rows 1-3; catalog O03; Issue #90. S42 is the live card.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Create server/src/computer/capacity.ts, server/tests/computer-capacity.test.ts; Modify the cited start/write touchpoint file(s) minimally + baseline script env docs (comments). Never touch openmuse-deletion/connectors/files (concurrent worker).

### Task 0

- [ ] Cite: where a computer starts (gateway/provider method), where workspace writes land (F09's seam), and where idle/holder state is readable (K03's control store) — file:line each.

### Task 1: RED — limiter tests (fakes)

1. 21st start with 20 running → typed capacity refusal (503/code), zero starts; 20th passes; freed slot allows again;
2. idle sweep: computer idle 16 min without run/control → stop called; 14 min → not; active control/run resets the clock;
3. disk: write when usage+payload > 2 GiB → typed quota refusal, no write; under → passes;
4. cross-user: another user's computers count only via the GLOBAL active count (they share the cap — record this reading of §10's deployment-wide bound) but never appear in each other's workspaces.

### Task 2: GREEN

- Implement per matrix (Task 0 citations); per-file tests green; typecheck + biome clean.

### Task 3: Checkpoint

- Report: Task 0 citations + the deployment-wide-cap reading, files + shasum, test tails, S42 deferred note. No commit.

## Failure handling

- If the provider exposes no usage/du seam, implement the check against recorded byte totals (F09/attachments write paths) and record the approximation.
