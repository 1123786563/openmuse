// @ts-expect-error -- bun:test types come from the Bun runtime; this tsconfig names node types.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Artifact, BrowserSession } from "../../../packages/domain/src/index.ts";
import { workspaceSchema } from "../../../packages/domain/src/index.ts";
import { createSamplePdf } from "../../../packages/integrations/src/pdf.ts";
import type { Config } from "./config.ts";
import { createStore, type Store } from "./db.ts";

/*
 * T07.07 (#597, original task P17; interfaces §5.2): the enterprise BFF's
 * media tickets, its online media routes and the reauth proxies.
 *
 * `POST /api/media-tickets` mints at most 60-second opaque locator tickets
 * bound to the session, the resource and the selection; the only admissible
 * paths are the file content, browser preview and browser console routes and
 * only GET/HEAD. The media routes themselves (`GET|HEAD /api/files/:id/
 * content`, the browser preview and the console) accept Bearer+selector and
 * the one-time ticket, and re-admit online for every new request and every
 * Range: an expired or revoked ticket cannot start a new pull. A file answer
 * is a private no-store proxy (single Range 206, multi Range 416, batched
 * ≤262144-byte pulls), never a storage redirect or a signed owner URL.
 *
 * `GET /api/enterprise/workspace-scope`, `POST .../validate-selection` and
 * `POST /api/enterprise/company-auth/challenge` proxy the OpenBot authority's
 * original §4/§5 DTOs from the same Bearer handle — the authority decides,
 * the BFF translates, and no client Cookie or actor claim is ever read.
 *
 * The authority below is the REAL wire peer of `createOpenbotAuthority`: a
 * local HTTP server answering the frozen OpenBot routes
 * (`/api/enterprise/mobile/session/{exchange,authorize}` and the three
 * proxied surfaces), so the BFF's service credential, per-request online
 * admission and the proxies are exercised end to end through the production
 * `createApp` in enterprise mode.
 */

const BFF = {
  clientId: "openmuse-mobile",
  bffServiceId: "bff-service",
  bffServiceSecret: "bff-service-secret",
  user: { id: "user-1", principalId: "principal-1" } as const,
};

const ACME = { tenantId: "tenant-acme", workspaceId: "ws-acme-ops" } as const;
const GLOBEX = { tenantId: "tenant-globex", workspaceId: "ws-globex-ops" } as const;
const OWNER = `enterprise:${ACME.tenantId}:${ACME.workspaceId}:${BFF.user.principalId}`;

const SELECTOR_HEADERS = (tenant: typeof ACME | typeof GLOBEX) => ({
  "x-openbot-tenant": tenant.tenantId,
  "x-openbot-workspace": tenant.workspaceId,
});

/** The §4 ScopeListing the authority's own listing route answers with. */
const SCOPE_LISTING = Object.freeze({
  companies: [
    {
      tenantId: ACME.tenantId,
      organizationId: ACME.tenantId,
      name: "Acme",
      memberEpoch: 1,
      companyGeneration: 0,
      role: "member",
      capabilities: [],
      teams: [
        {
          workspaceId: ACME.workspaceId,
          teamId: `team-${ACME.workspaceId}`,
          name: "Acme Ops",
          workspaceMemberEpoch: 1,
          teamGeneration: 0,
        },
      ],
    },
  ],
});

/** The §4 ValidatedSelection the authority's validate-selection answers with. */
const VALIDATED_SELECTION = Object.freeze({
  tenantId: ACME.tenantId,
  workspaceId: ACME.workspaceId,
  organizationId: ACME.tenantId,
  teamId: `team-${ACME.workspaceId}`,
  memberEpoch: 1,
  workspaceMemberEpoch: 1,
  companyGeneration: 0,
  teamGeneration: 0,
  capabilities: [],
});

/** The §5 challenge DTO the authority's challenge route answers with. */
const CHALLENGE_DTO = Object.freeze({
  challengeId: "challenge-1",
  redirectUrl: "https://sso.example/challenge-1",
  expiresAt: "2026-11-02T12:00:00.000Z",
});

interface AuthorityCall {
  readonly route: string;
  readonly handle: string;
  readonly selector: { tenantId: string; workspaceId: string } | null;
  readonly operation: string | null;
  readonly resourceId: string | null;
}

