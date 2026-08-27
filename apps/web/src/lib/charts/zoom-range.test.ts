/**
 * Phase 4: what a zoom gesture MEANS.
 *
 * A brush selection is two numbers. Turning it into something the app can act on
 * is the whole of the feature, and none of it belongs in a `.svelte` file:
 * zooming into twenty minutes of hourly buckets has to REFETCH at minute
 * resolution, or the user has magnified four fat bars instead of seeing what
 * happened. So the mapping lives here, and the components only wire it up.
 *
 * Time zones are passed explicitly and every instant is written as UTC. Flipping
 * `process.env.TZ` inside a test leaks into every file that runs after it (see
 * AGENTS.md), and the DST cases below are exactly the ones that would then fail
 * only in the full run.
 */

import { describe, expect, test } from "bun:test";
import {
  activeSpec,
  bandIndexRange,
  labelOptionsFrom,
  minExtentFor,
  MIN_BAND_EXTENT,
  zoomSpanLabel,
  zoomedChartSpec,
  zoomAnchor,
  zoomedHistoryRange,
  zoomedHistoryRangeFrom,
} from "./zoom-range";
import type { ChartSpec } from "../cost/ranges";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const at = (iso: string) => new Date(iso);

describe("zoomedHistoryRange", () => {
  test("a sub-hour window refetches at minute resolution", () => {
    const range = zoomedHistoryRange(at("2026-08-01T10:00:00Z"), at("2026-08-01T10:20:00Z"));
    expect(range?.bucket).toBe("minute");
    expect(range?.from.toISOString()).toBe("2026-08-01T10:00:00.000Z");
    expect(range?.to.toISOString()).toBe("2026-08-01T10:20:00.000Z");
  });

  test("the zoomed window is never the live buffer, and is its own range id", () => {
    const range = zoomedHistoryRange(at("2026-08-01T10:00:00Z"), at("2026-08-01T10:20:00Z"));
    expect(range?.live).toBe(false);
    expect(range?.id).toBe("zoom");
  });

  test("a right-to-left drag selects the same window as a left-to-right one", () => {
    const forward = zoomedHistoryRange(at("2026-08-01T10:00:00Z"), at("2026-08-01T11:00:00Z"));
    const backward = zoomedHistoryRange(at("2026-08-01T11:00:00Z"), at("2026-08-01T10:00:00Z"));
    expect(backward).toEqual(forward);
  });

  test("a zero-width selection is a tap, not a zoom", () => {
    expect(zoomedHistoryRange(at("2026-08-01T10:00:00Z"), at("2026-08-01T10:00:00Z"))).toBeNull();
  });

  test("an unparseable edge is not a zoom", () => {
    expect(zoomedHistoryRange(new Date(Number.NaN), at("2026-08-01T10:00:00Z"))).toBeNull();
  });

  // The whole point of refetching: the bucket follows the SELECTED span, not the
  // span the data on screen was fetched at. `bucketForSpan` owns the boundary,
  // and this pins that the zoom goes through it rather than past it.
  test("the rollup boundary is the seven-day one the history page already uses", () => {
    const base = at("2026-01-01T00:00:00Z");
    const exactly7d = zoomedHistoryRange(base, new Date(base.getTime() + 7 * DAY));
    const justOver = zoomedHistoryRange(base, new Date(base.getTime() + 7 * DAY + 1));
    expect(exactly7d?.bucket).toBe("minute");
    expect(justOver?.bucket).toBe("hour");
  });

  // Berlin's spring-forward: 00:30 and 03:30 local are two hours apart, not
  // three. The bucket must follow the elapsed time, and the label the wall clock.
  test("a window across a DST spring-forward keeps its elapsed span", () => {
    const range = zoomedHistoryRange(at("2026-03-28T23:30:00Z"), at("2026-03-29T01:30:00Z"), {
      locale: "en-US",
      timeZone: "Europe/Berlin",
      hour12: false,
    });
    expect(range?.bucket).toBe("minute");
    expect(range?.label).toBe("00:30 – 03:30");
  });
});

