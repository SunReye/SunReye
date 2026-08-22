import { describe, expect, test } from "bun:test";
import {
  CHART_BOX,
  CHART_BOX_SHORT,
  CLUSTER_GAP,
  expandedChartClass,
  expandedSectionClass,
  GRID,
  SEGMENTED_MAX_OPTIONS,
  TILE_CELL,
  TILE_COLUMNS,
  TILE_FRAME,
  needsCompactSwitcher,
  SECTION_GAP,
  SECTION_PAD,
  SHELL_GAP,
  SHELL_PAD,
  SHELL_WIDTH,
  TAP,
  TOOLTIP_VIEWPORT_MARGIN,
  pageShellClass,
  sectionShellClass,
  tapTargetPx,
  tileContentWidthPx,
  type GridVariant,
  type ShellWidth,
  sectionActionsClass,
  sectionHeaderGridClass,
  readoutRowClass,
} from "./tokens";

describe("shell widths", () => {
  // Seven pages shipped four different measures, and /automations (max-w-3xl)
  // sat next to its own detail page (max-w-7xl), so the content measure jumped
  // on navigation. Three named intents, no fourth.
  test("narrow is the reading measure forms and lists get", () => {
    expect(SHELL_WIDTH.narrow).toBe("max-w-3xl");
  });

  test("wide is the dashboard measure, uncapped again on very large screens", () => {
    expect(SHELL_WIDTH.wide).toBe("max-w-7xl 2xl:max-w-384");
  });

  test("full opts out of the measure for bespoke full-bleed pages", () => {
    expect(SHELL_WIDTH.full).toBe("max-w-none");
  });

  test("the width keys are exhaustive — a fourth measure has to be added here", () => {
    expect(Object.keys(SHELL_WIDTH).sort()).toEqual(["full", "narrow", "wide"]);
  });
});

describe("spacing tokens", () => {
  test("the page shell pads up on larger screens", () => {
    expect(SHELL_PAD).toBe("p-4 sm:p-6");
    expect(SHELL_GAP).toBe("gap-6");
  });

  // Shell + section + chart panel nested three p-4s: 50px/side of chrome at
  // 390px. The section steps DOWN on mobile so the innermost box pays least.
  test("the section pad steps down on mobile, unlike the shell", () => {
    expect(SECTION_PAD).toBe("p-3 sm:p-4");
  });

  test("sections separate their content tighter than the page separates sections", () => {
    expect(SECTION_GAP).toBe("gap-4");
    expect(CLUSTER_GAP).toBe("gap-x-3 gap-y-2");
  });
});

describe("page shell builder", () => {
  test("a wide shell centres itself, stacks, and carries the wide measure", () => {
    expect(pageShellClass("wide")).toBe(
      "mx-auto flex w-full flex-col max-w-7xl 2xl:max-w-384 gap-6 p-4 sm:p-6",
    );
  });

  test("a narrow shell differs from a wide one only in the measure", () => {
    expect(pageShellClass("narrow")).toBe(
      "mx-auto flex w-full flex-col max-w-3xl gap-6 p-4 sm:p-6",
    );
  });

  test("a full shell still pads and still centres — only the cap is gone", () => {
    expect(pageShellClass("full")).toBe("mx-auto flex w-full flex-col max-w-none gap-6 p-4 sm:p-6");
  });

  test("width defaults to wide, the measure most pages want", () => {
    expect(pageShellClass()).toBe(pageShellClass("wide"));
  });
});

