import assert from "node:assert/strict";
import test from "node:test";
import { createChannel } from "../src/openbot/api.ts";
import {
  distinctThreads,
  mergeCreated,
  orderPassthrough,
  selectedIdentity,
  sessionFor,
  type WorkspaceChannel,
} from "../src/openbot/channel-state.ts";
import { runtimeAgentFor } from "../src/openbot/chat-state.ts";
import { openbotUrl } from "../src/openbot/config.ts";
import { OpenBotError } from "../src/openbot/errors.ts";

/**
 * Roster fixture deliberately UNSORTED by name and id: the server's
 * pinned/recency/id cursor order is the only order, and these tests prove the
 * client never re-sorts it (Task 0: mobile-bff maps channelStore.list rows
 * straight into channels[], workspace.ts).
 */
const beta: WorkspaceChannel = {
  id: "ch-3",
  name: "Beta",
  agentIds: ["b1"],
  threadId: "t-3",
  lastMessageAt: "2026-10-11T08:00:00Z",
};
const alpha: WorkspaceChannel = {
  id: "ch-1",
  name: "Alpha",
  agentIds: ["b1"],
  threadId: "t-1",
  lastMessageAt: null,
};
const gamma: WorkspaceChannel = {
  id: "ch-2",
  name: "Gamma",
  agentIds: ["b2"],
  threadId: "t-2",
  lastMessageAt: "2026-10-12T09:30:00Z",
};
const roster = [beta, alpha, gamma];

test("orderPassthrough returns the server order EXACTLY — no client re-sort", () => {
  const ordered = orderPassthrough(roster);
  // Same elements, same positions: the unsorted-by-name fixture survives verbatim.
  assert.deepEqual(ordered, roster);
  assert.deepEqual(
    ordered.map((channel) => channel.name),
    ["Beta", "Alpha", "Gamma"],
  );
  // The input is not aliased or mutated by the passthrough.
  assert.notEqual(ordered, roster);
});

test("selectedIdentity re-keys the chat on the channel, never the botId", () => {
  assert.deepEqual(selectedIdentity(alpha), {
    agentId: "channel:ch-1",
    runtimeAgentId: "b1",
    threadId: "t-1",
  });
});

test("two channels carry different thread ids (distinct-thread assertion)", () => {
  const first = selectedIdentity(alpha);
  const second = selectedIdentity(gamma);
  assert.notEqual(first.threadId, second.threadId);
  assert.ok(distinctThreads([alpha, gamma]));
  // The helper fails when two rows share a thread: one thread must never back two channels.
  assert.ok(!distinctThreads([alpha, { ...gamma, threadId: alpha.threadId }]));
});

test("sessionFor maps a channel row onto the chat's session-shaped prop", () => {
  assert.deepEqual(sessionFor(gamma), {
    botId: "b2",
    channelId: "ch-2",
    threadId: "t-2",
  });
  // The bridge must agree with C01's seam: identity of the channel == runtimeAgentFor of its session.
  assert.deepEqual(selectedIdentity(gamma), runtimeAgentFor(sessionFor(gamma)));
});

test("mergeCreated appends a new channel without duplicates", () => {
  const delta: WorkspaceChannel = {
    id: "ch-9",
    name: "Delta",
    agentIds: ["b1"],
    threadId: "t-9",
    lastMessageAt: null,
  };
  const merged = mergeCreated(roster, delta);
  assert.equal(merged.length, roster.length + 1);
  assert.equal(merged.at(-1), delta);
  assert.equal(new Set(merged.map((channel) => channel.id)).size, merged.length);
});

test("mergeCreated merges a re-created row into its existing id slot", () => {
  const refreshed = { ...alpha, name: "Alpha", lastMessageAt: "2026-10-13T10:00:00Z" };
  const merged = mergeCreated(roster, refreshed);
  assert.equal(merged.length, roster.length);
  assert.equal(merged.filter((channel) => channel.id === alpha.id).length, 1);
  assert.ok(merged.includes(refreshed));
});

const createdRow = {
  channel: {
    id: "ch-9",
    name: "Ada",
    agentIds: ["b1"],
    threadId: "t-9",
    active: true,
    lastMessageAt: null,
  },
};

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

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

test("createChannel POSTs the Task-0 shape {agentIds} to /api/channels and returns the row", async () => {
  const stubbed = patchFetch(() => json(201, createdRow));
  try {
    const channel = await createChannel([" b1 ", "b1 "]);
    // Trimmed and de-duplicated before the wire, as parseChannelInput demands non-empty unique ids.
    assert.deepEqual(channel, {
      id: "ch-9",
      name: "Ada",
      agentIds: ["b1"],
      threadId: "t-9",
      lastMessageAt: null,
    });
    assert.equal(stubbed.calls.length, 1);
    assert.equal(stubbed.calls[0].url, `${openbotUrl}/api/channels`);
    assert.equal(stubbed.calls[0].init.method, "POST");
    assert.equal(stubbed.calls[0].init.body, JSON.stringify({ agentIds: ["b1"] }));
  } finally {
    stubbed.restore();
  }
});

test("createChannel refuses an empty roster locally, before any request", async () => {
  const stubbed = patchFetch(() => json(201, createdRow));
  try {
    for (const bad of [[], ["  "]] as const) {
      // try/catch, not .catch: the local refusal throws before a promise exists.
      let error: unknown;
      try {
        await createChannel([...bad]);
      } catch (e) {
        error = e;
      }
      assert.ok(error instanceof OpenBotError);
      assert.equal(error.code, "invalid_input");
    }
    assert.equal(stubbed.calls.length, 0);
  } finally {
    stubbed.restore();
  }
});

