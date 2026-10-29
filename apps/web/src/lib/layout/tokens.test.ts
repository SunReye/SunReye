import { describe, expect, test } from "bun:test";
import {
  CLUSTER_GAP,
  expandedChartClass,
  expandedSectionClass,
  TILE_CELL,
  TILE_FRAME,
  needsCompactSwitcher,
  SECTION_PAD,
  pageShellClass,
  sectionShellClass,
  tapTargetPx,
  tileContentWidthPx,
  sectionActionsClass,
  sectionHeaderGridClass,
  readoutRowClass,
} from "./tokens";

// What these class strings DO on a screen — the header cluster hard right at
// 390px, a full-screen card whose chart actually grows, a 44px caret — is
// proved by mounting the components that spend them:
// `components/layout/section.svelte.test.ts`, `chart-fullscreen.svelte.test.ts`.
// This file keeps the builders' composition rules.

describe("page shell builder", () => {
  test("a narrow shell differs from a wide one only in the measure", () => {
    expect(pageShellClass("narrow")).toBe(
      "mx-auto flex w-full flex-col max-w-3xl gap-6 p-4 sm:p-6",
    );
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

describe("compact switcher", () => {
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

describe("expandedSectionClass", () => {
  // A section that goes full-screen keeps being the same card — the same
  // header, the same body, the same chart component with its brush and pinch
  // still bound. What changes is a handful of classes.
  const BASE = "flex min-w-0 flex-col sm:border sm:border-border gap-4 sm:p-4";

  test("is the untouched card while it is not expanded", () => {
    expect(expandedSectionClass(BASE, false)).toBe(BASE);
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

  test("always pins itself over the page", () => {
    // Same reason as the section card: the browser is handed `<html>`, not this
    // frame, so nothing but `fixed inset-0` makes it fill the screen.
    expect(expandedChartClass(true)).toContain("fixed inset-0");
  });
});

describe("header action placement", () => {
  test("the header is a two-column grid and the cluster packs to its right edge", () => {
    // The row used to be one `flex-wrap`, so where the controls landed depended
    // on the title's length. The grid's `minmax(0,1fr)` column absorbs it.
    expect(sectionHeaderGridClass()).toContain("grid-cols-[minmax(0,1fr)_auto]");
    expect(sectionActionsClass()).toContain("justify-end");
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
});
