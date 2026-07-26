// The chartable-metric picker view shared by the History page and the custom-chart
// editor: both narrow the live manifest to chartable metrics, then search + group
// them by category for a collapsible/checkbox list.
import { filterMetrics, groupByCategory, isChartable } from "$lib/inverter/ranges";
import type { ManifestMetric } from "$lib/inverter/types";

/** Metrics from the live manifest that can be plotted at all. */
export function chartableMetrics(metrics: ManifestMetric[]): ManifestMetric[] {
  return metrics.filter(isChartable);
}

/** `[category, metrics]` pairs for the metrics matching `search`. */
export function searchedGroups(
  metrics: ManifestMetric[],
  search: string,
): [string, ManifestMetric[]][] {
  return groupByCategory(filterMetrics(metrics, search));
}
