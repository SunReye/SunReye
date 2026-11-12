// The core's figures laid onto a range's bands: a value over a span counts in a band by the share
// of its span inside the band, so a band cut by a range's edge or a change of offset stays right.
import type { Band } from "./bands.ts";
import type { Edge } from "./edges.ts";

/** A span of time in ms since the epoch, [start, end). */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/** The sum of `value` over `items`, each by its share inside [from, to), and the time they cover. */
export function spread<T extends Span>(
  items: readonly T[],
  from: number,
  to: number,
  value: (item: T) => number,
) {
  let [sum, covered] = [0, 0];

  for (const item of items) {
    const inside = Math.min(to, item.end) - Math.max(from, item.start);

    if (inside <= 0 || item.end <= item.start) continue;

    sum += (value(item) * inside) / (item.end - item.start);
    covered += inside;
  }

  return { sum, covered };
}

/** Instants as spans up to the next instant; the last is as long as the one before it. */
export function intervals<T>(
  items: readonly T[],
  at: (item: T) => number,
): (Span & { readonly item: T })[] {
  return items.map((item, i) => {
    const start = at(item);

    const end =
      i + 1 < items.length ? at(items[i + 1]!) : i > 0 ? 2 * start - at(items[i - 1]!) : start;

    return { start, end, item };
  });
}

/** What one band holds: its figures, and how much of its elapsed time readings cover. */
export interface Fill {
  readonly up: readonly number[];
  readonly down: readonly number[];
  readonly mark?: number | null;
  readonly ghost?: number | null;
  /** In any unit, as long as `elapsed` is in the same. */
  readonly covered: number;
  readonly elapsed: number;
}

/** A past band without readings is a gap; the clock decides the rest. */
function stateOf(clock: Edge["state"], covered: number): Band["state"] {
  if (clock === "past") return covered > 0 ? "data" : "gap";

  return clock;
}

/** The chart's bands: a past band without readings is a gap; one with too few is partial. */
export function bandsOf(edges: readonly Edge[], fill: (edge: Edge, index: number) => Fill): Band[] {
  return edges.map((edge, i) => {
    const f = fill(edge, i);
    const state = stateOf(edge.state, f.covered);
    const [up, down] = state === "gap" || state === "future" ? [[], []] : [f.up, f.down];

    return {
      key: edge.key,
      label: edge.label,
      tick: edge.tick,
      title: edge.title,
      state,
      partial: state === "data" && f.covered < 0.9 * f.elapsed,
      up,
      down,
      mark: f.mark ?? null,
      ghost: f.ghost ?? null,
      drillable: edge.drill !== null && edge.state !== "future",
    };
  });
}
