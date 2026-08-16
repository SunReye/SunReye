import { describe, expect, test } from "bun:test";
import {
  CLUSTER_GAP,
  GRID,
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
