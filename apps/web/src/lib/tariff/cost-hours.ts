// A day's costs by the hour (ADR 12, 21 "Sheet content"): the tariff's hourly rollups of its
// `cost.*` rates, each hour laid out as the core lays out a day. No `cost.*` rate holds the standing
// charge, so none is owed here.
import { TARIFF } from "../api/computed-devices.ts";
import { answerOf } from "../api/client.ts";
import type { Core } from "../api/core.ts";
import type { CostDays } from "../api/tariff.ts";
import { periodOf, rollups, type Rolled } from "../history/history.ts";
import type { Range } from "../range/range.ts";

const H = 3_600_000;

/** The euros of the rollup starting at `start`; 0 for an hour without one. */
const eurosAt = (rolled: readonly Rolled[], start: number) =>
  rolled.find((r) => r.start === start)?.integral ?? 0;

/** What was paid, earned and saved in each hour from `from` to before `to` that has a rollup. */
async function costHours(
  core: Readonly<Pick<Core, "statistics">>,
  from: Readonly<Date>,
  to: Readonly<Date>,
): Promise<CostDays> {
  const read = (series: string) => rollups(core, TARIFF, series, "hour", from, to);

  const [paid, earned, saved] = await Promise.all([
    read("cost.import.rate"),
    read("cost.export.rate"),
    read("cost.savings.rate"),
  ]);

  const starts = [...new Set([...paid, ...earned, ...saved].map((r) => r.start))].toSorted(
    (a, b) => a - b,
  );

  const days = starts.map((start) => ({
    start: new Date(start).toISOString(),
    end: new Date(start + H).toISOString(),
    paid: eurosAt(paid, start),
    earned: eurosAt(earned, start),
    saved: eurosAt(saved, start),
    standing: 0,
  }));

  const sum = (key: "paid" | "earned" | "saved") =>
    days.reduce((a, d: Readonly<CostDays["days"][number]>) => a + d[key], 0);

  return {
    days,
    total: { paid: sum("paid"), earned: sum("earned"), saved: sum("saved"), standing: 0 },
  };
}

/**
 * A chart's costs over `range`, from `from` to before `to`: by the tariff's hours for a chart that
 * reads hours on a range read by the hour, as a day or a brush on one; else the core's days. A
 * refusal fails the read with the core's reason.
 */
export async function costsOver(
  core: Readonly<Pick<Core, "costs" | "statistics">>,
  hourly: boolean,
  range: Readonly<Range>,
  span: readonly [Readonly<Date>, Readonly<Date>],
): Promise<CostDays> {
  const [from, to] = span;

  if (hourly && periodOf(range) === "hour") return costHours(core, from, to);

  return answerOf(await core.costs(from, to));
}
