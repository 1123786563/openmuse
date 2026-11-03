// @ts-expect-error -- bun:test types come from the Bun runtime; this tsconfig names node types.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Mail } from "../../../packages/domain/src/index.ts";
import { emailDraftSchema } from "../../../packages/domain/src/index.ts";
import type { Config } from "./config.ts";
import { createStore, type Store } from "./db.ts";
import { createEnterpriseApp } from "./enterprise.ts";

/*
 * T07.17 (#607): the BFF's mail, calendar, draft, conversation and approval
 * surfaces consume the controlled namespace.
 *
 * GET /api/calendars, /api/calendar/events, /api/mail/threads/:id,
 * /api/drafts, /api/main-thread, /api/conversation, POST /api/actions and
 * POST /api/actions/:id/decide and PUT /api/conversation keep their original
 * wire DTOs and run under the enterprise middleware: one online admission per
 * request (workspace.read for reads, and the same single frozen word the
 * authority whitelists for this surface), the store namespace is fixed to
 * company/team/principal, and read/write/approve are checked separately per
 * object. Data of another company/team/principal never crosses the namespace
 * boundary, a revoked admission refuses the very next request, and an unknown
 * route still never falls back to the standalone owner.
 *
 * The authority below is the REAL wire peer of createOpenbotAuthority: a
 * local HTTP server that answers the frozen OpenBot POST
 * /api/enterprise/mobile/session/{exchange,authorize} contracts (T05.12 /
 * T05.13), so the per-request admission is exercised end to end.
 */

const BFF = {
  clientId: "openmuse-mobile",
  bffServiceId: "bff-service",
  bffServiceSecret: "bff-service-secret",
  user: { id: "user-1", principalId: "principal-1" } as const,
};

const ACME = { tenantId: "tenant-acme", workspaceId: "ws-acme-ops" } as const;
const GLOBEX = { tenantId: "tenant-globex", workspaceId: "ws-globex-ops" } as const;

