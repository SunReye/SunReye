// What a detail sheet's range analytics read (ADR 21): the series its overview charts, the power
// its heat grid counts per hour, and whether its strings compare. Pure.
import type { PvString } from "../api/core.ts";
import { PLANT } from "../dashboard/day.ts";
import { parseFigure } from "../detail/figures.ts";

export interface Analytics {
  readonly device: number;
  readonly series: string;
  /** The power an hour's heat counts from a mean in W; null for a power that runs both ways. */
  readonly heat: ((watts: number) => number) | null;
  /** The layout's strings are compared. */
  readonly compare: boolean;
  /** The inverters whose `pv.power` forecasts add up to what the figure expects; none for most. */
  readonly forecast: readonly number[];
}

const all = (w: number): number => w;
const imported = (w: number): number => Math.max(0, w);
const exported = (w: number): number => Math.max(0, -w);

const PLANT_SERIES = new Map<string, [string, Analytics["heat"]]>([
  ["production", ["pv.power", all]],
  ["pv", ["pv.power", all]],
  ["inverter", ["pv.power", all]],
  ["consumption", ["load.power", all]],
  ["house", ["load.power", all]],
  ["purchase", ["grid.power", imported]],
  ["grid", ["grid.power", imported]],
  ["feedIn", ["grid.power", exported]],
  ["battery", ["battery.power", null]],
  ["generator", ["generator.power", all]],
]);

/** PV figures compare their strings, when there are several. */
const PV = new Set(["production", "pv", "inverter"]);

/** The figures that overlay the plant's PV forecast. */
const FORECAST = new Set(["production", "pv"]);

/** The analytics of figure `id`; null for one without a series in history. */
export function analyticsOf(id: string, strings: readonly Readonly<PvString>[]): Analytics | null {
  const several = strings.length > 1;
  const ref = parseFigure(id);

  if (ref?.kind === "string") {
    const s = strings.find((x: Readonly<PvString>) => x.id === ref.id);

    return s
      ? {
          device: s.device,
          series: `pv.string.power[${s.id}]`,
          heat: all,
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
