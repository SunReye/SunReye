// Which cars the scene draws (ADR 20): one per car place whose loadpoint reports a connected
// vehicle, in the body its catalogue entry, else the admin's pick, names. Pure: no three.js.
import type { Values } from "../api/core.ts";
import type { BodyClass, CarPlace, Geometry, Point } from "../builder/pv.ts";
import { catalogue } from "./catalogue.ts";

/** What neither the catalogue nor the admin picked. */
const PLAIN = { class: "sedan", colour: "#8a8f98" } as const;

export interface Parked {
  readonly device: number;
  readonly at: Point;
  readonly forward: Point;
  readonly above: Point;
  readonly length: number;
  readonly width: number;
  readonly body: { readonly class: BodyClass; readonly colour: string };
  /** An uploaded body's id, drawn in place of `body` once loaded. */
  readonly model: string | null;
  readonly watts: number | null;
  readonly soc: number | null;
}

/** The catalogue entry the vehicle's title names, else the admin's pick. */
function body(place: CarPlace, model: number | undefined): Parked["body"] {
  const entry = catalogue.find(({ id }) => id === model);

  return entry === undefined ? (place.body ?? PLAIN) : { class: entry.class, colour: entry.colour };
}

type Stand = NonNullable<Geometry["stands"]>[number];

/** The car at `place`, with its loadpoint's live values. */
function car(place: CarPlace, stand: Stand, live: Readonly<Record<string, number>>): Parked {
  return {
    ...stand,
    device: place.device,
    length: place.length,
    width: place.width,
    body: body(place, live["ev.vehicle.model"]),
    model: place.model ?? null,
    watts: live["ev.charge.power"] ?? null,
    soc: live["ev.vehicle.soc"] ?? null,
  };
}

export function parked(
  places: readonly CarPlace[],
  stands: Geometry["stands"],
  values: Values["devices"],
): Parked[] {
  return places.flatMap((place, i): Parked[] => {
    const stand = stands?.[i];
    const live = values[String(place.device)] ?? {};

    return stand === undefined || live["ev.connected"] !== 1 ? [] : [car(place, stand, live)];
  });
}
