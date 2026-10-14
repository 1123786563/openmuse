# REPAIR wave — cluster 1 (calendar + connections + client transport)

范围:OCR findings(/tmp/ocr-openmuse2.txt)中 apps/mobile/src/openbot/{calendar.tsx, calendar-view.ts, connections.tsx, connection-status.ts, client.ts, errors.ts} 的全部 high+medium 项。errors.ts 无 high+medium finding(仅 low 级 409-conflict 建议),未改动。未提交 commit(按要求)。

## Per-finding 修复摘要

| Finding | 级别 | 修复 |
|---|---|---|
| calendar.tsx:137-141 EventRow 脏数据整屏崩溃 | high | 计算下沉为 calendar-view.ts 新纯函数 `eventRowView()`:try/catch 内联 zoneOf/renderTimedRange/renderAllDay/durationHours,任一抛错(Invalid Date / 非法时区)时本行降级为原始 `start – end` 字符串,不再拖垮列表。node:test 直接覆盖 |
| client.ts:63-64 二进制 20s 固定超时 + AbortError 误分类 | medium | `sendAndCheck` 增加 `timeoutMs` 参数(默认 20s);`openbotFetchBinary` 放宽至 120s(截图/文件/PDF 字节流,只防悬挂不限制传输)。catch 先识别调用方取消(`init.signal?.aborted \|\| error.name === "AbortError"`)原样上抛;超时 abort 以 TimeoutError 落地仍归 `network`。测试覆盖 JSON 与二进制两条路径的透传 |
| connections.tsx:103-104 authorizationUrl 未校验即 openURL | sec·medium | `Linking.openURL` 前强制 `/^https:\/\//i` 校验,不通过抛 `OpenBotError("invalid_response", 固定文案)`,阻止 http/intent/自定义 scheme |
| connections.tsx:105-109 服务端错误文案绕过脱敏守卫 | sec·medium | 新纯函数 `connectionErrorCopy()`(connection-status.ts):非 auth 错误统一过 `sanitizeConnectionError`(token 形状整句替换 + 120 截断),空文案兜底「未知错误」;三处 catch 全部接入。测试覆盖 ya29 token 替换 |
| connections.tsx:92-97 load/disconnect 并发竞态 | medium | `requestSeq` useRef 序号守卫:mount、AppState active、手动刷新、disconnect 重取并发时只采纳最后发起的响应(setRows/setError/setBusy 均带 seq 判断),旧响应(如 disconnect 后又显示已连接)直接丢弃 |
| connections.tsx:74-80 catch 未区分 authentication_required | medium | `connectionErrorCopy()` 首分支 `isAuthFailure(e)` → 固定文案「登录已过期，请重新登录后再查看连接状态。」(重试注定 401,不再误导);connect 的 catch 对非 auth 错误才拼 openFailed 前缀 |
| connections.tsx:164-168 错误与加载态同屏矛盾 | medium | loading 块条件改 `rows === null && !error`;失败态仅渲染错误横幅 + 重试 |
| calendar.tsx:121-125 错误与加载态同屏矛盾 | medium | 同上模式:`events === null && !error` 才渲染 loading;改并列条件渲染(空列表/truncated/列表体) |
| calendar.tsx:69-70 只消费第一页,nextCursor/truncated 静默丢弃 | medium | load() 循环跟随 nextCursor 取尽窗口(页数上限 50 仅防坏 cursor 死循环);`truncated` 落到 state,列表上方渲染「日程较多，仅显示部分结果」提示 |
| calendar.tsx:142-143 durationHours 浮点直拼("0.333… 小时") | medium | 新纯函数 `formatDurationHours()`:整分钟取整,<1h 显「x 分钟」、混合显「x 小时 y 分」;EventRow 改用之 |
| calendar-view.ts:100-103 跨天 timed 事件只有纯时间标签 | medium | `renderTimedRange` 跨天时输出「3月10日 22:00–3月11日 02:00」(day 判定用 zonedWallMs 墙钟日);同日行为不变,既有 DST 断言全绿 |

TDD:5 个新测试先 RED 后 GREEN(见下)。低级(style/low、maintainability/low、performance/low)findings 按任务范围不动。

## 文件与 shasum

```
dab059f22508aada79ac7a98c298dc8802f49ca8  apps/mobile/src/openbot/calendar.tsx
720a81ed94b476bc6df5f5eb0e12b92317c3ef0c  apps/mobile/src/openbot/calendar-view.ts
b37430209b6a857be720323871ef83df0a6c6f50  apps/mobile/src/openbot/connections.tsx
6268e43f8cc931deb645c2e21bb79a0cc78f9159  apps/mobile/src/openbot/connection-status.ts
9c5c2dba6f866f1e86204d2af15f3052d4a10191  apps/mobile/src/openbot/client.ts
9edb509289949bae040dd11593be2ebd6795a3ee  apps/mobile/src/openbot/errors.ts   (未改动,无范围内 finding)
12466c823166900dfeef603e51de9d38b89d945e  apps/mobile/test/openbot-calendar-view.test.ts
d5ae8c7e6b80d6b0b20ef51af62fddcd75a0dd48  apps/mobile/test/openbot-connection-status.test.ts
9239865421907ca76bc9b1546a96b9546117c03b  apps/mobile/test/openbot-client.test.ts
```

## 验证 tails

- `pnpm test`(全量):`tests 692 / pass 692 / fail 0`(cluster 1 相关 24/24)
- 范围文件 `biome check`:9 files checked,0 error(全仓 `pnpm lint` 仅剩 openbot-file-cache.test.ts 一处 format 错,属 cluster 2 其他 worker 的文件,未触碰)
- `pnpm typecheck`:本 scope 文件 0 error;全仓 exit 2 的报错全部来自并行 worker 进行中的 openbot-control-state.test.ts / openbot-computer-state.test.ts(cluster 3,非本 scope)
