import { useEffect, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Button, colors, s } from "../ui";
import {
  type ComputerInput,
  cancelComputerControl,
  releaseComputerControl,
  requestComputerControl,
  sendComputerInput,
  takeComputerControl,
} from "./api";
import {
  attemptControlInput,
  type ControlState,
  controlCancelled,
  controlExpired,
  controlInputFailed,
  controlPhaseLabels,
  controlReleased,
  controlRequestSent,
  controlTaken,
  initialControlState,
  isLateInputRefusal,
} from "./control-state";
import { OpenBotError } from "./errors";

/** zh-CN user copy, module-internal like every other OpenBot screen. */
const COPY = {
  title: "接管控制",
  request: "请求接管",
  take: "接管",
  cancel: "取消请求",
  release: "交还控制",
  releaseRetry: "再次请求接管",
  inputHint: "接管期间可以点击画面、输入文字或按回车。",
  padLabel: "点击画面发送点击",
  noPad: "暂无画面，无法定位点击坐标",
  typePlaceholder: "输入要键入的文字",
  typeSend: "键入",
  enterKey: "按回车",
  failed: "操作失败",
  noWaitingLease: "请求没有被受理，请稍后再试。",
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

const chipTint: Record<ControlState["phase"], { backgroundColor: string; color: string }> = {
  viewing: { backgroundColor: colors.lavender, color: colors.text },
  requesting: { backgroundColor: colors.sky, color: colors.blueDark },
  controlling: { backgroundColor: colors.green, color: colors.text },
  released: { backgroundColor: colors.sky, color: colors.blueDark },
  refused: { backgroundColor: colors.orange, color: colors.danger },
  expired: { backgroundColor: colors.orange, color: colors.danger },
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    gap: 10,
  },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 14,
    color: colors.text,
    flex: 1,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  requestRow: { flexDirection: "row", gap: 10 },
  controllingBody: { gap: 10 },
  typeRow: { flexDirection: "row", gap: 10, alignItems: "center" },
});

/**
 * The human-control panel of the Computer screen (K04): request → take →
 * control → release over the K03 lease routes, with a state chip per phase.
 * Input (a click at (x,y) on the preview, typed text, the Enter key) leaves
 * the device ONLY while controlling, numbered by the lease's monotonic seq;
 * a 403/409 answer after the lease is gone surfaces as a visible 已断开
 * refusal and is never retried. Honest scoping: full keyboard/mouse
 * streaming rides the live WS stream, which is the native pass — every input
 * here travels over the HTTP gesture routes.
 */
