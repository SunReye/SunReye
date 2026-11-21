// Fold mode's state (ADR 22): whether the series folds, the period from the hash route, and the
// statistics read for the range, one call per fold.
import { settleRead } from "../api/client.ts";
import { only, type Period, type Problem } from "../api/core.ts";
import { foldTable } from "./csv.ts";
import {
  FOLD_PARAM,
  foldOf,
  isCounter,
  periodOf,
  periodsOf,
  rowsOf,
  type FoldRow,
} from "./fold.ts";
import { ModeView } from "./mode-view.svelte.ts";
import { same, type SeriesRef } from "./view.ts";

/** One fold's read: whose and by which period, and its rows, or that it was refused. */
export interface Folded {
  readonly ref: SeriesRef;
  readonly period: Period;
  readonly zone: string;
  /** The retry it was read on. */
  readonly attempt: number;
  readonly from: number;
  readonly to: number;
  readonly failed: boolean;
  /** Why the core refused the read; none for a lost core. */
  readonly refused?: Problem | undefined;
  readonly counter: boolean;
  readonly rows: readonly FoldRow[];
}

export class Fold extends ModeView<Folded | null> {
  readonly state = $derived.by(() => foldOf(this.chosen, this.input().catalog));

  readonly periods = $derived.by(() => periodsOf(this.input().route.range));

  readonly period: Period = $derived.by(() => {
    const { route } = this.input();

    return periodOf(route.range, route.params);
  });

  /** Raised to read again after a refusal. */
  #again = $state(0);

  /** What was read, while it is still this series' fold by this period; null until then. */
  readonly got = $derived.by(() => {
    const read = this.data.current?.data;

    return read && same(read.ref, this.chosen.ref) && read.period === this.period ? read : null;
  });

  /** The bars, under the range they were read for. */
  readonly table = $derived.by(() => {
    const [range, got] = [this.data.current?.range, this.got];

    if (!range || !got || got.failed) return null;

    return foldTable(range, this.chosen, got.period, got.counter, got.rows);
  });

  protected async load(from: Readonly<Date>, to: Readonly<Date>): Promise<Folded | null> {
    const { core, route } = this.input();

    const [ref, period, kind, zone] = [
      this.chosen.ref,
      this.period,
      this.chosen.kind,
      route.place.zone,
    ];

    // Read before the first await, so a retry loads again.
    const attempt = this.#again;

    if (this.state !== "read") return null;

    const base = { ref, period, zone, attempt, from: from.getTime(), to: to.getTime() };

    // An unreachable core rejects; a refusal answers with a problem.
    const got = await settleRead(
      core.statistics(ref.device, [ref.series], period, new Date(from), new Date(to)).then(only),
    );

    if (got.failed) return { ...base, failed: true, counter: false, rows: [] };

    if ("problem" in got.data)
      return { ...base, failed: true, refused: got.data, counter: false, rows: [] };

    return {
      ...base,
      failed: false,
      counter: isCounter(kind ?? null, got.data.points),
      rows: rowsOf(got.data.points),
    };
  }

  /** Folds by another period, as a step back can undo; the range's own leaves the route. */
  setPeriod = (next: Period): void => {
    const { route } = this.input();

    route.patch({ [FOLD_PARAM]: next === this.periods.initial ? null : next }, true);
  };

  retry = (): void => {
    this.#again++;
  };
}
