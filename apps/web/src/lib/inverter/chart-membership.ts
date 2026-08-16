/**
 * "Add this metric to a chart", as data.
 *
 * Every card on /history offers a menu of the saved custom charts, so the
 * questions are always the same three: is this metric already on that chart,
 * has that chart room for another, and what does the metric list become when
 * the row is picked. The menu component renders what this returns and hands the
 * result to the store; nothing here knows about the network or the DOM.
 */

import { MAX_CHART_METRICS, type CustomChart } from "./custom-chart";

/** One row of the menu. */
export interface MembershipItem {
  id: string;
  name: string;
  /** The chart already draws this metric — picking the row takes it off. */
  holds: boolean;
  /** At the overlay limit, so this metric cannot be added to it. */
  full: boolean;
}

/** The saved charts as menu rows for one metric, in the store's own order. */
export function membership(charts: readonly CustomChart[], key: string): MembershipItem[] {
  return charts.map((chart) => {
    const holds = chart.metrics.includes(key);
    return {
      id: chart.id,
      name: chart.name,
      holds,
      // Removing is always allowed: a chart at its limit that already holds the
      // metric must not read as full, or the only way back off it is disabled.
      full: !holds && chart.metrics.length >= MAX_CHART_METRICS,
    };
  });
}

/**
 * The chart's metric list after toggling this metric, or `null` when adding
 * would take it past the overlay limit.
 *
 * Appends rather than prepends: series colour is assigned by position, so a new
 * metric at the front would recolour everything already on the chart. Removal
 * drops every copy — the list is stored as the client sends it, and a duplicate
 * left behind would keep the row reading as "on" after a toggle.
 *
 * An empty result is returned as such. The server rejects a chart with no
 * metrics, and deciding what that means — refuse, or delete the chart — is
 * {@link plannedUpdate}'s call, not this one's.
 *
 * Module-private: {@link plannedUpdate} is the whole surface, so a caller
 * cannot reach past the three "send nothing" cases it answers for.
 */
function withMetric(chart: CustomChart, key: string): string[] | null {
  if (chart.metrics.includes(key)) return chart.metrics.filter((metric) => metric !== key);
  if (chart.metrics.length >= MAX_CHART_METRICS) return null;
  return [...chart.metrics, key];
}

/** A chart update ready to send: the chart's id and the payload it takes. */
export interface PlannedUpdate {
  id: string;
  input: { name: string; metrics: string[] };
}

/**
 * What picking a chart's row in the menu should send, or `null` when it should
 * send nothing.
 *
 * Three ways to reach `null`, and each of them is a decision rather than a
 * defensive check:
 *
 * - the chart is gone (another tab deleted it between render and click);
 * - adding would pass the overlay limit — the row is disabled, so this is only
 *   reachable if the chart grew elsewhere meanwhile;
 * - the toggle would leave the chart with no metrics. The server rejects that,
 *   and silently deleting the user's chart because they took its last series
 *   off is a worse answer than leaving it alone. Emptying a chart is what the
 *   editor is for.
 */
export function plannedUpdate(
  charts: readonly CustomChart[],
  id: string,
  key: string,
): PlannedUpdate | null {
  const chart = charts.find((candidate) => candidate.id === id);
  if (!chart) return null;
  const metrics = withMetric(chart, key);
  if (!metrics || metrics.length === 0) return null;
  return { id: chart.id, input: { name: chart.name, metrics } };
}
