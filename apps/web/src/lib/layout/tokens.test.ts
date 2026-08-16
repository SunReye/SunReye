import { describe, expect, test } from "bun:test";
import {
  CHART_BOX,
  CHART_BOX_SHORT,
  CLUSTER_GAP,
  GRID,
  SEGMENTED_MAX_OPTIONS,
  TILE_COLUMNS,
  needsCompactSwitcher,
  SECTION_GAP,
  SECTION_PAD,
  SHELL_GAP,
  SHELL_PAD,
  SHELL_WIDTH,
  TAP,
  pageShellClass,
  sectionShellClass,
  tapTargetPx,
  type GridVariant,
  type ShellWidth,
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
