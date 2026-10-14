# F04 — Use Files on iOS: Execution Report

Plan: docs/superpowers/plans/tickets/F04-ios-files.md (GitHub issue #42, catalog F04).
Worktree: /Users/wuyongjun/trea/openmuse/.worktrees/v4-base · branch v4/openbot-exec · NO commits made.

## Binary-helper note (client.ts)

One export added: `openbotFetchBinary(path, init) → Promise<Response>`. The shared transport
(path check, native Cookie header / web credentials, 20s timeout, full !ok error mapping
incl. the 401 hook) was extracted into an internal `sendAndCheck(path, init, accept, isWrite)`;
`openbotFetch` and `openbotFetchBinary` are now two thin callers of it (JSON parse vs raw
stream). Behavior of every existing JSON route is unchanged — the whole pre-existing
openbot-client/api test suite still passes byte-for-byte semantics. `openbotFetchBinary`
always maps 408/5xx to `unavailable` (read semantics).

## Files + shasum (sha256, first 16 hex)

```
736062ea1380786c  apps/mobile/src/openbot/file-cache.ts   (new — pure seam)
63728f3ca01b54b9  apps/mobile/src/openbot/files.tsx       (new — screen + RN adapter)
27510beca3f06975  apps/mobile/src/openbot/api.ts          (fetchFiles, fileContentUrl, downloadFile)
bf1a3f8f6aa28aa9  apps/mobile/src/openbot/client.ts       (openbotFetchBinary + sendAndCheck extraction)
64eacd29b90706bc  apps/mobile/src/openbot/types.ts        (openBotFile(s)Schema)
caf7b95713cb7416  apps/mobile/test/openbot-file-cache.test.ts (new — 13 tests)
4eb810204e0bd116  apps/mobile/App.tsx                     (文件 entry: FolderOpen icon, overlay toggle)
```

Untouched per constraints: chat/channels/config/auth/gate/private-state/computer/task/
calendar/connections (private-state.ts is imported, not edited). package.json/pnpm-lock
modifications predate this dispatch (earlier tickets, uncommitted in this worktree).

## TDD record

RED first: the new test file failed (module absent) while the other 630 tests passed.
GREEN after implementing the seam + api/client; final full suite 643/643.

### openbot-file-cache.test.ts tail (13/13 pass)

```
✔ deriveCachePath maps fileId+extension into openmuse-files under the cache directory
✔ deriveCachePath refuses path traversal in the fileId
✔ deriveCachePath sanitizes the extension so it can never carry a separator
✔ extensionFor prefers the name's suffix, falls back to the mime map, then bin
✔ classifyCache: same versionId is a hit; different or absent is a miss
✔ ensureCached writes via temp+rename to the derived path and records etag/sha/size
✔ a versionId change classifies the cache stale and forces a re-download
✔ a mid-write failure never reports a complete download
✔ bytesLengthOfBase64 counts bytes, not characters
✔ logout sweep: clearNativePrivateState deletes a downloaded cache file (I07 registry)
✔ fetchFiles lists the owner's files and passes the cursor through
✔ fetchFiles surfaces 401 and 404 through the shared error mapping
✔ fileContentUrl builds the authenticated content route and downloadFile returns the raw Response
ℹ tests 13  pass 13  fail 0
```

### Full-suite tail

```
ℹ tests 643  pass 643  fail 0  (pnpm test)
```

## Verification

- `pnpm test` → 643/643 pass.
- `pnpm --dir apps/mobile typecheck` → exit 0.
- `pnpm lint` (biome check .) → exit 0 (one pre-existing info: biome config expects 2.5.15, found 2.5.13 — not from this ticket).
- `pnpm build:ios` tail:

```
iOS Bundled 3618ms apps/mobile/index.js (3530 modules)
› ios bundles (1):
_expo/static/js/ios/index-41816876c1c146c23a944a0e8d748d34.hbc (9.05 MB)
Exported: dist/ios
```

## Seam design (pure, no react-native/expo imports)

- `deriveCachePath(cacheDir, fileId, ext)` → `<cache>/openmuse-files/<fileId>.<ext>`;
  refuses `/`, `\`, `..`, `.` and empty ids (invalid_input); extension collapsed to
  [a-z0-9] (default bin) so it can never carry a separator.
- Staleness: sidecar `<path>.json` records `{versionId, sha256, etag, size, downloadedAt}`;
  `classifyCache` hits only on exact versionId match (versions immutable per contracts §5).
- Completeness: bytes write to `<path>.part` → rename → then meta. Mid-write failure
  cleans the temp and leaves no final file/meta; crash between rename and meta write
  simply re-downloads (meta absent → miss).
- `ensureCached(file, {cacheDirectory, fetchBytes, fileSystem, now?})` — fs + byte fetch
  fully injected; the RN adapter (expo-file-system/legacy, lazy `require` probe like
  private-state.ts) lives in files.tsx, along with the Response→base64 chunked conversion
  (RN has no Buffer; documented adapter per the plan's failure-handling note).

## Scoping notes

- **Preview deferral (F07/F08):** 打开 shows the size + SHA-256 (+ downloadedAt)
  confirmation card of the landed bytes only. Image/PDF preview screens are F07/F08's.
  S27 (open original + transfer copy twice) therefore remains open with F07/F08/F09.
- **S23 (iOS column) status:** the list/download/logout-clear mechanics S23 needs are
  implemented and unit-verified (logout sweep: written cache file + sidecar deleted by
  `clearNativePrivateState`, I07 registry); live-device evidence (upload/rename/delete +
  old-URL refusal end-to-end on a real iOS session) belongs to the verifier group, and
  the F01/F02/F03 server endpoints are not present in this execution worktree (client was
  built against contracts §5 + F01/F02 ticket plans: list `{files:[{id,name,mimeType,size,
  sha256,versionId,createdAt}], nextCursor}`, content route ETag `sha256:<digest>`).
- `fileContentUrl` returns the absolute authenticated URL for F07/F08 viewers (never a
  shareable link); `downloadFile` rides the internal path through the shared transport.
- Web: no cacheDirectory → download button disabled with a hint (移动端 only for local cache).
