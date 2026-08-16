/**
 * The categorical palette overlaid series are drawn from.
 *
 * `--chart-1..5` shipped as shadcn's default, which is one hue at five
 * lightnesses. That is a correct *sequential* ramp — for a quantity that has an
 * order — and the wrong thing entirely for series plotted on top of each other,
 * where the reader's only job is telling them apart. On a phone it read as five
 * shades of blue.
 *
 * These eight are categorical: each carries its own hue, and consecutive
 * entries are far apart on the wheel so the two series a chart most often
 * overlays are the two least alike. The values live in `app.css`, so the theme
 * still owns what each token means on each surface; this module owns the order
 * and the fact that there are eight of them.
 */

/**
 * Palette ids, in the order a chart spends them. Not colours — token names, so
 * light and dark can differ and nothing here needs to know.
 *
 * Kept in step with the same list in `@SunReye/db/custom-charts`, which
 * validates a pinned colour on write. The web app cannot import from that
 * package, so a test compares the two by reading its source.
 */
export const SERIES_COLORS = [
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "chart-6",
  "chart-7",
  "chart-8",
] as const;

export type SeriesColor = (typeof SERIES_COLORS)[number];

/**
 * The CSS value for a palette id.
 *
 * `--chart-N`, the theme's own property, and NOT Tailwind's `--color-chart-N`.
 * The mapped name only exists in the stylesheet when Tailwind sees it in
 * scanned source, and these are composed at runtime — so the mapping is emitted
 * for whichever numbers happen to appear as literals somewhere and dropped for
 * the rest. `--chart-6` was the one that fell through: the swatch painted
 * transparent and the sixth series drew with no colour at all, while 7 and 8
 * worked because a test file happened to spell them out.
 *
 * The raw property is declared in an ordinary `:root` rule, so it is always
 * there. Same trap as the composed class names in `layout/tokens.ts`.
 */
export function colorVar(id: SeriesColor): string {
  return `var(--${id})`;
}

/**
 * The colour at a position in a chart's series list. Cycles, because the
 * history grid also spends this palette and has no bound on how many cards a
 * category holds. Inside one chart it never wraps: the palette is as long as
 * the overlay limit, which a test holds.
 */
export function paletteColor(index: number): string {
  return colorVar(SERIES_COLORS[index % SERIES_COLORS.length]!);
}

/**
 * Is this a palette id?
 *
 * A pinned colour round-trips through the server and ends up in a `style`
 * attribute and in SVG fill/stroke. Narrowing it to the palette is what keeps
 * that from being a way to inject CSS — which is also why the picker offers
 * swatches rather than a free-form field.
 */
export function isSeriesColor(value: unknown): value is SeriesColor {
  return typeof value === "string" && (SERIES_COLORS as readonly string[]).includes(value);
}
