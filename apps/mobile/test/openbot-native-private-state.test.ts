import assert from "node:assert/strict";
import test from "node:test";
import { openbotEndpoint } from "../src/openbot/config.ts";
import {
  clearNativePrivateState,
  nativePrivateKeys,
  pdfCachePaths,
} from "../src/openbot/private-state.ts";

/** Minimal SecureStore stub: a map plus a deletion log. */
function secureStoreStub(initial: Record<string, string> = {}, failDelete: string[] = []) {
  const store = new Map(Object.entries(initial));
  const deletions: string[] = [];
  return {
    store,
    deletions,
    keys: () => [...store.keys()],
    deleteItemAsync: async (key: string) => {
      if (failDelete.includes(key)) throw new Error(`delete failed: ${key}`);
      deletions.push(key);
      store.delete(key);
    },
  };
}

/**
 * Minimal expo-file-system/legacy stub over an in-memory tree: directories as
 * a URI set, files as a URI map, deletions logged, optional delete failures.
 */
function fileSystemStub(
  init: {
    cacheDirectory?: string;
    dirs?: string[];
    files?: Record<string, string>;
    failDelete?: string[];
    failRead?: string[];
    failInfo?: string[];
  } = {},
) {
  const cacheDirectory = init.cacheDirectory ?? "file:///var/cache/";
  const dirs = new Set(init.dirs ?? []);
  const files = new Map(Object.entries(init.files ?? {}));
  const deleted: string[] = [];
  const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/"));
  return {
    deleted,
    files,
    cacheDirectory,
    readDirectoryAsync: async (uri: string) => {
      const dir = uri.endsWith("/") ? uri.slice(0, -1) : uri;
      if (init.failRead?.includes(dir)) throw new Error(`read failed: ${dir}`);
      return [...dirs, ...files.keys()]
        .filter((p) => parentOf(p) === dir)
        .map((p) => p.slice(dir.length + 1));
    },
    infoAsync: async (uri: string) => {
      if (init.failInfo?.includes(uri)) throw new Error(`info failed: ${uri}`);
      return {
        exists: dirs.has(uri) || files.has(uri),
        isDirectory: dirs.has(uri),
      };
    },
    deleteAsync: async (uri: string, options?: { idempotent?: boolean }) => {
      if (init.failDelete?.includes(uri)) throw new Error(`delete failed: ${uri}`);
      if (!dirs.has(uri) && !files.has(uri)) {
        if (options?.idempotent) return;
        throw new Error(`ENOENT: ${uri}`);
      }
      deleted.push(uri);
      dirs.delete(uri);
      files.delete(uri);
    },
  };
}

