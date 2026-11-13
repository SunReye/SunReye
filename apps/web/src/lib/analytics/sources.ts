// What a detail sheet's range analytics read (ADR 21): the series its overview charts, the power
// its heat grid reads per hour, and whether its strings compare. Pure.
import type { PvString } from "../api/core.ts";
import { PLANT } from "../dashboard/day.ts";

export interface Analytics {
  readonly device: number;
  readonly series: string;
  /** The series whose hourly energy the heat grid shows; null for a power that runs both ways. */
  readonly heat: string | null;
  /** The layout's strings are compared. */
  readonly compare: boolean;
  /** The inverters whose `pv.power` forecasts add up to what the figure expects; none for most. */
  readonly forecast: readonly number[];
}

const PLANT_SERIES = new Map<string, [string, Analytics["heat"]]>([
  ["production", ["pv.power", "pv.power"]],
  ["pv", ["pv.power", "pv.power"]],
  ["inverter", ["pv.power", "pv.power"]],
  ["consumption", ["load.power", "load.power"]],
  ["house", ["load.power", "load.power"]],
  ["purchase", ["grid.power", "grid.import.power"]],
  ["grid", ["grid.power", "grid.import.power"]],
  ["feedIn", ["grid.power", "grid.export.power"]],
  ["battery", ["battery.power", null]],
  ["generator", ["generator.power", "generator.power"]],
]);

/** PV figures compare their strings, when there are several. */
const PV = new Set(["production", "pv", "inverter"]);

/** The figures that overlay the plant's PV forecast. */
const FORECAST = new Set(["production", "pv"]);

/** The analytics of figure `id`; null for one without a series in history. */
export function analyticsOf(id: string, strings: readonly Readonly<PvString>[]): Analytics | null {
  const several = strings.length > 1;
  const string = /^string-(\d+)$/u.exec(id);

  if (string) {
    const s = strings.find((x: Readonly<PvString>) => x.id === Number(string[1]));

    return s
      ? {
          device: s.device,
          series: `pv.string.power[${s.id}]`,
          heat: `pv.string.power[${s.id}]`,
          compare: several,
          forecast: [],
        }
      : null;
  }

  const plant = PLANT_SERIES.get(id);

  if (!plant) return null;

  return {
    device: PLANT,
    series: plant[0],
    heat: plant[1],
    compare: several && PV.has(id),
    forecast: FORECAST.has(id) ? [...new Set(strings.map((s) => s.device))] : [],
  };
}
