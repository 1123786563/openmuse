import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, colors, Mascot, s } from "../ui";
import { archiveChannel, createChannel, renameChannel, reopenChannel } from "./api";
import { partitionArchived, validateChannelName, type WorkspaceChannel } from "./channel-actions";
import { OpenBotError } from "./errors";

/** zh-CN user copy, module-internal like every other OpenBot screen. */
const COPY = {
  title: "频道",
  close: "返回对话",
  create: "新建频道",
  creating: "正在创建频道…",
  errorTitle: "操作没有成功",
  current: "当前",
  archived: "已归档",
  backToActive: "返回活跃频道",
  archivedEmpty: "还没有归档的频道。",
  rename: "重命名",
  archive: "归档",
  reopen: "恢复",
  save: "保存",
  cancel: "取消",
  renamePlaceholder: "新的频道名称",
} as const;

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    marginVertical: 6,
  },
  current: { borderColor: colors.blueDark, borderWidth: 2 },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: "row", gap: 8, marginTop: 10 },
  renameRow: { flexDirection: "row", gap: 8, marginTop: 10, alignItems: "center" },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 4,
  },
  scrollContent: { paddingHorizontal: 18, paddingVertical: 12, flexGrow: 1 },
  footer: { padding: 12, paddingBottom: 16 },
  busyRow: { flexDirection: "row", gap: 10, alignItems: "center", padding: 8 },
});

/**
 * Channel list + create + switch (C02) with rename/archive/reopen (C03). The
 * list renders the server's order untouched within each partition
 * (partitionArchived splits by archivedAt, never re-sorts: the
 * pinned/recency/id cursor is the server's answer, the client never
 * re-sorts). Creation has NO name field: the server names a channel from its
 * Bot roster (Task 0, parseChannelInput takes {agentIds} only), so this
 * mirrors the web flow — create over the private Bot, hand the row to the
 * shell, which merges it and switches onto it. Rename archives nothing and
 * archive deletes nothing: the same {id, threadId} come back on reopen, so
 * the shell only re-stamps the local row.
 */
