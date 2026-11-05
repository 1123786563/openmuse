// T07.12 (#602, original task P20): the mobile client's company-assurance and
// media-ticket half, over the BFF surfaces T07.07 (#597) shipped.
//
// WHAT THIS MODULE OWNS (and this file pins):
// - The §5 additional-company-authentication flow, mobile side: a 403
//   COMPANY_REAUTH_REQUIRED answer keeps the target on screen (the business is
//   paused, never cleared), mints one challenge through
//   POST /api/enterprise/company-auth/challenge bound to the ORIGINAL session
//   handle and selection, opens the system browser at the challenge's
//   redirectUrl, and re-validates the selection when the callback returns to
//   the ORIGINAL intent — never the temporarily active one.
// - An account change between challenge and callback can never resume the old
//   scope: only the handle that minted the challenge may complete it, and a
//   callback arriving for a different handle/intent is refused outright.
// - The media half: native readers that cannot set headers locate one
//   resource through a ≤60-second ticket minted by POST /api/media-tickets,
//   one ticket per resource+method; a refused or expired ticket NEVER falls
//   back to the storage URL, and logout/revocation clears the media cache and
//   every pending ticket so nothing private survives the session.
//
// The BFF's own half (mint HMAC, online re-admission per pull) is T07.07's,
// pinned by apps/server/src/enterprise-media-proof.test.ts. This file pins the
// CLIENT's half: intent binding, ticket lifecycle, cache clearing, and the
// no-storage-fallback rule, with the fetch/browser/clock collaborators
// injected exactly like tenancy.ts and transport.ts inject theirs, so the
// whole contract runs in CI with no runtime beneath it.
//
// Rerun: bun test apps/mobile/src/openbot/company-assurance.test.ts

import { describe, expect, test } from "bun:test";

import {
  createCompanyAssuranceClient,
  dispositionOf,
  type MediaTicketRequest,
  type MobileBffErrorCode,
  reauthRequired,
  refusalOf,
} from "./company-assurance";
import { createTenancyStore, type ScopeSelection, type ScopeStorage } from "./tenancy";

// ---------------------------------------------------------------------------
// The injected collaborators, as fakes that record every call
// ---------------------------------------------------------------------------

/** Every fetch the flow made, in order, for assertions. */
type FetchCall = { path: string; init?: RequestInit };

function fakeFetch() {
  const calls: FetchCall[] = [];
  const responders: Array<(path: string) => Response> = [];
  const fetchLike = async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    const responder = responders.length > 1 ? responders.shift() : responders[0];
    if (!responder) throw new Error(`unexpected fetch: ${path}`);
    return responder(path);
  };
  return {
    calls,
    fetchLike,
    answer(responder: (path: string) => Response) {
      responders.length = 0;
      responders.push(responder);
    },
  };
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const bffError = (status: number, code: MobileBffErrorCode) =>
  jsonResponse(status, { error: "Request refused.", code, requestId: "req-1" });

function fakeBrowser() {
  const opened: string[] = [];
  return {
    opened,
    open(url: string) {
      opened.push(url);
    },
  };
}

function memoryStorage(): ScopeStorage {
  const slots = new Map<string, string>();
  return {
    getItem: (key: string) => Promise.resolve(slots.get(key) ?? null),
    setItem: (key: string, value: string) => {
      slots.set(key, value);
      return Promise.resolve();
    },
  };
}

const USER = "user-1";
const ACME: ScopeSelection = { tenantId: "acme", workspaceId: "acme-finance" };
const GLOBEX: ScopeSelection = { tenantId: "globex", workspaceId: "globex-ops" };

function world(options?: { handle?: string; now?: () => number }) {
  const fetch = fakeFetch();
  const browser = fakeBrowser();
  const store = createTenancyStore({ userId: USER, storage: memoryStorage() });
  const client = createCompanyAssuranceClient({
    store,
    fetchLike: fetch.fetchLike,
    openBrowser: browser.open,
    handle: options?.handle ?? "handle-A",
    ...(options?.now ? { now: options.now } : {}),
  });
  return { fetch, browser, store, client };
}

/** A challenge DTO exactly as the BFF proxies it. */
const CHALLENGE = {
  challengeId: "ch-1",
  redirectUrl: "https://idp.example/authorize?challenge=ch-1",
  expiresAt: "2026-11-04T12:00:00Z",
};

