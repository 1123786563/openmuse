# OCR Round 2 — apps/mobile/src/openbot REPAIR 报告

Worktree: `.worktrees/v4-base`（branch `v4/openbot-exec`），无 commit（按要求留在工作区）。
范围：OCR /tmp/ocr-openmuse3.txt 中 `apps/mobile/src/openbot/*` 的全部 HIGH+MEDIUM（2 HIGH + 21 MEDIUM = 23 条）。App.tsx 的 3 条 medium 不在任务 glob 内，未处理。

## 结论

**23/23 条全部 fixed；0 条 invalid-with-citation。** 每个现有测试保持绿色；与钉住测试契约可能冲突的两处（control-state 签名、clearVersionCache 签名）以"可选参数向后兼容"实现，测试契约原样保留。

## Per-finding 处置

### HIGH（2）

| # | 位置 | 处置 | 说明 |
|---|------|------|------|
| 1 | gate.tsx workspace_inconsistent 绕过 | **fixed** | `step({type:"workspace-ok"})` 后新增 `if (sequence.phase === "error") return;`：错误 UI（非重试 + 返回登录）得以呈现，openConversation/persistSession/onReady 不再对被阻断的入场执行。reducer 契约（gate-state.ts）未动，openbot-gate.test.ts 钉住的 workspace_inconsistent 行为不变。 |
| 2 | files.tsx ETag 守卫填充后永久误判 | **fixed** | 与权威契约对齐：`etagMatchesVersion(result.etag, { sha256: null })`（降级 current-version 协议，openbot-pdf-view-state.test.ts:216-227/255-286 钉住）——只要求格式良好的 sha256 ETag 并记录字节实际摘要；版本陈旧由 versionId 变化 → cache miss → 重下载兜底。报错文案改为"缺少可验证的 SHA-256 摘要"。 |

### MEDIUM（21）

| # | 位置 | 处置 | 说明 |
|---|------|------|------|
| 3 | auth.ts sso_required 大小写 | **fixed** | 提取 `signInErrorReason`：`/^sso[_-]?required$/i` 大小写不敏感匹配；兜底改为通用文案"登录失败，请稍后重试。"，服务器原始 message 不再直出（signUp 保持原样，属 low）。 |
| 4 | email-signin.tsx catch 直出异常 | **fixed** | connection-status.ts 新导出 copy-agnostic 的 `isTokenShaped`；catch 中经 token 形态守卫 + 120 裁剪，空/token 形态/兜底一律"登录失败，请稍后重试。"。 |
| 5 | chat.tsx 游标身份空间 | **fixed** | resume 游标改取 `messagesRef.current.at(-1)?.id ?? null`（消息 id 空间），不再用可能落在合成工具卡 id（`<msg>:<call>:start`）上的 `renderSet.lastEventId()`；在途工具期间重连不再误判 reload-history。 |
| 6 | chat.tsx restoring 期间可发送 | **fixed** | send 守卫加 `restoring`，按钮 `disabled={restoreFailed \|\| restoring}`，useCallback 依赖同步加入。 |
| 7 | chat.tsx applyBatch 返回值被丢弃 | **fixed** | "dedupe seam wraps transcript construction"落地：chat-state.ts 新增纯 seam `dedupeById`（§3：重放同 id 折叠为首次出现，一个气泡一个 key），rows 与 toolRows 构造均经其包裹；RED→GREEN 测试在 openbot-chat-state.test.ts。渲染集继续承担 resume/reset 机制（注释说明分工）。 |
| 8 | channels.tsx 已归档单向死角 | **fixed** | effect：`showArchived && partition.archived.length === 0` 时自动回落活跃列表。 |
| 9 | channels.tsx 空 agentIds 行崩溃 | **fixed** | 行 Pressable `disabled={archivedRow \|\| channel.agentIds.length === 0}`；channel-state.runtimeBotId 的 throw 保留为兜底（openbot-channel-state.test.ts:313 钉住，兼容）。 |
| 10 | private-state.ts MAX_COOKIE_CHUNKS=8 | **fixed** | 上调至 64（删除不存在键是 no-op，宁可多枚举），两处注释同步改写。stub 测试基于真实 store 键，不受候选清单变长影响。 |
| 11 | chat.tsx send 失败本地回显残留 | **fixed** | `localId` 记录；runAgent reject 且回合未开始时 `agent.setMessages(messages.filter(m => m.id !== localId))` 回滚（先例 src/chat.tsx thread-locked 分支同款），重试不再双发。 |
| 12 | chat.tsx stopAgent 迟到 reject | **fixed** | 新增 `stopOutcome` ref 镜像终端结果（onRunFinishedEvent 写入、send 复位）；stop 的 catch 中 `if (stopOutcome.current) return;` —— 运行已终结则不弹"没有停止这次回复"。 |
| 13 | calendar.tsx 50 页上限静默退出 | **fixed** | `if (cursor) sawTruncated = true;`（页数上限退出且 cursor 未尽时置位截断提示）。 |
| 14 | calendar.tsx truncated 提交时机 | **fixed** | 局部变量 `sawTruncated` 收集，仅在成功时与 `setEvents` 一并提交；失败路径保留旧提示/旧列表不动；开头 `setTruncated(false)` 移除。 |
| 15 | calendar-view.ts Intl formatter 每次新建 | **fixed** | 模块级 `formatterCache`（style+zone 键）缓存 wall/time/day 三类 formatter；行为不变，现有 §4 fixture 测试全绿。 |
| 16 | control-state.ts 跨租约 seq 撞号 | **fixed** | ControlState 新增单调 `generation`（controlTaken +1，从不复位）；`controlInputFailed` 增可选第 4 参 generation（省略=不守卫，兼容现有 3 参钉住调用）；control.tsx dispatch 捕获并传入。RED→GREEN 碰撞测试在 openbot-control-state.test.ts（新测试）。 |
| 17 | control.tsx 卸载遗漏 requesting | **fixed** | 卸载清理补 `else if (now.phase === "requesting" && now.leaseId) cancelComputerControl(...)`；`controlSignedOut` 死导出一项属 low，未动。 |
| 18 | control.tsx requesting 两条死路 | **fixed** | ① request 200 但 `body.request?.id` 为 null → 不进入 requesting，提示"请求没有被受理"（面板不再卡死）；② take 409 → `controlExpired` 本地结论（expired 相位重渲染请求按钮）；cancel 409 → 吞掉并回 viewing。`controlExpired` 从死导出变为生产使用。 |
| 19 | file-cache.ts moveAsync 覆盖语义 | **fixed** | move 前仅当目标存在时 `deleteAsync(target)`（幂等，条件式以保持 pinned `fs.deleted` 断言原样）；iOS EEXIST 拒绝场景有 RED→GREEN 测试（openbot-file-cache.test.ts）。 |
| 20 | pdf-view-state.ts clearVersionCache 整槽误删 | **fixed** | file-cache.ts 新导出 `clearCacheSlot`（同一 per-target 锁内执行；`onlyVersionId` 提供时先读 sidecar，仅 `meta.versionId === onlyVersionId` 才清）；`clearVersionCache` 委托之，可选 `failedVersionId` 参数（2 参钉住调用不变）；pdf-view.tsx open 的 refusal 清缓存传入 `selected.versionId`。版本作用域测试在 openbot-pdf-view-state.test.ts。 |
| 21 | files.tsx ↔ pdf-view.tsx 循环依赖 | **fixed** | 新模块 `native-cache-adapter.ts` 收纳 `nativeCacheAdapter`/`responseToBase64`/`MAX_CACHE_FILE_BYTES`（无 react-native 导入）；files.tsx 与 pdf-view.tsx 单向依赖它，files.tsx 不再被 pdf-view 反向引用。 |
| 22 | files.tsx 64MB 检查在 arrayBuffer 后 | **fixed** | `responseToBase64`（现居 native-cache-adapter.ts）读体前先查 `Content-Length`（缺失/NaN 时退回原有字节判断）。 |
| 23 | tasks.tsx onBack busy 泄漏 | **fixed** | onBack 补 `setBusy(false)`（被取代请求的 finally 受 seq 守卫会跳过复位）。 |

