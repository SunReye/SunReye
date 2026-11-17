// What a detail sheet's range analytics read (ADR 21): the series its overview charts, the power
// its heat grid reads per hour, and whether its strings compare. Pure.
import { PLANT, type PvString } from "../api/core.ts";
import { parseFigure } from "../detail/figures.ts";
import { m } from "../paraglide/messages.js";

export interface Analytics {
  readonly device: number;
  readonly series: string;
  /** The series whose hourly energy the heat grid shows; null for none. */
  readonly heat: string | null;
  /** The series whose energy over the range heads the sheet; null where one figure cannot. */
  readonly energy: string | null;
  /** The way the heat and the energy read, where the figure's name does not say it; else null. */
  readonly way: string | null;
  /** The layout's strings are compared. */
  readonly compare: boolean;
  /** The inverters whose forecasts of `series` add up to what the figure expects; none for most. */
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
  ["battery", ["battery.power", "battery.discharge.power", "battery.discharge.power"]],
  ["generator", ["generator.power", "generator.power", "generator.power"]],
]);

/** The figures whose heat and energy read one way of a power that runs both. */
const WAYS = new Map([["battery", m.side_discharged]]);

/** PV figures compare their strings, when there are several. */
const PV = new Set(["production", "pv", "inverter"]);

/** The figures that overlay the plant's PV forecast. */
const FORECAST = new Set(["production", "pv", "inverter"]);

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
          way: null,
          compare: several,
          // Stored under its inverter, beside its history (ADR 17).
          forecast: [s.device],
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
    way: WAYS.get(id)?.() ?? null,
    compare: several && PV.has(id),
    forecast: FORECAST.has(id) ? [...new Set(strings.map((s) => s.device))] : [],
  };
}
