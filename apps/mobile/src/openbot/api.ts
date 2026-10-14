import { z } from "zod";
import { validateChannelName, type WorkspaceChannel } from "./channel-actions";
import { openbotFetch, openbotFetchBinary } from "./client";
import { OPENMUSE_SCHEME, openbotUrl } from "./config";
import { OpenBotError } from "./errors";
import {
  conversationsSchema,
  type GoogleConnection,
  type GoogleConnections,
  type GoogleConnectStarted,
  googleConnectionSchema,
  googleConnectionsSchema,
  googleConnectStartedSchema,
  meSchema,
  type OpenBotCalendarEvents,
  type OpenBotConversations,
  type OpenBotFile,
  type OpenBotFiles,
  type OpenBotMe,
  type OpenBotSession,
  type OpenBotTask,
  type OpenBotTasks,
  type OpenBotWorkspace,
  openBotCalendarEventsSchema,
  openBotFilesSchema,
  openBotSessionSchema,
  openBotTaskSchema,
  openBotTasksSchema,
  type ProvisionedBot,
  provisionedBotSchema,
  workspaceSchema,
} from "./types";

/** High-level OpenBot endpoints for the mobile client (one function per route). */

/** Post-sign-in self check; 401 throws authentication_required. */
export function fetchMe(signal?: AbortSignal): Promise<OpenBotMe> {
  return openbotFetch("/api/me", meSchema, { signal });
}

/**
 * Provision (or find) this user's one private OpenMuse Bot. The request body
 * is empty: ownership comes from the session cookie, never a client-supplied
 * user id. A write, so 5xx surfaces as outcome_unknown (the provisioning may
 * already have landed); idempotency itself is the server's (I02).
 */
export function provisionOpenMuseBot(signal?: AbortSignal): Promise<ProvisionedBot> {
  return openbotFetch(
    "/api/mobile/openmuse-bot",
    provisionedBotSchema,
    { method: "POST", body: {}, signal },
    true,
  );
}

/** Cold-start aggregate: user + Bot roster + existing conversations. */
export function fetchWorkspace(signal?: AbortSignal): Promise<OpenBotWorkspace> {
  return openbotFetch("/api/mobile/workspace", workspaceSchema, { signal });
}

/**
 * Open or resume the conversation with one Bot, returning the session's three
 * identifiers. The server's direct() semantics are idempotent: re-opening the
 * same Bot returns the same channel. A Bot the caller cannot list answers 404.
 */
export function openConversation(botId: string, signal?: AbortSignal): Promise<OpenBotSession> {
  const id = botId.trim();
  if (!id) throw new OpenBotError("invalid_input", "缺少 Bot ID。");
  return openbotFetch(
    "/api/mobile/conversations",
    openBotSessionSchema,
    { method: "POST", body: { botId: id }, signal },
    true,
  );
}

/** POST /api/channels 201 body: channelDto; extras like `active` strip safely. */
const createdChannelSchema = z.object({
  channel: workspaceSchema.shape.channels.element,
});

/**
 * Create a Channel over the given Bot roster (C02). The body is `{agentIds}`
 * only — the server names the channel from the agents (Task 0:
 * server/src/channels/routes.ts parseChannelInput + channelName); there is no
 * client-supplied name and so no name validation. Ids are trimmed and
 * de-duplicated locally, mirroring the server's non-empty/unique check. A
 * write, so 5xx surfaces as outcome_unknown.
 */
export function createChannel(agentIds: string[], signal?: AbortSignal): Promise<WorkspaceChannel> {
  const trimmed = agentIds.map((id) => id.trim());
  if (trimmed.length === 0 || trimmed.some((id) => !id)) {
    throw new OpenBotError("invalid_input", "缺少 Bot ID，无法创建频道。");
  }
  const unique = [...new Set(trimmed)];
  return openbotFetch(
    "/api/channels",
    createdChannelSchema,
    { method: "POST", body: { agentIds: unique }, signal },
    true,
  ).then((body) => body.channel);
}

/** PATCH /api/channels/:id 200 body: the renamed channelDto row. */
const renamedChannelSchema = z.object({
  channel: workspaceSchema.shape.channels.element,
});

