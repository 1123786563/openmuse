# F08 — View original and filled PDF on Android: Execution Report (Issue #47)

Plan: `docs/superpowers/plans/tickets/F08-android-pdf-view.md` — executed exactly (F07's Android twin; Task 0 audit with citations). No commits (per plan).

## Task 0: Audit verdict — **NO Android delta** (the finding, with citations)

1. **PdfReader.native renders the Android path unchanged** — `apps/mobile/src/PdfReader.native.tsx:61-69` feeds `react-native-pdf` `source={{ uri: url, headers: …, cache: false }}`; `react-native-pdf@7.0.5` README's source.uri support table (`apps/mobile/node_modules/react-native-pdf/README.md:398`) documents `{uri:"file:///absolute/path/to/xxx.pdf"}` — load pdf from local file system — as ✔ iOS / **✔ Android** / ✔ Windows (line 299's `file:///sdcard/test.pdf` example is Android). `deriveCachePath` returns exactly that form (`<cacheDirectory>/openmuse-files/<fileId>.pdf`, a `file://` URI), so the `openedPath` PdfReader receives on Android is the documented-supported one. The `Authorization` header stays inert on a `file://` source and `pageCount` self-corrects via `onLoadComplete` (F07's recorded finding; `pdf-view.tsx:204-210`).
2. **Cache adapter resolution is platform-free** — `apps/mobile/src/openbot/files.tsx:67-89` `nativeCacheAdapter` requires `expo-file-system/legacy`, guards only `if (!fs.cacheDirectory) return null` (web-null), no `Platform` import or OS branch; `expo-file-system/build/legacy/types.d.ts:13` declares the single `cacheDirectory: string | null` (Android resolves `file:///data/user/0/<pkg>/cache/`, iOS its Containers path). The viewer's `useState(nativeCacheAdapter)` (`pdf-view.tsx:66`) inherits whatever the OS resolved.
3. **F10's finding (no delta) holds in-tree** — F10's Android pins run green in the same suite: `apps/mobile/test/openbot-file-cache.test.ts:247-321` pins `file:///data/user/0/com.openmuse.app/cache/` (download lands under the Android root, I07/I08 sweep clears bytes+sidecar+deep siblings, B-user fresh start) — the F04 seam `pdf-view-state.openPdfVersion` wraps (`ensureCached`) is the same platform-parameterized seam, already proven over the Android directory.
4. **Import scan (C09's method mirrored)** — zero `Platform` references in `pdf-view.tsx` / `pdf-view-state.ts` / `files.tsx` (grep: no matches); no `*.android.*` / `*.ios.*` split files under `apps/mobile/src/openbot/` (the only platform split is `src/PdfReader.{native,web}.tsx`, shared by both mobile OSes).

Per the plan's failure-handling clause: **no delta IS the finding** — zero source changes; only Android-named regression pins were appended to the owned test file.

## Changed files (+ shasum)

| File | Status | shasum |
| --- | --- | --- |
| `apps/mobile/test/openbot-pdf-view-state.test.ts` | modified (§6 Android pins appended, 3 tests) | `2e331f5a8251c7528d259929053e499d0e438f2a` |
| `apps/mobile/src/openbot/pdf-view.tsx` | UNTOUCHED (no delta) | `ed61d4c1946a90c6b55e550845f4064332ade78c` |
| `apps/mobile/src/openbot/pdf-view-state.ts` | UNTOUCHED (no delta) | `6c95439d9c6edd20a34bdfe038af7535a52ba8ad` |
| `apps/mobile/src/openbot/files.tsx` | UNTOUCHED (cited only) | `735068e49c72a2547a664d86d41fc311965ac55b` |

No other files touched.

### Android pins added (GREEN immediately — no real gap, so no RED; C09 precedent)

- `android: open lands the selected version under the Android cache root as a file:// URI` — the exact URI PdfReader receives on Android (the README-documented form) with verified meta.
- `android: 401 refusal deletes that version's bytes+sidecar under the Android cache root` — stale-refusal protocol over the Android directory (fill lands → new version is a miss → expired session refuses → cache cleared, no stale render).
- `android: switching to the filled copy re-downloads into the same Android slot` — one slot per file; the version switch replaces bytes at the same Android path.

## Verification

- `pnpm test`: **tests 682 / pass 682 / fail 0** (679 before + 3 new F08 pins).
- `pnpm typecheck` (`tsc --noEmit` root + mobile): clean.
- `pnpm lint` (biome): `Checked 230 files … Found 1 info` — the pre-existing `biome migrate` config-version notice (same as C09's run); no errors, none from these files.
- `pnpm build:android` tail:
  ```
  › android bundles (1):
  _expo/static/js/android/index-d43bb659b1be9e5157b66a334a4c0f21.hbc (9.04 MB)

  › Files (1):
  metadata.json (212 B)

  Exported: dist/android
  ```

### F08 pin tail (from the full suite)

```
✔ android: open lands the selected version under the Android cache root as a file:// URI (0.576875ms)
✔ android: 401 refusal deletes that version's bytes+sidecar under the Android cache root (0.3315ms)
✔ android: switching to the filled copy re-downloads into the same Android slot (1.05325ms)
```

## Deferred

- **S27-A live-device row deferred** per plan (viewing original + filled PDF on a physical Android device is gate-pass live evidence). Deployment note (I05, still applies): physical devices need `EXPO_PUBLIC_OPENBOT_URL` set to the host's LAN address; the emulator default only covers `10.0.2.2`.
- F07's server-side gap still stands for F08 too: `GET /:id/versions` and version-scoped `/content?versionId=` are not shipped server-side yet; the client degrades safely (original-only, ETag-guarded). No commit made.
