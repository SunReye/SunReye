/**
 * The step from "a list of metric keys" to "the props an overlay plot takes".
 *
 * It sat inline in `custom-chart-card.svelte` and so was reachable only by a
 * saved chart with an id — and, being inside a `.svelte` file, was covered by
 * nothing. A draft chart needs the identical steps from an unsaved key list,
 * which is what forced it out here where it can be exercised.
 */

import { describe, expect, test } from "bun:test";
import {
  mergePoints,
  overlayDatums,
  overlayDelta,
  overlaySeries,
  resolveMetrics,
} from "./overlay-chart";
import type { Datum } from "./chart-axes";
import type { ManifestMetric } from "./types";

function metric(key: string, label: string, unit?: string): ManifestMetric {
  return { key, label, unit, group: "test" } as ManifestMetric;
}

const PV = metric("dc.pv1.power", "PV 1", "W");
const LOAD = metric("ac.load.power", "Load", "W");
const SOC = metric("battery.soc", "SOC", "%");

describe("colouring", () => {
  const colorsFor = (n: number) =>
    overlaySeries(Array.from({ length: n }, (_, i) => metric(`m${i}`, `M${i}`))).map(
      (s) => s.color,
    );

  test("spends the palette in order", () => {
    expect(colorsFor(3)).toEqual(["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"]);
  });

  test("gives a full chart eight different colours", () => {
    // The whole point of the categorical palette: at MAX_CHART_METRICS no two
    // series share a colour, where the old five-entry ramp repeated three.
    expect(new Set(colorsFor(8)).size).toBe(8);
  });

  test("uses the colour the user pinned for that metric", () => {
    const [pv, soc] = overlaySeries([PV, SOC], { "battery.soc": "chart-7" });
    expect(pv!.color).toBe("var(--chart-1)");
    expect(soc!.color).toBe("var(--chart-7)");
  });

  test("keys the override by metric, so reordering does not move it", () => {
    // An array aligned by position would hand the colour to whichever series
    // ended up at that index after an edit.
    const pinned = { "battery.soc": "chart-8" };
    expect(overlaySeries([SOC, PV], pinned)[0]!.color).toBe("var(--chart-8)");
    expect(overlaySeries([PV, SOC], pinned)[1]!.color).toBe("var(--chart-8)");
  });

  test("ignores a pinned value that is not a palette id", () => {
    // The record comes back from a server that validates on write — but an
    // older or hand-edited blob is read, not re-validated, and this value lands
    // in a `style` attribute.
    const [pv] = overlaySeries([PV], { "dc.pv1.power": "red; background: url(x)" });
    expect(pv!.color).toBe("var(--chart-1)");
  });

  test("ignores an override naming a metric the chart does not draw", () => {
    expect(overlaySeries([PV], { "battery.soc": "chart-5" })[0]!.color).toBe("var(--chart-1)");
  });
});

describe("resolveMetrics", () => {
  test("keeps the caller's order, not the catalogue's", () => {
    // Order is what decides colour, and the user picked the order.
    const { resolved } = resolveMetrics([PV, LOAD, SOC], ["battery.soc", "dc.pv1.power"]);
    expect(resolved.map((m) => m.key)).toEqual(["battery.soc", "dc.pv1.power"]);
  });

  test("reports keys the active profile does not have", () => {
    // A saved chart outlives a profile change; a draft outlives the metric it
    // started from. Either way the card says so rather than drawing fewer
    // series than the user picked and staying silent about it.
    const { resolved, missing } = resolveMetrics([PV], ["dc.pv1.power", "gone.away"]);
    expect(resolved.map((m) => m.key)).toEqual(["dc.pv1.power"]);
    expect(missing).toEqual(["gone.away"]);
  });

  test("resolves nothing from an empty catalogue", () => {
    // The manifest has not landed yet — every key is 'missing' for a moment,
    // which is why the caller must not read that as "this chart is broken".
    expect(resolveMetrics([], ["dc.pv1.power"])).toEqual({
      resolved: [],
      missing: ["dc.pv1.power"],
    });
  });

  test("answers an empty key list with two empty lists", () => {
    expect(resolveMetrics([PV], [])).toEqual({ resolved: [], missing: [] });
  });

  test("does not deduplicate — the same key twice is two series", () => {
    // Whether a duplicate is possible is the caller's business; silently
    // collapsing one here would hide the bug rather than fix it.
    const { resolved } = resolveMetrics([PV], ["dc.pv1.power", "dc.pv1.power"]);
    expect(resolved).toHaveLength(2);
  });
});

