/**
 * Phase 3 of the layout system: what the dashboard does with 412 CSS pixels.
 *
 * Measured on a 412x961 phone before this: /statistics was 7371px tall, of
 * which ~1400px was 31 stat tiles stacked one to a row; /automations scrolled
 * sideways; and the same tiles rendered 2-up on the peak-shaving page. None of
 * that was decided — it is what a missing base column count and a desktop-sized
 * chart gutter do when nobody looks at the small end.
 *
 * There is no component-rendering harness (`apps/web/TESTING.md`), so these
 * cases read the sources. The rules are written over the WHOLE app rather than
 * over the files this phase touched: the point is that the next hand-rolled
 * grid or chart box fails too, not that today's are green.
 */

import { describe, expect, test } from "bun:test";
import { fittedPadding, type ChartPadding } from "$lib/charts/plot-padding";
import { chartPaddingFor } from "$lib/cost/ranges";
import { CHART_BOX, CHART_BOX_SHORT, TAP, TILE_COLUMNS } from "./tokens";

/** A 412px phone's plot box — the width these rules are measured at. */
const PHONE_PLOT = 412;

const SRC = new URL("../../", import.meta.url);

const files = [...new Bun.Glob("**/*.svelte").scanSync(SRC.pathname)].sort();
const sources = new Map<string, string>(
  await Promise.all(
    files.map(async (f) => [f, await Bun.file(new URL(f, SRC)).text()] as [string, string]),
  ),
);

function read(file: string): string {
  const text = sources.get(file);
  if (text === undefined) throw new Error(`no such component: ${file}`);
  return text;
}

/**
 * Every `class` value in a component, as written. Covers the three forms the
 * codebase uses: a quoted attribute (which may interpolate `{…}`), an
 * expression holding a template or quoted literal, and `class={cn("…", …)}`
 * where only the literal parts are layout.
 */
