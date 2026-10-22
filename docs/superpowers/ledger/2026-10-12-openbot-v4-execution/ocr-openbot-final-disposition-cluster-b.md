# OCR openbot-final repair round 4 — cluster B disposition

Scope: EVERY high+medium finding in `server/src/openmuse-tasks/*`,
`server/src/openmuse-files/*`, `server/src/openmuse-finance/*`,
`server/src/openmuse-documents/*` of `ocr-openbot-final.txt` — 19 findings
(2 high, 17 medium). Each was re-verified against the current tree at
`.worktrees/v4-base` (branch `v4/openbot-exec`, prior uncommitted repair
waves in place) before acting. Nothing committed, per instruction.

Legend: **fixed** = code changed this pass; **fixed-before** = a prior wave
already repaired it (verified against current code, pinned test cited);
**dependency** = valid, but the minimal correct fix lives in files outside
this cluster (app wiring / schema+migration), recorded, no code change.

## openmuse-documents

| Finding | Verdict | Action | Evidence |
| --- | --- | --- | --- |
| routes.ts:170-173 [bug·med] fill 的 1 MiB bodyLimit 在家族 8 KiB 限制之后挂载,不可达 | dependency | Verified the mount is still after the bff family limit (`server/src/app.ts:1993` mounts `openMuseDocuments` after `app.route("/api/mobile", bff)`; `server/src/mobile-bff/routes.ts:76` is the family `bodyLimit({maxSize: 8_192})`). The gap is recorded in-module (`routes.ts:37-46` "KNOWN MOUNT GAP"). The in-scope alternative (shrink the constant to 8 KiB) is rejected: §5 pins 10,000 chars/field, so a two-field long fill (~20 KiB) is legitimate, and the pinned route test ("an oversized JSON body answers 413", `openmuse-documents.test.ts:1302-1315`) pins the 1 MiB ceiling — shrinking would silently break the §5 contract. The mount reorder is app.ts/mobile-bff wiring (dependency 1) | `server/src/openmuse-documents/routes.ts:37-46` |
| transfer.ts:58 [bug·med] MAX_LEDGER_ENTRIES=5000 超出接缝最小上限,台账读截断后静默清空 | fixed-before | Bound is now 100 with corrected 64 KB-read-cap arithmetic; pinned test asserts the shed ledger stays under 64,000 bytes | `server/src/openmuse-documents/transfer.ts:52-64`; test `openmuse-documents.test.ts` "a ledger past the eviction threshold sheds failed and oldest entries" |
| routes.ts:114-125 [bug·med] onError 把提取/填充阶段的 pdf-lib 原生错误归为 503,日志只记 error.name | fixed + fixed-before | Logging half fixed before (full `name: message` + stack, `routes.ts:124-138`); fill-adapter half fixed before (native walk/save errors → `PdfRefusalError("pdf_malformed")`, `fill.ts:150-160`). The EXTRACTOR half was still open — `createPdfFieldExtractor` let `getForm()/getFields()` native throws escape to the 503 fallback. Fixed this pass: post-load walk wrapped, native errors refuse as `pdf_malformed` (route 400) | `server/src/openmuse-documents/inspect.ts:177-199`; new seam test "an AcroForm that loads but breaks while walked refuses as pdf_malformed" + new route test "a torn AcroForm that breaks while walked answers 400, not a retry-me 503" (RED→GREEN) |
| routes.ts:242-247 [bug·med] 409 注释声称 "the store refused",但 append 的 check-then-insert 非原子 | fixed-before + dependency | Comment rewritten to name the non-atomicity and the `(file_id, parent_version_id)` unique-index migration; store records the same KNOWN LIMIT. DB-level enforcement needs the provenance-column migration (dependency 2) | `server/src/openmuse-documents/routes.ts:302-312`; `server/src/openmuse-files/store.ts:534-543` |

## openmuse-files

