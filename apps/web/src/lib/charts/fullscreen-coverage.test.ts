/**
 * Every chart in the app can be taken to the whole screen.
 *
 * Not a list of today's charts — a list is green the day someone adds the
 * fourteenth one. The charts are discovered from disk by the thing that makes a
 * component a chart (layerchart's container, which is where `CHART_BOX`'s fixed
 * height is written), and the control is discovered by walking the import graph
 * *upwards* until a file that offers one: a `Section` asked for `fullscreen`, or
 * the standalone `ChartFullscreen` frame.
 *
 * What this can and cannot see: it proves a chart has an ancestor that offers
 * the control, not that the control's box contains that particular chart. The
 * difference is real — `decision-charts.svelte` had one control for a card
 * holding two plots and three paragraphs, and expanding it split a landscape
 * screen five ways and left each plot 59px tall. That is a judgement about
 * *which* box to expand, and no sweep can make it; this one only holds the
 * floor, that no chart ships without a way to make it big.
 */

import { describe, expect, test } from "bun:test";

const SRC = new URL("../../", import.meta.url);
const files = [...new Bun.Glob("**/*.svelte").scanSync(SRC.pathname)]
  // Vendored shadcn primitives and generated output are not this app's charts.
  .filter((f) => !f.startsWith("lib/components/ui/") && !f.includes("paraglide"))
  .sort();
const sources = new Map<string, string>(
  await Promise.all(
    files.map(async (f) => [f, await Bun.file(new URL(f, SRC)).text()] as [string, string]),
  ),
);

const read = (file: string): string => sources.get(file) ?? "";

/**
 * Which components a file imports, as `Tag → file`. Only `$lib/…` and relative
 * paths — a package import is not a file in this graph.
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
 * A chart is a component that renders layerchart's container. That is the
 * element `CHART_BOX`'s fixed height lands on, and the element the expansion
 * overrides — so it is the same definition the feature itself uses.
 */
// `<Chart.Container` (the shadcn wrapper) or a bare `<Chart` (layerchart's own
// component, used directly by the correction heat map). NOT `<Chart.Tooltip` —
// a tooltip is not a plot, and counting one would let the "we found at least
// ten charts" guard be satisfied by tooltip components.
const charts = files.filter((f) => /<Chart\.Container[\s/>]|<Chart[\s/>]/.test(read(f)));

/**
 * A file that declares the control itself, rather than through a component.
 *
 * The `(?=[\s/>])` after the tag name is load-bearing: without it `<Section`
 * also matches `<SectionHeader … screen={fullscreen ? …} />` inside
 * `section.svelte`, which made the section card itself read as a full-screen
 * provider — and then every section in the app, so nothing could ever fail.
 */
function declaresFullscreen(file: string): boolean {
  const code = read(file);
  if (code.includes("<ChartFullscreen")) return true;
  // `fullscreen` as a bare prop on a Section open tag — not the word appearing
  // in a comment somewhere in the file.
  return /<Section(?=[\s/>])(?:[^<>]|\{[^{}]*\})*?\bfullscreen\b/.test(code);
}

/**
 * The ranges of a file's template that sit inside a full-screen control: a
 * `<ChartFullscreen>` frame, a `<Section>` asked for `fullscreen`, or any
 * component this file renders that declares one of those itself (a chart put
 * inside `<ChartPanel>` is inside that panel's full-screen section).
 *
 * Ranges, not "the word appears in the file": containment is the whole
 * question. `decision-charts.svelte` declares two frames AND renders text
 * outside them; a file-level check would call anything in it covered.
 */
function blockRange(code: string, open: RegExpMatchArray, tag: string): [number, number] | null {
  const close = code.indexOf(`</${tag}>`, open.index);
  return close === -1 ? null : [open.index!, close];
}

/** Component tags in this file that are, or contain, a full-screen control. */
function providerTags(file: string): string[] {
  const tags = ["ChartFullscreen"];
  for (const [tag, target] of importsOf(file)) {
    if (declaresFullscreen(target)) tags.push(tag);
  }
  return [...new Set(tags)];
}

