/**
 * The other half of Phase 4: that the mapping in ./zoom-range.ts is what the
 * charts actually run.
 *
 * Runes do not execute under `bun test` and there is no render harness
 * (apps/web/TESTING.md), so these cases read the sources — in the style of
 * lib/layout/mobile-density.test.ts. Every case here pins STRUCTURE or captures
 * the identifier that is really passed, because "the file mentions
 * `zoomedChartSpec` somewhere" stays green while the chart hands it the wrong
 * array, and a zoom wired to the wrong array is silently wrong data rather than
 * a broken build.
 */

import { describe, expect, test } from "bun:test";

const SRC = new URL("../../", import.meta.url);

const read = async (file: string) => await Bun.file(new URL(file, SRC)).text();

const files = [...new Bun.Glob("**/*.svelte").scanSync(SRC.pathname)].sort();
const sources = new Map<string, string>(
  await Promise.all(files.map(async (f) => [f, await read(f)] as [string, string])),
);

function svelte(file: string): string {
  const text = sources.get(file);
  if (text === undefined) throw new Error(`no such component: ${file}`);
  return text;
}

/** The name a file binds its `chartZoom()` controller to. */
function controller(code: string): string | null {
  return code.match(/const\s+(\w+)\s*=\s*chartZoom\(/)?.[1] ?? null;
}

const OPEN = new Set(["(", "[", "{"]);
const CLOSE = new Set([")", "]", "}"]);

/** The text between the balanced parens of the first `name(` call. */
function callArguments(code: string, name: string): string {
  const open = code.indexOf(`${name}(`) + name.length;
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    depth += Number(OPEN.has(code[i])) - Number(CLOSE.has(code[i]));
    if (depth === 0) return code.slice(open + 1, i);
  }
  throw new Error(`unbalanced call to ${name}`);
}

/** An argument list split at the commas that are not nested inside anything. */
function argumentsOf(code: string, name: string): string[] {
  const parts: string[] = [""];
  let depth = 0;
  for (const ch of callArguments(code, name)) {
    depth += Number(OPEN.has(ch)) - Number(CLOSE.has(ch));
    if (ch === "," && depth === 0) parts.push("");
    else parts[parts.length - 1] += ch;
  }
  return parts.map(trimmed);
}

const trimmed = (s: string) => s.trim();

/** The whole of a `const name = …` declaration — to the `;` that ends it, not
 *  to the first one inside its body. */
function declaration(code: string, name: string): string {
  const at = code.indexOf(`const ${name} =`);
  if (at < 0) throw new Error(`no declaration of ${name}`);
  const rest = code.slice(at);
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    depth += Number(OPEN.has(rest[i])) - Number(CLOSE.has(rest[i]));
    if (depth === 0 && rest[i] === ";") return rest.slice(0, i);
  }
  return rest;
}

/**
 * Where `name`'s implementation body opens.
 *
 * Skips a type declaration of the same name — `zoomTo(spec: …): void;` in the
 * interface above the implementation ends at a `;` before it ever reaches a
 * `{`, and taking its "body" would swallow the rest of the file and pass on
 * anything at all.
 */
function bodyStart(code: string, name: string): number {
  for (const match of code.matchAll(new RegExp(`\\b${name}\\s*\\(`, "g"))) {
    const open = code.indexOf("{", match.index);
    const semicolon = code.indexOf(";", match.index);
    if (open >= 0 && (semicolon < 0 || open < semicolon)) return open;
  }
  throw new Error(`no implementation of ${name}`);
}

/**
 * The opening `<Tag …>` of a component, attribute expressions consumed whole so
 * a `{…}` value containing `>` does not end the tag early.
 */
function openTagOf(code: string, tag: string): string {
  const match = new RegExp(`<${tag}(?:\\s(?:[^<>{]|\\{[^{}]*\\})*)?/?>`).exec(code);
  if (!match) throw new Error(`no <${tag}> in this component`);
  return match[0];
}

/** The braces block that starts at `open`, braces included. */
function block(code: string, open: number): string {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    depth += Number(code[i] === "{") - Number(code[i] === "}");
    if (depth === 0) return code.slice(open, i + 1);
  }
  throw new Error("unterminated block");
}

const methodBody = (code: string, name: string) => block(code, bodyStart(code, name));

/** Charts that gained the gesture, in the order they were rolled out. */
const ZOOMABLE: string[] = [
  "lib/components/inverter/_shared/metric-history-chart.svelte",
  "lib/components/statistics/period-series-chart.svelte",
  "lib/components/prices/price-track-chart.svelte",
  "lib/components/statistics/yoy-chart.svelte",
  // The overlaid form — a saved custom chart, or a draft on a metric card.
  // Its LIVE branch still does not zoom: that one glides its own window
  // through a transform inside a ChartClipPath, and a second one composes
  // badly. Only the two historical branches spread the controller.
  "lib/components/inverter/_shared/custom-chart-plot.svelte",
];

