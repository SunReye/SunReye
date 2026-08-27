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
 * One height for every control in a page toolbar, borders included.
 *
 * The toolbar is a row of peers, and they were three different sizes: the period
 * navigator sat flush inside its border (34px), the range switcher carries `p-1`
 * (38px), and an icon button is `size="icon"` (32px). At 1440px that is a 2-3px
 * step at each seam of one line — not obviously wrong, which is why it survived,
 * and visibly untidy all the same.
 *
 * `h-9` and not a padding rule: these controls disagree about their INSIDES (one
 * flush, one padded, one a bare icon), so the only thing they can share is the
 * outside. Tailwind is border-box, so this is the total including the border.
 */
export const TOOLBAR_CONTROL_H = "h-9";

/**
 * The same height, from `sm` up only — for a control that is a stacked block on
 * a phone and a single row on a laptop (the period navigator).
 *
 * Spelled out as its own literal rather than composed as `sm:{TOOLBAR_CONTROL_H}`
 * at the call site: Tailwind scans SOURCE TEXT, so an interpolated variant is
 * never generated and the class silently does nothing. The suite has a case for
 * exactly this mistake on the fullscreen tokens.
 */
export const TOOLBAR_CONTROL_H_SM = "sm:h-9";

/**
 * An icon button in a page toolbar, at the same height as its neighbours.
 *
 * The Button primitive's `size="icon"` is `size-9 sm:size-8` — it SHRINKS from
 * `sm`, which is the one breakpoint where it has to line up with a 36px
 * navigator and a 36px switcher. Written as a `sm:size-*` class and not as
 * `sm:h-9 sm:w-9`, because tailwind-merge only displaces a class from the same
 * group AND the same variant: `w-9` leaves `sm:size-8` standing, and the winner
 * is then whichever rule Tailwind happened to emit last.
 */
export const TOOLBAR_ICON_CONTROL = "sm:size-9";

/**
 * The section header's two columns: title + caption on the left, chrome on the
 * right.
 *
 * The header used to be a single `flex-wrap items-center` row, and that is where
 * a card's controls scattered. Wrapping is decided by content, so the SAME
 * cluster landed in a different place on every panel: beside a short title
 * ("Energy split") it was right-aligned; under a long or captioned one ("Hour of
 * the week", "2026 versus last year") it took a line of its own and, with one
 * child on that line, was CENTRED. Three chart panels on /statistics, three
 * placements, none of them a decision.
 *
 * A grid ends the argument by never asking about content: column two is column
 * two at 390px and at 2560px. Column one is `minmax(0,1fr)` and not `1fr`
 * because a grid item's automatic minimum is its min-content size — a long
 * unbroken title would otherwise blow the track open and push the cluster off
 * the right edge, and the `truncate` on the `h2` would never get to fire.
 * `items-start` so a two-line title grows downwards while the chrome stays put
 * on the first line instead of drifting to the middle of it.
 *
 * The universal part of the four-zone header, so settings panels get it too;
 * only the readout row ({@link readoutRowClass}) and the icons-only rule are
 * specific to cards holding a plot.
 */
export function sectionHeaderGridClass(): string {
  return `grid grid-cols-[minmax(0,1fr)_auto] items-start ${CLUSTER_GAP}`;
}

/**
 * The card's readout row — zone 3, the first row of the body, above the plot:
 * the headline value and its delta on the left, the card's text controls on the
 * right.
 *
 * This is the one zone allowed to wrap, and wrapping here means STACKING: from
 * `max-sm` the two cells become one column apiece, each starting at the left
 * margin. Written as `max-sm:grid-cols-1` rather than as a wrapping flex row on
 * purpose — a wrapped flex line holding a single child still obeys `justify-*`,
 * which is precisely how the old header cluster ended up centred. A grid cell
 * has nowhere to centre to.
 *
 * `items-end` and not `items-center`: the value is a large number and the
 * controls are small text, so the two only read as one line when their bottoms
 * agree.
 */
