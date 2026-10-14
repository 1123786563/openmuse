import assert from "node:assert/strict";
import test from "node:test";
import {
  downloadFileVersion,
  fetchFileVersions,
  fileVersionContentUrl,
} from "../src/openbot/api.ts";
import { openbotUrl } from "../src/openbot/config.ts";
import { OpenBotError } from "../src/openbot/errors.ts";
import type { CacheFileSystem } from "../src/openbot/file-cache.ts";
import {
  buildPdfVersions,
  canPdfPreview,
  clearVersionCache,
  etagMatchesVersion,
  initialSelectionId,
  openPdfVersion,
  refusalClearsCache,
} from "../src/openbot/pdf-view-state.ts";
import type { OpenBotFile } from "../src/openbot/types.ts";

/**
 * F07 pure-seam tests: the version list (原件 + F06-derived 填充副本 with
 * parent/labels and selection), the stale-bytes refusal protocol (401/404 on
 * open deletes THAT version's cached bytes before the error shows; an ETag
 * digest mismatch never caches at all), versionId-change re-download over the
 * F04 file-cache, and the PDF-only preview predicate. Everything runs without
 * react-native/expo — the screen injects the real adapter.
 */

const cache = "file:///var/mobile/Containers/Data/Application/X/Library/Caches/";
const filesDir = `${cache}openmuse-files`;

const file: OpenBotFile = {
  id: "f1",
  name: "contract.pdf",
  mimeType: "application/pdf",
  size: 11,
  sha256: "a".repeat(64),
  versionId: "v1",
  createdAt: "2026-10-12T08:00:00Z",
};

const shaOf = (c: string) => c.repeat(64);

// ---------------------------------------------------------------------------
// 1. Version list: original + derived rows, labels, selection.

test("buildPdfVersions without rows degrades to an honest current-version entry", () => {
  // The file row keeps the ORIGINAL's hash while versionId flips to the fill
  // after F06 lands one, so the degraded entry can claim neither identity:
  // it is the CURRENT version with an unknown digest until bytes arrive.
  const versions = buildPdfVersions(file, []);
  assert.equal(versions.length, 1);
  assert.deepEqual(versions[0], {
    versionId: "v1",
    parentVersionId: null,
    kind: "current",
    label: "当前版本",
    sha256: null,
    size: 11,
  });
});

test("buildPdfVersions maps rows to 原件 + 填充副本 <versionId>, original first", () => {
  const rows = [
    {
      versionId: "v2",
      parentVersionId: "v1",
      sha256: shaOf("b"),
      size: 20,
      createdAt: "2026-10-12T09:00:00Z",
    },
    {
      versionId: "v1",
      parentVersionId: null,
      sha256: file.sha256,
      size: 11,
      createdAt: "2026-10-12T08:00:00Z",
    },
    {
      versionId: "v3",
      parentVersionId: "v2",
      sha256: shaOf("c"),
      size: 30,
      createdAt: "2026-10-12T10:00:00Z",
    },
  ];
  const versions = buildPdfVersions(file, rows);
  assert.equal(versions.length, 3);
  const [original, firstFill, secondFill] = versions;
  assert.equal(original.kind, "original");
  assert.equal(original.label, "原件");
  assert.equal(original.parentVersionId, null);
  assert.equal(firstFill.kind, "filled");
  assert.equal(firstFill.label, "填充副本 v2");
  assert.equal(firstFill.parentVersionId, "v1");
  assert.equal(secondFill.label, "填充副本 v3");
  assert.equal(secondFill.parentVersionId, "v2");
});

test("selection: the original is selected initially and any listed version is findable", () => {
  const rows = [
    {
      versionId: "v2",
      parentVersionId: "v1",
      sha256: shaOf("b"),
      size: 20,
      createdAt: "2026-10-12T09:00:00Z",
    },
    {
      versionId: "v1",
      parentVersionId: null,
      sha256: file.sha256,
      size: 11,
      createdAt: "2026-10-12T08:00:00Z",
    },
  ];
  const versions = buildPdfVersions(file, rows);
  assert.equal(initialSelectionId(versions), "v1");
  assert.equal(initialSelectionId([]), undefined);
  const switched = versions.find((v) => v.versionId === "v2");
  assert.ok(switched);
  assert.equal(switched.label, "填充副本 v2");
});

// ---------------------------------------------------------------------------
// 2. Stale refusal: 401/404 on open → THAT version's cache is deleted and the
//    error shows; an ETag mismatch never caches; network errors keep the cache.

