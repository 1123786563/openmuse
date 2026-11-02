import { randomUUID } from "node:crypto";
import { MessageSchema } from "@ag-ui/core";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { z } from "zod";
import type {
  ActionProposal,
  ActivityEntry,
  Artifact,
  BrowserSession,
  CalendarEvent,
  Connection,
  Mail,
  Workspace,
} from "../../../packages/domain/src/index.ts";
import {
  calendarRangeSchema,
  emailDraftSchema,
  proposalSchema,
} from "../../../packages/domain/src/index.ts";
import { ActionService } from "./actions.ts";
import { createAuth } from "./auth.ts";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";
import { Files } from "./files.ts";
import { GoogleAuth } from "./google-auth.ts";
import { rateLimit } from "./rate-limit.ts";
import { WorkspaceService } from "./workspace.ts";

/*
 * T07.05 (#595, original task P17; BA interfaces §5.2): the enterprise BFF.
 *
 * An enterprise deployment keeps this OpenMuse server but replaces its
 * standalone credential half (access key, "local-user" owner, sample seed)
 * with the OpenBot authority: the mobile app hands over the frozen
 * EnterpriseSessionInput, this server exchanges the one-time code with the
 * registered service credential, and every later request presents the opaque
 * session handle. The handle is never accepted as an owner key, never stored
 * in the clear server-side, and every business request is admitted online —
 * one authorize call per request, no positive caching between requests.
 *
 * GET /api/workspace answers with the ORIGINAL Workspace contract populated
 * from this server's real store, scoped to the authorized
 * company/team/principal namespace. The OpenBot /api/mobile/workspace
 * response is a different contract and is never assigned, cast or passed
 * through here.
 *
 * The production OpenBotAuthorityClient calls the real
 * POST /api/enterprise/mobile/session/{exchange,authorize} routes (T05.12 /
 * T05.13). The seam is an interface so tests can pin this server's half of
 * the contract without a live OpenBot; nothing else in the server sees the
 * difference.
 */

/** The frozen request of POST /api/session (BA interfaces §5.2). */
export interface EnterpriseSessionInput {
  readonly authMode: "enterprise";
  readonly intentId: string;
  readonly code: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
}

/** The frozen response of POST /api/session (BA interfaces §5.2). */
export interface EnterpriseSessionResponse {
  readonly token: string;
  readonly mode: "live";
  readonly authMode: "enterprise";
  readonly authority: string;
  readonly expiresAt: string;
  readonly user: Readonly<{ id: string; principalId: string | null }>;
  readonly scope: null;
}

/** The per-action admission the OpenBot authorize route answers with. */
export interface EnterpriseAdmission {
  readonly actor: Readonly<{
    userId: string;
    principalId: string | null;
    identityGeneration: number | null;
  }>;
  readonly scope:
    | Readonly<{ tenantId: string; workspaceId: null }>
    | Readonly<{
        tenantId: string;
        workspaceId: string;
        capabilities: readonly string[];
      }>
    | null;
  readonly admissionId: string;
  readonly operation: string;
  readonly resourceId: string | null;
}

/** The stable company/team selection an enterprise request names as its intent. */
export interface EnterpriseScopeSelector {
  readonly tenantId: string;
  readonly workspaceId: string;
}

/**
 * The OpenBot authority seam (T05.12/T05.13 consumed): exchange mints the
 * handle through the authority, and admission re-runs online for EVERY
 * business request. An implementation must never cache a positive decision
 * and must never accept a client-asserted actor.
 */
export interface OpenbotAuthority {
  /** The deployment-controlled authority origin answers appear under. */
  readonly authorityOrigin: string;
  exchange(input: EnterpriseSessionInput): Promise<EnterpriseSessionResponse>;
  admission(
    handle: string,
    selector: EnterpriseScopeSelector,
    operation: string,
  ): Promise<EnterpriseAdmission>;
}

/**
 * The error taxonomy the enterprise surface answers with, mapped onto the
 * frozen MobileBffError shape { error, code, requestId }.
 */
