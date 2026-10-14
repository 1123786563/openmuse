import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fetchComputerScreenshot, fetchComputerSnapshot } from "../src/openbot/api.ts";
import {
  computerConnectionLabels,
  computerFailed,
  computerPageOf,
  computerPoll,
  computerRetry,
  computerViewed,
  initialComputerState,
  isComputerStale,
  snapshotSourceOf,
} from "../src/openbot/computer-state.ts";
import { openbotUrl } from "../src/openbot/config.ts";
import { OpenBotError } from "../src/openbot/errors.ts";

/**
 * K02 pure seams: the computer preview connection state machine (Task 0 route
 * facts: POST /api/computers/:botId/snapshot answers the accessibility tree,
 * GET /api/computers/:botId/screenshot the PNG as base64).
 */

const interval = 5000;
const page = computerPageOf({
  snapshotId: 7,
  url: "https://example.com/a",
  title: "页面 A",
  truncated: false,
  elements: [{ ref: "e1" }, { ref: "e2" }, { ref: "e3" }],
});
const dataUrl = "data:image/png;base64,aW1n";
const shot = { width: 1536, height: 1024 };

test("page view: element count and untrusted fold; truncated passes through", () => {
  assert.deepEqual(page, {
    snapshotId: 7,
    url: "https://example.com/a",
    title: "页面 A",
    truncated: false,
    elementCount: 3,
    untrusted: false,
  });
  const flagged = computerPageOf({
    snapshotId: 8,
    url: "https://example.com/b",
    title: "页面 B",
    truncated: true,
    elements: [],
    untrusted: "慢速脚本",
  });
  assert.equal(flagged.untrusted, true);
  assert.equal(flagged.elementCount, 0);
});

test("state machine: connecting → viewing on the first snapshot, then any auth/refusal/abort disconnects", () => {
  const initial = initialComputerState();
  assert.equal(initial.connection, "connecting");
  assert.equal(snapshotSourceOf(initial), null);

  const viewing = computerViewed(initial, initial.seq, page, dataUrl, "t0", 1000, shot);
  assert.equal(viewing.connection, "viewing");
  assert.equal(viewing.seq, initial.seq);
  assert.equal(snapshotSourceOf(viewing), dataUrl);
  assert.equal(viewing.freshAt, 1000);

  for (const reason of ["authentication_required", "refused", "not_found", "network"] as const) {
    const disconnected = computerFailed(viewing, viewing.seq + 1, reason, "失败说明");
    assert.equal(disconnected.connection, "disconnected");
    assert.equal(disconnected.reason, reason);
    assert.equal(disconnected.message, "失败说明");
    // Disconnect clears every in-memory reference to the preview.
    assert.equal(disconnected.page, null);
    assert.equal(snapshotSourceOf(disconnected), null);
    assert.equal(isComputerStale(disconnected, 1000 + 3 * interval, interval), false);
  }
});

test("disconnected never auto-reverts; only the explicit retry event reconnects", () => {
  const disconnected = computerFailed(initialComputerState(), 1, "unavailable");
  // Neither a late success, nor a poll tick, may quietly revive the preview.
  assert.equal(
    computerViewed(disconnected, disconnected.seq, page, dataUrl, "t0", 2000, shot).connection,
    "disconnected",
  );
  assert.equal(computerPoll(disconnected, disconnected.seq + 1).connection, "disconnected");
  const retried = computerRetry(disconnected);
  assert.equal(retried.connection, "connecting");
  assert.equal(retried.seq, disconnected.seq + 1);
  assert.equal(retried.image, null);
  assert.equal(retried.reason, null);
});

test("staleness: data older than 2× the poll interval flags stale; the first poll keeps viewing", () => {
  const viewing = computerViewed(initialComputerState(), 1, page, dataUrl, "t0", 1000, shot);
  assert.equal(isComputerStale(viewing, 1000 + 2 * interval, interval), false);
  assert.equal(isComputerStale(viewing, 1000 + 2 * interval + 1, interval), true);
  const connecting = initialComputerState();
  assert.equal(isComputerStale(connecting, 10_000 + 1, interval), false);
  // The next round keeps the old picture visible (viewing, not connecting).
  const polling = computerPoll(viewing, viewing.seq + 1);
  assert.equal(polling.connection, "viewing");
  assert.equal(polling.image, dataUrl);
  // zh-CN chip copy per the K02 plan.
  assert.deepEqual(computerConnectionLabels, {
    connecting: "连接中",
    viewing: "查看中",
    disconnected: "已断开",
  });
});

test("race: a later-arriving older response is discarded by the seq guard; newest wins", () => {
  const state = computerViewed(initialComputerState(), 2, page, dataUrl, "t2", 2000, shot);
  const older = computerPageOf({
    snapshotId: 1,
    url: "https://old.example/",
    title: "旧页面",
    truncated: false,
    elements: [],
  });
  const stale = computerViewed(state, 1, older, "data:image/png;base64,b2xk", "t1", 3000, shot);
  assert.equal(stale.seq, 2);
  // The seq-2 data survives: the older round's picture is what gets dropped.
  assert.equal(stale.page?.snapshotId, page.snapshotId);
  assert.equal(stale.image, dataUrl);
  const newer = computerPageOf({
    snapshotId: 9,
    url: "https://new.example/",
    title: "新页面",
    truncated: false,
    elements: [],
  });
  const next = computerViewed(state, 3, newer, "data:image/png;base64,bmV3", "t3", 4000, shot);
  assert.equal(next.seq, 3);
  assert.equal(next.page?.snapshotId, 9);
});

