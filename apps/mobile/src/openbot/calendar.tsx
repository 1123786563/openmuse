import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, colors, Mascot, s } from "../ui";
import { fetchCalendarEvents } from "./api";
import { eventRowView } from "./calendar-view";
import { OpenBotError } from "./errors";
import type { OpenBotCalendarEvent } from "./types";

/** zh-CN user copy, module-internal like every other OpenBot screen. */
const COPY = {
  title: "日历",
  close: "返回对话",
  refresh: "刷新",
  retry: "重试",
  loading: "正在加载日程…",
  errorTitle: "日历没有加载出来",
  emptyList: "这个时间段没有日程",
  truncatedList: "日程较多，仅显示部分结果",
  allDay: "全天",
  assumedZone: "默认时区",
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

/**
 * Client-side row cap: the schema puts no bound on a window's events, and an
 * unbounded collected list would mount every row at once — past the cap the
 * list admits it is truncated (the same hint a server truncation gets) instead
 * of growing memory without end on dense calendars.
 */
const MAX_EVENT_ROWS = 500;

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    marginVertical: 6,
  },
});

/**
 * A03: minimal Calendar list over A01's endpoint — title plus the §4 render
 * semantics: timed ranges in the device zone (presentation only; stored
 * instants never move), all-day as date-only with an exclusive end, a naive
 * ISO marked as rendered in its assumed zone.
 */
export function OpenBotCalendarScreen({ onClose }: { onClose: () => void }) {
  const [events, setEvents] = useState<OpenBotCalendarEvent[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  // Device zone only drives presentation; never written back to any event.
  const [zone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  // connections.tsx's requestSeq pattern: only the latest load's responses
  // land, and its AbortController tears the paging loop down when the screen
  // unmounts mid-drain (the do..while would otherwise keep firing up to 50
  // pages against a gone component).
  const requestSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    try {
      // ponytail: fixed ±31-day window around today; real day/week paging is A02's.
      const now = Date.now();
      const timeMin = new Date(now - 31 * 86_400_000).toISOString();
      const timeMax = new Date(now + 31 * 86_400_000).toISOString();
      // Drain every page inside the window (a cursor-less truncated page
      // still gets its hint rendered). The page cap only guards a broken
      // server cursor looping forever — this window needs a handful at most.
      const collected: OpenBotCalendarEvent[] = [];
      let sawTruncated = false;
      let cursor: string | null = null;
      let pages = 0;
      do {
        const page = await fetchCalendarEvents({ timeMin, timeMax, cursor }, controller.signal);
        collected.push(...page.events);
        // The row cap leaves the cursor pending, so the post-loop check below
        // flags the list as truncated — nothing is silently dropped.
        cursor = page.nextCursor;
        if (page.truncated) sawTruncated = true;
        if (collected.length >= MAX_EVENT_ROWS) break;
      } while (cursor && ++pages < 50);
      // Exiting on the page cap with a cursor still pending means the list is
      // just as incomplete as a truncated page — hint it, never drop silently.
      if (cursor) sawTruncated = true;
      if (seq !== requestSeq.current) return; // a newer load owns the screen
      // Truncated commits with the events it describes: an in-place write
      // would clear the old hint before the fetch even fails, leaving a
      // half-loaded view that claims completeness (or scaring a complete one).
      setEvents(collected);
      setTruncated(sawTruncated);
    } catch (e) {
      if (seq !== requestSeq.current) return;
      setError(e instanceof OpenBotError ? e.message : String(e));
    } finally {
      if (seq === requestSeq.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

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
      <View style={{ flex: 1 }}>
        {error && (
          <View style={[s.error, { marginHorizontal: 18 }]}>
            <Text style={{ color: colors.danger, fontSize: 13, lineHeight: 19 }}>
              {COPY.errorTitle}（{error}）
            </Text>
            <Button small onPress={() => void load()}>
              {COPY.retry}
            </Button>
          </View>
        )}
        {/* Loading only while nothing has failed yet; an error shows its own banner. */}
        {events === null && !error ? (
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center", padding: 8 }}>
            <ActivityIndicator size="small" color={colors.blueDark} />
            <Text style={s.muted}>{COPY.loading}</Text>
          </View>
        ) : null}
        {/* Virtualized: dense calendars mount only the visible rows, and the
            memoized EventRow skips the per-row Intl work on unrelated state
            flips (busy/truncated/error). */}
        <FlatList
          data={events}
          keyExtractor={(event) => event.id}
          renderItem={({ item }) => <EventRow event={item} zone={zone} />}
          contentContainerStyle={{ paddingHorizontal: 18, paddingVertical: 12, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={truncated ? <Text style={s.muted}>{COPY.truncatedList}</Text> : null}
          ListEmptyComponent={
            events === null ? null : <Text style={s.muted}>{COPY.emptyList}</Text>
          }
        />
      </View>
    </SafeAreaView>
  );
}

/**
 * Title + rendered range + all-day chip, all semantics delegated to
 * calendar-view. Memoized: event objects are identity-stable in collected and
 * zone never changes, so busy/truncated/error flips re-render zero rows.
 */
const EventRow = memo(function EventRow({
  event,
  zone,
}: {
  event: OpenBotCalendarEvent;
  zone: string;
}) {
  // eventRowView is the dirty-data guard: one bad event degrades its own row.
  const view = eventRowView(event, zone);
  return (
    <View style={styles.card}>
      <View style={s.between}>
        <Text style={s.heading}>{event.title || event.id}</Text>
        {event.allDay ? (
          <Text style={[chipBase, { backgroundColor: colors.sky, color: colors.blueDark }]}>
            {COPY.allDay}
          </Text>
        ) : null}
      </View>
      <Text style={s.small}>
        {view.range}
        {view.duration ? ` · ${view.duration}` : ""}
        {view.assumed ? ` · ${COPY.assumedZone}` : ""}
      </Text>
      {event.location ? <Text style={s.small}>{event.location}</Text> : null}
    </View>
  );
});
