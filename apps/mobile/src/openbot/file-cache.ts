/**
 * Pure owner-scoped download cache for F04/F07 (no react-native/expo imports;
 * node:test exercises this module directly, the screen injects the real
 * expo-file-system adapter). Paths live under `<cache>/openmuse-files/` — the
 * exact tree I07's pdfCachePaths sweeps on logout, so cached bytes are
 * user-private by construction. Staleness is versionId-based: version ids are
 * immutable (contracts §5), so a mismatch means the cached bytes are an older
 * version and must be re-downloaded.
 */

import { OpenBotError } from "./errors";

/** Directory under the native cache where file downloads land (I07 registry). */
export const FILES_CACHE_DIR = "openmuse-files";

/** What ensureCached needs of a file row; the full DTO is api.ts's business. */
export interface CacheableFile {
  id: string;
  name: string;
  mimeType: string;
  versionId: string;
}

/** Sidecar record written next to the cached bytes (never before them). */
export interface CachedFileMeta {
  versionId: string;
  /** From the content route's ETag `sha256:<digest>`; null when absent. */
  sha256: string | null;
  etag: string | null;
  size: number;
  downloadedAt: string;
}

/** What the injected byte fetch returns (the adapter converts the Response). */
export interface CacheFetchResult {
  base64: string;
  etag: string | null;
}

/** expo-file-system/legacy subset ensureCached drives (node tests inject a fake). */
export interface CacheFileSystem {
  /** Idempotently ensures a directory exists. */
  makeDirectoryAsync(dir: string): Promise<void>;
  /** Byte channel: the payload is base64-decoded by real adapters before write. */
  writeFileAsync(path: string, base64: string): Promise<void>;
  /** Text channel: the payload is written as UTF-8 verbatim (meta sidecars). */
  writeTextAsync(path: string, text: string): Promise<void>;
  readFileAsync(path: string): Promise<string>;
  moveAsync(from: string, to: string): Promise<void>;
  /** Idempotent delete (absent path is fine). */
  deleteAsync(path: string): Promise<void>;
  /** Existence probe: the OS can reclaim the bytes while the sidecar survives. */
  hasFileAsync(path: string): Promise<boolean>;
}

/** URI-safe path join; exported for private-state's sweep of the same tree. */
export function joinUri(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

/** Mime fallback when the display name carries no usable suffix. */
const MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "text/plain": "txt",
  "text/csv": "csv",
  "text/markdown": "md",
  "application/json": "json",
};

/**
 * The cache filename's extension: the name's own suffix (a clean ≤8-char
 * alphanumeric run) or the mime map's, else "bin". The display name never
 * reaches the path itself — only this collapsed suffix does.
 */
export function extensionFor(file: { name: string; mimeType: string }): string {
  const dot = file.name.lastIndexOf(".");
  const suffix = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  const clean = suffix.replace(/[^a-z0-9]/g, "");
  if (clean && clean.length <= 8) return clean;
  const mime = file.mimeType.toLowerCase().split(";")[0].trim();
  return MIME_EXTENSIONS[mime] ?? "bin";
}

function sanitizeExtension(extension: string): string {
  const clean = extension.toLowerCase().replace(/[^a-z0-9]/g, "");
  return clean || "bin";
}

/**
 * `<cache>/openmuse-files/<fileId>.<ext>`. The fileId must stay a single path
 * segment: `/`, `\` and `..` are refused (contracts §5: path traversal never
 * selects a storage location), as is an empty id.
 */
export function deriveCachePath(cacheDirectory: string, fileId: string, extension: string): string {
  const id = fileId.trim();
  if (!id || id.includes("/") || id.includes("\\") || id === ".." || id === ".")
    throw new OpenBotError("invalid_input", "文件 ID 不能用于本地缓存路径。");
  return joinUri(joinUri(cacheDirectory, FILES_CACHE_DIR), `${id}.${sanitizeExtension(extension)}`);
}

/** Sidecar meta path for a derived cache path (`<path>.json`). */
export function cacheMetaPathFor(cachePath: string): string {
  return `${cachePath}.json`;
}

/** Cache-hit classification: only an exact versionId match is a hit. */
export function classifyCache(
  cachedVersionId: string | null | undefined,
  currentVersionId: string,
): "hit" | "miss" {
  return cachedVersionId === currentVersionId ? "hit" : "miss";
}

/** Byte length of a standard base64 string, without decoding it. */
export function bytesLengthOfBase64(base64: string): number {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, "").replace(/=+$/, "");
  return Math.floor((clean.length * 3) / 4);
}

/**
 * Extracts the digest from the content route's ETag (`"sha256:<hex>"`).
 * Exported as the single parser — pdf-view-state's etagMatchesVersion builds
 * on it so the format cannot drift between the cache and the viewer.
 */
export function sha256FromEtag(etag: string | null): string | null {
  if (etag === null) return null;
  const match = /^"?sha256:([0-9a-fA-F]{64})"?$/.exec(etag.trim());
  return match ? match[1].toLowerCase() : null;
}

