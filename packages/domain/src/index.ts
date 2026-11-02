import { z } from "zod";

export type WorkspaceMode = "sample" | "live";
export type Section =
  | "today"
  | "chat"
  | "mail"
  | "calendar"
  | "browser"
  | "files"
  | "activity"
  | "connections"
  | "ideas"
  | "goals"
  | "apps";
export interface Mail {
  id: string;
  threadId: string;
  from: string;
  sender: string;
  to: string[];
  subject: string;
  body: string;
  date: string;
  unread: boolean;
  label: string;
  attachments: string[];
}
export interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  timeZone: string;
  location: string;
  description: string;
  attendees: string[];
}
export const calendarRangeSchema = z
  .object({
    timeMin: z.iso.datetime({ offset: true }),
    timeMax: z.iso.datetime({ offset: true }),
  })
  .refine(({ timeMin, timeMax }) => {
    const duration = Date.parse(timeMax) - Date.parse(timeMin);
    return duration > 0 && duration <= 366 * 86400000;
  }, "Calendar range must end after it starts and span at most 366 days");
export interface Artifact {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  pageCount: number;
  url: string;
  createdAt: string;
  source: string;
  parentId?: string;
  fields?: { name: string; value: string; type: "text" | "checkbox" | "unsupported" }[];
}
export interface BrowserSession {
  id: string;
  title: string;
  url: string;
  status: "idle" | "active" | "closed" | "error";
  updatedAt: string;
  previewUrl?: string;
  consoleUrl?: string;
}
export const emailDraftSchema = z.object({
  to: z.array(z.email()).min(1).max(50),
  cc: z.array(z.email()).max(50).default([]),
  bcc: z.array(z.email()).max(50).default([]),
  subject: z
    .string()
    .trim()
    .min(1)
    .max(998)
    .refine((s) => !/[\r\n]/.test(s), "Subject must be a single line"),
  body: z.string().min(1).max(100000),
  attachmentIds: z.array(z.string()).max(10).default([]),
  threadId: z.string().optional(),
  replyToMessageId: z.string().optional(),
});
export const eventDraftSchema = z
  .object({
    calendarId: z.string().default("primary"),
    title: z.string().trim().min(1).max(500),
    start: z.string().min(1),
    end: z.string().min(1),
    allDay: z.boolean().default(false),
    timeZone: z.string().default("America/Los_Angeles"),
    location: z.string().max(2000).default(""),
    description: z.string().max(10000).default(""),
    attendees: z.array(z.email()).max(50).default([]),
  })
  .superRefine((value, ctx) => {
    if (
      !Number.isFinite(Date.parse(value.start)) ||
      !Number.isFinite(Date.parse(value.end)) ||
      Date.parse(value.end) <= Date.parse(value.start)
    ) {
      ctx.addIssue({ code: "custom", message: "End must be after a valid start", path: ["end"] });
    }
    const dateOnly = z.iso.date();
    const timed = /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/;
    // Validate the calendar date separately so timed values can retain minute precision.
    const validTimestamp = (timestamp: string) =>
      value.allDay
        ? dateOnly.safeParse(timestamp).success
        : timed.test(timestamp) && dateOnly.safeParse(timestamp.slice(0, 10)).success;
    if (!validTimestamp(value.start) || !validTimestamp(value.end)) {
      ctx.addIssue({
        code: "custom",
        message: value.allDay
          ? "All-day events need valid date-only values"
          : "Timed events need valid date-times with an explicit offset",
        path: ["start"],
      });
    }
    try {
      new Intl.DateTimeFormat("en", { timeZone: value.timeZone });
    } catch {
      ctx.addIssue({ code: "custom", message: "Invalid time zone", path: ["timeZone"] });
    }
  });
