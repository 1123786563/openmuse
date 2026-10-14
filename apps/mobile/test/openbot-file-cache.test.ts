import assert from "node:assert/strict";
import test from "node:test";
import { downloadFile, fetchFiles, fileContentUrl } from "../src/openbot/api.ts";
import { openbotUrl } from "../src/openbot/config.ts";
import { OpenBotError } from "../src/openbot/errors.ts";
import {
  bytesLengthOfBase64,
  classifyCache,
  deriveCachePath,
  ensureCached,
  extensionFor,
} from "../src/openbot/file-cache.ts";
import { clearNativePrivateState } from "../src/openbot/private-state.ts";

/**
 * F04 pure-seam tests: cache path derivation (traversal refused), staleness by
 * versionId, the temp+rename download flow over an injected fs, and the I07
 * logout sweep over the written path. F10 adds Android-parameterized pins over
 * the same seams (the audit found no platform delta). Everything here runs
 * without react-native/expo — the screen injects the real adapter.
 */

const cache = "file:///var/mobile/Containers/Data/Application/X/Library/Caches/";
const filesDir = `${cache}openmuse-files`;

const file = {
  id: "f1",
  name: "contract.pdf",
  mimeType: "application/pdf",
  versionId: "v1",
  size: 11,
} as const;

const sha = "a".repeat(64);
const etag = `"sha256:${sha}"`;

// ---------------------------------------------------------------------------
// 1. Cache path derivation.

test("deriveCachePath maps fileId+extension into openmuse-files under the cache directory", () => {
  assert.equal(deriveCachePath(cache, "f1", "pdf"), `${filesDir}/f1.pdf`);
  // A cache directory without the trailing slash joins the same way.
  assert.equal(deriveCachePath(cache.replace(/\/$/, ""), "f1", "pdf"), `${filesDir}/f1.pdf`);
});

test("deriveCachePath refuses path traversal in the fileId", () => {
  for (const id of ["../escape", "a/b", "a\\b", "..", ".", ""]) {
    assert.throws(
      () => deriveCachePath(cache, id, "pdf"),
      (error: unknown) => error instanceof OpenBotError && error.code === "invalid_input",
      `fileId ${JSON.stringify(id)} must be refused`,
    );
  }
});

test("deriveCachePath sanitizes the extension so it can never carry a separator", () => {
  // Whatever the display name's suffix collapses to, the result stays a single
  // path segment under openmuse-files.
  assert.equal(deriveCachePath(cache, "f1", "PDF"), `${filesDir}/f1.pdf`);
  assert.equal(deriveCachePath(cache, "f1", "../x"), `${filesDir}/f1.x`);
  assert.equal(deriveCachePath(cache, "f1", ""), `${filesDir}/f1.bin`);
});

test("extensionFor prefers the name's suffix, falls back to the mime map, then bin", () => {
  assert.equal(extensionFor({ name: "report.PDF", mimeType: "text/plain" }), "pdf");
  assert.equal(extensionFor({ name: "noext", mimeType: "image/png" }), "png");
  assert.equal(extensionFor({ name: "noext", mimeType: "application/x-unknown" }), "bin");
  assert.equal(extensionFor({ name: "weird.name.here", mimeType: "application/pdf" }), "here");
});

// ---------------------------------------------------------------------------
// 2. Staleness classification.

test("classifyCache: same versionId is a hit; different or absent is a miss", () => {
  assert.equal(classifyCache("v1", "v1"), "hit");
  assert.equal(classifyCache("v1", "v2"), "miss");
  assert.equal(classifyCache(null, "v1"), "miss");
  assert.equal(classifyCache(undefined, "v1"), "miss");
});

// ---------------------------------------------------------------------------
// 3. Download flow over an injected fs.

/** In-memory CacheFileSystem with write/move/delete logs. */
function cacheFsStub() {
  const files = new Map<string, string>();
  const moves: { from: string; to: string }[] = [];
  const deleted: string[] = [];
  const textWrites: string[] = [];
  const byteWrites: string[] = [];
  return {
    files,
    moves,
    deleted,
    textWrites,
    byteWrites,
    hasFileAsync: async (path: string) => files.has(path),
    makeDirectoryAsync: async () => {},
    writeFileAsync: async (path: string, base64: string) => {
      byteWrites.push(path);
      files.set(path, base64);
    },
    writeTextAsync: async (path: string, text: string) => {
      textWrites.push(path);
      files.set(path, text);
    },
    readFileAsync: async (path: string) => {
      if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
      return files.get(path) as string;
    },
    moveAsync: async (from: string, to: string) => {
      moves.push({ from, to });
      files.set(to, files.get(from) ?? "");
      files.delete(from);
    },
    deleteAsync: async (path: string) => {
      deleted.push(path);
      files.delete(path);
    },
  };
}

