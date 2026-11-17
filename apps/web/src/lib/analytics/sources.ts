// What a detail sheet's range analytics read (ADR 21): the series its overview charts, the power
// its heat grid reads per hour, and whether its strings compare. Pure.
import { PLANT, type PvString } from "../api/core.ts";
import { parseFigure } from "../detail/figures.ts";

export interface Analytics {
  readonly device: number;
  readonly series: string;
  /** The series whose hourly energy the heat grid shows; null for a power that runs both ways. */
  readonly heat: string | null;
  /** The series whose energy over the range heads the sheet; null where one figure cannot. */
  readonly energy: string | null;
  /** The layout's strings are compared. */
  readonly compare: boolean;
  /** The inverters whose `pv.power` forecasts add up to what the figure expects; none for most. */
  readonly forecast: readonly number[];
}

/** Each plant figure's series, heat and energy. */
const PLANT_SERIES = new Map<string, [string, Analytics["heat"], Analytics["energy"]]>([
  ["production", ["pv.power", "pv.power", "pv.power"]],
  ["pv", ["pv.power", "pv.power", "pv.power"]],
  ["inverter", ["pv.power", "pv.power", "pv.power"]],
  ["consumption", ["load.power", "load.power", "load.power"]],
  ["house", ["load.power", "load.power", "load.power"]],
  ["purchase", ["grid.power", "grid.import.power", "grid.import.power"]],
  ["grid", ["grid.power", "grid.import.power", null]],
  ["feedIn", ["grid.power", "grid.export.power", "grid.export.power"]],
  ["battery", ["battery.power", null, null]],
  ["generator", ["generator.power", "generator.power", "generator.power"]],
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
          heat: `pv.string.power[${s.id}]`,
          energy: `pv.string.power[${s.id}]`,
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
    energy: plant[2],
    compare: several && PV.has(id),
    forecast: FORECAST.has(id) ? [...new Set(strings.map((s) => s.device))] : [],
  };
}
