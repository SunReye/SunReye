/**
 * The series reducer that stands between a rollup response and a path element.
 *
 * A /history card is ~450 CSS px wide and receives ~1876 rows for a preset
 * range; roughly 270ms of the measured 278ms per mount is d3 turning those rows
 * into `d` attributes. The card cannot resolve more than about one point per
 * device pixel, so the rows above that budget are work whose only output is a
 * sub-pixel wobble.
 *
 * Which reducer matters: a stride sampler ("every nth row") is cheaper to write
 * and silently deletes the one-sample spike that is the entire reason somebody
 * opens a battery-power chart. LTTB picks, per bucket, the row that spans the
 * largest triangle with its neighbours — so an outlier is the row it keeps.
 * The spike case below is written to go red under a naive rewrite.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { downsample, pointBudget } from "./downsample";

/** The chart rows as `metric-history-chart` holds them. */
type Row = { t: number; v: number };

const access = { x: (p: Row) => p.t, y: (p: Row) => p.v };

/** `count` rows of a gentle ramp — no feature for the reducer to preserve. */
function ramp(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ t: i, v: i % 7 }));
}

describe("downsample", () => {
  it("keeps the series untouched when it already fits the cap", () => {
    const rows = ramp(50);
    expect(downsample(rows, 50, access)).toEqual(rows);
    expect(downsample(rows, 500, access)).toEqual(rows);
  });

  it("never returns more rows than the cap allows", () => {
    for (const cap of [3, 4, 17, 100, 999]) {
      expect(downsample(ramp(1876), cap, access).length).toBeLessThanOrEqual(cap);
    }
  });

  it("spends the cap rather than undershooting it", () => {
    // A reducer that returns 40 rows for a cap of 400 is throwing away
    // resolution the card asked for and paid the measuring pass to learn.
    expect(downsample(ramp(1876), 400, access)).toHaveLength(400);
  });

  it("preserves the first and the last row exactly", () => {
    const rows = ramp(1000);
    const reduced = downsample(rows, 25, access);
    expect(reduced[0]).toBe(rows[0]);
    expect(reduced.at(-1)).toBe(rows.at(-1));
  });

  it("keeps a single-sample spike that a stride sampler would drop", () => {
    // 800 flat rows with one 9kW spike at an index no plausible stride lands
    // on. The spike is the event; losing it is losing the chart's reason to
    // exist, which is why this is LTTB and not `filter((_, i) => i % n === 0)`.
    const rows = ramp(800).map((row) => ({ ...row, v: 0 }));
    const spikeAt = 397;
    rows[spikeAt] = { t: spikeAt, v: 9000 };

    const reduced = downsample(rows, 50, access);

    expect(reduced).toContainEqual({ t: spikeAt, v: 9000 });
    expect(Math.max(...reduced.map((r) => r.v))).toBe(9000);
  });

  it("keeps a downward spike too — extremes, not maxima", () => {
    const rows = ramp(800).map((row) => ({ ...row, v: 0 }));
    rows[397] = { t: 397, v: -9000 };
    expect(Math.min(...downsample(rows, 50, access).map((r) => r.v))).toBe(-9000);
  });

  it("returns the rows in the order it was given them", () => {
    const reduced = downsample(ramp(1000), 60, access);
    const times = reduced.map((r) => r.t);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(new Set(times).size).toBe(times.length);
  });

  it("survives an empty series", () => {
    expect(downsample([], 100, access)).toEqual([]);
    expect(downsample([], 2, access)).toEqual([]);
  });

  it("survives one row and two rows", () => {
    const one = ramp(1);
    const two = ramp(2);
    expect(downsample(one, 2, access)).toEqual(one);
    expect(downsample(two, 2, access)).toEqual(two);
    expect(downsample(ramp(3), 2, access)).toEqual([
      { t: 0, v: 0 },
      { t: 2, v: 2 },
    ]);
  });

  it("survives a series whose timestamps are all equal", () => {
    // Every triangle is degenerate, so every area is 0. The reducer must still
    // return a cap-sized, endpoint-preserving series and no NaN.
    const rows: Row[] = Array.from({ length: 500 }, (_, i) => ({
      t: 1000,
      v: i,
    }));
    const reduced = downsample(rows, 20, access);

    expect(reduced).toHaveLength(20);
    expect(reduced[0]).toBe(rows[0]);
    expect(reduced.at(-1)).toBe(rows.at(-1));
    expect(reduced.every((r) => Number.isFinite(r.v))).toBe(true);
  });

  it("survives values that are not finite", () => {
    // A rollup gap can arrive as null and map to NaN. It must not swallow the
    // rest of the series into a single bucket pick.
    const rows = ramp(600).map((row, i) => (i === 42 ? { t: i, v: Number.NaN } : row));
    expect(downsample(rows, 30, access)).toHaveLength(30);
  });

  it("treats a cap it cannot honour as no cap at all", () => {
    // 0, 1 and a negative cap cannot carry a line; blanking the chart is a
    // worse answer than drawing the rows we have, so the cap is ignored.
    const rows = ramp(500);
    for (const cap of [0, 1, -5, Number.NaN, -Infinity]) {
      expect(downsample(rows, cap, access)).toEqual(rows);
    }
  });

  it("does not mutate the series it was handed", () => {
    const rows = ramp(500);
    const before = structuredClone(rows);
    downsample(rows, 30, access);
    expect(rows).toEqual(before);
  });
});