describe("zoomedHistoryRangeFrom", () => {
  // A time scale hands its brush edges back as epoch numbers, but the canvas and
  // SVG contexts have each been seen to pass Dates. Both are the same window.
  test("epoch numbers and Dates describe the same window", () => {
    const from = at("2026-08-01T10:00:00Z");
    const to = at("2026-08-01T10:20:00Z");
    expect(zoomedHistoryRangeFrom([from.getTime(), to.getTime()])).toEqual(
      zoomedHistoryRangeFrom([from, to]),
    );
    expect(zoomedHistoryRangeFrom([from, to])?.bucket).toBe("minute");
  });

  test("a half-open selection is not a zoom", () => {
    expect(zoomedHistoryRangeFrom([null, at("2026-08-01T10:20:00Z")])).toBeNull();
    expect(zoomedHistoryRangeFrom([at("2026-08-01T10:00:00Z")])).toBeNull();
  });

  // A band value on a chart that is not a time series would otherwise parse to
  // an invalid Date and blank every card on the page.
  test("a value that is not an instant is not a zoom", () => {
    expect(zoomedHistoryRangeFrom(["00:00", "06:00"])).toBeNull();
  });
});

describe("labelOptionsFrom", () => {
  // `auto` means "whatever the viewer's browser does", which for Intl is the
  // absence of the option — passing the string through would throw.
  test("the automatic zone and clock become no option at all", () => {
    expect(labelOptionsFrom("de", { timeZone: "auto", hourCycle: "auto" })).toEqual({
      locale: "de",
      timeZone: undefined,
      hour12: undefined,
    });
  });

  test("a configured zone and clock are passed through", () => {
    expect(labelOptionsFrom("en", { timeZone: "Europe/Berlin", hourCycle: "12h" })).toEqual({
      locale: "en",
      timeZone: "Europe/Berlin",
      hour12: true,
    });
    expect(labelOptionsFrom("en", { timeZone: "UTC", hourCycle: "24h" }).hour12).toBe(false);
  });
});

describe("minExtentFor", () => {
  // Two buckets wide: one bucket is the width of a fat finger on a phone, and a
  // selection that narrow is a mis-tap every time.
  test("a zoom must be at least two buckets wide", () => {
    expect(minExtentFor("minute")).toBe(2 * MINUTE);
    expect(minExtentFor("hour")).toBe(2 * HOUR);
    expect(minExtentFor("day")).toBe(2 * DAY);
  });

  test("band scales count categories, not milliseconds", () => {
    expect(MIN_BAND_EXTENT).toBe(2);
  });
});

describe("bandIndexRange", () => {
  const labels = ["00:00", "01:00", "02:00", "03:00"];

  test("a selection resolves to the positions it covers", () => {
    expect(bandIndexRange(labels, ["01:00", "03:00"])).toEqual([1, 3]);
  });

  test("a right-to-left band drag normalizes to ascending positions", () => {
    expect(bandIndexRange(labels, ["03:00", "01:00"])).toEqual([1, 3]);
  });

  test("an empty band domain has nothing to select", () => {
    expect(bandIndexRange([], ["01:00", "03:00"])).toBeNull();
  });

  test("a single-band domain selects its one position", () => {
    expect(bandIndexRange(["00:00"], ["00:00", "00:00"])).toEqual([0, 0]);
  });

  test("a value that is not in the domain is not a selection", () => {
    expect(bandIndexRange(labels, ["01:00", "99:00"])).toBeNull();
  });

  test("an incomplete selection is not a selection", () => {
    expect(bandIndexRange(labels, [null, "03:00"])).toBeNull();
    expect(bandIndexRange(labels, ["01:00"])).toBeNull();
  });

  // A brush hands back whatever the scale's domain holds; only a band domain
  // holds strings, and a number here means the chart is not the one we think.
  test("a selection that is not made of bands is not a band selection", () => {
    expect(bandIndexRange(labels, [1, 3])).toBeNull();
  });
});

