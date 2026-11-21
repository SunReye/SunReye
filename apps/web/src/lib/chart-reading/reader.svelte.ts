// Reading a chart (ADR 21 "Chart reading", "Sheet content", "One behaviour, one component"): the
// one pointer reading every chart runs on. The legend or row header says the values at the place
// read; no tooltip floats. A chart says only what a place is, its band and what it opens.
// - Mouse: hover reads, a click drills, a drag across bands narrows the range.
// - Finger on a full screen: reads at once and leads; lifted it leaves its place read to open, and
//   lifted on the band it went down on it taps, which drills. No brushing.
// - Finger inside a sheet: reads once held (`rest.ts`), then leads; lifted before it held it taps,
//   and lifted it ends the reading.
// - Keys: arrows and Home/End move, Shift and arrows select a span, Enter or Space narrows or
//   drills, Escape clears.
// A finger's or a key's reading ticks `selection` as it crosses into another band.
import { inSheet } from "../detail/in-sheet.ts";
import { haptics } from "../haptics.ts";
import { Rest } from "./rest.ts";

/** A key that moves the reading. */
export type Move = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home" | "End";

/** What a chart says of its places, read at the moment of an input. */
export interface Readable<P> {
  /** The place under a point, given as shares of the plot's width and height. */
  readonly over: (x: number, y: number) => P;
  /** The band a place lies in: a tap stays in one, a reading ticks as it crosses into another. */
  readonly band: (p: P) => number;
  /** Where a key moves the reading from `from`, null with none read; undefined if it does not. */
  readonly step?: ((from: P | null, key: Move) => P | undefined) | undefined;
  /** Opens the band at `p`; whether it could. */
  readonly drill?: ((p: P) => boolean) | undefined;
  /** Narrows the range from `a` to `b`, in the order selected; whether it could. Without it,
   * nothing selects. */
  readonly brush?: ((a: P, b: P) => boolean) | undefined;
}

/** Where the reading is kept when the caller shares it, as with a bound prop. */
export interface Store<P> {
  readonly get: () => P | null;
  readonly set: (p: P | null) => void;
}

export interface Options<P> {
  /** Whether a finger reads only once held; by default, whether the chart stands in a sheet. */
  readonly hold?: boolean;
  readonly store?: Store<P>;
}

/** What a handler reads of a pointer event. */
type Pointer = Readonly<
  Pick<PointerEvent, "button" | "clientX" | "clientY" | "pointerId" | "pointerType">
> & { readonly currentTarget: Element };

/** What a handler reads of a key event. */
type Key = Readonly<Pick<KeyboardEvent, "key" | "preventDefault" | "shiftKey">>;

const MOVES: ReadonlySet<string> = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
]);

const isMove = (key: string): key is Move => MOVES.has(key);

/** Where `v` lies along `size` from `from`, as a share in [0, 1]. */
const share = (v: number, from: number, size: number) =>
  size > 0 ? Math.min(1, Math.max(0, (v - from) / size)) : 0;

export class ChartReader<P> {
  #own = $state.raw<P | null>(null);
  #pinned = $state(false);
  #brush = $state.raw<readonly [P, P] | null>(null);

  readonly #chart: () => Readable<P>;
  readonly #hold: boolean;
  readonly #store: Store<P>;

  /** A mouse pressed, on this place. */
  #press: P | null = null;
  /** A finger down on a full screen: the band it went down on, while it stays there. */
  #finger: { from: number | null } | null = null;
  /** A finger inside a sheet. */
  readonly #rest = new Rest<P>();

