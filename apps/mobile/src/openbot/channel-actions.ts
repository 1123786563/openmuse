import type { WorkspaceChannel } from "./channel-state";

export type { WorkspaceChannel } from "./channel-state";

/**
 * Pure rename/archive/reopen seams for C03. No React and no SDK imports: like
 * channel-state, everything here is testable under node:test and the screen
 * stays a thin adapter. Identity is the invariant: archiving changes neither
 * a channel's id nor its thread, so history survives the round trip.
 */

/** Server contract: channels/routes.ts MAX_CHANNEL_NAME_CODE_POINTS. */
const MAX_CHANNEL_NAME_CODE_POINTS = 120;

export type ChannelNameValidation = { ok: true; name: string } | { ok: false; error: string };

/**
 * The client's mirror of the server's parseRenameInput: trim, non-empty, at
 * most 120 code points. Control characters are additionally refused — the
 * server only trims and counts, but a name the UI cannot render is a caller
 * bug, and refusing locally costs nothing.
 */
export function validateChannelName(name: string): ChannelNameValidation {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "频道名称不能为空。" };
  const chars = Array.from(trimmed);
  if (chars.some((char) => char < " " || char === "\u007f"))
    return { ok: false, error: "频道名称不能包含控制字符。" };
  if (chars.length > MAX_CHANNEL_NAME_CODE_POINTS)
    return { ok: false, error: "频道名称最多 120 个字符。" };
  return { ok: true, name: trimmed };
}

/**
 * Split the workspace roster into active/archived by each row's archivedAt,
 * keeping the server's order within each partition (the workspace read lists
 * the active partition first, the archived one after; the client classifies
 * by the field, never by position).
 */
export function partitionArchived(channels: readonly WorkspaceChannel[]): {
  active: WorkspaceChannel[];
  archived: WorkspaceChannel[];
} {
  const active: WorkspaceChannel[] = [];
  const archived: WorkspaceChannel[] = [];
  for (const channel of channels) {
    // Explicit double check, never a loose !=: archivedAt is string | null |
    // undefined (a row from a pre-archive server omits the field and is
    // active), and !== null alone would file an undefined as archived.
    const isArchived = channel.archivedAt !== null && channel.archivedAt !== undefined;
    (isArchived ? archived : active).push(channel);
  }
  return { active, archived };
}

/**
 * Reopened-identity assertion: true when two rows are the same conversation
 * ({id, threadId}). Archive→reopen changes only archivedAt; a differing id or
 * thread means it is not the same channel come back.
 */
export function sameChannelIdentity(a: WorkspaceChannel, b: WorkspaceChannel): boolean {
  return a.id === b.id && a.threadId === b.threadId;
}

/** Merge a rename (or reopen) response row into its slot; position untouched. */
export function applyRenamed(
  channels: readonly WorkspaceChannel[],
  updated: WorkspaceChannel,
): WorkspaceChannel[] {
  return channels.map((channel) => (channel.id === updated.id ? updated : channel));
}

/**
 * Stamp the row archived locally (the server's 204 carries no timestamp); the
 * next workspace read restores the true value, like mergeCreated's append.
 */
export function applyArchived(
  channels: readonly WorkspaceChannel[],
  channelId: string,
  at: string,
): WorkspaceChannel[] {
  return channels.map((channel) =>
    channel.id === channelId ? { ...channel, archivedAt: at } : channel,
  );
}

/** Clear the local stamp on reopen; the server keeps id, thread and history. */
export function applyReopened(
  channels: readonly WorkspaceChannel[],
  channelId: string,
): WorkspaceChannel[] {
  return channels.map((channel) =>
    channel.id === channelId ? { ...channel, archivedAt: null } : channel,
  );
}
