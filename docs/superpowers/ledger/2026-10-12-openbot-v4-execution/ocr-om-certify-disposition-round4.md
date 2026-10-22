# OCR ocr-om-certify.txt — REPAIR round 4 disposition (2026-10-14)

26 findings: **24 fixed, 2 invalid-with-citation** (pinned test contracts win).
Verification: `pnpm test` 714/714 green (5 new tests added) · root+mobile `tsc --noEmit` exit 0 · `biome check .` clean (only pre-existing biome.json schema-version info) · `build:web` exported. NO commits (working tree only).

## CRITICAL

- **file-cache.ts:234 — meta sidecar JSON 走 base64 通道** → **FIXED**. `CacheFileSystem` 新增 `writeTextAsync(path, text)`（UTF-8 文本通道，契约注释写明 writeFileAsync 的载荷会被真实适配器 base64 解码）；`ensureCachedOnce` 的 sidecar 写入改走文本通道；`native-cache-adapter.ts` 实现 `fs.writeAsStringAsync(path, text)`（默认 UTF8，与既有 `readFileAsync` 的 UTF8 读取对称）。两个测试 stub（file-cache / pdf-view-state）同步实现；新测试 pin「字节走 writeFileAsync（.part），sidecar 走 writeTextAsync（.json）」——node stub 按原样存取无法暴露的真实 Android/iOS 差异从此有通道级断言。

## HIGH

- **gate.tsx:252-256 — 非重试失败返回登录页既不吊销也不清扫 → workspace_inconsistent 死锁** → **FIXED**. `backToSignin` onPress 改为 `signOut()（吊销）→ clearPrivateState()（registry 清除同时移除 stale stored session）→ setSeq(initialEntrySequence) → signin`，与 auth-failed catch 的「先吊销再清扫（I07）」次序一致。重新登录 / 冷启动不再重读失效 botId。
- **gate.tsx:115-121 — stored session 无用户绑定，justSignedIn 信任上一用户残留** → **FIXED**. `openBotSessionSchema` 增加可选 `userId`（types.ts，旧条目不匹配即弃）；`fetchMe()` 返回值保留（`const me = await fetchMe()`）；`persistSession({ ...session, userId: me.user.id })` 绑定写入；读取时 `stored.userId === me.user.id` 才采用，不匹配即 `removeStoredSession()`（新增 helper）。绑定校验对 fresh-sign-in 与常规入口统一生效——"干净启动"不再依赖「登录表单渲染前 sweep 必已执行」这一被 #252-256 路径破坏的不变量。

## MEDIUM — 修复（22 项）

