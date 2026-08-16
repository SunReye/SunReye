// fallow-ignore-file unused-export unused-type -- phase 2.1 of the layout system: the vocabulary is broader than the first wave of callers spends; later phases claim the rest
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
/**
 * The column ramp a grid of dense readouts follows, on its own so the one grid
 * that cannot spend {@link GRID}`.tiles` wholesale still shares the decision.
 *
 * The statistics tile grid draws hairline separators with per-tile borders
 * rather than a gap (a gap over a border-coloured backdrop showed the backdrop
 * through the empty trailing cells), so it needs the columns without `gap-3`.
 * Restating them there is how the same 31 readouts ended up 2-up on the
 * peak-shaving page and 1-up on statistics.
 */
export const TILE_COLUMNS = "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4";

export const GRID = {
  /** Dense readouts: stat tiles, metric pairs. */
  tiles: `grid ${TILE_COLUMNS} gap-3 [&>*]:min-w-0`,
  /** Two related blocks — charts side by side once there is room for both. */
  pair: "grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0",
  /** Many cards of equal weight: automation list, forecast panels. */
  wall: "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0",
} as const;

export type GridVariant = keyof typeof GRID;

/**
 * The plot box every full-width chart renders into.
 *
 * A chart is a header, a fixed-height plot and a legend; at `h-64` that stack
 * is ~340px, so a 961px-tall phone showed two and a half of them and
 * /statistics measured 7371px end to end. Losing 64px per plot on a phone costs
 * a chart nothing legible — the plot is still taller than it is wide there —
 * and buys back a whole chart per screenful.
 */
export const CHART_BOX = "h-48 sm:h-64";

/** The same box for a chart that ships shorter by design (the energy split). */
export const CHART_BOX_SHORT = "h-44 sm:h-55";

/**
 * How many options a segmented switcher can show as a row on a phone. A fourth
 * wraps to a second line at 412px, where it reads as a separate control rather
 * than as more of the same choice; past this the switcher offers a Select
 * instead — see {@link needsCompactSwitcher}.
 */
export const SEGMENTED_MAX_OPTIONS = 3;

/** Does a switcher over `optionCount` options need a compact phone form? */
export function needsCompactSwitcher(optionCount: number): boolean {
  return optionCount > SEGMENTED_MAX_OPTIONS;
}

