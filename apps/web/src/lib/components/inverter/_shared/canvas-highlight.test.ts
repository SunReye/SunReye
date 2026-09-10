/**
 * That the canvas hover wash is ONE decision, in the module that owns it.
 *
 * A canvas LayerChart cannot read the `.lc-highlight-area` CSS rule, so every
 * canvas chart has to hand the highlight a concrete colour or get an opaque slab
 * over the hovered band. `canvasHighlight()` was extracted for exactly that —
 * its own header says "a copy per chart is how the two of them drifted into a
 * clone" — but it handed back only the COLOUR, so each of the four charts still
 * wrote the wash itself:
 *
 *     highlight={{ area: { fill: highlight.fill, fillOpacity: 0.1 } }}
 *
 * Four copies of one decision, and once the house-style pass made the charts
 * around that line identical too, it became the longest of the clone groups
 * `fallow dupes` reported (9 lines, period-series-chart <-> yoy-chart). The
 * opacity belongs to the helper: it is what "a low opacity" MEANS here, and a
 * fifth canvas chart picking 0.2 is a hover that reads as a different state.
 *
 * Source-text, because `canvas-highlight.svelte.ts` holds a `$state` rune and
 * runes do not run under `bun test` (apps/web/TESTING.md). Read that file's
 * "Writing a source-text test" first: every case here pins the identifier the
 * chart really passes, not that a string appears somewhere in it.
 */

import { describe, expect, test } from "bun:test";

const SRC = new URL("../../../../", import.meta.url);
const files = [...new Bun.Glob("**/*.{svelte,ts}").scanSync(SRC.pathname)]
  // Vendored shadcn primitives and generated message catalogues are not ours.
  .filter((f) => !f.startsWith("lib/components/ui/") && !f.includes("paraglide"))
  .filter((f) => !f.endsWith(".test.ts"))
  .sort();
const sources = new Map<string, string>(
  await Promise.all(
    files.map(async (f) => [f, await Bun.file(new URL(f, SRC)).text()] as [string, string]),
  ),
);

const read = (file: string): string => {
  const text = sources.get(file);
  if (text === undefined) throw new Error(`no such source: ${file}`);
  return text;
};

/** The module that owns the wash; every census below excludes it by name. */
const HELPER = "lib/components/inverter/_shared/canvas-highlight.svelte.ts";

/**
 * Every canvas chart, discovered by the workaround it needs.
 *
 * A census and not a list: the charts that need this are the ones drawing
 * through `layerchart/canvas`, and the fifth of them is the one a list cannot
 * see. Today it finds the price track, the two statistics bar charts and the
 * forecast chart.
 */
const canvasCharts = files.filter((f) => f !== HELPER && read(f).includes("canvasHighlight("));

/**
 * Which components a file renders, as `Tag → file` — relative and `$lib/…`
 * `.svelte` imports, in the style of `charts/fullscreen-coverage.test.ts`.
 */
function importsOf(file: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of read(file).matchAll(
    /import\s+(\w+)(?:,\s*\{[^}]*\})?\s+from\s+['"]([^'"]+)['"]/g,
  )) {
    const [, tag, path] = m;
    if (!path!.endsWith(".svelte")) continue;
    if (path!.startsWith("$lib/")) out.set(tag!, path!.replace("$lib/", "lib/"));
    else if (path!.startsWith("."))
      out.set(tag!, new URL(path!, `file:///${file}`).pathname.slice(1));
  }
  return out;
}

/**
 * Does the wash bound to `name` reach a `highlight` prop — in this file, or in
 * a mark component this file HANDS it to?
 *
 * The hop exists because the grouped bar mark is one component shared by the
 * two statistics bar charts. It is followed rather than assumed: a `{highlight}`
 * handed to a component that never spends it is the same opaque slab this whole
 * file is about.
 */
function spendsHighlight(file: string, name: string): boolean {
  if (!sources.has(file)) return false;
  const code = read(file);
  if (code.includes(`highlight={${name}.props}`)) return true;
  for (const [tag, target] of importsOf(file)) {
    const tags = [...code.matchAll(new RegExp(`<${tag}(?=[\\s/>])(?:[^<>]|\\{[^{}]*\\})*?>`, "g"))];
    const handed = tags.some((t) => new RegExp(`\\{${name}\\}|\\w+=\\{${name}\\}`).test(t[0]));
    // In the target the wash arrives as a prop, and the prop is `highlight`.
    if (handed && spendsHighlight(target, "highlight")) return true;
  }
  return false;
}

describe("the hovered-band wash", () => {
  test("the sweep finds the canvas charts, not a handful of them", () => {
    // A discovery that quietly stops matching passes exactly as green as one
    // that holds.
    expect(canvasCharts.length).toBeGreaterThanOrEqual(4);
  });

  test("no chart builds the wash itself", () => {
    // The clone, in one regex: an inline object on the `highlight` prop is a
    // chart deciding its own hover opacity. There is one hover state in the
    // app, so there is one place it is written.
    const inline = canvasCharts.filter((f) => /highlight=\{\{/.test(read(f)));
    expect(inline).toEqual([]);
  });

  test.each(canvasCharts)("%s spends the helper it built", (file) => {
    const code = read(file);
    // The identifier the chart bound the helper to, and THAT is what has to
    // reach the prop — `canvasHighlight()` called and thrown away, with the
    // literal still on the chart, is the state this undoes.
    const helper = /const\s+(\w+)\s*=\s*canvasHighlight\(\)/.exec(code)?.[1];
    expect(helper, `${file} binds no canvasHighlight controller`).toBeDefined();
    expect(spendsHighlight(file, helper!)).toBe(true);
  });

  test("the hop to a shared mark is followed, not assumed", () => {
    // The two statistics bar charts draw through one mark component now
    // (`statistics/grouped-bar-plot.svelte`), so for them the prop is one hop
    // down. Without following the hop the case above would pass on the chart's
    // own text; without CHECKING the hop it would pass on `{highlight}` handed
    // to a component that drops it.
    const yoy = "lib/components/statistics/yoy-chart.svelte";
    expect(read(yoy)).not.toContain("highlight={highlight.props}");
    expect(spendsHighlight(yoy, "highlight")).toBe(true);
    expect(spendsHighlight("lib/components/statistics/series-tooltip.svelte", "highlight")).toBe(
      false,
    );
  });

  test("and the opacity lives in the helper, once", () => {
    // Pinned in the module rather than beside the assertion: the value is a
    // decision (a wash you can read a bar through), and the point of the case
    // is that exactly one file carries it.
    expect(read(HELPER)).toMatch(/fillOpacity:\s*0\.1\b/);
    const others = files.filter((f) => f !== HELPER && /fillOpacity:\s*0\.1\b/.test(read(f)));
    expect(others).toEqual([]);
  });
});
