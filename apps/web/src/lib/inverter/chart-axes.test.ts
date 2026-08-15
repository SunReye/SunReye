import { describe, expect, it } from "bun:test";
import {
  type AxisSeries,
  axisScale,
  domainFor,
  groupSeriesByUnit,
  normalizeSeries,
} from "./chart-axes";

const s = (key: string, unit: string): AxisSeries => ({
  key,
  label: key,
  color: "#000",
  unit,
  value: (d) => (d[key] as number | undefined) ?? null,
});

describe("groupSeriesByUnit", () => {
  it("keeps a single-unit chart on one axis", () => {
    const g = groupSeriesByUnit([s("a", "W"), s("b", "W")]);
    expect(g.dualAxis).toBe(false);
    expect(g.left.map((x) => x.key)).toEqual(["a", "b"]);
    expect(g.right).toHaveLength(0);
    expect(g.leftUnit).toBe("W");
  });

  it("puts the majority unit on the left, the rest on the right", () => {
    const g = groupSeriesByUnit([s("eff", "%"), s("batt", "W"), s("dc", "W")]);
    expect(g.dualAxis).toBe(true);
    expect(g.leftUnit).toBe("W");
    expect(g.left.map((x) => x.key)).toEqual(["batt", "dc"]);
    expect(g.right.map((x) => x.key)).toEqual(["eff"]);
    expect(g.rightUnit).toBe("%");
  });

  it("breaks a unit-count tie toward the first series' unit", () => {
    const g = groupSeriesByUnit([s("eff", "%"), s("batt", "W")]);
    expect(g.leftUnit).toBe("%");
    expect(g.rightUnit).toBe("W");
  });

  it("reports no right unit label when the right group mixes units", () => {
    const g = groupSeriesByUnit([s("p1", "W"), s("p2", "W"), s("e", "%"), s("v", "V")]);
    expect(g.leftUnit).toBe("W");
    expect(g.rightUnit).toBe("");
    expect(g.right.map((x) => x.key)).toEqual(["e", "v"]);
  });
});

describe("domainFor", () => {
  const rows = [
    { date: new Date(0), eff: 82, batt: -135 },
    { date: new Date(1), eff: 84, batt: 500 },
  ];

  it("hugs a tight range instead of anchoring to zero", () => {
    const [lo, hi] = domainFor(rows, [s("eff", "%")]);
    // nice() of [82,84] must not collapse to include 0 — that would drown it.
    expect(lo).toBeGreaterThan(0);
    expect(lo).toBeLessThanOrEqual(82);
    expect(hi).toBeGreaterThanOrEqual(84);
  });

  it("spans negative to positive for signed values", () => {
    const [lo, hi] = domainFor(rows, [s("batt", "W")]);
    expect(lo).toBeLessThanOrEqual(-135);
    expect(hi).toBeGreaterThanOrEqual(500);
  });

  it("falls back to [0,1] with no finite values", () => {
    expect(domainFor([], [s("eff", "%")])).toEqual([0, 1]);
  });

  it("skips non-finite and missing readings instead of poisoning the domain", () => {
    // Only the real readings may decide the axis. An Infinity would stretch the
    // domain to the end of the number line and a gap (null) would drag its floor
    // to zero — both leave the actual 50–60 band a flat line against one edge.
    const withGaps = [
      { date: new Date(0), eff: Number.NaN },
      { date: new Date(1), eff: 50 },
      { date: new Date(2), eff: Number.POSITIVE_INFINITY },
      { date: new Date(3) }, // series reports null for the missing key
      { date: new Date(4), eff: 60 },
    ];
    expect(domainFor(withGaps, [s("eff", "%")])).toEqual([50, 60]);
  });

  it("falls back to [0,1] when every reading is non-finite", () => {
    // Nothing survives the filter, so this must take the empty path. Without it
    // the extent is [Infinity, -Infinity], which nice()s into a domain whose
    // ticks are NaN and whose axis renders blank.
    const allGaps = [
      { date: new Date(0), eff: Number.NaN },
      { date: new Date(1), eff: Number.NEGATIVE_INFINITY },
    ];
    expect(domainFor(allGaps, [s("eff", "%")])).toEqual([0, 1]);
  });

  it("gives a flat series a band from zero, by sign", () => {
    const flat = (v: number) => [{ date: new Date(0), eff: v }];
    expect(domainFor(flat(40), [s("eff", "%")])).toEqual([0, 44]);
    expect(domainFor(flat(-40), [s("eff", "%")])).toEqual([-44, 0]);
    expect(domainFor(flat(0), [s("eff", "%")])).toEqual([0, 1]);
  });
});

describe("normalizeSeries", () => {
  it("maps values into [0,1] within the group domain", () => {
    const [ns] = normalizeSeries([s("eff", "%")], [80, 90]);
    expect(ns.value({ eff: 80 })).toBe(0);
    expect(ns.value({ eff: 90 })).toBe(1);
    expect(ns.value({ eff: 85 })).toBeCloseTo(0.5);
  });

  it("returns 0.5 for a flat (zero-span) domain", () => {
    const [ns] = normalizeSeries([s("eff", "%")], [82, 82]);
    expect(ns.value({ eff: 82 })).toBe(0.5);
  });

  it("passes through null for missing values", () => {
    const [ns] = normalizeSeries([s("eff", "%")], [80, 90]);
    expect(ns.value({})).toBeNull();
  });
});

describe("axisScale", () => {
  it("puts the domain minimum at the bottom of the plot", () => {
    // SVG y grows downward, so the range is inverted: a tick label drawn at the
    // scale's output for `min` has to sit on the baseline, not the top edge.
    const scale = axisScale([0, 100], 240);
    expect(scale(0)).toBe(240);
    expect(scale(100)).toBe(0);
    expect(scale(50)).toBe(120);
  });

  it("keeps a signed domain's zero where the data says, not mid-plot", () => {
    // Battery power runs −135 W to 500 W; the axis must not pretend it is
    // symmetric, or the charge/discharge crossing is drawn in the wrong place.
    const scale = axisScale([-135, 500], 635);
    expect(scale(-135)).toBe(635);
    expect(scale(0)).toBeCloseTo(500, 6);
    expect(scale(500)).toBe(0);
  });

  it("survives a zero-height plot without producing NaN ticks", () => {
    // The chart is measured after mount; the first paint asks for a scale on a
    // container that has no height yet.
    const scale = axisScale([80, 90], 0);
    expect(scale(85)).toBe(0);
  });

  it("still resolves a reading outside its domain", () => {
    // domainFor nice()s the ends, so a raw sample can land just past them —
    // clamping is not on, and the value has to stay plottable.
    const scale = axisScale([80, 90], 100);
    expect(scale(95)).toBe(-50);
  });
});