/** Joins the truthy parts of a class list; keeps builders free of `&&` noise. */
function classes(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** The one page container: centred, full-width up to its measure, stacked. */
export function pageShellClass(width: ShellWidth = "wide"): string {
  return classes("mx-auto flex w-full flex-col", SHELL_WIDTH[width], SHELL_GAP, SHELL_PAD);
}

/** The card's own chrome — the frame a nested card gives up on a phone. */
const SECTION_BORDER = "border border-border";

/** The same utilities, deferred to the sm breakpoint. Written as a transform
 *  rather than a second literal so one edit still reaches both variants. */
const fromSmUp = (utilities: string): string =>
  utilities
    .split(" ")
    .map((u) => (u.startsWith("sm:") ? u : `sm:${u}`))
    .join(" ");

/** The `sm:`-and-up half of a responsive token; its phone value is dropped. */
const smHalf = (token: string): string =>
  token
    .split(" ")
    .filter((u) => u.startsWith("sm:"))
    .join(" ");

export type SectionShellOptions = {
  /** Customize mode: the section is being arranged, not just read. */
  dashed?: boolean;
  /** Hidden-section preview — still mounted, visibly demoted. */
  dimmed?: boolean;
  /**
   * This card sits inside another one (a chart panel inside a statistics
   * section, inside the page shell). Three frames cost 50px per side at 390px,
   * a quarter of the screen spent saying "these things are separate" about
   * boxes that are already stacked with a gap between them. The inner frame
   * comes back at sm, where the width is there to spend.
   */
  nested?: boolean;
};

/** The one section card: bordered stack, optionally in a customize state. */
export function sectionShellClass({ dashed, dimmed, nested }: SectionShellOptions = {}): string {
  return classes(
    "flex min-w-0 flex-col",
    nested ? fromSmUp(SECTION_BORDER) : SECTION_BORDER,
    SECTION_GAP,
    nested ? smHalf(SECTION_PAD) : SECTION_PAD,
    dashed && "border-dashed border-primary/60",
    dimmed && "opacity-40",
  );
}

/**
 * What a section card becomes while one of its charts holds the screen.
 *
 * The card is not replaced by a "big" copy of itself — same header, same body,
 * same chart component with its brush and pinch still bound. Only these classes
 * change, and they are stated here rather than inline because which declaration
 * wins is the whole behaviour: every chart is sized by {@link CHART_BOX} on
 * layerchart's own container, so filling the screen means beating that class on
 * the element that carries it.
 *
 * Written out one literal at a time, never composed with `map`/`join`: Tailwind
 * finds classes by scanning source text, so a class name this file builds at
 * runtime is a class name that never reaches the stylesheet. That failure is
 * silent — the string is present in the DOM and does nothing.
 */
const EXPANDED_SECTION = [
  "!h-full !w-full !max-w-none !border-0 !p-4 bg-background",
  "flex flex-col",
  // The body takes the leftover height; otherwise the children keep their
  // content heights and pile up at the top with a screen of white beneath.
  "[&_[data-slot=collapsible-content]]:flex [&_[data-slot=collapsible-content]]:flex-col",
  "[&_[data-slot=collapsible-content]]:min-h-0 [&_[data-slot=collapsible-content]]:flex-1",
  // Then the whole chain down to the plot. `:has()` picks out exactly the
  // ancestors of a chart, so a legend or a caption beside it keeps its content
  // height while the plot takes everything left over. A chain rather than one
  // rule because the depth differs per chart — some are a bare container in the
  // body, some sit two wrappers down beside a legend and a zoom control.
  "[&_[data-slot=collapsible-content]_*:has([data-slot=chart])]:!flex",
  "[&_[data-slot=collapsible-content]_*:has([data-slot=chart])]:!flex-col",
  "[&_[data-slot=collapsible-content]_*:has([data-slot=chart])]:!min-h-0",
  "[&_[data-slot=collapsible-content]_*:has([data-slot=chart])]:!flex-1",
  // And the plot itself, which is where CHART_BOX's fixed height is written.
  "[&_[data-slot=collapsible-content]_[data-slot=chart]]:!min-h-0",
  "[&_[data-slot=collapsible-content]_[data-slot=chart]]:!flex-1",
  "[&_[data-slot=collapsible-content]_[data-slot=chart]]:!h-full",
].join(" ");

const OVERLAY_SECTION = "fixed inset-0 z-50 overflow-auto";

/** A section card's classes, given whether it currently holds the screen. */
export function expandedSectionClass(base: string, expanded: boolean, overlay: boolean): string {
  if (!expanded) return base;
  return overlay ? `${base} ${EXPANDED_SECTION} ${OVERLAY_SECTION}` : `${base} ${EXPANDED_SECTION}`;
}

/**
 * The same expansion for a chart with no section card around it — the two
 * dialogs and the forecast-correction panel. Same rules, anchored on the
 * wrapper's own last child instead of on the collapsible body.
 *
 * Literal class names for the same reason as {@link expandedSectionClass}:
 * Tailwind scans source text, so a name composed at runtime never reaches the
 * stylesheet and fails silently.
 */
const CHART_FRAME = "flex min-w-0 flex-col gap-2";

const EXPANDED_CHART = [
  "!h-full !w-full !p-4 bg-background",
  "[&>*:last-child]:flex [&>*:last-child]:flex-col",
  "[&>*:last-child]:min-h-0 [&>*:last-child]:flex-1",
  "[&_*:has([data-slot=chart])]:!flex [&_*:has([data-slot=chart])]:!flex-col",
  "[&_*:has([data-slot=chart])]:!min-h-0 [&_*:has([data-slot=chart])]:!flex-1",
  "[&_[data-slot=chart]]:!min-h-0 [&_[data-slot=chart]]:!flex-1",
  "[&_[data-slot=chart]]:!h-full",
].join(" ");

/** A standalone chart frame's classes, given whether it holds the screen. */
export function expandedChartClass(expanded: boolean, overlay: boolean): string {
  if (!expanded) return CHART_FRAME;
  return overlay
    ? `${CHART_FRAME} ${EXPANDED_CHART} ${OVERLAY_SECTION}`
    : `${CHART_FRAME} ${EXPANDED_CHART}`;
}
