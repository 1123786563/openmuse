# O02 — Deploy OpenConnector and OAuth callback: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single bounded ticket; one agent context, evidence-driven (TDD where code changes). Predecessors O01+G03 verified+integrated.

**Goal:** The baseline environment can stand up OpenConnector beside the OpenBot API: the OAuth callback reaches the configured public origin; connector runtime/admin interfaces are backend-restricted; no secret enters the mobile bundle; the G01 flow's vendor calls are configurable end-to-end.

**Architecture:** Extend the baseline stack: (1) `scripts/openmuse-v4-baseline.sh` gains an optional OpenConnector service (`up` starts an open-connector container on OPENMUSE_V4_CONNECTOR_PORT default 55441 — Task 0: find the official image (docker hub oomol/open-connector or build from the public repo; cite; if no ready image exists, document the docker build path from the repo and make the script support `CONNECTOR_IMAGE` override) with OOMOL_CONNECT_ORIGIN + OOMOL_CONNECT_ENCRYPTION_KEY set to generated values; (2) the OpenBot server's OPENCONNECTOR_URL wiring is exercised live: boot with the connector URL, call /ready, and record the connector's /api/providers reachable from the server container network only (127.0.0.1 binding); (3) OAuth callback origin: document + set OPENBOT_PUBLIC_ORIGIN in the baseline env so G01's client-config redirectUri resolves (evidence: the oauth config PUT with the callback URL succeeds against the live connector); (4) secret scan: assert the mobile bundles (dist/web from the exec worktree) contain no client secret strings (rg patterns); (5) evidence file docs/openmuse-v4/o02-connector-deployment.md with every command + sanitized output.

**Spec:** Contracts §10 + catalog O02 (callback reaches configured public origin; connector backend-restricted; no secret in mobile bundle); Issue #89.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base + /tmp/openmuse-v4-baseline. NO commits.
- Owned files: Modify scripts/openmuse-v4-baseline.sh, server/src/openmuse-connectors/client.ts ONLY if the base-URL env name needs aligning (cite; prefer env-only), docs/openmuse-v4/o02-connector-deployment.md (new). Never touch openmuse-personal/deletion/tasks (concurrent workers).
- NEVER print secrets in evidence (generated keys referenced by path/journal, not value).
- Ports: connector 55441 (verify free first); existing baseline ports per O01.

### Task 0

- [ ] Cite the OpenConnector runtime's official distribution (docker image name or repo build path) from the vendor docs (https://github.com/oomol-lab/open-connector — README/configuration.md); record the chosen path.

### Task 1: Script + evidence

- [ ] Implement the connector service + `up/down/status` integration; generated encryption key stored under /tmp/openmuse-v4-baseline/connector.key (0600) — value never echoed;
- [ ] Full cycle: `up` → OpenBot /ready 200 with OPENCONNECTOR_URL set → connector /api/providers answers on 127.0.0.1 only (bind check from a non-loopback attempt fails) → oauth config PUT (clientId dummy, redirectUri = ${OPENBOT_PUBLIC_ORIGIN}/api/mobile/openmuse-google/callback) succeeds → secret scan of dist/web (rg -c for the dummy id + key patterns = 0 matches) → `down` clean;
- [ ] Evidence file with all outputs (sanitized) + Task 0 citation.

### Task 2: Verification

- [ ] `bash -n scripts/openmuse-v4-baseline.sh` clean; existing baseline cycle (postgres+api only) still works after the change; typecheck+biome on any touched source file.

### Task 3: Checkpoint

- Report: Task 0 answer, files + shasum, cycle output tails, S15 live-consent note (real Google consent remains gate-level). No commit.

## Failure handling

- If no official image exists and a source build is impractical in this environment, implement the script's CONNECTOR_IMAGE override + document the manual build, run the cycle with the API-only fallback (connector absent → OPENCONNECTOR_URL unset → G01 503 path evidenced), and record the blocker honestly.