test("URL hygiene: snapshotSourceOf is null after disconnect; the module holds no storage imports", () => {
  const viewing = computerViewed(initialComputerState(), 1, page, dataUrl, "t0", 0, shot);
  assert.equal(snapshotSourceOf(viewing), dataUrl);
  assert.equal(snapshotSourceOf(computerFailed(viewing, 2, "network")), null);
  // Static check: the pure state module must never import a storage surface.
  const source = readFileSync(
    join(import.meta.dirname, "../src/openbot/computer-state.ts"),
    "utf8",
  );
  const imports = source.split("\n").filter((line) => /^\s*import\b/.test(line));
  for (const line of imports)
    assert.doesNotMatch(
      line,
      /react-native|expo|storage|localStorage|sessionStorage|AsyncStorage/i,
    );
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Patch globalThis.fetch with a recorder, mirroring openbot-task-view.test.ts. */
function patchFetch(respond: () => Response) {
  const original = globalThis.fetch;
  const calls: { url: string; method: string }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? "GET" });
    return respond();
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const snapshotBody = {
  snapshotId: 7,
  url: "https://example.com/a",
  title: "页面 A",
  truncated: false,
  elements: [{ ref: "e1", role: "link", name: "打开" }],
};
const screenshotBody = {
  base64: "aW1n",
  width: 1536,
  height: 1024,
  capturedAt: "2026-10-13T00:00:00.000Z",
};

test("fetchComputerSnapshot POSTs /api/computers/:botId/snapshot over the auth transport", async () => {
  const stubbed = patchFetch(() => json(200, snapshotBody));
  try {
    const snapshot = await fetchComputerSnapshot("b1");
    assert.equal(snapshot.snapshotId, 7);
    assert.equal(snapshot.elements.length, 1);
    assert.deepEqual(stubbed.calls[0], {
      url: `${openbotUrl}/api/computers/b1/snapshot`,
      method: "POST",
    });
  } finally {
    stubbed.restore();
  }
});

test("fetchComputerScreenshot GETs /api/computers/:botId/screenshot (base64 PNG)", async () => {
  const stubbed = patchFetch(() => json(200, screenshotBody));
  try {
    const shot = await fetchComputerScreenshot("b1");
    assert.equal(shot.base64, "aW1n");
    assert.equal(shot.width, 1536);
    assert.deepEqual(stubbed.calls[0], {
      url: `${openbotUrl}/api/computers/b1/screenshot`,
      method: "GET",
    });
  } finally {
    stubbed.restore();
  }
});

test("a foreign Bot snapshot (404) lands as not_found; an unconfigured computer (503) as unavailable", async () => {
  const notFound = patchFetch(() => json(404, { error: "There is no such Bot." }));
  try {
    const error = await fetchComputerSnapshot("foreign").catch((e: unknown) => e);
    assert.ok(error instanceof OpenBotError);
    assert.equal(error.code, "not_found");
  } finally {
    notFound.restore();
  }
  const unavailable = patchFetch(() => json(503, { error: "Computer is not configured." }));
  try {
    const error = await fetchComputerSnapshot("b1").catch((e: unknown) => e);
    assert.ok(error instanceof OpenBotError);
    assert.equal(error.code, "unavailable");
  } finally {
    unavailable.restore();
  }
});

test("viewport rides the picture's round guard: only an accepted round re-times the pad mapping", () => {
  const first = { width: 1536, height: 1024 };
  const viewing = computerViewed(initialComputerState(), 2, page, dataUrl, "t2", 2000, first);
  assert.deepEqual(viewing.viewport, first);

  // A stale round's shot must NOT re-time coordinate mapping for a newer picture.
  const staleShot = { width: 800, height: 600 };
  const guarded = computerViewed(
    viewing,
    1,
    page,
    "data:image/png;base64,b2xk",
    "t1",
    3000,
    staleShot,
  );
  assert.equal(guarded, viewing); // unchanged: the older round lost wholesale
  assert.deepEqual(guarded.viewport, first);

  // A newer round replaces the viewport together with the picture.
  const nextShot = { width: 1024, height: 768 };
  const next = computerViewed(viewing, 3, page, dataUrl, "t3", 4000, nextShot);
  assert.deepEqual(next.viewport, nextShot);

  // The poll between rounds keeps the last picture AND its viewport.
  const polling = computerPoll(next, next.seq + 1);
  assert.deepEqual(polling.viewport, nextShot);
  assert.equal(polling.image, dataUrl);

  // Disconnect drops every in-memory reference to the picture, viewport included.
  const disconnected = computerFailed(next, next.seq + 1, "network");
  assert.equal(disconnected.viewport, null);
  assert.equal(disconnected.image, null);
  // Retry starts clean; a disconnected state never revives implicitly.
  assert.equal(computerRetry(disconnected).viewport, null);
  assert.equal(
    computerViewed(disconnected, disconnected.seq, page, dataUrl, "t4", 5000, first).viewport,
    null,
  );
});