function providerRanges(file: string): [number, number][] {
  const code = read(file);
  const ranges: [number, number][] = [];
  for (const tag of providerTags(file)) {
    const open = new RegExp(`<${tag}(?=[\\s/>])(?:[^<>]|\\{[^{}]*\\})*?>`, "g");
    for (const at of code.matchAll(open)) {
      const range = blockRange(code, at, tag);
      if (range) ranges.push(range);
    }
  }
  const section = /<Section(?=[\s/>])(?:[^<>]|\{[^{}]*\})*?\bfullscreen\b(?:[^<>]|\{[^{}]*\})*?>/g;
  for (const at of code.matchAll(section)) {
    const range = blockRange(code, at, "Section");
    if (range) ranges.push(range);
  }
  return ranges;
}

/** Does `at` fall inside any of these ranges? */
function within(ranges: [number, number][], at: number): boolean {
  return ranges.some(([from, to]) => at > from && at < to);
}

/** Every place a file renders `<Tag`, as offsets. */
function renderSites(file: string, tag: string): number[] {
  return [...read(file).matchAll(new RegExp(`<${tag}[\\s/>]`, "g"))].map((m) => m.index);
}

/**
 * Is every rendering of this component inside a full-screen control?
 *
 * Recursive, because most charts are rendered by a thin wrapper that is itself
 * rendered inside the control: `DecisionChart` is drawn by
 * `decision-power-chart.svelte`, and it is *that* component the frame in
 * `decision-charts.svelte` wraps. So a site passes if it is inside a control,
 * or if the file it sits in is itself covered everywhere it is used.
 *
 * A component nothing renders is NOT covered — an unreachable chart would
 * otherwise pass by having no sites to check.
 */
const coverage = new Map<string, boolean>();

/** A file that wraps its OWN plot — the correction heat map draws a bare
 *  layerchart `<Chart>` inside its own frame, and the settings form that
 *  renders it knows nothing about any of this. */
function wrapsOwnPlot(file: string): boolean {
  const at = read(file).search(/<Chart[.\s/>]/);
  return at !== -1 && within(providerRanges(file), at);
}

function covered(file: string, stack = new Set<string>()): boolean {
  const memo = coverage.get(file);
  if (memo !== undefined) return memo;
  if (stack.has(file)) return false;
  stack.add(file);
  const result = wrapsOwnPlot(file) || coveredByParents(file, stack);
  stack.delete(file);
  coverage.set(file, result);
  return result;
}

/** Every place a parent renders this component is inside a control, or that
 *  parent is itself covered everywhere IT is used. */
function coveredByParents(file: string, stack: Set<string>): boolean {
  const tag = tagOf(file);
  let sites = 0;
  let ok = true;
  for (const parent of files) {
    if (importsOf(parent).get(tag) !== file) continue;
    const ranges = providerRanges(parent);
    for (const at of renderSites(parent, tag)) {
      sites++;
      if (!within(ranges, at) && !covered(parent, stack)) ok = false;
    }
  }
  // A component nothing renders is NOT covered — an unreachable chart would
  // otherwise pass by having no sites to check.
  return sites > 0 && ok;
}

/** The tag a file is imported under, wherever it is imported. */
function tagOf(file: string): string {
  for (const parent of files) {
    for (const [tag, target] of importsOf(parent)) if (target === file) return tag;
  }
  return "";
}

describe("the sweep finds what it claims to", () => {
  test("discovers the charts, not a handful of them", () => {
    // A discovery that quietly stops matching passes exactly as green as one
    // that holds.
    expect(charts.length).toBeGreaterThanOrEqual(10);
  });

  test.each([
    "lib/components/statistics/period-series-chart.svelte",
    "lib/components/statistics/yoy-chart.svelte",
    "lib/components/prices/price-track-chart.svelte",
    "lib/components/inverter/live-area.svelte",
    "lib/components/automations/decision-chart.svelte",
    "lib/components/settings/forecast-correction-panel.svelte",
  ])("%s is one of them", (file) => {
    expect(charts).toContain(file);
  });

  test("a component nobody renders is not covered", () => {
    // Otherwise an unreachable chart passes by having no sites to check, and
    // the rule below can never fail for a newly added file.
    expect(covered("lib/components/nonexistent-chart.svelte")).toBe(false);
  });

  test("a rendering outside the control is not covered by one inside it", () => {
    // The containment check is the point: `decision-charts.svelte` declares two
    // frames and renders three paragraphs outside them.
    const ranges = providerRanges("lib/components/automations/decision-charts.svelte");
    expect(ranges.length).toBeGreaterThanOrEqual(2);
    const code = read("lib/components/automations/decision-charts.svelte");
    const outside = code.indexOf("<RangeSwitcher");
    expect(outside).toBeGreaterThan(0);
    expect(within(ranges, outside)).toBe(false);
  });
});

