// What the screen says about a loaded range besides its chart: the verdict, the gap it has, the
// breakdown and the notes, for the chosen question. Pure.
import type { StringRow } from "../analytics/strings.ts";
import { bestOf } from "./answer.ts";
import { breakdownOf, type Row } from "./breakdown.ts";
import { gapsOf } from "./flows.ts";
import { notesOf, type Note } from "./notes.ts";
import type { Loaded } from "./stats.svelte.ts";
import type { StatsView } from "./view.ts";
import { verdict } from "./words.ts";

export interface Summary {
  readonly sentence: string;
  /** Hours of the range so far without a house reading. */
  readonly gapHours: number;
  readonly breakdown: readonly Row[];
  readonly notes: readonly Note[];
}

export interface StringsState {
  readonly rows: readonly StringRow[];
  /** The first day the correction learned, while it has too few days to judge. */
  readonly learning: number | null;
}

export function summaryOf(
  got: Readonly<Loaded>,
  view: Readonly<StatsView>,
  plant: Readonly<StringsState>,
): Summary {
  const [from, to] = [got.spans[0]?.[0] ?? 0, got.spans.at(-1)?.[1] ?? 0];
  const elapsed = Math.max(0, Math.min(to, got.now) - from);
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
      kwp: plant.rows.reduce((a, r) => a + r.kwp, 0),
      strings: plant.rows.length,
      elapsed,
    }),
    notes: notesOf({
      zone: got.zone,
      gaps: gapsOf(got.plant, from, to, got.now),
      strings: plant.learning === null ? plant.rows : [],
      best: view.metric === "energy" ? bestOf(got) : null,
    }),
  };
}
