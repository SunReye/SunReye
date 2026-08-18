import { describe, expect, it } from "bun:test";
import type { ManifestMetric } from "./types";
import {
  bucketForSpan,
  customRange,
  dayRange,
  filterMetrics,
  groupByCategory,
  isChartable,
  PRESETS,
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

  it("drops to hourly past a week", () => {
    expect(bucketForSpan(7 * DAY + 1)).toBe("hour");
    expect(bucketForSpan(365 * DAY)).toBe("hour");
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
    const r = resolvePreset("30d", NOW);
    expect(r.live).toBe(false);
    expect(r.from.getTime()).toBe(NOW.getTime() - 30 * DAY);
    expect(r.bucket).toBe("hour");
  });

  it("falls back to the first preset for an unknown id", () => {
    expect(resolvePreset("nonsense", NOW).id).toBe(PRESETS[0].id);
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

describe("dayRange", () => {
  it("covers one civil day from midnight, at minute resolution", () => {
    const r = dayRange(new Date(2026, 4, 14, 13, 37));
    expect(r.id).toBe("day");
    expect(r.from).toEqual(new Date(2026, 4, 14));
    expect(r.to).toEqual(new Date(2026, 4, 15));
    expect(r.bucket).toBe("minute");
  });

  it("reads the day in the zone it is given", () => {
    // Santiago springs forward AT midnight on 2026-09-06: the day begins at
    // 01:00, and a day built from the host's calendar cannot express that.
    const r = dayRange(new Date("2026-09-06T15:00:00Z"), "America/Santiago");
    expect(r.from.toISOString()).toBe("2026-09-06T04:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-09-07T03:00:00.000Z");
  });

  it("rolls over the end of a month", () => {
    expect(dayRange(new Date(2026, 0, 31, 9, 0)).to).toEqual(new Date(2026, 1, 1));
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