test("ensureCached writes via temp+rename to the derived path and records etag/sha/size", async () => {
  const fs = cacheFsStub();
  const calls: number[] = [];
  const fetchBytes = async () => {
    calls.push(calls.length);
    return { base64: btoa("hello bytes"), etag };
  };
  const result = await ensureCached(file, { cacheDirectory: cache, fetchBytes, fileSystem: fs });
  assert.equal(result.status, "downloaded");
  const target = `${filesDir}/f1.pdf`;
  assert.equal(result.path, target);
  assert.equal(fs.files.get(target), btoa("hello bytes"));
  assert.deepEqual(fs.moves, [{ from: `${target}.part`, to: target }]);
  const meta = JSON.parse(fs.files.get(`${target}.json`) as string);
  assert.equal(meta.versionId, "v1");
  assert.equal(meta.sha256, sha);
  assert.equal(meta.etag, etag);
  assert.equal(meta.size, "hello bytes".length);
  // Same version again: a pure cache hit, zero new requests.
  const again = await ensureCached(file, { cacheDirectory: cache, fetchBytes, fileSystem: fs });
  assert.equal(again.status, "hit");
  assert.equal(calls.length, 1);
});

test("a versionId change classifies the cache stale and forces a re-download", async () => {
  const fs = cacheFsStub();
  let downloads = 0;
  const fetchBytes = async () => {
    downloads += 1;
    return { base64: btoa("hello bytes"), etag };
  };
  await ensureCached(file, { cacheDirectory: cache, fetchBytes, fileSystem: fs });
  const renewed = await ensureCached(
    { ...file, versionId: "v2" },
    { cacheDirectory: cache, fetchBytes, fileSystem: fs },
  );
  assert.equal(renewed.status, "downloaded");
  assert.equal(downloads, 2);
  assert.equal(renewed.meta.versionId, "v2");
});

test("a re-download over an existing target deletes it before the move (iOS moveAsync refuses existing targets)", async () => {
  const fs = cacheFsStub();
  const target = `${filesDir}/f1.pdf`;
  // iOS's NSFileManager moveItemAtPath throws when the destination exists
  // (Android's rename(2) overwrites) — the Map.set stub default masked this.
  fs.moveAsync = async (from, to) => {
    if (fs.files.has(to)) throw new Error("NSFileManagerMoveItemAtPath: EEXIST");
    fs.files.set(to, fs.files.get(from) ?? "");
    fs.files.delete(from);
  };
  const bytesOf = (versionId: string) => async () => ({
    base64: btoa(`bytes of ${versionId}`),
    etag,
  });
  await ensureCached(file, { cacheDirectory: cache, fetchBytes: bytesOf("v1"), fileSystem: fs });
  const renewed = await ensureCached(
    { ...file, versionId: "v2" },
    { cacheDirectory: cache, fetchBytes: bytesOf("v2"), fileSystem: fs },
  );
  assert.equal(renewed.status, "downloaded");
  assert.equal(fs.files.get(target), btoa("bytes of v2"));
  // The overwrite was made safe by an explicit delete of the old target first.
  assert.ok(fs.deleted.includes(target));
});

test("a mid-write failure never reports a complete download", async () => {
  const fs = cacheFsStub();
  const originalWrite = fs.writeFileAsync;
  const target = `${filesDir}/f1.pdf`;
  fs.writeFileAsync = async (path: string, base64: string) => {
    if (path.endsWith(".part")) throw new Error("disk full");
    return originalWrite(path, base64);
  };
  const fetchBytes = async () => ({ base64: btoa("hello bytes"), etag });
  await assert.rejects(
    ensureCached(file, { cacheDirectory: cache, fetchBytes, fileSystem: fs }),
    /disk full/,
  );
  // No final file, no meta, and the leftover temp is cleaned up.
  assert.equal(fs.files.has(target), false);
  assert.equal(fs.files.has(`${target}.json`), false);
  assert.deepEqual(fs.deleted, [`${target}.part`]);
});

