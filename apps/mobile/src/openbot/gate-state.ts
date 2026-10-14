/**
 * Pure entry state machine for OpenBotGate. Lives in its own module (no
 * react-native imports) so node:test can exercise it directly; gate.tsx
 * imports and re-exports it.
 */
import type { OpenBotErrorCode } from "./errors";
import type { OpenBotSession } from "./types";

export type GatePhase = "checking" | "signin" | "loading";

/**
 * Only the events the gate actually dispatches: workspace load failures run
 * through entrySequenceReducer instead, and sign-out happens at the App layer
 * (the gate is already unmounted by then).
 */
export type GateEvent = { type: "no-local-session" } | { type: "auth-failed" } | { type: "me-ok" };

export interface GateState {
  phase: GatePhase;
}

export function entryPhaseReducer(_state: GateState, event: GateEvent): GateState {
  switch (event.type) {
    case "no-local-session":
    case "auth-failed":
      return { phase: "signin" };
    case "me-ok":
      return { phase: "loading" };
  }
}

/**
 * The post-auth entry sequence (I03): provision the private OpenMuse Bot →
 * read the workspace → open the returned Bot's conversation, ending in
 * `ready` with the session's three identifiers. A stored session from a
 * previous entry skips straight to the workspace validation step. Also pure,
 * so node:test exercises every failure kind without React.
 */
export type EntrySequencePhase =
  | "provisioning"
  | "workspace"
  | "conversation"
  | "ready"
  | "signin"
  | "error";

export interface EntrySequenceFailure {
  retryable: boolean;
  /** OpenBot error code, or workspace_inconsistent for the missing-Bot case. */
  code: OpenBotErrorCode | "workspace_inconsistent";
  message: string;
}

export interface EntrySequenceState {
  phase: EntrySequencePhase;
  /** Private Bot ID once known (after provision-ok, or from a stored session). */
  botId?: string;
  /** Full conversation identifiers; present once the phase is ready. */
  session?: OpenBotSession;
  failure?: EntrySequenceFailure;
}

export type EntrySequenceEvent =
  /** No stored session: begin the sequence at provisioning. */
  | { type: "start" }
  /** Stored session from a previous entry: validate it via the workspace read only. */
  | { type: "stored"; session: OpenBotSession }
  | { type: "provision-ok"; botId: string }
  | { type: "workspace-ok"; agents: ReadonlyArray<{ id: string }> }
  | { type: "conversation-ok"; session: OpenBotSession }
  /** Any step failed with the given OpenBot error. */
  | { type: "failed"; code: OpenBotErrorCode; message: string };

export const initialEntrySequence: EntrySequenceState = { phase: "provisioning" };

const COPY = {
  workspaceInconsistent: "工作区未包含你的专属 Bot，数据不一致，请退出登录后重试。",
} as const;

export function entrySequenceReducer(
  state: EntrySequenceState,
  event: EntrySequenceEvent,
): EntrySequenceState {
  switch (event.type) {
    case "start":
      return { phase: "provisioning" };
    case "stored":
      return { phase: "workspace", botId: event.session.botId, session: event.session };
    case "provision-ok":
      return { phase: "workspace", botId: event.botId };
    case "workspace-ok": {
      // The workspace must list the Bot this entry provisioned (or restored);
      // a miss is server-side data inconsistency, not something a retry fixes.
      const botId = state.botId;
      if (!botId || !event.agents.some((agent) => agent.id === botId)) {
        return {
          phase: "error",
          failure: {
            retryable: false,
            code: "workspace_inconsistent",
            message: COPY.workspaceInconsistent,
          },
        };
      }
      // A stored session is already complete; a fresh provision still needs
      // its conversation opened.
      return state.session
        ? { phase: "ready", botId, session: state.session }
        : { phase: "conversation", botId };
    }
    case "conversation-ok":
      return { phase: "ready", botId: event.session.botId, session: event.session };
    case "failed":
      if (event.code === "authentication_required") return { phase: "signin" };
      // Contract drift will not fix itself on retry; everything else might.
      return {
        phase: "error",
        failure: {
          retryable: event.code !== "invalid_response",
          code: event.code,
          message: event.message,
        },
      };
  }
}
