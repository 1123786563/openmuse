# OCR final-pass disposition — cluster D (tasks.tsx / task-view.ts / pdf-view.tsx)

Date: 2026-10-14 · Branch: v4/openbot-exec (worktree v4-base, all changes left uncommitted)
Source findings: `ocr-mob-final-cluster-d.txt` (12 blocks) · Line refs below are post-fix.

| # | Finding (file:lines) | Verdict | Action | Evidence |
|---|---|---|---|---|
| 1 | pdf-view.tsx:143-145 — open 的 catch 在 await clearVersionCache 后无条件 setError，废弃请求错误落到新版本下 (bug·medium) | fixed-before | 无代码改动：代数守卫已在前轮加入 | `pdf-view.tsx:150` — `if (openGeneration.current !== request) return;` 位于 awaited `clearVersionCache` 之后、`setOpened`/`setError` 之前，恰为 finding 建议的修复 |
| 2 | pdf-view.tsx:86-92 — setListHint 三级嵌套三元 (style·low) | fixed | 提取模块级 `describeVersionListError(e)`，调用点单行 | `pdf-view.tsx:46-52`（函数），`pdf-view.tsx:94`（调用） |
| 3 | pdf-view.tsx:66 — useState(nativeCacheAdapter) 每次渲染都执行工厂 (maintainability·low) | fixed | 改为惰性初始化 | `pdf-view.tsx:74` — `useState(() => nativeCacheAdapter())` |
| 4 | pdf-view.tsx:217 — 错误文案「（打开预览）」读起来像错误的一部分 (style·low) | fixed | 写明动作语义 | `pdf-view.tsx:224` — `{error}（点「{COPY.open}」重试）` |
| 5 | tasks.tsx:147-156 — 详情失败后"重试"只 load()；load/open 共用 busy 且 load 的 finally 无守卫 (bug·low) | fixed | 新增 `failedDetailId` state（open 失败时记录、成功/load/新 open 时清除），重试优先 `open(failedDetailId)`；load 加入共享 openSeq 守卫（catch+finally），被 open 抢先的 load 不再提前 `setBusy(false)` | `tasks.tsx:106`（state）、`tasks.tsx:138-141`（catch 记录）、`tasks.tsx:216`（重试路由）、`tasks.tsx:114,122-124`（load seq 守卫） |
| 6 | tasks.tsx:132 — 头部标题用原始 id、列表项 a11y label 也是 id (other·low) | fixed | 标题与 a11y 统一为 kind（id 仍在卡片正文/详情元信息行展示） | `tasks.tsx:196`（heading）、`tasks.tsx:178`（accessibilityLabel） |
| 7 | tasks.tsx:211-213 — updatedAt 原始 ISO 串直出 (other·low) | fixed | 新增 `formatUpdatedAt`：沿用 agent-ui.tsx `stamp()` 的 toLocaleString 惯例，非法日期回退原串 | `tasks.tsx:75-88`（函数），`tasks.tsx:240`（使用） |
| 8 | tasks.tsx:157-159 — 渲染主体三层嵌套三元 (style·low) | fixed | 抽为 `renderBody()` 局部函数，if 提前返回 | `tasks.tsx:152-190`，调用点 `tasks.tsx:221` |
| 9 | tasks.tsx:120-129 — 头部导航行等静态样式内联，与既有 StyleSheet 双轨 (style·low) | fixed | 提取 `header`/`headerTitleRow`/`headerActions`/`loadingRow` 进既有 `styles` | `tasks.tsx:66-77`（定义），`tasks.tsx:157,193-198`（使用） |
| 10 | task-view.ts:42 — byId 嵌套三元 (style·low) | fixed | 展开为 if 形式 | `task-view.ts:42-47` |
| 11 | task-view.ts:109-110 — TaskStepRow.result/evidenceIds 全仓无消费者 (maintainability·low) | fixed | 从视图模型移除两个字段（DTO 保留）；新增测试钉住不回传 | `task-view.ts:82-87`（接口）、`task-view.ts:111-116`（map）；test `openbot-task-view.test.ts` "step rows drop the DTO passthrough" |
| 12 | task-view.ts:57-64 — mail/file/web 摘要不限长，与 user/error 裁剪口径不一致 (maintainability·low) | fixed | 三类摘要统一 `clip(…, 120)` | `task-view.ts:63-74`；test "mail/file/web summaries clip to one line (120 chars)" |

## Totals

- 12 findings: **11 fixed, 1 fixed-before, 0 invalid**
- Files changed: `apps/mobile/src/openbot/{tasks.tsx,task-view.ts,pdf-view.tsx}`, `apps/mobile/test/openbot-task-view.test.ts`（+2 tests）

## Verification

- `pnpm exec tsx --import ./tests/setup.ts --test openbot-task-view openbot-pdf-view-state openbot-stop-state` → **39 pass / 0 fail**
- `pnpm run typecheck`（root tsc + apps/mobile tsc）→ **clean**
- `bunx biome check` on all 4 touched files → **clean**

## Dependencies

- 无阻塞依赖。
- 备注（非本 cluster 范围，未动）：pdf-view.tsx 的 header 内联样式与 tasks.tsx 同构，但不在 finding 清单内，按"minimal diffs, no drive-by"保持原样；`describeVersionListError` 位于组件文件内（import react-native），无法被 node:test 直测，与既有 COPY 同为模块内部约定。
