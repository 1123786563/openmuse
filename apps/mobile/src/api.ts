import { Platform } from "react-native";
import { readApiPayload } from "./api-response";
import { type MobileAuthConfig, resolveMobileAuthConfig } from "./openbot/transport";

/**
 * OpenMuse's own API origin — the enterprise BFF in enterprise deployments,
 * the standalone server in legacy ones. `EXPO_PUBLIC_API_URL` is baked in at
 * build time; the platform default only exists for the legacy local flow.
 */
export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL ||
  (Platform.OS === "android" ? "http://10.0.2.2:8787" : "http://localhost:8787")
).replace(/\/$/, "");

function currentPlatform(): "web" | "ios" | "android" {
  return Platform.OS === "android" ? "android" : Platform.OS === "ios" ? "ios" : "web";
}

/**
 * T07.10 (#600): the one deployment configuration the mobile client runs
 * with. Enterprise mode requires BOTH the OpenBot authority origin and the
 * OpenMuse BFF origin to be supplied explicitly, so a missing value fails the
 * login gate loudly instead of silently pointing at an old origin.
 */
export function mobileAuthConfig(): MobileAuthConfig {
  return resolveMobileAuthConfig(
    {
      mode: process.env.EXPO_PUBLIC_MOBILE_AUTH_MODE,
      apiOrigin: process.env.EXPO_PUBLIC_API_URL,
      authorityOrigin: process.env.EXPO_PUBLIC_OPENBOT_URL,
      clientId: process.env.EXPO_PUBLIC_MOBILE_CLIENT_ID,
      redirectUri: process.env.EXPO_PUBLIC_MOBILE_REDIRECT_URI,
    },
    currentPlatform(),
  );
}

export interface MuseApiOptions {
  /**
   * The transport the API calls ride. The enterprise app injects the scoped
   * fetch from `createScopedFetch`, so the verified tenant/workspace headers
   * and the generation refusal apply to every business request from the one
   * tenancy store. Omitted, calls go straight to `baseUrl`.
   */
  fetchLike?: (path: string, init?: RequestInit) => Promise<Response>;
  /** The BFF origin; defaults to the legacy `API_URL`. */
  baseUrl?: string;
}

/**
 * The original OpenMuse Workspace client. The enterprise supply keeps this
 * exact wire contract (`GET /api/workspace` returns the original `Workspace`),
 * and the session handle is the only credential it carries — never an access
 * key and never the authority origin.
 */
export class MuseApi {
  readonly baseUrl: string;
  private readonly fetchLike: (path: string, init?: RequestInit) => Promise<Response>;

  constructor(
    readonly token: string,
    options: MuseApiOptions = {},
  ) {
    this.baseUrl = options.baseUrl ?? API_URL;
    this.fetchLike = options.fetchLike ?? ((path, init) => fetch(`${this.baseUrl}${path}`, init));
  }

  async response(path: string, body?: unknown, method?: string): Promise<Response> {
    return this.fetchLike(path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body === undefined || body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  }

  async request<T>(path: string, body?: unknown, method?: string): Promise<T> {
    return readApiPayload<T>(await this.response(path, body, method));
  }

  url(path: string) {
    return path.startsWith("http") ? path : `${this.baseUrl}${path}`;
  }
}

/**
 * The explicit legacy login, kept for a standalone deployment: it submits the
 * server's access key to the standalone `/api/session`. The enterprise app
 * never calls this function — it has no accessKey path at all.
 */
export async function createStandaloneSession(
  accessKey?: string,
): Promise<{ token: string; mode: "sample" | "live" }> {
  const response = await fetch(`${API_URL}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessKey }),
  });
  return readApiPayload<{ token: string; mode: "sample" | "live" }>(
    response,
    "Could not open your workspace.",
  );
}