describe("section shell builder", () => {
  const base = "flex min-w-0 flex-col border border-border gap-4 p-3 sm:p-4";

  test("a plain section is a bordered stack with no state classes", () => {
    expect(sectionShellClass()).toBe(base);
    expect(sectionShellClass({})).toBe(base);
  });

  test("dashed swaps in the customize-mode outline", () => {
    expect(sectionShellClass({ dashed: true })).toBe(`${base} border-dashed border-primary/60`);
  });

  test("dimmed previews a hidden section without unmounting it", () => {
    expect(sectionShellClass({ dimmed: true })).toBe(`${base} opacity-40`);
  });

  test("dashed and dimmed compose — a hidden section while customizing is both", () => {
    expect(sectionShellClass({ dashed: true, dimmed: true })).toBe(
      `${base} border-dashed border-primary/60 opacity-40`,
    );
  });

  test("false flags add nothing, so callers can pass booleans straight through", () => {
    expect(sectionShellClass({ dashed: false, dimmed: false })).toBe(base);
  });

  // A chart panel sits inside a statistics section, which sits inside the page
  // shell: three borders and three pads, 50px per side of pure chrome on a
  // 390px screen. The inner card keeps its chrome only where there is room.
  test("nested drops the inner card's own border and pad below sm", () => {
    expect(sectionShellClass({ nested: true })).toBe(
      "flex min-w-0 flex-col sm:border sm:border-border gap-4 sm:p-4",
    );
  });

  // Derived from SECTION_PAD rather than restated beside it: a changed section
  // pad has to reach the nested variant too, or the two drift apart silently.
  test("the nested pad is the sm half of the section pad, not a second literal", () => {
    const [, ...fromSmUp] = SECTION_PAD.split(" ");
    expect(sectionShellClass({ nested: true })).toContain(fromSmUp.join(" "));
    expect(sectionShellClass({ nested: true })).not.toContain(SECTION_PAD);
  });

  test("a nested section still composes with the customize states", () => {
    expect(sectionShellClass({ nested: true, dashed: true, dimmed: true })).toBe(
      "flex min-w-0 flex-col sm:border sm:border-border gap-4 sm:p-4" +
        " border-dashed border-primary/60 opacity-40",
    );
  });
});

describe("grids", () => {
  const variants = Object.keys(GRID) as GridVariant[];

  test("the variants are the three the app actually lays out", () => {
    expect(variants.sort()).toEqual(["pair", "tiles", "wall"]);
  });

  // 31 statistics tiles stacked one-up on a phone because the grid was
  // `grid sm:grid-cols-2` with no base column count. Every variant states its
  // phone layout explicitly.
  test.each(variants)("%s states a base column count before any breakpoint", (variant) => {
    expect(GRID[variant]).toMatch(/(^|\s)grid-cols-\d/);
  });

  // Grid children default to min-width:auto, so one long unbroken value (a
  // tabular-nums kWh total) widens its column and pushes the row off-screen.
  test.each(variants)("%s lets its children shrink below their content", (variant) => {
    expect(GRID[variant]).toContain("[&>*]:min-w-0");
  });

  test.each(variants)("%s is a grid and sets its own gap", (variant) => {
    expect(GRID[variant]).toMatch(/(^|\s)grid(\s|$)/);
    expect(GRID[variant]).toMatch(/(^|\s)gap-\d/);
  });
});

describe("tile columns", () => {
  // The statistics tile grid draws its own hairline separators instead of using
  // a gap, so it cannot spend GRID.tiles wholesale. It must still get the SAME
  // column ramp, or the same 31 readouts render 4-up on one page and 2-up on
  // another — which is exactly what shipped.
  test("GRID.tiles is the shared ramp plus a gap, not a second column decision", () => {
    expect(GRID.tiles).toContain(TILE_COLUMNS);
  });

  test("the ramp starts two-up and never loses a column on a wider screen", () => {
    const counts = [...TILE_COLUMNS.matchAll(/grid-cols-(\d+)/g)].map((m) => Number(m[1]));
    expect(counts[0]).toBe(2);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
  });
});

describe("what is left for a tile to say", () => {
  // Measured in a browser at 390px before this: page shell p-4, section
  // border + p-3, grid border-l, tile border-r + px-4 — 46px of chrome per
  // edge and 133px of content, for a figure that carries a delta chip beside
  // it and a sub-line under it. Three stacked borders: a box, in a box, in the
  // page.
  //
  // 150px is the floor because that is what the widest headline row needs at
  // this type scale: a `text-2xl` five-character figure ("−1,234") measures
  // ~92px in the app's mono face, the delta chip beside it is ~48px, and the
  // `gap-2` between them is 8.
  test("a two-up tile on a 390px phone gets at least 150px for its text", () => {
    expect(tileContentWidthPx(390, 2)).toBeGreaterThanOrEqual(150);
  });

  // The saving has to come out of the CHROME, not out of the desktop card. A
  // laptop keeps the frame it has room for, and the same helper says so.
  test("a laptop still spends the full nested frame on its tiles", () => {
    const utilities = TILE_FRAME.split(" ");
    expect(utilities).toContain("sm:border-l");
    expect(TILE_CELL).toContain("sm:px-4");
    expect(tileContentWidthPx(1024, 4)).toBeGreaterThan(150);
  });

  // The helper is only worth having if it MEASURES the tokens. A frame that
  // stopped bleeding, or a cell that padded itself back up, has to move the
  // number — otherwise the assertion above is decoration.
  test("the measurement follows the tokens rather than restating them", () => {
    const bled = tileContentWidthPx(390, 2);
    expect(bled).toBeGreaterThan(insideTheOldFrame(390, 2));
  });

  test("more columns divide the same row, they do not conjure width", () => {
    expect(tileContentWidthPx(390, 4)).toBeLessThan(tileContentWidthPx(390, 2));
  });
});