export function readoutRowClass(): string {
  return `grid grid-cols-[minmax(0,1fr)_auto] max-sm:grid-cols-1 items-end ${CLUSTER_GAP}`;
}

/**
 * The header's right-hand cluster — zone 2, the contents of grid column two.
 *
 * Placement is no longer this token's business: {@link sectionHeaderGridClass}
 * puts the column hard right at every width, which is why the phone-width
 * `max-sm:[&:has(>*)]:w-full` + `justify-center` pair is gone (it was what
 * centred the cluster under a long title) and why `sm:ml-auto` went with them —
 * an auto margin pushing against the end of a track that is already flush right
 * does nothing but outlive its reason.
 *
 * What survives is the cluster's own internals: a row, vertically centred,
 * packed to its right edge so it grows leftwards as controls are added.
 *
 * It deliberately claims no width, padding or min-size of its own. An `auto`
 * track with nothing in it collapses to zero and the column gap goes with it,
 * which is what keeps an EMPTY cluster free — and empty is the common case:
 * every statistics section passes an `actions` snippet (`SectionControls`) that
 * renders nothing outside customize mode, so a `hasActions` prop is truthy while
 * the cluster is visually empty. That is the observation the old `:has(> *)`
 * gate encoded; the grid now answers it structurally, without a selector.
 *
 * On a card holding a plot this cluster is icons only — a text button belongs in
 * the readout row ({@link readoutRowClass}). Settings panels, which have no
 * plot and no readout row, legitimately keep a text button here.
 *
 * The collapse caret is still deliberately NOT in here (see
 * `section-collapse-trigger.svelte`): grouped with the chrome it reads as a
 * "show more" button rather than as the section's own affordance.
 */
export function sectionActionsClass(): string {
  return `flex items-center justify-end ${CLUSTER_GAP}`;
}

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

/**
 * How close a portalled overlay — popover, tooltip, and the chart tooltips that
 * follow them — may come to the edge of the viewport, in CSS px.
 *
 * Spent as floating-ui's `collisionPadding`, which defaults to zero: an overlay
 * anchored to a control in the page gutter flips and then sits flush against
 * the edge, with its shadow and its rounded corner cut in half. A NUMBER rather
 * than a class, because the collision is resolved at position time by
 * measurement — a Tailwind inset is invisible to it and would only shift the
 * box after the decision was already made.
 *
 * Half the phone gutter (`SHELL_PAD`'s `p-4`): enough to read as deliberate,
 * small enough that a wide popover still prefers its natural side.
 */
export const TOOLTIP_VIEWPORT_MARGIN = 8;

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

/**
 * The tile grid's own frame.
 *
 * On a laptop this is `border-l border-t` and the tiles close the box with
 * their own `border-b border-r` — a hairline grid inside the section card.
 * Nested inside a card that is itself inside the page, that box cost 46px per
 * edge at 390px and left a two-up tile 133px: a box, in a box, in the page,
 * for a figure with a delta chip beside it.
 *
 * So on a phone the grid stops being a box and becomes a full-bleed run of
 * rows. It gives up its left border and pulls out through the section's gutter
 * (`SECTION_PAD`'s `p-3`), keeping only the top rule that separates it from
 * the header. The right bleed is one pixel deeper than the left on purpose:
 * the LAST column still draws its own `border-r`, and at -13px that border
 * lands exactly on the card's, instead of beside it as a two-pixel edge. The
 * left needs no such pixel — the card's own border is the frame there.
 *
 * `sm:ml-0 sm:mr-0` rather than `sm:mx-0`: Tailwind sorts `ml`/`mr` after `mx`,
 * so the axis form is not reliably the winner at the breakpoint even though it
 * comes later in the source. Same level on both sides of the breakpoint, and
 * the browser pass in `e2e/statistics-mobile-density.spec.ts` measures that it
 * really did win.
 */