export function OpenBotChannelsScreen({
  channels,
  currentId,
  botId,
  onSelect,
  onCreated,
  onRenamed,
  onArchived,
  onReopened,
  onClose,
}: {
  channels: WorkspaceChannel[];
  currentId: string;
  botId: string;
  onSelect: (channel: WorkspaceChannel) => void;
  onCreated: (channel: WorkspaceChannel) => void;
  onRenamed: (channel: WorkspaceChannel) => void;
  onArchived: (channelId: string) => void;
  onReopened: (channelId: string) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // C03: the Archived filter is view state only — the roster itself stays the
  // server's mixed workspace order.
  const [showArchived, setShowArchived] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  // Rename in-flight gate: the save button and the draft's onSubmitEditing
  // both call submitRename, and busyId only becomes visible after a
  // re-render — the ref is synchronous with the first submit, so a
  // same-frame double fire sends one PATCH, not two.
  const renameInFlightRef = useRef<string | null>(null);

  const partition = partitionArchived(channels);
  const visible = showArchived ? partition.archived : partition.active;

  // Reopening the last archived channel empties the archived partition and
  // unmounts the toggle with it — fall back to the active list instead of
  // stranding the view on an empty 已归档 list with no way back.
  useEffect(() => {
    if (showArchived && partition.archived.length === 0) setShowArchived(false);
  }, [showArchived, partition.archived.length]);

  const create = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      onCreated(await createChannel([botId]));
    } catch (e) {
      setError(e instanceof OpenBotError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [botId, onCreated]);

  /** One runner for every row action: the row's own busy flag, one error slot. */
  const runAction = useCallback(async (channelId: string, action: () => Promise<void>) => {
    setBusyId(channelId);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof OpenBotError ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }, []);

  const submitRename = useCallback(
    (channel: WorkspaceChannel) => {
      if (renameInFlightRef.current !== null) return;
      const validated = validateChannelName(renameDraft);
      if (!validated.ok) {
        setError(validated.error);
        return;
      }
      renameInFlightRef.current = channel.id;
      void runAction(channel.id, async () => {
        try {
          onRenamed(await renameChannel(channel.id, validated.name));
          setRenamingId(null);
        } finally {
          renameInFlightRef.current = null;
        }
      });
    },
    [onRenamed, renameDraft, runAction],
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={styles.headerRow}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Mascot size={34} />
          <Text style={s.heading}>{COPY.title}</Text>
        </View>
        <Button small onPress={onClose}>
          {COPY.close}
        </Button>
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {error && (
          <View style={s.error}>
            <Text style={styles.errorText}>
              {COPY.errorTitle}（{error}）
            </Text>
          </View>
        )}
        {partition.archived.length > 0 && (
          <Button small onPress={() => setShowArchived((value) => !value)}>
            {showArchived ? COPY.backToActive : `${COPY.archived}（${partition.archived.length}）`}
          </Button>
        )}
        {visible.length === 0 && showArchived && (
          <Text style={[s.muted, { textAlign: "center", marginTop: 16 }]}>
            {COPY.archivedEmpty}
          </Text>
        )}
        {visible.map((channel) => {
          const current = channel.id === currentId;
          const renaming = renamingId === channel.id;
          const rowBusy = busyId === channel.id;
          // Explicit double check, never a loose !=: an omitted archivedAt
          // (pre-archive server row) is active; !== null alone misfiles it.
          const archivedRow = channel.archivedAt !== null && channel.archivedAt !== undefined;
          return (
            <View key={channel.id} style={[styles.card, current ? styles.current : null]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={channel.name}
                disabled={archivedRow || channel.agentIds.length === 0}
                onPress={() => onSelect(channel)}
                style={({ pressed }) => ({
                  opacity: pressed && !archivedRow && channel.agentIds.length > 0 ? 0.7 : 1,
                })}
              >
                <View style={s.between}>
                  <Text style={s.heading}>{channel.name}</Text>
                  {current && (
                    <Text style={[s.small, { color: colors.blueDark }]}>{COPY.current}</Text>
                  )}
                </View>
                <Text style={s.small} numberOfLines={1}>
                  {channel.threadId}
                </Text>
              </Pressable>
              <View style={styles.actions}>
                <Button
                  small
                  disabled={busyId !== null}
                  onPress={() => {
                    setRenamingId(renaming ? null : channel.id);
                    setRenameDraft(channel.name);
                    setError(null);
                  }}
                >
                  {COPY.rename}
                </Button>
                <Button
                  small
                  disabled={busyId !== null || (!archivedRow && channel.id === currentId)}
                  onPress={() =>
                    void runAction(channel.id, async () => {
                      if (archivedRow) {
                        await reopenChannel(channel.id);
                        onReopened(channel.id);
                      } else {
                        await archiveChannel(channel.id);
                        onArchived(channel.id);
                      }
                    })
                  }
                >
                  {archivedRow ? COPY.reopen : COPY.archive}
                </Button>
              </View>
              {renaming && (
                <View style={styles.renameRow}>
                  {rowBusy ? (
                    <ActivityIndicator size="small" color={colors.blueDark} />
                  ) : (
                    <>
                      <TextInput
                        accessibilityLabel={COPY.renamePlaceholder}
                        value={renameDraft}
                        onChangeText={setRenameDraft}
                        placeholder={COPY.renamePlaceholder}
                        placeholderTextColor={colors.muted}
                        style={[s.input, { flex: 1 }]}
                        onSubmitEditing={() => submitRename(channel)}
                      />
                      <Button small primary onPress={() => submitRename(channel)}>
                        {COPY.save}
                      </Button>
                      <Button small onPress={() => setRenamingId(null)}>
                        {COPY.cancel}
                      </Button>
                    </>
                  )}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
      <View style={styles.footer}>
        {busy ? (
          <View style={styles.busyRow}>
            <ActivityIndicator size="small" color={colors.blueDark} />
            <Text style={s.muted}>{COPY.creating}</Text>
          </View>
        ) : (
          <Button primary onPress={() => void create()}>
            {COPY.create}
          </Button>
        )}
      </View>
    </SafeAreaView>
  );
}