test("concurrent ensureCached on the same slot serialize: bytes and sidecar land as one consistent pair", async () => {
  const fs = cacheFsStub();
  const target = `${filesDir}/f1.pdf`;
  const bytesOf = (versionId: string) => btoa(`bytes of ${versionId}`);
  const etagOf = (sha: string) => `"sha256:${sha}"`;
  // F04's list download and F07's preview race for the same fileId slot with
  // two different versions (user closed the preview and re-opened on another
  // chip while the first download was still in flight).
  const [first, second] = await Promise.all([
    ensureCached(file, {
      cacheDirectory: cache,
      fetchBytes: async () => ({ base64: bytesOf("v1"), etag: etagOf("a".repeat(64)) }),
      fileSystem: fs,
    }),
    ensureCached(
      { ...file, versionId: "v2" },
      {
        cacheDirectory: cache,
        fetchBytes: async () => ({ base64: bytesOf("v2"), etag: etagOf("b".repeat(64)) }),
        fileSystem: fs,
      },
    ),
  ]);
  assert.equal(first.status, "downloaded");
  assert.equal(second.status, "downloaded");
  // Whichever flow ran last, the slot's bytes and sidecar must describe the
  // SAME version — never one flow's bytes labeled with the other's versionId.
  const landed = fs.files.get(target) ?? "";
  const meta = JSON.parse(fs.files.get(`${target}.json`) as string);
  assert.notEqual(landed, "", "the slot must not end up empty from a stolen .part move");
  assert.equal(landed, bytesOf(meta.versionId));
  assert.ok(meta.versionId === "v1" || meta.versionId === "v2");
  // No half-written temp survives either flow.
  assert.equal(fs.files.has(`${target}.part`), false);
});

test("concurrent ensureCached of the same version download once and share the hit", async () => {
  const fs = cacheFsStub();
  let downloads = 0;
  const fetchBytes = async () => {
    downloads += 1;
    return { base64: btoa("hello bytes"), etag };
  };
  const [a, b] = await Promise.all([
    ensureCached(file, { cacheDirectory: cache, fetchBytes, fileSystem: fs }),
    ensureCached(file, { cacheDirectory: cache, fetchBytes, fileSystem: fs }),
  ]);
  // Double-tap on 下载: one download, one hit — never two concurrent fetches.
  assert.equal(downloads, 1);
  assert.equal(a.status, "downloaded");
  assert.equal(b.status, "hit");
  assert.equal(a.path, b.path);
});

test("a surviving sidecar without its bytes re-downloads instead of a dangling hit", async () => {
  const fs = cacheFsStub();
  const target = `${filesDir}/f1.pdf`;
  let downloads = 0;
  const fetchBytes = async () => {
    downloads += 1;
    return { base64: btoa("hello bytes"), etag };
  };
  await ensureCached(file, { cacheDirectory: cache, fetchBytes, fileSystem: fs });
  // The OS reclaimed the bytes file alone; the meta sidecar survived.
  fs.files.delete(target);
  const again = await ensureCached(file, { cacheDirectory: cache, fetchBytes, fileSystem: fs });
  assert.equal(again.status, "downloaded");
  assert.equal(downloads, 2);
  assert.equal(fs.files.has(target), true);
  assert.equal(again.meta.versionId, "v1");
});

test("bytesLengthOfBase64 counts bytes, not characters", () => {
  assert.equal(bytesLengthOfBase64(btoa("hello bytes")), 11);
  assert.equal(bytesLengthOfBase64(""), 0);
  assert.equal(bytesLengthOfBase64(btoa("a")), 1);
});

// ---------------------------------------------------------------------------
// 4. Logout integration: the written path sits inside I07's sweep.

/**
 * One stub satisfying BOTH interfaces: the seam's CacheFileSystem for writing
 * and private-state's FileSystemLike (infoAsync/readDirectoryAsync/deleteAsync)
 * so clearNativePrivateState can walk the same tree.
 */
function deviceFsStub(cacheDirectory: string = cache) {
  const dirs = new Set<string>();
  const files = new Map<string, string>();
  const deleted: string[] = [];
  const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/"));
  const listUnder = (uri: string) => {
    const dir = uri.endsWith("/") ? uri.slice(0, -1) : uri;
    return [...dirs, ...files.keys()]
      .filter((p) => parentOf(p) === dir)
      .map((p) => p.slice(dir.length + 1));
  };
  return {
    cacheDirectory,
    dirs,
    files,
    deleted,
    hasFileAsync: async (uri: string) => files.has(uri) || dirs.has(uri),
    makeDirectoryAsync: async (dir: string) => {
      dirs.add(dir);
    },
    writeFileAsync: async (path: string, base64: string) => {
      files.set(path, base64);
    },
    writeTextAsync: async (path: string, text: string) => {
      files.set(path, text);
    },
    readFileAsync: async (path: string) => {
      if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
      return files.get(path) as string;
    },
    moveAsync: async (from: string, to: string) => {
      files.set(to, files.get(from) ?? "");
      files.delete(from);
    },
    deleteAsync: async (path: string) => {
      deleted.push(path);
      files.delete(path);
      dirs.delete(path);
    },
    infoAsync: async (uri: string) => ({
      exists: dirs.has(uri) || files.has(uri),
      isDirectory: dirs.has(uri),
    }),
    readDirectoryAsync: async (uri: string) => listUnder(uri),
  };
}

