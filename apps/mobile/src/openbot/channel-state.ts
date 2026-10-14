import type { OpenBotSession, OpenBotWorkspace } from "./types";

/**
 * Pure channel-list identity and ordering seams for C02 (create and switch
 * Channels). No React and no SDK imports: like chat-state, everything here is
 * testable under node:test and the screen stays a thin adapter.
 */

/** One workspace channels[] row, exactly as the mobile-bff workspace read returns it. */
export type WorkspaceChannel = OpenBotWorkspace["channels"][number];

/**
 * The server's roster order IS the render order: OpenBot sorts by its
 * pinned/recency/id keyset cursor (channels/routes.ts ROSTER_ORDER) and
 * mobile-bff maps those rows straight into channels[] (workspace.ts). A named
 * passthrough rather than a bare identity, so "the client never re-sorts" is
 * one tested seam instead of an invisible convention.
 */
export function orderPassthrough(channels: readonly WorkspaceChannel[]): WorkspaceChannel[] {
  return [...channels];
}

/**
 * The channel's runtime Bot. The schema allows an empty agentIds array, but a
 * session keyed on undefined would only fail deep inside the runtime — the
 * mapping refuses such a row loudly instead.
 */
function runtimeBotId(channel: WorkspaceChannel): string {
  const botId = channel.agentIds[0];
  if (botId === undefined) throw new Error(`频道 ${channel.id} 缺少 Bot，无法建立会话。`);
  return botId;
}

/**
 * The conversation identity switching the chat onto one channel: the local
 * channel-scoped agent id (the runtime convention, never the botId), the
 * channel's first agent as the runtime Bot, and the channel's own thread.
 */
export function selectedIdentity(channel: WorkspaceChannel): {
  agentId: string;
  runtimeAgentId: string;
  threadId: string;
} {
  return {
    agentId: `channel:${channel.id}`,
    runtimeAgentId: runtimeBotId(channel),
    threadId: channel.threadId,
  };
}

/**
 * Distinct-thread assertion helper: true when no two channels share a thread.
 * One thread must never back two channels — that is the C02 acceptance seam.
 */
export function distinctThreads(channels: readonly WorkspaceChannel[]): boolean {
  return new Set(channels.map((channel) => channel.threadId)).size === channels.length;
}

/**
 * A channel row as the chat screen's session-shaped prop: botId is the
 * channel's first agent, so C01's runtimeAgentFor derives exactly the identity
 * selectedIdentity describes.
 */
export function sessionFor(channel: WorkspaceChannel): OpenBotSession {
  return {
    botId: runtimeBotId(channel),
    channelId: channel.id,
    threadId: channel.threadId,
  };
}

/**
 * Fold a POST /api/channels row into the list: merge into an existing id slot
 * (no duplicate rows), otherwise append. Appending is the plan's merge rule,
 * not the server's recency order — the next workspace read restores the true
 * cursor order.
 */
export function mergeCreated(
  existing: readonly WorkspaceChannel[],
  created: WorkspaceChannel,
): WorkspaceChannel[] {
  return existing.some((channel) => channel.id === created.id)
    ? existing.map((channel) => (channel.id === created.id ? created : channel))
    : [...existing, created];
}
