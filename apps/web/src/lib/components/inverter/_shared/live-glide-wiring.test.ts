/**
 * The other half of the glide-quantisation change: that the two live charts
 * actually SPEND the snapped transform on their marks group.
 *
 * The group keeps the SVG `transform` ATTRIBUTE it always had. Quantisation is
 * where the entire measured win lives (transform writes fell 95%); at the ~11
 * remaining writes per second the MECHANISM is perf-irrelevant, so it is not
 * worth carrying the cross-browser risk of a CSS transform on an SVG element
 * (transform-box, user-unit-vs-px equivalence) for an unmeasurable benefit.
 *
 * Runes do not run under `bun test` and there is no render harness
 * (apps/web/TESTING.md), so these cases read the sources and pin the identifier
 * that is really passed — "the file mentions glideTransform" stays green while
 * the group still writes `transform={...glideOffset(...)}` beside it, which is
 * exactly the 60-writes-per-second regression this change removes.
 *
 * These are source-text assertions, so they pin the LOAD-BEARING TOKEN only:
 * adding a class or an aria-hidden to the group, or writing a comment that
 * happens to name a function, must not turn a green suite red.
 */

import { describe, expect, test } from "bun:test";

const HERE = new URL("./", import.meta.url);

const read = async (file: string) => await Bun.file(new URL(file, HERE)).text();

const CHARTS = ["../live-area.svelte", "../custom-live-chart.svelte"];
const sources = new Map<string, string>(
  await Promise.all(CHARTS.map(async (f) => [f, await read(f)] as [string, string])),
);

function source(file: string): string {
  const text = sources.get(file);
  if (text === undefined) throw new Error(`no such component: ${file}`);
  return text;
}

/**
 * Source with markup, block and line comments removed, so an assertion about
 * what the component DOES cannot be tripped by prose that mentions it. (`//`
 * preceded by `:` is left alone — that is a URL, not a comment.)
 */
export function stripComments(code: string): string {
  return code
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const OPEN = new Set(["(", "[", "{"]);
const CLOSE = new Set([")", "]", "}"]);

/** The text between the balanced parens of the first `name(` call — a nested call
 *  in an argument must not end the list early. */
function callArguments(code: string, name: string): string {
  const open = code.indexOf(`${name}(`) + name.length;
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    depth += Number(OPEN.has(code[i])) - Number(CLOSE.has(code[i]));
    if (depth === 0) return code.slice(open + 1, i);
  }
  throw new Error(`unbalanced call to ${name}`);
}