/** In-memory CacheFileSystem with a delete log. */
function cacheFsStub(): CacheFileSystem & { files: Map<string, string>; deleted: string[] } {
  const files = new Map<string, string>();
  const deleted: string[] = [];
  return {
    files,
    deleted,
    hasFileAsync: async (path) => files.has(path),
    makeDirectoryAsync: async () => {},
    writeFileAsync: async (path, base64) => {
      files.set(path, base64);
    },
    writeTextAsync: async (path, text) => {
      files.set(path, text);
    },
    readFileAsync: async (path) => {
      if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
      return files.get(path) as string;
    },
    moveAsync: async (from, to) => {
      files.set(to, files.get(from) ?? "");
      files.delete(from);
    },
    deleteAsync: async (path) => {
      deleted.push(path);
      files.delete(path);
    },
  };
}

const bytesOf = (etag: string | null) => async () => ({ base64: btoa("pdf bytes"), etag });

test("401 on open deletes that version's cached bytes and sidecar before the error shows", async () => {
  const fs = cacheFsStub();
  const versions = buildPdfVersions(file, []);
  const cached = await openPdfVersion(file, versions[0], {
    cacheDirectory: cache,
    fileSystem: fs,
    fetchBytes: bytesOf(`"sha256:${file.sha256}"`),
  });
  assert.equal(cached.status, "downloaded");
  const target = `${filesDir}/f1.pdf`;

  // The version list moved on (a fill landed), so the open of the new version
  // is a cache miss and hits the network — where the session is now expired.
  const stale = buildPdfVersions(file, [
    {
      versionId: "v2",
      parentVersionId: "v1",
      sha256: shaOf("b"),
      size: 20,
      createdAt: "2026-10-12T09:00:00Z",
    },
    {
      versionId: "v1",
      parentVersionId: null,
      sha256: file.sha256,
      size: 11,
      createdAt: "2026-10-12T08:00:00Z",
    },
  ]);
  const refusal = await openPdfVersion(file, stale[1], {
    cacheDirectory: cache,
    fileSystem: fs,
    fetchBytes: async () => {
      throw new OpenBotError("authentication_required", "会话已过期。");
    },
  }).catch((error: unknown) => error);
  assert.ok(refusal instanceof OpenBotError);
  assert.equal(refusal.code, "authentication_required");

  // The refusal protocol the screen runs: clear that version's cache, keep no
  // render path — a stale render is impossible.
  assert.equal(refusalClearsCache(refusal.code), true);
  await clearVersionCache(file, { cacheDirectory: cache, fileSystem: fs });
  assert.deepEqual(fs.deleted, [target, `${target}.json`]);
  assert.equal(fs.files.has(target), false);
  assert.equal(fs.files.has(`${target}.json`), false);
});

test("404 refusal clears the cache too, but network errors keep it for retry", () => {
  assert.equal(refusalClearsCache("not_found"), true);
  assert.equal(refusalClearsCache("invalid_response"), true);
  assert.equal(refusalClearsCache("authentication_required"), true);
  assert.equal(refusalClearsCache("network"), false);
  assert.equal(refusalClearsCache("unavailable"), false);
});

test("etagMatchesVersion: only the version's own digest verifies; an unknown digest still demands a usable one", () => {
  assert.equal(etagMatchesVersion(`"sha256:${file.sha256}"`, { sha256: file.sha256 }), true);
  assert.equal(etagMatchesVersion(`sha256:${file.sha256}`, { sha256: file.sha256 }), true);
  assert.equal(etagMatchesVersion(`"sha256:${shaOf("b")}"`, { sha256: file.sha256 }), false);
  assert.equal(etagMatchesVersion(null, { sha256: file.sha256 }), false);
  assert.equal(etagMatchesVersion('W/"weak"', { sha256: file.sha256 }), false);
  // Unknown digest (degraded current-version entry): any WELL-FORMED sha256
  // ETag verifies — the digest shown is the one the bytes actually carry.
  assert.equal(etagMatchesVersion(`"sha256:${shaOf("b")}"`, { sha256: null }), true);
  assert.equal(etagMatchesVersion(null, { sha256: null }), false);
  assert.equal(etagMatchesVersion('W/"weak"', { sha256: null }), false);
});

