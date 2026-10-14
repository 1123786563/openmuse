import assert from "node:assert/strict";
import test from "node:test";
import {
  createRenderSet,
  dedupeByEventId,
  interruptionVisible,
  resumeStrategy,
  type StreamEvent,
} from "../src/openbot/stream-resume.ts";

/** §3 fixture: one thread, one run, e1 text / e2 tool-start / e3 tail. */
const ev = (eventId: string, runId = "r1", threadId = "t1"): StreamEvent => ({
  threadId,
  runId,
  eventId,
});
const e1 = ev("e1");
const e2 = ev("e2");
const e3 = ev("e3");

test("applyBatch: live [e1,e2] then replay [e2,e3] renders e3 only — e2 seen once total", () => {
  const model = createRenderSet();
  assert.deepEqual(model.applyBatch([e1, e2]), [e1, e2]);
  assert.deepEqual(model.applyBatch([e2, e3]), [e3], "the replayed e2 must not render again");
});

test("applyBatch: a duplicate inside one batch collapses too (e2 delivered twice)", () => {
  const model = createRenderSet();
  assert.deepEqual(model.applyBatch([e1, e2, e2, e3]), [e1, e2, e3]);
});

test("keys include threadId and runId: same eventId in another run is NOT deduped", () => {
  const model = createRenderSet();
  model.applyBatch([ev("e5", "run-a")]);
  assert.deepEqual(model.applyBatch([ev("e5", "run-b")]), [ev("e5", "run-b")]);

  const model2 = createRenderSet();
  model2.applyBatch([ev("e5", "run-a", "thread-a")]);
  assert.deepEqual(
    model2.applyBatch([ev("e5", "run-a", "thread-b")]),
    [ev("e5", "run-a", "thread-b")],
    "same (runId,eventId) on another thread is a different event",
  );
});

test("dedupeByEventId: pure — received minus rendered, order kept", () => {
  assert.deepEqual(dedupeByEventId([e2, e3], [e1, e2]), [e3]);
  assert.deepEqual(dedupeByEventId([e1, e2, e3], []), [e1, e2, e3]);
});

test("resumeStrategy: cursor within the offered window → resume-from-cursor", () => {
  assert.equal(resumeStrategy("e2", [e2, e3]), "resume-from-cursor");
  assert.equal(resumeStrategy("e2", [e1, e2]), "resume-from-cursor"); // window ends at the cursor: nothing new, still anchored
});

test("resumeStrategy: offered history lacks the cursor → reload-history", () => {
  assert.equal(resumeStrategy("e2", [ev("e4"), ev("e5")]), "reload-history");
});

test("resumeStrategy: no lastEventId → fresh; nothing offered → already-current", () => {
  assert.equal(resumeStrategy(null, [e1, e2]), "fresh");
  assert.equal(resumeStrategy("e2", []), "already-current");
});

test("interruption chip is derived: only the reload-history path shows it", () => {
  assert.equal(interruptionVisible("reload-history"), true);
  assert.equal(interruptionVisible("resume-from-cursor"), false);
  assert.equal(interruptionVisible("fresh"), false);
  assert.equal(interruptionVisible("already-current"), false);
});

test("out-of-order late batch after a reload is discarded against the reloaded history", () => {
  const model = createRenderSet();
  model.applyBatch([e1, e2, e3]);
  const reloaded = [ev("e1"), ev("e2"), ev("e3"), ev("e4")]; // persisted thread after reload
  model.reset(reloaded);
  assert.deepEqual(
    model.applyBatch([e2]),
    [],
    "a late duplicate of pre-reload state renders nothing",
  );
  assert.deepEqual(model.applyBatch([e2, ev("e5")]), [ev("e5")]);
  assert.equal(model.lastEventId(), "e5");
});

test("lastEventId tracks what this instance last rendered (null before anything)", () => {
  const model = createRenderSet();
  assert.equal(model.lastEventId(), null);
  model.applyBatch([e1, e2]);
  assert.equal(model.lastEventId(), "e2");
  model.reset([e1, e2, e3]);
  assert.equal(model.lastEventId(), "e3", "a reload re-bases the cursor on the reloaded history");
});