## 验证

- `pnpm test`：**702 pass / 0 fail**（基线 698 + 新增 4 个 seam 测试，全部先 RED 后 GREEN）
- `pnpm typecheck`（root tsc + apps/mobile tsc）：**通过，无输出错误**
- `pnpm lint`（biome check 231 files）：**0 error / 1 info**（info 为预先存在的 `biome migrate` 配置迁移提示，与本次改动无关）

## 文件 + shasum（apps/mobile 相对路径）

```
15453b6973b46bd9fe47bcce989ca00ee0245570  src/openbot/auth.ts
66bc31822fc5d32cb2cb89f87d696e8e175f9125  src/openbot/calendar-view.ts
900f37f51e9f2ba666badf4e96a6938a7c36959b  src/openbot/calendar.tsx
c0e87e849b57fd8b767fb303f3f184d7a74a1c19  src/openbot/channels.tsx
5381941441e7c908a55c343271bc9bcdca68cc92  src/openbot/chat-state.ts
68463ab94dbc240234fa34b76afbe0a56aaaf73a  src/openbot/chat.tsx
72e9be2222a74e4817ff878ad1110d1fda25d54c  src/openbot/connection-status.ts
b8abc2e68390742deabd1682df488bdb371daece  src/openbot/control-state.ts
9c19926f1a47d34c5006b8a28f1cd61626804f5c  src/openbot/control.tsx
309cd266e73ed5bd477ad0c2affb5a8528cffb5a  src/openbot/email-signin.tsx
32fc62f73d6e6a98e524090792e941b13f61dfcc  src/openbot/file-cache.ts
55547da1b8daddf2e30659a6a0672614720d4b30  src/openbot/files.tsx
cfb219a651156c1f0c5aeb5130b7deb5387632a3  src/openbot/gate.tsx
bbb985fb58241609d8bf8ede644ccff990932152  src/openbot/native-cache-adapter.ts  (新增)
6e50f176df36e3991fc54ad06ba6aa7a121862c9  src/openbot/pdf-view-state.ts
e2b35a1ebf036d61a18250e1d0d576aa575e3db3  src/openbot/pdf-view.tsx
c2879dd979d9cd39b1b1c71b315b56923d5d350d  src/openbot/private-state.ts
d1b6cea65516f8fa548565c6ea11f1c118834831  src/openbot/tasks.tsx
fd0e04761bf778d177e40ea99ba75afbcbf766fd  test/openbot-chat-state.test.ts
ccf57d3e01f1cb2e981a0499e94f5ed1142dd609  test/openbot-control-state.test.ts
8e5f6b440f5b86bc20b19ad669a1788bc21980a8  test/openbot-file-cache.test.ts
2d62a5df058d6d54efc9102091fb80bd0125eb09  test/openbot-pdf-view-state.test.ts
```

## 遗留（明确不在本轮范围）

- App.tsx 的 3 条 medium（zIndex 层叠、401 不复位 UI、sessionFor render 路径崩溃）——其中 sessionFor 崩溃的主触发路径已由 #9（channels.tsx 禁用空 agentIds 行）消除，但 App.tsx 侧兜底未做。
- 全部 low 级 finding（嵌套三元、chipBase 五处重复、gate-state.error 死字段等）。