describe("zoomedChartSpec", () => {
  const monthSpec: ChartSpec = {
    from: new Date(2026, 7, 1),
    to: new Date(2026, 8, 1),
    bucket: "day",
    caption: "This month, by day",
  };
  const dayKeys = Array.from({ length: 31 }, (_, i) => `2026-08-${String(i + 1).padStart(2, "0")}`);

  test("nothing selected leaves the section on its own spec", () => {
    expect(zoomedChartSpec(monthSpec, dayKeys, null)).toBeNull();
  });

  test("an empty period list has no window to narrow to", () => {
    expect(zoomedChartSpec(monthSpec, [], [0, 2])).toBeNull();
  });

  // The selected days are Aug 3–Aug 9 inclusive; the window runs to the
  // EXCLUSIVE next-day boundary so the last selected day is fetched whole.
  test("a band selection becomes the period window it covers", () => {
    const spec = zoomedChartSpec(monthSpec, dayKeys, [2, 8]);
    expect(spec?.from).toEqual(new Date(2026, 7, 3));
    expect(spec?.to).toEqual(new Date(2026, 7, 10));
  });

  test("a week of days refetches by hour, so the zoom shows something new", () => {
    expect(zoomedChartSpec(monthSpec, dayKeys, [2, 8])?.bucket).toBe("hour");
  });

  // Refining is only worth it while the finer series still draws as a chart.
  // A whole month by hour is ~744 bars on a 390px phone: a grey block.
  test("a selection too wide to redraw finely keeps its own granularity", () => {
    expect(zoomedChartSpec(monthSpec, dayKeys, [0, 30])?.bucket).toBe("day");
  });

  test("hour buckets are already the finest the series endpoints serve", () => {
    const hourSpec: ChartSpec = {
      from: new Date(2026, 7, 1),
      to: new Date(2026, 7, 2),
      bucket: "hour",
      caption: "Today, by hour",
    };
    const hourKeys = Array.from(
      { length: 24 },
      (_, i) => `2026-08-01T${String(i).padStart(2, "0")}`,
    );
    const spec = zoomedChartSpec(hourSpec, hourKeys, [6, 11]);
    expect(spec?.bucket).toBe("hour");
    expect(spec?.from).toEqual(new Date(2026, 7, 1, 6));
    expect(spec?.to).toEqual(new Date(2026, 7, 1, 12));
  });

  test("month keys narrow to whole calendar months", () => {
    const yearSpec: ChartSpec = {
      from: new Date(2025, 0, 1),
      to: new Date(2026, 11, 31),
      bucket: "month",
      caption: "Last 24 months",
    };
    const monthKeys = ["2026-01", "2026-02", "2026-03", "2026-04"];
    const spec = zoomedChartSpec(yearSpec, monthKeys, [1, 2]);
    expect(spec?.from).toEqual(new Date(2026, 1, 1));
    expect(spec?.to).toEqual(new Date(2026, 3, 1));
    expect(spec?.bucket).toBe("day");
  });

  test("a single band is a whole period, not an empty window", () => {
    const spec = zoomedChartSpec(monthSpec, dayKeys, [4, 4]);
    expect(spec?.from).toEqual(new Date(2026, 7, 5));
    expect(spec?.to).toEqual(new Date(2026, 7, 6));
  });

  // The chart can hold more bands than the series it was built from — a stale
  // selection arriving after a refetch, above all. Clamping keeps that a
  // narrower zoom rather than an invalid date the axis then throws on.
  test("positions past the end of the period list clamp to it", () => {
    const spec = zoomedChartSpec(monthSpec, dayKeys, [-4, 99]);
    expect(spec?.from).toEqual(new Date(2026, 7, 1));
    expect(spec?.to).toEqual(new Date(2026, 8, 1));
  });

  test("a key that does not match its bucket is not a window", () => {
    expect(zoomedChartSpec(monthSpec, ["not-a-day", "2026-08-02"], [0, 1])).toBeNull();
  });

  // The caption names what is ON SCREEN. It is built from the narrowed window,
  // so it cannot go on claiming "This month, by day" after a zoom into a week.
  test("the caption describes the zoomed window, not the section's range", () => {
    // Aug 9, not Aug 10: the window's `to` is exclusive, and a caption that
    // names the boundary claims a day the chart does not draw.
    expect(zoomedChartSpec(monthSpec, dayKeys, [2, 8], { locale: "en-US" })?.caption).toBe(
      "Aug 3 – Aug 9",
    );
    expect(zoomedChartSpec(monthSpec, dayKeys, [2, 8])?.caption).not.toBe(monthSpec.caption);
  });

  test("a window inside a day keeps the clock in its caption", () => {
    const hourSpec: ChartSpec = {
      from: new Date(2026, 7, 1),
      to: new Date(2026, 7, 2),
      bucket: "hour",
      caption: "Today, by hour",
    };
    const hourKeys = Array.from(
      { length: 24 },
      (_, i) => `2026-08-01T${String(i).padStart(2, "0")}`,
    );
    expect(
      zoomedChartSpec(hourSpec, hourKeys, [6, 11], { locale: "en-US", hour12: false })?.caption,
    ).toBe("06:00 – 12:00");
  });
});

