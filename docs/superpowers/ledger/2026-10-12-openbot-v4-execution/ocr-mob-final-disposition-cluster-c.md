# OCR mob-final confirming pass — cluster C disposition

Scope: all 12 findings of `ocr-mob-final-cluster-c.txt` (files.tsx ×2,
connections.tsx ×4, private-state.ts ×4, calendar.tsx ×1, calendar-view.ts ×1),
each re-verified against the current tree at `.worktrees/v4-base` (branch
`v4/openbot-exec`, prior uncommitted repair waves in place) before acting.
Nothing committed, per instruction.

Legend: **fixed** = code changed this pass; **fixed-before** = a prior wave
already repaired it (verified against current code, pinned test cited);
**invalid** = does not hold against current code.

## connections.tsx

| Finding | Verdict | Action | Evidence |
| --- | --- | --- | --- |
| connections.tsx:106-108 [bug·low] connect() 未纳入 requestSeq，finally 无条件 setBusy(false)，与 load/disconnect 并发时提前释放全局 busy | fixed | connect now takes `const seq = ++requestSeq.current` and guards its catch/finally like load/disconnect, so an early connect return no longer unlocks buttons while a load/disconnect is still in flight | `apps/mobile/src/openbot/connections.tsx:120-140` |
| connections.tsx:142-151 [style·low] 头部行静态内联样式应收敛进 StyleSheet.create | fixed | Header View's inline static style object moved to `styles.header` in the existing StyleSheet.create; email-signin.tsx's FieldError has the same pattern but is outside this cluster's ownership (dependency 1) | `apps/mobile/src/openbot/connections.tsx:57-65,163` |
| connections.tsx:117-122 [bug·low] 错误横幅固定标题把 connect/disconnect 失败误报为「状态读取失败」 | fixed | Error state is now `{title, detail}` per source: load → errorTitle, connect → openFailed (auth failure keeps its own sentence as title, detail empty), disconnect → new COPY.disconnectFailed；渲染处不再拼接固定前缀 | `apps/mobile/src/openbot/connections.tsx:28,77-79,99,133-139,155,182-185` |
| connections.tsx:224-232 [style·low] 操作按钮两层嵌套三元，建议早返回辅助 | fixed | ConnectionCard computes `action` via an if/else-if chain (disconnected/revoked → connect, connected/refresh_required → disconnect) before the JSX; render is one flat conditional | `apps/mobile/src/openbot/connections.tsx:226-232,246-256` |

## calendar.tsx / calendar-view.ts

| Finding | Verdict | Action | Evidence |
| --- | --- | --- | --- |
| calendar.tsx:59-62 [bug·med] load 缺少请求序号与取消守卫 | fixed-before | Current load already carries the full guard set: `requestSeq` + `abortRef`, per-page `controller.signal` into fetchCalendarEvents, seq-guarded setEvents/setError/setBusy, and `return () => abortRef.current?.abort()` in the effect cleanup | `apps/mobile/src/openbot/calendar.tsx:66-77,90,104-120` |
| calendar-view.ts:194-196 [bug·med] 脏数据兜底对 timed 事件存在 NaN 缺口 | fixed-before | eventRowView validates `Number.isFinite(instantOf(...))` for timed (and the all-day twin for `Date.parse`) and throws RangeError so the documented catch degrades to raw strings; formatDurationHours also short-circuits non-finite | `apps/mobile/src/openbot/calendar-view.ts:204-223,136`; pinned tests `openbot-calendar-view.test.ts:109` (NaN duration never renders NaN copy), `:116` (dirty events degrade to raw strings), `:226` (dirty all-day dates) |

## files.tsx

