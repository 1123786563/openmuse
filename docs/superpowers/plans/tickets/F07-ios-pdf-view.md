# F07 — View original and filled PDF on iOS: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single bounded client ticket; one agent context, TDD for pure seams. Predecessors F06+F04 verified+integrated.

**Goal:** From the Files screen, the owner can open BOTH the original and a filled version: the viewer renders from the owner-scoped cache (F04 seams) with authenticated bytes; an expired session or a deleted file fails WITHOUT displaying stale cached bytes; both versions' identity (versionId) is explicit in the UI.

**Architecture:** Client: reuse the canonical PdfReader (apps/mobile/src/PdfReader.{native,web}.tsx — Task 0: cite its props/entry) in a new `src/openbot/pdf-view.tsx` (version selector 原件/填充副本 + open action) + pure `src/openbot/pdf-view-state.ts` (version list from the file row's derived versions — F06 records parent+values: fetch the file's versions via the files list/detail; stale-cache invalidation on versionId change — reuse file-cache.ts; refusal classification: 401/404 → clear the local cached copy for that version before showing the error — never render stale bytes). Files screen gains the 打开预览 action for PDFs.

**Spec:** Contracts §5 + catalog F07; Issue #46. S27 live rows are gate evidence.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/openmuse/.worktrees/v4-base (OpenMuse exec worktree). NO commits.
- Owned files: Create apps/mobile/src/openbot/{pdf-view.tsx,pdf-view-state.ts}, apps/mobile/test/openbot-pdf-view-state.test.ts; Modify apps/mobile/src/openbot/{files.tsx (preview entry),api.ts (file versions fetch if the detail lacks them — check F01's DTO)}, App.tsx only if routing needs it.
- Do NOT touch chat/channels/config/auth/gate/private-state/computer/task/calendar/connections; do NOT modify the legacy PdfReader components (consume only).

### Task 0

- [ ] Cite PdfReader's entry props (how it accepts a local file path/URI) and whether the files detail DTO exposes version lists (F01/F06 shapes).

### Task 1: RED — seam tests

1. version list: original + derived versions with parent/labels (原件 / 填充副本 <versionId>); selection state;
2. stale refusal: 401/404 on open → the cached bytes for THAT version are deleted (injected fs asserts) and the error shows — stale render impossible;
3. version change → cache miss → re-download (file-cache reuse);
4. non-PDF file → preview entry absent.

### Task 2: GREEN

- Implement per matrix (Task 0 citations); `pnpm test && typecheck && lint` green; `pnpm build:ios` exports (record tail).

### Task 3: Checkpoint

- Report: Task 0 citations, files + shasum, test tails, build:ios tail, S27-I device row deferred. No commit.

## Failure handling

- If PdfReader needs a URI scheme the cache path can't satisfy, add a thin adapter (noted) rather than modifying the legacy component.
