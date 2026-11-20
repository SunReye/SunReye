// fallow-ignore-file coverage-gaps -- reads a live core; run by hand with `bun run bench`.
// The plant the screens are opened on (ADR 24), read from the core once signed in.

import type { Core } from "./http.ts";
import type { Plant, PvString } from "./reads.ts";

/** The plant timezone `/timezone` answers. */
function zoneOf(text: string): string {
  const zone: unknown = JSON.parse(text);

  if (!(zone instanceof Object) || !("name" in zone)) throw new TypeError("/timezone has no name");

  return String(zone.name);
}

function isListed(value: unknown): value is { readonly id: unknown; readonly device: unknown } {
  return value instanceof Object && "id" in value && "device" in value;
}

/** The strings `/layout` answers, each on its inverter. */
function stringsOf(text: string): PvString[] {
  const layout: unknown = JSON.parse(text);

  if (!(layout instanceof Object) || !("strings" in layout) || !Array.isArray(layout.strings))
    throw new TypeError("/layout has no strings");

  const strings: PvString[] = [];

  for (const listed of layout.strings)
    if (isListed(listed)) strings.push({ id: Number(listed.id), device: Number(listed.device) });

  return strings;
}

/** 18:00 on the last whole plant-local day in `zone` before `end`, in ms since 1970. */
export function openingMoment(end: number, zone: string): number {
  const last = Temporal.Instant.fromEpochMilliseconds(end - 1)
    .toZonedDateTimeISO(zone)
    .startOfDay();

  const whole = last.add({ days: 1 }).epochMilliseconds === end ? last : last.subtract({ days: 1 });

  return whole.with({ hour: 18 }).epochMilliseconds;
}

/**
 * The plant the screens open on, `end` being where the file's data stops. The wall clock is past
 * it, where every day is empty.
 */
export async function plantAt(core: Core, end: number): Promise<Plant> {
  const zone = zoneOf(await core.get("/api/v1/timezone"));
  const strings = stringsOf(await core.get("/api/v1/layout"));

  return {
    zone,
    now: openingMoment(end, zone),
    inverters: [...new Set(strings.map((s) => s.device))],
    strings,
  };
}
