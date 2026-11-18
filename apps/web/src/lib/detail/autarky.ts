// What the autarky and self-consumption sheet says of its range (ADR 21 "Sheet content"): what
// covered the house, where the PV went, and its best and worst band. Pure, from the plant's flows
// (ADR 14).
import { flowColour } from "../energy-colours.ts";
import { sources } from "../history/chart.ts";
import { NEXT_TO_NOTHING } from "../history/breakdown.ts";
import type { Sum } from "../history/flows.ts";
import { m } from "../paraglide/messages.js";
import type { Band } from "../range/bands.ts";
import type { Fact } from "./figures.ts";

/** The plant has a battery, as far as the range shows. */
const hasBattery = (s: Readonly<Sum>): boolean => s.charge + s.discharge > NEXT_TO_NOTHING;

/** The house load's shares in %: PV directly, the battery where there is one, the grid. */
export function coverOf(s: Readonly<Sum>): number[] | null {
  return s.consumption < NEXT_TO_NOTHING ? null : sources(s, hasBattery(s));
}

/**
 * The PV's shares in %: the house, the battery where there is one, the grid. The battery takes
 * no more than the PV did not feed in; the rest it charged came from the grid.
 */
export function wentOf(s: Readonly<Sum>): number[] | null {
  if (s.production < NEXT_TO_NOTHING) return null;

  const pct = (v: number) => (Math.max(0, v) / s.production) * 100;
  const stored = Math.min(s.charge, s.selfUsed);
  const house = pct(s.selfUsed - stored);

  return hasBattery(s) ? [house, pct(stored), pct(s.feedIn)] : [house, pct(s.feedIn)];
}

/** The band's autarky; null for one that is not done, or had no load. */
const done = (b: Readonly<Band>): number | null => (b.state === "data" ? (b.up[0] ?? null) : null);

/** The done bands with the highest and the lowest autarky, the first of each; none for one band. */
export function extremes(bands: readonly Band[]) {
  const scored = bands.flatMap((b) => {
    const v = done(b);

    return v === null ? [] : [{ b, v }];
  });

  if (scored.length < 2) return { best: null, worst: null };

  /** The first band furthest up, or with `sign` -1 down. */
  const pick = (sign: 1 | -1) => {
    let top = scored[0]!;

    for (const x of scored) if (sign * (x.v - top.v) > 0) top = x;

    return top.b;
  };

  return { best: pick(1), worst: pick(-1) };
}

/** A band's autarky above and its self-consumption below; none without load, or without PV. */
export function sharesOf(s: Readonly<Sum>) {
  return {
    up: s.consumption < NEXT_TO_NOTHING || s.autarky === null ? [] : [s.autarky],
    down: s.production < NEXT_TO_NOTHING || s.selfUse === null ? [] : [s.selfUse],
  };
}

/** One part of a composition bar: its share in %, null without a whole. */
export interface Part {
  readonly label: string;
  readonly colour: string;
  readonly share: number | null;
}

type Key = readonly [label: string, colour: string];

const partsOf = (keys: readonly Key[], shares: readonly number[] | null): Part[] =>
  keys.map(([label, colour], i) => ({ label, colour, share: shares?.[i] ?? null }));

/** What covered the house and where the PV went, as the two bars draw them. */
export function barsOf(all: Readonly<Sum>) {
  const battery = hasBattery(all);
  const from: Key[] = battery ? [[m.stats_from_battery(), flowColour("battery")]] : [];
  const into: Key[] = battery ? [[m.detail_to_battery(), flowColour("battery")]] : [];

  return {
    covered: partsOf(
      [
        [m.stats_from_pv(), flowColour("solar")],
        ...from,
        [m.stats_from_grid(), flowColour("import")],
      ],
      coverOf(all),
    ),
    went: partsOf(
      [
        [m.detail_to_house(), flowColour("house")],
        ...into,
        [m.detail_to_grid(), flowColour("export")],
      ],
      wentOf(all),
    ),
  };
}

const pct = (label: string, value: number | null): Fact => ({ label, value, unit: "%", digits: 0 });

/** A band's autarky, with when it was under it. */
function at(label: string, b: Readonly<Band> | null): Fact {
  if (b === null) return pct(label, null);

  return { ...pct(label, b.up[0] ?? null), note: b.title };
}

/** The facts row: the best and the worst band, and the last 30 whole days' autarky. */
export const autarkyFacts = (
  best: Readonly<Band> | null,
  worst: Readonly<Band> | null,
  mean: number | null,
): Fact[] => [
  at(m.detail_best(), best),
  at(m.detail_worst(), worst),
  pct(m.detail_month_mean(), mean),
];
