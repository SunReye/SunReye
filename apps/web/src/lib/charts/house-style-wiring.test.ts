/**
 * That the house style in ./house-style.ts is what the charts actually draw.
 *
 * The table is worth nothing while nineteen components still spell their own
 * curve, weight and dash. So these cases are a CENSUS, discovered from disk:
 * one module names the d3 curves, one module holds the two dash patterns, one
 * module holds the stroke weight, and every plot spends them. A census fails
 * for the chart that does not exist yet, which a list of today's files cannot.
 *
 * Source-text, because runes do not run under `bun test` and there is no render
 * harness (apps/web/TESTING.md). Read that file's "Writing a source-text test"
 * first: every case below pins a STRUCTURE or captures the identifier really
 * passed. "The file mentions houseLine" stays green for a chart that calls it,
 * throws the result away and draws its own literal — which is precisely the
 * state this pass is undoing.
 *
 * The behaviour that only exists in a document — that the energy chart's marks
 * really are filled rects and not a stroked polyline — is
 * `e2e/chart-house-style.spec.ts`. This file cannot see a drawn mark.
 */

import { describe, expect, test } from "bun:test";
import { MARK_STYLE } from "./house-style";

const SRC = new URL("../../", import.meta.url);
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

/** Files matching a pattern, as a sorted census. */
const matching = (re: RegExp): string[] => files.filter((f) => re.test(read(f))).sort();

/** The module that owns the vocabulary; every census excludes it by name. */
const TABLE = "lib/charts/house-style.ts";

