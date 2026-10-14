import { z } from "zod";

/**
 * OpenBot API data model. Field names mirror the server source
 * (server/src/mobile-bff/workspace.ts and routes.ts); unknown keys are
 * stripped, so server extras like `mode` or `onboarding` pass through safely.
 */

const nonempty = z.string().min(1);

/** GET /api/me. */
export const meSchema = z.object({
  user: z.object({
    id: nonempty,
    role: z.string(),
  }),
});
export type OpenBotMe = z.infer<typeof meSchema>;

/** POST /api/mobile/conversations 201 body (the server also sends mode:"single"). */
export const openBotSessionSchema = z.object({
  botId: nonempty,
  channelId: nonempty,
  threadId: nonempty,
  /**
   * Account the entry persisted under (gate binds it to /api/me's user.id on
   * write and drops mismatches on read): the session itself carries no user
   * field, so this is the only way a previous user's stored entry cannot seed
   * the next one's entry. Optional — pre-binding entries simply never match.
   */
  userId: nonempty.optional(),
});
export type OpenBotSession = z.infer<typeof openBotSessionSchema>;

/** POST /api/mobile/openmuse-bot 200 body (I02; profile is lazy-provisioned → nullable). */
export const provisionedBotSchema = z.object({
  botId: nonempty,
  templateVersion: z.number().int(),
  computerProfileId: z.string().nullable(),
});
export type ProvisionedBot = z.infer<typeof provisionedBotSchema>;

/** GET /api/mobile/workspace cold-start aggregate. */
export const workspaceSchema = z.object({
  user: z.object({ id: nonempty, role: z.string() }),
  agents: z.array(
    z.object({
      id: nonempty,
      name: z.string(),
      title: z.string(),
      avatarSeed: z.string(),
      visibility: z.enum(["public", "private"]),
    }),
  ),
  channels: z.array(
    z.object({
      id: nonempty,
      name: z.string(),
      agentIds: z.array(nonempty),
      threadId: nonempty,
      lastMessageAt: z.string().nullable(),
      // C03: null = active, ISO string = archived. Optional so a pre-archive
      // server still parses; it classifies as active.
      archivedAt: z.string().nullable().optional(),
    }),
  ),
});
export type OpenBotWorkspace = z.infer<typeof workspaceSchema>;