| Finding | Verdict | Action | Evidence |
| --- | --- | --- | --- |
| **[high]** store.ts:702-713 墓碑文件逃过账号删除清单 | fixed-before | `versionsByOwner` no longer filters `deletedAt` (tombstones' bytes are D06's to purge); pinned test "enumerateOwner keeps a tombstoned file's versions — the deletion manifest must purge them too" | `server/src/openmuse-files/store.ts:831-856`; `openmuse-files.test.ts:997` |
| store.ts:733-740 [bug·med] hardDeleteFile 两删非事务 | fixed-before | Both deletes inside one `database.transaction`, versions-first, owner-scoped subselect | `server/src/openmuse-files/store.ts:857-890` |
| store.ts:481-484 [bug·med] stale-parent 并发契约无 DB 兜底 | fixed-before + dependency | KNOWN LIMIT recorded at the check (non-atomic, no unique index); enforcement needs the `parent_version_id` migration (dependency 2) | `server/src/openmuse-files/store.ts:534-543` |
| store.ts:380-381 [perf·med] list 路径 N+1 | fixed-before | Batch seam `latestVersionsForFileIds` (one query per page, newest-first first-seen), fallback preserved for older fakes | `server/src/openmuse-files/store.ts:141-143,412-438,753-767` |
| store.ts:485-490 [sec·med] fill 版本追加绕过聚合配额、旧版本 blob 永不清理 | fixed-before | Superseded MIDDLE versions pruned (rows before bytes) once the new one lands; original + latest survive; pinned test "a fill-append prunes superseded middle versions, keeping the original and the latest" asserts rows AND blobs gone | `server/src/openmuse-files/store.ts:556-613`; `openmuse-files.test.ts:1040` |
| routes.ts:379 [sec·med] import/gmail-attachment 与 PATCH /:id 无 bodyLimit | fixed-before | Both JSON routes carry `bodyLimit({ maxSize: 64 * 1024 })` | `server/src/openmuse-files/routes.ts:331,390-393` |

## openmuse-finance

| Finding | Verdict | Action | Evidence |
| --- | --- | --- | --- |
| csv.ts:102-103 [bug·med] 空行过滤后 "Row N" 非物理行号 | fixed-before | Rows carry their physical line (`rowStart`, unquoted-`\n` counting); errors use `r.line`; pinned test "a blank line mid-file does not shift the reported line numbers" | `server/src/openmuse-finance/csv.ts:51-100,121,129`; `openmuse-finance.test.ts:142` |
| csv.ts:135-137 [bug·med] "__proto__" 分类被原型 setter 吞掉 | fixed-before | `byCategory` built via `Object.fromEntries` (own-property semantics); pinned test "a category literally named __proto__ still reports…" | `server/src/openmuse-finance/csv.ts:147-162`; `openmuse-finance.test.ts:177` |
| csv.ts:113-115 [bug·med] 金额越界错误缺行号前缀 | fixed-before | `` `Row ${r.line}: transaction amount is out of range` ``; pinned test asserts the prefix | `server/src/openmuse-finance/csv.ts:131-133`; `openmuse-finance.test.ts:163` |

## openmuse-tasks

| Finding | Verdict | Action | Evidence |
| --- | --- | --- | --- |
| **[high]** runner.ts:2211-2217 sweep 循环无 try/finally,claim 抛错泄漏容量槽位 | fixed-before | `try { … } finally { for held → capacity.end() }`; pinned test "a claim failure mid-sweep releases the slots it already began" (asserts `ends === [0]`) | `server/src/openmuse-tasks/runner.ts:2252-2268`; `openmuse-task-runner.test.ts` |
| routes.ts:121-125 [bug·med] 重复 dependsOn 条目误判为环 | fixed-before | Frontier push only on `dependencies?.delete(id)` returning true; pinned test "a duplicated dependsOn entry does not read as a cycle" | `server/src/openmuse-tasks/routes.ts:132-141`; `openmuse-tasks.test.ts:1846` |
| store.ts:747-755 [bug·med] insert 后 offer 失败被折叠为幂等重放 (created=false,无队列项) | fixed-before | Insert and offer split into two try blocks; offer failure propagates honestly; pinned test "an offer failure after a successful insert propagates — never misread as an idempotent replay" | `server/src/openmuse-tasks/store.ts:742-775`; `openmuse-task-runner.test.ts` |
| runner.ts:2060-2069 [bug·med] 落库后的 re-offer 失败被逐项 catch 吞掉,行永久滞留 | fixed + fixed-before | Plan next-step and monitor re-arm already went through `offerContinuation` (loud `openmuse-task-reoffer-failed` log, `runner.ts:458-487`). Two review-path sites still used the raw `queue.offer`: the review POLL's `reoffer` and the review PARK's offer — the park's failure also misfiled the item as `skipped` and dropped the `task.waiting_review` notification. Both now route through `offerContinuation`. New pinned test "a park whose re-offer fails still reports ran, notifies, and never sinks the sweep" (RED→GREEN). Store-side resume/retry/answer offers propagate as honest 500s per the recorded choice; a reconciliation scan for stranded non-terminal rows remains the recorded dependency 3 | `server/src/openmuse-tasks/runner.ts:1149-1155,1576-1584`; `openmuse-task-runner.test.ts` |
| routes.ts:51-56 [bug·med] contains 无 selector 静默失效 | fixed-before | Creation matrix refuses a selector-less contains (400); pinned test "a contains condition without its selector answers 400, not a silently dead monitor" | `server/src/openmuse-tasks/routes.ts:66-70`; `openmuse-tasks.test.ts:2146` |
| runner.ts:807-815 [bug·med] monitor 检查失败路径丢弃停止请求 | fixed-before | The catch re-reads the row and consumes `cancellationRequested`/`pauseRequested` (settle cancelled/paused with failure evidence) before the backoff re-arm; pinned test "a stop landing during a FAILED check is consumed, never wedged behind the backoff" | `server/src/openmuse-tasks/runner.ts:828-878`; `openmuse-task-runner.test.ts:1723` |

