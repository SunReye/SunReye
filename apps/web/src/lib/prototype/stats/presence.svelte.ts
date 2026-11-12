// PROTOTYPE: keyed presence for marks that move on CSS transitions (ADR 21). A key that leaves the
// set stays rendered as `out` for its exit, a key that returns mid-exit simply stops being `out`,
// so the transition reverses from where it is. Nothing here animates: it only decides what is drawn.
import { untrack } from "svelte";

export interface Kept<T> {
  key: string;
  item: T;
  /** Leaving: drawn until its exit has run. */
  out: boolean;
  /** Arrived with this update: its place among the arrivals, for a stagger; -1 otherwise. */
  fresh: number;
}

export class Presence<T> {
  list = $state.raw<Kept<T>[]>([]);
  #timers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * @param exit how long a leaving item stays, in ms; 0 drops it at once
   * @param enter false draws arrivals in place, without an entrance
   * @param leave where a leaving item goes, such as its place on the new scale
   */
  set(items: T[], key: (item: T) => string, { exit, enter = true, leave }: { exit: number; enter?: boolean; leave?: (item: T) => T }): number {
    const before = new Map(untrack(() => this.list).map((k) => [k.key, k]));
    let fresh = 0;
    const next: Kept<T>[] = items.map((item) => {
      const k = key(item);
      const was = before.get(k);
      before.delete(k);
      if (was?.out) this.#cancel(k);
      return { key: k, item, out: false, fresh: enter && (!was || was.out) ? fresh++ : -1 };
    });
    for (const was of before.values()) {
      if (exit <= 0) {
        this.#cancel(was.key);
        continue;
      }
      next.push(was.out ? was : { key: was.key, item: leave ? leave(was.item) : was.item, out: true, fresh: -1 });
      if (!this.#timers.has(was.key)) {
        this.#timers.set(
          was.key,
          setTimeout(() => {
            this.#timers.delete(was.key);
            this.list = this.list.filter((k) => !(k.out && k.key === was.key));
          }, exit),
        );
      }
    }
    this.list = next;
    return fresh;
  }

  #cancel(key: string): void {
    clearTimeout(this.#timers.get(key));
    this.#timers.delete(key);
  }

  destroy(): void {
    for (const t of this.#timers.values()) clearTimeout(t);
    this.#timers.clear();
  }
}