/**
 * The same walk with the frame this replaced — a nested bordered box and a
 * 16px cell gutter — so the improvement is a comparison and not a memory.
 */
function insideTheOldFrame(viewportPx: number, columns: number): number {
  const shell = viewportPx - 2 * 16;
  const section = shell - 2 * (1 + 12);
  const grid = section - 1;
  return grid / columns - 1 - 2 * 16;
}

describe("chart boxes", () => {
  // A 256px plot box plus its legend and section header meant three charts to a
  // phone screen; /statistics measured 7371px tall at 412x961.
  test("the plot box is shorter on a phone and grows back at sm", () => {
    expect(CHART_BOX).toBe("h-48 sm:h-64");
    expect(CHART_BOX_SHORT).toBe("h-44 sm:h-55");
  });

  test.each([CHART_BOX, CHART_BOX_SHORT])("%s changes height exactly once", (box) => {
    // Same breakpoint policy as the rest of the vocabulary: a box that steps at
    // sm AND lg produces an in-between size nobody designed.
    expect(box.match(/(^|\s)(sm|lg|xl|2xl):/g)).toHaveLength(1);
    expect(box).not.toMatch(/(^|\s)md:/);
  });

  test("the phone height is the smaller one — the token is a saving, not a swap", () => {
    const [phone, wide] = CHART_BOX.split(" ");
    expect(Number(phone.replace("h-", ""))).toBeLessThan(Number(wide.replace("sm:h-", "")));
  });
});

describe("compact switcher", () => {
  // A segmented row of four options wraps to two lines at 412px, and the second
  // line reads as an unrelated control. Past the threshold the switcher offers a
  // Select on a phone instead.
  // The number, not just the relation: a `size="sm"` button with a range label
  // ("Last 7 days") is ~90px, the row adds 1px of border and 4px of gap either
  // side, and a 412px phone inside the page and section gutters has ~348px. Four
  // of them wrap; three do not.
  test("the threshold is three", () => {
    expect(SEGMENTED_MAX_OPTIONS).toBe(3);
  });

  test("three options still fit a phone as a segmented row", () => {
    expect(needsCompactSwitcher(0)).toBe(false);
    expect(needsCompactSwitcher(1)).toBe(false);
    expect(needsCompactSwitcher(3)).toBe(false);
  });

  test("a fourth option does not", () => {
    expect(needsCompactSwitcher(4)).toBe(true);
    expect(needsCompactSwitcher(7)).toBe(true);
  });
});

describe("tap targets", () => {
  test("TAP grows the hit area without moving the icon", () => {
    expect(TAP).toContain("relative");
    expect(TAP).toContain("after:absolute");
  });

  // The point of the token is a NUMBER, so the test asserts the number. The
  // string it replaced (`-inset-x-3 -inset-y-2`, still what Checkbox and Switch
  // carry) reads as "bigger" and measured 40x32 around a 16px icon — under the
  // WCAG 2.5.5 44px target on both axes, worst on the vertical one, which is
  // where a thumb on a phone actually misses.
  test("a 16px icon trigger reaches the 44px touch target on both axes", () => {
    expect(tapTargetPx(16)).toEqual({ width: 44, height: 44 });
  });

  test("the expander is symmetric, so it adds the same reach to any control", () => {
    expect(tapTargetPx(0)).toEqual({ width: 28, height: 28 });
    expect(tapTargetPx(32)).toEqual({ width: 60, height: 60 });
  });
});

