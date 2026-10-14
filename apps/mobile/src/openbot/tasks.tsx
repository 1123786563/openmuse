import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, colors, Mascot, s } from "../ui";
import { fetchTaskDetail, fetchTasks } from "./api";
import { OpenBotError } from "./errors";
import { normalizeTaskDetail, taskStatusLabels } from "./task-view";
import type { OpenBotTask, TaskStatus, TaskStepStatus } from "./types";

/** zh-CN user copy, module-internal like every other OpenBot screen. */
const COPY = {
  title: "任务",
  close: "返回对话",
  refresh: "刷新",
  retry: "重试",
  loading: "正在加载任务…",
  errorTitle: "任务没有加载出来",
  emptyList: "还没有任务",
  backToList: "返回任务列表",
  steps: "步骤",
  evidence: "证据",
  artifacts: "产物",
  none: "还没有内容",
} as const;

const chipBase = {
  fontSize: 11,
  lineHeight: 16,
  fontWeight: "600" as const,
  paddingHorizontal: 8,
  paddingVertical: 2,
  borderRadius: 9,
  overflow: "hidden" as const,
};

const stepChip: Record<TaskStepStatus, { backgroundColor: string; color: string }> = {
  pending: { backgroundColor: colors.line, color: colors.muted },
  running: { backgroundColor: colors.sky, color: colors.blueDark },
  succeeded: { backgroundColor: colors.green, color: colors.text },
  failed: { backgroundColor: colors.orange, color: colors.danger },
  waiting: { backgroundColor: colors.lavender, color: colors.text },
};

const taskChip: Record<TaskStatus, { backgroundColor: string; color: string }> = {
  queued: stepChip.pending,
  running: stepChip.running,
  waiting_approval: stepChip.waiting,
  waiting_input: stepChip.waiting,
  scheduled: stepChip.running,
  paused: stepChip.pending,
  succeeded: stepChip.succeeded,
  failed: stepChip.failed,
  cancelled: stepChip.pending,
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    marginVertical: 6,
  },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 4,
  },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  loadingRow: { flexDirection: "row", gap: 10, alignItems: "center", padding: 8 },
});

/** ISO → local stamp (agent-ui.tsx stamp() convention); an unparsable server
 * string surfaces verbatim, never a rendered "Invalid Date". */
function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

/**
 * The owner's OpenMuse Tasks (T03): a list that opens one Task's detail —
 * steps by stable id with status chips, typed evidence rows, artifact ids —
 * plus a refresh button standing in for pull-to-refresh. Reload always
 * replaces state, so re-fetching can never duplicate a row.
 */
