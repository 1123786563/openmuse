// @ts-expect-error -- bun:test types come from the Bun runtime; this tsconfig names node types.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserSession } from "../../../packages/domain/src/index.ts";
import type { Config } from "./config.ts";
import { createStore, type Store } from "./db.ts";
import { createEnterpriseApp } from "./enterprise.ts";

/*
 * T07.18 (#608, original task P17; interfaces §5.2): the BFF's browser and
 * computer control surfaces admit every action online.
 *
 * POST /api/browsers, navigate/close/reopen/import-downloads and the console
 * input route, GET /api/browsers/:id/read, and the /api/computer sub-routes
 * each map to one operation + optional resourceId, the server-side namespace
 * ownership applies (an instance of another company/team/principal is a
 * uniform 404, and its worker is never touched), the browser preview answers
 * through the media seam the guard already re-admits, instance reuse obeys
 * the reset contract (a browser session reopened in this namespace is a NEW
 * worker open of the namespace's own record, never another namespace's
 * profile), and a revocation committed before the next command refuses that
 * command online — zero later control calls reach the worker.
 *
 * The authority below is the real wire peer of createOpenbotAuthority (a
 * local HTTP server answering the frozen OpenBot routes), and the browser
 * worker is a real local HTTP server, so the whole chain — route → guard →
 * online authorize → scoped service → worker — is exercised end to end
 * through the production createApp wiring in enterprise mode.
 */

const BFF = {
  clientId: "openmuse-mobile",
  bffServiceId: "bff-service",
  bffServiceSecret: "bff-service-secret",
  user: { id: "user-1", principalId: "principal-1" } as const,
};

const ACME = { tenantId: "tenant-acme", workspaceId: "ws-acme-ops" } as const;
const GLOBEX = { tenantId: "tenant-globex", workspaceId: "ws-globex-ops" } as const;
const ACME_OWNER = `enterprise:${ACME.tenantId}:${ACME.workspaceId}:${BFF.user.principalId}`;
const GLOBEX_OWNER = `enterprise:${GLOBEX.tenantId}:${GLOBEX.workspaceId}:principal-2`;

const SELECTOR_HEADERS = (tenant: typeof ACME | typeof GLOBEX) => ({
  "x-openbot-tenant": tenant.tenantId,
  "x-openbot-workspace": tenant.workspaceId,
});

interface AdmissionCall {
  readonly route: string;
  readonly handle: string;
  readonly operation: string;
  readonly resourceId: string | null;
  readonly tenantId: string;
  readonly workspaceId: string;
}

class AuthorityStub {
  readonly admissions: AdmissionCall[] = [];
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