/** A minted ticket DTO exactly as the BFF answers it. */
const TICKET = {
  url: "https://bff.example/api/files/file-1/content?ticket=opaque",
  expiresAt: "2026-11-04T12:00:30Z",
};

/** One media ticket request the native PDF reader would make. */
const PDF_REQUEST: MediaTicketRequest = {
  path: "/api/files/file-1/content",
  method: "GET",
};

// ---------------------------------------------------------------------------
// The 403 rule: keep the target, pause the business
// ---------------------------------------------------------------------------

describe("T07.12: the 403 rule keeps the target and pauses the business", () => {
  test("a COMPANY_REAUTH_REQUIRED refusal is recognized from status+code", async () => {
    expect(reauthRequired(await refusalOf(bffError(403, "COMPANY_REAUTH_REQUIRED")))).toBe(true);
    expect(reauthRequired(await refusalOf(bffError(401, "SESSION_EXPIRED")))).toBe(false);
    expect(reauthRequired(await refusalOf(bffError(403, "IDENTITY_DISABLED")))).toBe(false);
    expect(reauthRequired(await refusalOf(jsonResponse(200, {})))).toBe(false);
    expect(reauthRequired(await refusalOf(new Response("gateway", { status: 502 })))).toBe(false);
  });

  test("the refusal disposition table maps 401/403/503/other", async () => {
    expect(dispositionOf(await refusalOf(bffError(401, "SESSION_EXPIRED")))).toBe("sign-out");
    expect(dispositionOf(await refusalOf(bffError(401, "ACCOUNT_CHANGED")))).toBe("sign-out");
    expect(dispositionOf(await refusalOf(bffError(403, "COMPANY_REAUTH_REQUIRED")))).toBe(
      "pause-reauth",
    );
    expect(dispositionOf(await refusalOf(bffError(403, "IDENTITY_DISABLED")))).toBe("surface");
    expect(dispositionOf(await refusalOf(bffError(503, "AUTHORITY_UNAVAILABLE")))).toBe(
      "keep-failure",
    );
    expect(dispositionOf(await refusalOf(bffError(404, "RESOURCE_NOT_FOUND")))).toBe("surface");
  });

  test("the paused intent keeps its selection and target; the flow starts from it", async () => {
    const { client, store } = world();
    await store.selectScope(ACME);
    const paused = client.pauseForReauth({ detail: { kind: "file", id: "file-1" } });
    // The selection is kept — the business is paused, not reset.
    const scope = store.scope();
    expect(scope.status === "open" ? scope.selection : null).toEqual(ACME);
    expect(paused.target).toEqual({ detail: { kind: "file", id: "file-1" } });
    expect(paused.selection).toEqual(ACME);
    expect(paused.activeFlow).toBe(null);
  });

  test("starting the challenge posts the original selection and tenant returnPath", async () => {
    const { client, store, fetch, browser } = world();
    await store.selectScope(ACME);
    client.pauseForReauth({ detail: { kind: "file", id: "file-1" } });
    fetch.answer((path) =>
      path === "/api/enterprise/company-auth/challenge"
        ? jsonResponse(200, CHALLENGE)
        : jsonResponse(404, {}),
    );
    const flow = await client.beginChallenge();
    expect(flow?.challengeId).toBe("ch-1");
    // The system browser opened at the authority's redirect URL, exactly once.
    expect(browser.opened).toEqual([CHALLENGE.redirectUrl]);
    // The request carried the Bearer handle, the selection headers and the
    // site-local returnPath naming the paused target's tenant.
    const call = fetch.calls.find((c) => c.path.includes("company-auth/challenge"));
    if (!call) throw new Error("the challenge request was not made");
    const headers = call.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer handle-A");
    expect(headers["x-openbot-tenant"]).toBe("acme");
    expect(headers["x-openbot-workspace"]).toBe("acme-finance");
    const body = JSON.parse(String(call.init?.body)) as { tenantId: string; returnPath: string };
    expect(body.tenantId).toBe("acme");
    expect(body.returnPath.startsWith("/")).toBe(true);
    expect(body.returnPath).toContain("file-1");
  });

  test("a second beginChallenge while one is live returns the same flow, not a new challenge", async () => {
    const { client, store, fetch, browser } = world();
    await store.selectScope(ACME);
    client.pauseForReauth({ detail: { kind: "chat" } });
    fetch.answer(() => jsonResponse(200, CHALLENGE));
    const first = await client.beginChallenge();
    const second = await client.beginChallenge();
    expect(second?.challengeId).toBe(first?.challengeId);
    expect(browser.opened).toHaveLength(1);
    expect(fetch.calls.filter((c) => c.path.includes("challenge"))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The deep-link callback: the original intent, never the temporarily active
// ---------------------------------------------------------------------------

describe("T07.12: the callback binds the original intent", () => {
  test("a completed callback re-validates the ORIGINAL selection, not the active one", async () => {
    const { client, store, fetch } = world();
    await store.selectScope(ACME);
    client.pauseForReauth({ detail: { kind: "file", id: "file-1" } });
    fetch.answer(() => jsonResponse(200, CHALLENGE));
    await client.beginChallenge();
    // While the browser is out, the user (or a race) moves the store to
    // another scope — the temporarily ACTIVE selection is globex.
    await store.selectScope(GLOBEX);
    fetch.answer((path) =>
      path.includes("validate-selection")
        ? jsonResponse(200, { ok: true, ...ACME })
        : jsonResponse(500, {}),
    );
    const done = await client.completeCallback("openmuse://company-auth/done");
    expect(done?.status).toBe("validated");
    // The re-validation named the paused ACME selection — never globex.
    const validate = fetch.calls.find((c) => c.path.includes("validate-selection"));
    if (!validate) throw new Error("the re-validation request was not made");
    const validateHeaders = (validate.init?.headers ?? {}) as Record<string, string>;
    expect(validateHeaders["x-openbot-tenant"]).toBe("acme");
    const restore = done as { status: "validated"; restoreSelection: ScopeSelection };
    expect(restore.restoreSelection).toEqual(ACME);
  });

  test("old_account_callback_cannot_resume_mobile_scope", async () => {
    // The named counter-example: the account changed while the system browser
    // was out (another account completed the challenge, or the handle was
    // re-bound). The old scope must NOT resume, and the pending target dies.
    const { client, store, fetch } = world({ handle: "handle-A" });
    await store.selectScope(ACME);
    client.pauseForReauth({ detail: { kind: "file", id: "file-1" } });
    fetch.answer(() => jsonResponse(200, CHALLENGE));
    await client.beginChallenge();
    // The account changed: the BFF refuses the old handle's re-validation.
    fetch.answer(() => bffError(401, "ACCOUNT_CHANGED"));
    const outcome = await client.completeCallback("openmuse://company-auth/done");
    expect(outcome?.status).toBe("account-changed");
    let oldScopeResumed = false;
    if (outcome?.status === "validated") oldScopeResumed = true;
    expect(oldScopeResumed).toBe(false);
    // The flow is closed: a retry cannot ride the dead challenge.
    expect(client.pendingChallenge()).toBe(null);
    // And the identity must be cleared before any new flow may begin.
    expect(client.needsNewIdentity()).toBe(true);
  });

  test("a callback naming another intent never completes this flow", async () => {
    const { client, store, fetch } = world();
    await store.selectScope(ACME);
    client.pauseForReauth({ detail: { kind: "file", id: "file-1" } });
    fetch.answer(() => jsonResponse(200, CHALLENGE));
    await client.beginChallenge();
    // A callback for a different challenge (the temporarily active intent)
    // is ignored: no re-validation, the flow stays pending for the real one.
    const ignored = await client.completeCallback("openmuse://company-auth/done?intentId=ch-other");
    expect(ignored?.status).toBe("no-pending-challenge");
    expect(fetch.calls.some((c) => c.path.includes("validate-selection"))).toBe(false);
    expect(client.pendingChallenge()?.challengeId).toBe("ch-1");
  });

  test("a callback with no live challenge answers none-pending and resumes nothing", async () => {
    const { client } = world();
    const outcome = await client.completeCallback("openmuse://company-auth/done");
    expect(outcome?.status).toBe("no-pending-challenge");
  });
});

// ---------------------------------------------------------------------------
// The media half: tickets, never the storage URL
// ---------------------------------------------------------------------------

describe("T07.12: native media reads locate through tickets", () => {
  test("a ticket is minted per resource+method with the selection headers", async () => {
    const { client, store, fetch } = world();
    await store.selectScope(ACME);
    fetch.answer((path) =>
      path === "/api/media-tickets" ? jsonResponse(200, TICKET) : jsonResponse(404, {}),
    );
    const located = await client.mediaTicket(PDF_REQUEST);
    expect(located).toEqual(TICKET);
    const call = fetch.calls.find((c) => c.path === "/api/media-tickets");
    if (!call) throw new Error("the media ticket request was not made");
    const headers = call.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer handle-A");
    expect(headers["x-openbot-tenant"]).toBe("acme");
    const body = JSON.parse(String(call.init?.body)) as MediaTicketRequest;
    expect(body).toEqual(PDF_REQUEST);
  });

  test("revoked_mobile_pdf_cannot_retry_direct_storage", async () => {
    // The named counter-example: the BFF refuses the mint (revoked session,
    // expired ticket window, invisible resource — any refusal). The client
    // must answer a typed refusal and NEVER retry the bare storage/content
    // URL the old code fell back to.
    const { client, store, fetch } = world();
    await store.selectScope(ACME);
    const storageFallbackRequests: string[] = [];
    fetch.answer((path) => {
      // Count any bare content/storage retry the old code fell back to.
      if (path.includes("/api/files/") && !path.includes("media-tickets")) {
        storageFallbackRequests.push(path);
      }
      return bffError(401, "SESSION_REVOKED");
    });
    await expect(client.mediaTicket(PDF_REQUEST)).rejects.toMatchObject({
      code: "SESSION_REVOKED",
    });
    expect(storageFallbackRequests).toHaveLength(0);
    expect(fetch.calls.map((call) => call.path)).toEqual(["/api/media-tickets"]);
  });

  test("an expired ticket is re-minted instead of reused for the next pull", async () => {
    // A ≤60 s locator is not an authorization to reuse indefinitely: once
    // its window closes, the reader mints a new one rather than replaying a
    // stale URL the server would refuse.
    let clock = Date.parse("2026-11-04T12:00:00Z");
    const { client, store, fetch } = world({ now: () => clock });
    await store.selectScope(ACME);
    fetch.answer(() => jsonResponse(200, TICKET));
    const first = await client.mediaTicket(PDF_REQUEST);
    // Still inside the window: no second mint.
    expect(await client.mediaTicket(PDF_REQUEST)).toEqual(first);
    expect(fetch.calls.filter((c) => c.path === "/api/media-tickets")).toHaveLength(1);
    // Past the 60-second window: a fresh locator is minted.
    clock = Date.parse("2026-11-04T12:01:05Z");
    fetch.answer(() =>
      jsonResponse(200, {
        ...TICKET,
        url: `${TICKET.url}-fresh`,
        expiresAt: "2026-11-04T12:02:30Z",
      }),
    );
    const renewed = await client.mediaTicket(PDF_REQUEST);
    expect(renewed.url).toBe(`${TICKET.url}-fresh`);
    expect(fetch.calls.filter((c) => c.path === "/api/media-tickets")).toHaveLength(2);
  });

  test("a ticket is never reused across scope switches: the cache key names the scope", async () => {
    const { client, store } = world();
    await store.selectScope(ACME);
    const first = client.ticketCacheKey("/api/files/file-1/content");
    await store.selectScope(GLOBEX);
    const second = client.ticketCacheKey("/api/files/file-1/content");
    expect(first).not.toBe(second);
  });
});

// ---------------------------------------------------------------------------
// Logout / revocation: nothing private survives
// ---------------------------------------------------------------------------

describe("T07.12: logout clears media cache and pending tickets", () => {
  test("signOut drops every pending ticket and the media cache entries", async () => {
    const { client, store, fetch } = world();
    await store.selectScope(ACME);
    fetch.answer(() => jsonResponse(200, TICKET));
    await client.mediaTicket(PDF_REQUEST);
    // A pending challenge also exists; logout must kill it too.
    fetch.answer(() => jsonResponse(200, CHALLENGE));
    client.pauseForReauth({ detail: { kind: "chat" } });
    await client.beginChallenge();
    const dropped = client.signOut();
    expect(dropped.pendingTickets).toBe(1);
    expect(dropped.pendingChallenge).toBe(true);
    expect(client.pendingChallenge()).toBe(null);
    expect(client.mediaCacheIsEmpty()).toBe(true);
  });

  test("a scope switch alone keeps personal isolation: old scope media is absent", async () => {
    const { client, store, fetch } = world();
    await store.selectScope(ACME);
    fetch.answer(() => jsonResponse(200, TICKET));
    await client.mediaTicket(PDF_REQUEST);
    await store.selectScope(GLOBEX);
    expect(client.cachedTicket("/api/files/file-1/content")).toBe(null);
  });
});
