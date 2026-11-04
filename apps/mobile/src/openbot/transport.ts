/*
 * The mobile tenancy adapter's transport half, MT105 (Issue #148).
 *
 * THE RULES ARE THE WEB TRANSPORT'S, in both registers. The REST register is `client.ts`'s: the
 * selection pair rides as HEADERS (`x-openbot-tenant`, `x-openbot-workspace`) on reviewed
 * same-origin business paths only — a closed inventory, each entry owned by the ticket that
 * reviewed it, never widened by accident. The stream register is `stream-scope.ts`'s: a streaming
 * connection cannot carry request headers (an SSE read, a WebSocket upgrade), so on those surfaces
 * the SAME pair rides the URL's query under the same two names, on the same kind of closed
 * inventory — one vocabulary, so the server-side wiring (MT125) reads one set of names wherever
 * the connection came from.
 *
 * THE LIFECYCLE HALF IS THE TICKET'S REAL SUBJECT, as it was MT082's: a stream that outlives its
 * scope is a pipe pushing one company's events into a screen that has moved on, and a media cache
 * that outlives its scope is yesterday's company file one tap away. So every business connection
 * this module serves is bound to the tenancy store's live scope: it opens only once the scope
 * source has resolved (never on a guess), is torn down when the scope moves, re-reads the CURRENT
 * selection at every (re)connect — a dropped line that comes back answers under the scope that is
 * current THEN, never a defaulted one (spec A6) — and every answer is checked against the
 * generation it left under, so an in-flight response that lands after a switch is refused rather
 * than applied (the same `stillCurrent` rule the web streams and caches share).
 */

import type { ScopeSelection, TenancyStore } from "./tenancy";

/** The header names, identical to the web client's — one vocabulary across clients. */
export const TENANT_HEADER = "x-openbot-tenant";
export const WORKSPACE_HEADER = "x-openbot-workspace";

/** One reviewed REST path the selection pair may ride as headers. */
export interface ScopeHeaderPathEntry {
  readonly id: string;
  readonly prefix: string;
  readonly reason: string;
  readonly ownerTicket: string;
}

/**
 * The closed inventory of reviewed same-origin REST paths the mobile client may carry the
 * selection pair on (MT105 / Issue #148).
 *
 * The families are the same ones the web client's inventory reviews (`client.ts`, MT081 onward):
 * the mobile app is another client of the same deployment API, so the review that admitted a
 * family on the web admits the mobile client onto it — and a family neither ticket reviewed stays
 * undecorated until one does. Widening this list is a review, not an accident.
 */