test("createChannel 4xx responses surface their error codes", async () => {
  const cases = [
    [400, "invalid_input"],
    [404, "not_found"],
    [403, "refused"],
  ] as const;
  for (const [status, code] of cases) {
    const stubbed = patchFetch(() => json(status, { error: "denied" }));
    try {
      const error = await createChannel(["b1"]).catch((e: unknown) => e);
      assert.ok(error instanceof OpenBotError);
      assert.equal(error.code, code);
    } finally {
      stubbed.restore();
    }
  }
});

// ---------------------------------------------------------------------------
// iOS regression pins (C08 audit: no delta — channel-state.ts is pure (one
// type-only import), and the navigator-less shell remounts the chat by
// channel key (App.tsx `key={selected.id}`), so iOS channel switching flows
// through these same seams; the pins re-assert them under an iOS roster).
// ---------------------------------------------------------------------------

/** iOS session roster, deliberately unsorted (recency order is the server's). */
const iosRoster: WorkspaceChannel[] = [
  {
    id: "ch-ios-2",
    name: "Q4 Planning",
    agentIds: ["bot-priv"],
    threadId: "thr-ios-2",
    lastMessageAt: "2026-10-13T07:40:00Z",
  },
  {
    id: "ch-ios-1",
    name: "Trip Planning",
    agentIds: ["bot-priv"],
    threadId: "thr-ios-1",
    lastMessageAt: null,
  },
];

test("ios: switch re-keys onto the channel — server order kept, threads distinct, identity is the channel's", () => {
  assert.deepEqual(orderPassthrough(iosRoster), iosRoster);
  assert.ok(distinctThreads(iosRoster));
  const trip = iosRoster[1];
  assert.deepEqual(selectedIdentity(trip), {
    agentId: "channel:ch-ios-1",
    runtimeAgentId: "bot-priv",
    threadId: "thr-ios-1",
  });
  // The remount key targets the channel id; the chat's runtime agent derives
  // from exactly that session — the same C01/C02 bridge, on the iOS roster.
  assert.deepEqual(selectedIdentity(trip), runtimeAgentFor(sessionFor(trip)));
});

test("ios: create over the private Bot appends the row without duplicate threads", () => {
  const created: WorkspaceChannel = {
    id: "ch-ios-9",
    name: "Ada",
    agentIds: ["bot-priv"],
    threadId: "thr-ios-9",
    lastMessageAt: null,
  };
  const merged = mergeCreated(iosRoster, created);
  assert.equal(merged.length, iosRoster.length + 1);
  assert.equal(merged.at(-1), created);
  assert.ok(distinctThreads(merged)); // the C02 acceptance seam, iOS fixture
});

// ---------------------------------------------------------------------------
// Android regression pins (C09 audit: no delta, same finding as C08 on iOS —
// the seams stay platform-free (channel-state.ts keeps its single type-only
// import) and App.tsx re-keys the chat by channel id with no OS branch, so
// Android channel switching rides them unchanged. The one real Android
// transport delta, the Cookie-header session path, is I05's and is pinned in
// openbot-native-session.test.ts; these re-assert the roster seams under an
// Android roster).
// ---------------------------------------------------------------------------

/** Android roster, deliberately unsorted (recency order is the server's). */
const androidRoster: WorkspaceChannel[] = [
  {
    id: "ch-and-2",
    name: "周报",
    agentIds: ["bot-priv"],
    threadId: "thr-and-2",
    lastMessageAt: "2026-10-13T06:10:00Z",
  },
  {
    id: "ch-and-1",
    name: "Trip",
    agentIds: ["bot-priv"],
    threadId: "thr-and-1",
    lastMessageAt: null,
  },
];

test("android: switch re-keys onto the channel — server order kept, threads distinct, identity is the channel's", () => {
  assert.deepEqual(orderPassthrough(androidRoster), androidRoster);
  assert.ok(distinctThreads(androidRoster));
  const trip = androidRoster[1];
  assert.deepEqual(selectedIdentity(trip), {
    agentId: "channel:ch-and-1",
    runtimeAgentId: "bot-priv",
    threadId: "thr-and-1",
  });
  // The same C01/C02 bridge as iOS: the remount key targets the channel id,
  // so the Android roster re-keys through the identical identity seam.
  assert.deepEqual(selectedIdentity(trip), runtimeAgentFor(sessionFor(trip)));
});

test("android: create over the private Bot appends the row without duplicate threads", () => {
  const created: WorkspaceChannel = {
    id: "ch-and-9",
    name: "Ada",
    agentIds: ["bot-priv"],
    threadId: "thr-and-9",
    lastMessageAt: null,
  };
  const merged = mergeCreated(androidRoster, created);
  assert.equal(merged.length, androidRoster.length + 1);
  assert.equal(merged.at(-1), created);
  assert.ok(distinctThreads(merged)); // the C02 acceptance seam, Android fixture
});

test("a channel row with no agents refuses identity mapping loudly, never an undefined botId", () => {
  // workspaceSchema allows an empty agentIds array (z.array(nonempty)), but a
  // session keyed on undefined would only fail deep inside the runtime.
  const empty = { ...alpha, agentIds: [] as string[] } as WorkspaceChannel;
  assert.throws(() => sessionFor(empty), /缺少 Bot/);
  assert.throws(() => selectedIdentity(empty), /缺少 Bot/);
});
