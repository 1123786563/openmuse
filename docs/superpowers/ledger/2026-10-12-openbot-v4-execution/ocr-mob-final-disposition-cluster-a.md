# OCR final-pass disposition — cluster A（session/auth/core）

日期：2026-10-14 · 分支：v4/openbot-exec（全部改动保持未提交）
输入：`ocr-mob-final-cluster-a.txt`（16 findings）· 对照 13:12 UTC 修复轮后的当前代码逐条验证。

| # | Finding（file:lines） | 严重度 | Verdict | Action | Evidence |
|---|---|---|---|---|---|
| 1 | auth.ts:106-108 signUp 兜底透传服务端原文 | security·medium | fixed-before | 无改动 | `signUpErrorReason`（auth.ts:99-104）未识别错误一律返回通用文案"注册失败，请稍后重试。"，`signUpWithEmail`（auth.ts:133）经它映射，无 `error.message` 透传 |
| 2 | auth.ts:103-108 三层嵌套三元 | style·low | fixed-before | 无改动 | auth.ts:133 `reason: signUpErrorReason(error)` 单次调用；映射体为早返回函数 |
| 3 | email-signin.tsx:120-123 catch 放行原始异常文本 | security·medium | fixed-before | 无改动 | email-signin.tsx:114-120 catch 无条件 `setServerError(COPY.errSignInUnexpected)`，注释明确 token-shape 守卫不足 |
| 4 | 密码规则 8 硬编码散落 | maintainability·low | **fixed** | auth.ts 导出 `MIN_PASSWORD_LENGTH = 8`；`validatePassword`、`phPassword`、`errPasswordShort`、`signUpErrorReason` 文案统一引用 | auth.ts:44-50（新增常量）、auth.ts:101；email-signin.tsx:4、18、29、47 |
| 5 | client.ts:64-65 RN 缺 AbortSignal.timeout/any | bug·high | fixed-before | 无改动 | client.ts:41-70 `timeoutSignalAfter`/`mergeAbortSignals` + client.ts:106-114 特性探测降级 |
| 6 | client.ts:103-114 嵌套三元 + 409/429→invalid_input | maintainability·low | **fixed（部分）** | signal 的嵌套三元改为 if（行为等价）；409/429 映射保留 — 改映射需扩展 errors.ts `OpenBotErrorCode`（不在本 cluster 所有权），且 openbot-gate.test.ts:75-88 现有契约明确 "409 arrives as invalid_input … must stay retryable"，属跨模块契约变更 | client.ts:106-114；见依赖 1 |
| 7 | App.tsx:192-196 provider 展开嵌套三元 | style·low | **fixed** | 提取 `providerAuthProps(web, cookie)` 模块级函数，JSX 单次调用 | App.tsx:166-173、209 |
| 8 | App.tsx:234-236 入口按钮魔法像素偏移 | style·low | fixed-before | 无改动 | App.tsx:220-243 入口条已为 flexDirection row + `insets.top + 6`，无绝对定位、无 right 偏移 |
| 9 | api.ts:223-227 `openmuse://` 三处重复 | maintainability·low | **fixed** | config.ts 导出 `OPENMUSE_SCHEME`；auth.ts `scheme:` 与 api.ts `returnUri` 引用；app.json 无法 import 常量，注释标明两侧同步义务 | config.ts:56-61、auth.ts:5/37、api.ts:4/225 |
| 10 | config.ts:55-57 顶层 parseEndpoint 逻辑重复 | maintainability·low | **fixed（部分）** | `openbotEndpoint = parseEndpoint(resolveOpenbotUrl(currentOS(), env))`，"env 覆盖 + 平台默认"单一来源；import 期抛错保留 — 非法 `EXPO_PUBLIC_OPENBOT_URL` 属部署配置错误，fail-fast 即设计，推迟到首屏受控提示需新错误边界（见依赖 2） | config.ts:63-66 |
| 11 | package.json 7 个 expo 模块 ^57 版本线 | bug·high | fixed-before | 无改动 | package.json:22-31 已为 SDK 54 线：expo-constants ~18.0.14、expo-linking ~8.0.12、expo-network ~8.0.8、expo-secure-store ~15.0.8、expo-web-browser ~15.0.11（expo-crypto/expo-device 已移除）；逐项核对 node_modules/expo@54.0.37/bundledNativeModules.json 完全一致，且 .pnpm 中已装 54 线版本 |
| 12 | App.tsx:102-108 onAuthExpired 不回登录门 | bug·medium | fixed-before | 无改动 | App.tsx:120-133：onAuthExpired 在 OpenBotApp useEffect 内注册，清扫后 `.finally(() => setEntry(undefined))` 整树回 OpenBotGate |
| 13 | gate.tsx:119-129 justSignedIn 不清 native 私有状态 | security·high | fixed-before | 无改动 | gate.tsx:136-152：no-local-session 分支（signIn 写入新键之前）`await clearPrivateState()`；justSignedIn 分支注释说明依赖 userId 绑定（gate.tsx:169-172）防跨用户残留 |
| 14 | gate.tsx:233-237 loading 行嵌套三元 | style·low | fixed-before | 无改动 | gate.tsx:55-58 `loadingCopy(failure, phase)` 早返回函数，gate.tsx:266 调用 |
| 15 | gate-state.ts:26-27 不可达事件/状态 | maintainability·low | **fixed** | `GateEvent` 裁剪至生产实际派发的 no-local-session/auth-failed/me-ok；`GateState` 删 `error` 字段（无读者）；gate.tsx 3 处 setState 同步；openbot-gate.test.ts 删 4 个死代码用例、signed-out 用例并入 auth-failed 既有用例 | gate-state.ts:9-21、gate.tsx:107/120/279-283、openbot-gate.test.ts:15-28、156-158 |
| 16 | gate.tsx:247-251 返回登录页未清 notice | bug·low | **fixed** | handler 的 finally 加 `setNotice("")`；workspace_inconsistent 的 sessionStorage 残留部分不另改 — 该路径的"返回登录页"本就 revoke+sweep（含 sessionStorage 清扫，gate.tsx:275-281），文案即指引，符合 finding 自述的"至少应重置 notice"下限 | gate.tsx:279-284 |