test("an ETag mismatch refuses before anything is cached — wrong bytes never land", async () => {
  const fs = cacheFsStub();
  // Real version rows pin the original's digest; serving anything else refuses.
  const versions = buildPdfVersions(file, [
    {
      versionId: "v1",
      parentVersionId: null,
      sha256: file.sha256,
      size: 11,
      createdAt: "2026-10-12T08:00:00Z",
    },
  ]);
  const target = `${filesDir}/f1.pdf`;
  const error = await openPdfVersion(file, versions[0], {
    cacheDirectory: cache,
    fileSystem: fs,
    // The server served a newer version's bytes for this version's request.
    fetchBytes: bytesOf(`"sha256:${shaOf("z")}"`),
  }).catch((e: unknown) => e);
  assert.ok(error instanceof OpenBotError);
  assert.equal(error.code, "invalid_response");
  assert.equal(fs.files.has(target), false);
  assert.equal(fs.files.has(`${target}.json`), false);
  assert.equal(fs.files.has(`${target}.part`), false);
});

test("degraded open caches whatever the content route serves, labeled with the digest it carries", async () => {
  const fs = cacheFsStub();
  const versions = buildPdfVersions(file, []);
  // A fill already flipped the row's current bytes; the versions route is
  // absent so the viewer cannot tell — the entry claims only "current".
  const served = shaOf("b");
  const result = await openPdfVersion(file, versions[0], {
    cacheDirectory: cache,
    fileSystem: fs,
    fetchBytes: async () => ({ base64: btoa("filled bytes"), etag: `"sha256:${served}"` }),
  });
  assert.equal(result.status, "downloaded");
  assert.equal(result.meta.versionId, "v1");
  assert.equal(result.meta.sha256, served);
});

test("degraded open still refuses bytes with no usable sha256 ETag", async () => {
  for (const etag of [null, 'W/"weak"'] as const) {
    const fs = cacheFsStub();
    const versions = buildPdfVersions(file, []);
    const target = `${filesDir}/f1.pdf`;
    const error = await openPdfVersion(file, versions[0], {
      cacheDirectory: cache,
      fileSystem: fs,
      fetchBytes: bytesOf(etag),
    }).catch((e: unknown) => e);
    assert.ok(error instanceof OpenBotError, `etag ${String(etag)} must refuse`);
    assert.equal(error.code, "invalid_response");
    assert.equal(fs.files.has(target), false);
    assert.equal(fs.files.has(`${target}.json`), false);
  }
});

// ---------------------------------------------------------------------------
// 3. Version change → cache miss → re-download (file-cache reuse).

test("switching to another version classifies the cache stale and re-downloads", async () => {
  const fs = cacheFsStub();
  const rows = [
    {
      versionId: "v2",
      parentVersionId: "v1",
      sha256: shaOf("b"),
      size: 20,
      createdAt: "2026-10-12T09:00:00Z",
    },
    {
      versionId: "v1",
      parentVersionId: null,
      sha256: file.sha256,
      size: 11,
      createdAt: "2026-10-12T08:00:00Z",
    },
  ];
  const versions = buildPdfVersions(file, rows);
  let downloads = 0;
  const etags = new Map([
    ["v1", `"sha256:${file.sha256}"`],
    ["v2", `"sha256:${shaOf("b")}"`],
  ]);
  const fetchBytes = async (versionId: string) => {
    downloads += 1;
    return { base64: btoa(`bytes of ${versionId}`), etag: etags.get(versionId) ?? null };
  };

  const first = await openPdfVersion(file, versions[0], {
    cacheDirectory: cache,
    fileSystem: fs,
    fetchBytes: () => fetchBytes("v1"),
  });
  assert.equal(first.status, "downloaded");
  assert.equal(first.meta.versionId, "v1");

  const second = await openPdfVersion(file, versions[1], {
    cacheDirectory: cache,
    fileSystem: fs,
    fetchBytes: () => fetchBytes("v2"),
  });
  assert.equal(second.status, "downloaded");
  assert.equal(second.meta.versionId, "v2");
  assert.equal(second.meta.sha256, shaOf("b"));
  assert.equal(downloads, 2);
  assert.equal(second.path, `${filesDir}/f1.pdf`);
});