| Finding | Verdict | Action | Evidence |
| --- | --- | --- | --- |
| files.tsx:221-225 [style·low] 下载按钮两级嵌套三元 | fixed | Module-level `downloadAction(row, enabled, onDownload)` helper with early returns (cached → fact, downloading → busy copy, else the Pressable; failed rows re-offer the button beside their own error line, as before); render site is a single call | `apps/mobile/src/openbot/files.tsx:69-88,291` |
| files.tsx:86-90 [maint·low] load/download 无卸载取消，未透传 AbortSignal | fixed | Mount effect owns an AbortController stored in `abortRef`, aborts on cleanup; `load(signal?)` passes it to `fetchFiles(null, signal)` (api.ts supports the param), and download's byte fetch passes `abortRef.current?.signal` to `downloadFile(file, signal)` (ensureCached only writes after fetchBytes resolves, so an abort leaves no partial file) | `apps/mobile/src/openbot/files.tsx:126-131,161-169,180`; `apps/mobile/src/openbot/api.ts:459,486` |

## private-state.ts

| Finding | Verdict | Action | Evidence |
| --- | --- | --- | --- |
| private-state.ts:24-27 [sec·med] 注册表缺口：web 端 secureStorePrefix 下的插件 jar 清不到 | fixed-before | `webPrivateStorageKeys.prefixes` already includes `secureStorePrefix` with the explanatory comment (auth.ts wires the same storagePrefix into expoClient's localStorage storage on web) | `apps/mobile/src/openbot/private-state.ts:31-41`; pinned test `openbot-private-state.test.ts:70` "web registry covers the expo plugin jar" |
| private-state.ts:129 [style·low] import 语句位于文件中部，应上移 | fixed | `import { FILES_CACHE_DIR, joinUri } from "./file-cache"` moved from mid-file to the top import block (after ./config); the finding's suggested `import { openbotEndpoint }` already existed at top | `apps/mobile/src/openbot/private-state.ts:18-19` |
| private-state.ts:140-141 [bug·med] 顶层 infoAsync 的 `.catch(() => null)` 把探测 IO 失败当不存在，清扫静默 no-op | fixed-before | Root probe is now `await fs.infoAsync(dir)` with no catch — only `exists === false` counts as absent, probe/read failures propagate; the recursive per-entry probe keeps its catch (null falls into idempotent delete / failedDeletes accounting) | `apps/mobile/src/openbot/private-state.ts:141-152`; pinned tests `openbot-native-private-state.test.ts:293` (unreadable dir surfaces), `:301` (infoAsync failing surfaces, not a silent no-op), `:311` (absent dir still the normal no-op) |
| private-state.ts:151-155 [doc·low] 注释过时：声称下载目录「不存在、清扫是 proven no-op」 | fixed | pdfCachePaths docblock now states the live path (owner-scoped F04/F07 download cache written by file-cache.ts ensureCached via native-cache-adapter.ts, swept on sign-out and any 401 — verified callers App.tsx onAuthExpired/sign-out and gate.tsx); file header's "plus, later, downloaded PDF bytes" updated to "plus the downloaded file bytes" | `apps/mobile/src/openbot/private-state.ts:9-11,157-160`; callers `apps/mobile/App.tsx:122-129,145-149`, `apps/mobile/src/openbot/gate.tsx:146,195,277` |

## Totals

- 12 findings: **8 fixed** this pass (connections.tsx ×4, files.tsx ×2,
  private-state.ts import + comments ×2), **4 fixed-before** (calendar.tsx
  seq/abort, calendar-view.ts NaN guard, private-state secureStorePrefix
  registry, private-state infoAsync propagation), **0 invalid**.
- No test extensions added: the four fixed-before items already carry pinned
  tests (cited above); this pass's changes are React Native screen
  wiring/style (connections.tsx, files.tsx render) plus comment/import moves,
  none of which the repo's node:test suites can reach (no React render
  harness; the suites exercise pure modules only).
- Verification: the six acceptance suites (file-cache, connection-status,
  private-state, native-private-state, calendar-view, stream-resume) —
  76 tests, 0 fail; `pnpm run typecheck` clean (root + mobile);
  `bunx biome check` clean on all three touched files. All changes left
  uncommitted.

## Dependencies (outside this cluster's ownership)

1. **email-signin.tsx** — finding 2's second half: FieldError and other
   static inline styles (fontSize/marginTop) violate the same
   StyleSheet.create rule; the file is outside this cluster's edit scope.
2. None further — calendar.tsx/calendar-view.ts/private-state.ts fixes were
   all in-file.