## Totals

- **fixed：7**（#4、#6 部分、#7、#9、#10 部分、#15、#16）
- **fixed-before（13:12 轮已修，本轮仅核实）：9**（#1、#2、#3、#5、#8、#11、#12、#13、#14）
- **invalid：0**

验收证据：
- `pnpm exec tsx --import ./tests/setup.ts --test apps/mobile/test/{openbot-gate,openbot-client,openbot-api,openbot-native-session,openbot-android-config,strings}.test.ts` → 41 pass / 0 fail
- 全量 `apps/mobile/test/openbot-*.test.ts + strings.test.ts` → **229 pass / 0 fail**
- `pnpm run typecheck`（root tsc + apps/mobile tsc）→ clean
- `bunx biome check`（9 个触碰文件）→ clean

触碰文件：`src/openbot/{auth,email-signin,client,config,api,gate,gate-state}.ts(x)`、`App.tsx`、`test/openbot-gate.test.ts`（package.json 未改——#11 已在版本线内）。

## Dependencies（跨模块，未在本轮处理）

1. **409/429 → `invalid_input` 映射语义**（finding 6 残余）：需在 `errors.ts` 扩展 `OpenBotErrorCode`（如 `conflict`/`rate_limited`），并审视所有按 code 分支的调用方与 openbot-gate.test.ts:75-88 的既有契约断言。errors.ts 不在 cluster A 所有权。
2. **config.ts import 期抛错的 UI 兜底**（finding 10 残余）：把非法 `EXPO_PUBLIC_OPENBOT_URL` 的失败推迟到首屏受控提示需要入口级错误边界设计；当前 fail-fast 为合理取舍。
3. **并行会话观察**：本轮一次全量测试运行中 `openbot-control-state.test.ts` 出现瞬态 `controlSignedOut is not a function`（当时源码与测试均无此符号，单跑与后续全量均 0 fail）。推断为其他 cluster worker 并发编辑同批 untracked 文件所致；若 cluster B/C 也见此现象，需核对最终合并状态。
