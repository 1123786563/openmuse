import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
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
/*
 * T07.07 (#597): the media seam's own services. files.ts, browser.ts and
 * auth.ts import nothing from this file, so the enterprise supply composes
 * them statically — the same services app.ts builds, over the same store.
 */
import { createAuth } from "./auth.ts";
import { BrowserService } from "./browser.ts";
import { browserConsole } from "./browser-console.ts";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";
import { Files } from "./files.ts";
import { GoogleAuth } from "./google-auth.ts";
import { rateLimit } from "./rate-limit.ts";

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
    resourceId?: string | null,
  ): Promise<EnterpriseAdmission>;
  /**
   * T07.07 (#597): the scope-free admission `scope.discover` performs — no
   * selectors ride the wire, mirroring the authority's own rule that
   * discovery works before any selection exists.
   */
  admissionDiscovery(handle: string, operation: string): Promise<EnterpriseAdmission>;
  /**
   * T07.07 (#597): the §4 scope listing, translated from the handle. The
   * authority decides eligibility; this server never reads an external
   * Cookie and never accepts a client-asserted actor.
   */
  scopeListing(handle: string): Promise<unknown>;
  /** T07.07 (#597): the §4 selection validation, translated from the handle. */
  validateSelection(handle: string, selector: EnterpriseScopeSelector): Promise<unknown>;
  /**
   * T07.07 (#597): the §5 additional-company-authentication challenge. The
   * original BA session the handle still binds is the one the challenge is
   * issued for — the client cannot name a subject.
   */
  companyChallenge(
    handle: string,
    input: { tenantId: string; returnPath: string },
  ): Promise<unknown>;
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
  /**
   * T07.07 (#597): minting one ≤60-second media locator ticket. The mint is
   * itself an online admission — the authority's own frozen operation word —
   * naming the resource the ticket will locate.
   */
  mediaTicket: "media.ticket",
  /**
   * T07.07 (#597): every new media read (request, Range or pull) re-admits
   * online under the authority's own `file.read` word, for the exact
   * resource being read.
   */
  fileRead: "file.read",
  /** T07.07 (#597): the §4 scope listing, through the authority's own word. */
  scopeDiscover: "scope.discover",
  /** T07.07 (#597): the §4 selection validation word. */
  scopeValidate: "scope.validate",
  /** T07.07 (#597): the §5 additional-company-authentication challenge word. */
  companyChallenge: "company.challenge",
} as const;

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
    admission: (handle, selector, operation, resourceId = null) =>
      post<EnterpriseAdmission>("/api/enterprise/mobile/session/authorize", {
        handle,
        requestId: randomUUID(),
        selectors: { tenantId: selector.tenantId, workspaceId: selector.workspaceId },
        operation,
        ...(resourceId !== null ? { resourceId } : {}),
      }),
    admissionDiscovery: (handle, operation) =>
      post<EnterpriseAdmission>("/api/enterprise/mobile/session/authorize", {
        handle,
        requestId: randomUUID(),
        operation,
      }),
    // T07.07 (#597): the three proxied surfaces speak the handle, so the
    // registered credential this client already carries is the whole
    // translation — the authority's own routes stay the decision makers.
    scopeListing: (handle) =>
      post<unknown>("/api/enterprise/workspace-scope", {
        handle,
        requestId: randomUUID(),
        operation: ENTERPRISE_OPERATIONS.scopeDiscover,
      }),
    validateSelection: (handle, selector) =>
      post<unknown>("/api/enterprise/workspace-scope/validate-selection", {
        handle,
        requestId: randomUUID(),
        operation: ENTERPRISE_OPERATIONS.scopeValidate,
        selectors: { tenantId: selector.tenantId, workspaceId: selector.workspaceId },
        tenantId: selector.tenantId,
        workspaceId: selector.workspaceId,
      }),
    companyChallenge: (handle, input) =>
      post<unknown>("/api/enterprise/company-auth/challenge", {
        handle,
        requestId: randomUUID(),
        operation: ENTERPRISE_OPERATIONS.companyChallenge,
        tenantId: input.tenantId,
        returnPath: input.returnPath,
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
 *
 * T07.07 (#597): the media surface joins the wired set. `POST
 * /api/media-tickets`, the file content route and the browser preview and
 * console routes each admit under their own frozen operation word, and the
 * media routes additionally accept the one-time locator ticket in place of
 * the Bearer handle (the ticket carries its own handle binding, so the same
 * online admission runs; see `enterpriseMediaTicketOf`).
 */
export function enterpriseGuard(
  _config: Config,
  authority: OpenbotAuthority,
  tickets: EnterpriseMediaTickets,
): MiddlewareHandler {
  return async (context, next) => {
    const path = context.req.path;
    const mediaRoute = enterpriseMediaRouteOf(path);
    const isWorkspace = path === "/api/workspace";
    const isRunSurface =
      path === "/api/copilotkit" ||
      path.startsWith("/api/copilotkit/") ||
      path === "/api/agent" ||
      path.startsWith("/api/agent/");
    const isMediaTicketMint = path === "/api/media-tickets" && context.req.method === "POST";
    const proxy = enterpriseProxyRouteOf(path, context.req.method);
    if (!isWorkspace && !isRunSurface && !mediaRoute && !isMediaTicketMint && !proxy)
      throw AppError.fromCode("RESOURCE_NOT_FOUND", 404);
    const authorization = context.req.header("authorization");
    const ticket =
      mediaRoute && !authorization?.startsWith("Bearer ")
        ? enterpriseMediaTicketOf(tickets, context.req.raw)
        : null;
    if (!authorization?.startsWith("Bearer ") && !ticket)
      throw AppError.fromCode("SESSION_EXPIRED", 401);
    const handle = ticket ? ticket.handle : (authorization as string).slice(7);
    const headerTenant =
      context.req.header(SELECTOR_HEADER_TENANT) ??
      new URL(context.req.url).searchParams.get("tenantId") ??
      "";
    const headerWorkspace =
      context.req.header(SELECTOR_HEADER_WORKSPACE) ??
      new URL(context.req.url).searchParams.get("workspaceId") ??
      "";
    // scope.discover runs before any selection exists; every other wired
    // surface names its one intent explicitly.
    const scopeFree = enterpriseProxyRouteOf(path, context.req.method)?.kind === "scope-listing";
    if (!scopeFree && (!headerTenant || !headerWorkspace)) {
      // A media ticket carries its own minted selection — a native reader
      // that cannot set headers locates the resource by the ticket alone.
      if (!ticket?.selector.tenantId || !ticket.selector.workspaceId)
        throw AppError.fromCode("SCOPE_REQUIRED", 400);
    }
    const selector = ticket
      ? {
          tenantId: headerTenant || ticket.selector.tenantId,
          workspaceId: headerWorkspace || ticket.selector.workspaceId,
        }
      : { tenantId: headerTenant, workspaceId: headerWorkspace };
    // A ticket may only locate the one resource and method it was minted
    // for, under the selection it was minted under — never a new one.
    if (ticket) {
      if (ticket.path !== path || ticket.method !== context.req.method)
        throw AppError.fromCode("INVALID_REQUEST", 400);
      if (
        ticket.selector.tenantId !== selector.tenantId ||
        ticket.selector.workspaceId !== selector.workspaceId
      )
        throw AppError.fromCode("SCOPE_SELECTOR_CONFLICT", 400);
    }
    const operation = isWorkspace
      ? ENTERPRISE_OPERATIONS.workspaceRead
      : isRunSurface
        ? ENTERPRISE_OPERATIONS.copilotkitInvoke
        : isMediaTicketMint
          ? ENTERPRISE_OPERATIONS.mediaTicket
          : proxy
            ? proxy.operation
            : mediaRoute
              ? ENTERPRISE_OPERATIONS.fileRead
              : ENTERPRISE_OPERATIONS.workspaceRead;
    // scope.discover is the one scope-free word (interfaces §5.2's
    // "未选范围时可发现"): discovery may run before a selection exists, so
    // it admits without selectors exactly as the authority's route does.
    const admission = scopeFree
      ? await authority.admissionDiscovery(handle, operation)
      : await authority.admission(handle, selector, operation, mediaRoute?.id);
    // The admitted scope must echo the request's one intent exactly.
    if (
      !scopeFree &&
      (admission.scope?.tenantId !== selector.tenantId ||
        admission.scope.workspaceId !== selector.workspaceId)
    )
      throw AppError.fromCode("SCOPE_SELECTOR_CONFLICT", 400);
    context.set("enterpriseAdmission", admission);
    context.set("enterpriseTickets", tickets);
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

/*
 * T07.07 (#597): the media locator ticket.
 *
 * A ticket is an opaque, at most 60-second locator for ONE resource path and
 * method under ONE session handle and selection. It is not an authorization:
 * the media route that consumes it still performs its own online admission
 * (file.read) with the bound handle, so revocation lands on the next request,
 * Range or pull regardless of any unexpired ticket. The value carries no
 * handle bytes — only an HMAC the server keyed itself — and never a signature
 * over an owner, so the standalone signed-URL vocabulary cannot be replayed
 * against it.
 */

/** The frozen ceiling of interfaces §5.2: a media ticket lives at most 60 s. */
export const MEDIA_TICKET_MAX_AGE_MS = 60_000;

/** The P15 batch ceiling the BFF's media proxy inherits (T06.06 / M2). */
export const MEDIA_PULL_BATCH_BYTES = 262_144;

const _FILE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const _BROWSER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** One whitelisted media route, decomposed: the path families §5.2 admits. */
export interface EnterpriseMediaRoute {
  /** The route family's frozen kind. */
  readonly kind: "file-content" | "browser-preview" | "browser-console";
  /** The resource id the path names (a file id or a browser session id). */
  readonly id: string;
}

/** The exact media paths a ticket may be minted for (interfaces §5.2). */
export function enterpriseMediaRouteOf(path: string): EnterpriseMediaRoute | null {
  const file = /^\/api\/files\/([^/]+)\/content$/.exec(path);
  if (file) return { kind: "file-content", id: file[1] };
  const preview = /^\/api\/browsers\/([^/]+)\/preview$/.exec(path);
  if (preview) return { kind: "browser-preview", id: preview[1] };
  const consolePath = /^\/api\/browsers\/([^/]+)\/console$/.exec(path);
  if (consolePath) return { kind: "browser-console", id: consolePath[1] };
  return null;
}

interface MediaTicketPayload {
  readonly handle: string;
  readonly selector: EnterpriseScopeSelector;
  readonly path: string;
  readonly method: "GET" | "HEAD";
  readonly expiresAt: number;
}

/** One BFF instance's media tickets: mint, and read back from a request. */
export interface EnterpriseMediaTickets {
  mint(
    handle: string,
    selector: EnterpriseScopeSelector,
    path: string,
    method: "GET" | "HEAD",
  ): { url: string; expiresAt: string };
  /** The ticket a request carries, or null when it carries none. */
  read(request: Request): MediaTicketPayload | null;
}

/**
 * The media ticket minter. The signing key is process-local random state: a
 * ticket is only ever consumed by the BFF process that minted it, which is
 * the whole locator scope §5.2 gives it (≤60 s, one resource, no offline
 * authorization to survive a restart).
 */
export function createEnterpriseMediaTickets(publicUrl: string): EnterpriseMediaTickets {
  const key = randomUUID() + randomUUID();
  const sign = (payload: string) => createHmac("sha256", key).update(payload).digest("base64url");
  return {
    mint(handle, selector, path, method) {
      const expiresAt = Date.now() + MEDIA_TICKET_MAX_AGE_MS;
      const issued = new Date(expiresAt).toISOString();
      const body = `${handle}\n${selector.tenantId}\n${selector.workspaceId}\n${path}\n${method}\n${expiresAt}`;
      const value = `${Buffer.from(body).toString("base64url")}.${sign(body)}`;
      const url = new URL(path, publicUrl);
      url.searchParams.set("ticket", value);
      return { url: url.toString(), expiresAt: issued };
    },
    read(request) {
      const url = new URL(request.url);
      const value = url.searchParams.get("ticket");
      if (!value?.includes(".")) return null;
      const separator = value.lastIndexOf(".");
      const encoded = value.slice(0, separator);
      const signature = value.slice(separator + 1);
      let body: string;
      try {
        body = Buffer.from(encoded, "base64url").toString("utf8");
      } catch {
        return null;
      }
      const expected = sign(body);
      const a = Buffer.from(signature);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
      const parts = body.split("\n");
      if (parts.length !== 6) return null;
      const [handle, tenantId, workspaceId, path, method, expiresAt] = parts;
      if (method !== "GET" && method !== "HEAD") return null;
      const expiry = Number(expiresAt);
      if (!Number.isSafeInteger(expiry) || expiry < Date.now()) return null;
      return {
        handle,
        selector: { tenantId, workspaceId },
        path,
        method,
        expiresAt: expiry,
      };
    },
  };
}

/** The ticket a media request carries, or null — read through the app's minter. */
export function enterpriseMediaTicketOf(
  tickets: EnterpriseMediaTickets,
  request: Request,
): MediaTicketPayload | null {
  return tickets.read(request);
}

/**
 * The P15-style byte answer the BFF's file proxy serves: private no-store,
 * single Range 206 / multi Range 416, and a highWaterMark:0 stream whose
 * serial pulls each read at most one ≤262144-byte batch. Revocation between
 * pulls ends the stream through `admit` — already-enqueued batches are not
 * recalled.
 */
export function mediaByteResponse(options: {
  readonly method: string;
  readonly rangeHeader: string | undefined;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly read: (offset: number, maxBytes: number) => Promise<Uint8Array>;
  /** Each pull's online re-admission; false ends the stream. */
  readonly admit: () => Promise<boolean>;
  readonly close: () => Promise<void>;
}): Response {
  const { sizeBytes } = options;
  const parse = (): { start: number; end: number } | "unsatisfiable" | undefined => {
    const header = options.rangeHeader;
    if (header === undefined) return undefined;
    if (!header.startsWith("bytes=")) return undefined;
    const spec = header.slice("bytes=".length).trim();
    if (spec.includes(",")) return "unsatisfiable";
    const match = /^(\d*)-(\d*)$/.exec(spec);
    if (!match) return undefined;
    const [, startText, endText] = match;
    if (startText === "" && endText === "") return undefined;
    if (startText === "") {
      const suffix = Number(endText);
      if (!Number.isInteger(suffix) || suffix <= 0 || sizeBytes === 0) return "unsatisfiable";
      const take = Math.min(suffix, sizeBytes);
      return { start: sizeBytes - take, end: sizeBytes - 1 };
    }
    const start = Number(startText);
    if (!Number.isInteger(start) || start < 0) return undefined;
    if (start >= sizeBytes) return "unsatisfiable";
    if (endText === "") return { start, end: sizeBytes - 1 };
    const end = Number(endText);
    if (!Number.isInteger(end) || end < start) return "unsatisfiable";
    return { start, end: Math.min(end, sizeBytes - 1) };
  };
  const range = parse();
  const headers: Record<string, string> = {
    "content-type": options.contentType,
    "cache-control": "private, no-store",
    "x-openbot-sensitive": "1",
  };
  if (range === "unsatisfiable") {
    void options.close();
    return new Response(null, {
      status: 416,
      headers: { ...headers, "content-range": `bytes */${sizeBytes}` },
    });
  }
  const start = range === undefined ? 0 : range.start;
  const end = range === undefined ? sizeBytes - 1 : range.end;
  headers["content-length"] = String(end - start + 1);
  headers["accept-ranges"] = "bytes";
  if (range !== undefined) headers["content-range"] = `bytes ${start}-${end}/${sizeBytes}`;
  if (options.method === "HEAD") {
    void options.close();
    return new Response(null, { status: range === undefined ? 200 : 206, headers });
  }
  let offset = start;
  let open = true;
  const finish = async () => {
    if (!open) return;
    open = false;
    await options.close().catch(() => undefined);
  };
  const stream = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        if (offset > end) {
          controller.close();
          await finish();
          return;
        }
        if (!(await options.admit())) {
          controller.close();
          await finish();
          return;
        }
        const want = Math.min(MEDIA_PULL_BATCH_BYTES, end - offset + 1);
        const got = await options.read(offset, want);
        if (got.byteLength === 0) {
          controller.close();
          await finish();
          return;
        }
        controller.enqueue(got.subarray(0, want) as Uint8Array & { buffer: ArrayBuffer });
        offset += Math.min(got.byteLength, want);
        if (offset > end) {
          controller.close();
          await finish();
        }
      },
      async cancel() {
        await finish();
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(stream as unknown as BodyInit, {
    status: range === undefined ? 200 : 206,
    headers,
  });
}

/** One of the three §5.2 reauth proxies this BFF serves from the handle. */
interface EnterpriseProxyRoute {
  readonly kind: "scope-listing" | "validate-selection" | "company-challenge";
  readonly operation: string;
}

function enterpriseProxyRouteOf(path: string, method: string): EnterpriseProxyRoute | null {
  if (path === "/api/enterprise/workspace-scope" && method === "GET")
    return { kind: "scope-listing", operation: ENTERPRISE_OPERATIONS.scopeDiscover };
  if (path === "/api/enterprise/workspace-scope/validate-selection" && method === "POST")
    return { kind: "validate-selection", operation: ENTERPRISE_OPERATIONS.scopeValidate };
  if (path === "/api/enterprise/company-auth/challenge" && method === "POST")
    return { kind: "company-challenge", operation: ENTERPRISE_OPERATIONS.companyChallenge };
  return null;
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
    Variables: {
      enterpriseAdmission: EnterpriseAdmission;
      enterpriseTickets: EnterpriseMediaTickets;
    };
  },
>(
  app: Hono<Env>,
  deps: {
    db: Store;
    config: Config;
    authority: OpenbotAuthority;
    tickets: EnterpriseMediaTickets;
    /** The media byte routes need the server's own file and browser seams. */
    media: EnterpriseMediaDeps;
  },
): void {
  app.post("/api/session", enterpriseSessionHandler(deps.authority));
  app.use("/api/*", enterpriseGuard(deps.config, deps.authority, deps.tickets));
  app.get("/api/workspace", async (context) => {
    const facts = enterpriseFacts(context);
    const owner = enterpriseOwner(facts.selector, { principalId: facts.principalId });
    return context.json(
      await enterpriseWorkspaceSnapshot(deps.db, deps.config, owner, context.req.query("q")),
      200,
    );
  });
  mountEnterpriseMediaRoutes(app, deps);
}

/**
 * T07.07 (#597): the media ticket mint, the online media reads and the three
 * reauth proxies. Mounted after the guard, which has already performed this
 * request's online admission and put the admitted namespace on the context.
 */
export function mountEnterpriseMediaRoutes<
  Env extends {
    Variables: {
      enterpriseAdmission: EnterpriseAdmission;
      enterpriseTickets: EnterpriseMediaTickets;
    };
  },
>(
  app: Hono<Env>,
  deps: {
    authority: OpenbotAuthority;
    tickets: EnterpriseMediaTickets;
    media: EnterpriseMediaDeps;
  },
): void {
  // POST /api/media-tickets — one online media.ticket admission (the guard
  // performed it), then a ≤60-second locator bound to this session, resource
  // and selection. The resource must already be visible in the admitted
  // namespace: only verified file content / browser preview / console paths.
  app.post("/api/media-tickets", async (context) => {
    let body: Record<string, unknown>;
    try {
      body = (await context.req.json()) as Record<string, unknown>;
    } catch {
      throw AppError.fromCode("INVALID_REQUEST", 400);
    }
    const path = body.path;
    const method = body.method;
    if (typeof path !== "string" || (method !== "GET" && method !== "HEAD"))
      throw AppError.fromCode("INVALID_REQUEST", 400);
    const route = enterpriseMediaRouteOf(path);
    if (!route) throw AppError.fromCode("INVALID_REQUEST", 400);
    const facts = enterpriseFacts(context);
    const owner = enterpriseOwner(facts.selector, { principalId: facts.principalId });
    // Only a resource this namespace really owns is locatable; an invisible
    // one answers the uniform 404, indistinguishable from a nonexistent id.
    if (route.kind === "file-content") {
      await resourceOf(() => deps.media.file(owner, route.id));
    } else {
      await resourceOf(() => deps.media.browser(owner, route.id));
    }
    const handle = enterpriseHandleOf(context);
    const minted = deps.tickets.mint(handle, facts.selector, path, method);
    return context.json(minted, 200);
  });

  // The media reads accept Bearer+selector OR the minted ticket; either way
  // the guard already re-admitted online. A file answer is the P15-style
  // proxy: private no-store, single Range/206, multi Range/416, ≤262144-byte
  // serial pulls, each pull admitted again online.
  app.on(["GET", "HEAD"], "/api/files/:id/content", async (context) => {
    const facts = enterpriseFacts(context);
    const owner = enterpriseOwner(facts.selector, { principalId: facts.principalId });
    const id = context.req.param("id");
    const file = await resourceOf(() => deps.media.file(owner, id));
    let source: EnterpriseMediaSource;
    source = await resourceOf(() => deps.media.open(owner, id));
    const handle = enterpriseHandleOf(context);
    const selector = facts.selector;
    const response = mediaByteResponse({
      method: context.req.method,
      rangeHeader: context.req.header("range"),
      contentType: "application/pdf",
      sizeBytes: source.sizeBytes,
      read: (offset, maxBytes) => source.read(offset, maxBytes),
      close: () => source.close(),
      admit: async () => {
        try {
          await deps.authority.admission(handle, selector, ENTERPRISE_OPERATIONS.fileRead, file.id);
          return true;
        } catch {
          return false;
        }
      },
    });
    // The private no-store discipline is the response's own, not the global
    // transport middleware's plain no-store.
    response.headers.set("cache-control", "private, no-store");
    return response;
  });

  app.get("/api/browsers/:id/preview", async (context) => {
    const facts = enterpriseFacts(context);
    const owner = enterpriseOwner(facts.selector, { principalId: facts.principalId });
    await resourceOf(() => deps.media.browser(owner, context.req.param("id")));
    const response = await deps.media.preview(owner, context.req.param("id"));
    context.header("Content-Type", "image/png");
    context.header("Cache-Control", "private, no-store");
    return context.body(await response.arrayBuffer());
  });

  app.get("/api/browsers/:id/console", async (context) => {
    const facts = enterpriseFacts(context);
    const owner = enterpriseOwner(facts.selector, { principalId: facts.principalId });
    await resourceOf(() => deps.media.browser(owner, context.req.param("id")));
    // The console is a document a native webview renders without headers:
    // its embedded preview URL is a ≤60-second locator minted for this
    // selection, and every refresh through it re-admits online.
    const handle = enterpriseHandleOf(context);
    const minted = deps.tickets.mint(
      handle,
      facts.selector,
      `/api/browsers/${context.req.param("id")}/preview`,
      "GET",
    );
    context.header(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' blob:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
    );
    return context.html(deps.media.console(minted.url));
  });

  // ── the three §5.2 reauth proxies ──────────────────────────────────────
  // The authority decides (eligibility, proof demand, challenge issuance);
  // this BFF only translates the handle and passes the frozen DTO through.
  app.get("/api/enterprise/workspace-scope", async (context) => {
    const listing = await deps.authority.scopeListing(enterpriseHandleOf(context));
    return context.json(listing, 200);
  });

  app.post("/api/enterprise/workspace-scope/validate-selection", async (context) => {
    let body: Record<string, unknown>;
    try {
      body = (await context.req.json()) as Record<string, unknown>;
    } catch {
      throw AppError.fromCode("INVALID_REQUEST", 400);
    }
    if (typeof body.tenantId !== "string" || typeof body.workspaceId !== "string")
      throw AppError.fromCode("INVALID_REQUEST", 400);
    const facts = enterpriseFacts(context);
    const validated = await deps.authority.validateSelection(enterpriseHandleOf(context), {
      tenantId: body.tenantId,
      workspaceId: body.workspaceId,
    });
    // A validated selection that names another company than this request's
    // one intent is the closed conflict, never a silent override.
    const validatedSelection = validated as { tenantId?: unknown; workspaceId?: unknown };
    if (
      validatedSelection.tenantId !== facts.selector.tenantId ||
      validatedSelection.workspaceId !== facts.selector.workspaceId
    )
      throw AppError.fromCode("SCOPE_SELECTOR_CONFLICT", 400);
    return context.json(validated, 200);
  });

  app.post("/api/enterprise/company-auth/challenge", async (context) => {
    let body: Record<string, unknown>;
    try {
      body = (await context.req.json()) as Record<string, unknown>;
    } catch {
      throw AppError.fromCode("INVALID_REQUEST", 400);
    }
    if (typeof body.tenantId !== "string" || typeof body.returnPath !== "string")
      throw AppError.fromCode("INVALID_REQUEST", 400);
    const facts = enterpriseFacts(context);
    if (body.tenantId !== facts.selector.tenantId)
      throw AppError.fromCode("SCOPE_SELECTOR_CONFLICT", 400);
    const challenge = await deps.authority.companyChallenge(enterpriseHandleOf(context), {
      tenantId: body.tenantId,
      returnPath: body.returnPath,
    });
    return context.json(challenge, 200);
  });
}

/** The media seam: what the media routes need from the deployment's services. */
export interface EnterpriseMediaDeps {
  /** The artifact record, scoped to the admitted owner (404 otherwise). */
  file(owner: string, id: string): Promise<{ id: string; size: number }>;
  /** The bounded byte source over the stored file. */
  open(owner: string, id: string): Promise<EnterpriseMediaSource>;
  /** The browser session record, scoped to the admitted owner (404 otherwise). */
  browser(owner: string, id: string): Promise<unknown>;
  /** The worker's screenshot response for this session. */
  preview(owner: string, id: string): Promise<Response>;
  /** The console document with the given preview URL embedded. */
  console(previewUrl: string): string;
}

/**
 * T07.07 (#597): map a media seam's record read onto the frozen refusal
 * taxonomy. A resource outside the admitted namespace answers the uniform
 * 404 word — the same answer a nonexistent id gets, so no side channel
 * distinguishes "not yours" from "not there".
 */
async function resourceOf<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof AppError && error.status === 404)
      throw AppError.fromCode("RESOURCE_NOT_FOUND", 404);
    throw error;
  }
}

/** The bounded byte source a file proxy pull reads through. */
export interface EnterpriseMediaSource {
  readonly sizeBytes: number;
  read(offset: number, maxBytes: number): Promise<Uint8Array>;
  close(): Promise<void>;
}

/**
 * The handle the guard admitted this request under: the Bearer handle, or
 * the one bound into the media ticket a native reader presented.
 */
export function enterpriseHandleOf<
  Env extends {
    Variables: {
      enterpriseAdmission: EnterpriseAdmission;
      enterpriseTickets: EnterpriseMediaTickets;
    };
  },
>(context: Context<Env>): string {
  const authorization = context.req.header("authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7);
  const tickets = context.get("enterpriseTickets");
  if (tickets) {
    const ticket = tickets.read(context.req.raw);
    if (ticket) return ticket.handle;
  }
  throw AppError.fromCode("SESSION_EXPIRED", 401);
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
export function createEnterpriseApp(
  db: Store,
  config: Config,
  options: {
    authority?: OpenbotAuthority;
    tickets?: EnterpriseMediaTickets;
    media?: EnterpriseMediaDeps;
  } = {},
): Hono<{
  Variables: {
    enterpriseAdmission: EnterpriseAdmission;
    enterpriseTickets: EnterpriseMediaTickets;
  };
}> {
  if (config.mode === "sample")
    throw new Error("The enterprise supply never serves a sample workspace");
  // The real authority client unless a test injects its seam.
  const authority = options.authority ?? createOpenbotAuthority(config);
  const tickets = options.tickets ?? createEnterpriseMediaTickets(config.publicUrl);
  const app = new Hono<{
    Variables: {
      enterpriseAdmission: EnterpriseAdmission;
      enterpriseTickets: EnterpriseMediaTickets;
    };
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
    // Provider and document errors are useful, but raw stack traces and
    // token-bearing responses are not.
    console.error(`[OpenMuse enterprise] ${error.name}`);
    return context.json({ error: "Request failed. Check the server setup and try again." }, 502);
  });
  // The deployment probe carries no identity or tenant data.
  app.get("/api/health", (context) =>
    context.json({ ok: true, mode: config.mode, authMode: "enterprise" }),
  );
  mountEnterpriseRoutes(app, { db, config, authority, tickets, media: mediaDeps(db, config) });
  return app;
}

/**
 * The default media seam over this server's own services. The store reads
 * stay owner-scoped: only the admitted namespace's records are ever visible.
 */
function mediaDeps(db: Store, config: Config): EnterpriseMediaDeps {
  const auth = createAuth(db, config);
  const resolved = async () => {
    const authService = await auth;
    return {
      auth: authService,
      files: new Files(db, config, authService),
      browsers: new BrowserService(db, config, authService, new Files(db, config, authService)),
    };
  };
  let services: Awaited<ReturnType<typeof resolved>> | undefined;
  const lazy = async () => (services ??= await resolved());
  return {
    async file(owner, id) {
      const file = await (await lazy()).files.get(owner, id);
      return { id: file.id, size: file.size };
    },
    async open(owner, id) {
      return (await lazy()).files.stream(owner, id);
    },
    async browser(owner, id) {
      return (await lazy()).browsers.get(owner, id);
    },
    async preview(owner, id) {
      return (await lazy()).browsers.preview(owner, id);
    },
    console(previewUrl: string) {
      return browserConsole(previewUrl);
    },
  };
}
