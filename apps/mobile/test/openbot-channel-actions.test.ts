import assert from "node:assert/strict";
import test from "node:test";
import { archiveChannel, renameChannel, reopenChannel } from "../src/openbot/api.ts";
import {
  applyArchived,
  applyRenamed,
  applyReopened,
  partitionArchived,
  sameChannelIdentity,
  validateChannelName,
  type WorkspaceChannel,
} from "../src/openbot/channel-actions.ts";
import { openbotUrl } from "../src/openbot/config.ts";
import { OpenBotError } from "../src/openbot/errors.ts";

/**
 * C03 rename/archive/reopen seams. Server contract (Task 0,
 * OpenBot/.worktrees/v4-base server/src/channels/routes.ts):
 * PATCH /api/channels/:id {name} (trim, non-empty, ≤120 code points);
 * POST /:id/archive and POST /:id/unarchive answer 204 with no body;
 * the workspace read lists the archived partition after the active one,
 * each row carrying archivedAt (mobile-bff.test.ts "lists the archived partition").
 */

/**
 * Mixed workspace fixture, deliberately UNSORTED by id and archivedAt: the
 * server's cursor order within each partition is the only order, and the
 * classification must not re-sort it.
 */
const activeLate: WorkspaceChannel = {
  id: "ch-3",
  name: "Gamma",
  agentIds: ["b2"],
  threadId: "t-3",
  lastMessageAt: "2026-10-12T09:30:00Z",
  archivedAt: null,
};
const activeEarly: WorkspaceChannel = {
  id: "ch-1",
  name: "Alpha",
  agentIds: ["b1"],
  threadId: "t-1",
  lastMessageAt: null,
  archivedAt: null,
};
const archivedMid: WorkspaceChannel = {
  id: "ch-2",
  name: "Beta",
  agentIds: ["b1"],
  threadId: "t-2",
  lastMessageAt: "2026-10-11T08:00:00Z",
  archivedAt: "2026-10-12T00:00:00.000Z",
};
const roster = [activeLate, activeEarly, archivedMid];

test("validateChannelName trims, and rejects blank, control chars, and >120 code points", () => {
  assert.deepEqual(validateChannelName("  项目频道 "), { ok: true, name: "项目频道" });
  for (const bad of ["", "   ", "\t\n"]) {
    assert.deepEqual(validateChannelName(bad), { ok: false, error: "频道名称不能为空。" });
  }
  // Control characters never reach the server (it only trims and counts).
  assert.deepEqual(validateChannelName("频道\u0007名"), {
    ok: false,
    error: "频道名称不能包含控制字符。",
  });
  // The server's MAX_CHANNEL_NAME_CODE_POINTS is 120, counted in code points.
  assert.equal(validateChannelName("a".repeat(120)).ok, true);
  assert.deepEqual(validateChannelName("a".repeat(121)), {
    ok: false,
    error: "频道名称最多 120 个字符。",
  });
  // Code points, not UTF-16 units: emoji count once.
  assert.equal(validateChannelName("😀".repeat(120)).ok, true);
});

test("partitionArchived splits a mixed list by archivedAt, order intact in each partition", () => {
  const { active, archived } = partitionArchived(roster);
  assert.deepEqual(active, [activeLate, activeEarly]);
  assert.deepEqual(archived, [archivedMid]);
  // A row missing archivedAt (pre-archive server) classifies as active.
  const legacy = { ...activeEarly, archivedAt: undefined };
  assert.deepEqual(partitionArchived([legacy]).active, [legacy]);
});

test("archive then reopen keeps the SAME {id, threadId} (reopened identity)", () => {
  // The server's archive stamps archivedAt and unarchive clears it; neither
  // touches identity or history. The client asserts the wire rows agree.
  const before = activeEarly;
  const archived = { ...before, archivedAt: "2026-10-13T00:00:00.000Z" };
  const reopened = { ...archived, archivedAt: null };
  for (const row of [archived, reopened]) {
    assert.ok(sameChannelIdentity(before, row));
    assert.deepEqual({ id: row.id, threadId: row.threadId }, { id: "ch-1", threadId: "t-1" });
  }
  // A different thread is a different conversation, not a reopen.
  assert.ok(!sameChannelIdentity(before, { ...reopened, threadId: "t-other" }));
  assert.ok(!sameChannelIdentity(before, { ...reopened, id: "ch-other" }));
});

