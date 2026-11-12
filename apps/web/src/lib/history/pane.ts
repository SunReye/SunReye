// What every tab's pane is given, and which tabs chart the range.
import type { Core } from "../api/core.ts";
import type { HeatSource } from "../analytics/heat.ts";
import { PLANT } from "../dashboard/day.ts";
import { m } from "../paraglide/messages.js";
import type { RangeRoute } from "../range/route.svelte.ts";
import type { Facts } from "./facts.ts";
import type { Loaded } from "./stats.svelte.ts";
import type { Metric, Tab, StatsView } from "./view.ts";

export type PaneCore = Readonly<
  Pick<
    Core,
    | "history"
    | "costs"
    | "forecasts"
    | "tariff"
    | "moduleTypes"
    | "corrections"
    | "records"
    | "batteryCapacity"
  >
>;

export interface PaneProps {
  core: PaneCore;
  got: Loaded;
  view: StatsView;
  route: RangeRoute;
  facts: Facts | null;
  /** Recording began days ago. */
  fresh: boolean;
  loading: boolean;
  height: number;
  /** Opens another view of the screen; back returns. */
  onview: (patch: Readonly<Record<string, string | null>>) => void;
}

const CHARTS: ReadonlySet<Tab> = new Set<Tab>(["time", "years", "pattern", "forecast"]);

export const chartsRange = (tab: Tab): boolean => CHARTS.has(tab);

/** What the pattern counts per hour: production, or what autarky misses, the import. */
export function heatOf(metric: Metric): HeatSource & { name: string; colour: string } {
  if (metric === "autarky")
    return {
      device: PLANT,
      series: "grid.import.power",
      pick: (w) => w,
      name: m.stats_pattern_grid(),
      colour: "var(--e-import)",
    };

  return {
    device: PLANT,
    series: "pv.power",
    pick: (w) => w,
    name: m.stats_pattern_pv(),
    colour: "var(--e-solar)",
  };
}
