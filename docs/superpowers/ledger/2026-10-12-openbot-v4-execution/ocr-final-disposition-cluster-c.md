# OCR final-pass disposition — cluster C (tasks / finance / documents / files)

Source: `ocr-final-cluster-c.txt` (42 findings). Repo: OpenBot `.worktrees/v4-base`, branch `v4/openbot-exec`, all changes left uncommitted per instruction.

Verification: 7 acceptance suites 309 pass / 0 fail (`openmuse-{tasks,task-runner,task-capacity,task-lease-recovery,finance,documents,files}`); related suites 110 pass / 0 fail (`openmuse-deletion`, `openmuse-ops-signals`, `openmuse-personal-tools`, `mobile-bff` with TEST_DATABASE_URL); `bun run --filter server typecheck` exit 0; `bunx biome lint` clean on all 16 touched files.

## Dispositions

| # | Finding (file:lines) | Verdict | Action | Evidence |
|---|---|---|---|---|
| 1 | documents/routes.ts:170-173 fill bodyLimit 在生产挂载下不可达(家族 8KiB 先执行) | fixed (module half) | 常量注释记录 KNOWN MOUNT GAP 与 8KiB 现实;真正的挂载顺序修复在 app.ts/mobile-bff,记为依赖 | routes.ts `OPENMUSE_MAX_FILL_BODY_BYTES` 注释;既有 "request body ceiling (round 3)" 测试仍验 413 |
| 2 | transfer.ts:58 MAX_LEDGER_ENTRIES=5000 与接缝上限矛盾(64KB 读截断→台账静默清空) | fixed | 5000 → 100,注释按最小接缝上限(64,000 读)重写算术(最坏 ~530B/条 × 100 ≈ 53KB) | transfer.ts:52-66;测试新增 "shed ledger < 64,000 bytes" 断言 |
| 3 | documents/routes.ts:114-125 未识别异常一律 503,提取/填充阶段原生错误未归类;日志只记 name | fixed | onError 日志带 `name: message` + stack;fill.ts 生产适配器把 getForm/setText/check/save 阶段的原生错误包装为 `PdfRefusalError("pdf_malformed")` → 400 | routes.ts onError;fill.ts `createPdfFillAdapter` try/catch |
| 4 | transfer.ts:190-191 窄竞态:失败清理删除他人已 complete 的共享工件 | fixed | catch 内重读台账:另一 complete 条目占用同路径则跳过 remove;failed 标记写在新副本上(不再覆写并发完成者);taken 注释修正 list 截断措辞 | transfer.ts `transferVersionToWorkspace` catch |
| 5 | fill.ts:55 typed 普通对象字面量承载 `__proto__` 字段名 | fixed | `Object.create(null) as TypedPdfFillValues`,与 transfer.ts 台账同款防御 | fill.ts validateFill;测试 "__proto__ fills as an ordinary field" |
| 6 | documents/routes.ts:55-59 用户消息硬编码 500 | fixed | 导入并插值 `MAX_PDF_PAGES` | routes.ts refusalAnswer |
| 7 | documents/routes.ts:210-217 空 values 对象可通过校验 | fixed | `Object.keys(values).length === 0` → 400 | routes.ts fill 分支;测试 "empty values object is no fill" |
| 8 | inspect.ts:12 PDF 尺寸常量住在路由文件;10MiB 防御性整拷贝 | fixed | 常量下沉 `openmuse-files/bytes.ts`(routes/documents 改从此导入);`loadPdfDocument` 直传引用去掉 `new Uint8Array(bytes)` | bytes.ts:27-36;inspect.ts:134-147 |
| 9 | files/store.ts:702-713 versionsByOwner 过滤墓碑 → 账号删除后 blob 永久残留(高) | fixed | drizzle `versionsByOwner` 去掉 `isNull(deletedAt)`(唯一消费者是 enumerateOwner/D06 manifest);files 与 documents 测试 fake 同步对齐 | store.ts versionsByOwner;测试改写为 "keeps a tombstoned file's versions";openmuse-deletion.test.ts 的 fake 本就不带该过滤,与其契约一致 |
| 10 | files/store.ts:733-740 hardDeleteFile 两语句无事务 | fixed | 包进 `database.transaction`,与 insertFileWithVersion 同款原子性 | store.ts hardDeleteFile(drizzle rows 按仓库惯例不直接单测) |
| 11 | files/store.ts:481-484 stale-parent check-then-insert 非原子、无唯一约束兜底 | fixed (comment + dependency) | appendVersion 注释记录 KNOWN LIMIT;持久化 parent_version_id + 唯一索引为迁移依赖(禁改 schema) | store.ts appendVersion 注释 |
| 12 | files/store.ts:380-381 list 的 N+1(每行一次 latestVersion) | fixed | 接缝新增**可选** `latestVersionsForFileIds`(一次查询取整页最新版本),list 走批量、无成员的旧 fake 回退原路径——可选设计正是为了不动非所有权的 openmuse-deletion.test.ts fake | store.ts 接缝 + list + drizzle 实现;测试 "one query not one per row"(latestVersionCalls === 0) |
| 13 | files/routes.ts:147-151 上传名未套 rename 的分隔符/NUL 规则 | fixed | 同款 `.refine(!/[\\/]/ && !\0)`,在 byteStore.put 之前拒绝 | routes.ts upload;测试 "refuses a name carrying path separators or a NUL" |
| 14 | files/routes.ts:162-167 %PDF- 魔数两处重复实现 | fixed | 抽 `hasPdfMagic` helper,upload 与 gmail 导入复用 | routes.ts |
| 15 | files/routes.ts:306 ETag 裸值违反 RFC 7232 | fixed | `ETag: "sha256:..."` 加引号,对齐仓库惯例 | routes.ts /:id/content;两处 ETag 测试断言更新 |
| 16 | documents/routes.ts:242-247 409 注释声称 "the store refused" 但并发下不成立 | fixed | 注释改写为如实版本(顺序场景成立、真空隙需迁移),与 #11 同根 | routes.ts stale-parent 注释 |
| 17 | documents/routes.ts:190-200 尺寸护栏读 owned.file.size(陈旧元数据) | fixed | inspect/fill/transfer 三路由在 `owned.read()` 后按 `bytes.byteLength` 413;fill 对派生字节 `filled.byteLength` 同护栏(append 侧) | routes.ts 三处;测试 "served bytes' own length answers 413" |
| 18 | documents/routes.ts:114-121 兜底日志丢 message/stack | fixed | 同 #3(一次修复覆盖两条) | onError 日志 |
| 19 | files/store.ts:485-490 fill 版本字节绕过聚合配额、追加无上限 | fixed | appendVersion 落库后剪枝被取代的中间版本(插入前快照判定,避开并发窗口),保留原件(createdAt === file.createdAt)+ 最新;行先删、blob 尽力删。精确计量需版本 size 列(迁移,依赖) | store.ts appendVersion 剪枝 + quotaBytes 注释;测试 "prunes superseded middle versions" |
| 20 | files/routes.ts:379 import/PATCH JSON 路由无 bodyLimit | fixed | 两条路由各加 `bodyLimit({ maxSize: 64 * 1024 })`(本子应用挂在家族限制之前,无它即无界缓冲) | routes.ts PATCH /:id、POST /import/gmail-attachment |
| 21 | files/store.ts:535-537 insertFile 死代码 | deferred (ownership) | 接口成员被非所有权的 openmuse-deletion.test.ts fake 用作毒行 fixture,移除会使其类型检查失败;已加注释钉住"仅测试 fixture 用,生产必须走 insertFileWithVersion",移除记为依赖 | store.ts OpenMuseFileRows.insertFile 注释 |
| 22 | files/store.ts:307-313 配额 check-then-act 有界竞态 | fixed (comment) | 注释记录接受的 ~N×20MiB 有界超额与收紧路径 | store.ts upload 配额注释 |
| 23 | files/routes.ts:485-486 导入名未清理分隔符/NUL,兜底名可 265 字符 | fixed | `replace(/[\\/\0]/g, "").slice(0, 255)`,兜底名同样截 255 | routes.ts import;测试 "sender-controlled name is stripped" |
| 24 | finance/csv.ts:102-103 空行过滤使 Row N 偏离物理行号 | fixed | 解析循环维护物理行计数(rowStart 固定行起始行,引号内换行不推进),行错误全部改用物理行号 | csv.ts;测试 "blank line mid-file does not shift the reported line numbers" |
| 25 | csv.ts:42-43 csv.length 是码元数非字节 | fixed | `Buffer.byteLength(csv, "utf8") > 500000` | csv.ts;测试 CJK 200k 字符(~600KB)被拒 |
| 26 | csv.ts:85-91 必需列字面量重复 + 逐行 indexOf | fixed | 模块级 `REQUIRED_COLUMNS`;表头校验后 `columnOf` Map 一次预计算 | csv.ts |
| 27 | csv.ts:135-137 Record 插入序注释忽略整数键例外 | fixed (comment) | 注释说明纯数字类整数键在 JSON 序列化时先于字符串键 | csv.ts byCategory 注释 |
| 28 | csv.ts:135-137 分类名 `__proto__` 静默丢失 → 报表自相矛盾 | fixed | `Object.fromEntries`(CreateDataProperty 语义);与 #27 同一注释块 | csv.ts;测试 "__proto__ still reports" |
| 29 | csv.ts:113-115 金额越界错误缺行号前缀 | fixed | `Row ${r.line}: transaction amount is out of range`(与 #24 同一物理行号机制) | csv.ts;测试 |
| 30 | tasks/runner.ts:2211-2217 sweep 循环无 try/finally,claim 抛错永久滞留槽位(高) | fixed | 循环包 try/finally 释放已持有槽位;注释说明 claim 在逐项 try 之外 | runner.ts sweep;测试 "claim failure mid-sweep releases the slots"(ends===[0],任务仍 succeeded) |
| 31 | tasks/routes.ts:121-125 重复 dependsOn 使合法 plan 误判为环 | fixed | `if (dependencies?.delete(id) && dependencies.size === 0)` 只在真实转移时入队 | routes.ts planStepsProblem;测试 duplicated dependsOn 201 |
| 32 | tasks/store.ts:747-755 insertTask 后 offer 抛错被误读为幂等重放(200、无队列项、永久 queued) | fixed | 拆两段 try:仅 insert 失败做幂等重读;offer 失败如实上抛(注释说明误读后果) | store.ts create;测试 "offer failure propagates" |
| 33 | tasks/runner.ts:2060-2069 已落库后的 re-offer 失败被逐项 catch 吞掉(plan 场景还会把已成功的步重 settle 为 failed) | fixed | 新增 `offerContinuation` helper:monitor 成功/失败、plan 下一步三处统一走它,失败记 `openmuse-task-reoffer-failed` 日志后继续(不 unwind 污染已提交状态)。对账重挂扫描为依赖 | runner.ts offerContinuation + 三处调用点 |
| 34 | tasks/routes.ts:51-56 contains 无 selector 是静默失效监控 | fixed | monitorConditionProblem 新增 contains 必带 selector → 400 | routes.ts;测试(400 且零行落库) |
| 35 | tasks/routes.ts:371-373 活跃上限非原子且只守 HTTP 路径 | fixed (comment) | 注释记录两点与下沉 store.create 的依赖 | routes.ts create 分支注释 |
| 36 | tasks/store.ts:1475-1481 waiting_* 取消矩阵与批量关闭不一致 | fixed (comment) | shutdownOwnerTasks 注释记录 RECORDED DIVERGENCE(弃置的 wait 任务仍计活跃上限);矩阵统一是契约决定,依赖 | store.ts shutdownOwnerTasks 注释 |
| 37 | tasks/runner.ts:227-232 price_below 千分位截断误判 | fixed | `raw.replace(/,(?=\d{3}\b)/g, "")` 后再扫描;欧洲式小数逗号的既有局限记入注释 | runner.ts normalizeObservation;测试 "US$1,299.99"→1299.99 等 |
| 38 | tasks/runner.ts:807-815 监控检查失败路径丢弃停止请求 | fixed | catch 内先重读行:取消/暂停标志已置则 settle cancelled/paused(带失败证据)并终止,否则退避重排;失败证据统一为 failureEvidence | runner.ts monitor catch;测试 "stop during a FAILED check is consumed" |
| 39 | tasks/runner.ts:1804-1809 prompt 证据未截断 | fixed | `excerpt: (task.prompt ?? "").slice(0, EXCERPT_MAX)` | runner.ts settle |
| 40 | tasks/store.ts:40-43 waiting_approval 死状态 | fixed (comment) | 类型成员保留(pg enum 与 §7 目录携带它)但注释钉住"无生产者 + 未来接入需同步补齐的矩阵清单" | store.ts OpenMuseTaskStatus 注释 |
| 41 | tasks/routes.ts:189-191 taskDto 整列透传内部 attempt 世代戳 | fixed | `withoutAttempt` 在 DTO 映射时剥离 steps/evidence 行的 attempt;行上保留 | routes.ts taskDto;3 处 retry 测试更新为"行带戳、DTO 无戳"双向断言 |
| 42 | tasks/store.ts:1183-1190 updateTask 绝对值与追加值同传时后者静默覆盖 | fixed | updateTask 顶部互斥守卫(steps/appendedSteps、evidence/appendedEvidence 同传即 throw) | store.ts updateTask(drizzle rows 按仓库惯例不直接单测) |

### 附加修复(非 finding,typecheck 必需)

- tasks/runner.ts document 流(~1475):`appendVersion` 返回 `"stale-parent"` 未处理导致 6 处 TS 错误 — 加显式 throw(任务失败并说明输掉了版本竞争),与 fill 路由 409 语义对齐。

## Totals

- 42 findings:39 fixed(其中 8 条以注释/依赖记录方式落地:#11/#16/#22/#27/#35/#36/#40 + #1 模块侧)、1 条 deferred(#21,所有权阻塞)、2 条与其它条目同根合并计数(#18→#3,#16→#11,均独立验证并各自落地)。
- 新增/改写测试 17 个;触碰 src 11 文件、tests 5 文件,全部未提交。

## Dependencies(跨模块,未在本轮Ownership内修改)

1. **app.ts / mobile-bff 挂载顺序**(#1 根修):把 documents 子应用挂到家族 8KiB bodyLimit 之前(如 openMuseFiles/tasks 的挂法),`OPENMUSE_MAX_FILL_BODY_BYTES` 才是生效上限。
2. **db/drizzle 迁移**(#11/#16/#19 根修):`openmuse_file_versions` 持久化 `parent_version_id`/`values` 并加 `(file_id, parent_version_id)` 唯一索引,让并发 fill 输家在 DB 层失败;版本行加 `size` 列纳入 `sumBytesByOwner` 精确配额(当前以剪枝近似)。
3. **openmuse-deletion.test.ts**(非所有权):其 fake 移除 `insertFile` fixture 成员后,即可从 `OpenMuseFileRows` 接口删除 `insertFile`(#21);同理,若想让批量/剪枝接缝成为必选成员,需同步该 fake。
4. **对账扫描**(#33 根修):为"非终态但无队列项"的任务行增加重挂路径(store 侧 resume/retry/answerWait 的 offer 失败目前是诚实 500,行滞留但有日志信号 `openmuse-task-reoffer-failed`)。
5. **契约决定**(#35/#36):ACTIVE_TASKS_PER_USER 下沉 store.create 单一收口;waiting_* 纳入单行取消矩阵或文档化取舍。
6. **预存 typecheck 噪音**:openmuse-reviewed-actions/store.ts 两个 TS 错误曾来自其他 cluster 的未跟踪文件;本轮终验时已被并发修复(typecheck exit 0)。
