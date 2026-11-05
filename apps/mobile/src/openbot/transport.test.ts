// MT105 (Issue #148): the mobile transport carries the current company/team selection on its
// streams, uploads/downloads and media reads — and nothing else does. The attachment gates, the
// subscription lifecycle, the generation rule and the reconnect rule are the web transport's
// (MT082/MT083) re-expressed over the mobile tenancy store: this file pins them with the same
// fixture discipline. It imports nothing but bun:test and the adapter — AC-adjacent: the tests
// run in CI with no runtime beneath them.

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import {
  createTenancyStore,
  readWorkspaceScopeListing,
  type ScopeSelection,
  type ScopeStorage,
  scopeRefusalOf,
  WorkspaceScopeRefusedError,
} from "./tenancy";
import {
  createEnterpriseLogin,
  createScopeBoundStream,
  createScopedFetch,
  EnterpriseLoginRefused,
  mediaCacheKey,
  memoryPendingLoginStorage,
  pkceChallenge,
  readMediaCache,
  resolveMobileAuthConfig,
  SCOPE_HEADER_ALLOWED_PATHS,
  scopeHeaders,
  sha256,
  TENANT_HEADER,
  TenantSelectionChangedError,
  WORKSPACE_HEADER,
  withStreamScope,
  writeMediaCache,
} from "./transport";

const ACME: ScopeSelection = { tenantId: "acme", workspaceId: "acme-finance" };
const GLOBEX: ScopeSelection = { tenantId: "globex", workspaceId: "globex-ops" };

/** An in-memory storage stand-in, so the store's persistence mirror runs its real code in CI. */
function memoryStorage(): ScopeStorage {
  const slots = new Map<string, string>();
  return {
    getItem: (key: string) => slots.get(key) ?? null,
    setItem: (key: string, value: string) => {
      slots.set(key, value);
    },
  };
}

// ---------------------------------------------------------------------------
// AC1: the pair rides reviewed same-origin paths only
// ---------------------------------------------------------------------------

describe("scopeHeaders", () => {
  test("a reviewed REST path carries the pair as headers", () => {
    expect(scopeHeaders("/api/channels", ACME)).toEqual({
      [TENANT_HEADER]: "acme",
      [WORKSPACE_HEADER]: "acme-finance",
    });
    expect(scopeHeaders("/api/enterprise/workspace-scope", ACME)).toEqual({
      [TENANT_HEADER]: "acme",
      [WORKSPACE_HEADER]: "acme-finance",
    });
    // T07.10's first screen is the original Workspace read; it needs the pair too.
    expect(scopeHeaders("/api/workspace", ACME)).toEqual({
      [TENANT_HEADER]: "acme",
      [WORKSPACE_HEADER]: "acme-finance",
    });
  });

  test("an unreviewed path is left undecorated", () => {
    expect(scopeHeaders("/api/unreviewed/thing", ACME)).toBeNull();
    expect(scopeHeaders("/api/unreviewed", ACME)).toBeNull();
  });

  test("a non-same-origin path never receives the pair", () => {
    expect(scopeHeaders("https://elsewhere.example/api/agents", ACME)).toBeNull();
    expect(scopeHeaders("//api/agents", ACME)).toBeNull();
  });

  test("no selection attaches nothing — absence is carried as absence, never defaulted", () => {
    expect(scopeHeaders("/api/agents", null)).toBeNull();
  });

  test("every inventory entry names its owner and reason — a closed, reviewable list", () => {
    // Widening the list is a review, not an accident: each entry's owner names the ticket
    // that performed it (MT107's is the mobile-aggregation family's own review).
    const reviewedBy = ["MT105", "MT107", "T07.10"];
    for (const entry of SCOPE_HEADER_ALLOWED_PATHS) {
      expect(entry.id).toBeTruthy();
      expect(entry.prefix.startsWith("/api/")).toBe(true);
      expect(entry.reason.length).toBeGreaterThan(0);
      expect(reviewedBy).toContain(entry.ownerTicket);
    }
  });
});