describe("a section's zoom expires with the window it was drawn on", () => {
  const base: ChartSpec = {
    from: new Date(2026, 7, 1),
    to: new Date(2026, 8, 1),
    bucket: "day",
    caption: "This month, by day",
  };
  const other: ChartSpec = { ...base, caption: "Last 12 months" };
  const zoomed: ChartSpec = { ...base, to: new Date(2026, 7, 8), caption: "Aug 1 – Aug 7" };

  test("nothing zoomed leaves the section on its own window", () => {
    expect(activeSpec(base, null)).toBe(base);
  });

  test("a zoom anchored to the current window is what the section plots", () => {
    expect(activeSpec(base, zoomAnchor(base, zoomed))).toBe(zoomed);
  });

  // Identity, not equality: `other` is a spec with the same dates, and the point
  // is that picking a different range hands back a DIFFERENT object.
  test("a zoom anchored to a window that is gone stops applying", () => {
    expect(activeSpec(other, zoomAnchor(base, zoomed))).toBe(other);
  });

  test("clearing a zoom is nothing to anchor", () => {
    expect(zoomAnchor(base, null)).toBeNull();
  });
});

describe("zoomSpanLabel", () => {
  const opts = { locale: "en-US", timeZone: "Europe/Berlin", hour12: false };

  test("a window inside one civil day reads as clock times", () => {
    expect(zoomSpanLabel(at("2026-08-01T08:05:00Z"), at("2026-08-01T08:25:00Z"), opts)).toBe(
      "10:05 – 10:25",
    );
  });

  test("an overnight window names the day at both ends", () => {
    expect(zoomSpanLabel(at("2026-08-01T18:00:00Z"), at("2026-08-02T06:00:00Z"), opts)).toBe(
      "Aug 1, 20:00 – Aug 2, 08:00",
    );
  });

  test("a multi-day window drops the clock entirely", () => {
    expect(zoomSpanLabel(at("2026-08-01T00:00:00Z"), at("2026-08-09T00:00:00Z"), opts)).toBe(
      "Aug 1 – Aug 9",
    );
  });

  // A band window's `to` is exclusive, so `dateOnly` is handed the inclusive
  // end. One selected day then lands on one label, and naming it twice would
  // read as a two-day window.
  test("a date-only window whose ends land on one day prints it once", () => {
    expect(
      zoomSpanLabel(new Date(2026, 7, 3), new Date(2026, 7, 3, 23, 59), {
        locale: "en-US",
        dateOnly: true,
      }),
    ).toBe("Aug 3");
  });

  test("a date-only window ignores the clock at both ends", () => {
    expect(
      zoomSpanLabel(new Date(2026, 7, 3, 6), new Date(2026, 7, 9, 18), {
        locale: "en-US",
        dateOnly: true,
      }),
    ).toBe("Aug 3 – Aug 9");
  });

  // Same three hours of wall clock, two hours of elapsed time.
  test("a DST spring-forward window reads in wall-clock time", () => {
    expect(zoomSpanLabel(at("2026-03-28T23:30:00Z"), at("2026-03-29T01:30:00Z"), opts)).toBe(
      "00:30 – 03:30",
    );
  });

  test("a reversed pair labels the window it covers", () => {
    expect(zoomSpanLabel(at("2026-08-01T08:25:00Z"), at("2026-08-01T08:05:00Z"), opts)).toBe(
      "10:05 – 10:25",
    );
  });
});
