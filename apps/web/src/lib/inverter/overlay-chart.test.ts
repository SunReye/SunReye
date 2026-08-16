/**
 * The step from "a list of metric keys" to "the props an overlay plot takes".
 *
 * It sat inline in `custom-chart-card.svelte` and so was reachable only by a
 * saved chart with an id — and, being inside a `.svelte` file, was covered by
 * nothing. A draft chart needs the identical steps from an unsaved key list,
 * which is what forced it out here where it can be exercised.
 */

import { describe, expect, test } from "bun:test";
import { mergePoints, overlaySeries, resolveMetrics } from "./overlay-chart";
import type { Datum } from "./chart-axes";
import type { ManifestMetric } from "./types";

function metric(key: string, label: string, unit?: string): ManifestMetric {
  return { key, label, unit, group: "test" } as ManifestMetric;
}

const PV = metric("dc.pv1.power", "PV 1", "W");
const LOAD = metric("ac.load.power", "Load", "W");
const SOC = metric("battery.soc", "SOC", "%");

describe("the palette", () => {
  // Reached through `overlaySeries`, which is the module's only way to colour a
  // series — a second one is how two charts end up disagreeing about red.
  const colorsFor = (n: number) =>
    overlaySeries(Array.from({ length: n }, (_, i) => metric(`m${i}`, `M${i}`))).map(
      (s) => s.color,
    );

  test("cycles the five chart accents", () => {
    expect(colorsFor(6)).toEqual([
      "var(--color-chart-1)",
      "var(--color-chart-2)",
      "var(--color-chart-3)",
      "var(--color-chart-4)",
      "var(--color-chart-5)",
      "var(--color-chart-1)",
    ]);
  });

  test("gives eight overlaid series no two adjacent colours", () => {
    // MAX_CHART_METRICS is 8 against a 5-colour palette, so a repeat is
    // unavoidable; what must not happen is two neighbours sharing one.
    const colors = colorsFor(8);
    for (let i = 1; i < colors.length; i++) expect(colors[i]).not.toBe(colors[i - 1]);
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
    expect(series.map((s) => s.color)).toEqual(["var(--color-chart-1)", "var(--color-chart-2)"]);
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