/**
 * Rename a Channel (C03). The name is validated locally against the server's
 * parseRenameInput contract (trim, non-empty, ≤120 code points — see
 * channel-actions.validateChannelName) so a bad name never leaves the device.
 * A write, so 5xx surfaces as outcome_unknown; 404 (foreign channel) as
 * not_found.
 */
export function renameChannel(
  channelId: string,
  name: string,
  signal?: AbortSignal,
): Promise<WorkspaceChannel> {
  const validated = validateChannelName(name);
  if (!validated.ok) throw new OpenBotError("invalid_input", validated.error);
  return openbotFetch(
    `/api/channels/${encodeURIComponent(channelId)}`,
    renamedChannelSchema,
    { method: "PATCH", body: { name: validated.name }, signal },
    true,
  ).then((body) => body.channel);
}

/** 204 with no body: both archive and unarchive answer empty. */
const noContentSchema = z.void();

/**
 * Archive a Channel (C03): it leaves the active listing but keeps its id,
 * thread and history. POST /:id/archive answers 204 even for a repeat (the
 * server makes re-archiving a no-op), so only a foreign channel (404
 * not_found) can fail the caller.
 */
export function archiveChannel(channelId: string, signal?: AbortSignal): Promise<void> {
  return openbotFetch(
    `/api/channels/${encodeURIComponent(channelId)}/archive`,
    noContentSchema,
    { method: "POST", signal },
    true,
  );
}

/**
 * Reopen an archived Channel (C03): the SAME id and thread come back. POST
 * /:id/unarchive answers 204; a channel that was never archived answers 409
 * with the server's message, surfaced as-is.
 */
export function reopenChannel(channelId: string, signal?: AbortSignal): Promise<void> {
  return openbotFetch(
    `/api/channels/${encodeURIComponent(channelId)}/unarchive`,
    noContentSchema,
    { method: "POST", signal },
    true,
  );
}

/** Conversation list (delivery view); a null cursor fetches the first page. */
export function fetchConversations(
  cursor?: string | null,
  signal?: AbortSignal,
): Promise<OpenBotConversations> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return openbotFetch(`/api/delivery/conversations${query}`, conversationsSchema, { signal });
}

/** Task list (owner's OpenMuse Tasks, newest first); a null cursor fetches the first page. */
export function fetchTasks(cursor?: string | null, signal?: AbortSignal): Promise<OpenBotTasks> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return openbotFetch(`/api/mobile/openmuse-tasks${query}`, openBotTasksSchema, { signal });
}

/** One Task's detail: steps, evidence and artifacts by stable ids (T03). */
export function fetchTaskDetail(id: string, signal?: AbortSignal): Promise<OpenBotTask> {
  const taskId = id.trim();
  if (!taskId) throw new OpenBotError("invalid_input", "缺少任务 ID。");
  return openbotFetch(
    `/api/mobile/openmuse-tasks/${encodeURIComponent(taskId)}`,
    openBotTaskSchema,
    { signal },
  );
}

/**
 * GET /api/mobile/openmuse-calendar (A01): the §4 events with half-open
 * `[timeMin,timeMax)` both required, ascending start then id. `cursor` is the
 * paging seam A02 will drive; `truncated` rides in the page schema.
 */
export function fetchCalendarEvents(
  range: { timeMin: string; timeMax: string; cursor?: string | null },
  signal?: AbortSignal,
): Promise<OpenBotCalendarEvents> {
  const query = new URLSearchParams({ timeMin: range.timeMin, timeMax: range.timeMax });
  if (range.cursor) query.set("cursor", range.cursor);
  return openbotFetch(`/api/mobile/openmuse-calendar?${query}`, openBotCalendarEventsSchema, {
    signal,
  });
}

/**
 * GET /api/mobile/openmuse-google (G06 via G03): the combined status of every
 * Google provider this deployment grants, in catalog order. Honest server
 * state only — the screen renders it as-is, never inferring a connection
 * client-side. 401 lands as authentication_required (the gate flips back).
 */
export function fetchGoogleConnections(signal?: AbortSignal): Promise<GoogleConnections> {
  return openbotFetch("/api/mobile/openmuse-google", googleConnectionsSchema, { signal });
}