export const SCOPE_HEADER_ALLOWED_PATHS: readonly ScopeHeaderPathEntry[] = [
  {
    id: "workspace-rest",
    prefix: "/api/workspace",
    reason:
      "the enterprise BFF's original Workspace read (T07.10): the response is the OpenMuse Workspace contract, and the verified company/team selection is what the server's one admitted scope requires on it",
    ownerTicket: "T07.10",
  },
  {
    id: "enterprise-api",
    prefix: "/api/enterprise/",
    reason:
      "the enterprise API is the scope middleware's own surface: it resolves the selection pair into a trusted scope (MT005 ruling #1 — the headers only select; database membership decides)",
    ownerTicket: "MT105",
  },
  {
    id: "agents-rest",
    prefix: "/api/agents",
    reason:
      "the coworker surface's reads and writes, the same family the web review admitted (MT084); the server consumes the pair when the legacy assembly reads it (MT125)",
    ownerTicket: "MT105",
  },
  {
    id: "team-bots-rest",
    prefix: "/api/team-bots",
    reason:
      "the Team Bot publication surface, the same family the web review admitted (MT085)",
    ownerTicket: "MT105",
  },
  {
    id: "approvals-rest",
    prefix: "/api/approvals",
    reason:
      "the approval surface, the same family the web review admitted (MT086)",
    ownerTicket: "MT105",
  },
  {
    id: "responsibilities-rest",
    prefix: "/api/responsibilities",
    reason:
      "the standing-responsibility surface, the same family the web review admitted (MT086)",
    ownerTicket: "MT105",
  },
  {
    id: "computers-rest",
    prefix: "/api/computers",
    reason:
      "the computer surface — the fleet, its action boundary and the live screen it streams, the same family the web review admitted (MT086)",
    ownerTicket: "MT105",
  },
  {
    id: "channels-rest",
    prefix: "/api/channels",
    reason:
      "the conversation surface — roster, detail, attachments and member writes, the same family the web review admitted (MT087)",
    ownerTicket: "MT105",
  },
  {
    id: "groups-rest",
    prefix: "/api/groups",
    reason:
      "the group-conversation surface, the same family the web review admitted (MT087)",
    ownerTicket: "MT105",
  },
  {
    id: "plugins-rest",
    prefix: "/api/plugins",
    reason:
      "the plugin surface, the same family the web review admitted (MT088)",
    ownerTicket: "MT105",
  },
  {
    id: "memory-rest",
    prefix: "/api/memory",
    reason:
      "the personal/company memory surface, the same family the web review admitted",
    ownerTicket: "MT105",
  },
  {
    id: "routines-rest",
    prefix: "/api/routines",
    reason:
      "the routine surface, the same family the web review admitted",
    ownerTicket: "MT105",
  },
  {
    id: "craft-rest",
    prefix: "/api/craft",
    reason:
      "the craft surface — sessions, files, artifacts and their downloads, the same family the web review admitted",
    ownerTicket: "MT105",
  },
  {
    id: "workshop-rest",
    prefix: "/api/workshop",
    reason:
      "the workshop surface — turns, artifacts and their uploads/downloads, the same family the web review admitted",
    ownerTicket: "MT105",
  },
  {
    id: "marketplace-rest",
    prefix: "/api/marketplace",
    reason:
      "the marketplace surface, the same family the web review admitted",
    ownerTicket: "MT105",
  },
  {
    id: "components-rest",
    prefix: "/api/components",
    reason:
      "the component surface, the same family the web review admitted",
    ownerTicket: "MT105",
  },
  {
    id: "billing-rest",
    prefix: "/api/billing",
    reason:
      "the billing surface, the same family the web review admitted (MT097)",
    ownerTicket: "MT105",
  },
  {
    id: "voice-mobile-aggregate-rest",
    prefix: "/api/voice/mobile",
    reason:
      "the mobile aggregation snapshot surface — the BFF shape MT066's readMobileAggregate answers behind the voice family, whose every sub-query must answer under the scope the client currently holds. The review admitting the family is MT107's own ticket; the server's HTTP wiring of the exact route lands with MT125, and the client pair rides the moment it does",
    ownerTicket: "MT107",
  },
];

/** One reviewed stream path the selection pair may ride as query parameters. */
export interface ScopeStreamPathEntry {
  readonly id: string;
  readonly prefix: string;
  readonly reason: string;
  readonly ownerTicket: string;
}

/**
 * The closed inventory of reviewed same-origin stream paths the mobile client may carry the
 * selection pair on — the same five connection families the web inventory reviews (MT082),
 * because the mobile app opens the same streams against the same deployment.
 */
export const SCOPE_STREAM_ALLOWED_PATHS: readonly ScopeStreamPathEntry[] = [
  {
    id: "workshop-turn-events",
    prefix: "/api/workshop/",
    reason:
      "the workshop turn stream: an SSE read, which cannot carry request headers, so the pair rides the query on the one URL family this stream opens",
    ownerTicket: "MT105",
  },
  {
    id: "craft-turn-events",
    prefix: "/api/craft/",
    reason:
      "the craft session's turn and scheduled-run stream reads: same connection family as the workshop stream",
    ownerTicket: "MT105",
  },
  {
    id: "channel-roster-events",
    prefix: "/api/channels/events",
    reason:
      "the channel roster's event stream: an upgrade or SSE read, which cannot carry request headers, so the pair rides the query",
    ownerTicket: "MT105",
  },
  {
    id: "computer-screen-stream",
    prefix: "/api/computers/",
    reason:
      "the live computer screen stream: an upgrade request, which cannot carry request headers, so the pair rides the query",
    ownerTicket: "MT105",
  },
  {
    id: "voice-call-establishment",
    prefix: "/api/voice/calls",
    reason:
      "the POST that establishes a voice call — the stream's subscription moment; the realtime socket it returns is a third-party origin and never receives the pair",
    ownerTicket: "MT105",
  },
];

/** Whether a path is same-origin shaped for this client: a root-relative path, not protocol-relative. */
function sameOriginPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//");
}

