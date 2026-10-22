# OCR ocr-ob-final2 REPAIR round 6 — FINAL CERTIFICATION disposition

Executed 2026-10-14 in OpenBot/.worktrees/v4-base (branch v4/openbot-exec, NO commits per task).
51 findings (8 high + 43 medium). Scope note: the dispatch named server/src/openmuse-* + index.ts + mobile-bff/* + scripts/ as the path set; the coordinator approved option (A) mid-run — fix ALL findings wherever they land (computer/*, app.ts, drizzle/* included). No findings landed in mobile-bff/* or scripts/ this round; those paths needed no change.

Pinned-contract rule applied: where a pinned test contradicted the finding, the conflict was resolved in favor of the finding ONLY when the pinned assertion was itself the certified defect or pinned an incidental mechanism whose own comment disclaims product intent; each such revision is flagged **[test-revised]** below with file:line. No finding was recorded invalid against a product-level contract.

## ═══ HIGH FINDINGS (8) ═══

**[H1 · computer/client.ts:255-257 非法把建连后中断归为"从未到达"] — FIXED.**
  client.ts now classifies fetch rejections through the error and its cause chain (`code` + message): NEVER_REACHED (ECONNREFUSED/ENOTFOUND/EAI_AGAIN/"connection refused") → ComputerUnreachableError (refund side); INTERRUPTED_MID_FLIGHT (ECONNRESET/EPIPE/UND_ERR_SOCKET/"socket hang up"/"connection reset") checked FIRST and outranks refusal wording → ComputerUnavailableError("dropped the connection mid-flight", keeps the charge); unrecognized failures also keep the ambiguous class. Pinned contracts kept: "connect ECONNREFUSED" → "not running" (computer-client.test.ts:549), gateway refund-on-refused (computer-gateway.test.ts:1833). New tests: reset-mid-flight stays ambiguous; cause-code ECONNREFUSED still says not running.

**[H2 · computer/gateway.ts:1325-1327 退款谓词过窄] — FIXED.**
  writeFile's refund set now includes the computer-ANSWERED pre-write refusals: HumanHasControlError (409 gate), WorkspaceRefusedError (403), WorkspaceRequestError (400), WorkspaceNotFoundError (404), WorkspaceTooLargeError (413) — all proven not-landed because the computer answered before writing. Timeout/Stop/mid-flight reset keep the charge. New test: 409-humanHasControl / 403 / 413 each refund; existing "ambiguous 500 keeps charge" pin unchanged.

**[H3 · drizzle/0097 去重把不确定行置 cancelled] — FIXED (+ M8 folded in).**
  0097's dedupe UPDATE rewritten: 4-column key (adds coalesce(target_id,'')), survivor selection per key = earliest UNCERTAIN row (executing/outcome_unknown) else earliest awaiting_review; only pure awaiting_review race duplicates land 'cancelled'. The CREATE UNIQUE INDEX in 0097 now lands the FINAL 4-column form directly. Verified on a scratch DB (openbot_r6check): a1 executing survives over a2/a3 awaiting; b-group (target cal1) and c-group (target cal2) stay distinct; index recreates clean.

**[H4 · connectors/google-oauth.ts nonce 无法经 Google 链路往返,线上必 400] — FIXED via the finding's降级 remedy. [test-revised]**
  The callback's nonce check is now one-sided: a callback that NAMES a nonce must name the right one (400 otherwise); absence proceeds on the session(actor)+state bindings, because Google returns only code/scope/state to the registered redirect_uri — an unknown query parameter provably never round-trips, so the hard demand refused every real consent (G01/G03 dead in production). Nonce still minted/stored/appended to the authorization URL (re-arms if a vendor ever echoes unknown params). Revised pins: openmuse-google-oauth.test.ts:755 (missing-nonce 400→302, retitled one-sided) and the two parameterized copies at :1121 (gmail + googlecalendar matrices) — the revised pins keep the wrong-nonce-400 and right-nonce-302 assertions.

**[H5 · documents 挂载被 mobile-bff 8 KiB family limit 遮蔽] — FIXED (落点 app.ts,与 M4 一并).**
  The documents sub-app mount hoisted OUT of the channelStore conditional and placed BEFORE the bff mount (app.ts, above the channelStore block): its own requireUser answers, the /api/mobile fence (registered earlier) still covers it, and Hono's registration-order composition means the family 8 KiB limit never answers a fill first — the fill's 1 MB and (new) transfer's 64 KiB ceilings are the ones that stand. New test pins the composition: a ~12 KiB fill body reaches the fill route's own 422 validation, not a family 413.

**[H6 · mail/client.ts 五个 Gmail 动作 ID 硬编码] — FIXED.**
  All five GMAIL_*_ACTION_ID constants now read process.env.OPENCONNECTOR_GMAIL_<NAME>_ACTION_ID with the placeholder default — the calendar module's family pattern (catalogue mismatch = deployment variable, not re-release). The existing boot-time placeholder log.info now prints the resolved values.

**[H7 · tasks/runner.ts:2281 外层 catch 静默吞掉 DB 瞬时错误] — FIXED.**
  The catch now logs type openmuse-task-claim-dispatch-failed with key + error (same severity discipline as openmuse-task-reoffer-failed) before the best-effort finish. The stranded-row visibility the finding demanded is in place; the deeper remedies (failure-evidence row, reconciliation scan) remain recorded as the finding's own options, not attempted.

**[H8 · reviewed-actions 无 attempt 的 outcome_unknown 是永久死路] — FIXED via the finding's tombstone remedy.**
  reconcile() backfills a tombstone attempt (recovery-created, no fingerprint, outcome outcome_unknown, startedAt = decidedAt) when latestAttempt is null, then proceeds normally — the operator's tail can close, findSettledSameSend stays intact, no manual DB edit. New test seeds the crash-window aftermath (outcome_unknown, no attempt) and reconciles it closed.

## ═══ MEDIUM FINDINGS (43) ═══

**[M1 · index.ts 字节根目录双实例] — FIXED.** `openMuseFileBytes` hoisted once; store + D06 purger share it.

**[M2 · index.ts openMuseToolsFor 每回合 DB 往返] — FIXED.** Per-(owner,bot) in-process template cache (stable for a bot's lifetime — reprovision lands a new id and misses) + the three personal rows instances hoisted to module scope.

**[M3 · index.ts ops signals 重复 cleanup view] — FIXED.** `openMuseDeletionResourceRows` + `openMuseDeletionCleanup` hoisted above the ops block; both the signals reader and the admin surface use the one instance; the duplicate constructions deleted.

**[M4 · app.ts documents 挂载嵌在 channelStore 条件内] — FIXED** (same hoist as H5).

**[M5 · stream-auth token 进 URL 查询串] — FIXED. [test-revised]** toStreamUrl drops the token; StreamDecision.proxy carries `token` separately; index.ts opens the inward WebSocket with the x-openbot-computer-token header (Bun options form); agent-computer offeredToken accepts the header first on every path with the /stream query kept as browser fallback. Revised pins: stream-auth.test.ts:121 (proxy decision carries token, URL has none) and :181 (toStreamUrl has no token); agent-computer/tests/authorisation.test.ts:66 — the "stream does NOT accept a header" pin flipped, its own comment conceded the restriction was "not a restriction that matters for security".

**[M6 · gateway.ts resetUsage 排在可失败删除之后] — FIXED.** snapshots.clear + pageFrames.clear wrapped in try/finally with capacity.resetUsage in finally — the budget cannot outlive the workspace it describes.

**[M7 · drizzle.config.ts 脆弱 import 图] — FIXED (durable remedy executed).** The two pgTables moved to db/schema/openmuse-deletion.ts; openmuse-deletion/store.ts imports and re-exports them (all callers unchanged); drizzle.config.ts's entry swapped and its comment rewritten to record the completed move.

**[M8 · 0097 去重缺 coalesce(target_id,'')] — FIXED** (folded into H3's rewrite; 4-column key + 4-column index).

**[M9 · 0098 注释方向反 + UPDATE 恒空操作] — FIXED (option a, extended).** 0098_clean_triton.sql deleted outright (journal entry removed): with 0097 now creating the final 4-column index, 0098 had nothing left to do; its provably-zero-row dedupe and wrong-direction comment went with it. The generated successor 0098_openmuse_final_hardening.sql carries only M23/M33's changes with a comment recording the hand-trim of the generator's redundant index churn.

**[M10 · calendar 空页截断丢失续传位置] — FIXED.** Empty page under capped/stoppedShort re-states the inbound cursor's own keyset position (start/id/calendarId) plus providerToken; no inbound cursor → truncation flag stays honest with no cursor (mail's recorded tradeoff, now matched by a comment). New test pins the empty-page cursor.

**[M11 · calendar 游标未绑定查询窗口] — FIXED.** encode/decodeCalendarCursor carry timeMin/timeMax; mismatch answers the same 400 as a foreign cursor. Pre-M11 cursors decode leniently to "" which matches no window (refuse). New test pins the shifted-window 400.

**[M12 · calendar stoppedShort 截断无 nextCursor] — FIXED. [test-revised]** stoppedShort folded into `capped`, so every truncated response carries a resumable cursor. Revised pin: openmuse-calendar.test.ts:830 (repeating-token response: nextCursor undefined→defined) — the route's own STITCH_BUDGET_MS comment ("truncated on, cursor out") declared this intent; the old assertion pinned its violation.

**[M13 · calendar/client.ts 缺启动占位符信号] — FIXED.** Boot-time log.info type openmuse-calendar-placeholder-action-id with the resolved id, mail's baseline shape.

**[M14 · google-oauth CAS 仅比对 status] — FIXED.** overwriteConnection gains optional `expectGeneration` (drizzle WHERE + seam type + test fake mirror); runProviderCall's and refresh()'s auth-expired downgrades pass the snapshot generation, so a concurrent in-place heal (same status, new generation) is not rolled back. New CAS test.

**[M15 · connectors/client.ts 原始 vendor message 落日志] — FIXED.** pushGmailClientConfig's log.warn runs sanitizeLastError (retention.ts's §4 guard) before recording.

**[M16 · connectors/client.ts wire.json() 无条件调用] — FIXED.** 204 short-circuits; a parse failure on wire.ok or the delete seam's tolerated 404 reads as absence (body null), not an unreadable vendor answer — disconnect's 404 tolerance and forwardCallback work on empty bodies.

**[M17 · shutdown.ts 补偿回放被 120 字符截断抹掉] — FIXED.** log.error (type openmuse-work-shutdown-record-failed) records the FULL transitions list server-side before the sanitized throw.

**[M18 · deletion/routes.ts 未接线步骤误报 ok] — FIXED. [test-revised]** shutdown/revoke/manifest now if-guarded like sessions/backup-retention; unwired deployments answer only the steps they can act on. Revised pins: openmuse-deletion.test.ts:379 (no-seams answer steps:{} instead of {shutdown,revoke,manifest} all-ok) and :433 (unwired manifest step absent, not ok) — the module's own sessions-step comment ("keeps exactly the steps it can act on") declared the intent; the old pins enforced its violation. Wired-path pin (request-tracking "ran === [sessions,shutdown,revoke,manifest]") unchanged.

**[M19 · manifest 11 组枚举串行] — FIXED.** All eleven enumerations fan out through one Promise.all (attempt's attemptedKinds push stays synchronous, so resolveGaps/insertResources see the same order); resources reassembled in the original stable order.

**[M20 · purge.ts metadata kind 私有常量] — FIXED.** OPENMUSE_FILE_METADATA_KIND exported at module level.

**[M21 · purge-relational EXTERNAL_KINDS 硬编码字面量] — FIXED.** Metadata kind imported from purge.ts; the two google kinds derived from Object.keys(PROVIDER_BY_CONNECTION_KIND); MARKER_KIND = manifest.ts's new exported OPENMUSE_ACCOUNT_DELETION_KIND (manifest's own gapRows literal uses it too).

**[M22 · files appendVersion 修剪同步删 blob 杀死在飞读取] — FIXED (grace window). [test-revised]** Version rows still go immediately; blob deletion moves behind a grace window (OPENMUSE_PRUNE_GRACE_MS = 60s, injectable pruneGraceMs; 0 = synchronous) so a read() resolved against the old latest finishes. ponytail: setTimeout sweep, per-file sweeper if durability/multi-process matters. Revised pin: openmuse-files.test.ts:1040 prune test now injects pruneGraceMs:0 (same end-state assertions); new grace test pins the window.

**[M23 · documents 版本分叉竞态] — FIXED (持久化 remedy executed).** openmuse_file_versions gains parent_version_id (schema + 0098 migration) with partial unique index (file_id, parent_version_id) WHERE parent_version_id IS NOT NULL; drizzle insertVersion persists it; appendVersion maps the 23505 on openmuse_file_versions_parent_uq to "stale-parent" (the route's 409 finally true for the concurrent case); route comment updated. rowToStored mapper added (null↔undefined at the seam).

**[M24 · transfer 无本地 bodyLimit] — FIXED.** routes.post("/:id/transfer", bodyLimit 64 KiB with named 413) — tasks-grade; new test pins it.

**[M25 · transfer 生产永久 503 + 清理 seam 不可能] — RECORDED DEPENDENCY (comment hardened).** transfer.ts's seam citation now names BOTH wiring-ticket prerequisites explicitly: a binary-capable gateway WRITE and a REMOVE (delete) verb for the half-write cleanup — neither exists on ComputerGateway today; wiring without both would ship §5's no-false-completion promise on a seam that cannot honor it. No code change possible until the gateway verbs exist.

**[M26 · fill 双重解析 PDF] — FIXED.** PdfFillAdapter is loader-shaped ((load: () => Promise<PDFDocument>, supported, values)); inspect.ts exports extractPdfDocument (doc-shaped); the fill route and the runner's document fill memoize ONE loadPdfDocument shared by inspection and adapter. applyFill unit test pins the single load.

**[M27 · files 上传 PDF 魔数未归一 mimeType] — FIXED.** isPdf true pins the stored type to PDF_MIME (generic-claim PDFs become inspectable/fillable; the "%PDF-" polyglot claiming text/html can no longer store the refused name); comment records both halves.

**[M28 · mail dialAction 传输层失败未分类] — FIXED (calendar's shared seam too).** mail dialAction wraps deps.dial: transport failures → OpenMuseMailVendorError ("could not be reached") + openmuse-mail-vendor-failed log (502, distinguishable from unconfigured-OPENCONNECTOR_URL 503). calendar list() same treatment; callAction answers {ok:false,status:null,body:null} (definite pre-flight failure for the executors) after its own named log. New mail tests (502 + message).

**[M29 · mail.ts null 行整页 503] — FIXED.** mapProviderMessage drops non-object rows before row.id; new test pins the sparse page.

**[M30 · 附件字节解码前无廉价上限] — FIXED. [test-revised]** ATTACHMENT_MAX_BYTES moved to mail/client.ts (routes re-export); providerAttachmentBytesOf refuses base64 over ceil((MAX+2)/3)*4 BEFORE the replaceAll/decode/copies. Revised pin: openmuse-mail.test.ts:1291 lying-provider test — the buffered-then-413 path the finding names as the OOM vector is now the pre-decode 502 ("byte ceiling"); the limit-Is-a-property-of-the-bytes intent is preserved and stated in the test.

**[M31 · notifications insertNotification 遮蔽死代码] — FIXED.** Misindented duplicate ownerDisabledRow line removed.

**[M32 · notifications store 死导入] — FIXED.** openmuseAccountDeletions import removed (also removed the same dead import left in openmuse-tasks/store.ts by round-5's shared consolidation).

**[M33 · ops signals outcome_unknown 全表扫描] — FIXED.** Partial index openmuse_reviewed_actions_outcome_unknown_idx on (created_at) WHERE status='outcome_unknown' (schema + 0098 migration); reader comment cites it.

**[M34 · signals 把重试耗尽的队列行误报为 stuck] — FIXED.** Reader selects attempts/lastError into OpenMuseOpsTaskQueueRow; the filter excludes attempts >= OPENMUSE_TASK_MAX_ATTEMPTS (2, now exported from capacity.ts and used by the runner's own claim). Test fake extended with a done-with row that must not report.

**[M35 · task_delegate 配额 check-then-act 竞态] — FIXED (bound sunk to the insert).** drizzle insertTask wraps count+insert in one transaction under pg_advisory_xact_lock(hashtextextended(owner)); over-cap throws new OpenMuseTaskQuotaError; store.create propagates it; routes map it to the same 409 TASK_LIMIT_MESSAGE; tools catch it as the quota REFUSAL_MARKER string. Pre-checks stay as fast paths (routes' recorded NOTE updated to "closed"). Test fake mirrors; new store-level test (cap fills, 101st refuses, terminal frees a slot, other owner unaffected).

**[M36 · reconcile 收尾不写 completedAt/providerRef] — FIXED.** reconcile's claimTransition patch carries completedAt + (confirmed_succeeded ∧ providerEventId → providerRef); action and attempt ledgers now agree. New test.

**[M37 · 23505 兜底对 awaiting 孪生谎报 uncertain] — FIXED.** On the index refusal, propose re-queries new rows.findAwaitingSameSend; a twin answers ReviewedActionReproposalError("already_proposed") with its own sentence ("decide it or let it expire"); executing/outcome_unknown keep "uncertain". Existing 23505 pins unchanged (their fixtures hold no awaiting twin); new twin test.

**[M38 · reviewed-actions ownerDisabled stub 恒 false] — FIXED.** Drizzle rows read the real D01 marker (phase-aware, connectors-store shape); stale "until it exists" comment replaced with the real citation (T16 background path bypasses the /api/mobile fence — the reason the stub mattered).

**[M39 · 执行器把拨号前错误归为 outcome_unknown] — FIXED (all four executors).** Each execute tracks `dialStarted`; the shared settleDialFailure (executor.ts) settles pre-dial errors (requireConnection's transient DB failure, anything before the dial promise exists) as definite failed with a fixed sentence (raw driver message stays in the log), ConnectionRefused as before, post-dial as outcome_unknown. New pre-dial test (gmail.send); applies identically to gcalendar create/update/delete.

**[M40 · 占位 action id 无目录注入/启动信号] — FIXED.** Each executor separates the §6 KIND (API contract, fingerprints) from a DIAL_ACTION_ID env-overridable (OPENCONNECTOR_GMAIL_SEND/GCAL_CREATE/GCAL_UPDATE/GCAL_DELETE/GCAL_GET_ACTION_ID); dispatch-executor.ts logs openmuse-reviewed-action-placeholder-ids with all five resolved values at boot (mail/calendar baseline). Hard boot-fatal assertion NOT taken (would kill placeholder-default deployments); the visible-at-boot signal + env override is the finding's named alternative.

**[M41 · 四执行器骨架逐行重复] — FIXED-PARTIAL (deliberate).** The lockstep-critical tail (result mapping + ambiguity direction + M39's pre-dial split + log fields) unified into executor.ts's settleDialFailure applied to all four; a full-skeleton template was judged net-negative — the four success paths genuinely differ (create reads providerRef from the answer; update/delete answer targetId; fingerprints differ) and the config surface would rival the duplication. Documented at the helper.

**[M42 · runner 租约恢复 prologue 四份雷同] — FIXED-PARTIAL (deliberate).** The three structurally identical copies (monitor/finance/document) unified into recoverLease(task, {entryStatus, priorEffect, ambiguousExcerpt, ambiguousDetail}) returning the generation or null; the generic branch's steps-aware variant retained on purpose (its priorEffect reads steps and its ambiguous settle writes the plan graph — different policy, not drift) with a cross-reference comment. All T07 recovery tests green through the extraction.

**[M43 · 取消矩阵拒绝 waiting_input/waiting_review] — FIXED. [divergence reconciled]** Both statuses join requestTaskCancel's matrix (drizzle + test fake + shutdownOwnerTasks' RECORDED DIVERGENCE note rewritten as reconciled; pause still refuses them — a paused wait has no resume-into-wait path). New test: both cancel; terminal rows still re-answer.

## Files + shasum (sha256, first 16 hex)

```
4ec760fc82234e6f  server/src/computer/client.ts            0e1537dbc5ee9511  server/src/computer/gateway.ts
30c48e7cc78c224d  server/src/computer/stream-auth.ts       9ee000e6f5936ed9  server/src/index.ts
f2985421b8dafb21  agent-computer/src/authorisation.ts      96777b07e6a69e0f  server/drizzle/0097_openmuse_user_fks_and_gates.sql
a7ff1c8eb8a9ed9a  server/drizzle/0098_openmuse_final_hardening.sql   (0098_clean_triton.sql DELETED, journal entry removed)
dee190a5450d76a5  server/drizzle.config.ts                 9db064848cbf69c1  server/src/db/schema/openmuse.ts
6f1b5ef322faebe5  server/src/db/schema/openmuse-deletion.ts (NEW)
1bf4df54db1fc4eb  server/src/openmuse-deletion/store.ts    ed7ce1eb711e1f79  server/src/openmuse-deletion/shutdown.ts
e929cdd1afc20a74  server/src/openmuse-deletion/routes.ts   2f232ef153467d61  server/src/openmuse-deletion/manifest.ts
c505eb7f340059f0  server/src/openmuse-deletion/purge.ts    7fa8024e8967fe67  server/src/openmuse-deletion/purge-relational.ts
b63bf327234bc741  server/src/openmuse-connectors/client.ts 9d6ebb20eefe7510  server/src/openmuse-connectors/store.ts
f372d0f661aa7da5  server/src/openmuse-connectors/google-oauth.ts
9422d2d9217dda2c  server/src/openmuse-mail/client.ts       b1ba78725738c2bf  server/src/openmuse-mail/routes.ts
dc8de4bed2579e48  server/src/openmuse-mail/mail.ts         d0b78613fcae8b42  server/src/openmuse-calendar/client.ts
d0975d080e3ca491  server/src/openmuse-calendar/routes.ts   d1bdd8d99ad9181d  server/src/openmuse-calendar/calendar.ts
f6c349729c2a416e  server/src/openmuse-files/store.ts       c8a7110854045f46  server/src/openmuse-files/routes.ts
6f3034b43ded6a58  server/src/openmuse-documents/routes.ts  078c47175de09cf3  server/src/openmuse-documents/fill.ts
68cde982a692fd34  server/src/openmuse-documents/inspect.ts 8c4091f1139b4337  server/src/openmuse-documents/transfer.ts
d76ef70655bae63b  server/src/app.ts                        f68cf1da45f44475  server/src/openmuse-notifications/store.ts
84c08da07c20fbcf  server/src/openmuse-ops/signals.ts       f301833743f9ecf8  server/src/openmuse-personal/tools.ts
42009fd9641234d3  server/src/openmuse-tasks/store.ts       fdb34b1fb6b92769  server/src/openmuse-tasks/routes.ts
00f9750f04cddbca  server/src/openmuse-tasks/runner.ts      a7d104c86dec4357  server/src/openmuse-tasks/capacity.ts
a7d709df2a75e670  server/src/openmuse-reviewed-actions/service.ts    325996b51ee8d92a  server/src/openmuse-reviewed-actions/store.ts
d7c51dbe11503759  server/src/openmuse-reviewed-actions/executor.ts   64651a6954d57363  server/src/openmuse-reviewed-actions/dispatch-executor.ts
8bb3ed60f9409d18  server/src/openmuse-reviewed-actions/gmail-send-executor.ts
77f3ce323e5a35e2  server/src/openmuse-reviewed-actions/calendar-create-executor.ts
8389358ac565912f  server/src/openmuse-reviewed-actions/calendar-update-executor.ts
a018bf5687ff436a  server/src/openmuse-reviewed-actions/calendar-delete-executor.ts
acd354a8fb2e46ca  server/tests/computer-client.test.ts     0f0006f7622706ec  server/tests/computer-gateway.test.ts
1eb753ee3b173af1  server/tests/stream-auth.test.ts         cfc0bc2b2b120821  agent-computer/tests/authorisation.test.ts
b03259286e51133a  server/tests/openmuse-google-oauth.test.ts  c59c227e7c3cbd03  server/tests/openmuse-mail.test.ts
ded87f3c685fd859  server/tests/openmuse-calendar.test.ts   9e14e788e4c5357e  server/tests/openmuse-deletion.test.ts
a52c53c92f66b3c6  server/tests/openmuse-files.test.ts      6bde09843489bde1  server/tests/openmuse-documents.test.ts
3bf9783d702feb53  server/tests/openmuse-ops-signals.test.ts c709eba8651db5c7  server/tests/openmuse-tasks.test.ts
26a8faceaa15854c  server/tests/openmuse-reviewed-actions.test.ts
```

## Verification

- `bunx tsc --noEmit -p .` (server) — clean. `bunx biome lint` over all 59 touched files — clean (repo-wide remaining findings are pre-existing in untouched files: billing/codesandbox/craft/kb).
- `drizzle-kit check` — "Everything's fine"; drift probe `generate --name=ci_drift_probe` — "No schema changes"; fresh-DB migrate walk on scratch openbot_r6check — 99 migrations applied, parent_version_id + all three new/changed indexes verified; 0097 dedupe semantics proven on synthetic rows (uncertain survives; 4-col key separates targets).
- Per-file suite tails (touched suites, TEST_DATABASE_URL=openbot_test):
  - computer-client + computer-gateway + stream-auth + computer-routes + computer-download-routes + openmuse-google-oauth + openconnector-{transport,adapter,access} + google-oauth-transport + connector-tokens-never-reach-computer: `242 pass / 0 fail` (11 files)
  - openmuse-{mail,calendar,deletion,files,documents,notifications,ops-signals,tasks,personal-tools,reviewed-actions,goals,ideas,memories,activity} + request-tracking: `636 pass / 1 fail` — the 1 fail IS the task's declared pre-existing gated-DB pattern fail (openmuse-activity.test.ts:1172 "reviewed lister keyset (drizzle)" seeds three same-key awaiting_review rows that violate the active-send unique index dating to 0081, untouched by this round)
  - agent-computer authorisation + runtime-hardening: `17 pass / 0 fail`; control-http/control untouched this round (prior-round changes only)
  - Full-suite tails (touched per-file batches — the task's "full set" is the v4 suite set; 871-baseline + ~24 new tests this round ≈ 895):
```
242 pass / 0 fail   (computer+connectors batch, 11 files)
636 pass / 1 fail   (openmuse batch, 15 files; the 1 = pre-existing gated-DB seed pattern, above)
 17 pass / 0 fail   (agent-computer authorisation/runtime-hardening)
 17 pass / 0 fail   (server computer-provider, re-run standalone after one load-flaky full-run timeout)
 44 pass / 0 fail   (mobile-bff + schema + computer-provider: app.ts mount order and db/schema changes)
 17 pass / 0 fail   (openmuse-finance: the runner's fill-path change)
```
- Whole-repo `bun run test` (9152 tests, 199s) as an extra sweep: ZERO failures in any openmuse/computer/stream-auth suite; its 366 fails are all in service-dependent suites outside this round's scope (channel/knowledge/workshop/kb/tenant — need docker services not running in this environment) plus one 8s-timeout test (computer-provider "aborts fetch that never settles") that passes standalone in 269ms — load-induced flake under full-repo contention, re-verified green.

## Dependencies recorded (no code change possible this round)

1. M25: transfer wiring ticket needs BOTH gateway verbs — binary-capable write AND remove/delete.
2. H7 deeper remedies (optional): failure-evidence row on the stranded claim, or a periodic reconciliation scan re-offering non-terminal rows without queue items.
3. M22 upgrade path: per-file blob sweeper if durability/multi-process collection ever matters (current: 60s setTimeout sweep).
