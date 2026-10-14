import { OpenBotError } from "./errors";
import type { CacheFileSystem } from "./file-cache";

// Type-only; erased at compile time (same lazy-probe pattern as
// private-state.ts, so node:test never imports react-native/expo).
declare const require: ((id: string) => unknown) | undefined;

/**
 * The native cache adapter: expo-file-system/legacy behind the pure seam's
 * CacheFileSystem interface, plus the Response → base64 conversion that stays
 * out of the seam (RN has no Buffer; Hermes offers btoa over string chunks).
 * Lives in its own module — not files.tsx — so the Files and Pdf screens both
 * depend on it one-way instead of forming a files ↔ pdf-view cycle that drags
 * react-native-pdf into every importer of the Files screen. Exported for F07's
 * viewer, which renders from the same owner-scoped cache.
 */
export function nativeCacheAdapter(): {
  cacheDirectory: string;
  fileSystem: CacheFileSystem;
} | null {
  if (typeof require !== "function") return null;
  try {
    const fs = require("expo-file-system/legacy") as typeof import("expo-file-system/legacy");
    if (!fs.cacheDirectory) return null;
    return {
      cacheDirectory: fs.cacheDirectory,
      fileSystem: {
        makeDirectoryAsync: (dir) => fs.makeDirectoryAsync(dir, { intermediates: true }),
        writeFileAsync: (path, base64) =>
          fs.writeAsStringAsync(path, base64, { encoding: fs.EncodingType.Base64 }),
        writeTextAsync: (path, text) => fs.writeAsStringAsync(path, text),
        readFileAsync: (path) => fs.readAsStringAsync(path),
        moveAsync: (from, to) => fs.moveAsync({ from, to }),
        deleteAsync: (path) => fs.deleteAsync(path, { idempotent: true }),
        hasFileAsync: async (path) => (await fs.getInfoAsync(path)).exists,
      },
    };
  } catch {
    return null;
  }
}

/**
 * The conversion holds the bytes, the binary string, and the base64 string in
 * memory at once (plus a decode copy on write), so past this size it refuses
 * rather than risking an OOM on Hermes.
 */
const MAX_CACHE_FILE_BYTES = 64 * 1024 * 1024;

/** Response bytes as base64, in chunks small enough for String.fromCharCode. */
export async function responseToBase64(response: Response): Promise<string> {
  // RN fetch cannot stream, but a declared Content-Length rejects an
  // oversized body BEFORE the full read allocates it, not only after.
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_CACHE_FILE_BYTES)
    throw new OpenBotError("refused", "文件过大，无法在本地缓存后打开。");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_CACHE_FILE_BYTES)
    throw new OpenBotError("refused", "文件过大，无法在本地缓存后打开。");
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