/**
 * The OpenBot authority stand-in: the frozen wire contracts of every route
 * the BFF calls. The mobile-session half (exchange/authorize) is exactly the
 * T07.05 stub; the three proxied surfaces answer the frozen §4/§5 DTOs and
 * record what the BFF actually sent, so the tests can prove the proxy
 * translated the handle (and never a Cookie or a client-asserted actor).
 */
class AuthorityStub {
  readonly calls: AuthorityCall[] = [];
  readonly handles = new Map<string, { userId: string; principalId: string }>();
  revoked = false;
  server?: Server;
  origin = "";
  private issued = 0;

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      void this.answer(request, response);
    });
    this.server.listen(0, "127.0.0.1");
    await once(this.server, "listening");
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("authority did not bind");
    this.origin = `http://127.0.0.1:${address.port}`;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    this.server = undefined;
  }

  currentHandle(): string {
    const last = [...this.handles.keys()].at(-1);
    if (!last) throw new Error("no handle issued yet");
    return last;
  }

  private knownHandle(
    body: Record<string, unknown>,
    route: string,
    response: ServerResponse,
  ): string | null {
    const handle = typeof body.handle === "string" ? body.handle : "";
    if (!this.handles.has(handle)) {
      refuse(response, "SESSION_EXPIRED", 401);
      return null;
    }
    if (this.revoked) {
      refuse(response, "SESSION_REVOKED", 401);
      return null;
    }
    this.calls.push({
      route,
      handle,
      selector: {
        tenantId: String(
          body.tenantId ?? (body.selectors as { tenantId?: unknown })?.tenantId ?? "",
        ),
        workspaceId: String(
          body.workspaceId ?? (body.selectors as { workspaceId?: unknown })?.workspaceId ?? "",
        ),
      },
      operation: typeof body.operation === "string" ? body.operation : null,
      resourceId: typeof body.resourceId === "string" ? body.resourceId : null,
    });
    return handle;
  }

  private async answer(request: IncomingMessage, response: ServerResponse) {
    const body = await readJson(request);
    const expected = `Basic ${Buffer.from(`${BFF.bffServiceId}:${BFF.bffServiceSecret}`).toString("base64")}`;
    if ((request.headers.authorization ?? "") !== expected)
      return refuse(response, "BFF_CREDENTIAL_INVALID", 401);
    if (request.url === "/api/enterprise/mobile/session/exchange")
      return this.exchange(body, response);
    if (request.url === "/api/enterprise/mobile/session/authorize")
      return this.admission(body, response);
    if (request.url === "/api/enterprise/workspace-scope") {
      if (!this.knownHandle(body, "scope.list", response)) return;
      return json(response, 200, SCOPE_LISTING);
    }
    if (request.url === "/api/enterprise/workspace-scope/validate-selection") {
      if (!this.knownHandle(body, "scope.validate", response)) return;
      return json(response, 200, VALIDATED_SELECTION);
    }
    if (request.url === "/api/enterprise/company-auth/challenge") {
      if (!this.knownHandle(body, "company.challenge", response)) return;
      return json(response, 200, CHALLENGE_DTO);
    }
    return refuse(response, "RESOURCE_NOT_FOUND", 404);
  }

  private exchange(body: Record<string, unknown>, response: ServerResponse) {
    if (
      body.authMode !== "enterprise" ||
      typeof body.intentId !== "string" ||
      typeof body.code !== "string" ||
      typeof body.codeVerifier !== "string" ||
      typeof body.redirectUri !== "string"
    )
      return refuse(response, "INVALID_REQUEST", 400);
    this.issued += 1;
    const token = `handle-${this.issued}`;
    this.handles.set(token, { userId: BFF.user.id, principalId: BFF.user.principalId });
    return json(response, 200, {
      token,
      mode: "live",
      authMode: "enterprise",
      authority: this.origin,
      expiresAt: new Date(Date.now() + 1800_000).toISOString(),
      user: { id: BFF.user.id, principalId: BFF.user.principalId },
      scope: null,
    });
  }

  private admission(body: Record<string, unknown>, response: ServerResponse) {
    const handle = typeof body.handle === "string" ? body.handle : "";
    if (!this.handles.has(handle)) return refuse(response, "SESSION_EXPIRED", 401);
    const selectors = (body.selectors ?? {}) as Record<string, unknown>;
    const operation = typeof body.operation === "string" ? body.operation : "";
    // A revoked session still ANSWERS the authorize call online — the
    // decision is the authority's, so the call is recorded before refusing.
    if (this.revoked) {
      this.calls.push({
        route: "authorize",
        handle,
        selector: selectors.tenantId
          ? {
              tenantId: String(selectors.tenantId),
              workspaceId: String(selectors.workspaceId ?? ""),
            }
          : null,
        operation,
        resourceId: typeof body.resourceId === "string" ? body.resourceId : null,
      });
      return refuse(response, "SESSION_REVOKED", 401);
    }
    // scope.discover is selector-free, exactly as the authority's own rule
    // (MOBILE_ADMISSIBLE_OPERATIONS["scope.discover"] === "none") demands.
    if (operation === "scope.discover") {
      if (selectors.tenantId !== undefined) return refuse(response, "SCOPE_SELECTOR_CONFLICT", 400);
      this.calls.push({
        route: "authorize",
        handle,
        selector: null,
        operation,
        resourceId: null,
      });
      const discoveryUser = this.handles.get(handle) ?? {
        userId: BFF.user.id,
        principalId: BFF.user.principalId,
      };
      return json(response, 200, {
        mode: "live",
        authMode: "enterprise",
        actor: {
          userId: discoveryUser.userId,
          principalId: discoveryUser.principalId,
          identityGeneration: 1,
        },
        session: {
          sessionId: "session-1",
          handleExpiresAt: new Date(Date.now() + 1800_000).toISOString(),
        },
        scope: null,
        assurance: null,
        admissionId: randomUUID(),
        operation,
        resourceId: null,
      });
    }
    if (
      typeof selectors.tenantId !== "string" ||
      typeof selectors.workspaceId !== "string" ||
      !selectors.tenantId ||
      !selectors.workspaceId
    )
      return refuse(response, "INVALID_REQUEST", 400);
    const tenantId = selectors.tenantId;
    const workspaceId = selectors.workspaceId;
    this.calls.push({
      route: "authorize",
      handle,
      selector: { tenantId, workspaceId },
      operation,
      resourceId: typeof body.resourceId === "string" ? body.resourceId : null,
    });
    const user = this.handles.get(handle) ?? {
      userId: BFF.user.id,
      principalId: BFF.user.principalId,
    };
    return json(response, 200, {
      mode: "live",
      authMode: "enterprise",
      actor: { userId: user.userId, principalId: user.principalId, identityGeneration: 1 },
      session: {
        sessionId: "session-1",
        handleExpiresAt: new Date(Date.now() + 1800_000).toISOString(),
      },
      scope: {
        tenantId,
        workspaceId,
        organizationId: tenantId,
        teamId: `team-${workspaceId}`,
        memberEpoch: 1,
        workspaceMemberEpoch: 1,
        companyGeneration: 0,
        teamGeneration: 0,
        capabilities: [],
      },
      assurance: null,
      admissionId: randomUUID(),
      operation,
      resourceId: typeof body.resourceId === "string" ? body.resourceId : null,
    });
  }
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function refuse(response: ServerResponse, code: string, status: number) {
  json(response, status, { error: "Request refused.", code, requestId: randomUUID() });
}

