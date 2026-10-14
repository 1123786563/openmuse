import assert from "node:assert/strict";
import test from "node:test";
import { fetchGoogleConnections } from "../src/openbot/api.ts";
import { openbotUrl } from "../src/openbot/config.ts";
import {
  connectionErrorCopy,
  normalizeConnections,
  sanitizeConnectionError,
} from "../src/openbot/connection-status.ts";
import { OpenBotError } from "../src/openbot/errors.ts";
import type { GoogleConnections } from "../src/openbot/types.ts";

/**
 * The combined status payload exactly as the server writes it (OpenBot
 * openmuse-connectors/routes.ts: connected rows carry accountEmail /
 * grantedScopes / generation / connectedAt, disconnected rows carry only
 * {provider, status}, and lastError rides only while it is set).
 */
const combined: GoogleConnections = {
  connections: [
    {
      provider: "gmail",
      accountEmail: "ada@example.com",
      status: "connected",
      grantedScopes: ["https://mail.google.com/", "https://www.googleapis.com/auth/gmail.send"],
      generation: 3,
      connectedAt: "2026-10-12T08:00:00.000Z",
    },
    {
      provider: "googlecalendar",
      accountEmail: "ada@example.com",
      status: "refresh_required",
      grantedScopes: ["https://www.googleapis.com/auth/calendar"],
      generation: 1,
      connectedAt: "2026-10-01T08:00:00.000Z",
      lastError: "Google 拒绝了刷新请求，需要重新授权。",
    },
    { provider: "gemini", status: "paused" },
  ],
};

test("every §4 status maps to its zh-CN chip; unknown stays 未知, never a fabricated connected", () => {
  const labels = combined.connections.map((c) => normalizeConnections([c])[0].statusLabel);
  assert.deepEqual(labels, ["已连接", "需要刷新", "未知"]);
  assert.equal(
    normalizeConnections([{ provider: "x", status: "disconnected" }])[0].statusLabel,
    "已断开",
  );
  assert.equal(
    normalizeConnections([{ provider: "x", status: "revoked" }])[0].statusLabel,
    "已撤销",
  );
});

test("scopes join with · and an absent/empty list renders 未授予任何权限", () => {
  const rows = normalizeConnections(combined.connections);
  assert.equal(
    rows[0].scopesLabel,
    "https://mail.google.com/ · https://www.googleapis.com/auth/gmail.send",
  );
  assert.equal(rows[2].scopesLabel, "未授予任何权限");
  assert.equal(
    normalizeConnections([{ provider: "x", status: "connected", grantedScopes: [] }])[0]
      .scopesLabel,
    "未授予任何权限",
  );
});

test("token-shaped lastError is replaced wholesale with 需要重新连接; plain errors pass through clipped to 120", () => {
  assert.equal(sanitizeConnectionError("刷新失败：ya29.a0ARrdaM-9BxC1z"), "需要重新连接");
  assert.equal(sanitizeConnectionError("1//0abcdEFgh45678901"), "需要重新连接");
  assert.equal(sanitizeConnectionError("Bearer abc123"), "需要重新连接");
  assert.equal(
    sanitizeConnectionError("abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH"),
    "需要重新连接",
  );
  assert.equal(
    sanitizeConnectionError("Google 拒绝了刷新请求，需要重新授权。"),
    "Google 拒绝了刷新请求，需要重新授权。",
  );
  assert.equal(sanitizeConnectionError("拒".repeat(200))?.length, 120);
  assert.equal(sanitizeConnectionError(undefined), undefined);
});

test("screen catch copy: auth expiry gets its own sentence; other errors pass the token guard", () => {
  assert.equal(
    connectionErrorCopy(new OpenBotError("authentication_required", "Sign in first.")),
    "登录已过期，请重新登录后再查看连接状态。",
  );
  // A server-sent message (up to 500 chars in OpenBotError) must still pass
  // the token guard before it reaches the screen.
  assert.equal(
    connectionErrorCopy(new OpenBotError("unavailable", "刷新失败：ya29.a0ARrdaM-9BxC1z")),
    "需要重新连接",
  );
  assert.equal(
    connectionErrorCopy(new OpenBotError("network", "无法连接 OpenBot 服务，请检查网络后重试。")),
    "无法连接 OpenBot 服务，请检查网络后重试。",
  );
  assert.equal(connectionErrorCopy(new Error("boom")), "boom");
  assert.equal(connectionErrorCopy(new OpenBotError("invalid_input", "")), "未知错误");
});

test("rows keep the server's provider order and key; a row without accountEmail renders 未绑定账号", () => {
  const rows = normalizeConnections(combined.connections);
  assert.deepEqual(
    rows.map((row) => row.provider),
    ["gmail", "googlecalendar", "gemini"],
  );
  assert.equal(rows[0].accountLabel, "ada@example.com");
  assert.equal(rows[2].accountLabel, "未绑定账号");
  assert.equal(rows[1].errorText, "Google 拒绝了刷新请求，需要重新授权。");
  assert.ok(!rows[0].errorText);
});

test("fetchGoogleConnections GETs the combined status route; 401 lands as authentication_required", async () => {
  const original = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(combined), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const result = await fetchGoogleConnections();
    assert.equal(result.connections.length, 3);
    assert.equal(calls[0].url, `${openbotUrl}/api/mobile/openmuse-google`);
    assert.equal(calls[0].init.method, "GET");
  } finally {
    globalThis.fetch = original;
  }

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "Sign in again." }), {
      status: 401,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    const error = await fetchGoogleConnections().catch((e: unknown) => e);
    assert.ok(error instanceof OpenBotError);
    assert.equal(error.code, "authentication_required");
  } finally {
    globalThis.fetch = original;
  }
});

test("prototype-key providers and statuses never surface inherited labels", () => {
  // The server controls `provider` and `status` as open strings; a plain
  // object-literal lookup would hit Object.prototype members ("constructor",
  // "toString") and hand a function to Text, white-screening the screen.
  const rows = normalizeConnections([
    { provider: "constructor", status: "toString" },
    { provider: "__proto__", status: "valueOf" },
  ]);
  assert.equal(rows[0].providerLabel, "未知服务");
  assert.equal(rows[0].statusLabel, "未知");
  assert.equal(rows[1].providerLabel, "未知服务");
  assert.equal(rows[1].statusLabel, "未知");
});
