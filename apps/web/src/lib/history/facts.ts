// What the statistics screen reads once, whatever the range: the strings, whether the plant has a
// battery or an EV, the first day it recorded, and payback (admin only, ADR 12).
import { PLANT, type Core, type PvString } from "../api/core.ts";
import type { Payback } from "../api/tariff.ts";
import { inputCorrections, modulePeaks } from "../analytics/string-energy.ts";
import type { InputCorrection } from "../analytics/strings.ts";
import { layoutStrings } from "../live/plant-facts.ts";
import { dayOfIso } from "../range/calendar.ts";
import { hourInstant } from "../range/range.ts";

export type FactsCore = Readonly<
  Pick<
    Core,
    "layout" | "capabilities" | "statistics" | "records" | "payback" | "corrections" | "moduleTypes"
  >
>;

export interface Facts {
  readonly strings: readonly PvString[];
  readonly battery: boolean;
  readonly ev: boolean;
  /** The first plant-local day with rolled-up history; null before the first is rolled up. */
  readonly since: number | null;
  /** Null for a viewer. */
  readonly payback: Payback | null;
  /** Each MPPT input's learned correction, which flags a weak string. */
  readonly corrections: readonly InputCorrection[];
  /** Each module type's watts at standard test conditions. */
  readonly peaks: ReadonlyMap<number, number>;
}

/** Every registered device's published series: the core lists no computed device (ADR 9). */
async function series(core: FactsCore): Promise<readonly string[]> {
  const caps = await core.capabilities();

  return "devices" in caps ? Object.values(caps.devices).flatMap((d) => d.series) : [];
}

/**
 * The first day of the oldest recorded year. A year is read with a day's margin at each end, for
 * the plant's offset from UTC, which stays under the core's longest range (ADR 9).
 */
async function since(core: FactsCore): Promise<number | null> {
  const records = await core.records();
  const year = "years" in records ? records.years.at(-1)?.year : undefined;

  if (year === undefined) return null;

  const read = await core.statistics(
    PLANT,
    "load.power",
    "day",
    new Date(Date.UTC(year - 1, 11, 31)),
    new Date(Date.UTC(year + 1, 0, 2)),
  );

  const first = "points" in read ? read.points[0] : undefined;

  return first ? dayOfIso(first.date) : null;
}

/** When the record began, in ms since the epoch; 0 while it is not known. */
export function begunOf(facts: Readonly<Pick<Facts, "since">> | null, zone: string): number {
  const since = facts?.since ?? null;

  return since === null ? 0 : hourInstant(zone, since * 24).getTime();
}

export async function readFacts(core: FactsCore): Promise<Facts> {
  const [strings, published, first, payback, corrections, peaks] = await Promise.all([
    layoutStrings(core),
    series(core),
    since(core),
    core.payback(),
    inputCorrections(core),
    modulePeaks(core),
  ]);

  return {
    strings,
    battery: published.includes("battery.power"),
    ev: published.includes("ev.charge.power"),
    since: first,
    payback: "problem" in payback ? null : payback,
    corrections,
    peaks,
  };
}