/**
 * The header half of the pair, for REST-shaped requests (fetch can carry headers).
 *
 * `null` (personal context: no company/team selected) attaches NOTHING — a missing selection is
 * carried as absent, never defaulted. A path outside the inventory, or one that is not a
 * same-origin relative path, is left undecorated: the pair must not leak onto a surface no ticket
 * reviewed (AC1).
 */
export function scopeHeaders(
  path: string,
  selection: ScopeSelection | null,
): Record<string, string> | null {
  if (selection === null) return null;
  if (!sameOriginPath(path)) return null;
  const bare = path.split("?")[0] as string;
  if (
    !SCOPE_HEADER_ALLOWED_PATHS.some((entry) => bare.startsWith(entry.prefix))
  ) {
    return null;
  }
  return {
    [TENANT_HEADER]: selection.tenantId,
    [WORKSPACE_HEADER]: selection.workspaceId,
  };
}

/**
 * The query half of the pair, for stream-shaped connections (SSE reads and WebSocket upgrades
 * cannot carry request headers).
 *
 * Same gates as `scopeHeaders`: same-origin relative paths on the reviewed stream inventory only,
 * existing query parameters preserved (a stream's resume cursor rides the same URL), and a `null`
 * selection changes nothing at all.
 */
export function withStreamScope(
  path: string,
  selection: ScopeSelection | null,
): string {
  if (selection === null) return path;
  if (!sameOriginPath(path)) return path;
  const queryAt = path.indexOf("?");
  const bare = queryAt === -1 ? path : path.slice(0, queryAt);
  if (
    !SCOPE_STREAM_ALLOWED_PATHS.some((entry) => bare.startsWith(entry.prefix))
  ) {
    return path;
  }
  const pair =
    `${TENANT_HEADER}=${encodeURIComponent(selection.tenantId)}` +
    `&${WORKSPACE_HEADER}=${encodeURIComponent(selection.workspaceId)}`;
  return queryAt === -1 ? `${path}?${pair}` : `${path}&${pair}`;
}

/**
 * The typed refusal an answer earns when it outlived its scope — the mobile name for the web's
 * `TenantSelectionChangedError`, message included: an answer that arrives after the switch is
 * dropped, never applied to the scope that replaced the one it was asked under (AC3).
 */
export class TenantSelectionChangedError extends Error {
  constructor() {
    super("That answer outlived the tenant it was asked under.");
    this.name = "TenantSelectionChangedError";
  }
}

/**
 * One scope-bound fetch: the pair rides the URL as headers (REST) or query (streams) per the two
 * inventories, and the answer is refused on arrival if the generation moved while it was in
 * flight.
 *
 * `fetchLike` is injected (the app's fetch, a test's stand-in) so the rule runs identically in CI
 * with no runtime beneath it. A pending scope source refuses before dialing: a business read is
 * not established on a guess.
 */
/** The request init a scoped fetch hands its own transport: headers stay a plain record. */
export type ScopedRequestInit = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
};

export function createScopedFetch(options: {
  store: TenancyStore;
  fetchLike: (input: string, init?: ScopedRequestInit) => Promise<Response>;
}): (path: string, init?: RequestInit) => Promise<Response> {
  return async (path, init) => {
    const scope = options.store.scope();
    if (scope.status === "pending") {
      throw new Error("The scope source has not answered yet.");
    }
    const at = scope.generation;
    const headers = scopeHeaders(path, scope.selection);
    const streamPath = withStreamScope(path, scope.selection);
    const requestInit = {
      ...init,
      ...(headers === null
        ? {}
        : {
            headers: {
              ...(init?.headers as Record<string, string> | undefined),
              ...headers,
            },
          }),
    } as ScopedRequestInit;
    const response = await options.fetchLike(streamPath, requestInit);
    if (!options.store.stillCurrent(at)) {
      throw new TenantSelectionChangedError();
    }
    return response;
  };
}

/**
 * A stream subscription bound to the live scope (AC2/AC4).
 *
 * `open(url)` is the app's connection factory (its EventSource/WebSocket adapter); this wrapper
 * owns WHEN it opens and when it tears down: never while the scope source is pending, always
 * under the CURRENT selection at (re)connect — never a defaulted one — and torn down the moment
 * the scope key moves (a pair change or a generation advance, i.e. a switch anywhere), with the
 * old connection's late frames dropped by the generation check `frameStillCurrent`.
 *
 * The app drives reconnects itself (its runtime owns backoff); every reconnect calls `reopen()`,
 * which re-reads the scope world fresh — a dropped line that comes back answers under the scope
 * that is current THEN (AC4).
 */
