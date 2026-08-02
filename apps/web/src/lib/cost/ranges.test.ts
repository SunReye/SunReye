import { describe, expect, it } from "bun:test";
import {
  chartSpecFor,
  customCostRange,
  periodLabel,
  resolveCostPreset,
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

  it("charts this month by day", () => {
    expect(spec("month", "detail")).toEqual({
      from: local(2026, 4, 1),
      to: NOW.toISOString(),
      bucket: "day",
    });
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

describe("periodLabel", () => {
  it("labels an hour key with its wall-clock hour", () => {
    expect(periodLabel("2026-05-14T07", "hour")).toBe("07:00");
  });

  it("labels day and month keys through the locale formatter", () => {
    expect(periodLabel("2026-05-14", "day")).toBeTruthy();
    expect(periodLabel("2026-05", "month")).toBeTruthy();
  });
});