1. **config.ts:30-32** 路径前缀静默丢弃 → `parseEndpoint` 对非根 pathname 显式报错（与凭据/查询/片段守卫同风格）。新测试覆盖 `https://host/openbot` 与 trailing `/openbot/`。
2. **client.ts:148-159** 4 层嵌套三元 → if/else 链（`let code: OpenBotErrorCode`，新增类型导入）。
3. **App.tsx:287-295（含 223-295 全部六组）** 绝对定位魔法数字入口按钮 → 改为文档流内入口行：`useSafeAreaInsets()` 定 paddingTop、`flexDirection: "row" + justifyContent: "flex-end" + gap: 4`（6×44+5×4+16=300pt，窄于 320pt 最窄屏）；任一覆盖层打开时整行隐藏；六个覆盖层改为独立的 `{xOpen && …}` 块。消除①与 SignOutButton 重叠②状态栏相撞③悬浮于覆盖层头部④352 偏移越界。
4. **package.json:23-25** expo-crypto/expo-device 无使用方 → 已核实（src 零 import；@better-auth/expo@1.7.1 peerDeps 仅 constants/linking/network/secure-store/web-browser）；从 dependencies 移除并 `pnpm install` 同步 pnpm-lock.yaml。
5. **connection-status.ts:96-98** 原型键查找 → `ownLabel()` 用 `Object.hasOwn`（biome 建议写法，Hermes/RN0.81 支持）守卫 provider/status 两处。新测试覆盖 constructor/toString/__proto__/valueOf。
6. **connections.tsx:217** statusChip 同类问题 → 同 `Object.hasOwn` 守卫。
7. **auth.ts:46-50** getCookie 异常吞成 null → `sessionCookie()` 异常上抛；`client.ts` 捕获后映射 `OpenBotError("network", "无法读取本地登录凭证，请重试。")`——可重试、不再匿名请求→401→强制重登+本地清扫。App.tsx 的另一处调用本就有 rejection handler（→ setCookie(null)），行为不变。
8. **auth.ts:55-57** getSession 错误折叠为 null → `if (error) throw new OpenBotError("network", "无法确认登录状态，请检查网络后重试。")`；null 仅表示「确认无会话」。
9. **tool-cards.ts:185-193** 嵌套三元 → 模块级 `KIND_BY_STATUS` 查找表（`event.status ?? "none"`）。
10. **calendar.tsx:86-87** 无客户端上界 + 非虚拟化 + EventRow 无 memo → `FlatList`（虚拟化挂载；truncated → ListHeaderComponent，空列表 → ListEmptyComponent）+ `memo(EventRow)`（collected 内事件对象身份稳定）+ `MAX_EVENT_ROWS = 500` 上限（触顶即 break，post-loop cursor 检查置 truncated 提示）。
11. **calendar-view.ts:214-216** 裸 catch 静默 → `typeof __DEV__ !== "undefined" && __DEV__` 时 `console.warn("[calendar] event row degraded…", e)`（module 顶部 `declare const __DEV__`，node:test 下 typeof 探测安全、无 react-native import）。
12. **tool-cards.ts:203-206** 错误卡片显示成功摘要 → error 状态 `summary = payloadDetail || safeTruncate(event.name)`，绝不落回成功口径；其余分支不变。新测试 pin 失败截图卡片不含「已获取屏幕截图」且透出载荷错误详情。
13. **chat.tsx:263-266** renderSet 死记账 → 删除组件内 `renderSet` ref、`applyBatch`、connect-then 里的 `reset`，及误导注释；`messagesRef`/`resumeStrategy`/`dedupeById` 决策路径原样；`rowEvent`/`THREAD_RUN_SCOPE`/`StreamEvent` 仍被 offered 窗口计算使用故保留。stream-resume.ts 纯模块及其测试不动。
14. **calendar-view.ts:197-201** allDay 无脏数据校验 → allDay 分支对 start/end 各做 `Number.isFinite(Date.parse(`${iso}T00:00:00Z`))` 校验，无效即 throw RangeError 进降级（引擎无关）。新测试覆盖 dirty start / dirty end。
15. **calendar-view.ts:120-122** assumed 误标事件自带时区 → `zoneOf(dateIso, fallback, fromEventTimeZone = false)`；`eventRowView` 调用处传 `Boolean(event.timeZone)`——仅回退设备默认时区才置 assumed。新测试覆盖。
16. **files.tsx:90** nextCursor 丢弃 → `nextCursor` state + 列表尾「加载更多」按钮（`fetchFiles(nextCursor)` 追加），COPY.loadMore。
17. **files.tsx:221-223** 版本陈旧 cached 行永不恢复 → `demoteStaleCached(page)`：load/loadMore 后把 `meta.versionId !== file.versionId` 的 cached 行回退 idle，下载按钮重新可点（ensureCached 的陈旧重下保证从此可达）。
18. **pdf-view.tsx:130-132** 拒绝清理被世代守卫短路 → `refusalClearsCache` 分支的 `clearVersionCache(…, selected.versionId)`（sidecar 比对已保证不误删他版本）移到世代守卫之前；`setOpened(null)`/`setError` 留在守卫后。删除了原第二处冗余守卫后的重复注释。
19. **gate.tsx:122-130** 检查失败被当登出而全量清扫 → 由 #8 支撑：`currentSession` 仅确认无会话返回 null（才清扫）；检查失败 throw 落入既有 catch 的可重试路径（notice=zh 文案、seq failed、本地 jar 保留），注释同步更新。
20. **gate.tsx:238-242** 嵌套三元 → 模块级 `loadingCopy(failure, phase)`（新增 `EntrySequenceFailure` 类型导入）。
21. **private-state.ts:266-269** NativeClearReport 静默丢弃 → `clearPrivateState` 在 `failedKeys/failedDeletes` 非空时 `console.warn("[openbot] private-state sweep incomplete", report)`（生产调用方吞异常时不再零信号）。

（chat.tsx 修复与 files.tsx 两项修复均有对应纯 seam/契约测试间接覆盖；组件级行为无 node 测试 harness，以 typecheck+build+全量回归兜底。）

## INVALID（pinned test contract wins，2 项）

