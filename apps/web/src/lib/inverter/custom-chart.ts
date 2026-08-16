/**
 * The custom-chart model: the shape a saved chart has, and how many metrics one
 * may overlay.
 *
 * Split from `custom-charts.svelte.ts` because that file is a rune store — it
 * reaches the network at import and cannot be loaded under `bun test`, so
 * anything that wants to be tested against the model (see
 * `chart-membership.ts`) could not have it there. The shape mirrors the
 * server's shared schema (@SunReye/db/custom-charts); duplicated here so the
 * web app does not pull in db/drizzle just for a type.
 */

/** How many metrics one chart may overlay (mirrors MAX_CHART_METRICS). */
export const MAX_CHART_METRICS = 8;

export interface CustomChart {
  id: string;
  name: string;
  metrics: string[];
  /** Per-series colour overrides, keyed by metric key. Absent keys take the
   *  palette entry for their position — see `chart-palette.ts`. */
  colors?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}
