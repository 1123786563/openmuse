/**
 * Pure tool-event card registry for the chat screen (C06). Every event class
 * in contract §3's tool-event fixture list maps to a readable card or a
 * neutral fallback — an error is never shown as success, and an unknown event
 * never fabricates one. No React and no SDK imports: testable under node:test,
 * and the screen stays a thin adapter over this seam.
 *
 * Payload shapes are name-keyed stand-ins until the owning tickets (R/K/M/A)
 * pin their DTOs; renderSummary reads fields defensively and falls back to a
 * safe truncated string instead of echoing raw payloads.
 */

/** The run's outcome for one tool event, as the runtime reports it. */
export type ToolEventStatus = "start" | "result" | "error";

/** One §3 tool event: a named tool plus its outcome and JSON-ish payload. */
export type ToolEvent = {
  name: string;
  status?: ToolEventStatus;
  payload?: unknown;
};

/** Card kinds: one per §3 fixture class (text delta excluded — null, not a card). */
export type ToolCardKind =
  | "tool_start"
  | "tool_result"
  | "tool_error"
  | "reviewed_action"
  | "policy_approval"
  | "computer_screenshot"
  | "browser_navigation"
  | "mail_thread"
  | "calendar_event"
  | "file_artifact"
  | "unknown";

/** Neutral is the honest default: no outcome is claimed the event did not report. */
export type ToolCardStatus = "neutral" | "ok" | "error";

/** The card model the chat screen renders: zh-CN title, safe summary, status. */
export type ToolCard = {
  kind: ToolCardKind;
  title: string;
  summary: string;
  status: ToolCardStatus;
};

/** zh-CN card copy, module-internal like every other OpenBot surface. */
const TITLES: Record<ToolCardKind, string> = {
  tool_start: "工具调用",
  tool_result: "工具结果",
  tool_error: "工具执行失败",
  reviewed_action: "已审核操作",
  policy_approval: "Policy 审批",
  computer_screenshot: "计算机截图",
  browser_navigation: "浏览器导航",
  mail_thread: "邮件会话",
  calendar_event: "日历事件",
  file_artifact: "文件产物",
  unknown: "未知事件",
};

/** Registry key → named kind; keys are §3 fixture names, normalized on lookup. */
const NAMED_KINDS: Record<string, ToolCardKind> = {
  toolstart: "tool_start",
  toolresult: "tool_result",
  toolerror: "tool_error",
  reviewedaction: "reviewed_action",
  policyapproval: "policy_approval",
  computerscreenshot: "computer_screenshot",
  browsernavigation: "browser_navigation",
  mailthread: "mail_thread",
  calendarevent: "calendar_event",
  fileartifact: "file_artifact",
};

/** Reported outcome → generic kind for unmapped names; "none" → unknown. */
const KIND_BY_STATUS: Record<ToolEventStatus | "none", ToolCardKind> = {
  start: "tool_start",
  result: "tool_result",
  error: "tool_error",
  none: "unknown",
};

/** Reported outcome → card status; an event without one reads as a result. */
const STATUS_BY_OUTCOME: Record<ToolEventStatus, ToolCardStatus> = {
  start: "neutral",
  result: "ok",
  error: "error",
};

/** Registry lookup key: case/separator-insensitive so naming variants coalesce. */
const normalizeName = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Summary budget from the plan: ≤120 chars, ellipsis beyond. */
const SUMMARY_MAX = 120;

/** Truncate a string to the budget, marking the cut with an ellipsis. */
const safeTruncate = (text: string): string =>
  text.length <= SUMMARY_MAX ? text : `${text.slice(0, SUMMARY_MAX)}…`;

/**
 * Stringify any payload value safely: objects/arrays as JSON, strings as-is,
 * anything JSON.stringify rejects (circular…) via String(). Never throws.
 */
const safeStringify = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

/** Read a payload as a record, parsing a JSON string payload when possible. */
const asRecord = (payload: unknown): Record<string, unknown> | null => {
  let value = payload;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
};

/** First present string field among the keys, stringified safely if non-string. */
const field = (payload: unknown, ...keys: string[]): string => {
  const record = asRecord(payload);
  if (!record) return "";
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) {
      return safeTruncate(safeStringify(record[key]));
    }
  }
  return "";
};

