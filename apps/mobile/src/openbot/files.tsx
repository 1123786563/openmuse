import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, colors, Mascot, s } from "../ui";
import { downloadFile, fetchFiles } from "./api";
import { OpenBotError } from "./errors";
import { type CachedFileMeta, ensureCached } from "./file-cache";
import { nativeCacheAdapter, responseToBase64 } from "./native-cache-adapter";
import { OpenBotPdfView } from "./pdf-view";
import { canPdfPreview, etagMatchesVersion } from "./pdf-view-state";
import type { OpenBotFile } from "./types";

/** zh-CN user copy, module-internal like every other OpenBot screen. */
const COPY = {
  title: "文件",
  close: "返回对话",
  refresh: "刷新",
  retry: "重试",
  loading: "正在加载文件…",
  errorTitle: "文件没有加载出来",
  emptyList: "还没有文件",
  download: "下载",
  downloading: "下载中…",
  open: "打开",
  loadMore: "加载更多",
  preview: "打开预览",
  cached: "已缓存",
  size: "大小",
  sha256: "SHA-256",
  notCached: "请先下载",
  noNativeCache: "当前平台没有本地缓存，请在移动端使用。",
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
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  action: { fontSize: 13, color: colors.blueDark, fontWeight: "600" },
  actionBusy: { fontSize: 13, color: colors.muted, fontWeight: "600" },
  actionDisabled: { fontSize: 13, color: colors.muted },
});

/**
 * Per-row download state. "cached" carries the sidecar meta so 打开 can show
 * the size/SHA-256 confirmation of the bytes that actually landed.
 */
type RowState =
  | { phase: "idle" }
  | { phase: "downloading" }
  | { phase: "cached"; meta: CachedFileMeta }
  | { phase: "failed"; message: string };

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * The row's download affordance, flattened out of the JSX: cached states the
 * landed fact, downloading the busy copy, everything else — idle, or failed
 * with its own error line below — offers the button again. A plain function,
 * not a nested component, so the row keeps its identity.
 */
function downloadAction(row: RowState, enabled: boolean, onDownload: () => void) {
  if (row.phase === "cached") return <Text style={styles.action}>{COPY.cached}</Text>;
  if (row.phase === "downloading") return <Text style={styles.actionBusy}>{COPY.downloading}</Text>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={COPY.download}
      disabled={!enabled}
      onPress={onDownload}
    >
      <Text style={enabled ? styles.action : styles.actionDisabled}>{COPY.download}</Text>
    </Pressable>
  );
}

/**
 * The owner's Files (F04): list with per-row 下载 into the owner-scoped cache
 * (authenticated bytes via F02's content route; version-stale copies are
 * re-downloaded; I07's logout sweep clears the whole tree). 打开 confirms the
 * bytes that landed — size + SHA-256 — because image/PDF preview is F07/F08's
 * (scoping note, not an omission).
 */
