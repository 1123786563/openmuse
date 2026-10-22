# OCR final-pass disposition — cluster D (computer / agent-computer / mobile-bff / baseline / templates / app-wiring / db+drizzle / .gitmodules)

Source: `ocr-final-cluster-d.txt` (45 findings). Repo: OpenBot `.worktrees/v4-base`, branch `v4/openbot-exec`, all changes left uncommitted per instruction.

Verification: acceptance suites 84 pass / 0 fail (`computer-capacity`, `computer-routes`, `stream-auth`, `mobile-bff`, `openmuse-template-revision`, `agent-computer/tests/control{,-http}`); related suites green — `computer-gateway` + `computer-handoff-contract` + `control-lease-routes` (81 pass), `openmuse-bot` (21 pass), `agent-profile-store.integration` with TEST_DATABASE_URL (26 pass), channels family (202 pass), openmuse family (329 pass / 1 fail in `openmuse-files` "fill-append prunes superseded middle versions" — cluster C's own in-flight edit, file modified 00:00 by that cluster, not touched by D); `bun run --filter server typecheck` and agent-computer `tsc --noEmit` both exit 0; `bunx biome lint` + `format` clean on all touched files. Migration 0097 applied and verified on a throwaway clone of the enterprise test database (4 cascade FKs + 2 partial indexes created; clone dropped afterwards).

## Dispositions

| # | Finding (file:lines) | Verdict | Action | Evidence |
|---|---|---|---|---|
| 1 | .gitmodules:1-3 submodule 内容落入根工具链扫描(biome includes `**`、根 bun test 递归) | fixed (biome half) | biome.json `files.includes` 追加 `!apps/openmuse`,上游源码不再按本仓规则 lint/format | biome.json includes;`bunx biome lint` 在触碰文件上跑通即依赖该配置 |
| 1b | 同上 — 根测试发现范围 | deferred (ownership) | 根 `bun test` 的范围在 package.json `"test"` 与 scripts/test-ci.ts(均非本 cluster 所有权;bunfig `[test]` 无多路径发现范围)。建议:`"test": "bun test app server agent-computer agent-sandbox shared tests supervisor scripts desktop deliverables worker agent-langgraph agent-mastra agent-bot"`(按 `git ls-files '*.test.ts'` 实测分布,排除 apps/ 即 submodule 与已删的 openmuse-mobile) | package.json:19;git ls-files 统计见左 |
| 2 | .gitmodules:3-3 CI 从不初始化/校验 submodule pin | deferred (CI unverifiable here) | pin 当前可达已核实:`git ls-remote …/openmuse main` == gitlink `46792335`。建议在 ci.yml 新增 job(见文末“CI 建议”),本仓无法运行 actions 验证,未落地 | ls-remote 输出;ci.yml 全部 checkout 无 submodules 输入 |
| 3 | agent-computer/src/index.ts:932-938 seq 在负载校验前被消费 | fixed | /human/scroll 的 parseScrollDelta 移到 admitHumanInput 之前,被拒手势不再消耗序号 | index.ts HUMAN_INPUT 分支(校验先于 gate);opt-in 测试见 #18 行下方 control-http 新用例 |
| 4 | agent-computer/src/control.ts:393-396 注释声称两条输入路径都过此门 | fixed (comment) | 注释改为如实:WS screencast 路径只查 humanMayDrive、不带序号(parseInputMessage 无 seq 字段),按 finding 给出的第二选项记录延后(k03) | control.ts admitHumanInput doc;index.ts:603 仅 humanMayDrive |
| 5 | control.ts:120-124 finish 手工内联终态联合 | fixed | `status: HandoffStatus`(自 shared/computer-control 导入) | control.ts finish 签名 |
| 6 | control.ts:85-88 release 不校验持有者身份 | fixed | release/cancel 接收 holder,`heldByAnother` 409(cancel 仅对 taken 态);index.ts 透传 userId;gateway releaseControl/cancelControl 发送 `userId: actor.id` | control.ts release/cancel;gateway.ts 两方法;control.test.ts 新用例;computer-handoff-contract.test.ts 契约更新 |
| 7 | scripts/openmuse-v4-baseline.sh:207-209 父 pid lsof 查不到端口且无 `\|\| true` | fixed | 按「端口 + 命令行(src/index.ts)」认领监听进程(与 cmd_down 一致),lsof 加 `\|\| true`,die 分支可达 | baseline.sh cmd_up 复用段;`bash -n` 通过 |
| 8 | scripts/openmuse-v4-baseline.sh:219-220 env 词分割拆坏含空格值 | fixed | 逐行读入数组,`env "${env_args[@]}"` 整体传参 | baseline.sh 启动段;SC2046 disable 注释随删 |
| 9 | server/drizzle.config.ts:20-21 schema 来源分散两处 | fixed (comment) | openmuse-deletion/store.ts 条目加注释说明例外归属与“勿随手移除”后果 | drizzle.config.ts schema[0] |
| 10 | drizzle/0081:1-4 reviewed_actions 缺活跃同 payload 唯一约束 | fixed (DB half) | 0097 新迁移加部分唯一索引 `(owner_user_id,kind,payload_hash) WHERE status IN ('awaiting_review','executing','outcome_unknown')` + schema 同步;已在克隆库验证。应用层幂等(catch 23505 → 重跑门控 → 返回既有提案)在 openmuse-reviewed-actions/service.ts — 他人所有权,记为依赖 | drizzle/0097_openmuse_user_fks_and_gates.sql;db/schema/openmuse.ts uniqueIndex;克隆库 pg_indexes 验证 |
| 11 | drizzle/0079:20-22 oauth_pending 无删除路径 + 清扫全表扫描 | fixed (index half) | 0097 加部分索引 `openmuse_oauth_pending_open_idx (expires_at) WHERE consumed_at IS NULL AND outcome IS NULL`;TTL DELETE(openmuse-connectors/store.ts sweepExpired)为他人所有权,记为依赖 | 0097;schema openmuseOauthPending 索引;克隆库验证 |
| 12 | drizzle/0078:2-4 openmuse 系 owner/user 裸 text 无外键 | fixed | 0097 为 openmuse_tasks.owner_user_id、openmuse_google_connections.user_id、openmuse_oauth_pending.user_id、openmuse_goals.owner_user_id 补 `REFERENCES users(id) ON DELETE cascade`,前置孤儿行 DELETE 使约束可落地;schema 同步 references | 0097(4 DELETE + 4 ALTER);schema 四处;克隆库 conname/confdeltype=c 验证 |
| 13 | meta/0093_snapshot.json:7399-7415 索引名 owner_key 易误读 | fixed (comment) | schema 定义处加注释说明 "key" 指幂等键;快照为生成物不手改,重命名需与迁移/快照一起变更(记入依赖备注) | db/schema/openmuse.ts openmuse_tasks_owner_key_uq 注释 |
| 14 | server/src/index.ts:3991-3996 三处硬编码 OPENCONNECTOR_URL 默认 :3000 | fixed (url half) | 三处(Google/Mail/Calendar client)改 `config.openConnectorUrl`(统一默认 :3100);OPENBOT_PUBLIC_ORIGIN、OPENBOT_OPENMUSE_FILES_DIR 收敛需改 config.ts(非本 cluster),记为依赖 | index.ts:3994/4072/4106;config.ts:2310 |
| 15 | server/src/app.ts:630-634 createApp 30+ 位置参数 | deferred (ownership) | 有效的可维护性 finding;修复需迁移 ~45 个测试调用点(多为非所有权测试文件)。建议增量方案:新参数一律只加入尾部 `options` 对象、位置序列冻结,旧参数在测试自然重写时搬移 | app.ts 参数序列与 "APPENDED LAST" 注释自证 |
| 16 | server/src/index.ts:2717-2724 toolsForTurn 与 routineRunner 逐行重复 | fixed | 抽出 `computerToolsForTurn`(index.ts 模块级),实际发现 4 份相同内联副本(routineRunner/delivery/openMuseTaskRunner/第四处)全部替换 | index.ts computerToolsForTurn + 4 个 `toolsForTurn: computerToolsForTurn` |
| 17 | computer/stream-auth.ts:131-138 502 泄露内部 error.message | fixed | 通用文案 + `log.warn` 记服务端日志(与 503 容量分支同一中立立场) | stream-auth.ts catch;测试期望更新为通用文案;日志在套件运行中可见 |
| 18 | computer/routes.ts:474-480 revoke 持有人校验 TOCTOU | fixed | 观察到的租约(requestId+takenBy)作为前置条件随 revoke 下发;agent-computer /control/revoke 复核当前活动租约不匹配即 409 | routes.ts revoke;gateway.revokeControl observed 参数;index.ts /control/revoke 前置复核;control-lease-routes.test.ts 契约更新 + control-http opt-in 用例 |
| 19 | computer/routes.ts:474 预读 /ensure 会启动已停计算机 | fixed | revoke 先问 `gateway.computers()`(provider.list,不 ensure):未运行直接按 no-op 返回 `{holder:"bot"}`,不再为读 takenBy 启动计算机 | routes.ts revoke 头部;control-lease-routes.test.ts fixture list 改报 running |
| 20 | computer/gateway.ts:1277-1284 chargeWrite 失败不回冲 | fixed | post 失败 catch 内 `capacity.refundWrite(botId, bytes)` 后重抛 | gateway.ts writeFile;capacity.ts refundWrite;capacity 测试 "a refunded write's bytes come back" |
| 21 | computer/capacity.ts:223-226 咨询失败仍按时间戳停机 | fixed | 网关 consult 不再吞错(仅地址不允许仍返回 undefined);capacity 既有 per-computer catch 即"问不出的计算机跳过",与注释承诺一致 | gateway.ts consult;capacity 测试 "a consult that fails reads as unjudgeable" |
| 22 | computer/capacity.ts:180-183 争用全量清扫在串行链内 | fixed (throttle) | 清扫仍在链内 await(它是为调用方腾位的关键路径),但新增 SWEEP_THROTTLE_MS=10s 节流:窗口内的被拒重试不再重付全量清扫。移出串行段的更重方案记录为备选 | capacity.ts reserveOnce + SWEEP_THROTTLE_MS;测试 "does not re-pay the sweep on every retry" |
| 23 | computer/capacity.ts:102-107 嵌套三元 | fixed | 改 if/else 分支 | capacity.ts latestOf |
| 24 | computer/capacity.ts:124-127 lastRunActivity/charged 无清理 | fixed | sweep 停机成功后 `lastRunActivity.delete`;新增 `forget(botId)` 由 gateway.stopComputer 调用;charged 有意保留(supervisor 停机保卷,字节仍在)并注释说明 | capacity.ts sweepIdle/forget;gateway.ts stopComputer;测试 "forget drops the run-activity entry" |
| 25 | computer/stream-auth.ts:65-67 注释与实现不符(token 裁决调用方) | fixed (comment) | 注释改为:非浏览器调用方由上方会话与 Bot 访问校验裁决;COMPUTER_TOKEN 认证本服务器对计算机,而非调用方对本服务器 | stream-auth.ts origin 注释 |
| 26 | server/src/index.ts:4033-4037 requireUser 守卫与 app.ts 逐行重复 | fixed | app.ts 导出 `createDeploymentRequireUser(config, auth, roleRepository)`,createApp 与 index.ts openMuseGoogleGuard 共用;index.ts 清理不再使用的导入 | app.ts 工厂;index.ts openMuseGoogleGuard;双包 typecheck 0 |
| 27 | computer/capacity.ts:169-184 自身计算机已运行仍被容量拒绝 | fixed | `admittedBy()` 一次 list 同时判 ownRunning 与 others:已运行视为刷新直接放行(两条判定共用一次 list,保持串行链内一次读) | capacity.ts reserveOnce;测试改写为 "admitted past the cap as a refresh" |
| 28 | computer/capacity.ts:227-234 跨副本陈旧开始时间戳误停工作中的计算机 | deferred (needs shared seam) | 正确修法需计算机侧可跨副本见的"最近活动"参与 latestOf —— 要扩 shared/computer-control.ts 的 ComputerControlState(非本 cluster 所有权,agent-computer+shared+capacity 需同动)。备选"仅清扫本进程有记录的计算机"被否:网关重启后丢失全部记录,空闲计算机将永不回收。已有多副本风险在注释中如实呈现 | capacity.ts sweepIdle latestOf 注释;sweep 保护仅覆盖 human 持有 |
| 29 | computer/routes.ts:1052-1055 errorBody 下发含 env 指引的消息 | fixed | ComputerCapacityError/WorkspaceQuotaError 的浏览器文案中立化(与 stream-auth 同款),稳定 code 保留 | routes.ts errorBody |
| 30 | db/schema/openmuse.ts:244-246 oauth_pending 无清理路径(§9) | fixed (FK half) | user_id 补 users 外键 cascade(账号硬删即随删,孤儿不可能再产生;存量孤儿由 0097 前置 DELETE 清掉);TTL 定期清扫与 §9 manifest 枚举(openmuse-deletion/connectors)为他人所有权,记为依赖 | 0097;schema references;克隆库验证 |
| 31 | db/schema/coworker.ts:84-86 部分索引谓词写法不一致 | deferred (churn) | 统一写法本身会产生 snapshot 比对差异与一次无语义的索引重建迁移;建议并入下一次真正触碰该索引的迁移 | 0096 快照中原生字符串谓词仍在 |
| 32 | db/schema/openmuse.ts:1-11 使用原生 jsonb(高) | fixed | 改 `import { jsonb } from "./json"` 并注释原因;drizzle-kit generate 产出的 0097 不含任何列变更,证明类型替换 SQL 中立 | schema 头部;0097 内容仅 FK+索引 |
| 33 | agents/profile-store.ts:826-831 空数组 inArray 抛错 | fixed | `owned.length === 0` 直接返回(空事务提交,no-op),注释说明幂等重跑窗口 | profile-store.ts hardDelete;integration 套件 26 pass |
| 34 | agents/openmuse-template-store.ts:555-560 CAS 谓词与 load 回退语义不一致 | fixed | 谓词改 `coalesce((configuration->'openMuse'->>'templateVersion')::int, OPENMUSE_TEMPLATE_VERSION) = expected` | template-store applyManaged |
| 35 | admin/openmuse-template-routes.ts:20-23 版本上界双处硬编码 | fixed | `knownRevision` 由 `v in OPENMUSE_TEMPLATE_REVISIONS` 派生,previewQuery 用 `z.coerce.number().pipe(knownRevision)` | openmuse-template-routes.ts 头部 |
| 36 | agents/openmuse-template-store.ts:102-107 投影与 joinedProjection 13 列重复 | fixed | profile-store 导出 `joinedProjection`,template-store select 共用(两处 join 谓词仍各自合理不同) | profile-store export;template-store templateProfileRows |
| 37 | channels/routes.ts:866-869 archive/unarchive/rename 不发 CHANNEL_ACTIVITY_TOPIC | fixed | ChannelActivityEvent 新增 `archived?: boolean`、`renamed?: string`;archive/unarchive 在事务内(比照 softDelete)向全成员 pg_notify;rename 通知携带新名 | channels/events.ts 类型;routes.ts 三方法;channels 家族 202 pass |
| 38 | channels/routes.ts:915-924 unarchive 竞态静默 204 | fixed | update 加 returning,0 行命中抛 ChannelNotArchivedError(与前置检查同答案) | routes.ts unarchive |
| 39 | mobile-bff/workspace.ts:75-78 魔法数字 | fixed | `ARCHIVED_COLD_START_PAGE=100`、`ARCHIVED_COLD_START_MAX_PAGES=5` 具名常量 + 与 MAX_CHANNEL_PAGE(200)的邻居关系注释 | workspace.ts readArchived |
| 40 | channels/routes.ts:1363-1369 ?archived= 空串放行 | fixed | 空串纳入 400(与注释的严格立场一致) | routes.ts archived 解析;channel-routes 套件通过(无既有用例依赖放行) |
| 41 | admin/openmuse-template-routes.ts:72-79 apply 无审计 | deferred (ownership) | 需在 server/src/audit.ts 的 auditEventTypes 联合中新增事件类型(非本 cluster 所有权)。完整补丁见文末“审计建议” | audit.ts AuditEventType 为封闭联合;app.ts 已持 auditStore 可注入 |
| 42 | agents/openmuse-template-store.ts:455-457 版本相等但 managed 漂移时 preview/apply 矛盾 | fixed | `managedDrifted`(grantsDiffer \|\| systemPromptRevision 不同)时不走 noop,继续 applyManaged 收敛(CAS 恰匹配) | template-store applyRevision;测试 "converges managed values that drifted behind a matching version" |
| 43 | agents/openmuse-template-store.ts:131-138 isUniqueViolation 两份拷贝 | fixed | mobile-bff/openmuse-bot.ts 导出 isUniqueViolation,template-store 复用并删除本地 isPostgresUniqueViolation | openmuse-bot.ts export;template-store import/usage |
| 44 | mobile-bff/routes.ts:87-92 类身份不匹配(高) | fixed | `instanceof \|\| error.name === "OpenMuseOwnerDisabledError"`(三处同名类:files/tasks/connectors,挂载的子应用抛自己的) | mobile-bff/routes.ts onError;测试用 files 自己的类验证 403 |
| 45 | mobile-bff/routes.ts:99-104 OpenMuseFileQuotaError 落到 503 | fixed | 挂载层补 413 分支(与子应用自身 onError 同文案同 code) | mobile-bff/routes.ts;测试 "still answers 413 with its stable code" |

## Totals

- 45 findings: **35 fixed**(其中 6 项为“本 cluster 范围内的一半”,另一半记为跨 cluster 依赖:#10/#11/#14/#30 + #1 的测试范围半)、**8 deferred**(#1b 测试范围、#2 CI、#15 createApp 重构、#28 跨副本清扫、#31 谓词风格、#41 审计)、**0 invalid / 0 fixed-before**(逐条核对时全部仍然成立)。
- 新增迁移:`server/drizzle/0097_openmuse_user_fks_and_gates.sql`(drizzle-kit generate 生成后重命名,前置 4 条孤儿 DELETE;未改任何已应用迁移)。
- 未提交任何内容;未 stash/reset。

## Dependencies(跨 cluster / 后续)

1. **openmuse-reviewed-actions/service.ts(cluster A)**:#10 的应用层半 — propose/insertAction 捕获 23505 后重跑 findSettledSameSend 返回既有 awaiting_review 提案。索引已先行:没有这一半,并发重复 propose 会以 500 暴露而非静默双行(对副作用严格更安全,但应幂等化)。
2. **openmuse-connectors/store.ts(集群 A/B)**:#11/#30 的 TTL DELETE — sweepExpired 顺带删除 consumed/expired 超过保留期的行;以及 §9 删除 manifest 是否纳入该 kind。
3. **server/src/config.ts**:#14 的另外两处 env(OPENBOT_PUBLIC_ORIGIN、OPENBOT_OPENMUSE_FILES_DIR)收敛为 config 字段后,index.ts 直接改读。
4. **server/src/audit.ts**:#41 — auditEventTypes 增加 `"openmuse_template.revision_applied"`;随后 admin/openmuse-template-routes.ts deps 加可选 `audit` 回调,app.ts 以 `auditStore ? (e) => recordAuditEvent(auditStore, e) : undefined` 注入,apply 成功(含 noop)后记录 actorUserId/ownerUserId/target 与 stored 版本。
5. **shared/computer-control.ts + agent-computer**:#28 — ComputerControlState 增加跨副本可见的 lastActivity(计算机侧在 bot 动作时更新),capacity sweep 的 latestOf 纳入。
6. **root package.json / scripts/test-ci.ts**:#1b — 根测试发现范围限定(命令见上)。
7. **createApp 位置参数(#15)**:增量冻结策略(新参数只进尾部 options 对象)可作为后续独立重构工单。

## CI 建议(#2,未落地)

在 ci.yml 增加轻量校验 job(所有既有 checkout 均未设置 submodules):

```yaml
  submodule-pin:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<现有 pinned 版本> # 无 submodules 输入
      - name: The openmuse pin must be fetchable
        run: |
          git submodule update --init apps/openmuse
          test "$(git -C apps/openmuse rev-parse HEAD)" = "$(git ls-tree HEAD apps/openmuse | awk '{print $3}')"
```

规格(docs/superpowers/specs/2026-10-12-openmuse-frontend-openbot-backend-design.md)若要兑现“CI 初始化 submodule 并构建 Web/原生包”,可在此 job 上追加 `corepack enable && pnpm install --frozen-lockfile && pnpm --filter web build`;上游单点(个人账号仓库)建议镜像到组织可控仓库后改 .gitmodules url。

## 备注

- 全量根目录 `bun test` 存在与本 cluster 无关的失败:TEST_DATABASE_URL 未设时的全部 `*.integration.test.ts`、app/desktop 前端、knowledge/qa、audit.ts(他 cluster 00:00 前后仍在改动,` M server/src/audit.ts`)、openmuse-files(他 cluster 同时在改,“fill-append prunes” 用例失败)、migration-journal(0058/0059/0060/0063/0065 快照与 SQL 漂移,0097 不在差异中)。本 cluster 触碰文件对应的全部套件均绿。
- agent-computer 的 opt-in HTTP 套件(OPENBOT_CONTROL_HTTP=1)因该 worktree 未装 playwright 无法本地运行(与既有 opt-in 用例同条件);新增用例已在默认 lane 跳过编译执行之外通过 typecheck。
