// Fold mode's state (ADR 22): whether the series folds, the period from the hash route, and the
// statistics read for the range, one call per fold.
import type { Period } from "../api/core.ts";
import { RangeData } from "../range/range-data.svelte.ts";
import { FOLD_PARAM, foldOf, isCounter, periodOf, periodsOf, rowsOf } from "./fold.ts";
import type { ModeProps } from "./mode.ts";
import { same } from "./view.ts";

/** What the fold reads of its mode's contract. */
export type FoldInput = Pick<ModeProps, "core" | "route" | "series" | "catalog">;

export class Fold {
  readonly #input: () => FoldInput;

  /** A mode of one series takes the first. */
  readonly chosen = $derived.by(() => this.#input().series[0]!);

  readonly state = $derived.by(() => foldOf(this.chosen, this.#input().catalog));

  readonly periods = $derived.by(() => periodsOf(this.#input().route.range));

  readonly period: Period = $derived.by(() => {
    const { route } = this.#input();

    return periodOf(route.range, route.params);
  });

  /** Raised to read again after a refusal. */
  #again = $state(0);

  readonly #data;

  /** What was read, while it is still this series' fold by this period; null until then. */
  readonly got = $derived.by(() => {
    const read = this.#data.current?.data;

    return read && same(read.ref, this.chosen.ref) && read.period === this.period ? read : null;
  });

  constructor(input: () => FoldInput) {
    this.#input = input;

    this.#data = new RangeData(
      () => input().route,
      (from, to) => this.#read(from, to),
    );
  }

  async #read(from: Readonly<Date>, to: Readonly<Date>) {
    const { core, route } = this.#input();

    const [ref, period, kind, zone] = [
      this.chosen.ref,
      this.period,
      this.chosen.kind,
      route.place.zone,
    ];

    // Read before the first await, so a retry loads again.
    const attempt = this.#again;

    if (this.state !== "read") return null;

    // An unreachable core rejects; a refusal answers with a problem.
    const read = await core
      .statistics(ref.device, ref.series, period, new Date(from), new Date(to))
      .catch(() => ({ problem: "network" }) as const);

    const base = { ref, period, zone, attempt, from: from.getTime(), to: to.getTime() };

    if (!("points" in read)) return { ...base, failed: true, counter: false, rows: [] };

    return {
      ...base,
      failed: false,
      counter: isCounter(kind ?? null, read.points),
      rows: rowsOf(read.points),
    };
  }

  /** Folds by another period, as a step back can undo; the range's own leaves the route. */
  setPeriod = (next: Period): void => {
    const { route } = this.#input();

    route.patch({ [FOLD_PARAM]: next === this.periods.initial ? null : next }, true);
  };

  retry = (): void => {
    this.#again++;
  };
}
