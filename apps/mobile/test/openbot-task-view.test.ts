import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fetchTaskDetail, fetchTasks } from "../src/openbot/api.ts";
import { openbotUrl } from "../src/openbot/config.ts";
import { OpenBotError } from "../src/openbot/errors.ts";
import { normalizeTaskDetail } from "../src/openbot/task-view.ts";
import type { OpenBotTask } from "../src/openbot/types.ts";

/** One task covering every §7 step status and every evidence kind (T02 runner output shapes). */
const task: OpenBotTask = {
  id: "t1",
  kind: "agent",
  status: "running",
  attempts: 1,
  steps: [
    { id: "s3", status: "pending", evidenceIds: [] },
    { id: "s1", status: "succeeded", result: "ok", evidenceIds: ["e1"] },
    { id: "s5", status: "waiting", evidenceIds: [] },
    { id: "s2", status: "failed", error: "x".repeat(500), evidenceIds: [] },
    { id: "s4", status: "running", evidenceIds: [] },
  ],
  evidence: [
    { id: "e1", kind: "mail", payload: { subject: "周报", from: "ada@example.com" } },
    { id: "e2", kind: "file", payload: { name: "plan.md" } },
    { id: "e3", kind: "web", payload: { url: "https://example.com/a", title: "页面 A" } },
    { id: "e4", kind: "user", payload: { text: "好".repeat(200) } },
    { id: "e5", kind: "mystery", payload: { whatever: 1 } },
    { id: "e6", kind: "mail", payload: { from: "bob@example.com" } },
  ],
  artifactIds: ["a1", "a2"],
  createdAt: "2026-10-12T00:00:00.000Z",
  updatedAt: "2026-10-12T01:00:00.000Z",
};

test("refresh reloads the open detail instead of only the hidden task list", () => {
  const source = readFileSync(join(import.meta.dirname, "../src/openbot/tasks.tsx"), "utf8");
  const compact = source.replace(/\s+/g, "");
  assert.ok(
    compact.includes("onPress={()=>void(detail?open(detail.id):load())}"),
    "the header Refresh action must target the currently displayed task detail",
  );
});

test("steps sort by stable id and map every status to a zh-CN chip; failed exposes clipped errorText", () => {
  const view = normalizeTaskDetail(task);
  assert.deepEqual(
    view.steps.map((step) => step.id),
    ["s1", "s2", "s3", "s4", "s5"],
  );
  assert.deepEqual(
    view.steps.map((step) => step.statusLabel),
    ["已完成", "失败", "待执行", "进行中", "等待中"],
  );
  const failed = view.steps[1];
  assert.equal(failed.errorText, "x".repeat(200));
  assert.ok(!view.steps[0].errorText);
});

test("evidence kinds map to typed rows with payload summaries; unknown stays neutral", () => {
  const view = normalizeTaskDetail(task);
  assert.deepEqual(
    view.evidence.map((row) => row.id),
    ["e1", "e2", "e3", "e4", "e5", "e6"],
  );
  assert.equal(view.evidence[0].kindLabel, "邮件");
  assert.equal(view.evidence[0].summary, "周报");
  assert.equal(view.evidence[1].kindLabel, "文件");
  assert.equal(view.evidence[1].summary, "plan.md");
  assert.equal(view.evidence[2].kindLabel, "网页");
  assert.equal(view.evidence[2].summary, "https://example.com/a");
  assert.equal(view.evidence[3].kindLabel, "用户");
  assert.equal(view.evidence[3].summary.length, 80);
  // Unknown kind renders a neutral row, never a fabricated success kind.
  assert.equal(view.evidence[4].kindLabel, "未知类型");
  assert.equal(view.evidence[4].kind, "mystery");
  // Mail without a subject falls back to the sender.
  assert.equal(view.evidence[5].summary, "bob@example.com");
});

test("mail/file/web summaries clip to one line like user text (120 chars)", () => {
  const long = "y".repeat(200);
  const view = normalizeTaskDetail({
    ...task,
    evidence: [
      { id: "m1", kind: "mail", payload: { subject: long } },
      { id: "f1", kind: "file", payload: { name: long } },
      { id: "w1", kind: "web", payload: { url: long, title: long } },
    ],
  });
  assert.equal(view.evidence[0].summary, long.slice(0, 120));
  assert.equal(view.evidence[1].summary, long.slice(0, 120));
  assert.equal(view.evidence[2].summary, long.slice(0, 120));
});

test("step rows drop the DTO passthrough nothing renders (result/evidenceIds)", () => {
  // s1 carries result + evidenceIds in the payload; the view model must not
  // forward them — the detail screen has no consumer for either.
  const step = normalizeTaskDetail(task).steps[0];
  assert.ok(!("result" in step));
  assert.ok(!("evidenceIds" in step));
});

test("artifacts render as the id list", () => {
  assert.deepEqual(normalizeTaskDetail(task).artifactIds, ["a1", "a2"]);
});

test("reload dedupe: equal payloads normalize to equal view models keyed by stable ids", () => {
  const first = normalizeTaskDetail(task);
  const second = normalizeTaskDetail(JSON.parse(JSON.stringify(task)) as OpenBotTask);
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.steps.map((step) => step.id),
    second.steps.map((step) => step.id),
  );
});

test("a task without steps renders the empty state label", () => {
  const view = normalizeTaskDetail({ ...task, steps: [], evidence: [], artifactIds: [] });
  assert.ok(view.isEmpty);
  assert.equal(view.emptyLabel, "这个任务还没有步骤");
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Patch globalThis.fetch with a recorder, mirroring openbot-api.test.ts. */
function patchFetch(respond: (url: string) => Response) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return respond(url);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const page = { tasks: [task], nextCursor: null };

test("fetchTasks GETs /api/mobile/openmuse-tasks with the cursor passed through", async () => {
  const stubbed = patchFetch(() => json(200, page));
  try {
    const result = await fetchTasks("c2/下一页");
    assert.equal(result.tasks.length, 1);
    assert.equal(
      stubbed.calls[0],
      `${openbotUrl}/api/mobile/openmuse-tasks?cursor=c2%2F%E4%B8%8B%E4%B8%80%E9%A1%B5`,
    );
    await fetchTasks(null);
    assert.equal(stubbed.calls[1], `${openbotUrl}/api/mobile/openmuse-tasks`);
  } finally {
    stubbed.restore();
  }
});

test("fetchTaskDetail GETs /:id", async () => {
  const stubbed = patchFetch(() => json(200, task));
  try {
    const result = await fetchTaskDetail("t1");
    assert.equal(result.id, "t1");
    assert.equal(stubbed.calls[0], `${openbotUrl}/api/mobile/openmuse-tasks/t1`);
  } finally {
    stubbed.restore();
  }
});

test("a missing Task detail surfaces as not_found", async () => {
  const stubbed = patchFetch(() => json(404, { error: "No such task." }));
  try {
    const error = await fetchTaskDetail("t-gone").catch((e: unknown) => e);
    assert.ok(error instanceof OpenBotError);
    assert.equal(error.code, "not_found");
  } finally {
    stubbed.restore();
  }
});