  /** @param chart read at each input, so it sees the chart's latest props */
  constructor(chart: () => Readable<P>, { hold = inSheet(), store }: Options<P> = {}) {
    this.#chart = chart;
    this.#hold = hold;
    this.#store = store ?? {
      get: () => this.#own,
      set: (p) => {
        this.#own = p;
      },
    };
  }

  /** The place being read; null with none. */
  get at(): P | null {
    return this.#store.get();
  }

  /** Whether a finger or a key left the reading, so it stays to open. */
  get pinned(): boolean {
    return this.#pinned;
  }

  /** The span being selected, from where it began. */
  get brush(): readonly [P, P] | null {
    return this.#brush;
  }

  /** A finger's or a key's reading, which ticks as it crosses into another band. */
  #lead(p: P): void {
    const was = this.at;
    const { band } = this.#chart();

    if (was === null || band(p) !== band(was)) haptics.selection();

    this.#store.set(p);
  }

  #over(e: Pointer): P {
    const box = e.currentTarget.getBoundingClientRect();

    return this.#chart().over(
      share(e.clientX, box.left, box.width),
      share(e.clientY, box.top, box.height),
    );
  }

  #drill(p: P | null): boolean {
    const { drill } = this.#chart();

    return p !== null && drill !== undefined && drill(p);
  }

  /** Narrows to the span selected, if there is one; the narrower range has nothing read yet. */
  #narrow(): boolean {
    const span = this.#brush;

    this.#brush = null;

    if (!span || this.#chart().brush?.(span[0], span[1]) !== true) return false;

    this.#clear();

    return true;
  }

  #clear(): void {
    this.#pinned = false;
    this.#store.set(null);
  }

  down = (e: Pointer): void => {
    if (e.pointerType === "mouse") {
      if (e.button !== 0) return;

      this.#press = this.#over(e);

      if (this.#chart().brush) e.currentTarget.setPointerCapture(e.pointerId);
    } else if (this.#hold)
      this.#rest.down(e, this.#over(e), (p) => {
        this.#lead(p);
      });
    else {
      const p = this.#over(e);

      this.#finger = { from: this.#chart().band(p) };
      this.#pinned = true;
      this.#lead(p);
    }
  };

  move = (e: Pointer): void => {
    if (e.pointerType === "mouse") this.#hover(e);
    else if (this.#rest.reading || this.#finger) {
      const p = this.#over(e);

      if (this.#finger && this.#chart().band(p) !== this.#finger.from) this.#finger.from = null;

      this.#lead(p);
    } else this.#rest.move(e);
  };

  #hover(e: Pointer): void {
    const p = this.#over(e);
    const { band, brush } = this.#chart();

    this.#store.set(p);

    const from = this.#press;

    if (from !== null && brush && (this.#brush || band(p) !== band(from))) this.#brush = [from, p];
  }

  up = (e: Pointer): void => {
    if (e.pointerType === "mouse") {
      const from = this.#press;

      this.#press = null;

      if (from !== null && !this.#narrow()) this.#drill(from);
    } else if (this.#hold) {
      const tapped = this.#rest.tapped;

      this.end();
      this.#drill(tapped);
    } else {
      const tapped = this.#finger?.from ?? null;

      this.#finger = null;

      if (tapped !== null) this.#drill(this.at);
    }
  };

  /** A mouse leaving takes only what hovering read: a place a finger or a key left stays. */
  leave = (e: Pointer): void => {
    if (e.pointerType !== "mouse") {
      if (this.#hold) this.end();
    } else if (this.#press === null && !this.#pinned) this.#store.set(null);
  };

  /** The browser took the finger, to scroll, or a finger in a sheet let go. */
  end = (): void => {
    this.#rest.drop();
    this.#finger = null;
    this.#clear();
  };

  blur = (): void => {
    if (!this.#pinned) this.#store.set(null);
  };

  /** Opens the band being read. */
  open = (): void => {
    this.#drill(this.at);
  };

  key = (e: Key): void => {
    if (this.#keyed(e)) e.preventDefault();
  };

  #keyed(e: Key): boolean {
    if (isMove(e.key)) return this.#step(e.key, e.shiftKey);

    if (e.key === "Enter" || e.key === " ") return this.#narrow() || this.#drill(this.at);

    if (e.key !== "Escape" || (this.at === null && !this.#brush)) return false;

    this.#brush = null;
    this.#clear();

    return true;
  }

  /** Moves along the places; Shift and a sideways arrow select a span from where it began. */
  #step(key: Move, shift: boolean): boolean {
    const from = this.at;
    const next = this.#chart().step?.(from, key);

    if (next === undefined) return false;

    this.#brush = this.#span(shift && (key === "ArrowLeft" || key === "ArrowRight"), from, next);
    this.#pinned = true;
    this.#lead(next);

    return true;
  }

  /** The span a step selects, from where it began: only a sideways one with Shift does. */
  #span(selects: boolean, from: P | null, next: P): readonly [P, P] | null {
    if (!selects || from === null || !this.#chart().brush) return null;

    return [this.#brush?.[0] ?? from, next];
  }

  /** The handlers, spread on the plot, which the places are measured on. */
  readonly on = {
    onpointerdown: this.down,
    onpointermove: this.move,
    onpointerup: this.up,
    onpointerleave: this.leave,
    onpointercancel: this.end,
    onkeydown: this.key,
    onblur: this.blur,
  };
}