export function OpenBotFilesScreen({ onClose }: { onClose: () => void }) {
  const [files, setFiles] = useState<OpenBotFile[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [opened, setOpened] = useState<{ file: OpenBotFile; meta: CachedFileMeta } | null>(null);
  const [preview, setPreview] = useState<OpenBotFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The adapter is constant for the app's lifetime; web (no cacheDirectory)
  // resolves null and the download button degrades to a hint.
  const [adapter] = useState(nativeCacheAdapter);

  // A fresh list demotes cached rows whose version changed: "version-stale
  // re-downloads" only holds if 下载 becomes reachable again — otherwise the
  // row forever shows the old sidecar's size/SHA-256 as current fact.
  const demoteStaleCached = useCallback((page: OpenBotFile[]) => {
    setRows((prev) => {
      let next = prev;
      for (const file of page) {
        const row = next[file.id];
        if (row?.phase === "cached" && row.meta.versionId !== file.versionId) {
          if (next === prev) next = { ...prev };
          delete next[file.id];
        }
      }
      return next;
    });
  }, []);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setBusy(true);
      setError(null);
      try {
        const page = await fetchFiles(null, signal);
        setFiles(page.files);
        setNextCursor(page.nextCursor);
        demoteStaleCached(page.files);
      } catch (e) {
        setError(e instanceof OpenBotError ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [demoteStaleCached],
  );

  // Beyond the first page only on demand: files past the cursor are otherwise
  // invisible (no download/preview path reaches them).
  const loadMore = useCallback(async () => {
    if (nextCursor === null) return;
    setBusy(true);
    try {
      const page = await fetchFiles(nextCursor);
      setFiles((prev) => [...(prev ?? []), ...page.files]);
      setNextCursor(page.nextCursor);
      demoteStaleCached(page.files);
    } catch (e) {
      setError(e instanceof OpenBotError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [demoteStaleCached, nextCursor]);

  // Unmount aborts the mount-time list fetch and any download's byte stream:
  // the screen is gone, so neither keeps fetching nor lands a setState on it.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const download = useCallback(
    async (file: OpenBotFile) => {
      if (!adapter) return;
      setRows((prev) => ({ ...prev, [file.id]: { phase: "downloading" } }));
      try {
        const { meta } = await ensureCached(file, {
          cacheDirectory: adapter.cacheDirectory,
          fetchBytes: async () => {
            const response = await downloadFile(file, abortRef.current?.signal);
            const result = {
              base64: await responseToBase64(response),
              etag: response.headers.get("etag"),
            };
            // §5: the row's sha256 is ALWAYS the original's hash while
            // /content serves the CURRENT bytes — once a fill lands, an
            // equality check against the row's hash would refuse forever.
            // The degraded-current protocol (openbot-pdf-view-state.test.ts
            // pins it) instead demands a well-formed sha256 ETag and records
            // the digest the bytes actually carry; a version flip is caught
            // by the versionId-change cache miss, not by this digest.
            if (!etagMatchesVersion(result.etag, { sha256: null }))
              throw new OpenBotError(
                "invalid_response",
                "服务端响应缺少可验证的 SHA-256 摘要，已拒绝缓存。",
              );
            return result;
          },
          fileSystem: adapter.fileSystem,
        });
        setRows((prev) => ({ ...prev, [file.id]: { phase: "cached", meta } }));
      } catch (e) {
        setRows((prev) => ({
          ...prev,
          [file.id]: {
            phase: "failed",
            message: e instanceof OpenBotError ? e.message : String(e),
          },
        }));
      }
    },
    [adapter],
  );

  const open = useCallback(
    (file: OpenBotFile) => {
      const row = rows[file.id];
      // F07/F08 own the real preview; here "open" confirms the landed bytes.
      if (row?.phase === "cached") setOpened({ file, meta: row.meta });
    },
    [rows],
  );

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
              {COPY.errorTitle}（{error}）
            </Text>
            <Button small onPress={() => void load()}>
              {COPY.retry}
            </Button>
          </View>
        )}
        {opened && (
          <View style={styles.card}>
            <Text style={s.heading}>{opened.file.name}</Text>
            <Text style={s.small}>
              {COPY.size}：{formatSize(opened.meta.size)} · {COPY.cached} ·{" "}
              {formatDate(opened.meta.downloadedAt)}
            </Text>
            <Text style={s.small} selectable>
              {COPY.sha256}：{opened.meta.sha256 ?? "—"}
            </Text>
          </View>
        )}
        {files === null ? (
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center", padding: 8 }}>
            <ActivityIndicator size="small" color={colors.blueDark} />
            <Text style={s.muted}>{COPY.loading}</Text>
          </View>
        ) : files.length === 0 ? (
          <Text style={s.muted}>{COPY.emptyList}</Text>
        ) : (
          files.map((file) => {
            const row = rows[file.id] ?? { phase: "idle" as const };
            return (
              <View key={file.id} style={styles.card}>
                <View style={s.between}>
                  <Text numberOfLines={1} style={[s.heading, { flexShrink: 1 }]}>
                    {file.name}
                  </Text>
                  {downloadAction(row, !!adapter, () => void download(file))}
                </View>
                <Text style={s.small}>
                  {formatSize(file.size)} · {formatDate(file.createdAt)} · {file.mimeType}
                </Text>
                {row.phase === "failed" ? (
                  <Text style={styles.errorText}>{row.message}</Text>
                ) : (
                  <View style={{ flexDirection: "row", gap: 16, alignItems: "center" }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={COPY.open}
                      disabled={row.phase !== "cached"}
                      onPress={() => open(file)}
                    >
                      <Text style={row.phase === "cached" ? styles.action : styles.actionDisabled}>
                        {row.phase === "cached" ? COPY.open : COPY.notCached}
                      </Text>
                    </Pressable>
                    {canPdfPreview(file) && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={COPY.preview}
                        onPress={() => setPreview(file)}
                      >
                        <Text style={styles.action}>{COPY.preview}</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            );
          })
        )}
        {nextCursor !== null && files !== null ? (
          <Button small busy={busy} onPress={() => void loadMore()}>
            {COPY.loadMore}
          </Button>
        ) : null}
        {!adapter && files !== null && files.length > 0 ? (
          <Text style={[s.small, { marginTop: 10 }]}>{COPY.noNativeCache}</Text>
        ) : null}
      </ScrollView>
      {preview && (
        <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}>
          <OpenBotPdfView file={preview} onClose={() => setPreview(null)} />
        </View>
      )}
    </SafeAreaView>
  );
}