// ---------------------------------------------------------------------------
// iOS regression pins (C08 audit: no delta — stream-resume.ts has zero
// imports and chat.tsx reaches it with no Platform branch, so iOS
// process-restore and background reconnects flow through these same pure
// seams; the pins re-assert them under iOS restore scenarios).
// ---------------------------------------------------------------------------

test("ios: process restore replays the thread once; the restored cursor absorbs the next reconnect's overlap", () => {
  // Process death: the JS runtime restarts, so the instance carries no cursor.
  const replay = [e1, e2, e3];
  assert.equal(resumeStrategy(null, replay), "fresh");
  assert.equal(interruptionVisible("fresh"), false); // clean restore, no chip
  const model = createRenderSet();
  assert.deepEqual(model.applyBatch(replay), replay); // every replayed event renders
  assert.equal(model.lastEventId(), "e3"); // the cursor the next reconnect anchors on
  // iOS suspends and resumes WITHOUT process death: the gateway replays past
  // the restored cursor — the overlap dedupes, only the tail renders.
  const reoffered = [e2, e3, ev("e4")];
  assert.equal(resumeStrategy("e3", reoffered), "resume-from-cursor");
  assert.deepEqual(model.applyBatch(reoffered), [ev("e4")]);
});

test("ios: unstable handoff (rebuilt gateway ids) reloads history; the reloaded thread's own overlap still dedupes", () => {
  const model = createRenderSet();
  model.applyBatch([e1, e2]);
  // The reconnect's replay window no longer contains the cursor.
  assert.equal(resumeStrategy("e2", [ev("n1"), ev("n2")]), "reload-history");
  assert.equal(interruptionVisible("reload-history"), true); // the chip shows
  const persisted = [ev("n1"), ev("n2"), ev("n3")];
  model.reset(persisted); // re-based on the reloaded thread (rebuilt ids)
  // A redelivery of the reloaded thread renders only its unseen tail.
  assert.deepEqual(model.applyBatch([ev("n2"), ev("n3"), ev("n4")]), [ev("n4")]);
  assert.equal(model.lastEventId(), "n4");
});

// ---------------------------------------------------------------------------
// Android regression pins (C09 audit: no delta — stream-resume.ts has zero
// imports and chat.tsx reaches it with no Platform branch, so Android's
// routine process death (the OS reclaims background apps) and its throttled
// reconnects (Doze/app-standby) flow through these same pure seams; the pins
// re-assert them under Android restore scenarios).
// ---------------------------------------------------------------------------

test("android: routine process death replays the thread once; the restored cursor absorbs the next reconnect's overlap", () => {
  // Android reclaims the process outright: the restored instance has no
  // cursor, exactly the fresh-mount path.
  const replay = [e1, e2, e3];
  assert.equal(resumeStrategy(null, replay), "fresh");
  assert.equal(interruptionVisible("fresh"), false); // clean restore, no chip
  const model = createRenderSet();
  assert.deepEqual(model.applyBatch(replay), replay); // every replayed event renders
  assert.equal(model.lastEventId(), "e3"); // the cursor the next reconnect anchors on
  // Doze lets the socket drop without process death: the gateway replays past
  // the restored cursor — the overlap dedupes, only the tail renders.
  const reoffered = [e3, ev("e4")];
  assert.equal(resumeStrategy("e3", reoffered), "resume-from-cursor");
  assert.deepEqual(model.applyBatch(reoffered), [ev("e4")]);
});

test("android: overnight handoff (rebuilt gateway ids) reloads history; the reloaded thread's own overlap still dedupes", () => {
  const model = createRenderSet();
  model.applyBatch([e1, e2]);
  // The reconnect's replay window no longer contains the cursor.
  assert.equal(resumeStrategy("e2", [ev("n1"), ev("n2")]), "reload-history");
  assert.equal(interruptionVisible("reload-history"), true); // the chip shows
  const persisted = [ev("n1"), ev("n2"), ev("n3")];
  model.reset(persisted); // re-based on the reloaded thread (rebuilt ids)
  // A redelivery of the reloaded thread renders only its unseen tail.
  assert.deepEqual(model.applyBatch([ev("n2"), ev("n3"), ev("n4")]), [ev("n4")]);
  assert.equal(model.lastEventId(), "n4");
});