describe("overlaySeries", () => {
  test("colours by position among the RESOLVED metrics", () => {
    // Not by position in the requested keys: a chart whose second key is
    // unavailable would otherwise skip an accent and leave a hole.
    const series = overlaySeries([PV, SOC]);
    expect(series.map((s) => s.color)).toEqual(["var(--chart-1)", "var(--chart-2)"]);
  });

  test("carries the unit, which is what splits the axes", () => {
    // `resolveAxes` groups by unit; an empty unit here would put a % series on
    // the same scale as watts.
    expect(overlaySeries([PV, SOC]).map((s) => s.unit)).toEqual(["W", "%"]);
  });

  test("treats a metric with no unit as unitless rather than undefined", () => {
    expect(overlaySeries([metric("inverter.status", "Status")])[0]!.unit).toBe("");
  });

  test("reads its own key out of a row", () => {
    const [pv] = overlaySeries([PV]);
    expect(pv!.value({ date: new Date(0), "dc.pv1.power": 4200 })).toBe(4200);
  });

  test("answers null for a row that has no sample for it", () => {
    // A gap in the line, not a drop to zero — the difference between "the
    // inverter reported nothing" and "the inverter reported 0 W".
    const [pv] = overlaySeries([PV]);
    expect(pv!.value({ date: new Date(0) })).toBe(null);
  });

  test("keeps a real zero as zero", () => {
    // `?? null` and not `|| null`: 0 W at night is a reading.
    const [pv] = overlaySeries([PV]);
    expect(pv!.value({ date: new Date(0), "dc.pv1.power": 0 })).toBe(0);
  });
});

describe("mergePoints", () => {
  const at = (row: Datum) => (row.date as Date).getTime();

  test("puts metrics sharing a timestamp on one row", () => {
    const rows = mergePoints([
      { key: "a", points: [{ t: 1000, v: 1 }] },
      { key: "b", points: [{ t: 1000, v: 2 }] },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ date: new Date(1000), a: 1, b: 2 });
  });

  test("sorts ascending however the inputs arrive", () => {
    // The live buffers are ascending but the rollup fetches resolve in whatever
    // order the network returns them; an unsorted series draws as a scribble.
    const rows = mergePoints([
      { key: "a", points: [{ t: 3000, v: 3 }] },
      { key: "b", points: [{ t: 1000, v: 1 }] },
      { key: "c", points: [{ t: 2000, v: 2 }] },
    ]);
    expect(rows.map(at)).toEqual([1000, 2000, 3000]);
  });

  test("leaves a row sparse where a metric has no sample", () => {
    // The series accessor then answers null there and the line breaks, which is
    // the honest rendering of a metric that was not polled at that instant.
    const rows = mergePoints([
      {
        key: "a",
        points: [
          { t: 1000, v: 1 },
          { t: 2000, v: 2 },
        ],
      },
      { key: "b", points: [{ t: 2000, v: 9 }] },
    ]);
    expect(rows[0]).toEqual({ date: new Date(1000), a: 1 });
    expect(rows[1]).toEqual({ date: new Date(2000), a: 2, b: 9 });
  });

  test("keeps a zero rather than dropping it", () => {
    const rows = mergePoints([{ key: "a", points: [{ t: 1000, v: 0 }] }]);
    expect(rows[0]!.a).toBe(0);
  });

  test("is empty for no metrics, and for metrics with no points", () => {
    // Both happen on first paint: before the manifest lands, and before the
    // first live sample or rollup response.
    expect(mergePoints([])).toEqual([]);
    expect(mergePoints([{ key: "a", points: [] }])).toEqual([]);
  });

  test("lets a later metric win a key collision at the same timestamp", () => {
    // Only reachable with a duplicated key, which `resolveMetrics` deliberately
    // does not collapse. Stated so the behaviour is chosen rather than found.
    const rows = mergePoints([
      { key: "a", points: [{ t: 1000, v: 1 }] },
      { key: "a", points: [{ t: 1000, v: 2 }] },
    ]);
    expect(rows[0]!.a).toBe(2);
  });
});

/**
 * The overlay's half of #216.
 *
 * `entity-history-card` was moved onto `$lib/inverter/live-tail` for the single
 * metric case, which left `overlay-chart-view` still reading `range.live` the
 * old way — no fetch at all, the five-minute RAM buffer drawn instead. On
 * /history's Day tab standing on today that put a two-minute custom chart at
 * the top of a page of full-day cards.
 *
 * The overlay is the multi-metric case of the same two mechanisms, and both
 * boundaries it adds are about the keys disagreeing: a delta window has to be
 * wide enough for the LAGGING key (one answer refetched for all of them beats N
 * windows), and the splice has to happen per key or a key whose rollup reaches
 * further gets another key's tail written onto its own row.
 */
