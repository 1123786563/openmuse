import { type ReactNode, useEffect, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, colors, Mascot, s } from "../ui";
import { fetchComputerScreenshot, fetchComputerSnapshot } from "./api";
import {
  type ComputerDisconnectReason,
  type ComputerState,
  computerConnectionLabels,
  computerFailed,
  computerPageOf,
  computerPoll,
  computerRetry,
  computerStaleLabel,
  computerViewed,
  initialComputerState,
  isComputerStale,
  snapshotSourceOf,
} from "./computer-state";
import { OpenBotControlPanel } from "./control";
import { OpenBotError, type OpenBotErrorCode } from "./errors";

/** Any code the state machine does not name is a transport failure for this screen. */
const reasonOf = (code: OpenBotErrorCode): ComputerDisconnectReason =>
  code === "authentication_required" ||
  code === "refused" ||
  code === "not_found" ||
  code === "unavailable" ||
  code === "invalid_response" ||
  code === "network"
    ? code
    : "network";

/** zh-CN user copy, module-internal like every other OpenBot screen. */
const COPY = {
  title: "计算机",
  close: "返回对话",
  loading: "正在连接计算机…",
  errorTitle: "计算机预览已断开",
  retry: "重新连接",
  previewLabel: "当前屏幕",
  noPreview: "还没有画面",
  elements: "可操作元素",
  capturedAt: "截图时间",
  truncated: "（内容过长已截断）",
  untrusted: "包含未受信任内容",
} as const;

const reasonLabels: Record<ComputerDisconnectReason, string> = {
  authentication_required: "登录已过期",
  refused: "访问被拒绝",
  not_found: "没有这台 Bot 或无权访问",
  unavailable: "计算机服务不可用",
  invalid_response: "返回数据异常",
  network: "网络中断",
};

const chipBase = {
  fontSize: 11,
  lineHeight: 16,
  fontWeight: "600" as const,
  paddingHorizontal: 8,
  paddingVertical: 2,
  borderRadius: 9,
  overflow: "hidden" as const,
};

const chipTint: Record<
  "connecting" | "viewing" | "disconnected" | "stale",
  { backgroundColor: string; color: string }
> = {
  viewing: { backgroundColor: colors.green, color: colors.text },
  connecting: { backgroundColor: colors.sky, color: colors.blueDark },
  disconnected: { backgroundColor: colors.orange, color: colors.danger },
  stale: { backgroundColor: colors.lavender, color: colors.text },
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
  preview: { width: "100%", height: 300, borderRadius: 12, backgroundColor: colors.line },
  previewEmpty: { alignItems: "center", justifyContent: "center" },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 4,
  },
  body: { flex: 1, padding: 18, gap: 12 },
  loadingRow: { flexDirection: "row", gap: 10, alignItems: "center", padding: 8 },
});

/** Default preview refresh cadence; the staleness flag trips after two missed rounds. */
export const computerPollIntervalMs = 5000;

/**
 * The own private Bot's computer preview (K02): the current snapshot +
 * screenshot (authenticated polling over the K01-guarded routes), a live
 * state chip, and a terminal disconnected state on auth failure or refusal
 * that only the explicit retry button leaves. The WS live stream itself and
 * its closure semantics land with K04; this screen's "live" reading is
 * snapshot freshness. Nothing here writes any storage, and disconnect drops
 * every in-memory reference to the picture.
 */
