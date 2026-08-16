/**
 * The categorical palette overlaid series are drawn from, and the per-series
 * colour a user can pin instead.
 *
 * `--chart-1..5` shipped as shadcn's default: one hue (oklch 251–265) at five
 * lightnesses. As a sequential ramp that is correct; as the palette for series
 * plotted ON TOP OF EACH OTHER it is five shades of blue, which is what a
 * reader cannot tell apart on a phone. The cases here are about categorical
 * separation, and about the override never becoming a way to put an arbitrary
 * string into a `style` attribute.
 */

import { describe, expect, test } from "bun:test";
import { MAX_CHART_METRICS } from "./custom-chart";
import { SERIES_COLORS, colorVar, isSeriesColor, paletteColor } from "./chart-palette";

describe("the palette", () => {
  test("has a distinct entry for every series a chart may overlay", () => {
    // Fewer than MAX_CHART_METRICS and the eighth series repeats the first,
    // which is exactly the confusion this palette exists to remove.
    expect(SERIES_COLORS.length).toBeGreaterThanOrEqual(MAX_CHART_METRICS);
  });

  test("names no colour twice", () => {
    expect(new Set(SERIES_COLORS).size).toBe(SERIES_COLORS.length);
  });

  test("cycles once it runs out, rather than falling off the end", () => {
    // Nothing overlays more than MAX_CHART_METRICS today, but `paletteColor` is
    // also the accent source for the history grid, which has no such bound.
    expect(paletteColor(SERIES_COLORS.length)).toBe(paletteColor(0));
    expect(paletteColor(SERIES_COLORS.length + 3)).toBe(paletteColor(3));
  });

  test("gives every position inside one chart its own colour", () => {
    const used = Array.from({ length: MAX_CHART_METRICS }, (_, i) => paletteColor(i));
    expect(new Set(used).size).toBe(MAX_CHART_METRICS);
  });

  test("resolves to the token, never to a raw colour value", () => {
    // The theme owns the actual oklch values, light and dark; a literal here
    // would be a second source of truth that only one surface ever sees.
    for (const id of SERIES_COLORS) expect(colorVar(id)).toBe(`var(--${id})`);
    expect(paletteColor(0)).toMatch(/^var\(--chart-\d+\)$/);
  });

  test("names the theme's own property, not Tailwind's mapped one", () => {
    // `@theme inline` re-emits `--color-chart-N` only when Tailwind sees that
    // name in scanned source. These are built at runtime, so it saw none of
    // them: `--chart-6` resolved to nothing and its series drew colourless,
    // while 7 and 8 survived purely because a test file spelled them out.
    for (const id of SERIES_COLORS) expect(colorVar(id)).not.toContain("--color-");
  });
});

describe("isSeriesColor", () => {
  // A pinned colour is persisted and comes back from the server, then lands in
  // a `style` attribute and in SVG fill/stroke. It is a palette id and nothing
  // else — never an arbitrary CSS string.
  test("accepts every id the palette names", () => {
    for (const id of SERIES_COLORS) expect(isSeriesColor(id)).toBe(true);
  });

  test("rejects a colour that is not in the palette", () => {
    expect(isSeriesColor("chart-99")).toBe(false);
    expect(isSeriesColor("red")).toBe(false);
    expect(isSeriesColor("#ff0000")).toBe(false);
  });

  test("rejects anything that could carry CSS of its own", () => {
    expect(isSeriesColor("red; background: url(evil)")).toBe(false);
    expect(isSeriesColor("var(--color-chart-1)")).toBe(false);
    expect(isSeriesColor("expression(alert(1))")).toBe(false);
  });

  test("rejects non-strings", () => {
    expect(isSeriesColor(null)).toBe(false);
    expect(isSeriesColor(undefined)).toBe(false);
    expect(isSeriesColor(1)).toBe(false);
    expect(isSeriesColor({ toString: () => "chart-1" })).toBe(false);
  });
});

describe("the web palette and the schema that validates it", () => {
  test("name the same colours", async () => {
    // The web app cannot import from @SunReye/db (stated in that file), so the
    // list is mirrored. Mirrored without a check, a colour added on one side is
    // a colour the other side rejects on save — after the user picked it.
    const schema = await Bun.file(
      new URL("../../../../../packages/db/src/custom-charts.ts", import.meta.url),
    ).text();
    const declared = schema.match(/SERIES_COLORS = \[([^\]]*)\]/)?.[1];
    expect(declared, "packages/db declares no SERIES_COLORS").toBeDefined();
    const ids = [...declared!.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual([...SERIES_COLORS]);
  });
});