export const ENTERPRISE_REFUSAL_STATUS: Readonly<Record<string, 400 | 401 | 403 | 404 | 503>> =
  Object.freeze({
    INVALID_REQUEST: 400,
    SCOPE_REQUIRED: 400,
    SCOPE_SELECTOR_CONFLICT: 400,
    SESSION_EXPIRED: 401,
    SESSION_REVOKED: 401,
    ACCOUNT_CHANGED: 401,
    BFF_CREDENTIAL_REQUIRED: 401,
    BFF_CREDENTIAL_INVALID: 401,
    CLIENT_ASSERTED_ACTOR: 403,
    ADMISSION_REUSED: 403,
    COMPANY_REAUTH_REQUIRED: 403,
    IDENTITY_DISABLED: 403,
    RESOURCE_NOT_FOUND: 404,
    AUTHORITY_UNAVAILABLE: 503,
  });

/** The one wire error this surface ever answers with. */
export interface MobileBffError {
  readonly error: "Request refused.";
  readonly code: string;
  readonly requestId: string;
}

/** The operations this task wires; unknown routes never fall back to standalone auth. */
export const ENTERPRISE_OPERATIONS = {
  workspaceRead: "workspace.read",
  /**
   * T07.06 (#596): the CopilotKit stream and the run surface it drives. The
   * authority's frozen admissible list (T05.13 / OpenBot
   * `MOBILE_ADMISSIBLE_OPERATIONS`) names this one operation for the whole
   * run: every new model dispatch and every new tool action asks again, with a
   * fresh requestId, and nothing positive is cached between them.
   */
  copilotkitInvoke: "copilotkit.invoke",
} as const;

/** The original /api/calendar/events query the standalone app accepts. */
const calendarQuery = z.object({
  calendarId: z.string().min(1).max(1024).optional(),
  timeMin: z.iso.datetime({ offset: true }).optional(),
  timeMax: z.iso.datetime({ offset: true }).optional(),
});

interface ContentRouteRule {
  test: (path: string, method: string) => boolean;
  /**
   * Reads answer `workspace.read`; writes and approvals answer the same
   * frozen team-scoped word: the authority re-checks the actor and the
   * company/team selection on every single request either way.
   */
  operation: "workspace.read";
}

/**
 * T07.17 (#607): the mail/calendar/drafts/conversation/approval surfaces this
 * BFF answers for an enterprise supply, each named with the action class its
 * routes perform. The operation words are the authority's frozen admissible
 * list (`MOBILE_ADMISSIBLE_OPERATIONS`, interfaces §5.2): every content read
 * and every workspace-scoped write/approval asks `workspace.read` online, one
 * admission per request; no new operation word is invented here.
 */
const CONTENT_ROUTES: readonly ContentRouteRule[] = [
  {
    test: (path) => path === "/api/calendars" || path === "/api/calendar/events",
    operation: "workspace.read",
  },
  { test: (path) => /^\/api\/mail\/threads\/[^/]+$/.test(path), operation: "workspace.read" },
  {
    test: (path, method) => path === "/api/drafts" && method === "GET",
    operation: "workspace.read",
  },
  {
    test: (path, method) => path === "/api/drafts" && method === "POST",
    operation: "workspace.read",
  },
  {
    test: (path, method) => path === "/api/conversation" && method === "GET",
    operation: "workspace.read",
  },
  {
    test: (path, method) => path === "/api/conversation" && method === "PUT",
    operation: "workspace.read",
  },
  {
    test: (path, method) => path === "/api/actions" && method === "POST",
    operation: "workspace.read",
  },
  {
    test: (path, method) => /^\/api\/actions\/[^/]+\/decide$/.test(path) && method === "POST",
    operation: "workspace.read",
  },
];

/**
 * The one admission operation a request path/method maps to, or null when the
 * route is not one this BFF wired for the enterprise supply.
 */
