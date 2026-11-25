// What asks for a context menu on the canvas (ADR 20 "Navigation"): the right button let go where
// it was pressed, as a right drag orbits, or a finger held still. It only watches: whatever else the
// press starts goes on.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */

/** Pixels a press may travel and still ask for the menu. */
const STILL = 5;

/** Milliseconds a still finger asks for the menu after. */
export const LONG_PRESS = 500;

/** Where on the page, in CSS pixels, and on the canvas, −1 to 1 across with y up. */
export interface Asked {
  readonly client: readonly [number, number];
  readonly ndc: readonly [number, number];
}

interface Down extends Asked {
  readonly pointer: number;
  /** The long press's timer, for a finger. */
  readonly timer: ReturnType<typeof setTimeout> | undefined;
}

/** Where `event` lands: on the page, and on `canvas`, −1 to 1 across with y up. */
export function whereOn(canvas: HTMLCanvasElement, event: PointerEvent): Asked {
  const box = canvas.getBoundingClientRect();

  return {
    client: [event.clientX, event.clientY],
    ndc: [
      ((event.clientX - box.left) / box.width) * 2 - 1,
      1 - ((event.clientY - box.top) / box.height) * 2,
    ],
  };
}

export class ContextPress {
  readonly #canvas: HTMLCanvasElement;
  readonly #ask: () => ((asked: Asked) => void) | undefined;
  #down: Down | undefined;
  #fingers = 0;

  /** Stops watching. */
  readonly dispose: () => void;

  /** Watches `canvas` before every other listener on it; `ask` hears each request. */
  constructor(canvas: HTMLCanvasElement, ask: () => ((asked: Asked) => void) | undefined) {
    this.#canvas = canvas;
    this.#ask = ask;

    const listeners = [
      ["pointerdown", this.#press],
      ["pointermove", this.#move],
      ["pointerup", this.#release],
      ["pointercancel", this.#release],
    ] as const;

    for (const [type, listener] of listeners) {
      canvas.addEventListener(type, listener, { capture: true });
    }

    canvas.addEventListener("contextmenu", this.#menu);

    this.dispose = () => {
      this.#forget();

      for (const [type, listener] of listeners) {
        canvas.removeEventListener(type, listener, { capture: true });
      }

      canvas.removeEventListener("contextmenu", this.#menu);
    };
  }

  #forget(): void {
    if (this.#down?.timer !== undefined) clearTimeout(this.#down.timer);

    this.#down = undefined;
  }

  readonly #press = (event: PointerEvent): void => {
    if (event.pointerType === "touch") this.#fingers += 1;

    this.#forget();

    const finger = event.pointerType === "touch" && event.button === 0;

    // A second finger pans and zooms.
    if (this.#ask() === undefined || this.#fingers > 1 || (!finger && event.button !== 2)) return;

    const asked = whereOn(this.#canvas, event);

    const timer = finger
      ? setTimeout(() => {
          this.#down = undefined;
          this.#ask()?.(asked);
        }, LONG_PRESS)
      : undefined;

    this.#down = { ...asked, pointer: event.pointerId, timer };
  };

  readonly #move = (event: PointerEvent): void => {
    const down = this.#down;

    if (down?.pointer !== event.pointerId) return;

    const travel = Math.hypot(event.clientX - down.client[0], event.clientY - down.client[1]);

    if (travel > STILL) this.#forget();
  };

  readonly #release = (event: PointerEvent): void => {
    if (event.pointerType === "touch") this.#fingers = Math.max(0, this.#fingers - 1);

    const down = this.#down;

    if (down?.pointer !== event.pointerId) return;

    this.#forget();

    // A finger let go before its long press was a tap.
    if (down.timer === undefined && event.type === "pointerup") {
      this.#ask()?.({ client: down.client, ndc: down.ndc });
    }
  };

  /** The browser's own menu never shows over the canvas. */
  readonly #menu = (event: Event): void => {
    if (this.#ask() !== undefined) event.preventDefault();
  };
}
