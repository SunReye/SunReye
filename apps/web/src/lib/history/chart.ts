// The statistics screen's main chart for each question (ADR 21): the range's bands, a diverging
// split around one baseline, and the range's sums for the legend. Pure.
import type { Band, SeriesMeta } from "../range/bands.ts";
import { edges } from "../range/edges.ts";
import { bandsOf, spread } from "../range/fill.ts";
import { kwh, money, num } from "../range/format.ts";
import { hourInstant, t0Of } from "../range/range.ts";
import { costBands, split } from "../tariff/costs.ts";
import { bandSum, type Sum } from "./flows.ts";
import { costSeries, flowSeries } from "./series.ts";
import type { Loaded } from "./stats.svelte.ts";
import type { Metric } from "./view.ts";

export interface Chart {
  readonly bands: Band[];
  readonly up: SeriesMeta[];
  readonly down: SeriesMeta[];
  readonly groups: [string, string];
  readonly summary: {
    readonly up: number[];
    readonly down: number[];
    readonly mark: number | null;
  };
  readonly fmt: (v: number) => string;
  readonly unit: string;
  readonly max: number | undefined;
  readonly label: string;
  /** The range each band opens, by index. */
  readonly drills: Loaded["list"];
}

const share = (v: number, s: Sum) =>
  s.consumption > 0 ? (Math.max(0, v) / s.consumption) * 100 : 0;

/** Where the house load came from: the plant directly, the battery, the grid. */
function sources(s: Sum, battery: boolean): number[] {
  const own = Math.max(0, s.consumption - s.purchase);

  if (!battery) return [share(own, s), share(s.purchase, s)];

  const stored = Math.min(s.discharge, own);

  return [share(own - stored, s), share(stored, s), share(s.purchase, s)];
}

/**
 * Each band's span shifted onto the baseline, cut to as much of the band as has run and to the
 * baseline's compared hours, in ms; null where nothing of it is compared.
 */
function baseSpan(got: Loaded, i: number): readonly [number, number] | null {
  const edge = got.list[i];
  const [a, b] = got.spans[i] ?? [0, 0];

  if (!edge) return null;

  const shift = t0Of(got.range) - got.base.hours[0];
  const ms = (t: number) => hourInstant(got.zone, t).getTime();
  const from = ms(edge.t0 - shift);
  const to = Math.min(ms(edge.t1 - shift), from + Math.min(b, got.now) - a, ms(got.base.hours[1]));

  return to > from ? [from, to] : null;
}

const top = (xs: readonly number[]) => xs.reduce((a, v) => a + v, 0);

/** The baseline's savings on each day band, by index. */
function savedMarks(daily: Loaded): (i: number) => number | null {
  const before = (daily.base.days ?? []).map((d) => ({
    saved: d.saved,
    start: Date.parse(d.start),
    end: Date.parse(d.end),
  }));

  return (i) => {
    const was = baseSpan(daily, i);

    const saved = was
      ? spread(before, was[0], was[1], (d: Readonly<{ saved: number }>) => d.saved)
      : null;

    return saved && saved.covered > 0 ? saved.sum : null;
  };
}

function flows(got: Loaded, metric: "energy" | "autarky"): Chart {
  const battery = got.sum.discharge > 0.05;
  const energy = metric === "energy";
  const upOf = (s: Sum) => (energy ? [s.selfUsed, s.feedIn] : sources(s, battery));
  const downOf = (s: Sum) => (energy ? [s.selfCovered, s.purchase] : []);

  const bands = bandsOf(got.list, (edge, i) => {
    const [a, b] = got.spans[i]!;
    const hours = edge.t1 - edge.t0;
    const s = bandSum(got.plant, hours, a, b);
    const was = energy ? baseSpan(got, i) : null;
    const before = was ? bandSum(got.base.plant, hours, was[0], was[1]) : null;

    return {
      up: upOf(s),
      down: downOf(s),
      // The compared span as a mark on each bar's upper side; a share of 100 % has no such mark.
      mark: before && before.covered > 0 ? top(upOf(before)) : null,
      covered: s.covered,
      elapsed: Math.max(0, Math.min(b, got.now) - a),
    };
  });

  return {
    bands,
    ...flowSeries(energy, battery),
    summary: {
      up: upOf(got.sum),
      down: downOf(got.sum),
      mark: energy && got.base.sum.covered > 0 ? top(upOf(got.base.sum)) : null,
    },
    fmt: energy ? kwh : (v) => `${num(v)} %`,
    unit: energy ? "kWh" : "%",
    max: energy ? undefined : 100,
    drills: got.list,
  };
}

/** Money comes by the plant-local day, so a day is its finest band. */
function costs(got: Loaded): Chart {
  const list = edges(got.cal, got.range, "day");
  const ms = (t: number) => hourInstant(got.zone, t).getTime();
  const spans = list.map((e) => [ms(e.t0), ms(e.t1)] as const);

  const fill = costBands(got.days ?? [], spans, got.now);
  // Money bands are days, so the baseline is cut by the same day edges.
  const mark = savedMarks({ ...got, list, spans });

  return {
    bands: bandsOf(list, (_, i) => ({ ...fill(list[i]!, i), mark: mark(i) })),
    ...costSeries(),
    summary: { ...split(got.money ?? undefined), mark: got.base.money?.saved ?? null },
    fmt: money,
    unit: "€",
    max: undefined,
    drills: list,
  };
}

/** `begun` is when the record began, in ms since the epoch: a band that ended by then is no gap. */
export function chartOf(metric: Metric, got: Loaded, begun = 0): Chart {
  const chart =
    metric === "money" ? costs(got) : flows(got, metric === "autarky" ? "autarky" : "energy");

  const end = (i: number) => hourInstant(got.zone, chart.drills[i]?.t1 ?? 0).getTime();

  for (const [i, b] of chart.bands.entries()) {
    if (b.state === "gap" && end(i) <= begun) b.state = "before";
  }

  return chart;
}
