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
  /**
   * Which DEVICE each series is read from, by `devices.slug`, keyed by metric
   * key. Absent means nobody said, and the server resolves it on read.
   *
   * No editor names these yet; the editor carries them through a save. A bare
   * metric list means "whichever device", which stops having an answer the day a
   * second inverter exists — so what the operator meant is recorded while it can
   * still be known.
   */
  devices?: Record<string, string>;
  /**
   * `metrics` with each series' device resolved by the server (stated slug, else
   * the plant's sole inverter; null when it cannot say).
   *
   * READ-ONLY and derived per response — never sent back. Persisting it would
   * turn "the plant had one inverter when this was saved" into "the operator
   * chose this inverter".
   */
  series?: { metric: string; device: string | null }[];
  createdAt: string;
  updatedAt: string;
}
