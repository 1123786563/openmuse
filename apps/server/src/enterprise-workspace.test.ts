// @ts-expect-error -- bun:test types come from the Bun runtime; this tsconfig names node types.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Mail } from "../../../packages/domain/src/index.ts";
import { workspaceSchema } from "../../../packages/domain/src/index.ts";
import type { Config } from "./config.ts";
import { createStore, type Store } from "./db.ts";
import { createEnterpriseApp } from "./enterprise.ts";

/*
 * T07.05 (#595): the enterprise BFF keeps this OpenMuse server, exchanges the
 * frozen EnterpriseSessionInput for the OpenBot authority's opaque handle, and
 * answers GET /api/workspace with the ORIGINAL Workspace contract — the same
 * workspaceSchema the app consumes — scoped to the server-authorized
 * company/team/principal namespace. No accessKey, sample seed or local-user
 * fallback exists anywhere on the enterprise surface.
 *
 * The authority below is the REAL wire peer of createOpenbotAuthority: a local
 * HTTP server that answers the frozen OpenBot POST
 * /api/enterprise/mobile/session/{exchange,authorize} contracts (T05.12 /
 * T05.13), so the BFF's service credential, one-time code exchange and
 * per-request online admission are exercised end to end.
 */

const BFF = {
  clientId: "openmuse-mobile",
  bffServiceId: "bff-service",
  bffServiceSecret: "bff-service-secret",
  user: { id: "user-1", principalId: "principal-1" } as const,
};

interface AdmissionCall {
  operation: string;
  tenantId: string;
  workspaceId: string;
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

