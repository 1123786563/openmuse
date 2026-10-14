import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, colors, Mascot, s } from "../ui";
import { connectGoogle, disconnectGoogle, fetchGoogleConnections } from "./api";
import { type ConnectionRow, connectionErrorCopy, normalizeConnections } from "./connection-status";
import { isAuthFailure, OpenBotError } from "./errors";

/** zh-CN user copy, module-internal like every other OpenBot screen. */
const COPY = {
  title: "连接",
  close: "返回对话",
  refresh: "刷新",
  retry: "重试",
  loading: "正在读取连接状态…",
  errorTitle: "连接状态没有读取出来",
  connect: "连接",
  disconnect: "断开",
  openFailed: "没有打开授权页面，请重试。",
  disconnectFailed: "没有断开连接，请重试。",
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

/** §4 chips; the unknown fallback stays neutral, never a fabricated connected. */
const statusChip: Record<string, { backgroundColor: string; color: string }> = {
  connected: { backgroundColor: colors.green, color: colors.text },
  refresh_required: { backgroundColor: colors.sky, color: colors.blueDark },
  disconnected: { backgroundColor: colors.line, color: colors.muted },
  revoked: { backgroundColor: colors.orange, color: colors.danger },
};

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 4,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    marginVertical: 6,
    gap: 6,
  },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 19 },
});

/**
 * The Connections screen (G06): every Google provider the server reports, as
 * the server reports it — accountEmail, granted scopes, §4 status chip, and
 * the sanitized failure sentence when there is one. Connect opens the
 * consent's authorizationUrl via Linking (connectGoogle), disconnect posts
 * the G05 route (disconnectGoogle); a return from the consent browser
 * (AppState active) reloads, so the screen never infers state client-side.
 */
export function OpenBotConnectionsScreen({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<ConnectionRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  // Each source titles its own banner: a fixed errorTitle would mislabel a
  // connect/disconnect failure as a read failure (and its 重试 as reload).
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);

  // Mount, AppState-active, manual refresh, and disconnect's re-fetch can all
  // race: only the response of the LAST request lands (stale ones would
  // resurrect a row the user just disconnected).
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setBusy(true);
    setError(null);
    try {
      const next = normalizeConnections((await fetchGoogleConnections()).connections);
      if (seq === requestSeq.current) setRows(next);
    } catch (e) {
      if (seq === requestSeq.current)
        setError({ title: COPY.errorTitle, detail: connectionErrorCopy(e) });
    } finally {
      if (seq === requestSeq.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The consent round-trip ends back here: reload on the app's next active,
  // the same pattern the legacy workspace refresh uses.
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => listener.remove();
  }, [load]);

  const connect = useCallback(async (provider: string) => {
    // Same seq as load/disconnect: connect returning first must not release
    // the busy lock a still-in-flight load/disconnect still holds.
    const seq = ++requestSeq.current;
    setBusy(true);
    setError(null);
    try {
      const { authorizationUrl } = await connectGoogle(provider);
      // The server-sent URL only ever parsed as non-empty: lock it to https
      // before Linking, so a tampered backend can't launch an arbitrary scheme.
      if (!/^https:\/\//i.test(authorizationUrl)) {
        throw new OpenBotError("invalid_response", "授权地址不是安全的 https 链接，已阻止打开。");
      }
      await Linking.openURL(authorizationUrl);
    } catch (e) {
      if (seq !== requestSeq.current) return;
      const copy = connectionErrorCopy(e);
      // An auth failure is its own sentence (its copy already names the fix);
      // anything else gets the open-failure framing around its cause.
      setError(
        isAuthFailure(e) ? { title: copy, detail: "" } : { title: COPY.openFailed, detail: copy },
      );
    } finally {
      if (seq === requestSeq.current) setBusy(false);
    }
  }, []);

  const disconnect = useCallback(async (provider: string) => {
    const seq = ++requestSeq.current;
    setBusy(true);
    setError(null);
    try {
      await disconnectGoogle(provider);
      const next = normalizeConnections((await fetchGoogleConnections()).connections);
      if (seq === requestSeq.current) setRows(next);
    } catch (e) {
      if (seq === requestSeq.current)
        setError({ title: COPY.disconnectFailed, detail: connectionErrorCopy(e) });
    } finally {
      if (seq === requestSeq.current) setBusy(false);
    }
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={styles.header}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Mascot size={34} />
          <Text style={s.heading}>{COPY.title}</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
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
              {error.title}
              {error.detail ? `（${error.detail}）` : ""}
            </Text>
            <Button small onPress={() => void load()}>
              {COPY.retry}
            </Button>
          </View>
        )}
        {/* Loading only while nothing has failed; an error shows its own banner. */}
        {rows === null && !error ? (
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center", padding: 8 }}>
            <ActivityIndicator size="small" color={colors.blueDark} />
            <Text style={s.muted}>{COPY.loading}</Text>
          </View>
        ) : (
          rows?.map((row) => (
            <ConnectionCard
              key={row.provider}
              row={row}
              busy={busy}
              onConnect={() => void connect(row.provider)}
              onDisconnect={() => void disconnect(row.provider)}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** One provider's row: chip + account + scopes + sanitized error + the action the §4 status licenses. */
function ConnectionCard({
  row,
  busy,
  onConnect,
  onDisconnect,
}: {
  row: ConnectionRow;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  // §4 licenses exactly one action per status; the early-return chain stays
  // flat where nested ternaries would deepen with every status added.
  let action: { label: string; danger: boolean; onAction: () => void } | null = null;
  if (row.status === "disconnected" || row.status === "revoked") {
    action = { label: COPY.connect, danger: false, onAction: onConnect };
  } else if (row.status === "connected" || row.status === "refresh_required") {
    action = { label: COPY.disconnect, danger: true, onAction: onDisconnect };
  }
  return (
    <View style={styles.card}>
      <View style={s.between}>
        <Text style={s.heading}>{row.providerLabel}</Text>
        <Text
          style={[
            chipBase,
            Object.hasOwn(statusChip, row.status)
              ? statusChip[row.status]
              : statusChip.disconnected,
          ]}
        >
          {row.statusLabel}
        </Text>
      </View>
      <Text style={s.small}>{row.accountLabel}</Text>
      <Text style={s.small}>{row.scopesLabel}</Text>
      {row.errorText ? <Text style={styles.errorText}>{row.errorText}</Text> : null}
      {action ? (
        <Button
          small
          danger={action.danger}
          busy={busy}
          style={{ alignSelf: "flex-start" }}
          onPress={action.onAction}
        >
          {action.label}
        </Button>
      ) : null}
    </View>
  );
}