export const proposalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("email.send"), data: emailDraftSchema }),
  z.object({ kind: z.literal("calendar.create"), data: eventDraftSchema }),
  z.object({
    kind: z.literal("calendar.update"),
    data: eventDraftSchema.and(z.object({ eventId: z.string().min(1) })),
  }),
  z.object({
    kind: z.literal("calendar.delete"),
    data: z.object({ calendarId: z.string(), eventId: z.string().min(1), title: z.string() }),
  }),
]);
export type EmailDraft = z.infer<typeof emailDraftSchema>;
export type EventDraft = z.infer<typeof eventDraftSchema>;
export type ProposalInput = z.infer<typeof proposalSchema>;
export interface ActionProposal {
  target?: CalendarEvent;
  targetVersion?: string;
  taskId?: string;
  account?: string;
  connectionId?: string;
  id: string;
  title: string;
  kind: ProposalInput["kind"];
  data: Record<string, unknown>;
  status:
    | "awaiting_review"
    | "executing"
    | "succeeded"
    | "failed"
    | "outcome_unknown"
    | "denied"
    | "cancelled"
    | "expired";
  hash: string;
  createdAt: string;
  expiresAt: string;
  result?: string;
  error?: string;
}
export interface ActivityEntry {
  id: string;
  title: string;
  detail: string;
  date: string;
  status: string;
  actionId?: string;
}
export interface Connection {
  id: string;
  name: string;
  status: "connected" | "disconnected" | "sample" | "unconfigured" | "unavailable";
  account?: string;
  capabilities: string[];
}
export interface Workspace {
  mode: WorkspaceMode;
  profile: { name: string; email: string };
  mail: Mail[];
  events: CalendarEvent[];
  files: Artifact[];
  browsers: BrowserSession[];
  actions: ActionProposal[];
  activity: ActivityEntry[];
  connections: Connection[];
  runtime: {
    provider: "sample" | "model" | "openbot";
    configured: boolean;
    openbotConfigured: boolean;
    richThreads?: boolean;
  };
}

/**
 * T07.05 (#595): the runtime half of the ORIGINAL Workspace contract as a
 * zod schema, so the enterprise BFF's /api/workspace answers are provable
 * against the same contract the app consumes. parseWorkspace(body) checks the
 * full Workspace shape; the OpenBot /api/mobile/workspace response is a
 * different contract and must never parse with it.
 */
export const workspaceRuntimeSchema = z.object({
  provider: z.enum(["sample", "model", "openbot"]),
  configured: z.boolean(),
  openbotConfigured: z.boolean(),
  richThreads: z.boolean().optional(),
});
const mailSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  from: z.string(),
  sender: z.string(),
  to: z.array(z.string()),
  subject: z.string(),
  body: z.string(),
  date: z.string(),
  unread: z.boolean(),
  label: z.string(),
  attachments: z.array(z.string()),
});
const calendarEventSchema = z.object({
  id: z.string(),
  calendarId: z.string(),
  title: z.string(),
  start: z.string(),
  end: z.string(),
  allDay: z.boolean(),
  timeZone: z.string(),
  location: z.string(),
  description: z.string(),
  attendees: z.array(z.string()),
});
const artifactSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  size: z.number(),
  pageCount: z.number(),
  url: z.string(),
  createdAt: z.string(),
  source: z.string(),
  parentId: z.string().optional(),
  fields: z
    .array(
      z.object({
        name: z.string(),
        value: z.string(),
        type: z.enum(["text", "checkbox", "unsupported"]),
      }),
    )
    .optional(),
});
const browserSessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  status: z.enum(["idle", "active", "closed", "error"]),
  updatedAt: z.string(),
  previewUrl: z.string().optional(),
  consoleUrl: z.string().optional(),
});
const actionProposalSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(["email.send", "calendar.create", "calendar.update", "calendar.delete"]),
  data: z.record(z.string(), z.unknown()),
  status: z.enum([
    "awaiting_review",
    "executing",
    "succeeded",
    "failed",
    "outcome_unknown",
    "denied",
    "cancelled",
    "expired",
  ]),
  hash: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  target: calendarEventSchema.optional(),
  targetVersion: z.string().optional(),
  taskId: z.string().optional(),
  account: z.string().optional(),
  connectionId: z.string().optional(),
  result: z.string().optional(),
  error: z.string().optional(),
});
const activityEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string(),
  date: z.string(),
  status: z.string(),
  actionId: z.string().optional(),
});
const connectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["connected", "disconnected", "sample", "unconfigured", "unavailable"]),
  account: z.string().optional(),
  capabilities: z.array(z.string()),
});
export const workspaceSchema = z.object({
  mode: z.enum(["sample", "live"]),
  profile: z.object({ name: z.string(), email: z.string() }),
  mail: z.array(mailSchema),
  events: z.array(calendarEventSchema),
  files: z.array(artifactSchema),
  browsers: z.array(browserSessionSchema),
  actions: z.array(actionProposalSchema),
  activity: z.array(activityEntrySchema),
  connections: z.array(connectionSchema),
  runtime: workspaceRuntimeSchema,
});

/** Provider-independent boundary: OpenBot/AG-UI runs never dictate presentation. */
export interface ExecutionBackend {
  readonly kind: "standalone" | "openbot";
  readonly capabilities: readonly string[];
  health(): Promise<{ available: boolean; detail: string }>;
}

export type { ComputerCommand, ComputerDirectory, ComputerSnapshot } from "./computer.ts";
