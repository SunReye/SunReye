// Series mode's lanes (ADR 22): series of one unit share a lane, and a chart holds at most six
// series in four lanes. Pure: the picker asks what may still be added, the pane what to draw.
import { flowColour, roleFlow } from "../energy-colours.ts";
import type { Chosen } from "./picker.ts";

/** More cannot be read against each other, and bounds the reads to about six (ADR 22). */
const MAX_SERIES = 6;
const MAX_LANES = 4;

/** What a series needs to be placed. */
export type Placed = Pick<Chosen, "kind" | "unit">;

/** A drawn series and its colour. */
export interface LaneSeries {
  readonly chosen: Chosen;
  readonly colour: string;
}

export interface Lane {
  readonly key: string;
  /** Null without a unit, and for states. */
  readonly unit: string | null;
  /** A lane of statuses: bands of states, no value axis. */
  readonly states: boolean;
  readonly series: readonly LaneSeries[];
}

export interface Lanes {
  readonly lanes: readonly Lane[];
  /** Chosen past the caps, so not drawn. */
  readonly left: readonly Chosen[];
  /** Not in the catalog: no stored history. */
  readonly absent: readonly Chosen[];
}

/** A status has no unit and no scale, so it never shares a dimensionless measurement's lane. */
const keyOf = (s: Placed): string => (s.kind === "status" ? "states" : `unit:${s.unit ?? ""}`);

/** Why `candidate` cannot join `chosen`: the chart is full of series, or of lanes. */
export function blocked(chosen: readonly Placed[], candidate: Placed): "series" | "lanes" | null {
  if (chosen.length >= MAX_SERIES) return "series";

  const keys = new Set(chosen.map((s) => keyOf(s)));

  return keys.size >= MAX_LANES && !keys.has(keyOf(candidate)) ? "lanes" : null;
}

/** For a further series of a flow: a flow's colour is that flow's alone (ADR 21). */
const NEUTRAL = [1, 4, 5, 2, 3].map((n) => `var(--chart-${n})`);

/** A role's flow colour while it is free, else the first neutral colour that is. */
function colourOf(series: string, isTaken: (colour: string) => boolean): string {
  const own = flowColour(roleFlow(series));

  return isTaken(own) ? (NEUTRAL.find((c) => !isTaken(c)) ?? own) : own;
}

/** The chosen series in their lanes, in the order chosen, up to the caps. */
export function lanesOf(chosen: readonly Chosen[]): Lanes {
  const lanes = new Map<string, Lane & { readonly series: LaneSeries[] }>();
  const taken = new Set<string>();
  const left: Chosen[] = [];

  /** The lane `each` joins, opened if the chart has room for it; undefined when it is full. */
  const laneOf = (each: Chosen) => {
    const key = keyOf(each);
    const states = each.kind === "status";

    if (!lanes.has(key) && lanes.size < MAX_LANES)
      lanes.set(key, { key, unit: states ? null : each.unit, states, series: [] });

    return taken.size < MAX_SERIES ? lanes.get(key) : undefined;
  };

  for (const each of chosen.filter((s) => s.first !== null)) {
    const lane = laneOf(each);
    const colour = colourOf(each.ref.series, (c) => taken.has(c));

    if (lane) {
      taken.add(colour);
      lane.series.push({ chosen: each, colour });
    } else left.push(each);
  }

  return {
    // A lane opened for a series the series cap then kept out stays undrawn.
    lanes: [...lanes.values()].filter((l: Lane) => l.series.length > 0),
    left,
    absent: chosen.filter((s) => s.first === null),
  };
}
