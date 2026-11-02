import { randomUUID } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

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
export function enterpriseSessionHandler(config: Config, authority: OpenbotAuthority) {
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
 * and ONE online admission for this request before any store or run work. The
 * admitted facts ride the request context; the actor is the authority's
 * answer, never the client's body or headers. Routes this BFF has not wired
 * for the enterprise supply are refused — they never fall back to the
 * standalone owner authentication.
 *
 * T07.06 (#596) adds the two run surfaces that keep their own wire contract:
 * `/api/copilotkit/*` (the fixed CopilotKit SDK routes — the runtime then
 * re-admits every new model dispatch and tool action) and `/api/agent*` (the
 * run API the CopilotKit tools and the app drive). The operation for both is
 * the authority's single frozen run operation, `copilotkit.invoke`.
 */
export function enterpriseGuard(config: Config, authority: OpenbotAuthority): MiddlewareHandler {
  return async (context, next) => {
    const path = context.req.path;
    const isWorkspace = path === "/api/workspace";
    const isRunSurface =
      path === "/api/copilotkit" ||
      path.startsWith("/api/copilotkit/") ||
      path === "/api/agent" ||
      path.startsWith("/api/agent/");
    if (!isWorkspace && !isRunSurface) throw AppError.fromCode("RESOURCE_NOT_FOUND", 404);
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
    const admission = await authority.admission(
      handle,
      selector,
      isWorkspace ? ENTERPRISE_OPERATIONS.workspaceRead : ENTERPRISE_OPERATIONS.copilotkitInvoke,
    );
    // The admitted scope must echo the request's one intent exactly.
    if (
      admission.scope?.tenantId !== selector.tenantId ||
      admission.scope.workspaceId !== selector.workspaceId
    )
      throw AppError.fromCode("SCOPE_SELECTOR_CONFLICT", 400);
    context.set("enterpriseAdmission", admission);
    context.set("enterpriseConfig", config);
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
    // The authority must echo this stream's one intent; anything else ends it.
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
