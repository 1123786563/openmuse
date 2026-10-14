/**
 * Single registry of private state: web browser storage (I06) and the native
 * SecureStore/PDF-cache sweep (I07). Sign-out, a 401 anywhere, and each new
 * sign-in clear everything listed here, so a following user on the same
 * browser or device sees none of the previous user's data.
 *
 * Built from what the code actually persists: the OpenBot session key is the
 * only key our code writes (sessionStorage, I03); CopilotKit runtime/session
 * state uses the documented `copilotkit-*` pattern. Native keeps the Better
 * Auth Expo plugin's SecureStore keys plus the downloaded file bytes under
 * the file-system cache. Workspace snapshot, computer drafts and
 * preview/viewer URLs are React state cleared by the App-level remount, not
 * storage keys or files.
 *
 * No react-native/expo imports: node:test exercises this module directly.
 */

import { openbotEndpoint } from "./config";
import { FILES_CACHE_DIR, joinUri } from "./file-cache";

/** Stable sessionStorage key carrying the opened private Bot session between entries. */
export const OPENBOT_SESSION_STORAGE_KEY = "openmuse-openbot-session-v1";

/**
 * SecureStore key prefix the Better Auth Expo client namespaces every native
 * key under. auth.ts imports this constant as the plugin's storagePrefix, so
 * the registry and the writer share one expression instead of two copies an
 * equal-value test has to pin together.
 */
