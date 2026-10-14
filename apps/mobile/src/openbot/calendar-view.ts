/**
 * A03 pure calendar date logic (§4 fixtures). No react-native import: every
 * function runs in node:test and on every RN platform alike, because both
 * ship Intl with named-zone formatting (the app already leans on it — see
 * ui.tsx timeLabel). Presentation only: nothing here rewrites a stored
 * instant, and date-only all-day strings never touch the device zone.
 */
import type { OpenBotCalendarEvent } from "./types";

// Type-only; undefined under node:test (the typeof probe below stays safe).
declare const __DEV__: boolean;

/** True when a timed ISO carries Z or a ±hh:mm offset, pinning its instant. */
const hasExplicitOffset = (iso: string) => /[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso);

/**
 * Formatter construction is the hot path (up to a dozen per rendered row on
 * the naive-ISO path, and Hermes pays it visibly): each style+zone pair is
 * built once per module lifetime and reused. Safe because every style here
 * is locale- and option-fixed.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();
function cachedFormatter(key: string, build: () => Intl.DateTimeFormat): Intl.DateTimeFormat {
  const cached = formatterCache.get(key);
  if (cached) return cached;
  const fmt = build();
  formatterCache.set(key, fmt);
  return fmt;
}

/** The wall clock of `instant` in `zone`, as a UTC-anchored epoch ms, via Intl. */
function zonedWallMs(instant: number, zone: string): number {
  const parts = cachedFormatter(
    `wall\u0000${zone}`,
    () =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
  ).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
}

const secondFloor = (ms: number) => Math.floor(ms / 1000) * 1000;
const offsetMs = (instant: number, zone: string) =>
  zonedWallMs(instant, zone) - secondFloor(instant);

/**
 * Resolve one timed ISO to an epoch ms. An explicit offset parses exactly; a
 * naive ISO is read as a wall clock in `zone` (never the device zone — the
 * stored instant must not move when the user travels). Two offset passes give
 * two candidates; the one whose wall clock round-trips to the requested time
 * wins (an ambiguous fold picks the first occurrence this way). When neither
 * round-trips the time sits inside a DST gap, and the later candidate is the
 * standard normalize-forward reading.
 */
function instantOf(iso: string, zone?: string): number {
  if (hasExplicitOffset(iso)) return Date.parse(iso);
  const wall = Date.parse(`${iso}Z`);
  if (zone === undefined || !Number.isFinite(wall)) return Date.parse(iso);
  const first = wall - offsetMs(wall, zone);
  const second = wall - offsetMs(first, zone);
  if (zonedWallMs(second, zone) === wall) return second;
  if (zonedWallMs(first, zone) === wall) return first;
  return Math.max(first, second);
}