describe("withStreamScope", () => {
  test("a reviewed stream path carries the pair as query, preserving what is already there", () => {
    expect(withStreamScope("/api/workshop/turn/1", ACME)).toBe(
      "/api/workshop/turn/1?x-openbot-tenant=acme&x-openbot-workspace=acme-finance",
    );
    expect(withStreamScope("/api/craft/session/1/events?cursor=7", ACME)).toBe(
      "/api/craft/session/1/events?cursor=7&x-openbot-tenant=acme&x-openbot-workspace=acme-finance",
    );
    expect(withStreamScope("/api/channels/events", ACME)).toBe(
      "/api/channels/events?x-openbot-tenant=acme&x-openbot-workspace=acme-finance",
    );
  });

  test("the pair is encoded — an id with a space is still one value", () => {
    expect(
      withStreamScope("/api/computers/1/screen", {
        tenantId: "ac me",
        workspaceId: "finance team",
      }),
    ).toBe("/api/computers/1/screen?x-openbot-tenant=ac%20me&x-openbot-workspace=finance%20team");
  });

  test("an unreviewed stream path, a foreign origin, and no selection all change nothing", () => {
    expect(withStreamScope("/api/other/stream", ACME)).toBe("/api/other/stream");
    expect(withStreamScope("wss://third.party/stream", ACME)).toBe(
      "wss://third.party/stream",
    );
    expect(withStreamScope("//echo/stream", ACME)).toBe("//echo/stream");
    expect(withStreamScope("/api/workshop/turn/1", null)).toBe(
      "/api/workshop/turn/1",
    );
  });
});

// ---------------------------------------------------------------------------
// AC3: an in-flight answer that outlived its selection is refused on arrival
// ---------------------------------------------------------------------------

