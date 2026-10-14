import assert from "node:assert/strict";
import test from "node:test";
import { fetchCalendarEvents } from "../src/openbot/api.ts";
import {
  durationHours,
  eventRowView,
  formatDurationHours,
  renderAllDay,
  renderTimedRange,
  zoneOf,
} from "../src/openbot/calendar-view.ts";
import { openbotUrl } from "../src/openbot/config.ts";

/**
 * A03 pure date logic: the §4 fixtures. The LA DST event spans two wall clocks
 * (01:30→03:30) but only one real hour, because the offset moved underneath;
 * all-day ranges are date-only with an exclusive end, so they can never shift
 * with the device zone.
 */

const DST_START = "2026-03-08T01:30:00-08:00";
const DST_END = "2026-03-08T03:30:00-07:00";

test("LA DST fixture renders 01:30–03:30 and lasts exactly one hour", () => {
  assert.equal(renderTimedRange(DST_START, DST_END, "America/Los_Angeles"), "01:30–03:30");
  // Wall clocks span two hours; the instant gap is one (sprang forward at 02:00).
  assert.equal(durationHours(DST_START, DST_END), 1);
});

test("same instants render 05:30–06:30 in New York: presentation moves, duration does not", () => {
  // Plan said 04:30–05:30, but NY sprang forward at 07:00Z — before the 09:30Z
  // start — so the whole event sits in EDT (UTC-4). Intl agrees; the plan's
  // arithmetic assumed a fixed 5h offset. Spec only pins the LA rendering.
  assert.equal(renderTimedRange(DST_START, DST_END, "America/New_York"), "05:30–06:30");
  assert.equal(durationHours(DST_START, DST_END), 1);
});

test("all-day exclusive end: one-day span shows March 8 only, three-day shows 8–10", () => {
  assert.equal(renderAllDay("2026-03-08", "2026-03-09"), "3月8日");
  assert.equal(renderAllDay("2026-03-08", "2026-03-11"), "3月8日–3月10日");
});

test("all-day dates never shift with the device zone (e.g. Asia/Tokyo)", () => {
  // Date-only strings are anchored at UTC inside renderAllDay — there is no
  // zone parameter to get wrong, so a Tokyo device still reads March 8.
  assert.equal(renderAllDay("2026-03-08", "2026-03-09"), "3月8日");
  assert.equal(renderAllDay("2026-03-07", "2026-03-09"), "3月7日–3月8日");
});

test("timed ISO without an explicit zone renders in the fallback zone and is marked", () => {
  const resolved = zoneOf("2026-03-08T01:30:00", "Asia/Shanghai");
  assert.equal(resolved.zone, "Asia/Shanghai");
  assert.equal(resolved.assumed, true);
  // A naive ISO is read as a wall clock in the GIVEN zone, never the device zone:
  // 01:30 PST → 04:30 PDT spans three wall hours but two real ones.
  assert.equal(
    renderTimedRange("2026-03-08T01:30:00", "2026-03-08T04:30:00", "America/Los_Angeles"),
    "01:30–04:30",
  );
  assert.equal(
    durationHours("2026-03-08T01:30:00", "2026-03-08T04:30:00", "America/Los_Angeles"),
    2,
  );
  // An explicit offset pins the instant, so the zone is not an assumption.
  assert.equal(zoneOf(DST_START, "Asia/Shanghai").assumed, false);
});

test("a naive wall clock is read in the event's zone but displayed in the device zone", () => {
  // 01:30 LA wall clock = 09:30Z = 18:30 in Tokyo: travel moves the label, not
  // the instant. The end 02:30 sits in LA's spring-forward gap and normalizes
  // forward to 03:30 (= 10:30Z = 19:30 Tokyo).
  assert.equal(
    renderTimedRange(
      "2026-03-08T01:30:00",
      "2026-03-08T02:30:00",
      "Asia/Tokyo",
      "America/Los_Angeles",
    ),
    "18:30–19:30",
  );
});

test("zero-duration guard: one time label, duration 0", () => {
  assert.equal(renderTimedRange(DST_START, DST_START, "America/Los_Angeles"), "01:30");
  assert.equal(durationHours(DST_START, DST_START), 0);
});

test("a timed range crossing midnight carries both day labels; same-day stays time-only", () => {
  // March 10/11 sit safely past the March 8 spring-forward, so PDT (-07:00) holds.
  assert.equal(
    renderTimedRange(
      "2026-03-10T22:00:00-07:00",
      "2026-03-11T02:00:00-07:00",
      "America/Los_Angeles",
    ),
    "3月10日 22:00–3月11日 02:00",
  );
  assert.equal(renderTimedRange(DST_START, DST_END, "America/Los_Angeles"), "01:30–03:30");
});

test("duration copy renders whole minutes, never a raw float", () => {
  assert.equal(formatDurationHours(1), "1 小时");
  assert.equal(formatDurationHours(20 / 60), "20 分钟");
  assert.equal(formatDurationHours(2 + 1 / 3), "2 小时 20 分");
  assert.equal(formatDurationHours(0), "");
  assert.equal(formatDurationHours(-1), "");
});