export function OpenBotComputerScreen({
  botId,
  intervalMs = computerPollIntervalMs,
  onClose,
}: {
  botId: string;
  intervalMs?: number;
  onClose: () => void;
}) {
  const [state, setState] = useState<ComputerState>(initialComputerState);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (state.connection === "disconnected") return; // Polling stops; only retry restarts it.
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const round = state.seq;
    void (async () => {
      try {
        const [snapshot, shot] = await Promise.all([
          fetchComputerSnapshot(botId, controller.signal),
          fetchComputerScreenshot(botId, controller.signal),
        ]);
        setState((prev) =>
          computerViewed(
            prev,
            round,
            computerPageOf(snapshot),
            `data:image/png;base64,${shot.base64}`,
            shot.capturedAt,
            Date.now(),
            // The pad's coordinate mapping rides the picture's round guard:
            // a dropped round must not re-time it against another picture.
            { width: shot.width, height: shot.height },
          ),
        );
        timer = setTimeout(() => setState((prev) => computerPoll(prev, prev.seq + 1)), intervalMs);
      } catch (error) {
        // An abort is the unmount/retry cleanup's own doing; it owns the next state.
        if (controller.signal.aborted) return;
        const bot = error instanceof OpenBotError ? error : null;
        setState((prev) =>
          computerFailed(
            prev,
            round,
            reasonOf(bot?.code ?? "network"),
            bot?.message ?? "无法连接计算机。",
          ),
        );
      }
    })();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [state.seq, botId, intervalMs]);

  useEffect(() => {
    if (state.connection !== "viewing") {
      setStale(false);
      return;
    }
    setStale(isComputerStale(state, Date.now(), intervalMs));
    const timer = setInterval(() => setStale(isComputerStale(state, Date.now(), intervalMs)), 1000);
    return () => clearInterval(timer);
  }, [state, intervalMs]);

  const source = snapshotSourceOf(state);
  const chip = stale
    ? { label: computerStaleLabel, style: chipTint.stale }
    : {
        label: computerConnectionLabels[state.connection],
        style: chipTint[state.connection],
      };

  // The preview slot is one of three exclusive states, computed before the
  // JSX instead of a nested ternary: connecting (no picture yet), the live
  // picture, or the empty placeholder.
  let previewNode: ReactNode;
  if (state.connection === "connecting" && !state.image) {
    previewNode = (
      <View style={styles.loadingRow}>
        <ActivityIndicator size="small" color={colors.blueDark} />
        <Text style={s.muted}>{COPY.loading}</Text>
      </View>
    );
  } else if (source) {
    previewNode = (
      <Image
        accessibilityLabel={COPY.previewLabel}
        source={{ uri: source }}
        style={styles.preview}
        resizeMode="contain"
      />
    );
  } else {
    previewNode = (
      <View style={[styles.preview, styles.previewEmpty]}>
        <Text style={s.muted}>{COPY.noPreview}</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={styles.headerRow}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Mascot size={34} />
          <Text style={s.heading}>{COPY.title}</Text>
          <Text style={[chipBase, chip.style]}>{chip.label}</Text>
        </View>
        <Button small onPress={onClose}>
          {COPY.close}
        </Button>
      </View>
      <View style={styles.body}>
        {previewNode}
        {state.connection === "disconnected" && (
          <View style={[styles.card, { gap: 10 }]}>
            <Text style={styles.errorText}>{COPY.errorTitle}</Text>
            <Text style={styles.errorText}>
              {state.reason ? reasonLabels[state.reason] : ""}
              {state.message ? `（${state.message}）` : ""}
            </Text>
            <Button small onPress={() => setState(computerRetry)}>
              {COPY.retry}
            </Button>
          </View>
        )}
        <OpenBotControlPanel botId={botId} image={source} viewport={state.viewport} />
        {state.page && (
          <View style={styles.card}>
            <Text style={s.heading}>{state.page.title}</Text>
            <Text style={s.small}>{state.page.url}</Text>
            <Text style={[s.small, { marginTop: 6 }]}>
              {COPY.elements}：{state.page.elementCount}
              {state.page.truncated ? COPY.truncated : ""}
              {state.page.untrusted ? ` · ${COPY.untrusted}` : ""}
            </Text>
            {state.capturedAt ? (
              <Text style={s.small}>
                {COPY.capturedAt}：{state.capturedAt}
              </Text>
            ) : null}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
