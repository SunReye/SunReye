// What the statistics screen reads once, whatever the range: the strings, whether the plant has a
// battery or an EV, the first day it recorded, and payback (admin only, ADR 12).
import type { Core, PvString } from "../api/core.ts";
import type { Payback } from "../api/tariff.ts";
import { inputCorrections, modulePeaks } from "../analytics/string-energy.ts";
import type { InputCorrection } from "../analytics/strings.ts";
import { PLANT } from "../dashboard/day.ts";
import { layoutStrings } from "../live/plant-facts.ts";
import { dayOfIso } from "../range/calendar.ts";

export type FactsCore = Readonly<
  Pick<Core, "layout" | "capabilities" | "statistics" | "payback" | "corrections" | "moduleTypes">
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

const DAY = 86_400_000;

async function series(core: FactsCore): Promise<readonly string[]> {
  const caps = await core.capabilities();

  return "devices" in caps ? (caps.devices[String(PLANT)]?.series ?? []) : [];
}

/** The first month with history, then its first day. */
async function since(core: FactsCore): Promise<number | null> {
  const now = new Date();

  const months = await core.statistics(
    PLANT,
    "load.power",
    "month",
    new Date(now.getTime() - 1498 * DAY),
    now,
  );

  const month = "points" in months ? months.points[0] : undefined;

  if (month === undefined) return null;

  const from = new Date(month.start);

  const read = await core.statistics(
    PLANT,
    "load.power",
    "day",
    from,
    new Date(Math.min(now.getTime(), from.getTime() + 32 * DAY)),
  );

  const first = "points" in read ? read.points[0] : undefined;

  return first ? dayOfIso(first.date) : null;
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
