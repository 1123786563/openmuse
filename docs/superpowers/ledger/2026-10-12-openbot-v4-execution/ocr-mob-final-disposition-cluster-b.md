# OCR final-pass disposition — cluster B (mobile: chat/computer/control/channels/tools)

Source: `ocr-mob-final-cluster-b.txt` (17 findings), verified 2026-10-14 against the
current tree at `.worktrees/v4-base` (branch `v4/openbot-exec`, uncommitted).
Prior 13:12 UTC repair wave had already landed several fixes — those verify as
fixed-before below.

## Dispositions

| # | Finding (file:lines) | Verdict | Action | Evidence |
|---|---|---|---|---|
| 1 | chat.tsx:264 send-guard missing awaitingReply ref | fixed-before | none | `chat.tsx:279` — `if (!text \|\| awaitingReply.current \|\| agent.isRunning \|\| restoring \|\| restoreFailed) return;` with the same-frame rationale comment; landed by the 13:12 round |
| 2 | tool-cards.ts:185-193 kind 4-level nested ternary | fixed-before | none | `tool-cards.ts:202` — `named ?? KIND_BY_STATUS[event.status ?? "none"]`, nested ternary replaced by the lookup table |
| 3 | tool-cards.ts:158-159 computer_screenshot start card claims 「已获取屏幕截图」 | fixed | start-status screenshot events now take the event-name summary; renderSummary case annotated | `tool-cards.ts:221-222` (`else if (event.status === "start" && kind === "computer_screenshot") summary = safeTruncate(event.name)`); case comment at `tool-cards.ts:160-162`; new test `openbot-tool-cards.test.ts:219` (start card neutral, no success copy; result card keeps it) |
| 4 | chat-state.ts:93-95 historyKey unused + misleading comment | fixed-before | none | `chat-state.ts:91` — comment already honest since the 13:12 round: "the app currently does NOT call it … stays because its contract is pinned by openbot-chat-state.test.ts" (the test-only-seam option the finding offers) |
| 5 | chat.tsx:427-428 multiline onSubmitEditing silently dead on iOS | fixed | removed `onSubmitEditing={send}` (multiline drafts own the return key; send button is the single submit entry); send() guard comment updated to the double-tap window | `chat.tsx:453-455` (comment in place of the prop); `chat.tsx:273-276` |
| 6 | channel-actions.ts:47 loose `!= null` in partitionArchived | fixed | explicit double check `!== null && !== undefined` (undefined = pre-archive row = active; single `!== null` would misfile it) | `channel-actions.ts:49-51`; undefined→active already pinned by `openbot-channel-actions.test.ts:80-82` |
| 7 | channels.tsx:188 loose `!= null` for archivedRow | fixed | same explicit double check | `channels.tsx:199-200` |
| 8 | channels.tsx:135-138 rename double-submit (onSubmitEditing + save button) | fixed | `renameInFlightRef` sync gate around runAction, cleared in `finally` | `channels.tsx:103-107` (ref), `146`, `152`, `158`; no React-component test infra in this repo (all suites are pure node:test seams) — verified by inspection, mirrors chat.tsx awaitingReply precedent |
| 9 | channels.tsx:163-166 static inline styles | fixed | headerRow / scrollContent / footer / busyRow moved into StyleSheet.create | `channels.tsx:49-59`, used at `167`, `179`, and the footer block |
| 10 | chat.tsx:194-202 run-error path missing runEnded suppression of late stop rejection | fixed-before | none | `chat.tsx:141` `runEnded` ref; set in `fail()` (`chat.tsx:186-189`) and the runAgent catch; stop's catch guards `if (stopOutcome.current \|\| runEnded.current) return;` |
| 11 | chat.tsx:292-296 stop at-most-one-stopAgent only state-guarded | fixed | `stopPendingRef` sync gate before the reducer dispatch, released in `.finally` | `chat.tsx:142-148` (ref), `310-318` (gate + set), `333-335` (finally); reducer idempotence itself already tested in openbot-stop-state.test.ts |
| 12 | tool-cards.ts:200-201 status nested ternary | fixed | replaced with `STATUS_BY_OUTCOME` lookup table (matches the KIND_BY_STATUS style already in the file) | `tool-cards.ts:86-90`, `209`; all 11 status-bearing tool-cards tests still green |
| 13 | control.tsx:225-226 cancel() resets generation via initialControlState() | fixed-before | none | `control.tsx:234` — `commit(controlCancelled(stateRef.current))` with the generation-collision comment; `controlCancelled` in control-state.ts keeps generation monotonic; covered by `openbot-control-state.test.ts:315` |
| 14 | computer.tsx:199-203 nested ternary preview | fixed | `previewNode` computed imperatively before the JSX, rendered as a single slot | `computer.tsx:191-215` |
| 15 | computer.tsx:58-66 chipBase/chipTint duplicated across 5 screens | deferred (cross-module) | none — extraction requires editing calendar.tsx / connections.tsx / tasks.tsx and creating a shared module, all outside cluster B ownership | chipBase confirmed verbatim in computer.tsx:60-69 and control.tsx:48-57 (both owned, but the other 3 files are not); see Dependencies |
| 16 | computer.tsx:179-188 static inline styles (+ control.tsx named in the finding) | fixed | computer.tsx: headerRow/body/loadingRow/previewEmpty into StyleSheet; control.tsx: headerRow/requestRow/controllingBody/typeRow (the spots the finding names); dynamic styles (aspectRatio preview, pressed opacity, chip tints) stay inline | `computer.tsx:89-99`, `control.tsx:84-87` |
| 17 | control-state.ts:123-124 controlSignedOut dead export | fixed | deleted the export and its test block — grep confirms zero production call sites (only its own test); the real sign-out path is control.tsx's unmount cleanup (release/cancel best-effort) | removed from `control-state.ts` (was after controlCancelled) and `openbot-control-state.test.ts` (import line + "logout" test); recoverable from git history if a real sign-out flow ever wires it |

