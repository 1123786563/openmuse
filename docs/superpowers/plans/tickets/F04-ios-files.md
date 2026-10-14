# F04 — Use Files on iOS: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD for pure seams. Predecessors F02+I04 verified+integrated.

**Goal:** A Files screen on the OpenMuse app: list the owner's files (F01/F03 endpoints), download to an owner-scoped local cache with authenticated bytes (F02 content endpoint), open from cache; logout clears the cached bytes via I07's registry (pdfCachePaths already enumerates `<cache>/openmuse-files/**`).

**Architecture:** Client: `src/openbot/files.tsx` (FilesScreen: list + download + open) + pure `src/openbot/file-cache.ts` (cache path derivation `<cache>/openmuse-files/<fileId>.<ext>`, staleness by versionId mismatch → re-download, cache-hit vs miss classification). api.ts: fetchFiles (list), fileContentUrl helper + `downloadFile(file, authFetch)` using openbotFetch's raw response (binary) — Task 0: extend client.ts with a binary fetch helper if absent (one export). Open: image/PDF previews are F07/F08's; here "open" = confirm bytes landed + size/hash display (record the scoping). App shell entry 文件.

**Spec:** Contracts §5 Content access + catalog F04 (authenticated bytes and owner-scoped cache; list/download works; logout clears cached content and old URL access); Issue #42.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/openmuse/.worktrees/v4-base. NO commits.
- Owned files: Create apps/mobile/src/openbot/{files.tsx,file-cache.ts}, apps/mobile/test/openbot-file-cache.test.ts; Modify apps/mobile/src/openbot/{api.ts,client.ts (one binary helper if needed — note it),types.ts}, App.tsx (entry).
- Do NOT touch chat/channels/config/auth/gate/private-state/computer/task/calendar/connections files.

### Task 1: RED — seam tests

1. cache path derivation: fileId+extension → `<cache>/openmuse-files/<fileId>.<ext>` (path traversal: fileId with `/` or `..` sanitized/rejected — assert);
2. staleness: same versionId → cache hit; different → miss + re-download;
3. download flow (fake authFetch returning bytes): writes via injected fs to the derived path; ETag/sha from headers recorded; failure mid-write → partial file NOT reported as complete (temp name + rename pattern);
4. logout integration: clearNativePrivateState's pdfCachePaths covers the written path (fixture: write then clear → deleted);
5. api: fetchFiles lists with cursor; 404/401 surfaces.

### Task 2: GREEN

- file-cache.ts per matrix; api/client binary helper; files.tsx (list rows name/size/date, download button with progress state, 打开 shows size+sha confirmation — scoping note); App entry.
- `pnpm test && pnpm --dir apps/mobile typecheck && pnpm lint` green; `pnpm build:ios` exports (record tail).

### Task 3: Checkpoint

- Report: binary-helper note, files + shasum, test tails, build:ios tail, S23/S27 live notes + F07/F08 preview deferral. No commit.

## Failure handling

- If RN blob handling needs platform-specific APIs, keep the seam pure and inject the writer; record the adapter.