export const TILE_FRAME = "-ml-3 -mr-[13px] border-t border-border sm:ml-0 sm:mr-0 sm:border-l";

/**
 * One tile in that grid: the hairlines that close the box, and its gutter.
 *
 * The gutter steps down to 12px on a phone for the reason {@link SECTION_PAD}
 * does — the innermost box pays least — and because 16px inside a cell that is
 * already flush with the card's edge is padding on top of padding.
 */
export const TILE_CELL = "border-b border-r border-border bg-background px-3 py-3 sm:px-4";

/** Tailwind's `sm` breakpoint (40rem at a 16px root), in CSS px. */
const SM_PX = 640;

/** The wide shell's cap (`max-w-7xl`, 80rem), in CSS px. */
const SHELL_CAP_PX = 1280;

/** The utilities of a responsive token that actually apply at `viewportPx`. */
function activeUtilities(token: string, viewportPx: number): string[] {
  return token
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((u) => (u.startsWith("sm:") ? (viewportPx >= SM_PX ? [u.slice(3)] : []) : [u]));
}

/** `3` -> 12px, `[13px]` -> 13px. Tailwind's step at a 16px root. */
function lengthPx(value: string): number {
  const arbitrary = value.match(/^\[(\d+(?:\.\d+)?)px\]$/);
  return arbitrary ? Number(arbitrary[1]) : Number(value) * SPACING_PX;
}

/**
 * What a class list spends on ONE horizontal side: border + padding + margin,
 * in CSS px. Negative margins spend negatively — that is the whole point of a
 * full-bleed row, and a helper that could not go below zero could not measure
 * one.
 *
 * Resolution follows Tailwind's own ordering: a side utility (`pl-`) beats an
 * axis one (`px-`) beats the all-sides form (`p-`), and among equals the later
 * one in the token wins — which is how `px-3 sm:px-4` resolves once
 * {@link activeUtilities} has kept both. Tokens here therefore never mix
 * levels across a breakpoint (`-ml-3 sm:mx-0` would resolve differently in this
 * model than in the stylesheet); they restate the same level, and
 * `tokens.test.ts` measures the result rather than trusting it.
 */
function sideSpendPx(utilities: string[], side: "left" | "right"): number {
  const axial = side === "left" ? "l" : "r";
  return spentByClaims(utilities.flatMap((u) => sideClaimOf(u, axial) ?? []));
}

/** Which horizontal side a utility names, as `sideSpendPx` addresses it. */
type AxialSide = "l" | "r";

/**
 * One utility's claim on one horizontal side: which box part it sets
 * (`p`, `m`, `border`), how specifically it named the side, and what it costs.
 */
interface SideClaim {
  readonly kind: string;
  readonly rank: number;
  readonly px: number;
}

/**
 * How specifically `target` names `axial`, following Tailwind's own ordering:
 * the side form (`pl-`) beats the axis (`px-`) beats all-sides (`p-`). A
 * vertical-only target (`pt-`, `border-y`) is not a claim on this side at all,
 * and scores below every rank so it can be dropped rather than ranked.
 */
function sideRank(target: string | undefined, axial: AxialSide): number {
  if (target === axial) return 2;
  if (target === "x") return 1;
  return target === undefined || target === "" ? 0 : -1;
}

/** The padding/margin a utility spends on `axial`, or `null` if it is not one. */
function boxClaimOf(utility: string, axial: AxialSide): SideClaim | null {
  const box = utility.match(/^(-?)([pm])([xylrtb]?)-(.+)$/);
  if (box === null) return null;
  const [, sign, kind, target, value] = box;
  const rank = sideRank(target, axial);
  // Negative margins spend negatively — that is the whole point of a full-bleed
  // row, so the sign travels with the length rather than being clamped away.
  return rank < 0
    ? null
    : { kind: kind ?? "", rank, px: (sign === "-" ? -1 : 1) * lengthPx(value ?? "") };
}

