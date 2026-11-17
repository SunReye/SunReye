// Reading the weather detail's charts (ADR 23 "Dashboard", ADR 21 "Chart reading"): the hour
// under the pointer, and what every row says of it. A mouse reads where it hovers. A finger reads once it
// is held, then leads; one that moves first scrolls the sheet.
import { hourFigures, type Drawn, type HourFigures } from "./hour-figures.ts";
import type { Hour } from "./hourly.ts";

/** What a handler reads of a pointer event. */
type Pointer = Readonly<Pick<PointerEvent, "clientX" | "clientY" | "pointerType">> & {
  readonly currentTarget: Element;
};

/** How long a finger rests before it reads, in ms. */
const HOLD_MS = 250;

/** How far a resting finger may wander, in px. */
const SLACK = 8;

export class HourReading {
  /** The index of the hour being read; null with none. */
  at = $state<number | null>(null);

  /** The hour being read; null with none. */
  readonly hour = $derived.by((): Hour | null =>
    this.at === null ? null : (this.#day().hours[this.at] ?? null),
  );

  /** Each row's values at that hour. */
  readonly figures = $derived.by((): HourFigures | null =>
    this.hour === null ? null : hourFigures(this.hour, this.#day()),
  );

  readonly #day: () => Drawn & { readonly hours: readonly Hour[] };
  #held: { readonly x: number; readonly y: number; readonly timer: number } | undefined;

  /** `day` is the day being read, at the moment of an input. */
  constructor(day: () => Drawn & { readonly hours: readonly Hour[] }) {
    this.#day = day;
  }

  #over(e: Pointer): number {
    const box = e.currentTarget.getBoundingClientRect();
    const hours = this.#day().hours.length;
    const hour = Math.floor(((e.clientX - box.left) / box.width) * hours);

    return Math.min(hours - 1, Math.max(0, hour));
  }

  #drop(): void {
    clearTimeout(this.#held?.timer);
    this.#held = undefined;
  }

  down = (e: Pointer): void => {
    if (e.pointerType === "mouse") return;

    this.#drop();

    const hour = this.#over(e);

    const timer = window.setTimeout(() => {
      this.at = hour;
    }, HOLD_MS);

    this.#held = { x: e.clientX, y: e.clientY, timer };
  };

  move = (e: Pointer): void => {
    if (e.pointerType === "mouse" || this.at !== null) this.at = this.#over(e);
    else if (this.#held && Math.hypot(e.clientX - this.#held.x, e.clientY - this.#held.y) > SLACK)
      this.#drop();
  };

  /** A lifted finger ends its reading; a mouse reads on through a click. */
  up = (e: Pointer): void => {
    if (e.pointerType !== "mouse") this.end();
  };

  /** The pointer left, or the finger began to scroll. */
  end = (): void => {
    this.#drop();
    this.at = null;
  };
}
