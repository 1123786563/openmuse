import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { OPENMUSE_SCHEME, openbotUrl } from "./config";
import { OpenBotError } from "./errors";
import { secureStorePrefix } from "./private-state";

/**
 * Better Auth client. Web keeps the browser HttpOnly cookie (the plugin stores
 * its bookkeeping in localStorage); native has no cookie jar, so the expo
 * plugin persists the session in SecureStore and `sessionCookie()` hands the
 * explicit Cookie header to the transport (I04/I05). Pattern mirrors the
 * proven copied-client auth module.
 */

const isWeb = Platform.OS === "web";

const tokenStorage = isWeb
  ? {
      getItem: (key: string) => localStorage.getItem(key),
      setItem: (key: string, value: string) => localStorage.setItem(key, value),
      getItemAsync: (key: string) => Promise.resolve(localStorage.getItem(key)),
      setItemAsync: (key: string, value: string) =>
        Promise.resolve(localStorage.setItem(key, value)),
      deleteItemAsync: (key: string) => Promise.resolve(localStorage.removeItem(key)),
    }
  : SecureStore;

export const authClient = createAuthClient({
  baseURL: openbotUrl,
  plugins: [
    expoClient({
      scheme: OPENMUSE_SCHEME,
      // Single source: the I07 registry sweeps exactly this prefix.
      storagePrefix: secureStorePrefix,
      storage: tokenStorage,
    }),
  ],
});

export { openbotUrl };

/**
 * Cookie a native transport must attach by hand; the browser attaches it
 * automatically. A storage read failure propagates (the transport maps it to
 * `network`): swallowing it to null would send an anonymous request that 401s
 * and forces a full re-auth + local private-state sweep.
 */
export async function sessionCookie(): Promise<string | null> {
  if (isWeb) return null;
  return await authClient.getCookie();
}

/**
 * Current session, or null when CONFIRMED signed out (callers decide where to
 * go). A check failure (network/server) throws instead: collapsing it into
 * null would let the gate treat "cannot confirm" as "no session" and sweep the
 * still-valid local credentials away.
 */
export async function currentSession(): Promise<{ userId: string } | null> {
  const { data, error } = await authClient.getSession();
  if (error)
    // network/unavailable keeps the gate's retryable path and the local jar.
    throw new OpenBotError("network", "无法确认登录状态，请检查网络后重试。");
  if (!data?.user?.id) return null;
  return { userId: data.user.id };
}

export async function signOut(): Promise<void> {
  await authClient.signOut().catch(() => undefined);
}

/**
 * Password rule shared by the form's validation and the sign-up error copy;
 * must stay in lockstep with the server's Better Auth minPasswordLength.
 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Sign-in error code → copy. "sso_required" is matched case-insensitively
 * (the dispatch site is not ours to pin, and a case mismatch would otherwise
 * drop into the fallback); the fallback is generic copy — raw server text
 * never reaches the sign-in screen (the connection-status.ts principle).
 */
function signInErrorReason(error: { code?: string; message?: string }): string {
  if (error.code === "INVALID_EMAIL_OR_PASSWORD") return "邮箱或密码不正确。";
  if (error.code === "EMAIL_PASSWORD_DISABLED" || /not enabled/i.test(error.message ?? ""))
    return "此部署未开放邮箱密码登录。";
  if (/^sso[_-]?required$/i.test(error.code ?? "")) return "此部署要求通过企业登录（SSO）。";
  return "登录失败，请稍后重试。";
}

/**
 * Sign-up error code → copy, signInErrorReason's twin: the fallback is
 * generic copy — raw server text never reaches the sign-up screen either
 * (unrecognized messages may carry internal endpoint/credential-shaped
 * detail; client.ts truncates server text to 500 chars verbatim).
 */
function signUpErrorReason(error: { code?: string; message?: string }): string {
  if (error.code === "USER_ALREADY_EXISTS") return "该邮箱已注册，请直接登录。";
  if (error.code === "INVALID_PASSWORD" || /at least/i.test(error.message ?? ""))
    return `密码至少 ${MIN_PASSWORD_LENGTH} 位。`;
  return "注册失败，请稍后重试。";
}

/**
 * Email + password sign-in (Better Auth emailAndPassword; the deployment
 * needs OPENBOT_EMAIL_PASSWORD=true). Server errors map to copy the form
 * can show directly.
 */
export async function signInWithEmail(
  email: string,
  password: string,
): Promise<{ ok: true; userId: string } | { ok: false; reason: string }> {
  const { data, error } = await authClient.signIn.email({ email, password });
  if (error) return { ok: false, reason: signInErrorReason(error) };
  if (!data?.user?.id) return { ok: false, reason: "登录响应异常，请重试。" };
  return { ok: true, userId: data.user.id };
}

/** Sign-up (email + password). Password rule matches the server: at least 8 chars. */
export async function signUpWithEmail(
  email: string,
  password: string,
  name: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { error } = await authClient.signUp.email({ email, password, name });
  if (error) return { ok: false, reason: signUpErrorReason(error) };
  return { ok: true };
}