/**
 * POST /api/mobile/openmuse-google/:provider/connect (G01/G03): start a
 * consent; the state stays server-side and the caller gets only the
 * authorizationUrl to open (the screen hands it to Linking). The returnUri
 * names this screen under the app's own `openmuse://` scheme, which the
 * server validates before it ever lands in a 302. A write, so 5xx surfaces
 * as outcome_unknown (the consent may already have been started).
 */
export function connectGoogle(
  provider: string,
  returnUri = `${OPENMUSE_SCHEME}://connections`,
  signal?: AbortSignal,
): Promise<GoogleConnectStarted> {
  const name = provider.trim();
  if (!name) throw new OpenBotError("invalid_input", "缺少服务商标识，无法发起连接。");
  return openbotFetch(
    `/api/mobile/openmuse-google/${encodeURIComponent(name)}/connect`,
    googleConnectStartedSchema,
    { method: "POST", body: { returnUri }, signal },
    true,
  );
}

/**
 * POST /api/mobile/openmuse-google/:provider/disconnect (G05): withdraw the
 * caller's connection — vendor first, then the local row — idempotently.
 * The 200 body is the withdrawn row ({provider, status:"disconnected"}).
 */
export function disconnectGoogle(
  provider: string,
  signal?: AbortSignal,
): Promise<GoogleConnection> {
  const name = provider.trim();
  if (!name) throw new OpenBotError("invalid_input", "缺少服务商标识，无法断开连接。");
  return openbotFetch(
    `/api/mobile/openmuse-google/${encodeURIComponent(name)}/disconnect`,
    googleConnectionSchema,
    { method: "POST", signal },
    true,
  );
}

/**
 * POST /api/computers/:botId/snapshot body (K02 Task 0:
 * server/src/computer/routes.ts:281 → gateway.snapshot). The accessibility
 * tree — snapshotId, url, title, elements — carries no pixels; the preview
 * image comes from fetchComputerScreenshot. Reads fail safe (isWrite false),
 * so 404 (foreign Bot) lands as not_found and 503 (no computer configured)
 * as unavailable.
 */
export const computerSnapshotSchema = z.object({
  snapshotId: z.number(),
  url: z.string(),
  title: z.string(),
  truncated: z.boolean(),
  elements: z.array(z.object({ ref: z.string(), role: z.string(), name: z.string() })),
  untrusted: z.string().optional(),
});
export type OpenBotComputerSnapshot = z.infer<typeof computerSnapshotSchema>;

/** GET /api/computers/:botId/screenshot body (routes.ts:104 → gateway.screenshot): PNG, base64. */
export const computerScreenshotSchema = z.object({
  base64: z.string().min(1),
  width: z.number(),
  height: z.number(),
  capturedAt: z.string(),
  url: z.string().optional(),
});
export type OpenBotComputerScreenshot = z.infer<typeof computerScreenshotSchema>;

/** Current page snapshot of the own private Bot's computer (K02). */
export function fetchComputerSnapshot(
  botId: string,
  signal?: AbortSignal,
): Promise<OpenBotComputerSnapshot> {
  const id = botId.trim();
  if (!id) throw new OpenBotError("invalid_input", "缺少 Bot ID。");
  return openbotFetch(`/api/computers/${encodeURIComponent(id)}/snapshot`, computerSnapshotSchema, {
    method: "POST",
    body: {},
    signal,
  });
}

/** One screenshot of the Bot's computer page (K02): PNG bytes as base64. */
export function fetchComputerScreenshot(
  botId: string,
  signal?: AbortSignal,
): Promise<OpenBotComputerScreenshot> {
  const id = botId.trim();
  if (!id) throw new OpenBotError("invalid_input", "缺少 Bot ID。");
  return openbotFetch(
    `/api/computers/${encodeURIComponent(id)}/screenshot`,
    computerScreenshotSchema,
    {
      signal,
    },
  );
}

/**
 * Control-lease routes (K04 Task 0, server worktree read-only citations):
 * POST /api/computers/:botId/control/{request,take,release,cancel} →
 * server/src/computer/routes.ts:367-455; every body names the lease by
 * `requestId` (handoffId, routes.ts:1041-1048) and each answer is the
 * server's ControlState (shared/computer-control.ts ComputerControlState:
 * holder bot/human + HandoffRequest{id,status,...} with the K03 vocabulary
 * waiting/taken/completed/cancelled/expired/interrupted/refused). Writes, so
 * 5xx surfaces as outcome_unknown.
 */