export function enterpriseOperationFor(path: string, method: string): string | null {
  if (path === "/api/workspace") return ENTERPRISE_OPERATIONS.workspaceRead;
  const isRunSurface =
    path === "/api/copilotkit" ||
    path.startsWith("/api/copilotkit/") ||
    path === "/api/agent" ||
    path.startsWith("/api/agent/");
  if (isRunSurface) return ENTERPRISE_OPERATIONS.copilotkitInvoke;
  for (const route of CONTENT_ROUTES) if (route.test(path, method)) return route.operation;
  return null;
}

const SELECTOR_HEADER_TENANT = "x-openbot-tenant";
const SELECTOR_HEADER_WORKSPACE = "x-openbot-workspace";

/** The enterprise principal's record owner namespace: per-resource isolation. */
export function enterpriseOwner(
  selector: EnterpriseScopeSelector,
  actor: { principalId: string | null },
): string {
  // The principal is the isolation unit. A not-yet-onboarded actor has no
  // workspace namespace to read, so the caller refuses before reaching here.
  if (!actor.principalId) throw AppError.fromCode("COMPANY_REAUTH_REQUIRED", 403);
  return `enterprise:${selector.tenantId}:${selector.workspaceId}:${actor.principalId}`;
}

/**
 * The production authority client: the registered BFF service credential over
 * the deployment-controlled OpenBot origin. The origin is config, never a
 * request header, and no caller-named authority is ever read.
 */
