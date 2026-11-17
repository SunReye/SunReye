// Reading the band chart (ADR 21): the legend shows the band under the pointer, never a tooltip.
// Mouse: hover reads, a click opens the band, a drag narrows the range. Touch, on a full screen: a
// finger reads at once and leads, lifted it leaves its band read to open, and a tap opens the band.
// Touch, in a sheet: a finger held on the chart reads and leads, lifted it restores the sum, and a
// tap opens the band (ADR 21 "Sheet content"). There is no brushing by touch. Keys: arrows move,
// Shift and arrows select, Enter opens, Escape clears.
import { inSheet } from "../detail/in-sheet.ts";
import { PointerReading } from "../detail/pointer-reading.ts";
import { AtOnce, type Finger } from "./at-once.ts";
import { haptics } from "../haptics.ts";
import type { Band } from "./bands.ts";

/** What the chart reads from its caller at the moment of an input. */
export interface Target {
  readonly bands: readonly Band[];
  readonly plot: Element | null;
  readonly ondrill?: ((index: number) => void) | undefined;
  readonly onbrush?: ((from: number, to: number) => void) | undefined;
  /** Told the band being read, as it changes, for a chart that reads along. */
  readonly onread?: ((index: number | null) => void) | undefined;
}

/** What a handler reads of a pointer event. */
type Pointer = Readonly<
  Pick<PointerEvent, "button" | "clientX" | "clientY" | "pointerId" | "pointerType">
> & { readonly currentTarget: Element };

/** What a handler reads of a key event. */
type Key = Readonly<Pick<KeyboardEvent, "key" | "preventDefault" | "shiftKey">>;

const clamp = (v: number, last: number) => Math.min(last, Math.max(0, v));

export class Reading {
  #active = $state<number | null>(null);
  pinned = $state(false);
  brush = $state<[number, number] | null>(null);
  /** The span being selected, in order. */
  readonly sel = $derived(
    this.brush ? ([Math.min(...this.brush), Math.max(...this.brush)] as const) : null,
  );

  readonly #target: () => Target;
  #dragFrom: number | null = null;
  #dragged = false;

  readonly #finger: Finger<Pointer>;

  /** The band being read; null with none. */
  get active(): number | null {
    return this.#active;
  }

  set active(i: number | null) {
    this.#active = i;
    this.#target().onread?.(i);
  }

  /** @param hold whether a finger reads only once held: inside a sheet, read at setup */
  constructor(target: () => Target, hold = inSheet()) {
    this.#target = target;

    const write = (at: number | null) => {
      this.pinned = at !== null;
      this.#set(at);
    };

    const tap = (at: number) => {
      this.#drill(at);
    };

    this.#finger = hold
      ? new PointerReading(
          () => this.#target().bands.length,
          () => this.active,
          write,
          tap,
        )
      : new AtOnce((e) => this.#at(e), write, tap);
  }

  #at(e: Pointer): number {
    const { bands, plot } = this.#target();
    const r = plot?.getBoundingClientRect();
    const share = r ? (e.clientX - r.left) / r.width : 0;

    return clamp(Math.floor(share * bands.length), bands.length - 1);
  }

  #set(i: number | null): void {
    if (i !== this.active && i !== null && this.pinned) haptics.selection();

    this.active = i;
  }

  #drill(i: number | null): boolean {
    const t = this.#target();

    if (i === null || t.bands[i]?.drillable !== true || !t.ondrill) return false;

    t.ondrill(i);

    return true;
  }

  /** Narrows to the selected span, if there is one. */
  #narrow(): boolean {
    const sel = this.sel;

    this.brush = null;

    if (!sel || sel[1] <= sel[0]) return false;

    this.#target().onbrush?.(sel[0], sel[1]);

    return true;
  }

  down = (e: Pointer): void => {
    this.#dragged = false;

    if (e.pointerType !== "mouse") {
      this.#finger.down(e);

      return;
    }

    if (e.button !== 0) return;

    this.#dragFrom = this.#at(e);
    this.#target().plot?.setPointerCapture(e.pointerId);
  };

  move = (e: Pointer): void => {
    if (e.pointerType !== "mouse") {
      this.#finger.move(e);

      return;
    }

    const i = this.#at(e);

    this.#set(i);

    const from = this.#dragFrom;

    if (from !== null && this.#target().onbrush && (this.#dragged || i !== from)) {
      this.#dragged = true;
      this.brush = [from, i];
    }
  };

  up = (e: Pointer): void => {
    if (e.pointerType !== "mouse") {
      this.#finger.up(e);

      return;
    }

    const from = this.#dragFrom;

    this.#dragFrom = null;

    if (from === null) return;

    if (this.#dragged && this.#narrow()) return;

    this.brush = null;
    this.#drill(from);
  };

  leave = (e: Pointer): void => {
    if (e.pointerType === "mouse" && this.#dragFrom === null) this.#set(null);
  };

  /** The browser took the finger, to scroll. */
  cancel = (): void => {
    this.#finger.end();
  };

  blur = (): void => {
    if (!this.pinned) this.active = null;
  };

  /** Opens the band being read. */
  open = (): void => {
    this.#drill(this.active);
  };

  key = (e: Key): void => {
    const handled =
      this.#arrow(e) ?? this.#jump(e.key) ?? this.#enter(e.key) ?? this.#escape(e.key);

    if (handled) e.preventDefault();
  };

  /** The band to start from: the one being read, or the latest that has happened. */
  #current(): number {
    const { bands } = this.#target();

    return (
      this.active ??
      Math.max(
        0,
        bands.findLastIndex((b) => b.state === "data" || b.state === "live"),
      )
    );
  }

  /** Arrows move along the bands; with Shift they select a span. Undefined for any other key. */
  #arrow(e: Key): boolean | undefined {
    const dir = { ArrowLeft: -1, ArrowRight: 1 }[e.key];

    if (dir === undefined) return undefined;

    const { bands, onbrush } = this.#target();
    const cur = this.#current();
    const next = this.active === null ? cur : clamp(cur + dir, bands.length - 1);

    this.brush = e.shiftKey && onbrush ? [this.brush?.[0] ?? cur, next] : null;
    this.pinned = true;
    this.active = next;

    return true;
  }

  #jump(key: string): boolean | undefined {
    if (key !== "Home" && key !== "End") return undefined;

    this.pinned = true;
    this.active = key === "Home" ? 0 : this.#target().bands.length - 1;

    return true;
  }

  #enter(key: string): boolean | undefined {
    if (key !== "Enter" && key !== " ") return undefined;

    return this.#narrow() || this.#drill(this.active);
  }

  #escape(key: string): boolean {
    if (key !== "Escape" || (this.active === null && !this.brush)) return false;

    this.active = null;
    this.brush = null;
    this.pinned = false;

    return true;
  }
}
