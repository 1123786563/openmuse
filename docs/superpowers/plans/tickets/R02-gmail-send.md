# R02 — Approve and send one Gmail message: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessors R01+M03 verified+integrated.

**Goal:** Approving a Gmail send proposal executes the REAL send path: the proposal shows exact recipient/subject/body/account (bound accountEmail + connectionGeneration); approve sends ONCE with a provider message id in the receipt; deny and 30-minute expiry send nothing (already proven at the seam — now with the Gmail executor); a disconnected account refuses before the provider call.

**Architecture:** Swap R01's fake for `gmail-send-executor.ts` in `openmuse-reviewed-actions/`: executes through the openmuse-mail client dial (alias-bound; placeholder action id `gmail.send` recorded per M01's discipline), maps provider success → succeeded with providerRef = provider message id, clean provider rejection → failed, timeout/ambiguity → outcome_unknown (R04 owns reconciliation UX). Proposal creation gains kind `gmail.send` validation (zod: to[], subject, body, accountEmail; canonical payload = the §6 serialization — already hash-stable). Construction: index.ts passes the gmail executor where the fake was (cite the TODO-cited seam R01 left).

**Spec:** Contracts §6 + catalog R02 (exact fields shown; approve once with provider id; deny/expiry zero sends); Issue #50.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Create server/src/openmuse-reviewed-actions/gmail-send-executor.ts; Modify server/src/openmuse-reviewed-actions/{service.ts (kind validation),routes.ts (proposal input schema for gmail.send)}, server/src/index.ts (ONE line: executor construction swap at R01's cited seam), server/tests/openmuse-reviewed-actions.test.ts. No migrations.
- CONCURRENT: P01 worker may edit index.ts (appended args at the createApp call tail) — your edit is the executor ARG inside openmuse-reviewed-actions' construction; re-read before editing; never touch openmuse-personal/*.
- Do NOT modify openmuse-mail/* (import its client/dial factory; if an export is missing, add ONE export line and note it).

### Task 1: RED — executor tests

1. proposal kind gmail.send validates exact fields; payloadHash stable across identical submissions (re-assert with the gmail shape);
2. approve happy → dial called ONCE with alias header + exact payload; receipt providerRef = provider message id; final succeeded;
3. deny → zero dial calls (re-assert with real executor wired); expiry → zero;
4. provider rejection (definite) → failed with detail; provider timeout → outcome_unknown (no retry — second decision returns settled);
5. disconnected (requireConnection) → 409 at DECISION time, zero dial calls;
6. account mismatch: proposal's accountEmail/generation vs current connection row → 409 stale (seam-level check the executor performs pre-dial).

### Task 2: GREEN

- Implement per matrix; wire in index.ts at the cited seam; `bun test tests/openmuse-reviewed-actions.test.ts tests/ready.test.ts tests/openmuse-mail.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: send action-id note, files + shasum, test tails, S19/F-MAIL-1/2 live notes deferred. No commit.

## Failure handling

- If the mail client's dial factory cannot be reused without edits, add the one export; if deeper changes are needed, STOP and ask.