test("a refusal for the switched-away version keeps the other version's cached copy", async () => {
  const fs = cacheFsStub();
  const rows = [
    {
      versionId: "v2",
      parentVersionId: "v1",
      sha256: shaOf("b"),
      size: 20,
      createdAt: "2026-10-12T09:00:00Z",
    },
    {
      versionId: "v1",
      parentVersionId: null,
      sha256: file.sha256,
      size: 11,
      createdAt: "2026-10-12T08:00:00Z",
    },
  ];
  const versions = buildPdfVersions(file, rows);
  // The original is cached first; the switch to the fill then hits a refusal.
  await openPdfVersion(file, versions[0], {
    cacheDirectory: cache,
    fileSystem: fs,
    fetchBytes: bytesOf(`"sha256:${file.sha256}"`),
  });
  // One slot per file, and it still holds v1's valid copy: a v2 refusal must
  // not delete it (the next 原件 open would then needlessly re-download).
  await clearVersionCache(file, { cacheDirectory: cache, fileSystem: fs }, "v2");
  assert.deepEqual(fs.deleted, []);
  assert.equal(fs.files.has(`${filesDir}/f1.pdf`), true);
  // A refusal while the slot still holds the FAILED version clears it.
  await clearVersionCache(file, { cacheDirectory: cache, fileSystem: fs }, "v1");
  assert.deepEqual(fs.deleted, [`${filesDir}/f1.pdf`, `${filesDir}/f1.pdf.json`]);
});

// ---------------------------------------------------------------------------
// 4. Non-PDF files get no preview entry.

test("canPdfPreview: only application/pdf", () => {
  assert.equal(canPdfPreview(file), true);
  assert.equal(canPdfPreview({ ...file, mimeType: "image/png" }), false);
  assert.equal(canPdfPreview({ ...file, mimeType: "text/plain" }), false);
});

// ---------------------------------------------------------------------------
// 5. api: the version fetch the detail DTO lacks (Task 0) + version content.

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function patchFetch(respond: (url: string) => Response) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return respond(url);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test("fetchFileVersions calls the versions route and parses F06-shaped rows", async () => {
  const stubbed = patchFetch(() =>
    json(200, {
      versions: [
        // Extra keys like `values` (F06's fill provenance) strip safely.
        {
          versionId: "v2",
          parentVersionId: "v1",
          sha256: shaOf("b"),
          size: 20,
          createdAt: "2026-10-12T09:00:00Z",
          values: { name: "Ava" },
        },
        {
          versionId: "v1",
          parentVersionId: null,
          sha256: file.sha256,
          size: 11,
          createdAt: "2026-10-12T08:00:00Z",
        },
      ],
    }),
  );
  try {
    const page = await fetchFileVersions("f1");
    assert.equal(stubbed.calls[0], `${openbotUrl}/api/mobile/openmuse-files/f1/versions`);
    assert.equal(page.versions.length, 2);
    assert.equal(page.versions[0].parentVersionId, "v1");
    assert.equal(page.versions[1].parentVersionId, null);
    assert.equal("values" in page.versions[0], false);
  } finally {
    stubbed.restore();
  }
});

test("fetchFileVersions surfaces 404 as not_found and refuses an empty id", async () => {
  const stubbed = patchFetch(() => json(404, { error: "No such file." }));
  try {
    const error = await fetchFileVersions("f1").catch((e: unknown) => e);
    assert.ok(error instanceof OpenBotError);
    assert.equal(error.code, "not_found");
  } finally {
    stubbed.restore();
  }
  assert.throws(
    () => fetchFileVersions("  "),
    (error: unknown) => error instanceof OpenBotError && error.code === "invalid_input",
  );
});

test("fileVersionContentUrl scopes the content route by versionId", () => {
  assert.equal(
    fileVersionContentUrl("f 1", "v 9"),
    `${openbotUrl}/api/mobile/openmuse-files/f%201/content?versionId=v%209`,
  );
});

test("downloadFileVersion returns the raw Response with its ETag", async () => {
  const etag = `"sha256:${file.sha256}"`;
  const stubbed = patchFetch(
    () =>
      new Response("pdf bytes", {
        status: 200,
        headers: { "content-type": "application/pdf", etag },
      }),
  );
  try {
    const response = await downloadFileVersion(file, "v1");
    assert.equal(response.ok, true);
    assert.equal(await response.text(), "pdf bytes");
    assert.equal(response.headers.get("etag"), etag);
    assert.equal(
      stubbed.calls[0],
      `${openbotUrl}/api/mobile/openmuse-files/f1/content?versionId=v1`,
    );
  } finally {
    stubbed.restore();
  }
  assert.throws(
    () => downloadFileVersion(file, " "),
    (error: unknown) => error instanceof OpenBotError && error.code === "invalid_input",
  );
});

