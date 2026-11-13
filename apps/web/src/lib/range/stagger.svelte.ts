// A long keyed list that takes each change a share per frame (ADR 21): a chart's bars restyle as
// they move, and all of a month's at once overrun a frame at 4× throttle.
import { untrack } from "svelte";
import { after } from "../motion/frames.ts";

export class Stagger<T> {
  /** What to draw: the first shares of the newest list, the rest as they were. */
  list = $state.raw<T[]>([]);
  #cancel = (): void => {};

  /** @param share how many items take a change per frame */
  constructor(source: () => readonly T[], key: (item: T) => string, share: number) {
    $effect.pre(() => {
      const next = source();

      untrack(() => {
        this.#take(next, key, share, share, 2);
      });

      return () => {
        this.#cancel();
      };
    });
  }

  /** Takes `n` items of `next`; `wait` frames on, `share` more. */
  #take(
    next: readonly T[],
    key: (item: T) => string,
    share: number,
    n: number,
    wait: number,
  ): void {
    const was = new Map(this.list.map((item) => [key(item), item]));

    this.list = next.flatMap((item, i) => {
      if (i < n) return [item];

      const old = was.get(key(item));

      return old === undefined ? [] : [old];
    });

    this.#cancel =
      n < next.length
        ? after(wait, () => {
            this.#take(next, key, share, n + share, 1);
          })
        : () => {};
  }
}
