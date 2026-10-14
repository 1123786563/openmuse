import assert from "node:assert/strict";
import test from "node:test";
import {
  initialStopFlow,
  type RunEvent,
  type StopFlowState,
  stopButtonState,
  stopFlowReducer,
  terminalOf,
} from "../src/openbot/stop-state.ts";

const started: RunEvent = { type: "run_started" };
const delta: RunEvent = { type: "text_delta" };
const stopRequested: RunEvent = { type: "stop_requested" };
const stopped: RunEvent = { type: "run_stopped" };
const completed: RunEvent = { type: "run_completed" };

test("terminalOf: stop request lands the singular stopped terminal", () => {
  assert.equal(terminalOf([started, delta, stopRequested, stopped]), "stopped");
});

test("terminalOf: completion after a stop request wins — first terminal event decides", () => {
  assert.equal(terminalOf([started, stopRequested, completed]), "completed");
});

test("terminalOf: a stop racing a late completion collapses to the one that landed first", () => {
  assert.equal(terminalOf([started, stopRequested, completed, stopped]), "completed");
  assert.equal(terminalOf([started, stopRequested, stopped, completed]), "stopped");
});

test("terminalOf: a run without a terminal event is still running (null)", () => {
  assert.equal(terminalOf([]), null);
  assert.equal(terminalOf([started]), null);
  assert.equal(terminalOf([started, delta, stopRequested]), null);
});

test("stopButtonState: enabled while streaming and idle, disabled with label while pending", () => {
  const enabled = stopButtonState(true, false);
  assert.equal(enabled.visible, true);
  assert.equal(enabled.disabled, false);
  assert.equal(enabled.label, "停止");

  const pending = stopButtonState(true, true);
  assert.equal(pending.visible, true);
  assert.equal(pending.disabled, true);
  assert.equal(pending.label, "停止中…");
});

test("stopButtonState: hidden once the run is terminal, even mid-transition", () => {
  assert.equal(stopButtonState(false, false).visible, false);
  assert.equal(stopButtonState(false, true).visible, false);
});

test("stop flow: a click requests exactly one stop; repeats while pending are no-ops", () => {
  const state0: StopFlowState = initialStopFlow();
  const state1 = stopFlowReducer(state0, { type: "stop_clicked" });
  assert.deepEqual(state1, { pending: true, stopRequests: 1, outcome: null });

  const state1again = stopFlowReducer(state1, { type: "stop_clicked" });
  assert.equal(state1again.stopRequests, 1, "a pending stop must not fire a second request");
});

test("stop flow: a click after the terminal state is a no-op — idempotent stop", () => {
  const stoppedRun = stopFlowReducer(stopFlowReducer(initialStopFlow(), { type: "stop_clicked" }), {
    type: "terminal",
    outcome: "stopped",
  });
  assert.deepEqual(stoppedRun, { pending: false, stopRequests: 1, outcome: "stopped" });

  const reclicked = stopFlowReducer(stoppedRun, { type: "stop_clicked" });
  assert.equal(reclicked.stopRequests, 1, "no second request after the run already ended");
  assert.equal(reclicked.pending, false);
});

test("stop flow: a late terminal collapse — the first outcome stands", () => {
  const afterStop = stopFlowReducer(initialStopFlow(), { type: "terminal", outcome: "stopped" });
  const afterLateCompletion = stopFlowReducer(afterStop, {
    type: "terminal",
    outcome: "completed",
  });
  assert.equal(afterLateCompletion.outcome, "stopped");
});

test("stop flow: a new run clears the terminal outcome and the pending stop", () => {
  const ended = { pending: true, stopRequests: 2, outcome: null } as const;
  const restarted = stopFlowReducer(ended, { type: "run_started" });
  assert.deepEqual(restarted, initialStopFlow());
});
