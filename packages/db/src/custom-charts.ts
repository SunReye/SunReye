/**
 * Custom chart configuration — a named, multi-series chart the user composes on
 * the history page from any chartable metrics. Stored in the `custom_charts`
 * table (id + name columns, config in the `data` JSONB blob) and validated with
 * these schemas on write. Shared by the server (CRUD + metric-key validation)
 * and the web app (editor form + rendering), so the shape lives here.
 */

import { z } from "zod";

import { activeDevices } from "./plant-repo";

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
  /**
   * Which DEVICE each series is read from, keyed by metric key.
   *
   * A bare list of metric keys means "whichever device", which is the exact
   * ambiguity the retired `inverter_id` column had. On the multi-device plant
   * this release exists to enable that ambiguity is unresolvable — but right now,
   * with one inverter, it still has an answer, so the answer is recorded while
   * someone can still give it. No migration can go back and ask later.
   *
   * SLUGS, never the int2: this is a saved document, and `devices.slug` is the
   * API and export vocabulary precisely because the integer is a storage detail
   * that a restore or a re-add renumbers (see `./schema/plants.ts`).
   *
   * Keyed by metric key rather than by position for the reason `colors` is: a
   * chart whose metrics are reordered or thinned keeps the device on the right
   * series. The cost is that ONE metric on TWO devices is not expressible — see
   * {@link chartSeries}, which is where that limitation is pinned by a test.
   *
   * OPTIONAL, and absent means "nobody said", never "no device": every chart
   * saved before this field existed parses and renders exactly as it did, with
   * the plant's sole inverter supplied on read by {@link chartSeries}.
   */
  devices: z.record(z.string().min(1), z.string().min(1)).optional(),
});
export type CustomChartConfig = z.infer<typeof customChartConfigSchema>;

/** One resolved series of a saved chart: what to plot, and off which device. */
export interface ChartSeries {
  /** Canonical metric key (`ManifestMetric.key`). */
  metric: string;
  /**
   * `devices.slug` the series is read from, or null when the plant cannot say.
   *
   * Null rather than a guess: a chart with no stated device on a plant with two
   * inverters is genuinely ambiguous, and attributing it to whichever row sorted
   * lowest would put a wrong answer where an honest gap belongs. The read path
   * had no device to go on before this field existed either, so null is exactly
   * the behaviour it already handles.
   */
  device: string | null;
}

/**
 * A saved chart's series, each with its device resolved.
 *
 * The stated slug wins; otherwise `defaultDevice` — the plant's sole inverter
 * ({@link soleInverterSlug}) — which is what "whichever device" has always
 * silently meant on a single-inverter plant.
 *
 * A RESOLVER, not a normaliser: the config is returned untouched, because the
 * caller writes it back on the next save and a resolved default persisted into
 * the document would freeze today's inference as tomorrow's stated fact — which
 * is how a chart comes to claim a device the operator never chose.
 */
export function chartSeries(
  config: CustomChartConfig,
  defaultDevice: string | null,
): ChartSeries[] {
  return config.metrics.map((metric) => ({
    metric,
    device: config.devices?.[metric] ?? defaultDevice,
  }));
}

/** The role whose devices a chart series is read from. */
const INVERTER_ROLE = "inverter";

/**
 * The slug every unqualified series belongs to, or null when there is no single
 * answer.
 *
 * SOLE, not first. Two inverters and there is nothing to default to: picking one
 * would attach every old chart to whichever row happened to sort lowest, which
 * is a wrong answer wearing the confidence of a stored one. Zero inverters —
 * an onboarding-only boot, or a plant of meters and chargers — is the same
 * "cannot say".
 *
 * Retired devices are not candidates ({@link activeDevices}): retirement is
 * about the future, so a replaced inverter's history stays readable while a
 * chart saved today means the machine that is running. Counting it would leave
 * the plant permanently ambiguous after every inverter swap.
 */
export function soleInverterSlug(
  devices: readonly { slug: string; role: string; retiredAt: Date | null }[],
): string | null {
  const inverters = activeDevices(devices).filter((d) => d.role === INVERTER_ROLE);
  return inverters.length === 1 ? (inverters[0]?.slug ?? null) : null;
}

/** Payload accepted by create/update endpoints (name + config). */
export const customChartInputSchema = customChartConfigSchema.extend({
  name: z.string().trim().min(1).max(120),
});
export type CustomChartInput = z.infer<typeof customChartInputSchema>;

/** A custom chart as returned by the API (row flattened, timestamps as ISO). */
export interface CustomChart extends CustomChartConfig {
  id: string;
  name: string;
  /**
   * `metrics` with each series' device RESOLVED — derived on read, never stored.
   *
   * Read-only, and deliberately not part of `customChartInputSchema`: a client
   * that echoes it back has it stripped, because persisting a resolved default
   * would record "the plant had one inverter when this was last saved" as "the
   * operator chose this inverter". `devices` is the stated half; this is the
   * answer for today.
   */
  series: ChartSeries[];
  createdAt: string;
  updatedAt: string;
}
