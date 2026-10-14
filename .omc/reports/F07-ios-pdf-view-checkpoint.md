# F07 — View original and filled PDF on iOS: Checkpoint Report (Task 3)

No commit. Work only in the OpenMuse exec worktree; OpenBot server repo read-only for citations.

## Task 0 citations

**PdfReader entry props (consume-only, untouched):**
- `apps/mobile/src/PdfReader.native.tsx:6-10` — `PdfReaderProps { url: string; token: string; pageCount: number }`; feeds `react-native-pdf`'s `Pdf source={{ uri: url, headers: { Authorization: Bearer <token> }, cache: false }}` (line 63). Web twin `PdfReader.web.tsx:7-11` — same props, iframe `${url}#page=…`.
- Local-path support: react-native-pdf documents `{uri:"file:///absolute/path/to/xxx.pdf"}` on iOS (node_modules/react-native-pdf/README.md:398). expo's `cacheDirectory` is already a `file://` URI and `deriveCachePath` returns `file:///…/openmuse-files/<fileId>.pdf`, so **no adapter was needed** (plan's failure-handling branch not taken). The Authorization header is inert on a `file://` source; `pageCount` self-corrects via `onLoadComplete` (component passes 1).

**Files detail DTO does NOT expose version lists** (so the plan's conditional api.ts version fetch was executed):
- Mobile: `apps/mobile/src/openbot/types.ts:228-244` — `openBotFileSchema` carries id/name/mimeType/size/sha256/versionId/createdAt only.
- Server (read-only): `OpenBot/.worktrees/v4-base/server/src/openmuse-files/routes.ts:38-48` `fileJson` — same seven fields; routes = GET `/`, GET `/:id`, GET `/:id/content`, PATCH, DELETE, POST `/`, gmail import; `openmuse-documents/routes.ts` adds POST `/:id/{inspect,fill,transfer}`. **No versions-list route, no per-version byte route.**
- F06 version row shape: fill 201 body `{versionId, parentVersionId, sha256, size, values}` (`openmuse-documents/routes.ts:227-232`); upload's root version row has `parentVersionId` undefined (`store.ts` appendVersion/upload). DTO `versionId = latestVersion(fileId)` (`store.ts:196-213`) — flips to the derived version after a fill; `/content` serves the latest version's bytes with `ETag: sha256:<digest>`; the file row's `sha256` stays the original's by contract §5.

**Consequence (client-side guards, recorded):** until the server ships `GET /:id/versions` (and honors `?versionId=` on `/content`), `fetchFileVersions` answers not_found and the viewer degrades to the file row's current version (original-only). Wrong/newer bytes can never render mislabeled: the byte fetch verifies the ETag digest against the selected version's sha256 before the F04 cache writes anything, and refusals (401/404/invalid_response) delete that version's cached copy + sidecar and drop the render path.

## Files + shasum

```
65afc97729203886e7e367a99f574d76d4200c191f7cbe1013c65675b1c9a07e  apps/mobile/src/openbot/pdf-view.tsx        (new)
87532448ab92334d665c03a3ed8ca34060545f94ae5d266f222108ef3e2fd495  apps/mobile/src/openbot/pdf-view-state.ts   (new)
331153ed464ca409bed7b4c0d92ae6c4ac64ddfd2db179c50c4b9edc4399bcea  apps/mobile/test/openbot-pdf-view-state.test.ts (new)
b0b86038aaaf9f0db7a36088c17a8ec1b025c50127358bdaee1bfcf9814189ea  apps/mobile/src/openbot/files.tsx           (preview entry + exported adapter helpers)
db61502acac31cacf7b644c26e1cb9492b8b737aa4956480f5d2977442dd28f6  apps/mobile/src/openbot/api.ts              (fetchFileVersions, fileVersionContentUrl, downloadFileVersion)
```

App.tsx untouched (the viewer overlays inside the Files screen). Legacy PdfReader untouched. chat/channels/config/auth/gate/private-state/computer/task/calendar/connections untouched.

## Verification

- `pnpm test`: **679 pass / 0 fail** (13 new F07 seam tests).
- `pnpm typecheck`: clean (root + mobile).
- `pnpm lint` (biome): clean after `pnpm format` (format-only fixes).
- `pnpm build:ios`: exit 0 — `iOS Bundled 3265ms apps/mobile/index.js (3534 modules)` … `› ios bundles (1): _expo/static/js/ios/index-48db980e7da6ebbc2af810c424e66b08.hbc (9.08 MB)` … `Exported: dist/ios` / `[exited with code 0]`.

### F07 test tail

```
✔ 401 on open deletes that version's cached bytes and sidecar before the error shows
✔ 404 refusal clears the cache too, but network errors keep it for retry
✔ etagMatchesVersion: only the version's own digest verifies
✔ an ETag mismatch refuses before anything is cached — wrong bytes never land
✔ switching to another version classifies the cache stale and re-downloads
✔ canPdfPreview: only application/pdf
✔ fetchFileVersions calls the versions route and parses F06-shaped rows
✔ fetchFileVersions surfaces 404 as not_found and refuses an empty id
✔ fileVersionContentUrl scopes the content route by versionId
✔ downloadFileVersion returns the raw Response with its ETag
ℹ tests 13  ℹ pass 13  ℹ fail 0
```

(TDD: RED confirmed first — module-missing failure while the other 666 tests passed; then GREEN.)

## Deferred

- **S27-I device row deferred** (live device evidence, per plan).
- Server-side gap for the coordinator/OpenBot repo: `GET /api/mobile/openmuse-files/:id/versions` and version-scoped `/content?versionId=` do not exist yet; the client is already consuming that contract and degrades safely until they ship.
