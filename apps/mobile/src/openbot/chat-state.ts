import type { OpenBotSession } from "./types";

/**
 * Pure conversation-identity and transcript mapping for the OpenBot chat
 * screen (C01). No React and no SDK imports: everything here is testable
 * under node:test, and the screen stays a thin adapter over these seams.
 */

/**
 * The AG-UI message subset the transcript reads. Streaming is carried by the
 * caller (the runtime's messages have no such field in this SDK version);
 * `toTranscript` only honors it when present.
 */
export type ChatMessage = {
  id: string;
  role: string;
  content?: string;
  isStreaming?: boolean;
};

/** One rendered transcript row; `text` is trimmed and non-empty. */
export type TranscriptRow = {
  id: string;
  role: "assistant" | "user";
  text: string;
  streaming: boolean;
};

/** Local agent id for the session's channel: the runtime convention, never the botId. */
export function channelAgentId(session: OpenBotSession): string {
  return `channel:${session.channelId}`;
}

/**
 * The three conversation identities as one useAgent options object: a local
 * channel-scoped agent routing to the session's runtime Bot on its own thread.
 */
export function runtimeAgentFor(session: OpenBotSession): {
  agentId: string;
  runtimeAgentId: string;
  threadId: string;
} {
  return {
    agentId: channelAgentId(session),
    runtimeAgentId: session.botId,
    threadId: session.threadId,
  };
}

/** Map AG-UI messages to view rows: keep order, drop empties and non-chat roles. */
export function toTranscript(messages: readonly ChatMessage[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  for (const message of messages) {
    if (message.role !== "assistant" && message.role !== "user") continue;
    const text = (message.content ?? "").trim();
    if (!text) continue;
    rows.push({
      id: message.id,
      role: message.role,
      text,
      streaming: message.isStreaming === true,
    });
  }
  return rows;
}

/**
 * §3 dedupe wrapping transcript construction: persisted message ids are
 * unique per thread, so a duplicate id in the runtime list is replayed
 * overlap — the first occurrence renders (one bubble, one React key) and the
 * rest collapse, whatever the SDK did or did not merge on reconnect.
 */
export function dedupeById<T extends { id: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

/** Trim a draft and refuse an empty send (null), so the UI never sends whitespace. */
export function nextUserMessage(draft: string): string | null {
  const trimmed = draft.trim();
  return trimmed ? trimmed : null;
}

/**
 * Stable per-channel storage key, scoped to the channel only (never bot or
 * thread ids). Reserved for optimistic echo of the user's own line while a
 * run is in flight — the app currently does NOT call it (the in-memory
 * addMessage/rollback path owns echo today); it stays because its contract is
 * pinned by openbot-chat-state.test.ts. History authority is always the
 * runtime's persisted Thread, restored by the mount-time connect.
 */
export function historyKey(session: OpenBotSession): string {
  return `openmuse-openbot-chat-${session.channelId}`;
}
