import { z } from "zod";
import { openbotUrl } from "./config";
import { OpenBotError, type OpenBotErrorCode } from "./errors";

/**
 * The single transport for every OpenBot API call. Web rides the Better Auth
 * HttpOnly cookie via `credentials: "include"`. Native has no cookie jar, so
 * the caller supplies the session cookie (I04) and it rides an explicit
 * Cookie header instead. All of it is injectable so node:test never imports
 * react-native.
 */

export type OpenBotPlatform = "web" | "native";

export interface OpenBotTransportDefaults {
  platform?: OpenBotPlatform;
  getCookie?: () => Promise<string | null>;
  /** Fired once whenever a response comes back 401, right before the error is thrown. */
  onAuthExpired?: () => void;
}

const transportDefaults: OpenBotTransportDefaults = { platform: "web" };

/** App boot wires the platform + cookie source here; tests may also inject per call. */
export function setOpenbotTransportDefaults(defaults: OpenBotTransportDefaults): void {
  Object.assign(transportDefaults, defaults);
}

const errorBodySchema = z.object({
  error: z.string().optional(),
  rule: z.string().optional(),
});

/**
 * RN ≤0.81 (this repo: 0.81.5/Hermes) ships neither AbortSignal.timeout nor
 * AbortSignal.any, and this transport is their only consumer — without a
 * fallback, every request would throw TypeError BEFORE sendAndCheck's
 * try/catch, so no OpenBot call would ever reach the error mapping on native.
 * Node (≥17.3) has both, so node:test always exercises the native paths.
 */
export function timeoutSignalAfter(ms: number): AbortSignal {
  const controller = new AbortController();
  // The native twin rejects with a TimeoutError-named DOMException; the
  // hand-rolled reason keeps that classification where the platform allows.
  const reason =
    typeof DOMException === "function"
      ? new DOMException("signal timed out", "TimeoutError")
      : Object.assign(new Error("signal timed out"), { name: "TimeoutError" });
  setTimeout(() => controller.abort(reason), ms);
  return controller.signal;
}

/** AbortSignal.any fallback: aborts as soon as any source aborts, with its reason. */
export function mergeAbortSignals(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener(
      "abort",
      () => {
        controller.abort(signal.reason);
      },
      { once: true },
    );
  }
  return controller.signal;
}

export interface OpenBotRequestInit {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** "native" sends the session Cookie header explicitly; "web" (default) uses the browser jar. */
  platform?: OpenBotPlatform;
  /** Native session cookie source; returning null omits the header. */
  getCookie?: () => Promise<string | null>;
  /** Per-call override of the 401 hook. */
  onAuthExpired?: () => void;
}

/**
 * Shared transport for every OpenBot call: build the request (cookie header on
 * native, credentials on web, timeout), send it, and map any !ok response to
 * the error model. The ok Response comes back with its body unread — the JSON
 * path parses it, the binary path (openbotFetchBinary) streams it.
 */
async function sendAndCheck(
  path: string,
  init: OpenBotRequestInit,
  accept: string,
  isWrite = false,
  timeoutMs = 20_000,
): Promise<Response> {
  if (!path.startsWith("/api/"))
    throw new OpenBotError("invalid_input", "必须使用 /api/ 开头的 OpenBot 路径。");
  const doFetch = init.fetchImpl ?? ((input, fetchInit) => fetch(input, fetchInit));
  const timeout =
    typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(timeoutMs)
      : timeoutSignalAfter(timeoutMs);
  let signal = timeout;
  if (init.signal) {
    signal =
      typeof AbortSignal.any === "function"
        ? AbortSignal.any([init.signal, timeout])
        : mergeAbortSignals([init.signal, timeout]);
  }

  const platform = init.platform ?? transportDefaults.platform ?? "web";
  const getCookie = init.getCookie ?? transportDefaults.getCookie;
  let cookie: string | null = null;
  if (platform === "native" && getCookie) {
    try {
      cookie = (await getCookie()) ?? null;
    } catch {
      // A credential READ failure is not "signed out": mapping it to network
      // keeps the retry path alive instead of firing an anonymous request
      // that 401s and forces a full re-auth + local private-state sweep.
      throw new OpenBotError("network", "无法读取本地登录凭证，请重试。");
    }
  }

  let response: Response;
  try {
    response = await doFetch(`${openbotUrl}${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      credentials: platform === "native" ? "omit" : "include",
      redirect: "error",
      headers: {
        Accept: accept,
        ...(cookie !== null ? { Cookie: cookie } : {}),
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal,
    });
  } catch (error) {
    // A caller-initiated abort rethrows as-is (it is a cancellation, not a
    // network failure); a timeout aborts as TimeoutError and stays `network`.
    if (init.signal?.aborted || (error instanceof Error && error.name === "AbortError"))
      throw error;
    throw new OpenBotError("network", "无法连接 OpenBot 服务，请检查网络后重试。");
  }

  if (response.ok) return response;

  const body: unknown = await response.json().catch(() => undefined);
  const detail = errorBodySchema.safeParse(body);
  const message =
    detail.success && detail.data.error
      ? detail.data.error.slice(0, 500)
      : `OpenBot 请求失败（${response.status}）。`;
  // 408/5xx on a write means the outcome is ambiguous: the request may have
  // landed. Reads fail safe with `unavailable` and can simply be retried.
  let code: OpenBotErrorCode;
  if (response.status === 401) code = "authentication_required";
  else if (response.status === 403) code = "refused";
  else if (response.status === 404) code = "not_found";
  else if (response.status === 408 || response.status >= 500)
    code = isWrite ? "outcome_unknown" : "unavailable";
  else code = "invalid_input";
  if (response.status === 401) (init.onAuthExpired ?? transportDefaults.onAuthExpired)?.();
  throw new OpenBotError(
    code,
    message,
    response.status,
    detail.success ? detail.data.rule : undefined,
  );
}

export async function openbotFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  init: OpenBotRequestInit = {},
  isWrite = false,
): Promise<T> {
  const response = await sendAndCheck(path, init, "application/json", isWrite);
  const body: unknown = await response.json().catch(() => undefined);

  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new OpenBotError(
      "invalid_response",
      "OpenBot 返回了与预期不符的数据结构。",
      response.status,
    );
  return parsed.data;
}

/**
 * Binary twin of openbotFetch (F04, over F02's content route): identical
 * transport and error mapping, but the ok Response comes back untouched so the
 * caller can read the byte stream and headers (ETag `sha256:<digest>`)
 * directly. Always a read: 408/5xx surface as `unavailable`.
 */
export function openbotFetchBinary(path: string, init: OpenBotRequestInit = {}): Promise<Response> {
  // Screenshot polling and file/PDF byte streams share this path: a large
  // body on a weak network needs far more than the JSON calls' 20s window.
  // 120s only guards against a hang, not transfer time.
  return sendAndCheck(path, init, "application/octet-stream, */*", false, 120_000);
}
