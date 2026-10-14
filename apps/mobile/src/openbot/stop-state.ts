/**
 * Pure stop-of-run state for the OpenBot chat screen (C04). No React and no
 * SDK imports: the screen calls the runtime's stop seam
 * (`copilotkit.stopAgent({ agent })` — @copilotkit/core index.d.mts:2323) and
 * feeds what it observes into these seams, so every race below is testable
 * under node:test.
 */

/** How the run actually ended. Never both: the first terminal event wins. */
export type TerminalOutcome = "stopped" | "completed";

/**
 * The run events the stop flow observes. Terminal ones are `run_stopped` and
 * `run_completed`; `stop_requested` is not terminal — the run may already have
 * finished when the request lands.
 */
export type RunEvent = {
  type: "run_started" | "text_delta" | "stop_requested" | "run_stopped" | "run_completed";
};

/**
 * Collapse a run's events to ONE terminal outcome: the first terminal event
 * decides and later ones collapse away, so a stop racing a completion still
 * leaves a single terminal state and a single transcript. Null while running.
 */
export function terminalOf(events: readonly RunEvent[]): TerminalOutcome | null {
  for (const event of events) {
    if (event.type === "run_stopped") return "stopped";
    if (event.type === "run_completed") return "completed";
  }
  return null;
}

/** What the stop button renders. Hidden once the run is terminal. */
export type StopButtonState = {
  visible: boolean;
  disabled: boolean;
  label: string;
};

export function stopButtonState(streaming: boolean, pending: boolean): StopButtonState {
  if (!streaming) return { visible: false, disabled: true, label: "停止" };
  if (pending) return { visible: true, disabled: true, label: "停止中…" };
  return { visible: true, disabled: false, label: "停止" };
}

/**
 * The stop button's request flow, separate from the SDK's `isRunning` (which
 * stays the truth for streaming). `stopRequests` counts actual stop calls so
 * tests can assert idempotency: a click while pending, or after the run ended,
 * fires nothing.
 */
export type StopFlowState = {
  pending: boolean;
  stopRequests: number;
  outcome: TerminalOutcome | null;
};

export type StopFlowAction =
  | { type: "stop_clicked" }
  | { type: "terminal"; outcome: TerminalOutcome }
  | { type: "run_started" };

export function initialStopFlow(): StopFlowState {
  return { pending: false, stopRequests: 0, outcome: null };
}

export function stopFlowReducer(state: StopFlowState, action: StopFlowAction): StopFlowState {
  switch (action.type) {
    case "stop_clicked":
      // Idempotent: one request per run, and none at all once it ended.
      if (state.pending || state.outcome) return state;
      return { ...state, pending: true, stopRequests: state.stopRequests + 1 };
    case "terminal":
      // First terminal outcome stands — a late second one collapses away.
      if (state.outcome) return state;
      return { ...state, pending: false, outcome: action.outcome };
    case "run_started":
      return initialStopFlow();
  }
}
