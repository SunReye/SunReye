// A flow sheet's range (ADR 21 "Sheet content"): the flow's rollups for its peak and the tariff's
// rate for its euros (ADR 12), up to now.
import { PLANT } from "../api/core.ts";
import { TARIFF } from "../api/computed-devices.ts";
import { periodOf, rollups } from "../history/history.ts";
import { RangeData } from "../range/range-data.svelte.ts";
import type { RangeRoute } from "../range/route.svelte.ts";
import { flowFacts, type Flow, type FlowRead } from "./flow.ts";
import { strict, type MeasureCore } from "./measure.ts";

/** What the range reads through, and where it stands. */
export interface FlowInput {
  readonly core: MeasureCore;
  readonly route: RangeRoute;
  readonly flow: Flow;
}

export class FlowRange {
  readonly #input: () => FlowInput;
  readonly #data: RangeData<FlowRead>;

  constructor(input: () => FlowInput) {
    this.#input = input;
    this.#data = new RangeData(
      () => input().route,
      async (from, to, now) => {
        const { core, route, flow } = input();
        const period = periodOf(route.range);
        const until = new Date(Math.min(to.getTime(), now));

        const read = (device: number, series: string) =>
          from.getTime() < until.getTime()
            ? rollups(strict(core), device, series, period, from, until)
            : Promise.resolve([]);

        const [peak, money] = await Promise.all([
          read(PLANT, flow.series),
          flow.money === null ? null : read(TARIFF, flow.money.series),
        ]);

        return { peak, money, hours: period === "hour", zone: route.place.zone };
      },
    );
  }

  get failed(): boolean {
    return this.#data.failed;
  }

  retry = (): void => {
    this.#data.retry();
  };

  /** The facts row; each value null while the range is read. */
  readonly facts = $derived.by(() =>
    flowFacts(this.#input().flow, this.#data.current?.data ?? null),
  );
}