export const computerHandoffSchema = z.object({
  id: z.string(),
  status: z.enum([
    "waiting",
    "taken",
    "completed",
    "cancelled",
    "expired",
    "interrupted",
    "refused",
  ]),
  reason: z.string().optional(),
  expiresAt: z.string().optional(),
  finishedAt: z.string().optional(),
  takenBy: z.string().optional(),
});
export const computerControlSchema = z.object({
  holder: z.enum(["bot", "human"]),
  since: z.string(),
  requested: z.boolean(),
  reason: z.string().optional(),
  request: computerHandoffSchema.nullish(),
});
export type OpenBotComputerControl = z.infer<typeof computerControlSchema>;

/** POST /control/request: the empty body rides the server's default reason. */
export function requestComputerControl(
  botId: string,
  signal?: AbortSignal,
): Promise<OpenBotComputerControl> {
  const id = botId.trim();
  if (!id) throw new OpenBotError("invalid_input", "缺少 Bot ID。");
  return openbotFetch(
    `/api/computers/${encodeURIComponent(id)}/control/request`,
    computerControlSchema,
    { method: "POST", body: {}, signal },
    true,
  );
}

/** POST /control/take: claim the waiting lease (userId is session-injected server-side). */
export function takeComputerControl(
  botId: string,
  requestId: string,
  signal?: AbortSignal,
): Promise<OpenBotComputerControl> {
  const id = botId.trim();
  if (!id) throw new OpenBotError("invalid_input", "缺少 Bot ID。");
  return openbotFetch(
    `/api/computers/${encodeURIComponent(id)}/control/take`,
    computerControlSchema,
    { method: "POST", body: { requestId }, signal },
    true,
  );
}

/** POST /control/release: hand the wheel back to the Bot. */
export function releaseComputerControl(
  botId: string,
  requestId: string,
  signal?: AbortSignal,
): Promise<OpenBotComputerControl> {
  const id = botId.trim();
  if (!id) throw new OpenBotError("invalid_input", "缺少 Bot ID。");
  return openbotFetch(
    `/api/computers/${encodeURIComponent(id)}/control/release`,
    computerControlSchema,
    { method: "POST", body: { requestId }, signal },
    true,
  );
}

/** POST /control/cancel: withdraw a waiting request nobody took. */
export function cancelComputerControl(
  botId: string,
  requestId: string,
  signal?: AbortSignal,
): Promise<OpenBotComputerControl> {
  const id = botId.trim();
  if (!id) throw new OpenBotError("invalid_input", "缺少 Bot ID。");
  return openbotFetch(
    `/api/computers/${encodeURIComponent(id)}/control/cancel`,
    computerControlSchema,
    { method: "POST", body: { requestId }, signal },
    true,
  );
}

/**
 * POST /api/computers/:botId/human/:kind (K04 Task 0:
 * server/src/computer/routes.ts:526-609, gesture shapes 400-checked there):
 * click{x,y} / type{text} / key{key} / scroll{deltaY?} in viewport pixels,
 * plus the surface's monotonic `seq` — the lease admits only a number ahead
 * of the last delivered one, and answers 403 (policy) or 409 (no lease /
 * stale) once the lease is gone; that input was never delivered. The result
 * never carries the typed text (server HumanInputResult).
 */
export const computerInputResultSchema = z.object({
  action: z.enum(["human_click", "human_type", "human_key", "human_scroll"]),
  characters: z.number().optional(),
  key: z.string().optional(),
  deltaY: z.number().optional(),
  url: z.string(),
});
export type OpenBotComputerInputResult = z.infer<typeof computerInputResultSchema>;

export type ComputerInput =
  | { kind: "click"; x: number; y: number }
  | { kind: "type"; text: string }
  | { kind: "key"; key: string }
  | { kind: "scroll"; deltaY?: number };

/** POST /human/:kind: one gesture while controlling, numbered by the lease's seq. */
export function sendComputerInput(
  botId: string,
  input: ComputerInput & { seq?: number },
  signal?: AbortSignal,
): Promise<OpenBotComputerInputResult> {
  const id = botId.trim();
  if (!id) throw new OpenBotError("invalid_input", "缺少 Bot ID。");
  const { kind, ...gesture } = input;
  return openbotFetch(
    `/api/computers/${encodeURIComponent(id)}/human/${kind}`,
    computerInputResultSchema,
    { method: "POST", body: gesture, signal },
    true,
  );
}