describe("overlay viewport margin", () => {
  // A popover or tooltip anchored to a control in the page gutter has 16px of
  // shell padding to work with, and bits-ui's collision detection defaults to
  // zero: the flipped side lands flush against the viewport edge, where the
  // shadow and the rounded corner are cut in half and the text starts one pixel
  // in. 8px is half the phone gutter — enough to read as deliberate, small
  // enough that a wide popover still prefers its natural side rather than
  // flipping.
  test("an overlay keeps eight pixels between itself and the viewport edge", () => {
    expect(TOOLTIP_VIEWPORT_MARGIN).toBe(8);
  });

  // Spent as a NUMBER, not as a class: `collisionPadding` is measured by
  // floating-ui at position time, so a Tailwind inset would be invisible to it
  // and would move the box after the collision was already resolved.
  test("it is a measurement, not a utility string", () => {
    expect(typeof TOOLTIP_VIEWPORT_MARGIN).toBe("number");
  });
});

describe("breakpoint policy", () => {
  // The app's breakpoints are sm/lg/xl/2xl. `md:` in a token means a layout
  // that changes twice between phone and laptop, which is where the odd
  // in-between states came from.
  const allTokens: string[] = [
    ...Object.values(SHELL_WIDTH),
    ...Object.values(GRID),
    SHELL_PAD,
    SHELL_GAP,
    SECTION_PAD,
    SECTION_GAP,
    CLUSTER_GAP,
    TAP,
    ...(["narrow", "wide", "full"] as ShellWidth[]).map((w) => pageShellClass(w)),
    sectionShellClass({ dashed: true, dimmed: true }),
  ];

  test.each(allTokens)("%s carries no md: prefix", (token) => {
    expect(token).not.toMatch(/(^|[\s:])md:/);
  });
});

describe("expandedSectionClass", () => {
  // A section that goes full-screen keeps being the same card — the same
  // header, the same body, the same chart component with its brush and pinch
  // still bound. What changes is a handful of classes, and they are here
  // because "does the chart actually fill the screen" is decided by which
  // declaration wins, not by anything a component test could see.
  const BASE = "flex min-w-0 flex-col sm:border sm:border-border gap-4 sm:p-4";

  test("is the untouched card while it is not expanded", () => {
    expect(expandedSectionClass(BASE, false)).toBe(BASE);
  });

  test("overrides the fixed plot height, or the chart stays 192px tall", () => {
    // Every chart in this app is sized by CHART_BOX on layerchart's own
    // container. Filling the screen means beating that class on the element
    // that carries it — hence `!h-full` on `[data-slot=chart]` itself, not a
    // height on some ancestor that the plot would ignore.
    const expanded = expandedSectionClass(BASE, true);
    expect(expanded).toContain("[&_[data-slot=collapsible-content]_[data-slot=chart]]:!h-full");
    expect(CHART_BOX).toContain("h-48");
  });

  test("lets the body take the leftover height instead of the header", () => {
    // Without this the card is a full-height column whose children keep their
    // content heights and pile up at the top, leaving the chart its original
    // size with a screen of white under it.
    const expanded = expandedSectionClass(BASE, true);
    expect(expanded).toContain("[&_[data-slot=collapsible-content]]:flex-1");
    expect(expanded).toContain("[&_[data-slot=collapsible-content]]:min-h-0");
  });

  test("grows every box between the body and the plot, not only the plot", () => {
    // The depth differs per chart: some are a bare container in the body, some
    // sit two wrappers down beside a legend and a zoom control. A rule that
    // only sized the plot left those wrappers at their content height, so the
    // plot's `h-full` resolved against 192px and nothing moved.
    const expanded = expandedSectionClass(BASE, true);
    for (const c of ["flex", "flex-col", "min-h-0", "flex-1"]) {
      expect(expanded).toContain(
        `[&_[data-slot=collapsible-content]_*:has([data-slot=chart])]:!${c}`,
      );
    }
  });

  test("every class it names is written literally in the source", async () => {
    // Tailwind finds classes by scanning source TEXT. The first version of this
    // token built its `:has()` rules with `.map().join()`, which reads
    // identically from a test and produces nothing at all in the stylesheet:
    // the class names were in the DOM, no rule existed, and the chart stayed
    // 192px tall inside a full-screen card. Nothing about the returned string
    // can show that — only the file can.
    const source = await Bun.file(new URL("./tokens.ts", import.meta.url)).text();
    const expanded = expandedSectionClass("", true).trim().split(/\s+/);
    expect(expanded.length).toBeGreaterThan(10);
    expect(expanded.filter((c) => !source.includes(c))).toEqual([]);
  });

  test("leaves a legend beside the plot at its own height", () => {
    // `:has()` is what makes that true — it selects the chart's ANCESTORS, and
    // a legend is a sibling. A descendant selector over the whole body would
    // have stretched the legend to a quarter of the screen.
    expect(expandedSectionClass(BASE, true)).toContain(":has([data-slot=chart])");
  });

  test("paints its own background — the fullscreen backdrop is black", () => {
    // The native fullscreen element sits on a black backdrop, and this card's
    // background comes from the page behind it. Without an explicit one the
    // text renders on black in light mode.
    expect(expandedSectionClass(BASE, true)).toContain("bg-background");
  });

  test("takes pointer input back from the dialog that suppressed it", () => {
    // The frame is portalled to `document.body`, and bits-ui sets
    // `body { pointer-events: none }` for as long as a dialog is open — its
    // scroll lock. The frame therefore INHERITS `none` and every control in it
    // goes dead: expanded from the energy or forecast dialog it painted
    // perfectly and could not be hovered, brushed or even closed.
    //
    // Only visible to a hit test. A synthetic `element.click()` dispatches
    // straight at the node and succeeds either way, which is exactly how this
    // shipped.
    expect(expandedSectionClass(BASE, true)).toContain("pointer-events-auto");
    expect(expandedChartClass(true)).toContain("pointer-events-auto");
  });

  test("always pins itself over the page, native full screen or not", () => {
    // The card is never the element handed to the browser — `fullscreenTarget`
    // gives it `<html>`, so that body-portalled tooltips and menus stay in the
    // rendering tree. Which means the browser does nothing to lift this card
    // out of the page: `fixed inset-0` is the only thing that makes it fill the
    // screen, in BOTH paths. Making it conditional is what left the card sitting
    // in the document flow with a full-screen viewport behind it.
    expect(expandedSectionClass(BASE, true)).toContain("fixed inset-0");
  });
});