describe("overlay windows that are still filling in", () => {
  const MINUTE = 60_000;
  const from = new Date("2026-09-10T00:00:00.000Z");
  const to = new Date("2026-09-11T00:00:00.000Z");
  const window = { from, to, bucket: "minute" as const };
  const at = (iso: string) => new Date(iso).getTime();

  const row = (iso: string, avg: number) => ({ time: iso, avg, min: avg, max: avg });

  describe("overlayDelta", () => {
    test("names one window wide enough for the key that lags behind", () => {
      const delta = overlayDelta(
        [
          { key: "a", rows: [row("2026-09-10T10:00:00.000Z", 1)], live: [] },
          { key: "b", rows: [row("2026-09-10T09:30:00.000Z", 2)], live: [] },
        ],
        window,
        at("2026-09-10T10:01:30.000Z"),
        at("2026-09-10T10:00:30.000Z"),
      );
      // The newest bucket of the LAGGING key, not of the leading one: a window
      // starting at 10:00 would leave b's half hour hole permanently unfilled.
      expect(delta?.from.toISOString()).toBe("2026-09-10T09:30:00.000Z");
      expect(delta?.to).toEqual(to);
    });

    test("is null while every key already reaches the ticking bucket", () => {
      const rows = [row("2026-09-10T10:01:00.000Z", 1)];
      expect(
        overlayDelta(
          [
            { key: "a", rows, live: [] },
            { key: "b", rows, live: [] },
          ],
          window,
          at("2026-09-10T10:01:30.000Z"),
          at("2026-09-10T10:00:30.000Z"),
        ),
      ).toBeNull();
    });

    test("is null before the clock leaves the minute the rows were synced at", () => {
      expect(
        overlayDelta(
          [{ key: "a", rows: [row("2026-09-10T09:00:00.000Z", 1)], live: [] }],
          window,
          at("2026-09-10T10:00:10.000Z"),
          at("2026-09-10T10:00:30.000Z"),
        ),
      ).toBeNull();
    });

    test("asks for the whole window when a key holds nothing yet", () => {
      const delta = overlayDelta(
        [
          { key: "a", rows: [row("2026-09-10T10:00:00.000Z", 1)], live: [] },
          { key: "b", rows: [], live: [] },
        ],
        window,
        at("2026-09-10T10:01:30.000Z"),
        at("2026-09-10T10:00:30.000Z"),
      );
      expect(delta?.from).toEqual(from);
    });

    test("is null with no feeds at all", () => {
      expect(overlayDelta([], window, at("2026-09-10T10:01:30.000Z"), 0)).toBeNull();
    });
  });

  describe("overlayDatums", () => {
    test("merges each key's rollup rows by bucket", () => {
      const rows = overlayDatums(
        [
          { key: "a", rows: [row("2026-09-10T10:00:00.000Z", 1)], live: [] },
          { key: "b", rows: [row("2026-09-10T10:00:00.000Z", 2)], live: [] },
        ],
        window,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.a).toBe(1);
      expect(rows[0]!.b).toBe(2);
    });

    test("splices each key's own closed live buckets after its own last row", () => {
      const base = at("2026-09-10T10:00:00.000Z");
      const rows = overlayDatums(
        [
          {
            key: "a",
            rows: [row("2026-09-10T10:00:00.000Z", 1)],
            // 10:01 closes (a frame lands inside 10:02), 10:02 is still running.
            live: [
              { t: base + MINUTE, v: 4 },
              { t: base + 2 * MINUTE + 1000, v: 9 },
            ],
          },
          // b's rollup already covers 10:01, so its 10:01 frames must not be
          // spliced on top of the fetched answer.
          {
            key: "b",
            rows: [row("2026-09-10T10:00:00.000Z", 2), row("2026-09-10T10:01:00.000Z", 5)],
            live: [
              { t: base + MINUTE, v: 99 },
              { t: base + 2 * MINUTE + 1000, v: 99 },
            ],
          },
        ],
        window,
      );
      const minute = rows.find((d) => (d.date as Date).getTime() === base + MINUTE);
      expect(minute?.a).toBe(4);
      expect(minute?.b).toBe(5);
      // The running bucket is nobody's, on either key.
      expect(rows.some((d) => (d.date as Date).getTime() === base + 2 * MINUTE)).toBe(false);
    });

    test("is empty with no feeds and with feeds that hold nothing", () => {
      expect(overlayDatums([], window)).toEqual([]);
      expect(overlayDatums([{ key: "a", rows: [], live: [] }], window)).toEqual([]);
    });
  });
});
