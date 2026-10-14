import assert from "node:assert/strict";
import test from "node:test";
import { resolveOpenbotUrl } from "../src/openbot/config";

/**
 * I05 Android URL delta: only the default host varies per platform — Android
 * emulators reach the host machine at 10.0.2.2, not localhost. An explicit
 * EXPO_PUBLIC_OPENBOT_URL always wins verbatim. Pure seam: platform and env
 * are injected, react-native is never imported.
 */

test("android with no env defaults to the emulator loopback 10.0.2.2", () => {
  assert.equal(resolveOpenbotUrl("android"), "http://10.0.2.2:8787");
  assert.equal(resolveOpenbotUrl("android", undefined), "http://10.0.2.2:8787");
});

test("ios and web with no env keep the localhost default", () => {
  assert.equal(resolveOpenbotUrl("ios"), "http://localhost:8787");
  assert.equal(resolveOpenbotUrl("web"), "http://localhost:8787");
});

test("an explicit EXPO_PUBLIC_OPENBOT_URL wins on every platform, trimmed with trailing slash removed", () => {
  for (const platform of ["web", "ios", "android"] as const) {
    assert.equal(
      resolveOpenbotUrl(platform, "  https://bot.example.com:9443/ "),
      "https://bot.example.com:9443",
    );
    assert.equal(
      resolveOpenbotUrl(platform, "http://192.168.1.20:8787"),
      "http://192.168.1.20:8787",
    );
  }
});

test("an invalid explicit URL throws the existing config error", () => {
  assert.throws(
    () => resolveOpenbotUrl("android", "not a url"),
    /EXPO_PUBLIC_OPENBOT_URL must be a full URL/,
  );
  assert.throws(
    () => resolveOpenbotUrl("web", "://missing-scheme"),
    /EXPO_PUBLIC_OPENBOT_URL must be a full URL/,
  );
});

test("an explicit URL with a path is rejected: only origins are supported", () => {
  // resolveOpenbotUrl keeps only .origin, so a path prefix would be silently
  // dropped and every request would 404; reject it up front like credentials.
  assert.throws(
    () => resolveOpenbotUrl("web", "https://host.example.com/openbot"),
    /must be origin-only/,
  );
  assert.throws(
    () => resolveOpenbotUrl("android", "http://10.0.2.2:8787/openbot/"),
    /must be origin-only/,
  );
});
