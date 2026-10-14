import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { openbotFetch, setOpenbotTransportDefaults } from "../src/openbot/client";
import { OpenBotError } from "../src/openbot/errors";

const okSchema = z.object({ ok: z.boolean() });

/**
 * I04 native session transport: on native the session cookie rides an explicit
 * Cookie header (no browser cookie jar) and a 401 fires the expired hook; on
 * web nothing changes (credentials include, no manual header). Everything is
 * injectable so node:test never touches react-native.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("native transport sends the Cookie header from getCookie and omits credentials", async () => {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return jsonResponse({ ok: true });
  }) as typeof fetch;
  const schema = okSchema;

  await openbotFetch("/api/mobile/workspace", schema, {
    platform: "native",
    getCookie: async () => "better-auth.session_token=abc",
    fetchImpl,
  });

  const headers = seen[0].init.headers as Record<string, string>;
  assert.equal(headers.Cookie, "better-auth.session_token=abc");
  assert.notEqual(seen[0].init.credentials, "include");
});

test("android rides the same native transport: the cookie provider's cookie lands in the Cookie header", async () => {
  // I05: Android only differs from iOS in the default base URL (10.0.2.2);
  // session restore goes through the shared I04 native seam unchanged.
  const seen: Array<{ init: RequestInit }> = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    seen.push({ init });
    return jsonResponse({ ok: true });
  }) as typeof fetch;
  const schema = okSchema;

  await openbotFetch("/api/mobile/workspace", schema, {
    platform: "native",
    getCookie: async () => "better-auth.session_token=android-session",
    fetchImpl,
  });

  const headers = seen[0].init.headers as Record<string, string>;
  assert.equal(headers.Cookie, "better-auth.session_token=android-session");
});

test("web transport keeps credentials include and never injects a manual Cookie header", async () => {
  const seen: Array<{ init: RequestInit }> = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    seen.push({ init });
    return jsonResponse({ ok: true });
  }) as typeof fetch;
  const schema = okSchema;

  await openbotFetch("/api/mobile/workspace", schema, {
    platform: "web",
    getCookie: async () => "should-not-appear=1",
    fetchImpl,
  });

  const headers = seen[0].init.headers as Record<string, string>;
  assert.equal(headers.Cookie, undefined);
  assert.equal(seen[0].init.credentials, "include");
});

test("native with no cookie provider still works without the header", async () => {
  const seen: Array<{ init: RequestInit }> = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    seen.push({ init });
    return jsonResponse({ ok: true });
  }) as typeof fetch;
  const schema = okSchema;

  await openbotFetch("/api/mobile/workspace", schema, {
    platform: "native",
    getCookie: async () => null,
    fetchImpl,
  });
  assert.equal((seen[0].init.headers as Record<string, string>).Cookie, undefined);
});

test("a 401 on native throws authentication_required and fires the onAuthExpired hook once", async () => {
  let expired = 0;
  const fetchImpl = (async () =>
    jsonResponse({ error: "Authentication required." }, 401)) as typeof fetch;
  const schema = okSchema;

  await assert.rejects(
    openbotFetch("/api/mobile/workspace", schema, {
      platform: "native",
      getCookie: async () => "t=1",
      onAuthExpired: () => {
        expired += 1;
      },
      fetchImpl,
    }),
    (error: unknown) => {
      assert.ok(error instanceof OpenBotError);
      assert.equal(error.code, "authentication_required");
      return true;
    },
  );
  assert.equal(expired, 1);
});

test("module defaults apply when the call does not override them", async () => {
  const seen: Array<{ init: RequestInit }> = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    seen.push({ init });
    return jsonResponse({ ok: true });
  }) as typeof fetch;
  const schema = okSchema;

  setOpenbotTransportDefaults({
    platform: "native",
    getCookie: async () => "default-cookie=1",
  });
  try {
    await openbotFetch("/api/mobile/workspace", schema, { fetchImpl });
    const headers = seen[0].init.headers as Record<string, string>;
    assert.equal(headers.Cookie, "default-cookie=1");
  } finally {
    setOpenbotTransportDefaults({ platform: "web", getCookie: undefined });
  }
});
