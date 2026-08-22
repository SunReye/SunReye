import { describe, expect, it } from "bun:test";
import { browserTimeZone } from "$lib/time/browser-zone";
import { periodWindow, type Grain } from "$lib/time/period";
import {
  barBandPadding,
  chartSpecFor,
  COST_PRESETS,
  costRangeFor,
  customCostRange,
  periodKeyLabel,
  resolveCostPreset,
  specQuery,
  type ChartScope,
} from "./ranges";

// Mid-month, mid-year anchor so month/year arithmetic never lands on a boundary
// by accident: Thursday 2026-05-14 13:37 local.
const NOW = new Date(2026, 4, 14, 13, 37);

/** The spec a preset renders at one scope, as compact literals. */
const spec = (id: string, scope: ChartScope) => {
  const s = chartSpecFor(resolveCostPreset(id, NOW), scope);
  return { from: s.from.toISOString(), to: s.to.toISOString(), bucket: s.bucket };
};

/** The calendar period holding `NOW` in the host's zone — a navigator tab. */
const hostPeriod = (grain: Grain) =>
  costRangeFor(periodWindow(NOW, grain, { timeZone: browserTimeZone() }), NOW);

/** Local midnight as an ISO string — the boundaries the builders produce. */
const local = (year: number, month: number, day: number): string =>
  new Date(year, month, day).toISOString();

describe("COST_PRESETS — what survives the period navigator", () => {
  it("keeps only the rolling window no calendar grain can express", () => {
    // Today is the Day tab, this month the Month tab, last month the Month tab
    // plus one back-press, this year the Year tab. Those preset ids are the
    // navigator now. A rolling seven days is not a calendar week, so it stays.
    expect(COST_PRESETS.map((p) => p.id)).toEqual(["7d"]);
  });

  it("falls back to the kept preset for an unknown id", () => {
    expect(resolveCostPreset("nonsense", NOW).id).toBe("7d");
  });
});

