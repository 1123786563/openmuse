import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyToolEvent,
  renderSummary,
  type ToolCard,
  type ToolEvent,
  toolCardRows,
} from "../src/openbot/tool-cards.ts";

/**
 * Contract §3 tool-event fixture list — one fixture per class (C06). Payload
 * shapes are name-keyed stand-ins until the owning tickets (R/K/M/A) pin
 * their DTOs; the assertions here pin the card, not the payload contract.
 */

/** A known-class event: a §3 fixture name plus its stand-in payload. */
const ev = (name: string, payload?: unknown, status?: ToolEvent["status"]): ToolEvent => ({
  name,
  payload,
  status,
});

test("fixture class 1 — text delta is not a card: the text stream owns it", () => {
  assert.equal(classifyToolEvent(ev("text_delta", "你好")), null);
});

test("fixture class 2 — tool start maps to a neutral in-progress card", () => {
  const card = classifyToolEvent(ev("tool_start", undefined, "start"));
  assert.ok(card);
  assert.equal(card.kind, "tool_start");
  assert.equal(card.status, "neutral");
  assert.ok(card.title.length > 0, "zh-CN title required");
});

test("fixture class 3 — tool result maps to status ok", () => {
  const card = classifyToolEvent(ev("tool_result", { done: true }, "result"));
  assert.ok(card);
  assert.equal(card.kind, "tool_result");
  assert.equal(card.status, "ok");
});

test("fixture class 4 — tool error is an error card, never success", () => {
  const card = classifyToolEvent(ev("tool_error", { success: true }, "error"));
  assert.ok(card);
  assert.equal(card.kind, "tool_error");
  assert.equal(card.status, "error");
  assert.notEqual(card.status, "ok");
  // The same holds for a named tool that failed: kind stays, status is error.
  const named = classifyToolEvent(ev("browser_navigation", { url: "https://a.b/c" }, "error"));
  assert.ok(named);
  assert.equal(named.status, "error");
});

test("fixture class 5 — reviewed-action card shows its type label", () => {
  const card = classifyToolEvent(ev("reviewed_action", { type: "mail.send" }));
  assert.ok(card);
  assert.equal(card.kind, "reviewed_action");
  assert.ok(card.title.length > 0);
  assert.ok(
    card.summary.includes("mail.send"),
    `summary shows the type label, got ${card.summary}`,
  );
});

test("fixture class 6 — Policy approval card shows its type label", () => {
  const card = classifyToolEvent(ev("policy_approval", { type: "computer.control" }));
  assert.ok(card);
  assert.equal(card.kind, "policy_approval");
  assert.ok(card.title.length > 0);
  assert.ok(
    card.summary.includes("computer.control"),
    `summary shows the type label, got ${card.summary}`,
  );
});

test("fixture class 7 — computer screenshot shows a 截图 label", () => {
  const card = classifyToolEvent(ev("computer_screenshot", { streamId: "s1" }));
  assert.ok(card);
  assert.equal(card.kind, "computer_screenshot");
  assert.ok(card.summary.includes("截图"), `summary carries the 截图 label, got ${card.summary}`);
});

test("fixture class 8 — browser navigation shows URL host+path, no query", () => {
  const card = classifyToolEvent(
    ev("browser_navigation", { url: "https://mail.example.com/calendar/week?d=1" }),
  );
  assert.ok(card);
  assert.equal(card.kind, "browser_navigation");
  assert.equal(card.summary, "mail.example.com/calendar/week");
});

test("fixture class 9 — mail thread shows the subject", () => {
  const card = classifyToolEvent(ev("mail_thread", { subject: "本周例会安排" }));
  assert.ok(card);
  assert.equal(card.kind, "mail_thread");
  assert.equal(card.summary, "本周例会安排");
});

test("fixture class 10 — calendar event shows title + time", () => {
  const card = classifyToolEvent(
    ev("calendar_event", { title: "周会", start: "2026-10-13T09:00:00+08:00" }),
  );
  assert.ok(card);
  assert.equal(card.kind, "calendar_event");
  assert.ok(card.summary.includes("周会"));
  assert.ok(card.summary.includes("2026-10-13T09:00:00+08:00"));
});

test("fixture class 11 — file artifact shows the name", () => {
  const card = classifyToolEvent(ev("file_artifact", { name: "季度报表.pdf" }));
  assert.ok(card);
  assert.equal(card.kind, "file_artifact");
  assert.equal(card.summary, "季度报表.pdf");
});

test("fixture class 12 — unknown event is a neutral fallback, never a fabricated success", () => {
  const card = classifyToolEvent(ev("future_quantum_sync", { deep: { payload: "x" } }));
  assert.ok(card);
  assert.equal(card.kind, "unknown");
  assert.equal(card.status, "neutral");
  assert.ok(card.title.length > 0, "neutral zh-CN copy required");
  // No payload echo beyond a safe truncated string: the deep payload stays out.
  assert.ok(!card.summary.includes("payload"));
  assert.ok(card.summary.length <= 121);
});