export const secureStorePrefix = `openmuse-openbot-${openbotEndpoint.host.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

/**
 * Every web-private storage key (exact) or key prefix the web path owns.
 * secureStorePrefix is not native-only: auth.ts wires the same storagePrefix
 * into expoClient's localStorage-backed storage on web, so the plugin jar
 * (`_cookie`/`_session_data` and `.N` chunks) lands under it in web
 * localStorage too and the sweep must reach it there.
 */
export const webPrivateStorageKeys: { exact: readonly string[]; prefixes: readonly string[] } = {
  exact: [OPENBOT_SESSION_STORAGE_KEY],
  prefixes: ["copilotkit-", secureStorePrefix],
};

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

export interface WebStorage {
  sessionStorage?: StorageLike;
  localStorage?: StorageLike;
}

function isPrivate(key: string): boolean {
  return (
    webPrivateStorageKeys.exact.includes(key) ||
    webPrivateStorageKeys.prefixes.some((prefix) => key.startsWith(prefix))
  );
}

function clearStore(store: StorageLike): void {
  // Walk by index backwards: removeItem shifts later keys down.
  for (let i = store.length - 1; i >= 0; i--) {
    const key = store.key(i);
    if (key !== null && isPrivate(key)) store.removeItem(key);
  }
}

/**
 * Removes every registry key from both stores. Defaults to the real web
 * storage (absent outside the browser, e.g. SSR/node tests — then a no-op).
 */
export function clearWebPrivateState(stores: WebStorage = {}): void {
  const session =
    stores.sessionStorage ?? (typeof sessionStorage === "undefined" ? undefined : sessionStorage);
  const local =
    stores.localStorage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
  if (session) clearStore(session);
  if (local) clearStore(local);
}

/** Test helper: throws while any registry key survives in the given stores. */
export function assertCleared(stores: WebStorage): void {
  for (const store of [stores.sessionStorage, stores.localStorage]) {
    if (!store) continue;
    const keys = [...Array(store.length)].map((_, i) => store.key(i));
    const dirty = keys.filter((key): key is string => key !== null && isPrivate(key));
    if (dirty.length > 0) throw new Error(`web-private keys not cleared: ${dirty.join(", ")}`);
  }
}

/**
 * Cookie-jar chunk tails the @better-auth/expo plugin (1.7.1) splits large
 * writes across (`.0`…`.N`). Deleting an absent key is a no-op, so the cap
 * errs far above the observed ~14 KB jar (8 chunks): real jars grow with long
 * sessions and multi-domain cookies, and an under-sized cap silently leaves
 * session chunks behind for the next user of the device. Re-confirm against
 * the plugin when it upgrades — SecureStore cannot enumerate.
 */
const MAX_COOKIE_CHUNKS = 64;

/** Every native-private SecureStore key prefix the native path owns. */
export const nativePrivateKeys: { prefixes: readonly string[] } = {
  prefixes: [secureStorePrefix],
};

/** SecureStore subset clearNativePrivateState needs (node tests inject a fake). */
export interface SecureStoreLike {
  keys(): readonly string[];
  deleteItemAsync(key: string): Promise<void>;
}

/** expo-file-system/legacy subset (node tests inject a fake). */
export interface FileSystemLike {
  readonly cacheDirectory: string | null;
  infoAsync(uri: string): Promise<{ exists: boolean; isDirectory?: boolean }>;
  readDirectoryAsync(uri: string): Promise<string[]>;
  deleteAsync(uri: string, options?: { idempotent?: boolean }): Promise<void>;
}

/** What clearNativePrivateState did, for callers that retry failed deletions. */
export interface NativeClearReport {
  removedKeys: string[];
  /** SecureStore keys whose delete failed (isolated; the sweep continued). */
  failedKeys: string[];
  failedDeletes: string[];
}

function isNativePrivate(key: string): boolean {
  return nativePrivateKeys.prefixes.some((prefix) => key.startsWith(prefix));
}

/** Directory under the native cache where F04/F07 land file downloads. */
const PDF_CACHE_DIR = FILES_CACHE_DIR;

/** Collects every file under dir into out, recursively. */
async function collectFiles(fs: FileSystemLike, dir: string, out: string[]): Promise<void> {
  // An absent directory is the normal fresh-install case (nothing lives there
  // to clear); only a directory that provably exists (exists === false is the
  // only absence proof) is read, so a probe or read failure propagates instead
  // of silently degrading the sweep to a no-op while the caller's report still
  // says "cleared".
  const info = await fs.infoAsync(dir);
  if (!info.exists) return;
  const names = await fs.readDirectoryAsync(dir);
  for (const name of names) {
    const uri = joinUri(dir, name);
    const entryInfo = await fs.infoAsync(uri).catch(() => null);
    if (entryInfo?.isDirectory) await collectFiles(fs, uri, out);
    else out.push(uri);
  }
}

/**
 * Lists every file under <cacheDirectory>/openmuse-files/** recursively — the
 * owner-scoped download cache F04/F07 write (file-cache.ts ensureCached via
 * native-cache-adapter.ts), swept on sign-out and on any 401.
 */
export async function pdfCachePaths(fileSystem: FileSystemLike): Promise<string[]> {
  if (!fileSystem.cacheDirectory) return [];
  const paths: string[] = [];
  await collectFiles(fileSystem, joinUri(fileSystem.cacheDirectory, PDF_CACHE_DIR), paths);
  return paths;
}

/**
 * Removes every registry key from SecureStore and deletes every cached PDF
 * file. A file delete failure is collected into failedDeletes (the caller may
 * retry) instead of aborting the remaining deletions. Native drafts are
 * React state, not files: the App-level remount clears them.
 */
export async function clearNativePrivateState(
  stores: { secureStore?: SecureStoreLike; fileSystem?: FileSystemLike } = {},
): Promise<NativeClearReport> {
  const removedKeys: string[] = [];
  const failedKeys: string[] = [];
  const failedDeletes: string[] = [];
  const { secureStore, fileSystem } = stores;
  if (secureStore) {
    // One key's transient failure must not abort the chain — the file sweep
    // below and every other key still run, and the failure is reported.
    for (const key of secureStore.keys()) {
      if (!isNativePrivate(key)) continue;
      try {
        await secureStore.deleteItemAsync(key);
        removedKeys.push(key);
      } catch {
        failedKeys.push(key);
      }
    }
  }
  if (fileSystem) {
    for (const path of await pdfCachePaths(fileSystem)) {
      try {
        await fileSystem.deleteAsync(path, { idempotent: true });
      } catch {
        failedDeletes.push(path);
      }
    }
  }
  return { removedKeys, failedKeys, failedDeletes };
}

// Type-only; erased at compile time. Metro's require is the module closure
// parameter, while node:test has no react-native (same probe as config.ts).
declare const require: ((id: string) => unknown) | undefined;

/**
 * Names the expo client derives from each registry prefix: the `_cookie` jar
 * and `_session_data` cache, plus their `.N` chunk tails (values above the
 * per-write limit split across keys; the cap deliberately over-covers — see
 * MAX_COOKIE_CHUNKS). Sign-out rewrites the base keys short and leaves stale
 * chunks behind, which is exactly what the sweep removes.
 */
function secureStoreCandidates(): string[] {
  const names: string[] = [];
  for (const prefix of nativePrivateKeys.prefixes)
    for (const suffix of ["_cookie", "_session_data"]) {
      names.push(`${prefix}${suffix}`);
      for (let i = 0; i < MAX_COOKIE_CHUNKS; i++) names.push(`${prefix}${suffix}.${i}`);
    }
  return names;
}

/**
 * Real native adapters. SecureStore cannot enumerate its keys, so its adapter
 * offers the derived candidates instead — deleting an absent key is a no-op.
 * Web (and node:test/SSR, where require is undefined) get none: web keeps the
 * browser cookie plus the plugin's own bookkeeping.
 */
function nativeAdapters(): { secureStore?: SecureStoreLike; fileSystem?: FileSystemLike } {
  if (typeof require !== "function") return {};
  try {
    const os = (require("react-native") as { Platform?: { OS?: string } })?.Platform?.OS;
    if (os !== "ios" && os !== "android") return {};
    const secureStore = require("expo-secure-store") as typeof import("expo-secure-store");
    const fs = require("expo-file-system/legacy") as typeof import("expo-file-system/legacy");
    return {
      secureStore: {
        keys: () => secureStoreCandidates(),
        deleteItemAsync: (key) => secureStore.deleteItemAsync(key),
      },
      fileSystem: {
        cacheDirectory: fs.cacheDirectory,
        infoAsync: (uri) => fs.getInfoAsync(uri),
        readDirectoryAsync: (uri) => fs.readDirectoryAsync(uri),
        deleteAsync: (uri, options) => fs.deleteAsync(uri, options),
      },
    };
  } catch {
    // Native modules unavailable: native clearing is a no-op.
    return {};
  }
}

/**
 * Production sign-out clear for every platform: the web-private storage keys
 * plus, on native, the SecureStore registry and the PDF download cache. Call
 * after the server session revoke (auth.ts signOut) so the sweep cannot
 * delete the SecureStore session while signOut still needs its cookie.
 */
export async function clearPrivateState(): Promise<void> {
  clearWebPrivateState();
  const report = await clearNativePrivateState(nativeAdapters());
  // Production callers swallow this function's rejections (a failed sweep
  // must not block sign-out), so an incomplete sweep would otherwise vanish
  // silently and leave the previous user's keys/bytes on a shared device.
  if (report.failedKeys.length > 0 || report.failedDeletes.length > 0)
    console.warn("[openbot] private-state sweep incomplete", report);
}