const timeLabel = (ms: number, zone: string) =>
  cachedFormatter(
    `time\u0000${zone}`,
    () =>
      new Intl.DateTimeFormat("zh-CN", {
        timeZone: zone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
  ).format(new Date(ms));

/** "3月8日" for an instant in the given zone (midnight-crossing labels). */
const dayLabelOf = (ms: number, zone: string) =>
  cachedFormatter(
    `day\u0000${zone}`,
    () => new Intl.DateTimeFormat("zh-CN", { timeZone: zone, month: "long", day: "numeric" }),
  ).format(new Date(ms));

/** Same calendar day in `zone`? Compares the zoned wall clock's day number. */
const sameDay = (a: number, b: number, zone: string) =>
  Math.floor(zonedWallMs(a, zone) / 86_400_000) === Math.floor(zonedWallMs(b, zone) / 86_400_000);

const dayLabel = (dateIso: string) =>
  cachedFormatter(
    "day\u0000UTC",
    () => new Intl.DateTimeFormat("zh-CN", { timeZone: "UTC", month: "long", day: "numeric" }),
  ).format(new Date(`${dateIso}T00:00:00Z`));

/** The zone to render in plus whether it was assumed (naive ISO) or pinned. */
export interface ResolvedZone {
  zone: string;
  assumed: boolean;
}

/**
 * Zone for one event's start given a fallback (the event's own timeZone, or
 * the device zone). An explicit offset pins the instant, so the fallback is
 * presentation-only; a naive ISO makes it an assumption the UI should mark —
 * but only when the fallback is the device default: a zone the event itself
 * declared is given, not assumed (fromEventTimeZone).
 */
export function zoneOf(dateIso: string, fallback: string, fromEventTimeZone = false): ResolvedZone {
  return {
    zone: fallback,
    assumed: !fromEventTimeZone && /T/.test(dateIso) && !hasExplicitOffset(dateIso),
  };
}

/**
 * Timed range "01:30–03:30" in the GIVEN zone. Equal instants collapse to a
 * single label; a range crossing midnight carries both day labels
 * ("3月8日 22:00–3月9日 02:00") so it can't read as a same-day slot. A naive
 * ISO is interpreted as a wall clock in `interpretZone` (the event's own
 * timeZone when it declares one), then displayed in `zone` — device travel
 * moves presentation, never the instant.
 */
export function renderTimedRange(
  start: string,
  end: string,
  zone: string,
  interpretZone = zone,
): string {
  const from = instantOf(start, interpretZone);
  const to = instantOf(end, interpretZone);
  const label = timeLabel(from, zone);
  if (from === to) return label;
  if (!sameDay(from, to, zone)) {
    return `${dayLabelOf(from, zone)} ${label}–${dayLabelOf(to, zone)} ${timeLabel(to, zone)}`;
  }
  return `${label}–${timeLabel(to, zone)}`;
}

/**
 * All-day range from date-only strings with an EXCLUSIVE end: "2026-03-08"→
 * "2026-03-09" is one day ("3月8日"); →"2026-03-11" spans three ("3月8日–3月10日").
 * Anchored at UTC, so no device zone can shift the dates.
 */
export function renderAllDay(start: string, end: string): string {
  const from = dayLabel(start);
  // The end is EXCLUSIVE: the last covered day is one before it.
  const last = new Date(Date.parse(`${end}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  if (!(last >= start)) return from; // empty or inverted range: the start day alone
  const to = dayLabel(last);
  return from === to ? from : `${from}–${to}`;
}

/** Real elapsed hours between two timed ISOs (DST-aware: the LA fixture is 1, not 2). */
export function durationHours(start: string, end: string, zone?: string): number {
  return (instantOf(end, zone) - instantOf(start, zone)) / 3_600_000;
}

/** Duration copy from hours: whole minutes, never a raw float like 0.333333. */
export function formatDurationHours(hours: number): string {
  if (!Number.isFinite(hours)) return ""; // Hermes: NaN flows in where V8 throws
  const minutes = Math.round(hours * 60);
  if (minutes <= 0) return "";
  const h = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (h === 0) return `${minutes} 分钟`;
  return rest === 0 ? `${h} 小时` : `${h} 小时 ${rest} 分`;
}

export interface EventRowView {
  /** Rendered range; on dirty data, the raw start/end strings. */
  range: string;
  /** Duration copy; empty for all-day, zero, or dirty data. */
  duration: string;
  /** True when the start's zone was an assumption (naive ISO). */
  assumed: boolean;
}

/**
 * The EventRow's whole computation, dirty-data-safe: the zod schema only
 * guarantees non-empty date strings, so an unparseable date or an invalid
 * timeZone throws below — and this row degrades to its raw strings instead
 * of crashing the whole screen (a retry would just re-fetch the same server
 * data, so there is nothing to heal from here).
 */
export function eventRowView(event: OpenBotCalendarEvent, zone: string): EventRowView {
  try {
    const resolved = zoneOf(event.start, event.timeZone || zone, Boolean(event.timeZone));
    if (
      !event.allDay &&
      (!Number.isFinite(instantOf(event.start, resolved.zone)) ||
        !Number.isFinite(instantOf(event.end, resolved.zone)))
    ) {
      // Unparseable timed dates do NOT throw on Hermes (Date.parse → NaN flows
      // through Intl without raising, unlike V8): throw here so the catch
      // degrades to the raw strings exactly as the row guard documents.
      throw new RangeError(`unparseable timed date: ${event.start} / ${event.end}`);
    }
    if (
      event.allDay &&
      (!Number.isFinite(Date.parse(`${event.start}T00:00:00Z`)) ||
        !Number.isFinite(Date.parse(`${event.end}T00:00:00Z`)))
    ) {
      // Same Hermes/V8 split as above, all-day twin: dayLabel(start) would
      // render garbage without raising while end's toISOString throws only
      // on V8 — validate both so the degradation is engine-independent.
      throw new RangeError(`unparseable all-day date: ${event.start} / ${event.end}`);
    }
    const range = event.allDay
      ? renderAllDay(event.start, event.end)
      : renderTimedRange(event.start, event.end, zone, resolved.zone);
    const duration = event.allDay
      ? ""
      : formatDurationHours(durationHours(event.start, event.end, resolved.zone));
    return { range, duration, assumed: resolved.assumed };
  } catch (e) {
    // The intended catch is dirty server data (RangeError → raw-string row),
    // but an internal regression would wear the same disguise; warn in dev so
    // "every row degraded" is distinguishable from real dirt. console is a
    // standard global, and __DEV__ is typeof-probed so node:test stays clean.
    if (typeof __DEV__ !== "undefined" && __DEV__)
      console.warn(`[calendar] event row degraded to raw strings (id=${event.id})`, e);
    return { range: `${event.start} – ${event.end}`, duration: "", assumed: false };
  }
}