describe("the charts that zoom", () => {
  test("are exactly the ones that were meant to", () => {
    // A census rather than a list check: a chart that starts brushing without
    // going through the controller gets none of the touch-action handling, the
    // reset control or the mis-tap floor, and nothing else would say so.
    const brushing = files.filter((f) => svelte(f).includes("chartZoom("));
    expect(brushing.sort()).toEqual([...ZOOMABLE].sort());
  });

  // A brush — and a `domain` transform, which every chart here also has — makes
  // LayerChart wrap the `marks` layer in a ChartClipPath clipped to the plot
  // rect (ChartChildren.base.svelte). Axis labels live in the padding gutter,
  // OUTSIDE that rect, so a chart drawing its own axes from `marks` loses them
  // the moment it becomes zoomable: the series keep rendering and the axes
  // silently vanish. That is what happened to the dual-axis overlay.
  test.each(ZOOMABLE)("%s draws no axis inside its clipped marks layer", (file) => {
    const code = svelte(file);
    const at = code.indexOf("{#snippet marks(");
    if (at === -1) return; // no custom marks layer, nothing to clip away
    const marks = code.slice(at, code.indexOf("{/snippet}", at));
    expect(marks).not.toMatch(/<\w*Axis\b|<DualYAxes\b/);
  });

  test("the overlay's own axes are drawn from the slot that survives the clip", () => {
    // `axis` accepts a snippet, and LayerChart renders it outside both clip
    // paths. Named directly because this is the only chart in the app that
    // draws axes of its own.
    const code = svelte("lib/components/inverter/_shared/custom-chart-plot.svelte");
    expect(code).toContain("axis={dualAxes}");
    const at = code.indexOf("{#snippet dualAxes(");
    expect(at).toBeGreaterThan(-1);
    expect(code.slice(at, code.indexOf("{/snippet}", at))).toContain("<DualYAxes");
  });

  test("configure it through the controller rather than by hand", () => {
    const handRolled = files.filter((f) => /\b(brush|transform)=\{\{/.test(svelte(f)));
    expect(handRolled).toEqual([]);
  });

  test.each(ZOOMABLE)("%s spends the controller it built", (file) => {
    const code = svelte(file);
    const zoom = controller(code);
    expect(zoom, `${file} builds no chartZoom controller`).not.toBeNull();
    // The spread is the whole configuration — brush, transform and the
    // transform callback the reset control's visibility hangs off.
    expect(code).toContain(`{...${zoom}.props}`);
  });

  test.each(ZOOMABLE)("%s gives the viewer the way back out", (file) => {
    const code = svelte(file);
    const zoom = controller(code)!;
    const tag = code.match(/<ZoomControls\b([^>]*)>/);
    expect(tag, `${file} renders no reset control`).not.toBeNull();
    // The control has to be handed THIS chart's controller; a second one would
    // reset a transform nothing is using.
    expect(tag![1]).toContain(`{${zoom}}`);
  });

  test.each(ZOOMABLE)("%s captures the context its reset needs", (file) => {
    const code = svelte(file);
    const zoom = controller(code)!;
    // Without the capture the reset control renders and does nothing: the
    // canvas wrappers expose no bindable `context`, so `belowContext` is the
    // only route to the transform state.
    expect(code).toMatch(new RegExp(`\\{#snippet belowContext\\(`));
    expect(code).toContain(`${zoom}.capture(context)`);
    expect(code).toContain("{belowContext}");
  });

  // Both of these already own a transform inside a ChartClipPath (a gliding
  // live window, a decision timeline). A second one composes badly, so they
  // were deliberately left out and must stay out.
  test.each([
    "lib/components/inverter/custom-live-chart.svelte",
    "lib/components/automations/decision-chart.svelte",
  ])("%s keeps its own transform and takes no second one", (file) => {
    const code = svelte(file);
    expect(code).toContain("ChartClipPath");
    expect(code).not.toContain("chartZoom");
  });
});

describe("the resting gesture follows the pointer", () => {
  // What a finger actually does is measured in `e2e/chart-gesture-lock.spec.ts`
  // — a vertical swipe moving `window.scrollY`, a horizontal one refetching
  // nothing. These two are the one-token canaries for the same claim: the
  // controller has to ASK which pointer it is on, and it has to ask
  // ./gesture.ts rather than re-deriving the props itself.
  const controllerFile = "lib/charts/zoom.svelte.ts";

  test("the controller reads the pointer rather than assuming a mouse", async () => {
    const code = await read(controllerFile);
    // `restingMode(true)` is locked and `restingMode(false)` is the brush
    // (./gesture.test.ts). Passing a literal here is how brush-on-touch — the
    // bug — comes back with the whole unit suite green.
    expect(code).toContain("restingMode(pointerKind.coarse)");
  });

  test("and spends the tested mode mapping rather than its own", () => {
    const code = svelte("lib/charts/zoom-controls.svelte");
    // The control's `aria-pressed` and its way back out are what tell a viewer
    // the chart is holding their finger. Both hang off the controller's mode.
    expect(code).toContain("zoom.pinching");
    expect(code).toContain("zoom.reset()");
  });

  test("no chart hand-rolls the three modes for itself", async () => {
    const code = await read(controllerFile);
    expect(code).toContain("gestureProps(mode");
  });
});

describe("the page still scrolls under a chart", () => {
  const container = "lib/components/ui/chart/chart-container.svelte";

  test("the brush layer hands the vertical axis back to the browser", () => {
    // LayerChart ships `.lc-brush-context { touch-action: none }`. On /history
    // and /statistics — tall stacks of full-width charts — that means a swipe
    // which happens to start on a chart stops scrolling the page. `pan-y` is
    // the decision: vertical scrolls, horizontal brushes. Neither `touch-none`
    // nor `touch-auto` is that, so the value is pinned, not its presence.
    const utility = svelte(container).match(/\[&_\.lc-brush-context\]:([\w-]+)/);
    expect(utility, "no brush touch-action override").not.toBeNull();
    expect(utility![1]).toBe("touch-pan-y");
  });

  test("and the selection wears the app's own palette", () => {
    // The shipped default paints off `--color-surface-content`, which this
    // theme does not define — the selection came out as a colourless smear.
    const code = svelte(container);
    expect(code).toMatch(/\[&_\.lc-brush-range\]:bg-primary\//);
    expect(code).toMatch(/\[&_\.lc-brush-handle\]:bg-primary\//);
  });
});

describe("a zoom on /history refetches at a finer rollup", () => {
  const chart = "lib/components/inverter/_shared/metric-history-chart.svelte";
  const page = "routes/(app)/history/+page.svelte";

  /**
   * The page and the chart are three components apart. Pinning only the two
   * ends leaves the hops between them free: deleting `{onZoom}` from the card's
   * plot invocation kills zoom on /history end to end, and neither the suite
   * nor `svelte-check` says a word — an unused destructured prop is legal.
   */
  // Every hop from the page that owns the range down to the chart that emits
  // the selection. A callback dropped at any one of them leaves a chart whose
  // drag does nothing, with the whole suite green — so the chain is listed in
  // full rather than only at its ends.
  const HOPS: [string, string][] = [
    ["routes/(app)/history/metric-group.svelte", "EntityHistoryCard"],
    ["lib/components/inverter/entity-history-card.svelte", "MetricCardPlot"],
    ["lib/components/inverter/_shared/metric-card-plot.svelte", "MetricHistoryChart"],
  ];

  test.each(HOPS)("%s hands the zoom callbacks down to <%s>", (file, child) => {
    const tag = openTagOf(svelte(file), child);
    expect(tag).toContain("{onZoom}");
    expect(tag).toContain("{onResetZoom}");
  });

  test("the chart resolves the selection through the tested mapper", () => {
    // Not a local parse: `zoomedHistoryRangeFrom` is what rejects a tap, a
    // half-open selection and a band value, and re-derives the bucket.
    expect(svelte(chart)).toContain("zoomedHistoryRangeFrom(");
  });

  test("and hands the page that range whole, bucket and all", () => {
    // The bucket the mapper re-derives IS the feature: without it a zoom
    // narrows the axis over data already fetched, magnifying four hourly bars
    // — the one thing a zoom must not do. Spreading the range and overriding
    // `bucket` with the chart's current rollup is a one-token edit that leaves
    // every other assertion here green, so the emitted value is pinned to the
    // identifier the mapper returned rather than to the call appearing at all.
    const code = svelte(chart);
    const emitted = /const\s+(\w+)\s*=\s*zoomedHistoryRangeFrom\(/.exec(code)?.[1] ?? "";
    expect(emitted).not.toBe("");
    const [handed] = argumentsOf(code, "onZoom?.");
    expect(handed).toBe(emitted);
  });

  test("the mis-tap floor follows the bucket the chart was fetched at", () => {
    const code = svelte(chart);
    const [bucket] = argumentsOf(code, "minExtentFor");
    // The floor is only right if it reads the CURRENT rollup; a literal or a
    // stale local would put a 5-minute window's floor at two days.
    expect(code).toMatch(new RegExp(`\\n\\t\\t${bucket}: RollupBucket;`));
  });

  test("the page answers a zoom by moving its own range state", () => {
    const code = svelte(page);
    const handler = code.match(/onZoom=\{(\w+)\}/)?.[1];
    expect(handler, "the page passes no zoom handler").toBeDefined();
    // Assigning `range` is what makes this a refetch — every card's query
    // effect reads it. A handler that only stored the window somewhere else
    // would zoom nothing.
    expect(declaration(code, handler!)).toContain("range = next");
  });

  test("the reset control has a window to go back to", () => {
    const code = svelte(page);
    const handler = code.match(/onResetZoom=\{(\w+)\}/)?.[1];
    expect(handler, "the page passes no reset handler").toBeDefined();
    expect(declaration(code, handler!)).toContain("range = beforeZoom");
  });
});

describe("a zoom on /statistics narrows the section's own spec", () => {
  const section = "routes/(app)/statistics/energy-section.svelte";
  const chart = "lib/components/statistics/period-series-chart.svelte";
  const scopeFile = "lib/statistics/chart-scope.svelte.ts";

  test("the chart reports positions, resolved against the bands it plotted", () => {
    const code = svelte(chart);
    const [labels, selection] = argumentsOf(code, "bandIndexRange");
    expect(selection).toBe("x");
    // The labels have to be the ones on the axis right now. Resolving against
    // any other array maps a drag to the wrong periods, and a 24-month axis
    // repeats "Aug", so nothing downstream could notice.
    expect(code).toMatch(new RegExp(`const ${labels} = \\$derived\\(data\\.map`));
  });

  test("the section maps those positions with the keys of the plotted rows", () => {
    const code = svelte(section);
    const [spec, keys] = argumentsOf(code, "zoomedChartSpec");
    expect(spec).toBe("view.spec");
    expect(code).toMatch(new RegExp(`const ${keys} = \\$derived\\(series\\.periods\\.map`));
  });

  test("and hands the result to the section scope, which the fetch reads", () => {
    const code = svelte(section);
    const handler = code.match(/onZoom=\{(\w+)\}/)?.[1];
    expect(handler).toBeDefined();
    expect(declaration(code, handler!)).toContain("view.zoomTo(");
    expect(code).toContain("specQuery(view.spec)");
  });

  test("the zoom is ephemeral, like the scope pick beside it", async () => {
    const code = await read(scopeFile);
    // The persisted `statisticsPrefs…chartScope` is a deliberate choice a
    // viewer made once. A gesture must never write to it.
    //
    // Pinned as "zoomTo assigns to nothing but its own local", not as "no line
    // mentioning statisticsPrefs also mentions zoom": one `const prefs =
    // statisticsPrefs` alias defeats the line-local reading of that rule, and
    // a pinch quietly rewriting a saved preference is a data bug, not a
    // rendering one.
    const assignments = [...methodBody(code, "zoomTo").matchAll(/(\w+(?:\.\w+)*)\s*=(?!=)/g)].map(
      (m) => m[1],
    );
    expect(assignments).toEqual(["zoom"]);
  });

  test("and expires with the window it was drawn on", async () => {
    const code = await read(scopeFile);
    // Anchoring and expiry are unit-tested in ./zoom-range.test.ts; what has to
    // be pinned here is that the section state RUNS them, and that it anchors
    // to the spec it is currently plotting. Anchoring to anything else, or
    // reading the zoom without the anchor check, leaves a section pinned to a
    // week of last month after the viewer moves to this one.
    expect(argumentsOf(code, "zoomAnchor")).toEqual(["base", "next"]);
    expect(argumentsOf(code, "activeSpec")).toEqual(["base", "zoom"]);
    expect(declaration(code, "base")).toContain("chartSpecFor(range(), scope)");
  });
});

describe("the price track's chart-space marks survive a narrowed domain", () => {
  const track = "lib/components/prices/price-track-chart.svelte";

  test("the negative shading is clipped to the bands still on the axis", () => {
    const code = svelte(track);
    const each = code.match(/\{#each ([\s\S]*?) as run/);
    expect(each).not.toBeNull();
    // `bandSpan` reads a missing band's `undefined` as 0, so an unclipped run
    // that scrolled off does not vanish — it re-draws at the left edge and
    // claims the wrong quarter-hours were free.
    expect(each![1].trim()).toStartWith("clipRunsToDomain(");
    const [runs, all, visible] = argumentsOf(code, "clipRunsToDomain");
    expect(runs).toBe("negativeRuns");
    expect(visible).toBe("context.xScale.domain()");
    expect(code).toMatch(new RegExp(`const ${all} = \\$derived\\(rows\\.map`));
  });

  test("the now marker is dropped once it leaves the domain", () => {
    const code = svelte(track);
    const guard = code.match(/\{#if ([^}]*)\}\s*<Rule/);
    expect(guard, "the now rule is drawn unguarded").not.toBeNull();
    expect(guard![1]).toContain("isBandVisible(nowKey");
  });
});
