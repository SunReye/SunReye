/**
 * The two decisions the custom-chart editor makes about colours: which pinned
 * colours to take INTO the form when it opens, and which to send back out when
 * it saves.
 *
 * Both are about a record that outlives the metric list it describes — a chart
 * whose colours were pinned before a metric was removed, or before the palette
 * changed under it — so both are the sort of thing that is wrong silently. They
 * live here rather than in the dialog because a `.svelte` file cannot be
 * exercised under `bun test`.
 */

import { isSeriesColor, type SeriesColor } from "./chart-palette";
import type { CustomChart } from "./custom-chart";

/** What the editor sends to create/update. */
export interface CustomChartFormInput {
  name: string;
  metrics: string[];
  colors?: Record<string, SeriesColor>;
  /**
   * Per-series device slugs, keyed by metric key — CARRIED, never edited here.
   *
   * There is no device picker in this editor, so the only thing it can do to
   * them is lose them: it read-modify-writes the whole chart, and a payload
   * omitting this key erases the slugs on any unrelated edit. Losing them is
   * unrecoverable — on a two-inverter plant nobody can say afterwards which one
   * an old chart meant, which is the entire reason the field exists.
   */
  devices?: Record<string, string>;
}

/**
 * The pinned colours to prefill the form with.
 *
 * Filtered to ids the palette still names: a chart saved against an older
 * palette, or a hand-edited blob, would otherwise put a value into the form
 * that the server rejects on save — after the user had already changed
 * something else.
 */
export function pinnedColors(chart: CustomChart | null): Record<string, SeriesColor> {
  const out: Record<string, SeriesColor> = {};
  for (const [key, value] of Object.entries(chart?.colors ?? {})) {
    if (isSeriesColor(value)) out[key] = value;
  }
  return out;
}

/**
 * The payload for a save.
 *
 * Colours are pruned to the metrics the chart still draws — a metric taken off
 * would otherwise leave its colour in the record for good, and get it back if
 * it were ever re-added, which reads as the editor remembering something the
 * user does not. The key is omitted entirely when nothing is pinned, so the
 * common chart persists no colour at all and follows the palette if it changes.
 */
export function chartFormInput(
  name: string,
  metrics: readonly string[],
  colors: Readonly<Record<string, SeriesColor>>,
  devices: Readonly<Record<string, string>> = {},
): CustomChartFormInput {
  const pinned: Record<string, SeriesColor> = {};
  const named: Record<string, string> = {};
  for (const key of metrics) {
    const color = colors[key];
    if (color) pinned[key] = color;
    // Pruned to the metrics still drawn and COPIED key by key, for both of the
    // colour record's reasons: a slug left behind returns the day the metric is
    // re-added, and the caller's map is live state the editor keeps mutating.
    const device = devices[key];
    if (device) named[key] = device;
  }
  const input: CustomChartFormInput = { name: name.trim(), metrics: [...metrics] };
  if (Object.keys(pinned).length > 0) input.colors = pinned;
  if (Object.keys(named).length > 0) input.devices = named;
  return input;
}
