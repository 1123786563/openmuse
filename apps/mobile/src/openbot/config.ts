/**
 * OpenBot deployment address. `EXPO_PUBLIC_OPENBOT_URL` points at the OpenBot
 * server and is independent from OpenMuse's own `EXPO_PUBLIC_API_URL`.
 */

export type OpenbotOS = "web" | "ios" | "android";

function parseEndpoint(value: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(value.replace(/\/+$/, ""));
  } catch {
    throw new Error("EXPO_PUBLIC_OPENBOT_URL must be a full URL, e.g. http://localhost:8787");
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
    throw new Error("EXPO_PUBLIC_OPENBOT_URL must not carry credentials, query, or fragment.");
  // Only the origin is kept downstream, so a path prefix would be silently
  // dropped and every request would 404 — reject it instead.
  if (endpoint.pathname !== "/")
    throw new Error("EXPO_PUBLIC_OPENBOT_URL must be origin-only: it must not include a path.");
  return endpoint;
}

/** Android emulators reach the host machine at 10.0.2.2; everywhere else localhost. */
function defaultBaseUrl(platform: OpenbotOS): string {
  return platform === "android" ? "http://10.0.2.2:8787" : "http://localhost:8787";
}

/**
 * Resolve the OpenBot base URL for a platform. An explicit
 * `EXPO_PUBLIC_OPENBOT_URL` always wins; only the fallback host is
 * platform-specific (I05). Injectable so node:test never loads react-native.
 */
export function resolveOpenbotUrl(platform: OpenbotOS, envValue?: string): string {
  return parseEndpoint(envValue?.trim() || defaultBaseUrl(platform)).origin;
}

// Type-only; erased at compile time. Metro bundles define `require` as the
// module closure parameter, while node:test (importing this module through
// client.ts) has no react-native at all.
declare const require: ((id: string) => unknown) | undefined;

/**
 * react-native must not be imported at module scope (node:test constraint), so
 * the platform is probed lazily; outside the app runtime we fall back to web.
 */
function currentOS(): OpenbotOS {
  try {
    if (typeof require === "function") {
      const os = (require("react-native") as { Platform?: { OS?: string } })?.Platform?.OS;
      if (os === "android" || os === "ios" || os === "web") return os;
    }
  } catch {
    // react-native unavailable (node:test / SSR): web default.
  }
  return "web";
}

/**
 * The app's own deep-link scheme, shared by auth.ts (expoClient) and api.ts
 * (the OAuth returnUri). app.json must spell the same value out — Expo config
 * cannot import this constant — so change both together.
 */
export const OPENMUSE_SCHEME = "openmuse";

// Same resolution rule as resolveOpenbotUrl (env override + platform default,
// one source for both), so the two can never drift apart.
export const openbotEndpoint = parseEndpoint(
  resolveOpenbotUrl(currentOS(), process.env.EXPO_PUBLIC_OPENBOT_URL),
);
export const openbotUrl = openbotEndpoint.origin;
