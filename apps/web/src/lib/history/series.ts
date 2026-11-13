// The statistics charts' series, groups and labels: words and energy colours (ADR 21).
import { flowColour } from "../energy-colours.ts";
import { m } from "../paraglide/messages.js";
import type { SeriesMeta } from "../range/bands.ts";
import { kwh, money, num } from "../range/format.ts";
import type { Metric } from "./view.ts";

export interface Series {
  readonly up: SeriesMeta[];
  readonly down: SeriesMeta[];
  readonly groups: [string, string];
  readonly label: string;
}

/** Above zero production or the house load's sources; below it the house load, for energy. */
export function flowSeries(energy: boolean, battery: boolean): Series {
  if (!energy)
    return {
      up: [
        { label: m.stats_from_pv(), colour: flowColour("solar") },
        ...(battery ? [{ label: m.stats_from_battery(), colour: flowColour("battery") }] : []),
        { label: m.stats_from_grid(), colour: flowColour("import") },
      ],
      down: [],
      groups: ["", ""],
      label: m.stats_chart_autarky(),
    };

  return {
    up: [
      { label: m.stats_self_used(), colour: flowColour("solar") },
      { label: m.stats_fed_in(), colour: flowColour("export") },
    ],
    down: [
      { label: m.stats_self_covered(), colour: flowColour("house") },
      { label: m.stats_bought(), colour: flowColour("import") },
    ],
    groups: [m.stats_production(), m.stats_consumption()],
    label: m.stats_chart_energy(),
  };
}

/** Savings above zero, costs below. */
export function costSeries(): Series {
  return {
    up: [
      { label: m.stats_avoided(), colour: flowColour("solar") },
      { label: m.stats_feed_in_pay(), colour: flowColour("export") },
    ],
    down: [{ label: m.stats_import_cost(), colour: flowColour("import") }],
    groups: [m.stats_savings(), m.stats_costs()],
    label: m.stats_chart_money(),
  };
}

/** The measured production, beside its forecast. */
export function measuredSeries(): SeriesMeta[] {
  return [{ label: m.stats_measured(), colour: flowColour("solar") }];
}

/** The years chart's one series for a metric. */
export function yearSeries(metric: Metric) {
  if (metric === "money")
    return {
      name: m.stats_savings(),
      colour: flowColour("solar"),
      fmt: money,
      unit: "€",
      max: undefined,
    };

  if (metric === "autarky")
    return {
      name: m.stats_autarky(),
      colour: flowColour("battery"),
      fmt: (v: number) => `${num(v)} %`,
      unit: "%",
      max: 100,
    };

  return {
    name: m.stats_production(),
    colour: flowColour("solar"),
    fmt: kwh,
    unit: "kWh",
    max: undefined,
  };
}
