import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  cancelComputerControl,
  releaseComputerControl,
  requestComputerControl,
  sendComputerInput,
  takeComputerControl,
} from "../src/openbot/api.ts";
import { openbotUrl } from "../src/openbot/config.ts";
import {
  attemptControlInput,
  controlCancelled,
  controlExpired,
  controlInputFailed,
  controlInputRefused,
  controlLateInputLabel,
  controlPhaseLabels,
  controlRefused,
  controlReleased,
  controlRequestSent,
  controlTaken,
  initialControlState,
} from "../src/openbot/control-state.ts";
import { OpenBotError } from "../src/openbot/errors.ts";

/**
 * K04 pure seams: the human-control lease state machine (Task 0 route facts:
 * POST /api/computers/:botId/control/{request,take,release,cancel} answer the
 * server's ControlState; POST /api/computers/:botId/human/:kind carries the
 * gesture + seq and answers 403/409 once the lease is gone).
 */

test("happy path: viewing → requesting → controlling → released, each phase observable", () => {
  const viewing = initialControlState();
  assert.equal(viewing.phase, "viewing");
  assert.equal(viewing.leaseId, null);

  const requesting = controlRequestSent(viewing, "lease-1", "需要人类输入验证码");
  assert.equal(requesting.phase, "requesting");
  assert.equal(requesting.leaseId, "lease-1");
  assert.equal(requesting.reason, "需要人类输入验证码");

  const controlling = controlTaken(requesting, "lease-1");
  assert.equal(controlling.phase, "controlling");
  assert.equal(controlling.leaseId, "lease-1");
  assert.equal(attemptControlInput(controlling).ok, true);

  const released = controlReleased(controlling);
  assert.equal(released.phase, "released");
  // Released means the wheel is back with the Bot: no input may dispatch.
  assert.equal(attemptControlInput(released).ok, false);
});

test("refused and expired are terminal sub-states per K03's semantics; a new lease may start after either", () => {
  const refused = controlRefused(
    controlTaken(controlRequestSent(initialControlState(), "lease-1"), "lease-1"),
    "会话已注销",
  );
  assert.equal(refused.phase, "refused");
  assert.equal(refused.reason, "会话已注销");
  assert.equal(attemptControlInput(refused).ok, false);

  const expired = controlExpired(controlRequestSent(initialControlState(), "lease-2"));
  assert.equal(expired.phase, "expired");
  assert.equal(attemptControlInput(expired).ok, false);

  // Terminal names the lease's end, not the screen's: a fresh request starts over.
  assert.equal(controlRequestSent(refused, "lease-3").phase, "requesting");
});

test("input guard: dispatch allowed only while controlling; queued input while requesting is refused locally", () => {
  const requesting = controlRequestSent(initialControlState(), "lease-1");
  // No request may leave the device outside controlling — the guard refuses
  // locally, so nothing is queued that could fire after the take.
  const blocked = attemptControlInput(requesting);
  assert.equal(blocked.ok, false);
  assert.ok(!("seq" in blocked));
  for (const state of [
    initialControlState(),
    controlReleased(requesting),
    controlRefused(requesting),
    controlExpired(requesting),
  ]) {
    assert.equal(attemptControlInput(state).ok, false);
  }
});

test("input sequence: monotonic from take, reset per lease (the §3 ordering the server enforces)", () => {
  const controlling = controlTaken(controlRequestSent(initialControlState(), "lease-1"), "lease-1");
  const first = attemptControlInput(controlling);
  assert.ok(first.ok && first.seq === 1);
  const second = attemptControlInput(first.state);
  assert.ok(second.ok && second.seq === 2);
  // A new lease numbers its input from the start (K03: take resets the sequence).
  const retaken = controlTaken(
    controlRequestSent(controlReleased(second.state), "lease-2"),
    "lease-2",
  );
  const fresh = attemptControlInput(retaken);
  assert.ok(fresh.ok && fresh.seq === 1);
});

test("late input: 403/409 after release lands as a visible 已断开 refusal and is never retried", () => {
  const released = controlReleased(
    controlTaken(controlRequestSent(initialControlState(), "lease-1"), "lease-1"),
  );
  for (const status of [403, 409]) {
    const refusedLate = controlInputRefused(released, status);
    assert.equal(refusedLate.phase, "refused");
    assert.equal(refusedLate.inputRefused, true);
    assert.match(refusedLate.message ?? "", /已断开/);
    // The refusal is visible AND final: the input cannot be dispatched again.
    assert.equal(attemptControlInput(refusedLate).ok, false);
  }
  // Only the lease-gone answers (403/409) conclude the lease; a transport
  // failure (500) or a malformed gesture (400) changes nothing.
  const controlling = controlTaken(controlRequestSent(initialControlState(), "lease-2"), "lease-2");
  assert.equal(controlInputRefused(controlling, 500), controlling);
  assert.equal(controlInputRefused(controlling, 400), controlling);
});