test("registry keys on the event name/shape, tolerant of naming variants", () => {
  const card = classifyToolEvent(ev("browserNavigation", { url: "https://a.io/x" }));
  assert.ok(card);
  assert.equal(card.kind, "browser_navigation");
  const card2 = classifyToolEvent(ev("Mail-Thread", { subject: "s" }));
  assert.ok(card2);
  assert.equal(card2.kind, "mail_thread");
});

test("renderSummary truncates at 120 chars with an ellipsis", () => {
  const long = "长".repeat(200);
  const summary = renderSummary("mail_thread", { subject: long });
  assert.equal(summary.length, 121);
  assert.ok(summary.endsWith("…"));
  assert.equal(summary.slice(0, 120), long.slice(0, 120));
  // Exactly at the limit stays untouched.
  const exact = renderSummary("mail_thread", { subject: "字".repeat(120) });
  assert.equal(exact, "字".repeat(120));
});

test("renderSummary stringifies non-string payload fields safely", () => {
  const summary = renderSummary("mail_thread", { subject: { nested: true } });
  assert.equal(summary, '{"nested":true}');
  // A payload JSON.stringify cannot handle still yields a safe string.
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const fallback = renderSummary("tool_result", circular);
  assert.equal(typeof fallback, "string");
  assert.ok(fallback.length <= 121);
  // A JSON-string payload is parsed before field extraction.
  const parsed = renderSummary("file_artifact", JSON.stringify({ name: "a.pdf" }));
  assert.equal(parsed, "a.pdf");
});

test("toolCardRows joins tool results to names, errors map to error, starts stay neutral", () => {
  const rows = toolCardRows([
    {
      id: "m1",
      role: "assistant",
      content: "查一下",
      toolCalls: [
        {
          id: "c1",
          type: "function",
          function: { name: "browser_navigation", arguments: '{"url":"https://a.b/c"}' },
        },
        { id: "c2", type: "function", function: { name: "mail_thread", arguments: "{}" } },
        { id: "c3", type: "function", function: { name: "file_artifact", arguments: "{}" } },
      ],
    },
    { id: "m2", role: "tool", toolCallId: "c1", content: "ok" },
    { id: "m3", role: "tool", toolCallId: "c2", content: "{}", error: "provider 409" },
    // c3 has no tool message yet: it is in flight, so a start card trails.
  ]);
  assert.deepEqual(
    rows.map((row) => row.id),
    ["m2", "m3", "m1:c3:start"],
  );
  const [done, failed, started] = rows.map((row) => row.card) as ToolCard[];
  assert.equal(done.kind, "browser_navigation");
  assert.equal(done.status, "ok");
  assert.equal(failed.kind, "mail_thread");
  assert.equal(failed.status, "error"); // provider failure is never a success card
  assert.equal(started.kind, "file_artifact");
  assert.equal(started.status, "neutral"); // in-flight: no outcome claimed yet
});

test("toolCardRows ignores plain chat messages and unnamed tools", () => {
  const rows = toolCardRows([
    { id: "u1", role: "user", content: "你好" },
    { id: "a1", role: "assistant", content: "在的" },
    { id: "t1", role: "tool", toolCallId: "orphan", content: "x" },
  ]);
  // The orphan result still renders — through the generic tool_result class.
  assert.deepEqual(
    rows.map((row) => row.id),
    ["t1"],
  );
  assert.equal(rows[0]?.card.kind, "tool_result");
});

test("a failed screenshot card never shows the success summary", () => {
  // "an error is never shown as success": the 截图 success copy must not ride
  // an error card; the payload's own detail is the honest summary instead.
  const card = classifyToolEvent(ev("computer_screenshot", { error: "screen locked" }, "error"));
  assert.ok(card);
  assert.equal(card.status, "error");
  assert.ok(!card.summary.includes("已获取屏幕截图"), `got ${card.summary}`);
  assert.ok(card.summary.includes("screen locked"), `got ${card.summary}`);
});

test("an in-flight screenshot card does not claim a captured picture", () => {
  // The mirror of the error case for start: 「已获取屏幕截图」 is the result's
  // claim, and a pending call (an unresolved toolCall's start card) must not
  // wear it — no outcome is claimed the event did not report.
  const card = classifyToolEvent(ev("computer_screenshot", { streamId: "s1" }, "start"));
  assert.ok(card);
  assert.equal(card.kind, "computer_screenshot");
  assert.equal(card.status, "neutral");
  assert.ok(!card.summary.includes("已获取屏幕截图"), `got ${card.summary}`);
  // The completed capture (no status carries over from fixture class 7's
  // result-shaped event) still shows the 截图 copy.
  const done = classifyToolEvent(ev("computer_screenshot", { streamId: "s1" }, "result"));
  assert.ok(done);
  assert.equal(done.summary, "已获取屏幕截图");
});