## Totals

- fixed: **11** (findings 3, 5, 6, 7, 8, 9, 11, 12, 14, 16, 17)
- fixed-before (13:12 round, verified): **5** (1, 2, 4, 10, 13)
- deferred (valid but cross-module): **1** (15)
- invalid: **0**

## Verification (all required, all green)

1. `pnpm exec tsx --import ./tests/setup.ts --test` over the 8 acceptance suites
   (openbot-chat-state, openbot-computer-status, openbot-computer-state,
   openbot-control-state, openbot-channel-actions, openbot-channel-state,
   openbot-tool-cards, conversation-queue): **77 pass / 0 fail**
   (controlSignedOut test removed −1, in-flight screenshot test added +1).
2. `pnpm run typecheck` (root tsc + mobile tsc): **clean**.
3. `bunx biome check` on all 10 touched files: **clean**.

## Dependencies (cross-module, for the coordinator)

- **chipBase/chipTint dedup (finding 15)**: verbatim chip styles live in
  calendar.tsx, connections.tsx, tasks.tsx in addition to the two owned files.
  A shared `openbot` chip module needs an owner for those three files (or a
  follow-up cluster covering them).
- **Test-only seams outside this cluster (finding 4's siblings)**:
  stop-state.ts `terminalOf`, stream-resume.ts `dedupeByEventId` /
  `RenderSet.lastEventId` remain test-only seams; same disposition question as
  historyKey, but those files are outside cluster B ownership. chat-state.ts's
  own historyKey was left in place with its already-honest comment.
- **Component-level race guards (findings 5, 8, 11)**: no React-component test
  harness exists in this repo (every suite is a pure node:test seam); the ref
  gates are inspection-verified and follow the `src/chat.tsx` runLock /
  chat.tsx awaitingReply precedents.

Everything left uncommitted as instructed.