test("zh-CN phase chips per the K04 plan", () => {
  assert.deepEqual(controlPhaseLabels, {
    viewing: "机器人操作中",
    requesting: "等待接管",
    controlling: "接管中",
    released: "已交还",
    refused: "接管被拒",
    expired: "请求已过期",
  });
});

test("purity: the control state module holds no imports at all", () => {
  const source = readFileSync(join(import.meta.dirname, "../src/openbot/control-state.ts"), "utf8");
  const imports = source.split("\n").filter((line) => /^\s*import\b/.test(line));
  assert.equal(imports.length, 0);
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Patch globalThis.fetch with a recorder, mirroring openbot-computer-state.test.ts. */
function patchFetch(respond: () => Response) {
  const original = globalThis.fetch;
  const calls: { url: string; method: string; body: unknown }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return respond();
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const controlBody = (status: string, extra: Record<string, unknown> = {}) => ({
  holder: "bot",
  since: "2026-10-13T00:00:00.000Z",
  requested: true,
  reason: "需要人类输入验证码",
  request: { id: "lease-1", status, reason: "需要人类输入验证码" },
  ...extra,
});

test("control calls: request/take/release/cancel POST the Task 0 route shapes", async () => {
  const stubbed = patchFetch(() => json(200, controlBody("waiting")));
  try {
    await requestComputerControl("b1");
    assert.deepEqual(stubbed.calls[0], {
      url: `${openbotUrl}/api/computers/b1/control/request`,
      method: "POST",
      body: {},
    });
    await takeComputerControl("b1", "lease-1");
    assert.deepEqual(stubbed.calls[1], {
      url: `${openbotUrl}/api/computers/b1/control/take`,
      method: "POST",
      body: { requestId: "lease-1" },
    });
    await releaseComputerControl("b1", "lease-1");
    assert.deepEqual(stubbed.calls[2], {
      url: `${openbotUrl}/api/computers/b1/control/release`,
      method: "POST",
      body: { requestId: "lease-1" },
    });
    await cancelComputerControl("b1", "lease-1");
    assert.deepEqual(stubbed.calls[3], {
      url: `${openbotUrl}/api/computers/b1/control/cancel`,
      method: "POST",
      body: { requestId: "lease-1" },
    });
  } finally {
    stubbed.restore();
  }
});

test("input calls: one POST per gesture kind with the monotonic seq (server schema HumanInput)", async () => {
  const inputBody = { action: "human_click", url: "https://example.com/a" };
  const stubbed = patchFetch(() => json(200, inputBody));
  try {
    await sendComputerInput("b1", { kind: "click", x: 120, y: 40, seq: 1 });
    assert.deepEqual(stubbed.calls[0], {
      url: `${openbotUrl}/api/computers/b1/human/click`,
      method: "POST",
      body: { x: 120, y: 40, seq: 1 },
    });
    await sendComputerInput("b1", { kind: "type", text: "验证码", seq: 2 });
    assert.deepEqual(stubbed.calls[1], {
      url: `${openbotUrl}/api/computers/b1/human/type`,
      method: "POST",
      body: { text: "验证码", seq: 2 },
    });
    await sendComputerInput("b1", { kind: "key", key: "Enter", seq: 3 });
    assert.deepEqual(stubbed.calls[2], {
      url: `${openbotUrl}/api/computers/b1/human/key`,
      method: "POST",
      body: { key: "Enter", seq: 3 },
    });
    await sendComputerInput("b1", { kind: "scroll", deltaY: -300, seq: 4 });
    assert.deepEqual(stubbed.calls[3], {
      url: `${openbotUrl}/api/computers/b1/human/scroll`,
      method: "POST",
      body: { deltaY: -300, seq: 4 },
    });
  } finally {
    stubbed.restore();
  }
});

test("late input over HTTP: 403 and 409 surface with their status so the screen can refuse visibly", async () => {
  for (const [status, code] of [
    [403, "refused"],
    [409, "invalid_input"],
  ] as const) {
    const stubbed = patchFetch(() =>
      json(status, { error: "Take control before driving the computer yourself." }),
    );
    try {
      await assert.rejects(
        sendComputerInput("b1", { kind: "key", key: "Enter", seq: 9 }),
        (error: unknown) => {
          assert.ok(error instanceof OpenBotError);
          assert.equal(error.status, status);
          assert.equal(error.code, code);
          return true;
        },
      );
    } finally {
      stubbed.restore();
    }
  }
});

test("input refusal routing: only the freshest dispatched seq's 403/409 concludes the lease", () => {
  const controlling = controlTaken(controlRequestSent(initialControlState(), "lease-1"), "lease-1");
  const first = attemptControlInput(controlling);
  if (!first.ok) throw new Error("unreachable: controlling always dispatches");
  const second = attemptControlInput(first.state);
  if (!second.ok) throw new Error("unreachable: controlling always dispatches");

  // A superseded seq's 409 is a duplicate the server already moved past while
  // a newer input is in flight to settle the lease: it must NOT evict.
  const kept = controlInputFailed(second.state, first.seq, 409);
  assert.equal(kept.phase, "controlling");
  assert.equal(kept, second.state); // byte-identical: nothing was claimed
  // The freshest dispatch's refusal IS the lease conclusion.
  const refused = controlInputFailed(second.state, second.seq, 409);
  assert.equal(refused.phase, "refused");
  assert.equal(refused.inputRefused, true);
  assert.equal(refused.message, controlLateInputLabel);
  // 403 policy refusals conclude the same way on the freshest seq only.
  assert.equal(controlInputFailed(second.state, second.seq, 403).phase, "refused");
  // Non-refusal statuses (400 malformed, 5xx transport) never conclude.
  assert.equal(controlInputFailed(second.state, second.seq, 400).phase, "controlling");

  // A late refusal cannot land on an already-concluded or handed-back lease.
  assert.equal(controlInputFailed(refused, first.seq, 409).phase, "refused");
  const released = controlReleased(second.state);
  assert.equal(controlInputFailed(released, second.seq, 409).phase, "released");
  // A stale seq from a lease a re-take replaced (seq resets on take) is inert.
  const retaken = controlTaken(controlRequestSent(released, "lease-2"), "lease-2");
  assert.equal(controlInputFailed(retaken, second.seq, 409).phase, "controlling");
});

test("cancel returns to viewing but keeps the generation monotonic (a re-taken lease cannot collide)", () => {
  // The collision control.tsx's cancel used to create: take (gen 1) → release
  // → request → cancel reset generation to 0, so the NEXT take re-entered gen
  // 1 and a prior gen-1 lease's late 403/409 satisfied every controlInputFailed
  // guard, evicting the healthy re-taken lease.
  const taken = controlTaken(controlRequestSent(initialControlState(), "lease-1"), "lease-1");
  assert.equal(taken.generation, 1);
  const cancelled = controlCancelled(controlRequestSent(controlReleased(taken), "lease-2"));
  assert.equal(cancelled.phase, "viewing");
  assert.equal(cancelled.generation, 1); // never reset
  const reTaken = controlTaken(controlRequestSent(cancelled, "lease-3"), "lease-3");
  assert.equal(reTaken.generation, 2);
});

test("cross-lease seq collision: the old lease's late 409 cannot evict the re-taken lease (generation)", () => {
  // Lease 1 dispatches seq=1 and its answer is still in flight when the user
  // releases, re-requests, re-takes, and the new lease's seq catches up to 1.
  const first = controlTaken(controlRequestSent(initialControlState(), "lease-1"), "lease-1");
  const input = attemptControlInput(first);
  if (!input.ok) throw new Error("unreachable: controlling always dispatches");

  const second = controlTaken(
    controlRequestSent(controlReleased(input.state), "lease-2"),
    "lease-2",
  );
  const caughtUp = attemptControlInput(second);
  if (!caughtUp.ok) throw new Error("unreachable: controlling always dispatches");
  assert.equal(caughtUp.seq, input.seq, "fixture: the new lease's seq re-issued the old number");

  // The old lease's in-flight seq=1 lands 409 after the re-take: without a
  // generation check the collision evicts a healthy, freshly taken lease.
  const kept = controlInputFailed(caughtUp.state, input.seq, 409, input.state.generation);
  assert.equal(kept.phase, "controlling");
  assert.equal(kept, caughtUp.state); // byte-identical: nothing was claimed

  // The new lease's own refusal for its freshest seq still concludes it.
  const refused = controlInputFailed(caughtUp.state, caughtUp.seq, 409, caughtUp.state.generation);
  assert.equal(refused.phase, "refused");
  assert.equal(refused.inputRefused, true);

  // Each take advances the generation, so a third lease is distinct again.
  const third = controlTaken(controlRequestSent(controlReleased(second), "lease-3"), "lease-3");
  assert.notEqual(third.generation, second.generation);
});