export function createScopeBoundStream(options: {
  store: TenancyStore;
  open: (url: string) => { close: () => void };
}): {
  /** Open (or reopen) under the current scope; refuses while the scope source is pending. */
  reopen: (path: string) => { url: string; generation: number } | { refused: "scope-pending" };
  /** Tear the live connection down, if one is open. */
  close: () => void;
  /** The scope key the live connection was opened under, for change detection. */
  openedKey: () => string | null;
  /** Whether a frame from the live connection may still be applied (the generation rule). */
  frameStillCurrent: (generation: number) => boolean;
} {
  let live: { connection: { close: () => void }; key: string; generation: number } | null = null;
  return {
    reopen(path) {
      const scope = options.store.scope();
      if (scope.status === "pending") return { refused: "scope-pending" };
      // Reconnects answer under the CURRENT selection — never the one the dropped line had.
      live?.connection.close();
      const url = withStreamScope(path, scope.selection);
      live = {
        connection: options.open(url),
        key: scope.key,
        generation: scope.generation,
      };
      return { url, generation: scope.generation };
    },
    close() {
      live?.connection.close();
      live = null;
    },
    openedKey() {
      return live?.key ?? null;
    },
    frameStillCurrent(generation) {
      // A frame from a connection opened at `generation` may not decorate a screen whose scope
      // has since moved — the belt for a frame already in flight through the teardown.
      return live !== null && live.generation === generation && options.store.stillCurrent(generation);
    },
  };
}

/**
 * The media cache key for one URI: names the user's scope beside the URI itself, so the same
 * company file cached under two scopes is two entries, and an entry filed under one scope is
 * simply not found after a switch (AC2: the old scope's media is no longer served).
 *
 * Filed through the tenancy store's own bucket (the same prefix a switch drops wholesale), so
 * media isolation rides the SAME removal discipline as every other business entry — no second
 * cache to keep in step.
 */
export function mediaCacheKey(store: TenancyStore, uri: string): string {
  return `media:${store.cachePrefix()}:${uri}`;
}

/** Read one URI's cached media bytes through the store (absent after a switch, by the store's rule). */
export function readMediaCache<T>(
  store: TenancyStore,
  uri: string,
): { status: "present"; value: T } | { status: "absent" } {
  return store.read<T>(mediaCacheKey(store, uri));
}

/** Cache one URI's media under the current scope only. */
export function writeMediaCache(
  store: TenancyStore,
  uri: string,
  value: unknown,
): void {
  store.write(mediaCacheKey(store, uri), value);
}

// ---------------------------------------------------------------------------
// T07.10 (#600): the enterprise PKCE session handoff
// ---------------------------------------------------------------------------
//
// The rule the issue fixes: the app's authority origin and its BFF API origin
// are deployment configuration, never a user header or a body field, and the
// enterprise supply has no standalone fallback. This module owns the pure half
// — the PKCE pair, the authorize URL, the callback check and the one frozen
// EnterpriseSessionInput POST — so the app and its tests run the SAME code
// with no runtime beneath it. The app opens the system browser and injects the
// fetch; nothing here imports react-native or expo.

/**
 * The explicit mode a deployment configures for the mobile client. `legacy`
 * is the unset value: the existing OpenBot-direct app keeps booting exactly as
 * before, and only an explicitly configured enterprise deployment takes the
 * authority + BFF handoff.
 */
export type MobileAuthMode = "enterprise" | "standalone" | "legacy";

/** The deployment-controlled configuration one mobile client runs with. */
export interface MobileAuthConfig {
  readonly mode: MobileAuthMode;
  /** The OpenMuse BFF origin every business request goes to. */
  readonly apiOrigin: string;
  /** The OpenBot authority origin only the browser handoff touches. */
  readonly authorityOrigin: string;
  readonly clientId: string;
  readonly redirectUri: string;
}

/** The environment knobs the config resolver reads (Expo inlines EXPO_PUBLIC_* literals). */
export interface MobileAuthEnvironment {
  readonly mode?: string;
  readonly apiOrigin?: string;
  readonly authorityOrigin?: string;
  readonly clientId?: string;
  readonly redirectUri?: string;
}

