/**
 * F07 pure seams for the PDF viewer: the version list (原件 + F06-derived
 * 填充副本), the stale-bytes refusal protocol, and the open flow over the F04
 * file-cache. No react-native/expo imports; node:test exercises this module
 * directly, the screen injects the real adapter.
 *
 * Task 0 finding, recorded: F01's files list/detail DTO carries no version
 * list (types.ts openBotFileSchema has the seven file fields only; the
 * server's fileJson answers the same seven), so the viewer fetches
 * GET /api/mobile/openmuse-files/:id/versions (api.fetchFileVersions) — F06's
 * version rows projected: the root row (parentVersionId null) is 原件, rows
 * carrying parentVersionId are fill-derived copies. Until the server ships
 * that route the fetch answers not_found and the viewer degrades to the
 * file row's current version.
 *
 * Never render stale bytes (two guards):
 * - The byte fetch verifies the content route's ETag digest against the
 *   selected version's sha256 BEFORE the cache writes anything — the file
 *   row keeps the ORIGINAL's hash by contract (§5), so if /content serves a
 *   newer version's bytes for an 原件 request, the mismatch refuses instead
 *   of caching mislabeled bytes.
 * - A refusal (401 session gone / 404 file gone / invalid_response wrong
 *   bytes) deletes that version's cached copy before the error shows; the
 *   screen drops the render path so a stale render is impossible. Network
 *   errors keep the cache — the bytes may simply be offline-refreshable.
 */

import { OpenBotError, type OpenBotErrorCode } from "./errors";
import {
  type CacheableFile,
  type CacheFetchResult,
  type CacheFileSystem,
  clearCacheSlot,
  type EnsureCachedResult,
  ensureCached,
  sha256FromEtag,
} from "./file-cache";
import type { OpenBotFile } from "./types";

/** One row of GET /:id/versions — F06's version row (api.OpenBotFileVersion). */
export interface PdfVersionRow {
  versionId: string;
  /** The fill's parent; null on the upload's root row (原件). */
  parentVersionId: string | null;
  sha256: string;
  size: number;
  createdAt: string;
}

/** One selectable entry in the viewer's version list. */
export interface PdfVersionEntry {
  versionId: string;
  parentVersionId: string | null;
  kind: "original" | "filled" | "current";
  /** 原件 / 填充副本 <versionId> / 当前版本 — the identity is explicit. */
  label: string;
  /**
   * The digest this version's bytes must carry (ETag `sha256:<hex>`); null
   * when unknown (the degraded current-version entry) — then any well-formed
   * sha256 ETag verifies and the digest shown is the one the bytes carry.
   */
  sha256: string | null;
  size: number;
}

/** Only PDFs get the 打开预览 entry (the Files screen gates on this). */
export function canPdfPreview(file: Pick<OpenBotFile, "mimeType">): boolean {
  return file.mimeType === "application/pdf";
}

/**
 * The viewer's version list: 原件 first, then fill-derived copies oldest
 * first. Without rows the single entry is the file row's CURRENT version:
 * the row's sha256 stays the ORIGINAL's hash by contract (§5) while its
 * versionId flips to the fill once one lands, so the degraded entry can
 * claim neither identity — it verifies against the response's own digest
 * and shows the digest the bytes actually carry.
 */
export function buildPdfVersions(file: OpenBotFile, rows: PdfVersionRow[]): PdfVersionEntry[] {
  if (rows.length === 0)
    return [
      {
        versionId: file.versionId,
        parentVersionId: null,
        kind: "current",
        label: "当前版本",
        sha256: null,
        size: file.size,
      },
    ];
  const filled = rows
    .filter((row) => row.parentVersionId !== null)
    .sort((a, b) =>
      a.createdAt === b.createdAt
        ? a.versionId.localeCompare(b.versionId)
        : a.createdAt.localeCompare(b.createdAt),
    )
    .map(
      (row): PdfVersionEntry => ({
        versionId: row.versionId,
        parentVersionId: row.parentVersionId,
        kind: "filled",
        label: `填充副本 ${row.versionId}`,
        sha256: row.sha256,
        size: row.size,
      }),
    );
  const originals = rows
    .filter((row) => row.parentVersionId === null)
    .map(
      (row): PdfVersionEntry => ({
        versionId: row.versionId,
        parentVersionId: null,
        kind: "original",
        label: "原件",
        sha256: row.sha256,
        size: row.size,
      }),
    );
  return [...originals, ...filled];
}

/** The 原件 is the initial selection; an empty list selects nothing. */
export function initialSelectionId(versions: PdfVersionEntry[]): string | undefined {
  return versions[0]?.versionId;
}

/**
 * Only a usable digest proves what the served bytes are: an exact match for a
 * known version's sha256, or — when the entry's digest is unknown (degraded
 * current-version entry) — any well-formed `sha256:<hex>` ETag, so the digest
 * recorded and shown is always the one the bytes actually carry.
 */
export function etagMatchesVersion(
  etag: string | null,
  version: { sha256: string | null },
): boolean {
  const digest = sha256FromEtag(etag);
  return digest !== null && (version.sha256 === null || digest === version.sha256.toLowerCase());
}

export interface OpenVersionContext {
  cacheDirectory: string;
  fileSystem: CacheFileSystem;
  /** Authenticated byte fetch for THIS version (api.downloadFileVersion). */
  fetchBytes: () => Promise<CacheFetchResult>;
}

/**
 * Opens one version: F04's ensureCached keyed by versionId, with the byte
 * fetch wrapped so only ETag-verified bytes of THAT version can ever land.
 * A cache hit needs the sidecar's versionId to equal the selection, so a
 * version change is a miss and re-downloads.
 */
export function openPdfVersion(
  file: Pick<CacheableFile, "id" | "name" | "mimeType">,
  version: PdfVersionEntry,
  ctx: OpenVersionContext,
): Promise<EnsureCachedResult> {
  return ensureCached(
    { id: file.id, name: file.name, mimeType: file.mimeType, versionId: version.versionId },
    {
      cacheDirectory: ctx.cacheDirectory,
      fileSystem: ctx.fileSystem,
      fetchBytes: async () => {
        const result = await ctx.fetchBytes();
        if (!etagMatchesVersion(result.etag, version))
          throw new OpenBotError(
            "invalid_response",
            "服务端返回的字节不属于所选版本，已拒绝显示。",
          );
        return result;
      },
    },
  );
}

/** Refusals whose cached copy must not survive; network faults keep theirs. */
export function refusalClearsCache(code: OpenBotErrorCode): boolean {
  return code === "authentication_required" || code === "not_found" || code === "invalid_response";
}

/**
 * Deletes the cached bytes + sidecar for the file's cache slot (the slot
 * holds exactly one version — the last cached — so this is THAT version's
 * copy), under the same per-target lock as ensureCached. `failedVersionId`
 * scopes the delete to a refusal for THAT version: a switch may have already
 * replaced the slot with another version's still-valid copy, which must
 * survive. Idempotent through the injected fs's deleteAsync.
 */
export async function clearVersionCache(
  file: Pick<CacheableFile, "id" | "name" | "mimeType">,
  ctx: { cacheDirectory: string; fileSystem: CacheFileSystem },
  failedVersionId?: string,
): Promise<void> {
  await clearCacheSlot(file, ctx, failedVersionId);
}
