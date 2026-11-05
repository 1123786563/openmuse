// @ts-expect-error -- bun:test types come from the Bun runtime; this tsconfig names node types.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Artifact, Mail } from "../../../packages/domain/src/index.ts";
import { createSamplePdf } from "../../../packages/integrations/src/pdf.ts";
import { encryptSecret } from "../../../packages/integrations/src/vault.ts";
import type { Config } from "./config.ts";
import { createStore, type Store } from "./db.ts";
import { createEnterpriseApp } from "./enterprise.ts";
import { GoogleAuth } from "./google-auth.ts";

/*
 * T07.19 (#609, original task P17; interfaces §5.2): the BFF's Google OAuth
 * hand-off, attachment import and file generation remain part of the
 * enterprise supply.
 *
 * POST /api/google/connect, POST /api/google/disconnect,
 * POST /api/mail/import-attachment, POST /api/files, POST /api/files/:id/fill
 * and GET /api/google/callback keep their original standalone DTOs, but every
 * business route runs after the enterprise guard's online admission. The
 * OAuth state is minted by the server and fixes the authority, handle,
 * account, principal, company/team selection and return intent; the callback
 * recovers ownership from that state alone (never from an active session,
 * request body or query identity) and refuses a changed account/scope with
 * ACCOUNT_CHANGED before any Google token is stored. Attachment import binds
 * the mail source it reads and re-admits online, so a revocation committed
 * before the import reaches Google zero times. Generated artifacts stay in
 * the admitted namespace and answer with the BFF's online content URL rather
 * than a standalone signed owner URL.
 *
 * The authority below is the REAL wire peer of createOpenbotAuthority (a
 * local HTTP server answering the frozen OpenBot routes), and the Google
 * endpoints are a local stand-in for the provider's token/profile/attachment
 * calls, so the whole chain — route → guard → online authorize → service →
 * provider — is exercised through the production createApp wiring in
 * enterprise mode.
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
  actor: { userId: string; principalId: string } = {
    userId: BFF.user.id,
    principalId: BFF.user.principalId,
  };
  scopeOverride: { tenantId: string; workspaceId: string } | null = null;
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

  reset(): void {
    this.actor = { userId: BFF.user.id, principalId: BFF.user.principalId };
    this.scopeOverride = null;
    this.revoked = false;
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
    const resourceId = typeof body.resourceId === "string" ? body.resourceId : null;
    this.admissions.push({
      route: "authorize",
      handle,
      operation,
      resourceId,
      tenantId: String(selectors.tenantId ?? ""),
      workspaceId: String(selectors.workspaceId ?? ""),
    });
    // A revoked session still ANSWERS online — the refusal is the authority's
    // own decision, recorded here before it is refused.
    if (this.revoked) return refuse(response, "SESSION_REVOKED", 401);
    if (!operation || !selectors.tenantId || !selectors.workspaceId)
      return refuse(response, "INVALID_REQUEST", 400);
    const scope = this.scopeOverride ?? {
      tenantId: String(selectors.tenantId),
      workspaceId: String(selectors.workspaceId),
    };
    return json(response, 200, {
      mode: "live",
      authMode: "enterprise",
      actor: { ...this.actor, identityGeneration: 1 },
      session: {
        sessionId: "session-1",
        handleExpiresAt: new Date(Date.now() + 1800_000).toISOString(),
      },
      scope: {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        organizationId: scope.tenantId,
        teamId: `team-${scope.workspaceId}`,
        memberEpoch: 1,
        workspaceMemberEpoch: 1,
        companyGeneration: 0,
        teamGeneration: 0,
        capabilities: [],
      },
      assurance: null,
      admissionId: randomUUID(),
      operation,
      resourceId,
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

function json(response: ServerResponse, status: number, body: unknown): ServerResponse {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
  return response;
}

function refuse(response: ServerResponse, code: string, status: number) {
  json(response, status, { error: "Request refused.", code, requestId: randomUUID() });
}

function mailRow(id: string, references: string[]): Mail & { connectionId: string } {
  return {
    id,
    threadId: `thread-${id}`,
    from: `${id}@example.com`,
    sender: id,
    to: ["person@example.com"],
    subject: `${id} subject`,
    body: `${id} body`,
    date: "2026-10-22T10:00:00.000Z",
    unread: false,
    label: "Work",
    attachments: references,
    connectionId: "connection-1",
  };
}

describe("T07.19 Google OAuth, attachment import and file generation bind the enterprise intent", () => {
  const authority = new AuthorityStub();
  const realFetch = globalThis.fetch;
  let db: Store;
  let app: Awaited<ReturnType<typeof import("./app.ts")["createApp"]>>["app"];
  let directory: string;
  let config: Config;
  let token: string;
  let attachmentCalls = 0;
  let samplePdf: Uint8Array;

  beforeAll(async () => {
    await authority.start();
    directory = await mkdtemp(join(tmpdir(), "openmuse-enterprise-oauth-"));
    db = await createStore({ dataDir: join(directory, "data") });
    config = {
      mode: "live",
      host: "127.0.0.1",
      port: 8787,
      publicUrl: "http://localhost:8787",
      dataDir: directory,
      agentBackend: "model",
      intelligenceApiKey: "test-intelligence-key",
      googleClientId: "synthetic-client",
      googleClientSecret: "synthetic-secret",
      googleRedirectUri: "http://localhost:8787/api/google/callback",
      encryptionKey: randomBytes(32).toString("base64"),
      allowedOrigins: ["http://localhost:8081"],
      authMode: "enterprise",
      openbotAuthorityOrigin: authority.origin,
      openbotClientId: BFF.clientId,
      openbotBffServiceId: BFF.bffServiceId,
      openbotBffServiceSecret: BFF.bffServiceSecret,
    };
    samplePdf = await createSamplePdf();
    // `bun test` cannot statically import app.ts's CopilotKit runtime graph
    // (a CJS dependency requires an async ESM module); the deployed node
    // runtime performs the same dynamic load.
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
    // The provider stand-in: only Google's own origins are answered here; the
    // authority's real local server calls pass through untouched.
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith("https://oauth2.googleapis.com/token"))
        return Response.json({
          access_token: "google-access",
          refresh_token: "google-refresh",
          expires_in: 3600,
          scope:
            "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.events.readonly",
        });
      if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/profile"))
        return Response.json({ emailAddress: "person@example.com" });
      if (url.startsWith("https://oauth2.googleapis.com/revoke"))
        return new Response(null, { status: 200 });
      const attachment = /\/messages\/[^/]+\/attachments\/[^/?]+/.exec(url);
      if (attachment) {
        attachmentCalls += 1;
        return Response.json({
          data: Buffer.from(samplePdf).toString("base64url"),
          size: samplePdf.byteLength,
        });
      }
      return realFetch(input, init);
    }) as typeof fetch;
  }, 120_000);

  afterAll(async () => {
    globalThis.fetch = realFetch;
    await db.close();
    await rm(directory, { recursive: true, force: true });
    await authority.stop();
  }, 120_000);

  function authHeaders(tenant: typeof ACME | typeof GLOBEX = ACME): Record<string, string> {
    return { Authorization: `Bearer ${token}`, ...SELECTOR_HEADERS(tenant) };
  }

  async function connectGoogle(): Promise<string> {
    const response = await app.request("/api/google/connect", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ capability: "read" }),
    });
    expect(response.status).toBe(200);
    const url = ((await response.json()) as { url: string }).url;
    const state = new URL(url).searchParams.get("state");
    if (!state) throw new Error("connect did not return a state");
    return state;
  }

  test("changed_account_or_scope_cannot_consume_google_oauth_intent", async () => {
    authority.reset();
    const scopeState = await connectGoogle();
    // The scope the intent fixed is no longer the scope the session admits.
    authority.scopeOverride = { ...GLOBEX };
    const changedScope = await app.request(
      `/api/google/callback?state=${encodeURIComponent(scopeState)}&code=code-2`,
    );
    expect(changedScope.status).toBe(401);
    expect(((await changedScope.json()) as { code: string }).code).toBe("ACCOUNT_CHANGED");
    expect(await new GoogleAuth(db, config).tokens(ACME_OWNER)).toBeNull();

    authority.reset();
    const accountState = await connectGoogle();
    // The original BA account/principal changed behind the same handle.
    authority.actor = { userId: "user-2", principalId: "principal-2" };
    const changedAccount = await app.request(
      `/api/google/callback?state=${encodeURIComponent(accountState)}&code=code-3`,
    );
    expect(changedAccount.status).toBe(401);
    expect(((await changedAccount.json()) as { code: string }).code).toBe("ACCOUNT_CHANGED");

    // The refused state is consumed: it cannot be replayed after the account
    // is restored, and neither attempt bound a Google connection.
    authority.reset();
    const replay = await app.request(
      `/api/google/callback?state=${encodeURIComponent(accountState)}&code=code-4`,
    );
    expect(replay.status).toBe(400);
    const boundConnection = await new GoogleAuth(db, config).tokens(ACME_OWNER);
    expect(boundConnection).toBeNull();
  }, 60_000);

  test("google_oauth_callback_binds_the_original_intent_once", async () => {
    authority.reset();
    const state = await connectGoogle();
    const before = attachmentCalls;
    const callback = await app.request(
      `/api/google/callback?state=${encodeURIComponent(state)}&code=code-5`,
    );
    expect(callback.status).toBe(200);
    expect(await callback.text()).toContain("Google is connected");
    const bound = await new GoogleAuth(db, config).tokens(ACME_OWNER);
    expect(bound?.account).toBe("person@example.com");
    expect(await new GoogleAuth(db, config).tokens(GLOBEX_OWNER)).toBeNull();
    // The callback re-admitted the fixed intent online before the token was
    // stored; it never used an active session or a body-supplied owner.
    const callbackAdmission = authority.admissions.at(-1);
    expect(callbackAdmission?.operation).toBe("workspace.read");
    expect(callbackAdmission?.resourceId).toBe("google:connection");
    expect(callbackAdmission?.tenantId).toBe(ACME.tenantId);
    expect(callbackAdmission?.workspaceId).toBe(ACME.workspaceId);
    expect(attachmentCalls).toBe(before);
    // A copied, already-consumed state is a late state and never rebinds.
    const replay = await app.request(
      `/api/google/callback?state=${encodeURIComponent(state)}&code=code-6`,
    );
    expect(replay.status).toBe(400);
    const disconnected = await app.request("/api/google/disconnect", {
      method: "POST",
      headers: authHeaders(),
    });
    expect(disconnected.status).toBe(200);
    expect(await new GoogleAuth(db, config).tokens(ACME_OWNER)).toBeNull();
  }, 60_000);

  test("unknown_late_state_and_unknown_method_are_refused", async () => {
    authority.reset();
    const unknown = await app.request("/api/google/callback?state=unknown&code=code-7");
    expect(unknown.status).toBe(400);
    const wrongMethod = await app.request("/api/google/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "unknown", code: "code-8" }),
    });
    expect(wrongMethod.status).toBe(404);
    expect(((await wrongMethod.json()) as { code: string }).code).toBe("RESOURCE_NOT_FOUND");

    const state = await connectGoogle();
    const stored = await db.get<Record<string, unknown>>("system", "oauth", state);
    if (!stored) throw new Error("connect did not persist its state");
    await db.put<{ id: string; expiresAt: number } & Record<string, unknown>>("system", "oauth", {
      ...stored,
      id: state,
      expiresAt: Date.now() - 1,
    });
    const late = await app.request(
      `/api/google/callback?state=${encodeURIComponent(state)}&code=code-9`,
    );
    expect(late.status).toBe(400);
    expect(await new GoogleAuth(db, config).tokens(ACME_OWNER)).toBeNull();
  }, 60_000);

  test("bff_attachment_import_rechecks_source_authorization", async () => {
    authority.reset();
    const connectionId = "connection-1";
    const tokens = {
      connectionId,
      accessToken: "google-access",
      refreshToken: "google-refresh",
      expiresAt: Date.now() + 3600_000,
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      account: "person@example.com",
    };
    await db.put(ACME_OWNER, "credentials", {
      id: "google",
      generation: randomUUID(),
      connectionId,
      secret: encryptSecret(JSON.stringify(tokens), config.encryptionKey as string),
    });
    const first = "mail-1:att-1:attachment.pdf";
    const second = "mail-1:att-2:second.pdf";
    await db.put(ACME_OWNER, "mail", mailRow("mail-1", [first, second]));

    attachmentCalls = 0;
    const imported = await app.request("/api/mail/import-attachment", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ reference: first }),
    });
    expect(imported.status).toBe(201);
    const artifact = (await imported.json()) as Artifact;
    expect(artifact.url).toBe(`${config.publicUrl}/api/files/${artifact.id}/content`);
    expect(artifact.url).not.toContain("signature");
    expect(artifact.source).toBe("Gmail · mail-1 subject");
    expect(await db.get<Artifact>(ACME_OWNER, "files", artifact.id)).not.toBeNull();
    expect(await db.get<Artifact>(GLOBEX_OWNER, "files", artifact.id)).toBeNull();
    // The source the import reads is the one bound onto the admission.
    expect(authority.admissions.at(-1)?.operation).toBe("workspace.read");
    expect(authority.admissions.at(-1)?.resourceId).toBe(`mail-attachment:${first}`);
    expect(attachmentCalls).toBe(1);

    // Revocation committed before the next import: the guard refuses it
    // online and zero attachment fetches reach Google.
    attachmentCalls = 0;
    authority.revoked = true;
    const revoked = await app.request("/api/mail/import-attachment", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ reference: second }),
    });
    expect(revoked.status).toBe(401);
    expect(((await revoked.json()) as { code: string }).code).toBe("SESSION_REVOKED");
    const importCallsAfterRevoke = attachmentCalls;
    expect(importCallsAfterRevoke).toBe(0);
    authority.reset();
  }, 60_000);

  test("file_upload_and_fill_keep_the_online_contract_and_original_owner", async () => {
    authority.reset();
    const uploaded = await app.request("/api/files", {
      method: "POST",
      headers: authHeaders(),
      body: (() => {
        const form = new FormData();
        const bytes = new Uint8Array(samplePdf);
        form.set(
          "file",
          new File([bytes.buffer as ArrayBuffer], "uploaded.pdf", { type: "application/pdf" }),
        );
        return form;
      })(),
    });
    expect(uploaded.status).toBe(201);
    const file = (await uploaded.json()) as Artifact;
    expect(file.url).toBe(`${config.publicUrl}/api/files/${file.id}/content`);
    expect(file.url).not.toContain("signature");
    expect(await db.get<Artifact>(ACME_OWNER, "files", file.id)).not.toBeNull();
    expect(await db.get<Artifact>(GLOBEX_OWNER, "files", file.id)).toBeNull();

    const filled = await app.request(`/api/files/${file.id}/fill`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { participant_name: "Ada Lovelace" } }),
    });
    expect(filled.status).toBe(201);
    const generated = (await filled.json()) as Artifact;
    expect(generated.parentId).toBe(file.id);
    expect(generated.url).toBe(`${config.publicUrl}/api/files/${generated.id}/content`);
    expect(await db.get<Artifact>(ACME_OWNER, "files", generated.id)).not.toBeNull();
    expect(authority.admissions.at(-1)?.operation).toBe("file.read");
    expect(authority.admissions.at(-1)?.resourceId).toBe(`file:${file.id}`);

    // A revoked authority refuses the next generation before the source file
    // is read or a child artifact is written.
    const before = (await db.list<Artifact>(ACME_OWNER, "files")).length;
    authority.revoked = true;
    const refused = await app.request(`/api/files/${file.id}/fill`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { participant_name: "Grace Hopper" } }),
    });
    expect(refused.status).toBe(401);
    expect((await db.list<Artifact>(ACME_OWNER, "files")).length).toBe(before);
    authority.reset();
  }, 60_000);

  test("enterprise_app_factory_serves_the_same_oauth_and_file_routes", async () => {
    authority.reset();
    const mirror = await createEnterpriseApp(db, config, {});
    const session = await mirror.request("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authMode: "enterprise",
        intentId: "intent-2",
        code: "code-mirror",
        codeVerifier: "b".repeat(43),
        redirectUri: "openmuse://callback",
      }),
    });
    expect(session.status).toBe(200);
    const mirrorToken = ((await session.json()) as { token: string }).token;
    // The callback is mounted ahead of the guard and still consumes/refuses a
    // state rather than falling through to the unknown-route 404.
    const callback = await mirror.request("/api/google/callback?state=missing&code=code-mirror");
    expect(callback.status).toBe(400);
    const bytes = new Uint8Array(samplePdf);
    const form = new FormData();
    form.set(
      "file",
      new File([bytes.buffer as ArrayBuffer], "mirror.pdf", { type: "application/pdf" }),
    );
    const uploaded = await mirror.request("/api/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${mirrorToken}`, ...SELECTOR_HEADERS(ACME) },
      body: form,
    });
    expect(uploaded.status).toBe(201);
    const artifact = (await uploaded.json()) as Artifact;
    expect(artifact.url).toBe(`${config.publicUrl}/api/files/${artifact.id}/content`);
  }, 60_000);
});
