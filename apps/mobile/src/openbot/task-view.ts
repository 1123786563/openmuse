import type { OpenBotTask, TaskStatus, TaskStepStatus } from "./types";

/**
 * Pure view-model seam for the Task detail screen (T03): normalization only —
 * steps/evidence sorted by stable id, status chip labels, evidence summaries
 * and error extraction. No react-native imports, so node:test covers it
 * directly, and equal payloads always normalize to equal view models.
 */

export const stepStatusLabels: Record<TaskStepStatus, string> = {
  pending: "待执行",
  running: "进行中",
  succeeded: "已完成",
  failed: "失败",
  waiting: "等待中",
};

export const taskStatusLabels: Record<TaskStatus, string> = {
  queued: "排队中",
  running: "进行中",
  waiting_approval: "等待批准",
  waiting_input: "等待输入",
  scheduled: "已排期",
  paused: "已暂停",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

const evidenceKindLabels: Record<string, string> = {
  mail: "邮件",
  file: "文件",
  web: "网页",
  user: "用户",
};

const UNKNOWN_KIND_LABEL = "未知类型";
const EMPTY_SUMMARY = "（无摘要）";
const EMPTY_STEPS_LABEL = "这个任务还没有步骤";

/** Plain ascending compare; stable ids are opaque strings, never locale-sensitive. */
const byId = (a: { id: string }, b: { id: string }) => {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
};

function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

function payloadText(
  payload: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = payload?.[key];
  return typeof value === "string" && value ? value : undefined;
}

/** §7 payload → one-line summary; mail prefers subject then sender, web url then title. */
function evidenceSummary(kind: string, payload: Record<string, unknown> | undefined): string {
  switch (kind) {
    case "mail":
      return clip(
        payloadText(payload, "subject") ?? payloadText(payload, "from") ?? EMPTY_SUMMARY,
        120,
      );
    case "file":
      return clip(payloadText(payload, "name") ?? EMPTY_SUMMARY, 120);
    case "web":
      return clip(
        payloadText(payload, "url") ?? payloadText(payload, "title") ?? EMPTY_SUMMARY,
        120,
      );
    case "user":
      return clip(payloadText(payload, "text") ?? EMPTY_SUMMARY, 80);
    default:
      return EMPTY_SUMMARY;
  }
}

export interface TaskStepRow {
  id: string;
  status: TaskStepStatus;
  statusLabel: string;
  title?: string;
  /** Failed steps only, clipped to 200 chars; never fabricated from a result. */
  errorText?: string;
}

export interface TaskEvidenceRow {
  id: string;
  kind: string;
  kindLabel: string;
  summary: string;
}

export interface TaskDetailView {
  taskId: string;
  kind: string;
  status: TaskStatus;
  statusLabel: string;
  steps: TaskStepRow[];
  evidence: TaskEvidenceRow[];
  artifactIds: string[];
  isEmpty: boolean;
  emptyLabel: string;
}

export function normalizeTaskDetail(task: OpenBotTask): TaskDetailView {
  const steps = [...task.steps].sort(byId).map((step) => ({
    id: step.id,
    status: step.status,
    statusLabel: stepStatusLabels[step.status],
    title: step.title,
    errorText: step.error ? clip(step.error, 200) : undefined,
  }));
  const evidence = [...task.evidence].sort(byId).map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    kindLabel: evidenceKindLabels[entry.kind] ?? UNKNOWN_KIND_LABEL,
    summary: evidenceSummary(entry.kind, entry.payload),
  }));
  return {
    taskId: task.id,
    kind: task.kind,
    status: task.status,
    statusLabel: taskStatusLabels[task.status],
    steps,
    evidence,
    artifactIds: [...task.artifactIds],
    isEmpty: steps.length === 0,
    emptyLabel: EMPTY_STEPS_LABEL,
  };
}
