// Which cars the scene draws (ADR 20): one per car place whose loadpoint reports a connected
// vehicle, in the place's colour. Pure: no three.js.
import type { CarPlace, Geometry, Point } from "../builder/pv.ts";

/** The default body's paint without the admin's pick: Stealth Grey, quiet beside the energy colours. */
export const PLAIN = "#232528";

export interface Parked {
  readonly device: number;
  readonly at: Point;
  readonly forward: Point;
  readonly above: Point;
  readonly length: number;
  readonly width: number;
  /** The default body's paint, `#rrggbb`. */
  readonly colour: string;
  /** An uploaded body's id, drawn in place of the default once loaded. */
  readonly model: string | null;
  readonly watts: number | null;
  readonly soc: number | null;
}

type Stand = NonNullable<Geometry["stands"]>[number];

/** The car at `place`, with its loadpoint's live values. */
function car(place: CarPlace, stand: Stand, live: Readonly<Record<string, number>>): Parked {
  return {
    ...stand,
    device: place.device,
    length: place.length,
    width: place.width,
    colour: place.colour ?? PLAIN,
    model: place.model ?? null,
    watts: live["ev.charge.power"] ?? null,
    soc: live["ev.vehicle.soc"] ?? null,
  };
}

export function parked(
  places: readonly CarPlace[],
  stands: Geometry["stands"],
  /** Live values by device id, then by series name, as the core streams them. */
  values: Readonly<Record<string, Readonly<Record<string, number>>>>,
): Parked[] {
  return places.flatMap((place, i): Parked[] => {
    const stand = stands?.[i];
    const live = values[String(place.device)] ?? {};

    return stand === undefined || live["ev.connected"] !== 1 ? [] : [car(place, stand, live)];
  });
}