async function readMeta(fs: CacheFileSystem, metaPath: string): Promise<CachedFileMeta | null> {
  let raw: string;
  try {
    raw = await fs.readFileAsync(metaPath);
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw) as CachedFileMeta;
  } catch {
    return null;
  }
}

export interface EnsureCachedContext {
  cacheDirectory: string;
  fetchBytes: () => Promise<CacheFetchResult>;
  fileSystem: CacheFileSystem;
  now?: () => string;
}

export interface EnsureCachedResult {
  status: "hit" | "downloaded";
  path: string;
  meta: CachedFileMeta;
}

/**
 * Per-target in-flight serialization: concurrent ensureCached calls for the
 * same slot (F04's list download racing F07's preview on one fileId) take
 * turns, so the shared `<target>.part` temp path is never written by two
 * flows at once and bytes+sidecar always land as one version-consistent pair.
 */
const inflight = new Map<string, Promise<void>>();

function withTargetLock<T>(target: string, job: () => Promise<T>): Promise<T> {
  const previous = inflight.get(target) ?? Promise.resolve();
  const run = previous.then(job);
  const tail = run.then(
    () => undefined,
    () => undefined, // the lock tracks completion, never the outcome
  );
  inflight.set(target, tail);
  void tail.then(() => {
    if (inflight.get(target) === tail) inflight.delete(target);
  });
  return run;
}

/**
 * Downloads one file's authenticated bytes into the owner-scoped cache (or
 * returns the existing copy when the versionId still matches). Completeness is
 * temp+rename: bytes land at `<path>.part`, rename to `<path>`, and only then
 * does the meta sidecar appear — so a mid-write failure can never leave a
 * partial file that classifies as a complete download, and a crash between
 * rename and meta write just re-downloads next time.
 */
export async function ensureCached(
  file: CacheableFile,
  ctx: EnsureCachedContext,
): Promise<EnsureCachedResult> {
  const target = deriveCachePath(ctx.cacheDirectory, file.id, extensionFor(file));
  return withTargetLock(target, () => ensureCachedOnce(file, ctx, target));
}

async function ensureCachedOnce(
  file: CacheableFile,
  ctx: EnsureCachedContext,
  target: string,
): Promise<EnsureCachedResult> {
  const fs = ctx.fileSystem;
  const metaPath = cacheMetaPathFor(target);
  const temp = `${target}.part`;
  const now = ctx.now ?? (() => new Date().toISOString());

  const cached = await readMeta(fs, metaPath);
  if (cached && classifyCache(cached.versionId, file.versionId) === "hit") {
    // The OS can reclaim the bytes file alone while the sidecar survives;
    // a hit without bytes is a dangling path — re-download instead.
    if (await fs.hasFileAsync(target)) return { status: "hit", path: target, meta: cached };
  }

  const { base64, etag } = await ctx.fetchBytes();
  const meta: CachedFileMeta = {
    versionId: file.versionId,
    sha256: sha256FromEtag(etag),
    etag,
    size: bytesLengthOfBase64(base64),
    downloadedAt: now(),
  };
  try {
    await fs.makeDirectoryAsync(joinUri(ctx.cacheDirectory, FILES_CACHE_DIR));
    await fs.writeFileAsync(temp, base64);
    // iOS's moveAsync (NSFileManager moveItemAtPath) refuses an existing
    // destination while Android's rename(2) overwrites — delete the old
    // target first so the rename is cross-platform safe.
    if (await fs.hasFileAsync(target)) await fs.deleteAsync(target);
    await fs.moveAsync(temp, target);
  } catch (error) {
    await fs.deleteAsync(temp).catch(() => undefined);
    throw error;
  }
  // The sidecar is UTF-8 JSON: writeFileAsync's payload gets base64-decoded
  // by real adapters (Android throws on JSON chars, iOS mangles them), so the
  // sidecar must ride the text channel.
  await fs.writeTextAsync(metaPath, JSON.stringify(meta));
  return { status: "downloaded", path: target, meta };
}

/**
 * Clears the slot's bytes + sidecar under the same per-target lock as
 * ensureCached (no racing write can interleave). `onlyVersionId` scopes the
 * clear to a failed version: the slot holds the LAST cached version, so a
 * refusal for version A must not delete version B's still-valid copy.
 */
export function clearCacheSlot(
  file: Pick<CacheableFile, "id" | "name" | "mimeType">,
  ctx: { cacheDirectory: string; fileSystem: CacheFileSystem },
  onlyVersionId?: string,
): Promise<void> {
  const target = deriveCachePath(ctx.cacheDirectory, file.id, extensionFor(file));
  return withTargetLock(target, async () => {
    if (onlyVersionId !== undefined) {
      const meta = await readMeta(ctx.fileSystem, cacheMetaPathFor(target));
      if (meta?.versionId !== onlyVersionId) return;
    }
    await ctx.fileSystem.deleteAsync(target);
    await ctx.fileSystem.deleteAsync(cacheMetaPathFor(target));
  });
}