/**
 * GET /api/mobile/openmuse-files (F01/F03): the owner's files, newest first;
 * a null cursor fetches the first page. Tombstoned (deleted) files never
 * appear in the page.
 */
export function fetchFiles(cursor?: string | null, signal?: AbortSignal): Promise<OpenBotFiles> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return openbotFetch(`/api/mobile/openmuse-files${query}`, openBotFilesSchema, { signal });
}

/** Route path of one file's authenticated byte stream (F02 §5 content access). */
function fileContentPath(fileId: string): string {
  const id = fileId.trim();
  if (!id) throw new OpenBotError("invalid_input", "缺少文件 ID。");
  return `/api/mobile/openmuse-files/${encodeURIComponent(id)}/content`;
}

/**
 * Absolute URL of one file's authenticated byte stream — for in-app viewers
 * that take a source URL (F07/F08). The bytes still require the session, so
 * this URL is never a shareable link; only the owning session can fetch it.
 */
export function fileContentUrl(fileId: string): string {
  return `${openbotUrl}${fileContentPath(fileId)}`;
}

/**
 * Downloads one file's bytes (F02): the authenticated raw Response — the
 * caller converts on the adapter's terms (arrayBuffer → base64 on RN) and
 * reads the ETag header (`sha256:<digest>`) for the hash record. 401 (session
 * gone) and 404 (foreign/deleted id) surface through the shared mapping.
 */
export function downloadFile(file: OpenBotFile, signal?: AbortSignal): Promise<Response> {
  return openbotFetchBinary(fileContentPath(file.id), { signal });
}

/**
 * GET /api/mobile/openmuse-files/:id/versions row (F07 Task 0): F06's version
 * rows — the root row (parentVersionId null) is 原件, rows carrying
 * parentVersionId are fill-derived copies with their own sha256/size. F06's
 * fill provenance (`values`) is not the viewer's business and strips safely.
 */
const fileVersionRowSchema = z.object({
  versionId: z.string().min(1),
  parentVersionId: z.string().nullable(),
  sha256: z.string().min(1),
  size: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export const openBotFileVersionsSchema = z.object({
  versions: z.array(fileVersionRowSchema),
});
export type OpenBotFileVersion = z.infer<typeof fileVersionRowSchema>;

/**
 * One file's version list (F07). Task 0 finding, recorded: F01's detail DTO
 * exposes no version list (the list/detail rows carry the current versionId
 * only), so the viewer fetches this route instead. Until the server ships it
 * the call answers not_found and the viewer degrades to the file row's
 * current version (original-only).
 */
export function fetchFileVersions(
  fileId: string,
  signal?: AbortSignal,
): Promise<z.infer<typeof openBotFileVersionsSchema>> {
  const id = fileId.trim();
  if (!id) throw new OpenBotError("invalid_input", "缺少文件 ID。");
  return openbotFetch(
    `/api/mobile/openmuse-files/${encodeURIComponent(id)}/versions`,
    openBotFileVersionsSchema,
    { signal },
  );
}

/** Route path of one VERSION's byte stream: the content route with a version selector. */
function fileVersionContentPath(fileId: string, versionId: string): string {
  return `${fileContentPath(fileId)}?versionId=${encodeURIComponent(versionId.trim())}`;
}

/**
 * Absolute URL of one version's byte stream — the F02 content route scoped by
 * `versionId` (§5: the bytes still require the session; never a shareable
 * link). The viewer always verifies the answer's ETag digest against the
 * version row's sha256 before trusting the bytes (pdf-view-state).
 */
export function fileVersionContentUrl(fileId: string, versionId: string): string {
  return `${openbotUrl}${fileVersionContentPath(fileId, versionId)}`;
}

/** Downloads one VERSION's bytes (F07): the authenticated raw Response, like downloadFile. */
export function downloadFileVersion(
  file: OpenBotFile,
  versionId: string,
  signal?: AbortSignal,
): Promise<Response> {
  const id = versionId.trim();
  if (!id) throw new OpenBotError("invalid_input", "缺少版本 ID。");
  return openbotFetchBinary(fileVersionContentPath(file.id, versionId), { signal });
}