describe("expandedChartClass", () => {
  // The frame for a chart with no section card: the two dialogs and the
  // forecast-correction panel. Same job, different anchor — the wrapper's own
  // last child rather than the collapsible body.
  test("is a plain column while it is not expanded", () => {
    expect(expandedChartClass(false)).not.toContain("!h-full");
    expect(expandedChartClass(false)).not.toContain("fixed");
  });

  test("grows the chart and every box above it", () => {
    const expanded = expandedChartClass(true);
    expect(expanded).toContain("[&_[data-slot=chart]]:!h-full");
    expect(expanded).toContain("[&_*:has([data-slot=chart])]:!flex-1");
    expect(expanded).toContain("[&>*:last-child]:flex-1");
  });

  test("always pins itself over the page", () => {
    // Same reason as the section card: the browser is handed `<html>`, not this
    // frame, so nothing but `fixed inset-0` makes it fill the screen.
    expect(expandedChartClass(true)).toContain("fixed inset-0");
  });

  test("every class it names is written literally in the source", async () => {
    // See the same case on expandedSectionClass: a composed class name is in
    // the DOM, has no rule behind it, and changes nothing.
    const source = await Bun.file(new URL("./tokens.ts", import.meta.url)).text();
    const expanded = expandedChartClass(true).trim().split(/\s+/);
    expect(expanded.length).toBeGreaterThan(10);
    expect(expanded.filter((c) => !source.includes(c))).toEqual([]);
  });
});