- **client.ts:133-134 — 裸 AbortError 泄漏** → **INVALID**，引证 `apps/mobile/test/openbot-client.test.ts:178-183`：该测试在**无 caller signal** 的 `openbotFetchBinary` 上断言 fetch 抛出的 `AbortError` 必须**原样透传**（`assert.equal((binaryError as Error).name, "AbortError")`）。finding 建议的 `if (init.signal?.aborted) throw error; else throw OpenBotError("network")` 会把此场景改为 network 错误、直接打破该 pinned 契约（另 `:164-176` pin 了 caller-abort 透传，两者共同钉死当前分类）。若要采纳此修复需先修订该测试契约（超出本轮 REPAIR 权限）。
- **chat-state.ts:93-95 — historyKey 死导出** → **INVALID**，引证 `apps/mobile/test/openbot-chat-state.test.ts:78-85`：测试 pin 了 `historyKey` 的存在与契约（稳定、按 channel 作用域、不含 botId/threadId）。按规则保留导出；finding 中「注释误导」部分已单独修复——docstring 改为如实说明当前无 app 调用方、契约由测试钉住。

## Files + shasum（round 4 后）

```
4ea0cf67b988a43314bdcef2b27ff2e3c9102158  apps/mobile/App.tsx
ce0461f2a821f241c5823a045f9ca09b8650dec1  apps/mobile/package.json
8763165f2e68ee29a64e307c1eb4244fec603afe  apps/mobile/src/openbot/config.ts
8459b9dd9318f4b06df92e5cdc3975e405734847  apps/mobile/src/openbot/client.ts
cbc8e3084d16e3f1bd028b1ae38ba106d0761fef  apps/mobile/src/openbot/auth.ts
f3b51ceb74a8a17fd008ba2e15d95b7f8b5c589d  apps/mobile/src/openbot/gate.tsx
39ba897fbae732b8337e27414de89f9ce5148ee4  apps/mobile/src/openbot/connection-status.ts
bf44e1767f19bce1f86f638def91cea425dd272e  apps/mobile/src/openbot/connections.tsx
9dcaaa7798558874d623bf05dd761c8fedf91639  apps/mobile/src/openbot/tool-cards.ts
b7b2b687dc891d60c337db8955cf3120cf25a579  apps/mobile/src/openbot/calendar.tsx
cb684cd0c660951ca60f30fde67d73dc641dcd6c  apps/mobile/src/openbot/calendar-view.ts
a49cf70c7e101e8f0abdcf6fad718ae7c034964a  apps/mobile/src/openbot/chat.tsx
9d71f05d6a06ab663b1d059c246707b7240e711b  apps/mobile/src/openbot/chat-state.ts
90628e7cf39bcb2dbd7f4388097a48210875d399  apps/mobile/src/openbot/files.tsx
e05455fce9e10e6ca426dbdf2dd9acdabb20ec96  apps/mobile/src/openbot/file-cache.ts
e3a4786d14da4b3b76b7edd6e339305e1452443c  apps/mobile/src/openbot/native-cache-adapter.ts
4c094fb36c0c7667742a15c942dc41b9ebbc8d36  apps/mobile/src/openbot/pdf-view.tsx
426e01847d2c0900c7fa29decfe50318e9293266  apps/mobile/src/openbot/private-state.ts
b60a883c007b1ba6400b4f6ad99def0ad47b11d9  apps/mobile/src/openbot/types.ts
87e0e96dbf53edccb774477dad9359aaa181278f  apps/mobile/test/openbot-android-config.test.ts
d87190fc00f2cd7f3128fa8dc60ce05833cc9e25  apps/mobile/test/openbot-connection-status.test.ts
198cb11baf35000ccbc08ba9ff5a9e281d755379  apps/mobile/test/openbot-calendar-view.test.ts
75228e39eb70e64d98ccb7224d58e09919133745  apps/mobile/test/openbot-tool-cards.test.ts
e52eecc1fd8632f188689fb85e7dede602c325fe  apps/mobile/test/openbot-file-cache.test.ts
9194c40c8f8c502ed21d5540d217521c3488daee  apps/mobile/test/openbot-pdf-view-state.test.ts
78b3bcf06c5583a930c2b9e0c2c452af5f52e292  pnpm-lock.yaml
```

## Verification tails

- `pnpm test` → `ℹ tests 714  ℹ pass 714  ℹ fail 0  ℹ cancelled 0`（含 round 4 新增 5 测试；Object.hasOwn 改动后受影响 9 个 openbot 测试文件复跑 115/115）
- `pnpm typecheck`（root `tsc --noEmit` + apps/mobile）→ exit 0
- `pnpm lint`（biome check .）→ `Checked 231 files … Found 1 info`（仅既有 biome.json schema-version mismatch info，与本次改动无关）；round 4 引入的两处 noPrototypeBuiltins 警告已按建议改为 `Object.hasOwn` 并 format
- `pnpm --dir apps/mobile build:web` → `Exported: dist/web`
