// A flow sheet's range (ADR 21 "Sheet content"): the flow's rollups for its peak and the tariff's
// rate for its euros (ADR 12), up to now.
import { PLANT } from "../api/core.ts";
import { TARIFF } from "../api/computed-devices.ts";
import type { Fact } from "./figures.ts";
import { periodOf, rollups } from "../history/history.ts";
import { readFlows } from "../history/plant-read.ts";
import { flowFacts, type SheetFlow, type FlowRead } from "./flow.ts";
import { strict } from "./measure.ts";
import type { RangeInput, RangeReader } from "./sheet-range.svelte.ts";

export interface FlowInput extends RangeInput {
  readonly flow: SheetFlow;
  /** A tariff is in force (ADR 12). */
  readonly priced: boolean;
}

/** The facts row; each value null while the range is read. */
export const FLOW_RANGE: RangeReader<FlowInput, FlowRead, Fact[]> = {
  load: async (input, from, to, now) => {
    const { core, route, flow } = input();
    const period = periodOf(route.range);
    const until = new Date(Math.min(to.getTime(), now));

    const ran = from.getTime() < until.getTime();

    const read = (device: number, series: string) =>
      ran ? rollups(strict(core), device, series, period, from, until) : Promise.resolve([]);

    const [peak, flows, money] = await Promise.all([
      read(PLANT, flow.series),
      flow.cover && ran ? readFlows(strict(core), period, from.getTime(), until.getTime()) : null,
      flow.money === null ? null : read(TARIFF, flow.money.series),
    ]);

    return { peak, flows, money, hours: period === "hour", zone: route.place.zone };
  },
  view: (got, input) => {
    const { flow, priced } = input();

    return flowFacts(flow, got?.data ?? null, priced);
  },
};
