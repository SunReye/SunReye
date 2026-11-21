// The autarky sheet's range (ADR 21 "Sheet content"): the plant's flows over it laid on its bands,
// and the last 30 whole days' autarky, which does not move with the range.
import { NO_PLANT, rollupSum, type Rollups } from "../history/flows.ts";
import { periodOf } from "../history/history.ts";
import { readFlows } from "../history/plant-read.ts";
import { bandsOf } from "../range/fill.ts";
import { grainOf, hourInstant } from "../range/range.ts";
import { barsOf, extremes, sharesOf } from "./autarky.ts";
import { AUTARKY, measureOf, type MeasureCore } from "./measure.ts";
import type { RangeInput, RangeReader } from "./sheet-range.svelte.ts";

/** The plant-local midnight starting `day`, in ms since the epoch. */
const midnight = (zone: string, day: number) => hourInstant(zone, day * 24).getTime();

/** Both shares by band, the range's sums and bars, and its best and worst band; null unread. */
export const AUTARKY_RANGE = {
  load: (input, from, to, now) => {
    const { core, route } = input();
    const period = periodOf(route.range);
    const [a, b] = [from.getTime(), Math.min(to.getTime(), now)];

    return a < b ? readFlows(core, period, a, b) : Promise.resolve(NO_PLANT.days);
  },
  view: (got) => {
    if (got === null) return null;

    const bands = bandsOf(got.list, (_, i) => {
      const [a, b] = got.spans[i]!;
      const s = rollupSum(got.data, a, b);

      return { ...sharesOf(s), covered: s.covered, elapsed: Math.max(0, Math.min(b, got.now) - a) };
    });

    const all = rollupSum(got.data, got.spans[0]?.[0] ?? 0, got.spans.at(-1)?.[1] ?? 0);

    return { bands, all, grain: grainOf(got.range), ...barsOf(all), ...extremes(bands) };
  },
} satisfies RangeReader<RangeInput, Rollups, unknown>;

/** The autarky of the 30 whole days before plant day `today`; null where it cannot be read. */
export async function monthAutarky(
  core: MeasureCore,
  zone: string,
  today: number,
): Promise<number | null> {
  try {
    const read = await measureOf(AUTARKY, core).read(
      midnight(zone, today - 30),
      midnight(zone, today),
      "day",
    );

    return read.value;
  } catch {
    return null;
  }
}
