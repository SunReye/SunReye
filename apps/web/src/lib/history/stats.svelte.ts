// What the statistics screen reads for its range (ADR 11, 12): the plant's flows and the money,
// and the same for the baseline. The last figures stay while the next range loads, so the chart
// tweens instead of redrawing (ADR 21). A core that does not answer in 10 s is an error.
import type { Core } from "../api/core.ts";
import type { CostDays } from "../api/tariff.ts";
import { edges, type Edge } from "../range/edges.ts";
import { hourInstant, t0Of, t1Of, type Calendar, type Range, type Via } from "../range/range.ts";
import type { RangeRoute } from "../range/route.svelte.ts";
import { baselineOf } from "./compare.ts";
import { hourSum, NO_PLANT, sumOf, type Plant, type Sum } from "./flows.ts";
import { readPlant } from "./plant-read.ts";
import type { Compare } from "./view.ts";

export type StatsCore = Readonly<Pick<Core, "history" | "statistics" | "costs">>;

export type Money = Readonly<CostDays["total"]>;

export type CostDay = Readonly<CostDays["days"][number]>;

export interface Loaded {
  readonly range: Range;
  readonly via: Via;
  readonly cal: Calendar;
  readonly zone: string;
  /** Each band and its span in ms since the epoch. */
  readonly list: readonly Edge[];
  readonly spans: readonly (readonly [number, number])[];
  readonly now: number;
  readonly plant: Plant;
  readonly sum: Sum;
  /** Null when the core refused, as without a tariff. */
  readonly days: readonly CostDay[] | null;
  readonly money: Money | null;
  readonly cmp: Compare;
  /** The baseline over its compared hours [t0, t1), read like the range. */
  readonly base: {
    readonly range: Range;
    readonly hours: readonly [number, number];
    readonly sum: Sum;
    readonly money: Money | null;
    readonly plant: Plant;
    readonly days: readonly CostDay[] | null;
  };
}

const TIMEOUT_MS = 10_000;
const DAY = 86_400_000;

async function money(core: StatsCore, from: number, to: number) {
  if (to <= from) return { days: [], total: { paid: 0, earned: 0, saved: 0 } };

  const read = await core.costs(new Date(from), new Date(to));

  return "days" in read ? read : null;
}

async function within<T>(work: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("timeout"));
    }, TIMEOUT_MS);
  });

  try {
    return await Promise.race([work(), late]);
  } finally {
    clearTimeout(timer);
  }
}

export class StatsData {
  current = $state.raw<Loaded | undefined>();
  failed = $state(false);
  #attempt = $state(0);

  constructor(input: () => { core: StatsCore; route: RangeRoute; cmp: Compare }) {
    $effect(() => {
      const { core, route, cmp } = input();
      const r: RangeRoute = route;
      const [range, via, { zone, cal }] = [r.range, r.via, r.place];

      void this.#attempt;

      let live = true;

      void within(() => load(core, { range, via, zone, cal, cmp })).then(
        (got) => {
          if (live) [this.current, this.failed] = [got, false];

          return got;
        },
        () => {
          if (live) this.failed = true;
        },
      );

      return () => {
        live = false;
      };
    });
  }

  get loading(): boolean {
    return this.current === undefined && !this.failed;
  }

  // fallow-ignore-next-line unused-class-member -- StatsCard calls it through `Statistics["data"]`.
  retry = (): void => {
    this.failed = false;
    this.#attempt += 1;
  };
}

/** Bands of hours read the plant's hourly rollups (ADR 9). */
const hoursIn = (list: readonly Edge[]) => list.some((e) => e.t1 - e.t0 < 24);

/** A day's baseline is cut at the hour the range has run to, so it sums hourly rollups. */
const baseSum = (plant: Plant, from: number, to: number) =>
  (to - from < DAY ? hourSum : sumOf)(plant, from, to);

async function load(
  core: StatsCore,
  at: Readonly<{ range: Range; via: Via; zone: string; cal: Calendar; cmp: Compare }>,
): Promise<Loaded> {
  const { range, zone, cal } = at;
  const ms = (t: number) => hourInstant(zone, t).getTime();
  const now = Date.now();
  const list = edges(cal, range);
  const spans = list.map((e) => [ms(e.t0), ms(e.t1)] as const);
  const [from, to] = [ms(t0Of(range)), Math.min(ms(t1Of(range)), now)];
  const base = baselineOf(cal, range, at.cmp);
  const [b0, b1] = [ms(base.hours[0]), Math.min(ms(base.hours[1]), now)];

  const hours = hoursIn(list);

  const [plant, costs, basePlant, baseCosts] = await Promise.all([
    readPlant(core, from, Math.max(from, to), hours),
    money(core, from, ms(t1Of(range))),
    readPlant(core, b0, Math.max(b0, b1), hours),
    money(core, b0, b1),
  ]);

  return {
    ...at,
    list,
    spans,
    now,
    plant,
    sum: sumOf(plant, from, to),
    days: costs?.days ?? null,
    money: costs?.total ?? null,
    base: {
      range: base.range,
      hours: base.hours,
      sum: baseSum(basePlant, b0, b1),
      money: baseCosts?.total ?? null,
      plant: basePlant,
      days: baseCosts?.days ?? null,
    },
  };
}

/** A range not read yet, cut into its bands: what a pane a finger uncovers draws while it loads. */
export function pending(got: Loaded, range: Range): Loaded {
  const ms = (t: number) => hourInstant(got.zone, t).getTime();
  const list = edges(got.cal, range);
  const sum = sumOf(NO_PLANT, 0, 0);

  return {
    ...got,
    range,
    list,
    spans: list.map((e) => [ms(e.t0), ms(e.t1)] as const),
    plant: NO_PLANT,
    sum,
    days: null,
    money: null,
    base: { ...got.base, plant: NO_PLANT, sum, days: null, money: null },
  };
}
