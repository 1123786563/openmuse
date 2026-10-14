import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchConversations,
  fetchMe,
  fetchWorkspace,
  openConversation,
  provisionOpenMuseBot,
} from "../src/openbot/api.ts";
import { openbotUrl } from "../src/openbot/config.ts";
import { OpenBotError } from "../src/openbot/errors.ts";

const me = { user: { id: "u1", role: "user", onboarding: null }, singleUser: false };
const workspace = {
  user: { id: "u1", role: "user" },
  agents: [{ id: "b1", name: "Ada", title: "Assistant", avatarSeed: "s1", visibility: "public" }],
  channels: [{ id: "ch1", name: "Ada", agentIds: ["b1"], threadId: "t1", lastMessageAt: null }],
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

test("fetchWorkspace GETs exactly /api/mobile/workspace and parses the snapshot", async () => {
  const stubbed = patchFetch(() => json(200, workspace));
  try {
    assert.deepEqual(await fetchWorkspace(), workspace);
    assert.equal(stubbed.calls.length, 1);
    assert.equal(stubbed.calls[0].url, `${openbotUrl}/api/mobile/workspace`);
    assert.equal(stubbed.calls[0].init.method, "GET");
  } finally {
    stubbed.restore();
  }
});

test("fetchMe GETs /api/me", async () => {
  const stubbed = patchFetch(() => json(200, me));
  try {
    const result = await fetchMe();
    assert.equal(result.user.id, "u1");
    assert.equal(stubbed.calls[0].url, `${openbotUrl}/api/me`);
  } finally {
    stubbed.restore();
  }
});

test("openConversation trims the Bot ID and POSTs it to /api/mobile/conversations", async () => {
  const stubbed = patchFetch(() =>
    json(201, { channelId: "ch1", botId: "b1", threadId: "t1", mode: "single" }),
  );
  try {
    const session = await openConversation(" b1 ");
    assert.deepEqual(session, { botId: "b1", channelId: "ch1", threadId: "t1" });
    assert.equal(stubbed.calls[0].url, `${openbotUrl}/api/mobile/conversations`);
    assert.equal(stubbed.calls[0].init.method, "POST");
    assert.equal(stubbed.calls[0].init.body, JSON.stringify({ botId: "b1" }));
  } finally {
    stubbed.restore();
  }
});

test("a foreign Bot ID comes back as 404 not_found, never success", async () => {
  const stubbed = patchFetch(() => json(404, { error: "No such Bot." }));
  try {
    const error = await openConversation("b-other").catch((e: unknown) => e);
    assert.ok(error instanceof OpenBotError);
    assert.equal(error.code, "not_found");
  } finally {
    stubbed.restore();
  }
});

test("fetchConversations GETs the delivery list", async () => {
  const stubbed = patchFetch(() =>
    json(200, { conversations: [{ id: "ch1", name: "Ada", agentIds: ["b1"] }], nextCursor: null }),
  );
  try {
    const result = await fetchConversations(null);
    assert.equal(result.conversations.length, 1);
    assert.equal(stubbed.calls[0].url, `${openbotUrl}/api/delivery/conversations`);
  } finally {
    stubbed.restore();
  }
});

const provisioned = { botId: "b-openmuse", templateVersion: 1, computerProfileId: "cp1" };

test("provisionOpenMuseBot POSTs {} to /api/mobile/openmuse-bot, never a user id", async () => {
  const stubbed = patchFetch(() => json(200, provisioned));
  try {
    const result = await provisionOpenMuseBot();
    assert.deepEqual(result, provisioned);
    assert.equal(stubbed.calls.length, 1);
    assert.equal(stubbed.calls[0].url, `${openbotUrl}/api/mobile/openmuse-bot`);
    assert.equal(stubbed.calls[0].init.method, "POST");
    assert.equal(stubbed.calls[0].init.body, "{}");
  } finally {
    stubbed.restore();
  }
});

test("repeat provisioning parses the same shape (null computer profile parses too)", async () => {
  const responses = [
    json(200, provisioned),
    json(200, { ...provisioned, computerProfileId: null }),
  ];
  const queue = [...responses];
  const stubbed = patchFetch(() => queue.shift() as Response);
  try {
    assert.deepEqual(await provisionOpenMuseBot(), provisioned);
    assert.deepEqual(await provisionOpenMuseBot(), {
      botId: "b-openmuse",
      templateVersion: 1,
      computerProfileId: null,
    });
    assert.equal(stubbed.calls.length, 2);
  } finally {
    stubbed.restore();
  }
});

test("provisioning failures map to their OpenBot codes", async () => {
  const cases = [
    [401, "authentication_required"],
    [403, "refused"],
    [404, "not_found"],
  ] as const;
  for (const [status, code] of cases) {
    const stubbed = patchFetch(() => json(status, { error: "denied" }));
    try {
      const error = await provisionOpenMuseBot().catch((e: unknown) => e);
      assert.ok(error instanceof OpenBotError);
      assert.equal(error.code, code);
    } finally {
      stubbed.restore();
    }
  }
});