const FILE_ID = "11111111-2222-4333-8444-555555555555";
const BROWSER_ID = "00000000-0000-4000-8000-000000000001";

describe("T07.07 enterprise media tickets and reauth proxies", () => {
  const authority = new AuthorityStub();
  let db: Store;
  let app: Awaited<ReturnType<typeof import("./app.ts")["createApp"]>>["app"];
  let directory: string;
  let token: string;
  let fileSize: number;

  beforeAll(async () => {
    await authority.start();
    directory = await mkdtemp(join(tmpdir(), "openmuse-enterprise-media-"));
    db = await createStore({ dataDir: join(directory, "data") });
    const config: Config = {
      mode: "live",
      host: "127.0.0.1",
      port: 8787,
      publicUrl: "http://localhost:8787",
      dataDir: directory,
      agentBackend: "model",
      intelligenceApiKey: "test-intelligence-key",
      googleRedirectUri: "http://localhost:8787/api/google/callback",
      allowedOrigins: ["http://localhost:8081"],
      authMode: "enterprise",
      openbotAuthorityOrigin: authority.origin,
      openbotClientId: BFF.clientId,
      openbotBffServiceId: BFF.bffServiceId,
      openbotBffServiceSecret: BFF.bffServiceSecret,
    };
    // `bun test` cannot statically import app.ts's CopilotKit runtime graph
    // (a CJS dependency requires an async ESM module); the dynamic import the
    // deployed node runtime performs loads it fine.
    const { createApp } = await import("./app.ts");
    ({ app } = await createApp(db, config));
    const session = await app.request("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authMode: "enterprise",
        intentId: "intent-1",
        code: "code-1",
        codeVerifier: "a".repeat(43),
        redirectUri: "openmuse://callback",
      }),
    });
    expect(session.status).toBe(200);
    token = ((await session.json()) as { token: string }).token;

    // The admitted namespace's own records: a real PDF on disk and a browser
    // session. Another company's copy proves the isolation below.
    const bytes = await createSamplePdf();
    fileSize = bytes.byteLength;
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(directory, "files"), { recursive: true, mode: 0o700 });
    await writeFile(join(directory, "files", `${FILE_ID}.pdf`), bytes, { mode: 0o600 });
    const artifact: Artifact = {
      id: FILE_ID,
      name: "board-deck.pdf",
      mimeType: "application/pdf",
      size: fileSize,
      pageCount: 2,
      fields: [],
      url: "",
      createdAt: new Date().toISOString(),
      source: "Uploaded by you",
      parentId: undefined,
    };
    await db.put(OWNER, "files", artifact);
    const browserSession: BrowserSession = {
      id: BROWSER_ID,
      title: "Acme portal",
      url: "https://acme.example/",
      status: "active",
      updatedAt: new Date().toISOString(),
    };
    await db.put(OWNER, "browsers", browserSession);
    await db.put(`enterprise:${GLOBEX.tenantId}:${GLOBEX.workspaceId}:principal-2`, "browsers", {
      ...browserSession,
      title: "Globex",
    });
  }, 180_000);

  afterAll(async () => {
    await db.close();
    await rm(directory, { recursive: true, force: true });
    await authority.stop();
  }, 120_000);

  test("enterprise_bff_login_workspace_stream_media_and_reauth_contract", async () => {
    // The five chains, recorded as the routes the app actually answered and
    // the admissions the authority actually decided.
    const observedRoutes: string[] = [];
    authority.calls.length = 0;
    const record = async (
      route: string,
      call: () => Response | Promise<Response>,
    ): Promise<Response> => {
      const response = await call();
      observedRoutes.push(route);
      return response;
    };

    // ── Chain 1 — login: the frozen handoff exchanged this BFF's handle.
    expect(authority.handles.has(token)).toBe(true);

    // ── Chain 2 — workspace: the ORIGINAL Workspace contract from this
    // namespace, with media URLs pointing at the BFF's own online routes.
    const workspaceResponse = await record("GET /api/workspace", () =>
      app.request("/api/workspace", {
        headers: { Authorization: `Bearer ${token}`, ...SELECTOR_HEADERS(ACME) },
      }),
    );
    expect(workspaceResponse.status).toBe(200);
    const workspace = workspaceSchema.parse(await workspaceResponse.json());
    const mediaFile = workspace.files.find((entry) => entry.id === FILE_ID);
    expect(mediaFile).toBeDefined();
    expect(mediaFile?.url).toContain(`/api/files/${FILE_ID}/content`);
    // The content URL is the BFF's own online path — no signed owner link.
    expect(mediaFile?.url).not.toContain("signature=");
    expect(mediaFile?.url).not.toContain("owner=");

    // ── Chain 3 — stream: the CopilotKit run surface is T07.06's; this task
    // consumes the same handle. A stream-surface admission is out of scope
    // here, but the operation vocabulary must stay closed: nothing but the
    // frozen words ever reaches the authority.
    const operations = new Set(authority.calls.map((call) => call.operation));

    // ── Chain 4 — media: the ticket mint, the online file read, Range/416,
    // HEAD, and the browser preview/console tickets.
    const minted = await record("POST /api/media-tickets (file)", () =>
      app.request("/api/media-tickets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...SELECTOR_HEADERS(ACME),
        },
        body: JSON.stringify({ path: `/api/files/${FILE_ID}/content`, method: "GET" }),
      }),
    );
    expect(minted.status).toBe(200);
    const ticket = (await minted.json()) as { url: string; expiresAt: string };
    expect(ticket.url).toContain(`/api/files/${FILE_ID}/content`);
    expect(ticket.url).not.toContain("signature=");
    const expiresInMs = new Date(ticket.expiresAt).getTime() - Date.now();
    expect(expiresInMs).toBeGreaterThan(0);
    expect(expiresInMs).toBeLessThanOrEqual(60_000);

    const read = await record(`GET /api/files/${FILE_ID}/content (ticket)`, () =>
      app.request(new URL(ticket.url).pathname + new URL(ticket.url).search),
    );
    expect(read.status).toBe(200);
    expect(read.headers.get("cache-control")).toContain("private");
    expect(read.headers.get("cache-control")).toContain("no-store");
    expect((await read.arrayBuffer()).byteLength).toBe(fileSize);

    const range = await record(`GET /api/files/${FILE_ID}/content (range)`, () =>
      app.request(`/api/files/${FILE_ID}/content`, {
        headers: {
          Authorization: `Bearer ${token}`,
          ...SELECTOR_HEADERS(ACME),
          Range: `bytes=0-${Math.min(9, fileSize - 1)}`,
        },
      }),
    );
    expect(range.status).toBe(206);
    expect((await range.arrayBuffer()).byteLength).toBe(Math.min(10, fileSize));

    const multi = await record(`GET /api/files/${FILE_ID}/content (multi-range)`, () =>
      app.request(`/api/files/${FILE_ID}/content`, {
        headers: {
          Authorization: `Bearer ${token}`,
          ...SELECTOR_HEADERS(ACME),
          Range: "bytes=0-1,3-4",
        },
      }),
    );
    expect(multi.status).toBe(416);

    const head = await record(`HEAD /api/files/${FILE_ID}/content`, () =>
      app.request(`/api/files/${FILE_ID}/content`, {
        method: "HEAD",
        headers: { Authorization: `Bearer ${token}`, ...SELECTOR_HEADERS(ACME) },
      }),
    );
    expect(head.status).toBe(200);
    expect(Number(head.headers.get("content-length"))).toBe(fileSize);

    for (const [label, path] of [
      ["preview", `/api/browsers/${BROWSER_ID}/preview`],
      ["console", `/api/browsers/${BROWSER_ID}/console`],
    ] as const) {
      const browserTicket = await record(`POST /api/media-tickets (${label})`, () =>
        app.request("/api/media-tickets", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            ...SELECTOR_HEADERS(ACME),
          },
          body: JSON.stringify({ path, method: "GET" }),
        }),
      );
      expect(browserTicket.status).toBe(200);
      const browserMint = (await browserTicket.json()) as { url: string; expiresAt: string };
      expect(new URL(browserMint.url).pathname).toBe(path);
    }

    // ── Chain 5 — reauth: the three proxies answer the authority's original
    // DTOs from the same handle.
    const listing = await record("GET /api/enterprise/workspace-scope", () =>
      app.request("/api/enterprise/workspace-scope", {
        headers: { Authorization: `Bearer ${token}`, ...SELECTOR_HEADERS(ACME) },
      }),
    );
    expect(listing.status).toBe(200);
    expect(await listing.json()).toEqual(SCOPE_LISTING);

    const validated = await record("POST /api/enterprise/workspace-scope/validate-selection", () =>
      app.request("/api/enterprise/workspace-scope/validate-selection", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...SELECTOR_HEADERS(ACME),
        },
        body: JSON.stringify({
          tenantId: ACME.tenantId,
          workspaceId: ACME.workspaceId,
        }),
      }),
    );
    expect(validated.status).toBe(200);
    expect(await validated.json()).toEqual(VALIDATED_SELECTION);

    const challenged = await record("POST /api/enterprise/company-auth/challenge", () =>
      app.request("/api/enterprise/company-auth/challenge", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...SELECTOR_HEADERS(ACME),
        },
        body: JSON.stringify({
          tenantId: ACME.tenantId,
          returnPath: "/settings/connections",
        }),
      }),
    );
    expect(challenged.status).toBe(200);
    expect(await challenged.json()).toEqual(CHALLENGE_DTO);

    // One selection through all five chains: every admission the authority
    // decided named the same actor's handle and the same company/team, and
    // only the frozen operations were asked (no stream admission happened
    // here — the media/reauth routes use their own words).
    expect(operations.has("copilotkit.invoke")).toBe(false);
    for (const call of authority.calls) {
      expect(call.handle).toBe(token);
      // Admissions carry the one selection the five chains share, except
      // the scope-free discovery word; the proxied surfaces' own records
      // are asserted by their chains above.
      if (call.route === "authorize") {
        if (call.operation === "scope.discover") expect(call.selector).toBeNull();
        else expect(call.selector).toEqual({ ...ACME });
      }
    }
    const mintOperations = authority.calls
      .map((call) => call.operation)
      .filter((operation): operation is string => operation !== null);
    expect(mintOperations).toContain("media.ticket");
    expect(mintOperations).toContain("file.read");

    expect(observedRoutes).toEqual([
      "GET /api/workspace",
      "POST /api/media-tickets (file)",
      `GET /api/files/${FILE_ID}/content (ticket)`,
      `GET /api/files/${FILE_ID}/content (range)`,
      `GET /api/files/${FILE_ID}/content (multi-range)`,
      `HEAD /api/files/${FILE_ID}/content`,
      "POST /api/media-tickets (preview)",
      "POST /api/media-tickets (console)",
      "GET /api/enterprise/workspace-scope",
      "POST /api/enterprise/workspace-scope/validate-selection",
      "POST /api/enterprise/company-auth/challenge",
    ]);
  }, 120_000);

  test("expired_or_revoked_media_ticket_cannot_start_new_pull", async () => {
    // Mint a ticket for the file content, then revoke the session: the next
    // pull of the media route must admit ONLINE, refuse, and read nothing.
    const minted = await app.request("/api/media-tickets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...SELECTOR_HEADERS(ACME),
      },
      body: JSON.stringify({ path: `/api/files/${FILE_ID}/content`, method: "GET" }),
    });
    expect(minted.status).toBe(200);
    const ticket = (await minted.json()) as { url: string };
    const url = new URL(ticket.url);

    authority.revoked = true;
    try {
      authority.calls.length = 0;
      const refused = await app.request(`${url.pathname}${url.search}`);
      expect(refused.status).toBe(401);
      const refusedBody = await refused.text();
      expect((JSON.parse(refusedBody) as { code: string }).code).toBe("SESSION_REVOKED");
      // The refusal was an ONLINE decision: exactly one authorize call was
      // made for this pull, and it never reached the file bytes.
      const newPulls = authority.calls.filter(
        (call) => call.route === "authorize" && call.operation === "file.read",
      );
      expect(newPulls.length).toBe(1);
      // The answer body is the refusal, never file bytes.
      expect(refusedBody).not.toContain("%PDF");
    } finally {
      authority.revoked = false;
    }

    // A tampered ticket (an opaque value the server never minted) cannot
    // start a read either, and the attempt is not distinguishable from an
    // expired one: SESSION_EXPIRED, no bytes.
    const forged = await app.request(`/api/files/${FILE_ID}/content?ticket=forged-value`);
    expect(forged.status).toBe(401);
    const forgedBody = await forged.text();
    expect((JSON.parse(forgedBody) as { code: string }).code).toBe("SESSION_EXPIRED");
    expect(forgedBody).not.toContain("%PDF");
  }, 60_000);

  test("media_ticket_path_and_method_whitelist", async () => {
    const _before = authority.calls.length;
    const refuseMint = async (body: Record<string, unknown>) =>
      app.request("/api/media-tickets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...SELECTOR_HEADERS(ACME),
        },
        body: JSON.stringify(body),
      });
    // A non-media path is refused before the authority is ever asked.
    const outside = await refuseMint({ path: "/api/workspace", method: "GET" });
    expect(outside.status).toBe(400);
    expect(((await outside.json()) as { code: string }).code).toBe("INVALID_REQUEST");
    // POST is not a media read.
    const posted = await refuseMint({ path: `/api/files/${FILE_ID}/content`, method: "POST" });
    expect(posted.status).toBe(400);
    expect(((await posted.json()) as { code: string }).code).toBe("INVALID_REQUEST");
    // A browser control route is not a media path.
    const control = await refuseMint({
      path: `/api/browsers/${BROWSER_ID}/navigate`,
      method: "POST",
    });
    expect(control.status).toBe(400);
    // A resource outside this selection's namespace is refused with the
    // uniform not-found word: never a ticket for another company's session,
    // and the answer does not distinguish "not yours" from "not there".
    const foreign = await refuseMint({
      path: "/api/browsers/99999999-9999-4999-8999-999999999999/preview",
      method: "GET",
    });
    expect(foreign.status).toBe(404);
    expect(((await foreign.json()) as { code: string }).code).toBe("RESOURCE_NOT_FOUND");
    // Every refusal above happened before the mint: no ticket was issued.
    expect(authority.calls.at(-1)?.operation).toBe("media.ticket");
  }, 60_000);

  test("media_routes_never_fall_back_to_standalone_owner_or_signed_urls", async () => {
    // The standalone surface's signed URL (owner+expires+signature) is not a
    // credential on the enterprise surface: it is refused, never verified.
    const signed = await app.request(
      `/api/files/${FILE_ID}/content?owner=${encodeURIComponent(OWNER)}&expires=${Date.now() + 60_000}&signature=${"a".repeat(64)}`,
    );
    expect(signed.status).toBe(401);
    // Missing selector headers answer the closed scope error.
    const selectorless = await app.request(`/api/files/${FILE_ID}/content`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(selectorless.status).toBe(400);
    expect(((await selectorless.json()) as { code: string }).code).toBe("SCOPE_REQUIRED");
    // Another company's selection cannot read this namespace's file.
    const conflicted = await app.request(`/api/files/${FILE_ID}/content`, {
      headers: { Authorization: `Bearer ${token}`, ...SELECTOR_HEADERS(GLOBEX) },
    });
    expect(conflicted.status).toBe(404);
    expect(((await conflicted.json()) as { code: string }).code).toBe("RESOURCE_NOT_FOUND");
    // An unknown handle answers SESSION_EXPIRED through the MobileBffError.
    const unknown = await app.request(`/api/files/${FILE_ID}/content`, {
      headers: { Authorization: "Bearer handle-unknown", ...SELECTOR_HEADERS(ACME) },
    });
    expect(unknown.status).toBe(401);
    expect(((await unknown.json()) as { code: string }).code).toBe("SESSION_EXPIRED");
    // The other company's browser session is invisible to this selection.
    const foreignBrowser = await app.request(
      `/api/browsers/00000000-0000-4000-8000-000000000099/console`,
      { headers: { Authorization: `Bearer ${token}`, ...SELECTOR_HEADERS(ACME) } },
    );
    expect(foreignBrowser.status).toBe(404);
    expect(((await foreignBrowser.json()) as { code: string }).code).toBe("RESOURCE_NOT_FOUND");
  }, 60_000);

  test("scope_and_challenge_proxies_refuse_cleanly", async () => {
    // The proxies demand the same handle discipline, and their refusals stay
    // in the frozen MobileBffError shape. Discovery is scope-free: it works
    // before any selection exists (未选范围时可发现).
    const anonymous = await app.request("/api/enterprise/workspace-scope");
    expect(anonymous.status).toBe(401);
    expect(((await anonymous.json()) as { code: string }).code).toBe("SESSION_EXPIRED");
    const discovery = await app.request("/api/enterprise/workspace-scope", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(discovery.status).toBe(200);
    expect(await discovery.json()).toEqual(SCOPE_LISTING);
    const badValidate = await app.request("/api/enterprise/workspace-scope/validate-selection", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...SELECTOR_HEADERS(ACME),
      },
      body: JSON.stringify({ tenantId: ACME.tenantId }),
    });
    expect(badValidate.status).toBe(400);
    expect(((await badValidate.json()) as { code: string }).code).toBe("INVALID_REQUEST");
    const badChallenge = await app.request("/api/enterprise/company-auth/challenge", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...SELECTOR_HEADERS(ACME),
      },
      body: JSON.stringify({ tenantId: ACME.tenantId }),
    });
    expect(badChallenge.status).toBe(400);
    expect(((await badChallenge.json()) as { code: string }).code).toBe("INVALID_REQUEST");
    // A revoked session ends the proxies the same way.
    authority.revoked = true;
    try {
      const revoked = await app.request("/api/enterprise/workspace-scope", {
        headers: { Authorization: `Bearer ${token}`, ...SELECTOR_HEADERS(ACME) },
      });
      expect(revoked.status).toBe(401);
      expect(((await revoked.json()) as { code: string }).code).toBe("SESSION_REVOKED");
    } finally {
      authority.revoked = false;
    }
  }, 60_000);
});