/** The name the file binds its `glideTransform(...)` result to, via `{@const}` or `const`. */
function glideBinding(code: string): string | null {
  return code.match(/(?:\{@const|const)\s+(\w+)\s*=\s*glideTransform\(/)?.[1] ?? null;
}

describe.each(CHARTS)("%s glides on a snapped SVG transform", (file) => {
  const code = source(file);

  test("binds glideTransform and hands THAT identifier to the marks group's transform", () => {
    const bound = glideBinding(code);
    expect(bound).not.toBeNull();
    // The captured name, not the mere presence of a `transform=` — a group moved
    // by some other expression is the wrong data on screen. Other attributes on
    // the same tag are none of this test's business.
    expect(code).toMatch(new RegExp(String.raw`<g[^>]*\stransform=\{${bound}\}`));
  });

  test("moves the group with the attribute, not a CSS transform", () => {
    // Reverted deliberately: a CSS transform on an SVG element buys nothing
    // measurable here and carries transform-box / unit-equivalence risk.
    expect(stripComments(code)).not.toContain("style:transform");
  });

  test("never calls the unsnapped glideOffset directly", () => {
    // An unsnapped offset is a fresh float every frame, so every frame writes,
    // paints and rasters — the exact regression this change exists to prevent.
    // Comments are stripped first: naming the function in prose is not a call.
    expect(stripComments(code)).not.toContain("glideOffset(");
  });

  test("reads the step quantum from pixelQuantum rather than hard-coding one", () => {
    expect(code).toContain("pixelQuantum(");
  });
});

describe("stripComments — the reason these assertions stopped being brittle", () => {
  test("drops markup, block and line comments but keeps the code around them", () => {
    expect(stripComments("<!-- never glideOffset( -->\n<g />")).toContain("<g />");
    expect(stripComments("<!-- glideOffset( -->")).not.toContain("glideOffset(");
    expect(stripComments("/* glideOffset( */ const a = 1;")).not.toContain("glideOffset(");
    expect(stripComments("const a = 1; // glideOffset(")).toContain("const a = 1;");
    expect(stripComments("const a = 1; // glideOffset(")).not.toContain("glideOffset(");
  });

  test("leaves a URL's double slash alone", () => {
    expect(stripComments("// see https://example.test/x\nkeep()")).toContain("keep()");
    expect(stripComments("const u = 'https://example.test/x';")).toContain("example.test/x");
  });
});

const cursorSource = await read("./live-cursor.svelte.ts");

describe("live-cursor.svelte.ts owns no duration policy of its own", () => {
  const code = cursorSource;

  test("asks glideDurationMs, passing the reduced-motion preference", () => {
    expect(code).toContain("glideDurationMs(");
    const args = callArguments(code, "glideDurationMs");
    expect(args).toContain("prefersReducedMotion.current");
  });

  test("no longer defines the glide constants — two homes and they drift", () => {
    expect(code).not.toMatch(/const\s+MIN_DURATION_MS/);
    expect(code).not.toMatch(/const\s+OVERSHOOT/);
  });

  test("does not compute a duration inline any more", () => {
    expect(code).not.toMatch(/duration:\s*Math\.max\(/);
  });
});

/**
 * The same argument one level up. The chart cursor and the numeric readouts
 * drift side by side on the same page against the same feed, so the floor and
 * the overshoot are one policy — but they were spelled twice, as
 * MIN_DURATION_MS/OVERSHOOT here and MIN_GLIDE_MS/GLIDE_OVERSHOOT next door,
 * with nothing pinning the two copies together. A tweak to one that missed the
 * other would desynchronise the number drift from the chart drift silently.
 */
const DURATION_CALLERS = [
  "./live-window.ts",
  "./live-cursor.svelte.ts",
  "../animated-number.ts",
  "../animated-number.svelte",
];

const callerSources = new Map<string, string>(
  await Promise.all(DURATION_CALLERS.map(async (f) => [f, await read(f)] as [string, string])),
);

describe("the glide floor and overshoot have exactly one home", () => {
  test.each(DURATION_CALLERS)("%s spells neither number itself", (file) => {
    const code = stripComments(callerSources.get(file) as string);
    // The magnitudes, not just the names: re-inlining `Math.max(300, gap * 1.15)`
    // under a fresh name is the same two-homes bug wearing a hat.
    expect(code).not.toMatch(/\b(MIN_DURATION_MS|OVERSHOOT|MIN_GLIDE_MS|GLIDE_OVERSHOOT)\b/);
    expect(code).not.toMatch(/\b1\.15\b/);
    expect(code).not.toMatch(/Math\.max\(\s*300\b/);
  });

  test("_shared/glide.ts is that home, and it keeps the constants to itself", async () => {
    const code = await read("./glide.ts");
    expect(code).toMatch(/const\s+MIN_GLIDE_MS\s*=\s*300/);
    expect(code).toMatch(/const\s+GLIDE_OVERSHOOT\s*=\s*1\.15/);
    // Module-private on purpose: an exported constant with no consumer outside
    // its own tests is exactly what the dead-code gate rejects, and the policy is
    // provable through glideDurationMs anyway.
    expect(code).not.toMatch(/export\s+const\s+(MIN_GLIDE_MS|GLIDE_OVERSHOOT)/);
  });

  test("both call sites import the duration from there rather than restating it", () => {
    expect(stripComments(callerSources.get("./live-cursor.svelte.ts") as string)).toMatch(
      /import\s*\{[^}]*glideDurationMs[^}]*\}\s*from\s*["'][^"']*\/?glide["']/,
    );
    // The readout takes the `readoutGlideMs` wrapper rather than the base
    // function: same policy, plus the off-screen 0. Still glide.ts's decision —
    // what this case is really pinning is that the duration is IMPORTED.
    expect(stripComments(callerSources.get("../animated-number.svelte") as string)).toMatch(
      /import\s*\{[^}]*readoutGlideMs[^}]*\}\s*from\s*["'][^"']*glide["']/,
    );
  });
});