test("a NaN duration never renders NaN copy (Hermes: Intl does not throw on invalid dates)", () => {
  // Hermes' Intl formats an Invalid Date instead of throwing (V8 throws
  // RangeError), so an unparseable timed date can flow into the duration as
  // NaN; the copy must stay empty, never "NaN 小时 NaN 分".
  assert.equal(formatDurationHours(NaN), "");
});

test("dirty events degrade to raw strings instead of throwing (per-row guard)", () => {
  // A naive start forces interpretation in the event's own (broken) zone.
  const badZone = {
    ...eventPage.events[0],
    start: "2026-03-08T01:30:00",
    end: "2026-03-08T03:30:00",
    timeZone: "Mars/Olympus_Mons",
    allDay: false,
  };
  const view = eventRowView(badZone, "Asia/Shanghai");
  assert.equal(view.range, `${badZone.start} – ${badZone.end}`);
  assert.equal(view.duration, "");
  assert.equal(view.assumed, false);

  const badDates = {
    ...eventPage.events[0],
    allDay: false,
    start: "not-a-date",
    end: "2026-03-09",
  };
  const view2 = eventRowView(badDates, "Asia/Shanghai");
  assert.equal(view2.range, `not-a-date – 2026-03-09`);

  // A healthy timed row still renders range + duration + assumption mark.
  const healthy = eventRowView(eventPage.events[0], "America/Los_Angeles");
  assert.equal(healthy.range, "01:30–03:30");
  assert.equal(healthy.duration, "1 小时");
  assert.equal(healthy.assumed, false);
});

const eventPage = {
  events: [
    {
      id: "e1",
      calendarId: "cal1",
      etag: '"v1"',
      title: "春季清理",
      start: "2026-03-08T01:30:00-08:00",
      end: "2026-03-08T03:30:00-07:00",
      allDay: false,
      timeZone: "America/Los_Angeles",
      location: "Los Angeles",
      description: "DST 切换日的日程",
      attendees: [{ email: "ada@example.com", name: "Ada" }],
    },
  ],
  nextCursor: null,
};

function patchFetch(body: unknown) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test("fetchCalendarEvents GETs the A01 endpoint with encoded timeMin/timeMax", async () => {
  const stubbed = patchFetch(eventPage);
  try {
    const page = await fetchCalendarEvents({
      timeMin: "2026-03-01T00:00:00Z",
      timeMax: "2026-04-01T00:00:00Z",
    });
    assert.equal(
      stubbed.calls[0],
      `${openbotUrl}/api/mobile/openmuse-calendar?timeMin=2026-03-01T00%3A00%3A00Z&timeMax=2026-04-01T00%3A00%3A00Z`,
    );
    assert.equal(page.events.length, 1);
    assert.equal(page.events[0].title, "春季清理");
    assert.deepEqual(page.events[0].attendees, [{ email: "ada@example.com", name: "Ada" }]);
    assert.equal(page.nextCursor, null);
  } finally {
    stubbed.restore();
  }
});

test("a nextCursor rides along when paging (A02 seam)", async () => {
  const stubbed = patchFetch({ events: [], nextCursor: "c2" });
  try {
    const page = await fetchCalendarEvents({
      timeMin: "2026-03-01T00:00:00Z",
      timeMax: "2026-04-01T00:00:00Z",
      cursor: "c1",
    });
    assert.ok(stubbed.calls[0].includes("cursor=c1"));
    assert.equal(page.nextCursor, "c2");
  } finally {
    stubbed.restore();
  }
});

test("a naive ISO in the event's own declared zone is not an assumption", () => {
  // assumed marks the DEVICE-default fallback only: when the event declares
  // its timeZone, the render zone is given, not assumed — the badge would
  // otherwise mislabel the event's own zone as "默认时区".
  assert.equal(zoneOf("2026-03-08T01:30:00", "America/Los_Angeles", true).assumed, false);
  assert.equal(zoneOf("2026-03-08T01:30:00", "Asia/Shanghai").assumed, true);
});

test("dirty all-day dates degrade to raw strings like timed ones", () => {
  // Hermes lets Date.parse NaN flow through Intl without throwing, so the
  // all-day branch must validate parseability itself (the timed branch does).
  const dirtyStart = {
    ...eventPage.events[0],
    allDay: true,
    start: "not-a-date",
    end: "2026-03-09",
  };
  const view = eventRowView(dirtyStart, "Asia/Shanghai");
  assert.equal(view.range, `not-a-date – 2026-03-09`);
  assert.equal(view.duration, "");

  const dirtyEnd = {
    ...eventPage.events[0],
    allDay: true,
    start: "2026-03-08",
    end: "garbage",
  };
  const view2 = eventRowView(dirtyEnd, "Asia/Shanghai");
  assert.equal(view2.range, `2026-03-08 – garbage`);
});