test("applyRenamed merges the renamed row into its slot, position and siblings untouched", () => {
  const renamed = { ...archivedMid, name: "Beta 改" };
  const next = applyRenamed(roster, renamed);
  assert.equal(next.length, roster.length);
  assert.deepEqual(next, [activeLate, activeEarly, renamed]);
});

test("applyArchived stamps the row locally; applyReopened clears it, order intact", () => {
  const stamped = applyArchived(roster, "ch-1", "2026-10-13T10:00:00.000Z");
  assert.deepEqual(stamped, [
    activeLate,
    { ...activeEarly, archivedAt: "2026-10-13T10:00:00.000Z" },
    archivedMid,
  ]);
  assert.deepEqual(partitionArchived(stamped).active, [activeLate]);
  // The local stamp is approximate; the next workspace read restores the true one.
  assert.deepEqual(applyReopened(stamped, "ch-1"), roster);
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const noContent = () => new Response(null, { status: 204 });

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

const renamedBody = {
  channel: {
    id: "ch-1",
    name: "新名字",
    agentIds: ["b1"],
    threadId: "t-1",
    active: true,
    lastMessageAt: null,
    archivedAt: null,
  },
};

test("renameChannel PATCHes {name} to /api/channels/:id and returns the row", async () => {
  const stubbed = patchFetch(() => json(200, renamedBody));
  try {
    const channel = await renameChannel("ch-1", "  新名字 ");
    assert.deepEqual(channel, {
      id: "ch-1",
      name: "新名字",
      agentIds: ["b1"],
      threadId: "t-1",
      lastMessageAt: null,
      archivedAt: null,
    });
    assert.equal(stubbed.calls.length, 1);
    assert.equal(stubbed.calls[0].url, `${openbotUrl}/api/channels/ch-1`);
    assert.equal(stubbed.calls[0].init.method, "PATCH");
    assert.equal(stubbed.calls[0].init.body, JSON.stringify({ name: "新名字" }));
  } finally {
    stubbed.restore();
  }
});

test("renameChannel refuses an invalid name locally, before any request", async () => {
  const stubbed = patchFetch(() => json(200, renamedBody));
  try {
    let error: unknown;
    try {
      await renameChannel("ch-1", "  ");
    } catch (e) {
      error = e;
    }
    assert.ok(error instanceof OpenBotError);
    assert.equal(error.code, "invalid_input");
    assert.equal(stubbed.calls.length, 0);
  } finally {
    stubbed.restore();
  }
});

test("archiveChannel and reopenChannel POST to the Task-0 endpoints and take 204 with no body", async () => {
  const stubbed = patchFetch(() => noContent());
  try {
    await archiveChannel("ch-1");
    await reopenChannel("ch-1");
    assert.deepEqual(
      stubbed.calls.map((call) => [call.url, call.init.method, call.init.body]),
      [
        [`${openbotUrl}/api/channels/ch-1/archive`, "POST", undefined],
        [`${openbotUrl}/api/channels/ch-1/unarchive`, "POST", undefined],
      ],
    );
  } finally {
    stubbed.restore();
  }
});

test("a foreign channel surfaces 404 not_found on rename, archive and reopen", async () => {
  for (const call of [
    () => renameChannel("ch-other", "新名字"),
    () => archiveChannel("ch-other"),
    () => reopenChannel("ch-other"),
  ]) {
    const stubbed = patchFetch(() => json(404, { error: "Channel not found." }));
    try {
      const error = await call().catch((e: unknown) => e);
      assert.ok(error instanceof OpenBotError);
      assert.equal(error.code, "not_found");
    } finally {
      stubbed.restore();
    }
  }
});

test("unarchiving a never-archived channel surfaces the server's 409 as-is", async () => {
  const stubbed = patchFetch(() => json(409, { error: "Channel is not archived." }));
  try {
    const error = await reopenChannel("ch-1").catch((e: unknown) => e);
    assert.ok(error instanceof OpenBotError);
    assert.equal(error.status, 409);
    assert.equal(error.message, "Channel is not archived.");
  } finally {
    stubbed.restore();
  }
});