const DEFAULT_CLIENT_ID = "openmuse-mobile";
const DEFAULT_REDIRECT_URI = "openmuse://enterprise-auth";

function mobileDefaultOrigin(platform: "web" | "ios" | "android"): string {
  return platform === "android" ? "http://10.0.2.2:8787" : "http://localhost:8787";
}

/**
 * One origin, validated: a full http(s) URL with no credentials, query,
 * fragment or path. A path prefix would be silently dropped by every
 * `new URL(path, origin)` below, so it is refused instead.
 */
function mobileOrigin(name: string, value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(`${name} must be a full URL, e.g. https://openbot.example.com`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash)
    throw new Error(`${name} must not carry credentials, query, or fragment.`);
  if (parsed.pathname !== "/")
    throw new Error(`${name} must be origin-only: it must not include a path.`);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    throw new Error(`${name} must use http(s).`);
  return parsed.origin;
}

function redirectUriOf(value: string | undefined): string {
  const raw = value?.trim() || DEFAULT_REDIRECT_URI;
  try {
    // Custom app schemes parse here; the server's registration decides
    // whether this deployment accepts one.
    return new URL(raw).toString();
  } catch {
    throw new Error(
      "EXPO_PUBLIC_MOBILE_REDIRECT_URI must be an absolute URI, e.g. openmuse://enterprise-auth",
    );
  }
}

/**
 * Resolve the one mobile client configuration. Enterprise mode requires BOTH
 * origins to be supplied by the deployment — there is deliberately no
 * localhost fallback, because a fallback would be exactly the silent switch to
 * an old origin the spec forbids. Standalone keeps the legacy defaults.
 */
export function resolveMobileAuthConfig(
  environment: MobileAuthEnvironment,
  platform: "web" | "ios" | "android",
): MobileAuthConfig {
  const declared = environment.mode?.trim().toLowerCase();
  if (
    declared !== undefined &&
    declared !== "" &&
    declared !== "enterprise" &&
    declared !== "standalone"
  )
    throw new Error('EXPO_PUBLIC_MOBILE_AUTH_MODE must be "enterprise" or "standalone".');
  const mode: MobileAuthMode =
    declared === "enterprise" ? "enterprise" : declared === "standalone" ? "standalone" : "legacy";
  const clientId = environment.clientId?.trim() || DEFAULT_CLIENT_ID;
  const redirectUri = redirectUriOf(environment.redirectUri);

  if (mode !== "enterprise") {
    const fallback = mobileDefaultOrigin(platform);
    return {
      mode,
      // Standalone is the explicit legacy deployment; its old defaults are
      // preserved so an unrelated legacy boot does not fail on new config.
      apiOrigin: mobileOrigin("EXPO_PUBLIC_API_URL", environment.apiOrigin?.trim() || fallback),
      authorityOrigin: mobileOrigin(
        "EXPO_PUBLIC_OPENBOT_URL",
        environment.authorityOrigin?.trim() || fallback,
      ),
      clientId,
      redirectUri,
    };
  }

  if (!environment.apiOrigin?.trim())
    throw new Error(
      "EXPO_PUBLIC_MOBILE_AUTH_MODE=enterprise requires EXPO_PUBLIC_API_URL (the OpenMuse BFF origin).",
    );
  if (!environment.authorityOrigin?.trim())
    throw new Error(
      "EXPO_PUBLIC_MOBILE_AUTH_MODE=enterprise requires EXPO_PUBLIC_OPENBOT_URL (the OpenBot authority origin).",
    );
  return {
    mode,
    apiOrigin: mobileOrigin("EXPO_PUBLIC_API_URL", environment.apiOrigin),
    authorityOrigin: mobileOrigin("EXPO_PUBLIC_OPENBOT_URL", environment.authorityOrigin),
    clientId,
    redirectUri,
  };
}

