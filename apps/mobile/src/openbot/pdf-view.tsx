import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import PdfReader from "../PdfReader";
import { Button, colors, Mascot, s } from "../ui";
import { downloadFileVersion, fetchFileVersions } from "./api";
import { OpenBotError } from "./errors";
import { nativeCacheAdapter, responseToBase64 } from "./native-cache-adapter";
import {
  buildPdfVersions,
  clearVersionCache,
  initialSelectionId,
  openPdfVersion,
  type PdfVersionEntry,
  refusalClearsCache,
} from "./pdf-view-state";
import type { OpenBotFile } from "./types";

/** zh-CN user copy, module-internal like every other OpenBot screen. */
const COPY = {
  title: "PDF 预览",
  close: "返回文件",
  retry: "重试",
  loadingVersions: "正在加载版本…",
  open: "打开预览",
  opening: "正在获取 PDF…",
  version: "版本",
  listUnavailable: "版本列表暂不可用，仅显示当前版本。",
  noNativeCache: "当前平台没有本地缓存，请在移动端使用。",
} as const;

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipSelected: { borderColor: colors.blueDark, backgroundColor: colors.card },
  chipText: { fontSize: 13, color: colors.text },
  chipTextSelected: { fontSize: 13, color: colors.blueDark, fontWeight: "600" },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 19 },
});

/** The versions route failing to load is never fatal: the route's absence
 * degrades to the current version, other errors surface as the hint copy. */
function describeVersionListError(e: unknown): string {
  if (e instanceof OpenBotError && e.code === "not_found") return COPY.listUnavailable;
  return e instanceof OpenBotError ? e.message : String(e);
}

/**
 * F07: view one PDF file's original and filled versions. The version list
 * comes from the files row plus the versions route (degrading to the current
 * version when that route is absent); the bytes render from the owner-scoped
 * cache (F04 seams) only after the content route's ETag proves they are the
 * SELECTED version's, and a refusal (expired session / deleted file / wrong
 * bytes) deletes that version's cached copy and drops the render path — a
 * stale render is impossible. The legacy PdfReader is consumed as-is: its
 * url accepts the cache's file:// path (react-native-pdf documents
 * file:///absolute/path support on iOS), the Authorization header is inert on
 * a local source, and pageCount self-corrects via onLoadComplete.
 */
export function OpenBotPdfView({ file, onClose }: { file: OpenBotFile; onClose: () => void }) {
  const [versions, setVersions] = useState<PdfVersionEntry[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [listHint, setListHint] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [opened, setOpened] = useState<{ path: string; sha256: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Constant for the app's lifetime; web (no cacheDirectory) resolves null.
  // Lazy initializer so the expo probe runs once, not on every render.
  const [adapter] = useState(() => nativeCacheAdapter());
  // Bumped on every open and every selection change: only the current
  // selection's in-flight result may touch the render path.
  const openGeneration = useRef(0);

  const loadVersions = useCallback(async () => {
    setVersions(null);
    setListHint(null);
    try {
      const { versions: rows } = await fetchFileVersions(file.id);
      const built = buildPdfVersions(file, rows);
      setVersions(built);
      setSelectedId(initialSelectionId(built));
    } catch (e) {
      // The versions route is not this client's to ship: degrade to the file
      // row's current version instead of blocking the original. Deletion or
      // expiry still refuses at open time through the byte fetch.
      const built = buildPdfVersions(file, []);
      setVersions(built);
      setSelectedId(initialSelectionId(built));
      setListHint(describeVersionListError(e));
    }
  }, [file]);

  useEffect(() => {
    void loadVersions();
    setOpened(null);
    setError(null);
  }, [loadVersions]);

  const selected = versions?.find((version) => version.versionId === selectedId);

  const select = useCallback((versionId: string) => {
    openGeneration.current += 1; // any in-flight open belongs to a dead selection
    setSelectedId(versionId);
    // Never keep another version's render on screen while switching.
    setOpened(null);
    setError(null);
    setOpening(false);
  }, []);

  const open = useCallback(async () => {
    if (!adapter || !selected) return;
    const request = ++openGeneration.current;
    setOpening(true);
    try {
      const result = await openPdfVersion(file, selected, {
        cacheDirectory: adapter.cacheDirectory,
        fileSystem: adapter.fileSystem,
        fetchBytes: async () => {
          const response = await downloadFileVersion(file, selected.versionId);
          return { base64: await responseToBase64(response), etag: response.headers.get("etag") };
        },
      });
      if (openGeneration.current !== request) return; // the selection moved on
      setOpened({ path: result.path, sha256: result.meta.sha256 });
      setError(null);
    } catch (e) {
      // The refusal's cache clear runs BEFORE the generation guard: failedVersionId
      // scopes the delete to THIS version (a slot already holding another version's
      // still-valid copy survives the sidecar check), so the clear stays safe even
      // when the selection already moved on — and a dead request must not leave the
      // refused version's bytes cached until logout.
      if (e instanceof OpenBotError && refusalClearsCache(e.code)) {
        await clearVersionCache(
          file,
          {
            cacheDirectory: adapter.cacheDirectory,
            fileSystem: adapter.fileSystem,
          },
          selected.versionId,
        ).catch(() => undefined);
      }
      // Only now is this request dead: a stale selection's failure/error must
      // not land under the new one (select advanced the generation and cleared
      // the error).
      if (openGeneration.current !== request) return;
      setOpened(null);
      setError(e instanceof OpenBotError ? e.message : String(e));
    } finally {
      if (openGeneration.current === request) setOpening(false);
    }
  }, [adapter, file, selected]);

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
        <Button small onPress={onClose}>
          {COPY.close}
        </Button>
      </View>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 18, paddingVertical: 12, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text numberOfLines={1} style={s.heading}>
          {file.name}
        </Text>
        {versions === null ? (
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center", padding: 8 }}>
            <ActivityIndicator size="small" color={colors.blueDark} />
            <Text style={s.muted}>{COPY.loadingVersions}</Text>
          </View>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            {versions.map((version) => {
              const isSelected = version.versionId === selectedId;
              return (
                <Pressable
                  key={version.versionId}
                  accessibilityRole="button"
                  accessibilityLabel={version.label}
                  onPress={() => select(version.versionId)}
                  style={isSelected ? [styles.chip, styles.chipSelected] : styles.chip}
                >
                  <Text style={isSelected ? styles.chipTextSelected : styles.chipText}>
                    {version.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
        {selected && (
          <Text style={[s.small, { marginTop: 8 }]} selectable>
            {COPY.version}：{selected.versionId} · SHA-256：
            {selected.sha256 ?? opened?.sha256 ?? "打开后以实际字节为准"}
          </Text>
        )}
        {listHint && <Text style={[s.small, { marginTop: 8 }]}>{listHint}</Text>}
        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
          <Button small busy={opening} disabled={!adapter || !selected} onPress={() => void open()}>
            {COPY.open}
          </Button>
        </View>
        {error && (
          <Text style={[styles.errorText, { marginTop: 8 }]}>
            {error}（点「{COPY.open}」重试）
          </Text>
        )}
        {opened && (
          <View style={{ marginTop: 12 }}>
            {/* Local bytes: the token header is inert for a file:// source and
                pageCount self-corrects via onLoadComplete. */}
            <PdfReader url={opened.path} token="" pageCount={1} />
          </View>
        )}
        {!adapter && <Text style={[s.small, { marginTop: 10 }]}>{COPY.noNativeCache}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}
