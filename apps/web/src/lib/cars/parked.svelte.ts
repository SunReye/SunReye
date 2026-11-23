// The cars parked now: each place's car as the live stream last read it (#831).
import type { CarPlace, Geometry } from "@sunreye/builder/builder/pv.ts";
import { stream } from "../live/stream.svelte.ts";
import { parked, type Parked } from "@sunreye/builder/cars/parked.ts";

/** The cars at `places` on `stands` now; read in a derived, it follows the stream. */
export function parkedNow(places: readonly CarPlace[], stands: Geometry["stands"]): Parked[] {
  return parked(places, stands, stream.values?.devices ?? {});
}
