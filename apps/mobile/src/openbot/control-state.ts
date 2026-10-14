/**
 * Pure control-lease seam for the computer screen (K04). No react-native, no
 * storage, no imports at all: everything here runs under node:test, and the
 * lease state lives only in React state — it is never written to any storage.
 *
 * Task 0 route facts this models (server/src/computer/routes.ts in the OpenBot
 * v4-base worktree, read-only): POST /api/computers/:botId/control/{request,
 * take,release,cancel} answer the server's ControlState (holder bot/human +
 * HandoffRequest{id,status}), whose K03 status vocabulary ends a lease in
 * completed/cancelled/expired/interrupted/refused. POST
 * /api/computers/:botId/human/:kind (click|type|key|scroll) carries the
 * gesture and the surface's monotonic seq, and answers 403 (policy refusal)
 * or 409 (no lease / stale sequence) once the lease is gone — input refused
 * there was never delivered, so the surface refuses visibly and never
 * retries. The live WS stream's input framing is the native pass, not this
 * module's (K03 deferred it); every input here travels over HTTP.
 */

/** The §3 phases the surface renders, with K03's terminal outcomes. */
export type ControlPhase =
  | "viewing" // the Bot drives; no human lease
  | "requesting" // request sent; the lease waits to be claimed
  | "controlling" // take ok; the human holds the wheel
  | "released" // release/disconnect/logout landed; the Bot drives again
  | "refused" // terminal: policy refusal, revocation, or late input
  | "expired"; // terminal: the waiting deadline passed

export interface ControlState {
  phase: ControlPhase;
  /** HandoffRequest.id — the requestId every control route body carries. */
  leaseId: string | null;
  /** Why the Bot asked (server reason), or why a lease was refused. */
  reason: string | null;
  /** User-facing copy of the last failure; cleared on the next transition. */
  message: string | null;
  /** True while the visible state exists only to refuse a late input. */
  inputRefused: boolean;
  /** The last input seq this lease sent; resets on take (server semantics). */
  seq: number;
  /** Monotonic lease generation: +1 on every take, never reset — it keeps
   *  apart same-numbered seqs issued under different leases. */
  generation: number;
}

/** zh-CN chips, module-internal like every other OpenBot screen. */
export const controlPhaseLabels: Record<ControlPhase, string> = {
  viewing: "机器人操作中",
  requesting: "等待接管",
  controlling: "接管中",
  released: "已交还",
  refused: "接管被拒",
  expired: "请求已过期",
};

/** The visible refusal copy for input the lease refused after it was gone. */
export const controlLateInputLabel = "控制已断开，本次输入未发送。";

/** The server's lease-gone answers; anything else is not a lease conclusion. */
export function isLateInputRefusal(status: number): boolean {
  return status === 403 || status === 409;
}

export function initialControlState(): ControlState {
  return {
    phase: "viewing",
    leaseId: null,
    reason: null,
    message: null,
    inputRefused: false,
    seq: 0,
    generation: 0,
  };
}

/** A fresh, clean phase (transitions always clear the last refusal). */
function phase(state: ControlState, next: ControlPhase, leaseId: string | null): ControlState {
  return { ...state, phase: next, leaseId, message: null, inputRefused: false };
}

/**
 * POST /control/request landed. Any phase but controlling may open (or
 * re-open) a request — a terminal lease names the lease's end, not the
 * screen's — while a held lease must not be re-requested locally (the server
 * returns the waiting one anyway; the take button is the way forward).
 */
export function controlRequestSent(
  state: ControlState,
  leaseId: string | null,
  reason?: string,
): ControlState {
  if (state.phase === "controlling") return state;
  return { ...phase(state, "requesting", leaseId), reason: reason ?? state.reason };
}

/** POST /control/take ok. Only a waiting lease can be taken (server: 409). */
export function controlTaken(state: ControlState, leaseId: string | null): ControlState {
  if (state.phase !== "requesting") return state;
  // A fresh lease numbers its input from the start (K03 resets on take); the
  // generation moves on so a prior lease's in-flight seq cannot collide with
  // the re-taken lease's same-numbered seqs.
  return { ...phase(state, "controlling", leaseId), seq: 0, generation: state.generation + 1 };
}

/** POST /control/release landed, or the disconnect ended the lease. */
export function controlReleased(state: ControlState): ControlState {
  return phase(state, "released", null);
}

/** The lease ended against the holder: policy refusal or revocation. */
export function controlRefused(state: ControlState, reason?: string): ControlState {
  return { ...phase(state, "refused", null), reason: reason ?? null };
}

/** The waiting deadline passed before anyone took it. */
export function controlExpired(state: ControlState): ControlState {
  return phase(state, "expired", null);
}

/**
 * POST /control/cancel landed (or was 409-nothing-to-cancel): a cancelled
 * request was never held, so the screen returns to viewing — but the
 * generation stays monotonic. initialControlState() would reset it to 0, and
 * the NEXT take re-enters generation 1 with seq 0, so a prior gen-1 lease's
 * late 403/409 satisfies every controlInputFailed guard and evicts the
 * healthy re-taken lease — exactly the collision generation exists to prevent.
 */
export function controlCancelled(state: ControlState): ControlState {
  return phase(state, "viewing", null);
}

/**
 * A person's input came back 403/409: the lease was gone when it landed, the
 * server never delivered it, and this surface never retries. Only those two
 * answers conclude the lease; a 400 (malformed gesture) or a 5xx (transport)
 * leaves the phase untouched for the caller to surface its own way.
 */
export function controlInputRefused(state: ControlState, status: number): ControlState {
  if (!isLateInputRefusal(status)) return state;
  return { ...controlRefused(state), inputRefused: true, message: controlLateInputLabel };
}

/**
 * A dispatched input's 403/409 landed. Only the freshest dispatched seq may
 * conclude the lease: an answer for a superseded seq proves the server had
 * already moved past it (a duplicated or replayed dispatch) while a newer
 * input is still in flight to settle the lease — evicting on it would drop a
 * lease the newer request may still be delivering under. `generation` is the
 * lease generation the dispatch captured: seqs reset on take, so a prior
 * lease's late answer can otherwise collide with the re-taken lease's
 * same-numbered seq and evict a healthy lease (omitted = unguarded, legacy
 * call sites). Anything else (a non-refusal status, a concluded or handed-back
 * lease, a seq a re-take replaced) leaves the state untouched for the caller
 * to surface its own way.
 */
export function controlInputFailed(
  state: ControlState,
  seq: number,
  status: number,
  generation?: number,
): ControlState {
  if (
    !isLateInputRefusal(status) ||
    state.phase !== "controlling" ||
    seq !== state.seq ||
    (generation !== undefined && generation !== state.generation)
  )
    return state;
  return controlInputRefused(state, status);
}

/** The one phase input may leave the device in. */
export function canDispatchControlInput(state: ControlState): boolean {
  return state.phase === "controlling";
}

/**
 * The gate every gesture passes before any request is built: dispatching is
 * allowed only while controlling, so input queued while requesting is refused
 * locally (nothing leaves the device, nothing fires after the take). While
 * controlling, the call also assigns the gesture its monotonic seq — the
 * ordering the server's lease enforces — and returns the advanced state.
 */
export function attemptControlInput(
  state: ControlState,
): { ok: true; seq: number; state: ControlState } | { ok: false } {
  if (!canDispatchControlInput(state)) return { ok: false };
  const seq = state.seq + 1;
  return { ok: true, seq, state: { ...state, seq } };
}
