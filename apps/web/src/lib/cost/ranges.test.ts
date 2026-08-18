import { describe, expect, it } from "bun:test";
import {
  barBandPadding,
  chartSpecFor,
  customCostRange,
  periodLabel,
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

/** Local midnight as an ISO string — the boundaries the builders produce. */
const local = (year: number, month: number, day: number): string =>
  new Date(year, month, day).toISOString();

describe("chartSpecFor — detail scope buckets inside the picked window", () => {
  it("charts today by hour", () => {
    expect(spec("today", "detail")).toEqual({
      from: local(2026, 4, 14),
      to: NOW.toISOString(),
      bucket: "hour",
    });
  });

  it("charts the last 7 days by day, starting six days back", () => {
    expect(spec("7d", "detail")).toEqual({
      from: local(2026, 4, 8),
      to: NOW.toISOString(),
      bucket: "day",
    });
  });

  it("charts this month by day, across the whole month", () => {
    // Past today, so the axis is a settled month with today's bar advancing
    // across it rather than a chart that grows a column a day.
    expect(spec("month", "detail")).toEqual({
      from: local(2026, 4, 1),
      to: local(2026, 5, 1),
      bucket: "day",
    });
  });

  it("keeps the month TILES on the month so far", () => {
    // Only the chart runs ahead: you cannot total a month that hasn't happened.
    expect(resolveCostPreset("month", NOW).to.toISOString()).toBe(NOW.toISOString());
  });

  it("charts last month by day, ending at this month's first", () => {
    expect(spec("lastMonth", "detail")).toEqual({
      from: local(2026, 3, 1),
      to: local(2026, 4, 1),
      bucket: "day",
    });
  });

  it("charts this year by month", () => {
    expect(spec("year", "detail")).toEqual({
      from: local(2026, 0, 1),
      to: NOW.toISOString(),
      bucket: "month",
    });
  });
});

describe("chartSpecFor — context scope zooms one level out", () => {
  it("puts a single day in its calendar month, by day", () => {
    expect(spec("today", "context")).toEqual({
      from: local(2026, 4, 1),
      to: NOW.toISOString(),
      bucket: "day",
    });
  });

  it("puts a week in its calendar month, by day", () => {
    expect(spec("7d", "context")).toEqual(spec("today", "context"));
  });

  it("puts a month in the trailing 12 months, by month", () => {
    expect(spec("month", "context")).toEqual({
      from: local(2025, 5, 1),
      to: NOW.toISOString(),
      bucket: "month",
    });
  });

  it("puts last month in the same trailing 12 months", () => {
    expect(spec("lastMonth", "context")).toEqual(spec("month", "context"));
  });

  it("puts a year in the trailing 24 months, by month", () => {
    expect(spec("year", "context")).toEqual({
      from: local(2024, 5, 1),
      to: NOW.toISOString(),
      bucket: "month",
    });
  });
});

describe("chartSpecFor — captions and fallbacks", () => {
  it("keeps `chart` as the context spec for pre-switcher callers", () => {
    const range = resolveCostPreset("month", NOW);
    expect(chartSpecFor(range, "context")).toBe(range.chart);
    expect(chartSpecFor(range, "detail")).toBe(range.detail);
  });

  it("captions both scopes of one range distinctly", () => {
    const range = resolveCostPreset("year", NOW);
    expect(range.detail.caption).toBe("This year, by month");
    expect(range.chart.caption).toBe("Last 24 months");
  });

  it("falls back to this month for an unknown preset id", () => {
    expect(spec("nonsense", "detail")).toEqual(spec("month", "detail"));
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

describe("periodLabel", () => {
  it("labels an hour key with its wall-clock hour", () => {
    expect(periodLabel("2026-05-14T07", "hour")).toBe("07:00");
  });

  it("labels day and month keys through the locale formatter", () => {
    expect(periodLabel("2026-05-14", "day")).toBe("May 14");
    expect(periodLabel("2026-05", "month")).toBe("May");
  });

  it("falls back to the raw key when it doesn't match the bucket", () => {
    // A scope switch changes the bucket before the refetch lands, so the chart
    // can briefly hold day keys while asking for month labels. Intl throws on
    // the invalid Date that produces — one odd tick beats a blank page.
    expect(periodLabel("2026-05-14", "month")).toBe("2026-05-14");
    expect(periodLabel("2026-05", "day")).toBe("2026-05");
  });
});

describe("specQuery", () => {
  it("sends the picked window as the three parameters the series endpoints take", () => {
    // The two boundaries are LOCAL Dates, and the endpoints are queried in UTC:
    // serializing them any other way asks the server for someone else's day.
    const range = resolveCostPreset("today", NOW);
    expect(specQuery(range.detail)).toEqual({
      from: new Date(2026, 4, 14).toISOString(),
      to: NOW.toISOString(),
      bucket: "hour",
    });
  });

  it("carries the scope's own bucket, not the picked range's", () => {
    // Detail and context are fetched separately; a query that reused the other
    // scope's bucket would label month keys as days (see periodLabel's fallback).
    const range = resolveCostPreset("today", NOW);
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