## Totals

- 19 findings: **2 fixed this pass** (the extractor's native pdf-lib walk
  errors → `pdf_malformed`/400, with 3 new tests; the review-poll and
  review-park re-offers routed through the loud `offerContinuation` seam,
  with 1 new test — 4 files touched), **16 fixed-before** (verified
  against current code, pinned tests cited; two of them carry a recorded
  migration dependency for DB-level enforcement), **1 dependency-only**
  (the fill bodyLimit mount gap, recorded in-code and re-verified).
- 2 high (files tombstone enumeration, tasks sweep capacity leak): both
  fixed before this pass with pinned tests; no high finding remained
  open.

## Files modified this pass (sha256)

- `server/src/openmuse-documents/inspect.ts` — `62bad1e2ef127908b09b6a05852c33f17b1e478a3e9c2a322305f5be5c2e1243`
- `server/src/openmuse-tasks/runner.ts` — `34cc6a6f58e29251cc551669f1a1ba2d13aaa88fb2b53b01ff02a6aad42f2e7c`
- `server/tests/openmuse-documents.test.ts` — `a354b5f3038160403570db5f84af4c4dd8cb1ceb8e9b531963688c18024008f5`
- `server/tests/openmuse-task-runner.test.ts` — `f340aebd8a3491cb11a9122673b396fc97dcf978339c685d8d8d7433abaf1c1a`

## Verification

- `bun test server/tests/openmuse-tasks.test.ts server/tests/openmuse-files.test.ts server/tests/openmuse-finance.test.ts server/tests/openmuse-task-capacity.test.ts server/tests/openmuse-task-lease-recovery.test.ts server/tests/openmuse-documents.test.ts server/tests/openmuse-task-runner.test.ts`
  → **312 pass / 0 fail** (1342 expect() calls).
  New tests were RED against the pre-fix tree (3 fail) and GREEN after.
- `bun run --filter server typecheck` → exit 0.
- `bunx biome lint` + `format` over the 4 touched files → clean.

## Dependencies (cross-module, outside this cluster)

1. **app.ts mount order** — mount the documents sub-app inside the bff
   BEFORE `routes.use("*", bodyLimit({maxSize: 8_192}))` (the way
   openMuseFiles/openMuseTasks are mounted, `mobile-bff/routes.ts:70-76`)
   so the fill route's own 1 MiB ceiling is the one that stands; recorded
   at `openmuse-documents/routes.ts:37-46`.
2. **Version-chain concurrency migration** — persist `parent_version_id`
   on `openmuse_file_versions` + `UNIQUE (file_id, parent_version_id)` so
   a lost append race fails at the insert and maps to "stale-parent";
   recorded at `openmuse-files/store.ts:534-543` and
   `openmuse-documents/routes.ts:302-312`.
3. **Stranded-row reconciliation** — a scan that re-offers non-terminal
   task rows with no queue item (covers store-side resume/retry/answer
   offer failures that currently surface as honest 500s with no retry
   path); the loud `openmuse-task-reoffer-failed` log is the interim
   signal.
