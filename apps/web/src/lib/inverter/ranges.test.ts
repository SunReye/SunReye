import { describe, expect, it } from "bun:test";
import { periodWindow, type Grain } from "$lib/time/period";
import type { ManifestMetric } from "./types";
import {
  bucketForSpan,
  customRange,
  filterMetrics,
  groupByCategory,
  historyPeriodRange,
  historyRangeFor,
  isChartable,
  KEPT_PRESETS,
  resolvePreset,
} from "./ranges";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Mid-month, mid-year anchor so nothing lands on a boundary by accident:
// Thursday 2026-05-14 13:37 local.
const NOW = new Date(2026, 4, 14, 13, 37);

const BERLIN = "Europe/Berlin";

/** A boundary read back as wall-clock parts in the zone that produced it. */
function wall(instant: Date, timeZone: string): string {
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
}

const metric = (over: Partial<ManifestMetric> = {}): ManifestMetric => ({
  key: "pv1_power",
  topic: "pv1/power",
  label: "PV1 power",
  unit: "W",
  group: "solar",
  kind: "measurement",
  writable: false,
  ...over,
});

describe("bucketForSpan", () => {
  it("keeps minute resolution up to and including a week", () => {
    expect(bucketForSpan(HOUR)).toBe("minute");
    expect(bucketForSpan(7 * DAY)).toBe("minute");
  });

  it("drops to hourly past a week, up to and including two months", () => {
    expect(bucketForSpan(7 * DAY + 1)).toBe("hour");
    expect(bucketForSpan(60 * DAY)).toBe("hour");
  });

  it("drops to daily past two months, so a Year window is ~365 points not 8760", () => {
    // The Year tab asks for a whole year on the history page, and the page
    // mounts a chart per metric card — around a hundred of them on a Deye.
    // Hourly there is 8760 points EACH: the fetch alone is megabytes and the
    // chart has ~24 points per rendered pixel, none of which are visible.
    expect(bucketForSpan(60 * DAY + 1)).toBe("day");
    expect(bucketForSpan(365 * DAY)).toBe("day");
    expect(bucketForSpan(3 * 365 * DAY)).toBe("day");
  });
});

describe("resolvePreset", () => {
  it("resolves live to the trailing five-minute buffer", () => {
    const r = resolvePreset("live", NOW);
    expect(r.live).toBe(true);
    expect(r.bucket).toBe("minute");
    expect(r.to).toBe(NOW);
    expect(NOW.getTime() - r.from.getTime()).toBe(5 * 60_000);
  });

  it("anchors an hours preset at `now` and derives its bucket from the span", () => {
    const r = resolvePreset("14d", NOW);
    expect(r.live).toBe(false);
    expect(r.from.getTime()).toBe(NOW.getTime() - 14 * DAY);
    expect(r.bucket).toBe("hour");
  });

  it("keeps 6mo on HOURLY bars — a kept preset still shows what it showed", () => {
    // The four kept presets were kept, not redefined. 6mo has always been ~4368
    // hourly points; `bucketForSpan` growing a `> 60d -> day` arm for the Year
    // GRAIN silently re-cut it to ~182 daily ones, which is a different chart
    // wearing the same name. The preset states its own granularity so the two
    // callers cannot trade answers again.
    const r = resolvePreset("6mo", NOW);
    expect(r.bucket).toBe("hour");
    expect(r.from.getTime()).toBe(NOW.getTime() - 182 * DAY);
  });

  it("falls back to the live buffer for an unknown id", () => {
    expect(resolvePreset("nonsense", NOW).id).toBe("live");
    expect(resolvePreset("nonsense", NOW).live).toBe(true);
  });

  it("keeps only the rolling windows no calendar grain can express", () => {
    // The period navigator's four tabs ARE 24h / a week / a month / a year, so
    // the presets that named those windows are the tabs now and the ids are
    // gone. What is kept is what a calendar cannot say: an hour, six hours,
    // fourteen days, six months.
    expect(KEPT_PRESETS.map((p) => p.id)).toEqual(["1h", "6h", "14d", "6mo"]);
    // …and the popover list is the preset table minus the live buffer, not a
    // second hand-written list that could drift from it: the live range is
    // reachable only by standing on the current day.
    expect(KEPT_PRESETS.every((p) => p.live !== true)).toBe(true);
    for (const preset of KEPT_PRESETS) expect(resolvePreset(preset.id, NOW).live).toBe(false);
  });
});