/** host+path of a URL, query and hash dropped; malformed URLs fall back safely. */
const urlHostPath = (url: string): string => {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.host}${path}`;
  } catch {
    return safeTruncate(url);
  }
};

/**
 * Extract a safe ≤120-char summary for a known kind. Field names are the
 * stand-in payload contract; unknown shapes degrade to a safe truncated
 * string instead of echoing the raw payload.
 */
export function renderSummary(kind: ToolCardKind, payload: unknown): string {
  switch (kind) {
    case "browser_navigation": {
      const url = field(payload, "url", "href");
      return url ? urlHostPath(url) : "";
    }
    case "mail_thread":
      return field(payload, "subject");
    case "calendar_event": {
      const title = field(payload, "title", "summary");
      const time = field(payload, "start", "time", "when");
      if (title && time) return safeTruncate(`${title} · ${time}`);
      return title || time;
    }
    case "file_artifact":
      return field(payload, "name", "fileName");
    case "computer_screenshot":
      // A completed capture's claim; classifyToolEvent keeps an in-flight
      // start card from reaching here (no outcome claimed before it reports).
      return "已获取屏幕截图";
    case "reviewed_action":
    case "policy_approval":
      return field(payload, "type", "kind");
    case "tool_start":
      return "";
    case "tool_result":
    case "tool_error":
    case "unknown":
      return safeTruncate(safeStringify(payload));
  }
}

/**
 * Classify one §3 tool event into its card. Text deltas are NOT cards (null —
 * the text stream owns them); a tool error is never a success; an unknown
 * name/shape is a neutral fallback whose summary never echoes the payload
 * beyond a safe truncated string.
 */
export function classifyToolEvent(event: ToolEvent): ToolCard | null {
  const key = normalizeName(event.name);
  if (key === "textdelta" || key === "textmessagecontent") return null; // text stream owns it

  const named = NAMED_KINDS[key];
  // Unmapped name: the reported outcome alone decides the generic class; no
  // name and no known outcome → unknown (never a fabricated tool result).
  const kind: ToolCardKind = named ?? KIND_BY_STATUS[event.status ?? "none"];

  if (kind === "unknown") {
    // Neutral copy with the event's own name as the only identifying text.
    return { kind, title: TITLES.unknown, summary: safeTruncate(event.name), status: "neutral" };
  }

  const status: ToolCardStatus = STATUS_BY_OUTCOME[event.status ?? "result"];

  // A failed card never shows a success-shaped summary (e.g. 「已获取屏幕截图」):
  // the payload's own detail is the honest summary for error outcomes.
  const payloadDetail = safeTruncate(safeStringify(event.payload));
  let summary: string;
  if (kind === "tool_start") summary = safeTruncate(event.name);
  else if (event.status === "error") summary = payloadDetail || safeTruncate(event.name);
  // An in-flight call has no outcome to claim yet: the screenshot's fixed
  // 「已获取屏幕截图」 copy asserts a captured picture, so its start card shows
  // the call's own name instead. Argument-derived summaries (a URL, a mail
  // subject) describe the call, not an outcome, and stay.
  else if (event.status === "start" && kind === "computer_screenshot")
    summary = safeTruncate(event.name);
  else summary = renderSummary(kind, event.payload) || payloadDetail;

  return { kind, title: TITLES[kind], summary, status };
}

/** The AG-UI message subset the card rows read (assistant toolCalls + tool results). */
export type ToolMessageLike = {
  id: string;
  role: string;
  /** Tool results are strings; user multimodal content is unknown — read defensively. */
  content?: unknown;
  toolCallId?: string;
  error?: string;
  toolCalls?: {
    id: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }[];
};

/** One rendered card row; `id` is a stable runtime message (or call) id. */
export type ToolCardRow = { id: string; card: ToolCard };

/**
 * Map a runtime message list to card rows (C06 chat wiring). Resolved calls
 * (role:"tool" messages) render as result/error cards; unresolved assistant
 * toolCalls render as in-flight start cards until their result lands. Plain
 * chat messages are ignored — the transcript owns those.
 */
export function toolCardRows(messages: readonly ToolMessageLike[]): ToolCardRow[] {
  // First pass: toolCallId → tool name from any assistant message's calls,
  // and which calls already resolved (their tool message exists).
  const names = new Map<string, string>();
  const resolved = new Set<string>();
  for (const message of messages) {
    for (const call of message.toolCalls ?? []) {
      if (call?.id && call.function?.name) names.set(call.id, call.function.name);
    }
    if (message.role === "tool" && message.toolCallId) resolved.add(message.toolCallId);
  }

  const rows: ToolCardRow[] = [];
  for (const message of messages) {
    if (message.role !== "tool" || !message.toolCallId) continue;
    const card = classifyToolEvent({
      name: names.get(message.toolCallId) ?? "",
      status: message.error ? "error" : "result",
      payload: message.content,
    });
    if (card) rows.push({ id: message.id, card });
  }
  // In-flight calls trail the transcript — a start card per unresolved call.
  for (const message of messages) {
    for (const call of message.toolCalls ?? []) {
      if (!call?.id || resolved.has(call.id)) continue;
      const card = classifyToolEvent({
        name: call.function?.name ?? "",
        status: "start",
        payload: call.function?.arguments,
      });
      if (card) rows.push({ id: `${message.id}:${call.id}:start`, card });
    }
  }
  return rows;
}
