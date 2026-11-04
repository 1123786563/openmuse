/**
 * T07.12 (#602, original task P20): the mobile client's company-assurance and
 * media-ticket half, over the BFF surfaces T07.07 (#597) shipped
 * (POST /api/enterprise/company-auth/challenge, POST /api/media-tickets) and
 * the tenancy adapter's seam (the scope selection + its generation, from
 * tenancy.ts — the T07.11 contract this client re-reads at every step).
 *
 * THE RULES ARE THE ISSUE'S OWN:
 * - A 403 COMPANY_REAUTH_REQUIRED keeps the target and pauses the business
 *   (§5): nothing is cleared, the scope stays selected, and one challenge is
 *   minted bound to the ORIGINAL session handle, selection and intent.
 * - The system browser completes the challenge against the AUTHORITY (the
 *   redirectUrl the BFF proxied), never inside the app; when the deep link
 *   returns, the ORIGINAL intent's selection is re-validated — never the
 *   temporarily active one — and an account change (ACCOUNT_CHANGED on
 *   re-validation) never resumes the old scope: the flow dies and the
 *   identity must be re-established.
 * - Native Image/PDF readers that cannot set headers locate one resource
 *   through a ≤60-second ticket minted online. A refused mint is a typed
 *   refusal; the client NEVER falls back to the storage/content URL — a
 *   revoked session must not retry direct storage.
 * - Logout (and any sign-out sweep) drops every pending ticket and the
 *   pending challenge, and a scope switch makes the old scope's cached
 *   tickets absent — media never crosses a namespace.
 *
 * This module is pure adapter logic with injected collaborators (fetch,
 * browser opener), exactly like tenancy.ts and transport.ts inject theirs,
 * so its contract runs in CI with no runtime beneath it. The app screens
 * (details.tsx, PdfReader.*, App.tsx) consume it through these seams.
 */

import type { ScopeSelection, TenancyStore } from "./tenancy";
import { TENANT_HEADER, WORKSPACE_HEADER } from "./transport";

/** The BFF refusal codes this client branches on (interfaces §5.2's closed set). */
export type MobileBffErrorCode =
  | "INVALID_REQUEST"
  | "SCOPE_REQUIRED"
  | "SCOPE_SELECTOR_CONFLICT"
  | "SESSION_EXPIRED"
  | "SESSION_REVOKED"
  | "ACCOUNT_CHANGED"
  | "COMPANY_REAUTH_REQUIRED"
  | "IDENTITY_DISABLED"
  | "RESOURCE_NOT_FOUND"
  | "AUTHORITY_UNAVAILABLE";

const BFF_CODES: readonly MobileBffErrorCode[] = [
  "INVALID_REQUEST",
  "SCOPE_REQUIRED",
  "SCOPE_SELECTOR_CONFLICT",
  "SESSION_EXPIRED",
  "SESSION_REVOKED",
  "ACCOUNT_CHANGED",
  "COMPANY_REAUTH_REQUIRED",
  "IDENTITY_DISABLED",
  "RESOURCE_NOT_FOUND",
  "AUTHORITY_UNAVAILABLE",
];

/** The typed refusal a BFF answer maps to; never a bare string. */
export class MobileBffRefused extends Error {
  readonly status: number;
  readonly code: MobileBffErrorCode | "UNKNOWN";
  constructor(status: number, code: string) {
    super(`The BFF refused the request (${status} ${code}).`);
    this.name = "MobileBffRefused";
    this.status = status;
    this.code = BFF_CODES.includes(code as MobileBffErrorCode)
      ? (code as MobileBffErrorCode)
      : "UNKNOWN";
  }
}

/**
 * Read one response's refusal (a non-JSON or code-less body reads as
 * UNKNOWN), keeping the answer's status. The form every fetch seam here
 * funnels a non-ok answer through.
 */