export function createOpenbotAuthority(config: Config): OpenbotAuthority {
  const authorityOrigin = config.openbotAuthorityOrigin;
  const serviceId = config.openbotBffServiceId;
  const serviceSecret = config.openbotBffServiceSecret;
  if (!authorityOrigin || !serviceId || !serviceSecret)
    throw new Error(
      "ENTERPRISE_AUTH_MODE=enterprise requires OPENBOT_AUTHORITY_ORIGIN, OPENBOT_BFF_SERVICE_ID and OPENBOT_BFF_SERVICE_SECRET",
    );
  const credential = `Basic ${Buffer.from(`${serviceId}:${serviceSecret}`).toString("base64")}`;

  const post = async <T>(path: string, body: unknown): Promise<T> => {
    let response: Response;
    try {
      response = await fetch(`${authorityOrigin}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: credential },
        body: JSON.stringify(body),
      });
    } catch {
      throw AppError.fromCode("AUTHORITY_UNAVAILABLE", 503);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw AppError.fromCode("AUTHORITY_UNAVAILABLE", 503);
    }
    if (response.status !== 200) {
      const supplied = (payload as { code?: unknown } | null)?.code;
      const code =
        typeof supplied === "string" && supplied in ENTERPRISE_REFUSAL_STATUS
          ? supplied
          : "AUTHORITY_UNAVAILABLE";
      throw AppError.fromCode(code, ENTERPRISE_REFUSAL_STATUS[code]);
    }
    return payload as T;
  };

  return {
    authorityOrigin,
    exchange: (input) =>
      post<EnterpriseSessionResponse>("/api/enterprise/mobile/session/exchange", input),
    admission: (handle, selector, operation) =>
      post<EnterpriseAdmission>("/api/enterprise/mobile/session/authorize", {
        handle,
        requestId: randomUUID(),
        selectors: { tenantId: selector.tenantId, workspaceId: selector.workspaceId },
        operation,
      }),
  };
}

/**
 * POST /api/session for the enterprise supply: the frozen
 * EnterpriseSessionInput only. An accessKey body, an owner key or any other
 * standalone credential shape is refused before the authority is called —
 * the enterprise surface has no standalone fallback.
 */
export function enterpriseSessionHandler(authority: OpenbotAuthority) {
  return async (context: Context) => {
    let body: Record<string, unknown>;
    try {
      body = (await context.req.json()) as Record<string, unknown>;
    } catch {
      throw AppError.fromCode("INVALID_REQUEST", 400);
    }
    const enterpriseShape =
      body.authMode === "enterprise" &&
      typeof body.intentId === "string" &&
      typeof body.code === "string" &&
      typeof body.codeVerifier === "string" &&
      typeof body.redirectUri === "string";
    if (!enterpriseShape || "accessKey" in body) throw AppError.fromCode("INVALID_REQUEST", 400);
    const session = await authority.exchange({
      authMode: "enterprise",
      intentId: body.intentId as string,
      code: body.code as string,
      codeVerifier: body.codeVerifier as string,
      redirectUri: body.redirectUri as string,
    });
    // The handle is opaque to this server and never stored in the clear.
    return context.json(
      { ...session, authority: authority.authorityOrigin } satisfies EnterpriseSessionResponse,
      200,
    );
  };
}

/**
 * The enterprise request gate: Bearer handle + explicit selection headers,
 * and ONE online admission for this request before any store read. The
 * admitted facts ride the request context; the actor is the authority's
 * answer, never the client's. Routes this BFF has not wired for the
 * enterprise supply are refused — they never fall back to the standalone
 * owner authentication.
 */
export function enterpriseGuard(_config: Config, authority: OpenbotAuthority): MiddlewareHandler {
  return async (context, next) => {
    const path = context.req.path;
    const operation = enterpriseOperationFor(path, context.req.method);
    if (!operation) throw AppError.fromCode("RESOURCE_NOT_FOUND", 404);
    const authorization = context.req.header("authorization");
    if (!authorization?.startsWith("Bearer ")) throw AppError.fromCode("SESSION_EXPIRED", 401);
    const handle = authorization.slice(7);
    const tenantId =
      context.req.header(SELECTOR_HEADER_TENANT) ??
      new URL(context.req.url).searchParams.get("tenantId") ??
      "";
    const workspaceId =
      context.req.header(SELECTOR_HEADER_WORKSPACE) ??
      new URL(context.req.url).searchParams.get("workspaceId") ??
      "";
    if (!tenantId || !workspaceId) throw AppError.fromCode("SCOPE_REQUIRED", 400);
    const selector = { tenantId, workspaceId };
    const admission = await authority.admission(handle, selector, operation);
    // The admitted scope must echo the request's one intent exactly.
    if (
      admission.scope?.tenantId !== selector.tenantId ||
      admission.scope.workspaceId !== selector.workspaceId
    )
      throw AppError.fromCode("SCOPE_SELECTOR_CONFLICT", 400);
    context.set("enterpriseAdmission", admission);
    // Downstream handlers consume the server-admitted owner namespace, never
    // a client-supplied identity (T07.06: the run surfaces read this value).
    context.set("owner", enterpriseOwner(selector, admission.actor));
    await next();
  };
}

/** The admitted scope facts the workspace projection consumes. */
export interface EnterpriseRequestFacts {
  selector: EnterpriseScopeSelector;
  principalId: string;
  userId: string;
  admissionId: string;
}

/** Read the admitted facts the guard put on the request. */
export function enterpriseFacts(context: Context): EnterpriseRequestFacts {
  const admission = context.get("enterpriseAdmission") as EnterpriseAdmission | undefined;
  if (!admission) throw AppError.fromCode("AUTHORITY_UNAVAILABLE", 503);
  return {
    selector: {
      tenantId: admission.scope?.tenantId ?? "",
      workspaceId: admission.scope?.workspaceId ?? "",
    },
    principalId: admission.actor.principalId ?? "",
    userId: admission.actor.userId,
    admissionId: admission.admissionId,
  };
}

/**
 * T07.06 (#596): the SERVER-FIXED run context.
 *
 * One CopilotKit stream answers to exactly one actor, Run, company/team scope
 * and payer, all derived from the authority's admission answer — never from
 * the request body, the AG-UI `context` entries or `forwardedProps`. The
 * runtime adapter hands this value to the agent and to the scoped execution
 * adapters (tool actions); the client's own claims never reach either.
 */
export interface EnterpriseRunContext {
  /** The record-owner namespace every scoped store call uses. */
  readonly owner: string;
  readonly userId: string;
  readonly principalId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  /** The server-fixed payer reference: the admitted company, never a body value. */
  readonly payer: string;
  /** One server-minted id per stream; never carried over between requests. */
  readonly runId: string;
}

/** Derive the frozen run context from ONE admitted answer. */
export function enterpriseRunContext(
  admission: EnterpriseAdmission,
  selector: EnterpriseScopeSelector,
  runId: string,
): EnterpriseRunContext {
  if (!admission.scope || admission.actor.principalId === null)
    throw AppError.fromCode("COMPANY_REAUTH_REQUIRED", 403);
  return Object.freeze({
    owner: enterpriseOwner(selector, admission.actor),
    userId: admission.actor.userId,
    principalId: admission.actor.principalId,
    tenantId: selector.tenantId,
    workspaceId: selector.workspaceId,
    // T07.01: the payer is the admitted company's reference. The client body
    // (AG-UI context/forwardedProps) never names it.
    payer: `company:${selector.tenantId}`,
    runId,
  });
}

/** The one controlled error payload a refused bridge answers with. */
export function mobileBffError(code: string, requestId: string = randomUUID()): MobileBffError {
  return { error: "Request refused.", code, requestId };
}

/** A stream refusal: the code travels to the SSE error event, not a stack. */
export class EnterpriseStreamRefusal extends Error {
  constructor(readonly code: string) {
    super(`enterprise stream refused: ${code}`);
    this.name = "EnterpriseStreamRefusal";
  }
}

/**
 * ONE stream's live admission. Every new model dispatch and every new tool
 * action awaits `authorize*` immediately before it happens: a fresh online
 * admission, one per action, no positive result carried to the next action.
 * A refusal aborts the stream so later actions cannot start, and carries the
 * MobileBffError code the terminated stream reports.
 */
export interface EnterpriseActionGate {
  readonly context: EnterpriseRunContext;
  /** Aborted exactly when an action was refused; the runtime stops on it. */
  readonly canceled: AbortSignal;
  /** The code of the refusal that canceled the stream, when there was one. */
  refusalCode(): string | null;
  authorizeModel(): Promise<void>;
  authorizeTool(name: string): Promise<void>;
}

/**
 * Build one stream gate. The first model dispatch is authorized through the
 * admission this factory performs; every later model/tool action asks again.
 */
export async function createEnterpriseActionGate(
  authority: OpenbotAuthority,
  handle: string,
  selector: EnterpriseScopeSelector,
  runId: string = randomUUID(),
): Promise<EnterpriseActionGate> {
  const controller = new AbortController();
  let refusal: string | null = null;
  const admit = async (): Promise<EnterpriseAdmission> => {
    let admission: EnterpriseAdmission;
    try {
      admission = await authority.admission(
        handle,
        selector,
        ENTERPRISE_OPERATIONS.copilotkitInvoke,
      );
    } catch (error) {
      refusal = error instanceof AppError && error.code ? error.code : "AUTHORITY_UNAVAILABLE";
      controller.abort();
      throw new EnterpriseStreamRefusal(refusal);
    }
    // The authority must echo this stream's one intent; a mismatch ends it.
    if (
      admission.scope?.tenantId !== selector.tenantId ||
      admission.scope.workspaceId !== selector.workspaceId
    ) {
      refusal = "SCOPE_SELECTOR_CONFLICT";
      controller.abort();
      throw new EnterpriseStreamRefusal(refusal);
    }
    return admission;
  };
  const first = await admit();
  if (controller.signal.aborted) throw new EnterpriseStreamRefusal(refusal ?? "SESSION_REVOKED");
  const context = enterpriseRunContext(first, selector, runId);
  return {
    context,
    canceled: controller.signal,
    refusalCode: () => refusal,
    authorizeModel: async () => void (await admit()),
    authorizeTool: async () => void (await admit()),
  };
}

/** The two explicit selection headers, exported once for the runtime adapter. */
export const ENTERPRISE_SELECTOR_HEADERS = {
  tenant: SELECTOR_HEADER_TENANT,
  workspace: SELECTOR_HEADER_WORKSPACE,
} as const;

/**
 * Derive the handle and selector a CopilotKit request carries. This is
 * deployment-defined wire input (Bearer handle + the two explicit selection
 * headers), never the AG-UI body.
 */
export function enterpriseRequestSelection(request: Request): {
  handle: string;
  selector: EnterpriseScopeSelector;
} | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const tenantId = request.headers.get(ENTERPRISE_SELECTOR_HEADERS.tenant) ?? "";
  const workspaceId = request.headers.get(ENTERPRISE_SELECTOR_HEADERS.workspace) ?? "";
  if (!tenantId || !workspaceId) return null;
  return { handle: authorization.slice(7), selector: { tenantId, workspaceId } };
}

/**
 * The enterprise Workspace projection (BA interfaces §5.2 field table), read
 * from THIS namespace's scoped store. The batch answer is the ORIGINAL
 * Workspace contract: mode is fixed live, profile never comes from an
 * accessKey or the sample/local-user seed, content URLs are the BFF's own
 * online proxy path (never a public signed storage link), connections expose
 * public capabilities only, and runtime.provider is openbot with configured
 * from the actual enterprise execution readiness — this request could only
 * reach here after an online admission, so the adapter really answered.
 */
export async function enterpriseWorkspaceSnapshot(
  db: Store,
  config: Config,
  owner: string,
  query?: string,
): Promise<Workspace> {
  const mail = await db.list<Mail>(owner, "mail");
  const events = await db.list<CalendarEvent>(owner, "events");
  const files = await db.list<Artifact>(owner, "files");
  const browsers = await db.list<BrowserSession>(owner, "browsers");
  const actions = await db.list<ActionProposal>(owner, "actions");
  const activity = await db.list<ActivityEntry>(owner, "activity");
  // The namespace's own connection facts; a token is never returned here.
  const tokens = config.mode === "live" ? await new GoogleAuth(db, config).tokens(owner) : null;
  const words = (query ?? "").toLowerCase().trim().split(/\s+/).filter(Boolean);
  const visibleMail = words.length
    ? mail.filter((message) =>
        words.every((word) =>
          `${message.sender} ${message.subject} ${message.body}`.toLowerCase().includes(word),
        ),
      )
    : mail;
  const connections: Connection[] = [
    {
      id: "google",
      name: "Google",
      status: tokens ? "connected" : "disconnected",
      account: tokens?.account,
      capabilities: tokens?.scopes ?? [],
    },
    {
      id: "browser",
      name: "Browser",
      status: config.workerUrl && config.workerToken ? "connected" : "unconfigured",
      capabilities: ["Persistent sessions", "PDF downloads"],
    },
    {
      id: "openbot",
      name: "OpenBot",
      status: "connected",
      capabilities: ["Enterprise execution adapter"],
    },
  ];
  return {
    mode: "live",
    profile: {
      // The frozen authority DTOs carry the BA user's ids, not a display name
      // or email; this neutral live label and the namespace's own bound
      // account are used, never an accessKey or a sample/local-user seed.
      name: "You",
      email: tokens?.account ?? "",
    },
    mail: visibleMail.sort((a, b) => b.date.localeCompare(a.date)),
    events: events.sort((a, b) => a.start.localeCompare(b.start)),
    // Content URLs are the BFF's own online proxy path; the proxy route
    // itself belongs to P17's media task (T07.07), so no standalone signed
    // storage link ever appears here.
    files: files.map((file) => ({
      ...file,
      url: `${config.publicUrl}/api/files/${file.id}/content`,
    })),
    // Browser preview/console need the online ticket path (T07.13), not the
    // standalone signed URLs.
    browsers: browsers.map((session) => {
      const { previewUrl: _preview, consoleUrl: _console, ...rest } = session;
      return rest;
    }),
    actions,
    activity,
    connections,
    runtime: {
      provider: "openbot",
      configured: true,
      openbotConfigured: true,
      // Rich Threads is served by the enterprise execution stream (T07.06).
      richThreads: true,
    },
  };
}

/**
 * Mount the enterprise supply on a Hono app: the session exchange (its own
 * one-time code, never an accessKey), the per-request gate for everything
 * registered afterwards, and the original-Workspace read. app.ts mounts this
 * exact function, and the suite drives the same one.
 */
export function mountEnterpriseRoutes<
  Env extends {
    Variables: { enterpriseAdmission: EnterpriseAdmission; owner: string };
  },
>(
  app: Hono<Env>,
  deps: { db: Store; config: Config; authority: OpenbotAuthority } & {
    workspace: WorkspaceService;
    actions: ActionService;
  },
): void {
  app.post("/api/session", enterpriseSessionHandler(deps.authority));
  app.use("/api/*", enterpriseGuard(deps.config, deps.authority));
  app.get("/api/workspace", async (context) => {
    const facts = enterpriseFacts(context);
    const owner = enterpriseOwner(facts.selector, { principalId: facts.principalId });
    return context.json(
      await enterpriseWorkspaceSnapshot(deps.db, deps.config, owner, context.req.query("q")),
      200,
    );
  });
  // T07.17 (#607): the content and approval surfaces keep their ORIGINAL
  // client wire schemas; only the credential half is replaced. Every route
  // below answers from the server-admitted namespace the guard put on the
  // context, so a cross-company id guess reads and writes only this
  // company/team/principal's rows.
  app.get("/api/calendars", async (context) =>
    context.json(await deps.workspace.calendars(context.get("owner"))),
  );
  app.get("/api/calendar/events", async (context) => {
    const query = calendarQuery.parse(context.req.query());
    if (query.timeMin && query.timeMax) calendarRangeSchema.parse(query);
    return context.json(await deps.workspace.events(context.get("owner"), query));
  });
  app.get("/api/mail/threads/:id", async (context) =>
    context.json(await deps.workspace.thread(context.get("owner"), context.req.param("id"))),
  );
  app.get("/api/drafts", async (context) =>
    context.json(await deps.db.list(context.get("owner"), "drafts")),
  );
  app.post("/api/drafts", async (context) => {
    const body = emailDraftSchema
      .extend({ id: z.string().uuid().optional() })
      .parse(await context.req.json());
    const existing = body.id
      ? await deps.db.get<{ createdAt: string }>(context.get("owner"), "drafts", body.id)
      : null;
    if (body.id && !existing) throw new AppError("Draft not found", 404);
    return context.json(
      await deps.db.put(context.get("owner"), "drafts", {
        ...body,
        id: body.id ?? randomUUID(),
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      }),
      201,
    );
  });
  app.get("/api/conversation", async (context) =>
    context.json(
      (await deps.db.get(context.get("owner"), "conversations", "default")) ?? {
        messages: [],
      },
    ),
  );
  app.put("/api/conversation", async (context) => {
    const body = (await context.req.json()) as { messages?: unknown };
    const messages = z.array(z.unknown()).max(1000).parse(body.messages);
    for (const message of messages) MessageSchema.parse(message);
    await deps.db.put(context.get("owner"), "conversations", { id: "default", messages });
    return context.json({ ok: true });
  });
  app.post("/api/actions", async (context) => {
    const input = proposalSchema.parse(await context.req.json());
    return context.json(await deps.actions.propose(context.get("owner"), input), 201);
  });
  app.post("/api/actions/:id/decide", async (context) => {
    const body = z
      .object({ hash: z.string(), decision: z.enum(["approve", "deny"]) })
      .parse(await context.req.json());
    return context.json(
      await deps.actions.decide(
        context.get("owner"),
        context.req.param("id"),
        body.hash,
        body.decision,
      ),
    );
  });
}

/**
 * The refusal an enterprise surface answers with for a controller error, or
 * null when the error is not one of the frozen taxonomy words. Both the
 * standalone app's error hook and the enterprise app below use it, so the
 * wire shape cannot drift between the two.
 */
export function enterpriseRefusalOf(error: unknown): {
  status: 400 | 401 | 403 | 404 | 503;
  body: MobileBffError;
} | null {
  if (!(error instanceof AppError) || !error.code) return null;
  const status = ENTERPRISE_REFUSAL_STATUS[error.code];
  if (!status) return null;
  return {
    status,
    body: { error: "Request refused.", code: error.code, requestId: randomUUID() },
  };
}

/**
 * The complete enterprise BFF app: the same deployment transport discipline
 * as the standalone app (trusted origins, no-store, CORS, body ceiling, rate
 * limit) around the enterprise supply. app.ts mounts THIS app when the mode
 * is enterprise, and the suite drives the same one.
 */
export async function createEnterpriseApp(
  db: Store,
  config: Config,
  options: {
    authority?: OpenbotAuthority;
    workspace?: WorkspaceService;
    actions?: ActionService;
  } = {},
): Promise<Hono<{ Variables: { enterpriseAdmission: EnterpriseAdmission; owner: string } }>> {
  if (config.mode === "sample")
    throw new Error("The enterprise supply never serves a sample workspace");
  // The real authority client unless a test injects its seam.
  const authority = options.authority ?? createOpenbotAuthority(config);
  // T07.17: the content surfaces answer through the same services the
  // standalone app builds — an enterprise deployment keeps this server, so
  // the original DTO behavior comes from the original services, only ever
  // called with the server-admitted namespace owner.
  const google = new GoogleAuth(db, config);
  const workspace =
    options.workspace ??
    new WorkspaceService(db, config, new Files(db, config, await createAuth(db, config)), google);
  const actions =
    options.actions ??
    new ActionService(db, {
      execute: (owner, input, connectionId, targetVersion) =>
        workspace.execute(owner, input, connectionId, targetVersion),
      prepare: (owner, input, connectionId) => workspace.prepare(owner, input, connectionId),
      connected: (owner) => workspace.connected(owner),
      connection: (owner) => workspace.connection(owner),
    });
  const app = new Hono<{
    Variables: { enterpriseAdmission: EnterpriseAdmission; owner: string };
  }>();
  const origins = new Set([...config.allowedOrigins, new URL(config.publicUrl).origin]);
  app.use("*", async (context, next) => {
    const origin = context.req.header("origin");
    if (origin && !origins.has(origin))
      return context.json({ error: "Origin is not allowed" }, 403);
    context.header("X-Content-Type-Options", "nosniff");
    context.header("Referrer-Policy", "no-referrer");
    context.header("Cache-Control", "no-store");
    await next();
  });
  app.use(
    "*",
    cors({
      origin: (origin) => (origins.has(origin) ? origin : undefined),
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
    }),
  );
  app.use(
    "*",
    bodyLimit({
      maxSize: 12 * 1024 * 1024,
      onError: (context) => context.json({ error: "Request is too large" }, 413),
    }),
  );
  app.use("/api/*", rateLimit(Boolean(config.trustProxy)));
  app.onError((error, context) => {
    const refusal = enterpriseRefusalOf(error);
    if (refusal) return context.json(refusal.body, refusal.status);
    // T07.17: the content surfaces keep their ORIGINAL client wire schema —
    // an AppError from the shared services answers with its own status and
    // message (a 404 for another namespace's id is the namespace boundary the
    // client sees), exactly as the standalone app answers it. Zod validation
    // stays 422. Everything else is a 502 without a stack or token bearing.
    if (error instanceof AppError) return context.json({ error: error.message }, error.status);
    if (error instanceof z.ZodError)
      return context.json({ error: error.issues.map((issue) => issue.message).join("; ") }, 422);
    if (error instanceof SyntaxError) return context.json({ error: "Invalid request data" }, 400);
    // Provider and document errors are useful, but raw stack traces and
    // token-bearing responses are not.
    console.error(`[OpenMuse enterprise] ${error.name}`);
    return context.json({ error: "Request failed. Check the server setup and try again." }, 502);
  });
  // The deployment probe carries no identity or tenant data.
  app.get("/api/health", (context) =>
    context.json({ ok: true, mode: config.mode, authMode: "enterprise" }),
  );
  mountEnterpriseRoutes(app, { db, config, authority, workspace, actions });
  return app;
}
