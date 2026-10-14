# G06 — Show Google account status in OpenMuse: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD for pure seams. Predecessors G03+G04+G05 verified+integrated (status route exposes per-provider {status, generation, accountEmail?, scopes?, lastError?}).

**Goal:** A Connections screen in the OpenMuse app shows each Google provider's accountEmail, granted scopes, and status chip (已连接/需要刷新/已断开/已撤销); failure details appear without ever exposing tokens; connect/disconnect actions are reachable; the screen reflects the honest server state only (no client-side inference).

**Architecture:** Client: `src/openbot/connections.tsx` (screen) + pure `src/openbot/connection-status.ts` (status chip mapping incl. revoked, scope list formatting, sanitized-error display guard — strips anything token-shaped from lastError before render). api.ts gains `fetchGoogleConnections()` (the combined status route). App shell entry 连接.

**Spec:** Contracts §4 Connection statuses; catalog G06; Issue #31.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/openmuse/.worktrees/v4-base. NO commits.
- Owned files: Create apps/mobile/src/openbot/{connections.tsx,connection-status.ts}, apps/mobile/test/openbot-connection-status.test.ts; Modify apps/mobile/src/openbot/{api.ts,types.ts}, App.tsx (entry).
- Do NOT touch chat/channels/config/auth/client/gate/private-state/computer/task/calendar files.

### Task 1: RED — seam tests

1. status mapping: connected/refresh_required/disconnected/revoked → zh-CN chips 已连接/需要刷新/已断开/已撤销; unknown status → 未知 (never a fabricated connected);
2. scope formatting: list join with · , empty → 未授予任何权限;
3. sanitized-error guard: lastError containing token-shaped substrings (ya29.\*, 1//0\*, long base64 ≥40 chars, "Bearer " prefixes) is replaced with a generic 需要重新连接 message; plain errors pass through truncated to 120;
4. per-provider rows keyed by provider; accountEmail absent → 未绑定账号;
5. api: fetchGoogleConnections GETs the combined status route; 401 → authentication_required.

### Task 2: GREEN

- connection-status.ts per matrix; connections.tsx (rows + chips + scope list + connect/disconnect buttons invoking existing api seams — connect opens the authorizationUrl via Linking, disconnect POSTs the disconnect route — cite the api functions used); App entry.
- `pnpm test && pnpm --dir apps/mobile typecheck && pnpm lint` green; `pnpm build:web` exports (record tail).

### Task 3: Checkpoint

- Report: files + shasum, test tails, build:web tail, S15/S16 live rows deferred note. No commit.

## Failure handling

- If the combined status route's shape differs from G03/G04's tests, align types.ts to the actual route (read the connectors routes) and record.