// -- PKCE S256 --------------------------------------------------------------
//
// React Native has no WebCrypto `subtle` (react-native-get-random-values only
// supplies getRandomValues), so the digest is computed here. This is a public
// SHA-256 transcript, not a secret operation: the output is the PKCE challenge
// the authority publishes. The implementation is pinned against Node's
// crypto in transport.test.ts, including the FIPS vectors.

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/** SHA-256 over raw bytes (FIPS 180-4), the one primitive PKCE S256 needs. */
export function sha256(bytes: Uint8Array): Uint8Array {
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index++) words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index++) {
      const previous15 = words[index - 15] as number;
      const previous2 = words[index - 2] as number;
      const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
      words[index] =
        ((words[index - 16] as number) + sigma0 + (words[index - 7] as number) + sigma1) >>> 0;
    }
    let a = hash[0] as number;
    let b = hash[1] as number;
    let c = hash[2] as number;
    let d = hash[3] as number;
    let e = hash[4] as number;
    let f = hash[5] as number;
    let g = hash[6] as number;
    let h = hash[7] as number;
    for (let index = 0; index < 64; index++) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 =
        (h + sum1 + choice + (SHA256_K[index] as number) + (words[index] as number)) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = ((hash[0] as number) + a) >>> 0;
    hash[1] = ((hash[1] as number) + b) >>> 0;
    hash[2] = ((hash[2] as number) + c) >>> 0;
    hash[3] = ((hash[3] as number) + d) >>> 0;
    hash[4] = ((hash[4] as number) + e) >>> 0;
    hash[5] = ((hash[5] as number) + f) >>> 0;
    hash[6] = ((hash[6] as number) + g) >>> 0;
    hash[7] = ((hash[7] as number) + h) >>> 0;
  }

  const digest = new Uint8Array(32);
  const digestView = new DataView(digest.buffer);
  for (let index = 0; index < 8; index++) digestView.setUint32(index * 4, hash[index] as number);
  return digest;
}

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Unpadded base64url, the encoding both the challenge and the state use. */
export function base64url(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] as number;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    output += BASE64URL[first >> 2];
    output +=
      BASE64URL[((first & 0x03) << 4) | (second === undefined ? 0 : (second as number) >> 4)];
    if (second !== undefined)
      output +=
        BASE64URL[((second & 0x0f) << 2) | (third === undefined ? 0 : (third as number) >> 6)];
    if (third !== undefined) output += BASE64URL[third & 0x3f];
  }
  return output;
}

/** The PKCE S256 challenge for one verifier (43 unpadded base64url chars). */
export function pkceChallenge(verifier: string): string {
  const bytes = new Uint8Array(verifier.length);
  for (let index = 0; index < verifier.length; index++)
    bytes[index] = verifier.charCodeAt(index) & 0xff;
  return base64url(sha256(bytes));
}

/** The deployment's secure random source; injected in tests, never Math.random. */
export function secureRandomBytes(length: number): Uint8Array {
  const source = (
    globalThis as {
      crypto?: { getRandomValues?: (bytes: Uint8Array) => Uint8Array };
    }
  ).crypto;
  if (!source?.getRandomValues)
    throw new Error("A secure random source is required for the login handoff.");
  const bytes = new Uint8Array(length);
  source.getRandomValues(bytes);
  return bytes;
}

// -- The one-time handoff ----------------------------------------------------

/** The frozen EnterpriseSessionInput (interfaces §5.2); no accessKey field exists. */
export interface EnterpriseSessionInput {
  readonly authMode: "enterprise";
  readonly intentId: string;
  readonly code: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
}

/** A validated selection the authority already checked. */
export interface EnterpriseSessionScope {
  readonly tenantId: string;
  readonly workspaceId: string | null;
  readonly capabilities?: readonly string[];
}

/** The frozen EnterpriseSessionResponse (interfaces §5.2). */
export interface EnterpriseSessionResponse {
  readonly token: string;
  readonly mode: "live";
  readonly authMode: "enterprise";
  readonly authority: string;
  readonly expiresAt: string;
  readonly user: Readonly<{ id: string; principalId: string | null }>;
  readonly scope: EnterpriseSessionScope | null;
}

/** A typed refusal from the handoff; the code is the server's closed vocabulary. */
export class EnterpriseLoginRefused extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(`The enterprise login was refused (${status} ${code}).`);
    this.name = "EnterpriseLoginRefused";
  }
}

/** Where a pending PKCE pair is kept across the browser trip (web reloads). */
export interface PendingLoginStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const ENTERPRISE_PENDING_STORAGE_KEY = "openbot.enterprise-pending-login.v1";

export function memoryPendingLoginStorage(): PendingLoginStorage {
  const slots = new Map<string, string>();
  return {
    getItem: (key) => slots.get(key) ?? null,
    setItem: (key, value) => {
      slots.set(key, value);
    },
    removeItem: (key) => {
      slots.delete(key);
    },
  };
}

