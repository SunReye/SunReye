import { describe, expect, it } from "bun:test";
import { heatColor, heatGradient, heatKwh, heatOpacity, hourLabel, weekdayLabel } from "./heatmap";

/** The stops the module interpolates, restated here so a re-tune has to be a
 *  deliberate edit in two places rather than a silent colour drift. */
const HEAT_STOPS = ["#e2ab48", "#d88a12", "#c4450b", "#8a1f36"] as const;

/** sRGB luminance proxy — good enough to assert the ramp gets darker. */
const luma = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

describe("heatColor", () => {
  it("returns the first and last stop at the ends", () => {
    expect(heatColor(0)).toBe(HEAT_STOPS[0]);
    expect(heatColor(1)).toBe(HEAT_STOPS[HEAT_STOPS.length - 1]);
  });

  it("hits each intermediate stop exactly", () => {
    const step = 1 / (HEAT_STOPS.length - 1);
    HEAT_STOPS.forEach((stop, i) => expect(heatColor(i * step)).toBe(stop));
  });

  it("interpolates between two stops", () => {
    const mid = heatColor(1 / 6); // halfway from stop 0 to stop 1
    expect(mid).not.toBe(HEAT_STOPS[0]);
    expect(mid).not.toBe(HEAT_STOPS[1]);
    expect(luma(mid)).toBeLessThan(luma(HEAT_STOPS[0]));
    expect(luma(mid)).toBeGreaterThan(luma(HEAT_STOPS[1]));
  });

  it("darkens monotonically across the ramp, so it reads as sequential", () => {
    const samples = Array.from({ length: 21 }, (_, i) => luma(heatColor(i / 20)));
    samples.slice(1).forEach((l, i) => expect(l).toBeLessThan(samples[i]));
  });

  it("clamps out-of-range and NaN inputs instead of throwing", () => {
    expect(heatColor(-3)).toBe(HEAT_STOPS[0]);
    expect(heatColor(4)).toBe(HEAT_STOPS[HEAT_STOPS.length - 1]);
    // An all-zero window divides 0/0 — must not produce "#NaNNaNNaN".
    expect(heatColor(Number.NaN)).toBe(HEAT_STOPS[0]);
  });

  it("always emits a 7-character hex colour", () => {
    for (let i = 0; i <= 40; i++) expect(heatColor(i / 40)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("heatOpacity", () => {
  it("keeps the quietest cells visible but recessive", () => {
    expect(heatOpacity(0)).toBeCloseTo(0.12, 5);
  });

  it("reaches full opacity at a quarter of the maximum and stays there", () => {
    expect(heatOpacity(0.25)).toBeCloseTo(1, 5);
    expect(heatOpacity(0.6)).toBeCloseTo(1, 5);
    expect(heatOpacity(1)).toBeCloseTo(1, 5);
  });

  it("rises monotonically through the fade band", () => {
    const samples = [0, 0.05, 0.1, 0.15, 0.2, 0.25].map(heatOpacity);
    samples.slice(1).forEach((o, i) => expect(o).toBeGreaterThan(samples[i]));
  });

  it("clamps out-of-range and NaN inputs", () => {
    expect(heatOpacity(-1)).toBeCloseTo(0.12, 5);
    expect(heatOpacity(Number.NaN)).toBeCloseTo(0.12, 5);
  });
});

describe("heatGradient", () => {
  it("lists every stop left to right for the legend bar", () => {
    expect(heatGradient()).toBe(`linear-gradient(to right, ${HEAT_STOPS.join(", ")})`);
  });
});

describe("weekdayLabel", () => {
  it("names the ISO weekday, Monday first", () => {
    // The server emits ISO weekdays (1 = Monday … 7 = Sunday); the grid's rows
    // must read in that order, not the Sunday-first order the platform default
    // would give.
    expect([1, 2, 3, 4, 5, 6, 7].map(weekdayLabel)).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
  });

  it("gives seven distinct row labels, so no two weekdays collide", () => {
    expect(new Set([1, 2, 3, 4, 5, 6, 7].map(weekdayLabel)).size).toBe(7);
  });
});

describe("hourLabel", () => {
  it("pads the hour to a fixed width, so the axis does not jitter at 10:00", () => {
    expect(hourLabel(0)).toBe("00:00");
    expect(hourLabel(7)).toBe("07:00");
    expect(hourLabel(23)).toBe("23:00");
    expect(new Set(Array.from({ length: 24 }, (_, h) => hourLabel(h))).size).toBe(24);
  });

  it("labels every column with its own hour, midnight first", () => {
    // The grid renders 24 columns in index order, so the label at index h has
    // to be hour h itself — an off-by-one here silently shifts every reading in
    // the heatmap by an hour.
    expect(Array.from({ length: 24 }, (_, h) => hourLabel(h))).toEqual(
      Array.from({ length: 24 }, (_, h) => `${h < 10 ? "0" : ""}${h}:00`),
    );
  });
});

describe("heatKwh", () => {
  it("states a cell average to two decimals", () => {
    expect(heatKwh(1.234)).toBe("1.23 kWh");
    expect(heatKwh(0.42)).toBe("0.42 kWh");
  });

  it("reads a slot that moved nothing as a plain zero", () => {
    // The legend's low end is heatKwh(0), and a slot that occurred but stayed
    // idle is a real reading — not a gap.
    expect(heatKwh(0)).toBe("0 kWh");
  });

  it("collapses a sub-10 Wh average to zero rather than a long tail", () => {
    // A house that draws 3 W in an hour is 0.003 kWh: the grid should say "0",
    // not "0.003", and the cell is shaded by value regardless.
    expect(heatKwh(0.003)).toBe("0 kWh");
    expect(heatKwh(0.006)).toBe("0.01 kWh");
  });

  it("groups a large average the way the UI locale does", () => {
    expect(heatKwh(1234.5)).toBe("1,234.5 kWh");
  });
});