/**
 * Charts that ship without the control, each with the reason. An entry is a
 * claim that a plot is not worth making big, and it has to be argued here
 * before it is written.
 *
 * `live-area` is on the list for ONE of its two uses: the history card wraps it
 * in a full-screen section, but the dashboard KPI tile draws the same component
 * as a decorative 40px sparkline under a big number, with no header row to put
 * a control in and nothing in it a bigger view would reveal. The component is
 * covered where it is a chart and exempt where it is an ornament, which is a
 * distinction this sweep cannot draw — hence the entry rather than a rule.
 */
const NOT_WORTH_EXPANDING = ["lib/components/inverter/live-area.svelte"];

describe("every chart can be taken full screen", () => {
  test.each(charts.filter((c) => !NOT_WORTH_EXPANDING.includes(c)))("%s", (chart) => {
    expect(covered(chart)).toBe(true);
  });
});

/**
 * The other half of the claim: WHICH box the control expands.
 *
 * The sweep above holds the floor — no chart ships without a way to make it big.
 * These hold the ceiling on /statistics, and they are the decision that was made
 * when that page's control count was cut: the control stays on the panel that
 * holds one plot, and the four section cards above them do NOT get one.
 *
 * Expanding a box expands everything in it. `EXPANDED_SECTION`
 * (`$lib/layout/tokens`) puts `flex-1 min-h-0` on every ancestor of every
 * `[data-slot=chart]` in the card, so plots in one box divide whatever the
 * card's tiles, nested panel headers and legends leave — and on this page they
 * leave nothing. Measured on a 390x844 phone with the control hoisted to the
 * four section cards: Costs & savings 69px for its one plot, Energy 0/0/0/0 for
 * its four, Spot prices 0/0, Records 0 — against the 192px every one of those
 * plots already has in the scrolling page. Hoisting would have removed five
 * buttons and made all four expansions worse than not expanding at all.
 * `decision-charts.svelte` shipped that once — one control, two plots, three
 * paragraphs, 59px of plot — and the containment check in this file is what was
 * written for it.
 */
describe("on /statistics the control sits on the plot, not on the card above it", () => {
  const SHELL = "routes/(app)/statistics/statistics-section.svelte";
  const PANEL = "routes/(app)/statistics/chart-panel.svelte";

  test("the four section cards offer none", () => {
    // Read off the shell every section renders through, so this cannot be
    // satisfied by today's four sections happening not to ask for it.
    expect(read(SHELL)).toMatch(/<Section(?=[\s/>])/);
    expect(declaresFullscreen(SHELL)).toBe(false);
  });

  test("the chart panel is the provider, so a plot is one control's whole box", () => {
    expect(declaresFullscreen(PANEL)).toBe(true);
    // And it is the panel every plotted statistics block goes through.
    for (const file of [
      "routes/(app)/statistics/cost-section.svelte",
      "routes/(app)/statistics/energy-section.svelte",
      "routes/(app)/statistics/price-curves.svelte",
    ]) {
      expect(importsOf(file).get("ChartPanel")).toBe(PANEL);
    }
  });

  // A control over a box with no plot in it promises a bigger view of a list.
  // The negative-window history is a grouped list of times, height-unconstrained
  // and already fully visible in the page.
  test("a panel that plots nothing offers no bigger view of it", () => {
    const list = "routes/(app)/statistics/negative-window-history.svelte";
    expect(read(list)).not.toMatch(/<Chart\.Container[\s/>]|<Chart[\s/>]/);
    expect(providerRanges(list)).toEqual([]);
    expect(importsOf(list).has("ChartPanel")).toBe(false);
  });
});