describe("createScopedFetch", () => {
  test("the pair rides the request, and an answer that lands in time is accepted", async () => {
    const store = createTenancyStore({
      userId: "user-1",
      storage: memoryStorage(),
    });
    await store.selectScope(ACME);
    const seen: Array<{ url: string; headers: Record<string, string> | undefined }> = [];
    const scoped = createScopedFetch({
      store,
      fetchLike: async (url, init) => {
        seen.push({ url, headers: init?.headers });
        return new Response("{}", { status: 200 });
      },
    });
    const response = await scoped("/api/agents");
    expect(response.status).toBe(200);
    expect(seen[0]?.url).toBe("/api/agents");
    expect(seen[0]?.headers).toEqual({
      [TENANT_HEADER]: "acme",
      [WORKSPACE_HEADER]: "acme-finance",
    });
  });

  test("an answer that arrives after a switch is refused, never applied", async () => {
    const store = createTenancyStore({
      userId: "user-1",
      storage: memoryStorage(),
    });
    await store.selectScope(ACME);
    let answer: ((response: Response) => void) | null = null;
    const scoped = createScopedFetch({
      store,
      fetchLike: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    const inFlight = scoped("/api/agents");
    // The switch happens while the answer is in flight.
    await store.selectScope(GLOBEX);
    answer?.(new Response("{}", { status: 200 }));
    const error = await capture(inFlight);
    expect(error).toBeInstanceOf(TenantSelectionChangedError);
  });

  test("a pending scope source refuses before dialing — no read on a guess", async () => {
    const store = createTenancyStore({
      userId: undefined,
      storage: memoryStorage(),
    });
    const scoped = createScopedFetch({
      store,
      fetchLike: async () => {
        throw new Error("must not dial");
      },
    });
    const error = await capture(scoped("/api/agents"));
    expect(String(error)).toContain("scope source has not answered");
  });
});

// ---------------------------------------------------------------------------
// AC2: a switch tears the old subscription down and the old media cache is not served
// ---------------------------------------------------------------------------

describe("createScopeBoundStream", () => {
  function harness() {
    const store = createTenancyStore({
      userId: "user-1",
      storage: memoryStorage(),
    });
    const opened: string[] = [];
    const closed: string[] = [];
    const stream = createScopeBoundStream({
      store,
      open: (url) => {
        opened.push(url);
        return {
          close: () => {
            closed.push(url);
          },
        };
      },
    });
    return { store, stream, opened, closed };
  }

  test("opens under the current pair; refuses while the scope source is pending", async () => {
    const pending = createTenancyStore({
      userId: undefined,
      storage: memoryStorage(),
    });
    const stream = createScopeBoundStream({
      store: pending,
      open: () => {
        throw new Error("must not open");
      },
    });
    expect(stream.reopen("/api/workshop/turn/1")).toEqual({
      refused: "scope-pending",
    });

    const { store, stream: live, opened } = harness();
    await store.selectScope(ACME);
    const opened0 = live.reopen("/api/workshop/turn/1");
    expect(opened0).toMatchObject({ generation: expect.any(Number) });
    expect(opened[0]).toBe(
      "/api/workshop/turn/1?x-openbot-tenant=acme&x-openbot-workspace=acme-finance",
    );
  });

  test("a switch cancels the old subscription and the next open carries the NEW pair (AC2/AC4)", async () => {
    const { store, stream, opened, closed } = harness();
    await store.selectScope(ACME);
    stream.reopen("/api/workshop/turn/1");
    const keyBefore = stream.openedKey();

    await store.selectScope(GLOBEX);
    // The teardown signal, as the app's effect reads it: the live connection was opened under a
    // key the store has since left. The wrapper still names the old key — that IS the staleness.
    const scopeNow = store.scope();
    expect(scopeNow.status).toBe("open");
    if (scopeNow.status === "open") {
      expect(scopeNow.key).not.toBe(keyBefore);
    }
    expect(stream.openedKey()).toBe(keyBefore);
    // Reopening under the moved scope closes the old connection and carries the NEW pair.
    stream.reopen("/api/workshop/turn/1");
    expect(closed).toHaveLength(1);
    expect(opened[1]).toBe(
      "/api/workshop/turn/1?x-openbot-tenant=globex&x-openbot-workspace=globex-ops",
    );
    expect(stream.openedKey()).not.toBe(keyBefore);
  });

  test("a late frame from a torn-down connection is refused by the generation rule", async () => {
    const { store, stream } = harness();
    await store.selectScope(ACME);
    const { generation } = stream.reopen("/api/workshop/turn/1") as {
      generation: number;
    };
    expect(stream.frameStillCurrent(generation)).toBe(true);
    await store.selectScope(GLOBEX);
    // The frame's connection was opened under the old generation: dropped, not applied.
    expect(stream.frameStillCurrent(generation)).toBe(false);
  });

  test("a reconnect after a dropped line re-reads the CURRENT selection, never a default", async () => {
    const { store, stream, opened } = harness();
    await store.selectScope(ACME);
    stream.reopen("/api/workshop/turn/1");
    // The line drops; while it is down, the person switches scope.
    await store.selectScope(GLOBEX);
    stream.reopen("/api/workshop/turn/1");
    expect(opened[1]).toContain("x-openbot-tenant=globex");
    // And with no selection at all, the reconnected stream carries no pair at all — not a default.
    await store.selectScope(null);
    stream.reopen("/api/workshop/turn/1");
    expect(opened[2]).toBe("/api/workshop/turn/1");
  });
});

// ---------------------------------------------------------------------------
// AC2, the media half: the old scope's media cache is not served after a switch
// ---------------------------------------------------------------------------

describe("scoped media cache", () => {
  test("one URI is one entry per scope; after a switch the old scope's media is absent", async () => {
    const store = createTenancyStore({
      userId: "user-1",
      storage: memoryStorage(),
    });
    await store.selectScope(ACME);
    writeMediaCache(store, "/api/craft/file/1/media", { bytes: "acme-bytes" });
    expect(readMediaCache<{ bytes: string }>(store, "/api/craft/file/1/media")).toEqual({
      status: "present",
      value: { bytes: "acme-bytes" },
    });

    await store.selectScope(GLOBEX);
    // The same URI under the new scope is a miss — the old company's media does not display.
    expect(readMediaCache(store, "/api/craft/file/1/media")).toEqual({
      status: "absent",
    });
    writeMediaCache(store, "/api/craft/file/1/media", { bytes: "globex-bytes" });
    expect(readMediaCache<{ bytes: string }>(store, "/api/craft/file/1/media")).toEqual({
      status: "present",
      value: { bytes: "globex-bytes" },
    });

    // The personal context is its own shelf, in both directions.
    await store.selectScope(null);
    expect(readMediaCache(store, "/api/craft/file/1/media")).toEqual({
      status: "absent",
    });
  });

  test("the media key names the scope beside the URI", async () => {
    const store = createTenancyStore({
      userId: "user-1",
      storage: memoryStorage(),
    });
    await store.selectScope(ACME);
    expect(mediaCacheKey(store, "/media/1")).toBe(
      "media:acme/acme-finance:/media/1",
    );
    await store.selectScope(null);
    expect(mediaCacheKey(store, "/media/1")).toBe("media:personal:/media/1");
  });
});

// ---------------------------------------------------------------------------
// T07.10 (#600): the enterprise PKCE login and its one session handoff
// ---------------------------------------------------------------------------

const ENTERPRISE_AUTH_CONFIG = {
  mode: "enterprise" as const,
  apiOrigin: "https://bff.example",
  authorityOrigin: "https://auth.example",
  clientId: "openmuse-mobile",
  redirectUri: "openmuse://enterprise-auth",
};

describe("enterprise PKCE", () => {
  test("the SHA-256 digest and S256 challenge match Node's crypto on the FIPS vectors", () => {
    for (const text of [
      "",
      "abc",
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      "a".repeat(1000),
    ]) {
      const bytes = new TextEncoder().encode(text);
      expect(Buffer.from(sha256(bytes)).toString("hex")).toBe(
        createHash("sha256").update(text).digest("hex"),
      );
      expect(pkceChallenge(text)).toBe(createHash("sha256").update(text).digest("base64url"));
    }
  });

  test("a challenge is the unpadded base64url shape the authority accepts", () => {
    expect(pkceChallenge("verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pkceChallenge("verifier")).not.toContain("=");
  });
});

describe("enterprise configuration", () => {
  test("enterprise mode requires both explicit origins — no localhost fallback", () => {
    expect(() =>
      resolveMobileAuthConfig({ mode: "enterprise", apiOrigin: "https://bff.example" }, "ios"),
    ).toThrow(/EXPO_PUBLIC_OPENBOT_URL/);
    expect(() =>
      resolveMobileAuthConfig(
        { mode: "enterprise", authorityOrigin: "https://auth.example" },
        "android",
      ),
    ).toThrow(/EXPO_PUBLIC_API_URL/);
  });

  test("an explicit enterprise config keeps the two origins and the registered callback", () => {
    const config = resolveMobileAuthConfig(
      {
        mode: "enterprise",
        apiOrigin: "https://bff.example/",
        authorityOrigin: "https://auth.example/",
        clientId: "openmuse-mobile",
        redirectUri: "openmuse://enterprise-auth",
      },
      "web",
    );
    expect(config).toEqual(ENTERPRISE_AUTH_CONFIG);
  });

  test("the unset mode is legacy, never a silent enterprise/standalone switch", () => {
    expect(resolveMobileAuthConfig({}, "ios").mode).toBe("legacy");
    expect(resolveMobileAuthConfig({ mode: "standalone" }, "ios").mode).toBe("standalone");
  });
});

describe("enterprise session handoff", () => {
  test("mobile_real_app_uses_enterprise_session_handoff", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const login = createEnterpriseLogin({
      config: ENTERPRISE_AUTH_CONFIG,
      storage: memoryPendingLoginStorage(),
      randomBytes: () => new Uint8Array(32).fill(7),
      fetchLike: async (url, init) => {
        requests.push({ url, init });
        return new Response(
          JSON.stringify({
            token: "handle-1",
            mode: "live",
            authMode: "enterprise",
            authority: "https://auth.example",
            expiresAt: "2030-01-01T00:00:00.000Z",
            user: { id: "user-1", principalId: "principal-1" },
            scope: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    const pending = login.begin();
    const authorize = new URL(pending.authorizeUrl);
    expect(authorize.origin).toBe("https://auth.example");
    expect(authorize.pathname).toBe("/api/enterprise/mobile/authorize");
    expect(authorize.searchParams.get("client_id")).toBe("openmuse-mobile");
    expect(authorize.searchParams.get("redirect_uri")).toBe("openmuse://enterprise-auth");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("code_challenge")).toBe(pkceChallenge(pending.codeVerifier));

    const session = await login.complete(
      `openmuse://enterprise-auth?code=one-time-code&state=${encodeURIComponent(pending.state)}&intentId=intent-1`,
    );

    // The real app's session body is the frozen EnterpriseSessionInput, sent
    // to the BFF origin — never to the authority and never with an accessKey.
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://bff.example/api/session");
    const body = JSON.parse(String(requests[0]?.init?.body)) as Record<string, unknown>;
    expect(body.authMode).toBe("enterprise");
    expect(body.intentId).toBe("intent-1");
    expect(body.code).toBe("one-time-code");
    expect(body.codeVerifier).toBe(pending.codeVerifier);
    expect(body.redirectUri).toBe("openmuse://enterprise-auth");
    expect("accessKey" in body).toBe(false);
    expect(session.token).toBe("handle-1");
    expect(session.authority).toBe("https://auth.example");
  });

  test("enterprise_login_failure_never_tries_access_key", async () => {
    const standaloneRequests: unknown[] = [];
    const requestUrls: string[] = [];
    const login = createEnterpriseLogin({
      config: ENTERPRISE_AUTH_CONFIG,
      storage: memoryPendingLoginStorage(),
      randomBytes: () => new Uint8Array(32).fill(3),
      fetchLike: async (url, init) => {
        requestUrls.push(url);
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        if ("accessKey" in body || "owner" in body) standaloneRequests.push(body);
        return new Response(
          JSON.stringify({ error: "Request refused.", code: "SESSION_REVOKED", requestId: "r-1" }),
          { status: 401, headers: { "content-type": "application/json" } },
        );
      },
    });

    const pending = login.begin();
    const error = await capture(
      login.complete(
        `openmuse://enterprise-auth?code=c&state=${encodeURIComponent(pending.state)}&intentId=i`,
      ),
    );
    expect(error).toBeInstanceOf(EnterpriseLoginRefused);
    expect((error as EnterpriseLoginRefused).code).toBe("SESSION_REVOKED");
    expect(standaloneRequests).toHaveLength(0);
    expect(requestUrls).toEqual(["https://bff.example/api/session"]);
  });

  test("a foreign state or an unregistered redirect never reaches the exchange", async () => {
    let dialed = 0;
    const login = createEnterpriseLogin({
      config: ENTERPRISE_AUTH_CONFIG,
      storage: memoryPendingLoginStorage(),
      randomBytes: () => new Uint8Array(32).fill(5),
      fetchLike: async () => {
        dialed += 1;
        return new Response("{}", { status: 200 });
      },
    });
    const pending = login.begin();
    const badState = await capture(
      login.complete("openmuse://enterprise-auth?code=c&state=other&intentId=i"),
    );
    expect(badState).toBeInstanceOf(EnterpriseLoginRefused);
    expect((badState as EnterpriseLoginRefused).code).toBe("STATE_MISMATCH");
    const badRedirect = await capture(
      login.complete(
        `openmuse://elsewhere?code=c&state=${encodeURIComponent(pending.state)}&intentId=i`,
      ),
    );
    expect(badRedirect).toBeInstanceOf(EnterpriseLoginRefused);
    expect((badRedirect as EnterpriseLoginRefused).code).toBe("REDIRECT_MISMATCH");
    expect(dialed).toBe(0);
  });

  test("the scope listing reads the MobileBffError's flat refusal code", async () => {
    const error = await capture(
      readWorkspaceScopeListing(
        async () =>
          new Response(
            JSON.stringify({
              error: "Request refused.",
              code: "SESSION_EXPIRED",
              requestId: "r-1",
            }),
            { status: 401, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    expect(error).toBeInstanceOf(WorkspaceScopeRefusedError);
    expect(scopeRefusalOf(error)?.status).toBe(401);
    expect(scopeRefusalOf(error)?.code).toBe("SESSION_EXPIRED");
  });

  test("a session minted for another authority is refused, not adopted", async () => {
    const login = createEnterpriseLogin({
      config: ENTERPRISE_AUTH_CONFIG,
      storage: memoryPendingLoginStorage(),
      randomBytes: () => new Uint8Array(32).fill(4),
      fetchLike: async () =>
        new Response(
          JSON.stringify({
            token: "handle-1",
            mode: "live",
            authMode: "enterprise",
            authority: "https://old.example",
            expiresAt: "2030-01-01T00:00:00.000Z",
            user: { id: "user-1", principalId: null },
            scope: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });
    const pending = login.begin();
    const error = await capture(
      login.complete(
        `openmuse://enterprise-auth?code=c&state=${encodeURIComponent(pending.state)}&intentId=i`,
      ),
    );
    expect(error).toBeInstanceOf(EnterpriseLoginRefused);
    expect((error as EnterpriseLoginRefused).code).toBe("AUTHORITY_MISMATCH");
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function capture(
  run: Promise<unknown> | (() => Promise<unknown>),
): Promise<unknown> {
  try {
    await (typeof run === "function" ? run() : run);
    return null;
  } catch (error) {
    return error;
  }
}
