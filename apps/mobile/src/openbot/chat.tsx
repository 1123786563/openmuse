import { UseAgentUpdate, useAgent, useCopilotKit } from "@copilotkit/react-native/headless";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, colors, Mascot, s } from "../ui";
import { dedupeById, nextUserMessage, runtimeAgentFor, toTranscript } from "./chat-state";
import { SignOutButton } from "./email-signin";
import {
  initialStopFlow,
  stopButtonState,
  stopFlowReducer,
  type TerminalOutcome,
} from "./stop-state";
import {
  interruptionVisible,
  resumeStrategy,
  type StreamEvent,
  THREAD_RUN_SCOPE,
} from "./stream-resume";
import { toolCardRows } from "./tool-cards";
import type { OpenBotSession } from "./types";

/** zh-CN user copy, module-internal like every other OpenBot screen. */
const COPY = {
  title: "专属对话",
  placeholder: "给 Bot 发消息…",
  send: "发送",
  restoring: "正在恢复会话记录…",
  streaming: "Bot 正在回复…",
  /** Terminal chips: the run landed exactly one of these (C04), never both. */
  stopped: "已停止",
  completed: "已完成",
  /** Interruption chip: this view was rebuilt from the persisted Thread (C05). */
  interrupted: "已中断恢复",
  errorTitle: "这条消息没有发出去",
  stopFailed: "没有停止这次回复，请再试一次。",
  restoreFailed: "会话记录没有恢复出来。",
  retry: "重试",
} as const;

const styles = StyleSheet.create({
  bubbleUser: {
    alignSelf: "flex-end",
    backgroundColor: colors.blue,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginVertical: 4,
    maxWidth: "82%",
  },
  bubbleBot: {
    alignSelf: "flex-start",
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginVertical: 4,
    maxWidth: "82%",
    borderWidth: 1,
    borderColor: colors.line,
  },
  bubbleText: { fontSize: 15, lineHeight: 22, color: colors.text },
  /** C06 compact tool-event card: title + summary row, minimal presentation. */
  toolCard: {
    alignSelf: "flex-start",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginVertical: 4,
    maxWidth: "82%",
    gap: 2,
  },
  toolCardTitle: { fontSize: 12, fontWeight: "600", color: colors.text },
});

/** Local user-row ids; the runtime assigns its own on the stored Thread. */
let localSeq = 0;
const nextLocalId = () => `local-${Date.now()}-${localSeq++}`;

/**
 * One rendered row as a §3 event. Scoped to the thread, not the live run:
 * persisted message ids are stable across replay (Task 0), while the run
 * status may have reset by the time a replay lands.
 */
const rowEvent = (threadId: string, eventId: string): StreamEvent => ({
  threadId,
  runId: THREAD_RUN_SCOPE,
  eventId,
});

/**
 * One Channel conversation with the workspace's private Bot (C01). Mirrors the
 * OpenBot web ChannelChat minimally: a channel-scoped local agent routing to
 * the session's runtime Bot on the persisted thread, connect on mount to
 * restore history, addMessage + runAgent to send one turn.
 */