// ---------------------------------------------------------------------------
// 6. F08 Android pins: the same seams over the Android cache root
//    (F10's file:///data/user/0/… directory; PdfReader renders file:// URIs).

const androidCache = "file:///data/user/0/com.openmuse.app/cache/";
const androidFilesDir = `${androidCache}openmuse-files`;

test("android: open lands the selected version under the Android cache root as a file:// URI", async () => {
  const fs = cacheFsStub();
  const versions = buildPdfVersions(file, []);
  const cached = await openPdfVersion(file, versions[0], {
    cacheDirectory: androidCache,
    fileSystem: fs,
    fetchBytes: bytesOf(`"sha256:${file.sha256}"`),
  });
  // The exact URI PdfReader receives on Android (react-native-pdf's
  // documented file:///absolute/path form).
  assert.equal(cached.status, "downloaded");
  assert.equal(cached.path, `${androidFilesDir}/f1.pdf`);
  assert.equal(cached.meta.versionId, "v1");
  assert.equal(cached.meta.sha256, file.sha256);
  assert.equal(fs.files.has(`${androidFilesDir}/f1.pdf`), true);
});

test("android: 401 refusal deletes that version's bytes+sidecar under the Android cache root", async () => {
  const fs = cacheFsStub();
  const versions = buildPdfVersions(file, []);
  await openPdfVersion(file, versions[0], {
    cacheDirectory: androidCache,
    fileSystem: fs,
    fetchBytes: bytesOf(`"sha256:${file.sha256}"`),
  });
  // The version list moved on (a fill landed): opening the new version is a
  // cache miss and hits the network — where the session is now expired.
  const stale = buildPdfVersions(file, [
    {
      versionId: "v2",
      parentVersionId: "v1",
      sha256: shaOf("b"),
      size: 20,
      createdAt: "2026-10-12T09:00:00Z",
    },
    {
      versionId: "v1",
      parentVersionId: null,
      sha256: file.sha256,
      size: 11,
      createdAt: "2026-10-12T08:00:00Z",
    },
  ]);
  const refusal = await openPdfVersion(file, stale[1], {
    cacheDirectory: androidCache,
    fileSystem: fs,
    fetchBytes: async () => {
      throw new OpenBotError("authentication_required", "会话已过期。");
    },
  }).catch((error: unknown) => error);
  assert.ok(refusal instanceof OpenBotError);
  assert.equal(refusal.code, "authentication_required");
  assert.equal(refusalClearsCache(refusal.code), true);
  await clearVersionCache(file, { cacheDirectory: androidCache, fileSystem: fs });
  const target = `${androidFilesDir}/f1.pdf`;
  assert.deepEqual(fs.deleted, [target, `${target}.json`]);
  assert.equal(fs.files.has(target), false);
});

test("android: switching to the filled copy re-downloads into the same Android slot", async () => {
  const fs = cacheFsStub();
  const rows = [
    {
      versionId: "v2",
      parentVersionId: "v1",
      sha256: shaOf("b"),
      size: 20,
      createdAt: "2026-10-12T09:00:00Z",
    },
    {
      versionId: "v1",
      parentVersionId: null,
      sha256: file.sha256,
      size: 11,
      createdAt: "2026-10-12T08:00:00Z",
    },
  ];
  const versions = buildPdfVersions(file, rows);
  let downloads = 0;
  const etags = new Map([
    ["v1", `"sha256:${file.sha256}"`],
    ["v2", `"sha256:${shaOf("b")}"`],
  ]);
  const fetchBytes = async (versionId: string) => {
    downloads += 1;
    return { base64: btoa(`bytes of ${versionId}`), etag: etags.get(versionId) ?? null };
  };

  const first = await openPdfVersion(file, versions[0], {
    cacheDirectory: androidCache,
    fileSystem: fs,
    fetchBytes: () => fetchBytes("v1"),
  });
  assert.equal(first.status, "downloaded");
  const second = await openPdfVersion(file, versions[1], {
    cacheDirectory: androidCache,
    fileSystem: fs,
    fetchBytes: () => fetchBytes("v2"),
  });
  assert.equal(second.status, "downloaded");
  assert.equal(second.meta.versionId, "v2");
  assert.equal(second.meta.sha256, shaOf("b"));
  assert.equal(downloads, 2);
  // One slot per file: the switch replaces the bytes at the same Android path.
  assert.equal(second.path, `${androidFilesDir}/f1.pdf`);
});