describe("pointBudget", () => {
  it("gives a measured plot about one row per device pixel", () => {
    expect(pointBudget(450, 2)).toBe(900);
    expect(pointBudget(450, 1)).toBe(450);
  });

  it("imposes no cap before the plot has been measured", () => {
    // `bind:clientWidth` reads 0 until the element is in the document. Capping
    // on a guessed width would draw the wrong series and then redraw it.
    for (const width of [0, -1, Number.NaN, Infinity]) {
      expect(pointBudget(width, 2)).toBe(Number.POSITIVE_INFINITY);
    }
  });

  it("defends against a nonsensical device pixel ratio", () => {
    // dpr comes from the browser and is 0 in some headless configurations.
    expect(pointBudget(450, 0)).toBe(450);
    expect(pointBudget(450, Number.NaN)).toBe(450);
    expect(pointBudget(450, -2)).toBe(450);
  });

  it("keeps a sliver of a plot above the reducer's own floor", () => {
    // A collapsing card can measure a handful of pixels for a frame; a cap of 3
    // there would throw the series away for good on a memoised derivation.
    expect(pointBudget(2, 1)).toBeGreaterThanOrEqual(64);
  });
});

/**
 * The reducer being correct says nothing about it being CALLED, and a rune
 * shell cannot run under `bun test` (apps/web/TESTING.md). So the wiring is
 * read off disk, the way `mobile-density.test.ts` pins the gutter clamp: both
 * of these charts drew ~1876 rows into a ~450px box, and both of them built
 * every path twice — once at `plotWidth = 0` and once for real.
 */
describe("the chart bodies that draw a measured plot", () => {
  const PLOTS = ["../live-area.svelte", "./metric-history-chart.svelte"];

  const source = (file: string) => readFileSync(new URL(file, import.meta.url).pathname, "utf8");

  it.each(PLOTS)("%s waits for the measurement before it builds a plot", (file) => {
    const code = source(file);
    expect(code).toContain("shouldRenderPlot(plotWidth)");
    // Gating the PADDING alone would keep both renders and change nothing: the
    // plot itself has to sit inside the branch.
    expect(code).toMatch(/\{#if\s+!?shouldRenderPlot\(plotWidth\)\}/);
    expect(code).toContain("<Chart.Container");
  });

  it.each(PLOTS)("%s reduces its series to the plot's own budget", (file) => {
    const code = source(file);
    expect(code).toContain("downsample(");
    // The cap is a PROP with the measured budget as its default, not a
    // constant: the overview's wider sparklines have to be able to keep more,
    // and a hard-coded number would silently cap them too.
    expect(code).toMatch(/maxPoints \?\? pointBudget\(plotWidth, dpr\)/);
    expect(code).toContain("maxPoints?: number;");
  });

  it("draws the rows it reduced, not the rows it was handed", () => {
    // The reduction is worthless if the chart still receives `data`. This is
    // the one-character regression the browser budget would catch a day later.
    const code = source("./metric-history-chart.svelte");
    const chart = code.slice(code.indexOf("<AreaChart"));
    expect(chart).toContain("data={plotted}");
  });
});