test("native registry matches the auth.ts storagePrefix computation", () => {
  // auth.ts (edit out of scope for this ticket) passes
  // `openmuse-openbot-${openbotEndpoint.host.replace(/[^a-zA-Z0-9_-]/g, "-")}`
  // as the expo plugin's storagePrefix; every SecureStore key it writes is
  // namespaced under it (`_cookie` jar, `_session_data` cache, `.N` chunk
  // tails). The registry recomputes the same expression from the same config
  // endpoint, and this test pins the two together.
  const expected = `openmuse-openbot-${openbotEndpoint.host.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  assert.ok(nativePrivateKeys.prefixes.includes(expected));
});

test("clearNativePrivateState removes every prefixed SecureStore key and leaves unrelated keys", async () => {
  const prefix = nativePrivateKeys.prefixes[0];
  const ss = secureStoreStub({
    [`${prefix}_cookie`]: "{}",
    [`${prefix}_cookie.0`]: "user A cookie chunk",
    [`${prefix}_session_data`]: '{"user":{"id":"a"}}',
    "expo-unrelated-key": "keep",
  });
  const report = await clearNativePrivateState({ secureStore: ss });
  assert.deepEqual([...ss.store.keys()].sort(), ["expo-unrelated-key"]);
  assert.deepEqual(
    report.removedKeys.sort(),
    [`${prefix}_cookie`, `${prefix}_cookie.0`, `${prefix}_session_data`].sort(),
  );
});

test("pdfCachePaths enumerates openmuse-files recursively; clear deletes only those files", async () => {
  const fs = fileSystemStub({
    dirs: ["file:///var/cache/openmuse-files", "file:///var/cache/openmuse-files/filled"],
    files: {
      "file:///var/cache/openmuse-files/contract.pdf": "A bytes",
      "file:///var/cache/openmuse-files/filled/report.pdf": "A bytes",
      "file:///var/cache/unrelated.pdf": "keep",
    },
  });
  assert.deepEqual((await pdfCachePaths(fs)).sort(), [
    "file:///var/cache/openmuse-files/contract.pdf",
    "file:///var/cache/openmuse-files/filled/report.pdf",
  ]);
  const report = await clearNativePrivateState({ fileSystem: fs });
  assert.deepEqual([...fs.files.keys()], ["file:///var/cache/unrelated.pdf"]);
  assert.deepEqual(fs.deleted.sort(), [
    "file:///var/cache/openmuse-files/contract.pdf",
    "file:///var/cache/openmuse-files/filled/report.pdf",
  ]);
  assert.deepEqual(report.failedDeletes, []);
});

test("end-to-end: after native sign-out, user B observes no A-era key or cached byte", async () => {
  const prefix = nativePrivateKeys.prefixes[0];
  const ss = secureStoreStub({
    "expo-unrelated-key": "keep",
  });
  const fs = fileSystemStub({
    dirs: ["file:///var/cache/openmuse-files"],
    files: { "file:///var/cache/openmuse-files/a-file.pdf": "A bytes" },
  });
  // User A's session lands: the cookie jar is large enough that the expo
  // client splits it across `.0`/`.1` chunk keys and marks the base key.
  ss.store.set(`${prefix}_cookie.0`, "user A session cookie chunk 0");
  ss.store.set(`${prefix}_cookie.1`, "user A session cookie chunk 1");
  ss.store.set(`${prefix}_cookie`, "ba-chunks:2");
  ss.store.set(`${prefix}_session_data`, '{"user":{"id":"a"}}');
  // Sign-out (auth.ts signOut → plugin clearSessionCache) rewrites the base
  // keys short — the stale chunk keys holding A's cookie bytes survive it.
  ss.store.set(`${prefix}_cookie`, "{}");
  ss.store.set(`${prefix}_session_data`, "{}");
  // The registry sweep then deletes every prefixed key outright.
  const report = await clearNativePrivateState({ secureStore: ss, fileSystem: fs });
  assert.deepEqual(report.failedDeletes, []);
  for (const key of ss.keys()) assert.ok(!key.startsWith(prefix), `A-era key survived: ${key}`);
  assert.equal(ss.store.get("expo-unrelated-key"), "keep");
  assert.equal(fs.files.get("file:///var/cache/openmuse-files/a-file.pdf"), undefined);
});

test("a PDF delete failure is reported back while other deletions still happen", async () => {
  const failing = "file:///var/cache/openmuse-files/locked.pdf";
  const other = "file:///var/cache/openmuse-files/plain.pdf";
  const fs = fileSystemStub({
    dirs: ["file:///var/cache/openmuse-files"],
    files: { [failing]: "A", [other]: "B" },
    failDelete: [failing],
  });
  const report = await clearNativePrivateState({ fileSystem: fs });
  assert.deepEqual(report.failedDeletes, [failing]);
  assert.deepEqual(fs.deleted, [other]);
  assert.equal(fs.files.get(other), undefined);
});

// ---------------------------------------------------------------------------
// I08: Android parameterization. Task 0 audited the shared I07 path and found
// NO Android delta: nativeAdapters() accepts Platform.OS "android" alongside
// "ios", and pdfCachePaths takes the cache directory from the injected fs —
// expo-file-system resolves it per platform at runtime (Android:
// file:///data/user/0/<pkg>/cache/). With no gap, these cases are regression
// pins, not RED tests.

/** Android expo-file-system cacheDirectory shape: app sandbox, trailing slash. */
const androidCache = "file:///data/user/0/com.openmuse.app/cache/";

test("android: pdfCachePaths walks nested cache dirs to depth 3; clear deletes only those files", async () => {
  const deep = `${androidCache}openmuse-files/2026/10/deep.pdf`;
  const fs = fileSystemStub({
    cacheDirectory: androidCache,
    dirs: [
      `${androidCache}openmuse-files`,
      `${androidCache}openmuse-files/2026`,
      `${androidCache}openmuse-files/2026/10`,
    ],
    files: {
      [deep]: "A bytes",
      [`${androidCache}other-app-file.pdf`]: "keep",
    },
  });
  assert.deepEqual(await pdfCachePaths(fs), [deep]);
  const report = await clearNativePrivateState({ fileSystem: fs });
  assert.deepEqual(fs.deleted, [deep]);
  assert.equal(fs.files.get(`${androidCache}other-app-file.pdf`), "keep");
  assert.deepEqual(report.failedDeletes, []);
});

test("android: the registry prefix covers every SecureStore key the Android expo client writes", async () => {
  const prefix = nativePrivateKeys.prefixes[0];
  // auth.ts passes the same storagePrefix on both platforms; the Android
  // plugin writes the identical key shapes — base keys plus `.N` chunk tails.
  const ss = secureStoreStub({
    [`${prefix}_cookie`]: "ba-chunks:2",
    [`${prefix}_cookie.0`]: "user A cookie chunk 0",
    [`${prefix}_cookie.1`]: "user A cookie chunk 1",
    [`${prefix}_session_data`]: '{"user":{"id":"a"}}',
    "unrelated-android-key": "keep",
  });
  const report = await clearNativePrivateState({ secureStore: ss });
  assert.deepEqual(
    report.removedKeys.sort(),
    [
      `${prefix}_cookie`,
      `${prefix}_cookie.0`,
      `${prefix}_cookie.1`,
      `${prefix}_session_data`,
    ].sort(),
  );
  assert.deepEqual([...ss.store.keys()], ["unrelated-android-key"]);
});

test("android: a locked deep PDF delete failure is reported while sibling deletions still happen", async () => {
  const failing = `${androidCache}openmuse-files/2026/locked.pdf`;
  const other = `${androidCache}openmuse-files/plain.pdf`;
  const fs = fileSystemStub({
    cacheDirectory: androidCache,
    dirs: [`${androidCache}openmuse-files`, `${androidCache}openmuse-files/2026`],
    files: { [failing]: "A", [other]: "B" },
    failDelete: [failing],
  });
  const report = await clearNativePrivateState({ fileSystem: fs });
  assert.deepEqual(report.failedDeletes, [failing]);
  assert.deepEqual(fs.deleted, [other]);
  assert.equal(fs.files.get(other), undefined);
});

test("android: after sign-out, user B on the same device observes no A-era key or cached byte", async () => {
  const prefix = nativePrivateKeys.prefixes[0];
  const ss = secureStoreStub({ "unrelated-android-key": "keep" });
  const aPdf = `${androidCache}openmuse-files/2026/10/a-deep-file.pdf`;
  const fs = fileSystemStub({
    cacheDirectory: androidCache,
    dirs: [
      `${androidCache}openmuse-files`,
      `${androidCache}openmuse-files/2026`,
      `${androidCache}openmuse-files/2026/10`,
    ],
    files: {},
  });
  // User A's session lands on the device: a chunked cookie jar plus a deep
  // PDF download. (fs.files is the raw map, so seed directly.)
  ss.store.set(`${prefix}_cookie`, "ba-chunks:2");
  ss.store.set(`${prefix}_cookie.0`, "user A session cookie chunk 0");
  ss.store.set(`${prefix}_cookie.1`, "user A session cookie chunk 1");
  ss.store.set(`${prefix}_session_data`, '{"user":{"id":"a"}}');
  fs.files.set(aPdf, "A bytes");
  // Sign-out: server revoke already ran; the registry sweep takes the rest.
  const report = await clearNativePrivateState({ secureStore: ss, fileSystem: fs });
  assert.deepEqual(report.failedDeletes, []);
  // User B's fresh device view: no A-era key or byte anywhere.
  for (const key of ss.keys()) assert.ok(!key.startsWith(prefix), `A-era key survived: ${key}`);
  assert.equal(ss.store.get("unrelated-android-key"), "keep");
  assert.equal(fs.files.get(aPdf), undefined);
});

test("a SecureStore delete failure is isolated: the sweep still clears the rest and reports the failed key", async () => {
  const prefix = nativePrivateKeys.prefixes[0];
  const failing = `${prefix}_cookie`;
  const ss = secureStoreStub(
    {
      [failing]: "{}",
      [`${prefix}_session_data`]: '{"user":{"id":"a"}}',
      "expo-unrelated-key": "keep",
    },
    [failing],
  );
  const pdf = "file:///var/cache/openmuse-files/a.pdf";
  const fs = fileSystemStub({
    dirs: ["file:///var/cache/openmuse-files"],
    files: { [pdf]: "A bytes" },
  });
  const report = await clearNativePrivateState({ secureStore: ss, fileSystem: fs });
  // One key's transient failure must not abort the chain: the other key and
  // the PDF cache still clear, and the failure is reported, not swallowed.
  assert.deepEqual(report.failedKeys, [failing]);
  assert.deepEqual(report.removedKeys, [`${prefix}_session_data`]);
  assert.equal(ss.store.get(`${prefix}_session_data`), undefined);
  assert.equal(ss.store.get(failing), "{}"); // the failed key itself survives
  assert.equal(fs.files.get(pdf), undefined);
  assert.deepEqual(report.failedDeletes, []);
});

test("an unreadable cache directory surfaces instead of silently degrading the sweep to a no-op", async () => {
  const dir = "file:///var/cache/openmuse-files";
  const fs = fileSystemStub({ dirs: [dir], failRead: [dir] });
  // infoAsync proves the directory exists, so the read failure is a real IO
  // fault: it must propagate (the caller's report loses nothing silently).
  await assert.rejects(() => pdfCachePaths(fs), /read failed/);
});

test("an unreadable cache root (infoAsync failing) surfaces, not a silent no-op", async () => {
  const dir = "file:///var/cache/openmuse-files";
  const fs = fileSystemStub({ dirs: [dir], failInfo: [dir] });
  // A transient probe failure is not proof the directory is absent: treating
  // it as absent turns the whole sweep into a silent no-op while the caller's
  // report still says "cleared" — the exact failure mode the module promises
  // never to hit. Only exists === false is an absent directory.
  await assert.rejects(() => pdfCachePaths(fs), /info failed/);
});

test("an absent cache directory is still the normal no-op, not an error", async () => {
  const fs = fileSystemStub({ dirs: [] });
  assert.deepEqual(await pdfCachePaths(fs), []);
});
