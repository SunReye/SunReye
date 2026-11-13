// What the 2D power flow reads (ADR 21): the `plant` device's roles (ADR 14), the loadpoints' `ev`
// roles (ADR 10) and the layout's strings, signs per ADR 4. Pure.
import type { Live, PvString, Values } from "../api/core.ts";
import { PLANT } from "../live/labels.ts";
import { formatFigure } from "../detail/figures.ts";

/** The layout's strings, as far as the flow needs them. */
export type FlowStrings = readonly Readonly<Pick<PvString, "id" | "name" | "device">>[];

/** What the plant reports right now, in watts. A missing field is a role the plant does not have. */
export interface FlowReading {
  readonly strings: readonly {
    readonly id: string;
    readonly label: string;
    readonly watts: number;
    readonly estimated: boolean;
  }[];
  /** Total DC in; the aggregate PV node shows it when the strings do not fit. */
  readonly pvTotal?: number | undefined;
  /** ADR 4: positive charging. */
  readonly battery?: number | undefined;
  readonly batterySoc?: number | undefined;
  /** ADR 4: positive importing. */
  readonly grid?: number | undefined;
  /** House consumption, EV draw included (ADR 14). */
  readonly load?: number | undefined;
  readonly generator?: number | undefined;
  readonly charger?: ChargerDatum | undefined;
}

export type ChargerDatum = {
  readonly power: number;
  readonly connected: boolean;
  readonly charging: boolean;
  /** The vehicle's, when one loadpoint reports it. */
  readonly soc: number | undefined;
};

/** The plant's flow reading from the live values, the layout's strings and the estimated series. */
export function flowReading(
  values: Values["devices"],
  strings: FlowStrings,
  estimated: Readonly<Record<string, readonly string[] | undefined>>,
): FlowReading {
  const plant = values[PLANT] ?? {};

  return {
    strings: strings.flatMap((s) => {
      const series = `pv.string.power[${s.id}]`;
      const watts = values[String(s.device)]?.[series];

      return watts === undefined
        ? []
        : [
            {
              id: formatFigure({ kind: "string", id: s.id }),
              label: s.name,
              watts,
              estimated: estimated[String(s.device)]?.includes(series) ?? false,
            },
          ];
    }),
    pvTotal: plant["pv.power"],
    battery: plant["battery.power"],
    batterySoc: plant["battery.soc"],
    grid: plant["grid.power"],
    load: plant["load.power"],
    generator: plant["generator.power"],
    charger: charger(values, plant["ev.charge.power"]),
  };
}

function charger(values: Values["devices"], power: number | undefined): ChargerDatum | undefined {
  if (power === undefined) return undefined;

  const loadpoints = devices(values).filter((series) => "ev.charge.power" in series);

  return {
    power,
    connected: loadpoints.some((lp) => lp["ev.connected"] === 1),
    charging: loadpoints.some((lp) => lp["ev.charging"] === 1),
    soc: loadpoints.length === 1 ? loadpoints[0]?.["ev.vehicle.soc"] : undefined,
  };
}

/** Every device's values but the plant's. */
function devices(values: Values["devices"]): Readonly<Record<string, number>>[] {
  return Object.keys(values).flatMap((id) => (id === PLANT ? [] : [values[id] ?? {}]));
}

/** In watts and percent; efficiency and own use only while power goes through the inverter. */
export interface Hub {
  readonly dc: number | undefined;
  readonly efficiency: number | undefined;
  readonly own: number | undefined;
}

/**
 * The hub's figures: DC in, and the inverter's efficiency and own use as its profile computes them
 * (ADR 4). A ratio has no plant total, so they show only while one inverter reports them.
 */
export function hubMetrics(values: Values["devices"]): Hub {
  const dc = values[PLANT]?.["pv.power"];
  const inverters = devices(values).filter((series) => "inverter.efficiency" in series);
  const efficiency = inverters.length === 1 ? inverters[0]?.["inverter.efficiency"] : undefined;

  // The profile's ratio reads 0 while nothing goes in.
  if (efficiency === undefined || efficiency <= 0)
    return { dc, efficiency: undefined, own: undefined };

  return { dc, efficiency, own: inverters[0]?.["inverter.loss.power"] };
}

/** Whether the stream is lost or any of the plant's values is past its gap threshold (ADR 3). */
export function stalled(live: Live | undefined): boolean {
  if (live === undefined || !("devices" in live)) return false;

  return live.lost !== undefined || Object.keys(live.stale?.[PLANT] ?? {}).length > 0;
}
