/**
 * Nothing in this app may name a colour as `var(--color-chart-N)`.
 *
 * `--color-chart-N` is Tailwind's `@theme inline` mapping, and Tailwind only
 * re-emits a mapped token whose name it can SEE as a literal in scanned source.
 * The chart palette composes its names at runtime (`var(--${id})` in
 * chart-palette.ts), so it gives Tailwind nothing to see — which makes the
 * property's existence depend on whether some unrelated file happens to spell
 * the same number out.
 *
 * It has failed twice already. `--chart-6` resolved to nothing the day the
 * palette grew past five, because no file spelled it. And the semantic
 * migration deleted the last literals keeping `--color-chart-1..5` alive, which
 * would have left the history card and the live sparkline stroking with a
 * transparent colour: a chart that draws nothing, and no error anywhere.
 *
 * `--chart-N` is declared in an ordinary `:root` rule and is always there.
 *
 * NOT banned: `var(--color-energy-*)`. Those names ARE spelled out literally,
 * in the eight chart components that use them, so Tailwind keeps them — the
 * hazard is composition, not the `--color-` prefix.
 */

import { describe, expect, test } from "bun:test";

const SRC = new URL("../../", import.meta.url);
const files = [...new Bun.Glob("**/*.{svelte,ts}").scanSync(SRC.pathname)]
  // These two name the forbidden string in order to reject it: this sweep, and
  // chart-palette's own case asserting `colorVar` never produces it.
  .filter((f) => !f.endsWith("token-usage.test.ts") && !f.endsWith("chart-palette.test.ts"))
  .sort();

const sources = new Map<string, string>(
  await Promise.all(
    files.map(async (f) => [f, await Bun.file(new URL(f, SRC)).text()] as [string, string]),
  ),
);

describe("chart colours are named as the theme declares them", () => {
  test("the sweep sees the whole app", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  test("no source resolves a chart colour through the Tailwind mapping", () => {
    const offenders = files.filter((f) => sources.get(f)!.includes("var(--color-chart-"));
    expect(offenders).toEqual([]);
  });

  test("the palette helper hands out the raw property", () => {
    // The detector above is only as good as there being one place that builds
    // these names; if `colorVar` started composing `--color-` again, every
    // call site would be wrong at once and none of them would say so.
    const palette = sources.get("lib/inverter/chart-palette.ts")!;
    expect(palette).toContain("return `var(--${id})`");
  });
});
