# G01 — Connect Gmail with an OAuth callback: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessor I03 verified+integrated. Build ONLY the server seam here (client status UI is G06).

**Goal:** An authenticated OpenBot user starts Gmail consent; OpenBot issues its own one-use, session-bound, 10-minute-TTL state; the provider callback lands on OpenBot's public callback which verifies state + session + TTL, forwards the exchange to OpenConnector (named connection with server-derived alias), and records `{provider:"gmail", accountEmail, status:"connected", grantedScopes, generation:1}`; wrong/expired/cross-session state creates NO connection.

**Architecture:** New module `server/src/openmuse-connectors/`. OpenConnector (vendor) supports the full lifecycle (docs/credentials.md): `POST /api/oauth/authorizations {service, connectionName}` → `{authorizationUrl}`; OAuth client config `PUT /api/oauth/configs/gmail {clientId, clientSecret, redirectUri}`; callback forwarding: the app owning the redirect forwards `{code, state}` to the vendor's `/oauth/callback`; `/api/connections` exposes `{accountId, displayName, grantedScopes, oauthAuthorizationId}` per connection. Flow: OpenBot start → vendor authorization (connectionName = alias) → rewrite nothing; record pending `{vendorState↔userId}` parsed from the returned authorizationUrl query; Google→OpenBot callback carries the vendor state → OpenBot resolves pending, verifies session-user match + TTL + one-use → forwards to vendor /oauth/callback → reads connection profile → persists connection row → redirects browser to the app return URI.

**Tech Stack:** Hono, drizzle (2 tables, one migration), the injectable-dial test pattern from server/src/plugins/openconnector-adapter.ts (READ prior art lines ~100-160, ~316-340).

**Spec:**
- Contracts §4 OAuth state + Connection: /Users/wuyongjun/trea/openmuse/.worktrees/v4-base/docs/superpowers/plans/2026-10-12-openmuse-openbot-contracts-v4.md (§4)
- Catalog G01; Issue #26. Vendor docs: https://github.com/oomol-lab/open-connector/blob/main/docs/credentials.md (fetched 2026-10-12; excerpts in this plan are authoritative for the vendor API shape).

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Create server/src/openmuse-connectors/{client.ts,google-oauth.ts,store.ts,routes.ts}, server/tests/openmuse-google-oauth.test.ts, drizzle migration 00NN (+meta); Modify server/src/app.ts (mount: TWO mounts — session-guarded sub-app at /api/mobile/openmuse-google for connect/status, and the PUBLIC callback route; follow the existing conditional-assembly + appended-tail-param pattern: `openMuseGoogleOAuth?` tail param; update ready.test.ts offset comment per its convention), server/src/index.ts (import + arg + construction with vendor base URL from config env `OPENCONNECTOR_URL` default http://localhost:3000, client id/secret from `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` via config.ts — if config.ts has no such keys, read process.env directly in the module and document; do NOT edit config.ts).
- Do NOT touch: plugins/ (the broker/adapter stay as-is), openmuse-files/, openmuse-tasks/, computer/, admin/.
- The worktree carries prior uncommitted checkpoints — never revert.
- The client (OpenMuse app) is NOT in this ticket. Redirect the browser to a return URI the caller supplies at start (validated same-origin or app scheme `openmuse://`).

### Task 1: RED — state machine tests

- [ ] **Step 1:** server/tests/openmuse-google-oauth.test.ts (fake vendor dial + fake rows, Hono test apps):
  1. start: authenticated POST /connect → 200 {authorizationUrl, state? no: state stays server-side; return {authorizationUrl}}; pending row created with parsed vendor state, userId, scopes, returnUri, expiresAt = now+10min; vendor received {service:"gmail", connectionName: alias} where alias = `openmuse-<sha256(userId+"gmail")[:16]>` (server-derived; assert exact formula);
  2. callback happy path: GET /callback?code&state=<vendorState> with session cookie of the SAME user → 302 to returnUri; vendor /oauth/callback received {code, state}; connection row written {provider:"gmail", accountEmail: profile.displayName/accountId from fake /api/connections, status:"connected", grantedScopes, generation:1};
  3. wrong state (no pending row) → 400, vendor exchange NEVER called, no connection row;
  4. expired (clock injected past 10 min) → 410, no exchange, no row;
  5. cross-session (callback with DIFFERENT user's session) → 403, no exchange, no row;
  6. one-use: second callback with same state → 400 (consumed), exactly one exchange;
  7. unauthenticated /connect → 401; /callback with NO session cookie → 403 (session binding required per contract);
  8. vendor exchange failure (fake returns error) → 502, pending consumed, no connection row (a fresh start is required — no auto retry);
  9. §9 hooks: disableOwner refuses connect; enumerateOwner returns {kind:"openmuse-google-connection", id}.
- [ ] **Step 2:** `bun test tests/openmuse-google-oauth.test.ts` → FAIL.

### Task 2: GREEN

- [ ] **Step 1:** client.ts: vendor seam over injectable dial — `startGmailAuthorization(connectionName)` (POST /api/oauth/authorizations), `forwardCallback(code, state)` (GET-or-POST to vendor /oauth/callback with query per docs), `connectionProfile(connectionName)` (GET /api/connections, find by name), `putGmailClientConfig({clientId, clientSecret, redirectUri})` (PUT /api/oauth/configs/gmail — called once at boot when env credentials present; failure logged not fatal).
- [ ] **Step 2:** store.ts: drizzle tables `openmuse_oauth_pending` (state PK, userId, provider, scopes jsonb, returnUri, createdAt, expiresAt, consumedAt) + `openmuse_google_connections` (id PK, userId, provider 'gmail', accountEmail, status, grantedScopes jsonb, generation int default 1, alias, connectedAt; unique(userId, provider)); row seam injectable like F01/T01 for tests.
- [ ] **Step 3:** google-oauth.ts: orchestration exactly per Task 1 matrix (parse vendor state from authorizationUrl query param `state`; TTL 10 min; consume-once under compare-and-swap update WHERE consumedAt IS NULL).
- [ ] **Step 4:** routes.ts: connect (requireUser, zod body {returnUri: z.string().url() restricted to app scheme openmuse:// or same-origin https/http}), status (requireUser → current row or {status:"disconnected"}), callback (public; 302/4xx per matrix; Cache-Control no-store).
- [ ] **Step 5:** app.ts/index.ts wiring per Global Constraints; migration via `DATABASE_URL=... bun run db:generate` (SQL verbatim in report; do NOT db:migrate).
- [ ] **Step 6:** `bun test tests/openmuse-google-oauth.test.ts tests/ready.test.ts tests/mobile-bff.test.ts` → PASS; typecheck + biome clean on owned files.

### Task 3: Checkpoint

- [ ] Report: migration SQL, changed files + shasum, test tails, the exact alias formula, where redirectUri comes from (public origin config: `OPENBOT_PUBLIC_ORIGIN` env — document for O02), statement that real-Gmail consent evidence (S15) is gate-level and NOT claimed here. No commit.

## Acceptance (Issue #26 / catalog G01)

State is one-use, session-bound, 10-minute TTL (tests 3-7); successful consent shows accountEmail/generation via the status route (test 2 + status test); foreign alias and wrong state create no connection (tests 3,5,8). Verified by Task 1 suite against the fake vendor.

## Failure handling

- If the vendor dial base URL is unset at runtime, /connect answers 503 with a clear deployment message (no crash); tests cover.
- If OpenConnector's real /oauth/callback contract differs from the doc (forwarding method), implement per doc, mark the divergence in the report, and leave a TODO-cited seam for the live check (S15 gate).
