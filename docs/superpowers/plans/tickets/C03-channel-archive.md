# C03 — Rename, archive and reopen a Channel: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD for pure seams. Predecessor C02 verified+integrated.

**Goal:** Rename a channel (display name); archive hides it from the active list but an Archived filter lists it and reopening restores the SAME threadId and history; a foreign rename/archive returns 404 (server-side — the client surfaces it).

**Architecture:** Client over existing server seams (Task 0: find rename/archive endpoints in server/src/channels/routes.ts — PATCH-like rename + archive/unarchive; cite paths and shapes; if archive is a status field on PATCH, use it). UI: per-channel actions (rename dialog, archive button), an Archived filter toggle on the channel list (query param or client-side filter per Task 0's answer — server cursor ordering must stay intact for the active list). Pure seam `channel-actions.ts` (rename validation, archive-state classification, reopened-identity assertion: same {id,threadId}).

**Spec:** Contracts §3 (archive hides from active list; Archived filter lists and reopens retaining threadId); catalog C03; Issue #16.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/openmuse/.worktrees/v4-base. NO commits.
- Owned files: Create apps/mobile/src/openbot/channel-actions.ts, apps/mobile/test/openbot-channel-actions.test.ts; Modify apps/mobile/src/openbot/{api.ts (renameChannel/archiveChannel/reopenChannel), channels.tsx (actions UI + archived filter)}, App.tsx only if state threading requires (minimal).
- Do NOT touch chat.tsx/config/auth/client/gate/private-state/computer/task files.

### Task 0

- [ ] Cite the server rename/archive endpoints (paths, verbs, payload, archived-listing mechanism — dedicated param/endpoint or field filter) from server/src/channels/routes.ts.

### Task 1: RED — seam tests

1. rename validation (1..80 chars, no control chars); archived classification: active/archived partition from a mixed workspace list; reopened identity: {id,threadId} unchanged across archive→reopen (fixture);
2. api tests: rename/archive/reopen call the Task-0 shapes; 404 surfaces not_found (foreign); 409 (if server says already-archived) surfaced as-is.

### Task 2: GREEN

- channel-actions.ts + api.ts per matrix; channels.tsx actions (长按/菜单 or buttons — zh-CN), Archived filter toggle preserving server order within each partition.
- `pnpm test && pnpm --dir apps/mobile typecheck && pnpm lint` green; `pnpm build:web` exports (record tail).

### Task 3: Checkpoint

- Report: Task 0 citations, files + shasum, test tails, build:web tail, S10 deferred note. No commit.

## Failure handling

- If the server has no archive endpoint at all, STOP and report (server gap → this ticket becomes server+client; needs coordinator approval).
