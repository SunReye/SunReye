// What the string comparison reads from the core: each string's energy in a range, its module
// types' peak power and each MPPT input's learned correction.
import { answerOf, settleRead, type Settled } from "../api/client.ts";
import type { Core, PvString } from "../api/core.ts";
import { bandFigure, periodOf, rollups } from "../history/history.ts";
import { dayOf, fmt } from "../range/calendar.ts";
import type { Place } from "../range/range-data.svelte.ts";
import { hourInstant, t0Of, t1Of, type Range } from "../range/range.ts";
import type { InputCorrection } from "./strings.ts";

export type { PvString };

/** What the strings comparison reads. */
export type StringsCore = Readonly<Pick<Core, "statistics" | "moduleTypes" | "corrections">>;

/** Each string's energy in kWh from the range's start to its end or now, by string id. */
export async function stringEnergy(
  core: Readonly<Pick<Core, "statistics">>,
  strings: readonly Readonly<PvString>[],
  place: Place,
  r: Range,
): Promise<Map<number, number>> {
  const from = hourInstant(place.zone, t0Of(r));
  const to = new Date(Math.min(hourInstant(place.zone, t1Of(r)).getTime(), Date.now()));

  const read = async (s: Readonly<PvString>) => {
    const series = `pv.string.power[${s.id}]`;
    const points = from < to ? await rollups(core, s.device, series, periodOf(r), from, to) : [];

    return [s.id, bandFigure(series, points, from.getTime(), to.getTime()).value] as const;
  };

  return new Map(await Promise.all(strings.map((s) => read(s))));
}

/** Each module type's watts at standard test conditions; a refusal is thrown (`answerOf`). */
export async function modulePeaks(
  core: Readonly<Pick<Core, "moduleTypes">>,
): Promise<Map<number, number>> {
  const types = answerOf(await core.moduleTypes());

  return new Map(types.map((t: Readonly<(typeof types)[number]>) => [t.id, t.pmax]));
}

/** Each MPPT input's learned correction; a refusal is thrown (`answerOf`). */
export async function inputCorrections(
  core: Readonly<Pick<Core, "corrections">>,
): Promise<readonly InputCorrection[]> {
  return answerOf(await core.corrections()).inputs;
}

/** What every string's yield and ratio needs: the module types' peaks and the inputs' corrections. */
export type StringFacts = Settled<
  readonly [ReadonlyMap<number, number>, readonly InputCorrection[]]
>;

/** The module types' peaks and the inputs' corrections, settled together. */
export function stringFacts(
  core: Readonly<Pick<Core, "moduleTypes" | "corrections">>,
): Promise<StringFacts> {
  return settleRead(Promise.all([modulePeaks(core), inputCorrections(core)]));
}

/** The correction grid's columns: the twelve months. */
export const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const label = fmt("monthShort", dayOf(2025, i, 1)).replace(".", "");

  return { label, tick: true, title: label };
});
