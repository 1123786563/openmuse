import { isAuthFailure } from "./errors";
import type { GoogleConnection, GoogleConnections } from "./types";

/**
 * Pure view-model seam for the Connections screen (G06): normalization only —
 * §4 status chips, scope formatting, account fallbacks, and the
 * token-shape guard over lastError. No react-native imports, so node:test
 * covers it directly, and equal payloads always normalize to equal rows.
 */

export const connectionStatusLabels: Record<string, string> = {
  connected: "已连接",
  refresh_required: "需要刷新",
  disconnected: "已断开",
  revoked: "已撤销",
};

const UNKNOWN_STATUS_LABEL = "未知";
const UNKNOWN_PROVIDER_LABEL = "未知服务";
const NO_EMAIL_LABEL = "未绑定账号";
const NO_SCOPES_LABEL = "未授予任何权限";
const RECONNECT_NEEDED_LABEL = "需要重新连接";
const AUTH_EXPIRED_LABEL = "登录已过期，请重新登录后再查看连接状态。";
const UNKNOWN_ERROR_LABEL = "未知错误";
const SCOPE_SEPARATOR = " · ";
const ERROR_MAX_LENGTH = 120;

const providerLabels: Record<string, string> = {
  gmail: "Gmail 邮件",
  googlecalendar: "Google 日历",
};

/**
 * Token shapes a leaked credential takes in an error sentence: Google access
 * tokens (ya29.…), refresh tokens (1//0…), any ≥40-char base64url/base64 run,
 * and Authorization headers. Deliberately over-broad — the guard's failure
 * direction is hiding too much, never showing a credential.
 */
const TOKEN_SHAPED = /\bya29\.|1\/\/0[\w-]*|[A-Za-z0-9+/_=-]{40,}|\bBearer\s/i;

/**
 * The token-shape guard on its own, copy-agnostic, for other screens' catch
 * paths (e.g. the sign-in form): callers substitute their own fallback copy
 * instead of the Connections-specific label.
 */
export function isTokenShaped(text: string): boolean {
  return TOKEN_SHAPED.test(text);
}

/**
 * §4 render guard: an error that carries anything token-shaped is replaced
 * WHOLESALE (the sentence around a credential cannot be trusted either),
 * never partially scrubbed. A plain error passes through, clipped to 120.
 */
export function sanitizeConnectionError(lastError: string | undefined): string | undefined {
  if (lastError === undefined || lastError === "") return undefined;
  if (TOKEN_SHAPED.test(lastError)) return RECONNECT_NEEDED_LABEL;
  return lastError.length <= ERROR_MAX_LENGTH ? lastError : lastError.slice(0, ERROR_MAX_LENGTH);
}

/**
 * The screen's catch copy: session expiry gets its own sentence (retry would
 * just 401 again), and anything else passes the token guard — an OpenBotError
 * message is server text up to 500 chars and must never reach the screen raw.
 */
export function connectionErrorCopy(e: unknown): string {
  if (isAuthFailure(e)) return AUTH_EXPIRED_LABEL;
  const raw = e instanceof Error ? e.message : String(e);
  return sanitizeConnectionError(raw) ?? UNKNOWN_ERROR_LABEL;
}

export interface ConnectionRow {
  provider: string;
  providerLabel: string;
  /** Raw §4 status (or the server's unknown value); chip styling branches on it. */
  status: string;
  statusLabel: string;
  accountLabel: string;
  scopesLabel: string;
  /** The sanitized lastError, present only when the server sent one. */
  errorText?: string;
}

/**
 * The combined status becomes display rows: server order kept (it is the
 * catalog's), one row per provider keyed by `provider`, every label mapped —
 * the screen renders exactly this and infers nothing client-side.
 */
/**
 * Server-controlled string → plain-object-literal lookup that never leaks an
 * inherited Object.prototype member ("constructor", "toString", …): the ??
 * fallback cannot fire for those keys, and a function/object landing in Text
 * or a style array crashes the whole screen.
 */
function ownLabel(map: Record<string, string>, key: string, fallback: string): string {
  return Object.hasOwn(map, key) ? map[key] : fallback;
}

export function normalizeConnections(
  connections: GoogleConnections["connections"],
): ConnectionRow[] {
  return connections.map((connection: GoogleConnection) => {
    const errorText = sanitizeConnectionError(connection.lastError);
    return {
      provider: connection.provider,
      providerLabel: ownLabel(providerLabels, connection.provider, UNKNOWN_PROVIDER_LABEL),
      status: connection.status,
      statusLabel: ownLabel(connectionStatusLabels, connection.status, UNKNOWN_STATUS_LABEL),
      accountLabel: connection.accountEmail ?? NO_EMAIL_LABEL,
      scopesLabel:
        connection.grantedScopes && connection.grantedScopes.length > 0
          ? connection.grantedScopes.join(SCOPE_SEPARATOR)
          : NO_SCOPES_LABEL,
      ...(errorText === undefined ? {} : { errorText }),
    };
  });
}