/**
 * The offer has to resolve to a control.
 *
 * Everything above proves a chart has an ancestor that OFFERS full screen —
 * a `<Section fullscreen>` or a `<ChartFullscreen>` frame. That was the whole
 * claim while the trigger rendered inside `Section`'s own header: offering it and
 * drawing it were the same act.
 *
 * They are not any more. The control moved into the plot's bottom-right corner,
 * diagonally opposite the zoom reset, because in the header cluster it sat one
 * icon away from the collapse caret and the two were mispressed for each other.
 * `Section` now publishes its {@link FullscreenBox} through context and
 * `layout/plot-frame.svelte` consumes it — so a card can ask for full screen,
 * pass every case above, and render no button at all if nothing in its body is a
 * plot frame. That failure is invisible in review and total for the reader.
 *
 * So: every file that declares the offer must reach a `PlotFrame`, and the
 * reaching is transitive, because the frame is inside whichever chart component
 * the card happens to render.
 */
describe("a card that offers full screen actually draws the control", () => {
  const FRAME = "lib/components/layout/plot-frame.svelte";

  /** Does this file, or anything it renders, render the plot frame? */
  const framed = new Map<string, boolean>();
  function reachesFrame(file: string, stack = new Set<string>()): boolean {
    const memo = framed.get(file);
    if (memo !== undefined) return memo;
    if (stack.has(file)) return false;
    stack.add(file);
    const code = read(file);
    const result =
      /<PlotFrame(?=[\s/>])/.test(code) ||
      [...importsOf(file).values()].some((target) => reachesFrame(target, stack));
    stack.delete(file);
    framed.set(file, result);
    return result;
  }

  /**
   * Cards whose plot is not theirs to render: the body arrives as `children`,
   * from a caller.
   *
   * `chart-panel.svelte` is the /statistics panel — it draws the card, the
   * caption and the readout row, and the plot comes from `cost-section`,
   * `energy-section` or `price-curves`. The import graph does not cross a slot,
   * so no edit to any chart could ever make the panel itself reach a frame, and
   * the one edit that would — a `<PlotFrame>` in the panel, around
   * `{@render children()}` — is wrong: several panels put a legend or a footer in
   * that slot too, and the frame would hand the corner control to the legend.
   *
   * So for these the rule moves to the callers, which is where the plot actually
   * is. That is a real check and not a hole: each of the three sections below
   * imports its charts directly.
   */
  const BODY_FROM_CALLER: Record<string, string> = {
    "routes/(app)/statistics/chart-panel.svelte": "ChartPanel",
  };

  /** Every file that puts `fullscreen` on a Section — the cards under this rule.
   *  `section.svelte` itself is excluded: it is the component the prop is passed
   *  TO, and it forwards it to its own header. */
  const offering = files.filter(
    (f) =>
      declaresFullscreen(f) &&
      !f.endsWith("layout/section.svelte") &&
      !read(f).includes("<ChartFullscreen") &&
      !(f in BODY_FROM_CALLER),
  );

  /** The files that fill a slot-bodied card, as `[card, filler]` pairs. */
  const fillers = Object.entries(BODY_FROM_CALLER).flatMap(([card, tag]) =>
    files.filter((f) => importsOf(f).get(tag) === card).map((f) => [card, f] as const),
  );

  test("there are cards to check, so this rule cannot pass by matching nothing", () => {
    expect(offering.length).toBeGreaterThanOrEqual(5);
  });

  test.each(offering)("%s reaches a PlotFrame", (file) => {
    expect(reachesFrame(file)).toBe(true);
  });

  test("the slot-bodied cards have fillers to check", () => {
    // Otherwise the rule below passes by matching nothing, and the busiest page
    // in the app would be checked by no case at all.
    expect(fillers.length).toBeGreaterThanOrEqual(3);
  });

  test.each(fillers)("%s is filled by %s, which reaches a PlotFrame", (_card, filler) => {
    expect(reachesFrame(filler)).toBe(true);
  });

  // The frame is what publishes the trigger into the corner; a frame that drew
  // no button would satisfy the rule above and still ship nothing.
  test("the frame draws the trigger, positioned in the plot's own corner", () => {
    const code = read(FRAME);
    expect(code).toContain("<FullscreenTrigger");
    expect(code).toMatch(/absolute[^"']*bottom-/);
    expect(code).toContain("useFullscreen");
  });

  // And the header no longer does. Both places drawing it is the mispress this
  // change exists to remove, and it would look correct in every screenshot.
  test("the header cluster no longer draws one", () => {
    expect(read("lib/components/layout/section-actions.svelte")).not.toContain(
      "<FullscreenTrigger",
    );
  });
});
