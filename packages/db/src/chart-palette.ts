/**
 * Which colour palette the charts and the power-flow diagram are drawn in.
 * Stored in `app_settings` under {@link CHART_PALETTE_KEY} — one instance-wide
 * preference, like display and tariff.
 *
 * A preset id, never colours. Three reasons, all load-bearing:
 *
 * - A preset authors LIGHT and DARK values for every token. One colour picked
 *   by a user cannot; it would read on one surface and be wrong on the other.
 * - Separation is a property of the whole SET, not of any one colour. The set
 *   shipped here is checked pairwise under three colour-vision deficiencies
 *   (`apps/web/src/lib/inverter/energy-tokens.test.ts`); eight independent
 *   pickers reliably destroy that, and nothing would say so.
 * - An id round-trips into a `data-` attribute. Free-form colours would have to
 *   land in a `style` attribute instead, which is a CSS-injection surface the
 *   custom-chart colours already close by the same argument.
 *
 * Per-series colours pinned on a saved chart are unaffected either way: those
 * are palette ids too (see ./custom-charts), so a preset change re-hues them
 * rather than orphaning them.
 */

import { z } from "zod";

/** `app_settings.key` under which the palette preference is stored. */
export const CHART_PALETTE_KEY = "chartPalette";

/**
 * The palettes on offer. `categorical` is what the app ships with; the rest are
 * authored in `apps/web/src/app.css` as `[data-palette="…"]` overrides.
 */
// The list the web app mirrors — it cannot import from this package — and the
// one the schema's own cases enumerate.
// fallow-ignore-next-line unused-export -- consumed by the mirror test and the schema cases
export const PALETTE_PRESETS = ["categorical", "colorblind", "vivid", "muted"] as const;
export const chartPaletteSchema = z.object({
  /**
   * `.catch()` and not just `.default()`: this list will change, and a stored
   * id that has since been retired must degrade to the shipped palette rather
   * than fail the parse. A failed parse here is silent — the shared settings
   * accessor falls back to the default with no log — so a whole object would
   * reset where only this field is stale.
   */
  preset: z.enum(PALETTE_PRESETS).catch("categorical").default("categorical"),
});
export type ChartPaletteConfig = z.infer<typeof chartPaletteSchema>;

/** What an instance that has never chosen renders in. */
export const defaultChartPalette: ChartPaletteConfig = chartPaletteSchema.parse({});