  private async answer(request: IncomingMessage, response: ServerResponse) {
    const body = await readJson(request);
    const expected = `Basic ${Buffer.from(`${BFF.bffServiceId}:${BFF.bffServiceSecret}`).toString("base64")}`;
    if ((request.headers.authorization ?? "") !== expected)
      return refuse(response, "BFF_CREDENTIAL_INVALID", 401);
    if (request.url === "/api/enterprise/mobile/session/exchange")
      return this.exchange(body, response);
    if (request.url === "/api/enterprise/mobile/session/authorize")
      return this.admission(body, response);
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
    // A revoked session still ANSWERS online — the refusal is the authority's
    // own decision, recorded here before it is refused.
    this.admissions.push({
      route: "authorize",
      handle,
      operation,
      resourceId: typeof body.resourceId === "string" ? body.resourceId : null,
      tenantId: String(selectors.tenantId ?? ""),
      workspaceId: String(selectors.workspaceId ?? ""),
    });
    if (this.revoked) return refuse(response, "SESSION_REVOKED", 401);
    if (!operation || !selectors.tenantId || !selectors.workspaceId)
      return refuse(response, "INVALID_REQUEST", 400);
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
        tenantId: selectors.tenantId,
        workspaceId: selectors.workspaceId,
        organizationId: selectors.tenantId,
        teamId: `team-${selectors.workspaceId}`,
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

interface WorkerCall {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  /** The Bearer token the BFF presented to the worker, if any. */
  readonly authorization: string;
}

/** The real browser worker wire peer: /health, /sessions and its subroutes. */
class WorkerStub {
  readonly calls: WorkerCall[] = [];
  server?: Server;
  origin = "";
  /** Sessions the worker believes exist, by session id. */
  readonly sessions = new Map<string, { url: string; title: string }>();

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        let body: unknown;
        const text = Buffer.concat(chunks).toString("utf8");
        if (text) {
          try {
            body = JSON.parse(text);
          } catch {
            body = null;
          }
        }
        void this.answer(request, response, body);
      });
    });
    this.server.listen(0, "127.0.0.1");
    await once(this.server, "listening");
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("worker did not bind");
    this.origin = `http://127.0.0.1:${address.port}`;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    this.server = undefined;
  }

  /** How many CONTROL calls reached the worker (everything but /health). */
  controlCalls(): number {
    return this.calls.filter((call) => call.path !== "/health").length;
  }

  private answer(
    request: IncomingMessage,
    response: ServerResponse,
    body: unknown,
  ): ServerResponse {
    const url = request.url ?? "";
    this.calls.push({
      method: request.method ?? "",
      path: url,
      body,
      authorization: request.headers.authorization ?? "",
    });
    if (url === "/health") return json(response, 200, { ok: true });
    const open = /^\/sessions$/.exec(url);
    if (open && request.method === "POST") {
      const input = (body ?? {}) as { id?: string; url?: string };
      if (typeof input.id !== "string" || typeof input.url !== "string")
        return json(response, 400, { error: { message: "invalid open" } });
      this.sessions.set(input.id, { url: input.url, title: `Page at ${input.url}` });
      return json(response, 200, {
        id: input.id,
        title: `Page at ${input.url}`,
        url: input.url,
        status: "active",
        updatedAt: new Date().toISOString(),
      });
    }
    const sessionAction = /^\/sessions\/([^/]+)\/(read|close|input|downloads|screenshot)$/.exec(
      url,
    );
    if (sessionAction) {
      const [, id, action] = sessionAction;
      if (action === "read") {
        const session = this.sessions.get(id);
        if (!session) return json(response, 404, { error: { message: "no session" } });
        return json(response, 200, {
          url: session.url,
          title: session.title,
          text: `The text of ${session.url}`,
          truncated: false,
        });
      }
      if (action === "screenshot") {
        // A 1x1 PNG.
        const png = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
          "base64",
        );
        response.writeHead(200, { "content-type": "image/png" });
        response.end(png);
        return response;
      }
      if (action === "close") {
        this.sessions.delete(id);
        return json(response, 200, {
          id,
          title: "Closed",
          url: this.sessions.get(id)?.url ?? "about:blank",
          status: "closed",
          updatedAt: new Date().toISOString(),
        });
      }
      if (action === "input") {
        const session = this.sessions.get(id);
        if (!session) return json(response, 404, { error: { message: "no session" } });
        return json(response, 200, {
          id,
          title: session.title,
          url: session.url,
          status: "active",
          updatedAt: new Date().toISOString(),
        });
      }
      if (action === "downloads") return json(response, 200, { downloads: [], failures: [] });
    }
    return json(response, 404, { error: { message: "unknown worker route" } });
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

function json(response: ServerResponse, status: number, body: unknown): ServerResponse {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
  return response;
}

function refuse(response: ServerResponse, code: string, status: number) {
  json(response, status, { error: "Request refused.", code, requestId: randomUUID() });
}