  currentHandle(): string {
    const last = [...this.handles.keys()].at(-1);
    if (!last) throw new Error("no handle issued yet");
    return last;
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
    if (this.revoked) return refuse(response, "SESSION_REVOKED", 401);
    const handle = typeof body.handle === "string" ? body.handle : "";
    if (!this.handles.has(handle)) return refuse(response, "SESSION_EXPIRED", 401);
    const selectors = (body.selectors ?? {}) as Record<string, unknown>;
    if (
      body.operation !== "workspace.read" ||
      typeof selectors.tenantId !== "string" ||
      typeof selectors.workspaceId !== "string" ||
      !selectors.tenantId ||
      !selectors.workspaceId
    )
      return refuse(response, "INVALID_REQUEST", 400);
    const tenantId = selectors.tenantId;
    const workspaceId = selectors.workspaceId;
    this.admissions.push({ operation: String(body.operation), tenantId, workspaceId });
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
      operation: "workspace.read",
      resourceId: null,
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

const SELECTOR_HEADERS = (tenantId: string, workspaceId: string) => ({
  "x-openbot-tenant": tenantId,
  "x-openbot-workspace": workspaceId,
});

function mailRow(id: string, subject: string): Mail {
  return {
    id,
    threadId: `thread-${id}`,
    from: `${id}@example.com`,
    sender: id,
    to: ["person@example.com"],
    subject,
    body: `${subject} body`,
    date: "2026-10-22T10:00:00.000Z",
    unread: false,
    label: "Work",
    attachments: [],
  };
}

async function enterpriseApp(
  authority: AuthorityStub,
  overrides: Partial<Config> = {},
): Promise<{
  db: Store;
  directory: string;
  config: Config;
  app: Awaited<ReturnType<typeof createEnterpriseApp>>;
}> {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-enterprise-"));
  const db = await createStore({ dataDir: join(directory, "data") });
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
    ...overrides,
  };
  // Production wiring: the real OpenBot authority client, pointed at the
  // stub's HTTP server by deployment config — no seam injection.
  const app = await createEnterpriseApp(db, config);
  return { db, directory, config, app };
}

function sessionBody(): Record<string, string> {
  return {
    authMode: "enterprise",
    intentId: "intent-1",
    code: "code-1",
    codeVerifier: "a".repeat(43),
    redirectUri: "openmuse://callback",
  };
}

describe("T07.05 enterprise session and workspace mapping", () => {
  const authority = new AuthorityStub();
  let db: Store;
  let app: Awaited<ReturnType<typeof createEnterpriseApp>>;
  let directory: string;
  let token: string;

  beforeAll(async () => {
    await authority.start();
    ({ db, app, directory } = await enterpriseApp(authority));
    const response = await app.request("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sessionBody()),
    });
    expect(response.status).toBe(200);
    token = ((await response.json()) as { token: string }).token;
    // Two tenants live in the same store; only the admitted namespace may be read.
    await db.put(
      "enterprise:tenant-acme:ws-acme-ops:principal-1",
      "mail",
      mailRow("acme-mail", "Acme mail"),
    );
    await db.put("enterprise:tenant-acme:ws-acme-ops:principal-1", "browsers", {
      id: "acme-browser",
      title: "Acme browser",
      url: "https://acme.example",
      status: "idle",
      updatedAt: "2026-10-22T10:00:00.000Z",
    });
    await db.put(
      "enterprise:tenant-globex:ws-globex-ops:principal-2",
      "mail",
      mailRow("globex-mail", "Globex mail"),
    );
    await db.put("enterprise:tenant-globex:ws-globex-ops:principal-2", "browsers", {
      id: "globex-browser",
      title: "Globex browser",
      url: "https://globex.example",
      status: "idle",
      updatedAt: "2026-10-22T10:00:00.000Z",
    });
  }, 120_000);

  afterAll(async () => {
    await db.close();
    await rm(directory, { recursive: true, force: true });
    await authority.stop();
  }, 120_000);

  test("enterprise_bff_returns_original_workspace_schema", async () => {
    const response = await app.request("/api/workspace?q=acme", {
      headers: {
        Authorization: `Bearer ${token}`,
        ...SELECTOR_HEADERS("tenant-acme", "ws-acme-ops"),
      },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as unknown;
    expect(workspaceSchema.safeParse(body).success).toBe(true);
    const workspace = workspaceSchema.parse(body);
    expect(workspace.mode).toBe("live");
    expect(workspace.runtime.provider).toBe("openbot");
    expect(workspace.runtime.openbotConfigured).toBe(true);
    expect(workspace.mail.map((message) => message.id)).toEqual(["acme-mail"]);
    // The batch answer is the original contract, not the OpenBot one.
    expect("user" in (body as Record<string, unknown>)).toBe(false);
    expect("agents" in (body as Record<string, unknown>)).toBe(false);
  }, 60_000);

  test("enterprise_access_key_never_falls_back_to_standalone", async () => {
    // A body carrying an accessKey (the standalone credential) is refused
    // before the authority is ever called.
    const byBody = await app.request("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessKey: "standalone-access-key-0123456789" }),
    });
    expect(byBody.status).not.toBe(200);
    expect(((await byBody.json()) as { code: string }).code).toBe("INVALID_REQUEST");
    // A Bearer access key is not a session handle: the authority refuses the
    // unknown handle and the surface answers with the frozen error shape.
    const byBearer = await app.request("/api/workspace", {
      headers: {
        Authorization: "Bearer standalone-access-key-0123456789",
        ...SELECTOR_HEADERS("tenant-acme", "ws-acme-ops"),
      },
    });
    expect(byBearer.status).not.toBe(200);
    expect(byBearer.status).toBe(401);
    expect(((await byBearer.json()) as { code: string }).code).toBe("SESSION_EXPIRED");
  }, 60_000);

  test("workspace_scope_does_not_leak_other_tenant", async () => {
    const response = await app.request("/api/workspace", {
      headers: {
        Authorization: `Bearer ${token}`,
        ...SELECTOR_HEADERS("tenant-acme", "ws-acme-ops"),
      },
    });
    expect(response.status).toBe(200);
    const workspace = workspaceSchema.parse(await response.json());
    const visibleIds = [
      ...workspace.mail.map((message) => message.id),
      ...workspace.browsers.map((browser) => browser.id),
      ...workspace.files.map((file) => file.id),
      ...workspace.actions.map((action) => action.id),
      ...workspace.activity.map((entry) => entry.id),
    ];
    const otherTenantItems = visibleIds.filter((id) => id.startsWith("globex"));
    expect(otherTenantItems).toEqual([]);
    expect(workspace.mail.map((message) => message.id)).toContain("acme-mail");
  }, 60_000);

  test("workspace_without_scope_selection_is_refused", async () => {
    const response = await app.request("/api/workspace", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe("SCOPE_REQUIRED");
  }, 60_000);

  test("enterprise_admission_gate_runs_on_every_request", async () => {
    const selector = ["tenant-acme", "ws-acme-ops"] as const;
    const count = () =>
      authority.admissions.filter(
        (call) => call.tenantId === selector[0] && call.workspaceId === selector[1],
      ).length;
    const before = count();
    const first = await app.request("/api/workspace", {
      headers: { Authorization: `Bearer ${token}`, ...SELECTOR_HEADERS(...selector) },
    });
    expect(first.status).toBe(200);
    const second = await app.request("/api/workspace", {
      headers: { Authorization: `Bearer ${token}`, ...SELECTOR_HEADERS(...selector) },
    });
    expect(second.status).toBe(200);
    // No positive caching: two reads mean two online admissions.
    expect(count() - before).toBe(2);
  }, 60_000);

  test("revoked_authority_session_is_refused_per_request", async () => {
    authority.revoked = true;
    try {
      const response = await app.request("/api/workspace", {
        headers: {
          Authorization: `Bearer ${token}`,
          ...SELECTOR_HEADERS("tenant-acme", "ws-acme-ops"),
        },
      });
      expect(response.status).toBe(401);
      expect(((await response.json()) as { code: string }).code).toBe("SESSION_REVOKED");
    } finally {
      authority.revoked = false;
    }
  }, 60_000);

  test("unknown_routes_never_fall_back_to_standalone_owner", async () => {
    // T07.17 wired the content surfaces and T07.07 wired the media byte
    // routes (/api/files/:id/content among them); a route THIS BFF still has
    // not wired keeps refusing instead of falling back to the standalone owner.
    const response = await app.request("/api/admin/secrets", {
      headers: {
        Authorization: `Bearer ${token}`,
        ...SELECTOR_HEADERS("tenant-acme", "ws-acme-ops"),
      },
    });
    expect(response.status).toBe(404);
    expect(((await response.json()) as { code: string }).code).toBe("RESOURCE_NOT_FOUND");
  }, 60_000);
});
