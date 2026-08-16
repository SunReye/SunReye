// fallow-ignore-file unused-file unused-export unused-type -- phase 2.1 of the layout system: the tokens ship before the routes that spend them, and the migration commits remove this line
/**
 * The layout vocabulary — one place every page and section reads its measure,
 * padding and rhythm from.
 *
 * Before this, seven pages used five vertical rhythms and four content
 * measures, and the bordered section card was re-implemented six times with
 * three different gaps. None of that was a decision; it was whatever the last
 * author had open in the next tab. These constants are the decision, and the
 * enforcement gate compares raw class strings in routes against them — so they
 * are plain strings, not a class-variance config: a token that cannot be
 * grepped for cannot be enforced.
 *
 * Breakpoint policy: sm / lg / xl / 2xl only. `md:` is deliberately absent — a
 * token that changes twice between phone and laptop produces the in-between
 * states nobody designed. `tokens.test.ts` fails on one.
 */

/** Content measures, named by intent rather than by size. */
export const SHELL_WIDTH = {
  /** Forms, lists, prose — anything read line by line. */
  narrow: "max-w-3xl",
  /** Dashboards and charts: wide, then uncapped again on very large screens. */
  wide: "max-w-7xl 2xl:max-w-384",
  /** Bespoke full-bleed layouts (the overview's viewport-height grid). */
  full: "max-w-none",
} as const;

export type ShellWidth = keyof typeof SHELL_WIDTH;

/** Page gutter. Grows on larger screens, where the gutter is cheap. */
export const SHELL_PAD = "p-4 sm:p-6";

/** Distance between one section and the next. */
export const SHELL_GAP = "gap-6";

/**
 * Section gutter. Note it steps DOWN on mobile while {@link SHELL_PAD} steps
 * up: shell + section + chart panel nest, and three `p-4`s cost 50px per side
 * at 390px — a quarter of the screen spent on chrome.
 */
export const SECTION_PAD = "p-3 sm:p-4";

/** Distance between a section's header and its content, and between blocks in it. */
export const SECTION_GAP = "gap-4";

/** Wrapping row of controls (header actions, filter clusters, button groups). */
export const CLUSTER_GAP = "gap-x-3 gap-y-2";

/**
 * Hit-area expander for icon-only triggers: an invisible `::after` grows the
 * touch target past the icon without moving the icon or disturbing the layout.
 *
 * Sized to clear WCAG 2.5.5 (44px) around a 16px icon — see {@link tapTargetPx},
 * which measures it rather than trusting the string. This deliberately does NOT
 * match the `-inset-x-3 -inset-y-2` the Checkbox and Switch primitives carry:
 * that pair computes to 40x32, which reads generous and is not, and those two
 * controls sit beside a label that is part of their hit area anyway. An icon
 * trigger has nothing next to it.
 */
export const TAP = "relative after:absolute after:-inset-3.5";

/** Tailwind's default spacing step (`--spacing: 0.25rem`) at a 16px root. */
const SPACING_PX = 4;

/** The `after:-inset[-axis]-<n>` reach TAP declares on one axis, in CSS px. */
function tapInsetPx(axis: "x" | "y"): number {
  const axial = TAP.match(new RegExp(`after:-inset-${axis}-([\\d.]+)`));
  const both = TAP.match(/after:-inset-([\d.]+)(?:\s|$)/);
  return Number((axial ?? both)?.[1] ?? 0) * SPACING_PX;
}

/**
 * The touch target {@link TAP} produces around content of a given size, in CSS
 * px — derived from the token, not restated next to it, so a shrunk inset is a
 * red test instead of a silent regression. The inset is negative and applies to
 * both edges of each axis, hence the doubling.
 */
export function tapTargetPx(contentPx: number): { width: number; height: number } {
  return {
    width: contentPx + 2 * tapInsetPx("x"),
    height: contentPx + 2 * tapInsetPx("y"),
  };
}

/**
 * Responsive grids. Every variant carries a BASE `grid-cols-*`: a bare
 * `sm:grid-cols-2` inherits the single-column default, which is what stacked 31
 * statistics tiles one-up on a phone. Every variant also carries
 * `[&>*]:min-w-0`, because grid children default to `min-width:auto` and one
 * long unbroken number then widens its column past the viewport.
 */
export const GRID = {
  /** Dense readouts: stat tiles, metric pairs. */
  tiles: "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 [&>*]:min-w-0",
  /** Two related blocks — charts side by side once there is room for both. */
  pair: "grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0",
  /** Many cards of equal weight: automation list, forecast panels. */
  wall: "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0",
} as const;

export type GridVariant = keyof typeof GRID;

/** Joins the truthy parts of a class list; keeps builders free of `&&` noise. */
function classes(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** The one page container: centred, full-width up to its measure, stacked. */
export function pageShellClass(width: ShellWidth = "wide"): string {
  return classes("mx-auto flex w-full flex-col", SHELL_WIDTH[width], SHELL_GAP, SHELL_PAD);
}

export type SectionShellOptions = {
  /** Customize mode: the section is being arranged, not just read. */
  dashed?: boolean;
  /** Hidden-section preview — still mounted, visibly demoted. */
  dimmed?: boolean;
};

/** The one section card: bordered stack, optionally in a customize state. */
export function sectionShellClass({ dashed, dimmed }: SectionShellOptions = {}): string {
  return classes(
    "flex min-w-0 flex-col border border-border",
    SECTION_GAP,
    SECTION_PAD,
    dashed && "border-dashed border-primary/60",
    dimmed && "opacity-40",
  );
}
