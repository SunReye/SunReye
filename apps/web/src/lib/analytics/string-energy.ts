// What the string comparison reads from the core: each string's energy in a range, its module
// types' peak power and each MPPT input's learned correction.
import type { Core, PvString } from "../api/core.ts";
import { bandFigure, means } from "../history/history.ts";
import { dayOf, fmt } from "../range/calendar.ts";
import type { Place } from "../range/range-data.svelte.ts";
import { hourInstant, t0Of, t1Of, type Range } from "../range/range.ts";
import type { InputCorrection } from "./strings.ts";

/** Each string's energy in kWh from the range's start to its end or now, by string id. */
export async function stringEnergy(
  core: Readonly<Pick<Core, "history">>,
  strings: readonly Readonly<PvString>[],
  place: Place,
  r: Range,
): Promise<Map<number, number>> {
  const from = hourInstant(place.zone, t0Of(r));
  const to = new Date(Math.min(hourInstant(place.zone, t1Of(r)).getTime(), Date.now()));

  const read = async (s: Readonly<PvString>) => {
    const series = `pv.string.power[${s.id}]`;
    const points = from < to ? await means(core, s.device, series, from, to) : [];

    return [s.id, bandFigure(series, points, from.getTime(), to.getTime()).value] as const;
  };

  return new Map(await Promise.all(strings.map((s) => read(s))));
}

/** Each module type's watts at standard test conditions; none while they cannot be read. */
export async function modulePeaks(
  core: Readonly<Pick<Core, "moduleTypes">>,
): Promise<Map<number, number>> {
  const types = await core.moduleTypes();

  return new Map(
    "problem" in types ? [] : types.map((t: Readonly<(typeof types)[number]>) => [t.id, t.pmax]),
  );
}

/** Each MPPT input's learned correction; none while it cannot be read. */
export async function inputCorrections(
  core: Readonly<Pick<Core, "corrections">>,
): Promise<readonly InputCorrection[]> {
  const read = await core.corrections();

  return "inputs" in read ? read.inputs : [];
}

/** The correction grid's columns: the twelve months. */
export const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const label = fmt("monthShort", dayOf(2025, i, 1)).replace(".", "");

  return { label, tick: true, title: label };
});