interface AdmissionCall {
  operation: string;
  tenantId: string;
  workspaceId: string;
  resourceId: string | null;
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
    const operation = typeof body.operation === "string" ? body.operation : "";
    if (
      !operation ||
      typeof selectors.tenantId !== "string" ||
      typeof selectors.workspaceId !== "string" ||
      !selectors.tenantId ||
      !selectors.workspaceId
    )
      return refuse(response, "INVALID_REQUEST", 400);
    this.admissions.push({
      operation,
      tenantId: selectors.tenantId,
      workspaceId: selectors.workspaceId,
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

const threadSeeds: { threadId: string; userId: string; agentId: string }[] = [];
const acmeOwner = `enterprise:${ACME.tenantId}:${ACME.workspaceId}:${BFF.user.principalId}`;
const globexOwner = `enterprise:${GLOBEX.tenantId}:${GLOBEX.workspaceId}:principal-2`;

async function enterpriseApp(
  authority: AuthorityStub,
  overrides: Partial<Config> = {},
): Promise<{
  db: Store;
  directory: string;
  app: Awaited<ReturnType<typeof createEnterpriseApp>>;
}> {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-enterprise-content-"));
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
  const app = await createEnterpriseApp(db, config, {
    // The Rich Threads seam app.ts hands its real platform to; the stand-in
    // proves the thread is created for the ADMITTED owner, not a client value.
    intelligence: {
      getOrCreateThread: async (args) => {
        threadSeeds.push(args);
        return { threadId: args.threadId };
      },
    },
  });
  return { db, directory, app };
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

describe("T07.17 mail/calendar/drafts/conversation and approvals consume the controlled namespace", () => {
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
    // Two companies live in the same store; only the admitted namespace may
    // ever be read or written.
    await db.put(acmeOwner, "mail", mailRow("acme-mail", "Acme mail"));
    await db.put(
      acmeOwner,
      "drafts",
      Object.assign(
        { id: "acme-draft", createdAt: "2026-10-22T10:00:00.000Z" },
        emailDraftSchema.parse({
          to: ["acme@example.com"],
          subject: "Acme draft",
          body: "Acme draft body",
        }),
      ),
    );
    await db.put(globexOwner, "mail", mailRow("globex-mail", "Globex mail"));
    await db.put(
      globexOwner,
      "drafts",
      Object.assign(
        { id: "globex-draft", createdAt: "2026-10-22T10:00:00.000Z" },
        emailDraftSchema.parse({
          to: ["globex@example.com"],
          subject: "Globex draft",
          body: "Globex draft body",
        }),
      ),
    );
    await db.put(globexOwner, "conversations", {
      id: "default",
      messages: [{ id: "globex-message", role: "assistant", content: "Globex secret" }],
    });
  }, 120_000);

  afterAll(async () => {
    await db.close();
    await rm(directory, { recursive: true, force: true });
    await authority.stop();
  }, 120_000);

  test("bff_mail_calendar_and_drafts_do_not_cross_namespace", async () => {
    // Reads under the admitted company must answer 200 with the original
    // DTO shapes and never leak the other company's rows.
    const mailThread = await app.request(`/api/mail/threads/thread-acme-mail`, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...SELECTOR_HEADERS(ACME.tenantId, ACME.workspaceId),
      },
    });
    // Without a Google connection the thread read refuses (409) — but the
    // namespace check below uses the surfaces that answer from the store.
    expect([200, 409]).toContain(mailThread.status);
    // The object-level read admission names the thread it reads.
    const threadAdmission = authority.admissions.at(-1);
    expect(threadAdmission?.operation).toBe("workspace.read");
    expect(threadAdmission?.resourceId).toBe("mail-thread:thread-acme-mail");

    const drafts = await app.request("/api/drafts", {
      headers: {
        Authorization: `Bearer ${token}`,
        ...SELECTOR_HEADERS(ACME.tenantId, ACME.workspaceId),
      },
    });
    expect(drafts.status).toBe(200);
    const draftRows = (await drafts.json()) as { id: string }[];
    const otherTenantRows = draftRows.filter((row) => String(row.id).startsWith("globex"));
    expect(otherTenantRows).toEqual([]);
    expect(draftRows.map((row) => row.id)).toContain("acme-draft");

    // The write half: a draft written under the admitted namespace must not
    // appear in the other company's namespace.
    const written = await app.request("/api/drafts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...SELECTOR_HEADERS(ACME.tenantId, ACME.workspaceId),
      },
      body: JSON.stringify(
        emailDraftSchema.parse({
          to: ["writer@example.com"],
          subject: "Acme written draft",
          body: "Written under the admitted namespace",
        }),
      ),
    });
    expect(written.status).toBe(201);
    const writtenId = ((await written.json()) as { id: string }).id;
    const globexDrafts = await db.list<{ id: string }>(globexOwner, "drafts");
    expect(globexDrafts.map((row) => row.id)).not.toContain(writtenId);
    const acmeDrafts = await db.list<{ id: string }>(acmeOwner, "drafts");
    expect(acmeDrafts.map((row) => row.id)).toContain(writtenId);
  }, 60_000);

  test("bff_action_decision_rechecks_source_and_actor", async () => {
    // A proposal pending in the admitted namespace: the decide route must
    // re-run the online admission before the store write, so a revocation
    // committed before the request leaves zero decided rows.
    const proposal = await db.put(acmeOwner, "actions", {
      id: "action-1",
      title: "Send “Globex probe”",
      kind: "email.send",
      data: emailDraftSchema.parse({
        to: ["person@example.com"],
        subject: "Globex probe",
        body: "probe",
      }),
      status: "awaiting_review",
      hash: "hash-1",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
    authority.revoked = true;
    try {
      const refused = await app.request(`/api/actions/${proposal.id}/decide`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...SELECTOR_HEADERS(ACME.tenantId, ACME.workspaceId),
        },
        body: JSON.stringify({ hash: proposal.hash, decision: "approve" }),
      });
      expect(refused.status).toBe(401);
      expect(((await refused.json()) as { code: string }).code).toBe("SESSION_REVOKED");
    } finally {
      authority.revoked = false;
    }
    // Cross-company id guessing: the decide route runs in the admitted
    // namespace, so the other company's proposal id is simply not there.
    const crossProposal = await db.put(globexOwner, "actions", {
      id: "action-globex",
      title: "Send “Globex secret”",
      kind: "email.send",
      data: emailDraftSchema.parse({
        to: ["person@example.com"],
        subject: "Globex secret",
        body: "secret",
      }),
      status: "awaiting_review",
      hash: "hash-globex",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
    const cross = await app.request(`/api/actions/${crossProposal.id}/decide`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...SELECTOR_HEADERS(ACME.tenantId, ACME.workspaceId),
      },
      body: JSON.stringify({ hash: crossProposal.hash, decision: "approve" }),
    });
    expect(cross.status).toBe(404);
    // The decide admission names the object it decides AND stays in the
    // admitted company/team selector; the client cannot name either.
    const decideAdmission = authority.admissions.at(-1);
    expect(decideAdmission?.operation).toBe("workspace.read");
    expect(decideAdmission?.resourceId).toBe(`action:${crossProposal.id}`);
    expect(decideAdmission?.tenantId).toBe(ACME.tenantId);
    expect(decideAdmission?.workspaceId).toBe(ACME.workspaceId);
    const decisionsAfterRevoke = (await db.list(acmeOwner, "actions")).filter((row) =>
      ["approved", "executing", "succeeded", "denied"].includes(String(row.status)),
    ).length;
    expect(decisionsAfterRevoke).toBe(0);
    const globexAfter = await db.get<{ status: string }>(globexOwner, "actions", "action-globex");
    expect(globexAfter?.status).toBe("awaiting_review");
  }, 60_000);

  test("conversation_read_and_write_stay_in_namespace", async () => {
    const read = await app.request("/api/conversation", {
      headers: {
        Authorization: `Bearer ${token}`,
        ...SELECTOR_HEADERS(ACME.tenantId, ACME.workspaceId),
      },
    });
    expect(read.status).toBe(200);
    const before = (await read.json()) as { messages: unknown[] };
    expect(JSON.stringify(before)).not.toContain("Globex secret");

    const put = await app.request("/api/conversation", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...SELECTOR_HEADERS(ACME.tenantId, ACME.workspaceId),
      },
      body: JSON.stringify({
        messages: [
          {
            id: "acme-put-message",
            role: "user",
            content: "Acme conversation message",
          },
        ],
      }),
    });
    expect(put.status).toBe(200);
    const globexConversation = await db.get<{ messages: { id: string }[] }>(
      globexOwner,
      "conversations",
      "default",
    );
    expect(globexConversation?.messages.map((message) => message.id)).not.toContain(
      "acme-put-message",
    );
    const acmeConversation = await db.get<{ messages: { id: string }[] }>(
      acmeOwner,
      "conversations",
      "default",
    );
    expect(acmeConversation?.messages.map((message) => message.id)).toContain("acme-put-message");
  }, 60_000);

  test("content_routes_admit_online_per_request", async () => {
    const selector = [ACME.tenantId, ACME.workspaceId] as const;
    const count = () =>
      authority.admissions.filter(
        (call) => call.tenantId === selector[0] && call.workspaceId === selector[1],
      ).length;
    const before = count();
    const drafts = await app.request("/api/drafts", {
      headers: { Authorization: `Bearer ${token}`, ...SELECTOR_HEADERS(...selector) },
    });
    expect(drafts.status).toBe(200);
    const conversation = await app.request("/api/conversation", {
      headers: { Authorization: `Bearer ${token}`, ...SELECTOR_HEADERS(...selector) },
    });
    expect(conversation.status).toBe(200);
    // Two reads, two online admissions; no positive decision is cached.
    expect(count() - before).toBe(2);
    // Calendar surfaces are admitted too (the store answers 200 with []).
    const calendars = await app.request("/api/calendars", {
      headers: { Authorization: `Bearer ${token}`, ...SELECTOR_HEADERS(...selector) },
    });
    expect(calendars.status).toBe(200);
    expect(count() - before).toBe(3);
    const events = await app.request("/api/calendar/events", {
      headers: { Authorization: `Bearer ${token}`, ...SELECTOR_HEADERS(...selector) },
    });
    expect(events.status).toBe(200);
    expect(count() - before).toBe(4);
  }, 60_000);

  test("main_thread_creates_for_the_admitted_owner_only", async () => {
    const before = threadSeeds.length;
    const response = await app.request("/api/main-thread", {
      headers: {
        Authorization: `Bearer ${token}`,
        ...SELECTOR_HEADERS(ACME.tenantId, ACME.workspaceId),
      },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { threadId: string; existing: boolean };
    expect(body.existing).toBe(true);
    // The thread is created FOR the server-admitted namespace owner, never a
    // client-named identity, and the admission names the conversation object.
    const seed = threadSeeds.at(-1);
    expect(seed?.userId).toBe(acmeOwner);
    expect(seed?.agentId).toBe("default");
    const admission = authority.admissions.at(-1);
    expect(admission?.resourceId).toBe("conversation:main");
    expect(threadSeeds.length - before).toBe(1);
    // The settings row lives in the admitted namespace.
    const settings = await db.get<{ threadId: string }>(acmeOwner, "conversation-settings", "main");
    expect(settings?.threadId).toBe(body.threadId);
    const globexSettings = await db.get(globexOwner, "conversation-settings", "main");
    expect(globexSettings).toBeNull();
  }, 60_000);

  test("unknown_content_route_never_falls_back_to_standalone_owner", async () => {
    const response = await app.request("/api/files/some-file/content", {
      headers: {
        Authorization: `Bearer ${token}`,
        ...SELECTOR_HEADERS(ACME.tenantId, ACME.workspaceId),
      },
    });
    expect(response.status).toBe(404);
    expect(((await response.json()) as { code: string }).code).toBe("RESOURCE_NOT_FOUND");
  }, 60_000);
});
