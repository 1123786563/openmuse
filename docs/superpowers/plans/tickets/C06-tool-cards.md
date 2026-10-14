# C06 — Render named tool events and failures: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD for pure seams. Predecessors C01+C05 verified+integrated.

**Goal:** Every event class in contract §3's tool-event fixture list has a readable card or a neutral fallback: text delta, tool start, tool result, tool error, reviewed-action card, Policy approval card, computer screenshot, browser navigation, mail thread, calendar event, file artifact, unknown event. A tool error renders as an error (never success); unknown events render neutrally.

**Architecture:** Pure seam `src/openbot/tool-cards.ts`: `classifyToolEvent(event)` → typed card model {kind, title zh-CN, body summary, status} with a registry keyed by the event's tool name/shape; `renderSummary(kind, payload)` extracting a safe ≤120-char summary per known kind; unknown → {kind:"unknown", neutral} (never fabricated success). Chat wiring: tool events during a run render through the registry (a compact card row above/below the text stream — minimal presentation, not the rich cards of later tickets).

**Spec:** Contracts §3 tool-event fixtures; catalog C06; Issue #19. The 12 classes are the fixture list above.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/openmuse/.worktrees/v4-base. NO commits.
- Owned files: Create apps/mobile/src/openbot/tool-cards.ts, apps/mobile/test/openbot-tool-cards.test.ts; Modify apps/mobile/src/openbot/chat.tsx (card rendering through the registry; no rewrite of prior wiring).
- Do NOT touch channels/config/auth/client/gate/private-state/computer/task/stream-resume files.

### Task 1: RED — registry tests

1. one fixture per class (12 cases): classifyToolEvent returns the mapped kind with zh-CN title; summaries: browser navigation shows URL host+path; mail thread shows subject; calendar event shows title+time; file artifact shows name; computer screenshot shows a 截图 label; reviewed-action/Policy cards show their type label;
2. tool error → status error, never success; tool result → status ok;
3. unknown event name/shape → kind unknown, neutral copy, no payload echo beyond a safe truncated string;
4. summary truncation at 120 chars with ellipsis; non-string payload fields stringified safely;
5. text delta not a card (returns null — the text stream owns it).

### Task 2: GREEN

- tool-cards.ts per matrix; chat.tsx renders card rows from the registry during runs (existing transcript/dedupe paths untouched).
- `pnpm test && pnpm --dir apps/mobile typecheck && pnpm lint` green; `pnpm build:web` exports (record tail).

### Task 3: Checkpoint

- Report: files + shasum, test tails, build:web tail, S12 live fixture deferred note. No commit.

## Failure handling

- If a class's payload shape is unknown at this stage (e.g. no real events yet), map on the event NAME with a generic summary and mark the payload contract for the owning ticket (R/K/M/A tickets) in the report.
