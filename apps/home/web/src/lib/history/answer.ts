// The range's answer up front: the four figures against the baseline, and the strongest band. Pure.
import { m } from "../paraglide/messages.js";
import { num } from "../range/format.ts";
import { sumOf } from "./flows.ts";
import type { Loaded } from "./stats.svelte.ts";
import type { Range } from "../range/range.ts";
import type { Metric } from "./view.ts";
import { change } from "./words.ts";

export interface Figure {
  readonly id: Exclude<Metric, "plant">;
  readonly label: string;
  readonly value: number | null;
  readonly format: (v: number) => string;
  readonly unit: string;
  /** Against the baseline; percentage points for a share. */
  readonly change: number | null;
  readonly points: boolean;
}

/** The plant's state: weak strings, or none while the correction learns. */
export interface PlantState {
  readonly weak: number;
  readonly learning: boolean;
  readonly battery: boolean;
}

/** A rolling figure keeps the unit and digits of where it goes, so neither flips on the way. */
function energyRoll(v: number): Pick<Figure, "format" | "unit"> {
  if (v >= 10_000) return { format: (x) => num(x / 1000, 1), unit: "MWh" };

  return { format: (x) => num(x, v < 100 ? 1 : 0), unit: "kWh" };
}

function moneyRoll(v: number): Pick<Figure, "format" | "unit"> {
  return { format: (x) => num(x, Math.abs(v) < 100 ? 2 : 0), unit: "€" };
}

type Base = Loaded["base"] | null;

function production(s: Loaded["sum"] | undefined, base: Base): Figure {
  const value = s?.production ?? null;

  return {
    id: "energy",
    label: m.stats_production(),
    value,
    ...energyRoll(value ?? 0),
    change: value === null ? null : change(value, base?.sum.production),
    points: false,
  };
}

function savings(saved: number | null, base: Base): Figure {
  return {
    id: "money",
    label: m.stats_savings(),
    value: saved,
    ...moneyRoll(saved ?? 0),
    change: saved === null ? null : change(saved, base?.money?.saved),
    points: false,
  };
}

function autarky(aut: number | null, was: number | null): Figure {
  return {
    id: "autarky",
    label: m.stats_autarky(),
    value: aut,
    format: (x) => num(x),
    unit: "%",
    change: aut === null || was === null ? null : (aut - was) / 100,
    points: true,
  };
}

export function figuresOf(got: Readonly<Loaded> | undefined): Figure[] {
  const base = got && got.base.sum.covered > 0 ? got.base : null;

  return [
    production(got?.sum, base),
    savings(got?.money?.saved ?? null, base),
    autarky(got?.sum.autarky ?? null, base?.sum.autarky ?? null),
  ];
}

/** The band that produced most, among more than three whole ones that open. */
export function bestOf(
  got: Readonly<Loaded>,
): { title: string; value: number; drill: Range } | null {
  let [top, best, whole] = [0, -1, 0];

  for (const [i, edge] of got.list.entries()) {
    if (edge.state !== "past" || edge.drill === null) continue;

    const [a, b] = got.spans[i]!;
    const value = sumOf(got.plant, a, b).production;

    whole += 1;

    if (value > top) [top, best] = [value, i];
  }

  const edge = got.list[best];

  return whole > 3 && edge?.drill ? { title: edge.title, value: top, drill: edge.drill } : null;
}