/** GET /api/delivery/conversations page. */
export const conversationsSchema = z.object({
  conversations: z.array(
    z.object({
      id: nonempty,
      name: z.string(),
      agentIds: z.array(nonempty),
      threadId: z.string().optional(),
      lastMessageAt: z.string().nullable().optional(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
export type OpenBotConversations = z.infer<typeof conversationsSchema>;

/** POST /api/delivery/conversations/:id/messages 202 body (consumed by I03). */
export const messageAcceptedSchema = z.object({
  queued: z.boolean().optional(),
  id: z.string().optional(),
});
export type OpenBotMessageAccepted = z.infer<typeof messageAcceptedSchema>;

/** Contract §7 step statuses, as the openmuse-tasks runner records them (T02). */
export const taskStepStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "waiting",
]);
export type TaskStepStatus = z.infer<typeof taskStepStatusSchema>;

/** Contract §7 Task statuses. */
export const taskStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_approval",
  "waiting_input",
  "scheduled",
  "paused",
  "succeeded",
  "failed",
  "cancelled",
]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

/** One §7 plan step; `title`/`dependsOn` come from §7, `error` from T02's failure path. */
const taskStepSchema = z.object({
  id: nonempty,
  title: z.string().optional(),
  status: taskStepStatusSchema,
  result: z.string().optional(),
  error: z.string().optional(),
  evidenceIds: z.array(nonempty).optional(),
});

/**
 * One §7 evidence entry. `kind` stays an open string so an unknown kind parses
 * and renders neutrally in the view instead of failing the whole detail read.
 */
const taskEvidenceSchema = z.object({
  id: nonempty,
  kind: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

/** GET /api/mobile/openmuse-tasks/:id body (mirror of the T01 server DTO). */
export const openBotTaskSchema = z.object({
  id: nonempty,
  kind: z.string(),
  status: taskStatusSchema,
  attempts: z.number().int(),
  steps: z.array(taskStepSchema),
  evidence: z.array(taskEvidenceSchema),
  artifactIds: z.array(nonempty),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OpenBotTask = z.infer<typeof openBotTaskSchema>;

/** GET /api/mobile/openmuse-tasks page (owner's tasks, newest first). */
export const openBotTasksSchema = z.object({
  tasks: z.array(openBotTaskSchema),
  nextCursor: z.string().nullable(),
});
export type OpenBotTasks = z.infer<typeof openBotTasksSchema>;

/**
 * Contract §4 Calendar read DTO (A01's endpoint). `start`/`end` are RFC 3339
 * with offsets for timed events and date-only with an exclusive end for
 * all-day; rendering semantics are A03's (calendar-view.ts), the DTO just
 * passes them through. Optional fields keep an older server parsing.
 */
export const openBotCalendarEventSchema = z.object({
  id: nonempty,
  calendarId: nonempty,
  etag: z.string(),
  title: z.string(),
  start: nonempty,
  end: nonempty,
  allDay: z.boolean(),
  timeZone: z.string().optional(),
  location: z.string().optional(),
  description: z.string().optional(),
  attendees: z.array(z.object({ email: nonempty, name: z.string().optional() })).optional(),
});
export type OpenBotCalendarEvent = z.infer<typeof openBotCalendarEventSchema>;

/** GET /api/mobile/openmuse-calendar page (ascending start then id; A02 owns paging UI). */
export const openBotCalendarEventsSchema = z.object({
  events: z.array(openBotCalendarEventSchema),
  nextCursor: z.string().nullable(),
  truncated: z.boolean().optional(),
});
export type OpenBotCalendarEvents = z.infer<typeof openBotCalendarEventsSchema>;

/**
 * Contract §4 connection statuses, as the connectors store records them.
 * Kept as a set for narrowing only — the wire schema below stays an open
 * string, because an unknown status must render as 未知, not fail the whole
 * screen with a fabricated connected.
 */
export const googleConnectionStatuses = [
  "connected",
  "refresh_required",
  "disconnected",
  "revoked",
] as const;
export type GoogleConnectionStatus = (typeof googleConnectionStatuses)[number];

/**
 * One row of the combined status (G03 GET /api/mobile/openmuse-google). The
 * ACTUAL route shape (server openmuse-connectors/routes.ts connectionBody): a
 * connected row carries accountEmail/grantedScopes/generation/connectedAt,
 * a disconnected row carries only {provider, status}, and lastError rides
 * only while the server has one — hence every field after `status` is
 * optional, not nullable. `status` stays an open string per the §4 rule
 * above.
 */
export const googleConnectionSchema = z.object({
  provider: nonempty,
  status: z.string(),
  accountEmail: z.string().optional(),
  grantedScopes: z.array(z.string()).optional(),
  generation: z.number().optional(),
  connectedAt: z.string().optional(),
  lastError: z.string().optional(),
});
export type GoogleConnection = z.infer<typeof googleConnectionSchema>;

/** GET /api/mobile/openmuse-google body: every provider, in catalog order. */
export const googleConnectionsSchema = z.object({
  connections: z.array(googleConnectionSchema),
});
export type GoogleConnections = z.infer<typeof googleConnectionsSchema>;

/** POST /api/mobile/openmuse-google/:provider/connect 200 body (the state stays server-side). */
export const googleConnectStartedSchema = z.object({ authorizationUrl: nonempty });
export type GoogleConnectStarted = z.infer<typeof googleConnectStartedSchema>;

/**
 * Contract §5 File DTO as the openmuse-files list returns it (F01): stable
 * identity plus the current version's size/SHA-256. `name` is display-only
 * (F03 renames it); the local cache filename derives from `id`, never `name`.
 */
export const openBotFileSchema = z.object({
  id: nonempty,
  name: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  sha256: z.string(),
  versionId: nonempty,
  createdAt: z.string(),
});
export type OpenBotFile = z.infer<typeof openBotFileSchema>;

/** GET /api/mobile/openmuse-files page (owner's files, newest first). */
export const openBotFilesSchema = z.object({
  files: z.array(openBotFileSchema),
  nextCursor: z.string().nullable(),
});
export type OpenBotFiles = z.infer<typeof openBotFilesSchema>;
