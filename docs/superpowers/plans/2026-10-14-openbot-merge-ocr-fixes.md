# OpenBot Merge OCR Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the three valid medium OCR findings before merging `v4/openbot-exec` into `main`.

**Architecture:** Keep behavior fixes local to the three affected OpenBot screens. Prefer extracting a small pure decision only where it enables an observable Node test; otherwise pin behavior with the closest existing test seam and verify the component source through typecheck and focused tests.

**Tech Stack:** React Native, Expo, TypeScript, Node test runner.

**Spec:** `/tmp/ocr-openmuse-openbot-main-merge.md` (session `221ac338-7609-4488-901d-0f8aa7b78ba5`), OpenBot mobile requirements in `docs/superpowers/plans/2026-10-12-openmuse-openbot-acceptance-v4.md`.

## Global Constraints

- Preserve zh-CN user copy and the existing OpenBot module boundaries.
- Do not add dependencies or change server/API contracts.
- Every changed behavior needs a focused regression test where an existing seam makes that possible.
- `pnpm test`, `pnpm typecheck`, and `pnpm lint` must remain green.

## Review Focus

- Task refresh while a detail is open must reload the displayed detail, not only the hidden list.
- Calendar pagination must preserve `nextCursor` and `truncated` when the row limit is reached on the first page.
- Computer staleness must not force a whole-screen render every second or compute time during render.
- Regression fixes must not leak prior-bot state, duplicate network work, or introduce unhandled promise rejections.

### Task 1: Fix three medium OCR findings

**Files:**

- Modify: `apps/mobile/src/openbot/tasks.tsx`
- Modify: `apps/mobile/src/openbot/calendar.tsx`
- Modify: `apps/mobile/src/openbot/computer.tsx`
- Modify as needed: `apps/mobile/test/openbot-task-view.test.ts`
- Modify as needed: `apps/mobile/test/openbot-calendar-view.test.ts`
- Modify as needed: `apps/mobile/test/openbot-computer-state.test.ts`

**Interfaces:**

- Consumes existing `fetchTaskDetail(id)`, calendar page `{ events, nextCursor, truncated }`, and `isComputerStale(...)`.
- Produces no new public module exports unless required for the focused test seam.

**Steps:**

- [x] Add focused failing tests for task refresh target selection, first-page calendar truncation, and computer staleness state transition where practical.
- [x] Make the task Refresh button call `open(detail.id)` while a detail is displayed, otherwise call `load()`.
- [x] Store `cursor = page.nextCursor` and merge `page.truncated` before the row-limit `break`.
- [x] Move computer staleness evaluation into its interval callback and store only the resulting boolean state; avoid whole-screen clock-driven re-renders.
- [x] Run focused tests, then `pnpm test`, `pnpm typecheck`, and `pnpm lint`.
- [x] Report changed files, exact commands, and test evidence without committing.

## Execution Record

- Dedicated `frontend_implementer` dispatch failed because its configured `gpt-6-luna` model is unavailable in this runtime; `default` inheritance also failed. The controller executed the bounded frontend fix locally under systematic debugging and TDD.
- RED evidence: full suite reported 3 expected failures (712 pass / 3 fail), one per medium finding.
- GREEN evidence: focused suite 38 pass / 0 fail; full suite 715 pass / 0 fail; `pnpm typecheck` passed; `pnpm lint` exited 0 with the pre-existing schema-version info and broken `.codegraph` symlink warning.

**Acceptance:**

- All three medium findings are eliminated.
- Existing tests continue to pass and new regression tests cover the corrected logic.
- No unrelated low findings or refactors are mixed into this fix.