describe("customRange — the exclusive end is the next civil midnight", () => {
  it("extends an inclusive last day to the following midnight", () => {
    const r = customRange(new Date(2026, 4, 11), new Date(2026, 4, 14));
    expect(r.id).toBe("custom");
    expect(r.live).toBe(false);
    expect(r.from).toEqual(new Date(2026, 4, 11));
    expect(r.to).toEqual(new Date(2026, 4, 15));
  });

  it("labels the days the user picked, not the exclusive end", () => {
    const r = customRange(new Date(2026, 4, 11), new Date(2026, 4, 14));
    expect(r.label).toContain("11");
    expect(r.label).toContain("14");
    expect(r.label).not.toContain("15");
  });

  it("does not overshoot into the next day on a 23-hour day", () => {
    // Berlin springs forward on 2026-03-29: the day is 23 hours long, so
    // `toInclusive + 86_400_000` lands at 01:00 on the 30th and drags an hour of
    // the next day into the window.
    const from = new Date("2026-03-22T23:00:00Z"); // 2026-03-23 00:00 Berlin
    const toInclusive = new Date("2026-03-28T23:00:00Z"); // 2026-03-29 00:00 Berlin
    const r = customRange(from, toInclusive, BERLIN);
    expect(wall(r.to, BERLIN)).toBe("2026-03-30 00:00");
    expect(r.to.toISOString()).toBe("2026-03-29T22:00:00.000Z");
  });

  it("does not drop the last hour of a 25-hour day", () => {
    // Berlin falls back on 2026-10-25: the day is 25 hours long, so
    // `toInclusive + 86_400_000` ends at 23:00 and silently loses an hour of the
    // day the user actually picked.
    const from = new Date("2026-10-18T22:00:00Z"); // 2026-10-19 00:00 Berlin
    const toInclusive = new Date("2026-10-24T22:00:00Z"); // 2026-10-25 00:00 Berlin
    const r = customRange(from, toInclusive, BERLIN);
    expect(wall(r.to, BERLIN)).toBe("2026-10-26 00:00");
    expect(r.to.toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });

  it("buckets on the corrected span, so a 169-hour week is hourly", () => {
    // Seven civil days across a fall-back really are 169 hours of minute
    // samples — past the ≤7-day minute budget, which the truncated 168-hour
    // window used to slip under.
    const r = customRange(
      new Date("2026-10-18T22:00:00Z"),
      new Date("2026-10-24T22:00:00Z"),
      BERLIN,
    );
    expect(r.to.getTime() - r.from.getTime()).toBe(7 * DAY + HOUR);
    expect(r.bucket).toBe("hour");
  });

  it("still buckets a plain week at minute resolution", () => {
    const r = customRange(new Date(2026, 4, 8), new Date(2026, 4, 14));
    expect(r.to.getTime() - r.from.getTime()).toBe(7 * DAY);
    expect(r.bucket).toBe("minute");
  });

  it("covers a single picked day", () => {
    const r = customRange(new Date(2026, 4, 14), new Date(2026, 4, 14));
    expect(r.to).toEqual(new Date(2026, 4, 15));
    expect(r.bucket).toBe("minute");
  });
});

describe("isChartable", () => {
  it("charts measurements and cumulatives only", () => {
    expect(isChartable(metric({ kind: "measurement" }))).toBe(true);
    expect(isChartable(metric({ kind: "cumulative" }))).toBe(true);
    expect(isChartable(metric({ kind: "status" }))).toBe(false);
    expect(isChartable(metric({ kind: "setting" }))).toBe(false);
  });
});

describe("filterMetrics", () => {
  const metrics = [
    metric({ key: "pv1_power", label: "PV1 power" }),
    metric({ key: "battery_soc", label: "Battery SOC" }),
  ];

  it("hands back everything for an empty query", () => {
    expect(filterMetrics(metrics, "  ")).toBe(metrics);
  });

  it("matches label or key, case-insensitively", () => {
    expect(filterMetrics(metrics, "BATTERY").map((m) => m.key)).toEqual(["battery_soc"]);
    expect(filterMetrics(metrics, "pv1_p").map((m) => m.key)).toEqual(["pv1_power"]);
    expect(filterMetrics(metrics, "zzz")).toEqual([]);
  });
});

describe("groupByCategory", () => {
  it("groups by canonical role prefix, alphabetically, keeping metric order", () => {
    const metrics = [
      metric({ key: "pv1", role: "pv.total.power" }),
      metric({ key: "pv2", role: "pv.string.power" }),
      metric({ key: "soc", role: "battery.soc" }),
    ];
    expect(groupByCategory(metrics).map(([cat, ms]) => [cat, ms.map((m) => m.key)])).toEqual([
      ["Battery", ["soc"]],
      ["Solar", ["pv1", "pv2"]],
    ]);
  });

  it("falls back to a capitalised group when there is no known role", () => {
    expect(groupByCategory([metric({ role: undefined, group: "solar" })])[0][0]).toBe("Solar");
    expect(groupByCategory([metric({ role: undefined, group: "" })])[0][0]).toBe("Other");
  });
});

describe("historyRangeFor — a calendar period as a history window", () => {
  const OPTS = { timeZone: BERLIN, weekStartsOn: 1 as const };
  const period = (instant: Date, grain: Grain) => periodWindow(instant, grain, OPTS);

  it("carries the period's own bounds, never the live buffer", () => {
    const day = period(NOW, "day");
    const range = historyRangeFor(day, BERLIN);
    expect(range.live).toBe(false);
    expect(range.from).toEqual(day.start);
    expect(range.to).toEqual(day.end);
  });

  it("identifies itself by its grain, so the page can tell the four apart", () => {
    expect(historyRangeFor(period(NOW, "day"), BERLIN).id).toBe("day");
    expect(historyRangeFor(period(NOW, "week"), BERLIN).id).toBe("week");
    expect(historyRangeFor(period(NOW, "month"), BERLIN).id).toBe("month");
    expect(historyRangeFor(period(NOW, "year"), BERLIN).id).toBe("year");
  });

  it("buckets by GRAIN, so a year is affordable and a week is not coarse", () => {
    // A year of hourly rollups is 8760 points per metric card, on a page that
    // mounts one per metric — so the Year grain is daily. Every other grain is
    // the finest resolution its point count affords.
    expect(historyRangeFor(period(NOW, "day"), BERLIN).bucket).toBe("minute");
    expect(historyRangeFor(period(NOW, "week"), BERLIN).bucket).toBe("minute");
    expect(historyRangeFor(period(NOW, "month"), BERLIN).bucket).toBe("hour");
    expect(historyRangeFor(period(NOW, "year"), BERLIN).bucket).toBe("day");
  });

  it("keeps a 169-hour fall-back week on minute rollups, like every other week", () => {
    // The Week tab must not silently draw coarser data one week a year. A
    // calendar week containing Berlin's October fall-back really is 169 hours,
    // which is past `bucketForSpan`'s ≤7-day minute budget — so the grain
    // decides the bucket and the raw span does not.
    const dstWeek = period(new Date("2026-10-21T12:00:00Z"), "week");
    expect(dstWeek.end.getTime() - dstWeek.start.getTime()).toBe(7 * DAY + HOUR);
    expect(historyRangeFor(dstWeek, BERLIN).bucket).toBe("minute");
    expect(historyRangeFor(period(NOW, "week"), BERLIN).bucket).toBe("minute");
  });

  it("labels itself from the period, in the zone it was resolved in", () => {
    expect(historyRangeFor(period(new Date(2026, 2, 17), "month"), BERLIN).label).toBe("Mar 2026");
  });

  it("keeps a spring-forward day one civil day long", () => {
    // 29 March 2026 is 23 hours in Berlin. A window built by adding 86_400_000
    // would end at 01:00 on the 30th and price an hour of the next day.
    const dst = historyRangeFor(period(new Date("2026-03-29T09:00:00Z"), "day"), BERLIN);
    expect(wall(dst.from, BERLIN)).toBe("2026-03-29 00:00");
    expect(wall(dst.to, BERLIN)).toBe("2026-03-30 00:00");
  });

  it("does not change what customRange already returns", () => {
    // Additive only: the adapter is a new door into the same model.
    expect(customRange(new Date(2026, 4, 1), new Date(2026, 4, 3), BERLIN).id).toBe("custom");
  });
});

describe("historyPeriodRange — what /history renders for a calendar period", () => {
  const OPTS = { timeZone: BERLIN, weekStartsOn: 1 as const };
  const period = (instant: Date, grain: Grain) => periodWindow(instant, grain, OPTS);

  it("is the realtime buffer on the day holding now — standing on today IS live", () => {
    // The design has no "Live" tab: the reader is live because they are standing
    // on the current period, and on a DAY that has to mean the gliding chart the
    // deleted `live` preset used to reach. `range.live` forks the render path in
    // four components, and this is the only thing that still turns it on.
    const range = historyPeriodRange(period(NOW, "day"), NOW, BERLIN);
    expect(range.live).toBe(true);
    expect(range.bucket).toBe("minute");
    expect(NOW.getTime() - range.from.getTime()).toBe(5 * 60_000);
  });

  it("is a rollup window on any other day", () => {
    const yesterday = period(new Date(NOW.getTime() - DAY), "day");
    const range = historyPeriodRange(yesterday, NOW, BERLIN);
    expect(range.live).toBe(false);
    expect(range.id).toBe("day");
    expect(range.from).toEqual(yesterday.start);
    expect(range.to).toEqual(yesterday.end);
  });

  it("is never live above day grain, current period or not", () => {
    // A five-minute trailing sparkline is not what "this month" means. The
    // navigator still prints the live pill and kills the forward arrow there —
    // that signal is `containsNow`, and it is not this decision.
    for (const grain of ["week", "month", "year"] as const) {
      const range = historyPeriodRange(period(NOW, grain), NOW, BERLIN);
      expect(range.live).toBe(false);
      expect(range.id).toBe(grain);
    }
  });

  it("stays live at the day's first and last instant", () => {
    const today = period(NOW, "day");
    expect(historyPeriodRange(today, today.start, BERLIN).live).toBe(true);
    expect(historyPeriodRange(today, new Date(today.end.getTime() - 1), BERLIN).live).toBe(true);
    expect(historyPeriodRange(today, today.end, BERLIN).live).toBe(false);
  });
});
