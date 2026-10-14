/**
 * Pure connection-state seam for the computer preview screen (K02). No
 * react-native, no storage, no imports at all: everything here runs under
 * node:test, and the preview data lives only in React state — it is never
 * written to any storage and disconnect clears it in memory.
 *
 * Task 0 route facts this models: POST /api/computers/:botId/snapshot answers
 * the accessibility tree (no pixels); GET /api/computers/:botId/screenshot
 * answers the PNG as base64. 401/403/404 and aborted transports all land as
 * a terminal disconnected state; only the explicit retry event reconnects.
 * The live WS stream and its closure semantics are K04's, not this module's.
 */

export type ComputerConnection = "connecting" | "viewing" | "disconnected";

/** Why the preview disconnected; mirrors the OpenBot error codes the fetches raise. */
export type ComputerDisconnectReason =
  | "authentication_required"
  | "refused"
  | "not_found"
  | "unavailable"
  | "invalid_response"
  | "network";

/** What POST /snapshot returns, structurally (the api layer's parsed body satisfies this). */
export interface ComputerPageInput {
  snapshotId: number;
  url: string;
  title: string;
  truncated: boolean;
  elements: readonly unknown[];
  untrusted?: string;
}

/** The one-page summary the screen renders beside the preview image. */
export interface ComputerPage {
  snapshotId: number;
  url: string;
  title: string;
  truncated: boolean;
  elementCount: number;
  /** An untrusted-content flag from the server, folded to a boolean. */
  untrusted: boolean;
}

export interface ComputerState {
  connection: ComputerConnection;
  /**
   * The poll round this state reflects. A response from an older round loses
   * to whatever landed first; the retry button is the only path that bumps it
   * once the state is disconnected.
   */
  seq: number;
  page: ComputerPage | null;
  /** Preview image as a data: URL, in memory only; null once disconnected. */
  image: string | null;
  /**
   * The previewed page's pixel size, for mapping a control-pad tap to page
   * coordinates. It rides the picture's round guard and clears with it, so
   * the pad can never be timed against a picture that is not on screen.
   */
  viewport: { width: number; height: number } | null;
  /** Server clock of the screenshot, shown as the capture time. */
  capturedAt: string | null;
  /** Local epoch ms of the last accepted data; drives the staleness flag. */
  freshAt: number | null;
  reason: ComputerDisconnectReason | null;
  message: string | null;
}

export const computerConnectionLabels: Record<ComputerConnection, string> = {
  connecting: "连接中",
  viewing: "查看中",
  disconnected: "已断开",
};

export const computerStaleLabel = "数据过期";

export function computerPageOf(snapshot: ComputerPageInput): ComputerPage {
  return {
    snapshotId: snapshot.snapshotId,
    url: snapshot.url,
    title: snapshot.title,
    truncated: snapshot.truncated,
    elementCount: snapshot.elements.length,
    untrusted: Boolean(snapshot.untrusted),
  };
}

/** Round 1 is in flight: nothing viewed, nothing retained. */
export function initialComputerState(): ComputerState {
  return {
    connection: "connecting",
    seq: 1,
    page: null,
    image: null,
    viewport: null,
    capturedAt: null,
    freshAt: null,
    reason: null,
    message: null,
  };
}

/**
 * One poll round's success. A late answer from an older round is discarded
 * (newest wins), and a disconnected screen never revives implicitly — only
 * computerRetry() reconnects.
 */
export function computerViewed(
  state: ComputerState,
  round: number,
  page: ComputerPage,
  image: string,
  capturedAt: string,
  now: number,
  viewport: { width: number; height: number },
): ComputerState {
  if (state.connection === "disconnected" || round < state.seq) return state;
  return {
    connection: "viewing",
    seq: round,
    page,
    image,
    viewport,
    capturedAt,
    freshAt: now,
    reason: null,
    message: null,
  };
}

/**
 * One poll round's failure: terminal. Every in-memory reference to the
 * preview is cleared here, so nothing about the picture (URL included)
 * survives the disconnect.
 */
export function computerFailed(
  state: ComputerState,
  round: number,
  reason: ComputerDisconnectReason,
  message?: string,
): ComputerState {
  if (round < state.seq) return state;
  return {
    connection: "disconnected",
    seq: round,
    page: null,
    image: null,
    viewport: null,
    capturedAt: null,
    freshAt: null,
    reason,
    message: message ?? null,
  };
}

/** Start the next poll round, keeping the last picture visible meanwhile. */
export function computerPoll(state: ComputerState, seq: number): ComputerState {
  if (state.connection === "disconnected" || seq <= state.seq) return state;
  return { ...state, connection: state.image ? "viewing" : "connecting", seq };
}

/** The explicit reconnect event: the only way out of disconnected. */
export function computerRetry(state: ComputerState): ComputerState {
  return { ...initialComputerState(), seq: state.seq + 1 };
}

/** True while viewing data older than two poll intervals (the honest liveness reading of K02). */
export function isComputerStale(
  state: ComputerState,
  now: number,
  pollIntervalMs: number,
): boolean {
  return (
    state.connection === "viewing" &&
    state.freshAt !== null &&
    now - state.freshAt > 2 * pollIntervalMs
  );
}

/** The preview source for rendering: in memory only, null once disconnected. */
export function snapshotSourceOf(state: ComputerState): string | null {
  return state.connection === "viewing" ? state.image : null;
}