describe("header action placement", () => {
  // The complaint this exists for: the section header used to be one
  // `flex-wrap` row, so where the controls LANDED depended on whether the title
  // happened to leave room. Short title ("Energy split") and they sat beside it,
  // right-aligned; a long title or a caption ("Hour of the week", "2026 versus
  // last year") wrapped them onto a row of their own, where they were CENTRED.
  // Three chart panels on /statistics, three placements, none of them chosen.
  //
  // The header is now a two-column grid, so the cluster's column is the same
  // column at every width and the title's length cannot reach it.
  test("the title column absorbs every bit of title-length variance", () => {
    const utilities = sectionHeaderGridClass().split(/\s+/);
    expect(utilities).toContain("grid");
    // `minmax(0,1fr)` and not `1fr`: a grid item's automatic minimum is its
    // min-content size, so a long unbroken title (or a `truncate` that never
    // gets the chance to truncate) grows column one past the track and shoves
    // the cluster off the right edge. The zero floor is what makes the second
    // column's position independent of the first column's content.
    expect(utilities).toContain("grid-cols-[minmax(0,1fr)_auto]");
    expect(utilities).toContain("items-start");
    // The gap between the two columns is the same cluster gap the controls
    // inside the cluster use — one rhythm, decided once.
    for (const gap of CLUSTER_GAP.split(/\s+/)) expect(utilities).toContain(gap);
  });

  test("the cluster is hard right at EVERY width", () => {
    const utilities = sectionActionsClass().split(/\s+/);
    expect(utilities).toContain("justify-end");
    // The regression guard. Any of these coming back means the phone-width
    // cluster is centred on a row of its own again, which is the whole bug.
    expect(utilities).not.toContain("max-sm:[&:has(>*)]:w-full");
    expect(utilities).not.toContain("max-sm:[&:has(>*)]:justify-center");
    expect(utilities).not.toContain("justify-center");
    expect(utilities).not.toContain("justify-between");
    expect(utilities).not.toContain("w-full");
    // Not a single responsive variant survives: a cluster that is placed by its
    // grid column has nothing left to say at a breakpoint, and any variant here
    // could only move it back off that column.
    expect(utilities.filter((u) => /^(max-)?(sm|lg|xl|2xl):/.test(u))).toEqual([]);
    // `sm:ml-auto` is dead weight now — column two is already flush right — and
    // an auto margin that outlives its reason is the next author's puzzle.
    expect(utilities).not.toContain("sm:ml-auto");
    expect(utilities).not.toContain("ml-auto");
  });

  test("an EMPTY cluster claims no row and no gap", () => {
    // Every statistics section passes an `actions` snippet (`SectionControls`)
    // that renders nothing outside customize mode, so a `hasActions` prop is
    // truthy while the cluster is visually empty — this was tried and it spent a
    // `gap-y` on four sections for nothing. `:has(> *)` asks the only question
    // that matters, which is whether anything was actually rendered. In the grid
    // an empty `auto` column collapses to zero width by itself, so the cluster
    // must carry NO width, padding or min-size of its own that would keep the
    // column open.
    const utilities = sectionActionsClass().split(/\s+/);
    expect(utilities.filter((u) => /^(w-|min-w-|p[xl]?-|basis-|grow)/.test(u))).toEqual([]);
  });

  test("the readout row puts the value left and the controls right, and never centres", () => {
    // Zone 3: the row above the plot. It is the only zone allowed to wrap, and
    // wrapping means STACKING — on a phone the two cells become one column each
    // starting at the left margin. `grid-cols-1` and not a flex fallback,
    // because a wrapped flex line with one child obeys `justify-*` and that is
    // exactly how the header cluster ended up centred.
    const utilities = readoutRowClass().split(/\s+/);
    expect(utilities).toContain("grid");
    expect(utilities).toContain("grid-cols-[minmax(0,1fr)_auto]");
    expect(utilities).toContain("max-sm:grid-cols-1");
    // Bottoms, not centres: the value is a big number and the controls are
    // small text, and they read as one line only when their bottoms agree.
    expect(utilities).toContain("items-end");
    expect(
      utilities.filter((u) => u.includes("justify-center") || u.includes("text-center")),
    ).toEqual([]);
    expect(utilities).not.toContain("items-center");
    for (const gap of CLUSTER_GAP.split(/\s+/)) expect(utilities).toContain(gap);
  });

  test("every class the header zones name is written literally in the source", async () => {
    // Same reason as the expanded-chart case: Tailwind scans SOURCE TEXT, so a
    // class composed at a call site is in the DOM with no rule behind it.
    const source = await Bun.file(new URL("./tokens.ts", import.meta.url)).text();
    const named = [sectionHeaderGridClass(), readoutRowClass(), sectionActionsClass()]
      .join(" ")
      .trim()
      .split(/\s+/);
    expect(named.filter((c) => !source.includes(c))).toEqual([]);
  });
});
