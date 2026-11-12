// Reading the band chart (ADR 21): the legend shows the band under the pointer, never a tooltip.
// Mouse: hover reads, a click opens the band, a drag narrows the range. Touch: a drag reads and a
// tap opens the band; there is no brushing. Keys: arrows move, Shift and arrows select, Enter
// opens, Escape clears.
import { haptics } from "../haptics.ts";
import type { Band } from "./bands.ts";

/** What the chart reads from its caller at the moment of an input. */
export interface Target {
  readonly bands: readonly Band[];
  readonly plot: Element | null;
  readonly ondrill?: ((index: number) => void) | undefined;
  readonly onbrush?: ((from: number, to: number) => void) | undefined;
}

/** What a handler reads of a pointer event. */
type Pointer = Readonly<
  Pick<PointerEvent, "button" | "buttons" | "clientX" | "pointerId" | "pointerType" | "pressure">
>;

/** What a handler reads of a key event. */
type Key = Readonly<Pick<KeyboardEvent, "key" | "preventDefault" | "shiftKey">>;

const clamp = (v: number, last: number) => Math.min(last, Math.max(0, v));

export class Reading {
  active = $state<number | null>(null);
  pinned = $state(false);
  brush = $state<[number, number] | null>(null);
  /** The span being selected, in order. */
  readonly sel = $derived(
    this.brush ? ([Math.min(...this.brush), Math.max(...this.brush)] as const) : null,
  );

  readonly #target: () => Target;
  #dragFrom: number | null = null;
  #dragged = false;
  /** A finger that stays on its band is a tap. */
  #tapFrom: number | null = null;

  constructor(target: () => Target) {
    this.#target = target;
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
    const i = this.#at(e);

    this.#dragged = false;

    if (e.pointerType !== "mouse") {
      this.pinned = true;
      this.#tapFrom = i;
      this.#set(i);

      return;
    }

    if (e.button !== 0) return;

    this.#dragFrom = i;
    this.#target().plot?.setPointerCapture(e.pointerId);
  };

  move = (e: Pointer): void => {
    const i = this.#at(e);

    if (e.pointerType !== "mouse") {
      if (e.buttons === 0 && e.pressure <= 0) return;

      if (i !== this.#tapFrom) this.#tapFrom = null;

      this.#set(i);

      return;
    }

    this.#set(i);

    const from = this.#dragFrom;

    if (from !== null && this.#target().onbrush && (this.#dragged || i !== from)) {
      this.#dragged = true;
      this.brush = [from, i];
    }
  };

  up = (e: Pointer): void => {
    if (e.pointerType !== "mouse") {
      const tapped = this.#tapFrom;

      this.#tapFrom = null;
      this.#drill(tapped);

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
