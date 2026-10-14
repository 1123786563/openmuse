import assert from "node:assert/strict";
import test from "node:test";
import {
  type ChatMessage,
  channelAgentId,
  dedupeById,
  historyKey,
  nextUserMessage,
  runtimeAgentFor,
  toTranscript,
} from "../src/openbot/chat-state.ts";

/** Live-shaped session fixture: three distinct ids, as I03 persists them. */
const session = { botId: "bot-7f", channelId: "chan-a3", threadId: "thread-c9" };

test("channelAgentId follows the runtime channel:<channelId> convention, never the botId", () => {
  assert.equal(channelAgentId(session), "channel:chan-a3");
  assert.notEqual(channelAgentId(session), session.botId);
});

test("runtimeAgentFor keeps the three identities distinct and non-empty", () => {
  const ids = runtimeAgentFor(session);
  assert.equal(ids.agentId, "channel:chan-a3");
  assert.equal(ids.runtimeAgentId, "bot-7f");
  assert.equal(ids.threadId, "thread-c9");
  const values = [ids.agentId, ids.runtimeAgentId, ids.threadId];
  for (const value of values) assert.ok(value, "every identity must be non-empty");
  // Pairwise distinct when the fixture ids are distinct: no identity may collapse into another.
  assert.equal(new Set(values).size, 3);
});

test("toTranscript maps user/assistant rows in order, drops empties and other roles", () => {
  const messages: ChatMessage[] = [
    { id: "m1", role: "system", content: "instructions" },
    { id: "m2", role: "user", content: "你好" },
    { id: "m3", role: "assistant", content: "" },
    { id: "m4", role: "assistant", content: "   " },
    { id: "m5", role: "assistant", content: "在的" },
    { id: "m6", role: "user", content: undefined },
    { id: "m7", role: "tool", content: "tool output" },
  ];
  const rows = toTranscript(messages);
  assert.deepEqual(
    rows.map((row) => row.id),
    ["m2", "m5"],
  );
  assert.deepEqual(
    rows.map((row) => row.role),
    ["user", "assistant"],
  );
  assert.deepEqual(
    rows.map((row) => row.text),
    ["你好", "在的"],
  );
  assert.equal(
    rows.every((row) => row.streaming === false),
    true,
  );
});

test("toTranscript marks a row streaming when the message carries isStreaming", () => {
  const rows = toTranscript([
    { id: "m1", role: "user", content: "问" },
    { id: "m2", role: "assistant", content: "正在回答", isStreaming: true },
  ]);
  assert.deepEqual(
    rows.map((row) => row.streaming),
    [false, true],
  );
});

test("nextUserMessage trims and refuses an empty send", () => {
  assert.equal(nextUserMessage("  你好  "), "你好");
  assert.equal(nextUserMessage(""), null);
  assert.equal(nextUserMessage("   "), null);
});

test("historyKey is a stable per-channel storage key, scoped to the channel only", () => {
  assert.equal(historyKey(session), "openmuse-openbot-chat-chan-a3");
  // Stable across calls, distinct per channel, and never keyed on bot or thread:
  // the local echo cache is per conversation surface, not per session identity.
  assert.equal(historyKey(session), historyKey({ ...session, threadId: "thread-2" }));
  assert.notEqual(historyKey(session), historyKey({ ...session, channelId: "chan-b4" }));
  assert.ok(!historyKey(session).includes(session.botId));
});

test("dedupeById collapses a replayed duplicate id to its first occurrence (§3: one bubble, one React key)", () => {
  // A same-thread reconnect may append the persisted Thread's overlap into the
  // runtime list under the SAME stable id: the transcript seam keeps the first
  // occurrence so the row renders exactly once and the React key never clashes.
  const messages: ChatMessage[] = [
    { id: "m1", role: "user", content: "你好" },
    { id: "m2", role: "assistant", content: "你好！" },
    { id: "m1", role: "user", content: "你好" },
  ];
  const rows = toTranscript(dedupeById(messages));
  assert.deepEqual(
    rows.map((row) => row.id),
    ["m1", "m2"],
  );
  assert.deepEqual(rows.at(-1)?.text, "你好！");
  // Unique input is a passthrough; synthetic tool-card ids dedupe identically.
  assert.deepEqual(
    dedupeById([{ id: "m2:c1:start" }, { id: "m2:c1:start" }]).map((row) => row.id),
    ["m2:c1:start"],
  );
});