/** What `begin()` hands the app: the URL to open and the state it must see back. */
export interface EnterprisePendingLogin {
  readonly authorizeUrl: string;
  readonly state: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
}

interface StoredPendingLogin extends EnterprisePendingLogin {}

function sameRedirectUri(callback: URL, redirect: URL): boolean {
  return (
    callback.protocol === redirect.protocol &&
    callback.host === redirect.host &&
    callback.pathname === redirect.pathname
  );
}

/**
 * Read and check one callback URL against the pending login: it must be the
 * registered redirect, its `state` must be the one this client generated, and
 * code/intentId must be present. A callback for another authority or another
 * state is refused before any exchange could consume the code.
 */
export function readEnterpriseCallback(
  callbackUrl: string,
  pending: Pick<EnterprisePendingLogin, "state" | "redirectUri">,
): { code: string; intentId: string } {
  let callback: URL;
  try {
    callback = new URL(callbackUrl);
  } catch {
    throw new EnterpriseLoginRefused("INVALID_CALLBACK", 400);
  }
  let redirect: URL;
  try {
    redirect = new URL(pending.redirectUri);
  } catch {
    throw new EnterpriseLoginRefused("INVALID_CALLBACK", 400);
  }
  if (!sameRedirectUri(callback, redirect))
    throw new EnterpriseLoginRefused("REDIRECT_MISMATCH", 400);
  const state = callback.searchParams.get("state");
  if (state === null || state !== pending.state)
    throw new EnterpriseLoginRefused("STATE_MISMATCH", 400);
  const code = callback.searchParams.get("code");
  const intentId = callback.searchParams.get("intentId");
  if (!code || !intentId) throw new EnterpriseLoginRefused("INVALID_CALLBACK", 400);
  return { code, intentId };
}

function readSessionResponse(value: unknown, authorityOrigin: string): EnterpriseSessionResponse {
  if (value === null || typeof value !== "object")
    throw new EnterpriseLoginRefused("INVALID_SESSION", 200);
  const record = value as Record<string, unknown>;
  if (record.authMode !== "enterprise" || record.mode !== "live")
    throw new EnterpriseLoginRefused("INVALID_SESSION", 200);
  if (typeof record.token !== "string" || record.token.length === 0)
    throw new EnterpriseLoginRefused("INVALID_SESSION", 200);
  if (typeof record.authority !== "string")
    throw new EnterpriseLoginRefused("INVALID_SESSION", 200);
  const expected = mobileOrigin("authority", authorityOrigin);
  const actual = (() => {
    try {
      return new URL(record.authority).origin;
    } catch {
      return "";
    }
  })();
  if (actual !== expected) throw new EnterpriseLoginRefused("AUTHORITY_MISMATCH", 200);
  if (typeof record.expiresAt !== "string" || Number.isNaN(Date.parse(record.expiresAt)))
    throw new EnterpriseLoginRefused("INVALID_SESSION", 200);
  const user = record.user;
  if (user === null || typeof user !== "object")
    throw new EnterpriseLoginRefused("INVALID_SESSION", 200);
  const userRecord = user as Record<string, unknown>;
  if (typeof userRecord.id !== "string" || userRecord.id.length === 0)
    throw new EnterpriseLoginRefused("INVALID_SESSION", 200);
  if (userRecord.principalId !== null && typeof userRecord.principalId !== "string")
    throw new EnterpriseLoginRefused("INVALID_SESSION", 200);
  const scope = record.scope;
  if (scope !== null) {
    if (scope === undefined || typeof scope !== "object")
      throw new EnterpriseLoginRefused("INVALID_SESSION", 200);
    const scopeRecord = scope as Record<string, unknown>;
    if (typeof scopeRecord.tenantId !== "string")
      throw new EnterpriseLoginRefused("INVALID_SESSION", 200);
    if (scopeRecord.workspaceId !== null && typeof scopeRecord.workspaceId !== "string")
      throw new EnterpriseLoginRefused("INVALID_SESSION", 200);
  }
  return record as unknown as EnterpriseSessionResponse;
}

async function refusalOfSession(response: Response): Promise<EnterpriseLoginRefused> {
  let code = "SESSION_REFUSED";
  try {
    const body = (await response.json()) as { code?: unknown };
    if (typeof body?.code === "string") code = body.code;
  } catch {
    // A body that is not the frozen MobileBffError keeps the generic code.
  }
  return new EnterpriseLoginRefused(code, response.status);
}