describe("the curve vocabulary lives in one module", () => {
  test("nothing in the app draws with curveCatmullRom", () => {
    // The bug, not the taste: the spline overshoots its control points, so a PV
    // area drawn through a sunny day's samples peaks above the highest sample —
    // a watt figure the plant never produced, disagreeing with its own tooltip.
    //
    // The table itself is excluded because it NAMES the ban in its own header,
    // and the two cases that matter for that file are elsewhere: no d3 curve
    // import here (below) and `CURVE[k] !== curveCatmullRom` for every kind
    // (./house-style.test.ts).
    expect(matching(/curveCatmullRom/).filter((f) => f !== TABLE)).toEqual([]);
  });

  test("and only the table names a d3 curve at all", () => {
    // A census rather than a list: a new chart that imports `curveNatural`
    // straight from d3-shape is a second house style, and nothing else would
    // say so. It states its KIND and the table answers.
    const importers = matching(/from\s+["']d3-shape["']/).filter((f) => f !== TABLE);
    expect(importers).toEqual([]);
  });
});

describe("one stroke weight and two dash patterns, in one place", () => {
  test("no component writes its own stroke weight", () => {
    // `'stroke-width': 1.5` in eight files and `2` in a ninth is how the plots
    // ended up implying an emphasis none of them meant.
    const literal = /["']stroke-width["']\s*:\s*\d/;
    expect(matching(literal).filter((f) => f !== TABLE)).toEqual([]);
  });

  test("no component writes its own dash pattern", () => {
    // `'5 4'` meant three different things across three files and `'2 3'` a
    // fourth. A dash the reader cannot decode is decoration.
    const literal = /["'](?:\d+\s+\d+)["']/;
    const offenders = matching(literal).filter((f) => f !== TABLE);
    expect(offenders).toEqual([]);
  });
});

/**
 * Every component that CHOOSES a kind, with the kind it chooses.
 *
 * The pairs are the reviewable decision — "this file plots THAT" — and the case
 * below is that the file says so in the argument it really passes.
 *
 * Charts that were already drawn with the right mark and take nothing from the
 * table (the bar charts, the two heat matrices' axes) carry no kind: a prop
 * nothing reads is decoration, and a census over decoration cannot fail
 * usefully. Their kinds are recorded in the survey, not in the source.
 */
const KIND_OF: Record<string, string> = {
  // One instantaneous measure, filled. A MARK component rather than a chart:
  // the live sparkline and the history card both draw this one, chosen against
  // the signed mark below in the same `{#if diverging}`.
  "lib/components/inverter/power-area.svelte": "power",
  // The same measure when it is signed — the fill splits at zero.
  "lib/components/inverter/diverging-area.svelte": "flow",
  // Several measures compared on one plot.
  "lib/components/inverter/custom-live-chart.svelte": "overlay",
  "lib/components/inverter/_shared/custom-chart-plot.svelte": "overlay",
  "lib/components/automations/decision-power-chart.svelte": "overlay",
  "lib/components/automations/soc-chart.svelte": "overlay",
  "lib/components/statistics/ratio-trend-chart.svelte": "overlay",
  // A decomposition of one total into the parts that make it up.
  "lib/components/automations/plan-power-chart.svelte": "stack",
  // A quantity that belongs to a bucket, not to an instant.
  "lib/components/statistics/energy-series-chart.svelte": "energy",
  // A register's value, held until the next write.
  "lib/components/automations/decision-ceiling-chart.svelte": "setpoint",
};

/**
 * The shared plot bodies. Their kind arrives as a PROP, so they cannot name one
 * — what they must do instead is read the table with it rather than carrying a
 * mark style of their own.
 */
const SHELLS = [
  "lib/components/automations/decision-chart.svelte",
  "lib/components/statistics/period-series-chart.svelte",
];

describe("every plot states the kind it plots", () => {
  test.each(Object.entries(KIND_OF))("%s plots %s", (file, kind) => {
    const code = read(file);
    // The kind as an ARGUMENT or a prop value, not as a word in the file: the
    // string "power" appears in half these files as a label or a metric id.
    const spent = new RegExp(`(?:houseLine\\(|kind=)["']${kind}["']`);
    expect(spent.test(code)).toBe(true);
  });

  test("the census is the whole set of components that choose one", () => {
    // A new chart choosing a kind nobody wrote down is the regression this
    // exists for, and a hand-kept list of today's files cannot see it.
    // Scoped to the kinds that exist: `kind=` is also an ordinary prop name in
    // this app (a TOU cell's input type), and a census that counts those can
    // only be kept green by editing it.
    const anyKind = Object.keys(MARK_STYLE).join("|");
    const chooses = new RegExp(`houseLine\\(["'](?:${anyKind})["']|kind=["'](?:${anyKind})["']`);
    const choosers = matching(chooses).filter((f) => f !== TABLE);
    expect(choosers.sort()).toEqual(Object.keys(KIND_OF).sort());
  });

  test("and every component that draws a line mark is one of them, or a shell", () => {
    // `<Area` / `<Spline` is what makes a component one of these plots. A file
    // that draws one and neither names a kind nor takes one is a mark with a
    // style of its own, which is the state being undone.
    const drawing = matching(/<(?:Area|Spline)[\s/>]/).filter((f) => f !== TABLE);
    const allowed = new Set([...Object.keys(KIND_OF), ...SHELLS]);
    expect(drawing.filter((f) => !allowed.has(f))).toEqual([]);
    // And the discovery still finds them: a regex that quietly stops matching
    // passes exactly as green as one that holds.
    expect(drawing.length).toBeGreaterThanOrEqual(5);
  });

  test.each(SHELLS)("%s reads the table with the kind it was handed", (file) => {
    const code = read(file);
    expect(code).toMatch(/(?:CURVE|MARK_STYLE)\[kind\]|houseLine\(kind/);
  });
});

describe("a chart hands on the treatment it asked for", () => {
  // The sharp one. `houseLine('power')` called and discarded, with the literal
  // still on the mark, passes any "mentions the helper" check while changing
  // nothing — so capture what the call was assigned to (or spread inline) and
  // require THAT to be what reaches the mark.
  const AREA_CALLERS = [
    "lib/components/inverter/power-area.svelte",
    "lib/components/inverter/diverging-area.svelte",
    "lib/components/inverter/_shared/custom-chart-plot.svelte",
    "lib/components/inverter/custom-live-chart.svelte",
  ];

  test.each(AREA_CALLERS)("%s spreads the treatment onto its mark", (file) => {
    const code = read(file);
    // Either spread straight onto the mark, or via a `const` that is then
    // spread. Both are "the mark is drawn with what the table returned".
    const inline = /\{\.\.\.houseLine\(/.test(code);
    const named = /(?:const|@const)\s+(\w+)\s*=\s*(?:\$derived\()?houseLine\(/.exec(code)?.[1];
    expect(inline || (named !== undefined && code.includes(`{...${named}}`))).toBe(true);
  });

  /**
   * The two plots of the SAME measure, and the mark they share.
   *
   * The previous pass converged them by hand: `fallow dupes` then reported the
   * live sparkline's fill and the history card's as character-for-character the
   * same, six lines each. Two files agreeing is not one decision — it is one
   * decision waiting to drift back, and the drift it drifts back to is the one
   * this whole pass exists to undo (a flat 0.3 wash on the sparkline against a
   * 0.9 gradient on the card, which read as two different measures).
   */
  const POWER_PLOTS = [
    "lib/components/inverter/live-area.svelte",
    "lib/components/inverter/_shared/metric-history-chart.svelte",
  ];

  test.each(POWER_PLOTS)("%s draws the shared power area, not its own copy", (file) => {
    const code = read(file);
    // The tag it RENDERS, resolved from its own import — not "the file mentions
    // the component", which an import left behind after the mark was inlined
    // again would satisfy.
    const tag = /import\s+(\w+)\s+from\s+["'][^"']*power-area\.svelte["']/.exec(code)?.[1];
    expect(tag, `${file} imports no shared power area`).toBeDefined();
    expect(code).toMatch(new RegExp(`<${tag}[\\s/>]`));
    // And keeps no second gradient beside it. `LinearGradient` is the element
    // the fill is built from, so its absence is what says the copy is gone
    // rather than merely unused.
    expect(code).not.toContain("LinearGradient");
  });

  test("and one file decides the power fill for both of them", () => {
    // The anti-clone gate, discovered rather than listed: a third plot of an
    // instantaneous measure that spells its own `houseLine('power')` gradient
    // is the regression, and it fails here on the day it is written.
    expect(matching(/houseLine\(["']power["']/)).toEqual([
      "lib/components/inverter/power-area.svelte",
    ]);
  });

  test("the decision plots turn their kind into a curve through the table", () => {
    // `decision-chart` is the shared body behind four plots; it used to take a
    // `curve` prop, which is how two of the four ended up smoothed and two not.
    const code = read("lib/components/automations/decision-chart.svelte");
    expect(code).toMatch(/CURVE\[kind\]|houseLine\(kind/);
    // And the prop it takes is the kind, not a curve factory.
    expect(code).not.toMatch(/curve:\s*CurveFactory/);
  });
});

describe("the two heat matrices draw the same cell", () => {
  test.each([
    "lib/components/statistics/heat-grid.svelte",
    "lib/components/settings/forecast-correction-panel.svelte",
  ])("%s spends the house cell geometry", (file) => {
    const code = read(file);
    expect(code).toContain("{...houseCell()}");
    // And not its own copy of the inset/radius pair beside it.
    expect(code).not.toMatch(/insets=\{/);
  });
});
