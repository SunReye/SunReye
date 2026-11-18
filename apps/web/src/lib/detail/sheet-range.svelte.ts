// What a sheet's panel reads of its range (ADR 21 "Sheet content"), and what it shows of the read.
// A sheet keeps its panel while another figure of its kind opens, so a read is shown only to the
// figure it was read for.
import { RangeData, type Loaded } from "../range/range-data.svelte.ts";
import type { RangeRoute } from "../range/route.svelte.ts";
import type { MeasureCore } from "./measure.ts";

/** What a panel's range reads through. */
export interface RangeInput {
  readonly core: MeasureCore;
  readonly route: RangeRoute;
  /** Whose read it is: one read for another key is not shown. */
  readonly key: string;
}

/** How a panel reads its range, and what it shows of a read or, while there is none, of nothing. */
export interface RangeReader<I, T, V> {
  /** Reads from `from` to before `to`, up to `now`; what it reads of `input` before its first
   * `await` is tracked, so a change there reads again. Rejects when the core fails or refuses. */
  readonly load: (
    input: () => I,
    from: Readonly<Date>,
    to: Readonly<Date>,
    now: number,
  ) => Promise<T>;
  readonly view: (got: Readonly<Loaded<T>> | null, input: () => I) => V;
}

interface Keyed<T> {
  readonly key: string;
  readonly read: T;
}

export class SheetRange<I extends RangeInput, T, V> {
  readonly #input: () => I;
  readonly #reader: RangeReader<I, T, V>;
  readonly #data: RangeData<Keyed<T>>;

  constructor(input: () => I, reader: RangeReader<I, T, V>) {
    this.#input = input;
    this.#reader = reader;
    this.#data = new RangeData(
      () => input().route,
      (from, to, now) => {
        const key = input().key;

        return reader.load(input, from, to, now).then((read) => ({ key, read }));
      },
    );
  }

  get failed(): boolean {
    return this.#data.failed;
  }

  retry = (): void => {
    this.#data.retry();
  };

  readonly view: V = $derived.by(() => {
    const got = this.#data.current;
    const own = got !== undefined && got.data.key === this.#input().key;

    return this.#reader.view(own ? { ...got, data: got.data.read } : null, this.#input);
  });
}