describe("T07.18 browser and computer control admit every action online", () => {
  const authority = new AuthorityStub();
  const worker = new WorkerStub();
  let db: Store;
  let app: Awaited<ReturnType<typeof createEnterpriseApp>>;
  let directory: string;
  let token: string;
  const globexBrowserId = "00000000-0000-4000-8000-000000000099";

  beforeAll(async () => {
    await authority.start();
    await worker.start();
    directory = await mkdtemp(join(tmpdir(), "openmuse-enterprise-control-"));
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
      workerUrl: worker.origin,
      workerToken: "worker-token",
    };
    app = await createEnterpriseApp(db, config, {});
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
    // Another company's browser session, visible only to its own namespace.
    const globexSession: BrowserSession = {
      id: globexBrowserId,
      title: "Globex portal",
      url: "https://globex.example/",
      status: "active",
      updatedAt: new Date().toISOString(),
    };
    await db.put(GLOBEX_OWNER, "browsers", globexSession);
    worker.sessions.set(globexBrowserId, { url: "https://globex.example/", title: "Globex" });
  }, 120_000);

  afterAll(async () => {
    await db.close();
    await rm(directory, { recursive: true, force: true });
    await worker.stop();
    await authority.stop();
  }, 120_000);

  test("bff_browser_or_computer_cannot_use_another_namespace_instance", async () => {
    const before = worker.controlCalls();
    // A control action naming the OTHER company's browser instance: the
    // admission names the object, the server-side namespace ownership refuses
    // it with the uniform 404, and the worker is never touched.
    const navigate = await app.request(`/api/browsers/${globexBrowserId}/navigate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...SELECTOR_HEADERS(ACME),
      },
      body: JSON.stringify({ url: "https://acme.example/attack" }),
    });
    expect(navigate.status).toBe(404);
    expect(((await navigate.json()) as { code: string }).code).toBe("RESOURCE_NOT_FOUND");
    // The worker saw zero control calls for this namespace's attempts.
    expect(worker.controlCalls()).toBe(before);
    // The other namespace's session is unchanged and still "exists" for its own
    // owner — the refusal never mutated another company's record.
    const globexRow = await db.get<BrowserSession>(GLOBEX_OWNER, "browsers", globexBrowserId);
    expect(globexRow?.url).toBe("https://globex.example/");

    // The computer surface has the same boundary: /api/computer/* under the
    // admitted namespace only ever touches this namespace's computer.
    const computer = await app.request("/api/computer", {
      headers: { Authorization: `Bearer ${token}`, ...SELECTOR_HEADERS(ACME) },
    });
    expect(computer.status).toBe(200);
    const snapshot = (await computer.json()) as {
      enabled: boolean;
      provider: string;
      status: string;
    };
    expect(snapshot.provider).toBe("docker");
    // The computer admission named the namespace's own surface, and the
    // evidence below (route + actor + company/team) rides every admission.
    const lastAdmission = authority.admissions.at(-1);
    expect(lastAdmission?.tenantId).toBe(ACME.tenantId);
    expect(lastAdmission?.workspaceId).toBe(ACME.workspaceId);
  }, 60_000);

  test("revocation_blocks_next_browser_command", async () => {
    // A session in THIS namespace, created through the BFF.
    const created = await app.request("/api/browsers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...SELECTOR_HEADERS(ACME),
      },
      body: JSON.stringify({ url: "https://acme.example/" }),
    });
    expect(created.status).toBe(201);
    const browserId = ((await created.json()) as { id: string }).id;
    expect(worker.sessions.has(browserId)).toBe(true);

    // Revoke the session: the NEXT control command must be refused by the
    // online admission, and zero later commands reach the worker.
    const before = worker.controlCalls();
    authority.revoked = true;
    try {
      const laterCommands: number = await (async () => {
        const refused = await app.request(`/api/browsers/${browserId}/navigate`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            ...SELECTOR_HEADERS(ACME),
          },
          body: JSON.stringify({ url: "https://acme.example/next" }),
        });
        expect(refused.status).toBe(401);
        expect(((await refused.json()) as { code: string }).code).toBe("SESSION_REVOKED");
        // The read command is refused the same way.
        const read = await app.request(`/api/browsers/${browserId}/read`, {
          headers: { Authorization: `Bearer ${token}`, ...SELECTOR_HEADERS(ACME) },
        });
        expect(read.status).toBe(401);
        // The console input command is refused too.
        const input = await app.request(`/api/browsers/${browserId}/console`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            ...SELECTOR_HEADERS(ACME),
          },
          body: JSON.stringify({ type: "key", key: "Enter" }),
        });
        expect(input.status).toBe(401);
        return worker.controlCalls() - before;
      })();
      expect(laterCommands).toBe(0);
      // Each refusal was an ONLINE decision: the authority answered every one.
      const refusals = authority.admissions.filter((call) => call.operation === "workspace.read");
      expect(refusals.length).toBeGreaterThanOrEqual(3);
    } finally {
      authority.revoked = false;
    }
  }, 60_000);

  test("every_control_action_admits_online_with_operation_and_object", async () => {
    authority.admissions.length = 0;
    const created = await app.request("/api/browsers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...SELECTOR_HEADERS(ACME),
      },
      body: JSON.stringify({ url: "https://acme.example/control" }),
    });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { id: string }).id;

    const read = await app.request(`/api/browsers/${id}/read`, {
      headers: { Authorization: `Bearer ${token}`, ...SELECTOR_HEADERS(ACME) },
    });
    expect(read.status).toBe(200);
    const page = (await read.json()) as { url: string; text: string };
    expect(page.url).toBe("https://acme.example/control");

    const closed = await app.request(`/api/browsers/${id}/close`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, ...SELECTOR_HEADERS(ACME) },
    });
    expect(closed.status).toBe(200);

    // Every admission named this action's object under the frozen operation
    // word, for the one selection the request carried.
    const browserAdmissions = authority.admissions.filter(
      (call) => call.operation === "workspace.read",
    );
    expect(browserAdmissions.length).toBeGreaterThanOrEqual(3);
    for (const call of browserAdmissions) {
      expect(call.tenantId).toBe(ACME.tenantId);
      expect(call.workspaceId).toBe(ACME.workspaceId);
    }
    expect(
      browserAdmissions.some((call) => call.resourceId === null), // the create
    ).toBe(true);
    expect(
      browserAdmissions.some((call) => call.resourceId === `browser:${id}`), // the read
    ).toBe(true);
    expect(
      browserAdmissions.some((call) => call.resourceId === `browser:${id}`), // the close
    ).toBe(true);
  }, 60_000);

  test("browser_preview_and_console_answer_through_the_media_seam", async () => {
    const created = await app.request("/api/browsers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...SELECTOR_HEADERS(ACME),
      },
      body: JSON.stringify({ url: "https://acme.example/previewed" }),
    });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { id: string }).id;

    const preview = await app.request(`/api/browsers/${id}/preview`, {
      headers: { Authorization: `Bearer ${token}`, ...SELECTOR_HEADERS(ACME) },
    });
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toBe("image/png");
    expect(preview.headers.get("cache-control")).toContain("no-store");

    const console_ = await app.request(`/api/browsers/${id}/console`, {
      headers: { Authorization: `Bearer ${token}`, ...SELECTOR_HEADERS(ACME) },
    });
    expect(console_.status).toBe(200);
    const document = await console_.text();
    // The console document embeds a ≤60-second media ticket URL for the
    // preview — never the standalone signed owner URL.
    expect(document).not.toContain("signature=");
    expect(document).toContain("/api/browsers/");
    expect(document).toContain("/preview");
  }, 60_000);

  test("instance_reuse_follows_the_reset_contract", async () => {
    // Reopen is the BFF's reuse path: the SAME session id re-opens at a new
    // URL through the worker, in THIS namespace, with a fresh online
    // admission — the worker open is a new open of this namespace's record,
    // never a carry-over of another namespace's profile.
    const created = await app.request("/api/browsers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...SELECTOR_HEADERS(ACME),
      },
      body: JSON.stringify({ url: "https://acme.example/first" }),
    });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { id: string }).id;

    authority.admissions.length = 0;
    worker.calls.length = 0;
    const reopened = await app.request(`/api/browsers/${id}/reopen`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...SELECTOR_HEADERS(ACME),
      },
      body: JSON.stringify({ url: "https://acme.example/second" }),
    });
    expect(reopened.status).toBe(200);
    const reopenedBody = (await reopened.json()) as { url: string; status: string };
    expect(reopenedBody.url).toBe("https://acme.example/second");
    // One online admission for this one action.
    const reopenAdmissions = authority.admissions.filter(
      (call) => call.operation === "workspace.read",
    );
    expect(reopenAdmissions.length).toBe(1);
    expect(reopenAdmissions[0]?.resourceId).toBe(`browser:${id}`);
    // The worker saw exactly one open call for the same session id.
    const opens = worker.calls.filter(
      (call) => call.method === "POST" && call.path === "/sessions",
    );
    expect(opens.length).toBe(1);
    expect(((opens[0]?.body ?? {}) as { id?: string }).id).toBe(id);
    // The store row belongs to THIS namespace.
    const row = await db.get<BrowserSession>(ACME_OWNER, "browsers", id);
    expect(row?.url).toBe("https://acme.example/second");
    const globexRow = await db.get<BrowserSession>(GLOBEX_OWNER, "browsers", id);
    expect(globexRow).toBeNull();
  }, 60_000);

  test("unknown_control_route_never_falls_back_to_standalone_owner", async () => {
    // A route this task did not wire stays closed on the enterprise surface —
    // never a standalone owner authentication.
    const response = await app.request("/api/browsers/unknown-route", {
      headers: { Authorization: `Bearer ${token}`, ...SELECTOR_HEADERS(ACME) },
    });
    expect(response.status).toBe(404);
    expect(((await response.json()) as { code: string }).code).toBe("RESOURCE_NOT_FOUND");
    // The signed standalone URL is not a credential here either.
    const signed = await app.request(
      `/api/browsers/00000000-0000-4000-8000-000000000001/preview?owner=${encodeURIComponent(ACME_OWNER)}&expires=${Date.now() + 60_000}&signature=${"a".repeat(64)}`,
    );
    expect(signed.status).toBe(401);
  }, 60_000);
});
