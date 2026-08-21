/**
 * That the clamp in ./tooltip-placement.ts is what the charts actually run.
 *
 * The maths is unit-tested and the resulting box is measured in a real document
 * (`e2e/chart-tooltip-viewport.spec.ts`). What neither of those catches is a
 * SEVENTH tooltip added next month that renders LayerChart's own
 * `Tooltip.Root` directly: it would look right on a laptop and clip off the
 * left edge of a phone, and every other test in the repo would stay green.
 *
 * So this is a census, in the style of ./zoom-wiring.test.ts. Source-text tests
 * are the last resort here (apps/web/TESTING.md) — the claim is "no component
 * bypasses the wrapper", which is a fact about the source and about nothing
 * else.
 */

import { describe, expect, test } from "bun:test";

const SRC = new URL("../../", import.meta.url);
const files = [...new Bun.Glob("**/*.svelte").scanSync(SRC.pathname)].sort();
const sources = new Map<string, string>(
  await Promise.all(
    files.map(async (f) => [f, await Bun.file(new URL(f, SRC)).text()] as [string, string]),
  ),
);

const svelte = (file: string): string => {
  const text = sources.get(file);
  if (text === undefined) throw new Error(`no such component: ${file}`);
  return text;
};

/** The one component allowed to render LayerChart's tooltip root. */
const WRAPPER = "lib/charts/chart-tooltip-root.svelte";

/** Does this component import a tooltip from LayerChart at all? */
const importsLayerchartTooltip = (code: string) =>
  /import\s*\{[^}]*Tooltip[^}]*\}\s*from\s*['"]layerchart(\/canvas)?['"]/.test(code);

describe("every chart tooltip goes through one placement", () => {
  test("and only the wrapper renders LayerChart's own root", () => {
    const direct = files.filter(
      (f) =>
        f !== WRAPPER &&
        importsLayerchartTooltip(svelte(f)) &&
        /<(Tooltip|TooltipPrimitive)\.Root\b/.test(svelte(f)),
    );
    expect(direct).toEqual([]);
  });

  // The six roots the report named, listed so that DELETING the wrapper from
  // one of them fails here rather than only on a phone. bits-ui's own
  // `ui/tooltip` is a different component and is not in this census.
  const ROOTS = [
    "lib/components/ui/chart/chart-tooltip.svelte",
    "lib/components/inverter/custom-chart-tooltip.svelte",
    "lib/components/inverter/forecast-tooltip.svelte",
    "lib/components/prices/price-tooltip.svelte",
    "lib/components/statistics/heat-grid.svelte",
    "lib/components/settings/forecast-correction-panel.svelte",
  ];

  test.each(ROOTS)("%s renders the wrapper", (file) => {
    expect(svelte(file)).toContain("<ChartTooltipRoot");
  });
});

describe("the wrapper", () => {
  const code = svelte(WRAPPER);

  test("hands LayerChart numbers, which is what disables its own containment", () => {
    // `Tooltip.svelte` guards every containment branch with
    // `typeof x !== 'number'`. Numbers are how the flip that caused the bug is
    // turned off; passing `'pointer'` back would restore it in one token.
    expect(code).toMatch(/x=\{placement\.x\}/);
    expect(code).toMatch(/y=\{placement\.y\}/);
    expect(code).toMatch(/anchor=\{placement\.anchor\}/);
  });

  test("resolves the position through the tested rule", () => {
    expect(code).toContain("placeTooltip(");
    expect(code).toContain("pointerKind.coarse");
  });

  test("applies the width it reserved, so the clamp is not a guess", () => {
    // The arithmetic in placeTooltip promises a box no wider than `maxWidth`.
    // Without this style the promise is unfounded and a wide tooltip walks off
    // the right edge with every unit test still green.
    expect(code).toMatch(/max-width:\s*\$\{placement\.maxWidth\}px/);
  });

  test("paints at the position, rather than springing towards it", () => {
    // LayerChart springs `left`/`top` by default. Measured with a finger held
    // still: left 83.53, still walking to 84 six hundred milliseconds later.
    // A clamp that the box is only ON EVENTUALLY does not clear a fingertip
    // while it travels. `e2e/chart-tooltip-viewport.spec.ts` is what measures
    // it; this is the one-token canary.
    expect(code).toMatch(/motion="none"/);
  });

  test("measures the CHART, never itself", () => {
    // Reading the tooltip's own box here is the PR #60 loop. The only rect it
    // may read is the container's, which is an input and not an output.
    expect(code).toContain("ctx.containerRef");
    expect(code).not.toMatch(/rootRef|clientWidth|clientHeight|offsetWidth/);
  });
});