export function OpenBotTasksScreen({ onClose }: { onClose: () => void }) {
  const [tasks, setTasks] = useState<OpenBotTask[] | null>(null);
  const [detail, setDetail] = useState<OpenBotTask | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Which task's detail request the error block belongs to — its retry
   * re-opens that detail instead of only refreshing the list. */
  const [failedDetailId, setFailedDetailId] = useState<string | null>(null);
  /** Monotonic load/detail sequence: a late answer for a superseded action lands nowhere. */
  const openSeq = useRef(0);

  // List refresh only — the detail is open()'s own on-demand fetch. Keying
  // load on `detail` re-ran the whole list (and the detail again) on every
  // open/back, interleaving requests that could resurrect a closed detail.
  const load = useCallback(async () => {
    const seq = ++openSeq.current; // refresh supersedes in-flight detail answers
    setBusy(true);
    setError(null);
    setFailedDetailId(null);
    try {
      setTasks((await fetchTasks()).tasks);
    } catch (e) {
      if (seq === openSeq.current) setError(e instanceof OpenBotError ? e.message : String(e));
    } finally {
      if (seq === openSeq.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = useCallback(async (id: string) => {
    const seq = ++openSeq.current;
    setBusy(true);
    setError(null);
    setFailedDetailId(null);
    try {
      const task = await fetchTaskDetail(id);
      // A quicker tap on another task (or back to the list) superseded this
      // one: its late answer must not show under the newer selection.
      if (seq !== openSeq.current) return;
      setDetail(task);
    } catch (e) {
      if (seq === openSeq.current) {
        setError(e instanceof OpenBotError ? e.message : String(e));
        setFailedDetailId(id); // retry re-sends this detail, not a list load
      }
    } finally {
      if (seq === openSeq.current) setBusy(false);
    }
  }, []);

  const renderBody = () => {
    if (detail)
      return (
        <TaskDetailBody
          task={detail}
          onBack={() => {
            openSeq.current += 1; // an in-flight detail answer lands nowhere
            setDetail(null);
            // The superseded request's finally is seq-guarded and will skip
            // its reset — back is an operation too, so it releases busy.
            setBusy(false);
          }}
        />
      );
    if (tasks === null)
      return (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.blueDark} />
          <Text style={s.muted}>{COPY.loading}</Text>
        </View>
      );
    if (tasks.length === 0) return <Text style={s.muted}>{COPY.emptyList}</Text>;
    return tasks.map((task) => (
      <Pressable
        key={task.id}
        accessibilityRole="button"
        accessibilityLabel={task.kind}
        onPress={() => void open(task.id)}
        style={({ pressed }) => [styles.card, { opacity: pressed ? 0.7 : 1 }]}
      >
        <View style={s.between}>
          <Text style={s.heading}>{task.kind}</Text>
          <Text style={[chipBase, taskChip[task.status]]}>{taskStatusLabels[task.status]}</Text>
        </View>
        <Text style={s.small}>{task.id}</Text>
      </Pressable>
    ));
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Mascot size={34} />
          <Text style={s.heading}>{detail ? detail.kind : COPY.title}</Text>
        </View>
        <View style={styles.headerActions}>
          <Button small busy={busy} onPress={() => void load()}>
            {COPY.refresh}
          </Button>
          <Button small onPress={onClose}>
            {COPY.close}
          </Button>
        </View>
      </View>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 18, paddingVertical: 12, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        {error && (
          <View style={s.error}>
            <Text style={styles.errorText}>
              {COPY.errorTitle}（{error}）
            </Text>
            <Button small onPress={() => void (failedDetailId ? open(failedDetailId) : load())}>
              {COPY.retry}
            </Button>
          </View>
        )}
        {renderBody()}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Steps by stable id with chips + errors, typed evidence rows, artifact ids. */
function TaskDetailBody({ task, onBack }: { task: OpenBotTask; onBack: () => void }) {
  const view = normalizeTaskDetail(task);
  return (
    <View>
      <Button small style={{ alignSelf: "flex-start", marginBottom: 12 }} onPress={onBack}>
        {COPY.backToList}
      </Button>
      <View style={s.between}>
        <Text style={s.heading}>{view.kind}</Text>
        <Text style={[chipBase, taskChip[view.status]]}>{view.statusLabel}</Text>
      </View>
      <Text style={[s.small, { marginBottom: 8 }]}>
        {view.taskId} · {formatUpdatedAt(task.updatedAt)}
      </Text>
      <Text style={[s.label, { marginTop: 18 }]}>{COPY.steps}</Text>
      {view.isEmpty ? (
        <Text style={s.muted}>{view.emptyLabel}</Text>
      ) : (
        view.steps.map((step) => (
          <View key={step.id} style={[styles.card, { flexDirection: "row", gap: 10 }]}>
            <Text style={[chipBase, stepChip[step.status]]}>{step.statusLabel}</Text>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.text}>{step.title ?? step.id}</Text>
              {step.errorText ? <Text style={styles.errorText}>{step.errorText}</Text> : null}
            </View>
          </View>
        ))
      )}
      <Text style={[s.label, { marginTop: 18 }]}>{COPY.evidence}</Text>
      {view.evidence.length === 0 ? (
        <Text style={s.muted}>{COPY.none}</Text>
      ) : (
        view.evidence.map((row) => (
          <View key={row.id} style={styles.card}>
            <Text style={s.small}>{row.kindLabel}</Text>
            <Text style={s.text}>{row.summary}</Text>
          </View>
        ))
      )}
      <Text style={[s.label, { marginTop: 18 }]}>{COPY.artifacts}</Text>
      {view.artifactIds.length === 0 ? (
        <Text style={s.muted}>{COPY.none}</Text>
      ) : (
        view.artifactIds.map((id) => (
          <Text key={id} style={s.small}>
            {id}
          </Text>
        ))
      )}
    </View>
  );
}