/** The border width a utility draws on `axial`, or `null` if it draws none. */
function borderClaimOf(utility: string, axial: AxialSide): SideClaim | null {
  const border = utility.match(/^border(?:-([xylrtb]))?(?:-(\d+))?$/);
  if (border === null) return null;
  const [, target, width] = border;
  const rank = sideRank(target, axial);
  return rank < 0 ? null : { kind: "border", rank, px: width === undefined ? 1 : Number(width) };
}

/** What one utility claims on `axial` — padding, margin, border, or nothing. */
function sideClaimOf(utility: string, axial: AxialSide): SideClaim | null {
  return boxClaimOf(utility, axial) ?? borderClaimOf(utility, axial);
}

/**
 * The px the surviving claims add up to: one winner per box part — the most
 * specific, and among equals the later one in the token, which is how
 * `px-3 sm:px-4` resolves once {@link activeUtilities} has kept both.
 */
function spentByClaims(claims: SideClaim[]): number {
  const best = new Map<string, SideClaim>();
  for (const claim of claims) {
    const held = best.get(claim.kind);
    if (held === undefined || claim.rank >= held.rank) best.set(claim.kind, claim);
  }

  let total = 0;
  for (const { px } of best.values()) total += px;
  return total;
}

/** `width` minus what `token` spends on both of its horizontal sides. */
function insideOf(width: number, token: string, viewportPx: number): number {
  const utilities = activeUtilities(token, viewportPx);
  return width - sideSpendPx(utilities, "left") - sideSpendPx(utilities, "right");
}

/**
 * How many CSS px are left for a tile's TEXT at a given viewport, walking the
 * whole chrome chain the tile sits in: page shell, section card, tile grid,
 * tile.
 *
 * The number, not the classes, is the thing that was wrong. At 390px the chain
 * was 16 + (1 + 12) + 1 + (1 + 16) = 46px per edge and left a two-up tile 133px
 * — a box, inside a box, inside the page, for a figure with a delta chip beside
 * it. Derived from the tokens rather than restated next to them, so shrinking a
 * tile's measure is a red test instead of a silent regression.
 */
export function tileContentWidthPx(viewportPx: number, columns: number): number {
  const shell = insideOf(Math.min(viewportPx, SHELL_CAP_PX), SHELL_PAD, viewportPx);
  const section = insideOf(shell, `${SECTION_BORDER} ${SECTION_PAD}`, viewportPx);
  const grid = insideOf(section, TILE_FRAME, viewportPx);
  return insideOf(grid / columns, TILE_CELL, viewportPx);
}

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

/**
 * Pinned over the page — in BOTH paths, not only the fallback.
 *
 * The element handed to the browser is `<html>`, never this card (see
 * `$lib/charts/fullscreen`, `fullscreenTarget`): full-screening the card takes
 * every body-portalled tooltip and menu out of the rendering tree. So the
 * browser does nothing to lift this card out of the page, and `fixed inset-0`
 * is the only thing that makes it fill the screen.
 *
 * `pointer-events-auto` because the frame is portalled to `document.body`, and
 * bits-ui sets `body { pointer-events: none }` for as long as a dialog is open.
 * Inheriting that leaves a frame that paints perfectly and cannot be hovered,
 * brushed or closed.
 */
const OVERLAY_SECTION = "fixed inset-0 z-50 overflow-auto pointer-events-auto";

/** A section card's classes, given whether it currently holds the screen. */
export function expandedSectionClass(base: string, expanded: boolean): string {
  return expanded ? `${base} ${EXPANDED_SECTION} ${OVERLAY_SECTION}` : base;
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
export function expandedChartClass(expanded: boolean): string {
  return expanded ? `${CHART_FRAME} ${EXPANDED_CHART} ${OVERLAY_SECTION}` : CHART_FRAME;
}