export async function refusalOf(response: Response): Promise<MobileBffRefused> {
  const body = (await response.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code : "UNKNOWN";
  return new MobileBffRefused(response.status, code);
}

/**
 * Whether one parsed refusal is the §5 pause signal: 403 +
 * COMPANY_REAUTH_REQUIRED. Only this pair pauses the business; every other
 * 403 (identity disabled and friends) is a refusal the caller surfaces
 * as-is.
 */
export function reauthRequired(refusal: MobileBffRefused): boolean {
  return refusal.status === 403 && refusal.code === "COMPANY_REAUTH_REQUIRED";
}

/**
 * What the app does with one refusal (interfaces §5.2's disposition table):
 * - 401 SESSION_EXPIRED/SESSION_REVOKED/ACCOUNT_CHANGED → clear identity;
 * - 403 COMPANY_REAUTH_REQUIRED → keep the target, pause, run the challenge;
 * - 503 AUTHORITY_UNAVAILABLE → stay failed (retryable, never a silent pass);
 * - anything else → surface the refusal as-is.
 */
export type RefusalDisposition = "sign-out" | "pause-reauth" | "keep-failure" | "surface";

export function dispositionOf(refusal: MobileBffRefused): RefusalDisposition {
  if (refusal.status === 401) return "sign-out";
  if (refusal.status === 403 && refusal.code === "COMPANY_REAUTH_REQUIRED") return "pause-reauth";
  if (refusal.status === 503) return "keep-failure";
  return "surface";
}

// ---------------------------------------------------------------------------
// The wire shapes (the BFF's frozen answers)
// ---------------------------------------------------------------------------

/** One media locate request, exactly the paths the BFF whitelists. */
export interface MediaTicketRequest {
  readonly path: string;
  readonly method: "GET" | "HEAD";
}

/** The BFF's minted locator: an opaque URL and its ≤60-second expiry. */
export interface MediaTicket {
  readonly url: string;
  readonly expiresAt: string;
}

/** What was on screen when the 403 arrived — kept, never cleared. */
export interface PausedIntent {
  readonly detail: Readonly<Record<string, unknown>>;
}

/** The one live challenge, bound to the handle/selection that minted it. */
export interface CompanyAuthFlow {
  readonly challengeId: string;
  readonly redirectUrl: string;
  readonly expiresAt: string;
  readonly selection: ScopeSelection;
  readonly intent: PausedIntent;
}

/** What a deep-link callback resolved to. */
export type CallbackOutcome =
  | { status: "validated"; restoreSelection: ScopeSelection; intent: PausedIntent }
  | { status: "account-changed" }
  | { status: "no-pending-challenge" };

/** What signOut swept, for the caller's evidence line. */
export interface SignOutSweep {
  readonly pendingTickets: number;
  readonly pendingChallenge: boolean;
}

/**
 * Does a deep-link callback URL name THIS flow? A URL carrying no intent is
 * accepted only because the pending flow was started by this client (the
 * browser trip is ours); a URL naming a different intent/challenge is never
 * allowed to complete it.
 */
export function callbackNamesThisFlow(
  url: string,
  flow: Pick<CompanyAuthFlow, "challengeId">,
): boolean {
  const queryAt = url.indexOf("?");
  if (queryAt === -1) return true;
  const query = new URLSearchParams(url.slice(queryAt + 1));
  for (const key of ["intent", "intentId", "challenge", "challengeId"]) {
    const named = query.get(key);
    if (named !== null && named !== "" && named !== flow.challengeId) return false;
  }
  return true;
}

/** The collaborators the app injects; tests inject fakes. */
export interface CompanyAssuranceDeps {
  readonly store: TenancyStore;
  readonly fetchLike: (path: string, init?: RequestInit) => Promise<Response>;
  readonly openBrowser: (url: string) => void;
  /** The enterprise session handle (EnterpriseSessionResponse.token). */
  readonly handle: string;
  /** Wall clock for ticket-expiry checks; tests inject theirs. */
  readonly now?: () => number;
}

/** How long a minted locator stays usable client-side before a re-mint. */
const TICKET_REUSE_MARGIN_MS = 5_000;

export function createCompanyAssuranceClient(deps: CompanyAssuranceDeps) {
  // The intent the next challenge binds (set by pauseForReauth).
  let pausedIntent: Readonly<Record<string, unknown>> = {};
  // The live challenge, if any — exactly one browser trip per 403.
  let pendingFlow: CompanyAuthFlow | null = null;
  // Set when the identity must be re-established (account changed / logout).
  let identityCleared = false;
  // The paths a mint filed under the CURRENT scope (the sweep's own record;
  // the tenancy store exposes no enumeration by design).
  const mintedPaths = new Set<string>();
  let mediaCacheSwept = true;

  const ticketKey = (path: string) => `media-ticket:${path}`;
  const now = deps.now ?? (() => Date.now());

  /** A cached ticket is reused only while it is still comfortably unexpired. */
  const unexpired = (ticket: MediaTicket): boolean => {
    const expiry = Date.parse(ticket.expiresAt);
    return Number.isFinite(expiry) && expiry - now() > TICKET_REUSE_MARGIN_MS;
  };

  const scopeOrThrow = (): ScopeSelection => {
    const scope = deps.store.scope();
    if (scope.status !== "open" || scope.selection === null)
      throw new Error("The scope source has not answered yet.");
    return scope.selection;
  };

  const authHeaders = (selection: ScopeSelection): Record<string, string> => ({
    authorization: `Bearer ${deps.handle}`,
    "content-type": "application/json",
    [TENANT_HEADER]: selection.tenantId,
    [WORKSPACE_HEADER]: selection.workspaceId,
  });

  return {
    /**
     * Record the §5 pause: the 403 answer's target and the selection it
     * happened under. Nothing is cleared — the business is paused on the
     * same scope, waiting for one challenge.
     */
    pauseForReauth(detail: Readonly<Record<string, unknown>>): {
      target: Readonly<Record<string, unknown>>;
      selection: ScopeSelection | null;
      activeFlow: CompanyAuthFlow | null;
    } {
      // The pause keeps whatever was on screen even when the scope source has
      // not answered; beginChallenge is the step that requires a selection.
      pausedIntent = detail;
      const scope = deps.store.scope();
      return {
        target: detail,
        selection: scope.status === "open" ? scope.selection : null,
        activeFlow: pendingFlow,
      };
    },

    /**
     * Mint one challenge through the BFF proxy and open the system browser
     * at the authority's redirectUrl. A live flow is returned as-is — one
     * browser trip per 403, never a second challenge while one is pending.
     */
    async beginChallenge(): Promise<CompanyAuthFlow> {
      if (pendingFlow) return pendingFlow;
      const selection = scopeOrThrow();
      const response = await deps.fetchLike("/api/enterprise/company-auth/challenge", {
        method: "POST",
        headers: authHeaders(selection),
        // A site-local returnPath naming the paused target, so the
        // authority's 303 lands back inside the app's own surface.
        body: JSON.stringify({
          tenantId: selection.tenantId,
          returnPath: `/company-auth/return?target=${encodeURIComponent(JSON.stringify(pausedIntent))}`,
        }),
      });
      if (!response.ok) throw await refusalOf(response);
      const issued = (await response.json()) as Omit<CompanyAuthFlow, "selection" | "intent">;
      pendingFlow = { ...issued, selection, intent: { detail: pausedIntent } };
      deps.openBrowser(issued.redirectUrl);
      return pendingFlow;
    },

    /** The live challenge, or null — for sign-out sweeps and guards. */
    pendingChallenge(): CompanyAuthFlow | null {
      return pendingFlow;
    },

    /**
     * The deep link's return. The ORIGINAL flow's selection is re-validated
     * (never the temporarily active one); an ACCOUNT_CHANGED refusal kills
     * the flow and demands a new identity — the old scope cannot resume.
     */
    async completeCallback(deeplinkUrl: string): Promise<CallbackOutcome> {
      if (!pendingFlow) return { status: "no-pending-challenge" };
      const original = pendingFlow;
      // The deep link may name an intent/challenge; when it does, it must be
      // THIS flow's — a callback for another intent never completes this one
      // (the "never follow the temporarily active intent" rule).
      if (!callbackNamesThisFlow(deeplinkUrl, original)) {
        return { status: "no-pending-challenge" };
      }
      const response = await deps.fetchLike("/api/enterprise/workspace-scope/validate-selection", {
        method: "POST",
        headers: authHeaders(original.selection),
        body: JSON.stringify({
          tenantId: original.selection.tenantId,
          workspaceId: original.selection.workspaceId,
        }),
      });
      if (!response.ok) {
        const refusal = await refusalOf(response);
        // The resume-killers: the account the handle now binds is not the
        // one the challenge was minted for (ACCOUNT_CHANGED), or the session
        // itself is gone (401). Any other refusal keeps the flow pending
        // for an honest retry.
        if (refusal.code === "ACCOUNT_CHANGED" || refusal.status === 401) {
          pendingFlow = null;
          identityCleared = true;
          return { status: "account-changed" };
        }
        throw refusal;
      }
      pendingFlow = null;
      identityCleared = false;
      return {
        status: "validated",
        restoreSelection: original.selection,
        intent: original.intent,
      };
    },

    /**
     * Locate one resource for a headerless native reader: mint (or reuse
     * the current scope's cached) ticket. A refused mint is a typed refusal
     * — the caller never falls back to the storage/content URL.
     */
    async mediaTicket(request: MediaTicketRequest): Promise<MediaTicket> {
      // A cleared identity cannot mint: the 401 hook is remounting the tree,
      // and a ticket minted now would bind a session that no longer exists.
      if (identityCleared) throw new MobileBffRefused(401, "SESSION_EXPIRED");
      const cached = this.cachedTicket(request.path);
      // A ≤60-second locator is not an authorization to reuse forever: once
      // it is (nearly) expired the reader must mint a fresh one, or the next
      // pull would be refused on a stale URL.
      if (cached !== null && unexpired(cached)) return cached;
      const selection = scopeOrThrow();
      const response = await deps.fetchLike("/api/media-tickets", {
        method: "POST",
        headers: authHeaders(selection),
        body: JSON.stringify(request),
      });
      if (!response.ok) throw await refusalOf(response);
      const minted = (await response.json()) as MediaTicket;
      deps.store.write(ticketKey(request.path), minted);
      mintedPaths.add(request.path);
      mediaCacheSwept = false;
      return minted;
    },

    /** The current scope's cached ticket for one path, or null (absent after a switch). */
    cachedTicket(path: string): MediaTicket | null {
      const read = deps.store.read<MediaTicket>(ticketKey(path));
      return read.status === "present" ? read.value : null;
    },

    /** The cache key one path's ticket lives under (scope-prefixed, for audits). */
    ticketCacheKey(path: string): string {
      return `${deps.store.cachePrefix()}:${ticketKey(path)}`;
    },

    /** Whether the media ticket cache is empty (for sign-out evidence). */
    mediaCacheIsEmpty(): boolean {
      return mediaCacheSwept;
    },

    /** Whether the identity must be re-established before any new flow. */
    needsNewIdentity(): boolean {
      return identityCleared;
    },

    /**
     * The sign-out sweep: drop every pending ticket and the pending
     * challenge. Called by App.tsx on logout and by the 401 hook before the
     * tree remounts onto the sign-in gate. Ticket values are overwritten
     * with null in the live bucket and the paths forgotten, so a later
     * scope can never read a stale locator.
     */
    signOut(): SignOutSweep {
      const pendingTickets = mintedPaths.size;
      for (const path of mintedPaths) deps.store.write(ticketKey(path), null);
      mintedPaths.clear();
      const hadChallenge = pendingFlow !== null;
      pendingFlow = null;
      mediaCacheSwept = true;
      identityCleared = true;
      return { pendingTickets, pendingChallenge: hadChallenge };
    },
  };
}

export type CompanyAssuranceClient = ReturnType<typeof createCompanyAssuranceClient>;

// ---------------------------------------------------------------------------
// The app-session holder
// ---------------------------------------------------------------------------
//
// The enterprise session wiring (T07.10 owns the PKCE handoff) constructs the
// one client once it has the handle and the tenancy store, and registers it
// here; logout unregisters it. Until that wiring lands, no client is
// registered and every consumer (the deep-link listener in App.tsx used to
// complete a flow, details.tsx's ticket minting) keeps its legacy standalone
// contract — no invented handle, no guessed session.
//
// A plain module slot, not a React context, so this file stays loadable by
// bun test with no runtime beneath it (the tenancy/transport convention).

let liveClient: CompanyAssuranceClient | null = null;

/** Register (or clear) the live client; called by the enterprise session wiring and logout. */
export function setCompanyAssurance(client: CompanyAssuranceClient | null): void {
  liveClient = client;
}

/** The live client, or null on the standalone supply. */
export function getCompanyAssurance(): CompanyAssuranceClient | null {
  return liveClient;
}
