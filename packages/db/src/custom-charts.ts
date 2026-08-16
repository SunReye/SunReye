/**
 * Custom chart configuration — a named, multi-series chart the user composes on
 * the history page from any chartable metrics. Stored in the `custom_charts`
 * table (id + name columns, config in the `data` JSONB blob) and validated with
 * these schemas on write. Shared by the server (CRUD + metric-key validation)
 * and the web app (editor form + rendering), so the shape lives here.
 */

import { z } from "zod";

/**
 * How many metrics one chart may overlay (bounded to keep charts legible).
 * Enforced here on write; the editor form mirrors the value locally (see
 * `apps/web/src/lib/inverter/custom-charts.svelte.ts`) because the web app
 * can't import from this package.
 */
const MAX_CHART_METRICS = 8;

/**
 * Palette ids a series may be pinned to.
 *
 * An id, never a colour: a pinned value round-trips through here into a `style`
 * attribute and into SVG fill/stroke in the browser, so accepting an arbitrary
 * string would accept CSS. The theme owns what each id looks like on each
 * surface. Mirrored in `apps/web/src/lib/inverter/chart-palette.ts` — the web
 * app cannot import from this package — with a test comparing the two lists.
 */
const SERIES_COLORS = [
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "chart-6",
  "chart-7",
  "chart-8",
] as const;

/**
 * The `data` JSONB blob: the config that isn't already a column. Render style
 * (area/line) is a global view toggle on the history page, not a per-chart
 * property, so it is deliberately not persisted here.
 */
export const customChartConfigSchema = z.object({
  /** Canonical metric keys (`ManifestMetric.key`) plotted together. */
  metrics: z.array(z.string().min(1)).min(1).max(MAX_CHART_METRICS),
  /**
   * Per-series colour overrides, keyed by metric key rather than by position:
   * a chart whose metrics are reordered or thinned keeps the colours the user
   * chose, where an array aligned by index would silently shift them onto the
   * wrong series. Absent, and absent keys, fall back to the palette order.
   */
  colors: z.record(z.string().min(1), z.enum(SERIES_COLORS)).optional(),
});
export type CustomChartConfig = z.infer<typeof customChartConfigSchema>;

/** Payload accepted by create/update endpoints (name + config). */
export const customChartInputSchema = customChartConfigSchema.extend({
  name: z.string().trim().min(1).max(120),
});
export type CustomChartInput = z.infer<typeof customChartInputSchema>;

/** A custom chart as returned by the API (row flattened, timestamps as ISO). */
export interface CustomChart extends CustomChartConfig {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}