function classValues(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/\bclass="([^"]*)"/g)) out.push(m[1]);
  for (const m of code.matchAll(/\bclass=\{([\s\S]*?)\}(?=[\s/>])/g)) {
    for (const lit of m[1].matchAll(/[`'"]([^`'"]*)[`'"]/g)) out.push(lit[1]);
  }
  return out;
}

/** `class` values on elements/components whose tag matches `tag`. */
function classValuesOn(code: string, tag: RegExp): string[] {
  const out: string[] = [];
  for (const open of code.matchAll(/<([A-Za-z][\w.]*)((?:[^<>]|\{[^{}]*\})*?)\/?>/g)) {
    if (tag.test(open[1])) out.push(...classValues(open[2]));
  }
  return out;
}

const BREAKPOINT_COLUMNS = /(?:^|[\s:[])(?:sm|md|lg|xl|2xl):grid-cols-/;
const BASE_COLUMNS = /(?:^|\s)grid-cols-/;
/** The element is a grid on a phone too — `lg:grid` on a flex column is not. */
const BASE_GRID = /(?:^|\s)grid(?:\s|$)/;

describe("every responsive grid states its phone layout", () => {
  // `grid sm:grid-cols-2` reads like "two columns from sm up, one below". It is
  // not a decision that anyone made: below sm the utility simply does not apply
  // and the grid falls back to its single implicit column. That default is right
  // for a form (two inputs side by side is worse than stacked at 412px) and
  // catastrophic for a readout grid, and the class cannot tell you which one the
  // author meant. Stating the base column count makes it say so.
  const offenders = files.flatMap((file) =>
    classValues(read(file))
      // An element that only becomes a grid at a breakpoint (the overview's
      // `lg:grid`, the settings rail's `md:grid`) has no phone column count to
      // state — it is a flex column down there, on purpose.
      .filter((v) => BASE_GRID.test(v) && BREAKPOINT_COLUMNS.test(v) && !BASE_COLUMNS.test(v))
      .map((v) => `${file}: ${v}`),
  );

  test("no class anywhere sets a breakpoint column count without a base one", () => {
    expect(offenders).toEqual([]);
  });

  // The rule has to survive being handed the column count as a prop, or it just
  // moves the omission one file along. Discovered from disk, so a NEW component
  // taking a column prop is held to it too.
  const columnProps = files.filter((f) => /\b(columns|gridClass)\??:\s*string/.test(read(f)));

  test("the components that take their columns as a prop exist and are found", () => {
    expect(columnProps.length).toBeGreaterThan(0);
  });

  test.each(columnProps)("%s supplies the base column count itself", (file) => {
    const grids = classValues(read(file)).filter((v) => BASE_GRID.test(v));
    expect(grids.length).toBeGreaterThan(0);
    for (const g of grids) expect(g).toMatch(BASE_COLUMNS);
  });
});

describe("statistics tiles", () => {
  const tiles = read("routes/(app)/statistics/stat-tiles.svelte");

  test("spend the shared column ramp instead of a ramp of their own", () => {
    expect(tiles).toContain("{TILE_COLUMNS}");
    expect(tiles).toContain("$lib/layout/tokens");
  });

  test("and the ramp they spend is the one the tokens define", () => {
    expect(TILE_COLUMNS).toContain("grid-cols-2");
  });

  test("let a long total shrink rather than widen its column", () => {
    // Per-tile borders mean no gap, so `[&>*]:min-w-0` has to be spelled here
    // rather than inherited from GRID.tiles.
    expect(tiles).toContain("[&>*]:min-w-0");
  });
});

describe("the automation numeric knobs", () => {
  const grid = read("lib/components/automations/numeric-field-grid.svelte");

  test("are two-up on a phone as well", () => {
    // 17 short numeric fields in one column ran ~1700px at 412px — the form was
    // three viewports tall for values six characters wide. These are not prose
    // fields, so the reason the settings forms stack does not apply.
    const value = classValues(grid).find((v) => BASE_GRID.test(v));
    expect(value).toContain("grid-cols-2");
    expect(value).not.toMatch(BREAKPOINT_COLUMNS);
  });

  test("and their descriptions may wrap inside their half", () => {
    expect(grid).toContain("[&>*]:min-w-0");
  });
});

describe("chart plot boxes", () => {
  // Header + plot + legend at h-64 is ~340px, so a 961px phone fitted two and a
  // half charts. The box is the only part of that stack with slack in it.
  const boxes = files.flatMap((file) =>
    classValuesOn(read(file), /^Chart\.Container$/).map((v) => `${file}: ${v}`),
  );

  test("there are chart containers to hold to the rule", () => {
    expect(boxes.length).toBeGreaterThan(4);
  });

  test.each(boxes)("%s takes its height from the token, not a literal", (box) => {
    const value = box.slice(box.indexOf(": ") + 2);
    // `h-full` fills a box some ancestor sized, and a height held in a variable
    // is asserted where that variable is defined — neither states a size here.
    if (!/(?:^|\s)h-(?!full)/.test(value)) return;
    expect(value).toMatch(/\{CHART_BOX(_SHORT)?\}/);
  });

  test("the box a custom chart's plot fills is the token too", () => {
    // custom-chart-card sizes the box and its plot fills it with `h-full`, so
    // the Chart.Container rule above cannot see this one.
    const card = read("lib/components/inverter/custom-chart-card.svelte");
    expect(card).toContain("{CHART_BOX} w-full");
  });

  test("the chart that takes its height as a prop defaults to the token", () => {
    const chart = read("lib/components/automations/decision-chart.svelte");
    expect(chart).toContain("height = CHART_BOX");
    expect(chart).not.toMatch(/height\s*=\s*['"]h-/);
  });

  // An empty/loading state that is not the same height as the plot it replaces
  // makes the page jump by the difference the moment data lands.
  test.each([
    "lib/components/inverter/forecast-chart.svelte",
    "lib/components/inverter/hourly-bar-chart.svelte",
  ])("%s sizes its empty state to the same box", (file) => {
    const code = read(file);
    expect(code).toContain("{CHART_BOX}");
    expect(code.match(/\{CHART_BOX\}/g)!.length).toBeGreaterThanOrEqual(2);
    expect(code).not.toMatch(/(?:^|\s)h-64(?:\s|"|`)/);
  });

  test("the token itself is the shorter-on-a-phone one", () => {
    expect(CHART_BOX).toStartWith("h-48 ");
    expect(CHART_BOX_SHORT).toStartWith("h-44 ");
  });
});

describe("chart gutters follow the measured plot width", () => {
  // The fixed 60px left gutter was sized for a desktop axis label. On a 412px
  // phone it and the right gutter took a fifth of the plot before a single bar
  // was drawn — and a breakpoint could not tell, because the same component
  // renders full-bleed on /history and two-up inside a statistics section.
  const RAW = /\bCOST_CHART_PADDING\b|\bCOST_X_TICK_SPACING\b|\bHEAT_CHART_PADDING\b/;

  /** A gutter helper call in a component, with its argument list. */
  const GUTTER_CALL =
    /\b(chartPaddingFor|heatPaddingFor|xTickSpacingFor|stackedBarProps)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;

  /**
   * Components that may call a gutter helper without measuring a plot, each with
   * the reason. Empty on purpose: a helper call IS the request for a fitted
   * gutter, and there is no way to fit one to a box nobody measured. An entry
   * here is a claim that some component cannot measure its own plot, and it has
   * to be argued in this comment before it is written.
   */
  const CANNOT_MEASURE: string[] = [];

  // The rule is over the WHOLE app, not over the six files that had the bug.
  // Held per-file, it says nothing about the seventh chart: a new component
  // importing `chartPaddingFor` and calling it with a literal `0` — no
  // `bind:clientWidth` anywhere in it — reinstates the 60px phone gutter with
  // the suite green, because no list names it. Discovered from disk, so the
  // component that does not exist yet is already covered.
  const callers = files.filter((f) => new RegExp(GUTTER_CALL.source).test(read(f)));
  const measurers = callers.filter((f) => !CANNOT_MEASURE.includes(f));

  // A sweep that silently stops matching passes just as green as one that
  // holds. These six are the charts the gutter regression was measured on; the
  // discovery has to still be finding them.
  test.each([
    "lib/components/statistics/period-line-chart.svelte",
    "lib/components/statistics/yoy-chart.svelte",
    "lib/components/statistics/heat-grid.svelte",
    "lib/components/prices/price-track-chart.svelte",
    "lib/components/inverter/cost-bar-chart.svelte",
    "lib/components/inverter/energy-split-block.svelte",
  ])("%s is among the components the sweep discovers", (file) => {
    expect(callers).toContain(file);
  });

  /** The last argument of a call — the slot every one of these helpers takes
   *  the plot width in. Split at depth 0 so `stackedBarProps(f(a, b), w)` is
   *  two arguments, not three. */
  function lastArgument(args: string): string {
    const parts: string[] = [];
    let depth = 0;
    let current = "";
    for (const ch of args) {
      if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth--;
      if (ch === "," && depth === 0) {
        parts.push(current);
        current = "";
      } else current += ch;
    }
    parts.push(current);
    return parts.at(-1)!.trim();
  }

  // Measuring the box and then handing the helper something else is the whole
  // regression in one line: `bind:clientWidth={plotWidth}` still there, but
  // `chartPaddingFor(0)` — every helper reads 0 as the desktop case, so every
  // phone chart quietly keeps the 60px gutter while the test stays green. So
  // the bound identifier is captured, and every gutter call in the file has to
  // be spending THAT variable.
  test.each(measurers)("%s measures its plot and fits the gutters to it", (file) => {
    const code = read(file);
    const measured = code.match(/bind:clientWidth=\{(\w+)\}/);
    expect(measured, `${file} measures no plot width`).not.toBeNull();

    const calls = [...code.matchAll(GUTTER_CALL)];
    expect(calls.length).toBeGreaterThan(0);
    for (const [, helper, args] of calls) {
      expect(`${helper}: ${lastArgument(args)}`).toBe(`${helper}: ${measured![1]}`);
    }
  });

  test("no component anywhere reaches for the fixed desktop numbers", () => {
    expect(files.filter((f) => RAW.test(read(f)))).toEqual([]);
  });

  // Naming the constants is not the only way back to a desktop gutter: a new
  // chart can spell `padding={{ left: 60, right: 24 }}` inline and never touch
  // a helper, so the sweep above — which only holds components that DO call one
  // — never sees it. A padding literal on a chart is the bug written out
  // longhand.
  const PADDING_LITERAL = /padding=\{\{[^}]*\b(?:left|right)\s*:\s*\d/;

  /**
   * Charts still on a fixed gutter, with the left value each one writes.
   *
   * Empty: the seven that were here are now clamped against their own bases —
   * see "the hand-tuned charts narrow against their own base" below. An entry
   * here is a claim that some chart's gutter cannot narrow at all, which has to
   * be argued in this comment before it is written.
   *
   * What the rule buys is that the list cannot GROW: a new chart writing its
   * own gutter fails, and shrinking it needs no new rule.
   */
  const FIXED_GUTTER_BACKLOG: Record<string, number> = {};

  test("nor writes a plot gutter out as a literal instead", () => {
    const inline = files.filter(
      (f) => PADDING_LITERAL.test(read(f)) && !(f in FIXED_GUTTER_BACKLOG),
    );
    expect(inline).toEqual([]);
  });

  test("any chart left on the backlog still writes the gutter it claims", () => {
    // The entry has to keep naming a real number in a real file, so the list
    // cannot quietly become a blanket amnesty for the whole folder. Written as
    // one case rather than `test.each` so an EMPTY backlog is a legal state.
    for (const [file, left] of Object.entries(FIXED_GUTTER_BACKLOG)) {
      expect(read(file)).toMatch(new RegExp(`left:\\s*${left}\\b`));
      expect(left).toBeGreaterThan(chartPaddingFor(412).left);
    }
  });

  // The bar charts get their padding through the shared props builder, so the
  // width has to travel through it or the two of them silently keep the old
  // gutters while everything else adapts.
  test("the shared bar-chart props take the plot width and spend the helper", async () => {
    const shared = await Bun.file(
      new URL("lib/components/inverter/_shared/chart-series.ts", SRC),
    ).text();
    expect(shared).toMatch(/stackedBarProps\(\s*bucketCount: number,\s*width: number/);
    expect(shared).toContain("chartPaddingFor(width)");
    expect(shared).toContain("xTickSpacingFor(width)");
    expect(shared).not.toMatch(RAW);
  });

  test("every stackedBarProps caller passes it a width", () => {
    const calls = files.flatMap((file) =>
      [...read(file).matchAll(/stackedBarProps\(([^)]*)\)/g)].map((m) => `${file}: ${m[1]}`),
    );
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toMatch(/,\s*\w/);
  });
});

describe("the hand-tuned charts narrow against their own base", () => {
  // These sit outside the cost/statistics family, so routing them through
  // `chartPaddingFor` would hand a /history area chart the cost charts' 60px
  // desktop gutter and make it WORSE on a laptop. Each keeps the gutters it was
  // tuned with as its own base and passes that base through the shared clamp,
  // which only ever gives room back — so the desktop rendering is unchanged by
  // construction and only the phone narrows.

  /**
   * The charts this covers, each with the LEFT gutter it wrote as a fixed
   * literal before the clamp. That number is the whole point of the case: it is
   * what pins "the base is still the hand-tuned value", i.e. that nobody quietly
   * moved these onto the cost family's padding while converting them.
   */
  const FITTED_GUTTERS: Record<string, number> = {
    "lib/components/settings/forecast-correction-panel.svelte": 36,
    "lib/components/inverter/forecast-chart.svelte": 40,
    "lib/components/inverter/hourly-bar-chart.svelte": 40,
    "lib/components/inverter/live-area.svelte": 44,
    "lib/components/inverter/_shared/metric-history-chart.svelte": 44,
    "lib/components/automations/decision-chart.svelte": 44,
    "lib/components/inverter/_shared/custom-chart-plot.svelte": 44,
  };

  const OPEN = new Set(["(", "[", "{"]);
  const CLOSE = new Set([")", "]", "}"]);

  /** The text between the balanced delimiters that open at `from`. */
  function balanced(code: string, from: number): string {
    let depth = 0;
    for (let i = from; i < code.length; i++) {
      depth += Number(OPEN.has(code[i])) - Number(CLOSE.has(code[i]));
      if (depth === 0) return code.slice(from + 1, i);
    }
    throw new Error(`unbalanced at ${from}`);
  }

  /** An argument list split at the commas that are not nested inside anything. */
  function splitArguments(args: string): string[] {
    const parts: string[] = [""];
    let depth = 0;
    for (const ch of args) {
      depth += Number(OPEN.has(ch)) - Number(CLOSE.has(ch));
      if (ch === "," && depth === 0) parts.push("");
      else parts[parts.length - 1] += ch;
    }
    return parts.map((p) => p.trim());
  }

  /** Every `padding={…}` prop value in a component, as written. */
  function paddingProps(code: string): string[] {
    return [...code.matchAll(/\bpadding=(?=\{)/g)].map((m) =>
      balanced(code, m.index + "padding=".length).trim(),
    );
  }

  /** The whole of a `const name = …` declaration, to the `;` that ends it. */
  function declaration(code: string, name: string): string {
    const at = code.search(new RegExp(`\\bconst ${name}(?::[^=]*)? =`));
    if (at < 0) throw new Error(`no declaration of ${name}`);
    const rest = code.slice(at);
    let depth = 0;
    for (let i = 0; i < rest.length; i++) {
      depth += Number(OPEN.has(rest[i])) - Number(CLOSE.has(rest[i]));
      if (depth === 0 && rest[i] === ";") return rest.slice(0, i);
    }
    return rest;
  }

  /** A padding object literal, read back off its declaration. */
  function paddingOf(decl: string): ChartPadding {
    const side = (key: string) => {
      const found = decl.match(new RegExp(`\\b${key}:\\s*(\\d+)`));
      if (!found) throw new Error(`${decl} declares no ${key}`);
      return Number(found[1]);
    };
    return { top: side("top"), right: side("right"), bottom: side("bottom"), left: side("left") };
  }

  // The rule above is checked FORWARD — each named file must comply — which
  // says nothing about a chart that is simply never named. That escape used to
  // be theoretical; now that a named `const PADDING = { … }` base is the house
  // style across seven charts, `padding={PADDING}` with no clamp is the
  // idiomatic-looking way to reintroduce a desktop gutter on a phone.
  //
  // So the set is closed from the other side too: whatever a chart passes as
  // `padding`, the expression has to go through one of the fitted helpers.
  const FITTED_CALL = /\b(?:fittedPadding|chartPaddingFor|heatPaddingFor|stackedBarProps)\(/;

  /**
   * Whether a `padding={…}` expression reaches a fitted helper — directly, or
   * through one binding. A chart that also needs the resolved numbers for
   * something else (live-area feeds its edge-fade mask from `padding.left`)
   * binds the call first and passes the identifier, which is correct and must
   * not read as an escape.
   */
  function reachesTheClamp(code: string, expression: string): boolean {
    if (FITTED_CALL.test(expression)) return true;
    const identifier = expression.trim().match(/^\w+$/)?.[0];
    if (!identifier) return false;
    const bound = code.match(new RegExp(`\\b(?:const|let)\\s+${identifier}\\s*=([^;\\n]*)`));
    return bound !== null && FITTED_CALL.test(bound[1]);
  }

  const unclamped = files.flatMap((file) => {
    const code = read(file);
    return [...code.matchAll(/\bpadding=\{([\s\S]*?)\}(?=[\s/>])/g)]
      .filter((m) => !reachesTheClamp(code, m[1]))
      .map((m) => `${file}: padding={${m[1].trim()}}`);
  });

  test("and no chart anywhere passes a padding the clamp never saw", () => {
    expect(unclamped).toEqual([]);
  });

  test.each(Object.entries(FITTED_GUTTERS))(
    "%s hands its own base to the clamp with the width it measured",
    (file, left) => {
      const code = read(file);
      const measured = code.match(/bind:clientWidth=\{(\w+)\}/);
      expect(measured, `${file} measures no plot width`).not.toBeNull();

      const props = paddingProps(code);
      expect(props.length).toBeGreaterThan(0);

      const bases = new Set<string>();
      for (const prop of props) {
        // `padding={BASE}` reads almost exactly like the fitted form and hands
        // the chart its desktop gutter at every width — which is the whole bug.
        // So the prop has to RESOLVE to the call (directly, or through the one
        // `$derived` that a chart reusing the fitted value keeps), and the width
        // it is given has to be the identifier `bind:clientWidth` writes into.
        const call = /^\w+$/.test(prop) ? declaration(code, prop) : prop;
        expect(call).toContain("fittedPadding(");
        const args = splitArguments(
          balanced(call, call.indexOf("(", call.indexOf("fittedPadding("))),
        );
        expect(args[1]).toBe(measured![1]);
        // The base is a named constant, so the number asserted below is the one
        // the chart actually spends rather than one spelled into the assertion.
        expect(args[0]).toMatch(/^[A-Z][A-Z0-9_]*$/);
        bases.add(args[0]);

        const base = paddingOf(declaration(code, args[0]));
        const fitted = fittedPadding(base, PHONE_PLOT, {
          rightAxis: /rightAxis:\s*true/.test(args[2] ?? ""),
        });
        // The clamp has to BITE — a base already inside the caps would make the
        // conversion decorative — and land every chart on the same phone gutter.
        expect(fitted.left).toBeLessThan(base.left);
        expect(fitted.left).toBe(chartPaddingFor(PHONE_PLOT).left);
        // A right gutter drawing a second y-axis keeps room for its labels; one
        // holding only a tick overhang gives that room back.
        if (/rightAxis:\s*true/.test(args[2] ?? "")) expect(fitted.right).toBe(fitted.left);
        else expect(fitted.right).toBeLessThanOrEqual(8);
      }

      // …and one of those bases is still the hand-tuned gutter this chart shipped.
      const lefts = [...bases].map((b) => paddingOf(declaration(code, b)).left);
      expect(lefts).toContain(left);
    },
  );

  test("the custom plot declares the axis on the side that actually draws one", () => {
    // Without this the `rightAxis` flag is self-certifying: dropping it from the
    // dual-axis call clamps that gutter to the 8px overhang cap and the case
    // above still passes, because it only checks the flag against itself. The
    // side that draws a second y-axis is decided by the marks, so read those.
    const code = read("lib/components/inverter/_shared/custom-chart-plot.svelte");
    const plots = code.split(/<AreaChart\b/).slice(1);
    const [dual, single] = [
      plots.filter((p) => p.includes("<DualYAxes")),
      plots.filter((p) => !p.includes("<DualYAxes")),
    ];
    expect(dual).toHaveLength(1);
    expect(single).toHaveLength(1);
    // Each block runs to the end of the file, so take the padding it opens with.
    expect(paddingProps(dual[0])[0]).toContain("rightAxis: true");
    expect(paddingProps(single[0])[0]).not.toContain("rightAxis");
  });

  test("the live sparkline's edge fade follows the gutter it was measured against", () => {
    // The mask keeps the axis-label gutter opaque and feathers only inside the
    // plot. Its offsets were the same 44px the padding wrote, so clamping one
    // without the other would feather the first 10px of the plotted line away —
    // a gutter fix that eats data is worse than the gutter.
    const code = read("lib/components/inverter/live-area.svelte");
    const fade = declaration(code, "edgeFade");
    expect(fade).toContain("padding.left");
    expect(fade).not.toMatch(/\b44px/);
  });
});

describe("touch targets", () => {
  const button = read("lib/components/ui/button/button.svelte");
  const input = read("lib/components/ui/input/input.svelte");

  // The desktop scale is deliberately tight (h-7/h-8 rows read as data density,
  // not as chrome). A thumb does not get denser, so every size that a phone can
  // reach gains a step below sm and hands it back at sm.
  /** The `size:` block of the cva config — `variant:` also has a `default` key. */
  const sizeBlock = button.slice(
    button.indexOf("\t\t\tsize: {"),
    button.indexOf("defaultVariants"),
  );

  test.each([
    ["default", "h-9 sm:h-8"],
    ["sm", "h-8 sm:h-7"],
    ["icon", "size-9 sm:size-8"],
    ["icon-sm", "size-8 sm:size-7"],
  ])("the %s button is a step taller on a phone", (size, expected) => {
    expect(sizeBlock).not.toBe("");
    const line = sizeBlock.split("\n").find((l) => new RegExp(`^\\s*"?${size}"?:`).test(l));
    expect(line).toBeDefined();
    expect(line).toContain(expected);
  });

  test("the text input matches the default button's phone height", () => {
    expect(input.match(/(?:^|\s)h-9 sm:h-8(?:\s|"|`)/g)).toHaveLength(2); // file + text
    expect(input).not.toMatch(/(?:^|\s)h-8 rounded-lg/);
  });

  // Icon-only triggers have no label beside them to widen the hit area, so they
  // spend the TAP expander rather than growing and disturbing the row.
  test.each([
    "routes/(app)/statistics/stat-tile.svelte",
    "routes/(app)/statistics/section-controls.svelte",
  ])("%s gives its icon trigger the tap expander", (file) => {
    expect(read(file)).toContain("{TAP}");
  });

  test("the expander it spends is the tested one", () => {
    expect(TAP).toContain("after:-inset-3.5");
  });

  test("the range picker's step arrows are thumb-width on a phone", () => {
    const picker = read("lib/components/inverter/preset-range-picker.svelte");
    expect(picker).not.toMatch(/h-full w-8 rounded-none/);
    expect(picker.match(/w-9 sm:w-8/g)).toHaveLength(2);
    // The arrows sit in a shared border-box whose height they fill, so the box
    // has to grow with them or the wider arrows stay 32px tall.
    expect(picker).toContain("h-9 sm:h-8 items-center border border-input");
  });

  test("the calendar's day cells are tappable before they are compact", () => {
    const calendar = read("lib/components/ui/range-calendar/range-calendar.svelte");
    expect(calendar).toContain("[--cell-size:--spacing(9)] sm:[--cell-size:--spacing(7)]");
  });
});

describe("nothing runs off the side of the screen", () => {
  test("a popover never asks for more width than the viewport has", () => {
    // `w-72` is 288px; inside a 412px viewport with the page gutter and a
    // right-aligned trigger, bits-ui had nowhere to put it and it clipped.
    const popover = read("lib/components/ui/popover/popover-content.svelte");
    expect(popover).toContain("max-w-(--bits-popover-content-available-width)");
  });

  test("the band breakdown gives its three columns their own rows on a phone", () => {
    // Name, energy and cost on one 412px row left the name ~120px, which
    // truncated every band label in German.
    const bands = read("routes/(app)/statistics/band-breakdown.svelte");
    expect(bands).toMatch(/flex-col .*sm:flex-row|flex-col\b[^"]*\bsm:flex-row/);
  });

  test("an automation stat tile wraps its label instead of clipping it", () => {
    // "Netzeinspeisegrenze" does not fit a quarter of 412px on one line, and
    // `truncate` turned it into "Netzeinspei…" on the only screen where the
    // label is the whole explanation.
    const tiles = read("lib/components/automations/stat-tiles.svelte");
    expect(tiles).not.toContain("truncate text-xs text-muted-foreground");
  });

  test("the automation metric grid spends less on its column gutter at 412px", () => {
    const grid = read("lib/components/automations/metric-grid.svelte");
    expect(grid).toContain("gap-x-3 sm:gap-x-6");
  });

  test("a stat tile's label is legible before it is small", () => {
    // 0.65rem is 10.4px — under the 12px floor, and it is uppercase tracked
    // text carrying the tile's only identification.
    const tile = read("routes/(app)/statistics/stat-tile.svelte");
    expect(tile).toContain("text-xs sm:text-[0.65rem]");
  });
});

describe("a four-option switcher does not wrap on a phone", () => {
  const switcher = read("lib/components/inverter/range-switcher.svelte");

  test("the segmented row is a decision about option count, not a guess", () => {
    expect(switcher).toContain("needsCompactSwitcher(options.length)");
  });

  test("it offers a select below sm and the segmented row from sm up", () => {
    expect(switcher).toContain("OptionSelect");
    // Both forms are always rendered and CSS picks one: a JS media query here
    // would mean a resize listener per switcher and a visible swap on rotate.
    expect(switcher).toContain("sm:hidden");
    expect(switcher).toContain("hidden sm:flex");
  });

  test("both forms drive the same bound value", () => {
    expect(switcher).toContain("value = o.id");
    expect(switcher).toMatch(/onchange=\{\(v\) => \(value = v as T\)\}/);
  });

  test("only the switchers that need one pay for the select", () => {
    // Three-option switchers are the common case; they must not render a second
    // hidden control each.
    expect(switcher).toMatch(/\{#if compact\}/);
  });
});

describe("peak shaving reads in the right order on a phone", () => {
  const page = read("routes/(app)/automations/peak-shaving/+page.svelte");

  /** The grid columns: where each starts, and the order it takes at each size. */
  const columns = classValues(page)
    .filter((v) => /(?:^|\s)order-\d/.test(v))
    .map((v) => ({
      phone: Number(v.match(/(?:^|\s)order-(\d)/)![1]),
      wide: Number(v.match(/xl:order-(\d)/)![1]),
      at: page.indexOf(v),
    }))
    .sort((a, b) => a.at - b.at);

  /**
   * Panel names in the order the browser paints them at the given size — the
   * source order of each column, with the columns themselves resequenced by
   * their `order` class. Asserting the classes alone would not catch a panel
   * moved into the wrong column.
   */
  function readingOrder(key: "phone" | "wide"): string[] {
    return columns
      .map((c, i) => ({
        rank: c[key],
        at: c.at,
        panels: [
          ...page
            .slice(c.at, columns[i + 1]?.at ?? page.length)
            .matchAll(/<(PeakShaving\w+|Decision\w+)\b/g),
        ].map((m) => m[1]),
      }))
      .sort((a, b) => a.rank - b.rank || a.at - b.at)
      .flatMap((c) => c.panels);
  }

  test("the page really is two ordered columns", () => {
    expect(columns).toHaveLength(2);
  });

  test("a phone reads the live picture first and the knobs last", () => {
    // Stacked, the configuration form sat between the reader and the thing it
    // configures: status, then a screen and a half of knobs, then the plan those
    // knobs produce.
    expect(readingOrder("phone")).toEqual([
      "PeakShavingStatus",
      "DecisionPlan",
      "DecisionCharts",
      "PeakShavingForm",
    ]);
  });

  test("and a widescreen still puts the configuration column on the left", () => {
    expect(readingOrder("wide")).toEqual([
      "PeakShavingForm",
      "PeakShavingStatus",
      "DecisionPlan",
      "DecisionCharts",
    ]);
  });
});

describe("a card header cannot be wider than its card", () => {
  // Measured at 412px: the automations list overflowed the viewport by 78px.
  // `Card.Header` is a grid, and its implicit column is `auto` — which sizes to
  // the *max-content* of the row, i.e. the title, its badge and the whole
  // description laid out on one line. 458px of track inside a 380px card, so
  // the text ran off the right edge no matter how the children were written:
  // the title span already carried `min-w-0 flex-1 truncate` and did nothing,
  // because the track it sits in was never asked to fit.
  //
  // `overflow-x-clip` on the shell hides the scrollbar this produces, which is
  // exactly why it needs pinning here — the symptom is suppressed, so a
  // regression would be silent.
  test("the automations card constrains its header's grid track", () => {
    expect(read("lib/components/automations/automation-card.svelte")).toMatch(
      /<Card\.Header[^>]*\bclass="[^"]*grid-cols-\[minmax\(0,\s*1fr\)\]/,
    );
  });
});

describe("a measuring wrapper does not break the height chain", () => {
  // The gutter work put a `bind:clientWidth` div around each plot so the
  // padding could follow the MEASURED width. In `live-area.svelte` that div was
  // written `class="w-full"` — no height — and the component is handed
  // `height="h-full"` by the history card. `h-full` resolves against the
  // parent, so the chart asked a height-less div how tall it was, got `auto`,
  // and rendered at **0px**: every live chart on /history was an empty box,
  // with the whole suite green and the data present in the DOM.
  //
  // The rule is stated from the CALL SITE, discovered on disk: a component
  // somebody hands `h-full` may not put an unsized box between the box that
  // owns the height and the chart that consumes it.

  /** Components a caller sizes with `h-full`, mapped back to their own file. */
  function heightPassthroughFiles(): string[] {
    const out = new Set<string>();
    for (const file of files) {
      const code = read(file);
      for (const open of code.matchAll(/<([A-Z][\w.]*)((?:[^<>]|\{[^{}]*\})*?)\/?>/g)) {
        if (!/\bheight=(?:"h-full"|\{[^{}]*['"`]h-full['"`][^{}]*\})/.test(open[2])) continue;
        // Resolve the tag through the importing file's own import statement, so
        // this follows a rename instead of hard-coding today's pairs.
        const imported = code.match(
          new RegExp(`import\\s+${open[1]}\\s+from\\s+['"]([^'"]+)['"]`),
        )?.[1];
        if (imported?.startsWith("$lib/")) out.add(imported.replace("$lib/", "lib/"));
      }
    }
    return [...out].sort();
  }

  const passthrough = heightPassthroughFiles();

  test("the sweep still finds the history card's live chart", () => {
    // A discovery that quietly stops matching passes exactly as green as one
    // that holds; this is the pair the 0px bug was measured on.
    expect(passthrough).toContain("lib/components/inverter/live-area.svelte");
  });

  test.each(passthrough)("%s keeps every measuring wrapper full-height", (file) => {
    const unsized = [...read(file).matchAll(/<div((?:[^<>]|\{[^{}]*\})*?)>/g)]
      .filter((open) => /\bbind:clientWidth\b/.test(open[1]))
      .map((open) => open[1])
      .filter((attrs) => !classValues(attrs).some((v) => /(?:^|\s)h-full(?:\s|$)/.test(v)));
    expect(unsized).toEqual([]);
  });
});