/**
 * Fix 3: the live readout is gated on the card's own visibility.
 *
 * The readout renders in the card's readout row, the first row of the body,
 * which sits ABOVE `{#if !mounted}` — as the Section's `actions` snippet it came
 * from did too, so moving it changed nothing about this hazard. All 63 history
 * cards ran a readout Tween while only four charts existed, and at the measured 1s cadence the 1150ms glide outlasts the
 * feed, so the rAF loop never settles (829 text mutations per 10s on /history
 * against 78 on the overview).
 *
 * The gate is a DURATION, not an unmount: `readoutGlideMs(..., false)` is 0, the
 * Tween snaps, no rAF loop starts, and the off-screen readout still holds the
 * latest value — so scrolling back shows no em dash and no flash. Unmounting
 * AnimatedNumber, or branching the markup, would reintroduce both.
 */
const CARD = await read("../entity-history-card.svelte");
const READOUT = await read("./metric-readout.svelte");
const NUMBER = await read("../animated-number.svelte");

describe("the readout's glide is gated on the card being on screen", () => {
  test("the card hands the readout its own `mounted` state", () => {
    // `mounted`, not `visible`: an expanded card bypasses the observer entirely
    // and must still animate.
    expect(stripComments(CARD)).toMatch(/animate=\{mounted\}/);
  });

  test("the readout passes it straight through to AnimatedNumber", () => {
    // The card writes the readout itself now — the file that used to stand
    // between them held it and the compare menu together, and those two live in
    // different zones of the card since the header cluster went icons-only.
    expect(stripComments(CARD)).toMatch(/<MetricReadout[^>]*animate=\{mounted\}/);
    expect(stripComments(READOUT)).toMatch(/<AnimatedNumber[^>]*\{animate\}/);
  });

  test("AnimatedNumber spends it on the Tween duration", () => {
    const code = stripComments(NUMBER);
    expect(callArguments(code, "readoutGlideMs")).toContain("animate");
    // The old, ungated call must be gone, or the prop is decoration.
    expect(code).not.toContain("glideDurationMs(");
  });

  test("the readout is never unmounted or branched away instead", () => {
    // An {#if animate} around it would drop the value while off screen and pop
    // an em dash on re-entry — the whole reason this is a duration.
    expect(stripComments(READOUT)).not.toMatch(/\{#if[^}]*animate/);
    expect(stripComments(CARD)).not.toMatch(/\{#if[^}]*animate/);
  });
});

/**
 * Fix 1: a card the scroll merely passes must never build a chart.
 *
 * `use:inView` used to wire onEnter straight into `visible = true`, so a 12s
 * sweep paid full LayerChart construction for all 59 cards it flew past and tore
 * all 59 back down (~278ms each on a preset range, 9.4s blocked of 12s).
 */
describe("entity-history-card admits its mount through the queue", () => {
  const code = stripComments(CARD);

  test("enter REQUESTS a mount rather than setting visible synchronously", () => {
    expect(code).toMatch(/queue\.request\(/);
    expect(code).not.toMatch(/onEnter:\s*\(\)\s*=>\s*\(?visible\s*=\s*true/);
  });

  test("leave CANCELS the parked request — the whole point of the queue", () => {
    // Without the cancel, a flown-past card still builds 160ms later: the sweep
    // pays for every card it passed, just off the critical path.
    expect(code).toMatch(/queue\.cancel\(/);
  });

  test("mounts on the narrow margin and releases only on the wide one", () => {
    expect(code).toContain("RETENTION_BAND.mount");
    expect(code).toContain("RETENTION_BAND.retain");
  });

  test("full screen still bypasses the queue entirely", () => {
    // An expanded card is `fixed`, so its in-flow wrapper collapses to nothing
    // and the observer can never fire — a card expanded before it scrolled into
    // view would be stuck as a skeleton with no way out.
    expect(code).toMatch(/const mounted = \$derived\(visible \|\| screen\.expanded\)/);
  });
});