test("logout sweep: clearNativePrivateState deletes a downloaded cache file (I07 registry)", async () => {
  const fs = deviceFsStub();
  const fetchBytes = async () => ({ base64: btoa("hello bytes"), etag });
  await ensureCached(file, { cacheDirectory: fs.cacheDirectory, fetchBytes, fileSystem: fs });
  const target = `${filesDir}/f1.pdf`;
  assert.ok(fs.files.has(target), "fixture: the download landed");
  const report = await clearNativePrivateState({ fileSystem: fs });
  assert.equal(fs.files.has(target), false);
  assert.equal(fs.files.has(`${target}.json`), false);
  assert.deepEqual(report.failedDeletes, []);
});

// ---------------------------------------------------------------------------
// 5. Android regression pins (F10 audit: no delta — the screen adapter and the
//    I07/I08 registry both take cacheDirectory from the runtime/injected fs,
//    so the same seams hold under Android's cache root; these pin that).

const androidCache = "file:///data/user/0/com.openmuse.app/cache/";
const androidFilesDir = `${androidCache}openmuse-files`;

test("android: download lands under the Android cache root via temp+rename", async () => {
  const fs = cacheFsStub();
  const fetchBytes = async () => ({ base64: btoa("android bytes"), etag });
  const result = await ensureCached(file, {
    cacheDirectory: androidCache,
    fetchBytes,
    fileSystem: fs,
  });
  const target = `${androidFilesDir}/f1.pdf`;
  assert.equal(result.status, "downloaded");
  assert.equal(result.path, target);
  assert.deepEqual(fs.moves, [{ from: `${target}.part`, to: target }]);
  assert.equal(fs.files.get(target), btoa("android bytes"));
});

test("android: write→clear→deleted — the I07/I08 sweep takes F04 bytes, sidecar, and deep siblings", async () => {
  const fs = deviceFsStub(androidCache);
  const fetchBytes = async () => ({ base64: btoa("android bytes"), etag });
  const { path } = await ensureCached(file, {
    cacheDirectory: androidCache,
    fetchBytes,
    fileSystem: fs,
  });
  // F07 will write deeper under the same tree; the recursive walk covers it.
  fs.dirs.add(`${androidFilesDir}/2026`);
  fs.dirs.add(`${androidFilesDir}/2026/10`);
  fs.files.set(`${androidFilesDir}/2026/10/deep.pdf`, "deep bytes");
  const report = await clearNativePrivateState({ fileSystem: fs });
  assert.equal(fs.files.has(path), false);
  assert.equal(fs.files.has(`${path}.json`), false);
  assert.equal(fs.files.has(`${androidFilesDir}/2026/10/deep.pdf`), false);
  assert.deepEqual(report.failedDeletes, []);
});

test("android: one locked delete is reported while sibling cache files still clear", async () => {
  const fs = deviceFsStub(androidCache);
  const fetchBytes = async () => ({ base64: btoa("android bytes"), etag });
  const plain = await ensureCached(file, {
    cacheDirectory: androidCache,
    fetchBytes,
    fileSystem: fs,
  });
  const locked = await ensureCached(
    { ...file, id: "f2", name: "locked.png", mimeType: "image/png" },
    { cacheDirectory: androidCache, fetchBytes, fileSystem: fs },
  );
  const originalDelete = fs.deleteAsync;
  fs.deleteAsync = async (path: string) => {
    if (path === locked.path) throw new Error("EPERM");
    return originalDelete(path);
  };
  const report = await clearNativePrivateState({ fileSystem: fs });
  assert.deepEqual(report.failedDeletes, [locked.path]);
  assert.equal(fs.files.has(plain.path), false);
  assert.equal(fs.files.has(`${plain.path}.json`), false);
});