export function OpenBotChatScreen({
  session,
  title,
  onSignOut,
}: {
  session: OpenBotSession;
  /** The channel's name when the shell has switched onto one (C02); default copy otherwise. */
  title?: string;
  onSignOut: () => void;
}) {
  const { agent, isReady } = useAgent({
    ...runtimeAgentFor(session),
    updates: [UseAgentUpdate.OnMessagesChanged, UseAgentUpdate.OnRunStatusChanged],
  });
  const { copilotkit } = useCopilotKit();
  const [draft, setDraft] = useState("");
  /** Full display sentence (title + detail composed at the set site). */
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);
  /** The history restore failed: retryable, and send stays blocked meanwhile. */
  const [restoreFailed, setRestoreFailed] = useState(false);
  /** Bumped by the retry button to re-run the connect effect. */
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  /** Stop-button request flow (C04): pending, request count, terminal chip. */
  const [stopFlow, setStopFlow] = useState(initialStopFlow);
  /** Interruption chip: the reloaded-history path was taken on a reconnect (C05). */
  const [interrupted, setInterrupted] = useState(false);
  /** Set while a turn we started is awaited, so replayed history errors are not ours. */
  const awaitingReply = useRef(false);
  /**
   * Mirrors stopFlow.outcome for the late stopAgent rejection check: state
   * updates are async, and the rejection can land after the render that
   * already shows the terminal chip.
   */
  const stopOutcome = useRef<TerminalOutcome | null>(null);
  /**
   * The run ended (terminal outcome or run error) without a stop left to
   * retry: a late stopAgent rejection after a run ERROR must not overwrite
   * the more informative run error with "stop failed" copy — the run is over,
   * there is nothing left to stop, exactly as for a terminal outcome.
   */
  const runEnded = useRef(false);
  /**
   * Sync gate on the stop request: the reducer's pending guard lives in
   * state, so it only becomes visible after a re-render — a same-frame
   * double tap reads the pre-click flow and would fire a second stopAgent.
   * The ref is synchronous with the first tap, like awaitingReply for send.
   */
  const stopPendingRef = useRef(false);
  const lastSent = useRef("");
  const list = useRef<ScrollView>(null);
  // Streaming appends grow content without changing the row count, so the
  // follow rides onContentSizeChange; onScroll decides whether the person is
  // still at the bottom (within 100px), so reading history is never yanked.
  const followLatest = useRef(true);
  /** Latest messages snapshot, for the post-connect resume decision (C05). */
  const messagesRef = useRef(agent.messages);

  // Join the runtime thread and restore its persisted history — exactly the
  // prior art's mount block (connectAgent returns once the thread is idle, so
  // a reload during a reply waits that reply out instead of racing it).
  useEffect(() => {
    if (!isReady) return;
    let active = true;
    // C05: an effect re-run with rendered events is a same-instance reconnect.
    // The gateway replays past this cursor on the same thread (Task 0), so the
    // re-attach decides how that replay is absorbed: anchored → the overlap
    // dedupes away below; unanchored → re-base on the reloaded Thread + chip.
    // The cursor must live in the MESSAGE-id space: in-flight tool start cards
    // carry synthetic ids (`<message>:<call>:start`) that never appear in the
    // offered window, and a cursor resting on one always misjudges a
    // mid-tool reconnect as reload-history (false 已中断恢复 + needless reset).
    const cursor = messagesRef.current.at(-1)?.id ?? null;
    setRestoring(true);
    setRestoreFailed(false);
    copilotkit
      .connectAgent({ agent })
      .then(() => {
        if (!active || cursor === null) return; // fresh mount or unmounted
        const offered = messagesRef.current.map((message) =>
          rowEvent(session.threadId, message.id),
        );
        if (interruptionVisible(resumeStrategy(cursor, offered))) {
          setInterrupted(true);
        }
      })
      .catch(() => {
        // An empty transcript is a failed restore, not a silent success: the
        // person gets a retry entry and sending stays blocked until it lands.
        if (active) setRestoreFailed(true);
      })
      .finally(() => {
        if (active) setRestoring(false);
      });
    return () => {
      active = false;
    };
  }, [agent, copilotkit, isReady, session.threadId, restoreAttempt]);

  // A resolved run is not a successful one: failed turns land here, not in the
  // runAgent await. Gated on awaitingReply because replaying history re-emits
  // past RUN_ERROR events that belong to nobody on this screen.
  useEffect(() => {
    if (!isReady) return;
    const fail = (message?: string) => {
      if (!awaitingReply.current) return;
      awaitingReply.current = false;
      // The run died: a late stopAgent rejection is as much a no-op as a
      // terminal outcome would be — it must not replace this error with the
      // (less informative) stop-failed copy.
      runEnded.current = true;
      const detail = message?.trim();
      setError(detail ? `${COPY.errorTitle}（${detail}）` : COPY.errorTitle);
      // The run died without a terminal outcome: release a pending stop so the
      // next turn starts from a clean flow (no chip — the error UI owns this one).
      setStopFlow((prev) => (prev.pending ? { ...prev, pending: false } : prev));
    };
    const subscription = agent.subscribe({
      onRunErrorEvent: ({ event }) => fail(event?.message),
      onRunFailed: ({ error }) => fail(error?.message),
      onRunFinishedEvent: ({ event }) => {
        if (!awaitingReply.current) return; // replayed history is not this turn
        awaitingReply.current = false;
        // The interrupt outcome is the stopped run; anything else completed. The
        // reducer keeps the FIRST terminal outcome, so a late second one collapses.
        const outcome = event?.outcome?.type === "interrupt" ? "stopped" : "completed";
        stopOutcome.current = outcome;
        setStopFlow((prev) => stopFlowReducer(prev, { type: "terminal", outcome }));
      },
    });
    return () => subscription.unsubscribe();
  }, [agent, isReady]);

  const rows = useMemo(() => {
    const messages = dedupeById(agent.messages);
    let lastAssistant = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        lastAssistant = i;
        break;
      }
    }
    return toTranscript(
      messages.map((message, index) => ({
        id: message.id,
        role: message.role,
        content: typeof message.content === "string" ? message.content : undefined,
        // The runtime has no streaming field in this SDK version; the trailing
        // assistant row is mid-stream exactly while a run is in flight.
        isStreaming: index === lastAssistant && agent.isRunning,
      })),
    );
  }, [agent.messages, agent.isRunning]);

  // C06: tool events render through the card registry — resolved calls as
  // result/error cards, unresolved ones as in-flight start cards — as compact
  // rows below the text stream; the transcript above stays untouched.
  const toolRows = useMemo(() => dedupeById(toolCardRows(agent.messages)), [agent.messages]);

  // C05: keep the latest messages snapshot for the resume decision above.
  // Render dedupe itself is enforced where the transcript is CONSTRUCTED —
  // dedupeById collapses any replayed same-id row the SDK appended — and the
  // resume decision reads messagesRef + resumeStrategy, so no component-level
  // render bookkeeping is needed alongside them (the pure §3 render-set lives
  // in stream-resume.ts for its own tests).
  useEffect(() => {
    messagesRef.current = agent.messages;
  }, [agent.messages]);

  const send = useCallback(() => {
    const text = nextUserMessage(draft);
    // A failed restore leaves the agent history-less: sending now would fork
    // the persisted thread, so the retry entry is the way forward. A restore
    // still in flight is the same fork waiting to happen — the persisted
    // history it is about to load would overwrite this turn.
    // awaitingReply closes the same-frame double-fire window the render
    // closure cannot: a rapid double tap on send lands twice before a
    // re-render has flipped agent.isRunning, but the ref is synchronous with
    // the first send.
    if (!text || awaitingReply.current || agent.isRunning || restoring || restoreFailed) return;
    lastSent.current = text;
    setDraft("");
    setError(null);
    awaitingReply.current = true;
    runEnded.current = false;
    setStopFlow(initialStopFlow()); // new run: the old terminal chip is gone
    stopOutcome.current = null; // and its terminal outcome with it
    setInterrupted(false); // and the interruption notice with it
    const localId = nextLocalId();
    agent.addMessage({ id: localId, role: "user", content: text });
    void copilotkit.runAgent({ agent }).catch((e: unknown) => {
      // runAgent throwing is one failure mode; the subscription covers the rest.
      if (awaitingReply.current) {
        awaitingReply.current = false;
        runEnded.current = true; // nothing left to stop; late stop rejections are no-ops
        // The turn never started, so the local echo never left the client:
        // roll it back so a retry does not double the line on the persisted
        // thread (the prior art's thread-locked branch rolls back the same way).
        agent.setMessages(agent.messages.filter((message) => message.id !== localId));
        const detail = e instanceof Error ? e.message : String(e);
        setError(`${COPY.errorTitle}（${detail}）`);
      }
    });
  }, [agent, copilotkit, draft, restoreFailed, restoring]);

  // Stop the in-flight run via the SDK's stopAgent seam (@copilotkit/core
  // index.d.mts:2323 — the same runtime that serves runAgent/connectAgent).
  // The reducer refuses a repeat click while a request is pending or after the
  // run ended, so this fires at most one stopAgent per run — the ref makes the
  // pending refusal synchronous, closing the pre-render window.
  const stop = useCallback(() => {
    if (stopPendingRef.current) return; // same-frame double tap: one request
    const next = stopFlowReducer(stopFlow, { type: "stop_clicked" });
    if (next === stopFlow) return; // pending or terminal: idempotent no-op
    stopPendingRef.current = true;
    setStopFlow(next);
    void Promise.resolve(copilotkit.stopAgent({ agent }))
      .catch(() => {
        // The reducer refuses a second click while pending and nothing rolls it
        // back on its own: release the button and surface the failure so the
        // person can try again (the run's own terminal event still lands).
        // A rejection arriving AFTER the run's terminal event (a slow/failed
        // stop request outraced by RUN_FINISHED or the run itself errored out)
        // is not a failure: the run is over, there is nothing left to stop and
        // no retry to bait.
        if (stopOutcome.current || runEnded.current) return;
        setStopFlow((prev) => (prev.pending ? { ...prev, pending: false } : prev));
        setError(COPY.stopFailed);
      })
      .finally(() => {
        stopPendingRef.current = false;
      });
  }, [agent, copilotkit, stopFlow]);
  const stopButton = stopButtonState(agent.isRunning, stopFlow.pending);

  const retry = useCallback(() => {
    setError(null);
    // Words back in the box rather than a silent resend: the person sees and
    // owns the retry.
    setDraft(lastSent.current);
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 18,
          paddingTop: 8,
          paddingBottom: 4,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Mascot size={34} />
          <Text style={s.heading}>{title ?? COPY.title}</Text>
        </View>
        <SignOutButton onSignedOut={onSignOut} />
      </View>
      <ScrollView
        ref={list}
        contentContainerStyle={{ paddingHorizontal: 18, paddingVertical: 12, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={100}
        onScroll={({ nativeEvent: { contentOffset, contentSize, layoutMeasurement } }) => {
          followLatest.current =
            contentSize.height - contentOffset.y - layoutMeasurement.height < 100;
        }}
        onContentSizeChange={() => {
          if (followLatest.current) list.current?.scrollToEnd({ animated: false });
        }}
      >
        {rows.map((row) => (
          <View key={row.id} style={row.role === "user" ? styles.bubbleUser : styles.bubbleBot}>
            <Text style={styles.bubbleText}>
              {row.text}
              {row.streaming ? " ▍" : ""}
            </Text>
          </View>
        ))}
        {/* C06: compact tool-event cards below the text stream (registry-rendered). */}
        {toolRows.map((row) => (
          <View key={row.id} style={styles.toolCard}>
            <Text
              style={[
                styles.toolCardTitle,
                row.card.status === "error" && { color: colors.danger },
              ]}
            >
              {row.card.title}
            </Text>
            {row.card.summary ? (
              <Text style={[s.muted, { fontSize: 13 }]} numberOfLines={2}>
                {row.card.summary}
              </Text>
            ) : null}
          </View>
        ))}
        {restoring && (
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center", padding: 8 }}>
            <ActivityIndicator size="small" color={colors.blueDark} />
            <Text style={s.muted}>{COPY.restoring}</Text>
          </View>
        )}
        {!restoring && restoreFailed && (
          <View style={s.error}>
            <Text style={{ color: colors.danger, fontSize: 13 }}>{COPY.restoreFailed}</Text>
            <Button small onPress={() => setRestoreAttempt((attempt) => attempt + 1)}>
              {COPY.retry}
            </Button>
          </View>
        )}
        {!restoring && agent.isRunning && rows.every((row) => !row.streaming) && (
          <Text style={[s.muted, { padding: 8 }]}>{COPY.streaming}</Text>
        )}
        {/* Terminal chip: exactly one of stopped/completed, gone on the next send. */}
        {!restoring && !agent.isRunning && stopFlow.outcome && (
          <Text style={[s.muted, { padding: 8 }]}>
            {stopFlow.outcome === "stopped" ? COPY.stopped : COPY.completed}
          </Text>
        )}
        {/* Interruption chip: this transcript was reloaded from the persisted
            Thread because the replay could not be resumed at the cursor (§3). */}
        {!restoring && interrupted && (
          <Text style={[s.muted, { padding: 8 }]}>{COPY.interrupted}</Text>
        )}
        {error && (
          <View style={s.error}>
            <Text style={{ color: colors.danger, fontSize: 13 }}>{error}</Text>
            <Button small onPress={retry}>
              {COPY.retry}
            </Button>
          </View>
        )}
      </ScrollView>
      <View
        style={{
          flexDirection: "row",
          gap: 10,
          padding: 12,
          paddingBottom: 16,
          alignItems: "center",
        }}
      >
        <TextInput
          accessibilityLabel={title ?? COPY.title}
          value={draft}
          onChangeText={setDraft}
          placeholder={COPY.placeholder}
          placeholderTextColor={colors.muted}
          style={[s.input, { flex: 1 }]}
          multiline
          // No onSubmitEditing: iOS never fires it on a multiline input, so
          // the send button is the one reliable submit entry — no dead
          // enter-to-send affordance on any platform.
        />
        {stopButton.visible && (
          <Button disabled={stopButton.disabled} onPress={stop}>
            {stopButton.label}
          </Button>
        )}
        <Button primary busy={agent.isRunning} disabled={restoreFailed || restoring} onPress={send}>
          {COPY.send}
        </Button>
      </View>
    </SafeAreaView>
  );
}
