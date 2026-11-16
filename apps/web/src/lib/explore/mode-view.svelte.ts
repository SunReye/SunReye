// What every mode's state shares (ADR 22): its pane's props, the reads for the route's range, and
// the series a mode of one takes. Only the open mode's pane builds one, so only it reads.
import { RangeData } from "../range/range-data.svelte.ts";
import type { Table } from "./csv.ts";
import type { ModeProps } from "./mode.ts";

export abstract class ModeView<T> {
  protected readonly input: () => ModeProps;

  protected readonly data: RangeData<T>;

  /** A mode of one series takes the first. */
  readonly chosen = $derived.by(() => this.input().series[0]!);

  /** What the mode plotted, for the export; null with no point drawn. */
  abstract readonly table: Table | null;

  constructor(input: () => ModeProps) {
    this.input = input;
    // Called only once the pane is built, from the read's effect.
    this.data = new RangeData(
      () => input().route,
      (from, to) => this.load(from, to),
    );
  }

  /** Reads the figures from `from` to before `to`; what it reads before its first `await` is tracked. */
  protected abstract load(from: Readonly<Date>, to: Readonly<Date>): Promise<T>;
}
