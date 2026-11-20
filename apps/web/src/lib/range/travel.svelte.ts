// How a range card's content gets to the next range (ADR 21): a finger's drag slides it, the
// neighbour already beside it drawn loading from the figures in hand, so a drag reads nothing; an
// arrow's step or a new kind keeps the pane and its chart morphs in place. One per card: the flag a
// drag leaves is read once, by that card's pager.
import { untrack } from "svelte";
import { canStep, rangeKey, step, type Calendar, type Range, type Ranged } from "./range.ts";

/**
 * How a pager's content gets to a new id: it slides, crossfades a few px toward its side (shift), or
 * stays and moves by itself (keep), as a chart that morphs.
 */
export interface Travel {
  readonly kind: "slide" | "shift" | "keep";
  readonly dir: -1 | 0 | 1;
}

/** One pane's content: what was read, or what stands for it while it loads. */
export interface Paned<P> {
  readonly got: P;
  readonly loading: boolean;
}

/** The route as a card travels it. */
export interface TravelRoute extends Pick<Ranged, "range" | "via" | "step"> {
  readonly place: { readonly cal: Calendar };
}

export interface TravelInput<T, P> {
  readonly route: TravelRoute;
  /** The last figures read; undefined before the first. */
  readonly got: T | undefined;
  readonly loading: boolean;
  /** What a range not yet read draws, from the figures in hand. */
  readonly pending: (got: T, range: Range) => P;
  /** What tells one pane from the next; the range by default. */
  readonly key?: (range: Range) => string;
}

export class RangeTravel<T extends { readonly range: Range }, P = T> {
  readonly #input: () => TravelInput<T, P>;
  #dragged = false;
  /** The range a drag reached: its pane draws it loading, not the range it left. */
  #slidTo = $state<string | null>(null);

  constructor(input: () => TravelInput<T, P>) {
    this.#input = input;
  }

  get id(): string {
    const { route, key = rangeKey } = this.#input();

    return key(route.range);
  }

  /** What the shown pane draws; null before the first figures. */
  get pane(): Paned<T | P> | null {
    const { route, got, loading, pending } = this.#input();
    const at = rangeKey(route.range);

    if (!got) return null;

    if (rangeKey(got.range) !== at && this.#slidTo === at)
      return { got: pending(got, route.range), loading: true };

    return { got, loading };
  }

  /** The neighbour a drag uncovers; null at the end of the record or where the pane stays. */
  peek = (dir: -1 | 1): { id: string; data: Paned<P> } | null => {
    const { route, got, pending, key = rangeKey } = this.#input();
    const cal = route.place.cal;

    if (!got || !canStep(cal, route.range, dir)) return null;

    const next = step(cal, route.range, dir);
    const id = key(next);

    return id === this.id ? null : { id, data: { got: pending(got, next), loading: true } };
  };

  /** A finger paged the range. */
  drag = (dir: -1 | 1): void => {
    const { route } = this.#input();

    this.#dragged = true;
    route.step(dir);
    this.#slidTo = untrack(() => rangeKey(route.range));
  };

  /** How the pane gets to a new range; read once per change. */
  travel = (): Travel => {
    const out: Travel = {
      kind: this.#dragged ? "slide" : "keep",
      dir: this.#input().route.via.dir,
    };

    this.#dragged = false;

    return out;
  };
}