test("android: B-user sequence — after A's logout the device holds no A bytes and B starts fresh", async () => {
  const fs = deviceFsStub(androidCache);
  let downloads = 0;
  const fetchBytes = async () => {
    downloads += 1;
    return { base64: btoa("user A bytes"), etag };
  };
  await ensureCached(file, { cacheDirectory: androidCache, fetchBytes, fileSystem: fs });
  // A signs out (server revoke already ran); the registry sweep clears the rest.
  await clearNativePrivateState({ fileSystem: fs });
  assert.deepEqual([...fs.files.keys()], []);
  // B's download cannot hit A's stale cache: it re-fetches with B's version.
  const b = await ensureCached(
    { ...file, versionId: "b1" },
    { cacheDirectory: androidCache, fetchBytes, fileSystem: fs },
  );
  assert.equal(b.status, "downloaded");
  assert.equal(downloads, 2);
  assert.equal(b.meta.versionId, "b1");
});

// ---------------------------------------------------------------------------
// 6. api: list + authenticated content URL.

const fileRow = {
  id: "f1",
  name: "contract.pdf",
  mimeType: "application/pdf",
  size: 11,
  sha256: sha,
  versionId: "v1",
  createdAt: "2026-10-12T08:00:00Z",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Patch globalThis.fetch with a recorder; any /api/session hit fails the test. */
function patchFetch(respond: (url: string, init: RequestInit) => Response) {
  const original = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/session")) throw new Error(`legacy endpoint hit: ${url}`);
    calls.push({ url, init: init ?? {} });
    return respond(url, init ?? {});
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test("fetchFiles lists the owner's files and passes the cursor through", async () => {
  const stubbed = patchFetch(() => json(200, { files: [fileRow], nextCursor: "c2" }));
  try {
    const page = await fetchFiles();
    assert.deepEqual(page, { files: [fileRow], nextCursor: "c2" });
    assert.equal(stubbed.calls[0].url, `${openbotUrl}/api/mobile/openmuse-files`);
    assert.equal(stubbed.calls[0].init.method, "GET");
    const next = await fetchFiles("c2");
    assert.equal(stubbed.calls[1].url, `${openbotUrl}/api/mobile/openmuse-files?cursor=c2`);
    assert.equal(next.nextCursor, "c2");
  } finally {
    stubbed.restore();
  }
});

test("fetchFiles surfaces 401 and 404 through the shared error mapping", async () => {
  const unauthorized = patchFetch(() => json(401, { error: "Sign in first." }));
  try {
    const error = await fetchFiles().catch((e: unknown) => e);
    assert.ok(error instanceof OpenBotError);
    assert.equal(error.code, "authentication_required");
  } finally {
    unauthorized.restore();
  }
  const missing = patchFetch(() => json(404, { error: "No such file." }));
  try {
    const error = await fetchFiles().catch((e: unknown) => e);
    assert.ok(error instanceof OpenBotError);
    assert.equal(error.code, "not_found");
  } finally {
    missing.restore();
  }
});

test("fileContentUrl builds the authenticated content route and downloadFile returns the raw Response", async () => {
  assert.equal(fileContentUrl("f 1"), `${openbotUrl}/api/mobile/openmuse-files/f%201/content`);
  const stubbed = patchFetch(
    () =>
      new Response("hello bytes", {
        status: 200,
        headers: { "content-type": "application/pdf", etag },
      }),
  );
  try {
    const response = await downloadFile(fileRow);
    assert.equal(response.ok, true);
    assert.equal(await response.text(), "hello bytes");
    assert.equal(response.headers.get("etag"), etag);
    assert.equal(stubbed.calls[0].url, `${openbotUrl}/api/mobile/openmuse-files/f1/content`);
    assert.equal(stubbed.calls[0].init.method, "GET");
  } finally {
    stubbed.restore();
  }
});

test("the meta sidecar rides the TEXT write channel; bytes ride base64", async () => {
  // writeFileAsync's payload is base64-decoded by real adapters (Android
  // throws on JSON chars, iOS mangles them), so the UTF-8 JSON sidecar must
  // go through writeTextAsync or every cache read back is corrupt.
  const fs = cacheFsStub();
  await ensureCached(file, {
    cacheDirectory: cache,
    fetchBytes: async () => ({ base64: btoa("payload"), etag }),
    fileSystem: fs,
  });
  const target = `${filesDir}/f1.pdf`;
  assert.deepEqual(fs.byteWrites, [`${target}.part`]);
  assert.deepEqual(fs.textWrites, [`${target}.json`]);
  assert.equal(JSON.parse(fs.files.get(`${target}.json`) as string).versionId, "v1");
});
