// The range's year by month against the year before, for the chosen question, at the core's day
// tier (ADR 9).
import type { Edge } from "../range/edges.ts";
import { edges } from "../range/edges.ts";
import { bandsOf, spread } from "../range/fill.ts";
import {
  hourInstant,
  rangeFor,
  step,
  t0Of,
  t1Of,
  type Calendar,
  type Range,
} from "../range/range.ts";
import type { Band } from "../range/bands.ts";
import { NO_PLANT, sumOf, type Plant } from "./flows.ts";
import { readPlant } from "./plant-read.ts";
import type { CostDay, StatsCore } from "./stats.svelte.ts";
import type { Metric } from "./view.ts";

export interface Year {
  readonly range: Range;
  readonly plant: Plant;
  readonly days: readonly CostDay[];
}

export interface Years {
  readonly now: number;
  readonly list: readonly Edge[];
  readonly spans: readonly (readonly [number, number])[];
  readonly year: Year;
  readonly before: Year;
}

async function readYear(core: StatsCore, zone: string, range: Range, now: number): Promise<Year> {
  const ms = (t: number) => hourInstant(zone, t).getTime();
  const [from, to] = [ms(t0Of(range)), Math.min(ms(t1Of(range)), now)];

  if (to <= from)
    return {
      range,
      plant: NO_PLANT,
      days: [],
    };

  const [plant, costs] = await Promise.all([
    readPlant(core, from, to),
    core.costs(new Date(from), new Date(ms(t1Of(range)))),
  ]);

  return { range, plant, days: "days" in costs ? costs.days : [] };
}

/** The year the range ends in, and the one before. */
export async function readYears(
  core: StatsCore,
  zone: string,
  cal: Calendar,
  r: Range,
): Promise<Years> {
  const now = Date.now();
  const year = rangeFor("year", Math.min(cal.today, r.to - 1));
  const list = edges(cal, year, "month");
  const ms = (t: number) => hourInstant(zone, t).getTime();

  const [mine, before] = await Promise.all([
    readYear(core, zone, year, now),
    readYear(core, zone, step(cal, year, -1), now),
  ]);

  return { now, list, spans: list.map((e) => [ms(e.t0), ms(e.t1)] as const), year: mine, before };
}

const YEAR_MS = (d: number) => d * 86_400_000;

/** A month's figure for the question: production, savings or autarky. */
function figure(metric: Metric, y: Year, a: number, b: number) {
  if (metric === "money") {
    const days = y.days.map((d: CostDay) => ({
      saved: d.saved,
      start: Date.parse(d.start),
      end: Date.parse(d.end),
    }));

    const saved = spread(days, a, b, (d: Readonly<{ saved: number }>) => d.saved);

    return { value: saved.sum, covered: saved.covered };
  }

  const s = sumOf(y.plant, a, b);

  return { value: metric === "autarky" ? (s.autarky ?? 0) : s.production, covered: s.covered };
}

/** Each month of the year, with the same month a year earlier as its mark. */
export function yearBands(metric: Metric, got: Years): Band[] {
  const shift = YEAR_MS(got.year.range.from - got.before.range.from);

  return bandsOf(got.list, (_, i) => {
    const [a, b] = got.spans[i]!;
    const mine = figure(metric, got.year, a, b);
    const was = figure(metric, got.before, a - shift, b - shift);

    return {
      up: [mine.value],
      down: [],
      mark: was.covered > 0 ? was.value : null,
      covered: mine.covered,
      elapsed: Math.max(0, Math.min(b, got.now) - a),
    };
  });
}

/** The year's figure: the sum, or autarky over the whole year. */
export function yearTotal(metric: Metric, got: Years): number {
  const [a, b] = [got.spans[0]?.[0] ?? 0, got.spans.at(-1)?.[1] ?? 0];

  return figure(metric, got.year, a, b).value;
}