/**
 * The app's login client: one pending PKCE pair at a time, one frozen
 * `POST /api/session` to the configured BFF origin, and no other endpoint —
 * there is no code path here that could submit an access key, a standalone
 * owner or a caller-named authority.
 */
export function createEnterpriseLogin(options: {
  readonly config: MobileAuthConfig;
  readonly fetchLike: (url: string, init?: RequestInit) => Promise<Response>;
  readonly storage?: PendingLoginStorage;
  readonly randomBytes?: (length: number) => Uint8Array;
}) {
  const storage = options.storage ?? memoryPendingLoginStorage();
  const randomBytes = options.randomBytes ?? secureRandomBytes;
  let pending: StoredPendingLogin | null = null;

  const remember = (value: StoredPendingLogin | null): void => {
    pending = value;
    try {
      if (value === null) storage.removeItem(ENTERPRISE_PENDING_STORAGE_KEY);
      else storage.setItem(ENTERPRISE_PENDING_STORAGE_KEY, JSON.stringify(value));
    } catch {
      // Storage is a convenience across a web reload; the in-memory pair is
      // still enough for the native flow.
    }
  };

  const recall = (): StoredPendingLogin | null => {
    if (pending) return pending;
    let raw: string | null = null;
    try {
      raw = storage.getItem(ENTERPRISE_PENDING_STORAGE_KEY);
    } catch {
      return null;
    }
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as Partial<StoredPendingLogin>;
      if (
        typeof value.authorizeUrl !== "string" ||
        typeof value.state !== "string" ||
        typeof value.codeVerifier !== "string" ||
        typeof value.redirectUri !== "string"
      )
        return null;
      pending = {
        authorizeUrl: value.authorizeUrl,
        state: value.state,
        codeVerifier: value.codeVerifier,
        redirectUri: value.redirectUri,
      };
      return pending;
    } catch {
      return null;
    }
  };

  return {
    /** Start a login: generate the verifier/state and build the authority URL. */
    begin(): EnterprisePendingLogin {
      const codeVerifier = base64url(randomBytes(32));
      const state = base64url(randomBytes(32));
      const authorize = new URL("/api/enterprise/mobile/authorize", options.config.authorityOrigin);
      authorize.searchParams.set("client_id", options.config.clientId);
      authorize.searchParams.set("redirect_uri", options.config.redirectUri);
      authorize.searchParams.set("state", state);
      authorize.searchParams.set("code_challenge", pkceChallenge(codeVerifier));
      authorize.searchParams.set("code_challenge_method", "S256");
      const started: StoredPendingLogin = {
        authorizeUrl: authorize.toString(),
        state,
        codeVerifier,
        redirectUri: options.config.redirectUri,
      };
      remember(started);
      return { ...started };
    },

    /**
     * Complete the handoff: check the callback, then exchange the one-time
     * code + verifier + intent through the BFF's frozen `POST /api/session`.
     * A failure clears the pending pair and throws; it never tries another
     * credential shape.
     */
    async complete(callbackUrl: string): Promise<EnterpriseSessionResponse> {
      const current = recall();
      if (!current) throw new EnterpriseLoginRefused("NO_PENDING_LOGIN", 400);
      const { code, intentId } = readEnterpriseCallback(callbackUrl, current);
      const input: EnterpriseSessionInput = {
        authMode: "enterprise",
        intentId,
        code,
        codeVerifier: current.codeVerifier,
        redirectUri: current.redirectUri,
      };
      let response: Response;
      try {
        response = await options.fetchLike(`${options.config.apiOrigin}/api/session`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        });
      } catch {
        remember(null);
        throw new EnterpriseLoginRefused("AUTHORITY_UNAVAILABLE", 503);
      }
      if (!response.ok) {
        const refusal = await refusalOfSession(response);
        remember(null);
        throw refusal;
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        remember(null);
        throw new EnterpriseLoginRefused("INVALID_SESSION", response.status);
      }
      remember(null);
      return readSessionResponse(body, options.config.authorityOrigin);
    },

    /** Drop the pending pair (sign-out, cancel, a fresh start). */
    cancel(): void {
      remember(null);
    },
  };
}

export type EnterpriseLogin = ReturnType<typeof createEnterpriseLogin>;