export function OpenBotControlPanel({
  botId,
  image,
  viewport,
}: {
  botId: string;
  /** The current preview image (in memory only), or null when there is none. */
  image: string | null;
  /** The previewed page's pixel size, for mapping a pad tap to page coords. */
  viewport: { width: number; height: number } | null;
}) {
  const [state, setState] = useState<ControlState>(initialControlState);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [padWidth, setPadWidth] = useState(0);

  // The authoritative lease state, advanced synchronously: a rapid second
  // dispatch reads the ref, not this render's closure, so two inputs inside
  // one commit window consume seq n then n+1 — never the same seq twice (the
  // server 409s a duplicate seq, which would wrongly conclude the lease).
  // setState only mirrors it for rendering.
  const stateRef = useRef(state);
  const commit = (next: ControlState) => {
    stateRef.current = next;
    setState(next);
  };

  // Unmount (screen closed / sign-out navigation) ends control best-effort:
  // the release races the teardown, so its failure is deliberately swallowed.
  // Synced in an effect — never during render — so a discarded concurrent
  // render cannot advance it.
  const teardown = useRef({ phase: state.phase, leaseId: state.leaseId, botId });
  useEffect(() => {
    teardown.current = { phase: state.phase, leaseId: state.leaseId, botId };
  }, [state.phase, state.leaseId, botId]);
  useEffect(
    () => () => {
      const now = teardown.current;
      if (now.phase === "controlling" && now.leaseId) {
        void releaseComputerControl(now.botId, now.leaseId).catch(() => {});
      } else if (now.phase === "requesting" && now.leaseId) {
        // Leaving while a request waits for a take: cancel it, or the server
        // holds the Bot paused for a lease whose requester is already gone.
        void cancelComputerControl(now.botId, now.leaseId).catch(() => {});
      }
    },
    [],
  );

  /** Lease-route failures are notices; only a dispatched input's refusal concludes the lease. */
  const failNotice = (error: unknown) => {
    setNotice(error instanceof Error ? error.message : COPY.failed);
  };
  const failInput = (seq: number, generation: number) => (error: unknown) => {
    if (error instanceof OpenBotError && isLateInputRefusal(error.status ?? 0)) {
      // controlInputFailed concludes the lease only for the freshest
      // dispatched seq of the SAME lease generation: a superseded duplicate's
      // 409 — or a prior lease's late answer colliding with the re-taken
      // lease's re-issued seq number — must not evict a healthy lease.
      commit(controlInputFailed(stateRef.current, seq, error.status ?? 0, generation));
      return;
    }
    failNotice(error);
  };
  const failRelease = (error: unknown) => {
    // A release the server 409s because the lease is already gone still
    // means the Bot drives again — conclude it locally instead of leaving
    // a dead lease's controlling UI on screen.
    if (error instanceof OpenBotError && error.status === 409) {
      commit(controlReleased(stateRef.current));
      return;
    }
    failNotice(error);
  };

  const act = (
    action: () => Promise<unknown>,
    onFailure: (error: unknown) => void = failNotice,
  ) => {
    setNotice(null);
    setBusy(true);
    void action()
      .catch(onFailure)
      .finally(() => setBusy(false));
  };

  const request = () =>
    act(async () => {
      const body = await requestComputerControl(botId);
      const leaseId = body.request?.id ?? null;
      // A 200 without a waiting request is no lease to sit on: entering
      // requesting with a null leaseId deadlocks the panel (take/cancel both
      // disabled, and the request button no longer renders). Stay put instead.
      if (!leaseId) {
        setNotice(COPY.noWaitingLease);
        return;
      }
      commit(controlRequestSent(stateRef.current, leaseId, body.reason));
    });

  const take = () =>
    act(async () => {
      const id = stateRef.current.leaseId;
      if (!id) return;
      try {
        const body = await takeComputerControl(botId, id);
        commit(controlTaken(stateRef.current, body.request?.id ?? id));
      } catch (error) {
        // Only a waiting lease can be taken (server: 409) — the lease is
        // already gone server-side: conclude it as expired so the panel can
        // request again instead of sticking on 等待接管 forever.
        if (error instanceof OpenBotError && error.status === 409) {
          commit(controlExpired(stateRef.current));
          return;
        }
        throw error;
      }
    });

  const cancel = () =>
    act(async () => {
      const id = stateRef.current.leaseId;
      try {
        if (id) await cancelComputerControl(botId, id);
      } catch (error) {
        // The lease already vanished server-side (409): the request is as
        // cancelled as it will ever be — return to viewing, don't dead-end.
        if (!(error instanceof OpenBotError && error.status === 409)) throw error;
      }
      // A cancelled request was never held: the screen returns to viewing —
      // through controlCancelled, NOT initialControlState(): resetting the
      // generation would let a prior lease's late 403/409 evict the next
      // re-taken lease (the generation guard's whole reason to exist).
      commit(controlCancelled(stateRef.current));
    });

  const release = () =>
    act(async () => {
      if (stateRef.current.leaseId) await releaseComputerControl(botId, stateRef.current.leaseId);
      commit(controlReleased(stateRef.current));
    }, failRelease);

  /**
   * The single dispatch gate: only controlling sends, with the lease's next
   * seq. Serial by the ref above, so a duplicate seq never fires. Returns
   * whether the input left the device, so callers clear their own draft
   * only when it did.
   */
  const dispatch = (input: ComputerInput): boolean => {
    const attempt = attemptControlInput(stateRef.current);
    if (!attempt.ok) return false; // The guard already refused it: nothing leaves.
    commit(attempt.state);
    setNotice(null);
    sendComputerInput(botId, { ...input, seq: attempt.seq }).catch(
      failInput(attempt.seq, attempt.state.generation),
    );
    return true;
  };

  const chip = chipTint[state.phase];
  const message = state.message ?? notice;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={s.heading}>{COPY.title}</Text>
        <Text style={[chipBase, chip]}>{controlPhaseLabels[state.phase]}</Text>
      </View>
      {state.reason && state.phase !== "viewing" ? (
        <Text style={s.small}>{state.reason}</Text>
      ) : null}
      {message ? <Text style={styles.errorText}>{message}</Text> : null}

      {state.phase === "viewing" ||
      state.phase === "released" ||
      state.phase === "refused" ||
      state.phase === "expired" ? (
        <Button small disabled={busy} onPress={request}>
          {state.phase === "viewing" ? COPY.request : COPY.releaseRetry}
        </Button>
      ) : null}

      {state.phase === "requesting" && (
        <View style={styles.requestRow}>
          <Button small disabled={busy || !state.leaseId} onPress={take}>
            {COPY.take}
          </Button>
          <Button small disabled={busy || !state.leaseId} onPress={cancel}>
            {COPY.cancel}
          </Button>
        </View>
      )}

      {state.phase === "controlling" && (
        <View style={styles.controllingBody}>
          <Text style={s.small}>{COPY.inputHint}</Text>
          {image && viewport ? (
            <Pressable
              accessibilityLabel={COPY.padLabel}
              onLayout={(e) => setPadWidth(e.nativeEvent.layout.width)}
              onPress={(e) => {
                if (!padWidth || !viewport) return;
                const { locationX, locationY } = e.nativeEvent;
                // Pad taps scale to the page's viewport pixels.
                dispatch({
                  kind: "click",
                  x: Math.round((locationX / padWidth) * viewport.width),
                  y: Math.round(locationY * (viewport.width / padWidth)),
                });
              }}
            >
              <Image
                source={{ uri: image }}
                style={{
                  width: "100%",
                  aspectRatio: viewport.width / viewport.height,
                  borderRadius: 12,
                }}
                resizeMode="contain"
              />
            </Pressable>
          ) : (
            <Text style={s.small}>{COPY.noPad}</Text>
          )}
          <View style={styles.typeRow}>
            <TextInput
              style={styles.input}
              placeholder={COPY.typePlaceholder}
              placeholderTextColor={colors.text}
              value={text}
              onChangeText={setText}
            />
            <Button
              small
              disabled={busy || !text}
              onPress={() => {
                // Keep the typed text when the gate refused it locally —
                // clearing would silently drop what never left the device.
                if (dispatch({ kind: "type", text })) setText("");
              }}
            >
              {COPY.typeSend}
            </Button>
          </View>
          <Button small disabled={busy} onPress={() => dispatch({ kind: "key", key: "Enter" })}>
            {COPY.enterKey}
          </Button>
          <Button small disabled={busy} onPress={release}>
            {COPY.release}
          </Button>
        </View>
      )}
    </View>
  );
}
