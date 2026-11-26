// What the screen says about a loaded range besides its chart: the verdict, the gap it has, the
// breakdown and the notes, for the chosen question. Pure.
import type { StringRow } from "../analytics/strings.ts";
import { bestOf } from "./answer.ts";
import { breakdownOf, type Row } from "./breakdown.ts";
import { gapsOf } from "./flows.ts";
import { notesOf, type Note } from "./notes.ts";
import type { Loaded } from "./stats.svelte.ts";
import type { StatsView } from "./view.ts";
import { peaksOf, type Peak } from "./peaks.ts";
import { against, verdict } from "./words.ts";

export interface Summary {
  readonly sentence: string;
  /** Hours of the range so far without a house reading. */
  readonly gapHours: number;
  readonly breakdown: readonly Row[];
  /** What the breakdown's changes are against: "zum Vormonat"; empty without a baseline. */
  readonly against: string;
  readonly peaks: readonly Peak[];
  readonly notes: readonly Note[];
}

export interface StringsState {
  readonly rows: readonly StringRow[];
  /** The first day the correction learned, while it has too few days to judge. */
  readonly learning: number | null;
}

/**
 * The part of the range the record can cover, in ms: from the range's start, or the record's when
 * it began later, to the range's end or now. The time before the record began is no gap.
 */
export function recordedSpan(got: Readonly<Loaded>, begun: number) {
  const from = Math.max(got.spans[0]?.[0] ?? 0, begun);
  const to = Math.min(got.spans.at(-1)?.[1] ?? 0, got.now);

  return { from, to: Math.max(from, to), elapsed: Math.max(0, to - from) };
}

/** `begun` is when the record began, in ms since the epoch; 0 while it is not known. */
export function summaryOf(
  got: Readonly<Loaded>,
  view: Readonly<StatsView>,
  plant: Readonly<StringsState>,
  begun = 0,
): Summary {
  const { from, to, elapsed } = recordedSpan(got, begun);
  // Rollups count by their start: the first day's began before its first reading.
  const start = got.spans[0]?.[0] ?? 0;
  const weak = plant.rows.filter((r) => r.flag === "weak").length;

  return {
    sentence: verdict({
      metric: view.metric,
      cal: got.cal,
      range: got.range,
      cmp: view.cmp,
      sum: got.sum,
      money: got.money,
      base: got.base.sum.covered > 0 ? got.base : null,
      strings: { weak, total: plant.rows.length, learning: plant.learning },
    }),
    gapHours: Math.round(Math.max(0, elapsed - got.sum.covered) / 3_600_000),
    breakdown: breakdownOf(view.metric, {
      sum: got.sum,
      money: got.money,
      base: got.base.sum.covered > 0 ? got.base : null,
      days: got.plant.days.load.filter((r) => r.start >= start && r.start < to && r.covered > 0)
        .length,
      kwp: plant.rows.reduce((a, r) => a + r.kwp, 0),
      strings: plant.rows.length,
      elapsed,
    }),
    against: got.base.sum.covered > 0 ? against(got.range, view.cmp) : "",
    peaks: peaksOf(got.plant, {
      from: start,
      to,
      hours: got.list.some((e) => e.t1 - e.t0 < 24),
      zone: got.zone,
    }),
    notes: notesOf({
      zone: got.zone,
      gaps: gapsOf(got.plant, from, to, got.now),
      strings: plant.learning === null ? plant.rows : [],
      best: view.metric === "energy" ? bestOf(got) : null,
    }),
  };
}