describe("resolveCostPreset — the rolling seven days", () => {
  it("details the window by day, from six days back", () => {
    expect(spec("7d", "detail")).toEqual({
      from: local(2026, 4, 8),
      to: local(2026, 4, 15),
      bucket: "day",
    });
  });

  it("runs to the END of today, not to the instant it was picked", () => {
    // `$lib/statistics/live#includesNow` is `containsNow` over `[from, to)` now,
    // with no id list beside it. A window clamped at the pick instant stops
    // containing `now` one tick later, so the live lease would drop and the
    // tiles would freeze — which is exactly what the id list existed to paper
    // over. Ending at the day's exclusive midnight also makes `windowDays`
    // exactly 7 instead of 6 or 7 depending on the time of day.
    const range = resolveCostPreset("7d", NOW);
    expect(range.to.toISOString()).toBe(local(2026, 4, 15));
    expect(range.to.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("contextualizes against the calendar month it sits in", () => {
    expect(spec("7d", "context")).toEqual({
      from: local(2026, 4, 1),
      to: NOW.toISOString(),
      bucket: "day",
    });
  });

  it("captions both scopes distinctly", () => {
    const range = resolveCostPreset("7d", NOW);
    expect(range.detail.caption).toBe("Last 7 days, by day");
    expect(range.chart.caption).toBe("This month, by day");
  });

  it("keeps `chart` as the context spec for pre-switcher callers", () => {
    const range = resolveCostPreset("7d", NOW);
    expect(chartSpecFor(range, "context")).toBe(range.chart);
    expect(chartSpecFor(range, "detail")).toBe(range.detail);
  });
});

describe("customCostRange", () => {
  const range = customCostRange(new Date(2026, 2, 3), new Date(2026, 2, 9), NOW);

  it("details the picked span by day, with `to` pushed past the last day", () => {
    expect(range.detail).toMatchObject({
      from: new Date(2026, 2, 3),
      to: new Date(2026, 2, 10),
      bucket: "day",
    });
  });

  it("contextualizes a custom span against the trailing 12 months", () => {
    expect(range.chart.bucket).toBe("month");
    expect(range.chart.from.toISOString()).toBe(local(2025, 5, 1));
  });
});

describe("customCostRange — the exclusive end is the next civil midnight", () => {
  const BERLIN = "Europe/Berlin";

  /** A boundary read back as wall-clock parts in the zone that produced it. */
  const wall = (instant: Date, timeZone: string): string => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(instant)
        .map((x) => [x.type, x.value]),
    );
    return `${p.year}-${p.month}-${p.day} ${String(Number(p.hour) % 24).padStart(2, "0")}:${p.minute}`;
  };

  it("does not overshoot into the next day on a 23-hour day", () => {
    // Berlin springs forward on 2026-03-29, so `toInclusive + 86_400_000` lands
    // at 01:00 on the 30th and prices an hour that belongs to the next day.
    const range = customCostRange(
      new Date("2026-03-22T23:00:00Z"), // 2026-03-23 00:00 Berlin
      new Date("2026-03-28T23:00:00Z"), // 2026-03-29 00:00 Berlin
      NOW,
      BERLIN,
    );
    expect(wall(range.to, BERLIN)).toBe("2026-03-30 00:00");
    expect(range.detail.to.toISOString()).toBe("2026-03-29T22:00:00.000Z");
  });

  it("does not drop the last hour on a 25-hour day", () => {
    // Berlin falls back on 2026-10-25: an hour of the day the user picked was
    // silently missing from the tiles and from the daily bars.
    const range = customCostRange(
      new Date("2026-10-18T22:00:00Z"), // 2026-10-19 00:00 Berlin
      new Date("2026-10-24T22:00:00Z"), // 2026-10-25 00:00 Berlin
      NOW,
      BERLIN,
    );
    expect(wall(range.to, BERLIN)).toBe("2026-10-26 00:00");
    expect(range.detail.to.toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });

  it("still takes its trailing-12-month context from `now`, not from the zone", () => {
    // The third parameter is the context anchor. Passing a zone must not
    // displace it — the context chart would silently re-anchor on today.
    const range = customCostRange(
      new Date("2026-10-18T22:00:00Z"),
      new Date("2026-10-24T22:00:00Z"),
      NOW,
      BERLIN,
    );
    expect(range.chart.caption).toBe("Last 12 months");
    expect(range.chart.to).toBe(NOW);
    expect(range.chart.from.toISOString()).toBe(local(2025, 5, 1));
  });
});

describe("periodKeyLabel", () => {
  it("labels an hour key with its wall-clock hour", () => {
    expect(periodKeyLabel("2026-05-14T07", "hour")).toBe("07:00");
  });

  it("labels day and month keys through the locale formatter", () => {
    expect(periodKeyLabel("2026-05-14", "day")).toBe("May 14");
    expect(periodKeyLabel("2026-05", "month")).toBe("May");
  });

  it("falls back to the raw key when it doesn't match the bucket", () => {
    // A scope switch changes the bucket before the refetch lands, so the chart
    // can briefly hold day keys while asking for month labels. Intl throws on
    // the invalid Date that produces — one odd tick beats a blank page.
    expect(periodKeyLabel("2026-05-14", "month")).toBe("2026-05-14");
    expect(periodKeyLabel("2026-05", "day")).toBe("2026-05");
  });
});

describe("specQuery", () => {
  it("sends the picked window as the three parameters the series endpoints take", () => {
    // The two boundaries are LOCAL Dates, and the endpoints are queried in UTC:
    // serializing them any other way asks the server for someone else's day.
    const range = hostPeriod("day");
    expect(specQuery(range.detail)).toEqual({
      from: new Date(2026, 4, 14).toISOString(),
      to: new Date(2026, 4, 15).toISOString(),
      bucket: "hour",
    });
  });

  it("carries the scope's own bucket, not the picked range's", () => {
    // Detail and context are fetched separately; a query that reused the other
    // scope's bucket would label month keys as days (see periodKeyLabel's fallback).
    const range = hostPeriod("day");
    expect(specQuery(range.chart)).toEqual({
      from: new Date(2026, 4, 1).toISOString(),
      to: NOW.toISOString(),
      bucket: "day",
    });
  });

  it("keeps a custom range's exclusive end past the last picked day", () => {
    const range = customCostRange(new Date(2026, 2, 3), new Date(2026, 2, 9), NOW);
    expect(specQuery(range.detail).to).toBe(new Date(2026, 2, 10).toISOString());
  });
});

describe("barBandPadding", () => {
  it("fattens the padding for a window of a handful of bars", () => {
    // A two-bucket window (a fresh month, a two-day custom range) otherwise
    // renders bars half the viewport wide.
    expect(barBandPadding(1, 0.2)).toBe(0.6);
    expect(barBandPadding(4, 0.2)).toBe(0.6);
  });

  it("hands a busy axis back its own spacing", () => {
    expect(barBandPadding(5, 0.2)).toBe(0.2);
    expect(barBandPadding(31, 0.25)).toBe(0.25);
  });

  it("treats an empty series as the narrow case rather than dividing by nothing", () => {
    expect(barBandPadding(0, 0.2)).toBe(0.6);
  });
});

describe("costRangeFor — a calendar period as a statistics range", () => {
  const BERLIN = "Europe/Berlin";
  const OPTS = { timeZone: BERLIN, weekStartsOn: 1 as const };
  const period = (instant: Date, grain: Grain) => periodWindow(instant, grain, OPTS);
  const at = (range: { from: Date; to: Date }) => ({
    from: range.from.toISOString(),
    to: range.to.toISOString(),
  });

  it("prices the WHOLE period, not the part of it that has happened", () => {
    // `to: now` was right for a preset that means "this month so far"; here it
    // is a bug. `includesNow` leases the live feed while `range.to > now`, so a
    // window clamped to the instant it was built stops being live one tick
    // later and the tiles freeze.
    const month = period(NOW, "month");
    expect(at(costRangeFor(month, NOW, BERLIN))).toEqual(at({ from: month.start, to: month.end }));
    expect(costRangeFor(month, NOW, BERLIN).to.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("identifies itself by its grain", () => {
    expect(costRangeFor(period(NOW, "day"), NOW, BERLIN).id).toBe("day");
    expect(costRangeFor(period(NOW, "year"), NOW, BERLIN).id).toBe("year");
  });

  it("buckets the detail chart inside the period", () => {
    const detail = (grain: Grain) => costRangeFor(period(NOW, grain), NOW, BERLIN).detail;
    expect(detail("day").bucket).toBe("hour");
    expect(detail("week").bucket).toBe("day");
    expect(detail("month").bucket).toBe("day");
    expect(detail("year").bucket).toBe("month");
  });

  it("plots the detail chart across the whole period, so the axis is settled", () => {
    const month = period(NOW, "month");
    expect(at(costRangeFor(month, NOW, BERLIN).detail)).toEqual(
      at({ from: month.start, to: month.end }),
    );
  });

  it("zooms the context chart one level out from the period, as the presets do", () => {
    const context = (grain: Grain) => costRangeFor(period(NOW, grain), NOW, BERLIN).chart;
    // A day or a week reads against the month it sits in…
    expect(at(context("day"))).toEqual({ from: local(2026, 4, 1), to: NOW.toISOString() });
    expect(context("day").bucket).toBe("day");
    expect(at(context("week"))).toEqual({ from: local(2026, 4, 1), to: NOW.toISOString() });
    // …a month against the trailing twelve, a year against the trailing 24.
    expect(at(context("month"))).toEqual({ from: local(2025, 5, 1), to: NOW.toISOString() });
    expect(context("month").bucket).toBe("month");
    expect(at(context("year"))).toEqual({ from: local(2024, 5, 1), to: NOW.toISOString() });
  });

  it("captions the detail chart with the period it is plotting", () => {
    expect(costRangeFor(period(NOW, "day"), NOW, BERLIN).detail.caption).toBe("Today, by hour");
    expect(costRangeFor(period(NOW, "month"), NOW, BERLIN).detail.caption).toBe("May 2026, by day");
    expect(costRangeFor(period(NOW, "year"), NOW, BERLIN).detail.caption).toBe("2026, by month");
  });

  it("labels itself from the period", () => {
    expect(costRangeFor(period(NOW, "month"), NOW, BERLIN).label).toBe("May 2026");
    expect(costRangeFor(period(NOW, "day"), NOW, BERLIN).label).toBe("Today");
  });

  it("keeps a spring-forward day one civil day long", () => {
    const day = period(new Date("2026-03-29T09:00:00Z"), "day");
    const range = costRangeFor(day, NOW, BERLIN);
    expect(range.from.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-03-29T22:00:00.000Z");
  });

  it("leaves customCostRange's parameters exactly where they were", () => {
    // A previous attempt at this file repurposed the third parameter of
    // `customCostRange`, which is `now` and anchors the trailing-12-month
    // context chart. Additive only.
    const custom = customCostRange(new Date(2026, 2, 3), new Date(2026, 2, 9), NOW);
    expect(custom.id).toBe("custom");
    expect(custom.chart.from.toISOString()).toBe(local(2025, 5, 1));
    expect(custom.detail.bucket).toBe("day");
  });
});
