// The autarky sheet's range (ADR 21 "Sheet content"): the plant's flows over it laid on its bands,
// and the last 30 whole days' autarky, which does not move with the range.
import { NO_PLANT, rollupSum, type Rollups } from "../history/flows.ts";
import { periodOf } from "../history/history.ts";
import { readFlows } from "../history/plant-read.ts";
import { bandsOf } from "../range/fill.ts";
import { RangeData } from "../range/range-data.svelte.ts";
import { grainOf, hourInstant } from "../range/range.ts";
import type { RangeRoute } from "../range/route.svelte.ts";
import { barsOf, extremes, sharesOf } from "./autarky.ts";
import { measureOf, strict, type MeasureCore } from "./measure.ts";

/** The plant-local midnight starting `day`, in ms since the epoch. */
const midnight = (zone: string, day: number) => hourInstant(zone, day * 24).getTime();

/** What the range reads through, and where it stands. */
export interface AutarkyInput {
  readonly core: MeasureCore;
  readonly route: RangeRoute;
}

export class AutarkyRange {
  readonly #input: () => AutarkyInput;
  readonly #data: RangeData<Rollups>;

  // The 30 days are read once per plant day, not per range.
  readonly #core = $derived.by(() => this.#input().core);
  readonly #zone = $derived.by(() => this.#input().route.place.zone);
  readonly #today = $derived.by(() => this.#input().route.place.cal.today);

  constructor(input: () => AutarkyInput) {
    this.#input = input;
    this.#data = new RangeData(
      () => input().route,
      (from, to, now) => {
        const period = periodOf(input().route.range);
        const [a, b] = [from.getTime(), Math.min(to.getTime(), now)];

        return a < b
          ? readFlows(strict(input().core), period, a, b)
          : Promise.resolve(NO_PLANT.days);
      },
    );
  }

  get failed(): boolean {
    return this.#data.failed;
  }

  retry = (): void => {
    this.#data.retry();
  };

  /** Both shares by band, the range's sums and bars, and its best and worst band; null unread. */
  readonly view = $derived.by(() => {
    const got = this.#data.current;

    if (got === undefined) return null;

    const bands = bandsOf(got.list, (_, i) => {
      const [a, b] = got.spans[i]!;
      const s = rollupSum(got.data, a, b);

      return { ...sharesOf(s), covered: s.covered, elapsed: Math.max(0, Math.min(b, got.now) - a) };
    });

    const all = rollupSum(got.data, got.spans[0]?.[0] ?? 0, got.spans.at(-1)?.[1] ?? 0);

    return { bands, all, grain: grainOf(got.range), ...barsOf(all), ...extremes(bands) };
  });

  /** The autarky of the last 30 whole days; null where it cannot be read. */
  readonly month = $derived.by(async () => {
    const [zone, today] = [this.#zone, this.#today];
    const measure = measureOf({ id: "autarky", core: this.#core, strings: [] });

    try {
      return (
        (await measure?.read(midnight(zone, today - 30), midnight(zone, today), "day"))?.value ??
        null
      );
    } catch {
      return null;
    }
  });
}
