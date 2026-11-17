// Reading a chart along its time axis (ADR 21): the legend shows the values under the pointer.
// Mouse: hover reads, a drag narrows the range. Touch: a finger reads; there is no brushing.
// A chart that cannot narrow only reads.
// Keys: arrows move the pointer, Shift and arrows select a span, Enter narrows to it, Escape clears.

/** What the chart reads from its caller at the moment of an input. */
export interface Target {
  readonly plot: Element | null;
  /** The time axis, [from, to) in epoch ms. */
  readonly from: number;
  readonly to: number;
  /** Narrows to the span between two instants; null on a chart that only reads. */
  readonly onbrush: ((a: number, b: number) => void) | null;
}

type Input = Readonly<
  Pick<PointerEvent, "button" | "buttons" | "clientX" | "pointerId" | "pointerType" | "pressure">
>;

type Key = Readonly<Pick<KeyboardEvent, "key" | "preventDefault" | "shiftKey">>;

/** A press that moves less than this is no drag. */
const SLOP_PX = 4;

/** An arrow key's step, as a share of the axis. */
const STEP = 1 / 48;

export class Pointer {
  /** The instant being read. */
  at = $state<number | null>(null);
  /** The span being selected, from where it began. */
  brush = $state<readonly [number, number] | null>(null);

  readonly #target: () => Target;
  #drag: { x: number; t: number } | null = null;
  /** A finger or the keyboard holds the reading after it lifts. */
  #pinned = false;

  constructor(target: () => Target) {
    this.#target = target;
  }

  #instant(e: Input): number {
    const { plot, from, to } = this.#target();
    const r = plot?.getBoundingClientRect();
    const share = r && r.width > 0 ? (e.clientX - r.left) / r.width : 0;

    return from + Math.min(1, Math.max(0, share)) * (to - from);
  }

  down = (e: Input): void => {
    if (e.pointerType !== "mouse") {
      this.#pinned = true;
      this.at = this.#instant(e);

      return;
    }

    if (e.button !== 0 || !this.#target().onbrush) return;

    this.#drag = { x: e.clientX, t: this.#instant(e) };
    this.#target().plot?.setPointerCapture(e.pointerId);
  };

  move = (e: Input): void => {
    if (e.pointerType !== "mouse" && e.buttons === 0 && e.pressure <= 0) return;

    const t = this.#instant(e);

    this.at = t;

    if (e.pointerType !== "mouse") return;

    const drag = this.#drag;

    if (drag && (this.brush || Math.abs(e.clientX - drag.x) >= SLOP_PX)) this.brush = [drag.t, t];
  };

  up = (e: Input): void => {
    if (e.pointerType !== "mouse") return;

    this.#drag = null;
    this.#narrow();
  };

  leave = (e: Input): void => {
    if (e.pointerType === "mouse" && this.#drag === null) this.at = null;
  };

  blur = (): void => {
    if (!this.#pinned) this.at = null;
  };

  #narrow(): boolean {
    const brush = this.brush;

    this.brush = null;

    if (!brush || brush[0] === brush[1]) return false;

    this.#target().onbrush?.(brush[0], brush[1]);

    return true;
  }

  key = (e: Key): void => {
    if (this.#arrow(e) ?? this.#enter(e.key) ?? this.#escape(e.key)) e.preventDefault();
  };

  /** Arrows move the pointer; with Shift they select a span. Undefined for any other key. */
  #arrow(e: Key): boolean | undefined {
    const dir = { ArrowLeft: -1, ArrowRight: 1 }[e.key];

    if (dir === undefined) return undefined;

    const { from, to, onbrush } = this.#target();
    const was = this.at ?? (from + to) / 2;
    const next = Math.min(to, Math.max(from, was + dir * STEP * (to - from)));

    this.brush = e.shiftKey && onbrush ? [this.brush?.[0] ?? was, next] : null;
    this.#pinned = true;
    this.at = next;

    return true;
  }

  #enter(key: string): boolean | undefined {
    return key === "Enter" ? this.#narrow() : undefined;
  }

  #escape(key: string): boolean {
    if (key !== "Escape" || (this.at === null && !this.brush)) return false;

    this.at = null;
    this.brush = null;
    this.#pinned = false;

    return true;
  }
}
