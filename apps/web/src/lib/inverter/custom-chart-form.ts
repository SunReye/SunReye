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
): CustomChartFormInput {
  const pinned: Record<string, SeriesColor> = {};
  for (const key of metrics) {
    const color = colors[key];
    if (color) pinned[key] = color;
  }
  const input: CustomChartFormInput = { name: name.trim(), metrics: [...metrics] };
  if (Object.keys(pinned).length > 0) input.colors = pinned;
  return input;
}
